import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PRECOS_VIEW_ROLES } from '@/lib/auth/precos-guard';
import { getVisibleCompanies, isReadOnlyRole, normalizeRole, userHasPagePermission } from '@/lib/auth/permissions';
import { findUserByUsername } from '@/lib/auth/users-store';
import { faltaConfigurarAgendamento } from '@/lib/precos/agendador-qstash';
import { montarTarefaPrecos } from '@/lib/precos/montar-tarefa';
import {
  aplicarTarefaAgora,
  excluirTarefaComDisparo,
  programarTarefa,
} from '@/lib/precos/tarefas-executor';
import { listarTarefas, obterTarefa, salvarTarefa, type PrecoTarefa } from '@/lib/precos/tarefas-store';
import { validarAlteracoes } from '@/lib/precos/tarefas-validacao';
import { fetchLoteDetalhe } from '@/lib/repositories/precosTarefas';
import {
  fetchHistoricoLotes,
  fetchProdutosPrecos,
  reverterLotePrecos,
  type ExecutarPrecosResult,
  type PrecoCompany,
} from '@/lib/repositories/precos';
import { empresaSchema, listaOuNull, texto } from '@/lib/mcp/shared';
import type { RoleKey, UserSession } from '@/types/auth';

/**
 * Tools do MCP de PREÇOS (/api/mcp-precos/mcp): o Programar Preços sem a tela.
 * Tudo passa pelas MESMAS funções da página (montagem, validação, agendamento QStash,
 * executor, histórico NERD_PRECO_HISTORICO e estorno), então o que o conector faz
 * aparece na tela e pode ser desfeito por lá, e vice-versa.
 *
 * Permissão, conferida a CADA chamada contra o cadastro atual do /admin:
 *  - ler (consultar, listar, histórico): função com acesso a custo/preço
 *    (admin, diretor, logística) + página "Programar Preços" liberada + a empresa;
 *  - gravar (criar, agendar, aplicar, excluir, reverter): o mesmo, sem ser
 *    somente-leitura (diretor só consulta, como na tela).
 * O registro de quem fez sai no nome do dono do token.
 */

const TZ = 'America/Sao_Paulo';

type Extra = { authInfo?: { extra?: Record<string, unknown> } };

interface Acesso {
  username: string;
  role: RoleKey;
  podeAlterar: boolean;
  empresas: PrecoCompany[];
}

class AcessoNegado extends Error {}

async function carregarAcesso(extra: Extra): Promise<Acesso> {
  const username = String(extra.authInfo?.extra?.username ?? '').trim();
  if (!username) throw new AcessoNegado('Token sem usuário vinculado.');

  const user = await findUserByUsername(username);
  if (!user) throw new AcessoNegado(`O usuário ${username} do token não existe mais no /admin.`);

  const role = normalizeRole(user.role);
  const sessao: UserSession = {
    id: user.id,
    username: user.username,
    role,
    permissions: user.permissions ?? [],
    allowedCompanies: user.allowedCompanies,
  };

  if (!PRECOS_VIEW_ROLES.includes(role)) {
    throw new AcessoNegado(`A função de ${username} não tem acesso a custo e preço.`);
  }
  if (!userHasPagePermission(sessao, 'programar-precos')) {
    throw new AcessoNegado(`${username} não tem a página "Programar Preços" liberada no /admin.`);
  }

  const empresas = getVisibleCompanies(sessao).filter(
    (c): c is PrecoCompany => c === 'nerd' || c === 'scarfme'
  );
  return { username, role, podeAlterar: !isReadOnlyRole(role), empresas };
}

async function exigir(extra: Extra, company: PrecoCompany, escrita: boolean): Promise<Acesso> {
  const acesso = await carregarAcesso(extra);
  if (!acesso.empresas.includes(company)) {
    throw new AcessoNegado(`${acesso.username} não tem acesso à empresa ${company}.`);
  }
  if (escrita && !acesso.podeAlterar) {
    throw new AcessoNegado(`Acesso somente leitura: a função de ${acesso.username} não pode alterar preço.`);
  }
  return acesso;
}

function falha(mensagem: string) {
  return { content: [{ type: 'text' as const, text: JSON.stringify({ erro: mensagem }, null, 2) }], isError: true };
}

/** Roda o corpo da tool e transforma qualquer erro em resposta legível para o modelo. */
async function rodar(fn: () => Promise<unknown>) {
  try {
    return texto(await fn());
  } catch (error) {
    if (!(error instanceof AcessoNegado)) console.error('[mcp-precos] erro', error);
    return falha(error instanceof Error ? error.message : String(error));
  }
}

const round2 = (v: number | null | undefined) => (v === null || v === undefined ? null : Math.round(v * 100) / 100);

function dataBR(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' });
}

/**
 * Data/hora do agendamento. Sem fuso explícito, vale o horário de Brasília (é como o
 * usuário fala: "sexta às 00:00"). Brasil não tem horário de verão desde 2019.
 */
function parseQuando(valor: string): Date {
  const t = valor.trim().replace(' ', 'T');
  const semFuso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(t);
  const d = new Date(semFuso ? `${t}${t.length === 16 ? ':00' : ''}-03:00` : t);
  if (Number.isNaN(d.getTime())) throw new Error(`Data/hora inválida: ${valor}. Use AAAA-MM-DDTHH:MM.`);
  return d;
}

function resumoResultado(r: ExecutarPrecosResult | null) {
  if (!r) return null;
  return {
    lote: r.lote,
    aplicados: r.aplicados,
    semMudanca: r.semMudanca,
    semRegistro: r.semRegistro,
    naoConfirmados: r.naoConfirmados,
    erros: r.erros,
  };
}

function resumoTarefa(t: PrecoTarefa, detalhar = false) {
  return {
    id: t.id,
    nome: t.nome,
    status: t.status,
    agendadoPara: t.agendadoPara,
    agendadoParaBR: dataBR(t.agendadoPara),
    agendadoPor: t.agendadoPor,
    criadoPor: t.criadoPor,
    criadoEmBR: dataBR(t.criadoEm),
    executadoPor: t.executadoPor,
    executadoEmBR: dataBR(t.executadoEm),
    lote: t.lote,
    erro: t.erro,
    produtos: t.produtos.length,
    alteracoes: t.alteracoes.length,
    tabelas: [...new Set(t.alteracoes.map((a) => a.tabela))],
    resultado: resumoResultado(t.resultado),
    ...(detalhar
      ? {
          itens: t.alteracoes.map((a) => ({
            produto: a.produto,
            descricao: t.produtos.find((p) => p.produto === a.produto)?.descricao ?? '',
            tabela: a.tabela,
            tabelaDesc: a.tabelaDesc,
            atual: round2(a.atual),
            novo: round2(a.valor),
            variacaoPct: a.atual ? round2(((a.valor - a.atual) / a.atual) * 100) : null,
          })),
        }
      : {}),
  };
}

async function tarefaDaEmpresa(id: string, company: PrecoCompany): Promise<PrecoTarefa> {
  const tarefa = await obterTarefa(id.trim());
  if (!tarefa || tarefa.company !== company) throw new Error('Tarefa não encontrada.');
  return tarefa;
}

const confirmarSchema = z
  .literal(true)
  .describe('Só envie true DEPOIS que o usuário confirmou explicitamente nesta conversa.');

const itemSchema = z.object({
  codigo: z.string().describe('Código do produto ou código de barras.'),
  preco: z.number().nonnegative().optional().describe('Preço novo em R$. Use OU preco OU ajustePct.'),
  ajustePct: z
    .number()
    .gt(-100)
    .optional()
    .describe('Ajuste sobre o preço ATUAL de cada tabela: -30 = 30% de desconto, 10 = 10% de aumento.'),
  tabelas: z.array(z.string()).optional().describe('Tabelas só para este item (sobrepõe `tabelas` geral).'),
});

export function registerPrecosTools(server: McpServer) {
  server.registerTool(
    'quem_sou',
    {
      description:
        'Mostra o usuário dono deste token e o que ele pode fazer no Programar Preços (empresas, se pode alterar). ' +
        'Chame primeiro se não souber a empresa.',
      inputSchema: {},
    },
    async (_input, extra) =>
      rodar(async () => {
        const a = await carregarAcesso(extra as Extra);
        return {
          usuario: a.username,
          funcao: a.role,
          empresas: a.empresas,
          podeAlterar: a.podeAlterar,
          agendamentoIndisponivel: faltaConfigurarAgendamento(),
        };
      })
  );

  server.registerTool(
    'consultar_precos',
    {
      description:
        'Preço atual (Preço e Preço líquido, slot 1) dos produtos em cada tabela de preço que eles têm, mais o preço ' +
        'sugerido do cadastro. Use para conferir antes de montar uma tarefa. Informe `codigos` (produto ou barras) ' +
        'OU algum filtro (busca, grupos, linhas, coleções...).',
      inputSchema: {
        empresa: empresaSchema,
        codigos: z.array(z.string()).optional().describe('Códigos de produto ou de barras.'),
        busca: z.string().optional().describe('Trecho do nome ou do código (mín. 2 letras).'),
        grupos: z.array(z.string()).optional(),
        subgrupos: z.array(z.string()).optional(),
        linhas: z.array(z.string()).optional(),
        colecoes: z.array(z.string()).optional().describe('Códigos de coleção.'),
        tabelas: z.array(z.string()).optional().describe('Restringe às tabelas (ex.: ["01","ND"]).'),
        incluirInativos: z.boolean().optional(),
        limite: z.number().int().min(1).max(3000).optional().describe('Padrão 300.'),
      },
    },
    async (input, extra) =>
      rodar(async () => {
        await exigir(extra as Extra, input.empresa, false);
        const codigos = listaOuNull(input.codigos);
        const semFiltro =
          !codigos &&
          !listaOuNull(input.grupos) &&
          !listaOuNull(input.subgrupos) &&
          !listaOuNull(input.linhas) &&
          !listaOuNull(input.colecoes) &&
          (input.busca ?? '').trim().length < 2;
        if (semFiltro) throw new Error('Informe códigos ou algum filtro (busca, grupos, subgrupos, linhas, coleções).');

        const r = await fetchProdutosPrecos({
          company: input.empresa,
          codigos,
          busca: input.busca ?? null,
          grupos: listaOuNull(input.grupos),
          subgrupos: listaOuNull(input.subgrupos),
          linhas: listaOuNull(input.linhas),
          colecoes: listaOuNull(input.colecoes),
          tabelas: listaOuNull(input.tabelas),
          // Lista colada vale como está, igual à tela.
          incluirInativos: codigos ? true : !!input.incluirInativos,
          todoCadastro: !!codigos,
          camposCadastro: ['PRECO_REPOSICAO_1'],
          limite: input.limite ?? 300,
        });

        return {
          total: r.total,
          truncado: r.truncated,
          naoEncontrados: r.naoEncontrados,
          tabelas: r.tabelas,
          produtos: r.rows.map((row) => {
            const precos: Record<string, { preco: number | null; liquido: number | null }> = {};
            let precoSugerido: number | null = null;
            r.campos.forEach((c, i) => {
              if (row.sr.includes(i)) return;
              const v = round2(row.v[i]);
              if (c.origem === 'PRODUTOS') {
                if (c.campo === 'PRECO_REPOSICAO_1') precoSugerido = v;
                return;
              }
              const cod = c.codigoTabela!;
              precos[cod] ??= { preco: null, liquido: null };
              if (c.campo === 'PRECO1') precos[cod].preco = v;
              if (c.campo === 'PRECO_LIQUIDO1') precos[cod].liquido = v;
            });
            return {
              produto: row.produto,
              descricao: row.descricao,
              grupo: row.grupo,
              linha: row.linha,
              colecao: row.colecao,
              inativo: row.inativo,
              precoSugerido,
              precos,
            };
          }),
        };
      })
  );

  server.registerTool(
    'listar_tarefas',
    {
      description: 'Tarefas do Programar Preços (pendentes, agendadas, com erro; `incluirAplicadas` traz as já aplicadas).',
      inputSchema: {
        empresa: empresaSchema,
        incluirAplicadas: z.boolean().optional(),
      },
    },
    async (input, extra) =>
      rodar(async () => {
        await exigir(extra as Extra, input.empresa, false);
        const tarefas = await listarTarefas(input.empresa, { incluirAplicadas: !!input.incluirAplicadas });
        return { quantidade: tarefas.length, tarefas: tarefas.map((t) => resumoTarefa(t)) };
      })
  );

  server.registerTool(
    'ver_tarefa',
    {
      description: 'Uma tarefa com todos os itens: produto, tabela, preço atual (na hora da montagem), preço novo e variação %.',
      inputSchema: { empresa: empresaSchema, id: z.string() },
    },
    async (input, extra) =>
      rodar(async () => {
        await exigir(extra as Extra, input.empresa, false);
        return resumoTarefa(await tarefaDaEmpresa(input.id, input.empresa), true);
      })
  );

  server.registerTool(
    'criar_tarefa',
    {
      description:
        'Monta uma tarefa de preço a partir de uma lista "código → preço" (ou ajuste % sobre o preço atual). Altera o ' +
        'Preço (PRECO1) de cada tabela pedida; o Preço líquido acompanha na aplicação, como na tela. NÃO aplica nada: ' +
        'a tarefa fica PENDENTE (ou agendada, com `agendarPara`) e aparece na tela Programar Preços. ' +
        'Use `simular: true` para só ver o que entraria, sem salvar. Com `id`, substitui o conteúdo de uma tarefa ' +
        'pendente/agendada existente. Sempre relate ao usuário os avisos (não encontrados, sem registro na tabela, conflitos).',
      inputSchema: {
        empresa: empresaSchema,
        nome: z.string().min(1).max(120).describe('Nome da tarefa (ex.: "Black Friday capas").'),
        tabelas: z
          .array(z.string())
          .optional()
          .describe('Tabelas de preço que valem para todos os itens (ex.: ["01","ND"]). Veja consultar_precos.'),
        itens: z.array(itemSchema).min(1).max(20000),
        agendarPara: z
          .string()
          .optional()
          .describe('Data/hora para aplicar sozinha (AAAA-MM-DDTHH:MM, horário de Brasília). Omitido = pendente.'),
        simular: z.boolean().optional().describe('true = só mostra o resultado, não salva.'),
        id: z.string().optional().describe('Tarefa existente a substituir.'),
      },
    },
    async (input, extra) =>
      rodar(async () => {
        const acesso = await exigir(extra as Extra, input.empresa, !input.simular);

        const montagem = await montarTarefaPrecos({
          company: input.empresa,
          itens: input.itens,
          tabelas: input.tabelas ?? [],
        });
        const avisos = Object.fromEntries(
          Object.entries(montagem.avisos).filter(([, v]) => Array.isArray(v) && v.length > 0)
        );
        const previa = {
          alteracoes: montagem.alteracoes.length,
          produtos: montagem.produtos.length,
          tabelas: montagem.tabelas,
          avisos,
        };

        if (montagem.alteracoes.length === 0) {
          return { salvo: false, motivo: 'Nenhuma alteração a gravar (nada muda ou nada foi encontrado).', ...previa };
        }

        const { alteracoes, erro } = validarAlteracoes(montagem.alteracoes);
        if (erro) throw new Error(erro);

        const quando = input.agendarPara ? parseQuando(input.agendarPara) : null;

        if (input.simular) {
          const tmp: PrecoTarefa = {
            id: '(simulação)',
            company: input.empresa,
            nome: input.nome,
            status: 'pendente',
            agendadoPara: quando?.toISOString() ?? null,
            agendadoPor: null,
            qstashMessageId: null,
            produtos: montagem.produtos,
            alteracoes,
            criadoPor: acesso.username,
            criadoEm: new Date().toISOString(),
            atualizadoPor: null,
            atualizadoEm: new Date().toISOString(),
            executadoPor: null,
            executadoEm: null,
            lote: null,
            resultado: null,
            erro: null,
          };
          return { salvo: false, simulacao: true, ...previa, tarefa: resumoTarefa(tmp, true) };
        }

        const id = input.id?.trim() || null;
        if (id) {
          const existente = await tarefaDaEmpresa(id, input.empresa);
          if (existente.status === 'executando' || existente.status === 'aplicada') {
            throw new Error('Esta tarefa já foi aplicada; crie outra.');
          }
        }

        let tarefa = await salvarTarefa({
          id,
          company: input.empresa,
          nome: input.nome.trim(),
          produtos: montagem.produtos,
          alteracoes,
          usuario: acesso.username,
        });

        let erroAgendamento: string | null = null;
        if (quando) {
          try {
            tarefa = await programarTarefa(tarefa, quando, acesso.username);
          } catch (e) {
            erroAgendamento = `Tarefa salva como PENDENTE, mas não foi agendada: ${e instanceof Error ? e.message : String(e)}`;
          }
        }

        return { salvo: true, erroAgendamento, ...previa, tarefa: resumoTarefa(tarefa, true) };
      })
  );

  server.registerTool(
    'agendar_tarefa',
    {
      description:
        'Agenda a tarefa para aplicar sozinha numa data/hora (horário de Brasília), ou volta para pendente com ' +
        '`agendarPara: null`. Precisa ser pelo menos 1 minuto no futuro.',
      inputSchema: {
        empresa: empresaSchema,
        id: z.string(),
        agendarPara: z.string().nullable().describe('AAAA-MM-DDTHH:MM (Brasília) ou null para desagendar.'),
      },
    },
    async (input, extra) =>
      rodar(async () => {
        const acesso = await exigir(extra as Extra, input.empresa, true);
        const tarefa = await tarefaDaEmpresa(input.id, input.empresa);
        const quando = input.agendarPara ? parseQuando(input.agendarPara) : null;
        return resumoTarefa(await programarTarefa(tarefa, quando, acesso.username));
      })
  );

  server.registerTool(
    'aplicar_tarefa_agora',
    {
      description:
        'APLICA a tarefa no Linx agora (grava os preços). Gera um lote no histórico que pode ser desfeito com ' +
        'reverter_lote. Antes de chamar, mostre ao usuário o resumo (ver_tarefa) e peça confirmação.',
      inputSchema: { empresa: empresaSchema, id: z.string(), confirmar: confirmarSchema },
    },
    async (input, extra) =>
      rodar(async () => {
        const acesso = await exigir(extra as Extra, input.empresa, true);
        const { tarefa, resultado } = await aplicarTarefaAgora(input.id.trim(), input.empresa, acesso.username);
        return { tarefa: resumoTarefa(tarefa), resultado: resumoResultado(resultado) };
      })
  );

  server.registerTool(
    'excluir_tarefa',
    {
      description: 'Exclui uma tarefa (e cancela o agendamento). Não mexe em preço nenhum; tarefa já aplicada se desfaz com reverter_lote.',
      inputSchema: { empresa: empresaSchema, id: z.string() },
    },
    async (input, extra) =>
      rodar(async () => {
        await exigir(extra as Extra, input.empresa, true);
        await excluirTarefaComDisparo(input.id.trim(), input.empresa);
        return { excluida: input.id };
      })
  );

  server.registerTool(
    'historico_precos',
    {
      description:
        'Lotes de alteração de preço já aplicados (pela tela, por tarefa, pelo Black Friday ou por este conector), ' +
        'mais recentes primeiro. Com `lote`, traz os itens daquele lote (antes/depois por produto e tabela).',
      inputSchema: {
        empresa: empresaSchema,
        lote: z.string().optional(),
        limite: z.number().int().min(1).max(200).optional().describe('Padrão 30.'),
      },
    },
    async (input, extra) =>
      rodar(async () => {
        await exigir(extra as Extra, input.empresa, false);
        if (input.lote?.trim()) {
          const linhas = await fetchLoteDetalhe(input.lote.trim(), input.empresa);
          return { lote: input.lote.trim(), itens: linhas.length, linhas };
        }
        const lotes = await fetchHistoricoLotes(input.empresa, input.limite ?? 30);
        // DATA_ALTERACAO é GETDATE() (já hora de Brasília) e o driver rotula como UTC:
        // formatar em UTC devolve o relógio gravado — mesma regra do `dataLinx` da tela.
        return {
          lotes: lotes.map((l) => {
            const d = new Date(l.data);
            const dataBR = Number.isNaN(d.getTime())
              ? l.data
              : d.toLocaleString('pt-BR', { timeZone: 'UTC', dateStyle: 'short', timeStyle: 'short' });
            return { ...l, dataBR };
          }),
        };
      })
  );

  server.registerTool(
    'reverter_lote',
    {
      description:
        'Desfaz um lote aplicado, regravando os valores anteriores (gera um lote de estorno; nada é apagado). ' +
        'Com `produto`, desfaz só aquele produto e o resto do lote segue valendo. Peça confirmação antes.',
      inputSchema: {
        empresa: empresaSchema,
        lote: z.string(),
        produto: z.string().optional().describe('Código do produto para desfazer só ele.'),
        confirmar: confirmarSchema,
      },
    },
    async (input, extra) =>
      rodar(async () => {
        const acesso = await exigir(extra as Extra, input.empresa, true);
        const r = await reverterLotePrecos(input.lote.trim(), input.empresa, acesso.username, input.produto?.trim() || null);
        return { estorno: resumoResultado(r) };
      })
  );
}

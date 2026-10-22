import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GRUPOS_ORCAMENTO } from '@/lib/config/orcamento-despesas';
import { obterOrcamentoMes } from '@/lib/financeiro/orcamento-mes';
import {
  consultarAba,
  consultarLancamentos,
  obterDre,
  obterMeta,
  opcoesLancamentos,
} from '@/lib/financeiro/store';
import { dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tools do MCP do FINANCEIRO (/api/mcp-financeiro/mcp). Só leitura, sobre a base do
 * Controle Financeiro (planilha da Débora, Scarf Me) — as mesmas funções das telas, então
 * o número do conector é o número da página.
 */

/** A planilha do financeiro é da Scarf Me. */
const EMPRESA = 'scarfme';

const BLOCO_PRINCIPAL = 'Consolidado';

const round2 = (v: number) => Math.round(v * 100) / 100;

/** "Resultado Líquido" = "resultado liquido": nomes de linha/aba sem acento, caixa ou espaço extra. */
const chave = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

async function dataReferencia(): Promise<string | null> {
  const meta = await obterMeta(EMPRESA);
  const datas = meta.abas
    .filter((a) => a.tipo === 'lancamento' && a.dataReferencia)
    .map((a) => a.dataReferencia!.slice(0, 10))
    .sort();
  return datas[datas.length - 1] ?? null;
}

export function registerFinanceiroTools(server: McpServer) {
  server.registerTool(
    'financeiro_status',
    {
      description:
        'Estado da base do Controle Financeiro (planilha "Controle Financeiro - Scarf Me", mantida pela Débora): ' +
        'até que dia a planilha tem dado real (`dadosAte`, a data das abas de lançamento), quando e por quem foi ' +
        'importada, e as abas gravadas (nome, tipo, nº de registros). Chame primeiro para saber se o dado está atual ' +
        'e quais abas existem para `planilha_aba`.',
      inputSchema: {},
    },
    async () => {
      const meta = await obterMeta(EMPRESA);
      return texto({
        empresa: EMPRESA,
        dadosAte: await dataReferencia(),
        ultimaImportacao: meta.ultimaImportacao
          ? {
              arquivo: meta.ultimaImportacao.arquivo,
              aplicadaEm: meta.ultimaImportacao.aplicadoEm,
              aplicadaPor: meta.ultimaImportacao.aplicadoPor,
            }
          : null,
        totalRegistros: meta.totalRegistros,
        abas: meta.abas.map((a) => ({
          aba: a.aba,
          tipo: a.tipo,
          titulo: a.titulo,
          dataReferencia: a.dataReferencia ? a.dataReferencia.slice(0, 10) : null,
          registros: a.totalRegistros,
        })),
        tipos: {
          lancamento: 'abas de despesa (Outros, Funcionários, Fornecedor, Shoppings, Receitas e Despesas Fin, Impostos) → use `lancamentos`',
          dre: 'DRE mensal → use `dre`',
          caixa_diario: 'saldo de caixa dia a dia → use `planilha_aba`',
          entrada_banco: 'recebimentos por banco → use `planilha_aba`',
          entrada_atacado: 'recebimentos do atacado → use `planilha_aba`',
          budget: 'Budget x Realizado antigo (2017–2018) — o orçado atual está em `orcamento_mes`',
          grade: 'abas auxiliares, como estão na planilha → use `planilha_aba`',
        },
      });
    },
  );

  server.registerTool(
    'orcamento_mes',
    {
      description:
        'Despesas do mês × orçado, por linha do budget 2027 (cenário base; cobre out/2026 a dez/2027) — a aba ' +
        '"Orçamento do mês" do Controle Financeiro, pedida pelo Hélio. Por linha: orçado, MTD (saiu do caixa do dia 1º ' +
        'até a posição, pela DATA CAIXA), saldo do mês (orçado − MTD), saldo por dia (saldo ÷ dias do mês depois da ' +
        'posição), agendado (vence depois da posição, já lançado — não entra no saldo) e situação: "ok", "risco" ' +
        '(estoura somando o agendado) ou "estourou". `itens` abre cada linha por aba × classificação. ' +
        'Padrão da posição = data da planilha da Débora (último dia com dado real), NÃO hoje. Taxa de cartão fica fora ' +
        '(não tem lançamento; acompanha a receita).',
      inputSchema: {
        posicao: dataSchema
          .optional()
          .describe('Data de posição (YYYY-MM-DD). Padrão: a data da planilha (último dia com dado real).'),
      },
    },
    async ({ posicao }) => {
      const r = await obterOrcamentoMes(EMPRESA, posicao);
      const enriquecer = (orcado: number, mtd: number, agendado: number) => {
        const saldo = round2(orcado - mtd);
        return {
          orcado: round2(orcado),
          mtd: round2(mtd),
          consumo: orcado > 0 ? round2(mtd / orcado) : null,
          saldoMes: saldo,
          saldoPorDia: r.diasRestantes > 0 && saldo >= 0 ? round2(saldo / r.diasRestantes) : null,
          agendado: round2(agendado),
          situacao: mtd > orcado + 0.005 ? 'estourou' : mtd + agendado > orcado + 0.005 ? 'risco' : 'ok',
        };
      };
      const soma = (ls: typeof r.linhas) =>
        enriquecer(
          ls.reduce((t, l) => t + (l.orcado ?? 0), 0),
          ls.reduce((t, l) => t + l.mtd, 0),
          ls.reduce((t, l) => t + l.agendado, 0),
        );
      return texto({
        mes: r.mes.slice(0, 7),
        posicao: r.posicao,
        dadosAte: r.dataReferencia,
        diasNoMes: r.diasNoMes,
        diasRestantes: r.diasRestantes,
        temOrcado: r.temOrcado,
        total: soma(r.linhas),
        grupos: GRUPOS_ORCAMENTO.map((g) => {
          const ls = r.linhas.filter((l) => l.grupo === g.key);
          return {
            grupo: g.label,
            total: soma(ls),
            linhas: ls.map((l) => ({
              linha: l.label,
              referencia: l.referencia,
              ressalva: l.ressalva,
              ...enriquecer(l.orcado ?? 0, l.mtd, l.agendado),
              itens: l.itens,
            })),
          };
        }),
        foraDoBudget: r.fora,
      });
    },
  );

  server.registerTool(
    'dre',
    {
      description:
        'DRE da planilha do financeiro, mês a mês, como está na aba DRE (receitas por canal, CMV, despesas por linha, ' +
        'impostos, despesas financeiras, resultado operacional e líquido, sócios, investimentos, amortização). ' +
        'Valores de despesa vêm negativos. Meses a partir do mês de `dadosAte` são parciais/projeção. ' +
        'Padrão: ano de `dadosAte`, bloco "Consolidado" (há outros blocos, ex.: "WEB DRE" — listados em `blocos`).',
      inputSchema: {
        ano: z.number().int().min(2013).max(2030).optional().describe('Ano (jan–dez). Padrão: ano da última atualização.'),
        bloco: z.string().optional().describe('Bloco da DRE. Padrão: "Consolidado".'),
        linhas: listaOpcional('Só estas linhas (rótulo exato, ex.: ["Total Receitas","Resultado Líquido"]).'),
      },
    },
    async ({ ano, bloco, linhas }) => {
      const ref = await dataReferencia();
      const a = ano ?? Number((ref ?? new Date().toISOString()).slice(0, 4));
      const dre = await obterDre(EMPRESA, `${a}-01-01`, `${a}-12-01`);
      const b = bloco ?? BLOCO_PRINCIPAL;
      const filtro = listaOuNull(linhas)?.map(chave);
      const valores = new Map<string, number | null>();
      for (const c of dre.celulas) valores.set(`${c.linha}|${c.mes.slice(0, 7)}`, c.valor);
      const meses = Array.from({ length: 12 }, (_, i) => `${a}-${String(i + 1).padStart(2, '0')}`);
      const saida = dre.layout
        .filter((l) => l.bloco === b && !l.titulo && l.rotulo)
        .filter((l) => !filtro || filtro.includes(chave(l.rotulo)))
        .map((l) => {
          const porMes = Object.fromEntries(meses.map((m) => [m, valores.get(`${l.linha}|${m}`) ?? null]));
          const vals = Object.values(porMes).filter((v): v is number => v != null);
          return {
            linhaPlanilha: l.linha,
            rotulo: l.rotulo,
            formato: l.formato,
            meses: porMes,
            totalAno: l.formato === 'moeda' && vals.length ? round2(vals.reduce((t, v) => t + v, 0)) : null,
          };
        })
        .filter((l) => Object.values(l.meses).some((v) => v != null));
      return texto({
        ano: a,
        bloco: b,
        dadosAte: ref,
        blocos: [...new Set(dre.layout.map((l) => l.bloco))],
        linhas: saida,
      });
    },
  );

  server.registerTool(
    'lancamentos',
    {
      description:
        'Lançamentos das abas de despesa da planilha do financeiro (Outros, Funcionários, Fornecedor, Shoppings, ' +
        'Receitas e Despesas Fin, Impostos): data competência e caixa, valor (saída negativa), descrição, matriz, loja, ' +
        'classificação, forma de pagamento, status (PAGO/PENDENTE). Traz totais (saídas, entradas, pendente) e ' +
        'agregados por mês, classificação e aba de TUDO que casa o filtro, mais uma página de itens. ' +
        'Opções de filtro (abas, classificações, lojas…) em `lancamentos_opcoes`.',
      inputSchema: {
        abas: listaOpcional('Abas (ex.: ["Funcionários"]).'),
        classificacoes: listaOpcional('Classificações (coluna J; aceita a grafia da DRE, ex.: "Folha - VAREJO").'),
        lojas: listaOpcional('Lojas / shoppings.'),
        data: z.enum(['competencia', 'caixa']).optional().describe('Data usada no período e na série mensal. Padrão: competencia.'),
        inicio: dataSchema.optional().describe('Início do período (pela `data`).'),
        fim: dataSchema.optional().describe('Fim do período (pela `data`).'),
        mesCompetencia: dataSchema.optional().describe('Mês exato de competência (YYYY-MM-01), como a célula da DRE.'),
        status: z.enum(['PAGO', 'PENDENTE']).optional(),
        sinal: z.enum(['saida', 'entrada']).optional(),
        busca: z.string().optional().describe('Texto livre (descrição, loja, classificação…).'),
        ordem: z.enum(['data_desc', 'data_asc', 'valor_asc', 'valor_desc']).optional().describe('Padrão: data_desc. valor_asc = maiores saídas primeiro.'),
        limite: z.number().int().min(10).max(1000).optional().describe('Itens por página. Padrão 200.'),
        pagina: z.number().int().min(1).optional(),
      },
    },
    async (input) => {
      const r = await consultarLancamentos(EMPRESA, {
        abas: listaOuNull(input.abas) ?? undefined,
        classificacoes: listaOuNull(input.classificacoes) ?? undefined,
        lojas: listaOuNull(input.lojas) ?? undefined,
        status: input.status,
        data: input.data ?? 'competencia',
        de: input.inicio,
        ate: input.fim,
        mesCompetencia: input.mesCompetencia,
        sinal: input.sinal,
        q: input.busca,
        ordem: input.ordem ?? 'data_desc',
        pagina: input.pagina ?? 1,
        porPagina: input.limite ?? 200,
      });
      return texto({
        total: r.total,
        soma: round2(r.soma),
        saidas: round2(r.saidas),
        entradas: round2(r.entradas),
        pendente: round2(r.pendente),
        porMes: r.porMes,
        porClassificacao: r.porClassificacao,
        porAba: r.porAba,
        pagina: input.pagina ?? 1,
        quantidadeRetornada: r.itens.length,
        itens: r.itens.map((l) => ({
          aba: l.aba,
          linhaPlanilha: l.linha,
          competencia: l.dataCompetencia,
          caixa: l.dataCaixa,
          valor: l.valor,
          descricao: l.descricao,
          classificacao: l.classificacao,
          matriz: l.matriz,
          loja: l.loja,
          formaPgto: l.formaPgto,
          status: l.status,
        })),
      });
    },
  );

  server.registerTool(
    'lancamentos_opcoes',
    {
      description:
        'Valores possíveis dos filtros de `lancamentos` (abas, classificações, matrizes, lojas, status, formas de ' +
        'pagamento), com a contagem de lançamentos de cada um, e o intervalo de datas da base.',
      inputSchema: {},
    },
    async () => texto(await opcoesLancamentos(EMPRESA)),
  );

  server.registerTool(
    'planilha_aba',
    {
      description:
        'Linhas de QUALQUER aba gravada da planilha do financeiro, na estrutura dela: caixa diário ' +
        '("Caixa Diário_Evolucao"), recebimentos ("Entradas", "Entradas Atacado"), "RESUMO RESULTADO", "Un. de Negocio", ' +
        '"Budget x Realizado" etc. (nomes em `financeiro_status`). Cada item: `campos` (colunas reconhecidas: datas, ' +
        'valor, descrição…) e `extras` (as demais colunas, pelo título da planilha). `serieMensal` soma `valor` por mês.',
      inputSchema: {
        aba: z.string().describe('Nome exato da aba (veja financeiro_status).'),
        campoData: z.enum(['data_caixa', 'data_competencia', 'mes_competencia']).optional().describe('Campo de data do período. Padrão: data_caixa.'),
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        busca: z.string().optional().describe('Texto livre em qualquer coluna.'),
        ordem: z.enum(['linha', 'data_desc', 'data_asc']).optional().describe('Padrão: linha (ordem da planilha).'),
        serieMensal: z.boolean().optional(),
        limite: z.number().int().min(10).max(2000).optional().describe('Itens por página. Padrão 300.'),
        pagina: z.number().int().min(1).optional(),
      },
    },
    async (input) => {
      const meta = await obterMeta(EMPRESA);
      const aba = meta.abas.find((a) => chave(a.aba) === chave(input.aba))?.aba;
      if (!aba) {
        return texto({ erro: `Aba "${input.aba}" não encontrada.`, abas: meta.abas.map((a) => a.aba) });
      }
      const r = await consultarAba(EMPRESA, {
        aba,
        campoData: input.campoData,
        de: input.inicio,
        ate: input.fim,
        q: input.busca,
        ordem: input.ordem ?? 'linha',
        serieMensal: input.serieMensal,
        pagina: input.pagina ?? 1,
        porPagina: input.limite ?? 300,
      });
      if (!r.aba) return texto({ erro: `Aba "${aba}" sem estrutura gravada.` });
      const vazio = (v: unknown) => v == null || v === '';
      return texto({
        aba: r.aba.aba,
        tipo: r.aba.tipo,
        colunas: r.aba.colunas.map((c) => ({ coluna: c.letra, titulo: c.titulo, campo: c.campo })),
        total: r.total,
        soma: round2(r.soma),
        serie: r.serie.length ? r.serie : undefined,
        quantidadeRetornada: r.itens.length,
        itens: r.itens.map((i) => ({
          linhaPlanilha: i.linha,
          campos: Object.fromEntries(Object.entries(i.c).filter(([, v]) => !vazio(v))),
          extras: i.x,
        })),
      });
    },
  );
}

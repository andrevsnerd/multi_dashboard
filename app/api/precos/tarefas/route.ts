import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { faltaConfigurarAgendamento } from '@/lib/precos/agendador-qstash';
import { programarTarefa } from '@/lib/precos/tarefas-executor';
import {
  listarTarefas,
  obterTarefa,
  salvarTarefa,
  type TarefaAlteracao,
  type TarefaModo,
  type TarefaProduto,
} from '@/lib/precos/tarefas-store';
import { separarItemCor } from '@/lib/repositories/precosCor';
import { LIMITE_ALTERACOES, parseCampoKey } from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Tarefas da empresa (pendentes/agendadas; `?aplicadas=1` traz as já aplicadas). */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parsePrecoCompany(searchParams.get('company'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  try {
    const tarefas = await listarTarefas(company, { incluirAplicadas: searchParams.get('aplicadas') === '1' });
    return NextResponse.json({
      tarefas,
      podeExecutar: autorizacao.auth.podeExecutar,
      agendamentoIndisponivel: faltaConfigurarAgendamento(),
    });
  } catch (error) {
    console.error('[precos/tarefas] erro ao listar', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar tarefas.' },
      { status: 500 }
    );
  }
}

interface Body {
  id?: string | null;
  company?: string;
  nome?: string;
  modo?: TarefaModo;
  produtos?: TarefaProduto[];
  alteracoes?: TarefaAlteracao[];
  /** ISO; null deixa pendente; ausente mantém o agendamento atual. */
  agendadoPara?: string | null;
}

function limpar(v: unknown): string {
  return String(v ?? '').trim();
}

/**
 * Só preço de tabela (PRODUTOS_PRECOS) entra numa tarefa: é o que a tela edita. A chave
 * passa pela mesma whitelist do Alterar Custo / Preço — nada do cliente vai cru ao SQL.
 */
function validarAlteracoes(
  entrada: unknown,
  modo: TarefaModo
): { alteracoes: TarefaAlteracao[]; erro: string | null } {
  if (!Array.isArray(entrada) || entrada.length === 0) {
    return { alteracoes: [], erro: 'A tarefa não tem nenhuma alteração.' };
  }
  const vistos = new Set<string>();
  const alteracoes: TarefaAlteracao[] = [];
  for (const raw of entrada as Array<Record<string, unknown>>) {
    const produto = limpar(raw?.produto);
    const campo = parseCampoKey(limpar(raw?.campoKey));
    const valor = Number(raw?.valor);
    if (!produto || !campo || campo.origem !== 'PRODUTOS_PRECOS') {
      return { alteracoes: [], erro: `Alteração inválida (${produto || 'sem produto'}).` };
    }
    // Modo cor: o item é `PRODUTO|COR`; modo produto: código puro (sem a barra).
    if ((modo === 'cor') !== produto.includes('|') || (modo === 'cor' && !separarItemCor(produto))) {
      return { alteracoes: [], erro: `Item ${produto} não combina com o modo ${modo === 'cor' ? 'por cor' : 'por produto'}.` };
    }
    if (!Number.isFinite(valor) || valor < 0) {
      return { alteracoes: [], erro: `Valor inválido para ${produto} na tabela ${campo.codigoTabela}.` };
    }
    const chave = `${produto}||${campo.key}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const atual = raw?.atual === null || raw?.atual === undefined ? null : Number(raw.atual);
    alteracoes.push({
      produto,
      campoKey: campo.key,
      valor: Math.round(valor * 100) / 100,
      atual: atual !== null && Number.isFinite(atual) ? atual : null,
      tabela: campo.codigoTabela ?? '',
      tabelaDesc: limpar(raw?.tabelaDesc).slice(0, 120),
    });
  }
  if (alteracoes.length > LIMITE_ALTERACOES) {
    return { alteracoes: [], erro: `São ${alteracoes.length} alterações (limite ${LIMITE_ALTERACOES}).` };
  }
  return { alteracoes, erro: null };
}

/** Cria ou atualiza uma tarefa e, se pedido, agenda/desagenda o disparo. */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;
  const usuario = autorizacao.auth.username;

  try {
    const body = (await request.json()) as Body;
    const company = parsePrecoCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

    const nome = limpar(body.nome).slice(0, 120);
    if (!nome) return NextResponse.json({ error: 'Dê um nome para a tarefa.' }, { status: 400 });

    const modo: TarefaModo = body.modo === 'cor' ? 'cor' : 'produto';
    const { alteracoes, erro } = validarAlteracoes(body.alteracoes, modo);
    if (erro) return NextResponse.json({ error: erro }, { status: 400 });

    const comAlteracao = new Set(alteracoes.map((a) => a.produto));
    const produtos: TarefaProduto[] = (Array.isArray(body.produtos) ? body.produtos : [])
      .map((p) => ({ produto: limpar(p?.produto), descricao: limpar(p?.descricao).slice(0, 200) }))
      .filter((p) => p.produto && comAlteracao.has(p.produto));

    const id = limpar(body.id) || null;
    if (id) {
      const existente = await obterTarefa(id);
      if (!existente || existente.company !== company) {
        return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
      }
      if (existente.status === 'executando' || existente.status === 'aplicada') {
        return NextResponse.json({ error: 'Esta tarefa já foi aplicada; crie outra.' }, { status: 409 });
      }
    }

    let tarefa = await salvarTarefa({ id, company, nome, modo, produtos, alteracoes, usuario });

    if (body.agendadoPara !== undefined) {
      try {
        tarefa = await programarTarefa(tarefa, body.agendadoPara ? new Date(body.agendadoPara) : null, usuario);
      } catch (agendaErro) {
        // O conteúdo já ficou salvo; só o agendamento falhou. A tela mostra os dois fatos.
        return NextResponse.json(
          {
            tarefa,
            error: `Tarefa salva como pendente, mas não foi agendada: ${
              agendaErro instanceof Error ? agendaErro.message : String(agendaErro)
            }`,
          },
          { status: 422 }
        );
      }
    }

    return NextResponse.json({ tarefa });
  } catch (error) {
    console.error('[precos/tarefas] erro ao salvar', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao salvar a tarefa.' },
      { status: 500 }
    );
  }
}

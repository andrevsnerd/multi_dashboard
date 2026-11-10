import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { faltaConfigurarAgendamento } from '@/lib/precos/agendador-qstash';
import { programarTarefa } from '@/lib/precos/tarefas-executor';
import {
  listarTarefas,
  obterTarefa,
  salvarTarefa,
  type TarefaAlteracao,
  type TarefaProduto,
} from '@/lib/precos/tarefas-store';
import { validarAlteracoes } from '@/lib/precos/tarefas-validacao';

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
  produtos?: TarefaProduto[];
  alteracoes?: TarefaAlteracao[];
  /** ISO; null deixa pendente; ausente mantém o agendamento atual. */
  agendadoPara?: string | null;
}

function limpar(v: unknown): string {
  return String(v ?? '').trim();
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

    const { alteracoes, erro } = validarAlteracoes(body.alteracoes);
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

    let tarefa = await salvarTarefa({ id, company, nome, produtos, alteracoes, usuario });

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

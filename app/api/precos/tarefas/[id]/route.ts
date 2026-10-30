import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { cancelarDisparo } from '@/lib/precos/agendador-qstash';
import { programarTarefa } from '@/lib/precos/tarefas-executor';
import { excluirTarefa, obterTarefa } from '@/lib/precos/tarefas-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

async function carregar(request: Request, id: string, company: string | null) {
  const empresa = parsePrecoCompany(company);
  if (!empresa) return { erro: NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 }) };
  const tarefa = await obterTarefa(id);
  if (!tarefa || tarefa.company !== empresa) {
    return { erro: NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 }) };
  }
  return { tarefa };
}

export async function GET(request: Request, { params }: Ctx) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;
  const { id } = await params;
  const r = await carregar(request, id, new URL(request.url).searchParams.get('company'));
  if ('erro' in r) return r.erro;
  return NextResponse.json({ tarefa: r.tarefa });
}

/** Agenda (`agendadoPara` ISO) ou volta para pendente (`agendadoPara: null`). */
export async function PATCH(request: Request, { params }: Ctx) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;
  const { id } = await params;

  try {
    const body = (await request.json()) as { company?: string; agendadoPara?: string | null };
    const r = await carregar(request, id, body.company ?? null);
    if ('erro' in r) return r.erro;
    const tarefa = await programarTarefa(
      r.tarefa,
      body.agendadoPara ? new Date(body.agendadoPara) : null,
      autorizacao.auth.username
    );
    return NextResponse.json({ tarefa });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao agendar.' },
      { status: 400 }
    );
  }
}

/** Exclui a tarefa (e cancela o disparo, se estava agendada). Não mexe em preço nenhum. */
export async function DELETE(request: Request, { params }: Ctx) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;
  const { id } = await params;

  try {
    const r = await carregar(request, id, new URL(request.url).searchParams.get('company'));
    if ('erro' in r) return r.erro;
    if (r.tarefa.status === 'executando') {
      return NextResponse.json({ error: 'A tarefa está sendo aplicada agora.' }, { status: 409 });
    }
    await excluirTarefa(id);
    await cancelarDisparo(r.tarefa.qstashMessageId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[precos/tarefas] erro ao excluir', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao excluir a tarefa.' },
      { status: 500 }
    );
  }
}

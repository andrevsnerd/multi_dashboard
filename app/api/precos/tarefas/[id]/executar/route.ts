import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { cancelarDisparo } from '@/lib/precos/agendador-qstash';
import { executarTarefa } from '@/lib/precos/tarefas-executor';
import { atualizarTarefa, obterTarefa, reivindicarExecucao } from '@/lib/precos/tarefas-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** "Aplicar agora": aplica a tarefa na hora, agendada ou não. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;
  const usuario = autorizacao.auth.username;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { company?: string };
  const company = parsePrecoCompany(body.company);
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  const existente = await obterTarefa(id);
  if (!existente || existente.company !== company) {
    return NextResponse.json({ error: 'Tarefa não encontrada.' }, { status: 404 });
  }

  const tarefa = await reivindicarExecucao(id, { usuario });
  if (!tarefa) {
    return NextResponse.json(
      { error: 'A tarefa já foi aplicada ou está sendo aplicada agora.' },
      { status: 409 }
    );
  }
  // Aplicou na mão: o disparo agendado (se havia) não tem mais o que fazer.
  await cancelarDisparo(existente.qstashMessageId);

  try {
    const { tarefa: final, resultado } = await executarTarefa(tarefa, usuario);
    return NextResponse.json({ tarefa: final, resultado });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[precos/tarefas] erro ao aplicar', error);
    await atualizarTarefa(id, { status: 'erro', erro: msg.slice(0, 1000), qstashMessageId: null });
    return NextResponse.json({ error: `Falha ao aplicar: ${msg}` }, { status: 500 });
  }
}

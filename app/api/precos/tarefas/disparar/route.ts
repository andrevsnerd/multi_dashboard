import { NextResponse } from 'next/server';

import { TENTATIVAS_QSTASH, agendarDisparo, assinaturaValida } from '@/lib/precos/agendador-qstash';
import { executarTarefa, usuarioPodeGravarPrecos } from '@/lib/precos/tarefas-executor';
import { atualizarTarefa, obterTarefa, reivindicarExecucao } from '@/lib/precos/tarefas-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Chamada pelo QStash no horário agendado — não há usuário logado aqui. A autenticação
 * é a assinatura do QStash, e a tarefa é aplicada em nome de quem a agendou.
 *
 * Respostas: 2xx encerra; 5xx faz o QStash tentar de novo (até TENTATIVAS_QSTASH).
 * Só devolvemos 5xx quando vale repetir (falha de conexão com o Linx, por exemplo):
 * a execução é idempotente — o que já está no valor novo conta como "sem mudança".
 */
export async function POST(request: Request) {
  const body = await request.text();
  if (!(await assinaturaValida(request.headers.get('upstash-signature'), body))) {
    return NextResponse.json({ error: 'Assinatura inválida.' }, { status: 401 });
  }

  let tarefaId = '';
  try {
    tarefaId = String((JSON.parse(body) as { tarefaId?: string }).tarefaId ?? '').trim();
  } catch {
    /* corpo inválido cai no 400 abaixo */
  }
  if (!tarefaId) return NextResponse.json({ error: 'tarefaId ausente.' }, { status: 400 });

  const messageId = request.headers.get('upstash-message-id');
  const tentativa = Number(request.headers.get('upstash-retried') ?? 0);

  const existente = await obterTarefa(tarefaId);
  if (!existente) return NextResponse.json({ ignorado: 'Tarefa não existe mais.' });

  // Salto intermediário (agendamento além do limite de 7 dias do QStash): ainda não é a
  // hora — só publica o próximo salto e troca o messageId da tarefa.
  if (
    existente.status === 'agendada' &&
    existente.qstashMessageId === messageId &&
    existente.agendadoPara &&
    new Date(existente.agendadoPara).getTime() > Date.now() + 60_000
  ) {
    const proximo = await agendarDisparo(tarefaId, new Date(existente.agendadoPara));
    await atualizarTarefa(tarefaId, { qstashMessageId: proximo });
    return NextResponse.json({ reagendado: existente.agendadoPara });
  }

  const usuario = existente.agendadoPor || existente.criadoPor;
  if (!(await usuarioPodeGravarPrecos(usuario))) {
    await atualizarTarefa(tarefaId, {
      status: 'erro',
      erro: `Não aplicada: o usuário ${usuario} não tem mais permissão para alterar preço.`,
      qstashMessageId: null,
    });
    return NextResponse.json({ ignorado: 'Usuário sem permissão.' });
  }

  // Só a mensagem CORRENTE dispara: reagendada, cancelada ou já aplicada na mão = no-op.
  const tarefa = await reivindicarExecucao(tarefaId, { messageId, usuario });
  if (!tarefa) return NextResponse.json({ ignorado: 'Tarefa não está mais agendada para esta mensagem.' });

  try {
    const { resultado } = await executarTarefa(tarefa, usuario);
    return NextResponse.json({ ok: true, lote: resultado.lote, aplicados: resultado.aplicados });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[precos/tarefas/disparar] erro', tarefaId, error);
    const vaiRepetir = tentativa < TENTATIVAS_QSTASH;
    // Devolve para 'agendada' com o mesmo messageId: a próxima tentativa do QStash
    // consegue reivindicar de novo. Na última, fica como erro para alguém olhar.
    await atualizarTarefa(tarefaId, {
      status: vaiRepetir ? 'agendada' : 'erro',
      erro: `${vaiRepetir ? `Tentativa ${tentativa + 1} falhou, o QStash vai repetir` : 'Falhou'}: ${msg}`.slice(0, 1000),
    });
    return NextResponse.json({ error: msg }, { status: vaiRepetir ? 503 : 200 });
  }
}

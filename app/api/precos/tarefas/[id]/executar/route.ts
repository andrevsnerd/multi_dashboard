import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { TarefaErro, aplicarTarefaAgora } from '@/lib/precos/tarefas-executor';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** "Aplicar agora": aplica a tarefa na hora, agendada ou não. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const autorizacao = await autorizarPrecos(request, { exigirEscrita: true });
  if ('erro' in autorizacao) return autorizacao.erro;
  const { id } = await params;

  const body = (await request.json().catch(() => ({}))) as { company?: string };
  const company = parsePrecoCompany(body.company);
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  try {
    const { tarefa, resultado } = await aplicarTarefaAgora(id, company, autorizacao.auth.username);
    return NextResponse.json({ tarefa, resultado });
  } catch (error) {
    if (error instanceof TarefaErro) {
      if (error.status >= 500) console.error('[precos/tarefas] erro ao aplicar', error);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('[precos/tarefas] erro ao aplicar', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao aplicar a tarefa.' },
      { status: 500 }
    );
  }
}

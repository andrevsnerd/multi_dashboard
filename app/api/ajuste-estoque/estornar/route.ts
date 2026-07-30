import { NextResponse } from 'next/server';

import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole } from '@/lib/auth/permissions';
import { estornarContagem } from '@/lib/ajuste-estoque-executor';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';

export const dynamic = 'force-dynamic';

interface EstornarRequest {
  nomeOriginal: string;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
    }
    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 });
    }
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode estornar ajustes.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as EstornarRequest;
    const nomeOriginal = body.nomeOriginal?.trim();
    if (!nomeOriginal) {
      return NextResponse.json({ error: 'Informe a contagem a desfazer.' }, { status: 400 });
    }

    const now = new Date();
    const dataHoje = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    // Nome do estorno: EST + DDMMHHmmss (≤ 25 chars, único o bastante).
    const novoNome =
      `EST${pad(now.getDate())}${pad(now.getMonth() + 1)}` +
      `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const resultado = await estornarContagem(pool as unknown as { request: () => unknown }, {
      nomeOriginal,
      novoNome,
      emissao: `${dataHoje} 00:00:00`,
      responsavel: await resolveResponsavelLinx(username),
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[ajuste-estoque/estornar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao desfazer ajuste.' },
      { status: 500 }
    );
  }
}

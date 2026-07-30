import { NextResponse } from 'next/server';

import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { isReadOnlyRole } from '@/lib/auth/permissions';
import { resolverNomeFilial } from '@/lib/repositories/ajusteEstoque';
import { executarAjusteContagem, type AjusteContagemItem } from '@/lib/ajuste-estoque-executor';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';

export const dynamic = 'force-dynamic';

interface ExecutarRequest {
  filialCod: string;
  modo: 'zerar' | 'inventario';
  nomeContagem: string;
  dataContagem: string; // 'YYYY-MM-DD'
  obs?: string | null;
  itens: AjusteContagemItem[];
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!username) {
      return NextResponse.json(
        { error: 'Usuário não identificado. Faça login novamente.' },
        { status: 401 }
      );
    }
    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: 'Usuário não encontrado.' }, { status: 403 });
    }
    if (isReadOnlyRole(user.role)) {
      return NextResponse.json(
        { error: 'Acesso somente leitura: esta função não pode executar ajustes.' },
        { status: 403 }
      );
    }

    const body = (await request.json()) as ExecutarRequest;
    const { filialCod, modo, nomeContagem, dataContagem, obs, itens } = body;

    if (!filialCod || (modo !== 'zerar' && modo !== 'inventario')) {
      return NextResponse.json({ error: 'Parâmetros inválidos.' }, { status: 400 });
    }
    if (!nomeContagem?.trim()) {
      return NextResponse.json({ error: 'Informe a descrição da contagem.' }, { status: 400 });
    }
    if (nomeContagem.trim().length > 25) {
      return NextResponse.json(
        { error: 'A descrição deve ter no máximo 25 caracteres.' },
        { status: 400 }
      );
    }
    if (!isValidDate(dataContagem)) {
      return NextResponse.json({ error: 'Data da contagem inválida.' }, { status: 400 });
    }
    if (!Array.isArray(itens) || itens.length === 0) {
      return NextResponse.json({ error: 'Nenhum item para ajustar.' }, { status: 400 });
    }

    const filialNome = await resolverNomeFilial(filialCod);
    if (!filialNome) {
      return NextResponse.json({ error: 'Filial não encontrada.' }, { status: 404 });
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();

    const resultado = await executarAjusteContagem(pool as unknown as { request: () => unknown }, {
      filialNome,
      nomeContagem: nomeContagem.trim(),
      emissao: `${dataContagem} 00:00:00`,
      responsavel: await resolveResponsavelLinx(username),
      obs: obs ?? null,
      itens,
    });

    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[ajuste-estoque/executar] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao executar ajuste.' },
      { status: 500 }
    );
  }
}

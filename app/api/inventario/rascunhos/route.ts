import { NextResponse } from 'next/server';

import {
  inventarioRascunhoId,
  listarInventarioRascunhos,
  removerInventarioRascunho,
  salvarInventarioRascunho,
  type InventarioRascunhoItem,
} from '@/lib/utils/inventario-draft-store';

/**
 * Rascunhos do Inventário por bipagem (ver `lib/utils/inventario-draft-store.ts`).
 *
 * GET    ?company=nerd                      → rascunhos pendentes da empresa
 * PUT    { company, filialCod, itens, … }   → salva/atualiza (lista vazia apaga)
 * DELETE ?company=&filialCod=               → apaga o rascunho do usuário naquela filial
 * DELETE ?id=…                              → apaga um rascunho específico (aba Rascunhos)
 */

function getUsername(request: Request): string {
  return (request.headers.get('x-auth-username') || '').trim();
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get('company') || '').trim();
  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" é obrigatório.' }, { status: 400 });
  }
  try {
    const data = await listarInventarioRascunhos(companyKey);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[inventario/rascunhos] erro ao listar', error);
    return NextResponse.json({ error: 'Erro ao listar rascunhos' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const username = getUsername(request);
  if (!username) {
    return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      company?: string;
      filialCod?: string;
      filialNome?: string | null;
      nomeContagem?: string | null;
      nomeEditado?: boolean;
      observacao?: string | null;
      zerarNaoContados?: boolean;
      itens?: InventarioRascunhoItem[];
    };
    const companyKey = (body.company || '').trim();
    const filialCod = (body.filialCod || '').trim();
    if (!companyKey || !filialCod) {
      return NextResponse.json(
        { error: 'Parâmetros "company" e "filialCod" são obrigatórios.' },
        { status: 400 }
      );
    }
    const data = await salvarInventarioRascunho({
      companyKey,
      username,
      filialCod,
      filialNome: body.filialNome ?? null,
      nomeContagem: body.nomeContagem ?? null,
      nomeEditado: body.nomeEditado === true,
      observacao: body.observacao ?? null,
      zerarNaoContados: body.zerarNaoContados !== false,
      itens: Array.isArray(body.itens) ? body.itens : [],
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[inventario/rascunhos] erro ao salvar', error);
    return NextResponse.json({ error: 'Erro ao salvar rascunho' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const username = getUsername(request);
  const { searchParams } = new URL(request.url);
  const idParam = (searchParams.get('id') || '').trim();
  try {
    if (idParam) {
      // Apagar rascunho de outra pessoa é permitido de propósito: quem assume o
      // inventário precisa poder descartar o que ficou pendurado do turno anterior.
      await removerInventarioRascunho(idParam);
      return NextResponse.json({ ok: true });
    }
    if (!username) {
      return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
    }
    const companyKey = (searchParams.get('company') || '').trim();
    const filialCod = (searchParams.get('filialCod') || '').trim();
    if (!companyKey || !filialCod) {
      return NextResponse.json({ error: 'Informe "id" ou ("company" + "filialCod").' }, { status: 400 });
    }
    await removerInventarioRascunho(inventarioRascunhoId(companyKey, username, filialCod));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[inventario/rascunhos] erro ao remover', error);
    return NextResponse.json({ error: 'Erro ao remover rascunho' }, { status: 500 });
  }
}

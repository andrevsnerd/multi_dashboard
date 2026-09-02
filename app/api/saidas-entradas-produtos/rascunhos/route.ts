import { NextResponse } from 'next/server';

import {
  buscarRascunho,
  listarRascunhos,
  rascunhoId,
  removerRascunho,
  salvarRascunho,
  type RascunhoItem,
  type TipoOperacaoRascunho,
} from '@/lib/utils/saida-entrada-draft-store';

/**
 * Rascunhos da tela de Saídas/Entradas (ver `lib/utils/saida-entrada-draft-store.ts`).
 *
 * GET    ?company=nerd                      → rascunhos pendentes da empresa
 * PUT    { company, tipoOperacao, filial, itens, … }  → salva/atualiza (lista vazia apaga)
 * DELETE ?company=&tipoOperacao=&filial=[&romaneioEdicao=] → apaga o rascunho do usuário
 *                                            naquela filial (ou o da edição daquele romaneio)
 * DELETE ?id=…                              → apaga um rascunho específico (aba Rascunhos)
 */

function getUsername(request: Request): string {
  return (request.headers.get('x-auth-username') || '').trim();
}

function normalizeTipo(value: unknown): TipoOperacaoRascunho {
  return String(value ?? '').trim().toLowerCase() === 'entrada' ? 'entrada' : 'saida';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get('company') || '').trim();

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" é obrigatório.' }, { status: 400 });
  }

  try {
    const data = await listarRascunhos(companyKey);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao listar rascunhos de saída/entrada', error);
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
      companyKey?: string;
      tipoOperacao?: string;
      filial?: string;
      filialLabel?: string | null;
      filialDestino?: string | null;
      filialDestinoLabel?: string | null;
      tipoRomaneio?: string | null;
      observacao?: string | null;
      romaneioEdicao?: string | null;
      itens?: RascunhoItem[];
    };

    const companyKey = (body.company || body.companyKey || '').trim();
    const filial = (body.filial || '').trim();

    if (!companyKey || !filial) {
      return NextResponse.json(
        { error: 'Parâmetros "company" e "filial" são obrigatórios.' },
        { status: 400 }
      );
    }

    const data = await salvarRascunho({
      companyKey,
      username,
      tipoOperacao: normalizeTipo(body.tipoOperacao),
      filial,
      filialLabel: body.filialLabel ?? null,
      filialDestino: body.filialDestino ?? null,
      filialDestinoLabel: body.filialDestinoLabel ?? null,
      tipoRomaneio: body.tipoRomaneio ?? null,
      observacao: body.observacao ?? null,
      romaneioEdicao: body.romaneioEdicao ?? null,
      itens: Array.isArray(body.itens) ? body.itens : [],
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao salvar rascunho de saída/entrada', error);
    return NextResponse.json({ error: 'Erro ao salvar rascunho' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const username = getUsername(request);
  const { searchParams } = new URL(request.url);
  const idParam = (searchParams.get('id') || '').trim();

  try {
    if (idParam) {
      // Apagar rascunho de outra pessoa é permitido de propósito: a lista é da
      // LOJA, e quem assume a conferência precisa poder descartar o que ficou
      // pendurado do turno anterior.
      const existente = await buscarRascunho(idParam);
      if (!existente) return NextResponse.json({ ok: true });
      await removerRascunho(idParam);
      return NextResponse.json({ ok: true });
    }

    if (!username) {
      return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
    }

    const companyKey = (searchParams.get('company') || '').trim();
    const filial = (searchParams.get('filial') || '').trim();
    const tipoOperacao = normalizeTipo(searchParams.get('tipoOperacao'));

    if (!companyKey || !filial) {
      return NextResponse.json(
        { error: 'Informe "id" ou ("company" + "filial").' },
        { status: 400 }
      );
    }

    const romaneioEdicao = (searchParams.get('romaneioEdicao') || '').trim() || null;
    await removerRascunho(rascunhoId(companyKey, username, tipoOperacao, filial, romaneioEdicao));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao remover rascunho de saída/entrada', error);
    return NextResponse.json({ error: 'Erro ao remover rascunho' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { filialDaContagem } from '@/lib/repositories/ajusteEstoque';
import {
  abrirInventarioDaFilial,
  adotarInventarioRascunhoAntigo,
  atualizarInventarioRascunho,
  descartarInventarioRascunho,
  listarInventarioRascunhos,
  resolverTravaVencida,
  sincronizarInventarioRascunho,
  type InventarioCabecalho,
  type InventarioRascunhoItem,
  type SincronizarInventarioInput,
} from '@/lib/utils/inventario-draft-store';

export const dynamic = 'force-dynamic';

/**
 * Rascunhos do Inventário por bipagem — UM por filial, compartilhado por quem
 * conta junto, uma linha por item (ver `lib/utils/inventario-draft-store.ts`).
 *
 * NÃO há consulta automática: a tela só fala com o servidor quando muda algo
 * (bipe, quantidade…), quando a pessoa clica em "Atualizar agora" e antes de subir.
 *
 * GET    ?company=                          → rascunhos em andamento da empresa (aba Rascunhos)
 * GET    ?id=&versao=                       → "Atualizar agora": o que mudou desde a versão
 * PUT    { company, filialCod, rascunhoId, versaoBase, syncId, base, itens, cabecalho?, ocorrencias? }
 *                                           → aplica a diferença da tela e devolve o que mudou
 * POST   { acao:'abrir', company, filialCod }  → entra na filial (rascunho completo)
 * POST   { acao:'adotar', id, somar }       → "Continuar" num rascunho antigo, por usuário
 * DELETE ?id=                               → descarta (o compartilhado vira lápide)
 */

function getUsername(request: Request): string {
  return (request.headers.get('x-auth-username') || '').trim();
}

/** A subida caiu no meio? O Linx diz se a contagem chegou a ser gravada. */
async function contagemExisteNoLinx(nomeContagem: string): Promise<boolean> {
  return (await filialDaContagem(nomeContagem)) !== null;
}

/** Esbarrou numa trava vencida: resolve pelo Linx e diz se vale tentar de novo. */
async function resolverSeVencida(rascunho: { id: string; travaVencida: boolean } | null | undefined) {
  if (!rascunho?.travaVencida) return false;
  return (await resolverTravaVencida(rascunho.id, contagemExisteNoLinx)) !== 'nada';
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') || '').trim();
  const companyKey = (searchParams.get('company') || '').trim();
  try {
    if (id) {
      const versao = Number(searchParams.get('versao') ?? -1);
      let snap = await atualizarInventarioRascunho(id, versao);
      if (snap && (await resolverSeVencida(snap.rascunho))) snap = await atualizarInventarioRascunho(id, versao);
      return NextResponse.json({ data: snap });
    }
    if (!companyKey) {
      return NextResponse.json({ error: 'Parâmetro "company" é obrigatório.' }, { status: 400 });
    }
    return NextResponse.json({ data: await listarInventarioRascunhos(companyKey) });
  } catch (error) {
    console.error('[inventario/rascunhos] erro ao ler', error);
    return NextResponse.json({ error: 'Erro ao ler rascunhos' }, { status: 500 });
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
      rascunhoId?: string | null;
      versaoBase?: number;
      syncId?: string;
      base?: InventarioRascunhoItem[];
      itens?: InventarioRascunhoItem[];
      cabecalho?: InventarioCabecalho | null;
      ocorrencias?: number | null;
    };
    const companyKey = (body.company || '').trim();
    const filialCod = (body.filialCod || '').trim();
    const syncId = (body.syncId || '').trim();
    if (!companyKey || !filialCod || !syncId) {
      return NextResponse.json(
        { error: 'Parâmetros "company", "filialCod" e "syncId" são obrigatórios.' },
        { status: 400 }
      );
    }
    const input: SincronizarInventarioInput = {
      companyKey,
      username,
      filialCod,
      filialNome: body.filialNome ?? null,
      rascunhoId: body.rascunhoId ?? null,
      versaoBase: Number(body.versaoBase ?? -1),
      syncId,
      base: Array.isArray(body.base) ? body.base : [],
      itens: Array.isArray(body.itens) ? body.itens : [],
      cabecalho: body.cabecalho ?? null,
      ocorrencias: typeof body.ocorrencias === 'number' ? body.ocorrencias : null,
    };
    let resultado = await sincronizarInventarioRascunho(input);
    if (resultado.estado === 'travado' && (await resolverSeVencida(resultado.rascunho))) {
      resultado = await sincronizarInventarioRascunho(input);
    }
    return NextResponse.json(resultado);
  } catch (error) {
    console.error('[inventario/rascunhos] erro ao sincronizar', error);
    return NextResponse.json({ error: 'Erro ao salvar rascunho' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const username = getUsername(request);
  if (!username) {
    return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      acao?: string;
      company?: string;
      filialCod?: string;
      id?: string;
      somar?: boolean;
    };
    if (body.acao === 'abrir') {
      const companyKey = (body.company || '').trim();
      const filialCod = (body.filialCod || '').trim();
      if (!companyKey || !filialCod) {
        return NextResponse.json({ error: 'Informe "company" e "filialCod".' }, { status: 400 });
      }
      let snap = await abrirInventarioDaFilial({ companyKey, filialCod, username });
      if (snap && (await resolverSeVencida(snap.rascunho))) {
        snap = await abrirInventarioDaFilial({ companyKey, filialCod, username });
      }
      return NextResponse.json({ data: snap });
    }
    if (body.acao === 'adotar') {
      const id = (body.id || '').trim();
      if (!id) return NextResponse.json({ error: 'Informe "id".' }, { status: 400 });
      return NextResponse.json(await adotarInventarioRascunhoAntigo({ id, username, somar: body.somar === true }));
    }
    return NextResponse.json({ error: 'Ação inválida.' }, { status: 400 });
  } catch (error) {
    console.error('[inventario/rascunhos] erro', error);
    return NextResponse.json({ error: 'Erro ao abrir o rascunho' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const username = getUsername(request);
  const { searchParams } = new URL(request.url);
  const id = (searchParams.get('id') || '').trim();
  if (!id) {
    return NextResponse.json({ error: 'Informe "id".' }, { status: 400 });
  }
  try {
    // Descartar o de outra pessoa é permitido de propósito: o inventário é da loja.
    await descartarInventarioRascunho(id, username || '?');
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('[inventario/rascunhos] erro ao descartar', error);
    return NextResponse.json({ error: 'Erro ao descartar rascunho' }, { status: 500 });
  }
}

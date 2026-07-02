import { NextResponse } from 'next/server';

import { fetchProdutoDetalhes } from '@/lib/repositories/controleEstoque';
import { normalizeRangeForQuery } from '@/lib/utils/date';

async function runFetchDetalhes(params: {
  company?: string;
  filial?: string | null;
  produtoNome?: string;
  linha?: string;
  grupo?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  startDate?: Date;
  endDate?: Date;
  filtrarApenasComVendas?: boolean;
  giroDias?: number;
  produtosPermitidos?: string[];
}) {
  const detalhes = await fetchProdutoDetalhes(params);
  return NextResponse.json({ data: detalhes });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const produtoNome = searchParams.get('produtoNome') || undefined;
  const linha = searchParams.get('linha') || undefined;
  const grupo = searchParams.get('grupo') ?? undefined;
  const subgrupo = searchParams.get('subgrupo') || undefined;
  const grade = searchParams.get('grade') || undefined;
  const colecao = searchParams.get('colecao') || undefined;
  const giroDias = searchParams.get('giroDias');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  let startDate: Date | undefined;
  let endDate: Date | undefined;
  let filtrarApenasComVendas = false;
  if (giroDias && startParam && endParam) {
    // Valida sem descartar a string: normalizeRangeForQuery precisa receber a STRING
    // (não um Date) para interpretar o dia no fuso de negócio (Brasil). Passar um Date
    // de um instante ISO puraria essa lógica e traria +1 dia em servidores UTC.
    if (!Number.isNaN(new Date(startParam).getTime()) && !Number.isNaN(new Date(endParam).getTime())) {
      const { start: startNorm, end: endNorm } = normalizeRangeForQuery({ start: startParam, end: endParam });
      startDate = startNorm;
      endDate = endNorm;
      filtrarApenasComVendas = true;
    }
  }

  const giroDiasNum = giroDias ? parseInt(giroDias, 10) : undefined;

  try {
    return await runFetchDetalhes({
      company,
      filial,
      produtoNome,
      linha,
      grupo,
      subgrupo,
      grade,
      colecao,
      startDate,
      endDate,
      filtrarApenasComVendas,
      giroDias: Number.isFinite(giroDiasNum) ? giroDiasNum : undefined,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao carregar detalhes do produto';
    console.error('Erro ao carregar detalhes do produto:', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

/** POST: recebe produtosPermitidos no body (do cache/sessionStorage do giro) → resposta rápida com WHERE IN. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const company = body.company ?? undefined;
    const filial = body.filial ?? null;
    const produtoNome = body.produtoNome ?? undefined;
    const linha = body.linha ?? undefined;
    const grupo = body.grupo ?? undefined;
    const subgrupo = body.subgrupo ?? undefined;
    const grade = body.grade ?? undefined;
    const colecao = body.colecao ?? undefined;
    const produtosPermitidos = Array.isArray(body.produtosPermitidos) ? body.produtosPermitidos : undefined;

    let startDate: Date | undefined;
    let endDate: Date | undefined;
    let filtrarApenasComVendas = false;
    const giroDias = body.giroDias != null ? Number(body.giroDias) : undefined;
    const startParam = body.start;
    const endParam = body.end;
    if (giroDias != null && startParam != null && endParam != null) {
      // Passa as STRINGS ao normalizador (ver POST acima): Date de instante ISO
      // puraria a interpretação de fuso de negócio e traria +1 dia em servidor UTC.
      if (!Number.isNaN(new Date(startParam).getTime()) && !Number.isNaN(new Date(endParam).getTime())) {
        const { start: startNorm, end: endNorm } = normalizeRangeForQuery({ start: startParam, end: endParam });
        startDate = startNorm;
        endDate = endNorm;
        filtrarApenasComVendas = true;
      }
    }

    return await runFetchDetalhes({
      company,
      filial,
      produtoNome,
      linha,
      grupo,
      subgrupo,
      grade,
      colecao,
      startDate,
      endDate,
      filtrarApenasComVendas,
      giroDias: Number.isFinite(giroDias) ? giroDias : undefined,
      produtosPermitidos,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro ao carregar detalhes do produto';
    console.error('Erro ao carregar detalhes do produto (POST):', error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';

import { detectarERegistrarTransferenciasExternas } from '@/lib/server/detectar-transferencias-externas';

// Lê o Linx (janela de dias) — pode demorar um pouco.
export const maxDuration = 60;

/** Janela padrão de detecção (dias). Cobre o histórico de "Realizadas" (30d) com folga. */
const DEFAULT_DIAS = 45;

function parseDias(value: string | null): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_DIAS;
  return Math.min(Math.max(Math.floor(n), 1), 365);
}

/**
 * Detecta transferências entre lojas feitas fora do app (direto no Linx) e as
 * grava no Neon como "realizadas". Mutação → POST. Aceita `company` no corpo ou
 * na query string.
 */
export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let company = searchParams.get('company')?.trim() || '';
    let dias = parseDias(searchParams.get('dias'));

    try {
      const body = (await request.json()) as { company?: string; dias?: number } | null;
      if (body?.company) company = String(body.company).trim();
      if (body?.dias != null) dias = parseDias(String(body.dias));
    } catch {
      // corpo vazio/ inválido — usa os parâmetros da query
    }

    if (!company) {
      return NextResponse.json(
        { error: 'Parâmetro company é obrigatório' },
        { status: 400 }
      );
    }

    const resultado = await detectarERegistrarTransferenciasExternas(company, dias);
    return NextResponse.json({ success: true, ...resultado });
  } catch (error) {
    console.error('[detectar-transferencias-externas] ERRO:', error);
    return NextResponse.json(
      { error: 'Erro ao detectar transferências externas' },
      { status: 500 }
    );
  }
}

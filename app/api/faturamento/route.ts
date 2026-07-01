import { NextResponse } from 'next/server';

import {
  fetchNotasFiscais,
  fetchFaturamentoResumo,
  fetchFaturamentoDimensoes,
  type FaturamentoEmpresa,
  type FaturamentoFiltro,
} from '@/lib/repositories/faturamento';

export const maxDuration = 120;

function boolParam(v: string | null, dflt: boolean): boolean {
  if (v == null) return dflt;
  return ['1', 'true', 'yes', 'on', 'sim'].includes(v.trim().toLowerCase());
}

function parseFiltro(searchParams: URLSearchParams): FaturamentoFiltro {
  const empresaRaw = searchParams.get('empresa');
  const empresa =
    empresaRaw === 'nerd' || empresaRaw === 'scarfme' ? (empresaRaw as FaturamentoEmpresa) : null;
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const naturezas = searchParams.get('naturezas');
  return {
    empresa,
    filial: searchParams.get('filial') || null,
    naturezas: naturezas ? naturezas.split(',').map((s) => s.trim()).filter(Boolean) : null,
    cliente: searchParams.get('cliente') || null,
    nfNumero: searchParams.get('nf') || null,
    produto: searchParams.get('produto') || null,
    range: start && end ? { start, end } : undefined,
    incluirCanceladas: boolParam(searchParams.get('incluirCanceladas'), false),
    incluirDevolucoes: boolParam(searchParams.get('incluirDevolucoes'), true),
  };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get('mode') ?? 'lista';

  try {
    if (mode === 'dimensoes') {
      const data = await fetchFaturamentoDimensoes();
      return NextResponse.json({ data });
    }

    const filtro = parseFiltro(searchParams);

    if (mode === 'resumo') {
      const data = await fetchFaturamentoResumo(filtro);
      return NextResponse.json({ data });
    }

    const data = await fetchNotasFiscais(filtro);
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar faturamento/NFs', error);
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ETIMEOUT') {
      return NextResponse.json(
        { error: 'Timeout: a consulta demorou muito. Tente um período menor.', code: 'ETIMEOUT' },
        { status: 504 },
      );
    }
    return NextResponse.json({ error: 'Erro ao carregar faturamento/NFs' }, { status: 500 });
  }
}

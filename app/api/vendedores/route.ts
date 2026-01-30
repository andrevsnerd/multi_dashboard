import { NextResponse } from 'next/server';
import { fetchVendedoresList } from '@/lib/repositories/vendedores-v2';

/** Timeout menor: queries otimizadas com CTEs. */
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') ?? null;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const range =
    startParam && endParam
      ? { start: startParam, end: endParam }
      : undefined;

  const grupos = searchParams.getAll('grupo');
  const linhas = searchParams.getAll('linha');
  const colecoes = searchParams.getAll('colecao');
  const subgrupos = searchParams.getAll('subgrupo');
  const grades = searchParams.getAll('grade');
  const produtoId = searchParams.get('produtoId') ?? undefined;
  const produtoSearchTerm = searchParams.get('produtoSearchTerm') ?? undefined;

  /** light=0 ou false = inclui grupo/subgrupo mais vendido (mais lento). Default = light. */
  const light = searchParams.get('light') !== '0' && searchParams.get('light') !== 'false';

  try {
    const data = await fetchVendedoresList({
      company,
      filial: filial || null,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
      light,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar vendedores', error);
    if (error instanceof Error && 'code' in error && error.code === 'ETIMEOUT') {
      return NextResponse.json(
        { error: 'Timeout: A consulta demorou muito.', code: 'ETIMEOUT' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Erro ao carregar vendedores' },
      { status: 500 }
    );
  }
}

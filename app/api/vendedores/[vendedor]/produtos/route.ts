import { NextResponse } from 'next/server';
import { fetchVendedorProdutosList } from '@/lib/repositories/vendedores-v2';

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vendedor: string }> }
) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
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

  const { vendedor: vendedorEncoded } = await params;
  const vendedor = decodeURIComponent(vendedorEncoded);

  if (!filial) {
    return NextResponse.json(
      { error: 'Filial é obrigatória' },
      { status: 400 }
    );
  }

  try {
    const data = await fetchVendedorProdutosList({
      company,
      vendedor,
      filial,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId,
      produtoSearchTerm,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar produtos do vendedor', error);
    if (error instanceof Error && 'code' in error && error.code === 'ETIMEOUT') {
      return NextResponse.json(
        { error: 'Timeout: A consulta demorou muito.', code: 'ETIMEOUT' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Erro ao carregar produtos do vendedor' },
      { status: 500 }
    );
  }
}

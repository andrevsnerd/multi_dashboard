import { NextResponse } from 'next/server';

import { fetchVendedorProdutos } from '@/lib/repositories/vendedores';

export const maxDuration = 60; // 60 segundos

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vendedor: string }> }
) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const grupos = searchParams.getAll('grupo');
  const linhas = searchParams.getAll('linha');
  const colecoes = searchParams.getAll('colecao');
  const subgrupos = searchParams.getAll('subgrupo');
  const grades = searchParams.getAll('grade');
  const produtoId = searchParams.get('produtoId');
  const produtoSearchTerm = searchParams.get('produtoSearchTerm');

  const { vendedor: vendedorEncoded } = await params;
  const vendedor = decodeURIComponent(vendedorEncoded);

  if (!filial) {
    return NextResponse.json(
      { error: 'Filial é obrigatória' },
      { status: 400 }
    );
  }

  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  try {
    const data = await fetchVendedorProdutos({
      company,
      vendedor,
      filial,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId: produtoId || undefined,
      produtoSearchTerm: produtoSearchTerm || undefined,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar produtos do vendedor', error);
    
    // Verificar se é um erro de timeout
    if (error instanceof Error && 'code' in error && error.code === 'ETIMEOUT') {
      return NextResponse.json(
        { 
          error: 'Timeout: A consulta demorou muito para ser executada. Tente novamente.',
          code: 'ETIMEOUT'
        },
        { status: 504 } // Gateway Timeout
      );
    }
    
    return NextResponse.json(
      { error: 'Erro ao carregar produtos do vendedor' },
      { status: 500 }
    );
  }
}


import { NextResponse } from 'next/server';

import { fetchVendedores } from '@/lib/repositories/vendedores';

export const maxDuration = 60; // 60 segundos

export async function GET(request: Request) {
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

  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  try {
    const data = await fetchVendedores({
      company,
      filial: filial || null,
      range,
      grupos,
      linhas,
      colecoes,
      subgrupos,
      grades,
      produtoId: produtoId || undefined,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar vendedores', error);
    
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
      { error: 'Erro ao carregar vendedores' },
      { status: 500 }
    );
  }
}


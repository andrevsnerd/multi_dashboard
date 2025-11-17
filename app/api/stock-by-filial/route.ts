import { NextResponse } from 'next/server';

import { fetchStockByFilial, fetchFilterOptions } from '@/lib/repositories/stockByFilial';

// Aumentar timeout para queries que podem demorar mais
export const maxDuration = 60; // 60 segundos (padrão Next.js é 10s)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const linha = searchParams.get('linha');
  const subgrupo = searchParams.get('subgrupo');
  const grade = searchParams.get('grade');
  const colecao = searchParams.get('colecao');
  const filtersOnly = searchParams.get('filtersOnly') === 'true';
  
  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  try {
    // Se for apenas para buscar opções de filtro
    if (filtersOnly && company === 'scarfme') {
      const filterOptions = await fetchFilterOptions(company);
      return NextResponse.json({ filterOptions });
    }

    const data = await fetchStockByFilial({
      company,
      filial: filial || null,
      range,
      linha: linha || null,
      subgrupo: subgrupo || null,
      grade: grade || null,
      colecao: colecao || null,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar estoque por filial', error);
    
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
      { error: 'Erro ao carregar estoque por filial' },
      { status: 500 }
    );
  }
}


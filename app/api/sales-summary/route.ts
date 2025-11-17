import { NextResponse } from 'next/server';

import { fetchSalesSummary } from '@/lib/repositories/sales';

// Aumentar timeout para queries que podem demorar mais
export const maxDuration = 30; // 30 segundos (padrão Next.js é 10s)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  try {
    const {
      summary,
      currentPeriodLastSaleDate,
      availableRange,
    } = await fetchSalesSummary({
      company,
      range,
      filial: filial || null,
    });

    return NextResponse.json({
      data: summary,
      lastAvailableDate: currentPeriodLastSaleDate?.toISOString() ?? null,
      availableRange: {
        start: availableRange.start ? availableRange.start.toISOString() : null,
        end: availableRange.end ? availableRange.end.toISOString() : null,
      },
    });
  } catch (error) {
    console.error('Erro ao carregar resumo de vendas', error);
    
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
      { error: 'Erro ao carregar resumo de vendas' },
      { status: 500 }
    );
  }
}




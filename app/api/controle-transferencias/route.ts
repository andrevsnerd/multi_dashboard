import { NextResponse } from 'next/server';

import { fetchControleTransferencias } from '@/lib/repositories/controleTransferencias';

// Aumentar timeout para queries que podem demorar mais
export const maxDuration = 60; // 60 segundos

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
    const data = await fetchControleTransferencias({
      company,
      filial: filial || null,
      range,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar controle de transferências', error);
    
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
      { error: 'Erro ao carregar controle de transferências' },
      { status: 500 }
    );
  }
}

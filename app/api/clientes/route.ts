import { NextResponse } from 'next/server';

import { fetchClientes, fetchClientesCount } from '@/lib/repositories/clientes';

export const maxDuration = 60; // 60 segundos

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const searchTerm = searchParams.get('searchTerm');

  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  try {
    const [data, count] = await Promise.all([
      fetchClientes({
        company,
        filial: filial || null,
        range,
        searchTerm: searchTerm || undefined,
      }),
      fetchClientesCount({
        company,
        filial: filial || null,
        range,
        searchTerm: searchTerm || undefined,
      }),
    ]);

    return NextResponse.json({ data, count });
  } catch (error) {
    console.error('Erro ao carregar clientes', error);
    
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
      { error: 'Erro ao carregar clientes' },
      { status: 500 }
    );
  }
}


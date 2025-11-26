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


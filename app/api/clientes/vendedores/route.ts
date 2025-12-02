import { NextResponse } from 'next/server';

import { fetchVendedoresList } from '@/lib/repositories/clientes';

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
    const data = await fetchVendedoresList({
      company,
      filial: filial || null,
      range,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar lista de vendedores', error);
    
    return NextResponse.json(
      { error: 'Erro ao carregar lista de vendedores' },
      { status: 500 }
    );
  }
}





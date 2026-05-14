import { NextResponse } from 'next/server';
import { fetchVendedorProdutoVendas } from '@/lib/repositories/vendedores-v2';

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ vendedor: string }> }
) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const produto = searchParams.get('produto');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const range =
    startParam && endParam
      ? { start: startParam, end: endParam }
      : undefined;

  const { vendedor: vendedorEncoded } = await params;
  const vendedor = decodeURIComponent(vendedorEncoded);

  if (!filial || !produto) {
    return NextResponse.json(
      { error: 'Filial e produto são obrigatórios' },
      { status: 400 }
    );
  }

  try {
    const data = await fetchVendedorProdutoVendas({
      company,
      vendedor,
      filial,
      produto,
      range,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar vendas do produto', error);
    if (error instanceof Error && 'code' in error && error.code === 'ETIMEOUT') {
      return NextResponse.json(
        { error: 'Timeout: A consulta demorou muito.', code: 'ETIMEOUT' },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { error: 'Erro ao carregar vendas do produto' },
      { status: 500 }
    );
  }
}

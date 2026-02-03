import { NextResponse } from 'next/server';
import { fetchProductCustos } from '@/lib/repositories/productDetail';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('productId');
  const company = searchParams.get('company') ?? undefined;

  if (!productId) {
    return NextResponse.json(
      { error: 'Parâmetro productId é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const custos = await fetchProductCustos(productId, company);
    return NextResponse.json({ data: custos });
  } catch (error) {
    console.error('Erro ao buscar custos do produto', error);
    return NextResponse.json(
      { error: 'Erro ao buscar custos do produto' },
      { status: 500 }
    );
  }
}

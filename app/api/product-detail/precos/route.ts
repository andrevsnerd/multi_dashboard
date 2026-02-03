import { NextResponse } from 'next/server';
import { fetchProductPrecos } from '@/lib/repositories/productDetail';

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
    const precos = await fetchProductPrecos(productId, company);
    return NextResponse.json({ data: precos });
  } catch (error) {
    console.error('Erro ao buscar preços do produto', error);
    return NextResponse.json(
      { error: 'Erro ao buscar preços do produto' },
      { status: 500 }
    );
  }
}

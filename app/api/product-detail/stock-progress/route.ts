import { NextResponse } from 'next/server';

import {
  fetchProductStockProgressSeries,
  type ProductStockByFilial,
  type ProductStockProgressDay,
} from '@/lib/repositories/productDetail';

type RequestBody = {
  productId?: string;
  company?: string;
  colors?: string[];
  range?: {
    start?: string;
    end?: string;
  };
  stockByFilial?: ProductStockByFilial[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const productId = String(body.productId ?? '').trim();

    if (!productId) {
      return NextResponse.json({ error: 'Parâmetro productId é obrigatório' }, { status: 400 });
    }

    const stockByFilial = Array.isArray(body.stockByFilial) ? body.stockByFilial : [];
    const stockProgress: ProductStockProgressDay[] = await fetchProductStockProgressSeries(
      {
        productId,
        company: body.company ?? undefined,
        colors: Array.isArray(body.colors) ? body.colors : undefined,
        filial: null,
        range: body.range,
      },
      stockByFilial
    );

    return NextResponse.json({ data: stockProgress });
  } catch (error) {
    console.error('Erro ao carregar progresso de estoque do produto', error);
    return NextResponse.json(
      { error: 'Erro ao carregar progresso de estoque do produto' },
      { status: 500 }
    );
  }
}

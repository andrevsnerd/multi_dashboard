import { NextResponse } from 'next/server';

import {
  fetchProductDetail,
  fetchProductStockByFilial,
  fetchProductSaleHistory,
  type ProductDetailInfo,
  type ProductStockByFilial,
  type ProductSaleHistory,
} from '@/lib/repositories/productDetail';
import { getCurrentMonthRange } from '@/lib/utils/date';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('productId');
  const company = searchParams.get('company') ?? undefined;
  
  // Usar período padrão (mês atual) se não for fornecido
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const defaultRange = getCurrentMonthRange();
  
  const range = startParam && endParam
    ? {
        start: startParam,
        end: endParam,
      }
    : {
        start: defaultRange.start.toISOString(),
        end: defaultRange.end.toISOString(),
      };

  if (!productId) {
    return NextResponse.json(
      { error: 'Parâmetro productId é obrigatório' },
      { status: 400 }
    );
  }

  try {
    const [detail, stockByFilial, saleHistory] = await Promise.all([
      fetchProductDetail({
        productId,
        company,
        range,
        filial: null, // Sempre todas as filiais para visão completa
      }),
      fetchProductStockByFilial({
        productId,
        company,
        range,
        filial: null,
      }),
      fetchProductSaleHistory({
        productId,
        company,
        range,
        filial: null,
      }),
    ]);

    // Garantir que o estoque total do card seja a soma do estoque por filial (fonte única de verdade)
    const totalStockFromFilials = stockByFilial.reduce((sum, row) => sum + row.stock, 0);
    const detailWithConsistentStock: ProductDetailInfo = {
      ...detail,
      totalStock: totalStockFromFilials,
    };

    return NextResponse.json({
      data: {
        detail: detailWithConsistentStock,
        stockByFilial,
        saleHistory,
      },
    });
  } catch (error) {
    console.error('Erro ao carregar detalhes do produto', error);
    return NextResponse.json(
      { error: 'Erro ao carregar detalhes do produto' },
      { status: 500 }
    );
  }
}


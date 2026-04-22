import { NextResponse } from 'next/server';
import { endOfMonth, startOfDay, startOfMonth, subMonths } from 'date-fns';

import {
  fetchProductDetail,
  fetchProductStockByFilial,
  fetchProductSaleHistory,
  fetchProductAvailableColors,
  fetchProductStockProgressSeries,
  type ProductDetailInfo,
  type ProductStockProgressDay,
} from '@/lib/repositories/productDetail';
import { getCurrentMonthRange } from '@/lib/utils/date';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = searchParams.get('productId');
  const company = searchParams.get('company') ?? undefined;
  const colorsParam = searchParams.get('colors');
  const colors = colorsParam
    ? colorsParam.split(',').map((c) => c.trim()).filter(Boolean)
    : undefined;

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

  const baseParams = {
    productId,
    company,
    range,
    filial: null as null,
    colors,
  };

  try {
    const rangeStart = new Date(range.start);
    const rangeEnd = new Date(range.end);
    const startD = startOfDay(rangeStart);
    const endD = startOfDay(rangeEnd);

    // Do 1º dia do mês anterior ao início do range até o último dia do mês anterior ao fim do range
    // (cobre todos os “mês anterior” necessários para cada dia do gráfico).
    const comparisonRangeStart = startOfMonth(subMonths(startD, 1));
    const comparisonRangeEnd = endOfMonth(subMonths(endD, 1));

    const saleHistoryComparisonFetch = fetchProductSaleHistory({
      ...baseParams,
      range: {
        start: comparisonRangeStart.toISOString(),
        end: comparisonRangeEnd.toISOString(),
      },
    });

    const [detail, stockByFilial, saleHistory, availableColors, saleHistoryComparison] =
      await Promise.all([
        fetchProductDetail(baseParams),
        fetchProductStockByFilial(baseParams),
        fetchProductSaleHistory(baseParams),
        fetchProductAvailableColors(productId, company),
        saleHistoryComparisonFetch,
      ]);

    // Garantir que o estoque total do card seja a soma do estoque por filial (fonte única de verdade)
    const totalStockFromFilials = stockByFilial.reduce(
      (sum, row) => sum + Math.max(Number(row.stock ?? 0), 0),
      0
    );
    const detailWithConsistentStock: ProductDetailInfo = {
      ...detail,
      totalStock: totalStockFromFilials,
    };

    const stockProgress: ProductStockProgressDay[] = await fetchProductStockProgressSeries(
      baseParams,
      stockByFilial
    );

    return NextResponse.json({
      data: {
        detail: detailWithConsistentStock,
        stockByFilial,
        saleHistory,
        saleHistoryComparison,
        availableColors,
        stockProgress,
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

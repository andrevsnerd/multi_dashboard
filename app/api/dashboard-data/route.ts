import { NextResponse } from 'next/server';

import {
  fetchSalesSummary,
  fetchFilialPerformance,
  fetchTopProducts,
  fetchTopCategories,
  fetchDailyRevenue,
} from '@/lib/repositories/sales';
import { readGoals } from '@/lib/utils/goals-storage';

export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const linhasParam = searchParams.getAll('linha');
  const linhas = linhasParam.length > 0 ? linhasParam : null;
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const monthParam = searchParams.get('month');
  const yearParam = searchParams.get('year');

  if (!startParam || !endParam) {
    return NextResponse.json(
      { error: 'Parâmetros start e end são obrigatórios' },
      { status: 400 },
    );
  }

  const range = { start: startParam, end: endParam };
  const month = monthParam !== null ? parseInt(monthParam, 10) : null;
  const year = yearParam !== null ? parseInt(yearParam, 10) : null;

  try {
    const [
      filialPerformance,
      topProducts,
      topCategories,
      dailyRevenue,
      salesSummaryResult,
      allGoals,
    ] = await Promise.all([
      fetchFilialPerformance({ company, range, linhas }),
      fetchTopProducts({ company, range, filial, linhas }),
      fetchTopCategories({ company, range, filial, linhas }),
      fetchDailyRevenue({ company, range, filial, linhas }),
      fetchSalesSummary({ company, range, filial, linhas }),
      readGoals(),
    ]);

    const monthGoals: Record<string, number> =
      company && month !== null && year !== null && !Number.isNaN(month) && !Number.isNaN(year)
        ? ((allGoals[company]?.[String(year)]?.[String(month)] as Record<string, number>) ?? {})
        : {};

    return NextResponse.json(
      {
        filialPerformance,
        topProducts,
        topCategories,
        dailyRevenue,
        summary: salesSummaryResult.summary,
        lastAvailableDate: salesSummaryResult.currentPeriodLastSaleDate?.toISOString() ?? null,
        availableRange: {
          start: salesSummaryResult.availableRange.start?.toISOString() ?? null,
          end: salesSummaryResult.availableRange.end?.toISOString() ?? null,
        },
        goals: monthGoals,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    console.error('Erro ao carregar dados do dashboard:', error);
    const message = error instanceof Error ? error.message : 'Erro desconhecido';
    return NextResponse.json(
      { error: 'Erro ao carregar dados do dashboard', details: message },
      { status: 500 },
    );
  }
}

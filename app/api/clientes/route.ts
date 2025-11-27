import { NextResponse } from 'next/server';

import { fetchClientes, fetchClientesCount, fetchClientesCountPreviousPeriod, fetchTopFilialByClientes } from '@/lib/repositories/clientes';

export const maxDuration = 60; // 60 segundos

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  const vendedor = searchParams.get('vendedor');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');
  const searchTerm = searchParams.get('searchTerm');
  const last7DaysStartParam = searchParams.get('last7DaysStart');
  const last7DaysEndParam = searchParams.get('last7DaysEnd');

  const range =
    startParam && endParam
      ? {
          start: startParam,
          end: endParam,
        }
      : undefined;

  // Calcular range dos últimos 7 dias se fornecido
  const last7DaysRange = last7DaysStartParam && last7DaysEndParam
    ? {
        start: last7DaysStartParam,
        end: last7DaysEndParam,
      }
    : undefined;

  try {
    // Para crescimento semanal: comparar últimos 7 dias com os 7 dias anteriores
    const last7DaysCountPromise = last7DaysRange
      ? fetchClientesCount({
          company,
          filial: filial || null,
          vendedor: vendedor || null,
          range: last7DaysRange,
          searchTerm: searchTerm || undefined,
        })
      : Promise.resolve(0);

    const [data, count, last7DaysCount, countWeekPrevious, countMonth, topFilial] = await Promise.all([
      fetchClientes({
        company,
        filial: filial || null,
        vendedor: vendedor || null,
        range,
        searchTerm: searchTerm || undefined,
      }),
      fetchClientesCount({
        company,
        filial: filial || null,
        vendedor: vendedor || null,
        range,
        searchTerm: searchTerm || undefined,
      }),
      last7DaysCountPromise,
      fetchClientesCountPreviousPeriod({
        company,
        filial: filial || null,
        vendedor: vendedor || null,
        range: last7DaysRange || range,
        searchTerm: searchTerm || undefined,
        periodType: 'week',
      }),
      fetchClientesCountPreviousPeriod({
        company,
        filial: filial || null,
        vendedor: vendedor || null,
        range,
        searchTerm: searchTerm || undefined,
        periodType: 'month',
      }),
      fetchTopFilialByClientes({
        company,
        filial: filial || null,
        vendedor: vendedor || null,
        range,
        searchTerm: searchTerm || undefined,
      }),
    ]);

    return NextResponse.json({ 
      data, 
      count,
      countWeek: last7DaysCount, // Últimos 7 dias
      countWeekPrevious: countWeekPrevious, // 7 dias anteriores
      countMonth,
      topFilial,
    });
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


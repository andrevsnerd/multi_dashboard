import { NextResponse } from 'next/server';

import { fetchProductsWithDetails, type ProductDetail } from '@/lib/repositories/products';
import { aggregateProductDetailsWithGroups } from '@/lib/utils/produto-agrupado-aggregation';
import { listProdutoAgrupadoGroups } from '@/lib/utils/produto-agrupado-store';
import { listProdutosDescontinuados } from '@/lib/utils/produto-descontinuado-store';
import { buildDescontinuadoKeySet, isProdutoDescontinuado } from '@/lib/utils/produtos-descontinuados';
import type { CompanyKey } from '@/lib/config/company';

// Evita timeout em produção (proxy/túnel); padrão seria 10s no Hobby.
export const maxDuration = 300;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial');
  
  // Obter todos os valores para cada filtro (suporta múltiplos)
  const grupos = searchParams.getAll('grupo');
  const linhas = searchParams.getAll('linha');
  const colecoes = searchParams.getAll('colecao');
  const subgrupos = searchParams.getAll('subgrupo');
  const grades = searchParams.getAll('grade');
  const produtoId = searchParams.get('produtoId');
  const produtoSearchTerm = searchParams.get('produtoSearchTerm');
  
  const groupByColorParam = searchParams.get('groupByColor');
  const acimaDoTicketParam = searchParams.get('acimaDoTicket');
  const filterByRegistrationDateParam = searchParams.get('filterByRegistrationDate');
  const startParam = searchParams.get('start');
  const endParam = searchParams.get('end');

  if (!startParam || !endParam) {
    return NextResponse.json(
      { error: 'Parâmetros start e end são obrigatórios' },
      { status: 400 }
    );
  }

  const range = {
    start: startParam,
    end: endParam,
  };

  const groupByColor = groupByColorParam === 'true';
  const acimaDoTicket = acimaDoTicketParam === 'true';
  const filterByRegistrationDate = filterByRegistrationDateParam === 'true';

  try {
    const isKnownCompany = company === 'nerd' || company === 'scarfme';
    const [rawData, groupedProducts, descontinuados] = await Promise.all([
      fetchProductsWithDetails({
        company,
        range,
        filial: filial || null,
        grupos: grupos.length > 0 ? grupos : null,
        linhas: linhas.length > 0 ? linhas : null,
        colecoes: colecoes.length > 0 ? colecoes : null,
        subgrupos: subgrupos.length > 0 ? subgrupos : null,
        grades: grades.length > 0 ? grades : null,
        groupByColor,
        produtoId: produtoId || undefined,
        produtoSearchTerm: produtoSearchTerm || undefined,
        acimaDoTicket,
        filterByRegistrationDate,
      }),
      isKnownCompany ? listProdutoAgrupadoGroups(company as CompanyKey) : Promise.resolve([]),
      isKnownCompany ? listProdutosDescontinuados(company as CompanyKey) : Promise.resolve([]),
    ]);

    const aggregated: ProductDetail[] = aggregateProductDetailsWithGroups(rawData, groupedProducts, {
      groupByColor,
    });

    const descontinuadoKeys = buildDescontinuadoKeySet(descontinuados);
    const data: ProductDetail[] = aggregated.map((product) => ({
      ...product,
      descontinuado: isProdutoDescontinuado(descontinuadoKeys, product.productId),
    }));

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar produtos', error);
    return NextResponse.json(
      { error: 'Erro ao carregar produtos' },
      { status: 500 }
    );
  }
}


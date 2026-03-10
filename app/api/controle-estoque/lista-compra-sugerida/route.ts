import { NextResponse } from 'next/server';

import { fetchTopProdutosUltimos3Meses } from '@/lib/repositories/controleEstoque';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const categoria = searchParams.get('categoria') || null;
  const qtdCompra = Number(searchParams.get('qtdCompra') ?? '0');
  const limit = Number(searchParams.get('limit') ?? '50');

  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);

  try {
    const data = await fetchTopProdutosUltimos3Meses({
      company,
      filial,
      categoria,
      grupos: grupos.length > 0 ? grupos : null,
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
      qtdCompra,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    });

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar lista de compra sugerida', error);
    return NextResponse.json(
      { error: 'Erro ao carregar lista de compra sugerida' },
      { status: 500 }
    );
  }
}

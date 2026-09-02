import { NextResponse } from 'next/server';

import { fetchEstoqueDimensaoOpcoes } from '@/lib/repositories/controleEstoque';

/**
 * Opções dos selects do Gerador de Relatórios nas análises de ESTOQUE (as que não têm
 * filtro de período: Estoque por filial, Produtos parados, Produtos por cadastro).
 *
 * Tiradas do ESTOQUE, e não das vendas: `/api/products/{grupos,linhas,subgrupos,grades,
 * colecoes,tipos}` lista só o que teve venda numa janela invisível (o mês corrente por
 * padrão), o que escondia coleções inteiras que estão em estoque mas não venderam no mês.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const truthy = (v: string | null) => v === '1' || v === 'true';
  const incluirZerados = truthy(searchParams.get('incluirZerados'));
  const incluirNegativos = truthy(searchParams.get('incluirNegativos'));

  try {
    const data = await fetchEstoqueDimensaoOpcoes({
      company,
      filial,
      incluirZerados,
      incluirNegativos,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar opções de filtro do Gerador (estoque)', error);
    return NextResponse.json({ error: 'Erro ao carregar opções de filtro' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { fetchEstoqueFiltroOpcoes } from '@/lib/repositories/controleEstoque';

/**
 * Opções dos selects da Estoque Consulta, tiradas do ESTOQUE da filial (e não das
 * vendas do mês, que deixavam a tela sem filtros em loja de baixo giro).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const mostrarZerados =
    searchParams.get('mostrarZerados') === '1' || searchParams.get('mostrarZerados') === 'true';
  const mostrarNegativos =
    searchParams.get('mostrarNegativos') === '1' || searchParams.get('mostrarNegativos') === 'true';

  try {
    const data = await fetchEstoqueFiltroOpcoes({
      company,
      filial,
      mostrarZerados,
      mostrarNegativos,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar opções de filtro do estoque', error);
    return NextResponse.json({ error: 'Erro ao carregar opções de filtro do estoque' }, { status: 500 });
  }
}

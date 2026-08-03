import { NextResponse } from 'next/server';

import { getColecaoDescMap } from '@/lib/repositories/colecao';

/**
 * Mapa CÓDIGO → DESCRIÇÃO de TODAS as coleções (tabela mestre `COLECOES`).
 *
 * Diferente de `/api/products/colecoes`, que lista só as coleções COM VENDA no
 * período/filial: aqui não há filtro nenhum. Serve para rotular uma coleção que
 * está selecionada mas ficou fora da lista de vendas (ex.: SUELEN ARRIGO, que
 * mal saiu da matriz) — sem isso ela apareceria só como "Y7".
 *
 * Catálogo pequeno (~330 linhas, só código + texto) e já cacheado 10 min no
 * repositório, então dá para buscar uma vez por sessão da tela.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;

  // COLECAO só existe para SCARFME (mesma regra de fetchAvailableColecoes).
  if (company !== 'scarfme') {
    return NextResponse.json({ data: {} });
  }

  try {
    const map = await getColecaoDescMap();
    return NextResponse.json({ data: Object.fromEntries(map) });
  } catch (error) {
    console.error('Erro ao carregar descrições de coleção', error);
    return NextResponse.json({ error: 'Erro ao carregar descrições de coleção' }, { status: 500 });
  }
}

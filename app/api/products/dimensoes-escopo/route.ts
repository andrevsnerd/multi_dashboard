import { NextResponse } from 'next/server';

import { fetchDimensoesDosProdutos } from '@/lib/repositories/controleEstoque';

/**
 * Dimensões de cadastro (grupo/linha/subgrupo/grade/coleção/tipo/cor) DOS PRODUTOS de um
 * recorte. Serve os selects da Projeção Compra quando o usuário já escolheu item(ns) ou
 * digitou um nome: aí o filtro passa a listar só o que existe naqueles itens.
 *
 * `?produto=a&produto=b` (repetível) ou `?produtos=a,b`, e/ou `?busca=<nome>` (mín. 2 chars).
 * Sem nenhum recorte devolve tudo vazio de propósito — a tela usa os endpoints de sempre.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const produtoIds = Array.from(
    new Set(
      [...searchParams.getAll('produto'), ...(searchParams.get('produtos') ?? '').split(',')]
        .map((p) => p.trim())
        .filter(Boolean)
    )
  );
  const busca = (searchParams.get('busca') ?? '').trim();

  try {
    const data = await fetchDimensoesDosProdutos({
      company,
      produtoIds: produtoIds.length > 0 ? produtoIds : null,
      produtoSearchTerm: busca || null,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao carregar dimensões do escopo', error);
    return NextResponse.json({ error: 'Erro ao carregar dimensões do escopo' }, { status: 500 });
  }
}

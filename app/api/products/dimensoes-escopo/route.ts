import { NextResponse } from 'next/server';

import { fetchDimensoesDosProdutos } from '@/lib/repositories/controleEstoque';

/**
 * Dimensões de cadastro (grupo/linha/subgrupo/grade/coleção/tipo/cor) DOS PRODUTOS de um
 * recorte. Serve os selects da Projeção Compra quando o usuário já escolheu item(ns),
 * digitou um nome ou marcou algum filtro: aí cada select passa a listar só o que existe
 * no recorte.
 *
 * `?produto=a&produto=b` (repetível) ou `?produtos=a,b`, e/ou `?busca=<nome>` (mín. 2 chars),
 * e/ou os filtros já marcados: `?grupo=&linha=&subgrupo=&grade=&colecao=&tipo=&cor=`
 * (repetíveis ou CSV). Cada dimensão volta medida SEM o filtro dela própria — senão o select
 * de Grade passaria a mostrar só a grade já marcada e não daria para trocar.
 *
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

  const readDim = (name: string) =>
    Array.from(
      new Set(
        searchParams
          .getAll(name)
          .flatMap((v) => v.split(','))
          .map((v) => v.trim().toUpperCase())
          .filter(Boolean)
      )
    );

  try {
    const data = await fetchDimensoesDosProdutos({
      company,
      produtoIds: produtoIds.length > 0 ? produtoIds : null,
      produtoSearchTerm: busca || null,
      dimensoes: {
        grupos: readDim('grupo'),
        linhas: readDim('linha'),
        subgrupos: readDim('subgrupo'),
        grades: readDim('grade'),
        colecoes: readDim('colecao'),
        tipos: readDim('tipo'),
        cores: readDim('cor'),
      },
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error('Erro ao carregar dimensões do escopo', error);
    return NextResponse.json({ error: 'Erro ao carregar dimensões do escopo' }, { status: 500 });
  }
}

import { NextResponse } from 'next/server';

import { getActiveFilial } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { carregarEstoquePorTamanho, carregarGrades, chaveSku } from '@/lib/server/grade-produto';

export const dynamic = 'force-dynamic';

/**
 * GET /api/saidas-entradas-produtos/tamanhos?company=scarfme&filial=X&itens=PROD|COR;PROD|COR
 *
 * Grade de cada produto×cor para as telas de Saídas/Entradas, Romaneio e
 * Controle de Transferências: se o tamanho é obrigatório (peça P/M/G), quais são
 * os tamanhos e o saldo de cada um na filial (perna ATIVA do grupo, onde o
 * estoque mora). Produto que não exige tamanho volta com `tamanhos: []`.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = await resolveCompanyDynamic(searchParams.get('company') || undefined);
  const filialParam = (searchParams.get('filial') || '').trim();
  const filial = filialParam ? getActiveFilial(company, filialParam) : '';

  const itens = (searchParams.get('itens') || '')
    .split(';')
    .map((par) => {
      const [produto, ...resto] = par.split('|');
      return { produto: (produto || '').trim(), cor: resto.join('|').trim() };
    })
    .filter((it) => it.produto)
    .slice(0, 300);

  if (itens.length === 0) return NextResponse.json({ data: [] });

  try {
    const produtos = itens.map((it) => it.produto);
    const [grades, saldos] = await Promise.all([
      carregarGrades(produtos),
      filial ? carregarEstoquePorTamanho(filial, produtos) : Promise.resolve(new Map()),
    ]);

    const data = itens.map((it) => {
      const grade = grades.get(it.produto);
      const saldo = saldos.get(chaveSku(it.produto, it.cor));
      const exigeTamanho = Boolean(grade?.exigeTamanho);
      // Saldo que uma saída pode usar sem o Linx recusar: o menor entre o total e
      // o tamanho base (peça sem grade sai no base). Peça P/M/G usa o do tamanho.
      const tb = grade?.tamanhoBase ?? 1;
      const disponivel = saldo ? Math.min(saldo.estoque, saldo.es[tb - 1] ?? 0) : 0;
      return {
        produto: it.produto,
        cor: it.cor,
        estoque: saldo?.estoque ?? 0,
        disponivel,
        exigeTamanho,
        tamanhos: exigeTamanho
          ? grade!.tamanhos.map((t) => ({ ...t, estoque: saldo?.es[t.ordinal - 1] ?? 0 }))
          : [],
      };
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('[saidas-entradas-produtos/tamanhos] erro', error);
    return NextResponse.json({ error: 'Erro ao consultar a grade de tamanhos.' }, { status: 500 });
  }
}

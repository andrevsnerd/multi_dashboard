import { NextResponse } from 'next/server';

import {
  fetchTopProdutosUltimos3Meses,
  fetchVendasQuantidadesTotaisItensLote,
} from '@/lib/repositories/controleEstoque';

/** Lista ABC pode chamar muitas leituras iguais ao tooltip; margem para somar 12m+60d por item. */
export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get('company') ?? undefined;
  const filial = searchParams.get('filial') || null;
  const categoria = searchParams.get('categoria') || null;
  const qtdCompra = Number(searchParams.get('qtdCompra') ?? '0');
  const limit = Number(searchParams.get('limit') ?? '50');
  const porCor = searchParams.get('porCor') === '1' || searchParams.get('porCor') === 'true';

  const grupos = searchParams.getAll('grupos').filter(Boolean);
  const linhas = searchParams.getAll('linhas').filter(Boolean);
  const colecoes = searchParams.getAll('colecoes').filter(Boolean);
  const subgrupos = searchParams.getAll('subgrupos').filter(Boolean);
  const grades = searchParams.getAll('grades').filter(Boolean);
  const produtos = searchParams.getAll('produtos').filter(Boolean);

  try {
    const companyLc = (company ?? '').toLowerCase();
    let data = await fetchTopProdutosUltimos3Meses({
      company,
      filial,
      categoria,
      grupos: grupos.length > 0 ? grupos : null,
      linhas: linhas.length > 0 ? linhas : null,
      colecoes: colecoes.length > 0 ? colecoes : null,
      subgrupos: subgrupos.length > 0 ? subgrupos : null,
      grades: grades.length > 0 ? grades : null,
      produtos: produtos.length > 0 ? produtos : null,
      qtdCompra,
      porCor,
      limit: Number.isFinite(limit) && limit > 0 ? limit : 50,
    });

    // ScarfMe: mesmas quantidades do tooltip — soma via fetchVendasProdutoPorFilial (varejo + e-commerce).
    if (companyLc === 'scarfme' && data.length > 0) {
      const norm = (s: string) => String(s ?? '').replace(/\u00A0/g, ' ').trim();
      const keyRow = (r: { produto: string; cor?: string }) =>
        `${norm(r.produto)}||${porCor ? norm(r.cor ?? '') : ''}`;

      const totais = await fetchVendasQuantidadesTotaisItensLote({
        company,
        filial,
        porCor,
        itens: data.map((r) => ({
          produto: r.produto,
          cor: porCor ? (r.cor ?? null) : null,
        })),
      });
      data = data.map((r) => {
        const t = totais.get(keyRow(r));
        if (t == null) return r;
        return {
          ...r,
          vendas3meses: t.qtde12m,
          vendas60dias: t.qtde60d,
          vendasMesAtual: t.qtdeMesAtual,
        };
      });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao carregar lista de compra sugerida', error);
    return NextResponse.json(
      { error: 'Erro ao carregar lista de compra sugerida' },
      { status: 500 }
    );
  }
}

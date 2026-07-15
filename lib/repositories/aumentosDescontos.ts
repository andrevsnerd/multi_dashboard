import { fetchProductsWithDetails, fetchProdutosCustoPrecoMestre } from "@/lib/repositories/products";

/**
 * Análise "Aumentos e Descontos" (por produto × cor).
 *
 * Reusa a lógica VALIDADA de vendas (`fetchProductsWithDetails` com
 * `groupByColor: true`): trocas, cancelamentos, fator de desconto e grupos de
 * filial já estão tratados ali — o "valor real vendido" é o faturamento líquido
 * canônico. Aqui NÃO escrevemos SQL de vendas: só comparamos esse valor real
 * contra o VALOR SUGERIDO do cadastro (PRECO_REPOSICAO_1, via
 * `fetchProdutosCustoPrecoMestre`, mesma fonte do Gerador de Relatórios).
 *
 * Regra da classificação (por produto × cor, no período):
 *   valorSugerido = precoSugerido(unit) × qtde líquida vendida
 *   diferenca     = valorSugerido − valorReal
 *     > 0 → DESCONTO (vendeu abaixo do sugerido)
 *     < 0 → AUMENTO  (vendeu acima do sugerido)
 *     = 0 → preço justo
 *   percentual    = |diferenca| ÷ valorSugerido × 100
 */

export interface AumentosDescontosFilters {
  company?: string;
  start?: string;
  end?: string;
  filial?: string | null;
  grupos?: string[] | null;
  linhas?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
  colecoes?: string[] | null;
  cores?: string[] | null;
  tipos?: string[] | null;
  produtoId?: string | null;
  produtoSearchTerm?: string | null;
}

export interface AumentoDescontoRow {
  produto: string;
  cor: string; // código cru da cor
  corDescricao: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  tipo: string;
  grade: string;
  qtde: number; // qtde líquida vendida no período
  precoSugerido: number; // unitário (PRECO_REPOSICAO_1)
  valorSugerido: number; // precoSugerido × qtde
  precoMedioReal: number; // valorReal ÷ qtde
  valorReal: number; // faturamento líquido canônico
  /** Valor da diferença (sempre positivo): desconto concedido ou aumento praticado. */
  valor: number;
  /** Percentual relativo ao valor sugerido (sempre positivo). */
  percentual: number;
}

export interface AumentosDescontosResumo {
  valorSugeridoTotal: number;
  valorRealTotal: number;
  totalDescontoValor: number;
  totalAumentoValor: number;
  descontoMedioPerc: number;
  aumentoMedioPerc: number;
  itensDesconto: number;
  itensAumento: number;
  qtdeDesconto: number;
  qtdeAumento: number;
  itensPrecoJusto: number;
  itensSemPrecoSugerido: number;
}

export interface AumentosDescontosResult {
  descontos: AumentoDescontoRow[];
  aumentos: AumentoDescontoRow[];
  resumo: AumentosDescontosResumo;
}

function up(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeSet(values: string[] | null | undefined): Set<string> | null {
  const list = (values ?? []).map(up).filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

export async function fetchAumentosDescontos(
  filters: AumentosDescontosFilters
): Promise<AumentosDescontosResult> {
  const details = await fetchProductsWithDetails({
    company: filters.company,
    range: { start: filters.start, end: filters.end },
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    produtoId: filters.produtoId ?? undefined,
    produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
    groupByColor: true,
  });

  // Filtros pós-consulta (cor por DESCRIÇÃO e tipo) — mesma regra do Gerador de
  // Relatórios; `fetchProductsWithDetails` não expõe esses dois filtros.
  const corSet = normalizeSet(filters.cores);
  const tipoSet = normalizeSet(filters.tipos);
  const filtered = details.filter((d) => {
    if (corSet && !corSet.has(up(d.descCorProduto))) return false;
    if (tipoSet && !tipoSet.has(up(d.tipo))) return false;
    return true;
  });

  // Preço sugerido SEMPRE da tabela mestre PRODUTOS (PRECO_REPOSICAO_1). Mesmo
  // fallback do Gerador de Relatórios: se o mestre não tiver, usa o suggestedPrice
  // que a própria consulta de vendas já traz.
  const custoPreco = await fetchProdutosCustoPrecoMestre(
    filtered.map((d) => String(d.productId ?? "").trim())
  );

  const descontos: AumentoDescontoRow[] = [];
  const aumentos: AumentoDescontoRow[] = [];
  let itensPrecoJusto = 0;
  let itensSemPrecoSugerido = 0;
  let valorSugeridoTotal = 0;
  let valorRealTotal = 0;
  let totalDescontoValor = 0;
  let totalAumentoValor = 0;
  let qtdeDesconto = 0;
  let qtdeAumento = 0;
  let valorSugeridoDesconto = 0;
  let valorSugeridoAumento = 0;

  for (const d of filtered) {
    const pid = String(d.productId ?? "").trim();
    const qtde = d.totalQuantity ?? 0;
    const valorReal = d.totalRevenue ?? 0;

    const mestre = custoPreco.get(pid);
    const precoSugerido =
      mestre && mestre.precoSugerido != null
        ? mestre.precoSugerido
        : d.suggestedPrice != null
          ? d.suggestedPrice
          : null;

    // Sem preço sugerido ou sem quantidade líquida positiva → não dá para
    // comparar. Fica de fora das duas abas (contabilizado à parte).
    if (precoSugerido == null || precoSugerido <= 0 || qtde <= 0) {
      itensSemPrecoSugerido += 1;
      continue;
    }

    const valorSugerido = precoSugerido * qtde;
    const diferenca = valorSugerido - valorReal; // > 0 desconto, < 0 aumento
    const precoMedioReal = qtde > 0 ? valorReal / qtde : 0;

    valorSugeridoTotal += valorSugerido;
    valorRealTotal += valorReal;

    const base: Omit<AumentoDescontoRow, "valor" | "percentual"> = {
      produto: pid,
      cor: d.corProduto ? String(d.corProduto).trim() : "",
      corDescricao: d.descCorProduto ?? "",
      descricao: d.productName ?? "",
      grupo: d.grupo ?? "",
      subgrupo: d.subgrupo ?? "",
      linha: d.linha ?? "",
      tipo: d.tipo ?? "",
      grade: d.grade ?? "",
      qtde: roundInt(qtde),
      precoSugerido: round2(precoSugerido),
      valorSugerido: round2(valorSugerido),
      precoMedioReal: round2(precoMedioReal),
      valorReal: round2(valorReal),
    };

    const difArred = round2(diferenca);
    if (difArred > 0) {
      const perc = valorSugerido !== 0 ? (diferenca / valorSugerido) * 100 : 0;
      descontos.push({ ...base, valor: difArred, percentual: round2(perc) });
      totalDescontoValor += diferenca;
      qtdeDesconto += qtde;
      valorSugeridoDesconto += valorSugerido;
    } else if (difArred < 0) {
      const aumento = -diferenca;
      const perc = valorSugerido !== 0 ? (aumento / valorSugerido) * 100 : 0;
      aumentos.push({ ...base, valor: round2(aumento), percentual: round2(perc) });
      totalAumentoValor += aumento;
      qtdeAumento += qtde;
      valorSugeridoAumento += valorSugerido;
    } else {
      itensPrecoJusto += 1;
    }
  }

  // Maior impacto primeiro (valor em R$).
  descontos.sort((a, b) => b.valor - a.valor);
  aumentos.sort((a, b) => b.valor - a.valor);

  const resumo: AumentosDescontosResumo = {
    valorSugeridoTotal: round2(valorSugeridoTotal),
    valorRealTotal: round2(valorRealTotal),
    totalDescontoValor: round2(totalDescontoValor),
    totalAumentoValor: round2(totalAumentoValor),
    descontoMedioPerc:
      valorSugeridoDesconto !== 0 ? round2((totalDescontoValor / valorSugeridoDesconto) * 100) : 0,
    aumentoMedioPerc:
      valorSugeridoAumento !== 0 ? round2((totalAumentoValor / valorSugeridoAumento) * 100) : 0,
    itensDesconto: descontos.length,
    itensAumento: aumentos.length,
    qtdeDesconto: roundInt(qtdeDesconto),
    qtdeAumento: roundInt(qtdeAumento),
    itensPrecoJusto,
    itensSemPrecoSugerido,
  };

  return { descontos, aumentos, resumo };
}

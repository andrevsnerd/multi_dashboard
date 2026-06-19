import {
  fetchEstoqueRedePorProduto,
  type EstoqueRedeItemRow,
} from "@/lib/repositories/controleEstoque";
import { diasDesde, ROW_COR_FIELD } from "@/lib/reports/keys";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import type { ReportFilters, ReportResult, ReportRow } from "@/lib/reports/types";

const DEFAULT_LIMIT = 5000;

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Análise "Produtos por cadastro": produtos (produto × cor, com estoque) com a data de
 * cadastro e há quantos dias foram cadastrados. Reusa o mesmo motor/escopo da Estoque
 * por filial (`fetchEstoqueRedePorProduto`, que já traz DATA_CADASTRAMENTO e os filtros
 * cor/linha/grupo/etc.). Grão produto × cor; a data de cadastro é por produto.
 */
export async function fetchProdutosCadastro(filters: ReportFilters): Promise<ReportResult> {
  const itens = await fetchEstoqueRedePorProduto({
    company: filters.company,
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    cores: filters.cores ?? null,
    tipos: filters.tipos ?? null,
    produtoId: filters.produtoId ?? null,
    produtoSearchTerm: filters.produtoSearchTerm ?? null,
  });

  // Dedup por (produto, cor) — a fonte vem por filial; data de cadastro é por produto.
  const byKey = new Map<string, EstoqueRedeItemRow>();
  for (const r of itens) {
    const key = `${r.produto}||${r.cor}`;
    if (!byKey.has(key)) byKey.set(key, r);
  }

  const nowMs = Date.now();
  const aggs = Array.from(byKey.values());
  // Mais recém-cadastrados primeiro (sem data vai para o fim).
  aggs.sort((a, b) => (b.dataCadastro ?? "").localeCompare(a.dataCadastro ?? ""));

  const total = aggs.length;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const truncated = total > limit;
  const sliced = truncated ? aggs.slice(0, limit) : aggs;

  const rows: ReportRow[] = sliced.map((d) => {
    const dias = diasDesde(d.dataCadastro, nowMs);
    return {
      [ROW_COR_FIELD]: d.corCodigo ?? "",
      DATA_CADASTRO: d.dataCadastro,
      PRODUTO: d.produto,
      GRUPO: d.grupo,
      LINHA: d.linha,
      SUBGRUPO: d.subgrupo,
      GRADE: d.grade,
      TIPO: d.tipo,
      COR: d.cor,
      DESCRICAO: d.descricao,
      DIAS_CADASTRO: dias == null ? null : roundInt(dias),
    };
  });

  await applyColecaoLabels(filters.company, rows);

  return { rows, total, truncated };
}

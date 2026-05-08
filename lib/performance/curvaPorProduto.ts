export type CurvaPorProdutoClassificacao = "A" | "B" | "C";

export interface CurvaPorProdutoSelectedItem {
  produto: string;
  descricao: string;
  codigoBarra?: string | null;
  corProduto?: string | null;
  corDescricao?: string | null;
  grade?: string | null;
  linha?: string | null;
  subgrupo?: string | null;
}

export interface CurvaPorProdutoApiRow extends CurvaPorProdutoSelectedItem {
  categoria: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
  represented: boolean;
  curva: CurvaPorProdutoClassificacao | null;
  percParticipacao: number;
  percCumulativa: number;
}

export interface CurvaPorProdutoApiResponse {
  filial: string | null;
  displayName: string;
  comparisonMode: "month" | "year";
  totalScopeRevenue: number;
  range: {
    start: string;
    end: string;
  };
  rows: CurvaPorProdutoApiRow[];
}

export function buildCurvaPorProdutoKey(
  produto?: string | null,
  corProduto?: string | null
): string {
  return `${(produto ?? "").trim()}||${(corProduto ?? "").trim()}`;
}

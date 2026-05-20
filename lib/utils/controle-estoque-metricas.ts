export interface ControleEstoqueItemInput {
  produto: string;
  corProduto?: string | null;
}

export interface ControleEstoqueEstoquePorFilialRow {
  filial: string;
  estoque: number;
}

export interface ControleEstoqueVendasPorFilialRow {
  filial: string;
  qtde12m: number;
  qtde60d: number;
  qtdeMesAtual: number;
  valor12m: number;
  custoUnitario: number;
  diasDesdeUltimaVenda: number | null;
  primeiraEntradaFilial: string | null;
  diasHistoricoFilial: number;
  mesesHistoricoFilial: number;
  historicoParcial: boolean;
}

export interface ControleEstoqueResumoHistorico {
  primeiraEntradaFilial: string | null;
  diasHistoricoFilial: number;
  mesesHistoricoFilial: number;
  historicoParcial: boolean;
}

export interface ControleEstoqueItemMetricasResumo extends ControleEstoqueResumoHistorico {
  estoqueTotal: number;
  qtde12m: number;
  qtde60d: number;
  vendasMesAtual: number;
  valor12m: number | null;
  custoUnitario: number | null;
  diasDesdeUltimaVenda: number | null;
}

export interface ControleEstoqueItemMetricas {
  item: {
    produto: string;
    corProduto: string | null;
  };
  estoquePorFilial: ControleEstoqueEstoquePorFilialRow[];
  vendasPorFilial: ControleEstoqueVendasPorFilialRow[];
  resumo: ControleEstoqueItemMetricasResumo;
}

export interface ControleEstoqueMetricasItensPayload {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  itens: ControleEstoqueItemInput[];
}

export function normalizeControleEstoqueItemValue(value?: string | null): string {
  return (value ?? "").toString().trim();
}

export function normalizeControleEstoqueItemKeyPart(value?: string | null): string {
  return normalizeControleEstoqueItemValue(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function buildControleEstoqueItemKey(produto?: string | null, corProduto?: string | null): string {
  return `${normalizeControleEstoqueItemKeyPart(produto)}||${normalizeControleEstoqueItemKeyPart(corProduto)}`;
}

export function dedupeControleEstoqueItens<T extends ControleEstoqueItemInput>(itens: T[]): T[] {
  const unique = new Map<string, T>();
  for (const item of itens) {
    const produto = normalizeControleEstoqueItemValue(item.produto);
    if (!produto) continue;
    const corProduto = normalizeControleEstoqueItemValue(item.corProduto);
    const key = buildControleEstoqueItemKey(produto, corProduto);
    if (!unique.has(key)) {
      unique.set(key, {
        ...item,
        produto,
        corProduto: corProduto || null,
      });
    }
  }
  return Array.from(unique.values());
}

function getHistoricoFallback(): ControleEstoqueResumoHistorico {
  return {
    primeiraEntradaFilial: null,
    diasHistoricoFilial: 365,
    mesesHistoricoFilial: 12,
    historicoParcial: false,
  };
}

function calculateHistoricoFromDate(value: string): ControleEstoqueResumoHistorico {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getHistoricoFallback();
  const diasHistoricoFilial = Math.min(
    365,
    Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  );
  return {
    primeiraEntradaFilial: date.toISOString(),
    diasHistoricoFilial,
    mesesHistoricoFilial: Math.min(12, Math.max(1, diasHistoricoFilial / 30)),
    historicoParcial: diasHistoricoFilial < 365,
  };
}

export function mergeControleEstoqueHistoricoRows(
  rows: Array<
    Pick<
      ControleEstoqueVendasPorFilialRow,
      "primeiraEntradaFilial" | "diasHistoricoFilial" | "mesesHistoricoFilial" | "historicoParcial"
    >
  >
): ControleEstoqueResumoHistorico {
  let primeiraEntrada: Date | null = null;

  for (const row of rows) {
    if (!row.primeiraEntradaFilial) continue;
    const date = new Date(row.primeiraEntradaFilial);
    if (Number.isNaN(date.getTime())) continue;
    if (!primeiraEntrada || date < primeiraEntrada) primeiraEntrada = date;
  }

  if (primeiraEntrada) {
    return calculateHistoricoFromDate(primeiraEntrada.toISOString());
  }

  const parcial = rows.find(
    (row) =>
      row.diasHistoricoFilial != null &&
      row.mesesHistoricoFilial != null &&
      row.historicoParcial != null
  );

  if (parcial) {
    return {
      primeiraEntradaFilial: null,
      diasHistoricoFilial: Math.min(365, Math.max(0, Number(parcial.diasHistoricoFilial ?? 365))),
      mesesHistoricoFilial: Math.min(12, Math.max(1, Number(parcial.mesesHistoricoFilial ?? 12))),
      historicoParcial: Boolean(parcial.historicoParcial),
    };
  }

  return getHistoricoFallback();
}

export function summarizeControleEstoqueItemMetricas(input: {
  estoquePorFilial: ControleEstoqueEstoquePorFilialRow[];
  vendasPorFilial: ControleEstoqueVendasPorFilialRow[];
}): ControleEstoqueItemMetricasResumo {
  const { estoquePorFilial, vendasPorFilial } = input;
  const historico = mergeControleEstoqueHistoricoRows(vendasPorFilial);
  const diasValidos = vendasPorFilial
    .map((row) => row.diasDesdeUltimaVenda)
    .filter((value): value is number => value != null);
  const totalValor = vendasPorFilial.reduce((sum, row) => sum + Number(row.valor12m ?? 0), 0);
  const custoUnitario = vendasPorFilial.reduce(
    (max, row) => Math.max(max, Number(row.custoUnitario ?? 0)),
    0
  );

  return {
    estoqueTotal: Math.round(
      estoquePorFilial.reduce((sum, row) => sum + Math.max(0, Number(row.estoque ?? 0)), 0)
    ),
    qtde12m: Math.round(vendasPorFilial.reduce((sum, row) => sum + Number(row.qtde12m ?? 0), 0)),
    qtde60d: Math.round(vendasPorFilial.reduce((sum, row) => sum + Number(row.qtde60d ?? 0), 0)),
    vendasMesAtual: Math.round(
      vendasPorFilial.reduce((sum, row) => sum + Number(row.qtdeMesAtual ?? 0), 0)
    ),
    valor12m: totalValor > 0 ? Math.round(totalValor) : null,
    custoUnitario: custoUnitario > 0 ? custoUnitario : null,
    diasDesdeUltimaVenda: diasValidos.length > 0 ? Math.min(...diasValidos) : null,
    ...historico,
  };
}

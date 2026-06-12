import type { ProductStockProgressDay } from "@/lib/repositories/productDetail";

/**
 * Lógica de "cobertura de estoque" da página Produto Performance.
 *
 * Opera sobre a série diária real (`ProductStockProgressDay[]`) já produzida por
 * `fetchProductStockProgressSeries`. Cada dia traz o saldo estimado por filial
 * (`stockByFilial`, chaveado pelo nome de exibição em MAIÚSCULAS) e as vendas do
 * dia por filial (`salesByFilial`). A partir disso derivamos:
 *  - períodos contíguos com/sem estoque (consolidado e por filial);
 *  - a performance (vendas, velocidade, sugestão de compra) de um intervalo.
 *
 * É o equivalente real do mock-stock.ts do protótipo.
 */

/** Período contíguo de dias com (ou sem) estoque, por índice na série. */
export interface CoveragePeriod {
  /** índice do primeiro dia do período (inclusive) */
  startIndex: number;
  /** índice do último dia do período (inclusive) */
  endIndex: number;
  /** true = teve estoque; false = ruptura */
  inStock: boolean;
}

/** Filial presente na série, com chave (MAIÚSCULA) e rótulo de exibição. */
export interface CoverageFilial {
  key: string;
  label: string;
}

export interface FilialPerformance {
  key: string;
  label: string;
  /** dias com estoque > 0 OU venda > 0 no intervalo */
  daysInStock: number;
  unitsSold: number;
  /** unidades / dia, considerando apenas dias com estoque */
  velocity: number;
  /** ceil(velocity × coverageDays); 0 quando a filial não teve estoque no período */
  suggestedQty: number;
}

export interface PerformanceResult {
  filiais: FilialPerformance[];
  totalUnits: number;
  totalDaysInStock: number;
  /** totalUnits / soma de daysInStock */
  weightedVelocity: number;
  totalSuggested: number;
  /** quantas filiais tiveram estoque no período */
  filialsWithStock: number;
  /** total de filiais consideradas */
  totalFiliais: number;
  /** nº de dias do intervalo selecionado */
  days: number;
  /** maior velocidade individual do período (para escala relativa das barras) */
  maxVelocity: number;
}

export interface CoverageSummary {
  totalDays: number;
  inDays: number;
  outDays: number;
  /** percentual de dias com estoque (0-100) */
  pctIn: number;
  /** maior sequência contígua de dias em ruptura */
  longestOut: number;
  /** dias seguidos sem estoque ao fim do período (0 quando há estoque hoje) */
  daysSinceLastStock: number;
  currentlyOut: boolean;
}

/** Agrupa um vetor de flags booleanas em períodos contíguos. */
export function detectPeriods(flags: boolean[]): CoveragePeriod[] {
  const periods: CoveragePeriod[] = [];
  if (flags.length === 0) return periods;

  let start = 0;
  let current = flags[0];
  for (let i = 1; i < flags.length; i += 1) {
    if (flags[i] !== current) {
      periods.push({ startIndex: start, endIndex: i - 1, inStock: current });
      start = i;
      current = flags[i];
    }
  }
  periods.push({ startIndex: start, endIndex: flags.length - 1, inStock: current });
  return periods;
}

/** Flags consolidadas: dia "in" quando QUALQUER filial tinha estoque (usa outOfStock). */
export function aggregatedFlags(days: ProductStockProgressDay[]): boolean[] {
  return days.map((day) => !day.outOfStock);
}

/** Flags de uma filial específica: "in" quando o saldo daquele dia é > 0. */
export function branchFlags(days: ProductStockProgressDay[], filialKey: string): boolean[] {
  return days.map((day) => (day.stockByFilial?.[filialKey] ?? 0) > 0);
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * Lista as filiais presentes na série (união de chaves de estoque e de vendas).
 * `displayMap` mapeia chave MAIÚSCULA -> rótulo "bonito" (vindo de stockByFilial do detalhe).
 */
export function collectFilials(
  days: ProductStockProgressDay[],
  displayMap: Record<string, string>
): CoverageFilial[] {
  const keys = new Set<string>();
  for (const day of days) {
    for (const key of Object.keys(day.stockByFilial ?? {})) {
      keys.add(key);
    }
    for (const sale of day.salesByFilial ?? []) {
      keys.add(sale.filialDisplayName);
    }
  }
  return Array.from(keys)
    .map((key) => ({ key, label: displayMap[key] ?? titleCase(key) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
}

/** Vendas do dia para uma filial (salesByFilial só lista qty > 0). */
function salesForFilial(day: ProductStockProgressDay, filialKey: string): number {
  const entry = (day.salesByFilial ?? []).find((s) => s.filialDisplayName === filialKey);
  return entry ? entry.qty : 0;
}

/** Resumo de cobertura (KPIs do header) a partir das flags consolidadas. */
export function summarize(flags: boolean[]): CoverageSummary {
  const totalDays = flags.length;
  let inDays = 0;
  let longestOut = 0;
  let currentOutStreak = 0;
  let trailingOut = 0;

  for (let i = 0; i < flags.length; i += 1) {
    if (flags[i]) {
      inDays += 1;
      currentOutStreak = 0;
    } else {
      currentOutStreak += 1;
      if (currentOutStreak > longestOut) longestOut = currentOutStreak;
    }
  }
  // dias seguidos sem estoque ao final
  for (let i = flags.length - 1; i >= 0; i -= 1) {
    if (flags[i]) break;
    trailingOut += 1;
  }

  const outDays = totalDays - inDays;
  return {
    totalDays,
    inDays,
    outDays,
    pctIn: totalDays > 0 ? Math.round((inDays / totalDays) * 100) : 0,
    longestOut,
    daysSinceLastStock: trailingOut,
    currentlyOut: totalDays > 0 ? !flags[flags.length - 1] : false,
  };
}

/**
 * Performance do intervalo [startIndex, endIndex] (inclusive) por filial.
 * coverageDays é a cobertura alvo (dias) usada na sugestão de compra.
 */
export function computePerformance(
  days: ProductStockProgressDay[],
  filiais: CoverageFilial[],
  startIndex: number,
  endIndex: number,
  coverageDays: number
): PerformanceResult {
  const from = Math.max(0, Math.min(startIndex, endIndex));
  const to = Math.min(days.length - 1, Math.max(startIndex, endIndex));
  const slice = days.slice(from, to + 1);

  const perFilial: FilialPerformance[] = filiais.map((filial) => {
    let daysInStock = 0;
    let unitsSold = 0;
    for (const day of slice) {
      const stock = day.stockByFilial?.[filial.key] ?? 0;
      const sale = salesForFilial(day, filial.key);
      if (stock > 0 || sale > 0) daysInStock += 1;
      unitsSold += sale;
    }
    const velocity = daysInStock > 0 ? unitsSold / daysInStock : 0;
    const suggestedQty = daysInStock > 0 ? Math.ceil(velocity * coverageDays) : 0;
    return {
      key: filial.key,
      label: filial.label,
      daysInStock,
      unitsSold,
      velocity,
      suggestedQty,
    };
  });

  perFilial.sort((a, b) => b.velocity - a.velocity);

  const totalUnits = perFilial.reduce((sum, f) => sum + f.unitsSold, 0);
  const totalDaysInStock = perFilial.reduce((sum, f) => sum + f.daysInStock, 0);
  const totalSuggested = perFilial.reduce((sum, f) => sum + f.suggestedQty, 0);
  const filialsWithStock = perFilial.filter((f) => f.daysInStock > 0).length;
  const maxVelocity = perFilial.reduce((max, f) => (f.velocity > max ? f.velocity : max), 0);

  return {
    filiais: perFilial,
    totalUnits,
    totalDaysInStock,
    weightedVelocity: totalDaysInStock > 0 ? totalUnits / totalDaysInStock : 0,
    totalSuggested,
    filialsWithStock,
    totalFiliais: filiais.length,
    days: slice.length,
    maxVelocity,
  };
}

/** Último período "com estoque" do consolidado, para seleção inicial. */
export function lastInStockPeriod(periods: CoveragePeriod[]): CoveragePeriod | null {
  for (let i = periods.length - 1; i >= 0; i -= 1) {
    if (periods[i].inStock) return periods[i];
  }
  return periods[periods.length - 1] ?? null;
}

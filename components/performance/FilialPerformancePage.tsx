"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { canSeeCusto } from "@/lib/auth/permissions";
import { startOfMonth, endOfMonth } from "date-fns";
import type { CompanyKey } from "@/lib/config/company";
import {
  OUTROS_LABEL,
  filterOutrosKeys,
  getOutrosTooltip,
  isOutrosCategory,
} from "@/lib/performance/outrosCategories";
import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import { formatDateForQuery } from "@/lib/utils/date";
import FilialVendedoresTab from "./FilialVendedoresTab";
import styles from "./FilialPerformancePage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ProdutoRow {
  produto: string;
  descricao: string;
  categoria: string;
  grade?: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
}

interface FilialData {
  filial: string;
  displayName: string;
  vendas: number;
  vendasPrevious: number;
  qtde: number;
  meta: number;
  projecao: number;
  projecaoPct: number | null;
  categories: Record<string, { pct: number; deltaPct: number | null }>;
  categoryList: string[];
  daysElapsed: number;
  totalDaysInMonth: number;
  month: number;
  year: number;
  produtos: ProdutoRow[];
}

type Curva = "A" | "B" | "C";

interface ProdutoComCurva extends ProdutoRow {
  curva: Curva;
  percParticipacao: number;
  percCumulativa: number;
}

// ─── Formatação ──────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getComparisonBadge(
  current: number,
  previous: number
): { kind: "pct"; value: number } | { kind: "new" } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous > 0) return { kind: "pct", value: ((current - previous) / previous) * 100 };
  if (current > 0 && previous <= 0) return { kind: "new" };
  return null;
}

// ─── ABC helpers ──────────────────────────────────────────────────────────────

function calcularCurvas(produtos: ProdutoRow[]): ProdutoComCurva[] {
  const totalGeral = produtos.reduce((s, p) => s + p.vendas, 0);
  let cumulative = 0;
  return produtos.map((p): ProdutoComCurva => {
    cumulative += p.vendas;
    const percCum = totalGeral > 0 ? cumulative / totalGeral : 1;
    const curva: Curva = percCum <= 0.80 ? "A" : percCum <= 0.95 ? "B" : "C";
    const percParticipacao = totalGeral > 0 ? (p.vendas / totalGeral) * 100 : 0;
    return { ...p, curva, percParticipacao, percCumulativa: percCum };
  });
}

const CURVA_LABEL: Record<Curva, string> = {
  A: "Curva A — 80% do faturamento",
  B: "Curva B — 15% do faturamento",
  C: "Curva C — 5% do faturamento",
};

const CURVA_BADGE_CLASS: Record<Curva, string> = {
  A: styles.badgeA,
  B: styles.badgeB,
  C: styles.badgeC,
};

const CURVA_BAR_CLASS: Record<Curva, string> = {
  A: styles.percBarFillA,
  B: styles.percBarFillB,
  C: styles.percBarFillC,
};

// ─── Category helpers ─────────────────────────────────────────────────────────

function getCategoryHeaderLabel(category: string): string {
  const normalized = category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  if (normalized.includes("APROVEITAMENTO") && normalized.includes("LENC")) return "Ap. Lenços";
  return category.toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function formatCompactSignedPctForBadge(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const absRounded = Math.round(Math.abs(value));
  if (absRounded <= 999) return `${sign}${absRounded}%`;

  const thousands = Math.floor(absRounded / 1000);
  if (thousands <= 999) return `${sign}${thousands}K%`;

  return `${sign}999K%`;
}

function getCombinedCategoryMetrics(
  categories: Record<string, { pct: number; deltaPct: number | null }>,
  keys: string[],
  totalSales: number
): { pct: number; deltaPct: number | null; currentSales: number; previousSales: number } | null {
  if (keys.length === 0 || totalSales <= 0) return null;

  let currentSales = 0;
  let previousSales = 0;
  let hasAny = false;

  for (const key of keys) {
    const category = categories[key];
    const pct = category?.pct;
    if (!Number.isFinite(pct)) continue;

    const current = totalSales * (pct / 100);
    currentSales += current;
    hasAny = true;

    const deltaPct = category?.deltaPct;
    if (typeof deltaPct === "number" && Number.isFinite(deltaPct)) {
      const factor = 1 + (deltaPct / 100);
      if (factor > 0) previousSales += current / factor;
    }
  }

  if (!hasAny) return null;

  const pct = (currentSales / totalSales) * 100;
  const deltaPct = previousSales > 0
    ? ((currentSales - previousSales) / previousSales) * 100
    : null;

  return { pct: Math.round(pct), deltaPct, currentSales, previousSales };
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
  filial: string;
  month: number;
  year: number;
  compare: "month" | "year";
  initialStart?: string;
  initialEnd?: string;
}

export default function FilialPerformancePage({
  companyKey,
  filial,
  month,
  year,
  compare: initialCompare,
  initialStart,
  initialEnd,
}: Props) {
  const { user } = useAuth();
  const podeVerCusto = canSeeCusto(user);
  const router = useRouter();

  const parseYmdToLocalDate = (value?: string): Date | null => {
    if (!value) return null;
    const parts = value.split("-");
    if (parts.length !== 3) return null;
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    return Number.isNaN(dt.getTime()) ? null : dt;
  };

  const [range, setRange] = useState<DateRangeValue>(() => {
    const parsedStart = parseYmdToLocalDate(initialStart);
    const parsedEnd = parseYmdToLocalDate(initialEnd);
    if (parsedStart && parsedEnd) {
      return { startDate: parsedStart, endDate: parsedEnd };
    }
    const base = new Date(year, month, 1);
    return { startDate: startOfMonth(base), endDate: endOfMonth(base) };
  });
  const [comparisonMode, setComparisonMode] = useState<"month" | "year">(initialCompare);

  const selectedMonth = range.startDate.getMonth();
  const selectedYear = range.startDate.getFullYear();

  const [data, setData] = useState<FilialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"produtos" | "vendedores">("produtos");

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedCategory(null);
    const params = new URLSearchParams({
      company: companyKey,
      filial,
      month: String(selectedMonth),
      year: String(selectedYear),
      start: formatDateForQuery(range.startDate),
      end: formatDateForQuery(range.endDate),
      compare: comparisonMode,
    });
    fetch(`/api/controle-performance/filial?${params}`, { cache: "no-store" })
      .then(res => res.json())
      .then((json: FilialData & { error?: string }) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Erro desconhecido"))
      .finally(() => setLoading(false));
  }, [companyKey, filial, selectedMonth, selectedYear, comparisonMode, range.startDate, range.endDate]);

  const outrosTooltip = useMemo(() => getOutrosTooltip(companyKey), [companyKey]);

  const outrosKeys = useMemo(
    () => (data ? filterOutrosKeys(data.categoryList, companyKey) : []),
    [data, companyKey]
  );

  const displayedCategories = useMemo(() => {
    if (!data) return [];
    const outros = data.categoryList.filter(c => isOutrosCategory(companyKey, c));
    const remaining = data.categoryList.filter(c => !isOutrosCategory(companyKey, c));
    return outros.length > 0 ? [...remaining, OUTROS_LABEL] : remaining;
  }, [data, companyKey]);

  // Resolve which raw categoria values match the selected display category
  const activeCategorias = useMemo((): Set<string> | null => {
    if (!selectedCategory || !data) return null;
    if (selectedCategory === OUTROS_LABEL) {
      return new Set(filterOutrosKeys(data.categoryList, companyKey));
    }
    return new Set([selectedCategory]);
  }, [selectedCategory, data, companyKey]);

  const produtosFiltrados = useMemo(() => {
    if (!data) return [];
    if (!activeCategorias) return data.produtos;
    return data.produtos.filter(p => activeCategorias.has(p.categoria));
  }, [data, activeCategorias]);

  const produtosComCurva = useMemo(() => {
    if (produtosFiltrados.length === 0) return [];
    return calcularCurvas(produtosFiltrados);
  }, [produtosFiltrados]);

  const maxPerc = produtosComCurva.length > 0 ? produtosComCurva[0].percParticipacao : 1;
  const countA = produtosComCurva.filter(p => p.curva === "A").length;
  const countB = produtosComCurva.filter(p => p.curva === "B").length;
  const countC = produtosComCurva.filter(p => p.curva === "C").length;
  const groups: Curva[] = ["A", "B", "C"];

  // Quando há filtro ativo, KPIs refletem apenas os produtos filtrados
  const displayVendas = selectedCategory
    ? produtosFiltrados.reduce((s, p) => s + p.vendas, 0)
    : data?.vendas ?? 0;
  const displayQtde = selectedCategory
    ? produtosFiltrados.reduce((s, p) => s + p.qtde, 0)
    : data?.qtde ?? 0;
  const displayCMV = produtosFiltrados.reduce((s, p) => s + p.custo * p.qtde, 0);

  const variation = data ? getComparisonBadge(data.vendas, data.vendasPrevious) : null;

  const salesPct = data?.projecaoPct ?? null;

  const realPct = data && data.meta > 0 ? (data.vendas / data.meta) * 100 : null;
  const realBarPct = realPct !== null ? Math.min(realPct, 100) : 0;
  const realBarClass = realPct !== null
    ? (realPct >= 100 ? styles.fillGreen : realPct >= 75 ? styles.fillOrange : styles.fillRed)
    : styles.fillRed;
  const realMetaPctClass = realPct !== null
    ? (realPct >= 100 ? styles.metaPctGreen : realPct >= 75 ? styles.metaPctOrange : styles.metaPctRed)
    : "";

  const barPct = salesPct !== null ? Math.min(salesPct, 100) : 0;
  const barClass = salesPct !== null
    ? (salesPct >= 100 ? styles.fillGreen : salesPct >= 75 ? styles.fillOrange : styles.fillRed)
    : styles.fillRed;
  const metaPctClass = salesPct !== null
    ? (salesPct >= 100 ? styles.metaPctGreen : salesPct >= 75 ? styles.metaPctOrange : styles.metaPctRed)
    : "";

  const getCardCatPct = (cat: string): number | null => {
    if (!data) return null;
    if (cat === OUTROS_LABEL) {
      return getCombinedCategoryMetrics(data.categories, outrosKeys, data.vendas)?.pct ?? null;
    }
    const v = data.categories[cat]?.pct;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
  };

  const getCardCatDelta = (cat: string): number | null => {
    if (!data) return null;
    if (cat === OUTROS_LABEL) {
      return getCombinedCategoryMetrics(data.categories, outrosKeys, data.vendas)?.deltaPct ?? null;
    }
    const d = data.categories[cat]?.deltaPct;
    return typeof d === "number" && Number.isFinite(d) ? d : null;
  };

  const handleBadgeClick = (cat: string) => {
    setSelectedCategory(prev => prev === cat ? null : cat);
  };

  const comparisonLabel = comparisonMode === "month" ? "mês anterior" : "mesmo período do ano anterior";

  const monthName = new Date(selectedYear, selectedMonth, 1)
    .toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const abcTitleSuffix = selectedCategory
    ? ` — ${getCategoryHeaderLabel(selectedCategory)}`
    : "";

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrapper}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
            </div>
            <div>
              <h1 className={styles.title}>{data?.displayName ?? filial}</h1>
              <p className={styles.subtitle}>Performance de vendas</p>
              <div className={styles.periodFilter}>
                <DateRangeFilter
                  label=""
                  value={range}
                  onChange={(nextRange) => {
                    setRange(nextRange);
                  }}
                />
              </div>
            </div>
          </div>

          {/* KPI Cards inline */}
          {data && (
            <div className={styles.kpiCards}>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>VENDAS</span>
                <span className={styles.kpiValue}>{fmtCurrency(displayVendas)}</span>
                {!selectedCategory && <span className={styles.kpiProjecao}>Projeção: {fmtCurrency(data.projecao)}</span>}
                {variation && (
                  <span
                    className={`${styles.variationBadge} ${
                      variation.kind === "new"
                        ? styles.variationPos
                        : variation.value >= 0
                          ? styles.variationPos
                          : styles.variationNeg
                    }`}
                  >
                    {variation.kind === "new"
                      ? "★ NOVO"
                      : `${variation.value >= 0 ? "↗" : "↘"} ${formatSignedPct(variation.value)}`}
                    <span className={styles.variationLabel}> vs {comparisonLabel}</span>
                  </span>
                )}
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>META</span>
                <span className={styles.kpiValue}>{data.meta > 0 ? fmtCurrency(data.meta) : "—"}</span>
                {data.meta > 0 && realPct !== null && (
                  <>
                    <div className={styles.metaBarRow}>
                      <span className={`${styles.metaPct} ${realMetaPctClass}`}>{realPct.toFixed(1)}% atingido</span>
                    </div>
                    <div className={styles.progressBarTrack}>
                      <div className={`${styles.progressBarFill} ${realBarClass}`} style={{ width: `${realBarPct}%` }} />
                    </div>
                    <span className={styles.metaFalta}>
                      {realPct >= 100
                        ? `✓ Meta atingida`
                        : `Faltam ${fmtCurrency(data.meta - data.vendas)}`}
                    </span>
                  </>
                )}
              </div>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>QTDE VENDAS</span>
                <span className={styles.kpiValue}>{fmt(displayQtde)}</span>
              </div>
              {podeVerCusto && (
                <div className={styles.kpiCard}>
                  <span className={styles.kpiLabel}>CMV</span>
                  <span className={styles.kpiValue}>{displayCMV > 0 ? fmtCurrency(displayCMV) : "—"}</span>
                </div>
              )}
            </div>
          )}

          <button type="button" className={styles.backButton} onClick={() => router.back()}>
            ← Voltar
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {!error && (
        <div className={styles.tabsRow}>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "produtos" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("produtos")}
          >
            Produtos
          </button>
          <button
            type="button"
            className={`${styles.tabBtn} ${activeTab === "vendedores" ? styles.tabBtnActive : ""}`}
            onClick={() => setActiveTab("vendedores")}
          >
            Vendedores
          </button>
        </div>
      )}

      {activeTab === "produtos" && loading && <div className={styles.loading}>Carregando...</div>}

      {activeTab === "vendedores" && (
        <FilialVendedoresTab
          companyKey={companyKey}
          filial={filial}
          initialRange={range}
        />
      )}

      {activeTab === "produtos" && !loading && data && (
        <>

          {/* Category badges — clicáveis para filtrar ABC */}
          {displayedCategories.length > 0 && (
            <div className={styles.categoryBadgesRow}>
              {selectedCategory && (
                <span className={styles.badgesHint}>Filtrando por categoria — clique para remover:</span>
              )}
              {selectedCategory && (
                <button
                  type="button"
                  className={styles.clearFilterBtn}
                  onClick={() => setSelectedCategory(null)}
                >
                  ✕ Todos
                </button>
              )}
              {displayedCategories.map(cat => {
                const pct = getCardCatPct(cat);
                const delta = getCardCatDelta(cat);
                if (pct === null) return null;
                const isActive = selectedCategory === cat;
                const isInactive = selectedCategory !== null && !isActive;
                const categoryComparisonValues = (() => {
                  if (!data) return null;
                  if (cat === OUTROS_LABEL) {
                    const combined = getCombinedCategoryMetrics(data.categories, outrosKeys, data.vendas);
                    if (!combined) return null;
                    return {
                      current: combined.currentSales,
                      previous: combined.previousSales > 0 ? combined.previousSales : null,
                    };
                  }

                  const catData = data.categories[cat];
                  if (!catData) return null;
                  const current = data.vendas * (catData.pct / 100);
                  if (!Number.isFinite(current)) return null;
                  if (typeof catData.deltaPct === "number" && Number.isFinite(catData.deltaPct)) {
                    const factor = 1 + (catData.deltaPct / 100);
                    if (factor > 0) {
                      return {
                        current,
                        previous: current / factor,
                      };
                    }
                  }
                  return { current, previous: null };
                })();

                const catPillTrendClass = isActive
                  ? styles.catPillActive
                  : delta === null
                    ? styles.catPillNeutral
                    : (delta >= 0 ? styles.catPillUp : styles.catPillDown);
                const baseTitle = cat === OUTROS_LABEL ? outrosTooltip : getCategoryHeaderLabel(cat);
                const comparisonValuesTitle = categoryComparisonValues
                  ? `Atual: ${fmtCurrency(categoryComparisonValues.current)} | Anterior: ${categoryComparisonValues.previous !== null ? fmtCurrency(categoryComparisonValues.previous) : "—"}`
                  : "Atual: — | Anterior: —";
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`${styles.catPill} ${catPillTrendClass} ${isInactive ? styles.catPillInactive : ""}`}
                    title={`${baseTitle} | Variação vs ${comparisonLabel} | ${comparisonValuesTitle}`}
                    onClick={() => handleBadgeClick(cat)}
                  >
                    {getCategoryHeaderLabel(cat)} {delta !== null ? formatCompactSignedPctForBadge(delta) : "—"}
                    {delta !== null && !isActive && (
                      <span className={delta >= 0 ? styles.catArrowUp : styles.catArrowDown}>
                        {delta >= 0 ? " ↑" : " ↓"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* ABC Summary */}
          {produtosComCurva.length > 0 && (
            <div className={styles.summaryCard}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>PRODUTOS ÚNICOS</span>
                <span className={styles.summaryValueNeutral}>{produtosComCurva.length}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Curva A</span>
                <span className={`${styles.summaryValueSmall} ${styles.textA}`}>{countA} produtos</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Curva B</span>
                <span className={`${styles.summaryValueSmall} ${styles.textB}`}>{countB} produtos</span>
              </div>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Curva C</span>
                <span className={`${styles.summaryValueSmall} ${styles.textC}`}>{countC} produtos</span>
              </div>
              {selectedCategory && (
                <>
                  <div className={styles.summaryDivider} />
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Filtro ativo</span>
                    <span className={styles.filterActiveBadge}>{getCategoryHeaderLabel(selectedCategory)}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Comparação toggle */}
          <div className={styles.comparisonRow}>
            <span className={styles.comparisonLabel}>Comparação:</span>
            <div className={styles.comparisonToggle}>
              <button
                type="button"
                className={`${styles.toggleBtn} ${comparisonMode === "month" ? styles.toggleBtnActive : ""}`}
                onClick={() => setComparisonMode("month")}
              >
                Mês
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${comparisonMode === "year" ? styles.toggleBtnActive : ""}`}
                onClick={() => setComparisonMode("year")}
              >
                Ano
              </button>
            </div>
          </div>

          {/* ABC Table */}
          <div className={styles.tableCard}>
            {produtosComCurva.length === 0 && selectedCategory && (
              <div className={styles.empty}>
                Nenhum produto encontrado para a categoria <strong>{getCategoryHeaderLabel(selectedCategory)}</strong> neste período.
              </div>
            )}
            {produtosComCurva.length === 0 && !selectedCategory && (
              <div className={styles.empty}>Nenhum produto encontrado para este período.</div>
            )}
            {produtosComCurva.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th>
                      Produto
                      {abcTitleSuffix && <span className={styles.thFilterLabel}>{abcTitleSuffix}</span>}
                    </th>
                    <th className={styles.right}>Participação</th>
                    <th className={styles.right}>Faturamento no período</th>
                    <th className={styles.right}>Qtd vendida</th>
                    <th className={styles.right}>Markup</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(curva => {
                    const grupo = produtosComCurva.filter(p => p.curva === curva);
                    if (grupo.length === 0) return null;
                    return (
                      <React.Fragment key={curva}>
                        <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                          <td colSpan={6}>
                            <div className={styles.sectionLabel}>
                              <span className={`${styles.curvaBadge} ${CURVA_BADGE_CLASS[curva]}`}>{curva}</span>
                              <span className={styles.sectionTitle}>{CURVA_LABEL[curva]}</span>
                              <span className={styles.sectionCount}>{grupo.length} produtos</span>
                            </div>
                          </td>
                        </tr>
                        {grupo.map((p, i) => {
                          const rankGlobal = produtosComCurva.indexOf(p) + 1;
                          const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
                          const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
                          return (
                            <tr key={`${p.produto}-${p.categoria}`} className={curva !== "A" ? styles.rowDimmed : ""}>
                              <td>
                                <span className={`${styles.rank} ${i < 3 && curva === "A" ? styles.top : ""}`}>
                                  {rankGlobal}
                                </span>
                              </td>
                              <td>
                                <div className={styles.productNameRow}>
                                  <span className={styles.productName}>{p.descricao || p.produto}</span>
                                {(() => {
                                  const cmp = getComparisonBadge(p.vendas, p.vendasPrevious);
                                  if (!cmp) return null;
                                  const isPos = cmp.kind === "new" ? true : cmp.value >= 0;
                                  return (
                                    <span
                                      className={`${styles.prodCompareBadge} ${isPos ? styles.badgeGreen : styles.badgeRed}`}
                                      title={`Comparativo com ${comparisonLabel}`}
                                    >
                                      {cmp.kind === "new"
                                        ? "NOVO"
                                        : `${isPos ? "↑" : "↓"} ${isPos ? "+" : ""}${cmp.value.toFixed(1)}%`}
                                    </span>
                                  );
                                })()}
                                </div>
                                {((p.descricao && p.produto !== p.descricao) || p.categoria) && (
                                  <div className={styles.productMeta}>
                                    {p.descricao && p.produto !== p.descricao && (
                                      <span className={styles.productCode}>{p.produto}</span>
                                    )}
                                    {p.descricao && p.produto !== p.descricao && p.categoria && (
                                      <span className={styles.productMetaSeparator}>|</span>
                                    )}
                                    {p.categoria && (
                                      <span className={styles.productCategoria}>
                                        {getCategoryHeaderLabel(p.categoria)}
                                        {companyKey === "scarfme" && p.grade && (
                                          <>
                                            <span className={styles.productMetaSeparator}>•</span>
                                            <span className={styles.productGrade}>{p.grade}</span>
                                          </>
                                        )}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </td>
                              <td className={styles.percCell}>
                                <div className={styles.percBar}>
                                  <div className={styles.percBarTrack}>
                                    <div
                                      className={`${styles.percBarFill} ${CURVA_BAR_CLASS[curva]}`}
                                      style={{ width: `${Math.min(100, (p.percParticipacao / maxPerc) * 100)}%` }}
                                    />
                                  </div>
                                  <span className={styles.percText}>{p.percParticipacao.toFixed(1)}%</span>
                                </div>
                              </td>
                              <td className={styles.vendas}>{fmtBRL(p.vendas)}</td>
                              <td className={styles.vendas}>{fmt(p.qtde)}</td>
                              <td className={styles.vendas}>{markup !== null ? <span className={styles.markupBadge}>{markup.toFixed(2)}x</span> : <span className={styles.noData}>—</span>}</td>
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

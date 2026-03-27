"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { CompanyKey } from "@/lib/config/company";
import styles from "./FilialPerformancePage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ProdutoRow {
  produto: string;
  descricao: string;
  categoria: string;
  vendas: number;
  qtde: number;
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

const OUTROS_CATEGORIES = new Set([
  "CAPAS E ACESSORIOS P/ CEL",
  "HOME",
  "PAPELARIA",
  "ELETRONICOS",
  "PERFUMARIA",
  "SEDA PREMIUM",
]);
const OUTROS_LABEL = "OUTROS";
const OUTROS_TOOLTIP = `Composição do OUTROS:\n- ${Array.from(OUTROS_CATEGORIES).join("\n- ")}`;

const CATEGORY_COLORS = [
  "#1565c0", "#e65100", "#00695c", "#4527a0", "#ad1457",
  "#37474f", "#4e342e", "#1b5e20", "#00838f", "#6d4c41",
];

function getCategoryHeaderLabel(category: string): string {
  const normalized = category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  if (normalized.includes("APROVEITAMENTO") && normalized.includes("LENC")) return "Ap. Lenços";
  return category.toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
  filial: string;
  month: number;
  year: number;
  compare: "month" | "year";
}

export default function FilialPerformancePage({ companyKey, filial, month, year, compare }: Props) {
  const router = useRouter();
  const [data, setData] = useState<FilialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedCategory(null);
    const params = new URLSearchParams({
      company: companyKey,
      filial,
      month: String(month),
      year: String(year),
      compare,
    });
    fetch(`/api/controle-performance/filial?${params}`, { cache: "no-store" })
      .then(res => res.json())
      .then((json: FilialData & { error?: string }) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Erro desconhecido"))
      .finally(() => setLoading(false));
  }, [companyKey, filial, month, year, compare]);

  const displayedCategories = useMemo(() => {
    if (!data) return [];
    const outros = data.categoryList.filter(c => OUTROS_CATEGORIES.has(c));
    const remaining = data.categoryList.filter(c => !OUTROS_CATEGORIES.has(c));
    return outros.length > 0 ? [...remaining, OUTROS_LABEL] : remaining;
  }, [data]);

  // Resolve which raw categoria values match the selected display category
  const activeCategorias = useMemo((): Set<string> | null => {
    if (!selectedCategory || !data) return null;
    if (selectedCategory === OUTROS_LABEL) return OUTROS_CATEGORIES;
    return new Set([selectedCategory]);
  }, [selectedCategory, data]);

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

  const variationPct = data && data.vendasPrevious > 0
    ? ((data.vendas - data.vendasPrevious) / data.vendasPrevious) * 100
    : null;

  const salesPct = data?.projecaoPct ?? null;
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
      const entries = Array.from(OUTROS_CATEGORIES)
        .map(c => data.categories[c]?.pct)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (entries.length === 0) return null;
      return Math.round(entries.reduce((s, v) => s + v, 0) / entries.length);
    }
    const v = data.categories[cat]?.pct;
    return typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
  };

  const getCardCatDelta = (cat: string): number | null => {
    if (!data) return null;
    if (cat === OUTROS_LABEL) {
      const deltas = Array.from(OUTROS_CATEGORIES)
        .map(c => data.categories[c]?.deltaPct)
        .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (deltas.length === 0) return null;
      return deltas.reduce((s, v) => s + v, 0) / deltas.length;
    }
    const d = data.categories[cat]?.deltaPct;
    return typeof d === "number" && Number.isFinite(d) ? d : null;
  };

  const handleBadgeClick = (cat: string) => {
    setSelectedCategory(prev => prev === cat ? null : cat);
  };

  const comparisonLabel = compare === "month" ? "mês anterior" : "mesmo período do ano anterior";

  const monthName = data
    ? new Date(data.year, data.month, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" })
    : "";

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
              <p className={styles.subtitle}>
                Performance de vendas · {monthName}
              </p>
            </div>
          </div>
          <button type="button" className={styles.backButton} onClick={() => router.back()}>
            ← Voltar
          </button>
        </div>
      </div>

      {loading && <div className={styles.loading}>Carregando...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {!loading && data && (
        <>
          {/* KPI Cards */}
          <div className={styles.kpiCards}>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>VENDAS</span>
              <span className={styles.kpiValue}>{fmtCurrency(data.vendas)}</span>
              {variationPct !== null && (
                <span className={`${styles.variationBadge} ${variationPct >= 0 ? styles.variationPos : styles.variationNeg}`}>
                  {variationPct >= 0 ? "↗" : "↘"} {formatSignedPct(variationPct)}
                  <span className={styles.variationLabel}> vs {comparisonLabel}</span>
                </span>
              )}
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>META</span>
              <span className={styles.kpiValue}>{data.meta > 0 ? fmtCurrency(data.meta) : "—"}</span>
              {data.meta > 0 && salesPct !== null && (
                <span className={`${styles.projecaoBadge} ${salesPct >= 100 ? styles.badgeGreen : styles.badgeRed}`}>
                  {salesPct >= 100 ? "↗" : "↘"} {salesPct.toFixed(1)}% projetado
                </span>
              )}
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>PROJEÇÃO MÊS</span>
              <span className={styles.kpiValue}>{fmtCurrency(data.projecao)}</span>
              {data.meta > 0 && salesPct !== null && (
                <div className={styles.progressBarTrack}>
                  <div className={`${styles.progressBarFill} ${barClass}`} style={{ width: `${barPct}%` }} />
                </div>
              )}
              {data.meta > 0 && salesPct !== null && (
                <span className={`${styles.metaPct} ${metaPctClass}`}>{salesPct.toFixed(1)}% da meta</span>
              )}
            </div>
            <div className={styles.kpiCard}>
              <span className={styles.kpiLabel}>QTDE ITENS</span>
              <span className={styles.kpiValue}>{fmt(data.qtde)}</span>
            </div>
          </div>

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
              {displayedCategories.map((cat, idx) => {
                const pct = getCardCatPct(cat);
                const delta = getCardCatDelta(cat);
                if (pct === null) return null;
                const isActive = selectedCategory === cat;
                const isInactive = selectedCategory !== null && !isActive;
                const color = CATEGORY_COLORS[idx % CATEGORY_COLORS.length];
                const catPillTrendClass = isActive
                  ? styles.catPillActive
                  : delta === null
                    ? ""
                    : (delta >= 0 ? styles.catPillUp : styles.catPillDown);
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`${styles.catPill} ${catPillTrendClass} ${isInactive ? styles.catPillInactive : ""}`}
                    title={cat === OUTROS_LABEL ? OUTROS_TOOLTIP : `Filtrar ABC por ${cat}`}
                    onClick={() => handleBadgeClick(cat)}
                    style={!isActive ? {
                      backgroundColor: delta === null ? hexToRgba(color, 0.12) : undefined,
                      borderColor: delta === null ? hexToRgba(color, 0.35) : undefined,
                      color: delta === null ? color : undefined,
                    } : undefined}
                  >
                    {getCategoryHeaderLabel(cat)} {pct}%
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
                <span className={styles.summaryLabel}>Total produtos</span>
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
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Período</span>
                <span className={styles.summaryValueNeutral} style={{ fontSize: 14 }}>{monthName}</span>
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
                    <th className={styles.right}>Faturamento no período</th>
                    <th className={styles.right}>Qtd vendida</th>
                    <th className={styles.right}>Participação</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(curva => {
                    const grupo = produtosComCurva.filter(p => p.curva === curva);
                    if (grupo.length === 0) return null;
                    return (
                      <React.Fragment key={curva}>
                        <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                          <td colSpan={5}>
                            <div className={styles.sectionLabel}>
                              <span className={`${styles.curvaBadge} ${CURVA_BADGE_CLASS[curva]}`}>{curva}</span>
                              <span className={styles.sectionTitle}>{CURVA_LABEL[curva]}</span>
                              <span className={styles.sectionCount}>{grupo.length} produtos</span>
                              {curva === "A" && (
                                <span className={styles.sectionNote}>← maior impacto em vendas</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {grupo.map((p, i) => {
                          const rankGlobal = produtosComCurva.indexOf(p) + 1;
                          return (
                            <tr key={`${p.produto}-${p.categoria}`} className={curva !== "A" ? styles.rowDimmed : ""}>
                              <td>
                                <span className={`${styles.rank} ${i < 3 && curva === "A" ? styles.top : ""}`}>
                                  {rankGlobal}
                                </span>
                              </td>
                              <td>
                                <div className={styles.productName}>{p.descricao || p.produto}</div>
                                {p.descricao && p.produto !== p.descricao && (
                                  <div className={styles.productCode}>{p.produto}</div>
                                )}
                                {!selectedCategory && p.categoria && (
                                  <div className={styles.productCategoria}>{getCategoryHeaderLabel(p.categoria)}</div>
                                )}
                              </td>
                              <td className={styles.vendas}>{fmtBRL(p.vendas)}</td>
                              <td className={styles.vendas}>{fmt(p.qtde)}</td>
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

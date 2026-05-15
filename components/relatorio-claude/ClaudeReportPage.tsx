"use client";

import { useEffect, useMemo, useRef, useState, type RefObject } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter, { type MultiSelectOption } from "@/components/filters/MultiSelectFilter";
import { resolveCompany, VAREJO_VALUE, type CompanyKey } from "@/lib/config/company";
import { formatDateForQuery, getCurrentMonthRange } from "@/lib/utils/date";

import styles from "./ClaudeReportPage.module.css";

interface ShareRankingRow {
  label: string;
  revenue: number;
  quantity: number;
  skus: number;
  share: number;
  recentRevenue: number;
  recentShare: number;
  deltaPp: number;
}

interface CurveSummaryRow {
  curve: "A" | "B" | "C";
  skus: number;
  quantity: number;
  revenue: number;
  stock: number;
  share: number;
}

interface AbcItem {
  skuKey: string;
  product: string;
  description: string;
  line: string;
  subgrupo: string;
  tipoProduto: string;
  colecao: string;
  grade: string;
  cor: string;
  corDescricao: string;
  codigoBarra: string;
  revenue: number;
  quantity: number;
  stock: number;
  suggestion: number;
  curve: "A" | "B" | "C";
  rank: number;
  share: number;
  cumulativeShare: number;
}

interface BranchRankingRow {
  filial: string;
  operator: string;
  revenue: number;
  quantity: number;
  share: number;
}

interface BranchProfileRow {
  filial: string;
  revenue: number;
  growth: number;
  collections: string;
  color: string;
}

interface StockBucketRow {
  label: string;
  count: number;
  pct: number;
}

interface RecommendationRow {
  title: string;
  text: string;
}

interface StoryRow {
  title: string;
  text: string;
}

interface ChannelMixSummary {
  hasEcommerce: boolean;
  physicalRevenue: number;
  physicalUnits: number;
  physicalShare: number;
  physicalTicket: number;
  physicalActiveCount: number;
  ecommerceRevenue: number;
  ecommerceUnits: number;
  ecommerceShare: number;
  ecommerceTicket: number;
  ecommerceGrowth: number;
  note: string;
}

interface ClosingSummary {
  headline: string;
  body: string;
  badge: string;
}

interface ClaudeReportPayload {
  scopeLabel: string;
  gradeLabel: string;
  appliedFilters: {
    colecoes: string[];
    subgrupos: string[];
    grades: string[];
  };
  presentation: {
    badge: string;
    coverTitle: string;
    metaLine: string;
    summaryLead: string;
    performanceLead: string;
    closingLead: string;
  };
  range: {
    start: string;
    end: string;
    label: string;
    recentLabel: string;
    months: number;
  };
  summary: {
    totalRevenue: number;
    totalUnits: number;
    skuCount: number;
    activeStoreCount: number;
    retention: number;
    yoyNetwork: number;
    yoyLabel: string;
    monthProjected: number;
    monthProjectionYoy: number;
    monthActual: number;
    monthPrevious: number;
    monthCurrentLabel: string;
    monthPreviousLabel: string;
    stockTotal: number;
    coverageMonths: number;
    ruptureCount: number;
    openPurchaseCount: number;
  };
  curveSummary: CurveSummaryRow[];
  topCurveA: AbcItem[];
  yearSummary: Array<{
    year: number;
    revenue: number;
    quantity: number;
  }>;
  typeRanking: ShareRankingRow[];
  collectionRanking: ShareRankingRow[];
  colorRanking: ShareRankingRow[];
  subgroupRanking: ShareRankingRow[];
  branchRanking: BranchRankingRow[];
  branchProfiles: BranchProfileRow[];
  growthLabel: string;
  channelMix: ChannelMixSummary;
  stockBuckets: StockBucketRow[];
  ruptureTable: AbcItem[];
  purchaseByCurve: Array<{
    curve: "A" | "B" | "C";
    count: number;
  }>;
  warmingTypes: ShareRankingRow[];
  coolingCollections: ShareRankingRow[];
  movementTable: ShareRankingRow[];
  story: StoryRow[];
  closing: ClosingSummary;
  recommendations: RecommendationRow[];
}

interface ClaudeReportPageProps {
  companyKey: CompanyKey;
}

const DONUT_COLORS = ["#6D2E46", "#A86A74", "#ECE2D0", "#D4A373"];

function fmtCurrency(value: number, compact = false) {
  if (!compact) {
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }

  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    return `R$ ${(value / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1_000) {
    return `R$ ${(value / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  }
  return fmtCurrency(value);
}

function fmtInt(value: number) {
  return Math.round(value).toLocaleString("pt-BR");
}

function fmtPct(value: number, digits = 1, signed = false) {
  const signal = signed && value > 0 ? "+" : "";
  return `${signal}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function fmtPp(value: number) {
  const signal = value > 0 ? "+" : "";
  return `${signal}${value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}pp`;
}

function createEmptyRange(): DateRangeValue {
  const current = getCurrentMonthRange();
  return {
    startDate: current.start,
    endDate: current.end,
  };
}

function normalizeCoverText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .trim();
}

function formatCoverGradeLabel(value: string) {
  const trimmed = value.trim().toUpperCase();
  const match = trimmed.match(/^(\d+)\s*[Xx]\s*(\d+)$/);
  if (match) {
    return `${match[1]} × ${match[2]}`;
  }
  return trimmed || "MIX";
}

function inferSubgroupFamily(value: string) {
  const normalized = normalizeCoverText(value);

  if (normalized.includes("SEDA")) return "Seda";
  if (normalized.includes("POLIESTER")) return "Poliester";
  if (normalized.includes("VISCOSE")) return "Viscose";
  if (normalized.includes("ALGOD")) return "Algodao";
  if (normalized.includes("LINHO")) return "Linho";
  if (normalized.includes("CASHMERE")) return "Cashmere";
  if (normalized.includes("MODAL")) return "Modal";
  if (normalized.includes("ACRIL")) return "Acrilico";
  if (normalized.includes("LA ") || normalized.startsWith("LA") || normalized.includes(" LÃ")) return "La";
  if (normalized.includes("TRICOT")) return "Tricot";
  if (normalized.includes("MALHA")) return "Malha";
  if (normalized.includes("JERSEY")) return "Jersey";
  if (normalized.includes("VELUDO")) return "Veludo";
  if (normalized.includes("PASHMINA")) return "Pashmina";
  if (normalized.includes("CETIM")) return "Cetim";
  return value.trim() || "Mix";
}

function formatCoverSubgroupLabel(value: string) {
  return value.trim().toUpperCase();
}

function CoverIcon() {
  return (
    <div className={styles.coverIconCircle} aria-hidden="true">
      <svg viewBox="0 0 64 64" className={styles.coverIconSvg}>
        <path d="M22 24v-5c0-5.5 4.5-10 10-10s10 4.5 10 10v5h3c2.2 0 4 1.8 4 4v22c0 2.2-1.8 4-4 4H19c-2.2 0-4-1.8-4-4V28c0-2.2 1.8-4 4-4h3zm4 0h12v-5c0-3.3-2.7-6-6-6s-6 2.7-6 6v5zm-2 12a3 3 0 1 0 0 .1zm16 0a3 3 0 1 0 0 .1z" fill="currentColor" />
      </svg>
    </div>
  );
}

function BarList({
  rows,
  formatter,
}: {
  rows: Array<{ label: string; value: number }>;
  formatter: (value: number) => string;
}) {
  const maxValue = Math.max(...rows.map((row) => row.value), 1);

  return (
    <div className={styles.barList}>
      {rows.map((row) => (
        <div key={row.label} className={styles.barRow}>
          <div className={styles.barLabel}>{row.label}</div>
          <div className={styles.barTrack}>
            <div className={styles.barFill} style={{ width: `${(row.value / maxValue) * 100}%` }} />
          </div>
          <div className={styles.barValue}>{formatter(row.value)}</div>
        </div>
      ))}
    </div>
  );
}

function Donut({
  items,
  centerValue,
  centerLabel,
}: {
  items: Array<{ label: string; value: number; valueLabel: string; color: string }>;
  centerValue: string;
  centerLabel: string;
}) {
  const total = items.reduce((sum, item) => sum + Math.max(item.value, 0), 0);
  const gradient = items
    .reduce<{ cursor: number; slices: string[] }>((acc, item) => {
      const share = total > 0 ? (item.value / total) * 100 : 0;
      const slice = `${item.color} ${acc.cursor}% ${acc.cursor + share}%`;
      return {
        cursor: acc.cursor + share,
        slices: [...acc.slices, slice],
      };
    }, { cursor: 0, slices: [] })
    .slices.join(", ");

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut} style={{ background: `conic-gradient(${gradient || "#6D2E46"})` }}>
        <div className={styles.donutCenter}>
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className={styles.legend}>
        {items.map((item) => (
          <div key={item.label} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: item.color }} />
            {item.label} - {item.valueLabel}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReportView({
  report,
  deckRef,
}: {
  report: ClaudeReportPayload;
  deckRef?: RefObject<HTMLDivElement | null>;
}) {
  const curveAShare = report.curveSummary.find((row) => row.curve === "A")?.share ?? 0;
  const curveASkus = report.curveSummary.find((row) => row.curve === "A")?.skus ?? 0;
  const curveBPlusCUnits = report.curveSummary
    .filter((row) => row.curve !== "A")
    .reduce((sum, row) => sum + row.quantity, 0);
  const stockCurveA = report.curveSummary.find((row) => row.curve === "A")?.stock ?? 0;
  const stockCurveAShare = report.summary.stockTotal > 0 ? (stockCurveA / report.summary.stockTotal) * 100 : 0;
  const purchaseCurve = Object.fromEntries(report.purchaseByCurve.map((item) => [item.curve, item.count])) as Record<string, number>;
  const topStore = report.branchRanking[0] ?? null;
  const warmingCollections = report.collectionRanking.filter((row) => row.deltaPp > 0).slice(0, 2);
  const hasChannelView = report.channelMix.hasEcommerce && report.channelMix.ecommerceRevenue > 0 && report.channelMix.physicalRevenue > 0;
  const showSubgroupSlide = report.appliedFilters.subgrupos.length !== 1;
  const coverEyebrow = hasChannelView ? "Analise de produto - rede + e-com" : "Analise de produto - rede";
  const coverSubtitle = hasChannelView
    ? `Performance, curva ABC, tipos, colecoes, cores, ranking de filiais e desempenho do e-commerce - ${report.range.months} meses de dados (${report.range.label}).`
    : `Performance, curva ABC, tipos, colecoes, cores e ranking de filiais - ${report.range.months} meses de dados (${report.range.label}).`;
  const rankingLabel = hasChannelView ? "Ranking de canais" : "Ranking de filiais";
  const rankingTitle = hasChannelView
    ? `Onde ${report.presentation.performanceLead} mais performa`
    : `Onde ${report.presentation.performanceLead} mais performa`;
  const rankingSubtitle = hasChannelView
    ? "A leitura consolidada mostra o peso relativo de lojas e e-commerce dentro do recorte."
    : "A leitura fisica da rede mostra concentracao de faturamento e onde o mix tem maior alavanca comercial.";
  const profileEyebrow = hasChannelView ? "Perfil dos canais" : "Perfil das filiais";
  const profileTitle = hasChannelView ? "Cada operacao vende um mix diferente" : "Cada loja tem cara propria";
  const profileSubtitle = hasChannelView
    ? `Top 6 operacoes com suas colecoes e cores lideres - ${report.growthLabel}.`
    : `Top 6 filiais com suas colecoes e cores lideres - ${report.growthLabel}.`;
  const coverSubgroupsSource = (report.subgroupRanking.length > 0
    ? report.subgroupRanking.map((row) => row.label)
    : report.appliedFilters.subgrupos
  )
    .filter(Boolean)
    .slice(0, 4);
  const coverSubgroups = coverSubgroupsSource.length > 0 ? coverSubgroupsSource : ["Mix geral"];
  const subgroupFamilyRanking = new Map<string, number>();
  report.subgroupRanking.forEach((row) => {
    const family = inferSubgroupFamily(row.label);
    subgroupFamilyRanking.set(family, (subgroupFamilyRanking.get(family) ?? 0) + row.revenue);
  });
  const dominantFamily = Array.from(subgroupFamilyRanking.entries()).sort((a, b) => b[1] - a[1])[0]?.[0]
    ?? inferSubgroupFamily(coverSubgroups[0] ?? report.presentation.badge);
  const gradeLabel = formatCoverGradeLabel(report.gradeLabel);
  const physicalStoreLabel = `${report.channelMix.physicalActiveCount} ${report.channelMix.physicalActiveCount === 1 ? "loja" : "lojas"}`;
  const coverScopeLabel = hasChannelView
    ? `${physicalStoreLabel} + e-com`
    : report.summary.activeStoreCount > 0
      ? `${report.summary.activeStoreCount} ${report.summary.activeStoreCount === 1 ? "loja" : "lojas"}`
      : "rede";
  const hasFilters = report.appliedFilters.grades.length > 0 || report.appliedFilters.subgrupos.length > 0 || report.appliedFilters.colecoes.length > 0;
  const coverTitle = hasFilters
    ? `${dominantFamily}\nem ${coverScopeLabel}.`
    : `Performance Geral\nem ${coverScopeLabel}.`;
  const coverGradeDisplay = report.appliedFilters.grades.length === 0 ? "GERAL" : gradeLabel;
  const coverMeta = hasFilters
    ? [
        report.scopeLabel.toUpperCase(),
        `GRADE ${gradeLabel}`,
        dominantFamily.toUpperCase(),
        hasChannelView ? "LOJA + E-COMMERCE" : "LOJA",
      ].join(" · ")
    : [
        report.scopeLabel.toUpperCase(),
        hasChannelView ? "LOJA + E-COMMERCE" : "LOJA",
      ].join(" · ");
  const coverStatsLabel = hasChannelView
    ? `${physicalStoreLabel} + e-commerce`
    : `${report.summary.activeStoreCount} ${report.summary.activeStoreCount === 1 ? "loja ativa" : "lojas ativas"}`;

  return (
    <div ref={deckRef} className={styles.deck}>
      <section className={`${styles.slide} ${styles.cover}`} data-pdf-slide="">
        <div className={styles.coverLeft}>
          <div className={styles.coverLeftTop}>
            <CoverIcon />
            <div className={styles.coverKicker}>{hasChannelView ? "Rede + e-commerce" : "Rede"}</div>
          </div>
          <div className={styles.coverLeftCards}>
            <div className={styles.coverInfoCard}>
              <div className={styles.coverInfoLabel}>Categoria</div>
              <div className={styles.coverInfoValue}>{coverGradeDisplay}</div>
            </div>
            <div className={styles.coverSubgroupGroup}>
              <div className={styles.coverInfoLabel}>Subgrupo</div>
              {report.appliedFilters.subgrupos.length === 0 ? (
                <div className={styles.coverSubgroupCard}>GERAL</div>
              ) : (
                coverSubgroups.map((label) => (
                  <div key={label} className={styles.coverSubgroupCard}>
                    {formatCoverSubgroupLabel(label)}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className={styles.coverBottom}>Buying · Inventory Analytics</div>
        </div>
        <div className={styles.coverRight}>
          <div className={styles.coverHeader}>
            <div className={styles.brand}>SCARF<span>.</span>ME</div>
            <div className={styles.eyebrow}>{coverEyebrow}</div>
          </div>
          <h1>{coverTitle}</h1>
          <p className={styles.subtitle}>{coverSubtitle}</p>
          <div className={styles.coverLine} />
          <div className={styles.coverMeta}>{coverMeta}</div>
          <div className={styles.coverStats}>
            {fmtCurrency(report.summary.totalRevenue, true)} - {fmtInt(report.summary.totalUnits)} unidades - {coverStatsLabel}
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Resumo executivo</div>
        <h1>O que dizem os {report.range.months} meses da rede</h1>
        <p className={styles.subtitle}>
          {report.presentation.summaryLead} soma {fmtCurrency(report.summary.totalRevenue)} no periodo {report.range.label}. A rede cresce, mas o catalogo gira mais do que parece.
        </p>
        <div className={`${styles.statGrid} ${styles.four}`}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{fmtCurrency(report.summary.totalRevenue, true)}</div>
            <div className={styles.statLabel}>Faturamento - {report.range.months} meses</div>
            <div className={styles.statNote}>{fmtInt(report.summary.totalUnits)} unidades vendidas</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{fmtInt(report.summary.skuCount)}</div>
            <div className={styles.statLabel}>SKUs com venda no periodo</div>
            <div className={styles.statNote}>{fmtInt(curveASkus)} SKUs em Curva A</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{fmtPct(curveAShare)}</div>
            <div className={styles.statLabel}>do faturamento vem da Curva A</div>
            <div className={styles.statNote}>{fmtInt(curveASkus)} SKUs lideres</div>
          </div>
          <div className={`${styles.statCard} ${styles.accentGreen}`}>
            <div className={styles.statValue}>{fmtPct(report.summary.yoyNetwork, 1, true)}</div>
            <div className={styles.statLabel}>{report.summary.yoyLabel}</div>
            <div className={styles.statNote}>retencao Curva A: {fmtPct(report.summary.retention)}</div>
          </div>
        </div>
        <div className={styles.insightStrip}>
          A rede vende bem, mas so {fmtPct(report.summary.retention)} dos itens Curva A do periodo total permanecem A na janela recente {report.range.recentLabel}.
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Curva ABC</div>
        <h1>A concentracao se mantem - em escala maior</h1>
        <p className={styles.subtitle}>
          No periodo {report.range.label}, a Curva A responde por {fmtPct(curveAShare)} do faturamento.
        </p>
        <div className={styles.twoCol}>
          <Donut
            items={report.curveSummary.map((row, index) => ({
              label: `Curva ${row.curve}`,
              value: row.share,
              valueLabel: fmtPct(row.share),
              color: DONUT_COLORS[index] ?? DONUT_COLORS[0],
            }))}
            centerValue={fmtPct(curveAShare, 0)}
            centerLabel="Curva A"
          />
          <div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Curva</th>
                  <th>SKUs</th>
                  <th>Qtd</th>
                  <th>Faturamento</th>
                  <th>% Total</th>
                </tr>
              </thead>
              <tbody>
                {report.curveSummary.map((row) => (
                  <tr key={row.curve}>
                    <td>{row.curve}</td>
                    <td>{fmtInt(row.skus)}</td>
                    <td>{fmtInt(row.quantity)}</td>
                    <td>{fmtCurrency(row.revenue)}</td>
                    <td>{fmtPct(row.share)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className={styles.miniCallout}>
              <strong>{fmtInt(curveASkus)} SKUs Curva A</strong> concentram {fmtPct(curveAShare)} das vendas.
            </div>
            <div className={styles.miniCallout}>
              <strong>{fmtInt(report.curveSummary.find((row) => row.curve === "A")?.quantity ?? 0)} unidades</strong> vendidas em Curva A no periodo.
            </div>
            <div className={styles.miniCallout}>
              <strong>{fmtInt(curveBPlusCUnits)} unidades B+C</strong> confirmam cauda longa ativa.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Top 10 Curva A</div>
        <h1>Os SKUs que sustentam o catalogo</h1>
        <p className={styles.subtitle}>Ranking por faturamento no periodo {report.range.label}.</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>Produto</th>
              <th>Cor</th>
              <th>Unidades</th>
              <th>Faturamento</th>
              <th>Estoque</th>
            </tr>
          </thead>
          <tbody>
            {report.topCurveA.map((row) => (
              <tr key={row.skuKey}>
                <td>{String(row.rank).padStart(2, "0")}</td>
                <td>{row.description}</td>
                <td>{row.corDescricao || row.cor || "-"}</td>
                <td>{fmtInt(row.quantity)}</td>
                <td>{fmtCurrency(row.revenue)}</td>
                <td>
                  <span
                    className={`${styles.pill} ${
                      row.stock > 5 ? styles.pillGreen : row.stock <= 0 ? styles.pillRed : styles.pillOrange
                    }`}
                  >
                    {fmtInt(row.stock)} un.
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={styles.warningNote}>
          {fmtInt(report.summary.ruptureCount)} SKUs ativos estao em ruptura no consolidado.
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Comparativo anual</div>
        <h1>2024 vs 2025 vs 2026 - a tendencia da rede</h1>
        <p className={styles.subtitle}>
          O comparativo anual mostra ritmo de crescimento, enquanto {report.summary.monthCurrentLabel} ajuda a ler a velocidade mais recente desse recorte.
        </p>
        <div className={styles.yearGrid}>
          {report.yearSummary.slice(-3).map((row, index) => (
            <div
              key={row.year}
              className={`${styles.yearCard} ${
                index === 0 ? styles.yearSoft : index === 1 ? styles.yearLight : styles.yearDark
              }`}
            >
              <div className={styles.yearLabel}>{row.year}</div>
              <div className={styles.yearNote}>ano consolidado</div>
              <div className={styles.yearValue}>{fmtCurrency(row.revenue, true)}</div>
              <div className={styles.yearUnits}>{fmtInt(row.quantity)} unidades</div>
            </div>
          ))}
        </div>
        <div className={styles.compareBox}>
          <div>
            <div className={styles.compareTitle}>
              {report.summary.monthPreviousLabel} vs {report.summary.monthCurrentLabel}
            </div>
            <div className={styles.compareBars}>
              <div className={styles.compareBarRow}>
                <span>{report.summary.monthCurrentLabel} projetado</span>
                <div className={styles.compareTrack}>
                  <div className={styles.compareFill} style={{ width: "100%" }} />
                </div>
                <strong>{fmtCurrency(report.summary.monthProjected)}</strong>
              </div>
              <div className={styles.compareBarRow}>
                <span>{report.summary.monthPreviousLabel} realizado</span>
                <div className={styles.compareTrack}>
                  <div
                    className={`${styles.compareFill} ${styles.compareMuted}`}
                    style={{
                      width: `${report.summary.monthProjected > 0
                        ? (report.summary.monthPrevious / report.summary.monthProjected) * 100
                        : 0}%`,
                    }}
                  />
                </div>
                <strong>{fmtCurrency(report.summary.monthPrevious)}</strong>
              </div>
            </div>
          </div>
          <div className={styles.compareBadge}>{fmtPct(report.summary.monthProjectionYoy, 1, true)} YoY</div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Ranking por tipo</div>
        <h1>Quais estampas puxam o catalogo</h1>
        <p className={styles.subtitle}>A leitura abaixo combina participacao total e movimento na janela recente {report.range.recentLabel}.</p>
        <div className={`${styles.twoCol} ${styles.wideRight}`}>
          <BarList rows={report.typeRanking.slice(0, 14).map((row) => ({ label: row.label, value: row.revenue }))} formatter={(value) => fmtCurrency(value)} />
          <div>
            <div className={styles.podiumList}>
              {report.typeRanking.slice(0, 3).map((row, index) => (
                <div key={row.label} className={styles.podiumCard}>
                  <div className={styles.podiumRank}>#{index + 1}</div>
                  <div className={styles.podiumBody}>
                    <div className={styles.podiumTitle}>{row.label}</div>
                    <div className={styles.podiumSubtitle}>{fmtCurrency(row.revenue)} - {fmtInt(row.skus)} SKUs</div>
                    <div className={styles.podiumNote}>{fmtPct(row.share)} da rede</div>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.insightBox}>
              Top 3 tipos somam {fmtPct(report.typeRanking.slice(0, 3).reduce((sum, row) => sum + row.share, 0))} do faturamento da rede.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Ranking por colecao</div>
        <h1>Quais lancamentos sustentam a receita</h1>
        <p className={styles.subtitle}>A curva recente mostra quais colecoes ainda carregam caixa e quais comecam a perder folego.</p>
        <div className={`${styles.twoCol} ${styles.wideRight}`}>
          <BarList rows={report.collectionRanking.slice(0, 12).map((row) => ({ label: row.label, value: row.revenue }))} formatter={(value) => fmtCurrency(value)} />
          <div>
            <div className={styles.podiumList}>
              {report.collectionRanking.slice(0, 3).map((row, index) => (
                <div key={row.label} className={styles.podiumCard}>
                  <div className={styles.podiumRank}>#{index + 1}</div>
                  <div className={styles.podiumBody}>
                    <div className={styles.podiumTitle}>{row.label}</div>
                    <div className={styles.podiumSubtitle}>{fmtCurrency(row.revenue)} - {fmtInt(row.skus)} SKUs</div>
                    <div className={styles.podiumNote}>{fmtPct(row.share)} da rede</div>
                  </div>
                </div>
              ))}
            </div>
            <div className={`${styles.insightStrip} ${styles.small}`}>
              Esquentando: {warmingCollections.map((row) => `${row.label} (${fmtPp(row.deltaPp)})`).join(", ") || "sem destaque claro"}.
            </div>
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Ranking por cor</div>
        <h1>A paleta que move a rede</h1>
        <p className={styles.subtitle}>As cores abaixo mostram onde a grade aceita profundidade e onde vale reduzir risco de compra.</p>
        <div className={`${styles.twoCol} ${styles.wideRight}`}>
          <BarList rows={report.colorRanking.slice(0, 14).map((row) => ({ label: row.label, value: row.revenue }))} formatter={(value) => fmtCurrency(value)} />
          <div>
            <div className={styles.podiumList}>
              {report.colorRanking.slice(0, 3).map((row, index) => (
                <div key={row.label} className={styles.podiumCard}>
                  <div className={styles.podiumRank}>#{index + 1}</div>
                  <div className={styles.podiumBody}>
                    <div className={styles.podiumTitle}>{row.label}</div>
                    <div className={styles.podiumSubtitle}>{fmtCurrency(row.revenue)} - {fmtInt(row.skus)} SKUs</div>
                    <div className={styles.podiumNote}>{fmtPct(row.share)} da rede</div>
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.insightBox}>
              Top 3 cores somam {fmtPct(report.colorRanking.slice(0, 3).reduce((sum, row) => sum + row.share, 0))} do faturamento.
            </div>
          </div>
        </div>
      </section>

      {showSubgroupSlide ? (
        <section className={styles.slide} data-pdf-slide="">
          <div className={styles.eyebrow}>Ranking por subgrupo</div>
          <h1>A composicao material da rede</h1>
          <p className={styles.subtitle}>Subgrupos ajudam a separar o que sustenta volume, o que sustenta ticket e onde existe risco de concentracao.</p>
          <div className={styles.twoCol}>
            <Donut
              items={report.subgroupRanking.slice(0, 4).map((row, index) => ({
                label: row.label,
                value: row.share,
                valueLabel: fmtPct(row.share),
                color: DONUT_COLORS[index] ?? DONUT_COLORS[0],
              }))}
              centerValue={report.subgroupRanking[0] ? fmtPct(report.subgroupRanking[0].share, 0) : "0%"}
              centerLabel={report.subgroupRanking[0]?.label ?? "Subgrupo"}
            />
            <div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Subgrupo</th>
                    <th>SKUs</th>
                    <th>Qtd</th>
                    <th>Fat R$</th>
                    <th>Ticket Md</th>
                  </tr>
                </thead>
                <tbody>
                  {report.subgroupRanking.slice(0, 4).map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{fmtInt(row.skus)}</td>
                      <td>{fmtInt(row.quantity)}</td>
                      <td>{fmtCurrency(row.revenue)}</td>
                      <td>{fmtCurrency(row.quantity > 0 ? row.revenue / row.quantity : 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className={`${styles.insightStrip} ${styles.small}`}>
                Leitura de negocio: combinar subgrupos de volume com subgrupos de ticket e o que sustenta margem sem perder giro.
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {hasChannelView ? (
        <section className={styles.slide} data-pdf-slide="">
          <div className={styles.eyebrow}>Escopo e canais</div>
          <h1>Loja fisica e e-commerce contam historias diferentes</h1>
          <p className={styles.subtitle}>
            Este recorte soma rede fisica e digital. O bloco abaixo separa peso, ticket e relevancia operacional de cada canal antes de abrir o ranking.
          </p>
          <div className={styles.scopeGrid}>
            <div className={styles.scopeHero}>
              <div className={styles.scopeAmount}>{fmtCurrency(report.summary.totalRevenue, true)}</div>
              <div className={styles.scopeLabel}>Loja + e-com no recorte</div>
              <div className={styles.scopeMeta}>{fmtInt(report.summary.totalUnits)} unidades - {report.range.months} meses</div>
              <div className={styles.scopeNarrative}>{report.channelMix.note}</div>
            </div>
            <div className={styles.scopeCard}>
              <div className={styles.scopeCardTitle}>Loja fisica</div>
              <div className={styles.scopeCardValue}>{fmtCurrency(report.channelMix.physicalRevenue, true)}</div>
              <div className={styles.scopeCardLine}>{fmtInt(report.channelMix.physicalUnits)} un. - {fmtPct(report.channelMix.physicalShare)} do total</div>
              <div className={styles.scopeCardLine}>Ticket medio {fmtCurrency(report.channelMix.physicalTicket)} - {report.channelMix.physicalActiveCount} filiais ativas</div>
            </div>
            <div className={`${styles.scopeCard} ${styles.scopeCardAccent}`}>
              <div className={styles.scopeCardTitle}>E-commerce</div>
              <div className={styles.scopeCardValue}>{fmtCurrency(report.channelMix.ecommerceRevenue, true)}</div>
              <div className={styles.scopeCardLine}>{fmtInt(report.channelMix.ecommerceUnits)} un. - {fmtPct(report.channelMix.ecommerceShare)} do total</div>
              <div className={styles.scopeCardLine}>Ticket medio {fmtCurrency(report.channelMix.ecommerceTicket)} - variacao {fmtPct(report.channelMix.ecommerceGrowth, 1, true)}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>{rankingLabel}</div>
        <h1>{rankingTitle}</h1>
        <p className={styles.subtitle}>{rankingSubtitle}</p>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>{hasChannelView ? "Canal / operacao" : "Filial"}</th>
              <th>Operador</th>
              <th>Faturamento</th>
              <th>Unidades</th>
              <th>% Rede</th>
              <th>Partic.</th>
            </tr>
          </thead>
          <tbody>
            {report.branchRanking.slice(0, 11).map((row, index) => (
              <tr key={row.filial}>
                <td>{String(index + 1).padStart(2, "0")}</td>
                <td>{row.filial}</td>
                <td>{row.operator || "-"}</td>
                <td>{fmtCurrency(row.revenue)}</td>
                <td>{fmtInt(row.quantity)}</td>
                <td>{fmtPct(row.share)}</td>
                <td>
                  <div className={styles.microBar}>
                    <span style={{ width: `${topStore ? (row.share / topStore.share) * 100 : 0}%` }} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`${styles.insightStrip} ${styles.small}`}>
          Top 3 operacoes concentram {fmtPct(report.branchRanking.slice(0, 3).reduce((sum, row) => sum + row.share, 0))} da rede consolidada.
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>{profileEyebrow}</div>
        <h1>{profileTitle}</h1>
        <p className={styles.subtitle}>{profileSubtitle}</p>
        <div className={styles.profileGrid}>
          {report.branchProfiles.map((row) => (
            <div key={row.filial} className={styles.profileCard}>
              <div className={styles.profileTop}>
                <div className={styles.profileStore}>{row.filial}</div>
                <div className={styles.profileValue}>{fmtCurrency(row.revenue, true)}</div>
              </div>
              <div className={styles.profileMetaLabel}>Crescimento</div>
              <div className={styles.profileMeta}>{fmtPct(row.growth, 1, true)}</div>
              <div className={styles.profileMetaLabel}>Colecoes lideres</div>
              <div className={styles.profileMeta}>{row.collections}</div>
              <div className={styles.profileMetaLabel}>Cor lider</div>
              <div className={`${styles.profileMeta} ${styles.profileColor}`}>{row.color}</div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Estoque atual</div>
        <h1>O total da rede e suficiente?</h1>
        <p className={styles.subtitle}>A rede tem {fmtInt(report.summary.stockTotal)} unidades em estoque ativo. O desafio nao e volume agregado; e distribuicao.</p>
        <div className={`${styles.statGrid} ${styles.three}`}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{fmtInt(report.summary.stockTotal)}</div>
            <div className={styles.statLabel}>Unidades em estoque ativo</div>
            <div className={styles.statNote}>itens com historico de venda</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>{report.summary.coverageMonths.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m</div>
            <div className={styles.statLabel}>Cobertura media</div>
            <div className={styles.statNote}>ritmo medio do periodo</div>
          </div>
          <div className={`${styles.statCard} ${styles.accentTerracotta}`}>
            <div className={styles.statValue}>{fmtInt(report.summary.ruptureCount)}</div>
            <div className={styles.statLabel}>SKUs ativos em ruptura</div>
            <div className={styles.statNote}>estoque 0 com venda historica</div>
          </div>
        </div>
        <div className={styles.stockLayout}>
          <div className={styles.vbarChart}>
            {report.curveSummary.map((row) => (
              <div key={row.curve} className={styles.vbarCol}>
                <div className={styles.vbarValue}>{fmtInt(row.stock)}</div>
                <div className={styles.vbarBar} style={{ height: `${report.summary.stockTotal > 0 ? (row.stock / report.summary.stockTotal) * 180 : 12}px` }} />
                <div className={styles.vbarLabel}>Curva {row.curve}</div>
              </div>
            ))}
          </div>
          <div className={styles.diagnosticBox}>
            <div className={styles.diagTitle}>Diagnostico</div>
            <p><strong>{fmtPct(stockCurveAShare, 0)}</strong> do estoque esta em Curva A.</p>
            <p>Mas <strong>{fmtInt(report.summary.ruptureCount)} SKUs</strong> seguem em ruptura, pressionando venda real.</p>
            <p><strong>Conclusao:</strong> volume agregado existe; o mix operacional precisa de reposicao mais fina.</p>
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Gargalos de reposicao</div>
        <h1>{fmtInt(report.summary.openPurchaseCount)} SKUs com sugestao de compra aberta</h1>
        <p className={styles.subtitle}>Os alertas abaixo separam o problema por curva e destacam os itens mais sensiveis da rede.</p>
        <div className={`${styles.statGrid} ${styles.three}`}>
          <div className={`${styles.statCard} ${styles.accentTerracotta}`}>
            <div className={styles.statValue}>{fmtInt(purchaseCurve.A ?? 0)}</div>
            <div className={styles.statLabel}>Curva A com sugestao</div>
            <div className={styles.statNote}>prioridade maxima</div>
          </div>
          <div className={`${styles.statCard} ${styles.accentGold}`}>
            <div className={styles.statValue}>{fmtInt(purchaseCurve.B ?? 0)}</div>
            <div className={styles.statLabel}>Curva B com sugestao</div>
            <div className={styles.statNote}>alertas de continuidade</div>
          </div>
          <div className={`${styles.statCard} ${styles.accentRose}`}>
            <div className={styles.statValue}>{fmtInt(purchaseCurve.C ?? 0)}</div>
            <div className={styles.statLabel}>Curva C com sugestao</div>
            <div className={styles.statNote}>cauda com demanda</div>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th>Tipo</th>
              <th>Colecao</th>
              <th>Vendeu periodo</th>
            </tr>
          </thead>
          <tbody>
            {report.ruptureTable.slice(0, 6).map((row) => (
              <tr key={row.skuKey}>
                <td>{row.description}</td>
                <td>{row.corDescricao || row.cor || "-"}</td>
                <td>{row.tipoProduto || "-"}</td>
                <td>{row.colecao || "-"}</td>
                <td>{fmtInt(row.quantity)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Detalhamento de rupturas</div>
        <h1>O mapa completo do estoque em risco</h1>
        <p className={styles.subtitle}>{fmtInt(report.summary.ruptureCount)} SKUs ativos em ruptura e {fmtInt(curveASkus)} itens A exigem leitura de impacto.</p>
        <div className={`${styles.twoCol} ${styles.riskLayout}`}>
          <div>
            <div className={styles.bucketList}>
              {report.stockBuckets.map((row) => (
                <div key={row.label} className={styles.bucketRow}>
                  <div className={styles.bucketLabel}>{row.label}</div>
                  <div>{fmtInt(row.count)}</div>
                  <div className={styles.bucketTrack}>
                    <div className={styles.bucketFill} style={{ width: `${row.pct}%` }} />
                  </div>
                  <div className={styles.bucketPct}>{fmtPct(row.pct)}</div>
                </div>
              ))}
            </div>
            <div className={styles.impactBox}>
              <div className={styles.impactItem}>
                <strong>{fmtInt(report.ruptureTable.length)}</strong>
                <span>SKUs A em ruptura</span>
              </div>
              <div className={styles.impactItem}>
                <strong>{fmtCurrency(report.ruptureTable.reduce((sum, row) => sum + row.revenue, 0), true)}</strong>
                <span>faturamento historico</span>
              </div>
              <div className={styles.impactItem}>
                <strong>{fmtInt(report.ruptureTable.reduce((sum, row) => sum + row.quantity, 0))}</strong>
                <span>unidades vendidas</span>
              </div>
            </div>
          </div>
          <div>
            <table className={`${styles.table} ${styles.compact}`}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Produto</th>
                  <th>Cor</th>
                  <th>Qtd</th>
                  <th>Fat R$</th>
                  <th>Sug</th>
                </tr>
              </thead>
              <tbody>
                {report.ruptureTable.slice(0, 20).map((row, index) => (
                  <tr key={row.skuKey}>
                    <td>{String(index + 1).padStart(2, "0")}</td>
                    <td>{row.description}</td>
                    <td>{row.corDescricao || row.cor || "-"}</td>
                    <td>{fmtInt(row.quantity)}</td>
                    <td>{fmtCurrency(row.revenue)}</td>
                    <td>{fmtInt(row.suggestion)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Drift de curva</div>
        <h1>Como o catalogo se move entre janelas</h1>
        <p className={styles.subtitle}>So {fmtPct(report.summary.retention)} dos itens Curva A do periodo total permanecem A na janela recente {report.range.recentLabel}.</p>
        <div className={styles.driftBanner}>
          <div className={styles.driftHero}>Rotacao alta no topo</div>
          <div>A retencao da Curva A ajuda a separar sazonalidade saudavel de perda de forca estrutural.</div>
        </div>
        <div className={styles.driftGrid}>
          <div className={styles.driftCard}>
            <div className={styles.driftTitle}>Esquentando - tipos</div>
            <div className={styles.driftMain}>{report.warmingTypes.map((row) => row.label).join(" · ") || "Sem destaque"}</div>
            <div className={styles.driftNote}>{report.warmingTypes.map((row) => fmtPp(row.deltaPp)).join(" · ") || "0,0pp"}</div>
          </div>
          <div className={`${styles.driftCard} ${styles.terracotta}`}>
            <div className={styles.driftTitle}>Esfriando - colecoes</div>
            <div className={styles.driftMain}>{report.coolingCollections.map((row) => row.label).join(" · ") || "Sem destaque"}</div>
            <div className={styles.driftNote}>{report.coolingCollections.map((row) => fmtPp(row.deltaPp)).join(" · ") || "0,0pp"}</div>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Periodo total</th>
              <th>Recente</th>
              <th>Variacao</th>
              <th>Tendencia</th>
            </tr>
          </thead>
          <tbody>
            {report.movementTable.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{fmtPct(row.share)}</td>
                <td>{fmtPct(row.recentShare)}</td>
                <td>{fmtPp(row.deltaPp)}</td>
                <td>{row.deltaPp > 0 ? "▲" : "▼"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>A historia em 5 atos</div>
        <h1>O que os dados realmente contam</h1>
        <p className={styles.subtitle}>Sintese executiva para leitura rapida do negocio.</p>
        <div className={styles.storyList}>
          {report.story.map((row, index) => (
            <div key={row.title} className={styles.storyRow}>
              <div className={`${styles.storyIndex} ${index === 4 ? styles.storyHighlight : ""}`}>{String(index + 1).padStart(2, "0")}</div>
              <div className={styles.storyCard}>
                <div className={styles.storyTitle}>{row.title}</div>
                <div className={styles.storyText}>{row.text}</div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={`${styles.slide} ${styles.closing}`} data-pdf-slide="">
        <div className={styles.closingLeft}>
          <div className={styles.eyebrow}>Conclusao</div>
          <h2>{report.closing.headline}</h2>
          <p>{report.closing.body}</p>
          <div className={styles.validated}>{report.closing.badge}</div>
        </div>
        <div className={styles.closingRight}>
          <div className={styles.eyebrow}>Proximos passos</div>
          <h1>Recomendacoes praticas</h1>
          <div className={styles.recommendList}>
            {report.recommendations.map((row, index) => (
              <div key={row.title} className={styles.recommendCard}>
                <div className={styles.recommendIndex}>{String(index + 1).padStart(2, "0")}</div>
                <div>
                  <div className={styles.recommendTitle}>{row.title}</div>
                  <div className={styles.recommendText}>{row.text}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

export default function ClaudeReportPage({ companyKey }: ClaudeReportPageProps) {
  const [ranges, setRanges] = useState<DateRangeValue[]>([createEmptyRange()]);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<MultiSelectOption[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);
  const [loadingColecoes, setLoadingColecoes] = useState(false);
  const [loadingSubgrupos, setLoadingSubgrupos] = useState(false);
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [reports, setReports] = useState<ClaudeReportPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeReportIndex, setActiveReportIndex] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const deckRef = useRef<HTMLDivElement | null>(null);
  const allowedFiliais = useMemo(() => {
    const company = resolveCompany(companyKey);
    if (!company) {
      return null;
    }

    const excluded = new Set(["SCARF ME - MATRIZ", "SCARFME - IBIRAPUERA LLL"]);
    return company.filialFilters.sales.filter((filial) => !excluded.has(filial));
  }, [companyKey]);

  const envelopeRange = useMemo(() => {
    const starts = ranges.map((range) => range.startDate.getTime());
    const ends = ranges.map((range) => range.endDate.getTime());
    return {
      startDate: new Date(Math.min(...starts)),
      endDate: new Date(Math.max(...ends)),
    };
  }, [ranges]);

  async function loadFilterOptions(kind: "colecoes" | "subgrupos" | "grades") {
    const params = new URLSearchParams({
      company: companyKey,
      start: formatDateForQuery(envelopeRange.startDate),
      end: formatDateForQuery(envelopeRange.endDate),
    });

    if (kind === "colecoes") {
      params.set("includeDescriptions", "1");
    }

    if (selectedFilial) {
      params.set("filial", selectedFilial);
    }

    selectedColecoes.forEach((item) => params.append("colecoes", item));
    selectedSubgrupos.forEach((item) => params.append("subgrupos", item));
    selectedGrades.forEach((item) => params.append("grades", item));

    if (kind === "colecoes") {
      setLoadingColecoes(true);
    } else if (kind === "subgrupos") {
      setLoadingSubgrupos(true);
    } else {
      setLoadingGrades(true);
    }

    try {
      const response = await fetch(`/api/products/${kind}?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Erro ao carregar ${kind}`);
      }
      const json = (await response.json()) as { data?: string[] | MultiSelectOption[] };
      const values = json.data ?? [];
      if (kind === "colecoes") {
        setAvailableColecoes(values as MultiSelectOption[]);
      } else if (kind === "subgrupos") {
        setAvailableSubgrupos(values as string[]);
      } else {
        setAvailableGrades(values as string[]);
      }
    } catch {
      if (kind === "colecoes") {
        setAvailableColecoes([]);
      } else if (kind === "subgrupos") {
        setAvailableSubgrupos([]);
      } else {
        setAvailableGrades([]);
      }
    } finally {
      if (kind === "colecoes") {
        setLoadingColecoes(false);
      } else if (kind === "subgrupos") {
        setLoadingSubgrupos(false);
      } else {
        setLoadingGrades(false);
      }
    }
  }

  async function generateReport() {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/relatorio-claude", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          company: companyKey,
          filial: selectedFilial,
          colecoes: selectedColecoes,
          subgrupos: selectedSubgrupos,
          grades: selectedGrades,
          ranges: ranges.map((range) => ({
            start: formatDateForQuery(range.startDate),
            end: formatDateForQuery(range.endDate),
          })),
        }),
      });

      const json = (await response.json()) as { data?: ClaudeReportPayload[]; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Erro ao carregar Relatorio Claude.");
      }

      setReports(json.data ?? []);
      setActiveReportIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar Relatorio Claude.");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleExportPdf() {
    const activeReport = reports[activeReportIndex];
    const deckElement = deckRef.current;
    if (!activeReport || !deckElement) {
      return;
    }

    const slideElements = Array.from(deckElement.querySelectorAll<HTMLElement>("[data-pdf-slide]"));
    if (slideElements.length === 0) {
      return;
    }

    setExportingPdf(true);

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvases: HTMLCanvasElement[] = [];

      for (const slideElement of slideElements) {
        const canvas = await html2canvas(slideElement, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
          logging: false,
          windowWidth: 1440,
          windowHeight: 900,
          onclone: (cloneDoc) => {
            cloneDoc.querySelectorAll("[data-pdf-hide]").forEach((element) => {
              (element as HTMLElement).style.display = "none";
            });

            cloneDoc.querySelectorAll<HTMLElement>("[data-pdf-slide]").forEach((element) => {
              element.style.width = "1280px";
              element.style.minHeight = "720px";
              element.style.margin = "0";
            });
          },
        });

        canvases.push(canvas);
      }

      const firstCanvas = canvases[0];
      if (!firstCanvas) {
        return;
      }

      const pageWidthMm = 297;
      const pageHeightMm = (firstCanvas.height * pageWidthMm) / firstCanvas.width;
      const doc = new jsPDF({
        orientation: pageWidthMm >= pageHeightMm ? "landscape" : "portrait",
        unit: "mm",
        format: [pageWidthMm, pageHeightMm],
      });

      canvases.forEach((canvas, index) => {
        if (index > 0) {
          doc.addPage([pageWidthMm, pageHeightMm], pageWidthMm >= pageHeightMm ? "landscape" : "portrait");
        }

        doc.addImage(
          canvas.toDataURL("image/png"),
          "PNG",
          0,
          0,
          pageWidthMm,
          pageHeightMm,
          undefined,
          "FAST",
        );
      });

      const safeName = `relatorio-claude-${activeReport.range.start}-${activeReport.range.end}`
        .replace(/[^\w\-]+/g, "_")
        .slice(0, 100);
      doc.save(`${safeName}.pdf`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  useEffect(() => {
    void generateReport();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const availableSet = new Set(availableColecoes.map((item) => item.value));
    setSelectedColecoes((current) => current.filter((item) => availableSet.has(item)));
  }, [availableColecoes]);

  useEffect(() => {
    setSelectedSubgrupos((current) => current.filter((item) => availableSubgrupos.includes(item)));
  }, [availableSubgrupos]);

  useEffect(() => {
    setSelectedGrades((current) => current.filter((item) => availableGrades.includes(item)));
  }, [availableGrades]);

  useEffect(() => {
    if (!selectedFilial || !allowedFiliais) {
      return;
    }

    if (selectedFilial === VAREJO_VALUE) {
      return;
    }

    const allowedSet = new Set(allowedFiliais.map((filial) => filial.trim().toUpperCase()));
    if (!allowedSet.has(selectedFilial.trim().toUpperCase())) {
      setSelectedFilial(null);
    }
  }, [allowedFiliais, selectedFilial]);

  return (
    <div className={styles.page}>
      <div className={styles.controlsCard}>
        <div className={styles.headerRow}>
          <div>
            <div className={styles.pageEyebrow}>ScarfMe - Analise nativa</div>
            <h1 className={styles.pageTitle}>Relatorio Claude</h1>
            <p className={styles.pageSubtitle}>
              Mesmo espirito visual do HTML gerado no Python, agora direto na dashboard com filtros dinamicos e multiplos periodos.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleExportPdf()}
              disabled={loading || exportingPdf || !reports[activeReportIndex]}
            >
              {exportingPdf ? "Exportando PDF..." : "Exportar PDF"}
            </button>
            <button type="button" className={styles.generateButton} onClick={() => void generateReport()} disabled={loading}>
              {loading ? "Gerando..." : "Gerar analise"}
            </button>
          </div>
        </div>

        <div className={styles.filtersGrid}>
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
            allowedFiliais={allowedFiliais}
          />
          <MultiSelectFilter
            label="Colecoes"
            value={selectedColecoes}
            options={availableColecoes}
            onChange={setSelectedColecoes}
            onOpen={() => void loadFilterOptions("colecoes")}
            loading={loadingColecoes}
          />
          <MultiSelectFilter
            label="Subgrupos"
            value={selectedSubgrupos}
            options={availableSubgrupos}
            onChange={setSelectedSubgrupos}
            onOpen={() => void loadFilterOptions("subgrupos")}
            loading={loadingSubgrupos}
          />
          <MultiSelectFilter
            label="Grades"
            value={selectedGrades}
            options={availableGrades}
            onChange={setSelectedGrades}
            onOpen={() => void loadFilterOptions("grades")}
            loading={loadingGrades}
          />
        </div>

        <div className={styles.rangesSection}>
          <div className={styles.rangesHeader}>
            <div>
              <div className={styles.sectionTitle}>Periodos</div>
              <div className={styles.sectionSubtitle}>Adicione mais de um range quando quiser comparar leituras diferentes do mix.</div>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setRanges((current) => [...current, createEmptyRange()])}
            >
              + Adicionar periodo
            </button>
          </div>
          <div className={styles.rangesGrid}>
            {ranges.map((range, index) => (
              <div key={`${index}-${range.startDate.toISOString()}-${range.endDate.toISOString()}`} className={styles.rangeCard}>
                <div className={styles.rangeCardTop}>
                  <strong>Periodo {index + 1}</strong>
                  {ranges.length > 1 ? (
                    <button
                      type="button"
                      className={styles.removeButton}
                      onClick={() =>
                        setRanges((current) => current.filter((_, currentIndex) => currentIndex !== index))
                      }
                    >
                      Remover
                    </button>
                  ) : null}
                </div>
                <DateRangeFilter
                  value={range}
                  onChange={(value) =>
                    setRanges((current) =>
                      current.map((item, currentIndex) => (currentIndex === index ? value : item))
                    )
                  }
                  label=""
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {error ? <div className={styles.errorBox}>{error}</div> : null}

      {reports.length > 1 ? (
        <div className={styles.tabs}>
          {reports.map((report, index) => (
            <button
              key={`${report.range.start}-${report.range.end}-${index}`}
              type="button"
              className={`${styles.tab} ${index === activeReportIndex ? styles.tabActive : ""}`}
              onClick={() => setActiveReportIndex(index)}
            >
              {report.range.label}
            </button>
          ))}
        </div>
      ) : null}

      {reports[activeReportIndex] ? <ReportView report={reports[activeReportIndex]} deckRef={deckRef} /> : null}
    </div>
  );
}

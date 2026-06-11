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
  generalShare?: number;
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

interface SlideAuditMeta {
  source: string;
  queryBase: string;
  effectiveRange: string;
  appliedFilters: string;
  formula: string;
  checks: string;
}

interface ReportAudit {
  flags: {
    comparableRecentWindow: boolean;
    equivalentWindowComparison: boolean;
    stockTotalUsesScopeInventory: boolean;
    ruptureScopeUsesSoldSkus: boolean;
  };
  slides: Record<string, SlideAuditMeta>;
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
    previousEquivalentLabel: string;
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
    activeStockTotal: number;
    stockScopeSkuCount: number;
    coverageMonths: number;
    ruptureCount: number;
    openPurchaseCount: number;
    retentionComparable: boolean;
  };
  curveSummary: CurveSummaryRow[];
  topCurveA: AbcItem[];
  yearSummary: Array<{
    year: number;
    revenue: number;
    quantity: number;
    note: string;
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
  warmingTypes: ShareRankingRow[];
  coolingCollections: ShareRankingRow[];
  movementTable: ShareRankingRow[];
  story: StoryRow[];
  closing: ClosingSummary;
  recommendations: RecommendationRow[];
  audit: ReportAudit;
}

interface ClaudeReportPageProps {
  companyKey: CompanyKey;
}

const DONUT_COLORS = ["#6D2E46", "#A86A74", "#ECE2D0", "#D4A373"];

function toFiniteNumber(value: number, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function fmtCurrency(value: number, compact = false) {
  const safeValue = toFiniteNumber(value);

  if (!compact) {
    return safeValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  }

  const abs = Math.abs(safeValue);
  if (abs >= 1_000_000) {
    return `R$ ${(safeValue / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}M`;
  }
  if (abs >= 1_000) {
    return `R$ ${(safeValue / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}K`;
  }
  return fmtCurrency(value);
}

function fmtInt(value: number) {
  return Math.round(toFiniteNumber(value)).toLocaleString("pt-BR");
}

function fmtPct(value: number, digits = 1, signed = false) {
  const safeValue = toFiniteNumber(value);
  const signal = signed && safeValue > 0 ? "+" : "";
  return `${signal}${safeValue.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}%`;
}

function fmtPp(value: number) {
  const safeValue = toFiniteNumber(value);
  const signal = safeValue > 0 ? "+" : "";
  return `${signal}${safeValue.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}pp`;
}

function hasMeaningfulDrift(value: number) {
  return Math.abs(toFiniteNumber(value)) >= 0.25;
}

function fmtDriftPp(value: number) {
  const safeValue = toFiniteNumber(value);
  const digits = Math.abs(safeValue) < 1 ? 2 : 1;
  const signal = safeValue > 0 ? "+" : "";
  return `${signal}${safeValue.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}pp`;
}

function fmtDriftSignal(value: number) {
  const safeValue = toFiniteNumber(value);
  if (!hasMeaningfulDrift(safeValue)) return `estável (${fmtDriftPp(safeValue)})`;
  const magnitude = fmtPp(Math.abs(safeValue));
  return safeValue > 0 ? `\u25B2 ganhou ${magnitude}` : `\u25BC perdeu ${magnitude}`;
}

function rangeDurationLabel(months: number, start: string, end: string): string {
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000) + 1);
  if (days < 31) return `${days} ${days === 1 ? "dia" : "dias"}`;
  if (months < 2) return `${months.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} meses`;
  return `${Math.round(months)} meses`;
}

function formatPeriodHeadline(months: number, start: string, end: string): string {
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = Math.max(1, Math.round((new Date(end).getTime() - new Date(start).getTime()) / msPerDay) + 1);
  if (days < 31) {
    return `O que dizem os ${days} ${days === 1 ? "dia" : "dias"} da rede`;
  }
  if (months < 2) {
    const formatted = months.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `O que diz esse ${formatted} mês da rede`;
  }
  return `O que dizem os ${Math.round(months)} meses da rede`;
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
  if (normalized.includes("POLIESTER")) return "Poliéster";
  if (normalized.includes("VISCOSE")) return "Viscose";
  if (normalized.includes("ALGOD")) return "Algodão";
  if (normalized.includes("LINHO")) return "Linho";
  if (normalized.includes("CASHMERE")) return "Cashmere";
  if (normalized.includes("MODAL")) return "Modal";
  if (normalized.includes("ACRIL")) return "Acrílico";
  if (normalized.includes("LA ") || normalized.startsWith("LA") || normalized.includes(" LA")) return "Lã";
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

function StatCardIcon({ type, positive = true }: { type: "revenue" | "sku" | "curveA" | "yoy"; positive?: boolean }) {
  return (
    <div className={styles.statIcon}>
      {type === "revenue" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
          <polyline points="16 7 22 7 22 13" />
        </svg>
      )}
      {type === "sku" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
        </svg>
      )}
      {type === "curveA" && (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="6" />
          <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
        </svg>
      )}
      {type === "yoy" && (positive ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" />
          <polyline points="5 12 12 5 19 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" />
          <polyline points="19 12 12 19 5 12" />
        </svg>
      ))}
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
  const safeRows = rows.map((row) => ({
    ...row,
    value: toFiniteNumber(row.value),
  }));
  const maxValue = Math.max(...safeRows.map((row) => row.value), 1);

  return (
    <div className={styles.barList}>
      {safeRows.map((row) => (
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
  const safeItems = items.map((item) => ({
    ...item,
    value: Math.max(toFiniteNumber(item.value), 0),
  }));
  const total = safeItems.reduce((sum, item) => sum + item.value, 0);

  // SVG donut via stroke-dasharray — conic-gradient is not supported by html2canvas
  const r = 139;
  const cx = 170;
  const cy = 170;
  const strokeWidth = 63;
  const circumference = 2 * Math.PI * r;

  let cumulative = 0;
  const slices = safeItems.map((item) => {
    const share = total > 0 ? item.value / total : 0;
    const dashLength = toFiniteNumber(share * circumference);
    const dashOffset = toFiniteNumber(circumference * (0.25 - cumulative));
    cumulative += share;
    return { ...item, dashLength, dashOffset };
  });

  return (
    <div className={styles.donutWrap}>
      <div className={styles.donut}>
        <svg
          viewBox="0 0 340 340"
          aria-hidden="true"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", zIndex: 0 }}
        >
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e8e2d6" strokeWidth={strokeWidth} />
          {total > 0
            ? slices.map((slice) => (
                <circle
                  key={slice.label}
                  cx={cx}
                  cy={cy}
                  r={r}
                  fill="none"
                  stroke={slice.color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${slice.dashLength} ${circumference}`}
                  strokeDashoffset={slice.dashOffset}
                />
              ))
            : null}
        </svg>
        <div className={styles.donutCenter}>
          <strong>{centerValue}</strong>
          <span>{centerLabel}</span>
        </div>
      </div>
      <div className={styles.legend}>
        {safeItems.map((item) => (
          <div key={item.label} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: item.color }} />
            {item.label} - {item.valueLabel}
          </div>
        ))}
      </div>
    </div>
  );
}

function AuditPanel({ audit }: { audit?: SlideAuditMeta }) {
  if (!audit) return null;

  return (
    <div className={styles.auditPanel}>
      <div className={styles.auditTitle}>Modo auditoria</div>
      <div className={styles.auditGrid}>
        <div className={styles.auditItem}>
          <strong>Fonte</strong>
          <span>{audit.source}</span>
        </div>
        <div className={styles.auditItem}>
          <strong>Range efetivo</strong>
          <span>{audit.effectiveRange}</span>
        </div>
        <div className={`${styles.auditItem} ${styles.auditWide}`}>
          <strong>Query base</strong>
          <span>{audit.queryBase}</span>
        </div>
        <div className={`${styles.auditItem} ${styles.auditWide}`}>
          <strong>Filtros aplicados</strong>
          <span>{audit.appliedFilters}</span>
        </div>
        <div className={`${styles.auditItem} ${styles.auditWide}`}>
          <strong>Fórmula</strong>
          <span>{audit.formula}</span>
        </div>
        <div className={`${styles.auditItem} ${styles.auditWide}`}>
          <strong>Cheque de coerência</strong>
          <span>{audit.checks}</span>
        </div>
      </div>
    </div>
  );
}

function ReportView({
  report,
  deckRef,
  auditMode,
}: {
  report: ClaudeReportPayload;
  deckRef?: RefObject<HTMLDivElement | null>;
  auditMode?: boolean;
}) {
  const curveAShare = report.curveSummary.find((row) => row.curve === "A")?.share ?? 0;
  const curveASkus = report.curveSummary.find((row) => row.curve === "A")?.skus ?? 0;
  const curveBPlusCUnits = report.curveSummary
    .filter((row) => row.curve !== "A")
    .reduce((sum, row) => sum + row.quantity, 0);
  const stockCurveA = report.curveSummary.find((row) => row.curve === "A")?.stock ?? 0;
  const stockCurveAShare = report.summary.activeStockTotal > 0 ? (stockCurveA / report.summary.activeStockTotal) * 100 : 0;
  const topStore = report.branchRanking[0] ?? null;
  const hasChannelView = report.channelMix.hasEcommerce && report.channelMix.ecommerceRevenue > 0 && report.channelMix.physicalRevenue > 0;
  const showSubgroupSlide = report.appliedFilters.subgrupos.length !== 1;
  const slideAudit = report.audit.slides;
  const hasComparableRecentWindow = report.summary.retentionComparable;
  const coverEyebrow = hasChannelView ? "Análise de produto - rede + e-com" : "Análise de produto - rede";
  const coverSubtitle = hasChannelView
    ? `Performance, curva ABC, tipos, coleções, cores, ranking de filiais e desempenho do e-commerce - ${rangeDurationLabel(report.range.months, report.range.start, report.range.end)} de dados (${report.range.label}).`
    : `Performance, curva ABC, tipos, coleções, cores e ranking de filiais - ${rangeDurationLabel(report.range.months, report.range.start, report.range.end)} de dados (${report.range.label}).`;
  const rankingLabel = hasChannelView ? "Ranking de canais" : "Ranking de filiais";
  const rankingTitle = hasChannelView
    ? `Onde ${report.presentation.performanceLead} mais performa`
    : `Onde ${report.presentation.performanceLead} mais performa`;
  const rankingSubtitle = hasChannelView
    ? "A leitura consolidada mostra o peso relativo de lojas e e-commerce dentro do recorte."
    : "A leitura física da rede mostra concentração de faturamento e onde o mix tem maior alavanca comercial.";
  const profileEyebrow = hasChannelView ? "Perfil dos canais" : "Perfil das filiais";
  const profileTitle = hasChannelView ? "Cada operação vende um mix diferente" : "Cada loja tem cara própria";
  const profileSubtitle = hasChannelView
    ? `Top 6 operações com suas coleções e cores líderes - ${report.growthLabel}.`
    : `Top 6 filiais com suas coleções e cores líderes - ${report.growthLabel}.`;
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
            <div className={styles.brand}>
              SCARF<span className={styles.brandDot}>.</span><span className={styles.brandMe}>ME</span>
            </div>
            <div className={styles.eyebrow}>{coverEyebrow}</div>
          </div>
          <h1>{coverTitle}</h1>
          <p className={styles.subtitle}>{coverSubtitle}</p>
          {auditMode ? <AuditPanel audit={slideAudit.cover} /> : null}
          <div className={styles.coverLine} />
          <div className={styles.coverMeta}>{coverMeta}</div>
          <div className={styles.coverStats}>
            {fmtCurrency(report.summary.totalRevenue, true)} - {fmtInt(report.summary.totalUnits)} unidades - {coverStatsLabel}
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const periodFull = formatPeriodHeadline(report.range.months, report.range.start, report.range.end);
          const periodShort = periodFull.replace(/ da rede$/, "");
          const summaryHeadline = hasFilters && dominantFamily
            ? `${dominantFamily} - ${periodShort.charAt(0).toLowerCase()}${periodShort.slice(1)}`
            : periodFull;
          const summarySubtitle = report.presentation.summaryLead.length > 40
            ? report.presentation.summaryLead
            : `${report.presentation.summaryLead} soma ${fmtCurrency(report.summary.totalRevenue)} em ${rangeDurationLabel(report.range.months, report.range.start, report.range.end)} (${report.range.label}), com ${fmtInt(report.summary.skuCount)} SKUs ativos. Variação YoY: ${fmtPct(report.summary.yoyNetwork, 1, true)}.`;
          // Card 4: use YoY only when meaningful; fall back to monthly projection
          const days = Math.max(1, Math.round((new Date(report.range.end).getTime() - new Date(report.range.start).getTime()) / 86_400_000) + 1);
          const yoyAbs = Math.abs(toFiniteNumber(report.summary.yoyNetwork));
          const yoyMeaningful = yoyAbs > 0.05 && hasComparableRecentWindow && toFiniteNumber(report.summary.retention) < 99.9;
          const useMonthly = !yoyMeaningful || days < 31;
          const monthYoyPositive = toFiniteNumber(report.summary.monthProjectionYoy) >= 0;
          const card4Positive = useMonthly ? monthYoyPositive : report.summary.yoyNetwork >= 0;
          const card4Accent = card4Positive ? styles.accentGreen : styles.accentTerracotta;
          const card4Value = useMonthly
            ? fmtPct(report.summary.monthProjectionYoy, 1, true)
            : fmtPct(report.summary.yoyNetwork, 1, true);
          const card4Label = useMonthly
            ? `${report.summary.monthCurrentLabel} vs ${report.summary.monthPreviousLabel} (proj.)`
            : report.summary.yoyLabel;
          const card4Note = useMonthly
            ? `proj. ${fmtCurrency(report.summary.monthProjected, true)}`
            : hasComparableRecentWindow
              ? `${fmtPct(report.summary.retention)} dos top SKUs mantiveram posição`
              : "sem janela recente comparável";
          const insightText = useMonthly
            ? (monthYoyPositive
                ? `${report.summary.monthCurrentLabel} projeta ${fmtCurrency(report.summary.monthProjected, true)} - alta de ${fmtPct(report.summary.monthProjectionYoy, 1, true)} sobre o mesmo mês do ano anterior (${report.summary.monthPreviousLabel}).`
                : `${report.summary.monthCurrentLabel} projeta ${fmtCurrency(report.summary.monthProjected, true)} - queda de ${fmtPct(Math.abs(toFiniteNumber(report.summary.monthProjectionYoy)), 1)} vs ${report.summary.monthPreviousLabel}. Ritmo recente abaixo do ano anterior.`)
            : (report.summary.yoyNetwork >= 0
                ? `Crescimento YoY de ${fmtPct(report.summary.yoyNetwork, 1, true)} no período. ${hasComparableRecentWindow ? (toFiniteNumber(report.summary.retention) >= 90 ? "Mix estável - top SKUs mantiveram posição." : `${fmtPct(100 - toFiniteNumber(report.summary.retention))} dos líderes perderam ritmo na janela recente (${report.range.recentLabel}).`) : "Sem janela recente distinta para medir drift com confiabilidade."}`
                : `Queda de ${fmtPct(Math.abs(toFiniteNumber(report.summary.yoyNetwork)), 1)} YoY. Projeção de ${report.summary.monthCurrentLabel}: ${fmtCurrency(report.summary.monthProjected, true)}.`);
          return (
            <>
              <div className={styles.eyebrow}>Resumo executivo</div>
              <h1>{summaryHeadline}</h1>
              <p className={styles.subtitle}>{summarySubtitle}</p>
              {auditMode ? <AuditPanel audit={slideAudit.summary} /> : null}
              <div className={`${styles.statGrid} ${styles.four}`}>
                <div className={styles.statCard}>
                  <StatCardIcon type="revenue" />
                  <div className={styles.statValue}>{fmtCurrency(report.summary.totalRevenue, true)}</div>
                  <div className={styles.statLabel}>Faturamento - {rangeDurationLabel(report.range.months, report.range.start, report.range.end)}</div>
                  <div className={styles.statNote}>{fmtInt(report.summary.totalUnits)} unidades vendidas</div>
                </div>
                <div className={styles.statCard}>
                  <StatCardIcon type="sku" />
                  <div className={styles.statValue}>{fmtInt(report.summary.skuCount)}</div>
                  <div className={styles.statLabel}>SKUs ativos no período</div>
                  <div className={styles.statNote}>{fmtInt(curveASkus)} em Curva A</div>
                </div>
                <div className={styles.statCard}>
                  <StatCardIcon type="curveA" />
                  <div className={styles.statValue}>{fmtPct(curveAShare)}</div>
                  <div className={styles.statLabel}>do faturamento vem da Curva A</div>
                  <div className={styles.statNote}>{fmtInt(curveASkus)} SKUs líderes</div>
                </div>
                <div className={`${styles.statCard} ${card4Accent}`}>
                  <StatCardIcon type="yoy" positive={card4Positive} />
                  <div className={styles.statValue}>{card4Value}</div>
                  <div className={styles.statLabel}>{card4Label}</div>
                  <div className={styles.statNote}>{card4Note}</div>
                </div>
              </div>
              <div className={styles.insightStrip}>
                <span className={styles.insightBulb} aria-hidden="true">&#128161;</span>
                {insightText}
              </div>
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const curveARow = report.curveSummary.find((r) => r.curve === "A");
          const curveAQty = curveARow?.quantity ?? 0;
          const curveARevenue = curveARow?.revenue ?? 0;
          const curveATicket = curveAQty > 0 ? curveARevenue / curveAQty : 0;
          const curveBCSkus = report.curveSummary.filter((r) => r.curve !== "A").reduce((s, r) => s + r.skus, 0);
          const subj = hasFilters ? dominantFamily.toLowerCase() : "a rede";
          const motor = curveAShare >= 78 ? "motor enxuto" : curveAShare >= 65 ? "base concentrada" : "distribuição equilibrada";
          const abcHeadline = `Concentração — ${subj} tem ${motor}`;
          const abcSubtitle = `Em ${rangeDurationLabel(report.range.months, report.range.start, report.range.end)}, ${fmtInt(curveASkus)} produtos Curva A respondem por ${fmtPct(curveAShare)} do faturamento.`;
          const tailAdj = curveBPlusCUnits > curveAQty * 0.25 ? "cauda relevante" : "cauda reduzida";
          return (
            <>
              <div className={styles.eyebrow}>Curva ABC</div>
              <h1>{abcHeadline}</h1>
              <p className={styles.subtitle}>{abcSubtitle}</p>
              {auditMode ? <AuditPanel audit={slideAudit.curveAbc} /> : null}
              <div className={`${styles.twoCol} ${styles.abcCol}`}>
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
                    <strong>{fmtInt(curveASkus)} SKUs Curva A</strong> — concentram {fmtPct(curveAShare)} das vendas — {motor}.
                  </div>
                  <div className={styles.miniCallout}>
                    <strong>{fmtInt(curveAQty)} unidades</strong> — em Curva A{curveATicket > 0 ? `, ticket medio de ${fmtCurrency(curveATicket)}` : ""}.
                  </div>
                  <div className={styles.miniCallout}>
                    <strong>{fmtInt(curveBCSkus)} SKUs B+C</strong> — vendem {fmtInt(curveBPlusCUnits)} unidades — {tailAdj}.
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Top 10 Curva A</div>
        <h1>Os SKUs que sustentam o catálogo</h1>
        <p className={styles.subtitle}>Ranking por faturamento no período {report.range.label}.</p>
        {auditMode ? <AuditPanel audit={slideAudit.topCurveA} /> : null}
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
        {(() => {
          const top10 = report.topCurveA.slice(0, 10);
          const rupturedTop = top10.filter((r) => r.stock <= 0);
          const atRisk = top10.filter((r) => r.stock <= 2);
          const sortedByStock = [...top10].sort((a, b) => a.stock - b.stock);
          const worstItem = sortedByStock[0];

          const line1 = atRisk.length > 0
            ? `${atRisk.length} dos ${top10.length} SKUs do Top têm estoque ≤ 2 unidades.`
            : `${top10.filter((r) => r.stock > 10).length} dos ${top10.length} SKUs do Top com estoque saudável (> 10 unidades).`;

          let line2: string | null = null;
          if (worstItem) {
            if (worstItem.stock <= 0) {
              line2 = `${worstItem.description} está em ruptura total.`;
            } else if (worstItem.stock <= 2) {
              line2 = `${worstItem.description} é o mais crítico — apenas ${fmtInt(worstItem.stock)} ${worstItem.stock === 1 ? "unidade" : "unidades"}.`;
            } else if (worstItem.stock <= 5) {
              line2 = `${worstItem.description} merece atenção — ${fmtInt(worstItem.stock)} unidades restantes.`;
            }
          }

          const line3 = report.summary.ruptureCount > 0
            ? `${fmtInt(report.summary.ruptureCount)} SKUs ativos estão em ruptura no consolidado.`
            : null;

          const line4 = rupturedTop.length >= 3 || atRisk.length >= 6
            ? "Reposição é urgente."
            : rupturedTop.length > 0 || atRisk.length >= 2
              ? "Atenção ao reabastecimento dos itens críticos."
              : report.summary.ruptureCount > 0
                ? "Monitorar reposição — ruptura na rede impacta receita."
                : "Posição de estoque confortável para o período.";

          return (
            <div className={styles.warningNote}>
              <p>{line1}</p>
              {line2 ? <p>{line2}</p> : null}
              {line3 ? <p>{line3}</p> : null}
              <p>{line4}</p>
            </div>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const years = report.yearSummary.slice(-3);
          const endDate = new Date(`${report.range.end}T00:00:00Z`);
          const endYear = endDate.getUTCFullYear();
          const endMonth = endDate.getUTCMonth();
          const endDay = endDate.getUTCDate();
          const isComplete = (year: number) =>
            year < endYear || (year === endYear && endMonth === 11 && endDay >= 28);
          const channelSuffix = hasChannelView ? "loja + e-com somados" : "rede consolidada";
          const annualTitle = `Janelas equivalentes - ${channelSuffix}`;
          const lastFullIdx = [...years].reverse().findIndex((y) => isComplete(y.year));
          const lastFull = lastFullIdx >= 0 ? [...years].reverse()[lastFullIdx] : null;
          const prevOfLastFull = lastFull ? years[years.indexOf(lastFull) - 1] : null;
          const bigYoy = lastFull && prevOfLastFull && prevOfLastFull.revenue > 0
            ? (lastFull.revenue - prevOfLastFull.revenue) / prevOfLastFull.revenue * 100 : null;
          const monthYoy = toFiniteNumber(report.summary.monthProjectionYoy);
          const subj = hasFilters ? dominantFamily : "A rede";
          const annualSubtitle = (() => {
            const yoyPart = bigYoy !== null
              ? `${subj} ${bigYoy >= 0 ? `cresceu ${fmtPct(bigYoy, 0, true)}` : `caiu ${fmtPct(Math.abs(bigYoy), 0)}`} na janela equivalente de ${lastFull!.year} vs ${prevOfLastFull!.year}.`
              : `${subj} - comparativo por janelas equivalentes disponível.`;
            const monthPart = monthYoy >= 0
              ? `${report.summary.monthCurrentLabel} projeta alta de ${fmtPct(monthYoy, 1, true)} vs ${report.summary.monthPreviousLabel}.`
              : `${report.summary.monthCurrentLabel} projeta queda de ${fmtPct(Math.abs(monthYoy), 1)} vs ${report.summary.monthPreviousLabel} - sinal de desaceleração recente.`;
            return `${yoyPart} ${monthPart}`;
          })();
          const compareMax = Math.max(
            toFiniteNumber(report.summary.monthProjected),
            toFiniteNumber(report.summary.monthPrevious), 1
          );
          const projW = toFiniteNumber((report.summary.monthProjected / compareMax) * 100);
          const prevW = toFiniteNumber((report.summary.monthPrevious / compareMax) * 100);
          const monthYoyPositive = monthYoy >= 0;
          const unitSuffix = hasChannelView ? "loja+ecom" : "rede";
          const compareTitle = `Janela equivalente: ${report.summary.monthPreviousLabel.toUpperCase()} vs ${report.summary.monthCurrentLabel.toUpperCase()} - ${hasChannelView ? "LOJA + E-COM" : "REDE"}`;
          return (
            <>
              <div className={styles.eyebrow}>Janelas equivalentes</div>
              <h1>{annualTitle}</h1>
              <p className={styles.subtitle}>{annualSubtitle}</p>
              {auditMode ? <AuditPanel audit={slideAudit.timeCompare} /> : null}
              <div className={styles.yearGrid}>
                {years.flatMap((row, index) => {
                  const prev = years[index - 1];
                  const growth = prev && prev.revenue > 0
                    ? (row.revenue - prev.revenue) / prev.revenue * 100 : null;
                  const cardClass = index === 0 ? styles.yearSoft : index === 1 ? styles.yearLight : styles.yearDark;
                  const items = [];
                  if (index > 0) {
                    items.push(
                      <div
                        key={`arrow-${index}`}
                        className={`${styles.yearArrow} ${growth !== null && growth >= 0 ? styles.yearArrowGreen : styles.yearArrowGray}`}
                      >
                        {growth !== null ? <span>{fmtPct(growth, 0, true)}</span> : null}
                        <span>{"→"}</span>
                      </div>
                    );
                  }
                  items.push(
                    <div key={row.year} className={`${styles.yearCard} ${cardClass}`}>
                      <div className={styles.yearLabel}>{row.year}</div>
                      <div className={styles.yearNote}>{row.note}</div>
                      <div className={styles.yearValue}>{fmtCurrency(row.revenue, true)}</div>
                      <div className={styles.yearUnits}>{fmtInt(row.quantity)} un. · {unitSuffix}</div>
                    </div>
                  );
                  return items;
                })}
              </div>
              <div className={styles.compareBox}>
                <div>
                  <div className={styles.compareTitle}>{compareTitle}</div>
                  <div className={styles.compareBars}>
                    <div className={styles.compareBarRow}>
                      <span>{report.summary.monthCurrentLabel} (projetado)</span>
                      <div className={styles.compareTrack}>
                        <div className={styles.compareFill} style={{ width: `${projW}%` }} />
                      </div>
                      <strong>{fmtCurrency(report.summary.monthProjected)}</strong>
                    </div>
                    <div className={styles.compareBarRow}>
                      <span>{report.summary.monthPreviousLabel} (realizado)</span>
                      <div className={styles.compareTrack}>
                        <div className={`${styles.compareFill} ${styles.compareMuted}`} style={{ width: `${prevW}%` }} />
                      </div>
                      <strong>{fmtCurrency(report.summary.monthPrevious)}</strong>
                    </div>
                  </div>
                </div>
                <div className={`${styles.compareBadge} ${monthYoyPositive ? "" : styles.compareBadgeNeg}`}>
                  <div className={styles.compareBadgeLabel}>Variação YoY</div>
                  <div className={styles.compareBadgeValue}>{fmtPct(monthYoy, 1, true)}</div>
                  <div className={styles.compareBadgeSub}>{report.summary.monthCurrentLabel} proj. vs {report.summary.monthPreviousLabel}</div>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const top = report.typeRanking;
          const leader = top[0];
          const second = top[1];
          const risingOutsideTop3 = top.slice(3).find((r) => r.deltaPp >= 0.5);
          const losingLeader = leader && toFiniteNumber(leader.deltaPp) < -1.5;
          const gainLeader = leader && toFiniteNumber(leader.deltaPp) >= 0.8;
          const top3Sum = top.slice(0, 3).reduce((s, r) => s + r.share, 0);
          const tc = (s: string) => { const l = s.toLowerCase(); return l.charAt(0).toUpperCase() + l.slice(1); };
          const typeSubtitle = (() => {
            const parts: string[] = [];
            if (leader) {
              const hasGeneral = leader.generalShare !== undefined && leader.generalShare > 0;
              const subjectCtx = hasFilters ? ` no ${dominantFamily.toLowerCase()}` : "";
              const generalCtx = hasGeneral
                ? ` (${fmtPct(leader.share)} vs ${fmtPct(leader.generalShare!)} no total)`
                : ` com ${fmtPct(leader.share)} do faturamento`;
              const dominance = hasGeneral && leader.share > leader.generalShare! + 2
                ? "domina ainda mais"
                : "lidera";
              const momentum = gainLeader
                ? `, ganhando ${fmtPp(leader.deltaPp)} na janela recente`
                : losingLeader
                  ? `, mas perde ${fmtPp(Math.abs(toFiniteNumber(leader.deltaPp)))} de participação`
                  : "";
              parts.push(`${tc(leader.label)} ${dominance}${subjectCtx}${generalCtx}${momentum}.`);
            }
            if (second) {
              const secondMomentum = second.deltaPp > 0.5
                ? ` acelera — ${fmtPp(second.deltaPp)} na janela recente`
                : second.deltaPp < -1
                  ? ` perde força (${fmtPp(second.deltaPp)})`
                  : " mantém o pódio";
              parts.push(`${tc(second.label)}${secondMomentum}.`);
            }
            if (risingOutsideTop3) {
              const pos = top.indexOf(risingOutsideTop3) + 1;
              parts.push(`${tc(risingOutsideTop3.label)} entra forte como ${pos}º - sinal de tendência.`);
            }
            return parts.join(" ");
          })();
          return (
            <>
              <div className={styles.eyebrow}>Ranking por tipo</div>
              <h1>Quais estampas puxam o catálogo</h1>
              <p className={styles.subtitle}>{typeSubtitle || `A leitura combina participação total e movimento na janela recente ${report.range.recentLabel}.`}</p>
              {auditMode ? <AuditPanel audit={slideAudit.typeRanking} /> : null}
              <div className={`${styles.twoCol} ${styles.wideRight}`}>
                <BarList rows={top.slice(0, 14).map((row) => ({ label: row.label, value: row.revenue }))} formatter={(v) => fmtCurrency(v)} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div className={styles.podiumList}>
                    {top.slice(0, 3).map((row, index) => (
                      <div key={row.label} className={styles.podiumCard}>
                        <div className={styles.podiumRank}>#{index + 1}</div>
                        <div className={styles.podiumBody}>
                          <div className={styles.podiumTitle}>{row.label}</div>
                          <div className={styles.podiumSubtitle}>{fmtCurrency(row.revenue)} · {fmtInt(row.skus)} SKUs</div>
                          <div className={styles.podiumNote}>{fmtPct(row.share)} da rede {row.deltaPp !== 0 ? `· ${fmtPp(row.deltaPp)} recente` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.insightBox} style={{ marginTop: "auto", paddingTop: "14px" }}>
                    Top 3 somam <strong>{fmtPct(top3Sum)}</strong> do faturamento - {top3Sum >= 60 ? "concentração alta" : top3Sum >= 45 ? "mix equilibrado" : "cauda longa relevante"}.
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const cols = report.collectionRanking;
          const colLeader = cols[0];
          const warming = cols.filter((r) => toFiniteNumber(r.deltaPp) > 0.5).slice(0, 2);
          const cooling = cols.filter((r) => toFiniteNumber(r.deltaPp) < -1.5).slice(0, 1);
          const colTop3Sum = cols.slice(0, 3).reduce((s, r) => s + r.share, 0);
          const colSubtitle = (() => {
            const parts: string[] = [];
            if (colLeader) {
              const hasGeneral = colLeader.generalShare !== undefined && colLeader.generalShare > 0;
              const subjectCtx = hasFilters ? ` no ${dominantFamily.toLowerCase()}` : "";
              const generalCtx = hasGeneral
                ? ` (${fmtPct(colLeader.share)} vs ${fmtPct(colLeader.generalShare!)} no total)`
                : ` com ${fmtPct(colLeader.share)} do faturamento`;
              const momentum = toFiniteNumber(colLeader.deltaPp) > 0.8
                ? `, ainda acelerando (${fmtPp(colLeader.deltaPp)})`
                : toFiniteNumber(colLeader.deltaPp) < -1.5
                  ? `, mas perdendo fôlego (${fmtPp(colLeader.deltaPp)})`
                  : "";
              parts.push(`${colLeader.label} lidera${subjectCtx}${generalCtx}${momentum}.`);
            }
            if (warming.length > 0) {
              parts.push(`Esquentando: ${warming.map((r) => `${r.label} (${fmtPp(r.deltaPp)})`).join(", ")}.`);
            }
            if (cooling.length > 0) {
              parts.push(`${cooling[0].label} esfria — hora de queimar estoque.`);
            }
            return parts.join(" ") || `A curva recente mostra quais coleções carregam caixa e quais perdem fôlego.`;
          })();
          return (
            <>
              <div className={styles.eyebrow}>Ranking por coleção</div>
              <h1>Quais lançamentos sustentam a receita</h1>
              <p className={styles.subtitle}>{colSubtitle}</p>
              {auditMode ? <AuditPanel audit={slideAudit.collectionRanking} /> : null}
              <div className={`${styles.twoCol} ${styles.wideRight}`}>
                <BarList rows={cols.slice(0, 12).map((r) => ({ label: r.label, value: r.revenue }))} formatter={(v) => fmtCurrency(v)} />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div className={styles.podiumList}>
                    {cols.slice(0, 3).map((row, index) => (
                      <div key={row.label} className={styles.podiumCard}>
                        <div className={styles.podiumRank}>#{index + 1}</div>
                        <div className={styles.podiumBody}>
                          <div className={styles.podiumTitle}>{row.label}</div>
                          <div className={styles.podiumSubtitle}>{fmtCurrency(row.revenue)} · {fmtInt(row.skus)} SKUs</div>
                          <div className={styles.podiumNote}>{fmtPct(row.share)} da rede {toFiniteNumber(row.deltaPp) !== 0 ? `· ${fmtPp(row.deltaPp)} recente` : ""}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className={styles.insightBox} style={{ marginTop: "auto" }}>
                    Top 3 somam <strong>{fmtPct(colTop3Sum)}</strong> - {warming.length > 0 ? `${warming[0].label} lidera a aceleração` : "estabilidade no topo"}.
                  </div>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Ranking por cor</div>
        <h1>A paleta que move a rede</h1>
        <p className={styles.subtitle}>As cores abaixo mostram onde a grade aceita profundidade e onde vale reduzir risco de compra.</p>
        {auditMode ? <AuditPanel audit={slideAudit.colorRanking} /> : null}
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
          <h1>A composição material da rede</h1>
          <p className={styles.subtitle}>Subgrupos ajudam a separar o que sustenta volume, o que sustenta ticket e onde existe risco de concentração.</p>
          {auditMode ? <AuditPanel audit={slideAudit.subgroupRanking} /> : null}
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
                Leitura de negócio: combinar subgrupos de volume com subgrupos de ticket e o que sustenta margem sem perder giro.
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {hasChannelView ? (
        <section className={styles.slide} data-pdf-slide="">
          <div className={styles.eyebrow}>Escopo e canais</div>
          <h1>Loja física e e-commerce contam histórias diferentes</h1>
          <p className={styles.subtitle}>
            Este recorte soma rede física e digital. O bloco abaixo separa peso, ticket e relevância operacional de cada canal antes de abrir o ranking.
          </p>
          {auditMode ? <AuditPanel audit={slideAudit.channelMix} /> : null}
          <div className={styles.scopeGrid}>
            <div className={styles.scopeHero}>
              <div className={styles.scopeAmount}>{fmtCurrency(report.summary.totalRevenue, true)}</div>
              <div className={styles.scopeLabel}>Loja + e-com no recorte</div>
              <div className={styles.scopeMeta}>{fmtInt(report.summary.totalUnits)} unidades · {rangeDurationLabel(report.range.months, report.range.start, report.range.end)} ({report.range.label})</div>
              <div className={styles.scopeNarrative}>{report.channelMix.note}</div>
            </div>
            <div className={styles.scopeCard}>
              <div className={styles.scopeCardTitle}>Loja física</div>
              <div className={styles.scopeCardValue}>{fmtCurrency(report.channelMix.physicalRevenue, true)}</div>
              <div className={styles.scopeCardLine}>{fmtInt(report.channelMix.physicalUnits)} un. - {fmtPct(report.channelMix.physicalShare)} do total</div>
              <div className={styles.scopeCardLine}>Ticket médio {fmtCurrency(report.channelMix.physicalTicket)} - {report.channelMix.physicalActiveCount} filiais ativas</div>
            </div>
            <div className={`${styles.scopeCard} ${styles.scopeCardAccent}`}>
              <div className={styles.scopeCardTitle}>E-commerce</div>
              <div className={styles.scopeCardValue}>{fmtCurrency(report.channelMix.ecommerceRevenue, true)}</div>
              <div className={styles.scopeCardLine}>{fmtInt(report.channelMix.ecommerceUnits)} un. - {fmtPct(report.channelMix.ecommerceShare)} do total</div>
              <div className={styles.scopeCardLine}>Ticket médio {fmtCurrency(report.channelMix.ecommerceTicket)} - variação {fmtPct(report.channelMix.ecommerceGrowth, 1, true)}</div>
            </div>
          </div>
        </section>
      ) : null}

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>{rankingLabel}</div>
        <h1>{rankingTitle}</h1>
        <p className={styles.subtitle}>{rankingSubtitle}</p>
        {auditMode ? <AuditPanel audit={slideAudit.branchRanking} /> : null}
        <table className={styles.table}>
          <thead>
            <tr>
              <th>#</th>
              <th>{hasChannelView ? "Canal / operação" : "Filial"}</th>
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
                    <span
                      style={{
                        width: `${topStore && topStore.share > 0
                          ? toFiniteNumber((toFiniteNumber(row.share) / toFiniteNumber(topStore.share)) * 100)
                          : 0}%`,
                      }}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={`${styles.insightStrip} ${styles.small}`}>
          Top 3 operações concentram {fmtPct(report.branchRanking.slice(0, 3).reduce((sum, row) => sum + row.share, 0))} da rede consolidada.
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const profiles = report.branchProfiles;
          const isEcom = (name: string) => /e.?com/i.test(name);
          const fmtCols = (cols: string) =>
            cols.split(/[,|]/).map((s) => s.trim().toUpperCase()).filter(Boolean).join(" · ");
          const topGrowth = [...profiles].sort((a, b) => b.growth - a.growth)[0];
          const ecomProfile = profiles.find((r) => isEcom(r.filial));
          const profileInsight = (() => {
            const parts: string[] = [];
            if (topGrowth) {
              parts.push(`${topGrowth.filial} é a operação mais acelerada (${fmtPct(topGrowth.growth, 1, true)}).`);
            }
            if (ecomProfile && ecomProfile.growth > 0) {
              parts.push(`E-commerce cresce ${fmtPct(ecomProfile.growth, 1, true)} — canal digital em expansão.`);
            }
            return parts.join(" ");
          })();
          const dynSubtitle = (() => {
            const ecom = ecomProfile;
            const top = profiles[0];
            if (ecom && top) {
              return `${top.filial} lidera em faturamento. ${ecom.filial} com crescimento de ${fmtPct(ecom.growth, 1, true)}.`;
            }
            return profileSubtitle;
          })();
          return (
            <>
              <div className={styles.eyebrow}>{profileEyebrow}</div>
              <h1>{profileTitle}</h1>
              <p className={styles.subtitle}>{dynSubtitle}</p>
              {auditMode ? <AuditPanel audit={slideAudit.branchProfile} /> : null}
              <div className={styles.profileGrid}>
                {profiles.map((row) => {
                  const ecom = isEcom(row.filial);
                  const growthPositive = row.growth >= 0;
                  return (
                    <div
                      key={row.filial}
                      className={`${styles.profileCard} ${ecom ? styles.profileCardEcom : ""}`}
                    >
                      <div className={styles.profileHeader}>
                        <div className={styles.profileNameRow}>
                          <div className={styles.profileIcon} aria-hidden="true">
                            {ecom ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <circle cx="12" cy="12" r="10" />
                                <line x1="2" y1="12" x2="22" y2="12" />
                                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                <circle cx="12" cy="10" r="3" />
                              </svg>
                            )}
                          </div>
                          <div className={styles.profileStore}>{row.filial}</div>
                        </div>
                        <div className={`${styles.profileGrowthBadge} ${growthPositive ? "" : styles.profileGrowthBadgeNeg}`}>
                          {fmtPct(row.growth, 1, true)}
                        </div>
                      </div>
                      <div className={styles.profileValue}>{fmtCurrency(row.revenue, true)}</div>
                      <div className={styles.profileMetaLabel}>Coleções principais</div>
                      <div className={styles.profileMeta}>{fmtCols(row.collections)}</div>
                      <div className={styles.profileMetaLabel}>Cor líder</div>
                      <div className={`${styles.profileMeta} ${styles.profileColor}`}>{row.color.toUpperCase()}</div>
                    </div>
                  );
                })}
              </div>
              {profileInsight ? (
                <div className={styles.insightStrip} style={{ marginTop: 16 }}>
                  <span className={styles.insightBulb} aria-hidden="true">&#128161;</span>
                  <strong>{profileInsight}</strong>
                </div>
              ) : null}
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        {(() => {
          const subj = hasFilters ? `o ${dominantFamily.toLowerCase()}` : "a rede";
          const stockTitle = `O total é suficiente para ${subj}?`;
          const ruptPct = report.summary.skuCount > 0
            ? toFiniteNumber((report.summary.ruptureCount / report.summary.skuCount) * 100)
            : 0;
          const coverOk = toFiniteNumber(report.summary.coverageMonths) >= 1.5;
          const stockSubtitle = `O escopo filtrado soma ${fmtInt(report.summary.stockTotal)} unidades em estoque atual${hasFilters ? ` de ${dominantFamily.toLowerCase()}` : ""}. Para cobertura e ruptura, a base comparável usa ${fmtInt(report.summary.activeStockTotal)} unidades dos SKUs que venderam no período. ${report.summary.ruptureCount > 0 ? `${fmtInt(report.summary.ruptureCount)} desses SKUs vendidos já estão em ruptura.` : "Sem rupturas entre os SKUs vendidos no recorte."}`;
          const ruptureACount = report.ruptureTable.length;
          const ruptureARevenue = report.ruptureTable.reduce((s, r) => s + r.revenue, 0);
          const diagConclusion = coverOk && ruptureACount < 5
            ? "Volume e distribuição adequados para o ritmo atual."
            : ruptureACount >= 10
              ? "Estoque enxuto demais para o ritmo de venda — reposição urgente."
              : "Reposição seletiva necessária para manter o ritmo.";

          // SVG bar chart
          const barRows = report.curveSummary.map((r, i) => ({
            ...r,
            label: i === 0 ? `Curva A (motor)` : `Curva ${r.curve}`,
          }));
          const maxStock = Math.max(...barRows.map((r) => r.stock), 1);
          const chartH = 160;
          const barW = 80;
          const barGap = 50;
          const svgW = barRows.length * (barW + barGap);

          return (
            <>
              <div className={styles.eyebrow}>Estoque atual</div>
              <h1>{stockTitle}</h1>
              <p className={styles.subtitle}>{stockSubtitle}</p>
              {auditMode ? <AuditPanel audit={slideAudit.stockCurrent} /> : null}
              <div className={`${styles.statGrid} ${styles.three}`} style={{ margin: "16px 0 14px" }}>
                <div className={styles.statCard}>
                  <StatCardIcon type="sku" />
                  <div className={styles.statValue}>{fmtInt(report.summary.stockTotal)}</div>
                  <div className={styles.statLabel}>Unidades em estoque no escopo</div>
                  <div className={styles.statNote}>{fmtInt(report.summary.stockScopeSkuCount)} SKUs com saldo atual</div>
                </div>
                <div className={styles.statCard}>
                  <StatCardIcon type="revenue" />
                  <div className={styles.statValue}>{toFiniteNumber(report.summary.coverageMonths).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}m</div>
                  <div className={styles.statLabel}>Cobertura média</div>
                  <div className={styles.statNote}>base comparável dos SKUs vendidos em {rangeDurationLabel(report.range.months, report.range.start, report.range.end)}</div>
                </div>
                <div className={`${styles.statCard} ${styles.accentTerracotta}`}>
                  <StatCardIcon type="yoy" positive={false} />
                  <div className={`${styles.statValue} ${styles.accentTerracottaText}`}>{fmtInt(report.summary.ruptureCount)}</div>
                  <div className={styles.statLabel}>SKUs ativos em <strong>RUPTURA</strong></div>
                  <div className={styles.statNote}>{fmtPct(ruptPct, 0)} da carteira ativa</div>
                </div>
              </div>
              <div className={styles.stockLayout}>
                <div>
                  <div className={styles.compareTitle} style={{ marginBottom: 16 }}>Distribuição do estoque comparável por curva</div>
                  <svg
                    viewBox={`0 0 ${svgW} ${chartH + 40}`}
                    style={{ width: "100%", maxWidth: 420 }}
                    aria-hidden="true"
                  >
                    {barRows.map((row, i) => {
                      const barH = Math.max(toFiniteNumber((row.stock / maxStock) * chartH), 6);
                      const x = i * (barW + barGap);
                      const y = chartH - barH;
                      return (
                        <g key={row.curve}>
                          <rect x={x} y={y} width={barW} height={barH} fill="#6d2e46" rx="3" />
                          <text x={x + barW / 2} y={y - 6} textAnchor="middle" fontSize="13" fontWeight="700" fill="#2b1a1f">{fmtInt(row.stock)}</text>
                          <text x={x + barW / 2} y={chartH + 20} textAnchor="middle" fontSize="11" fill="#6d2e46">{row.label}</text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
                <div className={styles.diagnosticBox}>
                  <div className={styles.diagTitle}>Diagnóstico</div>
                  <p><strong>{fmtPct(stockCurveAShare, 0)} do estoque comparável</strong><br />está em Curva A - {stockCurveAShare >= 55 ? "alocação OK." : "alocação baixa."}</p>
                  {ruptureACount > 0 ? (
                    <p>Mas: <strong>{fmtInt(ruptureACount)} SKUs em ruptura</strong><br />({report.ruptureTable.filter((r) => r.curve === "A").length} são Curva A) - {fmtCurrency(ruptureARevenue, true)} de venda histórica no recorte.</p>
                  ) : null}
                  <p><strong style={{ color: "#d4a373" }}>Conclusão:</strong><br /><em>{diagConclusion}</em></p>
                </div>
              </div>
            </>
          );
        })()}
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Gargalos de reposição</div>
        <h1>{fmtInt(report.summary.ruptureCount)} SKUs ativos em ruptura</h1>
        <p className={styles.subtitle}>Aqui o foco fica só no que já rompeu estoque e concentra mais risco de venda no recorte.</p>
        {auditMode ? <AuditPanel audit={slideAudit.ruptureFocus} /> : null}
        <div className={`${styles.statGrid} ${styles.three}`}>
          <div className={`${styles.statCard} ${styles.accentTerracotta}`}>
            <div className={styles.statValue}>{fmtInt(report.ruptureTable.length)}</div>
            <div className={styles.statLabel}>Curva A em ruptura</div>
            <div className={styles.statNote}>maior risco imediato</div>
          </div>
          <div className={`${styles.statCard} ${styles.accentGold}`}>
            <div className={styles.statValue}>{fmtCurrency(report.ruptureTable.reduce((sum, row) => sum + row.revenue, 0), true)}</div>
            <div className={styles.statLabel}>Faturamento em risco</div>
            <div className={styles.statNote}>histórico dos itens A rompidos</div>
          </div>
          <div className={`${styles.statCard} ${styles.accentRose}`}>
            <div className={styles.statValue}>{fmtInt(report.ruptureTable.reduce((sum, row) => sum + row.quantity, 0))}</div>
            <div className={styles.statLabel}>Unidades vendidas</div>
            <div className={styles.statNote}>volume histórico em ruptura A</div>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Produto</th>
              <th>Cor</th>
              <th>Curva</th>
              <th>Estoque</th>
              <th>Vendeu período</th>
            </tr>
          </thead>
          <tbody>
            {report.ruptureTable.length > 0 ? (
              report.ruptureTable.slice(0, 8).map((row) => (
                <tr key={row.skuKey}>
                  <td>{row.description}</td>
                  <td>{row.corDescricao || row.cor || "-"}</td>
                  <td>{row.curve}</td>
                  <td>{fmtInt(row.stock)}</td>
                  <td>{fmtInt(row.quantity)}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>Nenhuma ruptura relevante neste recorte.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Detalhamento de rupturas</div>
        <h1>O mapa completo do estoque em risco</h1>
        <p className={styles.subtitle}>{fmtInt(report.summary.ruptureCount)} SKUs ativos em ruptura e {fmtInt(curveASkus)} itens A exigem leitura de impacto.</p>
        {auditMode ? <AuditPanel audit={slideAudit.ruptureDetail} /> : null}
        <div className={`${styles.twoCol} ${styles.riskLayout}`}>
          <div>
            <div className={styles.bucketList}>
              {report.stockBuckets.map((row) => (
                <div key={row.label} className={styles.bucketRow}>
                  <div className={styles.bucketLabel}>{row.label}</div>
                  <div>{fmtInt(row.count)}</div>
                  <div className={styles.bucketTrack}>
                    <div className={styles.bucketFill} style={{ width: `${toFiniteNumber(row.pct)}%` }} />
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
                <span>faturamento histórico</span>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>Drift de curva</div>
        <h1>Como o catálogo se move entre janelas</h1>
        <p className={styles.subtitle}>
          {hasComparableRecentWindow
            ? `Só ${fmtPct(report.summary.retention)} dos itens Curva A do período total permanecem A na janela recente ${report.range.recentLabel}. Variações abaixo de 0,25pp entram como estabilidade.`
            : `O recorte ${report.range.label} é curto demais para formar uma janela recente distinta. Por isso, este slide não calcula drift material e fica apenas como apoio de ranking.`}
        </p>
        {auditMode ? <AuditPanel audit={slideAudit.drift} /> : null}
        <div className={styles.driftBanner}>
          <div className={styles.driftHero}>
            {hasComparableRecentWindow
              ? (toFiniteNumber(report.summary.retention) < 70 ? "Rotação forte no topo" : toFiniteNumber(report.summary.retention) < 85 ? "Top mix em transição" : "Top mix mais estável")
              : "Janela recente indisponível"}
          </div>
          <div>
            PP significa pontos percentuais. Exemplo: sair de 10% para 12% = +2pp. {hasComparableRecentWindow
              ? "O resumo destaca movimentos materiais, e a tabela abaixo mostra os principais tipos mesmo quando a oscilação é pequena."
              : "Como não existe uma janela recente distinta dentro do recorte, não faz sentido afirmar ganho ou perda de participação aqui."}
          </div>
        </div>
        <div className={styles.driftGrid}>
          <div className={styles.driftCard}>
            <div className={styles.driftTitle}>Esquentando - tipos</div>
            <div className={styles.driftMain}>{report.warmingTypes.length > 0 ? report.warmingTypes.map((row) => `${row.label} (${fmtPp(row.deltaPp)})`).join(" · ") : "Sem alta material"}</div>
            <div className={styles.driftNote}>{report.warmingTypes.length > 0 ? `Tipos que ganharam participação em ${report.range.recentLabel}.` : "Nenhum tipo ganhou pelo menos 0,25pp na janela recente."}</div>
          </div>
          <div className={`${styles.driftCard} ${styles.terracotta}`}>
            <div className={styles.driftTitle}>Esfriando - coleções</div>
            <div className={styles.driftMain}>{report.coolingCollections.length > 0 ? report.coolingCollections.map((row) => `${row.label} (${fmtPp(row.deltaPp)})`).join(" · ") : "Sem queda material"}</div>
            <div className={styles.driftNote}>{report.coolingCollections.length > 0 ? "Coleções que perderam relevância recente no mix." : "Nenhuma coleção perdeu pelo menos 0,25pp na janela recente."}</div>
          </div>
        </div>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Part. total</th>
              <th>Part. recente</th>
              <th>Delta</th>
              <th>Sinal</th>
            </tr>
          </thead>
          <tbody>
            {report.movementTable.length > 0 ? report.movementTable.map((row) => (
              <tr key={row.label}>
                <td>{row.label}</td>
                <td>{fmtPct(row.share)}</td>
                <td>{fmtPct(row.recentShare)}</td>
                <td>{fmtDriftPp(row.deltaPp)}</td>
                <td>{fmtDriftSignal(row.deltaPp)}</td>
              </tr>
            )) : (
              <tr>
                <td colSpan={5}>
                  {hasComparableRecentWindow
                    ? "Sem movimentos relevantes entre o período total e a janela recente."
                    : "Sem leitura de drift: o recorte não forma uma janela recente distinta."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section className={styles.slide} data-pdf-slide="">
        <div className={styles.eyebrow}>A história em 5 atos</div>
        <h1>O que os dados realmente contam</h1>
        <p className={styles.subtitle}>Síntese executiva para leitura rápida do negócio.</p>
        {auditMode ? <AuditPanel audit={slideAudit.story} /> : null}
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
          <div className={styles.closingHeader}>
            <div className={`${styles.eyebrow} ${styles.closingEyebrow}`}>Conclusão</div>
            <h2>{report.closing.headline}</h2>
          </div>
          <p>{report.closing.body}</p>
          {auditMode ? <AuditPanel audit={slideAudit.closing} /> : null}
        </div>
        <div className={styles.closingRight}>
          <div className={styles.closingHeader}>
            <div className={`${styles.eyebrow} ${styles.closingEyebrow}`}>Próximos passos</div>
            <h1>Recomendações práticas</h1>
          </div>
          <div className={styles.recommendList}>
            {report.recommendations.map((row, index) => (
              <div key={row.title} className={styles.recommendCard}>
                <div className={styles.recommendIndex}>{String(index + 1).padStart(2, "0")}</div>
                <div className={styles.recommendBody}>
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
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [availableColecoes, setAvailableColecoes] = useState<MultiSelectOption[]>([]);
  const [availableSubgrupos, setAvailableSubgrupos] = useState<string[]>([]);
  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);
  const [availableGrades, setAvailableGrades] = useState<string[]>([]);
  const [loadingColecoes, setLoadingColecoes] = useState(false);
  const [loadingSubgrupos, setLoadingSubgrupos] = useState(false);
  const [loadingGrupos, setLoadingGrupos] = useState(false);
  const [loadingGrades, setLoadingGrades] = useState(false);
  const [reports, setReports] = useState<ClaudeReportPayload[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeReportIndex, setActiveReportIndex] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [auditMode, setAuditMode] = useState(false);
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

  async function loadFilterOptions(kind: "colecoes" | "subgrupos" | "grupos" | "grades") {
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
    selectedGrupos.forEach((item) => params.append("grupos", item));
    selectedGrades.forEach((item) => params.append("grades", item));

    if (kind === "colecoes") {
      setLoadingColecoes(true);
    } else if (kind === "subgrupos") {
      setLoadingSubgrupos(true);
    } else if (kind === "grupos") {
      setLoadingGrupos(true);
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
      } else if (kind === "grupos") {
        setAvailableGrupos(values as string[]);
      } else {
        setAvailableGrades(values as string[]);
      }
    } catch {
      if (kind === "colecoes") {
        setAvailableColecoes([]);
      } else if (kind === "subgrupos") {
        setAvailableSubgrupos([]);
      } else if (kind === "grupos") {
        setAvailableGrupos([]);
      } else {
        setAvailableGrades([]);
      }
    } finally {
      if (kind === "colecoes") {
        setLoadingColecoes(false);
      } else if (kind === "subgrupos") {
        setLoadingSubgrupos(false);
      } else if (kind === "grupos") {
        setLoadingGrupos(false);
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
          grupos: selectedGrupos,
          grades: selectedGrades,
          ranges: ranges.map((range) => ({
            start: formatDateForQuery(range.startDate),
            end: formatDateForQuery(range.endDate),
          })),
        }),
      });

      const json = (await response.json()) as { data?: ClaudeReportPayload[]; error?: string };
      if (!response.ok) {
        throw new Error(json.error ?? "Erro ao carregar Relatório Claude.");
      }

      setReports(json.data ?? []);
      setActiveReportIndex(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao carregar Relatório Claude.");
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
      await document.fonts.ready;

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);
      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });
      const pageWidthMm = doc.internal.pageSize.getWidth();
      const pageHeightMm = doc.internal.pageSize.getHeight();
      const marginMm = 8;
      const usableWidthMm = pageWidthMm - marginMm * 2;
      const usableHeightMm = pageHeightMm - marginMm * 2;

      for (const [index, slideElement] of slideElements.entries()) {
        if (index > 0) {
          doc.addPage();
        }

        const canvas = await html2canvas(slideElement, {
          backgroundColor: "#ffffff",
          scale: Math.min(window.devicePixelRatio || 1, 2),
          useCORS: true,
          logging: false,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: Math.max(slideElement.scrollWidth, 1440),
          windowHeight: Math.max(slideElement.scrollHeight, 900),
          onclone: (cloneDoc) => {
            cloneDoc.querySelectorAll("[data-pdf-hide]").forEach((element) => {
              (element as HTMLElement).style.display = "none";
            });

            cloneDoc.querySelectorAll<HTMLElement>("[data-pdf-slide]").forEach((element) => {
              element.style.width = "1280px";
              element.style.minHeight = "720px";
              element.style.height = "auto";
              element.style.margin = "0";
              element.style.boxShadow = "none";
            });

            // html2canvas divides stop positions by the gradient vector length.
            // Zero or negative inline dimensions → vector length 0 → NaN → addColorStop throws.
            cloneDoc.querySelectorAll<HTMLElement>("*[style]").forEach((el) => {
              const inlineW = el.style.width;
              const inlineH = el.style.height;
              const wVal = inlineW ? parseFloat(inlineW) : null;
              const hVal = inlineH ? parseFloat(inlineH) : null;
              if ((wVal !== null && wVal <= 0) || (hVal !== null && hVal <= 0)) {
                el.style.backgroundImage = "none";
                el.style.background = "transparent";
              }
            });
          },
        });

        const widthRatio = usableWidthMm / canvas.width;
        const heightRatio = usableHeightMm / canvas.height;
        const drawRatio = Math.min(widthRatio, heightRatio);
        const drawWidthMm = canvas.width * drawRatio;
        const drawHeightMm = canvas.height * drawRatio;
        const offsetXmm = (pageWidthMm - drawWidthMm) / 2;
        const offsetYmm = (pageHeightMm - drawHeightMm) / 2;

        doc.addImage(
          canvas.toDataURL("image/png"),
          "PNG",
          offsetXmm,
          offsetYmm,
          drawWidthMm,
          drawHeightMm,
          undefined,
          "FAST",
        );

        canvas.width = 0;
        canvas.height = 0;
      }

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
    setSelectedGrupos((current) => current.filter((item) => availableGrupos.includes(item)));
  }, [availableGrupos]);

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
            <div className={styles.pageEyebrow}>ScarfMe - Análise nativa</div>
            <h1 className={styles.pageTitle}>Relatório Claude</h1>
            <p className={styles.pageSubtitle}>
              Mesmo espírito visual do HTML gerado no Python, agora direto na dashboard com filtros dinâmicos e múltiplos períodos.
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              className={`${styles.secondaryButton} ${auditMode ? styles.auditButtonActive : ""}`}
              onClick={() => setAuditMode((current) => !current)}
            >
              {auditMode ? "Ocultar auditoria" : "Modo auditoria"}
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => void handleExportPdf()}
              disabled={loading || exportingPdf || !reports[activeReportIndex]}
            >
              {exportingPdf ? "Exportando PDF..." : "Exportar PDF"}
            </button>
            <button type="button" className={styles.generateButton} onClick={() => void generateReport()} disabled={loading}>
              {loading ? "Gerando..." : "Gerar análise"}
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
            label="Coleções"
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
            label="Grupos"
            value={selectedGrupos}
            options={availableGrupos}
            onChange={setSelectedGrupos}
            onOpen={() => void loadFilterOptions("grupos")}
            loading={loadingGrupos}
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
              <div className={styles.sectionTitle}>Períodos</div>
              <div className={styles.sectionSubtitle}>Adicione mais de um range quando quiser comparar leituras diferentes do mix.</div>
            </div>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setRanges((current) => [...current, createEmptyRange()])}
            >
              + Adicionar período
            </button>
          </div>
          <div className={styles.rangesGrid}>
            {ranges.map((range, index) => (
              <div key={`${index}-${range.startDate.toISOString()}-${range.endDate.toISOString()}`} className={styles.rangeCard}>
                <div className={styles.rangeCardTop}>
                  <strong>Período {index + 1}</strong>
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

      {reports[activeReportIndex] ? <ReportView report={reports[activeReportIndex]} deckRef={deckRef} auditMode={auditMode} /> : null}
    </div>
  );
}

"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { startOfMonth, endOfMonth } from "date-fns";
import {
  aggregateEstoquePorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  getFilialLabelForDisplay,
  resolveCompany,
  type CompanyConfig,
  type CompanyKey,
} from "@/lib/config/company";
import {
  OUTROS_LABEL,
  filterOutrosKeys,
  getOutrosTooltip,
  isOutrosCategory,
} from "@/lib/performance/outrosCategories";
import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import {
  clearControleEstoqueMetricasClientCache,
  fetchControleEstoqueMetricasItensClient,
} from "@/lib/client/controle-estoque-metricas";
import {
  buildControleEstoqueItemKey,
  mergeControleEstoqueMetricasEntries,
  type ControleEstoqueItemMetricas,
} from "@/lib/utils/controle-estoque-metricas";
import {
  buildCompraTransitoIndex,
  fetchComprasTransitoClient,
  getCompraTransitoEntries,
  type CompraTransitoIndex,
} from "@/lib/client/compras-transito";
import { formatDateForQuery } from "@/lib/utils/date";
import { applyTransitToSuggestion } from "@/lib/utils/compra-transito-analytics";
import { calcCompraIdealFromResumo, type CompraIdealResult } from "@/lib/utils/compra-ideal";
import CompraIdealCell from "@/components/shared/CompraIdealCell";
import { useCatracaDataCompra, type CatracaFreeze } from "@/lib/client/use-catraca-data-compra";
import {
  partesDestinoCompraFinal,
  type DestinoCompraFinalParte,
} from "@/lib/utils/compra-final-destino";
import {
  calcNecessidadeMinimaQty,
  calcTotalPerFilialFiliais,
  combineBaseSuggestionWithNecessidadeMinima,
  formatNecessidadeMinimaFiliaisDescription,
  type FilialNecessidadeMinimaInfo,
} from "@/lib/utils/necessidade-minima";
import {
  getReposicaoBaseType as getSharedReposicaoBaseType,
  getReposicaoCompraView as getSharedReposicaoCompraView,
} from "@/lib/utils/suggestion-rules";
import type { ProdutoAgrupadoMember } from "@/lib/utils/produtos-agrupados";
import { isProdutoAgrupadoSyntheticId } from "@/lib/utils/produtos-agrupados";
import FilialVendedoresTab from "./FilialVendedoresTab";
import { exportCurvaAbcSimpleCsv } from "@/lib/utils/exportCurvaAbcSimpleCsv";
import { exportCurvaAbcSimpleXlsx, type CurvaAbcSimpleXlsxRow } from "@/lib/utils/exportCurvaAbcSimpleXlsx";
import { exportCompraIdealPorFilialToXlsx } from "@/lib/utils/exportListaLoja";
import styles from "./FilialPerformancePage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface QtdePorFilialEntry {
  filial: string;
  displayName: string;
  qtde: number;
  activeFilialName?: string;
}

interface ProdutoRow {
  produto: string;
  descricao: string;
  categoria: string;
  linha?: string;
  subgrupo?: string;
  tipoProduto?: string;
  colecao?: string;
  grade?: string;
  cor?: string;
  corDescricao?: string;
  codigoBarra?: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
  qtdePorFilial?: QtdePorFilialEntry[];
  estoque?: number;
  estoquePorFilial?: QtdePorFilialEntry[];
  estoqueRede?: number;
  estoqueRedePorFilial?: QtdePorFilialEntry[];
  qtde12m?: number;
  mesesHistoricoFilial?: number;
  diasDesdeUltimaVenda?: number | null;
  isGroupedProduct?: boolean;
  groupId?: string | null;
  groupedMembers?: ProdutoAgrupadoMember[];
  descontinuado?: boolean;
}

type FilialFilterCompanyConfig = Pick<
  CompanyConfig,
  "filialFilters" | "filialDisplayNames" | "filialGroups" | "activeFilials" | "ecommerceFilials"
>;

interface FilialData {
  filial: string | null;
  displayName: string;
  porCor?: boolean;
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
  companyConfig?: FilialFilterCompanyConfig;
  produtos: ProdutoRow[];
}

type Curva = "A" | "B" | "C";
type StockBucket = "high" | "low" | "zero";

interface ProdutoComCurva extends ProdutoRow {
  curva: Curva;
  percParticipacao: number;
  percCumulativa: number;
}

type CompraMetricRow = {
  qtde12m: number | null;
  qtde60d: number | null;
  vendasMesAtual: number | null;
  estoqueFilial: number | null;
  diasDesdeUltimaVenda: number | null;
  mesesHistoricoFilial: number | null;
  diasComEstoquePositivo: number | null;
  diasSemEstoque: number | null;
  mesesDisponiveis: number | null;
  velocidadeAjustada: number | null;
  ritmoDiasComEstoque: number | null;
  ritmoVendasPeriodo: number | null;
  ritmoInicioIso: string | null;
  ritmoFimIso: string | null;
  ritmoDiasComVenda: number | null;
  ritmoPrimeiraVendaIso: string | null;
  ritmoUltimaVendaIso: string | null;
  totalNmQty: number | null;
  filiaisNM: FilialNecessidadeMinimaInfo[] | null;
  vendasPorFilial: Array<{
    filial: string;
    qtde12m: number;
    qtde60d?: number;
    qtdeMesAtual?: number;
    diasDesdeUltimaVenda?: number | null;
    mesesHistoricoFilial?: number | null;
    diasSemEstoque?: number | null;
    velocidadeAjustada?: number | null;
    mesesDisponiveis?: number | null;
    diasComEstoquePositivo?: number | null;
  }> | null;
  estoquePorFilial: Array<{ filial: string; estoque: number }> | null;
};

interface CurvaAbcObservacaoRecord {
  produto: string;
  cor: string;
  filial?: string;
  observacao: string;
}

interface ObservacaoModalState {
  produto: string;
  cor: string | null;
  usarCor: boolean;
  titulo: string;
  codigo: string;
  corLabel: string | null;
  filialLabel: string;
  /** A observação exibida vem do padrão (Todas as filiais), não desta filial. */
  inherited: boolean;
}

const EMPTY_COMPRA_METRIC_ROW: CompraMetricRow = {
  qtde12m: null,
  qtde60d: null,
  vendasMesAtual: null,
  estoqueFilial: null,
  diasDesdeUltimaVenda: null,
  mesesHistoricoFilial: null,
  diasComEstoquePositivo: null,
  diasSemEstoque: null,
  mesesDisponiveis: null,
  velocidadeAjustada: null,
  ritmoDiasComEstoque: null,
  ritmoVendasPeriodo: null,
  ritmoInicioIso: null,
  ritmoFimIso: null,
  ritmoDiasComVenda: null,
  ritmoPrimeiraVendaIso: null,
  ritmoUltimaVendaIso: null,
  totalNmQty: null,
  filiaisNM: null,
  vendasPorFilial: null,
  estoquePorFilial: null,
};

/** Compra Ideal (regra global) a partir do CompraMetricRow + trânsito do produto. */
function buildCompraIdealFromMetricRow(
  live: CompraMetricRow | undefined,
  p: { produto: string; cor?: string | null; linha?: string | null; subgrupo?: string | null },
  comprasTransitoIndex: CompraTransitoIndex,
  porCor: boolean,
  company?: string | null
): CompraIdealResult {
  return calcCompraIdealFromResumo(
    {
      estoqueTotal: live?.estoqueFilial ?? 0,
      qtde60d: live?.qtde60d ?? null,
      ritmoDiasComEstoque: live?.ritmoDiasComEstoque ?? null,
      ritmoVendasPeriodo: live?.ritmoVendasPeriodo ?? null,
      ritmoInicioIso: live?.ritmoInicioIso ?? null,
      ritmoFimIso: live?.ritmoFimIso ?? null,
      ritmoDiasComVenda: live?.ritmoDiasComVenda ?? null,
      ritmoPrimeiraVendaIso: live?.ritmoPrimeiraVendaIso ?? null,
      ritmoUltimaVendaIso: live?.ritmoUltimaVendaIso ?? null,
    },
    getCompraTransitoEntries(comprasTransitoIndex, p.produto, porCor ? (p.cor ?? null) : null),
    { linha: p.linha, subgrupo: p.subgrupo, company }
  );
}

const STOCK_BUCKET_ORDER: StockBucket[] = ["high", "low", "zero"];
const STOCK_BUCKET_LABEL: Record<StockBucket, string> = {
  high: "5+ estoque",
  low: "1-4 estoque",
  zero: "0 estoque",
};

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

function formatObservacaoPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "Sem observação";
  return trimmed;
}

const MESES_PT = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
function getPeriodoRef(diasSemEstoque: number, diasComEstoquePositivo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - Math.round(diasSemEstoque + diasComEstoquePositivo / 2));
  return `${MESES_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

function getTooltipViewportPosition(x: number, y: number): { left: number; top: number } {
  const offset = 12;
  const tooltipWidth = 360;
  const tooltipHeight = 280;
  const margin = 12;
  if (typeof window === "undefined") {
    return { left: x + offset, top: y - tooltipHeight - offset };
  }
  const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
  const left = Math.min(Math.max(margin, x + offset), maxLeft);
  const topAbove = y - tooltipHeight - offset;
  const maxTop = Math.max(margin, window.innerHeight - tooltipHeight - margin);
  const top = Math.min(Math.max(margin, topAbove), maxTop);
  return { left, top };
}

function renderTooltipFilialLabel(entry: QtdePorFilialEntry): React.ReactNode {
  if (!entry.activeFilialName) return entry.displayName;
  const activeCode = entry.activeFilialName.trim().split(/\s+/).pop() || entry.activeFilialName;
  return (
    <>
      <span className={styles.tooltipFilialPrimary}>{entry.displayName}</span>
      <span className={styles.tooltipFilialSecondary}>({activeCode})</span>
    </>
  );
}

function renderInlineTooltipFilialLabel(entry: QtdePorFilialEntry): React.ReactNode {
  if (!entry.activeFilialName) return <span className={styles.inlineTooltipFilialPrimary}>{entry.displayName}</span>;
  const activeCode = entry.activeFilialName.trim().split(/\s+/).pop() || entry.activeFilialName;
  return (
    <>
      <span className={styles.inlineTooltipFilialPrimary}>{entry.displayName}</span>
      <span className={styles.inlineTooltipFilialSecondary}>({activeCode})</span>
    </>
  );
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatCompactSignedPctForBadge(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  const absRounded = Math.round(Math.abs(value));
  if (absRounded <= 999) return `${sign}${absRounded}%`;

  const thousands = Math.floor(absRounded / 1000);
  if (thousands <= 999) return `${sign}${thousands}K%`;

  return `${sign}999K%`;
}

function getStockBucket(estoque: number | undefined): StockBucket {
  const value = Number(estoque ?? 0);
  if (value <= 0) return "zero";
  if (value < 5) return "low";
  return "high";
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
      if (factor > 0) {
        previousSales += current / factor;
      }
    }
  }

  if (!hasAny) return null;

  const pct = (currentSales / totalSales) * 100;
  const deltaPct = previousSales > 0
    ? ((currentSales - previousSales) / previousSales) * 100
    : null;

  return { pct: Math.round(pct), deltaPct, currentSales, previousSales };
}

// ─── ABC helpers ──────────────────────────────────────────────────────────────

function formatProductInfoValue(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  return trimmed.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCollectionCode(value?: string | null): string {
  return value?.trim() ?? "";
}

function splitGroupedMemberValues(value?: string | null): string[] {
  return String(value ?? "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatGroupedMemberShortName(value?: string | null): string {
  const words = String(value ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return "";
  return words.slice(0, 2).join(" ");
}

function formatGroupedMemberColors(member: ProdutoAgrupadoMember): string {
  return Array.from(
    new Set(splitGroupedMemberValues(member.corDescricao || member.cor))
  ).join(" / ");
}

function renderGroupedMemberLabel(member: ProdutoAgrupadoMember, shortName: boolean): React.ReactNode {
  const displayName = shortName
    ? formatGroupedMemberShortName(member.descricao) || member.produto
    : member.descricao || member.produto;
  const colors = formatGroupedMemberColors(member);

  return (
    <span className={styles.inlineTooltipLabel}>
      {displayName}
      <span className={styles.inlineTooltipCode}>{member.produto}</span>
      {colors && <span className={styles.inlineTooltipMeta}>{colors}</span>}
    </span>
  );
}

function calcularCurvas(produtos: ProdutoRow[]): ProdutoComCurva[] {
  const totalGeral = produtos.reduce((s, p) => s + p.vendas, 0);
  let cumulative = 0;
  return produtos.map((p): ProdutoComCurva => {
    cumulative += p.vendas;
    const percCum = totalGeral > 0 ? cumulative / totalGeral : 1;
    const curva: Curva = percCum <= 0.60 ? "A" : percCum <= 0.90 ? "B" : "C";
    const percParticipacao = totalGeral > 0 ? (p.vendas / totalGeral) * 100 : 0;
    return { ...p, curva, percParticipacao, percCumulativa: percCum };
  });
}

const CURVA_LABEL: Record<Curva, string> = {
  A: "Curva A — 60% do faturamento",
  B: "Curva B — 30% do faturamento",
  C: "Curva C — 10% do faturamento",
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

const METRICAS_CHUNK_SIZE = 40;

// ─── Category helpers ─────────────────────────────────────────────────────────

function getCategoryHeaderLabel(category: string): string {
  const normalized = category.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  if (normalized.includes("APROVEITAMENTO") && normalized.includes("LENC")) return "Ap. Lenços";
  return category.toLowerCase().replace(/^\w/, c => c.toUpperCase());
}

function normalizeKey(v?: string | null): string {
  return (v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toUpperCase();
}

function getMesesHistoricoFilial(item: { mesesHistoricoFilial?: number }): number {
  const meses = Number(item.mesesHistoricoFilial ?? 12);
  if (!Number.isFinite(meses)) return 12;
  return Math.min(12, Math.max(1, meses));
}

function getLimiteDiasReposicao(item: { linha?: string | null; subgrupo?: string | null }) {
  const linha = normalizeKey(item.linha);
  const subgrupo = normalizeKey(item.subgrupo);
  if (linha === "INDIA") return 90;
  if (linha === "ELETRONICOS") return 30;
  const subgrupos90 = new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]);
  if (subgrupos90.has(subgrupo)) return 90;
  return 60;
}

function getSuggestedDelta(
  item: { vendasMesAtual?: number; estoqueFilial?: number; linha?: string | null; subgrupo?: string | null },
  diasCorridosMes: number
): number | null {
  const vendasMes = Number(item.vendasMesAtual ?? 0);
  if (vendasMes <= 0 || diasCorridosMes <= 0) return 0;
  const consumoDiario = vendasMes / diasCorridosMes;
  if (consumoDiario <= 0) return 0;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const limiteDias = getLimiteDiasReposicao(item);
  const duracaoAtual = estoqueAtual / consumoDiario;
  if (duracaoAtual >= limiteDias) return 0;
  const qtd = Math.ceil(consumoDiario * (limiteDias - duracaoAtual));
  return Number.isFinite(qtd) ? Math.max(0, qtd) : 0;
}

function calcQtdSugestaoS(item: {
  qtde12m?: number;
  mesesHistoricoFilial?: number;
  linha?: string | null;
  subgrupo?: string | null;
}): number {
  const mediaVendasMes = Number(item.qtde12m ?? 0) / getMesesHistoricoFilial(item);
  const limiteDias = getLimiteDiasReposicao(item);
  return Math.max(0, Math.ceil((limiteDias / 30) * mediaVendasMes));
}

function calcQtdSugestaoEInfo(item: {
  qtde12m?: number;
  diasDesdeUltimaVenda?: number | null;
  mesesHistoricoFilial?: number;
  linha?: string | null;
  subgrupo?: string | null;
}): {
  qtd: number;
  velocidadeAjustada: number;
  mesesSemVenda: number;
  mesesAtivos: number;
} | null {
  const qtde12m = Number(item.qtde12m ?? 0);
  if (qtde12m <= 0) return null;
  const dias = item.diasDesdeUltimaVenda;
  if (dias == null || dias < 30) return null;
  const mesesBase = getMesesHistoricoFilial(item);
  const mesesSemVenda = dias / 30;
  const mesesAtivos = mesesBase - mesesSemVenda;
  if (mesesAtivos < 1) return null;
  const velocidadeAjustada = qtde12m / mesesAtivos;
  if (velocidadeAjustada < 0.5) return null;
  const limiteDias = getLimiteDiasReposicao(item);
  const qtd = Math.max(1, Math.ceil((limiteDias / 30) * velocidadeAjustada));
  return { qtd, velocidadeAjustada, mesesSemVenda, mesesAtivos };
}

function hasSugestaoE(item: {
  estoqueFilial?: number;
  qtde12m?: number;
  diasDesdeUltimaVenda?: number | null;
  mesesHistoricoFilial?: number;
  linha?: string | null;
  subgrupo?: string | null;
}): boolean {
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  if (estoqueAtual > 0) return false;
  return calcQtdSugestaoEInfo(item) !== null;
}

function getReposicaoCompraView(
  item: {
    vendasMesAtual?: number;
    estoqueFilial?: number;
    linha?: string | null;
    subgrupo?: string | null;
    qtde12m?: number;
    mesesHistoricoFilial?: number;
    diasDesdeUltimaVenda?: number | null;
    diasComEstoquePositivo?: number | null;
    diasSemEstoque?: number | null;
    mesesDisponiveis?: number | null;
    velocidadeAjustada?: number | null;
  },
  diasCorridosMes: number
): {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO: number;
  qtdNM: number;
  qtdSuficiente: boolean;
  semSugestao: boolean;
  sData?: import("@/lib/utils/suggestion-rules").SuggestionSData;
  eData?: import("@/lib/utils/suggestion-rules").SuggestionEData;
  poData?: import("@/lib/utils/suggestion-rules").SuggestionPOData;
  compraData?: import("@/lib/utils/suggestion-rules").SuggestionCompraData;
} {
  const sugestao = getSharedReposicaoCompraView(
    {
      qtde12m: item.qtde12m,
      vendasMesAtual: item.vendasMesAtual,
      estoqueAtual: item.estoqueFilial,
      linha: item.linha,
      subgrupo: item.subgrupo,
      diasDesdeUltimaVenda: item.diasDesdeUltimaVenda,
      mesesHistoricoFilial: item.mesesHistoricoFilial,
      diasComEstoquePositivo: item.diasComEstoquePositivo,
      diasSemEstoque: item.diasSemEstoque,
      mesesDisponiveis: item.mesesDisponiveis,
      velocidadeAjustada: item.velocidadeAjustada,
    },
    diasCorridosMes
  );
  return {
    qtdFinal: sugestao.qtdFinal,
    qtdS: sugestao.qtdS,
    qtdE: sugestao.qtdE,
    qtdPO: sugestao.qtdPO,
    qtdNM: sugestao.qtdNM,
    qtdSuficiente: sugestao.qtdSuficiente,
    semSugestao: sugestao.semSugestao,
    sData: sugestao.sData,
    eData: sugestao.eData,
    poData: sugestao.poData,
    compraData: sugestao.compraData,
  };
}

function getReposicaoBaseType(sugestao: {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO?: number;
  qtdNM?: number;
  qtdSuficiente: boolean;
}): "COMPRA" | "S" | "E" | "PO" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO" {
  return getSharedReposicaoBaseType(sugestao);
}

function getSuggestedQtyFromReposicaoView(sugestao: {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO?: number;
  qtdNM?: number;
}): number {
  return sugestao.qtdFinal > 0
    ? sugestao.qtdFinal
    : sugestao.qtdS > 0
      ? sugestao.qtdS
      : sugestao.qtdE > 0
        ? sugestao.qtdE
        : (sugestao.qtdPO ?? 0) > 0
          ? (sugestao.qtdPO ?? 0)
          : (sugestao.qtdNM ?? 0);
}

type FilialCompraSuggestionRow = {
  filial: string;
  qty: number;
  baseType: "COMPRA" | "S" | "E" | "PO" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO";
  qtde12m: number;
  vendasMesAtual: number;
  estoqueAtual: number;
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
  mesesDisponiveis: number;
  velocidadeAjustada: number;
  poData?: import("@/lib/utils/suggestion-rules").SuggestionPOData;
};

type PerFilialCompraSummary = {
  totalQty: number;
  topType: "COMPRA" | "S" | "E" | "PO" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO";
  hasPo: boolean;
  hasNm: boolean;
  rows: FilialCompraSuggestionRow[];
  distribuicao: DestinoCompraFinalParte[];
  poRows: FilialCompraSuggestionRow[];
  poPrincipal: FilialCompraSuggestionRow | null;
};

function buildPerFilialCompraSummary(input: {
  companyKey: CompanyKey;
  linha?: string | null;
  subgrupo?: string | null;
  diasCorridosMes: number;
  live: CompraMetricRow;
}): PerFilialCompraSummary | null {
  if (!input.live.vendasPorFilial || input.live.vendasPorFilial.length === 0) return null;
  const company = resolveCompany(input.companyKey);
  const estoquePorFilial = aggregateEstoquePorFilialByDisplayLabel(
    (input.live.estoquePorFilial ?? []).map((row) => ({
      filial: row.filial,
      estoque: Number(row.estoque ?? 0),
    })),
    company
  );
  const estoqueMap = new Map<string, number>(
    estoquePorFilial.map((row) => [row.filial, Number(row.estoque ?? 0)])
  );

  const vendasMap = new Map<
    string,
    {
      filial: string;
      qtde12m: number;
      qtdeMesAtual: number;
      diasDesdeUltimaVenda: number | null;
      mesesHistoricoFilial: number;
      diasComEstoquePositivo: number;
      diasSemEstoque: number;
      mesesDisponiveis: number;
      velocidadeAjustada: number;
    }
  >();

  for (const row of input.live.vendasPorFilial) {
    const filial = getFilialLabelForDisplay(company, row.filial);
    const current = vendasMap.get(filial) ?? {
      filial,
      qtde12m: 0,
      qtdeMesAtual: 0,
      diasDesdeUltimaVenda: null,
      mesesHistoricoFilial: 0,
      diasComEstoquePositivo: 0,
      diasSemEstoque: 365,
      mesesDisponiveis: 0,
      velocidadeAjustada: 0,
    };
    current.qtde12m += Number(row.qtde12m ?? 0);
    current.qtdeMesAtual += Number(row.qtdeMesAtual ?? 0);
    current.diasDesdeUltimaVenda =
      current.diasDesdeUltimaVenda == null
        ? (row.diasDesdeUltimaVenda ?? null)
        : row.diasDesdeUltimaVenda == null
          ? current.diasDesdeUltimaVenda
          : Math.min(current.diasDesdeUltimaVenda, row.diasDesdeUltimaVenda);
    current.mesesHistoricoFilial = Math.max(current.mesesHistoricoFilial, Number(row.mesesHistoricoFilial ?? 0));
    current.diasComEstoquePositivo = Math.max(current.diasComEstoquePositivo, Number(row.diasComEstoquePositivo ?? 0));
    current.diasSemEstoque = Math.min(current.diasSemEstoque, Number(row.diasSemEstoque ?? 365));
    current.mesesDisponiveis = Math.max(current.mesesDisponiveis, Number(row.mesesDisponiveis ?? 0));
    current.velocidadeAjustada = Math.max(current.velocidadeAjustada, Number(row.velocidadeAjustada ?? 0));
    vendasMap.set(filial, current);
  }

  const rows = Array.from(vendasMap.values())
    .map((row) => {
      const diasComEstoquePositivo = Math.max(0, Math.round(row.diasComEstoquePositivo));
      const mesesDisponiveis = diasComEstoquePositivo > 0 ? diasComEstoquePositivo / 30 : 0;
      const velocidadeAjustada = mesesDisponiveis > 0 ? row.qtde12m / mesesDisponiveis : 0;
      const diasSemEstoque = Math.max(0, row.diasSemEstoque);
      const estoqueAtual = estoqueMap.get(row.filial) ?? 0;
      const sugestao = getReposicaoCompraView(
        {
          vendasMesAtual: row.qtdeMesAtual,
          estoqueFilial: estoqueAtual,
          linha: input.linha ?? "",
          subgrupo: input.subgrupo ?? "",
          qtde12m: row.qtde12m,
          mesesHistoricoFilial: row.mesesHistoricoFilial,
          diasDesdeUltimaVenda: row.diasDesdeUltimaVenda,
          diasComEstoquePositivo,
          diasSemEstoque,
          mesesDisponiveis,
          velocidadeAjustada,
        },
        input.diasCorridosMes
      );
      return {
        filial: row.filial,
        qty: getSuggestedQtyFromReposicaoView(sugestao),
        baseType: getReposicaoBaseType(sugestao),
        qtde12m: row.qtde12m,
        vendasMesAtual: row.qtdeMesAtual,
        estoqueAtual,
        diasComEstoquePositivo,
        diasSemEstoque,
        mesesDisponiveis,
        velocidadeAjustada,
        poData: sugestao.poData,
      } satisfies FilialCompraSuggestionRow;
    })
    .filter((row) => row.qty > 0)
    .sort((a, b) => compareFilialDisplayOrder(a.filial, b.filial, company));

  if (rows.length === 0) return null;

  const totalQty = rows.reduce((sum, row) => sum + row.qty, 0);
  const qtyByType = new Map<string, number>();
  for (const row of rows) {
    qtyByType.set(row.baseType, (qtyByType.get(row.baseType) ?? 0) + row.qty);
  }
  const typePriority = ["COMPRA", "S", "E", "PO", "NM"] as const;
  let topType: PerFilialCompraSummary["topType"] = "SEM_SUGESTAO";
  let topQty = -1;
  for (const type of typePriority) {
    const qty = qtyByType.get(type) ?? 0;
    if (qty > topQty) {
      topQty = qty;
      topType = type;
    }
  }
  const poRows = rows.filter((row) => row.poData || row.baseType === "PO");
  const poPrincipal = poRows.length > 0
    ? poRows.slice().sort((a, b) => b.qty - a.qty)[0] ?? null
    : null;

  return {
    totalQty,
    topType,
    hasPo: poPrincipal != null,
    hasNm: rows.some((row) => row.baseType === "NM"),
    rows,
    distribuicao: rows.map((row) => ({
      label: row.filial,
      qtd: row.qty,
      qtde12m: row.qtde12m,
      isNM: row.baseType === "NM" || undefined,
      nmQty: row.baseType === "NM" ? row.qty : undefined,
    })),
    poRows,
    poPrincipal,
  };
}

function buildCurvaAbcMetricKey(
  produto?: string | null,
  corProduto?: string | null,
  porCor: boolean = true
): string {
  return buildControleEstoqueItemKey(produto, porCor ? corProduto : null);
}

function buildProductDetalhadoHref(
  companyKey: CompanyKey,
  p: Pick<ProdutoRow, "produto" | "descricao" | "cor">
): string {
  if (isProdutoAgrupadoSyntheticId(p.produto)) {
    return "#";
  }
  const params = new URLSearchParams();
  params.set("productId", p.produto.trim());
  params.set("name", (p.descricao || p.produto).trim());
  const cor = (p.cor ?? "").trim();
  if (cor) params.set("colors", cor);
  return `/${companyKey}/produto-detalhado?${params.toString()}`;
}

function buildProductPerformanceHref(
  companyKey: CompanyKey,
  p: Pick<ProdutoRow, "produto" | "descricao" | "cor">
): string {
  if (isProdutoAgrupadoSyntheticId(p.produto)) {
    return "#";
  }
  const params = new URLSearchParams();
  params.set("productId", p.produto.trim());
  params.set("name", (p.descricao || p.produto).trim());
  const cor = (p.cor ?? "").trim();
  if (cor) params.set("colors", cor);
  return `/${companyKey}/produto-performance?${params.toString()}`;
}

function renderRowActionIcons(
  companyKey: CompanyKey,
  p: Pick<ProdutoRow, "produto" | "descricao" | "cor">
): React.ReactNode {
  const name = p.descricao || p.produto;
  return (
    <>
      <Link
        href={buildProductDetalhadoHref(companyKey, p)}
        className={styles.productDetailIcon}
        title="Abrir produto detalhado"
        aria-label={`Abrir produto detalhado de ${name}`}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M1.75 10C3.3 6.95 6.3 5 10 5C13.7 5 16.7 6.95 18.25 10C16.7 13.05 13.7 15 10 15C6.3 15 3.3 13.05 1.75 10Z"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </Link>
      <Link
        href={buildProductPerformanceHref(companyKey, p)}
        className={`${styles.productDetailIcon} ${styles.productPerformanceIcon}`}
        title="Abrir produto performance"
        aria-label={`Abrir produto performance de ${name}`}
      >
        <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path
            d="M3 15.5C2.2 14 1.75 12.05 1.75 10C1.75 5.45 5.45 1.75 10 1.75C14.55 1.75 18.25 5.45 18.25 10C18.25 12.05 17.8 14 17 15.5"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M10 10L13.2 6.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10" cy="10" r="1.4" fill="currentColor" />
        </svg>
      </Link>
    </>
  );
}

function renderGroupedMetricTooltip(
  product: ProdutoRow,
  title: string,
  value: React.ReactNode,
  valueFormatter: (value: number) => string,
  valueSelector: (member: ProdutoAgrupadoMember) => number,
  options?: { totalValue?: number; alignRight?: boolean }
): React.ReactNode {
  const groupedMembers = product.groupedMembers ?? [];
  if (!product.isGroupedProduct || groupedMembers.length === 0) {
    return value;
  }

  return (
    <div className={styles.inlineTooltipWrapper}>
      <span className={styles.inlineTooltipTrigger}>{value}</span>
      <div
        className={`${styles.inlineTooltipPanel}${options?.alignRight ? ` ${styles.inlineTooltipPanelRight}` : ""}`}
      >
        <div className={styles.inlineTooltipTitle}>{title}</div>
        <div className={styles.inlineTooltipList}>
          {groupedMembers.map((member) => (
            <div key={member.produto} className={styles.inlineTooltipRow}>
              {renderGroupedMemberLabel(member, true)}
              <span className={styles.inlineTooltipValue}>
                {valueFormatter(valueSelector(member))}
              </span>
            </div>
          ))}
        </div>
        {groupedMembers.length > 1 && typeof options?.totalValue === "number" && (
          <div className={styles.inlineTooltipFooter}>
            <span>Total</span>
            <span>{valueFormatter(options.totalValue)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function renderFilialMetricTooltip(
  title: string,
  value: React.ReactNode,
  entries: QtdePorFilialEntry[],
  valueFormatter: (value: number) => string
): React.ReactNode {
  if (entries.length === 0) {
    return value;
  }

  const totalValue = entries.reduce((sum, entry) => sum + Number(entry.qtde ?? 0), 0);

  return (
    <div className={styles.inlineTooltipWrapper}>
      <span className={styles.inlineTooltipTrigger}>{value}</span>
      <div className={`${styles.inlineTooltipPanel} ${styles.inlineTooltipPanelRight}`}>
        <div className={styles.inlineTooltipTitle}>{title}</div>
        <div className={styles.inlineTooltipList}>
          {entries.map((entry) => (
            <div key={entry.filial} className={styles.inlineTooltipRow}>
              <span className={styles.inlineTooltipLabel}>
                <span className={styles.inlineTooltipFilial}>
                  {renderInlineTooltipFilialLabel(entry)}
                </span>
              </span>
              <span className={styles.inlineTooltipValue}>{valueFormatter(entry.qtde)}</span>
            </div>
          ))}
        </div>
        {entries.length > 1 && (
          <div className={styles.inlineTooltipFooter}>
            <span>Total</span>
            <span>{valueFormatter(totalValue)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ObservacaoEditorModal({
  modal,
  saving,
  error,
  initialValue,
  onClose,
  onSave,
}: {
  modal: ObservacaoModalState;
  saving: boolean;
  error?: string;
  initialValue: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className={styles.obsModalOverlay} onClick={onClose}>
      <div className={styles.obsModal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.obsModalHeader}>
          <div>
            <h3 className={styles.obsModalTitle}>Observação do item</h3>
            <div className={styles.obsModalMeta}>
              <strong>{modal.titulo}</strong>
              <span>Cód. {modal.codigo}</span>
              {modal.corLabel && <span>Cor: {modal.corLabel}</span>}
              <span>Filial: {modal.filialLabel}</span>
            </div>
          </div>
          <button
            type="button"
            className={styles.obsModalClose}
            onClick={onClose}
            aria-label="Fechar modal de observação"
          >
            ×
          </button>
        </div>
        <div className={styles.obsModalBody}>
          <textarea
            className={styles.obsInput}
            value={draft}
            maxLength={240}
            rows={7}
            placeholder="Escreva uma observação para este item"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (!(e.key === "Enter" && (e.metaKey || e.ctrlKey))) return;
              e.preventDefault();
              onSave(draft);
            }}
          />
          <div className={styles.obsModalHint}>{draft.trim().length}/240 caracteres</div>
          <div className={styles.obsModalScopeNote}>
            {modal.filialLabel === "Todas as filiais"
              ? "Esta é a observação padrão: vale para todas as filiais que ainda não tiverem uma própria."
              : modal.inherited
                ? `Mostrando a observação padrão. Ao salvar, ela passa a valer só para ${modal.filialLabel}. Limpar volta a usar o padrão.`
                : `Observação específica de ${modal.filialLabel}. Limpar volta a usar a observação padrão (Todas as filiais).`}
          </div>
          {error && <div className={styles.obsModalError}>{error}</div>}
        </div>
        <div className={styles.obsModalFooter}>
          <button
            type="button"
            className={styles.obsModalButtonGhost}
            disabled={saving || draft.length === 0}
            onClick={() => setDraft("")}
          >
            Limpar
          </button>
          <button type="button" className={styles.obsModalButtonSecondary} onClick={onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className={styles.obsModalButtonPrimary}
            disabled={saving}
            onClick={() => onSave(draft)}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

const ObservacaoCell = React.memo(function ObservacaoCell({
  produto,
  cor,
  usarCor,
  filialScope,
  filialLabel,
  inherited,
  titulo,
  codigo,
  corLabel,
  observacao,
  onSave,
}: {
  produto: string;
  cor: string | null;
  usarCor: boolean;
  filialScope: string;
  filialLabel: string;
  inherited: boolean;
  titulo: string;
  codigo: string;
  corLabel: string | null;
  observacao: string;
  onSave: (input: { produto: string; cor: string | null; usarCor: boolean; filialScope: string; rawValue: string }) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const possuiObservacao = observacao.trim().length > 0;
  const mostrarHerdada = possuiObservacao && inherited;

  async function handleSave(rawValue: string) {
    setSaving(true);
    setError(undefined);
    const result = await onSave({ produto, cor, usarCor, filialScope, rawValue });
    setSaving(false);
    if (result.ok) {
      setOpen(false);
      return;
    }
    setError(result.error || "Erro ao salvar observação.");
  }

  return (
    <>
      <button
        type="button"
        className={`${styles.obsTrigger} ${possuiObservacao ? styles.obsTriggerFilled : styles.obsTriggerEmpty} ${mostrarHerdada ? styles.obsTriggerInherited : ""} ${error ? styles.obsTriggerError : ""}`}
        disabled={saving}
        title={
          error
            ? `Erro ao salvar: ${error}`
            : !possuiObservacao
              ? "Adicionar observação"
              : mostrarHerdada
                ? `Observação padrão (Todas as filiais): ${observacao}`
                : observacao
        }
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        <span className={`${styles.obsTriggerText} ${!possuiObservacao ? styles.obsTriggerTextMuted : ""}`}>
          {saving ? "Salvando..." : formatObservacaoPreview(observacao)}
        </span>
        {mostrarHerdada && (
          <span className={styles.obsTriggerInheritedTag}>padrão</span>
        )}
        <span className={styles.obsTriggerIcon} aria-hidden>
          ✎
        </span>
      </button>
      {open && (
        <ObservacaoEditorModal
          modal={{ produto, cor, usarCor, titulo, codigo, corLabel, filialLabel, inherited: mostrarHerdada }}
          initialValue={observacao}
          saving={saving}
          error={error}
          onClose={() => {
            if (!saving) setOpen(false);
          }}
          onSave={(value) => {
            void handleSave(value);
          }}
        />
      )}
    </>
  );
});

const ExportMenu = React.memo(function ExportMenu({
  exportingPdf,
  onExportCsv,
  onExportXlsx,
  onExportPdf,
  onExportCompraIdealFilial,
  compraIdealFilialLabel,
}: {
  exportingPdf: boolean;
  onExportCsv: () => void;
  onExportXlsx: () => void;
  onExportPdf: () => void;
  onExportCompraIdealFilial: () => void;
  compraIdealFilialLabel: string | null;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  return (
    <div className={styles.exportMenuWrap} ref={menuRef}>
      <button
        type="button"
        className={styles.exportMenuTrigger}
        onClick={() => setOpen((prev) => !prev)}
        title="Escolher formato de exportacao"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        ↓ Export
      </button>
      {open && (
        <div className={styles.exportMenuDropdown} role="menu" aria-label="Opcoes de exportacao">
          <button
            type="button"
            className={styles.exportMenuItem}
            onClick={() => { setOpen(false); onExportCsv(); }}
            title="Exporta a tabela atual em CSV"
          >
            Exportar CSV
          </button>
          <button
            type="button"
            className={styles.exportMenuItem}
            onClick={() => { setOpen(false); onExportXlsx(); }}
            title="Exporta a tabela atual em Excel"
          >
            Exportar XLSX
          </button>
          <button
            type="button"
            className={styles.exportMenuItem}
            onClick={() => { setOpen(false); onExportPdf(); }}
            title="Exporta a lista atual em PDF"
            disabled={exportingPdf}
          >
            {exportingPdf ? "Exportando PDF..." : "Exportar PDF"}
          </button>
          <button
            type="button"
            className={styles.exportMenuItem}
            onClick={() => { if (!compraIdealFilialLabel) { setOpen(false); } onExportCompraIdealFilial(); }}
            title="Exporta todos os itens com a Compra Ideal de cada loja em colunas separadas (uma lista só, todas as lojas)"
            disabled={compraIdealFilialLabel !== null}
          >
            {compraIdealFilialLabel ?? "Compra Ideal por Loja"}
          </button>
        </div>
      )}
    </div>
  );
});

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      results[currentIndex] = await mapper(items[currentIndex]!, currentIndex);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

/** Loja-alvo do export: nome canônico (param `filial` da API) + rótulo de exibição (cabeçalho da coluna). */
interface FilialExportTarget {
  filial: string;
  label: string;
}

/**
 * Monta as linhas do export "Compra Ideal por Loja" da Curva ABC: agrega TODOS os itens
 * (união de todas as lojas) numa lista só, com uma coluna por loja contendo a Compra Ideal
 * daquela loja. Se o item não vende numa loja, a coluna fica 0; nas que vende, recebe a
 * sugestão daquela loja. Mesma regra/fonte do resto da Curva ABC (resumo de métricas com
 * escopo na filial → calcCompraIdealFromResumo, trânsito abatido, negativos zerados),
 * inclusive a fusão de produtos agrupados.
 *
 * Eficiência: o client fetcher agrupa itens por loja numa única requisição (em lotes),
 * então o custo é ~1 conjunto de lotes por loja, não item × loja.
 */
async function buildCompraIdealPorFilialRowsCurvaAbc(
  companyKey: string,
  produtos: ProdutoComCurva[],
  filiais: FilialExportTarget[],
  comprasTransitoIndex: CompraTransitoIndex,
  porCor: boolean,
  onFilialDone?: () => void
): Promise<{ rows: Array<Record<string, string | number | boolean | null>>; colunasFiliais: string[] }> {
  // Plano por linha: chave de métrica + itens-membro (produto agrupado expande para seus membros).
  const plans = produtos.map((row) => {
    const metricKey = buildCurvaAbcMetricKey(row.produto, row.cor ?? null, porCor);
    const members =
      row.isGroupedProduct && (row.groupedMembers?.length ?? 0) > 0
        ? row.groupedMembers!.map((member) => ({
            produto: member.produto,
            corProduto: porCor ? (member.cor || null) : null,
          }))
        : [{ produto: row.produto, corProduto: porCor ? (row.cor ?? null) : null }];
    return { row, metricKey, members };
  });

  // Itens únicos a consultar (membros deduplicados).
  const itemLookup = new Map<string, { produto: string; corProduto: string | null }>();
  for (const plan of plans) {
    for (const member of plan.members) {
      itemLookup.set(buildControleEstoqueItemKey(member.produto, member.corProduto), member);
    }
  }
  const itens = Array.from(itemLookup.values());

  // Rótulos das colunas (um por loja), garantindo unicidade caso dois nomes colidam.
  const seenLabel = new Map<string, number>();
  const colunasFiliais = filiais.map((f) => {
    const base = f.label;
    const count = seenLabel.get(base) ?? 0;
    seenLabel.set(base, count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });

  // Uma "rodada" por loja (cada uma vira lotes de requisições). Concorrência limitada
  // para não saturar o backend com várias consultas pesadas de histórico ao mesmo tempo.
  const idealPorFilial = await mapWithConcurrency(filiais, 3, async (f) => {
    const allMetricRows: Record<string, ControleEstoqueItemMetricas> = {};
    try {
      for (let i = 0; i < itens.length; i += METRICAS_CHUNK_SIZE) {
        const chunk = itens.slice(i, i + METRICAS_CHUNK_SIZE);
        const rows = await fetchControleEstoqueMetricasItensClient({
          company: companyKey,
          filial: f.filial,
          includeHistorico: true,
          itens: chunk,
        });
        Object.assign(allMetricRows, rows);
      }
    } catch {
      // Falha parcial: a loja entra com o que conseguiu (itens ausentes ficam 0).
    } finally {
      onFilialDone?.();
    }

    const byMetricKey = new Map<string, { ci: number; estoque: number }>();
    for (const plan of plans) {
      const memberMetrics = plan.members
        .map((member) => allMetricRows[buildControleEstoqueItemKey(member.produto, member.corProduto)])
        .filter((m): m is ControleEstoqueItemMetricas => Boolean(m));
      if (memberMetrics.length === 0) {
        byMetricKey.set(plan.metricKey, { ci: 0, estoque: 0 });
        continue;
      }
      const merged =
        memberMetrics.length === 1 ? memberMetrics[0]! : mergeControleEstoqueMetricasEntries(memberMetrics);
      const ideal = calcCompraIdealFromResumo(
        merged.resumo,
        getCompraTransitoEntries(comprasTransitoIndex, plan.row.produto, porCor ? (plan.row.cor ?? null) : null),
        { linha: plan.row.linha, subgrupo: plan.row.subgrupo, company: companyKey }
      );
      byMetricKey.set(plan.metricKey, {
        ci: Math.max(0, ideal.compraIdeal),
        estoque: Math.max(0, Math.round(merged.resumo.estoqueTotal ?? 0)),
      });
    }
    return byMetricKey;
  });

  const rows = plans.map((plan) => {
    const p = plan.row;
    const row: Record<string, string | number | boolean | null> = {
      CURVA: p.curva,
      PRODUTO: p.produto,
      DESCRICAO: p.descricao || p.produto,
      CODIGO_BARRA: p.codigoBarra || "",
      COR_DESCRICAO: porCor ? (p.corDescricao || p.cor || "") : "",
      // No NERD a "categoria" da curva ABC é o GRUPO_PRODUTO → vira a coluna GRUPO.
      ...(companyKey === "nerd" ? { GRUPO: p.categoria?.trim() || "" } : {}),
      LINHA: p.linha?.trim() || "",
      SUBGRUPO: p.subgrupo?.trim() || "",
      CUSTO_UNIT: Math.round((p.custo ?? 0) * 100) / 100,
      VENDAS_PERIODO: Math.round(p.vendas * 100) / 100,
      QTDE_PERIODO: p.qtde,
      // Placeholder; preenchido abaixo com a soma do estoque por filial (rede).
      ESTOQUE_REDE: 0,
    };
    let totalRede = 0;
    let estoqueRede = 0;
    filiais.forEach((_, idx) => {
      const cell = idealPorFilial[idx]?.get(plan.metricKey);
      const qtd = cell?.ci ?? 0;
      row[colunasFiliais[idx]] = qtd;
      totalRede += qtd;
      estoqueRede += cell?.estoque ?? 0;
    });
    row.ESTOQUE_REDE = estoqueRede;
    row["TOTAL REDE"] = totalRede;
    return row;
  });

  return { rows, colunasFiliais };
}

function getInitialRange(month: number, year: number): DateRangeValue {
  const base = new Date(year, month, 1);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  return {
    startDate: startOfMonth(base),
    endDate: isCurrentMonth ? today : endOfMonth(base),
  };
}

// ─── Componente principal ─────────────────────────────────────────────────────

interface Props {
  companyKey: CompanyKey;
  month: number;
  year: number;
  compare: "month" | "year";
}

export default function CurvaAbcPage({ companyKey, month, year, compare: initialCompare }: Props) {
  const [range, setRange] = useState<DateRangeValue>(() => getInitialRange(month, year));
  const [comparisonMode, setComparisonMode] = useState<"month" | "year">(initialCompare);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);

  const selectedMonth = range.startDate.getMonth();
  const selectedYear = range.startDate.getFullYear();

  const [data, setData] = useState<FilialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [compraIdealFilialProgresso, setCompraIdealFilialProgresso] = useState<{ feito: number; total: number; fase: "lendo" | "gerando" } | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"produtos" | "vendedores">("produtos");
  const [porCor, setPorCor] = useState(true);
  const [filtrarEletronicos, setFiltrarEletronicos] = useState(companyKey === 'nerd');
  const [filtrarSugeridos, setFiltrarSugeridos] = useState(false);
  const [selectedCurvas, setSelectedCurvas] = useState<Set<Curva>>(new Set());
  const [selectedStockBuckets, setSelectedStockBuckets] = useState<Set<StockBucket>>(new Set());
  const [focusedCurve, setFocusedCurve] = useState<Curva>("A");
  const [compraMetrics, setCompraMetrics] = useState<Record<string, CompraMetricRow>>({});
  const [comprasTransitoIndex, setComprasTransitoIndex] = useState<CompraTransitoIndex>(new Map());
  // Catraca da data de compra (modo ciclo) — mesma lógica/persistência das demais telas.
  const catraca = useCatracaDataCompra(companyKey, selectedFilial ?? "");
  // metricKey -> (escopo da filial -> observação). Escopo "" = padrão (fallback de todas as filiais).
  const [observacoes, setObservacoes] = useState<Record<string, Record<string, string>>>({});
  const [sugestaoTooltip, setSugestaoTooltip] = useState<null | {
    x: number;
    y: number;
    titulo: string;
    regra: string;
    limiteDias: number;
    vendasMesAtual: number;
    diasCorridos: number;
    consumoDiario: number;
    estoqueAtual: number;
    duracaoAtual: number;
    qtdCalculada: number;
    baseQty?: number;
    nmExtraQty?: number;
    distribuicao?: DestinoCompraFinalParte[];
    distribuicaoLabel?: string;
    blendAplicado?: boolean;
    qtdFinalPuro?: number;
    qtdSBlend?: number;
    historicoQtde12m?: number;
    historicoDiasComEstoquePositivo?: number;
    historicoMesesDisponiveis?: number;
    historicoVelocidadeAjustada?: number;
    transitTotal?: number;
    transitDates?: string[];
  }>(null);
  const [sugestaoSTooltip, setSugestaoSTooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m: number;
    diasComEstoquePositivo: number;
    mesesDisponiveis: number;
    velocidadeAjustada: number;
    estoqueAtual: number;
    limiteDias: number;
    qtdS: number;
    baseQty?: number;
    nmExtraQty?: number;
    distribuicao?: DestinoCompraFinalParte[];
    transitTotal?: number;
    transitDates?: string[];
  }>(null);
  const [sugestaoPOTooltip, setSugestaoPOTooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m?: number;
    filialLabel?: string;
    periodoRef?: string;
    poRows?: Array<{
      filialLabel: string;
      qtde12m: number;
      diasComEstoquePositivo: number;
      diasSemEstoque: number;
      velocidadeAjustada: number;
      limiteSeguro: number;
      qtdPO: number;
      periodoRef: string;
    }>;
    diasComEstoquePositivo?: number;
    diasSemEstoque?: number;
    velocidadeAjustada?: number;
    limiteSeguro?: number;
    qtdPO: number;
    transitTotal?: number;
    transitDates?: string[];
  }>(null);
  const [sugestaoETooltip, setSugestaoETooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m: number;
    diasComEstoquePositivo: number;
    diasSemEstoque: number;
    mesesDisponiveis: number;
    velocidadeAjustada: number;
    limiteDias: number;
    qtdE: number;
    baseQty?: number;
    nmExtraQty?: number;
    distribuicao?: DestinoCompraFinalParte[];
    transitTotal?: number;
    transitDates?: string[];
  }>(null);
  const clearAllTooltips = () => {
    setSugestaoTooltip(null);
    setSugestaoSTooltip(null);
    setSugestaoETooltip(null);
    setSugestaoPOTooltip(null);
  };
  const captureRef = useRef<HTMLDivElement | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const stickyBarRef = useRef<HTMLDivElement | null>(null);

  // Quando filial muda, voltar para aba de produtos
  useEffect(() => {
    setActiveTab("produtos");
    setSelectedCategory(null);
  }, [selectedFilial]);

  // Sticky table header clone — DOM direto, sem setState, throttled via rAF
  useEffect(() => {
    let rafId: number | null = null;
    let isVisible = false;

    const syncWidths = (thead: Element, bar: HTMLDivElement, tableRect: DOMRect) => {
      bar.style.left = tableRect.left + "px";
      bar.style.width = tableRect.width + "px";
      const ths = thead.querySelectorAll("th");
      const barThs = bar.querySelectorAll("th");
      ths.forEach((th, i) => {
        if (barThs[i]) (barThs[i] as HTMLElement).style.width = th.getBoundingClientRect().width + "px";
      });
    };

    const update = () => {
      rafId = null;
      const bar = stickyBarRef.current;
      const table = tableRef.current;
      if (!bar || !table) return;
      const thead = table.querySelector("thead");
      if (!thead) return;
      const theadRect = thead.getBoundingClientRect();
      const tableRect = table.getBoundingClientRect();
      const shouldShow = theadRect.top < 0 && tableRect.bottom > 0;
      if (shouldShow && !isVisible) {
        isVisible = true;
        syncWidths(thead, bar, tableRect);
        bar.style.display = "block";
      } else if (!shouldShow && isVisible) {
        isVisible = false;
        bar.style.display = "none";
      } else if (shouldShow && isVisible) {
        bar.style.left = tableRect.left + "px";
      }
    };

    const schedule = () => {
      if (rafId === null) rafId = requestAnimationFrame(update);
    };

    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", () => { isVisible = false; schedule(); }, { passive: true });
    return () => {
      window.removeEventListener("scroll", schedule);
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchComprasTransitoClient(companyKey)
      .then((docs) => {
        if (!cancelled) setComprasTransitoIndex(buildCompraTransitoIndex(docs));
      })
      .catch(() => {
        if (!cancelled) setComprasTransitoIndex(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/curva-abc-observacoes?company=${companyKey}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { data?: CurvaAbcObservacaoRecord[]; error?: string }) => {
        if (json.error) throw new Error(json.error);

        const nextMap: Record<string, Record<string, string>> = {};
        for (const row of json.data ?? []) {
          const metricKey = buildCurvaAbcMetricKey(row.produto, row.cor ?? null, true);
          const filialScope = (row.filial ?? "").trim();
          (nextMap[metricKey] ??= {})[filialScope] = row.observacao ?? "";
        }

        if (cancelled) return;
        setObservacoes(nextMap);
      })
      .catch(() => {
        if (cancelled) return;
        setObservacoes({});
      });

    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setSelectedCategory(null);
    const params = new URLSearchParams({
      company: companyKey,
      month: String(selectedMonth),
      year: String(selectedYear),
      start: formatDateForQuery(range.startDate),
      end: formatDateForQuery(range.endDate),
      compare: comparisonMode,
    });
    if (selectedFilial) {
      params.set('filial', selectedFilial);
    }
    if (porCor) {
      params.set('porCor', '1');
    }
    // Para NERD, o toggle "Eletrônicos" envia o filtro de linha ao backend
    // (mesma lógica de Dashboard e Produtos por Venda, alimentadas pela fonte global `fetchSalesTotals`).
    if (companyKey === 'nerd' && filtrarEletronicos) {
      params.append('linha', 'ELETRONICOS');
    }
    // Guarda de corrida: ao trocar filtros rapidamente, várias requisições disparam. Sem isso, uma
    // resposta antiga pode chegar depois e sobrescrever a nova (números "bugando"). O AbortController
    // cancela a requisição anterior e a flag `cancelled` impede aplicar respostas obsoletas.
    const controller = new AbortController();
    let cancelled = false;
    fetch(`/api/curva-abc?${params}`, { cache: "no-store", signal: controller.signal })
      .then(res => res.json())
      .then((json: FilialData & { error?: string }) => {
        if (cancelled) return;
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch(e => {
        if (cancelled || (e instanceof Error && e.name === "AbortError")) return;
        setError(e instanceof Error ? e.message : "Erro desconhecido");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, selectedFilial, selectedMonth, selectedYear, comparisonMode, range.startDate, range.endDate, porCor, filtrarEletronicos]);


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

  const activeCategorias = useMemo((): Set<string> | null => {
    if (!selectedCategory || !data) return null;
    if (selectedCategory === OUTROS_LABEL) {
      return new Set(filterOutrosKeys(data.categoryList, companyKey));
    }
    return new Set([selectedCategory]);
  }, [selectedCategory, data, companyKey]);

  const produtosBaseFiltro = useMemo(() => {
    if (!data) return [];
    return activeCategorias ? data.produtos.filter(p => activeCategorias.has(p.categoria)) : data.produtos;
  }, [data, activeCategorias]);

  const availableSubgrupos = useMemo(() => {
    return Array.from(
      new Set(
        produtosBaseFiltro
          .map((p) => (p.subgrupo ?? "").trim())
          .filter((value) => value !== "")
      )
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [produtosBaseFiltro]);

  const availableGrades = useMemo(() => {
    return Array.from(
      new Set(
        produtosBaseFiltro
          .map((p) => (p.grade ?? "").trim())
          .filter((value) => value !== "")
      )
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [produtosBaseFiltro]);

  const availableColecoes = useMemo(() => {
    return Array.from(
      new Set(
        produtosBaseFiltro
          .map((p) => (p.colecao ?? "").trim())
          .filter((value) => value !== "")
      )
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [produtosBaseFiltro]);

  useEffect(() => {
    setSelectedSubgrupos((prev) => prev.filter((value) => availableSubgrupos.includes(value)));
  }, [availableSubgrupos]);

  useEffect(() => {
    setSelectedGrades((prev) => prev.filter((value) => availableGrades.includes(value)));
  }, [availableGrades]);

  useEffect(() => {
    setSelectedColecoes((prev) => prev.filter((value) => availableColecoes.includes(value)));
  }, [availableColecoes]);

  async function saveObservacaoValue({
    produto,
    cor,
    usarCor,
    filialScope,
    rawValue,
  }: {
    produto: string;
    cor: string | null;
    usarCor: boolean;
    filialScope: string;
    rawValue: string;
  }): Promise<{ ok: boolean; error?: string }> {
    const lookupKey = buildCurvaAbcMetricKey(produto, cor ?? null, usarCor);
    const draftValue = rawValue.trim();
    const byFilial = observacoes[lookupKey] ?? {};
    const ownValue = byFilial[filialScope];
    // O que está visível hoje nesta filial: a própria observação ou, na falta, o padrão ("").
    const resolvedValue = (
      ownValue != null ? ownValue : filialScope !== "" ? byFilial[""] ?? "" : ""
    ).trim();

    // Sem mudança visível: não cria cópia redundante igual ao padrão herdado.
    if (draftValue === resolvedValue) return { ok: true };

    try {
      const res = await fetch("/api/curva-abc-observacoes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: companyKey,
          produto,
          cor: usarCor ? cor ?? null : null,
          filial: filialScope,
          observacao: draftValue,
        }),
      });

      const json = (await res.json()) as { data?: CurvaAbcObservacaoRecord | null; error?: string };
      if (!res.ok || json.error) {
        throw new Error(json.error || "Erro ao salvar observação.");
      }

      const nextValue = json.data?.observacao ?? "";

      setObservacoes((prev) => {
        const nextByFilial = { ...(prev[lookupKey] ?? {}) };
        if (!nextValue) {
          delete nextByFilial[filialScope];
        } else {
          nextByFilial[filialScope] = nextValue;
        }
        const next = { ...prev };
        if (Object.keys(nextByFilial).length === 0) {
          delete next[lookupKey];
        } else {
          next[lookupKey] = nextByFilial;
        }
        return next;
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Erro ao salvar observação.",
      };
    }
  }

  // Escopo de observação = filial selecionada; "Todas as filiais" edita o padrão (fallback).
  const observacaoFilialScope = selectedFilial ?? "";
  const observacaoFilialLabel = selectedFilial ? (data?.displayName ?? selectedFilial) : "Todas as filiais";

  const resolveObservacao = (metricKey: string): { value: string; inherited: boolean } => {
    const byFilial = observacoes[metricKey];
    if (!byFilial) return { value: "", inherited: false };
    const own = byFilial[observacaoFilialScope];
    if (own != null) return { value: own, inherited: false };
    if (observacaoFilialScope !== "") {
      const padrao = byFilial[""];
      if (padrao != null) return { value: padrao, inherited: true };
    }
    return { value: "", inherited: false };
  };

  const produtosFiltrados = useMemo(() => {
    let produtos = produtosBaseFiltro;
    if (selectedSubgrupos.length > 0) {
      produtos = produtos.filter((p) => selectedSubgrupos.includes((p.subgrupo ?? "").trim()));
    }
    if (selectedGrades.length > 0) {
      produtos = produtos.filter((p) => selectedGrades.includes((p.grade ?? "").trim()));
    }
    if (selectedColecoes.length > 0) {
      produtos = produtos.filter((p) => selectedColecoes.includes((p.colecao ?? "").trim()));
    }
    return produtos;
  }, [produtosBaseFiltro, selectedSubgrupos, selectedGrades, selectedColecoes]);

  const activeStructureFilterLabels = [
    selectedCategory ? getCategoryHeaderLabel(selectedCategory) : null,
    selectedSubgrupos.length > 0 ? `Subgrupos: ${selectedSubgrupos.join(", ")}` : null,
    selectedGrades.length > 0 ? `Grades: ${selectedGrades.join(", ")}` : null,
    selectedColecoes.length > 0 ? `Coleções: ${selectedColecoes.join(", ")}` : null,
  ].filter((value): value is string => Boolean(value));

  const activeFilterLabels = [
    ...activeStructureFilterLabels,
    selectedCurvas.size > 0 ? `Curvas: ${Array.from(selectedCurvas).join(", ")}` : null,
    selectedStockBuckets.size > 0
      ? `Estoque: ${Array.from(selectedStockBuckets).map((bucket) => STOCK_BUCKET_LABEL[bucket]).join(", ")}`
      : null,
  ].filter((value): value is string => Boolean(value));

  const hasStructuredFilters = activeStructureFilterLabels.length > 0;

  const produtosComCurva = useMemo(() => {
    if (produtosFiltrados.length === 0) return [];
    return calcularCurvas(produtosFiltrados);
  }, [produtosFiltrados]);
  const diasCorridosMes = Math.max(1, new Date().getDate());

  // Catraca: junta gravações pendentes (avança/re-baseia; manter → null) e persiste.
  const catracaFreezesAbc = useMemo<CatracaFreeze[]>(() => {
    if (!catraca.enabled) return [];
    const out: CatracaFreeze[] = [];
    for (const p of produtosComCurva) {
      const metricKey = buildCurvaAbcMetricKey(p.produto, p.cor ?? null, porCor);
      if (!Object.prototype.hasOwnProperty.call(compraMetrics, metricKey)) continue;
      const corCat = porCor ? (p.cor ?? null) : null;
      const idealCru = buildCompraIdealFromMetricRow(compraMetrics[metricKey], p, comprasTransitoIndex, porCor, companyKey);
      const { freeze } = catraca.reconcile(
        idealCru,
        buildControleEstoqueItemKey(p.produto, corCat),
        getCompraTransitoEntries(comprasTransitoIndex, p.produto, corCat)
      );
      if (freeze) out.push(freeze);
    }
    return out;
  }, [produtosComCurva, compraMetrics, comprasTransitoIndex, porCor, companyKey, catraca.enabled, catraca.reconcile]);

  useEffect(() => catraca.persist(catracaFreezesAbc), [catracaFreezesAbc, catraca.persist]);

  const produtosComCurvaComFiltroSugestao = useMemo(() => {
    const base = (companyKey === 'nerd' && filtrarEletronicos)
      ? produtosComCurva.filter((p) => normalizeKey(p.linha ?? '') === 'ELETRONICOS')
      : produtosComCurva;
    if (!filtrarSugeridos) return base;
    return base.filter((p) => {
      const metricKey = buildCurvaAbcMetricKey(p.produto, p.cor ?? null, porCor);
      const live = compraMetrics[metricKey];
      const hasLive = Object.prototype.hasOwnProperty.call(compraMetrics, metricKey);
      if (!hasLive) return false;
      const semBaseLive =
        live?.qtde12m == null &&
        live?.vendasMesAtual == null &&
        live?.estoqueFilial == null;
      if (semBaseLive) return false;
      const ideal = buildCompraIdealFromMetricRow(live, p, comprasTransitoIndex, porCor, companyKey);
      return ideal.compraIdeal > 0;
    });
  }, [filtrarEletronicos, filtrarSugeridos, companyKey, produtosComCurva, compraMetrics, comprasTransitoIndex, diasCorridosMes, porCor]);

  const produtosComCurvaComFiltroEstoque = useMemo(() => {
    if (selectedStockBuckets.size === 0) return produtosComCurvaComFiltroSugestao;
    return produtosComCurvaComFiltroSugestao.filter((p) => selectedStockBuckets.has(getStockBucket(p.estoque)));
  }, [produtosComCurvaComFiltroSugestao, selectedStockBuckets]);

  const produtosComCurvaExibidos = useMemo(() => {
    if (selectedCurvas.size === 0) return produtosComCurvaComFiltroEstoque;
    return produtosComCurvaComFiltroEstoque.filter((p) => selectedCurvas.has(p.curva));
  }, [produtosComCurvaComFiltroEstoque, selectedCurvas]);

  const maxPerc = produtosComCurvaExibidos.length > 0 ? produtosComCurvaExibidos[0].percParticipacao : 1;
  const groups: Curva[] = ["A", "B", "C"];
  const filteredCurve = selectedCurvas.size === 1 ? Array.from(selectedCurvas)[0] : null;
  const curveStockSummary = groups.map((curva) => {
    const items = produtosComCurvaComFiltroSugestao.filter((p) => p.curva === curva);
    const buckets = STOCK_BUCKET_ORDER.reduce(
      (acc, bucket) => {
        acc[bucket] = items.filter((p) => getStockBucket(p.estoque) === bucket).length;
        return acc;
      },
      {} as Record<StockBucket, number>
    );
    return { curva, total: items.length, buckets };
  });
  const focusedCurveSummary = curveStockSummary.find(({ curva }) => curva === focusedCurve) ?? curveStockSummary[0] ?? null;

  const totalVendasAllCurves = produtosComCurva.reduce((s, p) => s + p.vendas, 0);
  const curveRevenuePcts: Record<Curva, number> = {
    A: totalVendasAllCurves > 0 ? produtosComCurva.filter(p => p.curva === "A").reduce((s, p) => s + p.vendas, 0) / totalVendasAllCurves : 0,
    B: totalVendasAllCurves > 0 ? produtosComCurva.filter(p => p.curva === "B").reduce((s, p) => s + p.vendas, 0) / totalVendasAllCurves : 0,
    C: totalVendasAllCurves > 0 ? produtosComCurva.filter(p => p.curva === "C").reduce((s, p) => s + p.vendas, 0) / totalVendasAllCurves : 0,
  };
  const curveAData = curveStockSummary.find(x => x.curva === "A") ?? null;
  const activeCurveData = selectedCurvas.size > 0
    ? curveStockSummary.filter(c => selectedCurvas.has(c.curva))
    : curveStockSummary;
  const stockBucketTotals: Record<StockBucket, number> = {
    zero: activeCurveData.reduce((s, c) => s + c.buckets.zero, 0),
    low:  activeCurveData.reduce((s, c) => s + c.buckets.low, 0),
    high: activeCurveData.reduce((s, c) => s + c.buckets.high, 0),
  };

  const hasAnyDisplayFilter =
    hasStructuredFilters ||
    (companyKey === "nerd" && filtrarEletronicos) ||
    filtrarSugeridos ||
    selectedCurvas.size > 0 ||
    selectedStockBuckets.size > 0;

  // Filtros já aplicados no servidor (que retorna `data.vendas` / `data.qtde` via fonte global):
  //  - Eletrônicos (NERD): backend filtra LINHA = 'ELETRONICOS'
  // Quando o único filtro ativo é o eletrônicos, podemos usar os totais autoritativos do servidor
  // — assim Dashboard, Produtos por Venda e Curva ABC mostram exatamente o mesmo número.
  const onlyServerSideFilters =
    (companyKey === "nerd" && filtrarEletronicos) &&
    !hasStructuredFilters &&
    !filtrarSugeridos &&
    selectedCurvas.size === 0 &&
    selectedStockBuckets.size === 0;

  // Os cards de resumo refletem exatamente os produtos exibidos na tabela
  // (após TODOS os filtros: categoria, eletrônicos, sugeridos, estoque e curva).
  // Sem nenhum filtro ativo (ou apenas o filtro server-side de eletrônicos), usamos os totais autoritativos do servidor.
  const useServerTotals = !hasAnyDisplayFilter || onlyServerSideFilters;
  const displayVendas = useServerTotals
    ? data?.vendas ?? 0
    : produtosComCurvaExibidos.reduce((s, p) => s + p.vendas, 0);
  const displayVendasPrevious = useServerTotals
    ? data?.vendasPrevious ?? 0
    : produtosComCurvaExibidos.reduce((s, p) => s + p.vendasPrevious, 0);
  const displayQtde = useServerTotals
    ? data?.qtde ?? 0
    : produtosComCurvaExibidos.reduce((s, p) => s + p.qtde, 0);
  const displayCMV = produtosComCurvaExibidos.reduce((s, p) => s + p.custo * p.qtde, 0);
  // Projeção do mês escalada ao vendas exibido (mesmo run-rate do servidor: totalDias/diasDecorridos).
  // Assim a projeção aparece SEMPRE — inclusive com filtros — e fica coerente com o número exibido.
  // Sem filtro, displayVendas = data.vendas, então displayProjecao == data.projecao (idêntico ao servidor).
  const projecaoFactor = data && data.daysElapsed > 0 ? data.totalDaysInMonth / data.daysElapsed : 1;
  const displayProjecao = displayVendas * projecaoFactor;
  const displayedCountLabel = filteredCurve
    ? `${Array.from(selectedCurvas).join(", ")} ${porCor ? "itens exibidos" : "produtos exibidos"}`
    : porCor
      ? "ITENS (PROD. + COR)"
      : "PRODUTOS ÚNICOS";

  const handleCurveCardClick = (curva: Curva) => {
    if (filteredCurve && filteredCurve !== curva) {
      setSelectedCurvas(new Set());
      setSelectedStockBuckets(new Set());
    }
    setFocusedCurve(curva);
  };

  const handleCurveToggle = (curva: Curva) => {
    setSelectedCurvas(prev => {
      const next = new Set(prev);
      if (next.has(curva)) next.delete(curva);
      else next.add(curva);
      return next;
    });
  };

  const handleStockBucketToggle = (bucket: StockBucket) => {
    setSelectedStockBuckets(prev => {
      if (prev.has(bucket) && prev.size === 1) return new Set();
      return new Set([bucket]);
    });
  };

  const handleCurveStockShortcutClick = (curva: Curva, bucket: StockBucket) => {
    const isOnlyShortcutActive =
      selectedCurvas.size === 1 &&
      selectedCurvas.has(curva) &&
      selectedStockBuckets.size === 1 &&
      selectedStockBuckets.has(bucket);

    if (isOnlyShortcutActive) {
      setSelectedCurvas(new Set());
      setSelectedStockBuckets(new Set());
      return;
    }

    setSelectedCurvas(new Set([curva]));
    setSelectedStockBuckets(new Set([bucket]));
  };

  useEffect(() => {
    setCompraMetrics({});
  }, [companyKey, selectedFilial, porCor, selectedCategory, selectedSubgrupos, selectedGrades, selectedColecoes, range.startDate, range.endDate]);

  useEffect(() => {
    if (produtosComCurva.length === 0) return;
    let cancelled = false;
    const load = async () => {
      clearControleEstoqueMetricasClientCache();
      if (!cancelled) setCompraMetrics({});
      const groupedMetricMembers = new Map<string, Array<{ produto: string; corProduto: string | null }>>();
      const itemLookup = new Map<string, { produto: string; corProduto: string | null }>();
      const allMetricRows: Record<string, ControleEstoqueItemMetricas> = {};
      const limiteDiasMap = new Map<string, number>();
      const sortedRows = produtosComCurva.slice().sort((a, b) => b.vendas - a.vendas);

      for (const row of sortedRows) {
        const metricKey = buildCurvaAbcMetricKey(row.produto, row.cor ?? null, porCor);
        const members = row.isGroupedProduct && (row.groupedMembers?.length ?? 0) > 0
          ? row.groupedMembers!.map((member) => ({
              produto: member.produto,
              corProduto: porCor ? (member.cor || null) : null,
            }))
          : [{
              produto: row.produto,
              corProduto: porCor ? (row.cor ?? null) : null,
            }];

        limiteDiasMap.set(metricKey, getLimiteDiasReposicao(row));
        groupedMetricMembers.set(metricKey, members);
        for (const member of members) {
          itemLookup.set(buildControleEstoqueItemKey(member.produto, member.corProduto), member);
        }
      }

      const itens = Array.from(itemLookup.values());

      for (let i = 0; i < itens.length; i += METRICAS_CHUNK_SIZE) {
        if (cancelled) return;
        const chunk = itens.slice(i, i + METRICAS_CHUNK_SIZE);
        try {
          const rows = await fetchControleEstoqueMetricasItensClient({
            company: companyKey,
            filial: selectedFilial,
            includeHistorico: true,
            itens: chunk,
          });

          if (cancelled) return;

          setCompraMetrics((prev) => {
            const next = { ...prev };
            chunk.forEach((item) => {
              next[buildControleEstoqueItemKey(item.produto, item.corProduto)] = EMPTY_COMPRA_METRIC_ROW;
            });
            Object.entries(rows).forEach(([key, value]) => {
              allMetricRows[key] = value;
              const filiaisNM = calcTotalPerFilialFiliais({
                company: resolveCompany(companyKey),
                vendasPorFilial: value.vendasPorFilial,
                estoquePorFilial: value.estoquePorFilial,
                limiteDias: limiteDiasMap.get(key) ?? 60,
              });
              next[key] = {
                qtde12m: value.resumo.qtde12m,
                qtde60d: value.resumo.qtde60d,
                vendasMesAtual: value.resumo.vendasMesAtual,
                estoqueFilial: value.resumo.estoqueTotal,
                diasDesdeUltimaVenda: value.resumo.diasDesdeUltimaVenda,
                mesesHistoricoFilial: value.resumo.mesesHistoricoFilial,
                diasComEstoquePositivo: value.resumo.diasComEstoquePositivo,
                diasSemEstoque: value.resumo.diasSemEstoque,
                mesesDisponiveis: value.resumo.mesesDisponiveis,
                velocidadeAjustada: value.resumo.velocidadeAjustada,
                ritmoDiasComEstoque: value.resumo.ritmoDiasComEstoque,
                ritmoVendasPeriodo: value.resumo.ritmoVendasPeriodo,
                ritmoInicioIso: value.resumo.ritmoInicioIso,
                ritmoFimIso: value.resumo.ritmoFimIso,
                ritmoDiasComVenda: value.resumo.ritmoDiasComVenda,
                ritmoPrimeiraVendaIso: value.resumo.ritmoPrimeiraVendaIso,
                ritmoUltimaVendaIso: value.resumo.ritmoUltimaVendaIso,
                totalNmQty: filiaisNM.reduce((sum, row) => sum + row.qtd, 0),
                filiaisNM,
                vendasPorFilial: value.vendasPorFilial,
                estoquePorFilial: value.estoquePorFilial,
              };
            });

            groupedMetricMembers.forEach((members, groupedKey) => {
              const memberMetrics = members
                .map((member) => allMetricRows[buildControleEstoqueItemKey(member.produto, member.corProduto)])
                .filter(Boolean);

              if (memberMetrics.length === 0) return;

              const merged = mergeControleEstoqueMetricasEntries(memberMetrics);
              const filiaisNM = calcTotalPerFilialFiliais({
                company: resolveCompany(companyKey),
                vendasPorFilial: merged.vendasPorFilial,
                estoquePorFilial: merged.estoquePorFilial,
                limiteDias: limiteDiasMap.get(groupedKey) ?? 60,
              });

              next[groupedKey] = {
                qtde12m: merged.resumo.qtde12m,
                qtde60d: merged.resumo.qtde60d,
                vendasMesAtual: merged.resumo.vendasMesAtual,
                estoqueFilial: merged.resumo.estoqueTotal,
                diasDesdeUltimaVenda: merged.resumo.diasDesdeUltimaVenda,
                mesesHistoricoFilial: merged.resumo.mesesHistoricoFilial,
                diasComEstoquePositivo: merged.resumo.diasComEstoquePositivo,
                diasSemEstoque: merged.resumo.diasSemEstoque,
                mesesDisponiveis: merged.resumo.mesesDisponiveis,
                velocidadeAjustada: merged.resumo.velocidadeAjustada,
                ritmoDiasComEstoque: merged.resumo.ritmoDiasComEstoque,
                ritmoVendasPeriodo: merged.resumo.ritmoVendasPeriodo,
                ritmoInicioIso: merged.resumo.ritmoInicioIso,
                ritmoFimIso: merged.resumo.ritmoFimIso,
                ritmoDiasComVenda: merged.resumo.ritmoDiasComVenda,
                ritmoPrimeiraVendaIso: merged.resumo.ritmoPrimeiraVendaIso,
                ritmoUltimaVendaIso: merged.resumo.ritmoUltimaVendaIso,
                totalNmQty: filiaisNM.reduce((sum, metricRow) => sum + metricRow.qtd, 0),
                filiaisNM,
                vendasPorFilial: merged.vendasPorFilial,
                estoquePorFilial: merged.estoquePorFilial,
              };
            });
            return next;
          });
        } catch {
          if (!cancelled && i === 0) setCompraMetrics({});
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [produtosComCurva, companyKey, selectedFilial, porCor]);

  const variation = data ? getComparisonBadge(displayVendas, displayVendasPrevious) : null;

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

  void barPct; void barClass; void metaPctClass;

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

  const getSugestaoCompraExportValue = (p: ProdutoComCurva): number | "" => {
    const metricKey = buildCurvaAbcMetricKey(p.produto, p.cor ?? null, porCor);
    const live = compraMetrics[metricKey];
    const hasLive = Object.prototype.hasOwnProperty.call(compraMetrics, metricKey);
    if (!hasLive) return "";
    const ideal = buildCompraIdealFromMetricRow(live, p, comprasTransitoIndex, porCor, companyKey);
    return ideal.compraIdeal;
  };

  const buildExportSimpleRows = (): CurvaAbcSimpleXlsxRow[] => {
    if (produtosComCurvaExibidos.length === 0) return [];
    const rows: CurvaAbcSimpleXlsxRow[] = [];
    for (let rankGlobal = 1; rankGlobal <= produtosComCurvaExibidos.length; rankGlobal++) {
      const p = produtosComCurvaExibidos[rankGlobal - 1]!;
      const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
      const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
      const cmp = getComparisonBadge(p.vendas, p.vendasPrevious);
      let variacao: number | string = "";
      if (cmp?.kind === "new") variacao = "NOVO";
      else if (cmp?.kind === "pct") variacao = Math.round(cmp.value * 10) / 10;
      rows.push({
        RANK: rankGlobal,
        CURVA: p.curva,
        DESCRICAO: p.descricao || p.produto,
        PRODUTO: p.produto,
        CODIGO_BARRA: p.codigoBarra || "",
        LINHA: p.linha?.trim() || "",
        SUBGRUPO: p.subgrupo?.trim() || "",
        TIPO_PRODUTO: p.tipoProduto?.trim() || "",
        COLECAO: p.colecao?.trim() || "",
        GRADE: companyKey === "scarfme" ? (p.grade ?? "") : "",
        COR_DESCRICAO: porCor ? (p.corDescricao || p.cor || "") : "",
        ...(companyKey === "nerd" ? { GRUPO: p.categoria?.trim() || "" } : {}),
        PERC_PARTICIPACAO: Math.round(p.percParticipacao * 10) / 10,
        PERC_ACUMULADA: Math.round(p.percCumulativa * 1000) / 10,
        VENDAS: Math.round(p.vendas * 100) / 100,
        QTDE: p.qtde,
        ESTOQUE: p.estoque ?? 0,
        CUSTO_UNIT: Math.round((p.custo ?? 0) * 100) / 100,
        MARKUP: markup !== null ? Math.round(markup * 100) / 100 : "",
        COMPRA_IDEAL: getSugestaoCompraExportValue(p),
        VAR_VS_PERIODO_ANTERIOR: variacao,
      });
    }
    return rows;
  };

  const exportOptions = {
    companyKey,
    range: { startDate: range.startDate, endDate: range.endDate },
    filialLabel: selectedFilial ? (data?.displayName ?? selectedFilial) : null,
  };

  const handleExportSimpleXlsx = () => {
    const rows = buildExportSimpleRows();
    if (rows.length === 0) return;
    exportCurvaAbcSimpleXlsx(rows, { ...exportOptions });
  };

  const handleExportSimpleCsv = () => {
    const rows = buildExportSimpleRows();
    if (rows.length === 0) return;
    exportCurvaAbcSimpleCsv(rows, exportOptions);
  };

  const handleExportCompraIdealPorFilial = async () => {
    if (compraIdealFilialProgresso !== null) return;

    // Lojas-alvo: filiais canônicas de venda (uma coluna cada), excluindo MATRIZ, membros
    // não-canônicos de grupos e o e-commerce (NERD); para SCARFME inclui o e-commerce, igual
    // ao que o seletor de filial permite escolher loja a loja.
    const cfg = resolveCompany(companyKey);
    if (!cfg) return;
    const ecommerceFilials = cfg.ecommerceFilials ?? [];
    const groups = cfg.filialGroups ?? {};
    const canonicals = new Set(Object.keys(groups));
    const nonCanonicalGroupMembers = new Set<string>();
    for (const members of Object.values(groups)) {
      for (const m of members) {
        if (!canonicals.has(m)) nonCanonicalGroupMembers.add(m);
      }
    }
    const matrizByCompany: Record<string, string[]> = {
      scarfme: ["SCARF ME - MATRIZ"],
      nerd: ["NERD"],
    };
    const matrizSet = new Set(matrizByCompany[companyKey] ?? []);
    const displayNames = cfg.filialDisplayNames ?? {};
    const salesFiliais = cfg.filialFilters?.sales ?? [];
    const targets: FilialExportTarget[] = salesFiliais
      .filter(
        (f) => !ecommerceFilials.includes(f) && !nonCanonicalGroupMembers.has(f) && !matrizSet.has(f)
      )
      .map((f) => ({ filial: f, label: displayNames[f] ?? f }));
    if (companyKey === "scarfme" && ecommerceFilials.length > 0) {
      const ec = ecommerceFilials[0]!;
      targets.push({ filial: ec, label: displayNames[ec] ?? ec });
    }
    targets.sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));

    if (targets.length === 0) return;

    setCompraIdealFilialProgresso({ feito: 0, total: targets.length, fase: "lendo" });
    try {
      // Universo = UNIÃO das listas de curva ABC de cada loja (cada uma com seu próprio TOP
      // normal), e não o universo bruto da rede. Assim um item que entra na curva ABC de
      // QUALQUER loja aparece na lista agregada — mesmo que não ranqueie no total geral —,
      // sem inflar com a cauda profunda da rede inteira.
      const buildUniversoParams = (filial: string) => {
        const p = new URLSearchParams({
          company: companyKey,
          month: String(selectedMonth),
          year: String(selectedYear),
          start: formatDateForQuery(range.startDate),
          end: formatDateForQuery(range.endDate),
          compare: comparisonMode,
          filial,
        });
        if (porCor) p.set("porCor", "1");
        if (companyKey === "nerd" && filtrarEletronicos) p.append("linha", "ELETRONICOS");
        return p;
      };

      const listasPorLoja = await mapWithConcurrency(targets, 4, async (f) => {
        try {
          const res = await fetch(`/api/curva-abc?${buildUniversoParams(f.filial)}`, { cache: "no-store" });
          const json = (await res.json()) as FilialData & { error?: string };
          if (!res.ok || json.error) return [];
          return json.produtos ?? [];
        } catch {
          return [];
        } finally {
          setCompraIdealFilialProgresso((prev) => (prev ? { ...prev, feito: prev.feito + 1 } : prev));
        }
      });

      // Dedupe por chave de métrica, somando vendas/qtde das lojas onde o item aparece
      // (dá o total de período da rede só para os itens que entraram em alguma loja).
      const universoMap = new Map<string, ProdutoRow>();
      for (const lista of listasPorLoja) {
        for (const prod of lista) {
          const key = buildCurvaAbcMetricKey(prod.produto, prod.cor ?? null, porCor);
          const existing = universoMap.get(key);
          if (existing) {
            existing.vendas += prod.vendas;
            existing.qtde += prod.qtde;
          } else {
            universoMap.set(key, { ...prod });
          }
        }
      }
      const universo = calcularCurvas(Array.from(universoMap.values()));
      if (universo.length === 0) return;

      setCompraIdealFilialProgresso({ feito: 0, total: targets.length, fase: "gerando" });
      const { rows, colunasFiliais } = await buildCompraIdealPorFilialRowsCurvaAbc(
        companyKey,
        universo,
        targets,
        comprasTransitoIndex,
        porCor,
        () => setCompraIdealFilialProgresso((prev) => (prev ? { ...prev, feito: prev.feito + 1 } : prev))
      );
      const periodo = `${formatDateForQuery(range.startDate)}_a_${formatDateForQuery(range.endDate)}`;
      exportCompraIdealPorFilialToXlsx({
        companyKey,
        companyName: cfg.name,
        listaNome: `Curva ABC ${periodo}`,
        filtroAplicado:
          `Todas as lojas · união das curvas ABC por loja` +
          (porCor ? " · por cor" : "") +
          (companyKey === "nerd" && filtrarEletronicos ? " · só ELETRONICOS" : ""),
        colunasFiliais,
        rows,
      });
    } finally {
      setCompraIdealFilialProgresso(null);
    }
  };

  const handleExportPdf = async () => {
    const target = captureRef.current;
    if (!target || produtosComCurvaExibidos.length === 0) return;

    setExportingPdf(true);

    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const tableCard = target.querySelector<HTMLElement>(`.${styles.tableCard}`);
      const tableElement = target.querySelector<HTMLTableElement>(`.${styles.table}`);
      const prevOverflowX = tableCard?.style.overflowX ?? "";
      const prevTableCardWidth = tableCard?.style.width ?? "";
      const prevTargetWidth = target.style.width;
      const prevTargetMaxWidth = target.style.maxWidth;
      const prevTableWidth = tableElement?.style.width ?? "";
      let canvas: HTMLCanvasElement;

      try {
        const exportWidth = Math.max(
          target.scrollWidth,
          tableCard?.scrollWidth ?? 0,
          tableElement?.scrollWidth ?? 0
        );

        if (tableCard) {
          tableCard.style.overflowX = "visible";
          tableCard.style.width = `${exportWidth}px`;
        }
        if (tableElement) {
          tableElement.style.width = `${exportWidth}px`;
        }
        target.style.width = `${exportWidth}px`;
        target.style.maxWidth = "none";

        canvas = await html2canvas(target, {
          backgroundColor: "#f8fafc",
          scale: 2,
          useCORS: true,
          scrollX: 0,
          scrollY: -window.scrollY,
          windowWidth: Math.max(target.scrollWidth, target.clientWidth),
          windowHeight: Math.max(target.scrollHeight, target.clientHeight),
        });
      } finally {
        if (tableCard) {
          tableCard.style.overflowX = prevOverflowX;
          tableCard.style.width = prevTableCardWidth;
        }
        if (tableElement) {
          tableElement.style.width = prevTableWidth;
        }
        target.style.width = prevTargetWidth;
        target.style.maxWidth = prevTargetMaxWidth;
      }

      const pdf = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 6;
      const usableWidth = pageWidth - margin * 2;
      const usableHeight = pageHeight - margin * 2;
      const sliceHeightPx = Math.floor(canvas.width / (usableWidth / usableHeight));
      const totalPages = Math.ceil(canvas.height / sliceHeightPx);

      for (let page = 0; page < totalPages; page += 1) {
        if (page > 0) pdf.addPage();

        const srcY = page * sliceHeightPx;
        const srcHeight = Math.min(sliceHeightPx, canvas.height - srcY);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = srcHeight;

        const ctx = pageCanvas.getContext("2d");
        if (!ctx) continue;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, srcY, canvas.width, srcHeight, 0, 0, pageCanvas.width, pageCanvas.height);

        const imageData = pageCanvas.toDataURL("image/png");
        const drawHeight = (srcHeight * usableWidth) / canvas.width;
        pdf.addImage(imageData, "PNG", margin, margin, usableWidth, Math.min(drawHeight, usableHeight), undefined, "FAST");
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      const filialPart = selectedFilial
        ? `-${(data?.displayName ?? selectedFilial).replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48)}`
        : "";
      pdf.save(`curva-abc-${companyKey}${filialPart}-${dateStr}.pdf`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  const comparisonLabel = comparisonMode === "month" ? "mês anterior" : "mesmo período do ano anterior";

  const pageTitle = selectedFilial
    ? (data?.displayName ?? selectedFilial)
    : "Curva A,B,C";

  const pageSubtitle = selectedFilial
    ? "Performance de vendas"
    : "Visão geral — todas as filiais e e-commerce";
  const showEstoqueRede = selectedFilial !== null;

  const abcTitleSuffix = activeFilterLabels.length > 0
    ? ` - ${activeFilterLabels.join(" | ")}`
    : "";

  const nowStr = new Date().toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Curva A,B,C</h1>
          </div>

          <div className={styles.headerRight}>
            <div className={styles.periodFilter}>
              <DateRangeFilter
                label=""
                value={range}
                onChange={(nextRange) => setRange(nextRange)}
              />
            </div>
            <FilialFilter
              companyKey={companyKey}
              value={selectedFilial}
              onChange={setSelectedFilial}
              label=""
              showActiveGroupHint
              companyConfigOverride={data?.companyConfig ?? null}
            />
            {produtosComCurva.length > 0 && (
              <ExportMenu
                exportingPdf={exportingPdf}
                onExportCsv={handleExportSimpleCsv}
                onExportXlsx={handleExportSimpleXlsx}
                onExportPdf={handleExportPdf}
                onExportCompraIdealFilial={() => { void handleExportCompraIdealPorFilial(); }}
                compraIdealFilialLabel={
                  compraIdealFilialProgresso
                    ? `${compraIdealFilialProgresso.fase === "lendo" ? "Lendo lojas" : "Gerando"}… ${compraIdealFilialProgresso.feito}/${compraIdealFilialProgresso.total}`
                    : null
                }
              />
            )}
          </div>
        </div>
      </div>

      {/* Filter strip card */}
      {data && (
        <div className={styles.filterStripCard}>
          <div className={styles.filterStripLeft}>
            <span className={styles.comparisonLabel}>COMPARAÇÃO</span>
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
            <button
              type="button"
              className={`${styles.toggleBtn} ${porCor ? styles.toggleBtnActive : ""}`}
              onClick={() => setPorCor(v => !v)}
              title="Cada linha vira produto + cor (vendas, estoque e tooltips por cor)"
            >
              Por cor
            </button>
            <span className={styles.filterStripDivider} />
            {companyKey === 'nerd' && (
              <label className={styles.checkboxLabel} title="Filtra apenas produtos da linha Eletrônicos">
                <input
                  type="checkbox"
                  checked={filtrarEletronicos}
                  onChange={(e) => setFiltrarEletronicos(e.target.checked)}
                />
                Eletrônicos
              </label>
            )}
            <label className={styles.checkboxLabel} title="Mostra apenas produtos com sugestão de compra">
              <input
                type="checkbox"
                checked={filtrarSugeridos}
                onChange={(e) => setFiltrarSugeridos(e.target.checked)}
              />
              Sugeridos
            </label>
            <span className={styles.filterStripDivider} />
            {(["A", "B", "C"] as Curva[]).map(curva => (
              <label key={curva} className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={selectedCurvas.has(curva)}
                  onChange={() => handleCurveToggle(curva)}
                />
                <span className={styles.curvaCheckDot} data-curva={curva}>{curva}</span>
              </label>
            ))}
            {(selectedCurvas.size > 0 || selectedStockBuckets.size > 0 || filtrarSugeridos) && (
              <button
                type="button"
                className={styles.filtroClearBtn}
                onClick={() => {
                  setSelectedCurvas(new Set());
                  setSelectedStockBuckets(new Set());
                  setFiltrarSugeridos(false);
                }}
              >
                Limpar filtros
              </button>
            )}
          </div>
          <div className={styles.filterStripRight}>
            {availableSubgrupos.length > 0 && (
              <MultiSelectFilter
                label="Subgrupo"
                value={selectedSubgrupos}
                options={availableSubgrupos}
                onChange={setSelectedSubgrupos}
              />
            )}
            {availableGrades.length > 0 && (
              <MultiSelectFilter
                label="Grade"
                value={selectedGrades}
                options={availableGrades}
                onChange={setSelectedGrades}
              />
            )}
            {availableColecoes.length > 0 && (
              <MultiSelectFilter
                label="Coleção"
                value={selectedColecoes}
                options={availableColecoes}
                onChange={setSelectedColecoes}
              />
            )}
          </div>
        </div>
      )}

      {/* KPI cards row */}
      {data && (
        <div className={styles.kpiCardsRow}>
          <div className={`${styles.kpiCard} ${styles.kpiCardVendas}`}>
            <span className={styles.kpiLabel}>VENDAS</span>
            <span className={styles.kpiValue}>
              {(() => {
                const str = fmtCurrency(displayVendas);
                const ci = str.lastIndexOf(",");
                return ci === -1 ? str : <>{str.slice(0, ci)}<span className={styles.kpiValueCents}>{str.slice(ci)}</span></>;
              })()}
            </span>
            <div className={styles.kpiProjecaoRow}>
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
                    : `${variation.value >= 0 ? "↑" : "↓"} ${Math.abs(variation.value).toFixed(1)}%`}
                </span>
              )}
              {displayProjecao > 0 && (
                <span className={styles.kpiSubtitle}>Projeção {fmtCurrency(displayProjecao)}</span>
              )}
            </div>
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>QTD. VENDAS</span>
            <span className={styles.kpiValue}>{fmt(displayQtde)}</span>
            {produtosComCurvaExibidos.length > 0 && (
              <span className={styles.kpiSubtitle}>{fmt(produtosComCurvaExibidos.length)} itens</span>
            )}
          </div>
          <div className={styles.kpiCard}>
            <span className={styles.kpiLabel}>CMV</span>
            <span className={styles.kpiValue}>{displayCMV > 0 ? fmtCurrency(displayCMV) : "—"}</span>
            {displayCMV > 0 && displayVendas > 0 && (
              <span className={styles.kpiSubtitle}>
                margem {Math.round(((displayVendas - displayCMV) / displayVendas) * 100)}%
              </span>
            )}
          </div>
          <div className={styles.stockBucketInline}>
              {(["zero", "low", "high"] as StockBucket[]).map(bucket => {
                const count = stockBucketTotals[bucket];
                const isActive = selectedStockBuckets.has(bucket);
                const bucketColorClass = bucket === "zero" ? styles.stockBucketCountZero : bucket === "low" ? styles.stockBucketCountLow : styles.stockBucketCountHigh;
                return (
                  <button
                    key={bucket}
                    type="button"
                    data-bucket={bucket}
                    data-active={isActive ? "true" : undefined}
                    className={styles.stockBucketInlineRow}
                    onClick={() => handleStockBucketToggle(bucket)}
                    title={`Filtrar por: ${STOCK_BUCKET_LABEL[bucket]}`}
                  >
                    <span className={styles.stockBucketLabel}>{STOCK_BUCKET_LABEL[bucket]}</span>
                    <span className={`${styles.stockBucketCount} ${bucketColorClass}`}>{count}</span>
                  </button>
                );
              })}
            </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {!error && selectedFilial && (
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

      {activeTab === "vendedores" && selectedFilial && (
        <FilialVendedoresTab
          companyKey={companyKey}
          filial={selectedFilial}
          initialRange={range}
        />
      )}

      {activeTab === "produtos" && !loading && data && (
        <div ref={captureRef}>

          {/* Category section */}
          {displayedCategories.length > 0 && (
            <div className={styles.categorySection}>
              <div className={styles.categoryBadgesRow} style={{ marginBottom: 0 }}>
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
                const deltaClass = delta === null
                  ? styles.catDeltaNeutral
                  : delta >= 0 ? styles.catDeltaUp : styles.catDeltaDown;
                return (
                  <button
                    key={cat}
                    type="button"
                    className={`${styles.catPill} ${isActive ? styles.catPillActive : ""} ${isInactive ? styles.catPillInactive : ""}`}
                    title={`${baseTitle} | Variação vs ${comparisonLabel} | ${comparisonValuesTitle}`}
                    onClick={() => handleBadgeClick(cat)}
                  >
                    {getCategoryHeaderLabel(cat)}{" "}
                    <span className={deltaClass}>
                      {delta !== null ? formatCompactSignedPctForBadge(delta) : "—"}
                    </span>
                  </button>
                );
              })}
              </div>
            </div>
          )}

          {/* ABC Table */}
          <div className={styles.tableCard}>
            {produtosComCurvaExibidos.length === 0 && hasAnyDisplayFilter && (
              <div className={styles.empty}>
                {filtrarSugeridos
                  ? "Nenhum produto com sugestão de compra neste filtro."
                  : "Nenhum produto encontrado nos filtros selecionados neste período."}
              </div>
            )}
            {produtosComCurvaExibidos.length === 0 && !hasAnyDisplayFilter && (
              <div className={styles.empty}>
                {filtrarSugeridos
                  ? "Nenhum produto com sugestão de compra neste filtro."
                  : "Nenhum produto encontrado para este período."}
              </div>
            )}
            {produtosComCurvaExibidos.length > 0 && (
              <table className={styles.table} ref={tableRef}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }} />
                    <th>
                      Produto
                      {abcTitleSuffix && <span className={styles.thFilterLabel}>{abcTitleSuffix}</span>}
                    </th>
                    <th className={styles.obsHeader}>Obs.</th>
                    <>
                      <th className={styles.right}>Participação</th>
                      <th className={styles.right}>Faturamento no período</th>
                      <th className={styles.right}>Qtd vendida</th>
                      <th className={styles.right}>Estoque</th>
                      {showEstoqueRede && <th className={styles.right}>Estoque rede</th>}
                      <th className={styles.right}>Markup</th>
                      <th className={styles.right}>Compra ideal</th>
                    </>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(curva => {
                    const grupo = produtosComCurvaExibidos.filter(p => p.curva === curva);
                    if (grupo.length === 0) return null;
                    return (
                      <React.Fragment key={curva}>
                        <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                          <td colSpan={showEstoqueRede ? 10 : 9}>
                            <div className={styles.sectionLabel}>
                              <span className={`${styles.curvaBadge} ${CURVA_BADGE_CLASS[curva]}`}>{curva}</span>
                              <span className={styles.sectionTitle}>{CURVA_LABEL[curva]}</span>
                              <span className={styles.sectionCount}>
                                {grupo.length} {porCor ? "itens" : "produtos"}
                              </span>
                            </div>
                          </td>
                        </tr>
                        {grupo.map((p, i) => {
                          const rankGlobal = produtosComCurvaExibidos.indexOf(p) + 1;
                          const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
                          const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
                          const obsResolved = resolveObservacao(buildCurvaAbcMetricKey(p.produto, p.cor ?? null, porCor));
                          return (
                            <tr
                              key={`${p.produto}-${p.categoria}-${p.cor ?? ""}-${p.grade ?? ""}`}
                              className={p.descontinuado ? styles.descontinuadoRow : ""}
                            >
                              <td>
                                <span className={`${styles.rank} ${i < 3 && curva === "A" ? styles.top : ""}`}>
                                  {rankGlobal}
                                </span>
                              </td>
                              <td>
                                <div className={styles.productDetailLink}>
                                  <div className={styles.productNameRow}>
                                    <span className={styles.productName}>{p.descricao || p.produto}</span>
                                    {!p.isGroupedProduct && renderRowActionIcons(companyKey, p)}
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
                                    {p.isGroupedProduct && (p.groupedMembers?.length ?? 0) > 0 && (
                                      <div className={`${styles.groupedTooltipWrapper} ${styles.inlineTooltipWrapper}`}>
                                        <span className={styles.groupedBadge}>grupo</span>
                                        <div className={styles.inlineTooltipPanel}>
                                          <div className={styles.inlineTooltipTitle}>Produtos do grupo</div>
                                          <div className={styles.inlineTooltipList}>
                                            {(p.groupedMembers ?? []).map(m => (
                                              <div key={m.produto} className={styles.inlineTooltipRow}>
                                                {renderGroupedMemberLabel(m, false)}
                                                <span className={styles.inlineTooltipActions}>
                                                  {renderRowActionIcons(companyKey, m)}
                                                </span>
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
                                    )}
                                    {p.descontinuado && (
                                      <span className={styles.descontinuadoBadge}>DESCONTINUADO</span>
                                    )}
                                  </div>
                                  {p.isGroupedProduct ? (
                                    <div className={styles.productMeta}>
                                      {(p.groupedMembers?.length ?? 0) > 0 && (
                                        <span className={styles.productCode}>
                                          {(p.groupedMembers ?? []).map(m => m.produto).join(" / ")}
                                        </span>
                                      )}
                                      {(p.groupedMembers?.length ?? 0) > 0 && p.categoria && (
                                        <span className={styles.productMetaSeparator}>|</span>
                                      )}
                                      {p.categoria && (
                                        <span className={styles.productCategoria}>
                                          {getCategoryHeaderLabel(p.categoria)}
                                        </span>
                                      )}
                                    </div>
                                  ) : ((p.descricao && p.produto !== p.descricao) || p.categoria || p.codigoBarra) ? (
                                    <div className={styles.productMeta}>
                                      {((p.descricao && p.produto !== p.descricao) || p.codigoBarra) && (
                                        <span className={styles.productCode}>{p.produto}</span>
                                      )}
                                      {((p.descricao && p.produto !== p.descricao) || p.codigoBarra) && p.codigoBarra && (
                                        <span className={styles.productMetaSeparator}>|</span>
                                      )}
                                      {p.codigoBarra && (
                                        <span className={styles.productCategoria}>
                                          CB: {p.codigoBarra}
                                        </span>
                                      )}
                                      {((p.descricao && p.produto !== p.descricao) || p.codigoBarra) && p.categoria && (
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
                                  ) : null}
                                  {porCor && (p.corDescricao || p.cor) && (
                                    <div className={styles.productCode} style={{ marginTop: 4 }}>
                                      Cor: {p.corDescricao || p.cor}
                                      {companyKey === "scarfme"
                                        ? [
                                            formatProductInfoValue(p.subgrupo),
                                            formatProductInfoValue(p.tipoProduto),
                                            formatCollectionCode(p.colecao),
                                          ]
                                            .filter(Boolean)
                                            .map((value) => ` | ${value}`)
                                            .join("")
                                        : ""}
                                    </div>
                                  )}
                                </div>
                              </td>
                              <td className={styles.obsCell}>
                                <ObservacaoCell
                                  produto={p.produto}
                                  cor={p.cor ?? null}
                                  usarCor={porCor}
                                  filialScope={observacaoFilialScope}
                                  filialLabel={observacaoFilialLabel}
                                  inherited={obsResolved.inherited}
                                  titulo={p.descricao || p.produto}
                                  codigo={p.produto}
                                  corLabel={p.corDescricao || p.cor || null}
                                  observacao={obsResolved.value}
                                  onSave={saveObservacaoValue}
                                />
                              </td>
                              <>
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
                              <td className={styles.vendas}>
                                {renderGroupedMetricTooltip(
                                  p,
                                  "Faturamento por produto",
                                  fmtBRL(p.vendas),
                                  fmtBRL,
                                  (member) => Number(member.vendas ?? 0),
                                  { totalValue: p.vendas, alignRight: true }
                                )}
                              </td>
                              <td className={styles.vendas}>
                                {p.isGroupedProduct && (p.groupedMembers?.length ?? 0) > 0 ? (
                                  renderGroupedMetricTooltip(
                                    p,
                                    "Qtde por produto",
                                    fmt(p.qtde),
                                    fmt,
                                    (member) => Number(member.qtde ?? 0),
                                    { totalValue: p.qtde, alignRight: true }
                                  )
                                ) : p.qtdePorFilial && p.qtdePorFilial.length > 1 ? (
                                  <div className={styles.qtdeTooltipWrapper}>
                                    <span>{fmt(p.qtde)}</span>
                                    <div className={styles.qtdeTooltipContent}>
                                      <div className={styles.tooltipTitle}>Onde vendeu</div>
                                      {p.qtdePorFilial.map(entry => (
                                        <div key={entry.filial} className={styles.tooltipRow}>
                                          <span className={styles.tooltipFilial}>{entry.displayName}</span>
                                          <span className={styles.tooltipQtde}>{fmt(entry.qtde)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  fmt(p.qtde)
                                )}
                              </td>
                              <td className={styles.vendas}>
                                {p.estoquePorFilial && p.estoquePorFilial.length > 0 ? (
                                  renderFilialMetricTooltip(
                                    "Estoque por filial",
                                    fmt(p.estoque ?? 0),
                                    p.estoquePorFilial,
                                    fmt
                                  )
                                ) : (
                                  fmt(p.estoque ?? 0)
                                )}
                              </td>
                              {showEstoqueRede && (
                                <td className={styles.vendas}>
                                  {p.estoqueRedePorFilial && p.estoqueRedePorFilial.length > 0 ? (
                                    renderFilialMetricTooltip(
                                      "Estoque por filial",
                                      fmt(p.estoqueRede ?? 0),
                                      p.estoqueRedePorFilial,
                                      fmt
                                    )
                                  ) : (
                                    fmt(p.estoqueRede ?? 0)
                                  )}
                                </td>
                              )}
                              <td className={styles.vendas}>
                                {markup !== null
                                  ? renderGroupedMetricTooltip(
                                      p,
                                      "Markup por produto",
                                      <span className={styles.markupBadge}>{markup.toFixed(2)}x</span>,
                                      (value) => `${value.toFixed(2)}x`,
                                      (member) => Number(member.markup ?? 0),
                                      { alignRight: true }
                                    )
                                  : <span className={styles.noData}>—</span>}
                              </td>
                              <td className={styles.vendas}>
                                  {(() => {
                                    const metricKey = buildCurvaAbcMetricKey(p.produto, p.cor ?? null, porCor);
                                    const live = compraMetrics[metricKey];
                                    const hasLive = Object.prototype.hasOwnProperty.call(compraMetrics, metricKey);
                                    if (!hasLive) {
                                      return <span className={styles.cellMetric}>Carregando...</span>;
                                    }
                                    const semBaseLive =
                                      live?.qtde12m == null &&
                                      live?.vendasMesAtual == null &&
                                      live?.estoqueFilial == null;
                                    if (semBaseLive) {
                                      return <span className={styles.cellMetric}>Sem dados</span>;
                                    }
                                    const corCat = porCor ? (p.cor ?? null) : null;
                                    const idealCru = buildCompraIdealFromMetricRow(live, p, comprasTransitoIndex, porCor, companyKey);
                                    const { ideal } = catraca.reconcile(
                                      idealCru,
                                      buildControleEstoqueItemKey(p.produto, corCat),
                                      getCompraTransitoEntries(comprasTransitoIndex, p.produto, corCat)
                                    );
                                    return <CompraIdealCell ideal={ideal} />;
                                  })()}
                                </td>
                              </>
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
        </div>
      )}
      <div ref={stickyBarRef} className={styles.stickyTableHeader} style={{ display: "none" }}>
        <table style={{ width: "100%", borderCollapse: "separate", borderSpacing: 0, tableLayout: "fixed" }}>
          <thead>
            <tr>
              {["", "Produto", "Obs.", "Participação", "Faturamento no período", "Qtd vendida", "Estoque", ...(showEstoqueRede ? ["Estoque rede"] : []), "Markup", "Compra ideal"].map((label, i) => (
                <th key={i} className={styles.stickyTableHeaderTh} style={{ textAlign: i >= 3 ? "right" : "left" }}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      {sugestaoTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(sugestaoTooltip.x, sugestaoTooltip.y)}>
          <div className={styles.metricTooltipTitle}>{sugestaoTooltip.titulo}: {fmt(sugestaoTooltip.qtdCalculada)} un</div>
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            {sugestaoTooltip.blendAplicado
              ? "Mês atual fraco. Misturou consumo do mês com histórico."
              : "Estoque abaixo do alvo de cobertura."}
          </div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Estoque</span><span><strong>{fmt(sugestaoTooltip.estoqueAtual)} un</strong></span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Cobertura</span><span><strong>{Math.max(0, Math.round(sugestaoTooltip.duracaoAtual))}d</strong> / alvo {sugestaoTooltip.limiteDias}d</span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Consumo</span><span>{sugestaoTooltip.consumoDiario.toFixed(2)} un/dia ({fmt(sugestaoTooltip.vendasMesAtual)} vendas / {sugestaoTooltip.diasCorridos}d)</span>
          </div>
          {sugestaoTooltip.blendAplicado && sugestaoTooltip.qtdFinalPuro != null && sugestaoTooltip.qtdSBlend != null && (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ color: "#64748b", fontSize: 11 }}>
                Mês atual abaixo do normal. A sugestão final misturou o cálculo do mês com o histórico.
              </div>
              <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Sugestão pelo mês atual</span><span style={{ fontSize: 11 }}>{fmt(sugestaoTooltip.qtdFinalPuro)} un</span>
              </div>
              <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Sugestão pelo histórico</span><span style={{ fontSize: 11 }}>{fmt(sugestaoTooltip.qtdSBlend)} un</span>
              </div>
              {sugestaoTooltip.historicoQtde12m != null &&
              sugestaoTooltip.historicoDiasComEstoquePositivo != null &&
              sugestaoTooltip.historicoVelocidadeAjustada != null ? (
                <>
                  <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                    Base histórica: {fmt(sugestaoTooltip.historicoQtde12m)} vendas em {fmt(sugestaoTooltip.historicoDiasComEstoquePositivo)} dias com estoque
                  </div>
                  <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                    Projeção histórica: {Math.round(sugestaoTooltip.historicoVelocidadeAjustada)} un/mês
                    {sugestaoTooltip.historicoMesesDisponiveis != null ? ` (${sugestaoTooltip.historicoMesesDisponiveis.toFixed(2)} meses disponíveis)` : ""}
                  </div>
                </>
              ) : null}
            </>
          )}
          {sugestaoTooltip.distribuicao && sugestaoTooltip.distribuicao.length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                {sugestaoTooltip.distribuicaoLabel ?? "Por loja (proporcional)"}
              </div>
              {(() => {
                const totalVendas = sugestaoTooltip.distribuicao.reduce((s, f) => s + (f.qtde12m ?? 0), 0);
                return sugestaoTooltip.distribuicao.map((f) => (
                  <div key={f.label} className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <span>{f.label}</span>
                    <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      {totalVendas > 0 && <span style={{ fontSize: 11, color: "#64748b" }}>[{f.qtde12m ?? 0}/{totalVendas}]</span>}
                      <strong>{fmt(f.qtd)} un</strong>
                    </span>
                  </div>
                ));
              })()}
            </>
          ) : null}
          {sugestaoTooltip.transitTotal ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ color: "#0f766e" }}>
                <strong>+{fmt(sugestaoTooltip.transitTotal)} em trânsito</strong>
              </div>
              {sugestaoTooltip.transitDates?.map((label) => (
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>{label}</div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoSTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(sugestaoSTooltip.x, sugestaoSTooltip.y)}>
          <div className={styles.metricTooltipTitle}>S → {fmt(sugestaoSTooltip.qtdS)} un</div>
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            Produto sem estoque. Velocidade calculada nos dias com venda disponível.
          </div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Velocidade</span><span><strong>{sugestaoSTooltip.velocidadeAjustada.toFixed(1)} un/mês</strong></span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Estoque</span><span><strong>{fmt(sugestaoSTooltip.estoqueAtual)} un</strong></span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Alvo</span><span>{sugestaoSTooltip.limiteDias} dias</span>
          </div>
          {sugestaoSTooltip.distribuicao && sugestaoSTooltip.distribuicao.length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Por loja (proporcional)</div>
              {sugestaoSTooltip.distribuicao.map((f) => (
                <div key={f.label} className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span>{f.label}</span><strong>{fmt(f.qtd)} un</strong>
                </div>
              ))}
            </>
          ) : null}
          {sugestaoSTooltip.transitTotal ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ color: "#0f766e" }}>
                <strong>+{fmt(sugestaoSTooltip.transitTotal)} em trânsito</strong>
              </div>
              {sugestaoSTooltip.transitDates?.map((label) => (
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>{label}</div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoETooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(sugestaoETooltip.x, sugestaoETooltip.y)}>
          <div className={styles.metricTooltipTitle}>E → {fmt(sugestaoETooltip.qtdE)} un</div>
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
            Produto zerado. Velocidade estimada do período com estoque disponível.
          </div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Velocidade</span><span><strong>{sugestaoETooltip.velocidadeAjustada.toFixed(1)} un/mês</strong></span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Alvo</span><span>{sugestaoETooltip.limiteDias} dias</span>
          </div>
          {sugestaoETooltip.distribuicao && sugestaoETooltip.distribuicao.length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Por loja (proporcional)</div>
              {sugestaoETooltip.distribuicao.map((f) => (
                <div key={f.label} className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span>{f.label}</span><strong>{fmt(f.qtd)} un</strong>
                </div>
              ))}
            </>
          ) : null}
          {sugestaoETooltip.transitTotal ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ color: "#0f766e" }}>
                <strong>+{fmt(sugestaoETooltip.transitTotal)} em trânsito</strong>
              </div>
              {sugestaoETooltip.transitDates?.map((label) => (
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>{label}</div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoPOTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(sugestaoPOTooltip.x, sugestaoPOTooltip.y)}>
          <div className={styles.metricTooltipTitle} style={{ color: "#059669" }}>
            {(sugestaoPOTooltip.limiteSeguro ?? 0) > 0 ? "Potencial Oculto (PO)" : "Histórico Curto (PO)"}
          </div>
          {(sugestaoPOTooltip.limiteSeguro ?? 0) > 0 && (
            <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
              Vendeu bem em período curto e ficou sem estoque.
            </div>
          )}
          {sugestaoPOTooltip.poRows && sugestaoPOTooltip.poRows.length > 1 ? (
            <>
              {sugestaoPOTooltip.poRows.map((row, index) => (
                <React.Fragment key={`${row.filialLabel}-${index}`}>
                  <div className={styles.metricTooltipLine}>
                    <strong style={{ color: "#047857" }}>{row.filialLabel}</strong>
                    {row.periodoRef && <span style={{ color: "#64748b", fontWeight: 400 }}> ({row.periodoRef})</span>}
                    <span style={{ color: "#94a3b8" }}> | </span>
                    <span>Sugestão: <strong>{row.qtdPO} un</strong></span>
                  </div>
                  <div className={styles.metricTooltipLine} style={{ fontSize: 11 }}>
                    Vendas: {row.qtde12m} un em {Math.round(row.diasComEstoquePositivo)} dias c/ estoque
                    <span style={{ color: "#94a3b8" }}> | </span>
                    <strong>{row.velocidadeAjustada.toFixed(0)} un/mês</strong>
                  </div>
                  {row.diasSemEstoque > 0 ? (
                    <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                      {Math.round(row.diasSemEstoque)} dias sem estoque
                    </div>
                  ) : null}
                  {index < sugestaoPOTooltip.poRows!.length - 1 ? <div className={styles.metricTooltipDivider} /> : null}
                </React.Fragment>
              ))}
            </>
          ) : (
            <>
              {sugestaoPOTooltip.filialLabel ? (
                <div className={styles.metricTooltipLine}>
                  <strong style={{ color: "#047857" }}>{sugestaoPOTooltip.filialLabel}</strong>
                  {sugestaoPOTooltip.periodoRef && <span style={{ color: "#64748b", fontWeight: 400 }}> ({sugestaoPOTooltip.periodoRef})</span>}
                  {sugestaoPOTooltip.qtdPO != null && (
                    <>
                      <span style={{ color: "#94a3b8" }}> | </span>
                      <span>Sugestão: <strong>{sugestaoPOTooltip.qtdPO} un</strong></span>
                    </>
                  )}
                </div>
              ) : null}
              {sugestaoPOTooltip.qtde12m != null && sugestaoPOTooltip.diasComEstoquePositivo != null && (
                <div className={styles.metricTooltipLine} style={{ fontSize: 11 }}>
                  Vendas: {sugestaoPOTooltip.qtde12m} un em {Math.round(sugestaoPOTooltip.diasComEstoquePositivo)} dias c/ estoque
                  {sugestaoPOTooltip.velocidadeAjustada != null && (
                    <>
                      <span style={{ color: "#94a3b8" }}> | </span>
                      <strong>{sugestaoPOTooltip.velocidadeAjustada.toFixed(0)} un/mês</strong>
                    </>
                  )}
                </div>
              )}
              {(sugestaoPOTooltip.diasSemEstoque ?? 0) > 0 && (
                <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                  {Math.round(sugestaoPOTooltip.diasSemEstoque ?? 0)} dias sem estoque
                </div>
              )}
            </>
          )}
          {sugestaoPOTooltip.transitTotal ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ color: "#0f766e" }}>
                <strong>+{fmt(sugestaoPOTooltip.transitTotal)} em trânsito</strong>
              </div>
              {sugestaoPOTooltip.transitDates?.map((label) => (
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>{label}</div>
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

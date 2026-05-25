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

interface ProdutoComCurva extends ProdutoRow {
  curva: Curva;
  percParticipacao: number;
  percCumulativa: number;
}

type CompraMetricRow = {
  qtde12m: number | null;
  vendasMesAtual: number | null;
  estoqueFilial: number | null;
  diasDesdeUltimaVenda: number | null;
  mesesHistoricoFilial: number | null;
  diasComEstoquePositivo: number | null;
  diasSemEstoque: number | null;
  mesesDisponiveis: number | null;
  velocidadeAjustada: number | null;
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

const EMPTY_COMPRA_METRIC_ROW: CompraMetricRow = {
  qtde12m: null,
  vendasMesAtual: null,
  estoqueFilial: null,
  diasDesdeUltimaVenda: null,
  mesesHistoricoFilial: null,
  diasComEstoquePositivo: null,
  diasSemEstoque: null,
  mesesDisponiveis: null,
  velocidadeAjustada: null,
  totalNmQty: null,
  filiaisNM: null,
  vendasPorFilial: null,
  estoquePorFilial: null,
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
      const diasSemEstoque = Math.max(0, 365 - diasComEstoquePositivo);
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
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"produtos" | "vendedores">("produtos");
  const [porCor, setPorCor] = useState(true);
  const [filtrarEletronicos, setFiltrarEletronicos] = useState(companyKey === 'nerd');
  const [filtrarSugeridos, setFiltrarSugeridos] = useState(false);
  const [selectedCurvas, setSelectedCurvas] = useState<Set<Curva>>(new Set());
  const [compraMetrics, setCompraMetrics] = useState<Record<string, CompraMetricRow>>({});
  const [comprasTransitoIndex, setComprasTransitoIndex] = useState<CompraTransitoIndex>(new Map());
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
    poRows?: Array<{
      filialLabel: string;
      qtde12m: number;
      diasComEstoquePositivo: number;
      diasSemEstoque: number;
      velocidadeAjustada: number;
      limiteSeguro: number;
      qtdPO: number;
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
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const captureRef = useRef<HTMLDivElement | null>(null);

  // Quando filial muda, voltar para aba de produtos
  useEffect(() => {
    setActiveTab("produtos");
    setSelectedCategory(null);
  }, [selectedFilial]);

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
    fetch(`/api/curva-abc?${params}`, { cache: "no-store" })
      .then(res => res.json())
      .then((json: FilialData & { error?: string }) => {
        if (json.error) throw new Error(json.error);
        setData(json);
      })
      .catch(e => setError(e instanceof Error ? e.message : "Erro desconhecido"))
      .finally(() => setLoading(false));
  }, [companyKey, selectedFilial, selectedMonth, selectedYear, comparisonMode, range.startDate, range.endDate, porCor]);

  useEffect(() => {
    if (!exportMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [exportMenuOpen]);

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
  ].filter((value): value is string => Boolean(value));

  const hasStructuredFilters = activeStructureFilterLabels.length > 0;

  const produtosComCurva = useMemo(() => {
    if (produtosFiltrados.length === 0) return [];
    return calcularCurvas(produtosFiltrados);
  }, [produtosFiltrados]);
  const diasCorridosMes = Math.max(1, new Date().getDate());

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
      const compraItem = {
        vendasMesAtual: live?.vendasMesAtual ?? 0,
        estoqueFilial: live?.estoqueFilial ?? 0,
        linha: p.linha ?? "",
        subgrupo: p.subgrupo ?? "",
        qtde12m: live?.qtde12m ?? 0,
        mesesHistoricoFilial: live?.mesesHistoricoFilial ?? 12,
        diasDesdeUltimaVenda: live?.diasDesdeUltimaVenda ?? null,
        diasComEstoquePositivo: live?.diasComEstoquePositivo ?? null,
        diasSemEstoque: live?.diasSemEstoque ?? null,
        mesesDisponiveis: live?.mesesDisponiveis ?? null,
        velocidadeAjustada: live?.velocidadeAjustada ?? null,
      };
      const sugestao = getReposicaoCompraView(compraItem, diasCorridosMes);
      const baseType = getReposicaoBaseType(sugestao);
      const baseQty =
        sugestao.qtdFinal > 0
          ? sugestao.qtdFinal
          : sugestao.qtdS > 0
            ? sugestao.qtdS
            : sugestao.qtdE > 0
              ? sugestao.qtdE
              : sugestao.qtdPO > 0
                ? sugestao.qtdPO
                : sugestao.qtdNM;
      const combined = combineBaseSuggestionWithNecessidadeMinima({
        baseType,
        baseQty,
        totalNmQty: live?.totalNmQty ?? sugestao.qtdNM,
      });
      const transit = applyTransitToSuggestion({
        baseType: combined.effectiveType,
        baseQty: combined.totalQty,
        entries: getCompraTransitoEntries(comprasTransitoIndex, p.produto, porCor ? (p.cor ?? null) : null),
        estoqueAtual: compraItem.estoqueFilial,
        vendasMesAtual: compraItem.vendasMesAtual,
        diasCorridosMes,
        limiteDias: getLimiteDiasReposicao(compraItem),
      });
      return transit.qty > 0;
    });
  }, [filtrarEletronicos, filtrarSugeridos, companyKey, produtosComCurva, compraMetrics, comprasTransitoIndex, diasCorridosMes, porCor]);

  const produtosComCurvaExibidos = useMemo(() => {
    if (selectedCurvas.size === 0) return produtosComCurvaComFiltroSugestao;
    return produtosComCurvaComFiltroSugestao.filter((p) => selectedCurvas.has(p.curva));
  }, [produtosComCurvaComFiltroSugestao, selectedCurvas]);

  const maxPerc = produtosComCurvaExibidos.length > 0 ? produtosComCurvaExibidos[0].percParticipacao : 1;
  const countA = produtosComCurvaComFiltroSugestao.filter(p => p.curva === "A").length;
  const countB = produtosComCurvaComFiltroSugestao.filter(p => p.curva === "B").length;
  const countC = produtosComCurvaComFiltroSugestao.filter(p => p.curva === "C").length;
  const groups: Curva[] = ["A", "B", "C"];

  const displayVendas = hasStructuredFilters
    ? produtosFiltrados.reduce((s, p) => s + p.vendas, 0)
    : data?.vendas ?? 0;
  const displayQtde = hasStructuredFilters
    ? produtosFiltrados.reduce((s, p) => s + p.qtde, 0)
    : data?.qtde ?? 0;
  const displayCMV = produtosFiltrados.reduce((s, p) => s + p.custo * p.qtde, 0);
  const hasAnyDisplayFilter = hasStructuredFilters || filtrarSugeridos || selectedCurvas.size > 0;
  const displayedCountLabel = selectedCurvas.size > 0
    ? `${Array.from(selectedCurvas).join(", ")} ${porCor ? "itens exibidos" : "produtos exibidos"}`
    : porCor
      ? "ITENS (PROD. + COR)"
      : "PRODUTOS ÚNICOS";

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
                vendasMesAtual: value.resumo.vendasMesAtual,
                estoqueFilial: value.resumo.estoqueTotal,
                diasDesdeUltimaVenda: value.resumo.diasDesdeUltimaVenda,
                mesesHistoricoFilial: value.resumo.mesesHistoricoFilial,
                diasComEstoquePositivo: value.resumo.diasComEstoquePositivo,
                diasSemEstoque: value.resumo.diasSemEstoque,
                mesesDisponiveis: value.resumo.mesesDisponiveis,
                velocidadeAjustada: value.resumo.velocidadeAjustada,
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
                vendasMesAtual: merged.resumo.vendasMesAtual,
                estoqueFilial: merged.resumo.estoqueTotal,
                diasDesdeUltimaVenda: merged.resumo.diasDesdeUltimaVenda,
                mesesHistoricoFilial: merged.resumo.mesesHistoricoFilial,
                diasComEstoquePositivo: merged.resumo.diasComEstoquePositivo,
                diasSemEstoque: merged.resumo.diasSemEstoque,
                mesesDisponiveis: merged.resumo.mesesDisponiveis,
                velocidadeAjustada: merged.resumo.velocidadeAjustada,
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

    const perFilialSummary = !selectedFilial && live
      ? buildPerFilialCompraSummary({
          companyKey,
          linha: p.linha ?? "",
          subgrupo: p.subgrupo ?? "",
          diasCorridosMes,
          live,
        })
      : null;
    if (perFilialSummary) {
      const limiteDias = getLimiteDiasReposicao({ linha: p.linha ?? "", subgrupo: p.subgrupo ?? "" });
      const transit = applyTransitToSuggestion({
        baseType: perFilialSummary.topType,
        baseQty: perFilialSummary.totalQty,
        entries: getCompraTransitoEntries(comprasTransitoIndex, p.produto, porCor ? (p.cor ?? null) : null),
        estoqueAtual: live?.estoqueFilial ?? 0,
        vendasMesAtual: live?.vendasMesAtual ?? 0,
        diasCorridosMes,
        limiteDias,
      });
      if (transit.qty <= 0) return "";
      return transit.qty;
    }

    const compraItem = {
      vendasMesAtual: live?.vendasMesAtual ?? 0,
      estoqueFilial: live?.estoqueFilial ?? 0,
      linha: p.linha ?? "",
      subgrupo: p.subgrupo ?? "",
      qtde12m: live?.qtde12m ?? 0,
      mesesHistoricoFilial: live?.mesesHistoricoFilial ?? 12,
      diasDesdeUltimaVenda: live?.diasDesdeUltimaVenda ?? null,
      diasComEstoquePositivo: live?.diasComEstoquePositivo ?? null,
      diasSemEstoque: live?.diasSemEstoque ?? null,
      mesesDisponiveis: live?.mesesDisponiveis ?? null,
      velocidadeAjustada: live?.velocidadeAjustada ?? null,
    };
    const sugestao = getReposicaoCompraView(compraItem, diasCorridosMes);
    const baseType = getReposicaoBaseType(sugestao);
                                      const baseQty =
                                        sugestao.qtdFinal > 0
                                          ? sugestao.qtdFinal
                                          : sugestao.qtdS > 0
                                            ? sugestao.qtdS
                                            : sugestao.qtdE > 0
                                              ? sugestao.qtdE
                                              : sugestao.qtdPO > 0
                                                ? sugestao.qtdPO
                                                : sugestao.qtdNM;
    const combined = combineBaseSuggestionWithNecessidadeMinima({
      baseType,
      baseQty,
      totalNmQty: live?.totalNmQty ?? sugestao.qtdNM,
    });
    const transit = applyTransitToSuggestion({
      baseType: combined.effectiveType,
      baseQty: combined.totalQty,
      entries: getCompraTransitoEntries(comprasTransitoIndex, p.produto, porCor ? (p.cor ?? null) : null),
      estoqueAtual: compraItem.estoqueFilial,
      vendasMesAtual: compraItem.vendasMesAtual,
      diasCorridosMes,
      limiteDias: getLimiteDiasReposicao(compraItem),
    });

    if (baseType === "SUFICIENTE") return "";
    if (transit.qty <= 0) return "";
    return transit.qty;
  };

  const buildExportSimpleRows = (): CurvaAbcSimpleXlsxRow[] => {
    if (produtosComCurvaExibidos.length === 0) return [];
    const rows: CurvaAbcSimpleXlsxRow[] = [];
    for (const curva of groups) {
      const grupo = produtosComCurvaExibidos.filter(p => p.curva === curva);
      for (const p of grupo) {
        const rankGlobal = produtosComCurvaExibidos.indexOf(p) + 1;
        const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
        const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
        const cmp = getComparisonBadge(p.vendas, p.vendasPrevious);
        let variacao: number | string = "";
        if (cmp?.kind === "new") variacao = "NOVO";
        else if (cmp?.kind === "pct") variacao = Math.round(cmp.value * 10) / 10;
        rows.push({
          RANK: rankGlobal,
          CURVA: curva,
          DESCRICAO: p.descricao || p.produto,
          PRODUTO: p.produto,
          CODIGO_BARRA: p.codigoBarra || "",
          LINHA: p.linha?.trim() || "",
          SUBGRUPO: p.subgrupo?.trim() || "",
          TIPO_PRODUTO: p.tipoProduto?.trim() || "",
          COLECAO: p.colecao?.trim() || "",
          GRADE: companyKey === "scarfme" ? (p.grade ?? "") : "",
          COR_DESCRICAO: porCor ? (p.corDescricao || p.cor || "") : "",
          PERC_PARTICIPACAO: Math.round(p.percParticipacao * 10) / 10,
          PERC_ACUMULADA: Math.round(p.percCumulativa * 1000) / 10,
          VENDAS: Math.round(p.vendas * 100) / 100,
          QTDE: p.qtde,
          ESTOQUE: p.estoque ?? 0,
          MARKUP: markup !== null ? Math.round(markup * 100) / 100 : "",
          SUGESTAO_COMPRA: getSugestaoCompraExportValue(p),
          VAR_VS_PERIODO_ANTERIOR: variacao,
        });
      }
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
    setExportMenuOpen(false);
    exportCurvaAbcSimpleXlsx(rows, {
      ...exportOptions,
    });
  };

  const handleExportSimpleCsv = () => {
    const rows = buildExportSimpleRows();
    if (rows.length === 0) return;
    setExportMenuOpen(false);
    exportCurvaAbcSimpleCsv(rows, exportOptions);
  };

  const handleExportPdf = async () => {
    const target = captureRef.current;
    if (!target || produtosComCurvaExibidos.length === 0) return;

    setExportMenuOpen(false);
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

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div>
              <h1 className={styles.title}>{pageTitle}</h1>
              <p className={styles.subtitle}>{pageSubtitle}</p>
              <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
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
              </div>
            </div>
          </div>

          {/* KPI Cards inline */}
          {data && (
            <div className={styles.kpiCards}>
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>VENDAS</span>
                <span className={styles.kpiValue}>{fmtCurrency(displayVendas)}</span>
                {!hasStructuredFilters && <span className={styles.kpiProjecao}>Projeção: {fmtCurrency(data.projecao)}</span>}
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
              <div className={styles.kpiCard}>
                <span className={styles.kpiLabel}>CMV</span>
                <span className={styles.kpiValue}>{displayCMV > 0 ? fmtCurrency(displayCMV) : "—"}</span>
              </div>
            </div>
          )}
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
          {selectedFilial && (
            <button
              type="button"
              className={`${styles.tabBtn} ${activeTab === "vendedores" ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab("vendedores")}
            >
              Vendedores
            </button>
          )}
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
                <span className={styles.summaryLabel}>{displayedCountLabel}</span>
                <span className={styles.summaryValueNeutral}>{produtosComCurvaExibidos.length}</span>
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
              {activeFilterLabels.length > 0 && (
                <>
                  <div className={styles.summaryDivider} />
                  <div className={styles.summaryItem}>
                    <span className={styles.summaryLabel}>Filtros ativos</span>
                    <div className={styles.activeFilterBadges}>
                      {activeFilterLabels.map((label) => (
                        <span key={label} className={styles.filterActiveBadge}>{label}</span>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {/* Comparação toggle + export visão simples */}
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
            <button
              type="button"
              className={`${styles.toggleBtn} ${porCor ? styles.toggleBtnActive : ""}`}
              onClick={() => setPorCor(v => !v)}
              title="Cada linha vira produto + cor (vendas, estoque e tooltips por cor)"
            >
              Por cor
            </button>
            {companyKey === 'nerd' && (
              <label
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  marginLeft: 6,
                  fontSize: 13,
                  color: "#334155",
                  userSelect: "none",
                }}
                title="Filtra apenas produtos da linha Eletrônicos"
              >
                <input
                  type="checkbox"
                  checked={filtrarEletronicos}
                  onChange={(e) => setFiltrarEletronicos(e.target.checked)}
                />
                Eletrônicos
              </label>
            )}
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                marginLeft: 6,
                fontSize: 13,
                color: "#334155",
                userSelect: "none",
              }}
              title="Mostra apenas produtos com sugestão de compra"
            >
              <input
                type="checkbox"
                checked={filtrarSugeridos}
                onChange={(e) => setFiltrarSugeridos(e.target.checked)}
              />
              Sugeridos
            </label>
            {(["A", "B", "C"] as const).map((curva) => (
              <label key={curva} className={styles.filtroToggle}>
                <input
                  type="checkbox"
                  checked={selectedCurvas.has(curva)}
                  onChange={(e) => {
                    setSelectedCurvas((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(curva);
                      else next.delete(curva);
                      return next;
                    });
                  }}
                />
                <span className={`${styles.abcBadgeMini} ${styles[`abcBadge${curva}`]}`}>{curva}</span>
              </label>
            ))}
            {(selectedCurvas.size > 0 || filtrarSugeridos) && (
              <button
                type="button"
                className={styles.filtroClearBtn}
                onClick={() => {
                  setSelectedCurvas(new Set());
                  setFiltrarSugeridos(false);
                }}
              >
                Limpar filtros
              </button>
            )}
            {produtosComCurva.length > 0 && (
              <div className={styles.exportMenuWrap} ref={exportMenuRef}>
                <button
                  type="button"
                  className={styles.exportMenuTrigger}
                  onClick={() => setExportMenuOpen((prev) => !prev)}
                  title="Escolher formato de exportacao"
                  aria-haspopup="menu"
                  aria-expanded={exportMenuOpen}
                >
                  Exportar ▼
                </button>
                {exportMenuOpen && (
                  <div className={styles.exportMenuDropdown} role="menu" aria-label="Opcoes de exportacao">
                    <button
                      type="button"
                      className={styles.exportMenuItem}
                      onClick={handleExportSimpleCsv}
                      title="Exporta a tabela atual em CSV"
                    >
                      Exportar CSV
                    </button>
                    <button
                      type="button"
                      className={styles.exportMenuItem}
                      onClick={handleExportSimpleXlsx}
                      title="Exporta a tabela atual em Excel"
                    >
                      Exportar XLSX
                    </button>
                    <button
                      type="button"
                      className={styles.exportMenuItem}
                      onClick={handleExportPdf}
                      title="Exporta a lista atual em PDF"
                      disabled={exportingPdf}
                    >
                      {exportingPdf ? "Exportando PDF..." : "Exportar PDF"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {(availableSubgrupos.length > 0 || availableGrades.length > 0 || availableColecoes.length > 0) && (
            <div className={styles.abcFiltersRow}>
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
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th>
                      Produto
                      {abcTitleSuffix && <span className={styles.thFilterLabel}>{abcTitleSuffix}</span>}
                    </th>
                    <>
                      <th className={styles.right}>Participação</th>
                      <th className={styles.right}>Faturamento no período</th>
                      <th className={styles.right}>Qtd vendida</th>
                      <th className={styles.right}>Estoque</th>
                      {showEstoqueRede && <th className={styles.right}>Estoque rede</th>}
                      <th className={styles.right}>Markup</th>
                      <th className={styles.right}>Sugestão de compra</th>
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
                          <td colSpan={showEstoqueRede ? 9 : 8}>
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
                          return (
                            <tr
                              key={`${p.produto}-${p.categoria}-${p.cor ?? ""}-${p.grade ?? ""}`}
                              className={curva !== "A" ? styles.rowDimmed : ""}
                            >
                              <td>
                                <span className={`${styles.rank} ${i < 3 && curva === "A" ? styles.top : ""}`}>
                                  {rankGlobal}
                                </span>
                              </td>
                              <td>
                                <Link
                                  href={buildProductDetalhadoHref(companyKey, p)}
                                  className={styles.productDetailLink}
                                  title="Abrir produto detalhado"
                                >
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
                                    {p.isGroupedProduct && (p.groupedMembers?.length ?? 0) > 0 && (
                                      <div className={`${styles.groupedTooltipWrapper} ${styles.inlineTooltipWrapper}`}>
                                        <span className={styles.groupedBadge}>grupo</span>
                                        <div className={styles.inlineTooltipPanel}>
                                          <div className={styles.inlineTooltipTitle}>Produtos do grupo</div>
                                          <div className={styles.inlineTooltipList}>
                                            {(p.groupedMembers ?? []).map(m => (
                                              <div key={m.produto} className={styles.inlineTooltipRow}>
                                                {renderGroupedMemberLabel(m, false)}
                                              </div>
                                            ))}
                                          </div>
                                        </div>
                                      </div>
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
                                </Link>
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
                                    const perFilialSummary = !selectedFilial && live
                                      ? buildPerFilialCompraSummary({
                                          companyKey,
                                          linha: p.linha ?? "",
                                          subgrupo: p.subgrupo ?? "",
                                          diasCorridosMes,
                                          live,
                                        })
                                      : null;
                                    if (perFilialSummary) {
                                      const limiteDias = getLimiteDiasReposicao({ linha: p.linha ?? "", subgrupo: p.subgrupo ?? "" });
                                      const vendasMes = Number(live?.vendasMesAtual ?? 0);
                                      const estoqueAtual = Number(live?.estoqueFilial ?? 0);
                                      const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                                      const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
                                      const transit = applyTransitToSuggestion({
                                        baseType: perFilialSummary.topType,
                                        baseQty: perFilialSummary.totalQty,
                                        entries: getCompraTransitoEntries(comprasTransitoIndex, p.produto, porCor ? (p.cor ?? null) : null),
                                        estoqueAtual,
                                        vendasMesAtual: vendasMes,
                                        diasCorridosMes,
                                        limiteDias,
                                      });
                                      const transitDates = transit.entries.map(
                                        (entry) => `${new Date(`${entry.dataRecebimento}T00:00:00`).toLocaleDateString("pt-BR")} (+${fmt(entry.quantidade)})`
                                      );
                                      const transitBadge = transit.totalTransit > 0 ? (
                                        <span className={styles.badgeT} style={{ marginLeft: 6 }}>
                                          T {fmt(transit.totalTransit)}
                                        </span>
                                      ) : null;
                                      if (transit.qty <= 0) {
                                        return <span className={styles.reporNeutral}>Quantidade suficiente{transitBadge}</span>;
                                      }
                                      const poPrincipal = perFilialSummary.poPrincipal;
                                      const topTypeLabel =
                                        perFilialSummary.topType === "COMPRA" || perFilialSummary.topType === "PO"
                                          ? null
                                          : perFilialSummary.topType;
                                      return (
                                        <span
                                          className={styles.reporAdd}
                                          onMouseEnter={(e) => setSugestaoTooltip({
                                            x: e.clientX,
                                            y: e.clientY,
                                            titulo: "Sugestão de reposição (soma por filial)",
                                            regra: "Cada loja foi calculada individualmente com seu próprio estoque, dias com estoque positivo e velocidade. O total é a soma das lojas.",
                                            limiteDias,
                                            vendasMesAtual: vendasMes,
                                            diasCorridos: diasCorridosMes,
                                            consumoDiario,
                                            estoqueAtual,
                                            duracaoAtual,
                                            qtdCalculada: transit.qty,
                                            baseQty: perFilialSummary.totalQty,
                                            distribuicao: perFilialSummary.distribuicao,
                                            distribuicaoLabel: "Por loja (cálculo individual)",
                                            transitTotal: transit.totalTransit || undefined,
                                            transitDates,
                                          })}
                                          onMouseLeave={() => setSugestaoTooltip(null)}
                                        >
                                          {fmt(transit.qty)}
                                          {topTypeLabel ? (
                                            <span
                                              style={{
                                                marginLeft: 6,
                                                display: "inline-flex",
                                                width: 16,
                                                height: 16,
                                                borderRadius: "999px",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                fontSize: 10,
                                                fontWeight: 800,
                                                color: topTypeLabel === "E" ? "#fff" : "#0f172a",
                                                background: topTypeLabel === "E" ? "#f97316" : "#fde047",
                                                border: topTypeLabel === "E" ? "1px solid #ea580c" : "1px solid #facc15",
                                                verticalAlign: "middle",
                                                cursor: "help",
                                              }}
                                            >
                                              {topTypeLabel}
                                            </span>
                                          ) : null}
                                          {perFilialSummary.hasPo && poPrincipal ? (
                                            <span
                                              style={{ marginLeft: 6, display: "inline-flex", padding: "0 5px", height: 16, borderRadius: "999px", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#14532d", background: "#86efac", border: "1px solid #22c55e", verticalAlign: "middle", cursor: "help" }}
                                              onMouseEnter={(e) => {
                                                setSugestaoTooltip(null);
                                                setSugestaoSTooltip(null);
                                                setSugestaoETooltip(null);
                                                setSugestaoPOTooltip({
                                                  x: e.clientX,
                                                  y: e.clientY,
                                                  filialLabel: perFilialSummary.poRows.length === 1 ? poPrincipal.filial : undefined,
                                                  poRows: perFilialSummary.poRows.map((row) => ({
                                                    filialLabel: row.filial,
                                                    qtde12m: row.qtde12m,
                                                    diasComEstoquePositivo: row.poData?.diasComEstoquePositivo ?? row.diasComEstoquePositivo,
                                                    diasSemEstoque: row.poData?.diasSemEstoque ?? row.diasSemEstoque,
                                                    velocidadeAjustada: row.poData?.velocidadeAjustada ?? row.velocidadeAjustada,
                                                    limiteSeguro: row.poData?.limiteSeguro ?? 0,
                                                    qtdPO: row.qty,
                                                  })),
                                                  qtde12m: poPrincipal.qtde12m,
                                                  diasComEstoquePositivo: poPrincipal.poData?.diasComEstoquePositivo ?? poPrincipal.diasComEstoquePositivo,
                                                  diasSemEstoque: poPrincipal.poData?.diasSemEstoque ?? poPrincipal.diasSemEstoque,
                                                  velocidadeAjustada: poPrincipal.poData?.velocidadeAjustada ?? poPrincipal.velocidadeAjustada,
                                                  limiteSeguro: poPrincipal.poData?.limiteSeguro ?? 0,
                                                  qtdPO: poPrincipal.qty,
                                                  transitTotal: transit.totalTransit || undefined,
                                                  transitDates,
                                                });
                                              }}
                                              onMouseLeave={() => setSugestaoPOTooltip(null)}
                                            >
                                              PO
                                            </span>
                                          ) : null}
                                          {perFilialSummary.hasNm && perFilialSummary.topType !== "NM" ? (
                                            <span className={styles.badgeT} style={{ marginLeft: 6, background: "#7c3aed", borderColor: "#6d28d9", color: "#fff" }}>
                                              NM
                                            </span>
                                          ) : null}
                                          {transitBadge}
                                        </span>
                                      );
                                    }
                                    const compraItem = {
                                      vendasMesAtual: live?.vendasMesAtual ?? 0,
                                      estoqueFilial: live?.estoqueFilial ?? 0,
                                      linha: p.linha ?? "",
                                      subgrupo: p.subgrupo ?? "",
                                      qtde12m: live?.qtde12m ?? 0,
                                      mesesHistoricoFilial: live?.mesesHistoricoFilial ?? 12,
                                      diasDesdeUltimaVenda: live?.diasDesdeUltimaVenda ?? null,
                                      diasComEstoquePositivo: live?.diasComEstoquePositivo ?? null,
                                      diasSemEstoque: live?.diasSemEstoque ?? null,
                                      mesesDisponiveis: live?.mesesDisponiveis ?? null,
                                      velocidadeAjustada: live?.velocidadeAjustada ?? null,
                                    };
                                    const sugestao = getReposicaoCompraView(compraItem, diasCorridosMes);
                                    const limiteDias = getLimiteDiasReposicao(compraItem);
                                    const baseType = getReposicaoBaseType(sugestao);
    const baseQty =
      sugestao.qtdFinal > 0
        ? sugestao.qtdFinal
        : sugestao.qtdS > 0
          ? sugestao.qtdS
          : sugestao.qtdE > 0
            ? sugestao.qtdE
            : sugestao.qtdPO > 0
              ? sugestao.qtdPO
              : sugestao.qtdNM;
                                    const combined = combineBaseSuggestionWithNecessidadeMinima({
                                      baseType,
                                      baseQty,
                                      totalNmQty: live?.totalNmQty ?? sugestao.qtdNM,
                                    });
                                    const transit = applyTransitToSuggestion({
                                      baseType: combined.effectiveType,
                                      baseQty: combined.totalQty,
                                      entries: getCompraTransitoEntries(comprasTransitoIndex, p.produto, porCor ? (p.cor ?? null) : null),
                                      estoqueAtual: compraItem.estoqueFilial,
                                      vendasMesAtual: compraItem.vendasMesAtual,
                                      diasCorridosMes,
                                      limiteDias,
                                    });
                                    const transitDates = transit.entries.map(
                                      (entry) => `${new Date(`${entry.dataRecebimento}T00:00:00`).toLocaleDateString("pt-BR")} (+${fmt(entry.quantidade)})`
                                    );
                                    const transitBadge = transit.totalTransit > 0 ? (
                                      <span className={styles.badgeT} style={{ marginLeft: 6 }}>
                                        T {fmt(transit.totalTransit)}
                                      </span>
                                    ) : null;
                                    if (baseType === "COMPRA" && transit.qty > 0) {
                                      const vendasMes = Number(compraItem.vendasMesAtual ?? 0);
                                      const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                                      const estoqueAtual = sugestao.compraData?.estoqueAtual ?? Number(compraItem.estoqueFilial ?? 0);
                                      const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
                                      const qtdFinalPuro = sugestao.compraData?.qtdFinalPuro ?? 0;
                                      const qtdSBlend = sugestao.compraData?.qtdSBlend ?? 0;
                                      const blendAplicado = sugestao.compraData?.blendAplicado ?? false;
                                      const historicoQtde12m = Number(compraItem.qtde12m ?? 0);
                                      const historicoDiasComEstoquePositivo = sugestao.compraData?.diasComEstoquePositivo ?? Number(compraItem.diasComEstoquePositivo ?? 0);
                                      const historicoMesesDisponiveis = sugestao.compraData?.mesesDisponiveis ?? Number(compraItem.mesesDisponiveis ?? 0);
                                      const historicoVelocidadeAjustada = sugestao.compraData?.velocidadeAjustada ?? Number(compraItem.velocidadeAjustada ?? 0);
                                      const hasPOBadge =
                                        Boolean(sugestao.poData) ||
                                        (
                                          blendAplicado &&
                                          qtdSBlend > 0 &&
                                          historicoMesesDisponiveis > 0 &&
                                          historicoMesesDisponiveis < 1 &&
                                          historicoVelocidadeAjustada >= 4
                                        );
                                      return (
                                        <span
                                          className={styles.reporAdd}
                                          onMouseEnter={(e) => setSugestaoTooltip({
                                            x: e.clientX,
                                            y: e.clientY,
                                            titulo: blendAplicado
                                              ? "Sugestão de reposição (ajuste histórico aplicado)"
                                              : "Sugestão de reposição (cálculo principal)",
                                            regra: blendAplicado
                                              ? "Mês atual baixo (< 60% da média histórica). Qtd = 80% histórico + 40% atual."
                                              : "Qtd = consumo/dia × (limite de cobertura - duração atual).",
                                            limiteDias,
                                            vendasMesAtual: vendasMes,
                                            diasCorridos: diasCorridosMes,
                                            consumoDiario,
                                            estoqueAtual,
                                            duracaoAtual,
                                            qtdCalculada: transit.qty,
                                            baseQty: combined.baseQty,
                                            nmExtraQty: combined.hasCombinedNm ? combined.nmExtraQty : undefined,
                                            distribuicao: partesDestinoCompraFinal(transit.qty, live?.vendasPorFilial ?? [], companyKey, live?.estoquePorFilial ?? undefined, limiteDias) ?? undefined,
                                            blendAplicado,
                                            qtdFinalPuro,
                                            qtdSBlend,
                                            historicoQtde12m,
                                            historicoDiasComEstoquePositivo,
                                            historicoMesesDisponiveis,
                                            historicoVelocidadeAjustada,
                                            transitTotal: transit.totalTransit || undefined,
                                            transitDates,
                                          })}
                                          onMouseLeave={() => setSugestaoTooltip(null)}
                                        >
                                          {fmt(transit.qty)}
                                          {blendAplicado && <>{" "}<span style={{ display: "inline-flex", width: 16, height: 16, borderRadius: "999px", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#0f172a", background: "#fde047", border: "1px solid #facc15", verticalAlign: "middle", cursor: "help" }}>⚡</span></>}
                                          {hasPOBadge ? (
                                            <span
                                              style={{ marginLeft: 6, display: "inline-flex", padding: "0 5px", height: 16, borderRadius: "999px", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#14532d", background: "#86efac", border: "1px solid #22c55e", verticalAlign: "middle", cursor: "help" }}
                                              onMouseEnter={(e) => {
                                                setSugestaoTooltip(null);
                                                setSugestaoSTooltip(null);
                                                setSugestaoETooltip(null);
                                                setSugestaoPOTooltip({
                                                  x: e.clientX,
                                                  y: e.clientY,
                                                  qtde12m: historicoQtde12m,
                                                  diasComEstoquePositivo: sugestao.poData?.diasComEstoquePositivo ?? historicoDiasComEstoquePositivo,
                                                  diasSemEstoque: sugestao.poData?.diasSemEstoque ?? Number(compraItem.diasSemEstoque ?? 0),
                                                  velocidadeAjustada: sugestao.poData?.velocidadeAjustada ?? historicoVelocidadeAjustada,
                                                  limiteSeguro: sugestao.poData?.limiteSeguro ?? 0,
                                                  qtdPO: transit.qty,
                                                  transitTotal: transit.totalTransit || undefined,
                                                  transitDates,
                                                });
                                              }}
                                              onMouseLeave={() => setSugestaoPOTooltip(null)}
                                            >PO</span>
                                          ) : null}
                                          {combined.hasCombinedNm ? (
                                            <span className={styles.badgeT} style={{ marginLeft: 6, background: "#7c3aed", borderColor: "#6d28d9", color: "#fff" }}>
                                              NM
                                            </span>
                                          ) : null}
                                          {transitBadge}
                                        </span>
                                      );
                                    }
                                    if (baseType === "S" && transit.qty > 0) {
                                      return (
                                        <span className={styles.reporAdd}>
                                          {fmt(transit.qty)}{" "}
                                          <span
                                            onMouseEnter={(e) => setSugestaoSTooltip({
                                              x: e.clientX,
                                              y: e.clientY,
                                              qtde12m: Number(compraItem.qtde12m ?? 0),
                                              diasComEstoquePositivo: sugestao.sData?.diasComEstoquePositivo ?? 0,
                                              mesesDisponiveis: sugestao.sData?.mesesDisponiveis ?? 1,
                                              velocidadeAjustada: sugestao.sData?.velocidadeAjustada ?? 0,
                                              estoqueAtual: Number(compraItem.estoqueFilial ?? 0),
                                              limiteDias,
                                              qtdS: transit.qty,
                                              baseQty: combined.baseQty,
                                              nmExtraQty: combined.hasCombinedNm ? combined.nmExtraQty : undefined,
                                              distribuicao: partesDestinoCompraFinal(transit.qty, live?.vendasPorFilial ?? [], companyKey, live?.estoquePorFilial ?? undefined, limiteDias) ?? undefined,
                                              transitTotal: transit.totalTransit || undefined,
                                              transitDates,
                                            })}
                                            onMouseLeave={() => setSugestaoSTooltip(null)}
                                            style={{
                                              display: "inline-flex",
                                              width: 16,
                                              height: 16,
                                              borderRadius: "999px",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontSize: 10,
                                              fontWeight: 800,
                                              color: "#0f172a",
                                              background: "#fde047",
                                              border: "1px solid #facc15",
                                              verticalAlign: "middle",
                                              cursor: "help",
                                            }}
                                          >
                                            S
                                          </span>
                                          {sugestao.poData ? (
                                            <span
                                              style={{ marginLeft: 6, display: "inline-flex", padding: "0 5px", height: 16, borderRadius: "999px", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#14532d", background: "#86efac", border: "1px solid #22c55e", verticalAlign: "middle", cursor: "help" }}
                                              onMouseEnter={(e) => {
                                                setSugestaoTooltip(null);
                                                setSugestaoSTooltip(null);
                                                setSugestaoETooltip(null);
                                                setSugestaoPOTooltip({ x: e.clientX, y: e.clientY, qtde12m: Number(compraItem.qtde12m ?? 0), diasComEstoquePositivo: sugestao.poData!.diasComEstoquePositivo, diasSemEstoque: sugestao.poData!.diasSemEstoque, velocidadeAjustada: sugestao.poData!.velocidadeAjustada, limiteSeguro: sugestao.poData!.limiteSeguro, qtdPO: transit.qty, transitTotal: transit.totalTransit || undefined, transitDates });
                                              }}
                                              onMouseLeave={() => setSugestaoPOTooltip(null)}
                                            >PO</span>
                                          ) : null}
                                          {combined.hasCombinedNm ? (
                                            <span className={styles.badgeT} style={{ marginLeft: 6, background: "#7c3aed", borderColor: "#6d28d9", color: "#fff" }}>
                                              NM
                                            </span>
                                          ) : null}
                                          {transitBadge}
                                        </span>
                                      );
                                    }
                                    if (baseType === "E" && transit.qty > 0) {
                                      const eInfo = calcQtdSugestaoEInfo(compraItem);
                                      return (
                                        <span className={styles.reporAdd}>
                                          {fmt(transit.qty)}{" "}
                                          <span
                                            onMouseEnter={(e) => eInfo && setSugestaoETooltip({
                                              x: e.clientX,
                                              y: e.clientY,
                                              qtde12m: Number(compraItem.qtde12m ?? 0),
                                              diasComEstoquePositivo: sugestao.eData?.diasComEstoquePositivo ?? Math.round(eInfo.mesesAtivos * 30),
                                              diasSemEstoque: sugestao.eData?.diasSemEstoque ?? 0,
                                              mesesDisponiveis: eInfo.mesesAtivos,
                                              velocidadeAjustada: eInfo.velocidadeAjustada,
                                              limiteDias,
                                              qtdE: transit.qty,
                                              baseQty: combined.baseQty,
                                              nmExtraQty: combined.hasCombinedNm ? combined.nmExtraQty : undefined,
                                              distribuicao: partesDestinoCompraFinal(transit.qty, live?.vendasPorFilial ?? [], companyKey, live?.estoquePorFilial ?? undefined, limiteDias) ?? undefined,
                                              transitTotal: transit.totalTransit || undefined,
                                              transitDates,
                                            })}
                                            onMouseLeave={() => setSugestaoETooltip(null)}
                                            style={{
                                              display: "inline-flex",
                                              width: 16,
                                              height: 16,
                                              borderRadius: "999px",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontSize: 10,
                                              fontWeight: 800,
                                              color: "#fff",
                                              background: "#f97316",
                                              border: "1px solid #ea580c",
                                              verticalAlign: "middle",
                                              cursor: "help",
                                            }}
                                          >
                                            E
                                          </span>
                                          {sugestao.poData ? (
                                            <span
                                              style={{ marginLeft: 6, display: "inline-flex", padding: "0 5px", height: 16, borderRadius: "999px", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#14532d", background: "#86efac", border: "1px solid #22c55e", verticalAlign: "middle", cursor: "help" }}
                                              onMouseEnter={(e) => {
                                                setSugestaoTooltip(null);
                                                setSugestaoSTooltip(null);
                                                setSugestaoETooltip(null);
                                                setSugestaoPOTooltip({ x: e.clientX, y: e.clientY, qtde12m: Number(compraItem.qtde12m ?? 0), diasComEstoquePositivo: sugestao.poData!.diasComEstoquePositivo, diasSemEstoque: sugestao.poData!.diasSemEstoque, velocidadeAjustada: sugestao.poData!.velocidadeAjustada, limiteSeguro: sugestao.poData!.limiteSeguro, qtdPO: transit.qty, transitTotal: transit.totalTransit || undefined, transitDates });
                                              }}
                                              onMouseLeave={() => setSugestaoPOTooltip(null)}
                                            >PO</span>
                                          ) : null}
                                          {combined.hasCombinedNm ? (
                                            <span className={styles.badgeT} style={{ marginLeft: 6, background: "#7c3aed", borderColor: "#6d28d9", color: "#fff" }}>
                                              NM
                                            </span>
                                          ) : null}
                                          {transitBadge}
                                        </span>
                                      );
                                    }
                                    if ((baseType === "PO" || baseType === "NM") && transit.qty > 0) {
                                      const vendasMes = Number(compraItem.vendasMesAtual ?? 0);
                                      const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                                      return (
                                        <span
                                          className={styles.reporAdd}
                                          onMouseEnter={(e) => setSugestaoTooltip({
                                            x: e.clientX,
                                            y: e.clientY,
                                            titulo: baseType === "PO" ? "Potencial oculto (PO)" : "Necessidade minima (NM)",
                                            regra: baseType === "PO"
                                              ? "Velocidade ajustada pela disponibilidade real: qtde vendida ÷ (dias com estoque / 30), com trava de seguranca para nao superdimensionar."
                                              : "Sem outra regra de reposicao ativa. A sugestao vem da necessidade minima do item.",
                                            limiteDias,
                                            vendasMesAtual: vendasMes,
                                            diasCorridos: diasCorridosMes,
                                            consumoDiario,
                                            estoqueAtual: Number(compraItem.estoqueFilial ?? 0),
                                            duracaoAtual: 0,
                                            qtdCalculada: transit.qty,
                                            baseQty: combined.baseQty,
                                            distribuicao: partesDestinoCompraFinal(transit.qty, live?.vendasPorFilial ?? [], companyKey, live?.estoquePorFilial ?? undefined, limiteDias) ?? undefined,
                                            transitTotal: transit.totalTransit || undefined,
                                            transitDates,
                                          })}
                                          onMouseLeave={() => setSugestaoTooltip(null)}
                                        >
                                          {fmt(transit.qty)}{" "}
                                          <span
                                            style={{
                                              display: "inline-flex",
                                              padding: "0 5px",
                                              height: 16,
                                              borderRadius: "999px",
                                              alignItems: "center",
                                              justifyContent: "center",
                                              fontSize: 10,
                                              fontWeight: 800,
                                              color: "#fff",
                                              background: "#7c3aed",
                                              border: "1px solid #6d28d9",
                                              verticalAlign: "middle",
                                              cursor: "help",
                                            }}
                                          >
                                            {baseType === "PO" ? "PO" : "NM"}
                                          </span>
                                          {transitBadge}
                                        </span>
                                      );
                                    }
                                    if (baseType === "SEM_SUGESTAO") {
                                      if (transit.totalTransit > 0) {
                                        return (
                                          <span
                                            className={styles.reporOk}
                                            onMouseEnter={(e) => setSugestaoTooltip({
                                              x: e.clientX,
                                              y: e.clientY,
                                              titulo: "Em trânsito",
                                              regra: "Sem sugestão de compra no momento, mas existem unidades já compradas em trânsito.",
                                              limiteDias,
                                              vendasMesAtual: Number(compraItem.vendasMesAtual ?? 0),
                                              diasCorridos: diasCorridosMes,
                                              consumoDiario: diasCorridosMes > 0 ? Number(compraItem.vendasMesAtual ?? 0) / diasCorridosMes : 0,
                                              estoqueAtual: Number(compraItem.estoqueFilial ?? 0),
                                              duracaoAtual: 0,
                                              qtdCalculada: 0,
                                              transitTotal: transit.totalTransit || undefined,
                                              transitDates,
                                            })}
                                            onMouseLeave={() => setSugestaoTooltip(null)}
                                          >
                                            {transitBadge}
                                          </span>
                                        );
                                      }
                                      return <span className={styles.cellMetric}>Sem sugestao</span>;
                                    }
                                    const vendasMes = Number(compraItem.vendasMesAtual ?? 0);
                                    const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                                    const estoqueAtual = Number(compraItem.estoqueFilial ?? 0);
                                    const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
                                    return (
                                      <span
                                        className={styles.reporOk}
                                        onMouseEnter={(e) => setSugestaoTooltip({
                                          x: e.clientX,
                                          y: e.clientY,
                                          titulo: "Quantidade suficiente",
                                          regra: transit.suppressedByTransit
                                            ? "Sem reposição adicional: a compra em trânsito cobre a necessidade antes do estoque acabar."
                                            : "Sem reposição: duração atual já atende o limite de cobertura.",
                                          limiteDias,
                                          vendasMesAtual: vendasMes,
                                          diasCorridos: diasCorridosMes,
                                          consumoDiario,
                                          estoqueAtual,
                                          duracaoAtual,
                                          qtdCalculada: 0,
                                          transitTotal: transit.totalTransit || undefined,
                                          transitDates,
                                        })}
                                        onMouseLeave={() => setSugestaoTooltip(null)}
                                      >
                                        Quantidade suficiente{transitBadge}
                                      </span>
                                    );
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
      {sugestaoTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(sugestaoTooltip.x, sugestaoTooltip.y)}>
          <div className={styles.metricTooltipTitle}>{sugestaoTooltip.titulo}: {fmt(sugestaoTooltip.qtdCalculada)} un</div>
          {sugestaoTooltip.regra ? (
            <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>{sugestaoTooltip.regra}</div>
          ) : null}
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
                    Projeção histórica: ~{Math.round(sugestaoTooltip.historicoVelocidadeAjustada)} un/mês
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
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>Velocidade calculada só nos dias em que havia estoque</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Velocidade</span><span><strong>{sugestaoSTooltip.velocidadeAjustada.toFixed(1)} un/mês</strong></span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Base</span><span style={{ fontSize: 11 }}>{fmt(sugestaoSTooltip.qtde12m)} un em {fmt(sugestaoSTooltip.diasComEstoquePositivo)} dias c/ estoque</span>
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
              {(() => {
                const totalVendas = sugestaoSTooltip.distribuicao.reduce((s, f) => s + (f.qtde12m ?? 0), 0);
                return sugestaoSTooltip.distribuicao.map((f) => (
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
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>Produto zerado — velocidade calculada nos dias em que tinha estoque</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Velocidade</span><span><strong>{sugestaoETooltip.velocidadeAjustada.toFixed(1)} un/mês</strong></span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Base</span><span style={{ fontSize: 11 }}>{fmt(sugestaoETooltip.qtde12m)} un em {fmt(sugestaoETooltip.diasComEstoquePositivo)} dias c/ estoque</span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span style={{ fontSize: 11, color: "#64748b" }}>Sem estoque</span><span style={{ fontSize: 11 }}>{fmt(sugestaoETooltip.diasSemEstoque)} dias</span>
          </div>
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Alvo</span><span>{sugestaoETooltip.limiteDias} dias</span>
          </div>
          {sugestaoETooltip.distribuicao && sugestaoETooltip.distribuicao.length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Por loja (proporcional)</div>
              {(() => {
                const totalVendas = sugestaoETooltip.distribuicao.reduce((s, f) => s + (f.qtde12m ?? 0), 0);
                return sugestaoETooltip.distribuicao.map((f) => (
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
          <div className={styles.metricTooltipTitle} style={{ color: "#86efac" }}>
            {(sugestaoPOTooltip.limiteSeguro ?? 0) > 0 ? "Potencial Oculto (PO)" : "Histórico Curto (PO)"}
          </div>
          {sugestaoPOTooltip.poRows && sugestaoPOTooltip.poRows.length > 1 ? (
            <>
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                Mais de uma loja entrou por PO neste item. Abaixo está o detalhe de cada uma:
              </div>
              <div className={styles.metricTooltipDivider} />
              {sugestaoPOTooltip.poRows.map((row, index) => (
                <React.Fragment key={`${row.filialLabel}-${index}`}>
                  <div className={styles.metricTooltipLine} style={{ color: "#86efac" }}>
                    <strong>{row.filialLabel}</strong>
                  </div>
                  <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <span>Vendas</span><span><strong>{row.qtde12m} un</strong> em <strong>{Math.round(row.diasComEstoquePositivo)} dias</strong> c/ estoque</span>
                  </div>
                  <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <span>Projeção</span><span style={{ color: "#86efac" }}><strong>~{row.velocidadeAjustada.toFixed(0)} un/mês</strong></span>
                  </div>
                  <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                    = {row.qtde12m} un ÷ {(row.diasComEstoquePositivo / 30).toFixed(2)} meses disponíveis
                  </div>
                  {row.diasSemEstoque > 0 ? (
                    <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                      {row.diasSemEstoque} dias sem estoque no período
                    </div>
                  ) : null}
                  <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                    <span>Sugestão</span><span><strong>{row.qtdPO} un</strong></span>
                  </div>
                  {row.limiteSeguro > 0 ? (
                    <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                      trava de segurança: máx. {row.limiteSeguro} un
                    </div>
                  ) : null}
                  {index < sugestaoPOTooltip.poRows!.length - 1 ? <div className={styles.metricTooltipDivider} /> : null}
                </React.Fragment>
              ))}
            </>
          ) : (
            <>
          {sugestaoPOTooltip.filialLabel ? (
            <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
              Loja: <strong>{sugestaoPOTooltip.filialLabel}</strong>
            </div>
          ) : null}
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
            {(sugestaoPOTooltip.limiteSeguro ?? 0) > 0
              ? "Vendeu rápido no curto período em que tinha estoque"
              : "Velocidade extrapolada de histórico curto — use com cautela"}
          </div>
          <div className={styles.metricTooltipDivider} />
          {sugestaoPOTooltip.qtde12m != null && sugestaoPOTooltip.diasComEstoquePositivo != null ? (
            <>
              <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span>Vendas</span><span><strong>{sugestaoPOTooltip.qtde12m} un</strong> em <strong>{Math.round(sugestaoPOTooltip.diasComEstoquePositivo)} dias</strong> c/ estoque</span>
              </div>
              <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span>Projeção</span><span style={{ color: "#86efac" }}><strong>~{sugestaoPOTooltip.velocidadeAjustada?.toFixed(0)} un/mês</strong></span>
              </div>
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                = {sugestaoPOTooltip.qtde12m} un ÷ {((sugestaoPOTooltip.diasComEstoquePositivo ?? 0) / 30).toFixed(2)} meses disponíveis
              </div>
              {(sugestaoPOTooltip.diasSemEstoque ?? 0) > 0 && (
                <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
                  {sugestaoPOTooltip.diasSemEstoque} dias sem estoque no período
                </div>
              )}
              <div className={styles.metricTooltipDivider} />
            </>
          ) : <div className={styles.metricTooltipDivider} />}
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
            <span>Sugestão</span><span><strong>{sugestaoPOTooltip.qtdPO} un</strong></span>
          </div>
          {sugestaoPOTooltip.limiteSeguro != null && sugestaoPOTooltip.limiteSeguro > 0 && (
            <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>
              trava de segurança: máx. {sugestaoPOTooltip.limiteSeguro} un (histórico curto)
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

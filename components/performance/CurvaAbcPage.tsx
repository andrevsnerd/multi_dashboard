"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { startOfMonth, endOfMonth } from "date-fns";
import type { CompanyKey } from "@/lib/config/company";
import {
  OUTROS_LABEL,
  filterOutrosKeys,
  getOutrosTooltip,
  isOutrosCategory,
} from "@/lib/performance/outrosCategories";
import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import { formatDateForQuery } from "@/lib/utils/date";
import FilialVendedoresTab from "./FilialVendedoresTab";
import { exportCurvaAbcSimpleXlsx, type CurvaAbcSimpleXlsxRow } from "@/lib/utils/exportCurvaAbcSimpleXlsx";
import styles from "./FilialPerformancePage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface QtdePorFilialEntry {
  filial: string;
  displayName: string;
  qtde: number;
}

interface ProdutoRow {
  produto: string;
  descricao: string;
  categoria: string;
  subgrupo?: string;
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
}

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
  produtos: ProdutoRow[];
}

type Curva = "A" | "B" | "C";

interface ProdutoComCurva extends ProdutoRow {
  curva: Curva;
  percParticipacao: number;
  percCumulativa: number;
}

interface CompraMetricas {
  qtde12m: number | null;
  qtde60d: number | null;
  vendasMesAtual: number | null;
  valor12m: number | null;
  custoUnit: number | null;
  estoqueFilial: number | null;
  diasDesdeUltimaVenda: number | null;
  primeiraEntradaFilial: string | null;
  diasHistoricoFilial: number | null;
  mesesHistoricoFilial: number | null;
  historicoParcial: boolean | null;
}

interface CompraCurvaInfo {
  curva: Curva;
  percParticipacao: number;
  percCumulativo: number;
}

// ─── Formatação ──────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRL2(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatHistoricoDate(value?: string | null): string {
  if (!value) return "Nao encontrada";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
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

function getCombinedCategoryMetrics(
  categories: Record<string, { pct: number; deltaPct: number | null }>,
  keys: string[],
  totalSales: number
): { pct: number; deltaPct: number | null } | null {
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

  return { pct: Math.round(pct), deltaPct };
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

function buildProductDetalhadoHref(
  companyKey: CompanyKey,
  p: Pick<ProdutoRow, "produto" | "descricao" | "cor">
): string {
  const params = new URLSearchParams();
  params.set("productId", p.produto.trim());
  params.set("name", (p.descricao || p.produto).trim());
  const cor = (p.cor ?? "").trim();
  if (cor) params.set("colors", cor);
  return `/${companyKey}/produto-detalhado?${params.toString()}`;
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

function normalizeCompraKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function buildCompraItemKey(produto?: string | null, corProduto?: string | null) {
  return `${normalizeCompraKey(produto)}|${normalizeCompraKey(corProduto)}`;
}

function getMesesHistoricoFilialCompra(item: { mesesHistoricoFilial?: number | null }): number {
  const meses = Number(item.mesesHistoricoFilial ?? 12);
  if (!Number.isFinite(meses)) return 12;
  return Math.min(12, Math.max(1, meses));
}

function getHistoricoFilialFallbackCompra() {
  return {
    primeiraEntradaFilial: null as string | null,
    diasHistoricoFilial: 365,
    mesesHistoricoFilial: 12,
    historicoParcial: false,
  };
}

function calculateHistoricoFilialCompra(primeiraEntradaFilial?: string | Date | null) {
  if (!primeiraEntradaFilial) return getHistoricoFilialFallbackCompra();
  const data = primeiraEntradaFilial instanceof Date ? primeiraEntradaFilial : new Date(primeiraEntradaFilial);
  if (Number.isNaN(data.getTime())) return getHistoricoFilialFallbackCompra();
  const msPerDay = 1000 * 60 * 60 * 24;
  const diasHistoricoFilial = Math.min(365, Math.max(0, Math.floor((Date.now() - data.getTime()) / msPerDay)));
  return {
    primeiraEntradaFilial: data.toISOString(),
    diasHistoricoFilial,
    mesesHistoricoFilial: Math.min(12, Math.max(1, diasHistoricoFilial / 30)),
    historicoParcial: diasHistoricoFilial < 365,
  };
}

function mergeHistoricoFilialRowsCompra(
  rows: Array<{
    primeiraEntradaFilial?: string | null;
    diasHistoricoFilial?: number | null;
    mesesHistoricoFilial?: number | null;
    historicoParcial?: boolean | null;
  }>
) {
  let primeiraEntrada: Date | null = null;
  for (const row of rows) {
    if (!row.primeiraEntradaFilial) continue;
    const data = new Date(row.primeiraEntradaFilial);
    if (Number.isNaN(data.getTime())) continue;
    if (!primeiraEntrada || data < primeiraEntrada) primeiraEntrada = data;
  }
  if (primeiraEntrada) return calculateHistoricoFilialCompra(primeiraEntrada);

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
      mesesHistoricoFilial: getMesesHistoricoFilialCompra({ mesesHistoricoFilial: parcial.mesesHistoricoFilial }),
      historicoParcial: Boolean(parcial.historicoParcial),
    };
  }

  return getHistoricoFilialFallbackCompra();
}

function getLimiteDiasReposicao(item: { linha?: string | null; subgrupo?: string | null }) {
  const linha = normalizeCompraKey(item.linha);
  const subgrupo = normalizeCompraKey(item.subgrupo);
  if (linha === "INDIA") return 90;
  const subgrupos120 = new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]);
  if (subgrupos120.has(subgrupo)) return 120;
  return 60;
}

function getSuggestedDeltaCompra(
  item: { vendasMesAtual?: number | null; estoqueFilial?: number | null; linha?: string | null; subgrupo?: string | null },
  diasCorridosMes: number
): number {
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

function calcQtdSugestaoEInfo(item: {
  qtde12m?: number | null;
  estoqueFilial?: number | null;
  diasDesdeUltimaVenda?: number | null;
  mesesHistoricoFilial?: number | null;
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
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  if (estoqueAtual > 0) return null;
  const dias = item.diasDesdeUltimaVenda;
  if (dias == null || dias < 30) return null;
  const mesesBase = getMesesHistoricoFilialCompra(item);
  const mesesSemVenda = dias / 30;
  const mesesAtivos = mesesBase - mesesSemVenda;
  if (mesesAtivos < 1) return null;
  const velocidadeAjustada = qtde12m / mesesAtivos;
  if (velocidadeAjustada < 0.5) return null;
  const limiteDias = getLimiteDiasReposicao(item);
  const qtd = Math.max(1, Math.ceil((limiteDias / 30) * velocidadeAjustada));
  return { qtd, velocidadeAjustada, mesesSemVenda, mesesAtivos };
}

function getReposicaoCompraView(item: {
  qtde12m?: number | null;
  vendasMesAtual?: number | null;
  estoqueFilial?: number | null;
  diasDesdeUltimaVenda?: number | null;
  mesesHistoricoFilial?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
}, diasCorridosMes: number): {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdSuficiente: boolean;
  semSugestao: boolean;
} {
  const qtdFinal = getSuggestedDeltaCompra(item, diasCorridosMes);
  if (qtdFinal > 0) {
    return { qtdFinal, qtdS: 0, qtdE: 0, qtdSuficiente: false, semSugestao: false };
  }

  const vendasMes = Number(item.vendasMesAtual ?? 0);
  const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const limiteDias = getLimiteDiasReposicao(item);
  const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
  const qtdSuficiente = consumoDiario > 0 && duracaoAtual >= limiteDias;
  if (qtdSuficiente) {
    return { qtdFinal: 0, qtdS: 0, qtdE: 0, qtdSuficiente: true, semSugestao: false };
  }

  const mediaVendasMes = Number(item.qtde12m ?? 0) / getMesesHistoricoFilialCompra(item);
  if (mediaVendasMes >= 1 && estoqueAtual <= mediaVendasMes * 2) {
    return {
      qtdFinal: 0,
      qtdS: Math.max(0, Math.ceil((limiteDias / 30) * mediaVendasMes)),
      qtdE: 0,
      qtdSuficiente: false,
      semSugestao: false,
    };
  }

  const eInfo = calcQtdSugestaoEInfo(item);
  if (eInfo) {
    return { qtdFinal: 0, qtdS: 0, qtdE: eInfo.qtd, qtdSuficiente: false, semSugestao: false };
  }

  return { qtdFinal: 0, qtdS: 0, qtdE: 0, qtdSuficiente: false, semSugestao: true };
}

function calcularCurvasCompraRede(rows: Array<{ key: string; valor12m: number }>): Map<string, CompraCurvaInfo> {
  const base = [...rows].sort((a, b) => b.valor12m - a.valor12m);
  const total = base.reduce((s, row) => s + Math.max(0, row.valor12m), 0);
  const out = new Map<string, CompraCurvaInfo>();
  if (total <= 0) return out;
  let cumulative = 0;
  for (const row of base) {
    cumulative += Math.max(0, row.valor12m);
    const percCum = cumulative / total;
    const curva: Curva = percCum <= 0.8 ? "A" : percCum <= 0.95 ? "B" : "C";
    out.set(row.key, {
      curva,
      percParticipacao: (Math.max(0, row.valor12m) / total) * 100,
      percCumulativo: percCum * 100,
    });
  }
  return out;
}

async function fetchEstoqueFilialSumCompra(
  companyKey: string,
  filial: string | null,
  produto: string,
  corProduto: string | null
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
    if (filial && filial.trim()) params.set("filial", filial.trim());
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ estoque: number }> };
    const rows = json.data || [];
    return Math.round(rows.reduce((s, r) => s + Math.max(0, Number(r.estoque ?? 0)), 0));
  } catch {
    return null;
  }
}

async function fetchVendasItemMetricasCompra(
  companyKey: string,
  filial: string | null,
  produto: string,
  corProduto: string | null
): Promise<Omit<CompraMetricas, "estoqueFilial"> | null> {
  type VendasItemMetricasCompraApiRow = {
    qtde12m: number;
    qtde60d: number;
    qtdeMesAtual?: number;
    valor12m?: number;
    custoUnitario?: number;
    diasDesdeUltimaVenda?: number | null;
    primeiraEntradaFilial?: string | null;
    diasHistoricoFilial?: number | null;
    mesesHistoricoFilial?: number | null;
    historicoParcial?: boolean | null;
  };

  const fetchRows = async (includeHistorico: boolean): Promise<VendasItemMetricasCompraApiRow[]> => {
    const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
    if (includeHistorico) params.set("includeHistorico", "true");
    if (filial && filial.trim()) params.set("filial", filial.trim());
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Erro ao carregar metricas de vendas");
    const json = (await res.json()) as { data?: VendasItemMetricasCompraApiRow[] };
    return json.data || [];
  };

  try {
    let rows: VendasItemMetricasCompraApiRow[];
    try {
      rows = await fetchRows(true);
    } catch {
      rows = await fetchRows(false);
    }

    const totalValor = rows.reduce((s, r) => s + Number(r.valor12m ?? 0), 0);
    const maxCusto = rows.reduce((max, r) => Math.max(max, Number(r.custoUnitario ?? 0)), 0);
    const diasValidos = rows.map((r) => r.diasDesdeUltimaVenda).filter((d): d is number => d != null);
    const historicoFilial = mergeHistoricoFilialRowsCompra(rows);
    return {
      qtde12m: Math.round(rows.reduce((s, r) => s + Number(r.qtde12m ?? 0), 0)),
      qtde60d: Math.round(rows.reduce((s, r) => s + Number(r.qtde60d ?? 0), 0)),
      vendasMesAtual: Math.round(rows.reduce((s, r) => s + Number(r.qtdeMesAtual ?? 0), 0)),
      valor12m: totalValor > 0 ? Math.round(totalValor) : null,
      custoUnit: maxCusto > 0 ? maxCusto : null,
      diasDesdeUltimaVenda: diasValidos.length > 0 ? Math.min(...diasValidos) : null,
      ...historicoFilial,
    };
  } catch {
    return null;
  }
}

async function fetchVendasPorFilialItemCompra(
  companyKey: string,
  filial: string | null,
  produto: string,
  corProduto: string | null
): Promise<Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m: number }>> {
  const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
  if (filial && filial.trim()) params.set("filial", filial.trim());
  if (corProduto) params.set("corProduto", corProduto.trim());
  const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar vendas por filial");
  const json = (await res.json()) as {
    data?: Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m?: number | null }>;
  };
  return (json.data || []).map((row) => ({
    filial: row.filial,
    qtde12m: Number(row.qtde12m ?? 0),
    qtde60d: Number(row.qtde60d ?? 0),
    valor12m: Number(row.valor12m ?? 0),
  }));
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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"produtos" | "vendedores">("produtos");
  const [porCor, setPorCor] = useState(false);
  const [modoCompra, setModoCompra] = useState(false);
  const [compraCurvasAtivas, setCompraCurvasAtivas] = useState<Record<Curva, boolean>>({
    A: true,
    B: false,
    C: false,
  });
  const [compraMetricas, setCompraMetricas] = useState<Record<string, CompraMetricas>>({});
  const [compraEstoqueCache, setCompraEstoqueCache] = useState<Record<string, Array<{ filial: string; estoque: number }>>>({});
  const [compraVendasCache, setCompraVendasCache] = useState<Record<string, Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m: number }>>>({});
  const compraVendasHoverKeyRef = useRef<string | null>(null);
  const compraEstoqueHoverKeyRef = useRef<string | null>(null);
  const compraAbcHoverKeyRef = useRef<string | null>(null);
  const [compraEstoqueTooltip, setCompraEstoqueTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    filiais: Array<{ filial: string; estoque: number }>;
    total: number;
  }>(null);
  const [compraVendasTooltip, setCompraVendasTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    mode: "12m" | "60d" | "valor12m";
    filiais: Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m: number }>;
    loading: boolean;
  }>(null);
  const [compraAbcTooltip, setCompraAbcTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    escopo: "geral" | "loja";
    periodo: string;
    regra: string;
    curva: Curva;
    valor12m: number;
    percParticipacao: number;
    percCumulativo: number;
    filiaisLoading: boolean;
    filiais: Array<{ filial: string; curva: Curva; valor12m: number; participacao: number; acumulado: number }>;
  }>(null);
  const [compraSugestaoTooltip, setCompraSugestaoTooltip] = useState<null | {
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
  }>(null);
  const [compraDuracaoTooltip, setCompraDuracaoTooltip] = useState<null | {
    x: number;
    y: number;
    regra: string;
    limiteDias: number;
    vendasMesAtual: number;
    diasCorridos: number;
    consumoDiario: number;
    estoqueAtual: number;
    duracaoDias: number;
  }>(null);
  const [compraSugestaoSTooltip, setCompraSugestaoSTooltip] = useState<null | {
    x: number;
    y: number;
    mediaVendasMes: number;
    mesesHistoricoFilial: number;
    estoqueAtual: number;
    limiteDias: number;
    qtdS: number;
  }>(null);
  const [compraSugestaoETooltip, setCompraSugestaoETooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m: number;
    mesesHistoricoFilial: number;
    mesesSemVenda: number;
    mesesAtivos: number;
    velocidadeAjustada: number;
    limiteDias: number;
    qtdE: number;
  }>(null);
  const [compraHistoricoTooltip, setCompraHistoricoTooltip] = useState<null | {
    x: number;
    y: number;
    primeiraEntradaFilial: string | null;
    diasHistoricoFilial: number;
    mesesHistoricoFilial: number;
  }>(null);

  // Quando filial muda, voltar para aba de produtos
  useEffect(() => {
    setActiveTab("produtos");
    setSelectedCategory(null);
  }, [selectedFilial]);

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
  const compraFilialScope = selectedFilial?.trim() || "__ALL__";

  const produtosCompraAnalise = useMemo(() => {
    if (!modoCompra) return [];
    return produtosComCurva.filter((p) => compraCurvasAtivas[p.curva]);
  }, [modoCompra, produtosComCurva, compraCurvasAtivas]);

  const produtosCompraFetchKey = useMemo(
    () => produtosCompraAnalise.map((p) => buildCompraItemKey(p.produto, p.cor ?? null)).join("~"),
    [produtosCompraAnalise]
  );

  useEffect(() => {
    if (!modoCompra || produtosCompraAnalise.length === 0) return;
    let cancelled = false;
    void Promise.all(
      produtosCompraAnalise.map(async (p) => {
        const itemKey = buildCompraItemKey(p.produto, p.cor ?? null);
        const metricKey = `${compraFilialScope}::${itemKey}`;
        const [vendas, estoqueFilial] = await Promise.all([
          fetchVendasItemMetricasCompra(companyKey, selectedFilial, p.produto, p.cor ?? null),
          fetchEstoqueFilialSumCompra(companyKey, selectedFilial, p.produto, p.cor ?? null),
        ]);
        return {
          key: metricKey,
          values: {
            qtde12m: vendas?.qtde12m ?? null,
            qtde60d: vendas?.qtde60d ?? null,
            vendasMesAtual: vendas?.vendasMesAtual ?? null,
            valor12m: vendas?.valor12m ?? null,
            custoUnit: vendas?.custoUnit ?? (p.custo > 0 ? p.custo : null),
            estoqueFilial,
            diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
            primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
            diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
            mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
            historicoParcial: vendas?.historicoParcial ?? null,
          },
        };
      })
    )
      .then((rows) => {
        if (cancelled) return;
        setCompraMetricas((prev) => {
          const next = { ...prev };
          rows.forEach((row) => {
            next[row.key] = row.values;
          });
          return next;
        });
      })
      .catch(() => {
        // Mantem as celulas em branco quando uma metrica de compra falha.
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, selectedFilial, modoCompra, produtosCompraAnalise, produtosCompraFetchKey, compraFilialScope]);

  const compraAbcMap = useMemo(() => {
    return calcularCurvasCompraRede(
      produtosCompraAnalise.map((p) => {
        const itemKey = buildCompraItemKey(p.produto, p.cor ?? null);
        const metricKey = `${compraFilialScope}::${itemKey}`;
        return {
          key: itemKey,
          valor12m: Number(compraMetricas[metricKey]?.valor12m ?? 0),
        };
      })
    );
  }, [produtosCompraAnalise, compraMetricas, compraFilialScope]);

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

  const handleExportSimpleXlsx = () => {
    if (produtosComCurva.length === 0) return;
    const rows: CurvaAbcSimpleXlsxRow[] = [];
    for (const curva of groups) {
      const grupo = produtosComCurva.filter(p => p.curva === curva);
      for (const p of grupo) {
        const rankGlobal = produtosComCurva.indexOf(p) + 1;
        const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
        const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
        const cmp = getComparisonBadge(p.vendas, p.vendasPrevious);
        let variacao: number | string = "";
        if (cmp?.kind === "new") variacao = "NOVO";
        else if (cmp?.kind === "pct") variacao = Math.round(cmp.value * 10) / 10;
        rows.push({
          "#": rankGlobal,
          Curva: curva,
          Descrição: p.descricao || p.produto,
          Código: p.produto,
          "Codigo de Barras": p.codigoBarra || "",
          Categoria: p.categoria ? getCategoryHeaderLabel(p.categoria) : "",
          Grade: companyKey === "scarfme" ? (p.grade ?? "") : "",
          Cor: porCor ? (p.corDescricao || p.cor || "") : "",
          "Participação %": Math.round(p.percParticipacao * 10) / 10,
          "% acumulado": Math.round(p.percCumulativa * 1000) / 10,
          Faturamento: Math.round(p.vendas * 100) / 100,
          Qtd: p.qtde,
          Estoque: p.estoque ?? 0,
          Markup: markup !== null ? Math.round(markup * 100) / 100 : "",
          "Var. vs período anterior": variacao,
        });
      }
    }
    exportCurvaAbcSimpleXlsx(rows, {
      companyKey,
      range: { startDate: range.startDate, endDate: range.endDate },
      filialLabel: selectedFilial ? (data?.displayName ?? selectedFilial) : null,
    });
  };

  const comparisonLabel = comparisonMode === "month" ? "mês anterior" : "mesmo período do ano anterior";

  const pageTitle = selectedFilial
    ? (data?.displayName ?? selectedFilial)
    : "Curva A,B,C";

  const pageSubtitle = selectedFilial
    ? "Performance de vendas"
    : "Visão geral — todas as filiais e e-commerce";

  const abcTitleSuffix = selectedCategory
    ? ` — ${getCategoryHeaderLabel(selectedCategory)}`
    : "";

  const renderCompraCells = (p: ProdutoComCurva) => {
    const itemKey = buildCompraItemKey(p.produto, p.cor ?? null);
    const metricKey = `${compraFilialScope}::${itemKey}`;
    const metric = compraMetricas[metricKey];
    const valor12m = metric?.valor12m ?? null;
    const qtde12m = metric?.qtde12m ?? null;
    const qtde60d = metric?.qtde60d ?? null;
    const vendasMesAtual = metric?.vendasMesAtual ?? null;
    const estoqueFilial = metric?.estoqueFilial ?? null;
    const custoUnit = metric?.custoUnit ?? (p.custo > 0 ? p.custo : null);
    const diasDesdeUltimaVenda = metric?.diasDesdeUltimaVenda ?? null;
    const primeiraEntradaFilial = metric?.primeiraEntradaFilial ?? null;
    const diasHistoricoFilial = metric?.diasHistoricoFilial ?? null;
    const mesesHistoricoFilial = metric?.mesesHistoricoFilial ?? null;
    const historicoParcial = metric?.historicoParcial ?? false;
    const itemCompra = {
      qtde12m,
      vendasMesAtual,
      estoqueFilial,
      diasDesdeUltimaVenda,
      primeiraEntradaFilial,
      diasHistoricoFilial,
      mesesHistoricoFilial,
      historicoParcial,
      linha: p.categoria,
      subgrupo: p.subgrupo ?? null,
    };
    const diasCorridosMes = new Date().getDate();
    const abc = compraAbcMap.get(itemKey);
    const sugestao = getReposicaoCompraView(itemCompra, diasCorridosMes);
    const qtdBase = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;

    const showVendasTooltip = async (
      e: React.MouseEvent<HTMLElement>,
      mode: "12m" | "60d" | "valor12m"
    ) => {
      const cacheKey = `${compraFilialScope}::${itemKey}`;
      const hoverKey = `${cacheKey}::${mode}`;
      compraVendasHoverKeyRef.current = hoverKey;
      const cached = compraVendasCache[cacheKey];
      if (cached) {
        if (compraVendasHoverKeyRef.current !== hoverKey) return;
        setCompraVendasTooltip({ x: e.clientX, y: e.clientY, produto: p.produto, cor: p.corDescricao || p.cor || "", mode, filiais: cached, loading: false });
        return;
      }
      setCompraVendasTooltip({ x: e.clientX, y: e.clientY, produto: p.produto, cor: p.corDescricao || p.cor || "", mode, filiais: [], loading: true });
      try {
        const rows = await fetchVendasPorFilialItemCompra(companyKey, selectedFilial, p.produto, p.cor ?? null);
        if (compraVendasHoverKeyRef.current !== hoverKey) return;
        setCompraVendasCache((prev) => ({ ...prev, [cacheKey]: rows }));
        setCompraVendasTooltip((prev) => compraVendasHoverKeyRef.current === hoverKey && prev ? { ...prev, filiais: rows, loading: false } : null);
      } catch {
        if (compraVendasHoverKeyRef.current !== hoverKey) return;
        setCompraVendasTooltip((prev) => (prev ? { ...prev, loading: false } : null));
      }
    };

    const showEstoqueTooltip = async (e: React.MouseEvent<HTMLElement>) => {
      const cacheKey = `${compraFilialScope}::${itemKey}`;
      compraEstoqueHoverKeyRef.current = cacheKey;
      const showTooltip = (rows: Array<{ filial: string; estoque: number }>) => {
        if (compraEstoqueHoverKeyRef.current !== cacheKey) return;
        setCompraEstoqueTooltip({
          x: e.clientX,
          y: e.clientY,
          produto: p.produto,
          cor: p.corDescricao || p.cor || "",
          filiais: rows,
          total: rows.reduce((s, r) => s + Math.max(0, Number(r.estoque ?? 0)), 0),
        });
      };
      const cached = compraEstoqueCache[cacheKey];
      if (cached) {
        showTooltip(cached);
        return;
      }
      try {
        const params = new URLSearchParams({ company: companyKey, produto: p.produto.trim() });
        if (selectedFilial && selectedFilial.trim()) params.set("filial", selectedFilial.trim());
        if (p.cor) params.set("corProduto", p.cor.trim());
        const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
        const json = (await res.json()) as { data?: Array<{ filial: string; estoque: number }> };
        const rows = (json.data || []).map((r) => ({ filial: r.filial, estoque: Number(r.estoque ?? 0) }));
        if (compraEstoqueHoverKeyRef.current !== cacheKey) return;
        setCompraEstoqueCache((prev) => ({ ...prev, [cacheKey]: rows }));
        showTooltip(rows);
      } catch {
        showTooltip([]);
      }
    };

    const showAbcTooltip = async (e: React.MouseEvent<HTMLElement>) => {
      if (!abc) return;
      const hoverKey = `${compraFilialScope}::abc::${itemKey}`;
      compraAbcHoverKeyRef.current = hoverKey;
      const periodoHistorico = historicoParcial
        ? `Ultimos ${getMesesHistoricoFilialCompra({ mesesHistoricoFilial }).toFixed(1)} meses (historico real da filial)`
        : "Ultimos 12 meses";
      setCompraAbcTooltip({
        x: e.clientX,
        y: e.clientY,
        produto: p.produto,
        cor: p.corDescricao || p.cor || "",
        escopo: selectedFilial ? "loja" : "geral",
        periodo: periodoHistorico,
        regra: "Classificacao por faturamento acumulado (A ate 80%, B ate 95%, C acima de 95%).",
        curva: abc.curva,
        valor12m: Number(valor12m ?? 0),
        percParticipacao: abc.percParticipacao,
        percCumulativo: abc.percCumulativo,
        filiaisLoading: true,
        filiais: [],
      });
      try {
        const allItemsVendas = await Promise.all(
          produtosCompraAnalise.map(async (item) => {
            const ik = buildCompraItemKey(item.produto, item.cor ?? null);
            const cacheKey = `__ALL__::${ik}`;
            let rows = compraVendasCache[cacheKey];
            if (!rows) {
              rows = await fetchVendasPorFilialItemCompra(companyKey, null, item.produto, item.cor ?? null);
              setCompraVendasCache((prev) => ({ ...prev, [cacheKey]: rows }));
            }
            return { ik, rows };
          })
        );
        if (compraAbcHoverKeyRef.current !== hoverKey) return;
        const filialItemsMap = new Map<string, Array<{ ik: string; valor12m: number }>>();
        for (const { ik, rows } of allItemsVendas) {
          for (const row of rows) {
            if (!filialItemsMap.has(row.filial)) filialItemsMap.set(row.filial, []);
            filialItemsMap.get(row.filial)!.push({ ik, valor12m: row.valor12m });
          }
        }
        const filialResults: Array<{ filial: string; curva: Curva; valor12m: number; participacao: number; acumulado: number }> = [];
        const selectedLabel = data?.displayName ?? selectedFilial;
        for (const [filial, filialItens] of filialItemsMap) {
          if (selectedLabel && filial === selectedLabel) continue;
          const sorted = [...filialItens].sort((a, b) => b.valor12m - a.valor12m);
          const total = sorted.reduce((s, r) => s + Math.max(0, r.valor12m), 0);
          let cum = 0;
          for (const item of sorted) {
            cum += Math.max(0, item.valor12m);
            if (item.ik === itemKey) {
              const percCum = total > 0 ? cum / total : 1;
              const curvaFilial: Curva = percCum <= 0.8 ? "A" : percCum <= 0.95 ? "B" : "C";
              filialResults.push({
                filial,
                curva: curvaFilial,
                valor12m: item.valor12m,
                participacao: total > 0 ? (Math.max(0, item.valor12m) / total) * 100 : 0,
                acumulado: percCum * 100,
              });
              break;
            }
          }
        }
        filialResults.sort((a, b) => b.valor12m - a.valor12m);
        if (compraAbcHoverKeyRef.current !== hoverKey) return;
        setCompraAbcTooltip((prev) => prev ? { ...prev, filiaisLoading: false, filiais: filialResults } : null);
      } catch {
        if (compraAbcHoverKeyRef.current !== hoverKey) return;
        setCompraAbcTooltip((prev) => prev ? { ...prev, filiaisLoading: false } : null);
      }
    };

    return (
      <>
        <td className={styles.right}>
          {abc ? (
            <span
              className={`${styles.abcBadgeMini} ${styles[`abcBadge${abc.curva}`]}`}
              onMouseEnter={showAbcTooltip}
              onMouseLeave={() => {
                compraAbcHoverKeyRef.current = null;
                setCompraAbcTooltip(null);
              }}
              title="Curva ABC; passe o mouse para ver a posicao na lista por filial"
            >
              {abc.curva}
            </span>
          ) : (
            <span className={`${styles.abcBadgeMini} ${styles.abcBadgeEmpty}`}>—</span>
          )}
        </td>
        <td className={styles.right}><span className={styles.cellMetric} onMouseEnter={(e) => showVendasTooltip(e, "valor12m")} onMouseLeave={() => { compraVendasHoverKeyRef.current = null; setCompraVendasTooltip(null); }}>{valor12m != null ? fmtBRL(valor12m) : "—"}</span></td>
        <td className={styles.right}>
          <span
            className={styles.cellMetric}
            onMouseEnter={(e) => showVendasTooltip(e, "12m")}
            onMouseLeave={() => { compraVendasHoverKeyRef.current = null; setCompraVendasTooltip(null); }}
          >
            {qtde12m != null ? (
              <>
                {fmt(qtde12m)}
                {historicoParcial ? (
                  <span
                    className={styles.partialHistoryBadge}
                    onMouseEnter={(e) =>
                      setCompraHistoricoTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        primeiraEntradaFilial,
                        diasHistoricoFilial: Number(diasHistoricoFilial ?? 365),
                        mesesHistoricoFilial: getMesesHistoricoFilialCompra({ mesesHistoricoFilial }),
                      })
                    }
                    onMouseLeave={() => setCompraHistoricoTooltip(null)}
                  >
                    (&lt;12m)
                  </span>
                ) : null}
              </>
            ) : "—"}
          </span>
        </td>
        <td className={styles.right}><span className={styles.cellMetric} onMouseEnter={showEstoqueTooltip} onMouseLeave={() => { compraEstoqueHoverKeyRef.current = null; setCompraEstoqueTooltip(null); }}>{estoqueFilial != null ? fmt(estoqueFilial) : "—"}</span></td>
        <td className={styles.right}><span className={styles.cellMetric} onMouseEnter={(e) => showVendasTooltip(e, "60d")} onMouseLeave={() => { compraVendasHoverKeyRef.current = null; setCompraVendasTooltip(null); }}>{qtde60d != null ? fmt(qtde60d) : "—"}</span></td>
        <td className={styles.right}>
          <span
            className={styles.cellMetric}
            onMouseEnter={(e) => {
              const limiteDias = getLimiteDiasReposicao(itemCompra);
              const linha = normalizeCompraKey(p.categoria);
              const subgrupo = normalizeCompraKey(p.subgrupo);
              const regra = linha === "INDIA" ? "Linha India" : new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]).has(subgrupo) ? `Subgrupo: ${p.subgrupo ?? ""}`.trim() : "Padrao";
              const vendasMes = Number(vendasMesAtual ?? 0);
              const consumoDiario = vendasMes > 0 && diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
              const estoque = Number(estoqueFilial ?? 0);
              setCompraDuracaoTooltip({ x: e.clientX, y: e.clientY, regra, limiteDias, vendasMesAtual: vendasMes, diasCorridos: diasCorridosMes, consumoDiario, estoqueAtual: estoque, duracaoDias: consumoDiario > 0 ? Math.round(estoque / consumoDiario) : 0 });
            }}
            onMouseLeave={() => setCompraDuracaoTooltip(null)}
          >
            {(() => {
              const vendasMes = Number(vendasMesAtual ?? 0);
              const consumoDiario = vendasMes > 0 && diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
              const estoque = Number(estoqueFilial ?? 0);
              if (consumoDiario <= 0 || estoque <= 0) return "—";
              const dias = Math.round(estoque / consumoDiario);
              return dias >= 365 ? `${Math.round(dias / 30)} meses` : `${dias} dias`;
            })()}
          </span>
        </td>
        <td className={styles.right}>
          {abc ? (
            <div className={styles.percBar}>
              <div className={styles.percBarTrack}>
                <div className={`${styles.percBarFill} ${styles.percBarFillCompra}`} style={{ width: `${Math.min(100, abc.percParticipacao)}%` }} />
              </div>
              <span className={styles.percText}>{abc.percParticipacao.toFixed(1)}%</span>
            </div>
          ) : <span className={styles.cellMetric}>—</span>}
        </td>
        <td className={styles.right}>
          {(() => {
            if (sugestao.qtdFinal > 0) {
              const vendasMes = Number(vendasMesAtual ?? 0);
              const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
              const estoqueAtual = Number(estoqueFilial ?? 0);
              const limiteDias = getLimiteDiasReposicao(itemCompra);
              const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
              return <span className={styles.reporAdd} onMouseEnter={(e) => setCompraSugestaoTooltip({ x: e.clientX, y: e.clientY, titulo: "Sugestao de reposicao (calculo principal)", regra: "Qtd = consumo/dia x (limite de cobertura - duracao atual).", limiteDias, vendasMesAtual: vendasMes, diasCorridos: diasCorridosMes, consumoDiario, estoqueAtual, duracaoAtual, qtdCalculada: sugestao.qtdFinal })} onMouseLeave={() => setCompraSugestaoTooltip(null)}>{fmt(sugestao.qtdFinal)}</span>;
            }
            if (sugestao.qtdS > 0) {
              const mesesBase = getMesesHistoricoFilialCompra({ mesesHistoricoFilial });
              const mediaVendasMes = Number(qtde12m ?? 0) / mesesBase;
              const limiteDias = getLimiteDiasReposicao(itemCompra);
              return <span className={styles.reporAdd}>{fmt(sugestao.qtdS)}{" "}<span className={styles.reporRuleBadgeS} onMouseEnter={(e) => setCompraSugestaoSTooltip({ x: e.clientX, y: e.clientY, mediaVendasMes, mesesHistoricoFilial: mesesBase, estoqueAtual: Number(estoqueFilial ?? 0), limiteDias, qtdS: sugestao.qtdS })} onMouseLeave={() => setCompraSugestaoSTooltip(null)}>S</span></span>;
            }
            if (sugestao.qtdE > 0) {
              const eInfo = calcQtdSugestaoEInfo(itemCompra);
              const limiteDias = getLimiteDiasReposicao(itemCompra);
              return <span className={styles.reporAdd}>{fmt(sugestao.qtdE)}{" "}<span className={styles.reporRuleBadgeE} onMouseEnter={(e) => eInfo && setCompraSugestaoETooltip({ x: e.clientX, y: e.clientY, qtde12m: Number(qtde12m ?? 0), mesesHistoricoFilial: getMesesHistoricoFilialCompra({ mesesHistoricoFilial }), mesesSemVenda: eInfo.mesesSemVenda, mesesAtivos: eInfo.mesesAtivos, velocidadeAjustada: eInfo.velocidadeAjustada, limiteDias, qtdE: sugestao.qtdE })} onMouseLeave={() => setCompraSugestaoETooltip(null)}>E</span></span>;
            }
            if (sugestao.semSugestao) return <span className={styles.cellMetric}>—</span>;
            const vendasMes = Number(vendasMesAtual ?? 0);
            const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
            const estoqueAtual = Number(estoqueFilial ?? 0);
            const limiteDias = getLimiteDiasReposicao(itemCompra);
            const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
            return <span className={styles.reporOk} onMouseEnter={(e) => setCompraSugestaoTooltip({ x: e.clientX, y: e.clientY, titulo: "Quantidade suficiente", regra: "Sem reposicao: duracao atual ja atende o limite de cobertura.", limiteDias, vendasMesAtual: vendasMes, diasCorridos: diasCorridosMes, consumoDiario, estoqueAtual, duracaoAtual, qtdCalculada: 0 })} onMouseLeave={() => setCompraSugestaoTooltip(null)}>Quantidade suficiente</span>;
          })()}
        </td>
        <td className={styles.right}><span className={styles.cellMetric}>{custoUnit != null && custoUnit > 0 ? fmtBRL2(custoUnit) : "—"}</span></td>
        <td className={styles.right}><span className={styles.cellMetric}>{custoUnit != null && custoUnit > 0 && qtdBase > 0 ? fmtBRL(qtdBase * custoUnit) : "—"}</span></td>
      </>
    );
  };

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
                    title={cat === OUTROS_LABEL ? outrosTooltip : `Filtrar ABC por ${cat}`}
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
                <span className={styles.summaryLabel}>{porCor ? "ITENS (PROD. + COR)" : "PRODUTOS ÚNICOS"}</span>
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
            {produtosComCurva.length > 0 && (
              <button
                type="button"
                className={styles.exportXlsxBtn}
                onClick={handleExportSimpleXlsx}
                title="Exporta a tabela atual (uma linha por produto) em Excel"
              >
                Exportar XLSX
              </button>
            )}
          </div>

          <div className={styles.compraModeRow}>
            <span className={styles.comparisonLabel}>Modo compra:</span>
            <button
              type="button"
              className={`${styles.toggleBtn} ${modoCompra ? styles.toggleBtnActive : ""}`}
              onClick={() => setModoCompra(v => !v)}
              title="Alterna a tabela para a mesma analise de compra da Lista Loja"
            >
              {modoCompra ? "Ligado" : "Desligado"}
            </button>
            {modoCompra && (
              <div className={styles.compraCurvasChecks} aria-label="Curvas analisadas no modo compra">
                {groups.map((curva) => (
                  <label key={curva} className={styles.compraCurvaCheck}>
                    <input
                      type="checkbox"
                      checked={compraCurvasAtivas[curva]}
                      onChange={() => setCompraCurvasAtivas(prev => ({ ...prev, [curva]: !prev[curva] }))}
                    />
                    {curva}
                  </label>
                ))}
              </div>
            )}
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
                    {modoCompra ? (
                      <>
                        <th className={styles.right}>Curva ABC Rede</th>
                        <th className={styles.right}>Vendas 12 meses</th>
                        <th className={styles.right}>QTD 12 meses</th>
                        <th className={styles.right}>Estoque</th>
                        <th className={styles.right}>QTD 60 dias</th>
                        <th className={styles.right}>Duração</th>
                        <th className={styles.right}>Participação</th>
                        <th className={styles.right}>Sugestão de Reposição</th>
                        <th className={styles.right}>Custo Unit.</th>
                        <th className={styles.right}>Custo Total</th>
                      </>
                    ) : (
                      <>
                        <th className={styles.right}>Participação</th>
                        <th className={styles.right}>Faturamento no período</th>
                        <th className={styles.right}>Qtd vendida</th>
                        <th className={styles.right}>Estoque</th>
                        <th className={styles.right}>Markup</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {groups.map(curva => {
                    if (modoCompra && !compraCurvasAtivas[curva]) return null;
                    const grupo = produtosComCurva.filter(p => p.curva === curva);
                    if (grupo.length === 0) return null;
                    return (
                      <React.Fragment key={curva}>
                        <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                          <td colSpan={modoCompra ? 12 : 7}>
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
                          const rankGlobal = produtosComCurva.indexOf(p) + 1;
                          const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
                          const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
                          return (
                            <tr
                              key={`${p.produto}-${p.categoria}-${p.cor ?? ""}-${p.grade ?? ""}`}
                              className={!modoCompra && curva !== "A" ? styles.rowDimmed : ""}
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
                                  </div>
                                  {((p.descricao && p.produto !== p.descricao) || p.categoria || p.codigoBarra) && (
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
                                  )}
                                  {porCor && (p.corDescricao || p.cor) && (
                                    <div className={styles.productCode} style={{ marginTop: 4 }}>
                                      Cor: {p.corDescricao || p.cor}
                                    </div>
                                  )}
                                </Link>
                              </td>
                              {modoCompra ? (
                                renderCompraCells(p)
                              ) : (
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
                              <td className={styles.vendas}>{fmtBRL(p.vendas)}</td>
                              <td className={styles.vendas}>
                                {p.qtdePorFilial && p.qtdePorFilial.length > 1 ? (
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
                                  <div className={styles.qtdeTooltipWrapper}>
                                    <span>{fmt(p.estoque ?? 0)}</span>
                                    <div className={styles.qtdeTooltipContent}>
                                      <div className={styles.tooltipTitle}>Estoque por filial</div>
                                      {p.estoquePorFilial.map(entry => (
                                        <div key={entry.filial} className={styles.tooltipRow}>
                                          <span className={styles.tooltipFilial}>{entry.displayName}</span>
                                          <span className={styles.tooltipQtde}>{fmt(entry.qtde)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  fmt(p.estoque ?? 0)
                                )}
                              </td>
                              <td className={styles.vendas}>{markup !== null ? <span className={styles.markupBadge}>{markup.toFixed(2)}x</span> : <span className={styles.noData}>—</span>}</td>
                                </>
                              )}
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
      {compraEstoqueTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraEstoqueTooltip.x + 12, top: compraEstoqueTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Estoque por filial</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {compraEstoqueTooltip.produto}</div>
          {compraEstoqueTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {compraEstoqueTooltip.cor}</div>}
          <div className={styles.metricTooltipDivider} />
          {compraEstoqueTooltip.filiais.length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem dados de estoque por filial.</div>
          ) : (
            <>
              {compraEstoqueTooltip.filiais.map((row) => (
                <div key={row.filial} className={styles.metricTooltipRow}>
                  <span>{row.filial}</span>
                  <span>{fmt(row.estoque)}</span>
                </div>
              ))}
              <div className={styles.metricTooltipTotal}>
                <span>Total</span>
                <span>{fmt(compraEstoqueTooltip.total)}</span>
              </div>
            </>
          )}
        </div>
      )}
      {compraVendasTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraVendasTooltip.x + 12, top: compraVendasTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>
            {compraVendasTooltip.mode === "12m"
              ? "Vendas 12 meses por filial"
              : compraVendasTooltip.mode === "60d"
                ? "Vendas 60 dias por filial"
                : "Valor vendas 12 meses por filial"}
          </div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {compraVendasTooltip.produto}</div>
          {compraVendasTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {compraVendasTooltip.cor}</div>}
          <div className={styles.metricTooltipDivider} />
          {compraVendasTooltip.loading ? (
            <div className={styles.metricTooltipLine}>Carregando...</div>
          ) : compraVendasTooltip.filiais.length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem vendas no periodo.</div>
          ) : (
            <>
              {compraVendasTooltip.filiais.map((row) => (
                <div key={row.filial} className={styles.metricTooltipRow}>
                  <span>{row.filial}</span>
                  <span>
                    {compraVendasTooltip.mode === "valor12m"
                      ? fmtBRL(row.valor12m)
                      : fmt(compraVendasTooltip.mode === "12m" ? row.qtde12m : row.qtde60d)}
                  </span>
                </div>
              ))}
              <div className={styles.metricTooltipTotal}>
                <span>Total</span>
                <span>
                  {compraVendasTooltip.mode === "valor12m"
                    ? fmtBRL(compraVendasTooltip.filiais.reduce((s, row) => s + Number(row.valor12m ?? 0), 0))
                    : fmt(compraVendasTooltip.filiais.reduce((s, row) => s + Number(compraVendasTooltip.mode === "12m" ? row.qtde12m : row.qtde60d), 0))}
                </span>
              </div>
            </>
          )}
        </div>
      )}
      {compraAbcTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraAbcTooltip.x + 12, top: compraAbcTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Curva ABC (detalhe da logica)</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {compraAbcTooltip.produto}</div>
          {compraAbcTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {compraAbcTooltip.cor}</div>}
          <div className={styles.metricTooltipMeta}><strong>Escopo:</strong> {compraAbcTooltip.escopo === "geral" ? "Rede (todas as filiais)" : "Loja selecionada"}</div>
          <div className={styles.metricTooltipMeta}><strong>Periodo:</strong> {compraAbcTooltip.periodo}</div>
          <div className={styles.metricTooltipLine} style={{ marginTop: 6 }}>{compraAbcTooltip.regra}</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipRow}>
            <span>{compraAbcTooltip.periodo === "Ultimos 12 meses" ? "Valor 12 meses" : "Valor no periodo"}</span>
            <span>{fmtBRL(compraAbcTooltip.valor12m)}</span>
          </div>
          <div className={styles.metricTooltipRow}><span>Participacao na lista</span><span>{compraAbcTooltip.percParticipacao.toFixed(1)}%</span></div>
          <div className={styles.metricTooltipRow}><span>Acumulado</span><span>{compraAbcTooltip.percCumulativo.toFixed(1)}%</span></div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipRow}>
            <span>Classificacao ({compraAbcTooltip.escopo === "geral" ? "rede" : "loja selecionada"})</span>
            <span className={`${styles.abcBadgeMini} ${styles[`abcBadge${compraAbcTooltip.curva}`]}`}>{compraAbcTooltip.curva}</span>
          </div>
          {compraAbcTooltip.filiaisLoading ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine}>Carregando outras lojas...</div>
            </>
          ) : compraAbcTooltip.filiais.filter((r) => r.valor12m > 0).length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine}>Posicao na lista por loja:</div>
              {compraAbcTooltip.filiais.filter((r) => r.valor12m > 0).map((row) => (
                <div key={row.filial} className={styles.metricTooltipRow}>
                  <span>{row.filial}</span>
                  <span className={styles.metricTooltipInlineBadge}>
                    <span>{row.participacao.toFixed(1)}% | acum. {row.acumulado.toFixed(1)}%</span>
                    <span className={`${styles.abcBadgeMini} ${styles[`abcBadge${row.curva}`]}`}>{row.curva}</span>
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {compraSugestaoTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraSugestaoTooltip.x + 12, top: compraSugestaoTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>{compraSugestaoTooltip.titulo}</div>
          <div className={styles.metricTooltipLine}>{compraSugestaoTooltip.regra}</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Vendas mes:</strong> {fmt(compraSugestaoTooltip.vendasMesAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Dias corridos:</strong> {compraSugestaoTooltip.diasCorridos}</div>
          <div className={styles.metricTooltipLine}><strong>Consumo/dia:</strong> {compraSugestaoTooltip.consumoDiario.toFixed(2)} un</div>
          <div className={styles.metricTooltipLine}><strong>Estoque atual:</strong> {fmt(compraSugestaoTooltip.estoqueAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Duracao atual:</strong> {Math.max(0, Math.round(compraSugestaoTooltip.duracaoAtual))} dias</div>
          <div className={styles.metricTooltipLine}><strong>Limite do item:</strong> {compraSugestaoTooltip.limiteDias} dias</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(compraSugestaoTooltip.qtdCalculada)} un</div>
        </div>
      )}
      {compraHistoricoTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraHistoricoTooltip.x + 12, top: compraHistoricoTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Historico parcial na filial</div>
          <div className={styles.metricTooltipLine}>Este item ainda nao completou 12 meses de historico na filial selecionada.</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Data base historico:</strong> {formatHistoricoDate(compraHistoricoTooltip.primeiraEntradaFilial)}</div>
          <div className={styles.metricTooltipLine}><strong>Dias de historico:</strong> {fmt(compraHistoricoTooltip.diasHistoricoFilial)}</div>
          <div className={styles.metricTooltipLine}><strong>Meses de historico:</strong> {compraHistoricoTooltip.mesesHistoricoFilial.toFixed(1)}</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}>Os calculos historicos usam o periodo real disponivel ate completar 12 meses.</div>
        </div>
      )}
      {compraSugestaoSTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraSugestaoSTooltip.x + 12, top: compraSugestaoSTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Regra S (mesma logica da ABC)</div>
          <div className={styles.metricTooltipLine}><strong>Base historica filial:</strong> {compraSugestaoSTooltip.mesesHistoricoFilial.toFixed(1)} meses</div>
          <div className={styles.metricTooltipLine}><strong>Media de vendas:</strong> {compraSugestaoSTooltip.mediaVendasMes.toFixed(1)} un/mes</div>
          <div className={styles.metricTooltipLine}><strong>Estoque atual:</strong> {fmt(compraSugestaoSTooltip.estoqueAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Cobertura minima:</strong> {compraSugestaoSTooltip.limiteDias} dias</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(compraSugestaoSTooltip.qtdS)} un</div>
          <div className={styles.metricTooltipLine}>
            = {(compraSugestaoSTooltip.limiteDias / 30).toFixed(1)} meses x {compraSugestaoSTooltip.mediaVendasMes.toFixed(1)} un/mes
          </div>
        </div>
      )}
      {compraSugestaoETooltip && (
        <div className={styles.metricTooltip} style={{ left: compraSugestaoETooltip.x + 12, top: compraSugestaoETooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Regra E - Produto parado por falta de estoque</div>
          <div className={styles.metricTooltipLine}>A media mensal estava subestimada porque o produto ficou sem estoque.</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Vendas no periodo base:</strong> {fmt(compraSugestaoETooltip.qtde12m)} un</div>
          <div className={styles.metricTooltipLine}><strong>Base historica filial:</strong> {compraSugestaoETooltip.mesesHistoricoFilial.toFixed(1)} meses</div>
          <div className={styles.metricTooltipLine}><strong>Sem vendas ha:</strong> ~{Math.round(compraSugestaoETooltip.mesesSemVenda)} meses ({Math.round(compraSugestaoETooltip.mesesSemVenda * 30)} dias)</div>
          <div className={styles.metricTooltipLine}><strong>Periodo ativo estimado:</strong> ~{compraSugestaoETooltip.mesesAtivos.toFixed(1)} meses</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Velocidade ajustada:</strong> {compraSugestaoETooltip.velocidadeAjustada.toFixed(2)} un/mes</div>
          <div className={styles.metricTooltipLine}><strong>Cobertura minima:</strong> {compraSugestaoETooltip.limiteDias} dias ({(compraSugestaoETooltip.limiteDias / 30).toFixed(1)} meses)</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(compraSugestaoETooltip.qtdE)} un</div>
        </div>
      )}
      {compraDuracaoTooltip && (
        <div className={styles.metricTooltip} style={{ left: compraDuracaoTooltip.x + 12, top: compraDuracaoTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Duracao de estoque</div>
          <div className={styles.metricTooltipLine}><strong>Regra:</strong> {compraDuracaoTooltip.regra}</div>
          <div className={styles.metricTooltipLine}><strong>Limite do item:</strong> {compraDuracaoTooltip.limiteDias} dias</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Vendas mes:</strong> {fmt(compraDuracaoTooltip.vendasMesAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Dias corridos:</strong> {compraDuracaoTooltip.diasCorridos}</div>
          <div className={styles.metricTooltipLine}><strong>Consumo/dia:</strong> {compraDuracaoTooltip.consumoDiario.toFixed(2)} un</div>
          <div className={styles.metricTooltipLine}><strong>Estoque atual:</strong> {fmt(compraDuracaoTooltip.estoqueAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Duracao:</strong> {compraDuracaoTooltip.duracaoDias} dias</div>
        </div>
      )}
    </div>
  );
}

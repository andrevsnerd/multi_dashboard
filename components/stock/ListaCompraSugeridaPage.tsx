"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
// @ts-ignore - xlsx não tem tipos perfeitos
import * as XLSX from "xlsx";

import { useSidebar } from "@/components/layout/SidebarContext";
import {
  aggregateVendasPorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";
import {
  partesDestinoCompraFinal,
  textoDestinoCompraFinal,
  type DestinoCompraFinalParte,
} from "@/lib/utils/compra-final-destino";
import ComprasSalvasListPanel from "@/components/stock/ComprasSalvasListPanel";
import styles from "./ListaCompraSugeridaPage.module.css";

/** UserHeaderBar é sticky ~top:0 — cabeçalho da tabela ABC fica logo abaixo */
const USER_STICKY_HEADER_PX = 48;

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface ReposicaoItem {
  produto: string;
  descricao: string;
  cor?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  linha?: string;
  qtdCompra: number;
  estoqueReal: number;
  duracaoReal: number;
  consumoDiario: number;
  diasCobertura: number;
  necessidadeTotal: number;
  custoUnit?: number;
}

interface ReposicaoData {
  categoria: string;
  totalQtd: number;
  itens: ReposicaoItem[];
  timestamp: number;
  isProjecaoSimulada?: boolean;
  mesCompra?: string;
}

interface ProdutoSugestao {
  produto: string;
  cor?: string;
  corDescricao?: string;
  descricao: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  vendas3meses: number;
  /** Últimos 60 dias — apenas exibição na tabela ABC */
  vendas60dias?: number;
  vendasMesAtual?: number;
  valor3meses: number;
  /** Custo de reposição (cadastro), não preço médio de venda */
  custoUnitario?: number;
  estoqueAtual?: number;
  primeiraEntradaFilial?: string | null;
  diasHistoricoFilial?: number | null;
  mesesHistoricoFilial?: number | null;
  historicoParcial?: boolean | null;
  percParticipacao: number;
  qtdSugerida: number;
}

type Curva = "A" | "B" | "C";

interface ProdutoComCurva extends ProdutoSugestao {
  curva: Curva;
  qtdFinal: number;
  percCumulativa: number;
  qtdSuficiente?: boolean;
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

function getMesesHistoricoFilial(item: { mesesHistoricoFilial?: number | null }): number {
  const meses = Number(item.mesesHistoricoFilial ?? 12);
  if (!Number.isFinite(meses)) return 12;
  return Math.min(12, Math.max(1, meses));
}

// ─── ABC helpers (usados apenas na aba Análise ABC) ───────────────────────────

async function fetchListaCompra(params: URLSearchParams): Promise<ProdutoSugestao[]> {
  const res = await fetch(`/api/controle-estoque/lista-compra-sugerida?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: ProdutoSugestao[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar");
  return json.data ?? [];
}

async function fetchEstoquePorFilial(params: URLSearchParams): Promise<Array<{ filial: string; estoque: number }>> {
  const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: Array<{ filial: string; estoque: number }>; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar estoque por filial");
  return json.data ?? [];
}

async function fetchVendasPorFilialItem(params: URLSearchParams): Promise<Array<{ filial: string; qtde12m: number; qtde60d: number }>> {
  const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: Array<{ filial: string; qtde12m: number; qtde60d: number }>; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar vendas por filial");
  return json.data ?? [];
}

/** Hamilton/Largest Remainder distribution */
function hamiltonDistribute(items: { valor: number }[], total: number): number[] {
  const totalValor = items.reduce((s, r) => s + r.valor, 0);
  if (totalValor === 0 || total === 0) return items.map(() => 0);
  const exatos = items.map(r => (r.valor / totalValor) * total);
  const floors = exatos.map(Math.floor);
  const totalFloor = floors.reduce((s, v) => s + v, 0);
  const remainder = total - totalFloor;
  const fracs = exatos.map((e, i) => ({ i, frac: e - floors[i] }));
  fracs.sort((a, b) => b.frac - a.frac);
  const boost = new Set(fracs.slice(0, remainder).map(r => r.i));
  return floors.map((f, i) => f + (boost.has(i) ? 1 : 0));
}

/** Agrega códigos ERP por rótulo da dashboard (E-COMMERCE, PAULISTA, …) e ordena. */
function normalizeVendasPorFilialParaExibicao(
  companyKey: CompanyKey,
  rows: Array<{ filial: string; qtde12m: number; qtde60d: number }>
): Array<{ filial: string; qtde12m: number; qtde60d: number }> {
  const cfg = resolveCompany(companyKey);
  const merged = aggregateVendasPorFilialByDisplayLabel(rows, cfg);
  return [...merged].sort((a, b) => compareFilialDisplayOrder(a.filial, b.filial, cfg));
}

/** Claros com cor perceptível, mas contida (meio-termo entre cinza e pastel forte). */
const DESTINO_FILIAL_BADGE_THEMES = [
  { bg: "#c8d4ea", fg: "#1e3a5f", border: "#7d9dc4" },
  { bg: "#c5e0d0", fg: "#134332", border: "#5fa889" },
  { bg: "#e8d5c4", fg: "#4a3020", border: "#b88a6a" },
  { bg: "#d2cae6", fg: "#3a2d55", border: "#8f7eb5" },
  { bg: "#c2e2e8", fg: "#13404a", border: "#5aa3b5" },
  { bg: "#e2d0ee", fg: "#4a2565", border: "#9f7cbd" },
  { bg: "#ebd9b8", fg: "#5c3d12", border: "#c49a4e" },
  { bg: "#bee3dc", fg: "#12403a", border: "#4da894" },
  { bg: "#e8c9c9", fg: "#5c2222", border: "#c97a7a" },
  { bg: "#c2daf0", fg: "#153a5c", border: "#6c9ec9" },
  { bg: "#d8cef0", fg: "#40296b", border: "#8f7dc8" },
  { bg: "#d6e4c4", fg: "#354418", border: "#8baa5e" },
] as const;

function destinoBadgeThemeForFilial(label: string) {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % DESTINO_FILIAL_BADGE_THEMES.length;
  return DESTINO_FILIAL_BADGE_THEMES[idx];
}

function DestinoCompraFinalBadges({ partes }: { partes: DestinoCompraFinalParte[] }) {
  return (
    <div className={styles.destinoBadges}>
      {partes.map((p) => {
        const t = destinoBadgeThemeForFilial(p.label);
        return (
          <span
            key={p.label}
            className={styles.destinoFilialBadge}
            style={{ background: t.bg, color: t.fg, borderColor: t.border }}
          >
            <span className={styles.destinoFilialBadgeName}>{p.label}</span>
            <span className={styles.destinoFilialBadgeNum}>{fmt(p.qtd)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Calcula curva ABC por faturamento acumulado */
function calcularCurvas(produtos: ProdutoSugestao[], qtdCompra: number): ProdutoComCurva[] {
  const keyOf = (p: ProdutoSugestao) => `${p.produto}||${p.cor ?? ""}`;
  const totalGeral = produtos.reduce((s, p) => s + p.valor3meses, 0);
  let cumulative = 0;
  const comCurva = produtos.map((p): ProdutoComCurva => {
    cumulative += p.valor3meses;
    const percCum = totalGeral > 0 ? cumulative / totalGeral : 1;
    const curva: Curva = percCum <= 0.80 ? "A" : percCum <= 0.95 ? "B" : "C";
    return { ...p, curva, qtdFinal: 0, percCumulativa: percCum };
  });
  const curvaA = comCurva.filter(p => p.curva === "A");
  const qtds = hamiltonDistribute(curvaA.map(p => ({ valor: p.valor3meses })), qtdCompra);
  const qtdMap = new Map(curvaA.map((p, i) => [keyOf(p), qtds[i]]));
  return comCurva.map(p => ({
    ...p,
    qtdFinal: p.curva === "A" ? (qtdMap.get(keyOf(p)) ?? 0) : 0,
  }));
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

const ABC_ANALYSIS_COL_COUNT = 11;

/** Replica larguras das colunas da tabela principal no header flutuante (px, table-layout: fixed). */
function syncAbcStickyHeaderColumns(mainEl: HTMLTableElement | null, stickyEl: HTMLTableElement | null) {
  if (!mainEl || !stickyEl) return;
  let sourceCells: HTMLElement[] = [];
  for (const tr of mainEl.querySelectorAll("tbody tr")) {
    if (tr.children.length === ABC_ANALYSIS_COL_COUNT) {
      sourceCells = Array.from(tr.querySelectorAll("td"), (td) => td as HTMLElement);
      break;
    }
  }
  if (sourceCells.length !== ABC_ANALYSIS_COL_COUNT) {
    sourceCells = Array.from(mainEl.querySelectorAll("thead tr th"), (th) => th as HTMLElement);
  }
  const stickyThs = stickyEl.querySelectorAll("thead tr th");
  if (sourceCells.length !== stickyThs.length || sourceCells.length === 0) return;

  const widthsPx = sourceCells.map((c) => c.getBoundingClientRect().width);
  const mainW = mainEl.getBoundingClientRect().width;
  let sum = widthsPx.reduce((a, b) => a + b, 0);
  if (sum <= 0 || mainW <= 0) return;

  const scale = mainW / sum;
  const scaled = widthsPx.map((w) => Math.max(0, Math.floor(w * scale)));
  let diff = Math.round(mainW - scaled.reduce((a, b) => a + b, 0));
  scaled[scaled.length - 1] = Math.max(0, scaled[scaled.length - 1] + diff);

  stickyEl.style.tableLayout = "fixed";
  stickyEl.style.width = `${mainW}px`;
  scaled.forEach((w, i) => {
    const th = stickyThs[i] as HTMLElement;
    th.style.boxSizing = "border-box";
    th.style.width = `${w}px`;
    th.style.minWidth = `${w}px`;
    th.style.maxWidth = `${w}px`;
  });
}

function AbcAnalysisTableHead({ modoReposicao }: { modoReposicao: boolean }) {
  return (
    <thead>
      <tr>
        <th>#</th>
        <th>Produto</th>
        <th className={styles.right}>Vendas 12 meses</th>
        <th className={styles.right}>QTD 12 meses</th>
        <th className={styles.right}>Estoque</th>
        <th className={styles.right}>QTD 60 dias</th>
        <th className={styles.right}>Duração</th>
        <th className={styles.right}>Participação</th>
        <th className={styles.right}>{modoReposicao ? "Qtd a Repor" : "Qtd Proporcional"}</th>
        <th className={styles.right}>Custo Unit.</th>
        <th className={styles.right}>Custo Total</th>
      </tr>
    </thead>
  );
}

function normalizeKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Filiais inativas: no tooltip, ocultar apenas quando estoque for zero.
const INACTIVE_FILIAIS_ESTOQUE_TOOLTIP = new Set([
  "SCARFME ME - PAULISTA FFF",
  "SCARFME MATRIZ CMS",
  "SCARFME - IBIRAPUERA LLL",
  "SCARF ME - MATRIZ LLL",
].map((filial) => normalizeKey(filial)));

function filterEstoqueTooltipFiliais(filiais: Array<{ filial: string; estoque: number }>) {
  return filiais.filter((f) => {
    const filialKey = normalizeKey(f.filial);
    const estoque = Number(f.estoque ?? 0);
    if (INACTIVE_FILIAIS_ESTOQUE_TOOLTIP.has(filialKey) && estoque === 0) return false;
    return true;
  });
}

function getLimiteDiasReposicao(p: { linha?: string; subgrupo?: string }) {
  const linha = normalizeKey(p.linha);
  const subgrupo = normalizeKey(p.subgrupo);

  // Linha índia: regra exclusiva (subgrupo não conta)
  if (linha === "INDIA") return { limiteDias: 90, regra: "Linha Índia" };

  // 120 dias apenas para subgrupos específicos
  const subgrupos120 = new Set([
    "CETIM DE SEDA",
    "MOUSSELINE DE SEDA",
    "SEDA PREMIUM",
  ]);
  if (subgrupos120.has(subgrupo)) return { limiteDias: 120, regra: `Subgrupo: ${p.subgrupo ?? ""}`.trim() };

  // Restante
  return { limiteDias: 60, regra: "Padrão" };
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ListaCompraSugeridaPage({
  companyKey,
  companySlug = companyKey,
}: {
  companyKey: CompanyKey;
  companySlug?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { isOpen: sidebarOpen } = useSidebar();

  const categoria = searchParams.get("categoria") ?? "";
  const qtdCompra = Number(searchParams.get("qtdCompra") ?? "0");
  const filial = searchParams.get("filial") ?? "";
  const mode = searchParams.get("mode") ?? "";

  const [activeTab, setActiveTab] = useState<"reposicao" | "abc" | "final" | "compras-salvas">("reposicao");
  const [expandirPorCor, setExpandirPorCor] = useState(true);
  const [savingCompraSalva, setSavingCompraSalva] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const compraFinalExportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchParams.get("tab") === "compras-salvas") {
      setActiveTab("compras-salvas");
    }
  }, [searchParams]);

  const selectTab = useCallback(
    (t: "reposicao" | "abc" | "final" | "compras-salvas") => {
      setActiveTab(t);
      const p = new URLSearchParams(searchParams.toString());
      if (t === "compras-salvas") p.set("tab", "compras-salvas");
      else p.delete("tab");
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  // ── Aba Reposição ──────────────────────────────────────────────────────────
  const [reposicaoData, setReposicaoData] = useState<ReposicaoData | null>(null);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("lista_compra_reposicao");
      if (stored) {
        const data = JSON.parse(stored) as ReposicaoData;
        // Só usa dados recentes (< 10 minutos)
        if (Date.now() - data.timestamp < 10 * 60 * 1000) {
          setReposicaoData(data);
        }
      }
    } catch (_) { /* ignora */ }
  }, []);

  const reposicaoComCusto = useMemo(() => {
    if (!reposicaoData) return [];
    return reposicaoData.itens.map(item => ({
      ...item,
      custoUnit: item.custoUnit ?? 0,
      custoTotal: item.qtdCompra * (item.custoUnit ?? 0),
    }));
  }, [reposicaoData]);

  const reposicaoAgrupadaPorProduto = useMemo(() => {
    if (!reposicaoData) return [];
    const map = new Map<string, ReposicaoItem[]>();
    reposicaoData.itens.forEach((it) => {
      const k = (it.produto ?? "").trim();
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(it);
    });
    const merged: ReposicaoItem[] = [];
    map.forEach((items) => {
      const base = items[0];
      const qtdCompra = items.reduce((s, i) => s + (i.qtdCompra ?? 0), 0);
      const estoqueReal = items.reduce((s, i) => s + (i.estoqueReal ?? 0), 0);
      const consumoDiario = items.reduce((s, i) => s + (i.consumoDiario ?? 0), 0);
      const duracaoReal = consumoDiario > 0 ? Math.round(estoqueReal / consumoDiario) : 0;
      const diasCobertura = items.reduce((max, i) => Math.max(max, i.diasCobertura ?? 0), 0);
      const necessidadeTotal = consumoDiario * diasCobertura;
      merged.push({
        produto: base.produto,
        descricao: base.descricao,
        subgrupo: base.subgrupo,
        grade: base.grade,
        colecao: base.colecao,
        linha: base.linha,
        qtdCompra,
        estoqueReal,
        duracaoReal,
        consumoDiario,
        diasCobertura,
        necessidadeTotal,
        custoUnit: base.custoUnit,
      });
    });
    // ordena por qtdCompra desc
    merged.sort((a, b) => (b.qtdCompra ?? 0) - (a.qtdCompra ?? 0));
    return merged;
  }, [reposicaoData]);

  const reposicaoExibidaComCusto = useMemo(() => {
    const base = expandirPorCor ? reposicaoComCusto : reposicaoAgrupadaPorProduto.map(item => ({
      ...item,
      custoUnit: item.custoUnit ?? 0,
      custoTotal: (item.qtdCompra ?? 0) * (item.custoUnit ?? 0),
    }));
    return base;
  }, [expandirPorCor, reposicaoComCusto, reposicaoAgrupadaPorProduto]);

  const totalCustoReposicao = reposicaoExibidaComCusto.reduce((s, i) => s + (i.custoTotal ?? 0), 0);
  const totalQtdReposicao = reposicaoExibidaComCusto.reduce((s, i) => s + (i.qtdCompra ?? 0), 0);

  // ── Aba ABC ────────────────────────────────────────────────────────────────
  const [produtosABC, setProdutosABC] = useState<ProdutoSugestao[]>([]);
  const [loadingABC, setLoadingABC] = useState(false);
  const [errorABC, setErrorABC] = useState<string | null>(null);
  const [abcLoadedKey, setAbcLoadedKey] = useState<string | null>(null);
  const [modoReposicao, setModoReposicao] = useState(true);
  const [incluirCurvaB, setIncluirCurvaB] = useState(false);
  const [incluirCurvaC, setIncluirCurvaC] = useState(false);
  const [apenasCompras, setApenasCompras] = useState(false);
  const [abcHeadStuck, setAbcHeadStuck] = useState(false);
  const abcTableCardRef = useRef<HTMLDivElement>(null);
  const abcStickySentinelRef = useRef<HTMLDivElement>(null);
  const abcStickyBarRef = useRef<HTMLDivElement>(null);
  const abcMainAbcTableRef = useRef<HTMLTableElement>(null);
  const abcStickyAbcTableRef = useRef<HTMLTableElement>(null);

  type CompraFinalItem = {
    companyKey: string;
    contextKey: string;
    itemKey: string;
    produto: string;
    corProduto?: string;
    corDescricao?: string;
    descricao: string;
    grade?: string;
    colecao?: string;
    qtdManual: number;
  };
  const [compraFinal, setCompraFinal] = useState<CompraFinalItem[]>([]);
  const [loadingFinal, setLoadingFinal] = useState(false);
  const [errorFinal, setErrorFinal] = useState<string | null>(null);

  const diasCorridosMes = useMemo(() => new Date().getDate(), []);
  const consumoDiarioMesAtual = (p: ProdutoSugestao) => {
    const vendasMes = p.vendasMesAtual ?? 0;
    if (vendasMes <= 0 || diasCorridosMes <= 0) return 0;
    return vendasMes / diasCorridosMes;
  };

  const [sugestaoSTooltip, setSugestaoSTooltip] = useState<null | {
    x: number;
    y: number;
    mediaVendasMes: number;
    mesesHistoricoFilial: number;
    estoqueAtual: number;
    limiteDias: number;
    qtdS: number;
  }>(null);

  const [historicoTooltip, setHistoricoTooltip] = useState<null | {
    x: number;
    y: number;
    primeiraEntradaFilial: string | null;
    diasHistoricoFilial: number;
    mesesHistoricoFilial: number;
  }>(null);

  const [duracaoTooltip, setDuracaoTooltip] = useState<null | {
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

  const [estoqueTooltip, setEstoqueTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    corDescricao?: string;
    filiais: Array<{ filial: string; estoque: number }>;
    total: number;
  }>(null);

  const [estoquePorFilialCache, setEstoquePorFilialCache] = useState<Record<string, Array<{ filial: string; estoque: number }>>>({});

  const [vendasTooltip, setVendasTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    corDescricao?: string;
    mode: "12m" | "60d";
    filiais: Array<{ filial: string; qtde12m: number; qtde60d: number }>;
    loading: boolean;
  }>(null);
  const [vendasPorFilialCache, setVendasPorFilialCache] = useState<Record<string, Array<{ filial: string; qtde12m: number; qtde60d: number }>>>({});
  const vendasPorFilialCacheRef = useRef(vendasPorFilialCache);
  vendasPorFilialCacheRef.current = vendasPorFilialCache;
  const destinoVendasFetchRef = useRef(new Set<string>());

  const abcFetchKey = useMemo(() => {
    const gruposKey = searchParams.getAll("grupos").slice().sort().join("|");
    const linhasKey = searchParams.getAll("linhas").slice().sort().join("|");
    const colecoesKey = searchParams.getAll("colecoes").slice().sort().join("|");
    const subgruposKey = searchParams.getAll("subgrupos").slice().sort().join("|");
    const gradesKey = searchParams.getAll("grades").slice().sort().join("|");
    const produtosKey = searchParams.getAll("produtos").slice().sort().join("|");
    return [
      companyKey,
      filial,
      categoria,
      String(qtdCompra),
      expandirPorCor ? "porcor" : "porproduto",
      `g=${gruposKey}`,
      `l=${linhasKey}`,
      `c=${colecoesKey}`,
      `s=${subgruposKey}`,
      `gr=${gradesKey}`,
      `p=${produtosKey}`,
    ].join("::");
  }, [companyKey, filial, categoria, qtdCompra, expandirPorCor, searchParams]);

  // contextKey estável para Compra Final — exclui o filtro de produto individual (p=)
  // que é temporário e não deve mudar a "sessão" de compra
  const contextKey = useMemo(() => {
    const gruposKey = searchParams.getAll("grupos").slice().sort().join("|");
    const linhasKey = searchParams.getAll("linhas").slice().sort().join("|");
    const colecoesKey = searchParams.getAll("colecoes").slice().sort().join("|");
    const subgruposKey = searchParams.getAll("subgrupos").slice().sort().join("|");
    const gradesKey = searchParams.getAll("grades").slice().sort().join("|");
    return [
      companyKey,
      filial,
      categoria,
      String(qtdCompra),
      expandirPorCor ? "porcor" : "porproduto",
      `g=${gruposKey}`,
      `l=${linhasKey}`,
      `c=${colecoesKey}`,
      `s=${subgruposKey}`,
      `gr=${gradesKey}`,
    ].join("::");
  }, [companyKey, filial, categoria, qtdCompra, expandirPorCor, searchParams]);

  useEffect(() => {
    destinoVendasFetchRef.current.clear();
  }, [companyKey, expandirPorCor, contextKey]);

  async function fetchCompraFinalList(): Promise<CompraFinalItem[]> {
    const params = new URLSearchParams();
    params.set("company", companyKey);
    params.set("contextKey", contextKey);
    const res = await fetch(`/api/controle-estoque/compra-final?${params}`, { cache: "no-store" });
    const json = await res.json() as { data?: CompraFinalItem[]; error?: string };
    if (!res.ok) throw new Error(json.error ?? "Erro ao carregar compra final");
    return json.data ?? [];
  }

  useEffect(() => {
    if (activeTab !== "final") return;
    setLoadingFinal(true);
    setErrorFinal(null);
    fetchCompraFinalList()
      .then((data) => setCompraFinal(data))
      .catch((e) => setErrorFinal(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoadingFinal(false));
  }, [activeTab, contextKey, companyKey]);

  // Vendas por filial (12m) sem filtro de filial — necessário para ratear a qtd da Compra Final entre todas as lojas.
  useEffect(() => {
    if (activeTab !== "final" || compraFinal.length === 0) return;
    const unique = new Map<string, { produto: string; cor?: string }>();
    compraFinal.forEach((it) => {
      const produto = it.produto.trim();
      const corProduto = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
      const cacheKey = `${produto}||${corProduto ?? ""}`;
      unique.set(cacheKey, { produto, cor: corProduto });
    });
    unique.forEach(({ produto, cor }, cacheKey) => {
      if (vendasPorFilialCacheRef.current[cacheKey] !== undefined) return;
      if (destinoVendasFetchRef.current.has(cacheKey)) return;
      destinoVendasFetchRef.current.add(cacheKey);
      const params = new URLSearchParams();
      params.set("company", companyKey);
      params.set("produto", produto);
      if (cor) params.set("corProduto", cor);
      void fetchVendasPorFilialItem(params)
        .then((data) => {
          const norm = normalizeVendasPorFilialParaExibicao(companyKey, data);
          setVendasPorFilialCache((p) => ({ ...p, [cacheKey]: norm }));
        })
        .catch(() => setVendasPorFilialCache((p) => ({ ...p, [cacheKey]: [] })));
    });
  }, [activeTab, compraFinal, expandirPorCor, companyKey]);

  const compraFinalMap = useMemo(() => {
    return new Map(compraFinal.map((i) => [i.itemKey, i]));
  }, [compraFinal]);

  const itemKeyFromProduto = (produto: string, corProduto?: string) => `${produto.trim()}||${(corProduto ?? "").trim()}`;

  const handleAddCompraFinal = async (p: ProdutoComCurva) => {
    const produto = (p.produto ?? "").trim();
    const corProduto = expandirPorCor ? ((p.cor ?? "").trim() || undefined) : undefined;
    const itemKey = itemKeyFromProduto(produto, corProduto);
    const payload: CompraFinalItem = {
      companyKey,
      contextKey,
      itemKey,
      produto,
      corProduto,
      corDescricao: expandirPorCor ? p.corDescricao : undefined,
      descricao: p.descricao || produto,
      grade: p.grade,
      colecao: p.colecao,
      qtdManual: Math.max(0, Math.round(p.qtdFinal > 0 ? p.qtdFinal : temSugestaoS(p) ? calcQtdS(p) : 0)),
    };
    await fetch(`/api/controle-estoque/compra-final`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const next = await fetchCompraFinalList();
    setCompraFinal(next);
  };

  const handleUpdateQtdFinal = async (itemKey: string, qtdManual: number) => {
    await fetch(`/api/controle-estoque/compra-final`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyKey, contextKey, itemKey, qtdManual }),
    });
    setCompraFinal((prev) => prev.map((i) => (i.itemKey === itemKey ? { ...i, qtdManual } : i)));
  };

  const handleRemoveFinal = async (itemKey: string) => {
    const params = new URLSearchParams();
    params.set("company", companyKey);
    params.set("contextKey", contextKey);
    params.set("itemKey", itemKey);
    await fetch(`/api/controle-estoque/compra-final?${params}`, { method: "DELETE" });
    setCompraFinal((prev) => prev.filter((i) => i.itemKey !== itemKey));
  };

  const handleSalvarCompraAtual = async () => {
    if (compraFinal.length === 0) return;
    setSavingCompraSalva(true);
    try {
      const title = `Compra ${new Date().toLocaleDateString("pt-BR")}`;
      const res = await fetch("/api/controle-estoque/compras-salvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyKey,
          sourceContextKey: contextKey,
          title,
          expandirPorCor,
          items: compraFinalRows.map(({ it, custoUnit }) => ({
            itemKey: it.itemKey,
            produto: it.produto,
            corProduto: it.corProduto,
            corDescricao: it.corDescricao,
            descricao: it.descricao,
            grade: it.grade,
            colecao: it.colecao,
            qtdManual: it.qtdManual,
            custoUnitario: custoUnit > 0 ? custoUnit : undefined,
          })),
        }),
      });
      const json = await res.json() as { data?: { id?: string }; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Erro ao salvar");
      const newId = json.data?.id;
      if (newId) {
        router.push(`/${companySlug}/controle-estoque/projecao/lista-compra/compras-salvas/${newId}`);
      }
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao salvar compra");
    } finally {
      setSavingCompraSalva(false);
    }
  };

  const handleExportCompraFinalXlsx = () => {
    const rows = compraFinalRows.map(({ it, estoque, custoUnit, custoTotal }) => {
      const produto = it.produto.trim();
      const corProduto = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
      const cacheKey = `${produto}||${corProduto ?? ""}`;
      const vendasRows = vendasPorFilialCache[cacheKey];
      const destino =
        vendasRows !== undefined
          ? textoDestinoCompraFinal(it.qtdManual ?? 0, vendasRows, companyKey)
          : "";
      return {
        PRODUTO: it.produto,
        DESC_PRODUTO: it.descricao,
        COR_PRODUTO: it.corProduto ?? "",
        DESC_COR_PRODUTO: it.corDescricao ?? "",
        GRADE: it.grade ?? "",
        COLECAO: it.colecao ?? "",
        QTD_MANUAL: it.qtdManual ?? 0,
        DESTINO: destino,
        ESTOQUE_ATUAL: estoque ?? 0,
        CUSTO_UNIT: custoUnit ?? 0,
        CUSTO_TOTAL: custoTotal ?? 0,
      };
    });

    const kpis = [
      { METRICA: "Empresa", VALOR: companyKey },
      { METRICA: "Categoria", VALOR: categoria || "" },
      { METRICA: "Filial (filtro)", VALOR: filial || "" },
      { METRICA: "ContextKey", VALOR: contextKey },
      { METRICA: "Itens", VALOR: compraFinalTotals.totalItens },
      { METRICA: "Total Qtd Manual", VALOR: compraFinalTotals.totalQtdManual },
      { METRICA: "Custo Total", VALOR: compraFinalTotals.totalCusto },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpis), "KPIs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Compra Final");

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `compra-final-${companyKey}-${dateStr}.xlsx`;
    XLSX.writeFile(wb, filename);
  };

  const handleExportCompraFinalPdf = async () => {
    if (!compraFinalExportRef.current || compraFinal.length === 0) return;

    setExportingPdf(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const target = compraFinalExportRef.current;
      const canvas = await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight,
      });

      const pageWidthMm = 210;
      const pageHeightMm = (canvas.height * pageWidthMm) / canvas.width;
      const maxSinglePageHeightMm = 5000;

      if (pageHeightMm <= maxSinglePageHeightMm) {
        const pdf = new jsPDF({
          orientation: "portrait",
          unit: "mm",
          format: [pageWidthMm, pageHeightMm],
        });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidthMm, pageHeightMm, undefined, "FAST");
        const dateStr = new Date().toISOString().slice(0, 10);
        pdf.save(`compra-final-${companyKey}-${dateStr}.pdf`);
        return;
      }

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const pageHeightPx = Math.floor((canvas.width * pageHeight) / pageWidth);
      let renderedHeightPx = 0;
      let pageIndex = 0;

      while (renderedHeightPx < canvas.height) {
        const remainingHeightPx = canvas.height - renderedHeightPx;
        const sliceHeightPx = Math.min(pageHeightPx, remainingHeightPx);
        const pageCanvas = document.createElement("canvas");
        pageCanvas.width = canvas.width;
        pageCanvas.height = sliceHeightPx;
        const ctx = pageCanvas.getContext("2d");
        if (!ctx) break;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
        ctx.drawImage(canvas, 0, renderedHeightPx, canvas.width, sliceHeightPx, 0, 0, pageCanvas.width, pageCanvas.height);
        const imgHeight = (sliceHeightPx * imgWidth) / canvas.width;
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(pageCanvas.toDataURL("image/png"), "PNG", 0, 0, imgWidth, imgHeight, undefined, "FAST");

        renderedHeightPx += sliceHeightPx;
        pageIndex += 1;
      }

      const dateStr = new Date().toISOString().slice(0, 10);
      pdf.save(`compra-final-${companyKey}-${dateStr}.pdf`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  useEffect(() => {
    if (activeTab !== "abc" || abcLoadedKey === abcFetchKey) return;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    if (filial) params.set("filial", filial);
    if (categoria) params.set("categoria", categoria);
    params.set("qtdCompra", String(qtdCompra));
    params.set("limit", "2000");
    if (expandirPorCor) params.set("porCor", "1");
    searchParams.getAll("grupos").forEach((g) => params.append("grupos", g));
    searchParams.getAll("linhas").forEach((l) => params.append("linhas", l));
    searchParams.getAll("colecoes").forEach((c) => params.append("colecoes", c));
    searchParams.getAll("subgrupos").forEach((s) => params.append("subgrupos", s));
    searchParams.getAll("grades").forEach((g) => params.append("grades", g));
    searchParams.getAll("produtos").forEach((p) => params.append("produtos", p));

    setLoadingABC(true);
    setErrorABC(null);
    fetchListaCompra(params)
      .then(data => { setProdutosABC(data); setAbcLoadedKey(abcFetchKey); })
      .catch((e) => setErrorABC(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoadingABC(false));
  }, [activeTab, abcLoadedKey, abcFetchKey, companyKey, searchParams, categoria, qtdCompra, filial, expandirPorCor]);

  const produtosComCurva = useMemo(
    () => (produtosABC.length > 0 ? calcularCurvas(produtosABC, qtdCompra) : []),
    [produtosABC, qtdCompra]
  );
  const hasHistoricoParcialABC = produtosComCurva.some((p) => p.historicoParcial);

  // Modo Reposição Real: calcula qtd individualmente por produto (meta DIAS_META dias de cobertura)
  const produtosComCurvaFinal = useMemo((): ProdutoComCurva[] => {
    if (!modoReposicao) return produtosComCurva;
    return produtosComCurva.map(p => {
      const curvaAtiva =
        p.curva === "A" ||
        (p.curva === "B" && incluirCurvaB) ||
        (p.curva === "C" && incluirCurvaC);
      if (!curvaAtiva) return { ...p, qtdFinal: 0, qtdSuficiente: false };
      const consumoDiario = consumoDiarioMesAtual(p);
      if (consumoDiario <= 0) return { ...p, qtdFinal: 0, qtdSuficiente: false };
      const { limiteDias } = getLimiteDiasReposicao(p);
      const estoqueAtual = p.estoqueAtual ?? 0;
      const duracaoAtual = estoqueAtual / consumoDiario;
      if (duracaoAtual >= limiteDias) return { ...p, qtdFinal: 0, qtdSuficiente: true };
      const qtd = Math.ceil(consumoDiario * (limiteDias - duracaoAtual));
      return { ...p, qtdFinal: qtd, qtdSuficiente: false };
    });
  }, [produtosComCurva, modoReposicao, incluirCurvaB, incluirCurvaC, diasCorridosMes]);

  const temSugestaoS = (p: ProdutoComCurva) => {
    if (p.qtdFinal > 0 || p.qtdSuficiente) return false;
    const mediaVendasMes = p.vendas3meses / getMesesHistoricoFilial(p);
    // Dispara S se vende ≥ 2/mês em média e tem < 2 meses de cobertura de estoque
    return mediaVendasMes >= 2 && (p.estoqueAtual ?? 0) <= mediaVendasMes * 2;
  };

  const calcQtdS = (p: ProdutoComCurva) => {
    const mediaVendasMes = p.vendas3meses / getMesesHistoricoFilial(p);
    const { limiteDias } = getLimiteDiasReposicao(p);
    return Math.ceil((limiteDias / 30) * mediaVendasMes);
  };

  const totalCustoABC = produtosComCurvaFinal.reduce((s, p) => {
    const cu = p.custoUnitario ?? 0;
    if (cu <= 0) return s;
    if (p.qtdFinal > 0) return s + p.qtdFinal * cu;
    if (temSugestaoS(p)) return s + calcQtdS(p) * cu;
    return s;
  }, 0);
  const totalQtdABC = produtosComCurvaFinal.reduce((s, p) => {
    if (p.qtdFinal > 0) return s + p.qtdFinal;
    if (temSugestaoS(p)) return s + calcQtdS(p);
    return s;
  }, 0);

  const produtosTabelaABC = useMemo(
    () => (apenasCompras ? produtosComCurvaFinal.filter((p) => p.qtdFinal > 0 || temSugestaoS(p)) : produtosComCurvaFinal),
    [apenasCompras, produtosComCurvaFinal]
  );

  const compraFinalRows = useMemo(() => {
    return compraFinal.map((it) => {
      const produto = it.produto.trim();
      const corProduto = (it.corProduto ?? "").trim();
      const match = produtosComCurvaFinal.find((p) => {
        const pProd = (p.produto ?? "").trim();
        const pCor = (p.cor ?? "").trim();
        return pProd === produto && (expandirPorCor ? pCor === corProduto : true);
      });
      const qtdSugerida = match?.qtdFinal ?? 0;
      const estoque = match?.estoqueAtual ?? null;
      const custoUnit = match?.custoUnitario ?? 0;
      const custoTotal = custoUnit > 0 ? Math.round(it.qtdManual * custoUnit) : 0;
      return { it, match, qtdSugerida, estoque, custoUnit, custoTotal };
    });
  }, [compraFinal, produtosComCurvaFinal, expandirPorCor]);

  const compraFinalTotals = useMemo(() => {
    const totalItens = compraFinal.length;
    const totalQtdManual = compraFinal.reduce((s, i) => s + (i.qtdManual ?? 0), 0);
    const totalCusto = compraFinalRows.reduce((s, r) => s + (r.custoTotal ?? 0), 0);
    return { totalItens, totalQtdManual, totalCusto };
  }, [compraFinal, compraFinalRows]);
  const maxPerc = produtosComCurva.length > 0 ? produtosComCurva[0].percParticipacao : 1;
  const countA = produtosComCurva.filter(p => p.curva === "A").length;
  const countB = produtosComCurva.filter(p => p.curva === "B").length;
  const countC = produtosComCurva.filter(p => p.curva === "C").length;
  const groups: Curva[] = ["A", "B", "C"];

  const abcStickyStateRef = useRef(false);
  useEffect(() => {
    if (activeTab !== "abc" || loadingABC || errorABC || produtosComCurva.length === 0) {
      abcStickyStateRef.current = false;
      setAbcHeadStuck(false);
      return;
    }

    let raf = 0;
    const tick = () => {
      const sent = abcStickySentinelRef.current;
      const card = abcTableCardRef.current;
      const bar = abcStickyBarRef.current;
      if (!sent) return;
      const sr = sent.getBoundingClientRect();
      const stuck = sr.bottom <= USER_STICKY_HEADER_PX + 0.5;
      if (abcStickyStateRef.current !== stuck) {
        abcStickyStateRef.current = stuck;
        setAbcHeadStuck(stuck);
      }
      if (stuck && card && bar) {
        const cr = card.getBoundingClientRect();
        bar.style.left = `${cr.left}px`;
        bar.style.width = `${cr.width}px`;
        syncAbcStickyHeaderColumns(abcMainAbcTableRef.current, abcStickyAbcTableRef.current);
      }
    };

    const onScrollOrResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };

    tick();
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    const card = abcTableCardRef.current;
    const ro = card && typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScrollOrResize) : null;
    if (ro && card) ro.observe(card);
    const t = window.setTimeout(tick, 400);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
      ro?.disconnect();
      window.clearTimeout(t);
    };
  }, [activeTab, loadingABC, errorABC, produtosComCurva.length, abcFetchKey, sidebarOpen]);

  useLayoutEffect(() => {
    if (!abcHeadStuck || activeTab !== "abc") return;
    const card = abcTableCardRef.current;
    const bar = abcStickyBarRef.current;
    if (!card || !bar) return;
    const cr = card.getBoundingClientRect();
    bar.style.left = `${cr.left}px`;
    bar.style.width = `${cr.width}px`;
    syncAbcStickyHeaderColumns(abcMainAbcTableRef.current, abcStickyAbcTableRef.current);
    const id = requestAnimationFrame(() => {
      const c2 = abcTableCardRef.current;
      const b2 = abcStickyBarRef.current;
      if (c2 && b2) {
        const r = c2.getBoundingClientRect();
        b2.style.left = `${r.left}px`;
        b2.style.width = `${r.width}px`;
      }
      syncAbcStickyHeaderColumns(abcMainAbcTableRef.current, abcStickyAbcTableRef.current);
    });
    return () => cancelAnimationFrame(id);
  }, [
    abcHeadStuck,
    activeTab,
    modoReposicao,
    apenasCompras,
    expandirPorCor,
    produtosTabelaABC.length,
    abcFetchKey,
  ]);

  // ── Navegação de volta ─────────────────────────────────────────────────────
  const handleVoltar = () => {
    const projecaoParams = new URLSearchParams();
    if (filial) projecaoParams.set("filial", filial);
    searchParams.getAll("grupos").forEach((g) => projecaoParams.append("grupos", g));
    searchParams.getAll("linhas").forEach((l) => projecaoParams.append("linhas", l));
    searchParams.getAll("colecoes").forEach((c) => projecaoParams.append("colecoes", c));
    searchParams.getAll("subgrupos").forEach((s) => projecaoParams.append("subgrupos", s));
    searchParams.getAll("grades").forEach((g) => projecaoParams.append("grades", g));
    const expansao = searchParams.get("expansao");
    if (expansao) projecaoParams.set("expansao", expansao);
    router.push(`/${companyKey}/controle-estoque/projecao?${projecaoParams.toString()}`);
  };

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrapper}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <path d="M16 10a4 4 0 01-8 0" />
              </svg>
            </div>
            <div>
              <h1 className={styles.title}>Lista de Compra Sugerida</h1>
              <p className={styles.subtitle}>
                {categoria ? `Categoria: ${categoria} · ` : ""}
                Reposição baseada na performance real individual de cada produto
              </p>
            </div>
          </div>
          <button type="button" className={styles.backButton} onClick={handleVoltar}>
            ← Voltar
          </button>
        </div>

        {/* Tabs */}
        <div className={styles.tabBar}>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "reposicao" ? styles.tabActive : ""}`}
            onClick={() => selectTab("reposicao")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
            </svg>
            Reposição Necessária
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "abc" ? styles.tabActive : ""}`}
            onClick={() => selectTab("abc")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Análise ABC
            <span className={styles.tabBadgeInfo}>visual</span>
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "final" ? styles.tabActive : ""}`}
            onClick={() => selectTab("final")}
          >
            Compra Final
            <span className={styles.tabBadgeInfo}>{compraFinal.length}</span>
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "compras-salvas" ? styles.tabActive : ""}`}
            onClick={() => selectTab("compras-salvas")}
          >
            Compras salvas
          </button>
        </div>
      </div>

      {/* ── ABA REPOSIÇÃO ─────────────────────────────────────────────────── */}
      {activeTab === "reposicao" && (
        <>
          {/* Banner de projeção simulada */}
          {reposicaoData?.isProjecaoSimulada && (
            <div className={styles.projecaoSimuladaBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
              </svg>
              <span>
                <strong>PROJEÇÃO SIMULADA</strong> — Compra futura projetada com base em vendas do ano passado + 10%.
                {reposicaoData.mesCompra && <> Compra prevista para <strong>{reposicaoData.mesCompra}</strong>.</>}
                {" "}Os itens abaixo são sugestões para planejamento e não refletem necessidade real imediata.
              </span>
            </div>
          )}

          {/* Summary */}
          {reposicaoData && (
            <div className={styles.summaryCard}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Total a Comprar</span>
                <span className={styles.summaryValue}>{fmt(totalQtdReposicao)}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Custo Total</span>
                <span className={styles.summaryValue}>{fmtBRL(totalCustoReposicao)}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Produtos em Reposição</span>
                <span className={styles.summaryValueNeutral}>
                  {expandirPorCor ? reposicaoData.itens.length : reposicaoAgrupadaPorProduto.length}
                </span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Base do Cálculo</span>
                <span className={styles.summaryValueNeutral} style={{ fontSize: 14 }}>
                  {reposicaoData.isProjecaoSimulada ? "Vendas ano passado + 10%" : "Estoque e duração reais"}
                </span>
              </div>
            </div>
          )}

          {/* Table */}
          <div className={styles.tableCard}>
            {!reposicaoData && (
              <div className={styles.empty}>
                <div style={{ marginBottom: 8, fontSize: 32 }}>📋</div>
                <div>Nenhum dado de reposição disponível.</div>
                <div style={{ marginTop: 4, fontSize: 13, color: "#94a3b8" }}>
                  Clique em uma quantidade de compra na projeção de estoque para ver aqui.
                </div>
              </div>
            )}
            {reposicaoData && reposicaoData.itens.length === 0 && (
              <div className={styles.empty}>Nenhum produto precisa de reposição neste escopo.</div>
            )}
            {reposicaoData && reposicaoData.itens.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 40 }}>#</th>
                    <th>Produto</th>
                    <th className={styles.right}>Estoque Atual</th>
                    <th className={styles.right}>Duração Atual</th>
                    <th className={styles.right}>Consumo/dia</th>
                    <th className={styles.right}>Qtd a Repor</th>
                    <th className={styles.right}>Custo Unit.</th>
                    <th className={styles.right}>Custo Total</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Cabeçalho de seção */}
                  <tr className={styles.sectionRowReposicao}>
                    <td colSpan={8}>
                      <div className={styles.sectionLabel}>
                        <span className={`${styles.curvaBadge} ${styles.badgeReposicao}`}>↑</span>
                        <span className={styles.sectionTitle}>Produtos com estoque abaixo do limite — reposição individual</span>
                        <span className={styles.sectionCount}>
                          {expandirPorCor ? reposicaoData.itens.length : reposicaoAgrupadaPorProduto.length} item(ns)
                        </span>
                      </div>
                    </td>
                  </tr>
                  {reposicaoExibidaComCusto.map((item, i) => (
                    <tr key={`${item.produto}-${expandirPorCor ? (item.cor ?? "") : ""}-${i}`}>
                      <td>
                        <span className={`${styles.rank} ${i < 3 ? styles.top : ""}`}>{i + 1}</span>
                      </td>
                      <td>
                        <div className={styles.productName}>{item.descricao || item.produto}</div>
                        <div className={styles.productCode}>{item.produto}</div>
                        {expandirPorCor && item.cor && <div className={styles.productCode}>{item.cor}</div>}
                        {item.grade && <div className={styles.productCode}>Grade: {item.grade}</div>}
                        {item.colecao && <div className={styles.productCode}>Coleção: {item.colecao}</div>}
                      </td>
                      <td className={styles.vendas}>{fmt(item.estoqueReal)}</td>
                      <td>
                        <span className={styles.duracaoBadge}>{item.duracaoReal} dias</span>
                      </td>
                      <td className={styles.vendas}>{item.consumoDiario.toFixed(1)}/dia</td>
                      <td className={styles.qtdSugerida}>{fmt(item.qtdCompra)}</td>
                      <td className={`${styles.right} ${item.custoUnit > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                        {item.custoUnit > 0 ? fmtBRL2(item.custoUnit) : "—"}
                      </td>
                      <td className={`${styles.right} ${item.custoTotal > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                        {item.custoTotal > 0 ? fmtBRL(item.custoTotal) : "—"}
                      </td>
                    </tr>
                  ))}
                  {/* Linha de total */}
                  {reposicaoExibidaComCusto.length > 1 && (
                    <tr className={styles.totalRow}>
                      <td colSpan={5} style={{ textAlign: "right", fontWeight: 700, color: "#374151" }}>TOTAL</td>
                      <td className={styles.qtdSugerida}>{fmt(totalQtdReposicao)}</td>
                      <td />
                      <td className={`${styles.right} ${styles.qtdSugerida}`}>
                        {fmtBRL(totalCustoReposicao)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ── ABA ABC ───────────────────────────────────────────────────────── */}
      {activeTab === "abc" && (
        <>
          {!modoReposicao && (
            <div className={styles.abcInfoBanner}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 2 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>
                Esta análise é <strong>apenas informativa</strong> — mostra a performance dos produtos por curva ABC.
                A sugestão de compra real está na aba <strong>Reposição Necessária</strong>, calculada individualmente por produto.
                Ative o toggle abaixo para calcular sugestões por reposição real.
              </span>
            </div>
          )}

          {/* ── Toggle de Modo ── */}
          <div className={styles.modoBar}>
            <div
              role="switch"
              aria-checked={modoReposicao}
              tabIndex={0}
              className={styles.toggleWrap}
              onClick={() => {
                if (modoReposicao) {
                  setModoReposicao(false);
                  setIncluirCurvaB(false);
                  setIncluirCurvaC(false);
                } else {
                  setModoReposicao(true);
                }
              }}
              onKeyDown={e => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  if (modoReposicao) {
                    setModoReposicao(false);
                    setIncluirCurvaB(false);
                    setIncluirCurvaC(false);
                  } else {
                    setModoReposicao(true);
                  }
                }
              }}
            >
              <div className={`${styles.toggleTrack} ${modoReposicao ? styles.toggleTrackOn : ""}`}>
                <div className={`${styles.toggleThumb} ${modoReposicao ? styles.toggleThumbOn : ""}`} />
              </div>
              <span className={styles.toggleLabelText}>Reposição Real</span>
            </div>

            <div className={styles.toggleDivider} />

            <div
              role="switch"
              aria-checked={expandirPorCor}
              tabIndex={0}
              className={`${styles.toggleWrap} ${styles.toggleWrapSecondary}`}
              onClick={() => setExpandirPorCor(v => !v)}
              onKeyDown={e => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setExpandirPorCor(v => !v);
                }
              }}
              title="Alterna entre produto agrupado e produto+cor"
            >
              <div className={`${styles.toggleTrack} ${expandirPorCor ? styles.toggleTrackOn : ""}`}>
                <div className={`${styles.toggleThumb} ${expandirPorCor ? styles.toggleThumbOn : ""}`} />
              </div>
              <span className={styles.toggleLabelText}>Por Cor</span>
            </div>

            <div className={styles.toggleDivider} />

            <div
              role="switch"
              aria-checked={apenasCompras}
              tabIndex={0}
              className={`${styles.toggleWrap} ${styles.toggleWrapSecondary}`}
              onClick={() => setApenasCompras(v => !v)}
              onKeyDown={e => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  setApenasCompras(v => !v);
                }
              }}
              title="Mostra apenas itens indicados para compra"
            >
              <div className={`${styles.toggleTrack} ${apenasCompras ? styles.toggleTrackOn : ""}`}>
                <div className={`${styles.toggleThumb} ${apenasCompras ? styles.toggleThumbOn : ""}`} />
              </div>
              <span className={styles.toggleLabelText}>Apenas Compras</span>
            </div>

            {modoReposicao ? (
              <>
                <div className={styles.toggleDivider} />
                <span className={styles.toggleIncluirLabel}>Incluir sugestões:</span>
                <label className={`${styles.curvaCheckboxLabel} ${styles.checkboxLabelB}`}>
                  <input
                    type="checkbox"
                    checked={incluirCurvaB}
                    onChange={e => setIncluirCurvaB(e.target.checked)}
                  />
                  Curva B
                </label>
                <label className={`${styles.curvaCheckboxLabel} ${styles.checkboxLabelC}`}>
                  <input
                    type="checkbox"
                    checked={incluirCurvaC}
                    onChange={e => setIncluirCurvaC(e.target.checked)}
                  />
                  Curva C
                </label>
                <div className={styles.toggleDivider} />
                <span className={styles.modoMetaTag}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4 }}>
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  Meta: por item (60/90/120 dias)
                </span>
              </>
            ) : (
              <span className={styles.modoDescTag}>Distribuição proporcional pela qtd de referência</span>
            )}
          </div>

          {/* Summary ABC */}
          {!loadingABC && !errorABC && produtosComCurva.length > 0 && (
            <div className={styles.summaryCard}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>{modoReposicao ? "Total Calculado" : "QTD Referência"}</span>
                <span className={styles.summaryValue}>{modoReposicao ? fmt(totalQtdABC) : fmt(qtdCompra)}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>{modoReposicao ? "Custo Total" : "Custo (Curva A)"}</span>
                <span className={styles.summaryValue}>{totalCustoABC > 0 ? fmtBRL(totalCustoABC) : "—"}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>{modoReposicao ? "Cobertura Meta" : "Período Base"}</span>
                <span className={styles.summaryValueNeutral} style={{ fontSize: 14 }}>
                  {modoReposicao ? "Por item (60/90/120 dias)" : hasHistoricoParcialABC ? "Historico real por item" : "Últimos 12 meses"}
                </span>
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
            </div>
          )}

          {/* Table ABC */}
          <div ref={abcTableCardRef} className={`${styles.tableCard} ${styles.tableCardAbc}`}>
            {loadingABC && <div className={styles.loading}>Carregando análise ABC...</div>}
            {errorABC && <div className={styles.error}>{errorABC}</div>}
            {!loadingABC && !errorABC && produtosComCurva.length === 0 && (
              <div className={styles.empty}>Nenhum produto encontrado para este filtro.</div>
            )}
            {!loadingABC && !errorABC && produtosComCurva.length > 0 && (
              <>
                {abcHeadStuck && (
                  <div
                    ref={abcStickyBarRef}
                    className={styles.abcStickyHeaderBar}
                    style={{ top: USER_STICKY_HEADER_PX }}
                  >
                    <table
                      ref={abcStickyAbcTableRef}
                      className={`${styles.table} ${styles.tableAbc} ${styles.abcStickyHeaderTable}`}
                    >
                      <AbcAnalysisTableHead modoReposicao={modoReposicao} />
                    </table>
                  </div>
                )}
                <div ref={abcStickySentinelRef} className={styles.abcStickySentinel} aria-hidden />
                <table ref={abcMainAbcTableRef} className={`${styles.table} ${styles.tableAbc}`}>
                  <AbcAnalysisTableHead modoReposicao={modoReposicao} />
                <tbody>
                  {groups.map(curva => {
                    const grupo = produtosTabelaABC.filter(p => p.curva === curva);
                    if (grupo.length === 0) return null;
                    const curvaAtivaModo =
                      curva === "A" ||
                      (curva === "B" && modoReposicao && incluirCurvaB) ||
                      (curva === "C" && modoReposicao && incluirCurvaC);
                    return (
                      <React.Fragment key={curva}>
                        <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                          <td colSpan={11}>
                            <div className={styles.sectionLabel}>
                              <span className={`${styles.curvaBadge} ${CURVA_BADGE_CLASS[curva]}`}>{curva}</span>
                              <span className={styles.sectionTitle}>{CURVA_LABEL[curva]}</span>
                              <span className={styles.sectionCount}>{grupo.length} produtos</span>
                              {curva === "A" && (
                                <span className={styles.sectionNote}>
                                  {modoReposicao ? "← meta por item (60/90/120)" : "← referência proporcional"}
                                </span>
                              )}
                              {modoReposicao && curva !== "A" && curvaAtivaModo && (
                                <span className={styles.sectionNoteIncluida}>← incluída na sugestão</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {grupo.map((p, i) => {
                          const keyOf = (x: ProdutoComCurva) => `${x.produto}||${x.cor ?? ""}`;
                          const rankGlobal = produtosTabelaABC.findIndex(fp => keyOf(fp) === keyOf(p)) + 1;
                          const isDimmed = !curvaAtivaModo;
                          const addKey = itemKeyFromProduto((p.produto ?? "").trim(), expandirPorCor ? ((p.cor ?? "").trim() || undefined) : undefined);
                          const isAdded = compraFinalMap.has(addKey);
                          return (
                            <tr key={`${p.produto}-${p.cor ?? ""}`} className={isDimmed ? styles.rowDimmed : ""}>
                              <td>
                                <span className={`${styles.rank} ${i < 3 && curva === "A" ? styles.top : ""}`}>
                                  {rankGlobal}
                                </span>
                              </td>
                              <td>
                                <div className={styles.productName}>
                                  {p.descricao || p.produto}
                                  <button
                                    type="button"
                                    className={`${styles.addBtn} ${isAdded ? styles.addBtnActive : ""}`}
                                    onClick={() => { void handleAddCompraFinal(p); }}
                                    title="Adicionar na Compra Final"
                                  >
                                    +
                                  </button>
                                </div>
                                <div className={styles.productCode}>{p.produto}</div>
                                {expandirPorCor && (p.corDescricao ?? "").trim() !== "" && (
                                  <div className={styles.productCode}>{p.corDescricao}</div>
                                )}
                                {p.grade && <div className={styles.productCode}>Grade: {p.grade}</div>}
                                {p.colecao && <div className={styles.productCode}>Coleção: {p.colecao}</div>}
                              </td>
                              <td className={styles.vendas}>{fmtBRL(p.valor3meses)}</td>
                              <td
                                className={`${styles.vendas} ${styles.tooltipCell}`}
                                onMouseEnter={(e) => {
                                  const produto = (p.produto ?? '').trim();
                                  const corProduto = expandirPorCor ? ((p.cor ?? '').trim() || null) : null;
                                  const cacheKey = `${produto}||${corProduto ?? ''}`;
                                  const cached = vendasPorFilialCache[cacheKey];
                                  if (cached) {
                                    setVendasTooltip({ x: e.clientX, y: e.clientY, produto, corDescricao: expandirPorCor ? p.corDescricao : undefined, mode: "12m", filiais: cached, loading: false });
                                    return;
                                  }
                                  setVendasTooltip({ x: e.clientX, y: e.clientY, produto, corDescricao: expandirPorCor ? p.corDescricao : undefined, mode: "12m", filiais: [], loading: true });
                                  const params = new URLSearchParams();
                                  params.set("company", companyKey);
                                  if (filial) params.set("filial", filial);
                                  params.set("produto", produto);
                                  if (corProduto) params.set("corProduto", corProduto);
                                  fetchVendasPorFilialItem(params)
                                    .then((data) => {
                                      const norm = normalizeVendasPorFilialParaExibicao(companyKey, data);
                                      setVendasPorFilialCache((prev) => ({ ...prev, [cacheKey]: norm }));
                                      setVendasTooltip((prev) => prev ? { ...prev, filiais: norm, loading: false } : null);
                                    })
                                    .catch(() => setVendasTooltip((prev) => prev ? { ...prev, loading: false } : null));
                                }}
                                onMouseLeave={() => setVendasTooltip(null)}
                              >
                                {fmt(p.vendas3meses)}
                                {p.historicoParcial ? (
                                  <span
                                    className={styles.partialHistoryBadge}
                                    onMouseEnter={(e) =>
                                      setHistoricoTooltip({
                                        x: e.clientX,
                                        y: e.clientY,
                                        primeiraEntradaFilial: p.primeiraEntradaFilial ?? null,
                                        diasHistoricoFilial: Number(p.diasHistoricoFilial ?? 365),
                                        mesesHistoricoFilial: getMesesHistoricoFilial(p),
                                      })
                                    }
                                    onMouseLeave={() => setHistoricoTooltip(null)}
                                  >
                                    (&lt;12m)
                                  </span>
                                ) : null}
                              </td>
                              <td
                                className={styles.right}
                                onMouseEnter={(e) => {
                                  if (p.estoqueAtual == null) return;
                                  const produto = (p.produto ?? '').trim();
                                  const corProduto = expandirPorCor ? ((p.cor ?? '').trim() || null) : null;
                                  const cacheKey = `${produto}||${corProduto ?? ''}`;
                                  const cached = estoquePorFilialCache[cacheKey];
                                  const show = (filiais: Array<{ filial: string; estoque: number }>) => {
                                    const filiaisVisiveis = filterEstoqueTooltipFiliais(filiais);
                                    const total = filiaisVisiveis.reduce((s, f) => s + Math.max(0, f.estoque ?? 0), 0);
                                    setEstoqueTooltip({
                                      x: e.clientX,
                                      y: e.clientY,
                                      produto,
                                      corDescricao: expandirPorCor ? p.corDescricao : undefined,
                                      filiais: filiaisVisiveis,
                                      total,
                                    });
                                  };
                                  if (cached) {
                                    show(cached);
                                    return;
                                  }
                                  const params = new URLSearchParams();
                                  params.set("company", companyKey);
                                  if (filial) params.set("filial", filial);
                                  params.set("produto", produto);
                                  if (corProduto) params.set("corProduto", corProduto);
                                  fetchEstoquePorFilial(params)
                                    .then((data) => {
                                      setEstoquePorFilialCache((prev) => ({ ...prev, [cacheKey]: data }));
                                      show(data);
                                    })
                                    .catch(() => {
                                      show([]);
                                    });
                                }}
                                onMouseLeave={() => setEstoqueTooltip(null)}
                              >
                                {p.estoqueAtual != null ? fmt(p.estoqueAtual) : "—"}
                              </td>
                              <td
                                className={`${styles.vendas} ${styles.tooltipCell}`}
                                onMouseEnter={(e) => {
                                  const produto = (p.produto ?? '').trim();
                                  const corProduto = expandirPorCor ? ((p.cor ?? '').trim() || null) : null;
                                  const cacheKey = `${produto}||${corProduto ?? ''}`;
                                  const cached = vendasPorFilialCache[cacheKey];
                                  if (cached) {
                                    setVendasTooltip({ x: e.clientX, y: e.clientY, produto, corDescricao: expandirPorCor ? p.corDescricao : undefined, mode: "60d", filiais: cached, loading: false });
                                    return;
                                  }
                                  setVendasTooltip({ x: e.clientX, y: e.clientY, produto, corDescricao: expandirPorCor ? p.corDescricao : undefined, mode: "60d", filiais: [], loading: true });
                                  const params = new URLSearchParams();
                                  params.set("company", companyKey);
                                  if (filial) params.set("filial", filial);
                                  params.set("produto", produto);
                                  if (corProduto) params.set("corProduto", corProduto);
                                  fetchVendasPorFilialItem(params)
                                    .then((data) => {
                                      const norm = normalizeVendasPorFilialParaExibicao(companyKey, data);
                                      setVendasPorFilialCache((prev) => ({ ...prev, [cacheKey]: norm }));
                                      setVendasTooltip((prev) => prev ? { ...prev, filiais: norm, loading: false } : null);
                                    })
                                    .catch(() => setVendasTooltip((prev) => prev ? { ...prev, loading: false } : null));
                                }}
                                onMouseLeave={() => setVendasTooltip(null)}
                              >{fmt(p.vendas60dias ?? 0)}</td>
                              <td
                                className={styles.right}
                                onMouseEnter={(e) => {
                                  const { limiteDias, regra } = getLimiteDiasReposicao(p);
                                  const vendasMesAtual = p.vendasMesAtual ?? 0;
                                  const diasCorridos = diasCorridosMes;
                                  const consumoDiario = consumoDiarioMesAtual(p);
                                  const estoqueAtual = p.estoqueAtual ?? 0;
                                  const duracaoDias = consumoDiario > 0 ? Math.round(estoqueAtual / consumoDiario) : 0;
                                  setDuracaoTooltip({
                                    x: e.clientX,
                                    y: e.clientY,
                                    regra,
                                    limiteDias,
                                    vendasMesAtual,
                                    diasCorridos,
                                    consumoDiario,
                                    estoqueAtual,
                                    duracaoDias,
                                  });
                                }}
                                onMouseLeave={() => setDuracaoTooltip(null)}
                              >
                                {(() => {
                                  const consumoDiario = consumoDiarioMesAtual(p);
                                  if (consumoDiario <= 0 || !p.estoqueAtual) return "—";
                                  const dias = Math.round(p.estoqueAtual / consumoDiario);
                                  if (dias >= 365) return `${Math.round(dias / 30)} meses`;
                                  return `${dias} dias`;
                                })()}
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
                              {(() => {
                                if (p.qtdFinal > 0) {
                                  return (
                                    <td className={styles.qtdSugerida}>{fmt(p.qtdFinal)}</td>
                                  );
                                }
                                if (p.qtdSuficiente) {
                                  return (
                                    <td className={styles.qtdSuficienteTag}>quantidade suficiente</td>
                                  );
                                }
                                if (temSugestaoS(p)) {
                                  const qtdS = calcQtdS(p);
                                  const mesesHistoricoFilial = getMesesHistoricoFilial(p);
                                  const mediaVendasMes = p.vendas3meses / mesesHistoricoFilial;
                                  const { limiteDias } = getLimiteDiasReposicao(p);
                                  return (
                                    <td className={styles.qtdSugeridaS}>
                                      <span className={styles.qtdSugeridaSInner}>
                                        {fmt(qtdS)}
                                        <span
                                          className={styles.badgeS}
                                          onMouseEnter={(e) => setSugestaoSTooltip({ x: e.clientX, y: e.clientY, mediaVendasMes, mesesHistoricoFilial, estoqueAtual: p.estoqueAtual ?? 0, limiteDias, qtdS })}
                                          onMouseLeave={() => setSugestaoSTooltip(null)}
                                        >S</span>
                                      </span>
                                    </td>
                                  );
                                }
                                return <td className={styles.qtdSugeridaZero}>—</td>;
                              })()}
                              {(() => {
                                const cu = p.custoUnitario ?? 0;
                                const hasS = p.qtdFinal <= 0 && !p.qtdSuficiente && temSugestaoS(p);
                                const qtdParaCusto = p.qtdFinal > 0 ? p.qtdFinal : hasS ? calcQtdS(p) : 0;
                                const showCost = qtdParaCusto > 0 && cu > 0;
                                const cellClass = showCost
                                  ? hasS ? styles.qtdSugeridaS : styles.qtdSugerida
                                  : styles.qtdSugeridaZero;
                                return (
                                  <>
                                    <td className={`${styles.right} ${cellClass}`}>
                                      {showCost ? fmtBRL2(cu) : "—"}
                                    </td>
                                    <td className={`${styles.right} ${cellClass}`}>
                                      {showCost ? fmtBRL(qtdParaCusto * cu) : "—"}
                                    </td>
                                  </>
                                );
                              })()}
                            </tr>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
              </>
            )}
          </div>
        </>
      )}

      {activeTab === "final" && (
        <div ref={compraFinalExportRef}>
          <div className={styles.summaryCard} style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Itens na Compra Final</span>
              <span className={styles.summaryValueNeutral}>{compraFinalTotals.totalItens}</span>
            </div>
            <div className={styles.summaryDivider} />
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Total Qtd Manual</span>
              <span className={styles.summaryValue}>{fmt(compraFinalTotals.totalQtdManual)}</span>
            </div>
            <div className={styles.summaryDivider} />
            <div className={styles.summaryItem}>
              <span className={styles.summaryLabel}>Custo Total</span>
              <span className={styles.summaryValue}>{fmtBRL(compraFinalTotals.totalCusto)}</span>
            </div>
            </div>

            <div className={styles.exportActions}>
              <button
                type="button"
                className={styles.exportBtn}
                disabled={savingCompraSalva || compraFinal.length === 0}
                onClick={() => { void handleSalvarCompraAtual(); }}
              >
                {savingCompraSalva ? "Salvando…" : "Salvar compra atual"}
              </button>
              <button type="button" className={styles.exportBtn} onClick={handleExportCompraFinalXlsx}>
                Exportar XLSX
              </button>
              <button
                type="button"
                className={styles.exportBtn}
                disabled={exportingPdf || compraFinal.length === 0}
                onClick={() => { void handleExportCompraFinalPdf(); }}
              >
                {exportingPdf ? "Exportando PDF…" : "Exportar PDF"}
              </button>
            </div>
          </div>

          <div className={styles.tableCard}>
            {loadingFinal && <div className={styles.loading}>Carregando compra final...</div>}
            {errorFinal && <div className={styles.error}>{errorFinal}</div>}
            {!loadingFinal && !errorFinal && compraFinal.length === 0 && (
              <div className={styles.empty}>Nenhum item adicionado ainda.</div>
            )}
            {!loadingFinal && !errorFinal && compraFinal.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className={styles.right}>Qtd</th>
                    <th>Destino</th>
                    <th className={styles.right}>Estoque</th>
                    <th className={styles.right}>Custo Unit.</th>
                    <th className={styles.right}>Custo Total</th>
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {compraFinalRows.map(({ it, estoque, custoUnit, custoTotal }) => {
                    const produtoK = it.produto.trim();
                    const corK = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
                    const vendasKey = `${produtoK}||${corK ?? ""}`;
                    const vendasRowsK = vendasPorFilialCache[vendasKey];
                    const partesDestino =
                      vendasRowsK === undefined
                        ? undefined
                        : partesDestinoCompraFinal(it.qtdManual ?? 0, vendasRowsK, companyKey);
                    return (
                      <tr key={it.itemKey}>
                        <td>
                          <div className={styles.productName}>{it.descricao || it.produto}</div>
                          <div className={styles.productCode}>{it.produto}</div>
                          {it.corDescricao && <div className={styles.productCode}>{it.corDescricao}</div>}
                          {it.grade && <div className={styles.productCode}>Grade: {it.grade}</div>}
                          {it.colecao && <div className={styles.productCode}>Coleção: {it.colecao}</div>}
                        </td>
                        <td className={styles.right}>
                          <input
                            className={styles.qtyInput}
                            type="number"
                            value={it.qtdManual}
                            min={0}
                            onChange={(e) => {
                              const v = Math.max(0, Math.round(Number(e.target.value ?? 0)));
                              setCompraFinal((prev) => prev.map((x) => (x.itemKey === it.itemKey ? { ...x, qtdManual: v } : x)));
                            }}
                            onBlur={() => { void handleUpdateQtdFinal(it.itemKey, it.qtdManual); }}
                          />
                        </td>
                        <td className={styles.destinoCell}>
                          {partesDestino === undefined
                            ? "…"
                            : partesDestino === null
                              ? "—"
                              : <DestinoCompraFinalBadges partes={partesDestino} />}
                        </td>
                        <td
                          className={styles.right}
                          onMouseEnter={(e) => {
                            if (estoque == null) return;
                            const produto = (it.produto ?? "").trim();
                            const corProduto = expandirPorCor ? ((it.corProduto ?? "").trim() || null) : null;
                            const cacheKey = `${produto}||${corProduto ?? ""}`;
                            const cached = estoquePorFilialCache[cacheKey];
                            const show = (filiais: Array<{ filial: string; estoque: number }>) => {
                              const filiaisVisiveis = filterEstoqueTooltipFiliais(filiais);
                              const total = filiaisVisiveis.reduce((s, f) => s + Math.max(0, f.estoque ?? 0), 0);
                              setEstoqueTooltip({
                                x: e.clientX,
                                y: e.clientY,
                                produto,
                                corDescricao: expandirPorCor ? it.corDescricao : undefined,
                                filiais: filiaisVisiveis,
                                total,
                              });
                            };
                            if (cached) {
                              show(cached);
                              return;
                            }
                            const params = new URLSearchParams();
                            params.set("company", companyKey);
                            if (filial) params.set("filial", filial);
                            params.set("produto", produto);
                            if (corProduto) params.set("corProduto", corProduto);
                            fetchEstoquePorFilial(params)
                              .then((data) => {
                                setEstoquePorFilialCache((prev) => ({ ...prev, [cacheKey]: data }));
                                show(data);
                              })
                              .catch(() => {
                                show([]);
                              });
                          }}
                          onMouseLeave={() => setEstoqueTooltip(null)}
                        >
                          {estoque != null ? fmt(estoque) : "—"}
                        </td>
                        <td className={`${styles.right} ${custoUnit > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                          {custoUnit > 0 ? fmtBRL2(custoUnit) : "—"}
                        </td>
                        <td className={`${styles.right} ${custoTotal > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                          {custoTotal > 0 ? fmtBRL(custoTotal) : "—"}
                        </td>
                        <td className={styles.right}>
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => { void handleRemoveFinal(it.itemKey); }}
                            title="Remover"
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {activeTab === "compras-salvas" && (
        <div className={styles.tableCard} style={{ padding: 24 }}>
          <ComprasSalvasListPanel companyKey={companyKey} companySlug={companySlug} />
        </div>
      )}

      {sugestaoSTooltip && (
        <div
          className={styles.tooltip}
          style={{ left: sugestaoSTooltip.x + 12, top: sugestaoSTooltip.y + 12 }}
        >
          <div className={styles.tooltipTitle}>Sugestão por Critério S</div>
          <div className={styles.tooltipLine} style={{ color: "#c4b5fd", marginBottom: 6 }}>
            Produto com vendas consistentes e estoque abaixo da média mensal
          </div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}><strong>Base historica filial:</strong> {sugestaoSTooltip.mesesHistoricoFilial.toFixed(1)} meses</div>
          <div className={styles.tooltipLine}><strong>Média de vendas:</strong> {sugestaoSTooltip.mediaVendasMes.toFixed(1)} un/mês</div>
          <div className={styles.tooltipLine}><strong>Estoque atual:</strong> {fmt(sugestaoSTooltip.estoqueAtual)} un</div>
          <div className={styles.tooltipLine}><strong>Cobertura mínima:</strong> {sugestaoSTooltip.limiteDias} dias</div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}><strong>Qtd sugerida:</strong> {fmt(sugestaoSTooltip.qtdS)} un</div>
          <div className={styles.tooltipLine} style={{ color: "#94a3b8", marginTop: 4, fontSize: 11 }}>
            = {sugestaoSTooltip.limiteDias / 30} meses × {sugestaoSTooltip.mediaVendasMes.toFixed(1)} un/mês
          </div>
        </div>
      )}

      {historicoTooltip && (
        <div
          className={styles.tooltip}
          style={{ left: historicoTooltip.x + 12, top: historicoTooltip.y + 12 }}
        >
          <div className={styles.tooltipTitle}>Historico parcial na filial</div>
          <div className={styles.tooltipLine}>Este item ainda nao completou 12 meses de historico na filial selecionada.</div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}><strong>Data base historico:</strong> {formatHistoricoDate(historicoTooltip.primeiraEntradaFilial)}</div>
          <div className={styles.tooltipLine}><strong>Dias de historico:</strong> {fmt(historicoTooltip.diasHistoricoFilial)}</div>
          <div className={styles.tooltipLine}><strong>Meses de historico:</strong> {historicoTooltip.mesesHistoricoFilial.toFixed(1)}</div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}>Os calculos historicos usam o periodo real disponivel ate completar 12 meses.</div>
        </div>
      )}

      {duracaoTooltip && (
        <div
          className={styles.tooltip}
          style={{ left: duracaoTooltip.x + 12, top: duracaoTooltip.y + 12 }}
        >
          <div className={styles.tooltipTitle}>Duração real (mês atual)</div>
          <div className={styles.tooltipLine}><strong>Regra:</strong> {duracaoTooltip.regra}</div>
          <div className={styles.tooltipLine}><strong>Limite do item:</strong> {duracaoTooltip.limiteDias} dias</div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}><strong>Vendas mês:</strong> {fmt(duracaoTooltip.vendasMesAtual)}</div>
          <div className={styles.tooltipLine}><strong>Dias corridos:</strong> {duracaoTooltip.diasCorridos}</div>
          <div className={styles.tooltipLine}><strong>Consumo/dia:</strong> {duracaoTooltip.consumoDiario.toFixed(2)}</div>
          <div className={styles.tooltipLine}><strong>Estoque atual:</strong> {fmt(duracaoTooltip.estoqueAtual)}</div>
          <div className={styles.tooltipLine}><strong>Duração:</strong> {duracaoTooltip.duracaoDias} dias</div>
        </div>
      )}

      {estoqueTooltip && (
        <div
          className={styles.tooltipEstoque}
          style={{ left: estoqueTooltip.x + 12, top: estoqueTooltip.y + 12 }}
        >
          <div className={styles.tooltipEstoqueHeader}>Estoque por filial</div>
          <div className={styles.tooltipEstoqueMeta}><strong>Produto:</strong> {estoqueTooltip.produto}</div>
          {estoqueTooltip.corDescricao && (
            <div className={styles.tooltipEstoqueMeta}><strong>Cor:</strong> {estoqueTooltip.corDescricao}</div>
          )}
          <div className={styles.tooltipDivider} />
          {estoqueTooltip.filiais.length === 0 ? (
            <div className={styles.tooltipLine}>Sem dados de estoque por filial.</div>
          ) : (
            <>
              <div className={styles.tooltipEstoqueFiliais}>
                {estoqueTooltip.filiais.map((f) => (
                  <React.Fragment key={f.filial}>
                    <span className={styles.tooltipEstoqueFilialNome}>{f.filial}</span>
                    <span className={`${styles.tooltipEstoqueFilialQtd}${f.estoque < 0 ? ` ${styles.negative}` : ""}`}>{fmt(f.estoque)}</span>
                  </React.Fragment>
                ))}
              </div>
              <div className={styles.tooltipEstoqueTotal}>
                <span>Total</span>
                <span>{fmt(estoqueTooltip.total)}</span>
              </div>
            </>
          )}
        </div>
      )}

      {vendasTooltip && (
        <div
          className={styles.tooltipEstoque}
          style={{ left: vendasTooltip.x + 12, top: vendasTooltip.y + 12 }}
        >
          <div className={styles.tooltipEstoqueHeader}>
            {vendasTooltip.mode === "12m" ? "Vendas 12 meses por filial" : "Vendas 60 dias por filial"}
          </div>
          <div className={styles.tooltipEstoqueMeta}><strong>Produto:</strong> {vendasTooltip.produto}</div>
          {vendasTooltip.corDescricao && (
            <div className={styles.tooltipEstoqueMeta}><strong>Cor:</strong> {vendasTooltip.corDescricao}</div>
          )}
          <div className={styles.tooltipDivider} />
          {vendasTooltip.loading ? (
            <div className={styles.tooltipLine}>Carregando...</div>
          ) : vendasTooltip.filiais.length === 0 ? (
            <div className={styles.tooltipLine}>Sem vendas no período.</div>
          ) : (
            <>
              <div className={styles.tooltipEstoqueFiliais}>
                {vendasTooltip.filiais.map((f) => (
                  <React.Fragment key={f.filial}>
                    <span className={styles.tooltipEstoqueFilialNome}>{f.filial}</span>
                    <span className={styles.tooltipEstoqueFilialQtd}>
                      {fmt(vendasTooltip.mode === "12m" ? f.qtde12m : f.qtde60d)}
                    </span>
                  </React.Fragment>
                ))}
              </div>
              <div className={styles.tooltipEstoqueTotal}>
                <span>Total</span>
                <span>
                  {fmt(vendasTooltip.filiais.reduce((s, f) => s + (vendasTooltip.mode === "12m" ? f.qtde12m : f.qtde60d), 0))}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

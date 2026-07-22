"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import CompraIdealCell from "@/components/shared/CompraIdealCell";
import ProdutoGiroPerformanceChart from "@/components/stock/ProdutoGiroPerformanceChart";
import {
  clearControleEstoqueMetricasClientCache,
  fetchControleEstoqueMetricasItensClient,
} from "@/lib/client/controle-estoque-metricas";
import {
  buildControleEstoqueItemKey,
  type ControleEstoqueItemMetricas,
} from "@/lib/utils/controle-estoque-metricas";
import {
  buildCompraTransitoIndex,
  fetchComprasTransitoClient,
  getCompraTransitoEntries,
  type CompraTransitoIndex,
} from "@/lib/client/compras-transito";
import { calcCompraIdealFromResumo, type CompraIdealResult } from "@/lib/utils/compra-ideal";
import {
  buildTransferLensIndex,
  resolveTransferLens,
  applyTransferLens,
  type TransferLensIndex,
  type TransferLensResult,
} from "@/lib/utils/transferencia-regras";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";
import { useCatracaDataCompra } from "@/lib/client/use-catraca-data-compra";
import { formatDateForQuery } from "@/lib/utils/date";
import {
  exportProdutoGiroXlsx,
  type ProdutoGiroXlsxRow,
  type ProdutoGiroPerfXlsxRow,
  type ProdutoGiroResumoRow,
} from "@/lib/utils/exportProdutoGiroXlsx";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProdutoGiroPage.module.css";

// ─── Tipos ───────────────────────────────────────────────────────────────────

interface EstoqueFilialEntry {
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
  colecao?: string;
  grade?: string;
  cor?: string;
  corDescricao?: string;
  codigoBarra?: string;
  vendas: number;
  qtde: number;
  custo: number;
  estoque?: number;
  estoqueRede?: number;
  /** Estoque por filial no escopo selecionado. */
  estoquePorFilial?: EstoqueFilialEntry[];
  /** Estoque por filial na REDE inteira (só presente no modo filial específica). */
  estoqueRedePorFilial?: EstoqueFilialEntry[];
  descontinuado?: boolean;
}

type FilialFilterCompanyConfig = {
  filialFilters: unknown;
  filialDisplayNames?: Record<string, string>;
  filialGroups?: Record<string, string[]>;
  activeFilials?: Record<string, string>;
  ecommerceFilials?: string[];
};

interface CurvaAbcResponse {
  filial: string | null;
  displayName: string;
  porCor?: boolean;
  vendas: number;
  vendasPrevious: number;
  qtde: number;
  daysElapsed: number;
  totalDaysInMonth: number;
  companyConfig?: FilialFilterCompanyConfig | null;
  produtos: ProdutoRow[];
}

type SortKey = "dura" | "vendas" | "qtde" | "estoque" | "mediaDiaria";

type GiroView = "resumo" | "diario";

interface DiarioItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  codigoBarra: string;
  subgrupo: string;
  colecao: string;
  grade: string;
  porDia: Record<string, number>;
  totalQtde: number;
  totalVendas: number;
}

interface DiarioResponse {
  dias: string[];
  itens: DiarioItem[];
  totaisPorDia?: Array<{ dia: string; qtde: number; vendas: number }>;
}

interface FilialVendaRow {
  key: string;
  label: string;
  ecommerce: boolean;
  vendas: number;
  qtde: number;
  pct: number;
}

interface FiliaisResponse {
  totalVendas: number;
  totalQtde: number;
  filiais: FilialVendaRow[];
}

// ─── Formatação ──────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}
function fmtDec(n: number, dec = 1): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtBRLc(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function fmtDataCurta(d: Date): string {
  return `${String(d.getDate()).padStart(2, "0")}/${MESES_PT[d.getMonth()]}/${String(d.getFullYear()).slice(2)}`;
}

/** 'yyyy-MM-dd' → 'dd/mm' (cabeçalho das colunas de dia). */
function fmtDiaCurto(iso: string): string {
  const parts = iso.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}`;
}

function getCurrentMonthRange(): DateRangeValue {
  const now = new Date();
  return {
    startDate: new Date(now.getFullYear(), now.getMonth(), 1),
    endDate: now,
  };
}

/** Chave única de uma linha da tabela (produto + cor), usada na seleção por clique. */
function rowKey(produto: string, cor: string | null | undefined): string {
  return `${produto}||${cor ?? ""}`;
}

/** União das opções vindas do endpoint (imediatas) + derivadas do dataset (completas), ordenadas. */
function mergeOpts(base: string[], fromDataset: string[]): string[] {
  const set = new Set<string>(base);
  fromDataset.forEach((v) => {
    const t = (v ?? "").trim();
    if (t) set.add(t);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
}

/** Duração em dias do estoque no ritmo de venda do período. null quando não há giro. */
function calcDuracaoDias(estoque: number, mediaDiaria: number): number | null {
  if (mediaDiaria <= 0) return null;
  if (estoque <= 0) return 0;
  return estoque / mediaDiaria;
}

/**
 * Heatmap sequencial (azul, claro→escuro) da matriz diária: o fundo carrega a magnitude,
 * o número fica em tinta. Zero recua pro fundo; negativo (net trocas) vira vermelho.
 * Buckets fixos porque os valores por dia são inteiros pequenos.
 */
function diarioHeatClass(q: number): string {
  if (q < 0) return styles.diarioNeg;
  if (q === 0) return styles.diarioZero;
  if (q === 1) return styles.diarioL1;
  if (q <= 3) return styles.diarioL2;
  if (q <= 6) return styles.diarioL3;
  if (q <= 9) return styles.diarioL4;
  return styles.diarioL5;
}

function duraClass(dias: number | null): string {
  if (dias === null) return styles.muted;
  if (dias <= 15) return `${styles.duraPill} ${styles.duraCrit}`;
  if (dias <= 45) return `${styles.duraPill} ${styles.duraWarn}`;
  return `${styles.duraPill} ${styles.duraOk}`;
}

/**
 * Tooltip em PORTAL (document.body, position: fixed) — escapa do recorte do container da tabela
 * (`.tableCard` overflow:hidden + `.tableScroll` overflow-x:auto recortam absolutes). Posiciona a
 * partir do bounding rect do gatilho e vira pra baixo quando há pouco espaço acima.
 */
function HoverTooltip({
  trigger,
  align = "left",
  children,
}: {
  trigger: ReactNode;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; below: boolean } | null>(null);

  const open = () => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = r.top < 280; // pouco espaço acima → abre pra baixo
    setCoords({
      top: below ? r.bottom + 8 : r.top - 8,
      left: align === "right" ? r.right : r.left,
      below,
    });
  };
  const close = () => setCoords(null);

  return (
    <span
      ref={ref}
      className={styles.inlineTooltipTrigger}
      onMouseEnter={open}
      onMouseMove={open}
      onMouseLeave={close}
    >
      {trigger}
      {coords != null &&
        createPortal(
          <div
            className={styles.portalTooltip}
            style={{
              top: coords.top,
              left: coords.left,
              transform: `translate(${align === "right" ? "-100%" : "0"}, ${coords.below ? "0" : "-100%"})`,
            }}
          >
            {children}
          </div>,
          document.body
        )}
    </span>
  );
}

/** Tooltip da coluna Estoque: painel com o estoque da REDE (todas as filiais) desse item. */
function renderEstoqueTooltip(
  estoqueFilial: number,
  redeFiliais: EstoqueFilialEntry[],
  redeTotal: number,
  fmtUn: (value: number) => string
): ReactNode {
  const comEstoque = redeFiliais.filter((e) => e.qtde > 0);
  if (comEstoque.length === 0) return <span>{fmtUn(estoqueFilial)}</span>;

  return (
    <HoverTooltip align="left" trigger={<span className={styles.estoqueRedeTrigger}>{fmtUn(estoqueFilial)}</span>}>
      <div className={styles.inlineTooltipTitle}>Estoque na rede</div>
      <div className={styles.inlineTooltipList}>
        {comEstoque.map((e) => (
          <div key={e.filial} className={styles.inlineTooltipRow}>
            <span className={styles.inlineTooltipLabel}>
              <span className={styles.inlineTooltipFilial}>{e.displayName}</span>
            </span>
            <span className={styles.inlineTooltipValue}>{fmtUn(e.qtde)}</span>
          </div>
        ))}
      </div>
      <div className={styles.inlineTooltipFooter}>
        <span>Total rede</span>
        <span>{fmtUn(redeTotal)}</span>
      </div>
    </HoverTooltip>
  );
}

/** Tooltip da coluna Transferência: painel com as lojas de origem e quanto cada uma cede. */
function renderTransferenciaTooltip(lente: TransferLensResult, fmtUn: (value: number) => string): ReactNode {
  const trigger = (
    <span style={{ color: "#7c3aed", fontWeight: 600 }}>{fmtUn(lente.disponivelTransferir)} un</span>
  );
  if (lente.doadoras.length === 0) return trigger;

  return (
    <HoverTooltip align="right" trigger={trigger}>
      <div className={styles.inlineTooltipTitle}>Transferir de</div>
      <div className={styles.inlineTooltipList}>
        {lente.doadoras.map((doadora) => (
          <div key={doadora.origemCanonico} className={styles.inlineTooltipRow}>
            <span className={styles.inlineTooltipLabel}>
              <span className={styles.inlineTooltipFilial}>{doadora.origem}</span>
            </span>
            <span className={styles.inlineTooltipValue}>{fmtUn(doadora.quantidade)}</span>
          </div>
        ))}
      </div>
      {lente.doadoras.length > 1 && (
        <div className={styles.inlineTooltipFooter}>
          <span>Total</span>
          <span>{fmtUn(lente.disponivelTransferir)}</span>
        </div>
      )}
    </HoverTooltip>
  );
}

// ─── Componente ──────────────────────────────────────────────────────────────

const METRICS_CHUNK = 40;
const METRICS_CONCURRENCY = 4;
const MAX_METRICS_ITENS = 1200;

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<void>
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const i = nextIndex;
      nextIndex += 1;
      if (i >= items.length) return;
      await mapper(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

interface ProdutoGiroPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

export default function ProdutoGiroPage({ companyKey }: ProdutoGiroPageProps) {
  const [range, setRange] = useState<DateRangeValue>(getCurrentMonthRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [porCor, setPorCor] = useState(true);

  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [selectedGrupos, setSelectedGrupos] = useState<string[]>([]);
  const [selectedSubgrupos, setSelectedSubgrupos] = useState<string[]>([]);
  const [selectedGrades, setSelectedGrades] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);

  // Opções de filtro carregadas dos endpoints leves (/api/products/*) — chegam ANTES do dataset
  // pesado, então os dropdowns já ficam usáveis "logo de cara". Depois são unidas às derivadas
  // do dataset (mesmas colunas de PRODUTOS, UPPER+TRIM → valores casam).
  const [optGrupos, setOptGrupos] = useState<string[]>([]);
  const [optSubgrupos, setOptSubgrupos] = useState<string[]>([]);
  const [optGrades, setOptGrades] = useState<string[]>([]);
  const [optColecoes, setOptColecoes] = useState<string[]>([]);

  const [data, setData] = useState<CurvaAbcResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const [metrics, setMetrics] = useState<Record<string, ControleEstoqueItemMetricas | null>>({});
  const [metricsLoading, setMetricsLoading] = useState<{ feito: number; total: number } | null>(null);
  const [comprasTransitoIndex, setComprasTransitoIndex] = useState<CompraTransitoIndex>(new Map());

  // Lente de transferência (read-only): mostra o estoque parado na rede e o que a compra
  // ficaria descontando transferências — mesma lente da Curva A,B,C. Nasce LIGADA.
  const [verTransferencias, setVerTransferencias] = useState(true);
  const [transferLensIndex, setTransferLensIndex] = useState<TransferLensIndex | null>(null);
  const [transferLensLoading, setTransferLensLoading] = useState(false);

  // Seleção de itens por clique na linha (toggle). Filtra o gráfico de performance e os KPIs.
  const [selectedItemKeys, setSelectedItemKeys] = useState<Set<string>>(new Set());
  const toggleItemSelection = (key: string) =>
    setSelectedItemKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const [sortKey, setSortKey] = useState<SortKey>("dura");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  // Aba "Vendas por dia" (matriz item×cor × dias do período).
  const [view, setView] = useState<GiroView>("resumo");
  const [diario, setDiario] = useState<DiarioResponse | null>(null);
  const [diarioLoading, setDiarioLoading] = useState(false);
  const [diarioError, setDiarioError] = useState<string | null>(null);

  // Painel "Vendas por filial" (quebra do total do período por filial + %).
  const [filiais, setFiliais] = useState<FiliaisResponse | null>(null);
  const [filiaisLoading, setFiliaisLoading] = useState(false);

  const catraca = useCatracaDataCompra(companyKey, selectedFilial ?? "");

  // Debounce da busca (evita refazer filtro/métricas a cada tecla).
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim().toLowerCase()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Carrega base (vendas + estoque por produto×cor) do MESMO endpoint da Curva ABC.
  //    Vendas/qtde vêm de fetchSalesTotals → idênticos ao Dashboard e à Curva ABC.
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    const params = new URLSearchParams();
    params.set("company", companyKey);
    params.set("start", formatDateForQuery(range.startDate));
    params.set("end", formatDateForQuery(range.endDate));
    params.set("month", String(range.startDate.getMonth()));
    params.set("year", String(range.startDate.getFullYear()));
    params.set("compare", "month");
    if (selectedFilial) params.set("filial", selectedFilial);
    if (porCor) params.set("porCor", "1");

    fetch(`/api/curva-abc?${params.toString()}`, { cache: "no-store", signal: controller.signal })
      .then((res) => res.json())
      .then((json: CurvaAbcResponse) => {
        if (cancelled) return;
        setData(json);
      })
      .catch((err) => {
        if (!cancelled && err?.name !== "AbortError") setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [companyKey, selectedFilial, porCor, range.startDate, range.endDate]);

  // ── Compras em trânsito (abatem a compra sugerida — paridade com a Curva ABC).
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

  // ── Lente de transferência: só busca a rede quando o toggle está ligado (custo zero quando off).
  //    Reusa a MESMA fonte do Controle de Transferências (todas as filiais, 30d), igual à Curva A,B,C.
  useEffect(() => {
    if (!verTransferencias) return;
    let cancelled = false;
    setTransferLensLoading(true);
    fetch(`/api/controle-transferencias?company=${companyKey}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((json: { data?: ProdutoTransferencia[] }) => {
        if (!cancelled) setTransferLensIndex(buildTransferLensIndex(json.data ?? [], companyKey));
      })
      .catch(() => {
        if (!cancelled) setTransferLensIndex(null);
      })
      .finally(() => {
        if (!cancelled) setTransferLensLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [verTransferencias, companyKey]);

  // ── Opções de filtro (endpoints leves): carregam independentes do dataset pesado, no MESMO
  //    escopo (empresa + filial + período) para casar com os itens que vão aparecer.
  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    params.set("start", formatDateForQuery(range.startDate));
    params.set("end", formatDateForQuery(range.endDate));
    if (selectedFilial) params.set("filial", selectedFilial);
    const qs = params.toString();

    const load = (path: string, setter: (v: string[]) => void) =>
      fetch(`/api/products/${path}?${qs}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((json: { data?: string[] }) => {
          if (!cancelled) setter(Array.isArray(json.data) ? json.data : []);
        })
        .catch(() => {
          if (!cancelled) setter([]);
        });

    // Reset ao trocar de escopo (evita mostrar opções do escopo anterior).
    setOptGrupos([]);
    setOptSubgrupos([]);
    setOptGrades([]);
    setOptColecoes([]);

    void load("subgrupos", setOptSubgrupos);
    if (companyKey === "nerd") {
      void load("grupos", setOptGrupos);
    } else {
      void load("colecoes", setOptColecoes);
      void load("grades", setOptGrades);
    }
    return () => {
      cancelled = true;
    };
  }, [companyKey, selectedFilial, range.startDate, range.endDate]);

  const produtos = useMemo(() => data?.produtos ?? [], [data]);

  // Linhas selecionadas (cor-exato) + produtos distintos (base do filtro do gráfico).
  const selectedRows = useMemo(
    () => produtos.filter((p) => selectedItemKeys.has(rowKey(p.produto, p.cor))),
    [produtos, selectedItemKeys]
  );
  const selectedProdutos = useMemo(() => {
    const s = new Set<string>();
    selectedItemKeys.forEach((k) => {
      const prod = k.split("||")[0];
      if (prod) s.add(prod);
    });
    return Array.from(s);
  }, [selectedItemKeys]);

  // ── Opções de filtro derivadas do dataset (mesmo padrão da Curva ABC).
  const availableGrupos = useMemo(() => {
    if (companyKey !== "nerd") return [];
    return mergeOpts(optGrupos, produtos.map((p) => p.categoria ?? ""));
  }, [optGrupos, produtos, companyKey]);

  const availableSubgrupos = useMemo(
    () => mergeOpts(optSubgrupos, produtos.map((p) => p.subgrupo ?? "")),
    [optSubgrupos, produtos]
  );
  const availableGrades = useMemo(
    () => mergeOpts(optGrades, produtos.map((p) => p.grade ?? "")),
    [optGrades, produtos]
  );
  const availableColecoes = useMemo(() => {
    if (companyKey === "nerd") return [];
    return mergeOpts(optColecoes, produtos.map((p) => p.colecao ?? ""));
  }, [optColecoes, produtos, companyKey]);

  useEffect(() => {
    setSelectedGrupos((prev) => prev.filter((v) => availableGrupos.includes(v)));
  }, [availableGrupos]);
  useEffect(() => {
    setSelectedSubgrupos((prev) => prev.filter((v) => availableSubgrupos.includes(v)));
  }, [availableSubgrupos]);
  useEffect(() => {
    setSelectedGrades((prev) => prev.filter((v) => availableGrades.includes(v)));
  }, [availableGrades]);
  useEffect(() => {
    setSelectedColecoes((prev) => prev.filter((v) => availableColecoes.includes(v)));
  }, [availableColecoes]);

  const hasClientFilter =
    searchDebounced.length > 0 ||
    selectedGrupos.length > 0 ||
    selectedSubgrupos.length > 0 ||
    selectedGrades.length > 0 ||
    selectedColecoes.length > 0;

  // ── Aplica os filtros do cliente.
  const produtosFiltrados = useMemo(() => {
    let rows = produtos;
    if (selectedGrupos.length > 0) rows = rows.filter((p) => selectedGrupos.includes((p.categoria ?? "").trim()));
    if (selectedSubgrupos.length > 0) rows = rows.filter((p) => selectedSubgrupos.includes((p.subgrupo ?? "").trim()));
    if (selectedGrades.length > 0) rows = rows.filter((p) => selectedGrades.includes((p.grade ?? "").trim()));
    if (selectedColecoes.length > 0) rows = rows.filter((p) => selectedColecoes.includes((p.colecao ?? "").trim()));
    if (searchDebounced) {
      rows = rows.filter((p) => {
        const hay = `${p.descricao ?? ""} ${p.produto ?? ""} ${p.codigoBarra ?? ""} ${p.corDescricao ?? ""} ${p.categoria ?? ""} ${p.subgrupo ?? ""} ${p.colecao ?? ""}`.toLowerCase();
        return hay.includes(searchDebounced);
      });
    }
    return rows;
  }, [produtos, selectedGrupos, selectedSubgrupos, selectedGrades, selectedColecoes, searchDebounced]);

  // Produtos que o gráfico de performance deve considerar — ESPELHA o que está na tela:
  // clique numa linha vence; senão os filtros de dropdown/busca; senão a rede inteira.
  // Assim o gráfico bate com o KPI "Vendas no período" (não mostra a rede quando você filtrou).
  const chartProdutoIds = useMemo(() => {
    if (selectedProdutos.length > 0) return selectedProdutos;
    if (!hasClientFilter) return [];
    const s = new Set<string>();
    for (const p of produtosFiltrados) s.add(p.produto);
    return Array.from(s).slice(0, 1500); // teto de segurança p/ a cláusula IN
  }, [selectedProdutos, hasClientFilter, produtosFiltrados]);
  const chartProdutoKey = useMemo(() => [...chartProdutoIds].sort().join(","), [chartProdutoIds]);

  // Matriz "vendas por dia" (item×cor × cada dia do período), no MESMO escopo/filtros da tela.
  // Reusada pela aba e pelo export. Uma consulta por dia à lógica canônica (bate com o total).
  const fetchDiarioData = async (): Promise<DiarioResponse> => {
    const params = new URLSearchParams({
      company: companyKey,
      start: formatDateForQuery(range.startDate),
      end: formatDateForQuery(range.endDate),
    });
    if (selectedFilial) params.set("filial", selectedFilial);
    chartProdutoIds.forEach((p) => params.append("produto", p));
    const res = await fetch(`/api/produto-giro/diario?${params.toString()}`, { cache: "no-store" });
    const json = (await res.json()) as DiarioResponse & { error?: string };
    if (json.error) throw new Error(json.error);
    return { dias: json.dias ?? [], itens: json.itens ?? [], totaisPorDia: json.totaisPorDia ?? [] };
  };

  // Vendas por filial — mesmo escopo/filtros da tela. Reusado pelo painel e pelo export.
  const fetchFiliaisData = async (): Promise<FiliaisResponse> => {
    const params = new URLSearchParams({
      company: companyKey,
      start: formatDateForQuery(range.startDate),
      end: formatDateForQuery(range.endDate),
    });
    if (selectedFilial) params.set("filial", selectedFilial);
    chartProdutoIds.forEach((p) => params.append("produto", p));
    const res = await fetch(`/api/produto-giro/filiais?${params.toString()}`, { cache: "no-store" });
    const json = (await res.json()) as FiliaisResponse & { error?: string };
    if (json.error) throw new Error(json.error);
    return { totalVendas: json.totalVendas ?? 0, totalQtde: json.totalQtde ?? 0, filiais: json.filiais ?? [] };
  };

  useEffect(() => {
    let cancelled = false;
    setFiliaisLoading(true);
    fetchFiliaisData()
      .then((d) => {
        if (!cancelled) setFiliais(d);
      })
      .catch(() => {
        if (!cancelled) setFiliais(null);
      })
      .finally(() => {
        if (!cancelled) setFiliaisLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, selectedFilial, range.startDate, range.endDate, chartProdutoKey]);

  useEffect(() => {
    if (view !== "diario") return;
    let cancelled = false;
    setDiarioLoading(true);
    setDiarioError(null);
    fetchDiarioData()
      .then((d) => {
        if (!cancelled) setDiario(d);
      })
      .catch(() => {
        if (!cancelled) {
          setDiario(null);
          setDiarioError("Não foi possível carregar as vendas por dia.");
        }
      })
      .finally(() => {
        if (!cancelled) setDiarioLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // fetchDiarioData lê os primitivos abaixo do closure; chartProdutoKey resume a seleção.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, companyKey, selectedFilial, range.startDate, range.endDate, chartProdutoKey]);

  // ── Carrega as métricas (ritmo/estoque) dos itens visíveis, em lotes, com cache.
  //    Mesma fonte da Curva ABC (/api/controle-estoque/metricas-itens) → compra ideal idêntica.
  useEffect(() => {
    if (produtosFiltrados.length === 0) {
      setMetricsLoading(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const itens = produtosFiltrados.slice(0, MAX_METRICS_ITENS).map((p) => ({
        produto: p.produto,
        corProduto: porCor ? (p.cor ?? null) : null,
      }));
      const chunks: Array<typeof itens> = [];
      for (let i = 0; i < itens.length; i += METRICS_CHUNK) chunks.push(itens.slice(i, i + METRICS_CHUNK));

      setMetricsLoading({ feito: 0, total: itens.length });
      let feito = 0;
      await mapWithConcurrency(chunks, METRICS_CONCURRENCY, async (chunk) => {
        if (cancelled) return;
        try {
          const rows = await fetchControleEstoqueMetricasItensClient({
            company: companyKey,
            filial: selectedFilial,
            includeHistorico: true,
            itens: chunk,
          });
          if (cancelled) return;
          setMetrics((prev) => {
            const next = { ...prev };
            chunk.forEach((item) => {
              const key = buildControleEstoqueItemKey(item.produto, item.corProduto);
              next[key] = rows[key] ?? null;
            });
            return next;
          });
        } catch {
          /* mantém o que já veio; itens sem métrica exibem "Carregando…" até o cache resolver */
        } finally {
          if (!cancelled) {
            feito += chunk.length;
            setMetricsLoading({ feito: Math.min(feito, itens.length), total: itens.length });
          }
        }
      });
      if (!cancelled) setMetricsLoading(null);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [produtosFiltrados, companyKey, selectedFilial, porCor]);

  // Limpa o cache/métricas ao trocar de escopo (empresa/filial/cor/período).
  useEffect(() => {
    clearControleEstoqueMetricasClientCache();
    setMetrics({});
    setSelectedItemKeys(new Set());
  }, [companyKey, selectedFilial, porCor, range.startDate, range.endDate]);

  const daysElapsed = Math.max(1, data?.daysElapsed ?? 1);

  // ── Linhas enriquecidas com média diária + projeção (derivadas do período visível).
  const rows = useMemo(() => {
    return produtosFiltrados.map((p) => {
      const estoque = Math.max(0, p.estoque ?? 0);
      const mediaDiariaUn = p.qtde / daysElapsed;
      const duraDias = calcDuracaoDias(estoque, mediaDiariaUn);
      const acabaEm = duraDias !== null && duraDias > 0 ? new Date(Date.now() + duraDias * 86400000) : null;
      return { p, estoque, mediaDiariaUn, duraDias, acabaEm };
    });
  }, [produtosFiltrados, daysElapsed]);

  const sortedRows = useMemo(() => {
    const arr = rows.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    arr.sort((a, b) => {
      let av: number;
      let bv: number;
      switch (sortKey) {
        case "vendas":
          av = a.p.vendas;
          bv = b.p.vendas;
          break;
        case "qtde":
          av = a.p.qtde;
          bv = b.p.qtde;
          break;
        case "estoque":
          av = a.estoque;
          bv = b.estoque;
          break;
        case "mediaDiaria":
          av = a.mediaDiariaUn;
          bv = b.mediaDiariaUn;
          break;
        case "dura":
        default:
          // Sem giro (null) sempre no fim, independente da direção.
          av = a.duraDias ?? Number.POSITIVE_INFINITY;
          bv = b.duraDias ?? Number.POSITIVE_INFINITY;
          if (av === Number.POSITIVE_INFINITY && bv === Number.POSITIVE_INFINITY) return 0;
          if (av === Number.POSITIVE_INFINITY) return 1;
          if (bv === Number.POSITIVE_INFINITY) return -1;
          break;
      }
      return (av - bv) * dir;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  // ── KPIs (agregados). Sem filtro de cliente → usa os totais globais do servidor
  //    (fetchSalesTotals) p/ bater exatamente com Dashboard/Curva ABC. Com filtro,
  //    soma as linhas visíveis.
  const kpis = useMemo(() => {
    // Com itens selecionados por clique, os KPIs refletem só essa seleção (cor-exato).
    const hasSelection = selectedRows.length > 0;
    const base = hasSelection ? selectedRows : produtosFiltrados;
    const somaVendas = base.reduce((s, p) => s + p.vendas, 0);
    const somaQtde = base.reduce((s, p) => s + p.qtde, 0);
    const vendas = hasSelection || hasClientFilter ? somaVendas : data?.vendas ?? somaVendas;
    const qtde = hasSelection || hasClientFilter ? somaQtde : data?.qtde ?? somaQtde;
    const estoque = base.reduce((s, p) => s + Math.max(0, p.estoque ?? 0), 0);
    const mediaDiariaUn = qtde / daysElapsed;
    const mediaDiariaVal = vendas / daysElapsed;
    const duraDias = calcDuracaoDias(estoque, mediaDiariaUn);
    const acabaEm = duraDias !== null && duraDias > 0 ? new Date(Date.now() + duraDias * 86400000) : null;
    return { vendas, qtde, estoque, mediaDiariaUn, mediaDiariaVal, duraDias, acabaEm };
  }, [produtosFiltrados, selectedRows, hasClientFilter, data, daysElapsed]);

  // Compra ideal por linha — mesma computação da célula e do export (motor da Curva ABC).
  const computeIdealFor = (p: ProdutoRow): { ideal: CompraIdealResult | null; hasLive: boolean; semDados: boolean } => {
    const corCat = porCor ? (p.cor ?? null) : null;
    const metricKey = buildControleEstoqueItemKey(p.produto, corCat);
    const hasLive = Object.prototype.hasOwnProperty.call(metrics, metricKey);
    const live = metrics[metricKey];
    const semDados = hasLive && !live;
    if (!hasLive || !live) return { ideal: null, hasLive, semDados };
    const transit = getCompraTransitoEntries(comprasTransitoIndex, p.produto, corCat);
    const cru = calcCompraIdealFromResumo(live.resumo, transit, {
      linha: p.linha,
      subgrupo: p.subgrupo,
      company: companyKey,
    });
    const ideal = catraca.reconcile(cru, metricKey, transit).ideal;
    return { ideal, hasLive, semDados };
  };

  const statusLabel = (s: CompraIdealResult["status"]): string =>
    s === "REPOR" ? "Repor" : s === "EXCESSO" ? "Excesso" : "Suficiente";

  // Busca a série de performance semanal no MESMO escopo/filtro da tela (pra 2ª aba do XLSX).
  const fetchPerformanceParaExport = async (): Promise<ProdutoGiroPerfXlsxRow[]> => {
    try {
      const params = new URLSearchParams({ company: companyKey, mode: "week" });
      if (selectedFilial) params.set("filial", selectedFilial);
      chartProdutoIds.forEach((p) => params.append("produto", p));
      const res = await fetch(`/api/produto-giro/performance?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as {
        points?: Array<{
          label: string;
          startIso: string;
          endIso: string;
          dias: number;
          vendas: number;
          qtde: number;
          deltaPct: number | null;
          deltaBase: "cheio" | "parcial-equivalente" | null;
        }>;
      };
      return (json.points ?? []).map((pt) => ({
        PERIODO: pt.label,
        INICIO: pt.startIso,
        FIM: pt.endIso,
        DIAS: pt.dias,
        VENDAS: pt.vendas,
        QTDE: pt.qtde,
        VAR_PCT_VS_ANTERIOR: pt.deltaPct == null ? "" : Math.round(pt.deltaPct * 10) / 10,
        BASE_COMPARACAO:
          pt.deltaPct == null
            ? "—"
            : pt.deltaBase === "parcial-equivalente"
              ? `mesmos ${pt.dias} ${pt.dias === 1 ? "dia" : "dias"} da semana passada`
              : "semana anterior",
      }));
    } catch {
      return [];
    }
  };

  const handleExportXlsx = async () => {
    // Puxa performance semanal + matriz diária + vendas por filial em paralelo (mesmo escopo).
    const [performance, diarioExport, filiaisExport] = await Promise.all([
      fetchPerformanceParaExport(),
      (async () => {
        try {
          return await fetchDiarioData();
        } catch {
          return null;
        }
      })(),
      (async () => {
        try {
          return await fetchFiliaisData();
        } catch {
          return null;
        }
      })(),
    ]);
    const rows: ProdutoGiroXlsxRow[] = sortedRows.map(({ p, estoque, mediaDiariaUn, duraDias, acabaEm }) => {
      const { ideal } = computeIdealFor(p);
      const lente =
        verTransferencias && transferLensIndex && ideal
          ? applyTransferLens(
              ideal.compraIdeal,
              resolveTransferLens(transferLensIndex, p.produto, porCor ? (p.cor ?? null) : null)
            )
          : null;
      return {
        PRODUTO: p.produto.trim(),
        DESCRICAO: p.descricao || p.produto.trim(),
        COR: porCor ? (p.corDescricao || p.cor || "") : "",
        CATEGORIA: (p.categoria ?? "").trim(),
        SUBGRUPO: (p.subgrupo ?? "").trim(),
        COLECAO: (p.colecao ?? "").trim(),
        GRADE: (p.grade ?? "").trim(),
        VENDAS: Math.round(p.vendas * 100) / 100,
        QTDE: p.qtde,
        MEDIA_DIARIA: mediaDiariaUn > 0 ? Math.round(mediaDiariaUn * 100) / 100 : 0,
        ESTOQUE: estoque,
        DURACAO_DIAS: duraDias === null ? "" : Math.round(duraDias),
        ACABA_EM: acabaEm ? acabaEm.toLocaleDateString("pt-BR") : "",
        COMPRA_SUGERIDA: ideal ? Math.max(0, Math.ceil(ideal.compraIdeal)) : "",
        STATUS: ideal ? statusLabel(ideal.status) : "",
        ...(verTransferencias ? { TRANSFERENCIA: lente ? lente.disponivelTransferir : "" } : {}),
      };
    });
    // Filtros ativos (para a aba Resumo).
    const filtrosAtivos: string[] = [];
    if (searchDebounced) filtrosAtivos.push(`busca "${searchDebounced}"`);
    if (selectedGrupos.length) filtrosAtivos.push(`grupo: ${selectedGrupos.join(", ")}`);
    if (selectedSubgrupos.length) filtrosAtivos.push(`subgrupo: ${selectedSubgrupos.join(", ")}`);
    if (selectedGrades.length) filtrosAtivos.push(`grade: ${selectedGrades.join(", ")}`);
    if (selectedColecoes.length) filtrosAtivos.push(`coleção: ${selectedColecoes.join(", ")}`);
    if (selectedItemKeys.size > 0) filtrosAtivos.push(`${selectedItemKeys.size} item(ns) selecionado(s)`);

    const resumo: ProdutoGiroResumoRow[] = [
      ["Empresa", companyKey.toUpperCase()],
      ["Escopo (filial)", data?.displayName ?? "Todas as filiais"],
      ["Período", `${range.startDate.toLocaleDateString("pt-BR")} a ${range.endDate.toLocaleDateString("pt-BR")} (${fmt(daysElapsed)} dias)`],
      ["Filtros", filtrosAtivos.length ? filtrosAtivos.join(" · ") : "nenhum"],
      ["Itens (produto × cor)", sortedRows.length],
      ["Vendas no período (R$)", Math.round(kpis.vendas * 100) / 100],
      ["Quantidade vendida (un)", kpis.qtde],
      ["Média diária (un/dia)", Math.round(kpis.mediaDiariaUn * 100) / 100],
      ["Média diária (R$/dia)", Math.round(kpis.mediaDiariaVal * 100) / 100],
      ["Estoque na rede (un)", kpis.estoque],
      ["Projeção (dias até acabar)", kpis.duraDias === null ? "sem giro" : Math.round(kpis.duraDias)],
      ["Estoque acaba em", kpis.acabaEm ? kpis.acabaEm.toLocaleDateString("pt-BR") : "—"],
    ];

    exportProdutoGiroXlsx(rows, {
      companyKey,
      range: { startDate: range.startDate, endDate: range.endDate },
      filialLabel: data?.displayName ?? null,
      resumo,
      performance,
      performanceLabel: "Performance semanal",
      filiais: filiaisExport
        ? filiaisExport.filiais.map((f) => ({
            FILIAL: f.label,
            TIPO: f.ecommerce ? "E-commerce" : "Loja física",
            VENDAS: f.vendas,
            QTDE: f.qtde,
            PCT: Math.round(f.pct * 10) / 10,
          }))
        : null,
      diario: diarioExport
        ? {
            dias: diarioExport.dias,
            totaisPorDia: diarioExport.totaisPorDia ?? [],
            itens: diarioExport.itens.map((it) => ({
              produto: it.produto,
              descricao: it.descricao || it.produto.trim(),
              cor: it.corDescricao || it.cor || "",
              subgrupo: it.subgrupo,
              colecao: it.colecao,
              grade: it.grade,
              totalQtde: it.totalQtde,
              totalVendas: Math.round(it.totalVendas * 100) / 100,
              porDia: it.porDia,
            })),
          }
        : null,
    });
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      // Duração ascendente = acaba mais rápido primeiro; demais começam desc.
      setSortDir(key === "dura" ? "asc" : "desc");
    }
  };

  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? "▲" : "▼") : "");

  const limparFiltros = () => {
    setSearch("");
    setSelectedGrupos([]);
    setSelectedSubgrupos([]);
    setSelectedGrades([]);
    setSelectedColecoes([]);
  };

  const vendasCents = (() => {
    const str = fmtBRLc(kpis.vendas);
    const ci = str.lastIndexOf(",");
    return ci === -1 ? <>{str}</> : (
      <>
        {str.slice(0, ci)}
        <span className={styles.kpiValueCents}>{str.slice(ci)}</span>
      </>
    );
  })();

  const metricasPct = metricsLoading && metricsLoading.total > 0 ? Math.round((metricsLoading.feito / metricsLoading.total) * 100) : 100;

  // Vendas por filial com arredondamento por MAIOR RESTO: os reais inteiros exibidos somam
  // exatamente o total (sem o "some R$1" de arredondar cada um e depois somar).
  const filiaisDisplay = useMemo(() => {
    if (!filiais || filiais.filiais.length === 0) return null;
    const items = filiais.filiais;
    const alvo = Math.round(filiais.totalVendas);
    const floors = items.map((f) => Math.floor(f.vendas));
    const resto = alvo - floors.reduce((s, v) => s + v, 0);
    const ordem = items
      .map((f, i) => ({ i, frac: f.vendas - Math.floor(f.vendas) }))
      .sort((a, b) => b.frac - a.frac);
    const disp = floors.slice();
    for (let k = 0; k < resto && k < ordem.length; k++) disp[ordem[k].i] += 1;
    return items.map((f, i) => ({ ...f, vendasDisplay: disp[i] }));
  }, [filiais]);

  // Total geral por dia (agregado de TODOS os itens filtrados) — linha de topo da matriz diária.
  const diarioTotais = useMemo(() => {
    if (!diario || diario.itens.length === 0) return null;
    const porDia: Record<string, number> = {};
    let totalQtde = 0;
    let totalVendas = 0;
    for (const it of diario.itens) {
      totalQtde += it.totalQtde;
      totalVendas += it.totalVendas;
      for (const d of diario.dias) porDia[d] = (porDia[d] ?? 0) + (it.porDia[d] ?? 0);
    }
    return { porDia, totalQtde, totalVendas };
  }, [diario]);

  return (
    <div className={styles.wrapper}>
      {/* Header */}
      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div>
            <div className={styles.titleRow}>
              <h1 className={styles.title}>Produto Giro</h1>
              <span className={`${styles.loadingCue} ${loading ? styles.loadingCueActive : ""}`} role="status">
                <span className={styles.spinner} aria-hidden="true" />
                Carregando…
              </span>
            </div>
            <p className={styles.subtitle}>
              Busque por produto, categoria ou coleção e veja o giro por item × cor: quanto vendeu no período,
              média diária, estoque, em quanto tempo acaba e a compra sugerida — a mesma da Curva A,B,C.
            </p>
          </div>
          <div className={styles.headerRight}>
            <DateRangeFilter label="" value={range} onChange={setRange} />
            <FilialFilter
              companyKey={companyKey}
              value={selectedFilial}
              onChange={setSelectedFilial}
              label=""
              showActiveGroupHint
              companyConfigOverride={(data?.companyConfig as never) ?? null}
            />
            <button
              type="button"
              className={styles.exportBtn}
              onClick={() => { void handleExportXlsx(); }}
              disabled={sortedRows.length === 0}
              title="Exportar a tabela (item × cor) + performance semanal para Excel"
            >
              ⭳ Exportar XLSX
            </button>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className={styles.filterStripCard}>
        <div className={styles.searchBox}>
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Buscar produto, código, cor, categoria…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button type="button" className={styles.searchClear} onClick={() => setSearch("")} aria-label="Limpar busca">
              ×
            </button>
          )}
        </div>

        <button
          type="button"
          className={`${styles.toggleBtn} ${porCor ? styles.toggleBtnActive : ""}`}
          onClick={() => setPorCor((v) => !v)}
          title="Cada linha vira produto + cor"
        >
          Por cor
        </button>

        <button
          type="button"
          className={`${styles.toggleBtn} ${verTransferencias ? styles.toggleBtnActive : ""}`}
          onClick={() => setVerTransferencias((v) => !v)}
          title="Mostra o estoque parado na rede (Matriz + lojas sem giro) que pode cobrir a compra por transferência. Não desconta nada à força — só mostra. Mesma lente da Curva A,B,C."
        >
          Ver transferências{transferLensLoading ? " (…)" : ""}
        </button>

        {companyKey === "nerd" && availableGrupos.length > 0 && (
          <MultiSelectFilter label="Grupo" value={selectedGrupos} options={availableGrupos} onChange={setSelectedGrupos} />
        )}
        {availableSubgrupos.length > 0 && (
          <MultiSelectFilter label="Subgrupo" value={selectedSubgrupos} options={availableSubgrupos} onChange={setSelectedSubgrupos} />
        )}
        {availableGrades.length > 0 && (
          <MultiSelectFilter label="Grade" value={selectedGrades} options={availableGrades} onChange={setSelectedGrades} />
        )}
        {companyKey !== "nerd" && availableColecoes.length > 0 && (
          <MultiSelectFilter label="Coleção" value={selectedColecoes} options={availableColecoes} onChange={setSelectedColecoes} />
        )}

        <div className={styles.filterSpacer} />
        {hasClientFilter && (
          <button type="button" className={styles.clearBtn} onClick={limparFiltros}>
            Limpar filtros
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className={styles.kpiRow}>
        <div className={`${styles.kpiCard} ${styles.kpiCardAccent}`}>
          <span className={styles.kpiLabel}>Vendas no período</span>
          <span className={styles.kpiValue}>{vendasCents}</span>
          <span className={styles.kpiSub}>
            {fmt(kpis.qtde)} un · <span className={styles.kpiSubStrong}>{fmtBRL(kpis.mediaDiariaVal)}/dia</span>
          </span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Média diária</span>
          <span className={styles.kpiValue}>{fmtDec(kpis.mediaDiariaUn)}<span className={styles.kpiValueCents}> un/dia</span></span>
          <span className={styles.kpiSub}>ao longo de {fmt(daysElapsed)} dia(s) do período</span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Estoque</span>
          <span className={styles.kpiValue}>{fmt(kpis.estoque)}<span className={styles.kpiValueCents}> un</span></span>
          <span className={styles.kpiSub}>{selectedFilial ? "na filial selecionada" : "na rede (só saldos positivos)"}</span>
        </div>

        <div className={styles.kpiCard}>
          <span className={styles.kpiLabel}>Projeção</span>
          {kpis.duraDias === null ? (
            <>
              <span className={styles.kpiValue}>—</span>
              <span className={styles.kpiSub}>sem giro no período</span>
            </>
          ) : (
            <>
              <span className={`${styles.kpiValue} ${kpis.duraDias <= 15 ? styles.kpiDanger : kpis.duraDias <= 45 ? styles.kpiWarn : ""}`}>
                {fmt(kpis.duraDias)}<span className={styles.kpiValueCents}> dias</span>
              </span>
              <span className={styles.kpiSub}>
                acaba em <span className={styles.kpiSubStrong}>{kpis.acabaEm ? fmtDataCurta(kpis.acabaEm) : "—"}</span>
              </span>
            </>
          )}
        </div>
      </div>

      {/* Vendas por filial (quebra do total do período + %) */}
      <div className={styles.filialCard}>
        <div className={styles.filialHeader}>
          <h3 className={styles.filialTitle}>Vendas por filial</h3>
          <span className={styles.filialSub}>
            {filiaisLoading
              ? "Calculando…"
              : filiais
                ? `${fmt(filiais.filiais.length)} filial(is) · total ${fmtBRLc(filiais.totalVendas)}`
                : ""}
          </span>
        </div>
        {filiaisLoading && !filiaisDisplay ? (
          <div className={styles.filialEmpty}>Carregando…</div>
        ) : !filiaisDisplay ? (
          <div className={styles.filialEmpty}>Sem vendas no período para os filtros selecionados.</div>
        ) : (
          <div className={styles.filialList}>
            {filiaisDisplay.map((f) => (
              <div key={f.key} className={styles.filialRow}>
                <div className={styles.filialRowLabel}>
                  <span className={styles.filialName}>{f.label}</span>
                  {f.ecommerce && <span className={styles.filialTag}>online</span>}
                </div>
                <div className={styles.filialBarTrack}>
                  <div
                    className={`${styles.filialBar} ${f.ecommerce ? styles.filialBarEcom : ""}`}
                    style={{ width: `${Math.max(1.5, f.pct)}%` }}
                  />
                </div>
                <div className={styles.filialRowVal}>
                  <span className={styles.filialVal}>{fmtBRL(f.vendasDisplay)}</span>
                  <span className={styles.filialPct}>{f.pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                  <span className={styles.filialQtd}>{fmt(f.qtde)} un</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Performance semanal/mensal (comparação de crescimento) */}
      <ProdutoGiroPerformanceChart
        companyKey={companyKey}
        filial={selectedFilial}
        produtoIds={chartProdutoIds}
        escopoFiltrado={hasClientFilter && selectedProdutos.length === 0}
      />

      {/* Barra de seleção por clique */}
      {selectedItemKeys.size > 0 && (
        <div className={styles.selectionBar}>
          <span>
            <strong>{fmt(selectedItemKeys.size)}</strong> item(ns) selecionado(s) — KPIs e gráfico de
            performance filtrados por {selectedProdutos.length} produto(s)
          </span>
          <button type="button" className={styles.clearBtn} onClick={() => setSelectedItemKeys(new Set())}>
            Limpar seleção
          </button>
        </div>
      )}

      {/* Abas */}
      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tabBtn} ${view === "resumo" ? styles.tabBtnActive : ""}`}
          onClick={() => setView("resumo")}
        >
          Resumo (item × cor)
        </button>
        <button
          type="button"
          className={`${styles.tabBtn} ${view === "diario" ? styles.tabBtnActive : ""}`}
          onClick={() => setView("diario")}
        >
          Vendas por dia
        </button>
      </div>

      {/* Tabela — Resumo */}
      {view === "resumo" && (
      <div className={styles.tableCard}>
        {metricsLoading && metricsLoading.feito < metricsLoading.total && (
          <div className={styles.progressBar}>
            <div className={styles.progressFill} style={{ width: `${metricasPct}%` }} />
          </div>
        )}
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thLeft}>Produto</th>
                {porCor && <th className={styles.thLeft}>Cor</th>}
                <th className={styles.thSortable} onClick={() => toggleSort("vendas")}>
                  Vendas <span className={styles.sortArrow}>{sortArrow("vendas")}</span>
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort("qtde")}>
                  Qtd <span className={styles.sortArrow}>{sortArrow("qtde")}</span>
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort("mediaDiaria")}>
                  Média/dia <span className={styles.sortArrow}>{sortArrow("mediaDiaria")}</span>
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort("estoque")}>
                  Estoque <span className={styles.sortArrow}>{sortArrow("estoque")}</span>
                </th>
                <th className={styles.thSortable} onClick={() => toggleSort("dura")}>
                  Dura <span className={styles.sortArrow}>{sortArrow("dura")}</span>
                </th>
                <th>Acaba em</th>
                <th>Compra sugerida</th>
                {verTransferencias && <th>Transferência</th>}
              </tr>
            </thead>
            <tbody>
              {sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={(porCor ? 9 : 8) + (verTransferencias ? 1 : 0)}>
                    <div className={styles.emptyState}>
                      {loading ? "Carregando dados…" : "Nenhum produto encontrado nos filtros selecionados neste período."}
                    </div>
                  </td>
                </tr>
              ) : (
                sortedRows.map(({ p, estoque, mediaDiariaUn, duraDias, acabaEm }) => {
                  const { ideal, hasLive, semDados } = computeIdealFor(p);
                  // Lente de transferência da linha (só quando o toggle está ligado). Usa a mesma
                  // compra ideal já calculada como "compra original" — igual à Curva A,B,C.
                  const lente =
                    verTransferencias && transferLensIndex && ideal
                      ? applyTransferLens(
                          ideal.compraIdeal,
                          resolveTransferLens(transferLensIndex, p.produto, porCor ? (p.cor ?? null) : null)
                        )
                      : null;
                  const key = rowKey(p.produto, p.cor);
                  const isSelected = selectedItemKeys.has(key);
                  return (
                    <tr
                      key={key}
                      className={`${styles.rowClickable} ${isSelected ? styles.rowSelected : ""}`}
                      onClick={() => toggleItemSelection(key)}
                      title="Clique para ver a performance deste item (clique de novo para tirar)"
                    >
                      <td className={styles.tdProduto}>
                        <div className={styles.produtoName}>{p.descricao || p.produto.trim()}</div>
                        <div className={styles.produtoCode}>{(p.codigoBarra || p.produto).trim()}</div>
                      </td>
                      {porCor && <td className={styles.tdCor}>{p.corDescricao || p.cor || "—"}</td>}
                      <td className={`${styles.num} ${styles.strong}`}>{fmtBRL(p.vendas)}</td>
                      <td className={styles.num}>{fmt(p.qtde)}</td>
                      <td className={styles.num}>{mediaDiariaUn > 0 ? fmtDec(mediaDiariaUn, 2) : <span className={styles.muted}>—</span>}</td>
                      <td className={styles.num}>
                        {(() => {
                          // Detalhamento da REDE inteira: no modo filial vem em estoqueRedePorFilial;
                          // no modo "todas as filiais" o próprio estoquePorFilial já é a rede.
                          const redeFiliais = p.estoqueRedePorFilial ?? p.estoquePorFilial ?? [];
                          const redeTotal =
                            p.estoqueRede ?? redeFiliais.reduce((s, e) => s + Math.max(0, e.qtde), 0);
                          return redeFiliais.length === 0
                            ? fmt(estoque)
                            : renderEstoqueTooltip(estoque, redeFiliais, redeTotal, fmt);
                        })()}
                      </td>
                      <td className={styles.num}>
                        {duraDias === null ? (
                          <span className={styles.muted}>sem giro</span>
                        ) : (
                          <span className={duraClass(duraDias)}>{fmt(duraDias)}d</span>
                        )}
                      </td>
                      <td className={styles.num}>
                        {acabaEm ? fmtDataCurta(acabaEm) : <span className={styles.muted}>—</span>}
                      </td>
                      <td className={styles.num}>
                        <CompraIdealCell
                          ideal={ideal}
                          loading={!hasLive}
                          semDados={semDados}
                          descricao={p.descricao}
                          cor={p.cor}
                          company={companyKey}
                          descontinuado={p.descontinuado}
                        />
                      </td>
                      {verTransferencias && (
                        <td className={styles.num}>
                          {!transferLensIndex ? (
                            <span className={styles.noData}>{transferLensLoading ? "…" : "—"}</span>
                          ) : !lente || lente.disponivelTransferir <= 0 ? (
                            <span className={styles.noData}>—</span>
                          ) : (
                            renderTransferenciaTooltip(lente, fmt)
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className={styles.footNote}>
          {fmt(sortedRows.length)} item(ns){produtosFiltrados.length > MAX_METRICS_ITENS ? ` · compra sugerida calculada para os primeiros ${fmt(MAX_METRICS_ITENS)}` : ""}.
          {" "}Vendas e quantidade seguem a fonte global (idênticas ao Dashboard e à Curva A,B,C).
          {" "}Média diária = qtd vendida ÷ dias do período. Duração/“acaba em” = estoque ÷ média diária.
          {" "}Compra sugerida usa o mesmo motor da Curva A,B,C (ritmo dos últimos 12 meses + trânsito).
        </div>
      </div>
      )}

      {/* Tabela — Vendas por dia (matriz item×cor × dias) */}
      {view === "diario" && (
      <div className={styles.tableCard}>
        {diarioLoading ? (
          <div className={styles.emptyState}>Carregando vendas por dia… (uma consulta por dia do período)</div>
        ) : diarioError ? (
          <div className={styles.emptyState}>{diarioError}</div>
        ) : !diario || diario.itens.length === 0 ? (
          <div className={styles.emptyState}>Sem vendas no período para os filtros selecionados.</div>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={`${styles.table} ${styles.diarioTable}`}>
                <thead>
                  <tr>
                    <th className={`${styles.thLeft} ${styles.diarioStickyProduto}`}>Produto</th>
                    {porCor && <th className={`${styles.thLeft} ${styles.diarioStickyCor}`}>Cor</th>}
                    <th className={styles.diarioTotalCol}>Total</th>
                    {diario.dias.map((d) => (
                      <th key={d} className={styles.diarioDiaCol}>{fmtDiaCurto(d)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {diarioTotais && (
                    <tr className={styles.diarioTotalRow}>
                      <td className={`${styles.tdProduto} ${styles.diarioStickyProduto}`}>
                        <div className={styles.produtoName}>TOTAL GERAL</div>
                        <div className={styles.produtoCode}>{fmt(diario.itens.length)} itens · {fmtBRLc(diarioTotais.totalVendas)}</div>
                      </td>
                      {porCor && <td className={`${styles.tdCor} ${styles.diarioStickyCor}`}>—</td>}
                      <td className={`${styles.num} ${styles.strong} ${styles.diarioTotalCol}`}>{fmt(diarioTotais.totalQtde)}</td>
                      {diario.dias.map((d) => {
                        const q = diarioTotais.porDia[d] ?? 0;
                        return (
                          <td key={d} className={`${styles.num} ${styles.diarioDiaCol} ${q === 0 ? styles.diarioZero : ""}`}>
                            {q === 0 ? "·" : fmt(q)}
                          </td>
                        );
                      })}
                    </tr>
                  )}
                  {diario.itens.map((it) => (
                    <tr key={`${it.produto}||${it.cor}`}>
                      <td className={`${styles.tdProduto} ${styles.diarioStickyProduto}`}>
                        <div className={styles.produtoName}>{it.descricao || it.produto.trim()}</div>
                        <div className={styles.produtoCode}>{(it.codigoBarra || it.produto).trim()}</div>
                      </td>
                      {porCor && <td className={`${styles.tdCor} ${styles.diarioStickyCor}`}>{it.corDescricao || it.cor || "—"}</td>}
                      <td className={`${styles.num} ${styles.strong} ${styles.diarioTotalCol}`}>{fmt(it.totalQtde)}</td>
                      {diario.dias.map((d) => {
                        const q = it.porDia[d] ?? 0;
                        return (
                          <td key={d} className={`${styles.num} ${styles.diarioDiaCol} ${diarioHeatClass(q)}`}>
                            {q === 0 ? "·" : fmt(q)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.footNote}>
              {fmt(diario.itens.length)} item(ns) × {fmt(diario.dias.length)} dia(s). Quantidade líquida vendida por dia
              (venda − trocas), da mesma lógica validada — a soma dos dias bate com o total do período.
              {chartProdutoIds.length === 0 ? " Sem filtro: mostra os itens mais vendidos da rede (top 2.000)." : " Escopo = filtros/seleção da tela."}
            </div>
          </>
        )}
      </div>
      )}
    </div>
  );
}

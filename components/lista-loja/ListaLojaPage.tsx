"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAuth } from "@/components/auth/AuthContext";
import ComprasSalvasListPanel from "@/components/stock/ComprasSalvasListPanel";
import { type CompanyKey } from "@/lib/config/company";
import type { CompraSalvaItemRow } from "@/lib/types/compra-salva";

import styles from "./ListaLojaPage.module.css";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Filial {
  codFilial: string;
  filial: string;
}

const TODAS_FILIAIS_VALUE = "__TODAS__";
const TODAS_FILIAIS_LABEL = "TODAS (visão geral)";

interface Produto {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  linha?: string | null;
  subgrupo?: string | null;
  estoques: Array<{ filial: string; nomeFilial: string; estoque: number }>;
}

interface ListaItem {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  quantidade: number;
  /** QTD vendas 12 meses, snapshot ao adicionar */
  qtde12m?: number | null;
  /** Valor R$ vendas 12 meses, snapshot ao adicionar */
  valor12m?: number | null;
  /** QTD vendas 60 dias, snapshot ao adicionar */
  qtde60d?: number | null;
  /** Vendas no mês atual (para cálculo de Duração), snapshot ao adicionar */
  vendasMesAtual?: number | null;
  /** Custo unitário de reposição, snapshot ao adicionar */
  custoUnit?: number | null;
  /** Estoque na filial da lista, snapshot ao adicionar */
  estoqueFilial?: number | null;
  /** Dias desde a última venda registrada nos últimos 12 meses */
  diasDesdeUltimaVenda?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
}

type Curva = "A" | "B" | "C";

type CurvaInfo = {
  curva: Curva;
  percParticipacao: number;
  percCumulativo: number;
};

interface ListaLoja {
  id: string;
  nome: string;
  username: string;
  filial: string;
  nome_filial: string;
  company: string;
  itens: ListaItem[];
  created_at: string;
  updated_at: string;
}

interface TransferenciaPermissao {
  username: string;
  filiaisOrigem: string[];
  filialAtribuida?: string | null;
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function fetchPermissoes(username: string): Promise<TransferenciaPermissao | null> {
  try {
    const res = await fetch("/api/transferencia-produtos/permissoes", {
      headers: { "x-auth-username": username },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: TransferenciaPermissao | null };
    return json.data || null;
  } catch {
    return null;
  }
}

async function fetchFiliais(companyKey?: string): Promise<Filial[]> {
  try {
    const params = new URLSearchParams();
    if (companyKey) params.set("company", companyKey);
    const res = await fetch(`/api/transferencia-produtos/filiais?${params.toString()}`, { cache: "no-store" });
    if (!res.ok) return [];
    const json = (await res.json()) as { data: Filial[] };
    return json.data || [];
  } catch {
    return [];
  }
}

async function buscarPorCodigoBarras(codigoBarras: string, companyKey?: string) {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim() });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(
    `/api/transferencia-produtos/produto-por-codigo-barras?${params}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data: { produto: string; corProduto: string | null } | null };
  return json.data || null;
}

async function searchProdutos(term: string, companyKey?: string): Promise<Produto[]> {
  if (!term || term.trim().length < 2) return [];
  const params = new URLSearchParams({ q: term.trim(), entrada: "true" });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(`/api/transferencia-produtos/produtos?${params}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: Produto[] };
  return json.data || [];
}

async function fetchListas(company: string, username: string): Promise<ListaLoja[]> {
  const params = new URLSearchParams({ company });
  const res = await fetch(`/api/lista-loja?${params}`, {
    headers: { "x-auth-username": username },
    cache: "no-store",
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: ListaLoja[] };
  return json.data || [];
}

async function salvarLista(
  data: {
    id?: string;
    nome: string;
    filial: string;
    nomeFilial: string;
    company: string;
    itens: ListaItem[];
  },
  username: string
): Promise<{ id: string }> {
  const isNew = !data.id;
  const url = isNew ? "/api/lista-loja" : `/api/lista-loja/${data.id}`;
  const res = await fetch(url, {
    method: isNew ? "POST" : "PUT",
    headers: { "Content-Type": "application/json", "x-auth-username": username },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = (await res.json()) as { error: string };
    throw new Error(err.error || "Erro ao salvar lista");
  }
  const json = (await res.json()) as { data: { id: string } };
  return json.data;
}

async function deletarLista(id: string, username: string): Promise<void> {
  await fetch(`/api/lista-loja/${id}`, {
    method: "DELETE",
    headers: { "x-auth-username": username },
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRL2(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function buildDefaultListName(filialNome?: string): string {
  const base = (filialNome || "Lista").trim();
  const now = new Date();
  const d = now.toLocaleDateString("pt-BR");
  const t = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return `${base} ${d} ${t}`;
}

function appendUserToListName(nome: string, username: string): string {
  const base = (nome || "").trim();
  const user = (username || "").trim();
  if (!base) return user ? `Lista ${user}` : "Lista";
  if (!user) return base;
  if (base.toLowerCase().includes(user.toLowerCase())) return base;
  return `${base} · ${user}`;
}

/** Estoque na filial (ou grupo lógico de filiais), alinhado ao Controle de Estoque — não usar só o snapshot da busca de produtos. */
async function fetchEstoqueFilialSum(
  companyKey: string,
  codFilial: string | null,
  produto: string,
  corProduto: string | null
): Promise<number | null> {
  try {
    const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
    if (codFilial && codFilial.trim()) params.set("filial", codFilial.trim());
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ estoque: number }> };
    const rows = json.data || [];
    const sum = rows.reduce((s, r) => s + Math.max(0, Number(r.estoque ?? 0)), 0);
    return Math.round(sum);
  } catch {
    return null;
  }
}

async function fetchVendasItemMetricas(
  companyKey: string,
  codFilial: string | null,
  produto: string,
  corProduto: string | null
): Promise<{ qtde12m: number; qtde60d: number; vendasMesAtual: number; valor12m: number | null; custoUnit: number | null; diasDesdeUltimaVenda: number | null } | null> {
  try {
    const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
    if (codFilial && codFilial.trim()) params.set("filial", codFilial.trim());
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ qtde12m: number; qtde60d: number; qtdeMesAtual?: number; valor12m?: number; custoUnitario?: number; diasDesdeUltimaVenda?: number | null }> };
    const rows = json.data || [];
    const totalValor = rows.reduce((s, r) => s + Number(r.valor12m ?? 0), 0);
    const maxCusto = rows.reduce((max, r) => Math.max(max, Number(r.custoUnitario ?? 0)), 0);
    // Última venda mais recente entre todas as filiais (menor número de dias)
    const diasValidos = rows.map((r) => r.diasDesdeUltimaVenda).filter((d): d is number => d != null);
    const diasDesdeUltimaVenda = diasValidos.length > 0 ? Math.min(...diasValidos) : null;
    return {
      qtde12m: Math.round(rows.reduce((s, r) => s + Number(r.qtde12m ?? 0), 0)),
      qtde60d: Math.round(rows.reduce((s, r) => s + Number(r.qtde60d ?? 0), 0)),
      vendasMesAtual: Math.round(rows.reduce((s, r) => s + Number(r.qtdeMesAtual ?? 0), 0)),
      valor12m: totalValor > 0 ? Math.round(totalValor) : null,
      custoUnit: maxCusto > 0 ? maxCusto : null,
      diasDesdeUltimaVenda,
    };
  } catch {
    return null;
  }
}

async function fetchVendasPorFilialItem(
  companyKey: string,
  codFilial: string | null,
  produto: string,
  corProduto: string | null
): Promise<Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m: number }>> {
  const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
  if (codFilial && codFilial.trim()) params.set("filial", codFilial.trim());
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

function sameCart(a: ListaItem[], b: ListaItem[]): boolean {
  if (a.length !== b.length) return false;
  const key = (i: ListaItem) => buildItemKey(i.produto, i.corProduto);
  const mapA = new Map<string, number>();
  for (const i of a) mapA.set(key(i), i.quantidade);
  for (const i of b) {
    const k = key(i);
    if (!mapA.has(k) || mapA.get(k) !== i.quantidade) return false;
  }
  return true;
}

function normalizeKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function buildItemKey(produto?: string | null, corProduto?: string | null) {
  return `${normalizeKey(produto)}|${normalizeKey(corProduto)}`;
}

function getLimiteDiasReposicao(item: { linha?: string | null; subgrupo?: string | null }) {
  const linha = normalizeKey(item.linha);
  const subgrupo = normalizeKey(item.subgrupo);
  if (linha === "INDIA") return 90;
  const subgrupos120 = new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]);
  if (subgrupos120.has(subgrupo)) return 120;
  return 60;
}

function getSuggestedDelta(item: ListaItem, diasCorridosMes: number): number | null {
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

function hasSugestaoS(item: ListaItem, qtdFinal: number, qtdSuficiente: boolean): boolean {
  if (qtdFinal > 0) return false;
  if (qtdSuficiente) return false;
  const mediaVendasMes = Number(item.qtde12m ?? 0) / 12;
  if (mediaVendasMes < 1) return false;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  return estoqueAtual <= mediaVendasMes * 2;
}

function calcQtdSugestaoS(item: ListaItem): number {
  const mediaVendasMes = Number(item.qtde12m ?? 0) / 12;
  const limiteDias = getLimiteDiasReposicao(item);
  return Math.max(0, Math.ceil((limiteDias / 30) * mediaVendasMes));
}

/**
 * Sugestão E — produto parado por falta de estoque (estoque <= 0 há algum tempo).
 * A média mensal real é subestimada porque o produto ficou sem estoque e não pôde vender.
 * Calcula a velocidade ajustada excluindo o período inativo estimado.
 */
function calcQtdSugestaoEInfo(item: ListaItem): {
  qtd: number;
  velocidadeAjustada: number;
  mesesSemVenda: number;
  mesesAtivos: number;
} | null {
  const qtde12m = Number(item.qtde12m ?? 0);
  if (qtde12m <= 0) return null;
  const dias = item.diasDesdeUltimaVenda;
  if (dias == null || dias < 30) return null; // vendeu recentemente, não está estagnado
  const mesesSemVenda = dias / 30;
  const mesesAtivos = 12 - mesesSemVenda;
  if (mesesAtivos < 1) return null; // período ativo muito curto para extrapolar com confiança
  const velocidadeAjustada = qtde12m / mesesAtivos;
  if (velocidadeAjustada < 0.5) return null; // mesmo ajustado, velocidade insignificante
  const limiteDias = getLimiteDiasReposicao(item);
  const qtd = Math.max(1, Math.ceil((limiteDias / 30) * velocidadeAjustada));
  return { qtd, velocidadeAjustada, mesesSemVenda, mesesAtivos };
}

function hasSugestaoE(item: ListaItem): boolean {
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  if (estoqueAtual > 0) return false; // tem estoque, não é caso de estagnação
  return calcQtdSugestaoEInfo(item) !== null;
}

function getReposicaoCompraView(item: ListaItem, diasCorridosMes: number): {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdSuficiente: boolean;
  semSugestao: boolean;
} {
  const qtdFinal = getSuggestedDelta(item, diasCorridosMes) ?? 0;
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
  if (hasSugestaoS(item, qtdFinal, qtdSuficiente)) {
    return { qtdFinal: 0, qtdS: calcQtdSugestaoS(item), qtdE: 0, qtdSuficiente: false, semSugestao: false };
  }
  const eInfo = hasSugestaoE(item) ? calcQtdSugestaoEInfo(item) : null;
  if (eInfo) {
    return { qtdFinal: 0, qtdS: 0, qtdE: eInfo.qtd, qtdSuficiente: false, semSugestao: false };
  }
  return { qtdFinal: 0, qtdS: 0, qtdE: 0, qtdSuficiente: false, semSugestao: true };
}

function getSuggestedQtyValue(item: ListaItem, diasCorridosMes: number): number {
  const sugestao = getReposicaoCompraView(item, diasCorridosMes);
  if (sugestao.qtdFinal > 0) return sugestao.qtdFinal;
  if (sugestao.qtdS > 0) return sugestao.qtdS;
  if (sugestao.qtdE > 0) return sugestao.qtdE;
  return 0;
}

function calcularCurvasRede(itens: ListaItem[]): Map<string, CurvaInfo> {
  const keyOf = (i: ListaItem) => buildItemKey(i.produto, i.corProduto);
  const base = [...itens]
    .map((item) => ({ item, valor: Number(item.valor12m ?? 0) }))
    .sort((a, b) => b.valor - a.valor);
  const total = base.reduce((s, row) => s + Math.max(0, row.valor), 0);
  let cumulative = 0;
  const out = new Map<string, CurvaInfo>();
  for (const row of base) {
    cumulative += Math.max(0, row.valor);
    const percCum = total > 0 ? cumulative / total : 1;
    const curva: Curva = percCum <= 0.8 ? "A" : percCum <= 0.95 ? "B" : "C";
    out.set(keyOf(row.item), {
      curva,
      percParticipacao: total > 0 ? (Math.max(0, row.valor) / total) * 100 : 0,
      percCumulativo: percCum * 100,
    });
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ListaLojaPageProps {
  companyKey: CompanyKey;
  companyName: string;
  companySlug: string;
}

type Mode = "list" | "editor" | "saved-purchases";

type ListaLojaItensTableProps = {
  companyKey: CompanyKey;
  filialCod: string | null;
  filialNome?: string | null;
  itens: ListaItem[];
  compraView: boolean;
  abcMap: Map<string, CurvaInfo>;
  onMoveItem?: (fromIndex: number, toIndex: number) => void;
  onIncrement: (index: number) => void;
  onDecrement: (index: number) => void;
  onQtyChange: (index: number, qtd: number) => void;
  onRemove: (index: number) => void;
  onOpenColorPicker?: (index: number, mode: "replace" | "add") => void;
  activeColorPickerIndex?: number | null;
  activeColorPickerMode?: "replace" | "add" | null;
  colorPickerOptions?: Produto[];
  colorPickerLoading?: boolean;
  onApplyColor?: (index: number, produtoComCor: Produto) => void;
  onCancelColorPicker?: () => void;
};

function ListaLojaItensTable({
  companyKey,
  filialCod,
  filialNome = null,
  itens,
  compraView,
  abcMap,
  onMoveItem,
  onIncrement,
  onDecrement,
  onQtyChange,
  onRemove,
  onOpenColorPicker,
  activeColorPickerIndex,
  activeColorPickerMode,
  colorPickerOptions = [],
  colorPickerLoading = false,
  onApplyColor,
  onCancelColorPicker,
}: ListaLojaItensTableProps) {
  const filialScopeKey = filialCod && filialCod.trim() ? filialCod.trim() : "__ALL__";
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const diasCorridosMes = new Date().getDate();

  const [estoqueTooltip, setEstoqueTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    filiais: Array<{ filial: string; estoque: number }>;
    total: number;
  }>(null);
  const [vendasTooltip, setVendasTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    mode: "12m" | "60d" | "valor12m";
    filiais: Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m: number }>;
    loading: boolean;
  }>(null);
  const [abcTooltip, setAbcTooltip] = useState<null | {
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
  const vendasHoverKeyRef = useRef<string | null>(null);
  const estoqueHoverKeyRef = useRef<string | null>(null);
  const abcHoverKeyRef = useRef<string | null>(null);
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
  const [sugestaoSTooltip, setSugestaoSTooltip] = useState<null | {
    x: number;
    y: number;
    mediaVendasMes: number;
    estoqueAtual: number;
    limiteDias: number;
    qtdS: number;
  }>(null);
  const [sugestaoETooltip, setSugestaoETooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m: number;
    mesesSemVenda: number;
    mesesAtivos: number;
    velocidadeAjustada: number;
    limiteDias: number;
    qtdE: number;
  }>(null);

  const [estoqueCache, setEstoqueCache] = useState<Record<string, Array<{ filial: string; estoque: number }>>>({});
  const [vendasCache, setVendasCache] = useState<Record<string, Array<{ filial: string; qtde12m: number; qtde60d: number; valor12m: number }>>>({});
  const [liveMetrics, setLiveMetrics] = useState<
    Record<
      string,
      {
        qtde12m: number | null;
        qtde60d: number | null;
        vendasMesAtual: number | null;
        valor12m: number | null;
        custoUnit: number | null;
        estoqueFilial: number | null;
        diasDesdeUltimaVenda: number | null;
      }
    >
  >({});

  useEffect(() => {
    setEstoqueCache({});
    setVendasCache({});
    setLiveMetrics({});
  }, [filialScopeKey]);

  useEffect(() => {
    if (itens.length === 0) return;
    let cancelled = false;
    void Promise.all(
      itens.map(async (item) => {
        const key = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
        const [vendas, estoqueFilial] = await Promise.all([
          fetchVendasItemMetricas(companyKey, filialCod, item.produto, item.corProduto),
          fetchEstoqueFilialSum(companyKey, filialCod, item.produto, item.corProduto),
        ]);
        return {
          key,
          values: {
            qtde12m: vendas?.qtde12m ?? null,
            qtde60d: vendas?.qtde60d ?? null,
            vendasMesAtual: vendas?.vendasMesAtual ?? null,
            valor12m: vendas?.valor12m ?? null,
            custoUnit: vendas?.custoUnit ?? null,
            estoqueFilial,
            diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
          },
        };
      })
    )
      .then((rows) => {
        if (cancelled) return;
        setLiveMetrics((prev) => {
          const next = { ...prev };
          for (const row of rows) next[row.key] = row.values;
          return next;
        });
      })
      .catch(() => {
        // silencioso: mantém fallback visual "—"
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, filialCod, itens]);

  const handleDrop = useCallback(
    (toIndex: number) => {
      if (!onMoveItem || dragIndex === null) return;
      if (dragIndex !== toIndex) onMoveItem(dragIndex, toIndex);
      setDragIndex(null);
      setDragOverIndex(null);
    },
    [onMoveItem, dragIndex]
  );

  if (itens.length === 0) return null;
  return (
    <div className={`${styles.produtosTableWrap} ${compraView ? styles.produtosTableWrapCompra : ""}`}>
      <table className={styles.produtosTable}>
        <thead>
          <tr>
            <th className={styles.colProduto}>Produto</th>
            <th className={styles.colNumeric}>Curva ABC Rede</th>
            <th className={styles.colNumeric}>Vendas 12 meses</th>
            <th className={styles.colNumeric}>QTD 12 meses</th>
            <th className={styles.colNumeric}>Estoque</th>
            <th className={styles.colNumeric}>QTD 60 dias</th>
            <th className={styles.colNumeric}>Duração</th>
            <th className={styles.colNumeric}>Participação</th>
            <th className={styles.colNumeric}>Sugestão de Reposição</th>
            <th className={styles.colNumeric}>Custo Unit.</th>
            <th className={styles.colNumeric}>Custo Total</th>
          </tr>
        </thead>
        <tbody>
          {itens.map((item, idx) => (
            <tr
              key={`${item.produto}-${item.corProduto ?? "null"}-${idx}`}
              draggable={!!onMoveItem}
              className={dragOverIndex === idx ? styles.rowDragOver : undefined}
              onDragStart={() => {
                if (!onMoveItem) return;
                setDragIndex(idx);
                setDragOverIndex(idx);
              }}
              onDragOver={(e) => {
                if (!onMoveItem) return;
                e.preventDefault();
                if (dragOverIndex !== idx) setDragOverIndex(idx);
              }}
              onDrop={(e) => {
                if (!onMoveItem) return;
                e.preventDefault();
                handleDrop(idx);
              }}
              onDragEnd={() => {
                setDragIndex(null);
                setDragOverIndex(null);
              }}
            >
              {(() => {
                const itemKey = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
                const live = liveMetrics[itemKey];
                const valor12m = live?.valor12m ?? item.valor12m ?? null;
                const qtde12m = live?.qtde12m ?? item.qtde12m ?? null;
                const qtde60d = live?.qtde60d ?? item.qtde60d ?? null;
                const vendasMesAtual = live?.vendasMesAtual ?? item.vendasMesAtual ?? null;
                const estoqueFilial = live?.estoqueFilial ?? item.estoqueFilial ?? null;
                const custoUnit = live?.custoUnit ?? item.custoUnit ?? null;
                const diasDesdeUltimaVenda = live?.diasDesdeUltimaVenda ?? item.diasDesdeUltimaVenda ?? null;
                return (
                  <>
              <td>
                <div className={styles.productTitleRow}>
                  {onMoveItem ? (
                    <span className={styles.dragHandle} title="Arraste para reordenar">⋮⋮</span>
                  ) : null}
                  <span className={styles.productTitleName} title={item.descProduto}>
                    {item.descProduto}
                  </span>
                </div>
                <div className={styles.productMeta}>{item.produto}</div>
                <div className={styles.productMeta}>{(item.descCor || "").trim() || "—"}</div>
                {item.codigoBarra ? (
                  <div className={styles.productMeta}>Cód. barras: {item.codigoBarra}</div>
                ) : null}
                {onOpenColorPicker && (
                  <div className={styles.productRowActions}>
                    <button
                      type="button"
                      className={styles.colorChip}
                      onClick={() => onOpenColorPicker(idx, "replace")}
                    >
                      Trocar cor
                    </button>
                    <button
                      type="button"
                      className={styles.colorChip}
                      onClick={() => onOpenColorPicker(idx, "add")}
                    >
                      Adicionar cor
                    </button>
                  </div>
                )}
                {activeColorPickerIndex === idx && (
                  <div className={styles.productRowActions}>
                    <span className={styles.colorPickerLoading}>
                      {activeColorPickerMode === "add" ? "Selecione a nova cor para adicionar:" : "Selecione a nova cor:"}
                    </span>
                  </div>
                )}
                {activeColorPickerIndex === idx && (
                  <div className={styles.productRowActions}>
                    {colorPickerLoading ? (
                      <span className={styles.colorPickerLoading}>Buscando cores...</span>
                    ) : colorPickerOptions.length > 0 ? (
                      <div className={styles.colorChips}>
                        {colorPickerOptions.map((opcao) => (
                          <button
                            key={`${opcao.produto}-${opcao.corProduto ?? "null"}-${opcao.codigoBarra ?? ""}`}
                            className={styles.colorChip}
                            onClick={() => onApplyColor?.(idx, opcao)}
                          >
                            {opcao.descCor || opcao.corProduto}
                          </button>
                        ))}
                        <button
                          type="button"
                          className={styles.colorChipCancel}
                          onClick={onCancelColorPicker}
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className={styles.colorPickerNenhuma}>
                        <span>Nenhuma cor disponível</span>
                        <button
                          type="button"
                          className={styles.colorChipCancel}
                          onClick={onCancelColorPicker}
                        >
                          ✕
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className={styles.productRowActions}>
                  <div className={styles.qtyControl}>
                    <button
                      type="button"
                      className={styles.qtyBtn}
                      onClick={() => onDecrement(idx)}
                      disabled={item.quantidade <= 0}
                    >
                      −
                    </button>
                    <input
                      type="number"
                      className={styles.qtyInput}
                      value={item.quantidade}
                      onChange={(e) => onQtyChange(idx, Math.max(0, parseInt(e.target.value, 10) || 0))}
                      min={0}
                    />
                    <button type="button" className={styles.qtyBtn} onClick={() => onIncrement(idx)}>
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className={styles.removeBtn}
                    onClick={() => onRemove(idx)}
                    title="Remover"
                  >🗑</button>
                </div>
              </td>
              <td className={styles.colNumeric}>
                {(() => {
                  const k = buildItemKey(item.produto, item.corProduto);
                  const abc = abcMap.get(k);
                  const curva = abc?.curva ?? null;
                  if (!curva) {
                    return (
                      <span className={`${styles.abcBadge} ${styles.abcBadgeEmpty}`} title="Sem dados para classificar">
                        —
                      </span>
                    );
                  }
                  return (
                    <span
                      className={`${styles.abcBadge} ${styles[`abcBadge${curva}`]}`}
                      onMouseEnter={async (e) => {
                        const k = buildItemKey(item.produto, item.corProduto);
                        const abc = abcMap.get(k);
                        if (!abc) return;
                        const liveKey = `${filialScopeKey}::${k}`;
                        const liveVal = liveMetrics[liveKey]?.valor12m;
                        const val12m = liveVal ?? Number(item.valor12m ?? 0);
                        const hoverKey = `${filialScopeKey}::abc::${k}`;
                        abcHoverKeyRef.current = hoverKey;
                        // Mostra imediatamente os dados do badge (sem esperar o fetch)
                        setAbcTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          produto: item.produto,
                          cor: item.descCor || "",
                          escopo: filialCod ? "loja" : "geral",
                          periodo: "Últimos 12 meses",
                          regra: "Classificação por faturamento acumulado (A até 80%, B até 95%, C acima de 95%).",
                          curva: abc.curva,
                          valor12m: val12m,
                          percParticipacao: abc.percParticipacao,
                          percCumulativo: abc.percCumulativo,
                          filiaisLoading: true,
                          filiais: [],
                        });
                        // Carrega vendas por filial de TODOS os itens para calcular ABC correto por loja
                        try {
                          const allItemsVendas = await Promise.all(
                            itens.map(async (it) => {
                              const ik = buildItemKey(it.produto, it.corProduto);
                              const cacheKey = `__ALL__::${ik}`;
                              let rows = vendasCache[cacheKey];
                              if (!rows) {
                                rows = await fetchVendasPorFilialItem(companyKey, null, it.produto, it.corProduto);
                                setVendasCache((prev) => ({ ...prev, [cacheKey]: rows }));
                              }
                              return { ik, rows };
                            })
                          );
                          if (abcHoverKeyRef.current !== hoverKey) return;
                          // Agrupa por filial: para cada filial, coleta valor12m de cada item
                          const filialItemsMap = new Map<string, Array<{ ik: string; valor12m: number }>>();
                          for (const { ik, rows } of allItemsVendas) {
                            for (const row of rows) {
                              if (!filialItemsMap.has(row.filial)) filialItemsMap.set(row.filial, []);
                              filialItemsMap.get(row.filial)!.push({ ik, valor12m: row.valor12m });
                            }
                          }
                          // Para cada filial, calcula a posição deste produto na curva ABC daquela filial
                          const filialResults: Array<{ filial: string; curva: Curva; valor12m: number; participacao: number; acumulado: number }> = [];
                          for (const [filial, filialItens] of filialItemsMap) {
                            // Pula a filial selecionada no filtro (já representada pelo badge)
                            if (filialNome && filial === filialNome) continue;
                            const sorted = [...filialItens].sort((a, b) => b.valor12m - a.valor12m);
                            const total = sorted.reduce((s, r) => s + Math.max(0, r.valor12m), 0);
                            let cum = 0;
                            for (const it of sorted) {
                              cum += Math.max(0, it.valor12m);
                              if (it.ik === k) {
                                const percCum = total > 0 ? cum / total : 1;
                                const curvaFilial: Curva = percCum <= 0.8 ? "A" : percCum <= 0.95 ? "B" : "C";
                                filialResults.push({
                                  filial,
                                  curva: curvaFilial,
                                  valor12m: it.valor12m,
                                  participacao: total > 0 ? (Math.max(0, it.valor12m) / total) * 100 : 0,
                                  acumulado: percCum * 100,
                                });
                                break;
                              }
                            }
                          }
                          filialResults.sort((a, b) => b.valor12m - a.valor12m);
                          if (abcHoverKeyRef.current !== hoverKey) return;
                          setAbcTooltip((prev) => prev ? { ...prev, filiaisLoading: false, filiais: filialResults } : null);
                        } catch {
                          if (abcHoverKeyRef.current !== hoverKey) return;
                          setAbcTooltip((prev) => prev ? { ...prev, filiaisLoading: false } : null);
                        }
                      }}
                      onMouseLeave={() => {
                        abcHoverKeyRef.current = null;
                        setAbcTooltip(null);
                      }}
                      title="Curva ABC; passe o mouse para ver a posição na lista por filial"
                    >
                      {curva}
                    </span>
                  );
                })()}
              </td>
              <td className={styles.colNumeric}>
                <span
                  className={styles.cellMetric}
                  onMouseEnter={async (e) => {
                    const cacheKey = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
                    vendasHoverKeyRef.current = `${cacheKey}::12m`;
                    const cached = vendasCache[cacheKey];
                    if (cached) {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::12m`) return;
                      setVendasTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: item.descCor || "",
                        mode: "valor12m",
                        filiais: cached,
                        loading: false,
                      });
                      return;
                    }
                    setVendasTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      produto: item.produto,
                      cor: item.descCor || "",
                      mode: "valor12m",
                      filiais: [],
                      loading: true,
                    });
                    try {
                      const rows = await fetchVendasPorFilialItem(companyKey, filialCod, item.produto, item.corProduto);
                      if (vendasHoverKeyRef.current !== `${cacheKey}::12m`) return;
                      setVendasCache((prev) => ({ ...prev, [cacheKey]: rows }));
                      setVendasTooltip((prev) =>
                        vendasHoverKeyRef.current === `${cacheKey}::12m` && prev
                          ? { ...prev, filiais: rows, loading: false }
                          : null
                      );
                    } catch {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::12m`) return;
                      setVendasTooltip((prev) => (prev ? { ...prev, loading: false } : null));
                    }
                  }}
                  onMouseLeave={() => {
                    vendasHoverKeyRef.current = null;
                    setVendasTooltip(null);
                  }}
                >
                  {valor12m != null ? fmtBRL(valor12m) : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span
                  className={styles.cellMetric}
                  onMouseEnter={async (e) => {
                    const cacheKey = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
                    vendasHoverKeyRef.current = `${cacheKey}::valor12m`;
                    const cached = vendasCache[cacheKey];
                    if (cached) {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::valor12m`) return;
                      setVendasTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: item.descCor || "",
                        mode: "12m",
                        filiais: cached,
                        loading: false,
                      });
                      return;
                    }
                    setVendasTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      produto: item.produto,
                      cor: item.descCor || "",
                      mode: "12m",
                      filiais: [],
                      loading: true,
                    });
                    try {
                      const rows = await fetchVendasPorFilialItem(companyKey, filialCod, item.produto, item.corProduto);
                      if (vendasHoverKeyRef.current !== `${cacheKey}::valor12m`) return;
                      setVendasCache((prev) => ({ ...prev, [cacheKey]: rows }));
                      setVendasTooltip((prev) =>
                        vendasHoverKeyRef.current === `${cacheKey}::valor12m` && prev
                          ? { ...prev, filiais: rows, loading: false }
                          : null
                      );
                    } catch {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::valor12m`) return;
                      setVendasTooltip((prev) => (prev ? { ...prev, loading: false } : null));
                    }
                  }}
                  onMouseLeave={() => {
                    vendasHoverKeyRef.current = null;
                    setVendasTooltip(null);
                  }}
                >
                  {qtde12m != null ? fmt(qtde12m) : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span
                  className={styles.cellMetric}
                  onMouseEnter={async (e) => {
                    const cacheKey = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
                    estoqueHoverKeyRef.current = cacheKey;
                    const cached = estoqueCache[cacheKey];
                    const showTooltip = (rows: Array<{ filial: string; estoque: number }>) => {
                      if (estoqueHoverKeyRef.current !== cacheKey) return;
                      setEstoqueTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: item.descCor || "",
                        filiais: rows,
                        total: rows.reduce((s, r) => s + Math.max(0, Number(r.estoque ?? 0)), 0),
                      });
                    };
                    if (cached) {
                      showTooltip(cached);
                      return;
                    }
                    try {
                      const params = new URLSearchParams({
                        company: companyKey,
                        produto: item.produto.trim(),
                      });
                      if (filialCod && filialCod.trim()) params.set("filial", filialCod.trim());
                      if (item.corProduto) params.set("corProduto", item.corProduto.trim());
                      const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
                      const json = (await res.json()) as { data?: Array<{ filial: string; estoque: number }> };
                      const rows = (json.data || []).map((r) => ({ filial: r.filial, estoque: Number(r.estoque ?? 0) }));
                      if (estoqueHoverKeyRef.current !== cacheKey) return;
                      setEstoqueCache((prev) => ({ ...prev, [cacheKey]: rows }));
                      showTooltip(rows);
                    } catch {
                      showTooltip([]);
                    }
                  }}
                  onMouseLeave={() => {
                    estoqueHoverKeyRef.current = null;
                    setEstoqueTooltip(null);
                  }}
                >
                  {estoqueFilial != null ? fmt(estoqueFilial) : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span
                  className={styles.cellMetric}
                  onMouseEnter={async (e) => {
                    const cacheKey = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
                    vendasHoverKeyRef.current = `${cacheKey}::60d`;
                    const cached = vendasCache[cacheKey];
                    if (cached) {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::60d`) return;
                      setVendasTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: item.descCor || "",
                        mode: "60d",
                        filiais: cached,
                        loading: false,
                      });
                      return;
                    }
                    setVendasTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      produto: item.produto,
                      cor: item.descCor || "",
                      mode: "60d",
                      filiais: [],
                      loading: true,
                    });
                    try {
                      const rows = await fetchVendasPorFilialItem(companyKey, filialCod, item.produto, item.corProduto);
                      if (vendasHoverKeyRef.current !== `${cacheKey}::60d`) return;
                      setVendasCache((prev) => ({ ...prev, [cacheKey]: rows }));
                      setVendasTooltip((prev) =>
                        vendasHoverKeyRef.current === `${cacheKey}::60d` && prev
                          ? { ...prev, filiais: rows, loading: false }
                          : null
                      );
                    } catch {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::60d`) return;
                      setVendasTooltip((prev) => (prev ? { ...prev, loading: false } : null));
                    }
                  }}
                  onMouseLeave={() => {
                    vendasHoverKeyRef.current = null;
                    setVendasTooltip(null);
                  }}
                >
                  {qtde60d != null ? fmt(qtde60d) : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span
                  className={styles.cellMetric}
                  onMouseEnter={(e) => {
                    const limiteDias = getLimiteDiasReposicao(item);
                    const linha = normalizeKey(item.linha);
                    const subgrupo = normalizeKey(item.subgrupo);
                    const regra =
                      linha === "INDIA"
                        ? "Linha Índia"
                        : new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]).has(subgrupo)
                          ? `Subgrupo: ${item.subgrupo ?? ""}`.trim()
                          : "Padrão";
                    const vendasMes = vendasMesAtual ?? 0;
                    const diasCorridos = new Date().getDate();
                    const consumoDiario = vendasMes > 0 && diasCorridos > 0 ? vendasMes / diasCorridos : 0;
                    const estoque = estoqueFilial ?? 0;
                    const duracaoDias = consumoDiario > 0 ? Math.round(estoque / consumoDiario) : 0;
                    setDuracaoTooltip({
                      x: e.clientX,
                      y: e.clientY,
                      regra,
                      limiteDias,
                      vendasMesAtual: vendasMes,
                      diasCorridos,
                      consumoDiario,
                      estoqueAtual: estoque,
                      duracaoDias,
                    });
                  }}
                  onMouseLeave={() => setDuracaoTooltip(null)}
                >
                  {(() => {
                    const vendasMes = vendasMesAtual ?? 0;
                    const diasCorridos = new Date().getDate();
                    const consumoDiario = vendasMes > 0 && diasCorridos > 0 ? vendasMes / diasCorridos : 0;
                    const estoque = estoqueFilial ?? 0;
                    if (consumoDiario <= 0 || estoque <= 0) return "—";
                    const dias = Math.round(estoque / consumoDiario);
                    if (dias >= 365) return `${Math.round(dias / 30)} meses`;
                    return `${dias} dias`;
                  })()}
                </span>
              </td>
              <td className={styles.colNumeric}>
                {(() => {
                  const k = buildItemKey(item.produto, item.corProduto);
                  const abc = abcMap.get(k);
                  if (!abc) return <span className={styles.cellMetric}>—</span>;
                  const perc = abc.percParticipacao;
                  return (
                    <div className={styles.percBar}>
                      <div className={styles.percBarTrack}>
                        <div className={styles.percBarFill} style={{ width: `${Math.min(100, perc)}%` }} />
                      </div>
                      <span className={styles.percText}>{perc.toFixed(1)}%</span>
                    </div>
                  );
                })()}
              </td>
              <td className={styles.colNumeric}>
                {(() => {
                  const sugestao = getReposicaoCompraView(
                    { ...item, vendasMesAtual, estoqueFilial, qtde12m, diasDesdeUltimaVenda },
                    diasCorridosMes
                  );
                  if (sugestao.qtdFinal > 0) {
                    const vendasMes = Number(vendasMesAtual ?? 0);
                    const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                    const estoqueAtual = Number(estoqueFilial ?? 0);
                    const limiteDias = getLimiteDiasReposicao(item);
                    const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
                    return (
                      <span
                        className={styles.reporAdd}
                        onMouseEnter={(e) =>
                          setSugestaoTooltip({
                            x: e.clientX,
                            y: e.clientY,
                            titulo: "Sugestão de reposição (cálculo principal)",
                            regra: "Qtd = consumo/dia × (limite de cobertura - duração atual).",
                            limiteDias,
                            vendasMesAtual: vendasMes,
                            diasCorridos: diasCorridosMes,
                            consumoDiario,
                            estoqueAtual,
                            duracaoAtual,
                            qtdCalculada: sugestao.qtdFinal,
                          })
                        }
                        onMouseLeave={() => setSugestaoTooltip(null)}
                      >
                        {fmt(sugestao.qtdFinal)}
                      </span>
                    );
                  }
                  if (sugestao.qtdS > 0) {
                    const mediaVendasMes = Number(qtde12m ?? 0) / 12;
                    const limiteDias = getLimiteDiasReposicao(item);
                    return (
                      <span className={styles.reporAdd}>
                        {fmt(sugestao.qtdS)}{" "}
                        <span
                          onMouseEnter={(e) =>
                            setSugestaoSTooltip({
                              x: e.clientX,
                              y: e.clientY,
                              mediaVendasMes,
                              estoqueAtual: Number(estoqueFilial ?? 0),
                              limiteDias,
                              qtdS: sugestao.qtdS,
                            })
                          }
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
                      </span>
                    );
                  }
                  if (sugestao.qtdE > 0) {
                    const eInfo = calcQtdSugestaoEInfo({ ...item, qtde12m, diasDesdeUltimaVenda });
                    const limiteDias = getLimiteDiasReposicao(item);
                    return (
                      <span className={styles.reporAdd}>
                        {fmt(sugestao.qtdE)}{" "}
                        <span
                          onMouseEnter={(e) =>
                            eInfo && setSugestaoETooltip({
                              x: e.clientX,
                              y: e.clientY,
                              qtde12m: Number(qtde12m ?? 0),
                              mesesSemVenda: eInfo.mesesSemVenda,
                              mesesAtivos: eInfo.mesesAtivos,
                              velocidadeAjustada: eInfo.velocidadeAjustada,
                              limiteDias,
                              qtdE: sugestao.qtdE,
                            })
                          }
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
                      </span>
                    );
                  }
                  if (sugestao.semSugestao) {
                    return <span className={styles.cellMetric}>—</span>;
                  }
                  const vendasMes = Number(vendasMesAtual ?? 0);
                  const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                  const estoqueAtual = Number(estoqueFilial ?? 0);
                  const limiteDias = getLimiteDiasReposicao(item);
                  const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
                  return (
                    <span
                      className={styles.reporOk}
                      onMouseEnter={(e) =>
                        setSugestaoTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          titulo: "Quantidade suficiente",
                          regra: "Sem reposição: duração atual já atende o limite de cobertura.",
                          limiteDias,
                          vendasMesAtual: vendasMes,
                          diasCorridos: diasCorridosMes,
                          consumoDiario,
                          estoqueAtual,
                          duracaoAtual,
                          qtdCalculada: 0,
                        })
                      }
                      onMouseLeave={() => setSugestaoTooltip(null)}
                    >
                      Quantidade suficiente
                    </span>
                  );
                })()}
              </td>
              <td className={styles.colNumeric}>
                <span className={styles.cellMetric}>
                  {custoUnit != null && custoUnit > 0 ? fmtBRL2(custoUnit) : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span className={styles.cellMetric}>
                  {(() => {
                    if (custoUnit == null || custoUnit <= 0) return "—";
                    const sugestao = getReposicaoCompraView(
                      { ...item, vendasMesAtual, estoqueFilial, qtde12m },
                      diasCorridosMes
                    );
                    const qtdBase = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;
                    if (!qtdBase || qtdBase <= 0) return "—";
                    return fmtBRL(qtdBase * custoUnit);
                  })()}
                </span>
              </td>
                  </>
                );
              })()}
            </tr>
          ))}
        </tbody>
      </table>
      {estoqueTooltip && (
        <div className={styles.metricTooltip} style={{ left: estoqueTooltip.x + 12, top: estoqueTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Estoque por filial</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {estoqueTooltip.produto}</div>
          {estoqueTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {estoqueTooltip.cor}</div>}
          <div className={styles.metricTooltipDivider} />
          {estoqueTooltip.filiais.length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem dados de estoque por filial.</div>
          ) : (
            <>
              {estoqueTooltip.filiais.map((row) => (
                <div key={row.filial} className={styles.metricTooltipRow}>
                  <span>{row.filial}</span>
                  <span>{fmt(row.estoque)}</span>
                </div>
              ))}
              <div className={styles.metricTooltipTotal}>
                <span>Total</span>
                <span>{fmt(estoqueTooltip.total)}</span>
              </div>
            </>
          )}
        </div>
      )}
      {vendasTooltip && (
        <div className={styles.metricTooltip} style={{ left: vendasTooltip.x + 12, top: vendasTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>
            {vendasTooltip.mode === "12m"
              ? "Vendas 12 meses por filial"
              : vendasTooltip.mode === "60d"
                ? "Vendas 60 dias por filial"
                : "Valor vendas 12 meses por filial"}
          </div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {vendasTooltip.produto}</div>
          {vendasTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {vendasTooltip.cor}</div>}
          <div className={styles.metricTooltipDivider} />
          {vendasTooltip.loading ? (
            <div className={styles.metricTooltipLine}>Carregando...</div>
          ) : vendasTooltip.filiais.length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem vendas no período.</div>
          ) : (
            <>
              {vendasTooltip.filiais.map((row) => (
                <div key={row.filial} className={styles.metricTooltipRow}>
                  <span>{row.filial}</span>
                  <span>
                    {vendasTooltip.mode === "valor12m"
                      ? fmtBRL(row.valor12m)
                      : fmt(vendasTooltip.mode === "12m" ? row.qtde12m : row.qtde60d)}
                  </span>
                </div>
              ))}
              <div className={styles.metricTooltipTotal}>
                <span>Total</span>
                <span>
                  {vendasTooltip.mode === "valor12m"
                    ? fmtBRL(vendasTooltip.filiais.reduce((s, row) => s + Number(row.valor12m ?? 0), 0))
                    : fmt(
                        vendasTooltip.filiais.reduce(
                          (s, row) => s + Number(vendasTooltip.mode === "12m" ? row.qtde12m : row.qtde60d),
                          0
                        )
                      )}
                </span>
              </div>
            </>
          )}
        </div>
      )}
      {abcTooltip && (
        <div className={styles.metricTooltip} style={{ left: abcTooltip.x + 12, top: abcTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Curva ABC (detalhe da lógica)</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {abcTooltip.produto}</div>
          {abcTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {abcTooltip.cor}</div>}
          <div className={styles.metricTooltipMeta}><strong>Escopo:</strong> {abcTooltip.escopo === "geral" ? "Rede (todas as filiais)" : "Loja selecionada"}</div>
          <div className={styles.metricTooltipMeta}><strong>Período:</strong> {abcTooltip.periodo}</div>
          <div className={styles.metricTooltipLine} style={{ marginTop: 6 }}>{abcTooltip.regra}</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipRow}>
            <span>Valor 12 meses</span>
            <span>{fmtBRL(abcTooltip.valor12m)}</span>
          </div>
          <div className={styles.metricTooltipRow}>
            <span>Participação na lista</span>
            <span>{abcTooltip.percParticipacao.toFixed(1)}%</span>
          </div>
          <div className={styles.metricTooltipRow}>
            <span>Acumulado</span>
            <span>{abcTooltip.percCumulativo.toFixed(1)}%</span>
          </div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipRow}>
            <span>Classificação ({abcTooltip.escopo === "geral" ? "rede" : "loja selecionada"})</span>
            <span className={`${styles.abcBadgeMini} ${styles[`abcBadge${abcTooltip.curva}`]}`}>{abcTooltip.curva}</span>
          </div>
          {/* Breakdown por filial (posição do produto na lista de cada loja) */}
          {abcTooltip.filiaisLoading ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#94a3b8" }}>Carregando outras lojas...</div>
            </>
          ) : abcTooltip.filiais.filter((r) => r.valor12m > 0).length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>
                Posição na lista por loja:
              </div>
              {abcTooltip.filiais.filter((r) => r.valor12m > 0).map((row) => (
                <div key={row.filial} className={styles.metricTooltipRow}>
                  <span>{row.filial}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 11, color: "#cbd5e1" }}>
                      {row.participacao.toFixed(1)}% | acum. {row.acumulado.toFixed(1)}%
                    </span>
                    <span className={`${styles.abcBadgeMini} ${styles[`abcBadge${row.curva}`]}`}>{row.curva}</span>
                  </span>
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoTooltip && (
        <div className={styles.metricTooltip} style={{ left: sugestaoTooltip.x + 12, top: sugestaoTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>{sugestaoTooltip.titulo}</div>
          <div className={styles.metricTooltipLine}>{sugestaoTooltip.regra}</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Vendas mês:</strong> {fmt(sugestaoTooltip.vendasMesAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Dias corridos:</strong> {sugestaoTooltip.diasCorridos}</div>
          <div className={styles.metricTooltipLine}><strong>Consumo/dia:</strong> {sugestaoTooltip.consumoDiario.toFixed(2)} un</div>
          <div className={styles.metricTooltipLine}><strong>Estoque atual:</strong> {fmt(sugestaoTooltip.estoqueAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Duração atual:</strong> {Math.max(0, Math.round(sugestaoTooltip.duracaoAtual))} dias</div>
          <div className={styles.metricTooltipLine}><strong>Limite do item:</strong> {sugestaoTooltip.limiteDias} dias</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(sugestaoTooltip.qtdCalculada)} un</div>
        </div>
      )}
      {sugestaoSTooltip && (
        <div className={styles.metricTooltip} style={{ left: sugestaoSTooltip.x + 12, top: sugestaoSTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Regra S (mesma lógica da ABC)</div>
          <div className={styles.metricTooltipLine}><strong>Média de vendas:</strong> {sugestaoSTooltip.mediaVendasMes.toFixed(1)} un/mês</div>
          <div className={styles.metricTooltipLine}><strong>Estoque atual:</strong> {fmt(sugestaoSTooltip.estoqueAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Cobertura mínima:</strong> {sugestaoSTooltip.limiteDias} dias</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(sugestaoSTooltip.qtdS)} un</div>
          <div className={styles.metricTooltipLine}>
            = {(sugestaoSTooltip.limiteDias / 30).toFixed(1)} meses × {sugestaoSTooltip.mediaVendasMes.toFixed(1)} un/mês
          </div>
        </div>
      )}
      {sugestaoETooltip && (
        <div className={styles.metricTooltip} style={{ left: sugestaoETooltip.x + 12, top: sugestaoETooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Regra E — Produto parado por falta de estoque</div>
          <div className={styles.metricTooltipLine} style={{ color: "#94a3b8", fontSize: 11 }}>
            A média mensal estava subestimada porque o produto ficou sem estoque.
            A velocidade real é calculada excluindo o período inativo.
          </div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Vendas nos últimos 12m:</strong> {fmt(sugestaoETooltip.qtde12m)} un</div>
          <div className={styles.metricTooltipLine}><strong>Sem vendas há:</strong> ~{Math.round(sugestaoETooltip.mesesSemVenda)} meses ({Math.round(sugestaoETooltip.mesesSemVenda * 30)} dias)</div>
          <div className={styles.metricTooltipLine}><strong>Período ativo estimado:</strong> ~{sugestaoETooltip.mesesAtivos.toFixed(1)} meses</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Velocidade ajustada:</strong> {sugestaoETooltip.velocidadeAjustada.toFixed(2)} un/mês</div>
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#94a3b8" }}>
            = {fmt(sugestaoETooltip.qtde12m)} un ÷ {sugestaoETooltip.mesesAtivos.toFixed(1)} meses ativos
          </div>
          <div className={styles.metricTooltipLine}><strong>Cobertura mínima:</strong> {sugestaoETooltip.limiteDias} dias ({(sugestaoETooltip.limiteDias / 30).toFixed(1)} meses)</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(sugestaoETooltip.qtdE)} un</div>
          <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#94a3b8" }}>
            = ⌈{sugestaoETooltip.velocidadeAjustada.toFixed(2)} × {(sugestaoETooltip.limiteDias / 30).toFixed(1)}⌉ = {fmt(sugestaoETooltip.qtdE)}
          </div>
        </div>
      )}
      {duracaoTooltip && (
        <div className={styles.metricTooltip} style={{ left: duracaoTooltip.x + 12, top: duracaoTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Duração de estoque</div>
          <div className={styles.metricTooltipLine}><strong>Regra:</strong> {duracaoTooltip.regra}</div>
          <div className={styles.metricTooltipLine}><strong>Limite do item:</strong> {duracaoTooltip.limiteDias} dias</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Vendas mês:</strong> {fmt(duracaoTooltip.vendasMesAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Dias corridos:</strong> {duracaoTooltip.diasCorridos}</div>
          <div className={styles.metricTooltipLine}><strong>Consumo/dia:</strong> {duracaoTooltip.consumoDiario.toFixed(2)} un</div>
          <div className={styles.metricTooltipLine}><strong>Estoque atual:</strong> {fmt(duracaoTooltip.estoqueAtual)} un</div>
          <div className={styles.metricTooltipLine}><strong>Duração:</strong> {duracaoTooltip.duracaoDias} dias</div>
        </div>
      )}
    </div>
  );
}

export default function ListaLojaPage({ companyKey, companyName, companySlug }: ListaLojaPageProps) {
  const { user, isLoading: authLoading } = useAuth();

  const [mode, setMode] = useState<Mode>("list");

  // Lists view
  const [listas, setListas] = useState<ListaLoja[]>([]);
  const [loadingListas, setLoadingListas] = useState(false);

  // Editor state
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [nomeLista, setNomeLista] = useState("");
  const [filiais, setFiliais] = useState<Filial[]>([]);
  const [filiaisDisponiveis, setFiliaisDisponiveis] = useState<Filial[]>([]);
  const [filialSelecionada, setFilialSelecionada] = useState<Filial | null>(null);
  const [itens, setItens] = useState<ListaItem[]>([]);
  const itensRef = useRef<ListaItem[]>(itens);
  itensRef.current = itens;

  // Modal adicionar produto
  const [modalAberto, setModalAberto] = useState(false);
  const [modalConfirmarFechar, setModalConfirmarFechar] = useState(false);
  const [itensModal, setItensModal] = useState<ListaItem[]>([]);

  // Search (dentro do modal)
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const [batchCodes, setBatchCodes] = useState("");
  const [importandoBatch, setImportandoBatch] = useState(false);

  // Color picker (dentro do modal)
  const [colorPickerProduto, setColorPickerProduto] = useState<Produto | null>(null);
  const [colorPickerOpcoes, setColorPickerOpcoes] = useState<Produto[]>([]);
  const [loadingColorPicker, setLoadingColorPicker] = useState(false);

  // UI
  const [salvando, setSalvando] = useState(false);
  const [notificacao, setNotificacao] = useState<{ mensagem: string; tipo: "success" | "error" } | null>(null);
  const [editorColorPickerIndex, setEditorColorPickerIndex] = useState<number | null>(null);
  const [editorColorPickerMode, setEditorColorPickerMode] = useState<"replace" | "add" | null>(null);
  const [editorColorPickerOpcoes, setEditorColorPickerOpcoes] = useState<Produto[]>([]);
  const [editorColorPickerLoading, setEditorColorPickerLoading] = useState(false);
  const [modalColorPickerIndex, setModalColorPickerIndex] = useState<number | null>(null);
  const [modalColorPickerMode, setModalColorPickerMode] = useState<"replace" | "add" | null>(null);
  const [modalColorPickerOpcoes, setModalColorPickerOpcoes] = useState<Produto[]>([]);
  const [modalColorPickerLoading, setModalColorPickerLoading] = useState(false);
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [permissoesCarregadas, setPermissoesCarregadas] = useState(false);
  const filialConsultaSelecionada =
    filialSelecionada?.codFilial === TODAS_FILIAIS_VALUE ? null : (filialSelecionada?.codFilial?.trim() || null);


  const notifTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ─── Notification ───────────────────────────────────────────────────────────

  const mostrarNotificacao = useCallback(
    (mensagem: string, tipo: "success" | "error" = "success") => {
      if (notifTimeoutRef.current) clearTimeout(notifTimeoutRef.current);
      setNotificacao({ mensagem, tipo });
      notifTimeoutRef.current = setTimeout(() => setNotificacao(null), 3000);
    },
    []
  );

  // ─── Load permissions ───────────────────────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;
    if (!user?.username) { setPermissoesCarregadas(true); return; }
    fetchPermissoes(user.username)
      .then((p) => { setPermissoes(p); setPermissoesCarregadas(true); })
      .catch(() => setPermissoesCarregadas(true));
  }, [user?.username, authLoading]);

  // ─── Load filiais ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!permissoesCarregadas) return;
    fetchFiliais(companyKey).then((data) => {
      setFiliais(data);
      let disponiveis = data;
      if (permissoes) {
        const resolveFiliais = (lista: string[]) => {
          if (lista.length > 0) {
            return data.filter((f) =>
              lista.some((cod) => f.codFilial.trim() === (cod || "").trim())
            );
          }
          if (permissoes.filialAtribuida) {
            return data.filter(
              (f) => f.codFilial.trim() === permissoes.filialAtribuida!.trim()
            );
          }
          return data;
        };
        disponiveis = resolveFiliais(permissoes.filiaisOrigem || []);
      }
      const semMatriz = disponiveis.filter((f) => f.codFilial.trim().toUpperCase() !== "NERD" && f.filial.trim().toUpperCase() !== "MATRIZ");
      const comTodas =
        semMatriz.length > 0
          ? [{ codFilial: TODAS_FILIAIS_VALUE, filial: TODAS_FILIAIS_LABEL }, ...semMatriz]
          : semMatriz;
      setFiliaisDisponiveis(comTodas);
      if (comTodas.length > 0) {
        setFilialSelecionada((prev) => {
          if (!prev) return comTodas[0];
          const match = comTodas.find((f) => f.codFilial === prev.codFilial);
          return match ?? comTodas[0];
        });
      }
    });
  }, [permissoes, permissoesCarregadas, companyKey]);

  // Ao mudar a loja ou abrir outra lista para edição, recalcula vendas 90d e estoque (mesma lógica do Controle de Estoque: grupos de filial, etc.)
  useEffect(() => {
    if (mode !== "editor") return;
    if (itensRef.current.length === 0) return;

    const itemKey = (i: ListaItem) => buildItemKey(i.produto, i.corProduto);

    let cancelled = false;
    void (async () => {
      const snapshot = itensRef.current;
      const keys = snapshot.map(itemKey);
      const metrics = await Promise.all(
        snapshot.map(async (item) => {
          const [vendas, estoqueFilial] = await Promise.all([
            fetchVendasItemMetricas(companyKey, filialConsultaSelecionada, item.produto, item.corProduto),
            fetchEstoqueFilialSum(companyKey, filialConsultaSelecionada, item.produto, item.corProduto),
          ]);
          return {
            qtde12m: vendas?.qtde12m ?? null,
            qtde60d: vendas?.qtde60d ?? null,
            vendasMesAtual: vendas?.vendasMesAtual ?? null,
            valor12m: vendas?.valor12m ?? null,
            custoUnit: vendas?.custoUnit ?? null,
            estoqueFilial,
            diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
          };
        })
      );
      if (cancelled) return;
      const metricsByKey = new Map(keys.map((k, i) => [k, metrics[i]!]));
      setItens((current) =>
        current.map((it) => {
          const m = metricsByKey.get(itemKey(it));
          if (!m) return it;
          const merged = { ...it, ...m };
          return {
            ...merged,
            quantidade: getSuggestedQtyValue(merged, new Date().getDate()),
          };
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [filialConsultaSelecionada, mode, companyKey, editingId]);

  // ─── Load lists ─────────────────────────────────────────────────────────────

  const carregarListas = useCallback(async () => {
    if (!user?.username) return;
    setLoadingListas(true);
    try {
      const data = await fetchListas(companyKey, user.username);
      setListas(data);
    } catch {
      // silent
    } finally {
      setLoadingListas(false);
    }
  }, [companyKey, user?.username]);

  useEffect(() => {
    if (mode === "list" && permissoesCarregadas && user?.username) carregarListas();
  }, [mode, permissoesCarregadas, user?.username, carregarListas]);

  // ─── Product search with debounce (modal) ───────────────────────────────────

  useEffect(() => {
    if (!modalAberto) return;
    if (!searchTerm || searchTerm.trim().length < 2) {
      setProdutos([]);
      return;
    }
    let active = true;
    setLoadingProdutos(true);
    const timeoutId = setTimeout(async () => {
      try {
        const term = searchTerm.trim();
        let results: Produto[] = [];

        if (term.length >= 3) {
          const porBarra = await buscarPorCodigoBarras(term, companyKey);
          if (porBarra) {
            results = await searchProdutos(porBarra.produto, companyKey);
          }
        }

        if (results.length === 0) {
          results = await searchProdutos(term, companyKey);
        }

        if (active) setProdutos(results);
      } catch {
        if (active) setProdutos([]);
      } finally {
        if (active) setLoadingProdutos(false);
      }
    }, 300);

    return () => { active = false; clearTimeout(timeoutId); };
  }, [searchTerm, companyKey, modalAberto]);

  // reset color picker quando search muda
  useEffect(() => {
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [searchTerm]);

  // ─── Color picker options ───────────────────────────────────────────────────

  useEffect(() => {
    if (!colorPickerProduto) { setColorPickerOpcoes([]); return; }
    const coresNoResultado = produtos.filter(
      (p) => p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null
    );
    if (coresNoResultado.length > 0) {
      setColorPickerOpcoes(coresNoResultado);
      return;
    }
    let cancelled = false;
    setLoadingColorPicker(true);
    searchProdutos(colorPickerProduto.produto, companyKey)
      .then((result) => {
        if (!cancelled)
          setColorPickerOpcoes(
            result.filter((p) => p.produto.trim() === colorPickerProduto.produto.trim() && p.corProduto !== null)
          );
      })
      .catch(() => { if (!cancelled) setColorPickerOpcoes([]); })
      .finally(() => { if (!cancelled) setLoadingColorPicker(false); });
    return () => { cancelled = true; };
  }, [colorPickerProduto, companyKey, produtos]);

  // ─── Modal: open / close ─────────────────────────────────────────────────────

  const abrirModal = useCallback(() => {
    setItensModal(itens);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(true);
  }, [itens]);

  const solicitarFecharModal = useCallback(() => {
    const mudou = !sameCart(itensModal, itens);
    if (mudou) { setModalConfirmarFechar(true); return; }
    setModalAberto(false);
  }, [itensModal, itens]);

  const descartarModal = useCallback(() => {
    setModalConfirmarFechar(false);
    setItensModal(itens);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(false);
  }, [itens]);

  const continuarNoModal = useCallback(() => {
    setModalConfirmarFechar(false);
  }, []);

  const confirmarModal = useCallback(() => {
    setItens(itensModal);
    setModalAberto(false);
    setSearchTerm("");
    setProdutos([]);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
  }, [itensModal]);

  // ─── Modal: add product ──────────────────────────────────────────────────────

  const adicionarProdutoModal = useCallback(
    (produto: Produto) => {
      if (produto.corProduto === null) {
        const temVariantesComCor = produtos.some(
          (p) => p.produto.trim() === produto.produto.trim() && p.corProduto !== null
        );
        if (temVariantesComCor) {
          setColorPickerProduto(produto);
          return;
        }
      }

      const filialCod = filialConsultaSelecionada;
      const base: Omit<ListaItem, "quantidade" | "qtde12m" | "valor12m" | "qtde60d" | "vendasMesAtual" | "custoUnit" | "estoqueFilial"> = {
        produto: produto.produto,
        descProduto: produto.descProduto,
        codigoBarra: produto.codigoBarra ?? null,
        corProduto: produto.corProduto,
        descCor: (produto.descCor || "").trim(),
        linha: produto.linha ?? null,
        subgrupo: produto.subgrupo ?? null,
      };

      void (async () => {
        let vendas: { qtde12m: number; qtde60d: number; vendasMesAtual: number; valor12m: number | null; custoUnit: number | null; diasDesdeUltimaVenda: number | null } | null = null;
        let estoque: number | null = null;
        [vendas, estoque] = await Promise.all([
          fetchVendasItemMetricas(companyKey, filialCod, produto.produto, produto.corProduto),
          fetchEstoqueFilialSum(companyKey, filialCod, produto.produto, produto.corProduto),
        ]);
        setItensModal((prev) => {
          const chave = buildItemKey(base.produto, base.corProduto);
          const idx = prev.findIndex((i) => buildItemKey(i.produto, i.corProduto) === chave);
          if (idx !== -1) {
            const next = [...prev];
            next[idx] = { ...next[idx], quantidade: next[idx].quantidade + 1 };
            mostrarNotificacao(`${base.descProduto} +1`);
            return next;
          }
          mostrarNotificacao(`${base.descProduto} adicionado`);
          return [
            ...prev,
            {
              ...base,
              quantidade: getSuggestedQtyValue(
                {
                  ...base,
                  quantidade: 0,
                  qtde12m: vendas?.qtde12m ?? null,
                  qtde60d: vendas?.qtde60d ?? null,
                  vendasMesAtual: vendas?.vendasMesAtual ?? null,
                  valor12m: vendas?.valor12m ?? null,
                  custoUnit: vendas?.custoUnit ?? null,
                  estoqueFilial: estoque,
                  diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
                },
                new Date().getDate()
              ),
              qtde12m: vendas?.qtde12m ?? null,
              qtde60d: vendas?.qtde60d ?? null,
              vendasMesAtual: vendas?.vendasMesAtual ?? null,
              valor12m: vendas?.valor12m ?? null,
              custoUnit: vendas?.custoUnit ?? null,
              estoqueFilial: estoque,
              diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
            },
          ];
        });
      })();
    },
    [mostrarNotificacao, produtos, filialConsultaSelecionada, companyKey]
  );

  const adicionarComCor = useCallback(
    (produtoComCor: Produto) => {
      setColorPickerProduto(null);
      setColorPickerOpcoes([]);
      adicionarProdutoModal(produtoComCor);
    },
    [adicionarProdutoModal]
  );

  const removerItemModal = useCallback((index: number) => {
    setItensModal((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const atualizarQuantidadeModal = useCallback((index: number, qtd: number) => {
    if (qtd < 0) return;
    setItensModal((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantidade: qtd };
      return next;
    });
  }, []);

  const moverItemModal = useCallback((fromIndex: number, toIndex: number) => {
    setItensModal((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const importarBatchProdutos = useCallback(async () => {
    const codigos = batchCodes
      .split(/\r?\n|,|;|\t/g)
      .map((c) => c.trim())
      .filter(Boolean);
    if (codigos.length === 0) {
      mostrarNotificacao("Cole pelo menos um codigo para importar", "error");
      return;
    }

    const filialCod = filialConsultaSelecionada;
    setImportandoBatch(true);
    try {
      const resolvidos = await Promise.all(
        codigos.map(async (codigoOriginal) => {
          const codigo = codigoOriginal.trim();
          if (!codigo) return { codigoOriginal, produto: null as Produto | null };

          try {
            const porBarra = await buscarPorCodigoBarras(codigo, companyKey);
            if (porBarra) {
              const candidatosBarra = await searchProdutos(porBarra.produto, companyKey);
              const matchBarra =
                candidatosBarra.find(
                  (p) =>
                    p.produto.trim() === porBarra.produto.trim() &&
                    (p.corProduto ?? "") === (porBarra.corProduto ?? "")
                ) ||
                candidatosBarra.find((p) => p.produto.trim() === porBarra.produto.trim()) ||
                null;
              if (matchBarra) return { codigoOriginal, produto: matchBarra };
            }

            const candidatos = await searchProdutos(codigo, companyKey);
            if (candidatos.length === 0) return { codigoOriginal, produto: null as Produto | null };

            const exactProduto = candidatos.find((p) => p.produto.trim() === codigo);
            if (exactProduto) return { codigoOriginal, produto: exactProduto };

            const exactBarra = candidatos.find((p) => (p.codigoBarra || "").trim() === codigo);
            if (exactBarra) return { codigoOriginal, produto: exactBarra };

            return { codigoOriginal, produto: candidatos[0] ?? null };
          } catch {
            return { codigoOriginal, produto: null as Produto | null };
          }
        })
      );

      type BatchAgg = {
        item: Omit<ListaItem, "quantidade" | "qtde12m" | "valor12m" | "qtde60d" | "vendasMesAtual" | "custoUnit" | "estoqueFilial">;
        quantidade: number;
      };
      const agregados = new Map<string, BatchAgg>();
      let naoEncontrados = 0;
      const codigosNaoReconhecidos: string[] = [];

      for (const itemResolvido of resolvidos) {
        const p = itemResolvido.produto;
        if (!p) {
          naoEncontrados += 1;
          codigosNaoReconhecidos.push(itemResolvido.codigoOriginal.trim());
          continue;
        }
        const key = buildItemKey(p.produto, p.corProduto);
        const current = agregados.get(key);
        if (current) {
          current.quantidade += 1;
          continue;
        }
        agregados.set(key, {
          item: {
            produto: p.produto,
            descProduto: p.descProduto,
            codigoBarra: p.codigoBarra ?? null,
            corProduto: p.corProduto,
            descCor: (p.descCor || "").trim(),
            linha: p.linha ?? null,
            subgrupo: p.subgrupo ?? null,
          },
          quantidade: 1,
        });
      }

      if (agregados.size === 0) {
        mostrarNotificacao("Nenhum codigo foi reconhecido", "error");
        return;
      }

      const metricsEntries = await Promise.all(
        Array.from(agregados.entries()).map(async ([key, agg]) => {
          const [vendas, estoqueFilial] = await Promise.all([
            fetchVendasItemMetricas(companyKey, filialCod, agg.item.produto, agg.item.corProduto),
            fetchEstoqueFilialSum(companyKey, filialCod, agg.item.produto, agg.item.corProduto),
          ]);
          return [key, {
            qtde12m: vendas?.qtde12m ?? null,
            qtde60d: vendas?.qtde60d ?? null,
            vendasMesAtual: vendas?.vendasMesAtual ?? null,
            valor12m: vendas?.valor12m ?? null,
            custoUnit: vendas?.custoUnit ?? null,
            estoqueFilial,
            diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
          }] as const;
        })
      );
      const metricsMap = new Map(metricsEntries);

      setItensModal((prev) => {
        const next = [...prev];
        for (const [key, agg] of agregados.entries()) {
          const idx = next.findIndex((i) => buildItemKey(i.produto, i.corProduto) === key);
          if (idx >= 0) {
            next[idx] = { ...next[idx], quantidade: next[idx].quantidade + agg.quantidade };
            continue;
          }
          const metrics = metricsMap.get(key) || { qtde12m: null, valor12m: null, qtde60d: null, vendasMesAtual: null, custoUnit: null, estoqueFilial: null, diasDesdeUltimaVenda: null };
          const suggested = getSuggestedQtyValue(
            {
              ...agg.item,
              quantidade: 0,
              qtde12m: metrics.qtde12m,
              valor12m: metrics.valor12m,
              qtde60d: metrics.qtde60d,
              vendasMesAtual: metrics.vendasMesAtual,
              custoUnit: metrics.custoUnit,
              estoqueFilial: metrics.estoqueFilial,
              diasDesdeUltimaVenda: metrics.diasDesdeUltimaVenda,
            },
            new Date().getDate()
          );
          next.push({
            ...agg.item,
            quantidade: Math.max(agg.quantidade, suggested),
            qtde12m: metrics.qtde12m,
            valor12m: metrics.valor12m,
            qtde60d: metrics.qtde60d,
            vendasMesAtual: metrics.vendasMesAtual,
            custoUnit: metrics.custoUnit,
            estoqueFilial: metrics.estoqueFilial,
            diasDesdeUltimaVenda: metrics.diasDesdeUltimaVenda,
          });
        }
        return next;
      });

      const encontrados = codigos.length - naoEncontrados;
      if (naoEncontrados > 0) {
        const codigosNaoReconhecidosUnicos = Array.from(
          new Set(codigosNaoReconhecidos.filter(Boolean))
        );
        mostrarNotificacao(
          `Importacao: ${encontrados} reconhecido(s), ${naoEncontrados} nao encontrado(s). Nao reconhecidos: ${codigosNaoReconhecidosUnicos.join(", ")}`,
          "error"
        );
      } else {
        mostrarNotificacao(`Importacao concluida: ${encontrados} codigo(s) reconhecido(s)`);
      }
      setBatchCodes("");
    } finally {
      setImportandoBatch(false);
    }
  }, [batchCodes, filialConsultaSelecionada, companyKey, mostrarNotificacao]);

  // ─── Editor: lista items (fora do modal) ─────────────────────────────────────

  const removerItem = useCallback((index: number) => {
    setItens((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const atualizarQuantidade = useCallback((index: number, qtd: number) => {
    if (qtd < 0) return;
    setItens((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], quantidade: qtd };
      return next;
    });
  }, []);

  const moverItem = useCallback((fromIndex: number, toIndex: number) => {
    setItens((prev) => {
      if (
        fromIndex < 0 ||
        toIndex < 0 ||
        fromIndex >= prev.length ||
        toIndex >= prev.length ||
        fromIndex === toIndex
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const abrirColorPickerItem = useCallback(
    async (index: number, emModal: boolean, mode: "replace" | "add") => {
      const source = emModal ? itensModal : itens;
      const item = source[index];
      if (!item) return;

      if (emModal) {
        setModalColorPickerIndex(index);
        setModalColorPickerMode(mode);
        setModalColorPickerLoading(true);
      } else {
        setEditorColorPickerIndex(index);
        setEditorColorPickerMode(mode);
        setEditorColorPickerLoading(true);
      }

      try {
        const result = await searchProdutos(item.produto, companyKey);
        const opcoes = result.filter(
          (p) => p.produto.trim() === item.produto.trim() && p.corProduto !== null
        );

        const opcoesUnicas = Array.from(
          new Map(opcoes.map((p) => [`${p.corProduto ?? ""}|${p.codigoBarra ?? ""}`, p])).values()
        );

        if (emModal) {
          setModalColorPickerOpcoes(opcoesUnicas);
        } else {
          setEditorColorPickerOpcoes(opcoesUnicas);
        }
      } catch {
        if (emModal) {
          setModalColorPickerOpcoes([]);
        } else {
          setEditorColorPickerOpcoes([]);
        }
      } finally {
        if (emModal) {
          setModalColorPickerLoading(false);
        } else {
          setEditorColorPickerLoading(false);
        }
      }
    },
    [itens, itensModal, companyKey]
  );

  const trocarCorItem = useCallback(
    async (index: number, produtoComCor: Produto, emModal: boolean) => {
      const setLista = emModal ? setItensModal : setItens;
      const mode = emModal ? modalColorPickerMode : editorColorPickerMode;
      const filialCod = filialConsultaSelecionada;

      let vendas: { qtde12m: number; qtde60d: number; vendasMesAtual: number; valor12m: number | null; custoUnit: number | null; diasDesdeUltimaVenda: number | null } | null = null;
      let estoque: number | null = null;
      [vendas, estoque] = await Promise.all([
        fetchVendasItemMetricas(companyKey, filialCod, produtoComCor.produto, produtoComCor.corProduto),
        fetchEstoqueFilialSum(companyKey, filialCod, produtoComCor.produto, produtoComCor.corProduto),
      ]);

      const novasMetricas = {
        qtde12m: vendas?.qtde12m ?? null,
        qtde60d: vendas?.qtde60d ?? null,
        vendasMesAtual: vendas?.vendasMesAtual ?? null,
        valor12m: vendas?.valor12m ?? null,
        custoUnit: vendas?.custoUnit ?? null,
        estoqueFilial: estoque,
        diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
      };

      setLista((prev) => {
        const atual = prev[index];
        if (!atual) return prev;

        const chaveNova = buildItemKey(atual.produto, produtoComCor.corProduto);
        const idxExistente = prev.findIndex(
          (i, idx) => idx !== index && buildItemKey(i.produto, i.corProduto) === chaveNova
        );

        const novoItemBase: ListaItem = {
          ...atual,
          codigoBarra: produtoComCor.codigoBarra ?? null,
          corProduto: produtoComCor.corProduto,
          descCor: (produtoComCor.descCor || "").trim(),
          linha: produtoComCor.linha ?? atual.linha ?? null,
          subgrupo: produtoComCor.subgrupo ?? atual.subgrupo ?? null,
          ...novasMetricas,
        };

        if (mode === "add") {
          const novoItem: ListaItem = {
            ...novoItemBase,
            quantidade: getSuggestedQtyValue({ ...novoItemBase, quantidade: 0 }, new Date().getDate()),
          };
          if (idxExistente >= 0) {
            const next = [...prev];
            next[idxExistente] = {
              ...next[idxExistente],
              quantidade: next[idxExistente].quantidade + 1,
              ...novasMetricas,
            };
            return next;
          }
          const next = [...prev];
          next.splice(index + 1, 0, novoItem);
          return next;
        }

        if (idxExistente >= 0) {
          const next = [...prev];
          next[idxExistente] = {
            ...next[idxExistente],
            quantidade: next[idxExistente].quantidade + atual.quantidade,
            ...novasMetricas,
          };
          next.splice(index, 1);
          return next;
        }

        const next = [...prev];
        next[index] = novoItemBase;
        return next;
      });

      if (emModal) {
        setModalColorPickerIndex(null);
        setModalColorPickerMode(null);
        setModalColorPickerOpcoes([]);
      } else {
        setEditorColorPickerIndex(null);
        setEditorColorPickerMode(null);
        setEditorColorPickerOpcoes([]);
      }
      mostrarNotificacao(mode === "add" ? "Nova cor adicionada ao item" : "Cor atualizada com sucesso");
    },
    [companyKey, filialConsultaSelecionada, mostrarNotificacao, editorColorPickerMode, modalColorPickerMode]
  );

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const abrirNovaLista = useCallback(() => {
    setEditingId(undefined);
    setNomeLista("");
    setItens([]);
    if (filiaisDisponiveis.length > 0) setFilialSelecionada(filiaisDisponiveis[0]);
    setMode("editor");
  }, [filiaisDisponiveis]);

  const abrirEdicao = useCallback(
    (lista: ListaLoja) => {
      setEditingId(lista.id);
      setNomeLista(lista.nome);
      setItens(Array.isArray(lista.itens) ? lista.itens : []);
      const f = filiaisDisponiveis.find((f) => f.codFilial === lista.filial) ?? filiais.find((f) => f.codFilial === lista.filial);
      if (f) setFilialSelecionada(f);
      setMode("editor");
    },
    [filiais, filiaisDisponiveis]
  );

  const voltarParaLista = useCallback(() => {
    setMode("list");
  }, []);

  // ─── Save ───────────────────────────────────────────────────────────────────

  const enviarParaComprasSalvas = useCallback(async (customTitle?: string, stayInEditor: boolean = false) => {
    if (itens.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto para enviar", "error");
      return;
    }
    const username = user?.username?.trim() || "";
    const filialCtx = filialSelecionada?.codFilial?.trim() || "sem-filial";
    const sourceContextKey = `lista-loja:${companyKey}:${filialCtx}:${editingId ?? "novo"}`;
    const titleBase = nomeLista.trim() || buildDefaultListName(filialSelecionada?.filial || "Lista Loja");
    const title = `[Lista Loja] ${appendUserToListName(customTitle?.trim() || titleBase, username)}`;
    const payloadItems: CompraSalvaItemRow[] = itens.map((it) => ({
      itemKey: buildItemKey(it.produto, it.corProduto),
      produto: it.produto,
      corProduto: it.corProduto ?? undefined,
      corDescricao: it.descCor || undefined,
      descricao: it.descProduto || it.produto,
      qtdManual: Math.max(0, Math.round(it.quantidade ?? 0)),
      custoUnitario: it.custoUnit != null ? Number(it.custoUnit) : undefined,
    }));

    try {
      const res = await fetch("/api/controle-estoque/compras-salvas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyKey,
          sourceContextKey,
          title,
          expandirPorCor: true,
          items: payloadItems,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error || "Erro ao enviar para Compras Salvas");
      mostrarNotificacao("Lista enviada para Compras Salvas com sucesso!");
      if (!stayInEditor) setMode("saved-purchases");
    } catch (err: unknown) {
      mostrarNotificacao(err instanceof Error ? err.message : "Erro ao enviar para Compras Salvas", "error");
    }
  }, [companyKey, editingId, filialSelecionada, itens, mostrarNotificacao, nomeLista, user?.username]);

  const salvar = useCallback(async () => {
    if (!user?.username) return;
    if (itens.length === 0) { mostrarNotificacao("Adicione pelo menos um produto", "error"); return; }

    setSalvando(true);
    try {
      const nomeBase = nomeLista.trim() || buildDefaultListName(filialSelecionada?.filial || "Lista");
      const nomeFinal = appendUserToListName(nomeBase, user.username);
      const result = await salvarLista(
        {
          id: editingId,
          nome: nomeFinal,
          filial: "LISTA_LOJA",
          nomeFilial: "Lista Loja",
          company: companyKey,
          itens,
        },
        user.username
      );
      await enviarParaComprasSalvas(nomeFinal, true);
      mostrarNotificacao("Lista salva com sucesso!");
      setEditingId(result.id);
      setNomeLista(nomeFinal);
    } catch (err: unknown) {
      mostrarNotificacao(err instanceof Error ? err.message : "Erro ao salvar", "error");
    } finally {
      setSalvando(false);
    }
  }, [user?.username, nomeLista, filialSelecionada?.filial, itens, editingId, companyKey, mostrarNotificacao, enviarParaComprasSalvas]);

  // ─── Delete ─────────────────────────────────────────────────────────────────

  const excluirLista = useCallback(
    async (lista: ListaLoja, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!user?.username) return;
      if (!confirm(`Excluir a lista "${lista.nome}"?`)) return;
      try {
        await deletarLista(lista.id, user.username);
        mostrarNotificacao("Lista excluída");
        setListas((prev) => prev.filter((l) => l.id !== lista.id));
      } catch {
        mostrarNotificacao("Erro ao excluir lista", "error");
      }
    },
    [user?.username, mostrarNotificacao]
  );

  // ─── Derived ────────────────────────────────────────────────────────────────

  // Produtos que já estão no modal (para não mostrar nos resultados de busca)
  const produtosJaNoModal = useMemo(() => {
    return new Set(itensModal.map((i) => buildItemKey(i.produto, i.corProduto)));
  }, [itensModal]);

  const totalItens = itens.reduce((s, i) => s + i.quantidade, 0);
  const totalItensModal = itensModal.reduce((s, i) => s + i.quantidade, 0);
  const kpisLista = useMemo(() => {
    const diasCorridosMes = new Date().getDate();
    const totalQtdSugerida = itens.reduce((s, item) => {
      const sugestao = getReposicaoCompraView(item, diasCorridosMes);
      const qtd = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;
      return s + Math.max(0, qtd);
    }, 0);
    const totalCustoReferencia = itens.reduce((s, item) => {
      const custoUnit = Number(item.custoUnit ?? 0);
      if (custoUnit <= 0) return s;
      const sugestao = getReposicaoCompraView(item, diasCorridosMes);
      const qtd = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;
      if (qtd <= 0) return s;
      return s + qtd * custoUnit;
    }, 0);
    return {
      totalItens: itens.length,
      totalQtdSugerida,
      totalCustoReferencia,
    };
  }, [itens]);
  const abcMapRede = useMemo(() => calcularCurvasRede(itens), [itens]);
  const abcMapModal = useMemo(() => calcularCurvasRede(itensModal), [itensModal]);

  // ─── Render: loading ────────────────────────────────────────────────────────

  if (!permissoesCarregadas) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.centered}>Carregando...</div>
      </div>
    );
  }

  // ─── Render: editor ─────────────────────────────────────────────────────────

  if (mode === "editor") {
    return (
      <div className={styles.wrapper}>
        {/* Toast */}
        {notificacao && (
          <div className={`${styles.toast} ${notificacao.tipo === "error" ? styles.toastError : styles.toastSuccess}`}>
            <span className={styles.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
            {notificacao.mensagem}
          </div>
        )}

        {/* Header */}
        <div className={styles.topBar}>
          <button type="button" className={styles.backBtn} onClick={voltarParaLista}>
            <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
              <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Voltar
          </button>
          <h1 className={styles.title}>{editingId ? "Editar Lista" : "Nova Lista"}</h1>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => {
                void enviarParaComprasSalvas();
              }}
              disabled={itens.length === 0}
              title={itens.length === 0 ? "Adicione itens para enviar" : "Enviar para Compras Salvas"}
            >
              Enviar para Compras Salvas
            </button>
            <button type="button" className={styles.saveBtn} onClick={salvar} disabled={salvando}>
              {salvando ? "Salvando..." : "Salvar Lista"}
            </button>
          </div>
        </div>

        {/* Meta form */}
        <div className={styles.formRow}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Nome da Lista</label>
            <input
              type="text"
              className={styles.input}
              value={nomeLista}
              onChange={(e) => setNomeLista(e.target.value)}
              placeholder={buildDefaultListName(filialSelecionada?.filial || "Lista")}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>Loja</label>
            {filiaisDisponiveis.length === 1 && filialSelecionada ? (
              <div className={styles.filialFixed}>{filialSelecionada.filial}</div>
            ) : (
              <select
                className={styles.select}
                value={filialSelecionada?.codFilial || ""}
                onChange={(e) => {
                    const f = filiaisDisponiveis.find((f) => f.codFilial === e.target.value);
                  if (f) setFilialSelecionada(f);
                }}
              >
                {filiaisDisponiveis.map((f) => (
                  <option key={f.codFilial} value={f.codFilial}>{f.filial}</option>
                ))}
              </select>
            )}
          </div>
        </div>

        {/* Produtos da lista (sem card; scroll da página) */}
        <div className={styles.produtosSection}>
          {itens.length > 0 && (
            <div className={styles.kpiCard}>
              <div className={styles.kpiItem}>
                <span className={styles.kpiLabel}>Itens</span>
                <strong className={styles.kpiValueNeutral}>{kpisLista.totalItens}</strong>
              </div>
              <div className={styles.kpiDivider} />
              <div className={styles.kpiItem}>
                <span className={styles.kpiLabel}>Total Qtd</span>
                <strong className={styles.kpiValue}>{fmt(kpisLista.totalQtdSugerida)}</strong>
              </div>
              <div className={styles.kpiDivider} />
              <div className={styles.kpiItem}>
                <span className={styles.kpiLabel}>Custo Total (Referência)</span>
                <strong className={styles.kpiValue}>{fmtBRL(kpisLista.totalCustoReferencia)}</strong>
              </div>
            </div>
          )}
          {itens.length === 0 ? (
            <div className={styles.emptyProducts}>
              <div className={styles.emptyProductsIcon}>
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </div>
              <div className={styles.emptyProductsTitle}>Nenhum produto adicionado</div>
              <div className={styles.emptyProductsSub}>Clique em &ldquo;Adicionar Produto&rdquo; para começar</div>
            </div>
          ) : (
            <div className={styles.produtosList}>
              <ListaLojaItensTable
                companyKey={companyKey}
                filialCod={filialConsultaSelecionada}
                filialNome={filialConsultaSelecionada ? (filialSelecionada?.filial ?? null) : null}
                itens={itens}
                compraView={true}
                abcMap={abcMapRede}
                onMoveItem={moverItem}
                onIncrement={(idx) =>
                  atualizarQuantidade(idx, (itens[idx]?.quantidade ?? 1) + 1)
                }
                onDecrement={(idx) =>
                  atualizarQuantidade(idx, (itens[idx]?.quantidade ?? 1) - 1)
                }
                onQtyChange={(idx, q) => atualizarQuantidade(idx, q)}
                onRemove={removerItem}
                onOpenColorPicker={(idx, mode) => {
                  void abrirColorPickerItem(idx, false, mode);
                }}
                activeColorPickerIndex={editorColorPickerIndex}
                activeColorPickerMode={editorColorPickerMode}
                colorPickerOptions={editorColorPickerOpcoes}
                colorPickerLoading={editorColorPickerLoading}
                onApplyColor={(idx, produtoComCor) => {
                  void trocarCorItem(idx, produtoComCor, false);
                }}
                onCancelColorPicker={() => {
                  setEditorColorPickerIndex(null);
                  setEditorColorPickerMode(null);
                  setEditorColorPickerOpcoes([]);
                }}
              />
            </div>
          )}

          <div className={styles.produtosActionsRow}>
            {itens.length > 0 && (
              <span className={styles.badge}>
                {itens.length} prod · {totalItens} un.
              </span>
            )}
            <button
              type="button"
              className={styles.addProductBtn}
              onClick={abrirModal}
            >
              <svg viewBox="0 0 24 24" fill="none" width="16" height="16">
                <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              Adicionar Produto
            </button>
            {itens.length > 0 && (
              <button
                type="button"
                className={styles.clearProductsBtn}
                onClick={() => setItens([])}
              >
                Limpar lista
              </button>
            )}
          </div>
        </div>

        {/* Modal – Adicionar Produto */}
        {modalAberto && (
          <div className={styles.modalOverlay} onClick={solicitarFecharModal}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Adicionar Produto</h2>
                <button className={styles.modalCloseBtn} onClick={solicitarFecharModal}>×</button>
              </div>

              <div className={styles.modalContent}>
                {/* Search */}
                <div className={styles.searchBox}>
                  <span className={styles.searchIcon}>🔍</span>
                  <input
                    type="text"
                    className={styles.searchInput}
                    placeholder="Buscar por nome, código ou código de barras..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                  />
                </div>

                <div className={styles.batchBox}>
                  <textarea
                    className={styles.batchInput}
                    placeholder="Importacao em lote: cole um codigo por linha"
                    value={batchCodes}
                    onChange={(e) => setBatchCodes(e.target.value)}
                    rows={4}
                  />
                  <button
                    type="button"
                    className={styles.batchBtn}
                    onClick={importarBatchProdutos}
                    disabled={importandoBatch}
                  >
                    {importandoBatch ? "Importando..." : "Importar codigos"}
                  </button>
                </div>

                {/* Results */}
                {loadingProdutos ? (
                  <div className={styles.loadingText}>Buscando produtos...</div>
                ) : produtos.length === 0 && searchTerm.length >= 2 ? (
                  <div className={styles.emptySearch}>Nenhum produto encontrado</div>
                ) : (
                  <div className={styles.produtosModalList}>
                    {produtos
                      .filter((p) => !produtosJaNoModal.has(buildItemKey(p.produto, p.corProduto)))
                      .map((produto, index) => {
                        const isPickerActive =
                          colorPickerProduto?.produto === produto.produto && produto.corProduto === null;
                        return (
                          <div
                            key={`${produto.produto}-${produto.corProduto ?? "null"}-${index}`}
                            className={`${styles.produtoModalItem}${isPickerActive ? ` ${styles.produtoModalItemPickerActive}` : ""}`}
                          >
                            <div className={styles.produtoModalIcon}>📦</div>
                            <div className={styles.produtoModalInfo}>
                              <div className={styles.produtoModalName}>{produto.descProduto}</div>
                              <div className={styles.produtoModalDetails}>
                                {produto.produto}
                                {produto.descCor ? ` · ${produto.descCor}` : produto.corProduto ? ` · ${produto.corProduto}` : ""}
                                {produto.codigoBarra ? ` · ${produto.codigoBarra}` : ""}
                              </div>
                            </div>
                            {!isPickerActive && (
                              <button
                                className={styles.addModalBtn}
                                onClick={() => adicionarProdutoModal(produto)}
                              >
                                +
                              </button>
                            )}
                            {isPickerActive && (
                              <div className={styles.colorPickerRow}>
                                {loadingColorPicker ? (
                                  <span className={styles.colorPickerLoading}>Buscando cores...</span>
                                ) : colorPickerOpcoes.length > 0 ? (
                                  <div className={styles.colorChips}>
                                    {colorPickerOpcoes.map((opcao) => (
                                      <button
                                        key={opcao.corProduto}
                                        className={styles.colorChip}
                                        onClick={() => adicionarComCor(opcao)}
                                      >
                                        {opcao.descCor || opcao.corProduto}
                                      </button>
                                    ))}
                                    <button
                                      className={styles.colorChipCancel}
                                      onClick={() => { setColorPickerProduto(null); setColorPickerOpcoes([]); }}
                                    >✕</button>
                                  </div>
                                ) : (
                                  <div className={styles.colorPickerNenhuma}>
                                    <span>Nenhuma cor disponível</span>
                                    <button
                                      className={styles.colorChipCancel}
                                      onClick={() => { setColorPickerProduto(null); setColorPickerOpcoes([]); }}
                                    >✕</button>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}

                {/* Selecionados no modal */}
                {itensModal.length > 0 && (
                  <div className={styles.modalCartBlock}>
                    <div className={styles.modalCartHeader}>
                      <span className={styles.modalCartTitle}>Selecionados</span>
                      <span className={styles.modalCartMeta}>
                        {itensModal.length} prod · {totalItensModal} un.
                      </span>
                    </div>
                    <div className={styles.modalCartList}>
                      <ListaLojaItensTable
                        companyKey={companyKey}
                        filialCod={filialConsultaSelecionada}
                        filialNome={filialConsultaSelecionada ? (filialSelecionada?.filial ?? null) : null}
                        itens={itensModal}
                        compraView={true}
                        abcMap={abcMapModal}
                        onMoveItem={moverItemModal}
                        onIncrement={(idx) =>
                          atualizarQuantidadeModal(
                            idx,
                            (itensModal[idx]?.quantidade ?? 1) + 1
                          )
                        }
                        onDecrement={(idx) =>
                          atualizarQuantidadeModal(
                            idx,
                            (itensModal[idx]?.quantidade ?? 1) - 1
                          )
                        }
                        onQtyChange={(idx, q) => atualizarQuantidadeModal(idx, q)}
                        onRemove={removerItemModal}
                        onOpenColorPicker={(idx, mode) => {
                          void abrirColorPickerItem(idx, true, mode);
                        }}
                        activeColorPickerIndex={modalColorPickerIndex}
                        activeColorPickerMode={modalColorPickerMode}
                        colorPickerOptions={modalColorPickerOpcoes}
                        colorPickerLoading={modalColorPickerLoading}
                        onApplyColor={(idx, produtoComCor) => {
                          void trocarCorItem(idx, produtoComCor, true);
                        }}
                        onCancelColorPicker={() => {
                          setModalColorPickerIndex(null);
                          setModalColorPickerMode(null);
                          setModalColorPickerOpcoes([]);
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  className={styles.btnPrimary}
                  onClick={confirmarModal}
                  disabled={itensModal.length === 0}
                >
                  Confirmar ({itensModal.length})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Modal – Confirmar fechar */}
        {modalConfirmarFechar && (
          <div className={styles.modalOverlay} onClick={continuarNoModal}>
            <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
              <div className={styles.modalHeader}>
                <h2 className={styles.modalTitle}>Descartar alterações?</h2>
                <button className={styles.modalCloseBtn} onClick={continuarNoModal}>×</button>
              </div>
              <div className={styles.modalBody}>
                <p className={styles.confirmacaoTexto}>
                  Você adicionou ou alterou produtos mas ainda não confirmou. Deseja descartar essas alterações?
                </p>
              </div>
              <div className={styles.modalFooter}>
                <button className={styles.btnSecondary} onClick={continuarNoModal}>
                  Continuar no modal
                </button>
                <button className={styles.btnDanger} onClick={descartarModal}>
                  Descartar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (mode === "saved-purchases") {
    return (
      <div className={styles.wrapper}>
        {notificacao && (
          <div className={`${styles.toast} ${notificacao.tipo === "error" ? styles.toastError : styles.toastSuccess}`}>
            <span className={styles.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
            {notificacao.mensagem}
          </div>
        )}
        <div className={styles.topBar}>
          <div>
            <h1 className={styles.title}>Compras Salvas</h1>
            <p className={styles.subtitle}>{companyName}</p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className={styles.backBtn} onClick={() => setMode("list")}>
              Ver Listas
            </button>
            <button type="button" className={styles.saveBtn} onClick={abrirNovaLista}>
              + Nova Lista
            </button>
          </div>
        </div>
        <ComprasSalvasListPanel companyKey={companyKey} companySlug={companySlug} />
      </div>
    );
  }

  // ─── Render: list view ───────────────────────────────────────────────────────

  return (
    <div className={styles.wrapper}>
      {notificacao && (
        <div className={`${styles.toast} ${notificacao.tipo === "error" ? styles.toastError : styles.toastSuccess}`}>
          <span className={styles.toastIcon}>{notificacao.tipo === "success" ? "✓" : "✕"}</span>
          {notificacao.mensagem}
        </div>
      )}

      <div className={styles.topBar}>
        <div>
          <h1 className={styles.title}>Lista Loja</h1>
          <p className={styles.subtitle}>{companyName}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="button" className={styles.backBtn} onClick={() => setMode("saved-purchases")}>
            Compras Salvas
          </button>
          <button type="button" className={styles.saveBtn} onClick={abrirNovaLista}>
            + Nova Lista
          </button>
        </div>
      </div>

      {loadingListas ? (
        <div className={styles.centered}>Carregando listas...</div>
      ) : listas.length === 0 ? (
        <div className={styles.emptyState}>
          <svg viewBox="0 0 24 24" fill="none" width="48" height="48">
            <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <path d="M9 12h6M9 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <p>Nenhuma lista criada ainda</p>
          <button type="button" className={styles.saveBtn} onClick={abrirNovaLista}>
            Criar primeira lista
          </button>
        </div>
      ) : (
        <div className={styles.listasGrid}>
          {listas.map((lista) => {
            const totalUnidades = (lista.itens || []).reduce((s, i) => s + i.quantidade, 0);
            return (
              <div
                key={lista.id}
                className={styles.listaCard}
                onClick={() => abrirEdicao(lista)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && abrirEdicao(lista)}
              >
                <div className={styles.listaCardContent}>
                  <div className={styles.listaCardTop}>
                    <span className={styles.listaFilialTag}>{lista.nome_filial}</span>
                  </div>
                  <div className={styles.listaCardMeta}>
                    <span>{lista.username}</span>
                    <span className={styles.metaDot}>·</span>
                    <span>
                      {(lista.itens || []).length} produto(s)
                      {totalUnidades > 0 ? `, ${totalUnidades} un.` : ""}
                    </span>
                    <span className={styles.metaDot}>·</span>
                    <span>{formatDate(lista.updated_at)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  className={styles.deleteBtn}
                  onClick={(e) => excluirLista(lista, e)}
                  aria-label="Excluir lista"
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

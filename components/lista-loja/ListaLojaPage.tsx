"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { calculateTransfers } from "@/components/controle-transferencias/ControleTransferenciasTable";
import ComprasSalvasListPanel from "@/components/stock/ComprasSalvasListPanel";
import {
  compareFilialDisplayOrder,
  getFilialLabelForDisplay,
  resolveCompany,
  type CompanyConfig,
  type CompanyKey,
} from "@/lib/config/company";
import { fetchControleEstoqueItemMetricasClient } from "@/lib/client/controle-estoque-metricas";
import { exportListaLojaToXlsx } from "@/lib/utils/exportListaLoja";
import type { CompraSalvaItemRow } from "@/lib/types/compra-salva";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";

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
  /** Primeira entrada conhecida do item na filial selecionada */
  primeiraEntradaFilial?: string | null;
  /** Dias de historico real na filial, limitado a 365 */
  diasHistoricoFilial?: number | null;
  /** Meses de historico real na filial, entre 1 e 12 */
  mesesHistoricoFilial?: number | null;
  /** Indica que a filial ainda nao completou 12 meses de historico para o item */
  historicoParcial?: boolean | null;
  linha?: string | null;
  subgrupo?: string | null;
}

type Curva = "A" | "B" | "C";

type CurvaInfo = {
  curva: Curva;
  percParticipacao: number;
  percCumulativo: number;
};

type CurvaAbcProdutoRow = {
  produto: string;
  cor?: string | null;
  corDescricao?: string | null;
  vendas: number;
};

type CurvaAbcScopeData = {
  displayName?: string;
  produtos?: CurvaAbcProdutoRow[];
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

type FilialEstoqueRow = {
  filial: string;
  estoque: number;
};

type FilialVendaRow = {
  filial: string;
  qtde12m: number;
  qtde60d: number;
  qtdeMesAtual: number;
  valor12m: number;
};

type FilialExportMetrics = {
  estoque: number;
  qtde12m: number;
  qtde60d: number;
  qtdeMesAtual: number;
  valor12m: number;
};

type TransferenciaDestinoSugestao = {
  origemLabel: string;
  origemCanonico: string;
  destinoLabel: string;
  destinoCanonico: string;
  quantidade: number;
  // Métricas do destino para o resumo no tooltip (extraídas de quantidadeExplicacao)
  destinoCobertura?: number;
  destinoDiaria?: number;
  destinoEstoque?: number;
  destinoVendas12m?: number;
};

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

type BarcodeLookupRow = { produto: string; corProduto: string | null };

async function buscarPorCodigoBarras(codigoBarras: string, companyKey?: string) {
  const params = new URLSearchParams({ codigoBarras: codigoBarras.trim() });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(
    `/api/transferencia-produtos/produto-por-codigo-barras?${params}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { data: BarcodeLookupRow | null };
  return json.data || null;
}

/** Somente dígitos (p.ex. código de barras interno): não usar busca por nome como fallback. */
function isSomenteDigitosCodigoBarras(term: string): boolean {
  const t = term.trim();
  return t.length >= 4 && /^\d+$/.test(t);
}

/**
 * Resolve PRODUTOS_BARRA → produto na API com filtro de cor. Sem cor na barra, só retorna se houver uma única variante.
 */
async function produtoFromBarcodeLookup(porBarra: BarcodeLookupRow, companyKey?: string): Promise<Produto | null> {
  const list = await searchProdutos(
    porBarra.produto,
    companyKey,
    porBarra.corProduto != null ? porBarra.corProduto : undefined
  );
  const want = (porBarra.corProduto ?? "").trim();
  if (want !== "") {
    return list.find((p) => (p.corProduto ?? "").trim() === want) ?? null;
  }
  if (list.length === 1) return list[0] ?? null;
  return null;
}

async function searchProdutos(
  term: string,
  companyKey?: string,
  corProduto?: string | null
): Promise<Produto[]> {
  if (!term || term.trim().length < 2) return [];
  const params = new URLSearchParams({ q: term.trim(), entrada: "true" });
  if (companyKey) params.set("company", companyKey);
  if (corProduto !== undefined && corProduto !== null) {
    params.set("corProduto", String(corProduto).trim());
  }
  const res = await fetch(`/api/transferencia-produtos/produtos?${params}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data: Produto[] };
  return json.data || [];
}

async function fetchProdutosPorColecao(colecao: string, companyKey?: string): Promise<Produto[]> {
  const c = colecao.trim();
  if (!c) return [];
  const params = new URLSearchParams({ porColecao: "true", colecao: c });
  if (companyKey) params.set("company", companyKey);
  const res = await fetch(`/api/transferencia-produtos/produtos?${params}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: Produto[] };
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

function formatHistoricoDate(value?: string | null): string {
  if (!value) return "Nao encontrada";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getMesesHistoricoFilial(item: Pick<ListaItem, "mesesHistoricoFilial">): number {
  const meses = Number(item.mesesHistoricoFilial ?? 12);
  if (!Number.isFinite(meses)) return 12;
  return Math.min(12, Math.max(1, meses));
}

function getHistoricoFilialFallback() {
  return {
    primeiraEntradaFilial: null as string | null,
    diasHistoricoFilial: 365,
    mesesHistoricoFilial: 12,
    historicoParcial: false,
  };
}

function calculateHistoricoFilial(primeiraEntradaFilial?: string | Date | null) {
  if (!primeiraEntradaFilial) return getHistoricoFilialFallback();
  const data = primeiraEntradaFilial instanceof Date ? primeiraEntradaFilial : new Date(primeiraEntradaFilial);
  if (Number.isNaN(data.getTime())) return getHistoricoFilialFallback();
  const msPerDay = 1000 * 60 * 60 * 24;
  const diasHistoricoFilial = Math.min(365, Math.max(0, Math.floor((Date.now() - data.getTime()) / msPerDay)));
  return {
    primeiraEntradaFilial: data.toISOString(),
    diasHistoricoFilial,
    mesesHistoricoFilial: Math.min(12, Math.max(1, diasHistoricoFilial / 30)),
    historicoParcial: diasHistoricoFilial < 365,
  };
}

function mergeHistoricoFilialRows(
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
  if (primeiraEntrada) return calculateHistoricoFilial(primeiraEntrada);

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
      mesesHistoricoFilial: getMesesHistoricoFilial({ mesesHistoricoFilial: parcial.mesesHistoricoFilial }),
      historicoParcial: Boolean(parcial.historicoParcial),
    };
  }

  return getHistoricoFilialFallback();
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
    const metricas = await fetchControleEstoqueItemMetricasClient({
      company: companyKey,
      filial: codFilial,
      includeHistorico: true,
      item: {
        produto: produto.trim(),
        corProduto: corProduto?.trim() || null,
      },
    });
    return metricas?.resumo.estoqueTotal ?? null;
  } catch {
    return null;
  }
}

async function fetchVendasItemMetricas(
  companyKey: string,
  codFilial: string | null,
  produto: string,
  corProduto: string | null
): Promise<{ qtde12m: number; qtde60d: number; vendasMesAtual: number; valor12m: number | null; custoUnit: number | null; diasDesdeUltimaVenda: number | null; primeiraEntradaFilial: string | null; diasHistoricoFilial: number; mesesHistoricoFilial: number; historicoParcial: boolean } | null> {
  type VendasItemMetricasApiRow = {
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

  const fetchRows = async (includeHistorico: boolean): Promise<VendasItemMetricasApiRow[]> => {
    const params = new URLSearchParams({ company: companyKey, produto: produto.trim() });
    if (includeHistorico) params.set("includeHistorico", "true");
    if (codFilial && codFilial.trim()) params.set("filial", codFilial.trim());
    if (corProduto) params.set("corProduto", corProduto.trim());
    const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
    if (!res.ok) throw new Error("Erro ao carregar metricas de vendas");
    const json = (await res.json()) as { data?: VendasItemMetricasApiRow[] };
    return json.data || [];
  };

  try {
    const metricas = await fetchControleEstoqueItemMetricasClient({
      company: companyKey,
      filial: codFilial,
      includeHistorico: true,
      item: {
        produto: produto.trim(),
        corProduto: corProduto?.trim() || null,
      },
    });
    if (!metricas) return null;
    return {
      qtde12m: metricas.resumo.qtde12m,
      qtde60d: metricas.resumo.qtde60d,
      vendasMesAtual: metricas.resumo.vendasMesAtual,
      valor12m: metricas.resumo.valor12m,
      custoUnit: metricas.resumo.custoUnitario,
      diasDesdeUltimaVenda: metricas.resumo.diasDesdeUltimaVenda,
      primeiraEntradaFilial: metricas.resumo.primeiraEntradaFilial,
      diasHistoricoFilial: metricas.resumo.diasHistoricoFilial,
      mesesHistoricoFilial: metricas.resumo.mesesHistoricoFilial,
      historicoParcial: metricas.resumo.historicoParcial,
    };
    let rows: VendasItemMetricasApiRow[];
    try {
      rows = await fetchRows(true);
    } catch {
      // Fallback seguro: se a consulta de historico falhar, preserva as metricas visuais.
      rows = await fetchRows(false);
    }

    const totalValor = rows.reduce((s, r) => s + Number(r.valor12m ?? 0), 0);
    const maxCusto = rows.reduce((max, r) => Math.max(max, Number(r.custoUnitario ?? 0)), 0);
    // Última venda mais recente entre todas as filiais (menor número de dias)
    const diasValidos = rows.map((r) => r.diasDesdeUltimaVenda).filter((d): d is number => d != null);
    const diasDesdeUltimaVenda = diasValidos.length > 0 ? Math.min(...diasValidos) : null;
    const historicoFilial = mergeHistoricoFilialRows(rows);
    return {
      qtde12m: Math.round(rows.reduce((s, r) => s + Number(r.qtde12m ?? 0), 0)),
      qtde60d: Math.round(rows.reduce((s, r) => s + Number(r.qtde60d ?? 0), 0)),
      vendasMesAtual: Math.round(rows.reduce((s, r) => s + Number(r.qtdeMesAtual ?? 0), 0)),
      valor12m: totalValor > 0 ? Math.round(totalValor) : null,
      custoUnit: maxCusto > 0 ? maxCusto : null,
      diasDesdeUltimaVenda,
      ...historicoFilial,
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
): Promise<FilialVendaRow[]> {
  const metricas = await fetchControleEstoqueItemMetricasClient({
    company: companyKey,
    filial: codFilial,
    includeHistorico: false,
    item: {
      produto: produto.trim(),
      corProduto: corProduto?.trim() || null,
    },
  });
  return (metricas?.vendasPorFilial ?? []).map((row) => ({
    filial: row.filial,
    qtde12m: Number(row.qtde12m ?? 0),
    qtde60d: Number(row.qtde60d ?? 0),
    qtdeMesAtual: Number(row.qtdeMesAtual ?? 0),
    valor12m: Number(row.valor12m ?? 0),
  }));
}

async function fetchEstoquePorFilialItem(
  companyKey: string,
  codFilial: string | null,
  produto: string,
  corProduto: string | null
): Promise<FilialEstoqueRow[]> {
  const metricas = await fetchControleEstoqueItemMetricasClient({
    company: companyKey,
    filial: codFilial,
    includeHistorico: false,
    item: {
      produto: produto.trim(),
      corProduto: corProduto?.trim() || null,
    },
  });
  return (metricas?.estoquePorFilial ?? []).map((row) => ({
    filial: row.filial,
    estoque: Number(row.estoque ?? 0),
  }));
}

async function fetchControleTransferenciasLista(companyKey: string): Promise<ProdutoTransferencia[]> {
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - 30);
  const params = new URLSearchParams({
    company: companyKey,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  const res = await fetch(`/api/controle-transferencias?${params}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar transferencias");
  const json = (await res.json()) as { data?: ProdutoTransferencia[] };
  return (json.data || []).map((item) => ({
    ...item,
    filiais: item.filiais.map((filial) => ({
      ...filial,
      ultimaEntrada: filial.ultimaEntrada ? new Date(filial.ultimaEntrada) : null,
    })),
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

function matchFilialName(a?: string | null, b?: string | null) {
  return normalizeKey(a) === normalizeKey(b);
}

function getTransferenciaItemKeys(transferItem: {
  produto: string;
  cor?: string | null;
  itemOriginal?: { codigoCor?: string | null; cor?: string | null };
}) {
  return [
    buildItemKey(transferItem.produto, transferItem.itemOriginal?.codigoCor ?? null),
    buildItemKey(transferItem.produto, transferItem.itemOriginal?.cor ?? null),
    buildItemKey(transferItem.produto, transferItem.cor ?? null),
  ];
}

function itemTemTransferenciaSugerida(
  item: ListaItem,
  _diasCorridosMes: number,
  transferenciasPorItem: Record<string, TransferenciaDestinoSugestao[]>
): boolean {
  return (transferenciasPorItem[buildItemKey(item.produto, item.corProduto)] ?? []).length > 0;
}

const TRANSFERENCIA_BADGE_THEMES = [
  { bg: "#c8d4ea", fg: "#1e3a5f", border: "#7d9dc4" },
  { bg: "#c5e0d0", fg: "#134332", border: "#5fa889" },
  { bg: "#e8d5c4", fg: "#4a3020", border: "#b88a6a" },
  { bg: "#d2cae6", fg: "#3a2d55", border: "#8f7eb5" },
  { bg: "#c2e2e8", fg: "#13404a", border: "#5aa3b5" },
  { bg: "#e2d0ee", fg: "#4a2565", border: "#9f7cbd" },
] as const;

function transferenciaBadgeThemeForFilial(label: string) {
  let h = 2166136261;
  for (let i = 0; i < label.length; i++) {
    h ^= label.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return TRANSFERENCIA_BADGE_THEMES[Math.abs(h) % TRANSFERENCIA_BADGE_THEMES.length];
}


function buildExportHeaderToken(value: string) {
  const normalized = normalizeKey(value)
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || "SEM_FILIAL";
}

function aggregateEstoqueRowsForExport(
  rows: FilialEstoqueRow[],
  company: CompanyConfig | null
): FilialEstoqueRow[] {
  const acc = new Map<string, number>();
  for (const row of rows) {
    const label = getFilialLabelForDisplay(company, row.filial);
    acc.set(label, (acc.get(label) ?? 0) + Number(row.estoque ?? 0));
  }
  return Array.from(acc.entries())
    .map(([filial, estoque]) => ({ filial, estoque: Math.round(estoque) }))
    .sort((a, b) => compareFilialDisplayOrder(a.filial, b.filial, company));
}

function aggregateVendasRowsForExport(
  rows: FilialVendaRow[],
  company: CompanyConfig | null
): FilialVendaRow[] {
  const acc = new Map<string, FilialVendaRow>();
  for (const row of rows) {
    const label = getFilialLabelForDisplay(company, row.filial);
    const prev = acc.get(label);
    if (prev) {
      prev.qtde12m += Number(row.qtde12m ?? 0);
      prev.qtde60d += Number(row.qtde60d ?? 0);
      prev.qtdeMesAtual += Number(row.qtdeMesAtual ?? 0);
      prev.valor12m += Number(row.valor12m ?? 0);
      continue;
    }
    acc.set(label, {
      filial: label,
      qtde12m: Number(row.qtde12m ?? 0),
      qtde60d: Number(row.qtde60d ?? 0),
      qtdeMesAtual: Number(row.qtdeMesAtual ?? 0),
      valor12m: Number(row.valor12m ?? 0),
    });
  }
  return Array.from(acc.values()).sort((a, b) => compareFilialDisplayOrder(a.filial, b.filial, company));
}

function buildExportListText(values: string[]): string {
  return values.filter((value) => value.trim().length > 0).join(" | ");
}

function buildEstoqueTooltipText(rows: FilialEstoqueRow[]): string {
  return buildExportListText(
    rows
      .filter((row) => Number(row.estoque ?? 0) !== 0)
      .map((row) => `${row.filial}: ${fmt(Number(row.estoque ?? 0))}`)
  );
}

function buildVendasTooltipText(
  rows: FilialVendaRow[],
  mode: "12m" | "60d" | "mesAtual" | "valor12m"
): string {
  return buildExportListText(
    rows
      .filter((row) => {
        if (mode === "12m") return Number(row.qtde12m ?? 0) > 0;
        if (mode === "60d") return Number(row.qtde60d ?? 0) > 0;
        if (mode === "mesAtual") return Number(row.qtdeMesAtual ?? 0) > 0;
        return Number(row.valor12m ?? 0) > 0;
      })
      .map((row) => {
        if (mode === "valor12m") {
          return `${row.filial}: ${fmtBRL(Number(row.valor12m ?? 0))}`;
        }

        const quantidade =
          mode === "12m"
            ? Number(row.qtde12m ?? 0)
            : mode === "60d"
              ? Number(row.qtde60d ?? 0)
              : Number(row.qtdeMesAtual ?? 0);
        return `${row.filial}: ${fmt(quantidade)}`;
      })
  );
}

function buildFiliaisComEstoqueText(rows: FilialEstoqueRow[]): string {
  return buildExportListText(
    rows
      .filter((row) => Number(row.estoque ?? 0) > 0)
      .map((row) => row.filial)
  );
}

function buildFiliaisQueVenderamText(rows: FilialVendaRow[]): string {
  return buildExportListText(
    rows
      .filter((row) =>
        Number(row.qtde12m ?? 0) > 0 ||
        Number(row.qtde60d ?? 0) > 0 ||
        Number(row.qtdeMesAtual ?? 0) > 0 ||
        Number(row.valor12m ?? 0) > 0
      )
      .map((row) => row.filial)
  );
}

function buildTransferenciaExportData(rotas: TransferenciaDestinoSugestao[]): {
  total: number;
  resumoRotas: string;
  resumoDestinosUrgencia: string;
} {
  const total = rotas.reduce((sum, rota) => sum + Math.max(0, Math.round(rota.quantidade ?? 0)), 0);
  const resumoRotas = buildExportListText(
    rotas.map((rota) => `${rota.origemLabel} -> ${rota.destinoLabel}: ${fmt(rota.quantidade)} un`)
  );

  const destinosMap = new Map<string, { label: string; cobertura?: number }>();
  rotas.forEach((rota) => {
    if (!destinosMap.has(rota.destinoCanonico)) {
      destinosMap.set(rota.destinoCanonico, {
        label: rota.destinoLabel,
        cobertura: rota.destinoCobertura,
      });
    }
  });
  const resumoDestinosUrgencia = buildExportListText(
    Array.from(destinosMap.values())
      .sort((a, b) => (a.cobertura ?? Number.POSITIVE_INFINITY) - (b.cobertura ?? Number.POSITIVE_INFINITY))
      .map((destino) =>
        destino.cobertura != null
          ? `${destino.label}: ${Math.round(destino.cobertura)}d cobertura`
          : `${destino.label}: sem cobertura`
      )
  );

  return { total, resumoRotas, resumoDestinosUrgencia };
}

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

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      await worker();
    })
  );

  return results;
}

async function buildListaLojaExportRows(
  companyKey: string,
  codFilial: string | null,
  itens: ListaItem[],
  diasCorridosMes: number,
  transferenciasPorItem?: Record<string, TransferenciaDestinoSugestao[]>
): Promise<Array<Record<string, string | number | boolean | null>>> {
  const company = resolveCompany(companyKey);
  let curvaAbcMap = new Map<string, CurvaInfo>();
  try {
    const abcScope = await fetchCurvaAbcScope(companyKey as CompanyKey, codFilial);
    curvaAbcMap = calcularCurvasAbcProdutos(abcScope.produtos ?? []);
  } catch {
    curvaAbcMap = new Map<string, CurvaInfo>();
  }

  const detalhesPorItem = await mapWithConcurrency(itens, 6, async (item) => {
    const [estoqueRowsRaw, vendasRowsRaw] = await Promise.all([
      fetchEstoquePorFilialItem(companyKey, codFilial, item.produto, item.corProduto),
      fetchVendasPorFilialItem(companyKey, codFilial, item.produto, item.corProduto),
    ]);

    const byFilial = new Map<string, FilialExportMetrics>();

    for (const row of aggregateEstoqueRowsForExport(estoqueRowsRaw, company)) {
      byFilial.set(row.filial, {
        estoque: Number(row.estoque ?? 0),
        qtde12m: 0,
        qtde60d: 0,
        qtdeMesAtual: 0,
        valor12m: 0,
      });
    }

    for (const row of aggregateVendasRowsForExport(vendasRowsRaw, company)) {
      const prev = byFilial.get(row.filial);
      byFilial.set(row.filial, {
        estoque: prev?.estoque ?? 0,
        qtde12m: Number(row.qtde12m ?? 0),
        qtde60d: Number(row.qtde60d ?? 0),
        qtdeMesAtual: Number(row.qtdeMesAtual ?? 0),
        valor12m: Number(row.valor12m ?? 0),
      });
    }

    return {
      byFilial,
      filiaisComEstoque: buildFiliaisComEstoqueText(estoqueRowsRaw),
      filiaisQueVenderam: buildFiliaisQueVenderamText(vendasRowsRaw),
      detalheEstoqueTooltip: buildEstoqueTooltipText(estoqueRowsRaw),
      detalheVendas12mTooltip: buildVendasTooltipText(vendasRowsRaw, "12m"),
      detalheVendas60dTooltip: buildVendasTooltipText(vendasRowsRaw, "60d"),
      detalheVendasMesAtualTooltip: buildVendasTooltipText(vendasRowsRaw, "mesAtual"),
      detalheValor12mTooltip: buildVendasTooltipText(vendasRowsRaw, "valor12m"),
    };
  });

  const filiaisOrdenadas = Array.from(
    new Set(detalhesPorItem.flatMap((detail) => Array.from(detail.byFilial.keys())))
  ).sort((a, b) => compareFilialDisplayOrder(a, b, company));

  return itens.map((item, index) => {
    const itemKey = buildItemKey(item.produto, item.corProduto);
    const rotasTransferencia = transferenciasPorItem?.[itemKey] ?? [];
    const transferenciaExport =
      rotasTransferencia.length > 0 ? buildTransferenciaExportData(rotasTransferencia) : null;
    const curvaAbc = curvaAbcMap.get(itemKey)?.curva ?? null;
    const baseRow = buildListaLojaExportRow(item, diasCorridosMes, { curvaAbc, transferenciaExport });
    const detalhes = detalhesPorItem[index];

    baseRow.FILIAIS_COM_ESTOQUE = detalhes.filiaisComEstoque;
    baseRow.FILIAIS_QUE_VENDERAM = detalhes.filiaisQueVenderam;
    baseRow.DETALHE_ESTOQUE_FILIAIS_TOOLTIP = detalhes.detalheEstoqueTooltip;
    baseRow.DETALHE_VENDAS_12M_FILIAIS_TOOLTIP = detalhes.detalheVendas12mTooltip;
    baseRow.DETALHE_VENDAS_60D_FILIAIS_TOOLTIP = detalhes.detalheVendas60dTooltip;
    baseRow.DETALHE_VENDAS_MES_ATUAL_FILIAIS_TOOLTIP = detalhes.detalheVendasMesAtualTooltip;
    baseRow.DETALHE_VALOR_12M_FILIAIS_TOOLTIP = detalhes.detalheValor12mTooltip;

    for (const filial of filiaisOrdenadas) {
      const token = buildExportHeaderToken(filial);
      const metricas = detalhes.byFilial.get(filial);
      baseRow[`ESTOQUE_${token}`] = metricas?.estoque ?? 0;
      baseRow[`QTDE_12M_OU_PERIODO_${token}`] = metricas?.qtde12m ?? 0;
      baseRow[`QTDE_12M_${token}`] = metricas?.qtde12m ?? 0;
      baseRow[`QTDE_60D_${token}`] = metricas?.qtde60d ?? 0;
      baseRow[`QTDE_MES_ATUAL_${token}`] = metricas?.qtdeMesAtual ?? 0;
      baseRow[`VALOR_12M_${token}`] = metricas?.valor12m ?? 0;
    }

    return baseRow;
  });
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
  const mediaVendasMes = Number(item.qtde12m ?? 0) / getMesesHistoricoFilial(item);
  if (mediaVendasMes < 1) return false;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  return estoqueAtual <= mediaVendasMes * 2;
}

function calcQtdSugestaoS(item: ListaItem): number {
  const mediaVendasMes = Number(item.qtde12m ?? 0) / getMesesHistoricoFilial(item);
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
  const mesesBase = getMesesHistoricoFilial(item);
  const mesesSemVenda = dias / 30;
  const mesesAtivos = mesesBase - mesesSemVenda;
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
  const vendasMes = Number(item.vendasMesAtual ?? 0);
  const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const limiteDias = getLimiteDiasReposicao(item);
  const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
  const qtdSuficiente = consumoDiario > 0 && duracaoAtual >= limiteDias;

  const mediaVendasMes = Number(item.qtde12m ?? 0) / getMesesHistoricoFilial(item);
  const sEligivel = mediaVendasMes >= 1 && estoqueAtual <= mediaVendasMes * 2;
  const qtdS = sEligivel ? calcQtdSugestaoS(item) : 0;

  if (qtdFinal > 0) {
    if (qtdS > 0 && qtdFinal < 0.6 * qtdS) {
      return { qtdFinal: Math.round(0.8 * qtdS + 0.4 * qtdFinal), qtdS: 0, qtdE: 0, qtdSuficiente: false, semSugestao: false };
    }
    return { qtdFinal, qtdS: 0, qtdE: 0, qtdSuficiente: false, semSugestao: false };
  }
  if (qtdSuficiente) {
    return { qtdFinal: 0, qtdS: 0, qtdE: 0, qtdSuficiente: true, semSugestao: false };
  }
  if (sEligivel && qtdS > 0) {
    return { qtdFinal: 0, qtdS, qtdE: 0, qtdSuficiente: false, semSugestao: false };
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

function itemTemSugestaoCompra(item: ListaItem, diasCorridosMes: number): boolean {
  const sugestao = getReposicaoCompraView(item, diasCorridosMes);
  return sugestao.qtdFinal > 0 || sugestao.qtdS > 0 || sugestao.qtdE > 0;
}

function itemEhBarrado(item: ListaItem, diasCorridosMes: number): boolean {
  const sugestao = getReposicaoCompraView(item, diasCorridosMes);
  return (
    sugestao.qtdFinal === 0 &&
    sugestao.qtdS === 0 &&
    sugestao.qtdE === 0 &&
    (sugestao.qtdSuficiente || sugestao.semSugestao)
  );
}

function formatFixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatMaybe(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return "0";
  return formatFixed(value, digits);
}

function getHistoricoPeriodoLabel(mesesHistoricoFilial: number): string {
  return mesesHistoricoFilial >= 12
    ? "últimos 12 meses"
    : `período real de ${formatFixed(mesesHistoricoFilial, 1)} meses`;
}

function buildFinalBlockReason(duracaoAtual: number, limiteDias: number): string {
  return `Duração atual de ${Math.round(duracaoAtual)} dias não ficou abaixo do limite de ${limiteDias} dias.`;
}

function buildSBlockReason(mediaVendasMes: number, estoqueAtual: number): string {
  if (mediaVendasMes < 1) {
    return `Média mensal de ${formatFixed(mediaVendasMes)} un./mês ficou abaixo do mínimo de 1,0 un./mês.`;
  }
  return `Estoque atual de ${Math.round(estoqueAtual)} un. ficou acima de 2x a média mensal (${formatFixed(mediaVendasMes * 2)} un.).`;
}

function buildEBlockReason(
  item: ListaItem,
  mesesSemVenda: number | null,
  mesesAtivos: number | null,
  velocidadeAjustada: number | null,
  estoqueAtual: number
): string {
  const qtde12m = Number(item.qtde12m ?? 0);
  const mesesHistoricoFilial = getMesesHistoricoFilial(item);
  if (qtde12m <= 0) {
    return `Não houve vendas no ${getHistoricoPeriodoLabel(mesesHistoricoFilial)}, então não há base para sugestão E.`;
  }
  if (item.diasDesdeUltimaVenda != null && item.diasDesdeUltimaVenda < 30) {
    return `Última venda há ${Math.round(item.diasDesdeUltimaVenda)} dias, abaixo do mínimo de 30 dias para considerar item estagnado.`;
  }
  if (mesesAtivos != null && mesesAtivos < 1) {
    return `Período ativo estimado de ${formatMaybe(mesesAtivos)} meses ficou abaixo do mínimo de 1,0 mês.`;
  }
  if (velocidadeAjustada != null && velocidadeAjustada < 0.5) {
    return `Velocidade ajustada de ${formatMaybe(velocidadeAjustada)} un./mês ficou abaixo do corte de 0,5 un./mês.`;
  }
  if (estoqueAtual > 0) {
    return `Estoque atual de ${Math.round(estoqueAtual)} un. ainda existe, então o item não entrou como E.`;
  }
  if (mesesSemVenda != null) {
    return `Item parado há cerca de ${formatMaybe(mesesSemVenda)} meses, mas não passou no conjunto completo de critérios para sugestão E.`;
  }
  return "Não passou nos critérios de sugestão E com os dados atuais.";
}

function buildListaLojaExportRow(
  item: ListaItem,
  diasCorridosMes: number,
  exportData?: {
    curvaAbc: Curva | null;
    transferenciaExport: {
      total: number;
      resumoRotas: string;
      resumoDestinosUrgencia: string;
    } | null;
  }
): Record<string, string | number | boolean | null> {
  const sugestao = getReposicaoCompraView(item, diasCorridosMes);
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const vendasMesAtual = Number(item.vendasMesAtual ?? 0);
  const consumoDiario = diasCorridosMes > 0 ? vendasMesAtual / diasCorridosMes : 0;
  const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
  const limiteDias = getLimiteDiasReposicao(item);
  const diasHistoricoFilial = Math.min(365, Math.max(0, Number(item.diasHistoricoFilial ?? 365)));
  const mesesHistoricoFilial = getMesesHistoricoFilial(item);
  const historicoParcial = Boolean(item.historicoParcial ?? false);
  const mediaVendasMes = Number(item.qtde12m ?? 0) / mesesHistoricoFilial;
  const mesesSemVenda = item.diasDesdeUltimaVenda != null ? item.diasDesdeUltimaVenda / 30 : null;
  const mesesAtivos = mesesSemVenda != null ? mesesHistoricoFilial - mesesSemVenda : null;
  const velocidadeAjustada = mesesAtivos != null && mesesAtivos > 0 ? Number(item.qtde12m ?? 0) / mesesAtivos : null;
  const qtdCalculada = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;
  const status = qtdCalculada > 0 ? "Sugerido" : "Barrado";
  const tipo = sugestao.qtdFinal > 0
    ? "Final"
    : sugestao.qtdS > 0
      ? "S"
      : sugestao.qtdE > 0
        ? "E"
        : sugestao.qtdSuficiente
          ? "Suficiente"
          : "Sem sugestão";

  let regra = "";
  let resumo = "";

  if (sugestao.qtdFinal > 0) {
    regra = "Consumo diário = vendas do mês atual / dias corridos. Se a duração atual fica abaixo do limite, a compra cobre a diferença.";
    resumo = `Sugestão final de compra de ${qtdCalculada} un. porque a duração atual é ${Math.round(duracaoAtual)} dias, abaixo do limite de ${limiteDias} dias.`;
  } else if (sugestao.qtdS > 0) {
    regra = `Qtd S = teto((limite de ${limiteDias} dias / 30) x média mensal).`;
    resumo = `Sugestão S de ${qtdCalculada} un. com base na média de ${formatFixed(mediaVendasMes)} un./mês e no limite de ${limiteDias} dias.`;
  } else if (sugestao.qtdE > 0) {
    regra = "Qtd E = teto((limite de reposição em meses x velocidade ajustada)).";
    resumo = `Sugestão E de ${qtdCalculada} un. porque o item ficou cerca de ${formatFixed(mesesSemVenda ?? 0, 1)} meses sem venda e a velocidade ajustada é ${formatFixed(velocidadeAjustada ?? 0)} un./mês.`;
  } else if (sugestao.qtdSuficiente) {
    regra = `Estoque atual já cobre o limite de ${limiteDias} dias.`;
    resumo = `Barrado porque o estoque atual já cobre o limite de ${limiteDias} dias.`;
  } else {
    regra = "Não houve sugestão calculada com os dados atuais.";
    resumo = "Barrado porque os dados atuais não geraram sugestão de compra.";
  }

  return {
    PRODUTO: item.produto,
    DESC_PRODUTO: item.descProduto,
    CODIGO_BARRA: item.codigoBarra || "",
    COR_PRODUTO: item.corProduto || "",
    DESC_COR: item.descCor || "",
    QUANTIDADE: Math.max(0, Math.round(item.quantidade ?? 0)),
    QTDE_12M: item.qtde12m ?? null,
    VALOR_12M: item.valor12m ?? null,
    QTDE_60D: item.qtde60d ?? null,
    VENDAS_MES_ATUAL: item.vendasMesAtual ?? null,
    CUSTO_UNIT: item.custoUnit ?? null,
    ESTOQUE_FILIAL: item.estoqueFilial ?? null,
    DIAS_DESDE_ULTIMA_VENDA: item.diasDesdeUltimaVenda ?? null,
    PRIMEIRA_ENTRADA_FILIAL: item.primeiraEntradaFilial ?? null,
    DIAS_HISTORICO_FILIAL: diasHistoricoFilial,
    MESES_HISTORICO_FILIAL: mesesHistoricoFilial,
    HISTORICO_PARCIAL: historicoParcial ? "Sim" : "Nao",
    LINHA: item.linha || "",
    SUBGRUPO: item.subgrupo || "",
    CURVA_ABC_REDE: exportData?.curvaAbc ?? "",
    STATUS: status,
    TIPO_SUGESTAO: tipo,
    REGRA_REPOSICAO: regra,
    LIMITE_DIAS: limiteDias,
    VENDAS_MES: vendasMesAtual,
    DIAS_CORRIDOS: diasCorridosMes,
    CONSUMO_DIARIO: Number.isFinite(consumoDiario) ? consumoDiario : null,
    ESTOQUE_ATUAL: estoqueAtual,
    DURACAO_ATUAL: Number.isFinite(duracaoAtual) ? duracaoAtual : null,
    QTD_CALCULADA: qtdCalculada > 0 ? qtdCalculada : null,
    MEDIA_VENDAS_MES: mediaVendasMes,
    MESES_SEM_VENDA: mesesSemVenda,
    MESES_ATIVOS: mesesAtivos,
    VELOCIDADE_AJUSTADA: velocidadeAjustada,
    QTD_S: sugestao.qtdS > 0 ? sugestao.qtdS : null,
    QTD_E: sugestao.qtdE > 0 ? sugestao.qtdE : null,
    CUSTO_TOTAL_SUGERIDO:
      qtdCalculada > 0 && Number(item.custoUnit ?? 0) > 0
        ? qtdCalculada * Number(item.custoUnit ?? 0)
        : null,
    TEM_TRANSFERENCIA_SUGERIDA: exportData?.transferenciaExport ? "Sim" : "Não",
    TRANSFERENCIA_QTD_TOTAL: exportData?.transferenciaExport?.total ?? null,
    TRANSFERENCIA_ROTAS: exportData?.transferenciaExport?.resumoRotas ?? "",
    TRANSFERENCIA_DESTINOS_URGENCIA: exportData?.transferenciaExport?.resumoDestinosUrgencia ?? "",
    QTD_SUFICIENTE: sugestao.qtdSuficiente ? "Sim" : "Não",
    SEM_SUGESTAO: sugestao.semSugestao ? "Sim" : "Não",
    FALHA_FINAL: status === "Barrado" ? buildFinalBlockReason(duracaoAtual, limiteDias) : "",
    FALHA_S: status === "Barrado" ? buildSBlockReason(mediaVendasMes, estoqueAtual) : "",
    FALHA_E: status === "Barrado" ? buildEBlockReason(item, mesesSemVenda, mesesAtivos, velocidadeAjustada, estoqueAtual) : "",
    MOTIVO_BARRADO: status === "Barrado"
      ? `Barrado porque ${buildFinalBlockReason(duracaoAtual, limiteDias)} ${buildSBlockReason(mediaVendasMes, estoqueAtual)} ${buildEBlockReason(item, mesesSemVenda, mesesAtivos, velocidadeAjustada, estoqueAtual)}`
      : "",
    RESUMO: status === "Barrado"
      ? `Barrado. Final: ${buildFinalBlockReason(duracaoAtual, limiteDias)} S: ${buildSBlockReason(mediaVendasMes, estoqueAtual)} E: ${buildEBlockReason(item, mesesSemVenda, mesesAtivos, velocidadeAjustada, estoqueAtual)}`
      : resumo,
  };
}

function calcularCurvasAbcProdutos(produtos: CurvaAbcProdutoRow[]): Map<string, CurvaInfo> {
  const base = [...produtos]
    .map((produto) => ({ produto, valor: Number(produto.vendas ?? 0) }))
    .sort((a, b) => b.valor - a.valor);
  const total = base.reduce((s, row) => s + Math.max(0, row.valor), 0);
  let cumulative = 0;
  const out = new Map<string, CurvaInfo>();
  for (const row of base) {
    cumulative += Math.max(0, row.valor);
    const percCum = total > 0 ? cumulative / total : 1;
    const curva: Curva = percCum <= 0.8 ? "A" : percCum <= 0.95 ? "B" : "C";
    const info = {
      curva,
      percParticipacao: total > 0 ? (Math.max(0, row.valor) / total) * 100 : 0,
      percCumulativo: percCum * 100,
    };
    out.set(buildItemKey(row.produto.produto, row.produto.cor ?? null), info);
  }
  return out;
}

function formatYmdForCurvaAbc(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const curvaAbcScopeCache = new Map<string, Promise<CurvaAbcScopeData>>();

function fetchCurvaAbcScope(companyKey: CompanyKey, filial: string | null): Promise<CurvaAbcScopeData> {
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 365);
  const cacheKey = `${companyKey}|${filial ?? "__ALL__"}|${formatYmdForCurvaAbc(today)}`;
  const cached = curvaAbcScopeCache.get(cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({
    company: companyKey,
    start: formatYmdForCurvaAbc(start),
    end: formatYmdForCurvaAbc(today),
    porCor: "1",
  });
  if (filial) params.set("filial", filial);

  const promise = fetch(`/api/curva-abc?${params.toString()}`, { cache: "no-store" }).then(async (res) => {
    if (!res.ok) throw new Error("Erro ao carregar Curva ABC");
    return (await res.json()) as CurvaAbcScopeData;
  });
  curvaAbcScopeCache.set(cacheKey, promise);
  return promise;
}

function getLogicalAbcFilialScopes(companyKey: CompanyKey, company: CompanyConfig | null): Array<{ filial: string; label: string }> {
  const filiais = company?.filialFilters.sales ?? [];
  const matrizFiliais = new Set(companyKey === "scarfme" ? ["SCARF ME - MATRIZ"] : companyKey === "nerd" ? ["NERD"] : []);
  const ecommerceFilials = new Set(company?.ecommerceFilials ?? []);
  const ecommerceCanonical = filiais.find((filial) => ecommerceFilials.has(filial)) ?? null;
  const nonCanonical = new Set<string>();
  Object.entries(company?.filialGroups ?? {}).forEach(([canonical, members]) => {
    members.forEach((member) => {
      if (member !== canonical) nonCanonical.add(member);
    });
  });

  return filiais
    .filter((filial) => {
      if (matrizFiliais.has(filial)) return false;
      if (nonCanonical.has(filial)) return false;
      if (ecommerceFilials.has(filial) && filial !== ecommerceCanonical) return false;
      return true;
    })
    .map((filial) => ({ filial, label: getFilialLabelForDisplay(company, filial) }));
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
  transferenciasPorItem?: Record<string, TransferenciaDestinoSugestao[]>;
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
  transferenciasPorItem,
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
  const showTransferenciaColumn = transferenciasPorItem != null;

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
    blendAplicado?: boolean;
    qtdFinalPuro?: number;
    qtdSBlend?: number;
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
    mesesHistoricoFilial: number;
    estoqueAtual: number;
    limiteDias: number;
    qtdS: number;
  }>(null);
  const [sugestaoETooltip, setSugestaoETooltip] = useState<null | {
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
  const [historicoTooltip, setHistoricoTooltip] = useState<null | {
    x: number;
    y: number;
    primeiraEntradaFilial: string | null;
    diasHistoricoFilial: number;
    mesesHistoricoFilial: number;
  }>(null);
  const [transferenciaTooltip, setTransferenciaTooltip] = useState<null | {
    x: number;
    y: number;
    rotas: TransferenciaDestinoSugestao[];
  }>(null);

  const [estoqueCache, setEstoqueCache] = useState<Record<string, Array<{ filial: string; estoque: number }>>>({});
  const [vendasCache, setVendasCache] = useState<Record<string, FilialVendaRow[]>>({});
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
        primeiraEntradaFilial: string | null;
        diasHistoricoFilial: number | null;
        mesesHistoricoFilial: number | null;
        historicoParcial: boolean | null;
      }
    >
  >({});

  function hasResolvedLiveMetrics(values: {
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
  }): boolean {
    return Object.values(values).some((value) => value !== null && value !== undefined);
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setEstoqueCache({});
      setVendasCache({});
      setLiveMetrics({});
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [filialScopeKey]);

  const companyConfig = useMemo(() => resolveCompany(companyKey), [companyKey]);
  const [abcFullMap, setAbcFullMap] = useState<Map<string, CurvaInfo> | null>(null);
  const [abcFullLoadFailed, setAbcFullLoadFailed] = useState(false);
  const abcDisplayMap = abcFullMap ?? (abcFullLoadFailed ? abcMap : new Map<string, CurvaInfo>());

  useEffect(() => {
    let cancelled = false;
    fetchCurvaAbcScope(companyKey, filialCod)
      .then((data) => {
        if (cancelled) return;
        setAbcFullMap(calcularCurvasAbcProdutos(data.produtos ?? []));
        setAbcFullLoadFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setAbcFullMap(null);
        setAbcFullLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, filialCod, filialScopeKey]);

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
        setLiveMetrics((prev) => {
          const next = { ...prev };
          for (const row of rows) {
            if (!hasResolvedLiveMetrics(row.values)) continue;
            next[row.key] = row.values;
          }
          return next;
        });
      })
      .catch(() => {
        // silencioso: mantém fallback visual "—"
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey, filialCod, filialScopeKey, itens]);

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
            <th className={styles.colNumeric}>Sugestão de Reposição</th>
            {showTransferenciaColumn && <th>Sugestão de Transferência</th>}
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
                const hasLive = Object.prototype.hasOwnProperty.call(liveMetrics, itemKey);
                const valor12m = hasLive ? (live?.valor12m ?? null) : (item.valor12m ?? null);
                const qtde12m = hasLive ? (live?.qtde12m ?? null) : (item.qtde12m ?? null);
                const qtde60d = hasLive ? (live?.qtde60d ?? null) : (item.qtde60d ?? null);
                const vendasMesAtual = hasLive ? (live?.vendasMesAtual ?? null) : (item.vendasMesAtual ?? null);
                const estoqueFilial = hasLive ? (live?.estoqueFilial ?? null) : (item.estoqueFilial ?? null);
                const custoUnit = hasLive ? (live?.custoUnit ?? null) : (item.custoUnit ?? null);
                const diasDesdeUltimaVenda = hasLive ? (live?.diasDesdeUltimaVenda ?? null) : (item.diasDesdeUltimaVenda ?? null);
                const primeiraEntradaFilial = hasLive ? (live?.primeiraEntradaFilial ?? null) : (item.primeiraEntradaFilial ?? null);
                const diasHistoricoFilial = hasLive ? (live?.diasHistoricoFilial ?? null) : (item.diasHistoricoFilial ?? null);
                const mesesHistoricoFilial = hasLive ? (live?.mesesHistoricoFilial ?? null) : (item.mesesHistoricoFilial ?? null);
                const historicoParcial = hasLive ? (live?.historicoParcial ?? false) : (item.historicoParcial ?? false);
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
                  const abc = abcDisplayMap.get(k);
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
                        const abc = abcDisplayMap.get(k);
                        if (!abc) return;
                        const liveKey = `${filialScopeKey}::${k}`;
                        const liveVal = liveMetrics[liveKey]?.valor12m;
                        const val12m = liveVal ?? Number(item.valor12m ?? 0);
                        const periodoHistorico = historicoParcial
                          ? `Últimos ${formatFixed(getMesesHistoricoFilial({ mesesHistoricoFilial }))} meses (histórico real da filial)`
                          : "Últimos 12 meses";
                        const hoverKey = `${filialScopeKey}::abc::${k}`;
                        abcHoverKeyRef.current = hoverKey;
                        // Mostra imediatamente os dados do badge (sem esperar o fetch)
                        setAbcTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          produto: item.produto,
                          cor: item.descCor || "",
                          escopo: filialCod ? "loja" : "geral",
                          periodo: periodoHistorico,
                          regra: "Classificação por faturamento acumulado (A até 80%, B até 95%, C acima de 95%).",
                          curva: abc.curva,
                          valor12m: val12m,
                          percParticipacao: abc.percParticipacao,
                          percCumulativo: abc.percCumulativo,
                          filiaisLoading: true,
                          filiais: [],
                        });
                        // Carrega a base ABC completa de cada loja logica.
                        try {
                          const scopes = getLogicalAbcFilialScopes(companyKey, companyConfig);
                          const selectedLabel = filialNome ? getFilialLabelForDisplay(companyConfig, filialNome) : null;
                          const scopeResults = await Promise.all(
                            scopes.map(async (scope) => ({
                              scope,
                              data: await fetchCurvaAbcScope(companyKey, scope.filial),
                            }))
                          );
                          if (abcHoverKeyRef.current !== hoverKey) return;
                          // Usa a base ABC completa de cada loja logica, nao apenas os itens da lista.
                          const filialResults: Array<{ filial: string; curva: Curva; valor12m: number; participacao: number; acumulado: number }> = [];
                          for (const { scope, data } of scopeResults) {
                            if (selectedLabel && normalizeKey(scope.label) === normalizeKey(selectedLabel)) continue;
                            const produtos = data.produtos ?? [];
                            const scopeMap = calcularCurvasAbcProdutos(produtos);
                            const itemAbc = scopeMap.get(k);
                            if (!itemAbc) continue;
                            const produtoAbc = produtos.find((p) => buildItemKey(p.produto, p.cor ?? null) === k);
                            const valor12mFilial = Number(produtoAbc?.vendas ?? 0);
                            if (valor12mFilial <= 0) continue;
                            filialResults.push({
                              filial: scope.label,
                              curva: itemAbc.curva,
                              valor12m: valor12mFilial,
                              participacao: itemAbc.percParticipacao,
                              acumulado: itemAbc.percCumulativo,
                            });
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
                  {qtde12m != null ? (
                    <>
                      {fmt(qtde12m)}
                      {historicoParcial ? (
                        <span
                          className={styles.partialHistoryBadge}
                          onMouseEnter={(e) =>
                            setHistoricoTooltip({
                              x: e.clientX,
                              y: e.clientY,
                              primeiraEntradaFilial,
                              diasHistoricoFilial: Number(diasHistoricoFilial ?? 365),
                              mesesHistoricoFilial: getMesesHistoricoFilial({ mesesHistoricoFilial }),
                            })
                          }
                          onMouseLeave={() => setHistoricoTooltip(null)}
                        >
                          (&lt;12m)
                        </span>
                      ) : null}
                    </>
                  ) : "—"}
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
                      const metricas = await fetchControleEstoqueItemMetricasClient({
                        company: companyKey,
                        filial: filialCod,
                        includeHistorico: false,
                        item: {
                          produto: item.produto.trim(),
                          corProduto: item.corProduto?.trim() || null,
                        },
                      });
                      const rows = (metricas?.estoquePorFilial ?? []).map((r) => ({
                        filial: r.filial,
                        estoque: Number(r.estoque ?? 0),
                      }));
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
                  const sugestao = getReposicaoCompraView(
                    {
                      ...item,
                      vendasMesAtual,
                      estoqueFilial,
                      qtde12m,
                      diasDesdeUltimaVenda,
                      primeiraEntradaFilial,
                      diasHistoricoFilial,
                      mesesHistoricoFilial,
                      historicoParcial,
                    },
                    diasCorridosMes
                  );
                  if (sugestao.qtdFinal > 0) {
                    const vendasMes = Number(vendasMesAtual ?? 0);
                    const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
                    const estoqueAtual = Number(estoqueFilial ?? 0);
                    const limiteDias = getLimiteDiasReposicao(item);
                    const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
                    const qtdFinalPuro = consumoDiario > 0 && duracaoAtual < limiteDias
                      ? Math.ceil(consumoDiario * (limiteDias - duracaoAtual))
                      : 0;
                    const mediaVendasMesBlend = Number(qtde12m ?? 0) / getMesesHistoricoFilial({ mesesHistoricoFilial });
                    const sEligivelBlend = mediaVendasMesBlend >= 1 && estoqueAtual <= mediaVendasMesBlend * 2;
                    const qtdSBlend = sEligivelBlend ? calcQtdSugestaoS(item) : 0;
                    const blendAplicado = qtdSBlend > 0 && qtdFinalPuro > 0 && qtdFinalPuro < 0.6 * qtdSBlend;
                    return (
                      <span
                        className={styles.reporAdd}
                        onMouseEnter={(e) =>
                          setSugestaoTooltip({
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
                            qtdCalculada: sugestao.qtdFinal,
                            blendAplicado,
                            qtdFinalPuro,
                            qtdSBlend,
                          })
                        }
                        onMouseLeave={() => setSugestaoTooltip(null)}
                      >
                        {fmt(sugestao.qtdFinal)}{blendAplicado && <>{" "}<span style={{ display: "inline-flex", width: 16, height: 16, borderRadius: "999px", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 800, color: "#0f172a", background: "#fde047", border: "1px solid #facc15", verticalAlign: "middle", cursor: "help" }}>⚡</span></>}
                      </span>
                    );
                  }
                  if (sugestao.qtdS > 0) {
                    const mediaVendasMes = Number(qtde12m ?? 0) / getMesesHistoricoFilial({ mesesHistoricoFilial });
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
                              mesesHistoricoFilial: getMesesHistoricoFilial({ mesesHistoricoFilial }),
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
                    const eInfo = calcQtdSugestaoEInfo({
                      ...item,
                      qtde12m,
                      diasDesdeUltimaVenda,
                      primeiraEntradaFilial,
                      diasHistoricoFilial,
                      mesesHistoricoFilial,
                      historicoParcial,
                    });
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
                              mesesHistoricoFilial: getMesesHistoricoFilial({ mesesHistoricoFilial }),
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
              {showTransferenciaColumn && (
                <td>
                  {(() => {
                    const rotas = transferenciasPorItem?.[buildItemKey(item.produto, item.corProduto)] ?? [];
                    if (rotas.length === 0) return <span className={styles.cellMetric}>—</span>;
                    const total = rotas.reduce((s, r) => s + r.quantidade, 0);
                    return (
                      <span
                        className={styles.transferenciaTotalBadge}
                        onMouseEnter={(e) => setTransferenciaTooltip({ x: e.clientX, y: e.clientY, rotas })}
                        onMouseLeave={() => setTransferenciaTooltip(null)}
                      >
                        <span className={styles.transferenciaTotalBadgeIcon}>⇄</span>
                        {fmt(total)}
                      </span>
                    );
                  })()}
                </td>
              )}
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
                      {
                        ...item,
                        vendasMesAtual,
                        estoqueFilial,
                        qtde12m,
                        diasDesdeUltimaVenda,
                        primeiraEntradaFilial,
                        diasHistoricoFilial,
                        mesesHistoricoFilial,
                        historicoParcial,
                      },
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
            <span>{abcTooltip.periodo === "Últimos 12 meses" ? "Valor 12 meses" : "Valor no período"}</span>
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
          {sugestaoTooltip.blendAplicado && sugestaoTooltip.qtdFinalPuro != null && sugestaoTooltip.qtdSBlend != null && (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine}><strong>Cálculo atual (consumo):</strong> {fmt(sugestaoTooltip.qtdFinalPuro)} un</div>
              <div className={styles.metricTooltipLine}><strong>Cálculo histórico (S):</strong> {fmt(sugestaoTooltip.qtdSBlend)} un</div>
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#94a3b8" }}>
                Atual ({fmt(sugestaoTooltip.qtdFinalPuro)}) &lt; 60% de S ({fmt(Math.round(0.6 * sugestaoTooltip.qtdSBlend))}) → blend aplicado
              </div>
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#94a3b8" }}>
                = 80% × {fmt(sugestaoTooltip.qtdSBlend)} + 40% × {fmt(sugestaoTooltip.qtdFinalPuro)} = {fmt(sugestaoTooltip.qtdCalculada)}
              </div>
            </>
          )}
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Qtd sugerida:</strong> {fmt(sugestaoTooltip.qtdCalculada)} un</div>
        </div>
      )}
      {sugestaoSTooltip && (
        <div className={styles.metricTooltip} style={{ left: sugestaoSTooltip.x + 12, top: sugestaoSTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Regra S (mesma lógica da ABC)</div>
          <div className={styles.metricTooltipLine}><strong>Base historica filial:</strong> {sugestaoSTooltip.mesesHistoricoFilial.toFixed(1)} meses</div>
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
          <div className={styles.metricTooltipLine}>
            <strong>Vendas no período base:</strong> {fmt(sugestaoETooltip.qtde12m)} un
          </div>
          <div className={styles.metricTooltipLine}><strong>Base historica filial:</strong> {sugestaoETooltip.mesesHistoricoFilial.toFixed(1)} meses</div>
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
      {historicoTooltip && (
        <div className={styles.metricTooltip} style={{ left: historicoTooltip.x + 12, top: historicoTooltip.y + 12 }}>
          <div className={styles.metricTooltipTitle}>Historico parcial na filial</div>
          <div className={styles.metricTooltipLine}>Este item ainda nao completou 12 meses de historico na filial selecionada.</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}><strong>Data base historico:</strong> {formatHistoricoDate(historicoTooltip.primeiraEntradaFilial)}</div>
          <div className={styles.metricTooltipLine}><strong>Dias de historico:</strong> {fmt(historicoTooltip.diasHistoricoFilial)}</div>
          <div className={styles.metricTooltipLine}><strong>Meses de historico:</strong> {historicoTooltip.mesesHistoricoFilial.toFixed(1)}</div>
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine}>Os calculos historicos usam o periodo real disponivel ate completar 12 meses.</div>
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
      {transferenciaTooltip && (() => {
        const rotas = transferenciaTooltip.rotas;
        // Agrupa destinos únicos com métricas para o resumo, ordena por cobertura ASC (mais urgente primeiro)
        const destinosMap = new Map<string, { label: string; cobertura: number; diaria: number; estoque: number; vendas12m: number }>();
        rotas.forEach((r) => {
          if (!destinosMap.has(r.destinoCanonico) && r.destinoCobertura != null) {
            destinosMap.set(r.destinoCanonico, {
              label: r.destinoLabel,
              cobertura: r.destinoCobertura,
              diaria: r.destinoDiaria ?? 0,
              estoque: r.destinoEstoque ?? 0,
              vendas12m: r.destinoVendas12m ?? 0,
            });
          }
        });
        const destinosSorted = Array.from(destinosMap.values()).sort((a, b) => a.cobertura - b.cobertura);
        return (
          <div className={styles.metricTooltip} style={{ left: transferenciaTooltip.x + 12, top: transferenciaTooltip.y + 12 }}>
            <div className={styles.metricTooltipTitle}>Sugestão de Transferência</div>
            <div className={styles.metricTooltipDivider} />
            {rotas.map((r) => (
              <div key={`${r.origemCanonico}|${r.destinoCanonico}`} className={styles.metricTooltipRow}>
                <span>{r.origemLabel} → {r.destinoLabel}</span>
                <span>{fmt(r.quantidade)} un</span>
              </div>
            ))}
            {rotas.length > 1 && (
              <div className={styles.metricTooltipTotal}>
                <span>Total</span>
                <span>{fmt(rotas.reduce((s, r) => s + r.quantidade, 0))} un</span>
              </div>
            )}
            {destinosSorted.length > 0 && (
              <>
                <div className={styles.metricTooltipDivider} />
                <div className={styles.metricTooltipMeta} style={{ marginBottom: 6 }}>Lojas destino (por urgência):</div>
                {destinosSorted.map((d) => (
                  <div key={d.label} className={styles.metricTooltipRow} style={{ alignItems: "flex-start", gap: 10 }}>
                    <span style={{ minWidth: 82 }}>{d.label}</span>
                    <span className={styles.transferenciaDestinoResumo}>
                      Cob {Math.round(d.cobertura)}d · Cons {d.diaria.toFixed(1)}/dia · Est {fmt(d.estoque)} · V12m {fmt(d.vendas12m)}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        );
      })()}
    </div>
  );
}

export default function ListaLojaPage({ companyKey, companyName, companySlug }: ListaLojaPageProps) {
  const { user, isLoading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const initialMode: Mode = searchParams.get("view") === "compras-salvas" ? "saved-purchases" : "list";

  const [mode, setMode] = useState<Mode>(initialMode);

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
  const [colecoesDisponiveis, setColecoesDisponiveis] = useState<string[]>([]);
  const [loadingColecoesOpcoes, setLoadingColecoesOpcoes] = useState(false);
  const [colecaoParaImportar, setColecaoParaImportar] = useState("");
  const [importandoColecao, setImportandoColecao] = useState(false);

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
  const [exportandoXlsx, setExportandoXlsx] = useState(false);
  const [filtrarSugeridos, setFiltrarSugeridos] = useState(false);
  const [filtrarBarrados, setFiltrarBarrados] = useState(false);
  const [filtrarTransferencias, setFiltrarTransferencias] = useState(false);
  const [transferenciasPorItem, setTransferenciasPorItem] = useState<Record<string, TransferenciaDestinoSugestao[]>>({});
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [permissoesCarregadas, setPermissoesCarregadas] = useState(false);
  const filialConsultaSelecionada =
    filialSelecionada?.codFilial === TODAS_FILIAIS_VALUE ? null : (filialSelecionada?.codFilial?.trim() || null);
  const itensTransferenciaKey = useMemo(
    () => itens.map((item) => buildItemKey(item.produto, item.corProduto)).sort().join("\n"),
    [itens]
  );


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
            primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
            diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
            mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
            historicoParcial: vendas?.historicoParcial ?? null,
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

  useEffect(() => {
    if (mode !== "editor" || itensTransferenciaKey.length === 0) {
      setTransferenciasPorItem({});
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchControleTransferenciasLista(companyKey);
        if (cancelled) return;

        const itemKeys = new Set(itensTransferenciaKey.split("\n").filter(Boolean));
        const grupos = calculateTransfers(data, companyKey);
        const next: Record<string, TransferenciaDestinoSugestao[]> = {};

        for (const grupo of grupos) {
          for (const transferItem of grupo.items) {
            const key = getTransferenciaItemKeys(transferItem).find((k) => itemKeys.has(k));
            if (!key) continue;
            // Chave única para a rota origem→destino deste item
            const rotaKey = `${normalizeKey(transferItem.origemCanonico || transferItem.origem)}|${normalizeKey(transferItem.destinoCanonico || transferItem.destino)}`;
            const list = next[key] ?? [];
            const existing = list.find(
              (r) => `${normalizeKey(r.origemCanonico)}|${normalizeKey(r.destinoCanonico)}` === rotaKey
            );
            if (existing) {
              existing.quantidade += Math.max(0, Math.round(transferItem.quantidade ?? 0));
            } else {
              const chunk = transferItem.quantidadeExplicacao?.[0];
              const filialDest = transferItem.itemOriginal.filiais.find(
                (f) => (f.filial ?? "").trim().toUpperCase() === (transferItem.destinoCanonico ?? "").trim().toUpperCase()
              );
              list.push({
                origemLabel: transferItem.origem,
                origemCanonico: transferItem.origemCanonico || transferItem.origem,
                destinoLabel: transferItem.destino,
                destinoCanonico: transferItem.destinoCanonico || transferItem.destino,
                quantidade: Math.max(0, Math.round(transferItem.quantidade ?? 0)),
                destinoCobertura: chunk?.destino.coberturaDias,
                destinoDiaria: chunk?.destino.diaria,
                destinoEstoque: filialDest != null ? Math.max(0, filialDest.stock) : undefined,
                destinoVendas12m: filialDest?.vendas12m,
              });
            }
            next[key] = list.filter((r) => r.quantidade > 0);
          }
        }

        if (!cancelled) setTransferenciasPorItem(next);
      } catch {
        if (!cancelled) setTransferenciasPorItem({});
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [companyKey, itensTransferenciaKey, mode]);

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
            const matchBarra = await produtoFromBarcodeLookup(porBarra, companyKey);
            if (matchBarra) results = [matchBarra];
          } else if (isSomenteDigitosCodigoBarras(term)) {
            results = [];
          }
        }

        if (results.length === 0 && !isSomenteDigitosCodigoBarras(term)) {
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

  useEffect(() => {
    if (!modalAberto || companyKey !== "scarfme") {
      return;
    }
    let active = true;
    setLoadingColecoesOpcoes(true);
    void fetch("/api/stock-by-filial?company=scarfme&filtersOnly=true", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { filterOptions?: { colecoes?: string[] } };
      })
      .then((json) => {
        if (!active) return;
        setColecoesDisponiveis(json?.filterOptions?.colecoes ?? []);
      })
      .catch(() => {
        if (active) setColecoesDisponiveis([]);
      })
      .finally(() => {
        if (active) setLoadingColecoesOpcoes(false);
      });
    return () => {
      active = false;
    };
  }, [modalAberto, companyKey]);

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
    setColecaoParaImportar("");
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
    setColecaoParaImportar("");
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
    setColecaoParaImportar("");
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
        let vendas: Awaited<ReturnType<typeof fetchVendasItemMetricas>> = null;
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
                  primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
                  diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
                  mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
                  historicoParcial: vendas?.historicoParcial ?? null,
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
              primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
              diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
              mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
              historicoParcial: vendas?.historicoParcial ?? null,
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

  const importarColecaoProdutos = useCallback(async () => {
    const colecao = colecaoParaImportar.trim();
    if (!colecao) {
      mostrarNotificacao("Selecione uma coleção", "error");
      return;
    }
    if (companyKey !== "scarfme") return;

    const filialCod = filialConsultaSelecionada;
    setImportandoColecao(true);
    try {
      const lista = await fetchProdutosPorColecao(colecao, companyKey);
      if (lista.length === 0) {
        mostrarNotificacao("Nenhum item encontrado para esta coleção", "error");
        return;
      }

      type BatchAgg = {
        item: Omit<ListaItem, "quantidade" | "qtde12m" | "valor12m" | "qtde60d" | "vendasMesAtual" | "custoUnit" | "estoqueFilial">;
        quantidade: number;
      };
      const agregados = new Map<string, BatchAgg>();
      for (const p of lista) {
        const key = buildItemKey(p.produto, p.corProduto);
        if (agregados.has(key)) continue;
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
            primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
            diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
            mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
            historicoParcial: vendas?.historicoParcial ?? null,
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
          const metrics = metricsMap.get(key) || { qtde12m: null, valor12m: null, qtde60d: null, vendasMesAtual: null, custoUnit: null, estoqueFilial: null, diasDesdeUltimaVenda: null, primeiraEntradaFilial: null, diasHistoricoFilial: null, mesesHistoricoFilial: null, historicoParcial: null };
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
              primeiraEntradaFilial: metrics.primeiraEntradaFilial,
              diasHistoricoFilial: metrics.diasHistoricoFilial,
              mesesHistoricoFilial: metrics.mesesHistoricoFilial,
              historicoParcial: metrics.historicoParcial,
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
            primeiraEntradaFilial: metrics.primeiraEntradaFilial,
            diasHistoricoFilial: metrics.diasHistoricoFilial,
            mesesHistoricoFilial: metrics.mesesHistoricoFilial,
            historicoParcial: metrics.historicoParcial,
          });
        }
        return next;
      });

      const n = agregados.size;
      const limiteAviso = lista.length >= 2500;
      mostrarNotificacao(
        limiteAviso
          ? `Importados ${n} itens da coleção ${colecao}. Atenção: a busca limita em 2500 variantes; pode haver mais no cadastro.`
          : `Importados ${n} itens da coleção ${colecao}.`
      );
    } finally {
      setImportandoColecao(false);
    }
  }, [colecaoParaImportar, companyKey, filialConsultaSelecionada, mostrarNotificacao]);

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
              const matchBarra = await produtoFromBarcodeLookup(porBarra, companyKey);
              if (matchBarra) return { codigoOriginal, produto: matchBarra };
              return { codigoOriginal, produto: null as Produto | null };
            }
            if (isSomenteDigitosCodigoBarras(codigo)) {
              return { codigoOriginal, produto: null as Produto | null };
            }

            const candidatos = await searchProdutos(codigo, companyKey);
            if (candidatos.length === 0) return { codigoOriginal, produto: null as Produto | null };

            const exactProduto = candidatos.find((p) => p.produto.trim() === codigo);
            if (exactProduto) return { codigoOriginal, produto: exactProduto };

            const exactBarra = candidatos.find((p) => (p.codigoBarra || "").trim() === codigo);
            if (exactBarra) return { codigoOriginal, produto: exactBarra };

            return { codigoOriginal, produto: null as Produto | null };
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
            primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
            diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
            mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
            historicoParcial: vendas?.historicoParcial ?? null,
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
          const metrics = metricsMap.get(key) || { qtde12m: null, valor12m: null, qtde60d: null, vendasMesAtual: null, custoUnit: null, estoqueFilial: null, diasDesdeUltimaVenda: null, primeiraEntradaFilial: null, diasHistoricoFilial: null, mesesHistoricoFilial: null, historicoParcial: null };
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
              primeiraEntradaFilial: metrics.primeiraEntradaFilial,
              diasHistoricoFilial: metrics.diasHistoricoFilial,
              mesesHistoricoFilial: metrics.mesesHistoricoFilial,
              historicoParcial: metrics.historicoParcial,
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
            primeiraEntradaFilial: metrics.primeiraEntradaFilial,
            diasHistoricoFilial: metrics.diasHistoricoFilial,
            mesesHistoricoFilial: metrics.mesesHistoricoFilial,
            historicoParcial: metrics.historicoParcial,
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

      let vendas: Awaited<ReturnType<typeof fetchVendasItemMetricas>> = null;
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
        primeiraEntradaFilial: vendas?.primeiraEntradaFilial ?? null,
        diasHistoricoFilial: vendas?.diasHistoricoFilial ?? null,
        mesesHistoricoFilial: vendas?.mesesHistoricoFilial ?? null,
        historicoParcial: vendas?.historicoParcial ?? null,
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
    const diasCorridosMesLocal = new Date().getDate();
    const itensBase = itens.filter((item) => {
      if (!filtrarSugeridos && !filtrarBarrados && !filtrarTransferencias) return true;
      if (filtrarTransferencias) return itemTemTransferenciaSugerida(item, diasCorridosMesLocal, transferenciasPorItem);
      const sugerido = itemTemSugestaoCompra(item, diasCorridosMesLocal);
      const barrado = itemEhBarrado(item, diasCorridosMesLocal);
      if (filtrarSugeridos && filtrarBarrados) return sugerido || barrado;
      if (filtrarSugeridos) return sugerido;
      return barrado;
    });
    if (itensBase.length === 0) {
      mostrarNotificacao("Adicione pelo menos um produto para enviar", "error");
      return;
    }
    const username = user?.username?.trim() || "";
    const filialCtx = filialSelecionada?.codFilial?.trim() || "sem-filial";
    const sourceContextKey = `lista-loja:${companyKey}:${filialCtx}:${editingId ?? "novo"}`;
    const titleBase = nomeLista.trim() || buildDefaultListName(filialSelecionada?.filial || "Lista Loja");
    const title = `[Lista Loja] ${appendUserToListName(customTitle?.trim() || titleBase, username)}`;
    const payloadItems: CompraSalvaItemRow[] = itensBase.map((it) => ({
      itemKey: buildItemKey(it.produto, it.corProduto),
      produto: it.produto,
      corProduto: it.corProduto ?? undefined,
      corDescricao: it.descCor || undefined,
      descricao: it.descProduto || it.produto,
      qtdManual: Math.max(0, Math.round(it.quantidade ?? 0)),
      custoUnitario: it.custoUnit != null ? Number(it.custoUnit) : undefined,
      filialOrigem: filialConsultaSelecionada,
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
  }, [companyKey, editingId, filtrarBarrados, filtrarSugeridos, filtrarTransferencias, filialSelecionada, itens, mostrarNotificacao, nomeLista, transferenciasPorItem, user?.username]);

  const salvar = useCallback(async () => {
    if (!user?.username) return;
    const diasCorridosMesLocal = new Date().getDate();
    const itensBase = itens.filter((item) => {
      if (!filtrarSugeridos && !filtrarBarrados && !filtrarTransferencias) return true;
      if (filtrarTransferencias) return itemTemTransferenciaSugerida(item, diasCorridosMesLocal, transferenciasPorItem);
      const sugerido = itemTemSugestaoCompra(item, diasCorridosMesLocal);
      const barrado = itemEhBarrado(item, diasCorridosMesLocal);
      if (filtrarSugeridos && filtrarBarrados) return sugerido || barrado;
      if (filtrarSugeridos) return sugerido;
      return barrado;
    });
    if (itensBase.length === 0) { mostrarNotificacao("Adicione pelo menos um produto", "error"); return; }

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
          itens: itensBase,
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
  }, [companyKey, editingId, filtrarBarrados, filtrarSugeridos, filtrarTransferencias, filialSelecionada?.filial, itens, mostrarNotificacao, nomeLista, transferenciasPorItem, user?.username, enviarParaComprasSalvas]);

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

  const totalItensModal = itensModal.reduce((s, i) => s + i.quantidade, 0);
  const diasCorridosMes = new Date().getDate();
  const filtrosAtivos = filtrarSugeridos || filtrarBarrados || filtrarTransferencias;
  const itensVisiveis = useMemo(() => {
    return itens.filter((item) => {
      if (!filtrosAtivos) return true;
      if (filtrarTransferencias) return itemTemTransferenciaSugerida(item, diasCorridosMes, transferenciasPorItem);
      const sugerido = itemTemSugestaoCompra(item, diasCorridosMes);
      const barrado = itemEhBarrado(item, diasCorridosMes);
      if (filtrarSugeridos && filtrarBarrados) return sugerido || barrado;
      if (filtrarSugeridos) return sugerido;
      if (filtrarBarrados) return barrado;
      return true;
    });
  }, [diasCorridosMes, filtrarBarrados, filtrarSugeridos, filtrarTransferencias, filtrosAtivos, itens, transferenciasPorItem]);
  const indicesItensVisiveis = useMemo(
    () =>
      itens
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (!filtrosAtivos) return true;
          if (filtrarTransferencias) return itemTemTransferenciaSugerida(item, diasCorridosMes, transferenciasPorItem);
          const sugerido = itemTemSugestaoCompra(item, diasCorridosMes);
          const barrado = itemEhBarrado(item, diasCorridosMes);
          if (filtrarSugeridos && filtrarBarrados) return sugerido || barrado;
          if (filtrarSugeridos) return sugerido;
          if (filtrarBarrados) return barrado;
          return true;
        })
        .map(({ index }) => index),
    [diasCorridosMes, filtrarBarrados, filtrarSugeridos, filtrarTransferencias, filtrosAtivos, itens, transferenciasPorItem]
  );
  const kpisLista = useMemo(() => {
    const totalQtdSugerida = itensVisiveis.reduce((s, item) => {
      const sugestao = getReposicaoCompraView(item, diasCorridosMes);
      const qtd = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;
      return s + Math.max(0, qtd);
    }, 0);
    const totalCustoReferencia = itensVisiveis.reduce((s, item) => {
      const custoUnit = Number(item.custoUnit ?? 0);
      if (custoUnit <= 0) return s;
      const sugestao = getReposicaoCompraView(item, diasCorridosMes);
      const qtd = sugestao.qtdFinal > 0 ? sugestao.qtdFinal : sugestao.qtdS > 0 ? sugestao.qtdS : sugestao.qtdE;
      if (qtd <= 0) return s;
      return s + qtd * custoUnit;
    }, 0);
    return {
      totalItens: itensVisiveis.length,
      totalQtdSugerida,
      totalCustoReferencia,
    };
  }, [diasCorridosMes, itensVisiveis]);
  const abcMapRede = useMemo(() => new Map<string, CurvaInfo>(), []);
  const abcMapModal = useMemo(() => new Map<string, CurvaInfo>(), []);

  // ─── Render: loading ────────────────────────────────────────────────────────

  const filtroAplicadoLabel = filtrarTransferencias
    ? "Transferências"
    : filtrarSugeridos && filtrarBarrados
      ? "Sugeridos e barrados"
      : filtrarSugeridos
        ? "Sugeridos"
        : filtrarBarrados
          ? "Barrados"
          : "Todos";

  const exportarListaXlsx = useCallback(async () => {
    if (itensVisiveis.length === 0) {
      mostrarNotificacao("Adicione itens para exportar", "error");
      return;
    }

    setExportandoXlsx(true);
    try {
      const rows = await buildListaLojaExportRows(
        companyKey,
        filialSelecionada?.codFilial ?? null,
        itensVisiveis,
        diasCorridosMes,
        transferenciasPorItem
      );
      exportListaLojaToXlsx({
        companyKey,
        companyName,
        listaNome: nomeLista.trim() || buildDefaultListName(filialSelecionada?.filial || "Lista Loja"),
        filialNome: filialSelecionada?.filial ?? null,
        filtroAplicado: filtroAplicadoLabel,
        rows,
      });
      mostrarNotificacao("XLSX exportado com sucesso!");
    } catch (err: unknown) {
      mostrarNotificacao(err instanceof Error ? err.message : "Erro ao exportar XLSX", "error");
    } finally {
      setExportandoXlsx(false);
    }
  }, [
    companyKey,
    companyName,
    diasCorridosMes,
    filtroAplicadoLabel,
    filialSelecionada?.codFilial,
    filialSelecionada?.filial,
    itensVisiveis,
    transferenciasPorItem,
    mostrarNotificacao,
    nomeLista,
  ]);

  if (!permissoesCarregadas) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.centered}>Carregando...</div>
      </div>
    );
  }

  // ─── Render: editor ─────────────────────────────────────────────────────────

  if (mode === "editor") {
    const itensParaAcao = filtrosAtivos ? itensVisiveis : itens;
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
              className={styles.exportXlsxBtn}
              onClick={() => {
                void exportarListaXlsx();
              }}
              disabled={itensVisiveis.length === 0 || exportandoXlsx}
              title={itensVisiveis.length === 0 ? "Adicione itens para exportar" : "Exportar a lista atual para XLSX"}
            >
              {exportandoXlsx ? "Exportando XLSX..." : "Exportar XLSX"}
            </button>
            <button
              type="button"
              className={styles.backBtn}
              onClick={() => {
                void enviarParaComprasSalvas();
              }}
              disabled={itensParaAcao.length === 0}
              title={itensParaAcao.length === 0 ? "Adicione itens para enviar" : "Enviar para Compras Salvas"}
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
          {itensParaAcao.length > 0 && (
            <div className={styles.kpiCard}>
              <div className={styles.kpiItem}>
                <span className={styles.kpiLabel}>Itens</span>
                <strong className={styles.kpiValueNeutral}>
                  {kpisLista.totalItens}
                  {filtrosAtivos ? ` / ${itens.length}` : ""}
                </strong>
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
          <div className={styles.filtroRow}>
            <label className={styles.filtroToggle}>
              <input
                type="checkbox"
                checked={filtrarSugeridos}
                onChange={(e) => setFiltrarSugeridos(e.target.checked)}
              />
              <span>Sugeridos</span>
            </label>
            <label className={styles.filtroToggle}>
              <input
                type="checkbox"
                checked={filtrarBarrados}
                onChange={(e) => setFiltrarBarrados(e.target.checked)}
              />
              <span>Barrados</span>
            </label>
            <label className={styles.filtroToggle}>
              <input
                type="checkbox"
                checked={filtrarTransferencias}
                onChange={(e) => setFiltrarTransferencias(e.target.checked)}
                disabled={!filialConsultaSelecionada}
              />
              <span>Transferências</span>
            </label>
            {filtrosAtivos && (
              <button
                type="button"
                className={styles.filtroClearBtn}
                onClick={() => {
                  setFiltrarSugeridos(false);
                  setFiltrarBarrados(false);
                  setFiltrarTransferencias(false);
                }}
              >
                Limpar filtros
              </button>
            )}
          </div>
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
          ) : itensVisiveis.length === 0 ? (
            <div className={styles.emptyProducts}>
              <div className={styles.emptyProductsIcon}>
                <svg viewBox="0 0 24 24" fill="none">
                  <path d="M12 2 20 6.5v11L12 22l-8-4.5v-11L12 2Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                  <path d="M20 6.5 12 12 4 6.5" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
                </svg>
              </div>
              <div className={styles.emptyProductsTitle}>Nenhum item corresponde aos filtros</div>
              <div className={styles.emptyProductsSub}>Marque ou desmarque os filtros para voltar a visualizar os produtos.</div>
            </div>
          ) : (
            <div className={styles.produtosList}>
              <ListaLojaItensTable
                companyKey={companyKey}
                filialCod={filialConsultaSelecionada}
                filialNome={filialConsultaSelecionada ? (filialSelecionada?.filial ?? null) : null}
                itens={itensVisiveis}
                compraView={true}
                abcMap={abcMapRede}
                transferenciasPorItem={transferenciasPorItem}
                onMoveItem={(fromIndex, toIndex) => {
                  const origem = indicesItensVisiveis[fromIndex];
                  const destino = indicesItensVisiveis[toIndex];
                  if (origem == null || destino == null) return;
                  moverItem(origem, destino);
                }}
                onIncrement={(idx) =>
                  atualizarQuantidade(indicesItensVisiveis[idx] ?? idx, (itensVisiveis[idx]?.quantidade ?? 1) + 1)
                }
                onDecrement={(idx) =>
                  atualizarQuantidade(indicesItensVisiveis[idx] ?? idx, (itensVisiveis[idx]?.quantidade ?? 1) - 1)
                }
                onQtyChange={(idx, q) => atualizarQuantidade(indicesItensVisiveis[idx] ?? idx, q)}
                onRemove={(idx) => removerItem(indicesItensVisiveis[idx] ?? idx)}
                onOpenColorPicker={(idx, mode) => {
                  void abrirColorPickerItem(indicesItensVisiveis[idx] ?? idx, false, mode);
                }}
                activeColorPickerIndex={
                  editorColorPickerIndex != null && indicesItensVisiveis.indexOf(editorColorPickerIndex) >= 0
                    ? indicesItensVisiveis.indexOf(editorColorPickerIndex)
                    : null
                }
                activeColorPickerMode={editorColorPickerMode}
                colorPickerOptions={editorColorPickerOpcoes}
                colorPickerLoading={editorColorPickerLoading}
                onApplyColor={(idx, produtoComCor) => {
                  void trocarCorItem(indicesItensVisiveis[idx] ?? idx, produtoComCor, false);
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
            {itensParaAcao.length > 0 && (
              <span className={styles.badge}>
                {itensParaAcao.length} prod · {itensParaAcao.reduce((s, i) => s + i.quantidade, 0)} un.
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
            {itensParaAcao.length > 0 && (
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

                {companyKey === "scarfme" && (
                  <div className={styles.colecImportBox}>
                    <div className={styles.colecImportLabel}>Importar por coleção</div>
                    <div className={styles.colecImportRow}>
                      <select
                        className={styles.colecSelect}
                        value={colecaoParaImportar}
                        onChange={(e) => setColecaoParaImportar(e.target.value)}
                        disabled={loadingColecoesOpcoes || importandoColecao || importandoBatch}
                      >
                        <option value="">
                          {loadingColecoesOpcoes ? "Carregando coleções..." : "Selecione a coleção"}
                        </option>
                        {colecoesDisponiveis.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className={styles.batchBtn}
                        onClick={() => void importarColecaoProdutos()}
                        disabled={
                          importandoColecao ||
                          importandoBatch ||
                          !colecaoParaImportar ||
                          loadingColecoesOpcoes
                        }
                      >
                        {importandoColecao ? "Importando..." : "Importar coleção"}
                      </button>
                    </div>
                  </div>
                )}

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
                    disabled={importandoBatch || importandoColecao}
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
            <button
              type="button"
              className={styles.exportXlsxBtn}
              onClick={() => {
                void exportarListaXlsx();
              }}
              disabled={itensVisiveis.length === 0 || exportandoXlsx}
              title={itensVisiveis.length === 0 ? "Abra uma lista para exportar" : "Exportar a lista atual para XLSX"}
            >
              {exportandoXlsx ? "Exportando XLSX..." : "Exportar XLSX"}
            </button>
            <button type="button" className={styles.backBtn} onClick={() => setMode("list")}>
              Ver Listas
            </button>
            <button type="button" className={styles.saveBtn} onClick={abrirNovaLista}>
              + Nova Lista
            </button>
          </div>
        </div>
        <ComprasSalvasListPanel companyKey={companyKey} companySlug={companySlug} source="lista-loja" />
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
                    <span className={styles.listaNome}>{lista.nome}</span>
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

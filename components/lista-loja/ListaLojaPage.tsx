"use client";

import Link from "next/link";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth/AuthContext";
import { calculateTransfers } from "@/components/controle-transferencias/ControleTransferenciasTable";
import ComprasSalvasListPanel from "@/components/stock/ComprasSalvasListPanel";
import {
  buildControleEstoqueItemKey,
  type ControleEstoqueItemMetricas,
} from "@/lib/utils/controle-estoque-metricas";
import {
  aggregateEstoquePorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  getFilialLabelForDisplay,
  normalizeFilialLookupKey,
  resolveCompany,
  type CompanyConfig,
  type CompanyKey,
} from "@/lib/config/company";
import {
  fetchControleEstoqueItemMetricasClient,
  fetchControleEstoqueMetricasItensClient,
} from "@/lib/client/controle-estoque-metricas";
import {
  buildCompraTransitoIndex,
  fetchComprasTransitoClient,
  getCompraTransitoEntries,
  type CompraTransitoIndex,
  type CompraTransitoIndexEntry,
} from "@/lib/client/compras-transito";
import { exportListaLojaToXlsx, exportCompraIdealPorFilialToXlsx } from "@/lib/utils/exportListaLoja";
import { applyTransitToSuggestion } from "@/lib/utils/compra-transito-analytics";
import {
  calcCompraIdeal,
  calcCompraIdealFromResumo,
  precisaComprarEssaSemana,
  COMPRA_IDEAL_STATUS_LABEL,
  COMPRA_IDEAL_CONFIABILIDADE_LABEL,
  type CompraIdealStatus,
  type CompraIdealResult,
} from "@/lib/utils/compra-ideal";
import { resolveCicloCompra, hasCicloCompra, resolveGapAntigoDias, resolveRecenteHorizonteDias } from "@/lib/config/compra-ciclo";
import { useCatracaDataCompra, type CatracaFreeze } from "@/lib/client/use-catraca-data-compra";
import CompraIdealExplainCard from "@/components/shared/CompraIdealExplainCard";
import {
  partesDestinoCompraFinal,
  type DestinoCompraFinalParte,
} from "@/lib/utils/compra-final-destino";
import {
  calcNecessidadeMinimaQty,
  calcNecessidadeMinimaPorFilial,
  calcCoberturaPorFilial,
  combineBaseSuggestionWithNecessidadeMinima,
  formatNecessidadeMinimaFiliaisDescription,
} from "@/lib/utils/necessidade-minima";
import {
  calcQtdSugestaoEInfo as getSharedQtdSugestaoEInfo,
  calcQtdSugestaoPOInfo as getSharedQtdSugestaoPOInfo,
  calcQtdSugestaoS as getSharedQtdSugestaoS,
  getReposicaoBaseType as getSharedReposicaoBaseType,
  getReposicaoCompraView as getSharedReposicaoCompraView,
  type SuggestionPOData,
  type SuggestionEData,
  type SuggestionSData,
} from "@/lib/utils/suggestion-rules";
import { getMappedColorDescription } from "@/lib/utils/colorMapping";
import type { CompraSalvaItemRow } from "@/lib/types/compra-salva";
import type { ProdutoTransferencia } from "@/lib/repositories/controleTransferencias";

import styles from "./ListaLojaPage.module.css";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Filial {
  codFilial: string;
  filial: string;
  /** Rótulo de exibição (ex.: "MORUMBI 1" para o grupo, em vez do nome cru da ativa). */
  displayName?: string;
  /** Nomes equivalentes (ativa + membros do grupo), usados para casar permissões
   *  que referenciam um membro não-ativo do grupo (ex.: MORUMBI 1). */
  aliases?: string[];
}

/** Rótulo amigável da filial: usa displayName (grupo) quando houver, senão o nome cru. */
function filialLabel(f?: Filial | null): string {
  if (!f) return "";
  return (f.displayName || "").trim() || f.filial;
}

const TODAS_FILIAIS_VALUE = "__TODAS__";
const TODAS_FILIAIS_LABEL = "TODAS (visão geral)";

interface Produto {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  grade?: string | null;
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
  /** Janela de ritmo (maior período contínuo com estoque), snapshot ao adicionar */
  ritmoDiasComEstoque?: number | null;
  ritmoVendasPeriodo?: number | null;
  /** Trecho recente + última venda dele + gap — snapshot p/ o resgate de janela zerada no filtro. */
  ritmoRecenteDias?: number | null;
  ritmoRecenteVendas?: number | null;
  ritmoRecenteUltimaVendaIso?: string | null;
  ritmoGapDias?: number | null;
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
  diasComEstoquePositivo?: number | null;
  diasSemEstoque?: number | null;
  mesesDisponiveis?: number | null;
  velocidadeAjustada?: number | null;
  /** Indica que a filial ainda nao completou 12 meses de historico para o item */
  historicoParcial?: boolean | null;
  linha?: string | null;
  subgrupo?: string | null;
}

type FilialNecessidadeMinima = {
  filial: string;
  qtd: number;
  qtde12m: number;
};

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

const MESES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

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
  const maxTop = Math.max(margin, window.innerHeight - tooltipHeight - margin);
  const left = Math.min(Math.max(margin, x + offset), maxLeft);
  const topAbove = y - tooltipHeight - offset;
  const topBelow = y + offset;
  const top = topAbove >= margin
    ? topAbove
    : Math.min(Math.max(margin, topBelow), maxTop);
  return { left, top };
}

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

type EstoqueTooltipRow = {
  key: string;
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

async function fetchProdutosPorGrade(grade: string, companyKey?: string): Promise<Produto[]> {
  const g = grade.trim();
  if (!g) return [];
  const params = new URLSearchParams({ porGrade: "true", grade: g });
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
  return (json.data || []).map((lista) => ({
    ...lista,
    itens: Array.isArray(lista.itens) ? lista.itens.map(normalizeListaItemColor) : [],
  }));
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
    body: JSON.stringify({
      ...data,
      itens: data.itens.map(normalizeListaItemColor),
    }),
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

/** Data curta "10/jun" a partir de ISO yyyy-mm-dd (usado nas colunas Acaba em / Chega em). */
function formatShortDate(value?: string | null): string {
  if (!value) return "—";
  const v = value.trim().slice(0, 10);
  const d = new Date(`${v}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value;
  return `${String(d.getDate()).padStart(2, "0")}/${MESES_PT[d.getMonth()].toLowerCase()}`;
}

/** "atual" / "há X dias" / "há ~N meses" a partir de dias decorridos. */
function formatHaTempo(dias: number | null): string {
  if (dias == null) return "";
  if (dias <= 1) return "atual";
  if (dias < 45) return `há ${dias} dias`;
  const meses = Math.round(dias / 30);
  return `há ~${meses} ${meses === 1 ? "mês" : "meses"}`;
}

/** Cores/ícone do badge de Status da Compra Ideal. */
function compraIdealStatusVisual(status: CompraIdealStatus): { icon: string; bg: string; fg: string; border: string } {
  if (status === "REPOR") return { icon: "🟡", bg: "#fef9c3", fg: "#854d0e", border: "#fde047" };
  if (status === "EXCESSO") return { icon: "🔴", bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" };
  return { icon: "🟢", bg: "#dcfce7", fg: "#166534", border: "#86efac" };
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
  corProduto: string | null,
  itemMeta?: { linha?: string | null; subgrupo?: string | null }
): Promise<{ qtde12m: number; qtde60d: number; vendasMesAtual: number; valor12m: number | null; custoUnit: number | null; diasDesdeUltimaVenda: number | null; primeiraEntradaFilial: string | null; diasHistoricoFilial: number; mesesHistoricoFilial: number; diasComEstoquePositivo: number; diasSemEstoque: number; mesesDisponiveis: number; velocidadeAjustada: number; ritmoDiasComEstoque: number; ritmoVendasPeriodo: number; ritmoInicioIso: string | null; ritmoFimIso: string | null; ritmoDiasComVenda: number; ritmoPrimeiraVendaIso: string | null; ritmoUltimaVendaIso: string | null; ritmoRecenteDias: number; ritmoRecenteVendas: number; ritmoRecenteInicioIso: string | null; ritmoRecenteFimIso: string | null; ritmoRecenteUltimaVendaIso: string | null; ritmoGapDias: number; historicoParcial: boolean; filiaisNM: FilialNecessidadeMinima[]; filiaisCobertura: FilialNecessidadeMinima[]; vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number; velocidadeAjustada?: number | null; mesesDisponiveis?: number | null; diasComEstoquePositivo?: number | null }>; estoquePorFilial: Array<{ filial: string; estoque: number }> } | null> {
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
    diasComEstoquePositivo?: number | null;
    diasSemEstoque?: number | null;
    mesesDisponiveis?: number | null;
    velocidadeAjustada?: number | null;
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
    const companyConfig = resolveCompany(companyKey);
    const estoqueMap = new Map<string, number>(
      aggregateEstoquePorFilialByDisplayLabel(metricas.estoquePorFilial, companyConfig).map((e) => [
        normalizeFilialLookupKey(e.filial),
        e.estoque,
      ])
    );
    const filiaisNM = calcNecessidadeMinimaPorFilial({
      company: companyConfig,
      vendasPorFilial: metricas.vendasPorFilial,
      estoquePorFilial: metricas.estoquePorFilial,
    });
    const limiteDiasItem = getLimiteDiasReposicao({ linha: itemMeta?.linha, subgrupo: itemMeta?.subgrupo });
    const filiaisCobertura = calcCoberturaPorFilial({
      company: companyConfig,
      vendasPorFilial: metricas.vendasPorFilial,
      estoquePorFilial: metricas.estoquePorFilial,
      limiteDias: limiteDiasItem,
    });
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
      diasComEstoquePositivo: metricas.resumo.diasComEstoquePositivo,
      diasSemEstoque: metricas.resumo.diasSemEstoque,
      mesesDisponiveis: metricas.resumo.mesesDisponiveis,
      velocidadeAjustada: metricas.resumo.velocidadeAjustada,
      ritmoDiasComEstoque: metricas.resumo.ritmoDiasComEstoque,
      ritmoVendasPeriodo: metricas.resumo.ritmoVendasPeriodo,
      ritmoInicioIso: metricas.resumo.ritmoInicioIso,
      ritmoFimIso: metricas.resumo.ritmoFimIso,
      ritmoDiasComVenda: metricas.resumo.ritmoDiasComVenda,
      ritmoPrimeiraVendaIso: metricas.resumo.ritmoPrimeiraVendaIso,
      ritmoUltimaVendaIso: metricas.resumo.ritmoUltimaVendaIso,
      ritmoRecenteDias: metricas.resumo.ritmoRecenteDias,
      ritmoRecenteVendas: metricas.resumo.ritmoRecenteVendas,
      ritmoRecenteInicioIso: metricas.resumo.ritmoRecenteInicioIso,
      ritmoRecenteFimIso: metricas.resumo.ritmoRecenteFimIso,
      ritmoRecenteUltimaVendaIso: metricas.resumo.ritmoRecenteUltimaVendaIso,
      ritmoGapDias: metricas.resumo.ritmoGapDias,
      historicoParcial: metricas.resumo.historicoParcial,
      filiaisNM,
      filiaisCobertura,
      vendasPorFilial: metricas.vendasPorFilial,
      estoquePorFilial: metricas.estoquePorFilial,
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
      diasComEstoquePositivo: Math.max(0, ...rows.map((r) => Number(r.diasComEstoquePositivo ?? 0))),
      diasSemEstoque: Math.min(365, ...rows.map((r) => Number(r.diasSemEstoque ?? 365))),
      mesesDisponiveis: Math.max(1, ...rows.map((r) => Number(r.mesesDisponiveis ?? 1))),
      velocidadeAjustada: Math.max(0, ...rows.map((r) => Number(r.velocidadeAjustada ?? 0))),
      ritmoDiasComEstoque: 0,
      ritmoVendasPeriodo: 0,
      ritmoInicioIso: null,
      ritmoFimIso: null,
      ritmoDiasComVenda: 0,
      ritmoPrimeiraVendaIso: null,
      ritmoUltimaVendaIso: null,
      ritmoRecenteDias: 0,
      ritmoRecenteVendas: 0,
      ritmoRecenteInicioIso: null,
      ritmoRecenteFimIso: null,
      ritmoRecenteUltimaVendaIso: null,
      ritmoGapDias: 0,
      filiaisNM: [],
      filiaisCobertura: [],
      vendasPorFilial: [],
      estoquePorFilial: [],
    };
  } catch {
    return null;
  }
}

/**
 * Monta um ListaItem completo (com snapshot de vendas/estoque e qtd sugerida) a partir
 * de um item base. Mesma lógica de `adicionarProdutoModal`, isolada para reuso pela
 * entrada vinda da Curva ABC ("criar lista com este produto").
 */
async function buildListaItemComMetricas(
  companyKey: string,
  codFilial: string | null,
  base: {
    produto: string;
    descProduto: string;
    codigoBarra: string | null;
    corProduto: string | null;
    descCor: string;
    linha?: string | null;
    subgrupo?: string | null;
  },
  comprasTransitoIndex: CompraTransitoIndex
): Promise<ListaItem> {
  const [vendas, estoque] = await Promise.all([
    fetchVendasItemMetricas(companyKey, codFilial, base.produto, base.corProduto),
    fetchEstoqueFilialSum(companyKey, codFilial, base.produto, base.corProduto),
  ]);
  const metricFields = {
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
    diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
    diasSemEstoque: vendas?.diasSemEstoque ?? null,
    mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
    velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
    ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
    ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
    historicoParcial: vendas?.historicoParcial ?? null,
  };
  // Com filial específica, segue a Compra Ideal (mesma fórmula da coluna). Na visão geral
  // (TODAS), cai na sugestão de reposição agregada — igual aos demais caminhos de adição.
  const quantidade = calcQtdSugeridaParaFilial(
    codFilial,
    base,
    vendas,
    estoque,
    companyKey,
    comprasTransitoIndex,
    new Date().getDate()
  );
  return { ...base, quantidade, ...metricFields };
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
  return buildControleEstoqueItemKey(produto, corProduto);
}

function resolveStrictColorDescription(
  corProduto?: string | null,
  descCor?: string | null
) {
  const codigoCor = (corProduto ?? "").trim();
  if (codigoCor) {
    return getMappedColorDescription(codigoCor);
  }

  return (descCor ?? "").trim();
}

function formatColorDisplay(descCor?: string | null, corProduto?: string | null) {
  const descricao = resolveStrictColorDescription(corProduto, descCor);
  const codigoCor = (corProduto ?? "").trim();

  if (descricao && codigoCor) {
    return `${descricao} (${codigoCor})`;
  }
  if (descricao) {
    return descricao;
  }
  if (codigoCor) {
    return codigoCor;
  }
  return "—";
}

function formatColorInlineDetail(descCor?: string | null, corProduto?: string | null) {
  const colorLabel = formatColorDisplay(descCor, corProduto);
  return colorLabel === "—" ? "" : ` · ${colorLabel}`;
}

function normalizeListaItemColor(item: ListaItem): ListaItem {
  return {
    ...item,
    descCor: resolveStrictColorDescription(item.corProduto, item.descCor),
  };
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

function aggregateEstoqueRowsByDisplayLabel(
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

function aggregateVendasRowsByDisplayLabel(
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

function buildEstoqueTooltipRows(
  rows: FilialEstoqueRow[],
  company: CompanyConfig | null
): EstoqueTooltipRow[] {
  const positivos = new Map<string, number>();
  const negativos: Array<{ key: string; filial: string; estoque: number; sortLabel: string }> = [];

  for (const row of rows) {
    const estoque = Math.round(Number(row.estoque ?? 0));
    if (estoque === 0) continue;

    const rawFilial = (row.filial ?? "").trim();
    const displayLabel = getFilialLabelForDisplay(company, rawFilial);

    if (estoque < 0) {
      const detalharRaw = rawFilial && normalizeKey(rawFilial) !== normalizeKey(displayLabel);
      negativos.push({
        key: `neg:${rawFilial || displayLabel}:${negativos.length}`,
        filial: detalharRaw ? `${displayLabel} (${rawFilial})` : displayLabel,
        estoque,
        sortLabel: displayLabel,
      });
      continue;
    }

    positivos.set(displayLabel, (positivos.get(displayLabel) ?? 0) + estoque);
  }

  return [
    ...Array.from(positivos.entries()).map(([filial, estoque]) => ({
      key: `pos:${filial}`,
      filial,
      estoque: Math.round(estoque),
      sortLabel: filial,
    })),
    ...negativos,
  ]
    .sort((a, b) => {
      const byDisplay = compareFilialDisplayOrder(a.sortLabel, b.sortLabel, company);
      if (byDisplay !== 0) return byDisplay;
      return a.filial.localeCompare(b.filial, "pt-BR");
    })
    .map(({ key, filial, estoque }) => ({ key, filial, estoque }));
}

function buildExportListText(values: string[]): string {
  return values.filter((value) => value.trim().length > 0).join(" | ");
}

function buildEstoqueTooltipText(rows: FilialEstoqueRow[], company: CompanyConfig | null): string {
  return buildExportListText(
    buildEstoqueTooltipRows(rows, company)
      .map((row) => `${row.filial}: ${fmt(Number(row.estoque ?? 0))}`)
  );
}

/** Redistribui `total` unidades proporcionalmente ao qtde12m de cada filial (maior resto primeiro). */
function buildVendasTooltipText(
  rows: FilialVendaRow[],
  mode: "12m" | "60d" | "mesAtual" | "valor12m",
  company: CompanyConfig | null
): string {
  return buildExportListText(
    aggregateVendasRowsByDisplayLabel(rows, company)
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

function filterVendasTooltipRows(
  rows: FilialVendaRow[],
  mode: "12m" | "60d" | "valor12m"
): FilialVendaRow[] {
  return rows.filter((row) => {
    if (mode === "valor12m") return Number(row.valor12m ?? 0) > 0;
    if (mode === "12m") return Number(row.qtde12m ?? 0) > 0;
    return Number(row.qtde60d ?? 0) > 0;
  });
}

function buildFiliaisComEstoqueText(rows: FilialEstoqueRow[], company: CompanyConfig | null): string {
  return buildExportListText(
    aggregateEstoqueRowsByDisplayLabel(rows, company)
      .filter((row) => Number(row.estoque ?? 0) > 0)
      .map((row) => row.filial)
  );
}

function buildFiliaisQueVenderamText(rows: FilialVendaRow[], company: CompanyConfig | null): string {
  return buildExportListText(
    aggregateVendasRowsByDisplayLabel(rows, company)
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
  comprasTransitoIndex: CompraTransitoIndex,
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

    for (const row of aggregateEstoqueRowsByDisplayLabel(estoqueRowsRaw, company)) {
      byFilial.set(row.filial, {
        estoque: Number(row.estoque ?? 0),
        qtde12m: 0,
        qtde60d: 0,
        qtdeMesAtual: 0,
        valor12m: 0,
      });
    }

    for (const row of aggregateVendasRowsByDisplayLabel(vendasRowsRaw, company)) {
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
      filiaisComEstoque: buildFiliaisComEstoqueText(estoqueRowsRaw, company),
      filiaisQueVenderam: buildFiliaisQueVenderamText(vendasRowsRaw, company),
      detalheEstoqueTooltip: buildEstoqueTooltipText(estoqueRowsRaw, company),
      detalheVendas12mTooltip: buildVendasTooltipText(vendasRowsRaw, "12m", company),
      detalheVendas60dTooltip: buildVendasTooltipText(vendasRowsRaw, "60d", company),
      detalheVendasMesAtualTooltip: buildVendasTooltipText(vendasRowsRaw, "mesAtual", company),
      detalheValor12mTooltip: buildVendasTooltipText(vendasRowsRaw, "valor12m", company),
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
    const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, item.produto, item.corProduto);
    const baseRow = buildListaLojaExportRow(item, transitEntries, { curvaAbc, transferenciaExport }, companyKey);
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

/**
 * Monta as linhas do export "Compra Ideal por Loja": uma linha por item, uma coluna por
 * loja com a Compra Ideal daquela loja. O número de cada coluna é IDÊNTICO ao que aparece
 * ao filtrar a lista por aquela loja — mesma fonte (resumo de métricas com escopo na filial)
 * e mesma regra (calcCompraIdeal, trânsito da rede abatido, negativos zerados).
 *
 * Eficiência: o client fetcher agrupa todos os itens de uma mesma loja numa única
 * requisição HTTP, então o custo é ~1 requisição por loja (não item × loja).
 */
async function buildCompraIdealPorFilialRows(
  companyKey: string,
  filiais: Filial[],
  itens: ListaItem[],
  comprasTransitoIndex: CompraTransitoIndex,
  onFilialDone?: () => void
): Promise<{ rows: Array<Record<string, string | number | boolean | null>>; colunasFiliais: string[] }> {
  const company = resolveCompany(companyKey);
  const filiaisOrdenadas = [...filiais].sort((a, b) =>
    compareFilialDisplayOrder(filialLabel(a), filialLabel(b), company)
  );
  const colunasFiliais = filiaisOrdenadas.map((f) => filialLabel(f));

  const itensInput = itens.map((i) => ({ produto: i.produto, corProduto: i.corProduto }));

  // Uma "rodada" por loja (cada uma vira 1 requisição batcheada). Concorrência limitada
  // para não saturar o backend com várias consultas pesadas de histórico ao mesmo tempo.
  const metricasPorFilial = await mapWithConcurrency(filiaisOrdenadas, 4, async (f) => {
    try {
      return await fetchControleEstoqueMetricasItensClient({
        company: companyKey,
        filial: f.codFilial,
        includeHistorico: true,
        itens: itensInput,
      });
    } catch {
      return {} as Record<string, ControleEstoqueItemMetricas>;
    } finally {
      onFilialDone?.();
    }
  });

  const rows = itens.map((item) => {
    const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, item.produto, item.corProduto);
    const itemKey = buildControleEstoqueItemKey(item.produto, item.corProduto);

    let custoMax = 0;
    let totalRede = 0;
    const row: Record<string, string | number | boolean | null> = {
      PRODUTO: item.produto,
      DESC_PRODUTO: item.descProduto,
      CODIGO_BARRA: item.codigoBarra || "",
      COR_PRODUTO: item.corProduto || "",
      DESC_COR: item.descCor || "",
      LINHA: item.linha || "",
      SUBGRUPO: item.subgrupo || "",
      CUSTO_UNIT: null,
    };

    filiaisOrdenadas.forEach((_, idx) => {
      const metricas = metricasPorFilial[idx]?.[itemKey] ?? null;
      const ideal = calcCompraIdealFromResumo(metricas?.resumo ?? null, transitEntries, {
        linha: item.linha,
        subgrupo: item.subgrupo,
        company: companyKey,
      });
      const qtd = Math.max(0, ideal.compraIdeal);
      row[colunasFiliais[idx]] = qtd;
      totalRede += qtd;
      custoMax = Math.max(custoMax, Number(metricas?.resumo?.custoUnitario ?? 0));
    });

    row.CUSTO_UNIT = custoMax > 0 ? custoMax : null;
    row["TOTAL REDE"] = totalRede;
    return row;
  });

  return { rows, colunasFiliais };
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
  return getSharedQtdSugestaoS({
    qtde12m: item.qtde12m,
    estoqueAtual: item.estoqueFilial,
    linha: item.linha,
    subgrupo: item.subgrupo,
    mesesHistoricoFilial: item.mesesHistoricoFilial,
    diasComEstoquePositivo: item.diasComEstoquePositivo,
    diasSemEstoque: item.diasSemEstoque,
    mesesDisponiveis: item.mesesDisponiveis,
    velocidadeAjustada: item.velocidadeAjustada,
  });
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
  {
    const eInfo = getSharedQtdSugestaoEInfo({
      qtde12m: item.qtde12m,
      estoqueAtual: item.estoqueFilial,
      linha: item.linha,
      subgrupo: item.subgrupo,
      diasDesdeUltimaVenda: item.diasDesdeUltimaVenda,
      mesesHistoricoFilial: item.mesesHistoricoFilial,
      diasComEstoquePositivo: item.diasComEstoquePositivo,
      diasSemEstoque: item.diasSemEstoque,
      mesesDisponiveis: item.mesesDisponiveis,
      velocidadeAjustada: item.velocidadeAjustada,
    });
    if (!eInfo) return null;
    return {
      qtd: eInfo.qtd,
      velocidadeAjustada: eInfo.velocidadeAjustada,
      mesesSemVenda: eInfo.mesesSemVenda,
      mesesAtivos: eInfo.mesesAtivos,
    };
  }
  const qtde12m = Number(item.qtde12m ?? 0);
  if (qtde12m <= 0) return null;
  const dias = item.diasDesdeUltimaVenda ?? 0;
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

function getNecessidadeMinimaQty(item: { estoqueFilial?: number | null; qtde12m?: number | null }): number {
  return calcNecessidadeMinimaQty({
    estoqueAtual: item.estoqueFilial,
    qtde12m: item.qtde12m,
  });
}

function getReposicaoCompraView(item: ListaItem, diasCorridosMes: number): {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO: number;
  qtdNM: number;
  qtdSuficiente: boolean;
  semSugestao: boolean;
  sData?: SuggestionSData;
  eData?: SuggestionEData;
  poData?: SuggestionPOData;
} {
  return getSharedReposicaoCompraView(
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
}

/**
 * Quantidade sugerida ao adicionar um item: usa SEMPRE calcCompraIdeal — a MESMA fórmula da
 * coluna "Compra Ideal" (ritmo × cobertura − estoque − trânsito). Assim o número entre o − e o +
 * é idêntico ao exibido na coluna, tanto numa filial específica quanto na visão geral (TODAS,
 * onde estoque/ritmo já chegam agregados pela rede). O `_diasCorridosMes` fica só por
 * compatibilidade de assinatura (não é usado no cálculo por cobertura).
 */
function calcQtdSugeridaParaFilial(
  _filialCod: string | null,
  item: { produto: string; corProduto: string | null; linha?: string | null; subgrupo?: string | null },
  vendas: {
    ritmoDiasComEstoque?: number | null;
    ritmoVendasPeriodo?: number | null;
    ritmoInicioIso?: string | null;
    ritmoFimIso?: string | null;
    ritmoDiasComVenda?: number | null;
    ritmoPrimeiraVendaIso?: string | null;
    ritmoUltimaVendaIso?: string | null;
    ritmoRecenteDias?: number | null;
    ritmoRecenteVendas?: number | null;
    ritmoRecenteInicioIso?: string | null;
    ritmoRecenteFimIso?: string | null;
    ritmoRecenteUltimaVendaIso?: string | null;
    ritmoGapDias?: number | null;
    qtde60d?: number | null;
    qtde12m?: number | null;
    vendasMesAtual?: number | null;
    diasDesdeUltimaVenda?: number | null;
    mesesHistoricoFilial?: number | null;
    diasComEstoquePositivo?: number | null;
    diasSemEstoque?: number | null;
    mesesDisponiveis?: number | null;
    velocidadeAjustada?: number | null;
  } | null | undefined,
  estoqueFilial: number | null,
  companyKey: string,
  comprasTransitoIndex: CompraTransitoIndex,
  _diasCorridosMes: number
): number {
  const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, item.produto, item.corProduto);
  const cicloSug = hasCicloCompra(companyKey)
    ? resolveCicloCompra(companyKey, { linha: item.linha, subgrupo: item.subgrupo })
    : null;
  const ideal = calcCompraIdeal({
    estoqueAtual: estoqueFilial ?? 0,
    ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
    ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
    ritmoInicioIso: vendas?.ritmoInicioIso ?? null,
    ritmoFimIso: vendas?.ritmoFimIso ?? null,
    ritmoDiasComVenda: vendas?.ritmoDiasComVenda ?? null,
    ritmoPrimeiraVendaIso: vendas?.ritmoPrimeiraVendaIso ?? null,
    ritmoUltimaVendaIso: vendas?.ritmoUltimaVendaIso ?? null,
    ritmoRecenteDias: vendas?.ritmoRecenteDias ?? null,
    ritmoRecenteVendas: vendas?.ritmoRecenteVendas ?? null,
    ritmoRecenteInicioIso: vendas?.ritmoRecenteInicioIso ?? null,
    ritmoRecenteFimIso: vendas?.ritmoRecenteFimIso ?? null,
    ritmoRecenteUltimaVendaIso: vendas?.ritmoRecenteUltimaVendaIso ?? null,
    ritmoGapDias: vendas?.ritmoGapDias ?? null,
    gapAntigoDias: resolveGapAntigoDias(companyKey),
    recenteHorizonteDias: resolveRecenteHorizonteDias(companyKey),
    qtde60d: vendas?.qtde60d ?? null,
    linha: item.linha,
    subgrupo: item.subgrupo,
    coberturaDias: cicloSug?.coberturaDias ?? null,
    producaoDias: cicloSug?.producaoDias ?? null,
    transitEntries,
  });
  return Math.max(0, ideal.compraIdeal);
}

function itemTemSugestaoCompra(item: ListaItem, diasCorridosMes: number): boolean {
  const sugestao = getReposicaoCompraView(item, diasCorridosMes);
  return sugestao.qtdFinal > 0 || sugestao.qtdS > 0 || sugestao.qtdE > 0 || sugestao.qtdPO > 0 || sugestao.qtdNM > 0;
}

/**
 * Item precisa COMPRAR AGORA: mede a MESMA Compra Ideal da coluna (calcCompraIdeal a partir do
 * snapshot de ritmo do item) e exige compra ideal > 0 E a data de compra já chegada
 * (`comprarAgora`). Inclui os campos do trecho recente para o resgate de janela zerada valer aqui
 * igual na coluna (ex.: SMART WATCH lento que voltou a vender).
 */
function itemTemCompraAgora(
  item: ListaItem,
  companyKey: string,
  comprasTransitoIndex: CompraTransitoIndex
): boolean {
  const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, item.produto, item.corProduto);
  const ciclo = hasCicloCompra(companyKey)
    ? resolveCicloCompra(companyKey, { linha: item.linha, subgrupo: item.subgrupo })
    : null;
  const ideal = calcCompraIdeal({
    estoqueAtual: item.estoqueFilial ?? 0,
    ritmoDiasComEstoque: item.ritmoDiasComEstoque ?? null,
    ritmoVendasPeriodo: item.ritmoVendasPeriodo ?? null,
    ritmoRecenteDias: item.ritmoRecenteDias ?? null,
    ritmoRecenteVendas: item.ritmoRecenteVendas ?? null,
    ritmoRecenteUltimaVendaIso: item.ritmoRecenteUltimaVendaIso ?? null,
    ritmoGapDias: item.ritmoGapDias ?? null,
    gapAntigoDias: resolveGapAntigoDias(companyKey),
    recenteHorizonteDias: resolveRecenteHorizonteDias(companyKey),
    qtde60d: item.qtde60d ?? null,
    linha: item.linha,
    subgrupo: item.subgrupo,
    coberturaDias: ciclo?.coberturaDias ?? null,
    producaoDias: ciclo?.producaoDias ?? null,
    transitEntries,
  });
  // Inclui o "comprar essa semana" (NERD às segundas) — entra junto no filtro "comprar agora".
  return ideal.compraIdeal > 0 && (ideal.comprarAgora || precisaComprarEssaSemana(ideal, companyKey));
}

function itemEhBarrado(item: ListaItem, diasCorridosMes: number): boolean {
  const sugestao = getReposicaoCompraView(item, diasCorridosMes);
  return (
    sugestao.qtdFinal === 0 &&
    sugestao.qtdS === 0 &&
    sugestao.qtdE === 0 &&
    sugestao.qtdPO === 0 &&
    sugestao.qtdNM === 0 &&
    (sugestao.qtdSuficiente || sugestao.semSugestao)
  );
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

function formatFixed(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}


function buildListaLojaExportRow(
  item: ListaItem,
  transitEntries: CompraTransitoIndexEntry[],
  exportData?: {
    curvaAbc: Curva | null;
    transferenciaExport: {
      total: number;
      resumoRotas: string;
      resumoDestinosUrgencia: string;
    } | null;
  },
  company?: string | null
): Record<string, string | number | boolean | null> {
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const diasHistoricoFilial = Math.min(365, Math.max(0, Number(item.diasHistoricoFilial ?? 365)));
  const mesesHistoricoFilial = getMesesHistoricoFilial(item);
  const historicoParcial = Boolean(item.historicoParcial ?? false);
  const cicloExport = company && hasCicloCompra(company)
    ? resolveCicloCompra(company, { linha: item.linha, subgrupo: item.subgrupo })
    : null;

  // Mesma Compra Ideal exibida na tabela (ritmo + cobertura-alvo, com trânsito abatido).
  const ideal = calcCompraIdeal({
    estoqueAtual,
    ritmoDiasComEstoque: item.ritmoDiasComEstoque ?? null,
    ritmoVendasPeriodo: item.ritmoVendasPeriodo ?? null,
    qtde60d: item.qtde60d ?? null,
    linha: item.linha,
    subgrupo: item.subgrupo,
    coberturaDias: cicloExport?.coberturaDias ?? null,
    producaoDias: cicloExport?.producaoDias ?? null,
    transitEntries,
  });

  const compraIdeal = Math.max(0, ideal.compraIdeal);
  const excedente = Math.max(0, -ideal.compraIdeal);
  const quantidade = Math.max(0, Math.round(item.quantidade ?? 0));
  const custoUnit = Number(item.custoUnit ?? 0);
  const posicao = ideal.estoqueAtual + ideal.emTransito;
  const statusLabel = COMPRA_IDEAL_STATUS_LABEL[ideal.status];

  const resumo =
    ideal.status === "REPOR"
      ? `Repor ${fmt(compraIdeal)} un.: posição de ${fmt(posicao)} un. (estoque ${fmt(ideal.estoqueAtual)}${ideal.emTransito > 0 ? ` + ${fmt(ideal.emTransito)} em trânsito` : ""}) abaixo do alvo de ${fmt(ideal.alvoEstoque)} un. — cobertura-alvo ${ideal.coberturaAlvoDias}d, ritmo ${fmt(ideal.ritmoMensal)}/mês.`
      : ideal.status === "EXCESSO"
        ? `Excesso de ${fmt(excedente)} un.: posição de ${fmt(posicao)} un. acima do alvo de ${fmt(ideal.alvoEstoque)} un. (cobertura-alvo ${ideal.coberturaAlvoDias}d).`
        : `OK: posição de ${fmt(posicao)} un. dentro do alvo de ${fmt(ideal.alvoEstoque)} un. (cobertura-alvo ${ideal.coberturaAlvoDias}d).`;

  return {
    CURVA_ABC_REDE: exportData?.curvaAbc ?? "",
    PRODUTO: item.produto,
    DESC_PRODUTO: item.descProduto,
    CODIGO_BARRA: item.codigoBarra || "",
    COR_PRODUTO: item.corProduto || "",
    DESC_COR: item.descCor || "",
    LINHA: item.linha || "",
    SUBGRUPO: item.subgrupo || "",
    QUANTIDADE: quantidade,
    COMPRA_IDEAL: compraIdeal,
    STATUS: statusLabel,
    EXCEDENTE: excedente > 0 ? excedente : null,
    RITMO_MENSAL: ideal.ritmoMensal,
    CONFIABILIDADE_RITMO: COMPRA_IDEAL_CONFIABILIDADE_LABEL[ideal.confiabilidade],
    COBERTURA_ALVO_DIAS: ideal.coberturaAlvoDias,
    ALVO_ESTOQUE: ideal.alvoEstoque,
    ESTOQUE_FILIAL: item.estoqueFilial ?? null,
    EM_TRANSITO: ideal.emTransito,
    POSICAO: posicao,
    COBERTURA_ATUAL_DIAS: ideal.coberturaAtualDias,
    ACABA_EM: ideal.acabaEm,
    DIAS_ATE_ACABAR: ideal.diasAteAcabar,
    CHEGA_EM: ideal.chegaEm,
    DIAS_ATE_CHEGADA: ideal.diasAteChegada,
    SALDO_CHEGADA: ideal.saldoChegada,
    QTDE_12M: item.qtde12m ?? null,
    VALOR_12M: item.valor12m ?? null,
    QTDE_60D: item.qtde60d ?? null,
    VENDAS_MES_ATUAL: item.vendasMesAtual ?? null,
    CUSTO_UNIT: item.custoUnit ?? null,
    CUSTO_TOTAL: quantidade > 0 && custoUnit > 0 ? quantidade * custoUnit : null,
    DIAS_DESDE_ULTIMA_VENDA: item.diasDesdeUltimaVenda ?? null,
    PRIMEIRA_ENTRADA_FILIAL: item.primeiraEntradaFilial ?? null,
    DIAS_HISTORICO_FILIAL: diasHistoricoFilial,
    MESES_HISTORICO_FILIAL: mesesHistoricoFilial,
    HISTORICO_PARCIAL: historicoParcial ? "Sim" : "Nao",
    TEM_TRANSFERENCIA_SUGERIDA: exportData?.transferenciaExport ? "Sim" : "Não",
    TRANSFERENCIA_QTD_TOTAL: exportData?.transferenciaExport?.total ?? null,
    TRANSFERENCIA_ROTAS: exportData?.transferenciaExport?.resumoRotas ?? "",
    TRANSFERENCIA_DESTINOS_URGENCIA: exportData?.transferenciaExport?.resumoDestinosUrgencia ?? "",
    RESUMO: resumo,
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
    // Mesma regra da página Curva ABC: A até 60%, B até 90%, C acima de 90%.
    const curva: Curva = percCum <= 0.6 ? "A" : percCum <= 0.9 ? "B" : "C";
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

// ─── Component ────────────────────────────────────────────────────────────────

interface ListaLojaPageProps {
  companyKey: CompanyKey;
  companyName: string;
  companySlug: string;
}

type Mode = "list" | "editor" | "saved-purchases";

function NmBadgeAgregado({
  filiais,
  comCompra,
  onEnter,
  onLeave,
}: {
  filiais: FilialNecessidadeMinima[];
  comCompra: boolean;
  onEnter: (e: React.MouseEvent, filiais: FilialNecessidadeMinima[]) => void;
  onLeave: () => void;
}) {
  return (
    <span
      onMouseEnter={(e) => { e.stopPropagation(); onEnter(e, filiais); }}
      onMouseLeave={onLeave}
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
        marginLeft: comCompra ? 6 : 0,
      }}
    >
      NM
    </span>
  );
}

type ListaLojaItensTableProps = {
  companyKey: CompanyKey;
  filialCod: string | null;
  filialNome?: string | null;
  itens: ListaItem[];
  compraView: boolean;
  abcMap: Map<string, CurvaInfo>;
  enableAbc?: boolean;
  /** Índice de compras em trânsito (gerenciado pela página, compartilhado com o cálculo da qtd sugerida). */
  comprasTransitoIndex: CompraTransitoIndex;
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
  enableAbc = true,
  comprasTransitoIndex,
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
  // Catraca da data de compra (modo ciclo) — mesma lógica/persistência das demais telas.
  const { enabled: catracaEnabled, reconcile: catracaReconcile, persist: catracaPersist } =
    useCatracaDataCompra(companyKey, filialCod ?? "");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const diasCorridosMes = new Date().getDate();
  const showTransferenciaColumn = transferenciasPorItem != null;

  const [estoqueTooltip, setEstoqueTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    filiais: EstoqueTooltipRow[];
    total: number;
  }>(null);
  const [vendasTooltip, setVendasTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    mode: "12m" | "60d" | "valor12m";
    filiais: FilialVendaRow[];
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
  }>(null);
  const vendasHoverKeyRef = useRef<string | null>(null);
  const estoqueHoverKeyRef = useRef<string | null>(null);
  const [transitoTooltip, setTransitoTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    entries: CompraTransitoIndexEntry[];
    total: number;
  }>(null);
  const [compraIdealTooltip, setCompraIdealTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    ideal: CompraIdealResult;
  }>(null);
  const [ritmoTooltip, setRitmoTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    cor: string;
    ideal: CompraIdealResult;
  }>(null);
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
    blendAplicado?: boolean;
    qtdFinalPuro?: number;
    qtdSBlend?: number;
    transitTotal?: number;
    transitDates?: string[];
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
  const [sugestaoPOTooltip, setSugestaoPOTooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m?: number;
    periodoRef?: string;
    diasComEstoquePositivo?: number;
    diasSemEstoque?: number;
    velocidadeAjustada?: number;
    limiteSeguro?: number;
    qtdPO: number;
    transitTotal?: number;
    transitDates?: string[];
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
  const [nmTooltipAgregado, setNmTooltipAgregado] = useState<null | {
    x: number;
    y: number;
    filiais: FilialNecessidadeMinima[];
    total: number;
    comCompra: boolean;
    limiteDias?: number;
    duracaoAtual?: number;
  }>(null);

  const [estoqueCache, setEstoqueCache] = useState<Record<string, EstoqueTooltipRow[]>>({});
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
        ritmoRecenteDias: number | null;
        ritmoRecenteVendas: number | null;
        ritmoRecenteInicioIso: string | null;
        ritmoRecenteFimIso: string | null;
        ritmoRecenteUltimaVendaIso: string | null;
        ritmoGapDias: number | null;
        historicoParcial: boolean | null;
        filiaisNM: FilialNecessidadeMinima[] | null;
        filiaisCobertura: FilialNecessidadeMinima[] | null;
        vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number; velocidadeAjustada?: number | null; mesesDisponiveis?: number | null; diasComEstoquePositivo?: number | null }> | null;
        estoquePorFilial: Array<{ filial: string; estoque: number }> | null;
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
    diasComEstoquePositivo: number | null;
    diasSemEstoque: number | null;
    mesesDisponiveis: number | null;
    velocidadeAjustada: number | null;
    historicoParcial: boolean | null;
    filiaisNM: FilialNecessidadeMinima[] | null;
    filiaisCobertura: FilialNecessidadeMinima[] | null;
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
  const abcDisplayMap = enableAbc
    ? (abcFullMap ?? (abcFullLoadFailed ? abcMap : new Map<string, CurvaInfo>()))
    : new Map<string, CurvaInfo>();

  useEffect(() => {
    if (!enableAbc) return;
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
  }, [companyKey, filialCod, filialScopeKey, enableAbc]);

  useEffect(() => {
    if (itens.length === 0) return;
    let cancelled = false;
    void Promise.all(
      itens.map(async (item) => {
        const key = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
        const [vendas, estoqueFilial] = await Promise.all([
          fetchVendasItemMetricas(companyKey, filialCod, item.produto, item.corProduto, { linha: item.linha, subgrupo: item.subgrupo }),
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
            diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
            diasSemEstoque: vendas?.diasSemEstoque ?? null,
            mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
            velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
            ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
            ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
            ritmoInicioIso: vendas?.ritmoInicioIso ?? null,
            ritmoFimIso: vendas?.ritmoFimIso ?? null,
            ritmoDiasComVenda: vendas?.ritmoDiasComVenda ?? null,
            ritmoPrimeiraVendaIso: vendas?.ritmoPrimeiraVendaIso ?? null,
            ritmoUltimaVendaIso: vendas?.ritmoUltimaVendaIso ?? null,
            ritmoRecenteDias: vendas?.ritmoRecenteDias ?? null,
            ritmoRecenteVendas: vendas?.ritmoRecenteVendas ?? null,
            ritmoRecenteInicioIso: vendas?.ritmoRecenteInicioIso ?? null,
            ritmoRecenteFimIso: vendas?.ritmoRecenteFimIso ?? null,
            ritmoRecenteUltimaVendaIso: vendas?.ritmoRecenteUltimaVendaIso ?? null,
            ritmoGapDias: vendas?.ritmoGapDias ?? null,
            historicoParcial: vendas?.historicoParcial ?? null,
            filiaisNM: vendas?.filiaisNM ?? null,
            filiaisCobertura: vendas?.filiaisCobertura ?? null,
            vendasPorFilial: vendas?.vendasPorFilial ?? null,
            estoquePorFilial: vendas?.estoquePorFilial ?? null,
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

  // Catraca: junta gravações pendentes (mesmo cálculo do display: ciclo + ritmo + trânsito).
  const catracaFreezes = useMemo<CatracaFreeze[]>(() => {
    if (!catracaEnabled) return [];
    const out: CatracaFreeze[] = [];
    for (const item of itens) {
      const metricKey = `${filialScopeKey}::${buildItemKey(item.produto, item.corProduto)}`;
      const live = liveMetrics[metricKey];
      const hasLive = Object.prototype.hasOwnProperty.call(liveMetrics, metricKey);
      const ciclo = resolveCicloCompra(companyKey, { linha: item.linha, subgrupo: item.subgrupo });
      const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, item.produto, item.corProduto);
      const idealCru = calcCompraIdeal({
        estoqueAtual: hasLive ? (live?.estoqueFilial ?? 0) : (item.estoqueFilial ?? 0),
        ritmoDiasComEstoque: hasLive ? (live?.ritmoDiasComEstoque ?? null) : null,
        ritmoVendasPeriodo: hasLive ? (live?.ritmoVendasPeriodo ?? null) : null,
        ritmoInicioIso: hasLive ? (live?.ritmoInicioIso ?? null) : null,
        ritmoFimIso: hasLive ? (live?.ritmoFimIso ?? null) : null,
        ritmoDiasComVenda: hasLive ? (live?.ritmoDiasComVenda ?? null) : null,
        ritmoPrimeiraVendaIso: hasLive ? (live?.ritmoPrimeiraVendaIso ?? null) : null,
        ritmoUltimaVendaIso: hasLive ? (live?.ritmoUltimaVendaIso ?? null) : null,
        ritmoRecenteDias: hasLive ? (live?.ritmoRecenteDias ?? null) : null,
        ritmoRecenteVendas: hasLive ? (live?.ritmoRecenteVendas ?? null) : null,
        ritmoRecenteInicioIso: hasLive ? (live?.ritmoRecenteInicioIso ?? null) : null,
        ritmoRecenteFimIso: hasLive ? (live?.ritmoRecenteFimIso ?? null) : null,
        ritmoRecenteUltimaVendaIso: hasLive ? (live?.ritmoRecenteUltimaVendaIso ?? null) : null,
        ritmoGapDias: hasLive ? (live?.ritmoGapDias ?? null) : null,
        gapAntigoDias: resolveGapAntigoDias(companyKey),
        recenteHorizonteDias: resolveRecenteHorizonteDias(companyKey),
        qtde60d: hasLive ? (live?.qtde60d ?? null) : (item.qtde60d ?? null),
        linha: item.linha,
        subgrupo: item.subgrupo,
        coberturaDias: ciclo.coberturaDias,
        producaoDias: ciclo.producaoDias,
        transitEntries,
      });
      const { freeze } = catracaReconcile(idealCru, buildItemKey(item.produto, item.corProduto), transitEntries);
      if (freeze) out.push(freeze);
    }
    return out;
  }, [itens, liveMetrics, comprasTransitoIndex, companyKey, filialScopeKey, catracaEnabled, catracaReconcile]);

  useEffect(() => catracaPersist(catracaFreezes), [catracaFreezes, catracaPersist]);

  if (itens.length === 0) return null;
  return (
    <div className={`${styles.produtosTableWrap} ${compraView ? styles.produtosTableWrapCompra : ""}`}>
      <table className={styles.produtosTable}>
        <thead>
          <tr>
            <th className={styles.colProduto}>Produto</th>
            <th className={styles.colNumeric}>Curva</th>
            <th className={styles.colNumeric}>Qtd 12m</th>
            <th className={styles.colNumeric}>Estoque</th>
            <th className={styles.colNumeric}>Ritmo 60d</th>
            <th className={styles.colNumeric}>Acaba em</th>
            <th className={styles.colNumeric}>Chega em</th>
            <th className={styles.colNumeric}>Estoque chegada</th>
            <th className={styles.colNumeric}>Compra ideal</th>
            <th className={styles.colNumeric}>Status</th>
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
                // filiaisNM e filiaisCobertura só fazem sentido na visão agregada (sem filial específica)
                const filiaisNMAgregado = (!filialCod || !filialCod.trim()) ? (live?.filiaisNM ?? []) : [];
                const filiaisCoberturaAgregado = (!filialCod || !filialCod.trim()) ? (live?.filiaisCobertura ?? []) : [];
                // Opção C: total por filial = NM (zeradas) + Cobertura (abaixo do alvo)
                // combineBaseSuggestion já faz MAX(rede, totalPerFilial)
                const totalPerFilialQty = filiaisNMAgregado.reduce((s, f) => s + f.qtd, 0) + filiaisCoberturaAgregado.reduce((s, f) => s + f.qtd, 0);
                // Compra Ideal: ritmo medido sobre os até 60 dias com estoque mais recentes
                // (× cobertura-alvo − estoque − trânsito). Fallback p/ 60d corridos enquanto não carrega o live.
                // Antes do liveMetrics chegar, usa o snapshot de ritmo já gravado no item
                // (a semente da Curva ABC e as listas salvas o populam) — assim a Compra Ideal
                // já aparece no valor certo e não "pisca" do fallback para a janela.
                const ritmoDiasComEstoque = hasLive ? (live?.ritmoDiasComEstoque ?? null) : (item.ritmoDiasComEstoque ?? null);
                const ritmoVendasPeriodo = hasLive ? (live?.ritmoVendasPeriodo ?? null) : (item.ritmoVendasPeriodo ?? null);
                const ritmoInicioIso = hasLive ? (live?.ritmoInicioIso ?? null) : null;
                const ritmoFimIso = hasLive ? (live?.ritmoFimIso ?? null) : null;
                const ritmoDiasComVenda = hasLive ? (live?.ritmoDiasComVenda ?? null) : null;
                const ritmoPrimeiraVendaIso = hasLive ? (live?.ritmoPrimeiraVendaIso ?? null) : null;
                const ritmoUltimaVendaIso = hasLive ? (live?.ritmoUltimaVendaIso ?? null) : null;
                const ritmoRecenteDias = hasLive ? (live?.ritmoRecenteDias ?? null) : null;
                const ritmoRecenteVendas = hasLive ? (live?.ritmoRecenteVendas ?? null) : null;
                const ritmoRecenteInicioIso = hasLive ? (live?.ritmoRecenteInicioIso ?? null) : null;
                const ritmoRecenteFimIso = hasLive ? (live?.ritmoRecenteFimIso ?? null) : null;
                const ritmoRecenteUltimaVendaIso = hasLive ? (live?.ritmoRecenteUltimaVendaIso ?? null) : null;
                const ritmoGapDias = hasLive ? (live?.ritmoGapDias ?? null) : null;
                const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, item.produto, item.corProduto);
                const cicloItem = hasCicloCompra(companyKey)
                  ? resolveCicloCompra(companyKey, { linha: item.linha, subgrupo: item.subgrupo })
                  : null;
                const idealCru = calcCompraIdeal({
                  estoqueAtual: estoqueFilial,
                  ritmoDiasComEstoque,
                  ritmoVendasPeriodo,
                  ritmoInicioIso,
                  ritmoFimIso,
                  ritmoDiasComVenda,
                  ritmoPrimeiraVendaIso,
                  ritmoUltimaVendaIso,
                  ritmoRecenteDias,
                  ritmoRecenteVendas,
                  ritmoRecenteInicioIso,
                  ritmoRecenteFimIso,
                  ritmoRecenteUltimaVendaIso,
                  ritmoGapDias,
                  gapAntigoDias: resolveGapAntigoDias(companyKey),
                  recenteHorizonteDias: resolveRecenteHorizonteDias(companyKey),
                  qtde60d,
                  linha: item.linha,
                  subgrupo: item.subgrupo,
                  coberturaDias: cicloItem?.coberturaDias ?? null,
                  producaoDias: cicloItem?.producaoDias ?? null,
                  grupoCiclo: cicloItem?.grupo ?? null,
                  transitEntries,
                });
                const { ideal } = catracaReconcile(
                  idealCru,
                  buildItemKey(item.produto, item.corProduto),
                  transitEntries
                );
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
                <div className={styles.productMeta}>{formatColorDisplay(item.descCor, item.corProduto)}</div>
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
                            {formatColorDisplay(opcao.descCor, opcao.corProduto)}
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
                  if (!enableAbc) {
                    return (
                      <span className={`${styles.abcBadge} ${styles.abcBadgeEmpty}`} title="Curva ABC desativada no modal">
                        —
                      </span>
                    );
                  }
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
                      onMouseEnter={(e) => {
                        if (!enableAbc) return;
                        const k = buildItemKey(item.produto, item.corProduto);
                        const abc = abcDisplayMap.get(k);
                        if (!abc) return;
                        const liveKey = `${filialScopeKey}::${k}`;
                        const liveVal = liveMetrics[liveKey]?.valor12m;
                        const val12m = liveVal ?? Number(item.valor12m ?? 0);
                        // Período sempre 12 meses; para produto recente, usa o histórico real disponível na filial.
                        const periodoHistorico = historicoParcial
                          ? `Últimos ${formatFixed(getMesesHistoricoFilial({ mesesHistoricoFilial }))} meses (histórico real da filial)`
                          : "Últimos 12 meses";
                        // Classificação apenas no escopo atual: geral mostra rede, filtrado mostra a loja filtrada.
                        setAbcTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          produto: item.produto,
                          cor: formatColorDisplay(item.descCor, item.corProduto),
                          escopo: filialCod ? "loja" : "geral",
                          periodo: periodoHistorico,
                          regra: "Classificação por faturamento acumulado (A até 60%, B até 90%, C acima de 90%).",
                          curva: abc.curva,
                          valor12m: val12m,
                          percParticipacao: abc.percParticipacao,
                          percCumulativo: abc.percCumulativo,
                        });
                      }}
                      onMouseLeave={() => {
                        setAbcTooltip(null);
                      }}
                      title="Curva ABC no escopo atual (faturamento acumulado, regra 60/90)"
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
                    vendasHoverKeyRef.current = `${cacheKey}::valor12m`;
                    const cached = vendasCache[cacheKey];
                    if (cached) {
                      if (vendasHoverKeyRef.current !== `${cacheKey}::valor12m`) return;
                      setVendasTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: formatColorDisplay(item.descCor, item.corProduto),
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
                      cor: formatColorDisplay(item.descCor, item.corProduto),
                      mode: "12m",
                      filiais: [],
                      loading: true,
                    });
                    try {
                      const rows = aggregateVendasRowsByDisplayLabel(
                        await fetchVendasPorFilialItem(companyKey, filialCod, item.produto, item.corProduto),
                        companyConfig
                      );
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
                    const showTooltip = (rows: EstoqueTooltipRow[]) => {
                      if (estoqueHoverKeyRef.current !== cacheKey) return;
                      setEstoqueTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: formatColorDisplay(item.descCor, item.corProduto),
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
                      const rows = buildEstoqueTooltipRows(
                        (metricas?.estoquePorFilial ?? []).map((r) => ({
                          filial: r.filial,
                          estoque: Number(r.estoque ?? 0),
                        })),
                        companyConfig
                      );
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
                {(() => {
                  const baixa = hasLive && ideal.confiabilidade !== "alta";
                  const temDado = qtde60d != null || ideal.ritmoDiasBase > 0;
                  return (
                    <span
                      className={styles.cellMetric}
                      style={baixa ? { color: "#b45309", fontWeight: 600 } : undefined}
                      onMouseEnter={temDado ? (e) => setRitmoTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: formatColorDisplay(item.descCor, item.corProduto),
                        ideal,
                      }) : undefined}
                      onMouseLeave={() => setRitmoTooltip(null)}
                    >
                      {temDado ? `${fmt(ideal.ritmoMensal)}/mês` : "—"}
                      {baixa && temDado ? " ⚠" : ""}
                    </span>
                  );
                })()}
              </td>
              <td className={styles.colNumeric}>
                <span
                  className={styles.cellMetric}
                  title={ideal.acabaEm ? `Estoque atual zera no ritmo dos últimos 60 dias` : "Sem venda nos últimos 60 dias"}
                >
                  {ideal.acabaEm ? `${formatShortDate(ideal.acabaEm)} (${fmt(ideal.diasAteAcabar ?? 0)}d)` : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                <span className={styles.cellMetric}>
                  {ideal.chegaEm
                    ? `${formatShortDate(ideal.chegaEm)}${ideal.diasAteChegada != null ? ` (${fmt(ideal.diasAteChegada)}d)` : ""}`
                    : "—"}
                </span>
              </td>
              <td className={styles.colNumeric}>
                {ideal.saldoChegada != null ? (
                  <span
                    className={styles.cellMetric}
                    title="Estoque atual restante na data da chegada (+ o que chega, em verde)"
                    onMouseEnter={ideal.emTransito > 0 ? (e) =>
                      setTransitoTooltip({
                        x: e.clientX,
                        y: e.clientY,
                        produto: item.produto,
                        cor: formatColorDisplay(item.descCor, item.corProduto),
                        entries: transitEntries,
                        total: ideal.emTransito,
                      }) : undefined}
                    onMouseLeave={() => setTransitoTooltip(null)}
                  >
                    {fmt(ideal.saldoChegada)}
                    {ideal.emTransito > 0 ? (
                      <span style={{ color: "#166534", fontWeight: 700 }}> (+{fmt(ideal.emTransito)})</span>
                    ) : null}
                  </span>
                ) : (
                  <span className={styles.cellMetric}>—</span>
                )}
              </td>
              <td className={styles.colNumeric}>
                {(() => {
                  // Mesmos estados globais (idênticos à Curva ABC): carregando / sem dados / número.
                  if (!hasLive) {
                    return <span style={{ color: "#94a3b8", fontWeight: 500, whiteSpace: "nowrap" }}>Carregando...</span>;
                  }
                  const semBase = qtde12m == null && vendasMesAtual == null && estoqueFilial == null;
                  if (semBase) {
                    return <span style={{ color: "#94a3b8", fontWeight: 500, whiteSpace: "nowrap" }}>Sem dados</span>;
                  }
                  const compraIdealDisplay = Math.max(0, ideal.compraIdeal);
                  return (
                    <span
                      className={styles.cellMetric}
                      onMouseEnter={(e) =>
                        setCompraIdealTooltip({
                          x: e.clientX,
                          y: e.clientY,
                          produto: item.produto,
                          cor: formatColorDisplay(item.descCor, item.corProduto),
                          ideal,
                        })
                      }
                      onMouseLeave={() => setCompraIdealTooltip(null)}
                      style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", fontWeight: 700, color: compraIdealDisplay > 0 ? "#b45309" : "#475569" }}
                    >
                      <span>{fmt(compraIdealDisplay)} pcs</span>
                      {ideal.modoCiclo && ideal.dataCompra && ideal.status === "REPOR" ? (() => {
                        const essaSemana = precisaComprarEssaSemana(ideal, companyKey);
                        return (
                          <span style={{ fontSize: 11, fontWeight: ideal.comprarAgora || essaSemana ? 800 : 600, color: ideal.comprarAgora ? "#b91c1c" : essaSemana ? "#b45309" : "#0f766e" }}>
                            {ideal.comprarAgora
                              ? "📅 comprar agora"
                              : essaSemana
                                ? "📅 comprar essa semana"
                                : `📅 ${formatShortDate(ideal.dataCompra)}${ideal.diasAteComprar != null ? ` · ${fmt(ideal.diasAteComprar)}d` : ""}`}
                          </span>
                        );
                      })() : null}
                    </span>
                  );
                })()}
              </td>
              <td className={styles.colNumeric}>
                {(() => {
                  const excedente = Math.max(0, -ideal.compraIdeal);
                  const v = compraIdealStatusVisual(ideal.status);
                  const label =
                    ideal.status === "REPOR"
                      ? "Repor"
                      : excedente > 0
                        ? `Excesso +${fmt(excedente)}`
                        : "OK";
                  return (
                    <span
                      title={`Cobertura-alvo ${ideal.coberturaAlvoDias}d · alvo ${fmt(ideal.alvoEstoque)} un · posição ${fmt(ideal.estoqueAtual + ideal.emTransito)} un`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                        padding: "1px 8px",
                        borderRadius: 999,
                        fontSize: 11,
                        fontWeight: 700,
                        background: v.bg,
                        color: v.fg,
                        border: `1px solid ${v.border}`,
                        cursor: "help",
                      }}
                    >
                      {v.icon} {label}
                    </span>
                  );
                })()}
              </td>
              <td className={styles.colNumeric}>
                <span className={styles.cellMetric}>
                  {custoUnit != null && custoUnit > 0 && item.quantidade > 0
                    ? fmtBRL(item.quantidade * custoUnit)
                    : "—"}
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
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(estoqueTooltip.x, estoqueTooltip.y)}>
          <div className={styles.metricTooltipTitle}>Estoque por filial</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {estoqueTooltip.produto}</div>
          {estoqueTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {estoqueTooltip.cor}</div>}
          <div className={styles.metricTooltipDivider} />
          {estoqueTooltip.filiais.length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem dados de estoque por filial.</div>
          ) : (
            <>
              {estoqueTooltip.filiais.map((row) => (
                <div key={row.key} className={styles.metricTooltipRow}>
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
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(vendasTooltip.x, vendasTooltip.y)}>
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
          ) : filterVendasTooltipRows(vendasTooltip.filiais, vendasTooltip.mode).length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem vendas no período.</div>
          ) : (
            <>
              {filterVendasTooltipRows(vendasTooltip.filiais, vendasTooltip.mode).map((row, index) => (
                <div key={`${row.filial}-${index}`} className={styles.metricTooltipRow}>
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
                    ? fmtBRL(
                        filterVendasTooltipRows(vendasTooltip.filiais, vendasTooltip.mode).reduce(
                          (s, row) => s + Number(row.valor12m ?? 0),
                          0
                        )
                      )
                    : fmt(
                        filterVendasTooltipRows(vendasTooltip.filiais, vendasTooltip.mode).reduce(
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
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(abcTooltip.x, abcTooltip.y)}>
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
        </div>
      )}
      {transitoTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(transitoTooltip.x, transitoTooltip.y)}>
          <div className={styles.metricTooltipTitle}>Em trânsito</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {transitoTooltip.produto}</div>
          {transitoTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {transitoTooltip.cor}</div>}
          <div className={styles.metricTooltipDivider} />
          {transitoTooltip.entries.length === 0 ? (
            <div className={styles.metricTooltipLine}>Sem compras em trânsito.</div>
          ) : (
            <>
              {transitoTooltip.entries.map((entry, index) => (
                <div key={`${entry.title}-${entry.dataRecebimento}-${index}`} className={styles.metricTooltipRow}>
                  <span>{formatDate(entry.dataRecebimento)} · {entry.title}</span>
                  <span>+{fmt(entry.quantidade)}</span>
                </div>
              ))}
              <div className={styles.metricTooltipTotal}>
                <span>Total</span>
                <span>{fmt(transitoTooltip.total)}</span>
              </div>
            </>
          )}
        </div>
      )}
      {compraIdealTooltip && (
        <div
          style={{
            position: "fixed",
            zIndex: 9999,
            pointerEvents: "none",
            ...getTooltipViewportPosition(compraIdealTooltip.x, compraIdealTooltip.y),
          }}
        >
          <CompraIdealExplainCard
            ideal={compraIdealTooltip.ideal}
            descricao={compraIdealTooltip.produto}
            cor={compraIdealTooltip.cor}
          />
        </div>
      )}
      {ritmoTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(ritmoTooltip.x, ritmoTooltip.y)}>
          <div className={styles.metricTooltipTitle}>Ritmo de venda → {fmt(ritmoTooltip.ideal.ritmoMensal)}/mês</div>
          <div className={styles.metricTooltipMeta}><strong>Produto:</strong> {ritmoTooltip.produto}</div>
          {ritmoTooltip.cor && <div className={styles.metricTooltipMeta}><strong>Cor:</strong> {ritmoTooltip.cor}</div>}
          <div className={styles.metricTooltipLine} style={{ marginTop: 6, color: "#64748b", fontSize: 11 }}>
            Medido no maior período contínuo com estoque positivo dos últimos 12 meses (até 60 dias). Vendas ÷ dias × 30.
          </div>
          <div className={styles.metricTooltipDivider} />
          {ritmoTooltip.ideal.ritmoDiasBase > 0 ? (
            <>
              <div className={styles.metricTooltipRow}>
                <span>Período</span>
                <span>
                  {ritmoTooltip.ideal.ritmoInicioIso ? formatShortDate(ritmoTooltip.ideal.ritmoInicioIso) : "—"}
                  {" → "}
                  {ritmoTooltip.ideal.ritmoFimIso ? formatShortDate(ritmoTooltip.ideal.ritmoFimIso) : "—"}
                </span>
              </div>
              <div className={styles.metricTooltipRow}>
                <span>Duração</span><span>{fmt(ritmoTooltip.ideal.ritmoDiasBase)} {ritmoTooltip.ideal.ritmoDiasBase === 1 ? "dia" : "dias"} com estoque</span>
              </div>
              <div className={styles.metricTooltipRow}>
                <span>Terminou</span><span>{formatHaTempo(ritmoTooltip.ideal.ritmoDiasAtras) || "—"}</span>
              </div>
              <div className={styles.metricTooltipRow}>
                <span>Vendas no período</span><span>{fmt(ritmoTooltip.ideal.ritmoVendasBase)} un</span>
              </div>
              {ritmoTooltip.ideal.ritmoVendasBase > 0 ? (
                <div className={styles.metricTooltipRow}>
                  <span>Concentração</span>
                  <span>
                    {ritmoTooltip.ideal.ritmoPrimeiraVendaIso ? formatShortDate(ritmoTooltip.ideal.ritmoPrimeiraVendaIso) : "—"}
                    {" → "}
                    {ritmoTooltip.ideal.ritmoUltimaVendaIso ? formatShortDate(ritmoTooltip.ideal.ritmoUltimaVendaIso) : "—"}
                    {ritmoTooltip.ideal.ritmoSpanVendaDias != null ? ` (${fmt(ritmoTooltip.ideal.ritmoSpanVendaDias)}d · ${fmt(ritmoTooltip.ideal.ritmoDiasComVenda)} dias com venda)` : ""}
                  </span>
                </div>
              ) : null}
              <div className={styles.metricTooltipRow}>
                <span>Consumo</span><span>{ritmoTooltip.ideal.consumoDiario.toFixed(2)} un/dia</span>
              </div>
              {ritmoTooltip.ideal.ritmoBaseAmortecida ? (
                <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                  Piso de lançamento: {fmt(ritmoTooltip.ideal.ritmoDiasBase)}d reais de estoque → consumo projetado sobre base mínima de 30 dias (não extrapola a rajada).
                </div>
              ) : null}
              {ritmoTooltip.ideal.ritmoSpanVendaDias != null && ritmoTooltip.ideal.ritmoSpanVendaDias < ritmoTooltip.ideal.ritmoDiasBase * 0.5 ? (
                <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                  ⚠ Vendas concentradas em {fmt(ritmoTooltip.ideal.ritmoSpanVendaDias)}d dos {fmt(ritmoTooltip.ideal.ritmoDiasBase)}d — ritmo real no surto pode ser maior.
                </div>
              ) : null}
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipRow}>
                <span>Confiabilidade</span>
                <span style={ritmoTooltip.ideal.confiabilidade !== "alta" ? { color: "#b45309", fontWeight: 700 } : { color: "#166534", fontWeight: 700 }}>
                  {ritmoTooltip.ideal.confiabilidade !== "alta" ? "⚠ " : ""}{COMPRA_IDEAL_CONFIABILIDADE_LABEL[ritmoTooltip.ideal.confiabilidade]}
                </span>
              </div>
              {ritmoTooltip.ideal.confiabilidade !== "alta" ? (
                <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#b45309", marginTop: 2 }}>
                  Base curta (&lt;60 dias com estoque) — estimativa pode variar.
                </div>
              ) : null}
            </>
          ) : (
            <div className={styles.metricTooltipLine}>Sem período com estoque nos últimos 12 meses — ritmo estimado por 60 dias corridos.</div>
          )}
        </div>
      )}
      {sugestaoTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(sugestaoTooltip.x, sugestaoTooltip.y)}>
          <div className={styles.metricTooltipTitle}>{sugestaoTooltip.titulo} → {fmt(sugestaoTooltip.qtdCalculada)} un</div>
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
              <div className={styles.metricTooltipLine} style={{ color: "#64748b", fontSize: 11 }}>Mês atual abaixo do normal — histórico reforçou a sugestão</div>
              <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Atual</span><span style={{ fontSize: 11 }}>{fmt(sugestaoTooltip.qtdFinalPuro)} un</span>
              </div>
              <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>Histórico</span><span style={{ fontSize: 11 }}>{fmt(sugestaoTooltip.qtdSBlend)} un</span>
              </div>
            </>
          )}
          {sugestaoTooltip.distribuicao && sugestaoTooltip.distribuicao.length > 0 ? (
            <>
              <div className={styles.metricTooltipDivider} />
              <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>Por loja (proporcional)</div>
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
              {sugestaoSTooltip.distribuicao.map((filial) => (
                <div key={filial.label} className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span>{filial.label}</span><strong>{fmt(filial.qtd)} un</strong>
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
              {sugestaoETooltip.distribuicao.map((filial) => (
                <div key={filial.label} className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
                  <span>{filial.label}</span><strong>{fmt(filial.qtd)} un</strong>
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
              {sugestaoPOTooltip.periodoRef ? ` (${sugestaoPOTooltip.periodoRef})` : ""}
            </div>
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
      {nmTooltipAgregado && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(nmTooltipAgregado.x, nmTooltipAgregado.y)}>
          <div className={styles.metricTooltipTitle}>NM → {nmTooltipAgregado.total} un</div>
          {nmTooltipAgregado.comCompra && (
            <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>Complemento à sugestão principal — filiais zeradas com demanda</div>
          )}
          {!nmTooltipAgregado.comCompra && (
            <div className={styles.metricTooltipLine} style={{ fontSize: 11, color: "#64748b" }}>Filiais zeradas com demanda, sem outros motivos de compra</div>
          )}
          <div className={styles.metricTooltipDivider} />
          {nmTooltipAgregado.filiais.map((filial) => (
            <div key={filial.filial} className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 16 }}>
              <span>{filial.filial}</span>
              <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "#64748b" }}>⌈{filial.qtde12m}/12⌉</span>
                <strong>{fmt(filial.qtd)} un</strong>
              </span>
            </div>
          ))}
          <div className={styles.metricTooltipDivider} />
          <div className={styles.metricTooltipLine} style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
            <strong>Total</strong>
            <strong>{nmTooltipAgregado.total} un</strong>
          </div>
        </div>
      )}
      {historicoTooltip && (
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(historicoTooltip.x, historicoTooltip.y)}>
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
        <div className={styles.metricTooltip} style={getTooltipViewportPosition(duracaoTooltip.x, duracaoTooltip.y)}>
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
          <div className={styles.metricTooltip} style={getTooltipViewportPosition(transferenciaTooltip.x, transferenciaTooltip.y)}>
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
  // true enquanto recalcula vendas/estoque após trocar a loja — usado para sinalizar
  // visualmente que os valores na tela ainda são os antigos e estão sendo atualizados.
  const [recalculandoMetricas, setRecalculandoMetricas] = useState(false);
  // Índice de compras em trânsito, compartilhado entre a tabela (exibição) e o
  // recálculo da qtd sugerida (para a qtd ao lado do +/- bater com a Compra Ideal da loja).
  const [comprasTransitoIndex, setComprasTransitoIndex] = useState<CompraTransitoIndex>(new Map());
  const [itens, setItens] = useState<ListaItem[]>([]);
  const itensRef = useRef<ListaItem[]>(itens);
  itensRef.current = itens;
  // Garante que a semente vinda da Curva ABC (?addProduto=...) só seja aplicada uma vez.
  const seedAplicadoRef = useRef(false);

  // Modal adicionar produto
  const [modalAberto, setModalAberto] = useState(false);
  const [modalConfirmarFechar, setModalConfirmarFechar] = useState(false);
  const [itensModal, setItensModal] = useState<ListaItem[]>([]);

  // Search (dentro do modal)
  const [searchTerm, setSearchTerm] = useState("");
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [loadingProdutos, setLoadingProdutos] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [batchCodes, setBatchCodes] = useState("");
  const [importandoBatch, setImportandoBatch] = useState(false);
  const [colecoesDisponiveis, setColecoesDisponiveis] = useState<string[]>([]);
  const [loadingColecoesOpcoes, setLoadingColecoesOpcoes] = useState(false);
  const [gradesDisponiveis, setGradesDisponiveis] = useState<string[]>([]);
  const [loadingGradesOpcoes, setLoadingGradesOpcoes] = useState(false);
  const [importandoColecao, setImportandoColecao] = useState(false);
  const [importandoGrade, setImportandoGrade] = useState(false);

  const [importacaoQuery, setImportacaoQuery] = useState("");
  const [importacaoSelecionada, setImportacaoSelecionada] = useState<
    | { tipo: "colecao"; valor: string }
    | { tipo: "grade"; valor: string }
    | null
  >(null);
  const [importacaoDropdownAberto, setImportacaoDropdownAberto] = useState(false);
  const importacaoInputRef = useRef<HTMLInputElement | null>(null);

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
  const [compraIdealProgresso, setCompraIdealProgresso] = useState<{ feito: number; total: number } | null>(null);
  const [filtrarSugeridos, setFiltrarSugeridos] = useState(false);
  // Subconjunto: só os que precisam comprar AGORA (data de compra chegou/passou).
  const [filtrarComprarAgora, setFiltrarComprarAgora] = useState(false);
  const [filtrarBarrados, setFiltrarBarrados] = useState(false);
  const [filtrarTransferencias, setFiltrarTransferencias] = useState(false);
  const [filtrarCurvas, setFiltrarCurvas] = useState<Set<string>>(new Set());
  const [curvaMapEditor, setCurvaMapEditor] = useState<Map<string, CurvaInfo>>(new Map());
  const [transferenciasPorItem, setTransferenciasPorItem] = useState<Record<string, TransferenciaDestinoSugestao[]>>({});
  const [permissoes, setPermissoes] = useState<TransferenciaPermissao | null>(null);
  const [permissoesCarregadas, setPermissoesCarregadas] = useState(false);
  const filialConsultaSelecionada =
    filialSelecionada?.codFilial === TODAS_FILIAIS_VALUE ? null : (filialSelecionada?.codFilial?.trim() || null);
  const itensTransferenciaKey = useMemo(
    () => itens.map((item) => buildItemKey(item.produto, item.corProduto)).sort().join("\n"),
    [itens]
  );

  useEffect(() => {
    let cancelled = false;
    fetchCurvaAbcScope(companyKey as CompanyKey, filialConsultaSelecionada)
      .then((data) => {
        if (cancelled) return;
        setCurvaMapEditor(calcularCurvasAbcProdutos(data.produtos ?? []));
      })
      .catch(() => {
        if (cancelled) return;
      });
    return () => { cancelled = true; };
  }, [companyKey, filialConsultaSelecionada]);

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
    fetchFiliais(companyKey).then((dataRaw) => {
      // MATRIZ não tem performance de venda, então não é uma loja válida para
      // montar lista de compra — removida APENAS deste select (segue aparecendo
      // em estoques/análises das outras telas).
      const data = dataRaw.filter((f) => normalizeKey(f.displayName) !== "MATRIZ");
      setFiliais(data);
      let disponiveis = data;
      if (permissoes) {
        // Casa a permissão contra a filial ativa OU qualquer alias (membros do
        // grupo). Sem isto, permissões que apontam para um membro não-ativo do
        // grupo (ex.: "NERD MORUMBI RDRRRJ", quando a ativa é "NERD MORUMBI RDRX")
        // não casariam e a loja sumiria do select.
        const filialMatchesPermissao = (f: Filial, cod: string) => {
          const target = normalizeKey(cod);
          if (!target) return false;
          if (normalizeKey(f.codFilial) === target) return true;
          return (f.aliases ?? []).some((a) => normalizeKey(a) === target);
        };
        const resolveFiliais = (lista: string[]) => {
          if (lista.length > 0) {
            return data.filter((f) =>
              lista.some((cod) => filialMatchesPermissao(f, cod))
            );
          }
          if (permissoes.filialAtribuida) {
            return data.filter((f) =>
              filialMatchesPermissao(f, permissoes.filialAtribuida!)
            );
          }
          return data;
        };
        disponiveis = resolveFiliais(permissoes.filiaisOrigem || []);
      }
      const comTodas =
        disponiveis.length > 0
          ? [{ codFilial: TODAS_FILIAIS_VALUE, filial: TODAS_FILIAIS_LABEL }, ...disponiveis]
          : disponiveis;
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

  // Carrega o índice de compras em trânsito da empresa (usado na exibição e no cálculo da qtd sugerida).
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

  // Ao mudar a loja ou abrir outra lista para edição, recalcula vendas 90d e estoque (mesma lógica do Controle de Estoque: grupos de filial, etc.)
  useEffect(() => {
    if (mode !== "editor") return;
    if (itensRef.current.length === 0) return;

    const itemKey = (i: ListaItem) => buildItemKey(i.produto, i.corProduto);

    let cancelled = false;
    setRecalculandoMetricas(true);
    void (async () => {
     try {
      const snapshot = itensRef.current;
      const keys = snapshot.map(itemKey);
      const metrics = await Promise.all(
        snapshot.map(async (item) => {
          const [vendas, estoqueFilial] = await Promise.all([
            fetchVendasItemMetricas(companyKey, filialConsultaSelecionada, item.produto, item.corProduto),
            fetchEstoqueFilialSum(companyKey, filialConsultaSelecionada, item.produto, item.corProduto),
          ]);
          const fields = {
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
            diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
            diasSemEstoque: vendas?.diasSemEstoque ?? null,
            mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
            velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
            ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
            ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
            ritmoRecenteDias: vendas?.ritmoRecenteDias ?? null,
            ritmoRecenteVendas: vendas?.ritmoRecenteVendas ?? null,
            ritmoRecenteUltimaVendaIso: vendas?.ritmoRecenteUltimaVendaIso ?? null,
            ritmoGapDias: vendas?.ritmoGapDias ?? null,
            historicoParcial: vendas?.historicoParcial ?? null,
          };

          // Qtd sugerida ao lado do +/-: segue SEMPRE a Compra Ideal (a MESMA exibida na coluna,
          // já com trânsito abatido). Numa loja específica usa o escopo da loja; na visão geral
          // (TODAS) usa o escopo agregado da rede — em ambos bate com a coluna ao lado.
          const suggestedQty = calcQtdSugeridaParaFilial(
            filialConsultaSelecionada,
            item,
            vendas,
            estoqueFilial,
            companyKey,
            comprasTransitoIndex,
            new Date().getDate()
          );

          return { ...fields, suggestedQty };
        })
      );
      if (cancelled) return;
      const metricsByKey = new Map(keys.map((k, i) => [k, metrics[i]!]));
      setItens((current) =>
        current.map((it) => {
          const m = metricsByKey.get(itemKey(it));
          if (!m) return it;
          const { suggestedQty, ...metricFields } = m;
          return { ...it, ...metricFields, quantidade: suggestedQty };
        })
      );
     } finally {
       // Só a execução vigente (não cancelada por uma troca de loja mais recente)
       // desliga o indicador — evita esconder o spinner cedo demais.
       if (!cancelled) setRecalculandoMetricas(false);
     }
    })();

    return () => {
      cancelled = true;
    };
  }, [filialConsultaSelecionada, mode, companyKey, editingId, comprasTransitoIndex]);

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
    setLoadingGradesOpcoes(true);
    void fetch("/api/stock-by-filial?company=scarfme&filtersOnly=true", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as { filterOptions?: { colecoes?: string[]; grades?: string[] } };
      })
      .then((json) => {
        if (!active) return;
        setColecoesDisponiveis(json?.filterOptions?.colecoes ?? []);
        setGradesDisponiveis(json?.filterOptions?.grades ?? []);
      })
      .catch(() => {
        if (active) {
          setColecoesDisponiveis([]);
          setGradesDisponiveis([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingColecoesOpcoes(false);
          setLoadingGradesOpcoes(false);
        }
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
    setImportacaoQuery("");
    setImportacaoSelecionada(null);
    setImportacaoDropdownAberto(false);
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
    setImportacaoQuery("");
    setImportacaoSelecionada(null);
    setImportacaoDropdownAberto(false);
    setColorPickerProduto(null);
    setColorPickerOpcoes([]);
    setModalAberto(false);
  }, [itens]);

  const continuarNoModal = useCallback(() => {
    setModalConfirmarFechar(false);
  }, []);

  const confirmarModal = useCallback(() => {
    setItens(
      itensModal.map((item) => {
        if (item.quantidade <= 0) return { ...item, quantidade: 0 };
        return item;
      })
    );
    setModalAberto(false);
    setSearchTerm("");
    setProdutos([]);
    setImportacaoQuery("");
    setImportacaoSelecionada(null);
    setImportacaoDropdownAberto(false);
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
        descCor: resolveStrictColorDescription(produto.corProduto, produto.descCor),
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
              quantidade: calcQtdSugeridaParaFilial(
                filialCod,
                base,
                vendas,
                estoque,
                companyKey,
                comprasTransitoIndex,
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
              diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
              diasSemEstoque: vendas?.diasSemEstoque ?? null,
              mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
              velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
              ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
              ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
              historicoParcial: vendas?.historicoParcial ?? null,
            },
          ];
        });
      })();
    },
    [mostrarNotificacao, produtos, filialConsultaSelecionada, companyKey, comprasTransitoIndex]
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

  const importarColecaoProdutos = useCallback(async (colecaoInput?: string) => {
    const colecao = (colecaoInput ?? "").trim();
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
            descCor: resolveStrictColorDescription(p.corProduto, p.descCor),
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
            diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
            diasSemEstoque: vendas?.diasSemEstoque ?? null,
            mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
            velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
            ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
            ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
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
          const metrics = metricsMap.get(key) || { qtde12m: null, valor12m: null, qtde60d: null, vendasMesAtual: null, custoUnit: null, estoqueFilial: null, diasDesdeUltimaVenda: null, primeiraEntradaFilial: null, diasHistoricoFilial: null, mesesHistoricoFilial: null, diasComEstoquePositivo: null, diasSemEstoque: null, mesesDisponiveis: null, velocidadeAjustada: null, historicoParcial: null };
          const suggested = calcQtdSugeridaParaFilial(
            filialCod,
            agg.item,
            metrics,
            metrics.estoqueFilial,
            companyKey,
            comprasTransitoIndex,
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
            diasComEstoquePositivo: metrics.diasComEstoquePositivo,
            diasSemEstoque: metrics.diasSemEstoque,
            mesesDisponiveis: metrics.mesesDisponiveis,
            velocidadeAjustada: metrics.velocidadeAjustada,
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
  }, [companyKey, filialConsultaSelecionada, mostrarNotificacao, comprasTransitoIndex]);

  const importarGradeProdutos = useCallback(async (gradeInput?: string) => {
    const grade = (gradeInput ?? "").trim();
    if (!grade) {
      mostrarNotificacao("Selecione uma grade", "error");
      return;
    }
    if (companyKey !== "scarfme") return;

    const filialCod = filialConsultaSelecionada;
    setImportandoGrade(true);
    try {
      const lista = await fetchProdutosPorGrade(grade, companyKey);
      if (lista.length === 0) {
        mostrarNotificacao("Nenhum item encontrado para esta grade", "error");
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
            descCor: resolveStrictColorDescription(p.corProduto, p.descCor),
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
            diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
            diasSemEstoque: vendas?.diasSemEstoque ?? null,
            mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
            velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
            ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
            ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
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
          const metrics = metricsMap.get(key) || { qtde12m: null, valor12m: null, qtde60d: null, vendasMesAtual: null, custoUnit: null, estoqueFilial: null, diasDesdeUltimaVenda: null, primeiraEntradaFilial: null, diasHistoricoFilial: null, mesesHistoricoFilial: null, diasComEstoquePositivo: null, diasSemEstoque: null, mesesDisponiveis: null, velocidadeAjustada: null, historicoParcial: null };
          const suggested = calcQtdSugeridaParaFilial(
            filialCod,
            agg.item,
            metrics,
            metrics.estoqueFilial,
            companyKey,
            comprasTransitoIndex,
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
            diasComEstoquePositivo: metrics.diasComEstoquePositivo,
            diasSemEstoque: metrics.diasSemEstoque,
            mesesDisponiveis: metrics.mesesDisponiveis,
            velocidadeAjustada: metrics.velocidadeAjustada,
            historicoParcial: metrics.historicoParcial,
          });
        }
        return next;
      });

      const n = agregados.size;
      const limiteAviso = lista.length >= 2500;
      mostrarNotificacao(
        limiteAviso
          ? `Importados ${n} itens da grade ${grade}. Atenção: a busca limita em 2500 variantes; pode haver mais no cadastro.`
          : `Importados ${n} itens da grade ${grade}.`
      );
    } finally {
      setImportandoGrade(false);
    }
  }, [companyKey, filialConsultaSelecionada, mostrarNotificacao, comprasTransitoIndex]);

  const opcoesImportacao = useMemo(() => {
    if (companyKey !== "scarfme") return [];
    const colecoes = (colecoesDisponiveis || []).map((c) => ({
      key: `colecao:${c}`,
      tipo: "colecao" as const,
      valor: c,
      label: `Coleção: ${c}`,
    }));
    const grades = (gradesDisponiveis || []).map((g) => ({
      key: `grade:${g}`,
      tipo: "grade" as const,
      valor: g,
      label: `Grade: ${g}`,
    }));
    return [...colecoes, ...grades];
  }, [colecoesDisponiveis, gradesDisponiveis, companyKey]);

  const opcoesImportacaoFiltradas = useMemo(() => {
    const q = importacaoQuery.trim().toUpperCase();
    if (!q) return opcoesImportacao.slice(0, 30);
    return opcoesImportacao
      .filter((o) => o.valor.toUpperCase().includes(q) || o.label.toUpperCase().includes(q))
      .slice(0, 30);
  }, [opcoesImportacao, importacaoQuery]);

  const selecionarOpcaoImportacao = useCallback((opt: { tipo: "colecao" | "grade"; valor: string; label: string }) => {
    setImportacaoSelecionada(opt.tipo === "colecao" ? { tipo: "colecao", valor: opt.valor } : { tipo: "grade", valor: opt.valor });
    setImportacaoQuery(opt.label);
    setImportacaoDropdownAberto(false);
  }, []);

  const importarSelecionado = useCallback(async () => {
    if (!importacaoSelecionada) {
      mostrarNotificacao("Selecione uma coleção ou grade", "error");
      return;
    }
    if (importacaoSelecionada.tipo === "colecao") {
      await importarColecaoProdutos(importacaoSelecionada.valor);
      return;
    }
    await importarGradeProdutos(importacaoSelecionada.valor);
  }, [importacaoSelecionada, importarColecaoProdutos, importarGradeProdutos, mostrarNotificacao]);

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
            descCor: resolveStrictColorDescription(p.corProduto, p.descCor),
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
            diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
            diasSemEstoque: vendas?.diasSemEstoque ?? null,
            mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
            velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
            ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
            ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
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
          const metrics = metricsMap.get(key) || { qtde12m: null, valor12m: null, qtde60d: null, vendasMesAtual: null, custoUnit: null, estoqueFilial: null, diasDesdeUltimaVenda: null, primeiraEntradaFilial: null, diasHistoricoFilial: null, mesesHistoricoFilial: null, diasComEstoquePositivo: null, diasSemEstoque: null, mesesDisponiveis: null, velocidadeAjustada: null, historicoParcial: null };
          const suggested = calcQtdSugeridaParaFilial(
            filialCod,
            agg.item,
            metrics,
            metrics.estoqueFilial,
            companyKey,
            comprasTransitoIndex,
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
            diasComEstoquePositivo: metrics.diasComEstoquePositivo,
            diasSemEstoque: metrics.diasSemEstoque,
            mesesDisponiveis: metrics.mesesDisponiveis,
            velocidadeAjustada: metrics.velocidadeAjustada,
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
  }, [batchCodes, filialConsultaSelecionada, companyKey, mostrarNotificacao, comprasTransitoIndex]);

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
        diasComEstoquePositivo: vendas?.diasComEstoquePositivo ?? null,
        diasSemEstoque: vendas?.diasSemEstoque ?? null,
        mesesDisponiveis: vendas?.mesesDisponiveis ?? null,
        velocidadeAjustada: vendas?.velocidadeAjustada ?? null,
        ritmoDiasComEstoque: vendas?.ritmoDiasComEstoque ?? null,
        ritmoVendasPeriodo: vendas?.ritmoVendasPeriodo ?? null,
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
          descCor: resolveStrictColorDescription(produtoComCor.corProduto, produtoComCor.descCor),
          linha: produtoComCor.linha ?? atual.linha ?? null,
          subgrupo: produtoComCor.subgrupo ?? atual.subgrupo ?? null,
          ...novasMetricas,
        };

        if (mode === "add") {
          const novoItem: ListaItem = {
            ...novoItemBase,
            quantidade: calcQtdSugeridaParaFilial(
              filialCod,
              produtoComCor,
              vendas,
              estoque,
              companyKey,
              comprasTransitoIndex,
              new Date().getDate()
            ),
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
    [companyKey, filialConsultaSelecionada, mostrarNotificacao, editorColorPickerMode, modalColorPickerMode, comprasTransitoIndex]
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
      setItens(Array.isArray(lista.itens) ? lista.itens.map(normalizeListaItemColor) : []);
      const f = filiaisDisponiveis.find((f) => f.codFilial === lista.filial) ?? filiais.find((f) => f.codFilial === lista.filial);
      if (f) setFilialSelecionada(f);
      setMode("editor");
    },
    [filiais, filiaisDisponiveis]
  );

  const voltarParaLista = useCallback(() => {
    setMode("list");
  }, []);

  // ─── Entrada vinda da Curva ABC ("criar lista com este produto") ─────────────
  // Quando a URL traz ?addProduto=..., abre uma nova lista (visão geral) já com o
  // produto adicionado, como se o usuário tivesse criado a lista e incluído o item.
  useEffect(() => {
    if (seedAplicadoRef.current) return;
    if (!permissoesCarregadas) return;
    if (filiaisDisponiveis.length === 0) return;
    const seedProduto = (searchParams.get("addProduto") || "").trim();
    if (!seedProduto) return;

    seedAplicadoRef.current = true;

    const seedCor = (searchParams.get("addCor") || "").trim() || null;
    const seedNome = (searchParams.get("addNome") || "").trim() || seedProduto;
    const seedCorDesc = (searchParams.get("addCorDesc") || "").trim();
    // Escopo de filial herdado da Curva ABC (nome canônico, cod ou displayName). Casar aqui
    // garante que ritmo/Compra Ideal abram IGUAIS ao que estava na Curva ABC. Sem match
    // (ou sem addFilial) → TODAS (visão geral), que é filiaisDisponiveis[0].
    const seedFilial = (searchParams.get("addFilial") || "").trim();
    const alvoFilial = normalizeKey(seedFilial);
    const filialMatch = alvoFilial
      ? filiaisDisponiveis.find(
          (f) =>
            normalizeKey(f.codFilial) === alvoFilial ||
            normalizeKey(f.filial) === alvoFilial ||
            normalizeKey(f.displayName) === alvoFilial ||
            (f.aliases ?? []).some((a) => normalizeKey(a) === alvoFilial)
        )
      : null;

    const filialInicial = filialMatch ?? filiaisDisponiveis[0];
    setEditingId(undefined);
    setNomeLista("");
    setFilialSelecionada(filialInicial);
    setItens([]);
    setMode("editor");

    const filialCod =
      filialInicial.codFilial === TODAS_FILIAIS_VALUE ? null : filialInicial.codFilial?.trim() || null;

    void (async () => {
      let base = {
        produto: seedProduto,
        descProduto: seedNome,
        codigoBarra: null as string | null,
        corProduto: seedCor,
        descCor: resolveStrictColorDescription(seedCor, seedCorDesc),
        linha: null as string | null,
        subgrupo: null as string | null,
      };
      try {
        const encontrados = await searchProdutos(seedProduto, companyKey, seedCor ?? undefined);
        const match = seedCor
          ? encontrados.find((p) => (p.corProduto ?? "").trim() === seedCor.trim()) ?? encontrados[0]
          : encontrados.find((p) => p.produto.trim() === seedProduto) ?? encontrados[0];
        if (match) {
          base = {
            produto: match.produto,
            descProduto: match.descProduto || seedNome,
            codigoBarra: match.codigoBarra ?? null,
            corProduto: match.corProduto ?? seedCor,
            descCor: resolveStrictColorDescription(match.corProduto ?? seedCor, match.descCor || seedCorDesc),
            linha: match.linha ?? null,
            subgrupo: match.subgrupo ?? null,
          };
        }
      } catch {
        // sem match na base: segue com o item mínimo dos parâmetros
      }
      try {
        const item = await buildListaItemComMetricas(companyKey, filialCod, base, comprasTransitoIndex);
        setItens([item]);
      } catch {
        setItens([{ ...base, quantidade: 1 }]);
      }
    })();
  }, [permissoesCarregadas, filiaisDisponiveis, searchParams, companyKey, comprasTransitoIndex]);

  // ─── Save ───────────────────────────────────────────────────────────────────

  const enviarParaComprasSalvas = useCallback(async (customTitle?: string, stayInEditor: boolean = false) => {
    const diasCorridosMesLocal = new Date().getDate();
    const itensBase = itens.filter((item) => {
      if (filtrarCurvas.size > 0) {
        const curva = curvaMapEditor.get(buildItemKey(item.produto, item.corProduto))?.curva ?? null;
        if (!curva || !filtrarCurvas.has(curva)) return false;
      }
      if (filtrarComprarAgora && !itemTemCompraAgora(item, companyKey, comprasTransitoIndex)) return false;
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
    const titleBase = nomeLista.trim() || buildDefaultListName(filialLabel(filialSelecionada) || "Lista Loja");
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
  }, [companyKey, comprasTransitoIndex, curvaMapEditor, editingId, filtrarBarrados, filtrarComprarAgora, filtrarCurvas, filtrarSugeridos, filtrarTransferencias, filialSelecionada, itens, mostrarNotificacao, nomeLista, transferenciasPorItem, user?.username]);

  const salvar = useCallback(async () => {
    if (!user?.username) return;
    const diasCorridosMesLocal = new Date().getDate();
    const itensBase = itens.filter((item) => {
      if (filtrarCurvas.size > 0) {
        const curva = curvaMapEditor.get(buildItemKey(item.produto, item.corProduto))?.curva ?? null;
        if (!curva || !filtrarCurvas.has(curva)) return false;
      }
      if (filtrarComprarAgora && !itemTemCompraAgora(item, companyKey, comprasTransitoIndex)) return false;
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
      const nomeBase = nomeLista.trim() || buildDefaultListName(filialLabel(filialSelecionada) || "Lista");
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
  }, [companyKey, comprasTransitoIndex, curvaMapEditor, editingId, filtrarBarrados, filtrarComprarAgora, filtrarCurvas, filtrarSugeridos, filtrarTransferencias, filialSelecionada?.filial, filialSelecionada?.displayName, itens, mostrarNotificacao, nomeLista, transferenciasPorItem, user?.username, enviarParaComprasSalvas]);

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
  const filtrosAtivos = filtrarSugeridos || filtrarComprarAgora || filtrarBarrados || filtrarTransferencias || filtrarCurvas.size > 0;
  const itensVisiveis = useMemo(() => {
    return itens.filter((item) => {
      if (filtrarCurvas.size > 0) {
        const curva = curvaMapEditor.get(buildItemKey(item.produto, item.corProduto))?.curva ?? null;
        if (!curva || !filtrarCurvas.has(curva)) return false;
      }
      if (filtrarComprarAgora && !itemTemCompraAgora(item, companyKey, comprasTransitoIndex)) return false;
      if (!filtrarSugeridos && !filtrarBarrados && !filtrarTransferencias) return true;
      if (filtrarTransferencias) return itemTemTransferenciaSugerida(item, diasCorridosMes, transferenciasPorItem);
      const sugerido = itemTemSugestaoCompra(item, diasCorridosMes);
      const barrado = itemEhBarrado(item, diasCorridosMes);
      if (filtrarSugeridos && filtrarBarrados) return sugerido || barrado;
      if (filtrarSugeridos) return sugerido;
      if (filtrarBarrados) return barrado;
      return true;
    });
  }, [companyKey, comprasTransitoIndex, curvaMapEditor, diasCorridosMes, filtrarBarrados, filtrarComprarAgora, filtrarCurvas, filtrarSugeridos, filtrarTransferencias, itens, transferenciasPorItem]);
  const indicesItensVisiveis = useMemo(
    () =>
      itens
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => {
          if (filtrarCurvas.size > 0) {
            const curva = curvaMapEditor.get(buildItemKey(item.produto, item.corProduto))?.curva ?? null;
            if (!curva || !filtrarCurvas.has(curva)) return false;
          }
          if (filtrarComprarAgora && !itemTemCompraAgora(item, companyKey, comprasTransitoIndex)) return false;
          if (!filtrarSugeridos && !filtrarBarrados && !filtrarTransferencias) return true;
          if (filtrarTransferencias) return itemTemTransferenciaSugerida(item, diasCorridosMes, transferenciasPorItem);
          const sugerido = itemTemSugestaoCompra(item, diasCorridosMes);
          const barrado = itemEhBarrado(item, diasCorridosMes);
          if (filtrarSugeridos && filtrarBarrados) return sugerido || barrado;
          if (filtrarSugeridos) return sugerido;
          if (filtrarBarrados) return barrado;
          return true;
        })
        .map(({ index }) => index),
    [companyKey, comprasTransitoIndex, curvaMapEditor, diasCorridosMes, filtrarBarrados, filtrarComprarAgora, filtrarCurvas, filtrarSugeridos, filtrarTransferencias, itens, transferenciasPorItem]
  );
  const kpisLista = useMemo(() => {
    // Usa a quantidade real de cada item (= a qtd ao lado do +/-, já alinhada à
    // Compra Ideal da loja) — a MESMA base do CUSTO_TOTAL do export, pra os totais baterem.
    let totalQtdSugerida = 0;
    let totalCustoReferencia = 0;
    for (const item of itensVisiveis) {
      const qtd = Math.max(0, Math.round(item.quantidade ?? 0));
      if (qtd <= 0) continue;
      totalQtdSugerida += qtd;
      const custoUnit = Number(item.custoUnit ?? 0);
      if (custoUnit > 0) totalCustoReferencia += qtd * custoUnit;
    }
    return {
      totalItens: itensVisiveis.length,
      totalQtdSugerida,
      totalCustoReferencia,
    };
  }, [itensVisiveis]);
  const abcMapRede = useMemo(() => new Map<string, CurvaInfo>(), []);
  const abcMapModal = useMemo(() => new Map<string, CurvaInfo>(), []);

  // ─── Render: loading ────────────────────────────────────────────────────────

  const filtroAplicadoLabel = filtrarTransferencias
    ? "Transferências"
    : filtrarComprarAgora
    ? "Comprar agora"
    : filtrarSugeridos && filtrarBarrados
      ? "Sugeridos e barrados"
      : filtrarSugeridos
        ? "Sugeridos"
        : filtrarBarrados
          ? "Barrados"
          : filtrarCurvas.size > 0
            ? `Curva ${[...filtrarCurvas].sort().join("+")}`
            : "Todos";

  const exportarListaXlsx = useCallback(async () => {
    if (itensVisiveis.length === 0) {
      mostrarNotificacao("Adicione itens para exportar", "error");
      return;
    }

    setExportandoXlsx(true);
    try {
      const filialParaExport = filialSelecionada?.codFilial === TODAS_FILIAIS_VALUE
        ? null
        : (filialSelecionada?.codFilial?.trim() || null);
      const rows = await buildListaLojaExportRows(
        companyKey,
        filialParaExport,
        itensVisiveis,
        comprasTransitoIndex,
        transferenciasPorItem
      );
      exportListaLojaToXlsx({
        companyKey,
        companyName,
        listaNome: nomeLista.trim() || buildDefaultListName(filialLabel(filialSelecionada) || "Lista Loja"),
        filialNome: filialLabel(filialSelecionada) || null,
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
    comprasTransitoIndex,
    filtroAplicadoLabel,
    filialSelecionada?.codFilial,
    filialSelecionada?.filial,
    filialSelecionada?.displayName,
    itensVisiveis,
    transferenciasPorItem,
    mostrarNotificacao,
    nomeLista,
  ]);

  const exportarCompraIdealPorFilial = useCallback(async () => {
    if (itensVisiveis.length === 0) {
      mostrarNotificacao("Adicione itens para exportar", "error");
      return;
    }
    if (filiais.length === 0) {
      mostrarNotificacao("Nenhuma loja disponível para o cálculo", "error");
      return;
    }

    setCompraIdealProgresso({ feito: 0, total: filiais.length });
    try {
      const { rows, colunasFiliais } = await buildCompraIdealPorFilialRows(
        companyKey,
        filiais,
        itensVisiveis,
        comprasTransitoIndex,
        () => setCompraIdealProgresso((prev) => (prev ? { ...prev, feito: prev.feito + 1 } : prev))
      );
      exportCompraIdealPorFilialToXlsx({
        companyKey,
        companyName,
        listaNome: nomeLista.trim() || buildDefaultListName(filialLabel(filialSelecionada) || "Lista Loja"),
        filtroAplicado: filtroAplicadoLabel,
        colunasFiliais,
        rows,
      });
      mostrarNotificacao("Compra ideal por loja exportada com sucesso!");
    } catch (err: unknown) {
      mostrarNotificacao(err instanceof Error ? err.message : "Erro ao exportar compra ideal por loja", "error");
    } finally {
      setCompraIdealProgresso(null);
    }
  }, [
    companyKey,
    companyName,
    comprasTransitoIndex,
    filiais,
    filtroAplicadoLabel,
    filialSelecionada,
    itensVisiveis,
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
              className={styles.exportXlsxBtn}
              onClick={() => {
                void exportarCompraIdealPorFilial();
              }}
              disabled={itensVisiveis.length === 0 || compraIdealProgresso !== null}
              title={
                itensVisiveis.length === 0
                  ? "Adicione itens para exportar"
                  : "Exportar a compra ideal de cada loja (uma coluna por loja) para XLSX"
              }
            >
              {compraIdealProgresso
                ? `Gerando… ${compraIdealProgresso.feito}/${compraIdealProgresso.total} lojas`
                : "Exportar Compra Ideal por Loja"}
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
              placeholder={buildDefaultListName(filialLabel(filialSelecionada) || "Lista")}
            />
          </div>
          <div className={styles.formGroup}>
            <label className={styles.label}>
              Loja
              {recalculandoMetricas && (
                <span className={styles.recalcBadge}>
                  <span className={styles.recalcSpinner} aria-hidden="true" />
                  Atualizando valores da loja…
                </span>
              )}
            </label>
            {filiaisDisponiveis.length === 1 && filialSelecionada ? (
              <div className={styles.filialFixed}>{filialLabel(filialSelecionada)}</div>
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
                  <option key={f.codFilial} value={f.codFilial}>{filialLabel(f)}</option>
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
            <label className={styles.filtroToggle} title="Os que precisam comprar agora (data chegou) ou essa semana (NERD: até a próxima segunda)">
              <input
                type="checkbox"
                checked={filtrarComprarAgora}
                onChange={(e) => setFiltrarComprarAgora(e.target.checked)}
              />
              <span>Comprar agora</span>
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
            {(["A", "B", "C"] as const).map((curva) => (
              <label key={curva} className={styles.filtroToggle}>
                <input
                  type="checkbox"
                  checked={filtrarCurvas.has(curva)}
                  onChange={(e) => {
                    setFiltrarCurvas((prev) => {
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
            {filtrosAtivos && (
              <button
                type="button"
                className={styles.filtroClearBtn}
                onClick={() => {
                  setFiltrarSugeridos(false);
                  setFiltrarComprarAgora(false);
                  setFiltrarBarrados(false);
                  setFiltrarTransferencias(false);
                  setFiltrarCurvas(new Set());
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
              {recalculandoMetricas && (
                <div className={styles.recalcOverlay} role="status" aria-live="polite">
                  <span className={styles.recalcOverlaySpinner} aria-hidden="true" />
                  <span>Atualizando valores da loja…</span>
                </div>
              )}
              <div className={recalculandoMetricas ? styles.produtosListUpdating : undefined}>
              <ListaLojaItensTable
                companyKey={companyKey}
                filialCod={filialConsultaSelecionada}
                filialNome={filialConsultaSelecionada ? (filialLabel(filialSelecionada) || null) : null}
                itens={itensVisiveis}
                compraView={true}
                abcMap={abcMapRede}
                comprasTransitoIndex={comprasTransitoIndex}
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
                    ref={searchInputRef}
                    type="text"
                    className={styles.searchInput}
                    placeholder="Buscar por nome, código ou código de barras..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    autoFocus
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      className={styles.searchClearBtn}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSearchTerm("");
                        setProdutos([]);
                        setColorPickerProduto(null);
                        setColorPickerOpcoes([]);
                        searchInputRef.current?.focus();
                      }}
                      title="Limpar"
                      aria-label="Limpar busca"
                    >
                      ×
                    </button>
                  )}
                </div>

                {companyKey === "scarfme" && (
                  <div className={styles.colecImportBox}>
                    <div className={styles.sectionLabel}>Importar por coleção ou grade</div>
                    <div className={styles.colecImportRow}>
                      <div className={styles.importacaoInputWrap}>
                        <div className={styles.groupBox}>
                          <span className={styles.groupIcon} aria-hidden="true">🏷️</span>
                          <input
                            ref={importacaoInputRef}
                            type="text"
                            className={styles.groupInput}
                            value={importacaoQuery}
                            onChange={(e) => {
                              setImportacaoQuery(e.target.value);
                              setImportacaoSelecionada(null);
                              setImportacaoDropdownAberto(true);
                            }}
                            onFocus={() => setImportacaoDropdownAberto(true)}
                            onBlur={() => {
                              // permitir clique na sugestão
                              setTimeout(() => setImportacaoDropdownAberto(false), 120);
                            }}
                            placeholder={
                              loadingColecoesOpcoes || loadingGradesOpcoes
                                ? "Carregando opções..."
                                : "Digite uma coleção ou grade..."
                            }
                            disabled={
                              loadingColecoesOpcoes ||
                              loadingGradesOpcoes ||
                              importandoColecao ||
                              importandoGrade ||
                              importandoBatch
                            }
                          />
                        {importacaoQuery && (
                          <button
                            type="button"
                            className={styles.groupClearBtn}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setImportacaoQuery("");
                              setImportacaoSelecionada(null);
                              setImportacaoDropdownAberto(true);
                              importacaoInputRef.current?.focus();
                            }}
                            title="Limpar"
                            aria-label="Limpar"
                          >
                            ×
                          </button>
                        )}
                        </div>
                      </div>
                      {importacaoDropdownAberto &&
                        !(
                          loadingColecoesOpcoes ||
                          loadingGradesOpcoes ||
                          importandoColecao ||
                          importandoGrade ||
                          importandoBatch
                        ) && (
                          <div className={styles.importSuggestList}>
                            {opcoesImportacaoFiltradas.length === 0 ? (
                              <div className={styles.importSuggestEmpty}>Nenhuma opção encontrada</div>
                            ) : (
                              opcoesImportacaoFiltradas.map((opt) => (
                                <button
                                  key={opt.key}
                                  type="button"
                                  className={styles.importSuggestItem}
                                  onMouseDown={(e) => e.preventDefault()}
                                  onClick={() => selecionarOpcaoImportacao(opt)}
                                >
                                  {opt.label}
                                </button>
                              ))
                            )}
                          </div>
                        )}
                      <button
                        type="button"
                        className={styles.batchBtn}
                        onClick={() => void importarSelecionado()}
                        disabled={
                          importandoColecao ||
                          importandoGrade ||
                          importandoBatch ||
                          !importacaoSelecionada
                        }
                      >
                        {importandoColecao || importandoGrade ? "Importando..." : "Importar"}
                      </button>
                    </div>
                  </div>
                )}

                <div className={styles.batchBox}>
                  <div className={styles.sectionLabel}>Importação em lote</div>
                  <div className={styles.groupBox} style={{ alignItems: "flex-start", paddingTop: 10, paddingBottom: 10 }}>
                    <span className={styles.groupIcon} aria-hidden="true" style={{ marginTop: 2 }}>🧾</span>
                    <textarea
                      className={styles.groupTextarea}
                      placeholder="Cole um código por linha"
                      value={batchCodes}
                      onChange={(e) => setBatchCodes(e.target.value)}
                      rows={3}
                    />
                    {batchCodes.trim().length > 0 && (
                      <button
                        type="button"
                        className={styles.groupClearBtn}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setBatchCodes("")}
                        title="Limpar"
                        aria-label="Limpar lote"
                        style={{ marginTop: 2 }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.batchBtn}
                    onClick={importarBatchProdutos}
                    disabled={importandoBatch || importandoColecao || importandoGrade}
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
                                {formatColorInlineDetail(produto.descCor, produto.corProduto)}
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
                                        {formatColorDisplay(opcao.descCor, opcao.corProduto)}
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
                      {itensModal.map((item, idx) => (
                        <div
                          key={`${item.produto}-${item.corProduto ?? ""}-${idx}`}
                          className={styles.produtoItem}
                        >
                          <div className={styles.produtoInfo}>
                            <div className={styles.produtoName}>{item.descProduto}</div>
                            <div className={styles.produtoSku}>
                              {item.produto}
                              {formatColorInlineDetail(item.descCor, item.corProduto)}
                              {item.codigoBarra ? ` · ${item.codigoBarra}` : ""}
                            </div>
                          </div>
                          <div className={styles.produtoControls}>
                            <div className={styles.qtyControl}>
                              <button
                                type="button"
                                className={styles.qtyBtn}
                                onClick={() => atualizarQuantidadeModal(idx, (item.quantidade ?? 0) - 1)}
                                disabled={(item.quantidade ?? 0) <= 0}
                              >
                                −
                              </button>
                              <input
                                type="number"
                                className={styles.qtyInput}
                                value={item.quantidade ?? 0}
                                min={0}
                                onChange={(e) => {
                                  const v = Number.parseInt(e.target.value || "0", 10);
                                  atualizarQuantidadeModal(idx, Number.isFinite(v) ? v : 0);
                                }}
                              />
                              <button
                                type="button"
                                className={styles.qtyBtn}
                                onClick={() => atualizarQuantidadeModal(idx, (item.quantidade ?? 0) + 1)}
                              >
                                +
                              </button>
                            </div>
                            <button
                              type="button"
                              className={styles.removeBtn}
                              onClick={() => removerItemModal(idx)}
                              title="Remover"
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                      ))}
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
            <Link href={`/${companySlug}/compras-transito`} className={styles.backBtn}>
              Compras em Trânsito
            </Link>
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
          <Link href={`/${companySlug}/compras-transito`} className={styles.backBtn}>
            Compras em Trânsito
          </Link>
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

"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import {
  aggregateVendasPorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  getFilialLabelForDisplay,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";
import type { CompraSalva, CompraSalvaItemRow } from "@/lib/types/compra-salva";
import {
  partesDestinoCompraFinal,
  textoDestinoCompraFinal,
  type DestinoCompraFinalParte,
} from "@/lib/utils/compra-final-destino";
import {
  calcNecessidadeMinimaQty,
  calcTotalPerFilialQty,
  combineBaseSuggestionWithNecessidadeMinima,
} from "@/lib/utils/necessidade-minima";
import {
  calcQtdSugestaoPOInfo,
  getLimiteDiasReposicao as getSharedLimiteDiasReposicao,
  getReposicaoBaseType as getSharedReposicaoBaseType,
  getReposicaoCompraView as getSharedReposicaoCompraView,
  getSuggestedQtyValue as getSharedSuggestedQtyValue,
  type SuggestionPOData,
  type SuggestionRuleInput,
} from "@/lib/utils/suggestion-rules";
import { getMappedColorDescription } from "@/lib/utils/colorMapping";
import { fetchControleEstoqueItemMetricasClient } from "@/lib/client/controle-estoque-metricas";
import { buildControleEstoqueItemKey } from "@/lib/utils/controle-estoque-metricas";
import {
  buildCompraTransitoIndex,
  fetchComprasTransitoClient,
  getCompraTransitoEntries,
  type CompraTransitoIndex,
} from "@/lib/client/compras-transito";
import { applyTransitToSuggestion } from "@/lib/utils/compra-transito-analytics";
import { calcCompraIdealFromResumo, type CompraIdealResult } from "@/lib/utils/compra-ideal";
import CompraIdealCell from "@/components/shared/CompraIdealCell";
import { useCatracaDataCompra, type CatracaFreeze } from "@/lib/client/use-catraca-data-compra";

import styles from "./ListaCompraSugeridaPage.module.css";

interface ProdutoSugestao {
  produto: string;
  codigoBarra?: string;
  cor?: string;
  corDescricao?: string;
  descricao: string;
  linha?: string;
  subgrupo?: string;
  grade?: string;
  colecao?: string;
  vendas3meses?: number;
  vendasMesAtual?: number;
  custoUnitario?: number;
  estoqueAtual?: number;
  qtdSugerida?: number;
}

interface ProdutoBuscaManual {
  produto: string;
  descProduto: string;
  codigoBarra: string | null;
  corProduto: string | null;
  descCor: string;
  grade?: string | null;
  linha?: string | null;
  subgrupo?: string | null;
  colecao?: string | null;
}

type BarcodeLookupRow = {
  produto: string;
  corProduto: string | null;
};

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRL2(n: number) {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

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

function sumDistribuicaoManual(distribuicao?: Record<string, number>): number {
  return Object.values(distribuicao ?? {}).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
}

function resumirAjusteEntreDestinos(
  atual: DestinoCompraFinalParte[] | null,
  sugerido: DestinoCompraFinalParte[] | null
): string {
  if (!atual || !sugerido) return "Sem distribuição por filial para comparar.";
  const mapaAtual = new Map(atual.map((p) => [p.label, p.qtd]));
  const mapaSug = new Map(sugerido.map((p) => [p.label, p.qtd]));
  const labels = new Set([...mapaAtual.keys(), ...mapaSug.keys()]);
  const sobe: string[] = [];
  const desce: string[] = [];

  labels.forEach((label) => {
    const diff = (mapaSug.get(label) ?? 0) - (mapaAtual.get(label) ?? 0);
    if (diff > 0) sobe.push(`${label} +${diff}`);
    if (diff < 0) desce.push(`${label} ${diff}`);
  });

  if (sobe.length === 0 && desce.length === 0) {
    return "Distribuição por filial sem mudança.";
  }
  const partes: string[] = [];
  if (sobe.length > 0) partes.push(`Colocar: ${sobe.join(", ")}`);
  if (desce.length > 0) partes.push(`Tirar: ${desce.join(", ")}`);
  return partes.join(" | ");
}

function normalizeVendasPorFilialParaExibicao(
  companyKey: CompanyKey,
  rows: Array<{ filial: string; qtde12m: number; qtde60d: number }>
): Array<{ filial: string; qtde12m: number; qtde60d: number }> {
  const cfg = resolveCompany(companyKey);
  const merged = aggregateVendasPorFilialByDisplayLabel(rows, cfg);
  return [...merged].sort((a, b) => compareFilialDisplayOrder(a.filial, b.filial, cfg));
}

function normalizeKey(s?: string | null) {
  return (s ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

// Extrai o codFilial do sourceContextKey no formato "lista-loja:{company}:{filial}:{id}"
function parseListaLojaFilial(sourceContextKey: string): string | null {
  if (!sourceContextKey.startsWith("lista-loja:")) return null;
  const parts = sourceContextKey.split(":");
  const filialCtx = parts[2] ?? "";
  if (!filialCtx || filialCtx === "__TODAS__" || filialCtx === "sem-filial") return null;
  return filialCtx;
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

function isSomenteDigitosCodigoBarras(term: string): boolean {
  const t = term.trim();
  return t.length >= 4 && /^\d+$/.test(t);
}

async function searchProdutos(
  term: string,
  companyKey?: string,
  corProduto?: string | null
): Promise<ProdutoBuscaManual[]> {
  if (!term || term.trim().length < 2) return [];
  const params = new URLSearchParams({ q: term.trim(), entrada: "true" });
  if (companyKey) params.set("company", companyKey);
  if (corProduto !== undefined && corProduto !== null) {
    params.set("corProduto", String(corProduto).trim());
  }
  const res = await fetch(`/api/transferencia-produtos/produtos?${params}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: ProdutoBuscaManual[] };
  return json.data || [];
}

async function produtoFromBarcodeLookup(
  porBarra: BarcodeLookupRow,
  companyKey?: string
): Promise<ProdutoBuscaManual | null> {
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

function resolveCompraSalvaFilialOrigem(
  items: CompraSalvaItemRow[],
  sourceContextKey: string
): string | null | undefined {
  const primeiroComOrigem = items.find((item) => item.filialOrigem !== undefined);
  if (primeiroComOrigem) {
    return primeiroComOrigem.filialOrigem;
  }
  return parseListaLojaFilial(sourceContextKey);
}

function mergeLocalCompraSalvaItems(
  currentItems: CompraSalvaItemRow[],
  item: CompraSalvaItemRow
): CompraSalvaItemRow[] {
  const idx = currentItems.findIndex((current) => current.itemKey === item.itemKey);
  if (idx < 0) {
    return [...currentItems, item];
  }

  const current = currentItems[idx];
  const next = [...currentItems];
  next[idx] = {
    ...current,
    ...item,
    qtdManual: Math.max(0, Math.round(current.qtdManual ?? 0)) + Math.max(0, Math.round(item.qtdManual ?? 0)),
  };
  return next;
}


function buildSuggestionRuleInput(
  match: ProdutoSugestao,
  liveData: {
    qtde12m: number | null;
    vendasMesAtual: number | null;
    estoqueAtual: number | null;
    diasDesdeUltimaVenda: number | null;
    mesesHistoricoFilial: number | null;
    diasComEstoquePositivo: number | null;
    diasSemEstoque: number | null;
    mesesDisponiveis: number | null;
    velocidadeAjustada: number | null;
  }
): SuggestionRuleInput {
  return {
    qtde12m: liveData.qtde12m,
    vendasMesAtual: liveData.vendasMesAtual,
    estoqueAtual: liveData.estoqueAtual,
    diasDesdeUltimaVenda: liveData.diasDesdeUltimaVenda,
    mesesHistoricoFilial: liveData.mesesHistoricoFilial,
    diasComEstoquePositivo: liveData.diasComEstoquePositivo,
    diasSemEstoque: liveData.diasSemEstoque,
    mesesDisponiveis: liveData.mesesDisponiveis,
    velocidadeAjustada: liveData.velocidadeAjustada,
    linha: match?.linha,
    subgrupo: match?.subgrupo,
  };
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
// Replica a lógica completa de getReposicaoCompraView da Lista Loja (regras Compra, S e E).
// Só calcula quando liveData estiver carregado — nunca usa match para vendas/estoque
// pois lista-compra-sugerida usa query diferente (sem e-commerce para isProdutoLookup).
function calcularSugestaoCompleto(
  match: ProdutoSugestao | null | undefined,
  liveData: {
    qtde12m: number | null;
    vendasMesAtual: number | null;
    estoqueAtual: number | null;
    diasDesdeUltimaVenda: number | null;
    mesesHistoricoFilial: number | null;
    diasComEstoquePositivo: number | null;
    diasSemEstoque: number | null;
    mesesDisponiveis: number | null;
    velocidadeAjustada: number | null;
  } | undefined
): number | null {
  if (!match) return null;
  if (liveData === undefined) return null;
  const sugestao = getSharedReposicaoCompraView(buildSuggestionRuleInput(match, liveData), new Date().getDate());
  const qty = getSharedSuggestedQtyValue(sugestao);
  return qty > 0 ? qty : null;
}

function calcularSugestaoCompletoComTransito(
  match: ProdutoSugestao | null | undefined,
  liveData: {
    qtde12m: number | null;
    vendasMesAtual: number | null;
    estoqueAtual: number | null;
    diasDesdeUltimaVenda: number | null;
    mesesHistoricoFilial: number | null;
    diasComEstoquePositivo: number | null;
    diasSemEstoque: number | null;
    mesesDisponiveis: number | null;
    velocidadeAjustada: number | null;
    qtde60d?: number | null;
    ritmoDiasComEstoque?: number | null;
    ritmoVendasPeriodo?: number | null;
    ritmoInicioIso?: string | null;
    ritmoFimIso?: string | null;
    ritmoDiasComVenda?: number | null;
    ritmoPrimeiraVendaIso?: string | null;
    ritmoUltimaVendaIso?: string | null;
    totalNmQty: number | null;
  } | undefined,
  comprasTransitoIndex: CompraTransitoIndex,
  company?: string | null
): {
  qty: number | null;
  ideal: CompraIdealResult | null;
  transitTotal: number;
  transitDates: string[];
} {
  if (!match || liveData === undefined) {
    return { qty: null, ideal: null, transitTotal: 0, transitDates: [] };
  }

  // Regra global: a quantidade de referência é a Compra Ideal (lead time + cobertura).
  const transitEntries = getCompraTransitoEntries(comprasTransitoIndex, match?.produto ?? "", match?.cor ?? null);
  const ideal = calcCompraIdealFromResumo(
    {
      estoqueTotal: liveData.estoqueAtual ?? 0,
      qtde60d: liveData.qtde60d ?? null,
      ritmoDiasComEstoque: liveData.ritmoDiasComEstoque ?? null,
      ritmoVendasPeriodo: liveData.ritmoVendasPeriodo ?? null,
      ritmoInicioIso: liveData.ritmoInicioIso ?? null,
      ritmoFimIso: liveData.ritmoFimIso ?? null,
      ritmoDiasComVenda: liveData.ritmoDiasComVenda ?? null,
      ritmoPrimeiraVendaIso: liveData.ritmoPrimeiraVendaIso ?? null,
      ritmoUltimaVendaIso: liveData.ritmoUltimaVendaIso ?? null,
    },
    transitEntries,
    { linha: match.linha, subgrupo: match.subgrupo, company }
  );

  return {
    qty: ideal.compraIdeal > 0 ? ideal.compraIdeal : null,
    ideal,
    transitTotal: ideal.emTransito,
    transitDates: transitEntries.map(
      (entry) => `${new Date(`${entry.dataRecebimento}T00:00:00`).toLocaleDateString("pt-BR")} (+${fmt(entry.quantidade)})`
    ),
  };
}

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

function getFilialOptions(companyKey: CompanyKey): string[] {
  const cfg = resolveCompany(companyKey);
  if (!cfg) return [];

  const labels = new Map<string, string>();
  const addLabel = (raw: string) => {
    const label = getFilialLabelForDisplay(cfg, raw);
    const key = normalizeKey(label);
    if (!key || labels.has(key)) return;
    labels.set(key, label);
  };

  (cfg.estoqueFilialOrder ?? []).forEach(addLabel);
  (cfg.filialFilters.inventory ?? []).forEach(addLabel);
  (cfg.filialFilters.sales ?? []).forEach(addLabel);

  return [...labels.values()].sort((a, b) => compareFilialDisplayOrder(a, b, cfg));
}

function ManualDestinoEditor({
  distribuicao,
  allFiliais,
  onDelta,
  onSet,
  onAddFilial,
}: {
  distribuicao: Record<string, number>;
  allFiliais: string[];
  onDelta: (filial: string, delta: number) => void;
  onSet: (filial: string, value: number) => void;
  onAddFilial: (filial: string) => void;
}) {
  const [novaFilial, setNovaFilial] = useState("");
  const datalistId = useId();
  const filiaisPresentes = Object.keys(distribuicao);
  const filiaisPresentesNormalizadas = new Set(filiaisPresentes.map((f) => normalizeKey(f)));
  const filiaisParaAdicionar = allFiliais.filter((f) => !filiaisPresentesNormalizadas.has(normalizeKey(f)));

  const handleAddFilial = () => {
    const filialDigitada = novaFilial.trim();
    if (!filialDigitada) return;
    const filialExistente = filiaisPresentes.find((f) => normalizeKey(f) === normalizeKey(filialDigitada));
    onAddFilial(filialExistente ?? filialDigitada);
    setNovaFilial("");
  };

  return (
    <div className={styles.manualDestinoEditor}>
      {filiaisPresentes.map((filial) => {
        const qty = distribuicao[filial] ?? 0;
        const t = destinoBadgeThemeForFilial(filial);
        return (
          <div key={filial} className={styles.manualFilialRow}>
            <span
              className={styles.manualFilialBadge}
              style={{ background: t.bg, color: t.fg, borderColor: t.border }}
            >
              {filial}
            </span>
            <button type="button" className={styles.manualQtyBtn} onClick={() => onDelta(filial, -1)}>−</button>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              className={styles.manualQtyVal}
              value={qty}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                onSet(filial, Number.isNaN(v) ? 0 : v);
              }}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button type="button" className={styles.manualQtyBtn} onClick={() => onDelta(filial, +1)}>+</button>
          </div>
        );
      })}
      <div className={styles.manualAddFilialRow}>
        <input
          className={styles.manualAddFilialInput}
          type="text"
          list={datalistId}
          value={novaFilial}
          placeholder="+ Adicionar filial"
          onChange={(e) => setNovaFilial(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              handleAddFilial();
            }
          }}
        />
        <datalist id={datalistId}>
          {filiaisParaAdicionar.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button
          type="button"
          className={styles.manualAddFilialBtn}
          onClick={handleAddFilial}
          disabled={!novaFilial.trim()}
        >
          Adicionar
        </button>
      </div>
    </div>
  );
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

async function fetchListaCompra(params: URLSearchParams): Promise<ProdutoSugestao[]> {
  const res = await fetch(`/api/controle-estoque/lista-compra-sugerida?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: ProdutoSugestao[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar");
  return json.data ?? [];
}

async function fetchItemMetricas(params: URLSearchParams) {
  return fetchControleEstoqueItemMetricasClient({
    company: params.get("company") ?? undefined,
    filial: params.get("filial") || null,
    includeHistorico: params.get("includeHistorico") === "true",
    item: {
      produto: params.get("produto") || "",
      corProduto: params.get("corProduto"),
    },
  });
}

async function fetchEstoquePorFilial(params: URLSearchParams): Promise<Array<{ filial: string; estoque: number }>> {
  const metricas = await fetchItemMetricas(params);
  return metricas?.estoquePorFilial ?? [];
}

async function fetchVendasPorFilialItem(
  params: URLSearchParams
): Promise<Array<{ filial: string; qtde12m: number; qtde60d: number }>> {
  const metricas = await fetchItemMetricas(params);
  return (metricas?.vendasPorFilial ?? []).map((row) => ({
    filial: row.filial,
    qtde12m: Number(row.qtde12m ?? 0),
    qtde60d: Number(row.qtde60d ?? 0),
  }));
}

async function fetchVendasItemMetricas(params: URLSearchParams): Promise<{
  qtde12m: number;
  qtde60d: number;
  vendasMesAtual: number;
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
  totalNmQty: number;
} | null> {
  const metricas = await fetchItemMetricas(params);
  if (!metricas) return null;
  return {
    qtde12m: metricas.resumo.qtde12m,
    qtde60d: metricas.resumo.qtde60d,
    vendasMesAtual: metricas.resumo.vendasMesAtual,
    diasDesdeUltimaVenda: metricas.resumo.diasDesdeUltimaVenda,
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
    totalNmQty: calcTotalPerFilialQty({
      company: resolveCompany(params.get("company") ?? undefined),
      vendasPorFilial: metricas.vendasPorFilial,
      estoquePorFilial: metricas.estoquePorFilial,
      limiteDias: getSharedLimiteDiasReposicao({
        linha: params.get("linha") ?? undefined,
        subgrupo: params.get("subgrupo") ?? undefined,
      }),
    }),
  };
}

async function fetchEstoqueFilialSum(params: URLSearchParams): Promise<number | null> {
  const metricas = await fetchItemMetricas(params);
  return metricas?.resumo.estoqueTotal ?? null;
  const legacyRes = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
  const legacyJson = await legacyRes.json() as { data?: Array<{ estoque: number }>; error?: string };
  if (!legacyRes.ok) return null;
  const rows = legacyJson.data ?? [];
  return Math.round(rows.reduce((s, r) => s + Math.max(0, Number(r.estoque ?? 0)), 0));
}

export default function CompraSalvaDetalhePage({
  companyKey,
  companySlug,
  compraId,
}: {
  companyKey: CompanyKey;
  companySlug: string;
  compraId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fromListaLoja = searchParams.get("from") === "lista-loja";
  const fromOperacoes =
    searchParams.get("from") === "operacoes" ||
    (!!pathname && pathname.includes(`/${companySlug}/compras-salvas/`));
  const listBack = fromListaLoja
    ? `/${companySlug}/lista-loja?view=compras-salvas`
    : fromOperacoes
      ? `/${companySlug}/compras-salvas`
    : `/${companySlug}/controle-estoque/projecao/lista-compra?tab=compras-salvas`;
  const [doc, setDoc] = useState<CompraSalva | null>(null);
  const [items, setItems] = useState<CompraSalvaItemRow[]>([]);
  const [titleEdit, setTitleEdit] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listaRows, setListaRows] = useState<ProdutoSugestao[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<Record<string, {
    qtde12m: number | null;
    vendasMesAtual: number | null;
    estoqueAtual: number | null;
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
  }>>({});
  const [comprasTransitoIndex, setComprasTransitoIndex] = useState<CompraTransitoIndex>(new Map());
  // Catraca da data de compra (modo ciclo) — filial do contexto da compra salva.
  const catracaFilial = doc?.sourceContextKey ? (parseListaLojaFilial(doc.sourceContextKey) ?? "") : "";
  const catraca = useCatracaDataCompra(companyKey, catracaFilial);
  const [estoquePorFilialCache, setEstoquePorFilialCache] = useState<
    Record<string, Array<{ filial: string; estoque: number }>>
  >({});
  const [vendasPorFilialCache, setVendasPorFilialCache] = useState<
    Record<string, Array<{ filial: string; qtde12m: number; qtde60d: number }>>
  >({});
  const vendasPorFilialCacheRef = useRef(vendasPorFilialCache);
  vendasPorFilialCacheRef.current = vendasPorFilialCache;
  const destinoVendasFetchRef = useRef(new Set<string>());
  const [listaRowsRefreshKey, setListaRowsRefreshKey] = useState(0);
  const [vendasRefreshKey, setVendasRefreshKey] = useState(0);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingTransitDraft, setExportingTransitDraft] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [manualSearchTerm, setManualSearchTerm] = useState("");
  const [manualSearchResults, setManualSearchResults] = useState<ProdutoBuscaManual[]>([]);
  const [manualSearchLoading, setManualSearchLoading] = useState(false);
  const [manualSearchError, setManualSearchError] = useState<string | null>(null);
  const [addingItemKey, setAddingItemKey] = useState<string | null>(null);
  const compraSalvaExportRef = useRef<HTMLDivElement>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [manualState, setManualState] = useState<Record<string, "editing" | "confirmed">>({});
  const [manualDistribuicao, setManualDistribuicao] = useState<Record<string, Record<string, number>>>({});
  const manualDistribuicaoRef = useRef(manualDistribuicao);
  manualDistribuicaoRef.current = manualDistribuicao;
  const filialOptions = useMemo(() => getFilialOptions(companyKey), [companyKey]);
  const manualStorageKey = `compra-manual:${compraId}`;

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

  // Restaura itens confirmados manualmente do localStorage ao carregar
  useEffect(() => {
    try {
      const raw = localStorage.getItem(manualStorageKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, Record<string, number>>;
      if (typeof saved !== "object" || saved === null) return;
      const stateInit: Record<string, "editing" | "confirmed"> = {};
      Object.keys(saved).forEach((key) => { stateInit[key] = "confirmed"; });
      setManualState(stateInit);
      setManualDistribuicao(saved);
    } catch { /* ignora dados corrompidos */ }
  }, [manualStorageKey]);

  // Persiste itens confirmados no localStorage sempre que o estado mudar
  useEffect(() => {
    try {
      const toPersist: Record<string, Record<string, number>> = {};
      Object.entries(manualState).forEach(([key, state]) => {
        if (state === "confirmed" && manualDistribuicao[key]) {
          toPersist[key] = manualDistribuicao[key];
        }
      });
      if (Object.keys(toPersist).length > 0) {
        localStorage.setItem(manualStorageKey, JSON.stringify(toPersist));
      } else {
        localStorage.removeItem(manualStorageKey);
      }
    } catch { /* ignora erros de storage */ }
  }, [manualState, manualDistribuicao, manualStorageKey]);

  const expandirPorCor = doc?.expandirPorCor ?? true;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams();
    params.set("company", companyKey);
    void (async () => {
      try {
        const res = await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, { cache: "no-store" });
        const json = await res.json() as { data?: CompraSalva; error?: string };
        if (!res.ok) throw new Error(json.error ?? "Erro ao carregar");
        const d = json.data;
        if (!d) throw new Error("Resposta vazia");
        if (cancelled) return;
        setDoc(d);
        setItems(d.items);
        setTitleEdit(d.title);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Erro");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyKey, compraId]);

  // Polling: refresh suggested quantities and store distribution every 5 minutes
  useEffect(() => {
    const POLL_MS = 5 * 60 * 1000;
    const id = setInterval(() => {
      setListaRowsRefreshKey((k) => k + 1);
      // Clear vendas cache synchronously so next effect run re-fetches fresh data
      destinoVendasFetchRef.current.clear();
      vendasPorFilialCacheRef.current = {};
      setVendasPorFilialCache({});
      setVendasRefreshKey((k) => k + 1);
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!doc || items.length === 0) return;
    destinoVendasFetchRef.current.clear();
    setVendasPorFilialCache({});
  }, [doc?.id, expandirPorCor]);

  useEffect(() => {
    if (!exportMenuOpen) return undefined;

    const handlePointerDown = (event: MouseEvent) => {
      if (!exportMenuRef.current?.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [exportMenuOpen]);

  useEffect(() => {
    const term = manualSearchTerm.trim();
    if (!doc) return;
    if (term.length < 2) {
      setManualSearchResults([]);
      setManualSearchError(null);
      setManualSearchLoading(false);
      return;
    }

    let active = true;
    setManualSearchLoading(true);
    setManualSearchError(null);

    const timeoutId = window.setTimeout(async () => {
      try {
        let results: ProdutoBuscaManual[] = [];

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

        if (active) {
          setManualSearchResults(results);
        }
      } catch {
        if (active) {
          setManualSearchResults([]);
          setManualSearchError("Erro ao buscar produtos.");
        }
      } finally {
        if (active) {
          setManualSearchLoading(false);
        }
      }
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
    };
  }, [manualSearchTerm, companyKey, doc]);

  useEffect(() => {
    if (!doc || items.length === 0) return;
    const produtos = [...new Set(items.map((i) => i.produto.trim()).filter(Boolean))];
    if (produtos.length === 0) return;
    const totalQtd = items.reduce((s, i) => s + Math.max(0, i.qtdManual ?? 0), 0);
    const params = new URLSearchParams();
    params.set("company", companyKey);
    params.set("limit", "8000");
    params.set("qtdCompra", String(totalQtd > 0 ? totalQtd : 1));
    if (expandirPorCor) params.set("porCor", "1");
    produtos.forEach((p) => params.append("produtos", p));

    let cancelled = false;
    fetchListaCompra(params)
      .then((data) => {
        if (!cancelled) setListaRows(data);
      })
      .catch(() => {
        if (!cancelled) setListaRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [doc, items, companyKey, expandirPorCor, listaRowsRefreshKey]);

  useEffect(() => {
    if (!doc || items.length === 0) return;
    let cancelled = false;
    // Usa filialOrigem do primeiro item que a tenha (campo salvo a partir desta versão).
    // Fallback para sourceContextKey apenas em compras antigas sem filialOrigem.
    const primeiroComOrigem = items.find((it) => it.filialOrigem !== undefined);
    const filialFiltro = primeiroComOrigem !== undefined
      ? primeiroComOrigem.filialOrigem  // pode ser null (todas) ou codFilial específico
      : parseListaLojaFilial(doc.sourceContextKey);
    const unique = new Map<string, { produto: string; corProduto: string | null }>();
    items.forEach((it) => {
      const produto = it.produto.trim();
      const corProduto = expandirPorCor ? ((it.corProduto ?? "").trim() || null) : null;
      const key = `${produto}||${corProduto ?? ""}`;
      unique.set(key, { produto, corProduto });
    });
    void Promise.all(
      Array.from(unique.entries()).map(async ([key, val]) => {
        const params = new URLSearchParams();
        params.set("company", companyKey);
        params.set("produto", val.produto);
        if (val.corProduto) params.set("corProduto", val.corProduto);
        if (filialFiltro) params.set("filial", filialFiltro);
        const estoqueParams = new URLSearchParams(params);
        // includeHistorico só vai para vendas; estoque usa endpoint diferente
        params.set("includeHistorico", "true");
        const [vendas, estoque] = await Promise.all([
          fetchVendasItemMetricas(params),
          fetchEstoqueFilialSum(estoqueParams),
        ]);
        return {
          key,
          values: {
            qtde12m: vendas?.qtde12m ?? null,
            vendasMesAtual: vendas?.vendasMesAtual ?? null,
            estoqueAtual: estoque,
            diasDesdeUltimaVenda: vendas?.diasDesdeUltimaVenda ?? null,
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
            totalNmQty: vendas?.totalNmQty ?? null,
          },
        };
      })
    ).then((rows) => {
      if (cancelled) return;
      setLiveMetrics((prev) => {
        const next = { ...prev };
        rows.forEach((r) => { next[r.key] = r.values; });
        return next;
      });
    }).catch(() => {
      // fallback silencioso: usa dados de listaRows
    });
    return () => {
      cancelled = true;
    };
  }, [doc, items, companyKey, expandirPorCor]);

  useEffect(() => {
    if (!doc || items.length === 0) return;
    const unique = new Map<string, { produto: string; cor?: string }>();
    items.forEach((it) => {
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
      void Promise.all([
        fetchVendasPorFilialItem(params),
        fetchEstoquePorFilial(params),
      ])
        .then(([vendasData, estoqueData]) => {
          const norm = normalizeVendasPorFilialParaExibicao(companyKey, vendasData);
          setVendasPorFilialCache((p) => ({ ...p, [cacheKey]: norm }));
          setEstoquePorFilialCache((p) => ({ ...p, [cacheKey]: estoqueData }));
        })
        .catch(() => {
          setVendasPorFilialCache((p) => ({ ...p, [cacheKey]: [] }));
        });
    });
  }, [doc, items, expandirPorCor, companyKey, vendasRefreshKey]);

  const manualTotalByItemKey = useMemo(() => {
    return Object.fromEntries(
      Object.entries(manualDistribuicao).map(([itemKey, distribuicao]) => [itemKey, sumDistribuicaoManual(distribuicao)])
    ) as Record<string, number>;
  }, [manualDistribuicao]);

  const rowsComputed = useMemo(() => {
    return items.map((it) => {
      const produto = it.produto.trim();
      const corProduto = (it.corProduto ?? "").trim();
      const itemManualState = manualState[it.itemKey];
      const hasManualOverride =
        (itemManualState === "editing" || itemManualState === "confirmed") &&
        manualDistribuicao[it.itemKey] !== undefined;
      const effectiveQtdManual = hasManualOverride
        ? (manualTotalByItemKey[it.itemKey] ?? 0)
        : Math.max(0, Number(it.qtdManual ?? 0));
      const match = listaRows.find((p) => {
        const pProd = (p.produto ?? "").trim();
        const pCor = (p.cor ?? "").trim();
        return pProd === produto && (expandirPorCor ? pCor === corProduto : true);
      });
      const cacheKey = `${produto}||${expandirPorCor ? corProduto : ""}`;
      const live = liveMetrics[cacheKey];
      const estoque = live?.estoqueAtual ?? match?.estoqueAtual ?? null;
      const custoUnit = it.custoUnitario || match?.custoUnitario || 0;
      const custoTotal = custoUnit > 0 ? Math.round(effectiveQtdManual * custoUnit) : 0;
      const sugestaoBase = calcularSugestaoCompletoComTransito(match, live, comprasTransitoIndex, companyKey);
      // Catraca: mantém a data registrada (mais cedo) quando é pra manter (sem mutar o objeto).
      const sugestaoAtual = sugestaoBase.ideal
        ? {
            ...sugestaoBase,
            ideal: catraca.reconcile(
              sugestaoBase.ideal,
              buildControleEstoqueItemKey(produto, expandirPorCor ? corProduto : null),
              getCompraTransitoEntries(comprasTransitoIndex, produto, expandirPorCor ? corProduto : null)
            ).ideal,
          }
        : sugestaoBase;
      const qtdSugerida = sugestaoAtual.qty;
      return { it, match, live, estoque, custoUnit, custoTotal, qtdSugerida, sugestaoAtual, effectiveQtdManual };
    });
  }, [items, listaRows, expandirPorCor, liveMetrics, manualDistribuicao, manualState, manualTotalByItemKey, comprasTransitoIndex, companyKey, catraca.reconcile]);

  // Catraca: junta gravações pendentes e persiste.
  const catracaFreezes = useMemo<CatracaFreeze[]>(() => {
    if (!catraca.enabled) return [];
    const out: CatracaFreeze[] = [];
    for (const r of rowsComputed) {
      const ideal = r.sugestaoAtual?.ideal;
      if (!ideal) continue;
      const produto = r.it.produto.trim();
      const corCat = expandirPorCor ? (r.it.corProduto ?? "").trim() : null;
      const { freeze } = catraca.reconcile(
        ideal,
        buildControleEstoqueItemKey(produto, corCat),
        getCompraTransitoEntries(comprasTransitoIndex, produto, corCat)
      );
      if (freeze) out.push(freeze);
    }
    return out;
  }, [rowsComputed, expandirPorCor, comprasTransitoIndex, catraca.enabled, catraca.reconcile]);

  useEffect(() => catraca.persist(catracaFreezes), [catracaFreezes, catraca.persist]);

  const totals = useMemo(() => {
    const totalItens = rowsComputed.length;
    // Usa qtdSugerida quando disponível, incorporando a diferença no total
    const totalQtdManual = rowsComputed.reduce((s, r) => s + r.effectiveQtdManual, 0);
    const totalCusto = rowsComputed.reduce((s, r) => s + (r.custoTotal ?? 0), 0);
    return { totalItens, totalQtdManual, totalCusto };
  }, [rowsComputed]);

  const existingItemKeys = useMemo(() => new Set(items.map((item) => item.itemKey)), [items]);
  const manualSearchDisplayResults = useMemo(() => {
    if (!doc) return manualSearchResults;
    const seen = new Set<string>();
    return manualSearchResults.filter((produto) => {
      const key = buildItemKey(produto.produto, doc.expandirPorCor ? produto.corProduto : null);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [doc, manualSearchResults]);

  const [estoqueTooltip, setEstoqueTooltip] = useState<null | {
    x: number;
    y: number;
    produto: string;
    corDescricao?: string;
    filiais: Array<{ filial: string; estoque: number }>;
    total: number;
  }>(null);
  const [sugestaoDiffTooltip, setSugestaoDiffTooltip] = useState<null | {
    x: number;
    y: number;
    diffFmt: string;
    explicacao: string;
    qtdSugerida: number;
    qtdManual: number;
    mediaMensal12m: number;
    ritmoMensal60d: number;
    tendenciaTexto: string;
    ajusteDestinoTexto: string;
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
    distribuicao?: DestinoCompraFinalParte[];
    transitTotal?: number;
    transitDates?: string[];
  }>(null);
  const [sugestaoPOTooltip, setSugestaoPOTooltip] = useState<null | {
    x: number;
    y: number;
    qtde12m: number;
    periodoRef?: string;
    diasComEstoquePositivo: number;
    diasSemEstoque: number;
    velocidadeAjustada: number;
    potencialMensalBruto: number;
    limiteSeguro: number;
    qtdPO: number;
    transitTotal?: number;
    transitDates?: string[];
  }>(null);

  const handleUpdateQtd = async (itemKey: string, qtdManual: number) => {
    const params = new URLSearchParams();
    params.set("company", companyKey);
    await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemKey, qtdManual }),
    });
    setItems((prev) => prev.map((i) => (i.itemKey === itemKey ? { ...i, qtdManual } : i)));
  };

  const handleRemove = async (itemKey: string) => {
    try {
      const params = new URLSearchParams();
      params.set("company", companyKey);
      const res = await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeItemKey: itemKey }),
      });
      const json = await res.json() as { data?: CompraSalva; error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Erro ao remover item");
      }
      if (json.data) {
        setDoc(json.data);
        setItems(json.data.items);
        return;
      }
      setItems((prev) => prev.filter((i) => i.itemKey !== itemKey));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao remover item");
    }
  };

  const handleAddManualItem = async (produto: ProdutoBuscaManual) => {
    if (!doc) return;

    const corProduto = doc.expandirPorCor ? ((produto.corProduto ?? "").trim() || undefined) : undefined;
    const corDescricao = doc.expandirPorCor
      ? (resolveStrictColorDescription(produto.corProduto, produto.descCor) || undefined)
      : undefined;
    const addItem: CompraSalvaItemRow = {
      itemKey: buildItemKey(produto.produto, corProduto),
      produto: produto.produto,
      corProduto,
      corDescricao,
      descricao: produto.descProduto,
      grade: produto.grade ? String(produto.grade).trim() || undefined : undefined,
      colecao: produto.colecao ? String(produto.colecao).trim() || undefined : undefined,
      qtdManual: 1,
      filialOrigem: resolveCompraSalvaFilialOrigem(items, doc.sourceContextKey),
    };

    const params = new URLSearchParams();
    params.set("company", companyKey);
    setAddingItemKey(addItem.itemKey);

    try {
      const res = await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ addItem }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        throw new Error(json.error ?? "Erro ao adicionar item");
      }

      setItems((prev) => mergeLocalCompraSalvaItems(prev, addItem));
      setDoc((prev) => prev
        ? {
            ...prev,
            items: mergeLocalCompraSalvaItems(prev.items, addItem),
            updatedAt: new Date().toISOString(),
          }
        : prev);
      setManualSearchTerm("");
      setManualSearchResults([]);
      setManualSearchError(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Erro ao adicionar item");
    } finally {
      setAddingItemKey(null);
    }
  };

  const handleTitleBlur = async () => {
    if (!doc) return;
    const next = titleEdit.trim();
    if (!next) {
      setTitleEdit(doc.title);
      return;
    }
    if (next === doc.title) return;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: next }),
    });
    setDoc((d) => (d ? { ...d, title: next } : d));
  };

  const handleDeleteCompra = async () => {
    if (!window.confirm("Excluir esta compra salva? Esta ação não pode ser desfeita.")) return;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    const res = await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, { method: "DELETE" });
    if (res.ok) {
      router.push(listBack);
    }
  };

  const handleExportToTransitDraft = async () => {
    if (!doc || exportingTransitDraft) return;

    const transitItems = rowsComputed
      .map(({ it, estoque, custoUnit, effectiveQtdManual }) => ({
        itemKey: String(it.itemKey ?? ""),
        produto: String(it.produto ?? ""),
        descricao: String(it.descricao ?? it.produto ?? ""),
        corProduto: it.corProduto ? String(it.corProduto) : undefined,
        corDescricao: it.corDescricao ? String(it.corDescricao) : undefined,
        grade: it.grade ? String(it.grade) : undefined,
        dataRecebimento: "",
        quantidade: Math.max(0, Math.round(effectiveQtdManual)),
        custoUnitario: custoUnit > 0 ? Number(custoUnit) : undefined,
        estoqueAtual: estoque != null ? Number(estoque) : undefined,
        status: "rascunho" as const,
      }))
      .filter((item) => item.quantidade > 0);

    if (transitItems.length === 0) {
      window.alert("Essa compra salva nao tem itens com quantidade para exportar.");
      return;
    }

    setExportingTransitDraft(true);
    try {
      const res = await fetch("/api/compras-transito", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyKey,
          title: titleEdit.trim() || doc.title,
          items: transitItems,
          draft: true,
        }),
      });
      const json = (await res.json()) as { data?: { id?: string }; error?: string };
      if (!res.ok || !json.data?.id) {
        throw new Error(json.error ?? "Erro ao exportar compra para transito");
      }
      router.push(`/${companySlug}/compras-transito?draft=${encodeURIComponent(json.data.id)}`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao exportar compra para transito");
    } finally {
      setExportingTransitDraft(false);
    }
  };

  const handleExportXlsx = () => {
    const fmt2 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
    const rowExcel = rowsComputed.map(({ it, match, estoque, custoUnit, custoTotal, effectiveQtdManual }) => {
      const produtoK = it.produto.trim();
      const corK = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
      const vendasKey = `${produtoK}||${corK ?? ""}`;
      const vendasRows = vendasPorFilialCache[vendasKey];
      const itemState = manualState[it.itemKey] ?? "auto";
      let destino: string;
      if (itemState === "confirmed") {
        const dist = manualDistribuicao[it.itemKey] ?? {};
        const cfg = resolveCompany(companyKey);
        destino = Object.entries(dist)
          .filter(([, qty]) => qty > 0)
          .sort(([a], [b]) => compareFilialDisplayOrder(a, b, cfg))
          .map(([label, qty]) => `${label}: ${fmt2(qty)}`)
          .join(" · ");
      } else {
        destino = vendasRows !== undefined ? textoDestinoCompraFinal(effectiveQtdManual, vendasRows, companyKey, estoquePorFilialCache[vendasKey], getSharedLimiteDiasReposicao({ linha: match?.linha, subgrupo: match?.subgrupo })) : "";
      }
      return {
        PRODUTO: it.produto,
        CODIGO_BARRA: match?.codigoBarra ?? "",
        DESC_PRODUTO: it.descricao,
        COR_PRODUTO: it.corProduto ?? "",
        DESC_COR_PRODUTO: it.corDescricao ?? "",
        GRADE: it.grade ?? "",
        COLECAO: it.colecao ?? "",
        QTD_MANUAL: effectiveQtdManual,
        DESTINO: destino,
        ESTOQUE_ATUAL: estoque ?? 0,
        CUSTO_UNIT: custoUnit ?? 0,
        CUSTO_TOTAL: custoTotal ?? 0,
      };
    });

    const kpis = [
      { METRICA: "Título", VALOR: doc?.title ?? "" },
      { METRICA: "Empresa", VALOR: companyKey },
      { METRICA: "Itens", VALOR: totals.totalItens },
      { METRICA: "Total Qtd Manual", VALOR: totals.totalQtdManual },
      { METRICA: "Custo Total", VALOR: totals.totalCusto },
    ];

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(kpis), "KPIs");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rowExcel), "Compra salva");

    const safeName = (doc?.title ?? "compra-salva").replace(/[^\w\-]+/g, "_").slice(0, 80);
    XLSX.writeFile(wb, `${safeName}.xlsx`);
  };

  const handleExportPdf = async () => {
    if (!compraSalvaExportRef.current || items.length === 0) return;

    setExportingPdf(true);
    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const target = compraSalvaExportRef.current;

      // Coleta valores dos inputs ANTES do clone (cloneNode não copia .value de inputs React)
      const originalInputs = Array.from(target.querySelectorAll("input")) as HTMLInputElement[];
      const inputValues = originalInputs.map((inp) => inp.value);

      // Aplicado em CADA clone (medição + cada fatia capturada): esconde UI que não deve
      // aparecer no PDF, troca inputs por spans com o valor certo, e corrige overflow:clip
      // e position:sticky que o html2canvas não trata bem fora do container real.
      const applyExportTransform = (cloneDoc: Document, cloneEl: HTMLElement) => {
        cloneEl.querySelectorAll("[data-pdf-hide]").forEach((el) => {
          (el as HTMLElement).style.display = "none";
        });

        const cloneInputs = Array.from(cloneEl.querySelectorAll("input")) as HTMLInputElement[];
        cloneInputs.forEach((cloneInp, i) => {
          const span = cloneDoc.createElement("span");
          span.style.cssText = "display:block;text-align:right;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums;padding:6px 8px;";
          span.textContent = inputValues[i] ?? "";
          cloneInp.replaceWith(span);
        });

        const cloneWin = cloneDoc.defaultView;
        if (cloneWin) {
          cloneEl.querySelectorAll("*").forEach((el) => {
            const htmlEl = el as HTMLElement;
            const cs = cloneWin.getComputedStyle(htmlEl);
            if (cs.overflow === "clip") htmlEl.style.overflow = "visible";
            if (cs.position === "sticky") htmlEl.style.position = "relative";
          });
        }
      };

      // Pontos de quebra (em px de CSS, relativos ao topo da área exportada) onde
      // é seguro cortar a página — entre linhas da tabela, nunca no meio de uma.
      let rowBreaksCss: number[] = [];
      let contentWidthCss = 0;
      let contentHeightCss = 0;

      // Passagem de MEDIÇÃO: canvas final é minúsculo (scale ínfimo) de propósito —
      // aqui só nos importa o layout do clone (onclone roda antes do desenho, no
      // tamanho real em CSS px), não a imagem em si.
      await html2canvas(target, {
        backgroundColor: "#ffffff",
        scale: 0.05,
        useCORS: true,
        logging: false,
        windowWidth: target.scrollWidth,
        windowHeight: target.scrollHeight,
        onclone: (cloneDoc, cloneEl) => {
          applyExportTransform(cloneDoc, cloneEl);
          const baseRect = cloneEl.getBoundingClientRect();
          contentWidthCss = baseRect.width;
          contentHeightCss = baseRect.height;
          const breaks = new Set<number>();
          cloneEl.querySelectorAll("tbody tr").forEach((tr) => {
            breaks.add((tr as HTMLElement).getBoundingClientRect().bottom - baseRect.top);
          });
          rowBreaksCss = Array.from(breaks).sort((a, b) => a - b);
        },
      });

      if (contentWidthCss <= 0 || contentHeightCss <= 0) {
        throw new Error("Não foi possível medir o conteúdo para exportação.");
      }

      const SCALE = 2;
      const pageWidthMm = 210;
      const cssToMm = pageWidthMm / contentWidthCss;
      // Altura máxima (em px de CSS) de uma única captura. Compras com muitos itens
      // geram uma tabela muito alta; capturar tudo de uma vez num canvas só (como antes)
      // ultrapassa o limite de dimensão de canvas do navegador (~16k-32k px) e o navegador
      // devolve a imagem cortada/em branco a partir dali, sem erro — daí compras grandes
      // saírem com o fim da lista faltando. Por isso cada página é capturada separadamente,
      // já recortada (html2canvas x/y/width/height) no tamanho abaixo, nunca um canvas gigante.
      const MAX_SLICE_CSS_HEIGHT = 6000;

      const captureSlice = (startCss: number, endCss: number) =>
        html2canvas(target, {
          backgroundColor: "#ffffff",
          scale: SCALE,
          useCORS: true,
          logging: false,
          windowWidth: target.scrollWidth,
          windowHeight: target.scrollHeight,
          x: 0,
          y: startCss,
          width: contentWidthCss,
          height: endCss - startCss,
          onclone: (cloneDoc, cloneEl) => applyExportTransform(cloneDoc, cloneEl),
        });

      const safeName = (doc?.title ?? "compra-salva").replace(/[^\w\-]+/g, "_").slice(0, 80);

      if (contentHeightCss <= MAX_SLICE_CSS_HEIGHT) {
        // Compra pequena: cabe inteira numa única fatia segura — 1 página só, como antes.
        const canvas = await captureSlice(0, contentHeightCss);
        const pageHeightMm = contentHeightCss * cssToMm;
        const pdf = new jsPDF({
          orientation: "portrait",
          unit: "mm",
          format: [pageWidthMm, pageHeightMm],
        });
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidthMm, pageHeightMm, undefined, "FAST");
        pdf.save(`${safeName}.pdf`);
        return;
      }

      // Compra grande: pagina em A4, cada página com sua própria captura independente.
      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });
      const a4HeightMm = pdf.internal.pageSize.getHeight();
      const sliceCssHeight = Math.min(a4HeightMm / cssToMm, MAX_SLICE_CSS_HEIGHT);

      let cursorCss = 0;
      let pageIndex = 0;

      while (cursorCss < contentHeightCss) {
        const maxEndCss = cursorCss + sliceCssHeight;
        let sliceEndCss: number;
        if (maxEndCss >= contentHeightCss) {
          // Última página: leva tudo o que resta.
          sliceEndCss = contentHeightCss;
        } else {
          // Maior quebra de linha que cabe nesta página; se nenhuma couber
          // (linha mais alta que a página) faz corte rígido para não travar.
          let candidate = cursorCss;
          for (const bp of rowBreaksCss) {
            if (bp > cursorCss && bp <= maxEndCss) candidate = bp;
            else if (bp > maxEndCss) break;
          }
          sliceEndCss = candidate > cursorCss ? candidate : maxEndCss;
        }

        const canvas = await captureSlice(cursorCss, sliceEndCss);
        const imgHeightMm = (sliceEndCss - cursorCss) * cssToMm;
        if (pageIndex > 0) pdf.addPage();
        pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pageWidthMm, imgHeightMm, undefined, "FAST");

        cursorCss = sliceEndCss;
        pageIndex += 1;
      }

      pdf.save(`${safeName}.pdf`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  const startManualEdit = (itemKey: string, partesDestino: DestinoCompraFinalParte[] | null | undefined) => {
    if (!manualState[itemKey]) {
      const dist: Record<string, number> = {};
      (partesDestino ?? []).forEach((p) => { dist[p.label] = p.qtd; });
      manualDistribuicaoRef.current = { ...manualDistribuicaoRef.current, [itemKey]: dist };
      setManualDistribuicao((prev) => ({ ...prev, [itemKey]: dist }));
    }
    setManualState((prev) => ({ ...prev, [itemKey]: "editing" }));
  };

  const confirmManual = (itemKey: string) => {
    setManualState((prev) => ({ ...prev, [itemKey]: "confirmed" }));
  };

  const cancelManual = (itemKey: string) => {
    setManualState((prev) => { const next = { ...prev }; delete next[itemKey]; return next; });
    setManualDistribuicao((prev) => {
      const next = { ...prev };
      delete next[itemKey];
      manualDistribuicaoRef.current = next;
      return next;
    });
  };

  const handleManualFilialDelta = (itemKey: string, filial: string, delta: number) => {
    const itemDist = { ...(manualDistribuicaoRef.current[itemKey] ?? {}) };
    itemDist[filial] = Math.max(0, (itemDist[filial] ?? 0) + delta);
    const total = sumDistribuicaoManual(itemDist);
    manualDistribuicaoRef.current = { ...manualDistribuicaoRef.current, [itemKey]: itemDist };
    setManualDistribuicao((prev) => ({ ...prev, [itemKey]: itemDist }));
    setItems((prev) => prev.map((i) => (i.itemKey === itemKey ? { ...i, qtdManual: total } : i)));
    void handleUpdateQtd(itemKey, total);
  };

  const handleManualFilialSet = (itemKey: string, filial: string, value: number) => {
    const itemDist = { ...(manualDistribuicaoRef.current[itemKey] ?? {}) };
    itemDist[filial] = Math.max(0, Math.round(value));
    const total = sumDistribuicaoManual(itemDist);
    manualDistribuicaoRef.current = { ...manualDistribuicaoRef.current, [itemKey]: itemDist };
    setManualDistribuicao((prev) => ({ ...prev, [itemKey]: itemDist }));
    setItems((prev) => prev.map((i) => (i.itemKey === itemKey ? { ...i, qtdManual: total } : i)));
    void handleUpdateQtd(itemKey, total);
  };

  const handleManualAddFilial = (itemKey: string, filial: string) => {
    setManualDistribuicao((prev) => {
      const current = prev[itemKey] ?? {};
      if (filial in current) return prev;
      const next = { ...prev, [itemKey]: { ...current, [filial]: 0 } };
      manualDistribuicaoRef.current = next;
      return next;
    });
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.pageToolbar}>
        <Link href={listBack} className={styles.backButton}>
          ← Compras salvas
        </Link>
      </div>

      <div className={styles.headerCard}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.iconWrapper}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {!doc && loading && <h1 className={styles.title}>Carregando compra…</h1>}
              {doc && (
                <>
                  <label className={styles.subtitle} htmlFor="compra-salva-titulo" style={{ display: "block", marginBottom: 6 }}>
                    Título
                  </label>
                  <input
                    id="compra-salva-titulo"
                    type="text"
                    style={{
                      display: "block",
                      width: "100%",
                      maxWidth: 520,
                      fontSize: 20,
                      fontWeight: 700,
                      color: "#0f172a",
                      border: "1px solid #e2e8f0",
                      borderRadius: 8,
                      padding: "10px 14px",
                      marginBottom: 8,
                    }}
                    value={titleEdit}
                    onChange={(e) => setTitleEdit(e.target.value)}
                    onBlur={() => { void handleTitleBlur(); }}
                  />
                  <p className={styles.subtitle}>
                    Salva em {new Date(doc.savedAt).toLocaleString("pt-BR")} · {expandirPorCor ? "Por cor" : "Por produto"}
                  </p>
                </>
              )}
            </div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.dangerButton} onClick={() => { void handleDeleteCompra(); }}>
              Excluir compra
            </button>
          </div>
        </div>
      </div>

      {loading && <div className={styles.loading}>Carregando...</div>}
      {error && <div className={styles.error}>{error}</div>}

      {!loading && !error && doc && (
        <div ref={compraSalvaExportRef}>
          <div className={styles.summaryCard} style={{ justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap" }}>
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Itens</span>
                <span className={styles.summaryValueNeutral}>{totals.totalItens}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Total Qtd</span>
                <span className={styles.summaryValue}>{fmt(totals.totalQtdManual)}</span>
              </div>
              <div className={styles.summaryDivider} />
              <div className={styles.summaryItem}>
                <span className={styles.summaryLabel}>Custo total (referência)</span>
                <span className={styles.summaryValue}>{fmtBRL(totals.totalCusto)}</span>
              </div>
            </div>
            <div className={styles.exportActions} data-pdf-hide="" ref={exportMenuRef}>
              <button
                type="button"
                className={styles.exportBtn}
                onClick={() => { void handleExportToTransitDraft(); }}
                disabled={exportingTransitDraft || items.length === 0}
              >
                {exportingTransitDraft ? "Exportando..." : "Exportar para transito"}
              </button>
              <button
                type="button"
                className={`${styles.exportBtn} ${styles.exportMenuToggle}`}
                disabled={items.length === 0}
                onClick={() => setExportMenuOpen((prev) => !prev)}
                aria-expanded={exportMenuOpen}
                aria-haspopup="menu"
                aria-label="Abrir menu de exportacao"
              >
                <span className={styles.exportMenuLabel}>Exportar</span>
                <span className={`${styles.exportCaret}${exportMenuOpen ? ` ${styles.exportCaretOpen}` : ""}`}>v</span>
                {exportingPdf ? "Exportando PDF…" : "Exportar PDF"}
              </button>
              {exportMenuOpen && (
                <div className={styles.exportDropdown} role="menu">
                  <button
                    type="button"
                    className={styles.exportMenuItem}
                    onClick={() => {
                      setExportMenuOpen(false);
                      handleExportXlsx();
                    }}
                  >
                    Exportar XLSX
                  </button>
                  <button
                    type="button"
                    className={styles.exportMenuItem}
                    disabled={exportingPdf}
                    onClick={() => {
                      setExportMenuOpen(false);
                      void handleExportPdf();
                    }}
                  >
                    {exportingPdf ? "Exportando PDF..." : "Exportar PDF"}
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className={styles.manualProductPanel} data-pdf-hide="">
            <div className={styles.manualProductPanelHeader}>
              <div>
                <div className={styles.manualProductPanelTitle}>Adicionar produto manualmente</div>
                <div className={styles.manualProductPanelHint}>
                  Busque por codigo, nome ou codigo de barras.
                </div>
              </div>
            </div>
            <input
              type="text"
              className={styles.manualProductSearchInput}
              placeholder="Buscar por codigo, nome ou codigo de barras..."
              value={manualSearchTerm}
              onChange={(e) => setManualSearchTerm(e.target.value)}
            />
            {manualSearchLoading && (
              <div className={styles.manualProductStatus}>Buscando produtos...</div>
            )}
            {manualSearchError && (
              <div className={styles.manualProductError}>{manualSearchError}</div>
            )}
            {!manualSearchLoading && !manualSearchError && manualSearchTerm.trim().length >= 2 && manualSearchDisplayResults.length === 0 && (
              <div className={styles.manualProductStatus}>Nenhum produto encontrado.</div>
            )}
            {manualSearchDisplayResults.length > 0 && (
              <div className={styles.manualProductResults}>
                {manualSearchDisplayResults.map((produto) => {
                  const resultItemKey = buildItemKey(
                    produto.produto,
                    doc.expandirPorCor ? produto.corProduto : null
                  );
                  const jaExiste = existingItemKeys.has(resultItemKey);
                  const corDescricao = resolveStrictColorDescription(produto.corProduto, produto.descCor);
                  return (
                    <div key={resultItemKey} className={styles.manualProductResultRow}>
                      <div className={styles.manualProductResultMain}>
                        <div className={styles.productName}>{produto.descProduto || produto.produto}</div>
                        <div className={styles.productCode}>{produto.produto}</div>
                        {doc.expandirPorCor && corDescricao && (
                          <div className={styles.productCode}>{corDescricao}</div>
                        )}
                        {produto.codigoBarra && (
                          <div className={styles.productCode}>CB: {produto.codigoBarra}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        className={styles.manualProductAddBtn}
                        onClick={() => { void handleAddManualItem(produto); }}
                        disabled={addingItemKey === resultItemKey}
                      >
                        {addingItemKey === resultItemKey ? "Adicionando..." : jaExiste ? "+1" : "Adicionar"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {items.length === 0 ? (
            <div className={styles.empty}>Nenhum item nesta compra.</div>
          ) : (
            <div className={styles.tableCard}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className={styles.right}>Qtd</th>
                    <th>Destino</th>
                    <th className={styles.right}>Estoque</th>
                    <th className={styles.right}>Custo Unit.</th>
                    <th className={styles.right}>Custo Total</th>
                    <th style={{ width: 60 }} data-pdf-hide="" />
                  </tr>
                </thead>
                <tbody>
                  {rowsComputed.map(({ it, match, live, estoque, custoUnit, custoTotal, qtdSugerida, sugestaoAtual, effectiveQtdManual }) => {
                    const itemManualState = manualState[it.itemKey] ?? "auto";
                    const isEditing = itemManualState === "editing";
                    const isConfirmed = itemManualState === "confirmed";
                    const isManual = isEditing || isConfirmed;
                    const produtoK = it.produto.trim();
                    const corK = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
                    const vendasKey = `${produtoK}||${corK ?? ""}`;
                    const vendasRowsK = vendasPorFilialCache[vendasKey];
                    const estoqueRowsK = estoquePorFilialCache[vendasKey];
                    const partesDestino =
                      vendasRowsK === undefined
                        ? undefined
                        : partesDestinoCompraFinal(effectiveQtdManual, vendasRowsK, companyKey, estoqueRowsK, getSharedLimiteDiasReposicao({ linha: match?.linha, subgrupo: match?.subgrupo }));
                    const partesDestinoSugerido =
                      vendasRowsK === undefined || qtdSugerida === null
                        ? undefined
                        : partesDestinoCompraFinal(qtdSugerida, vendasRowsK, companyKey, estoqueRowsK, getSharedLimiteDiasReposicao({ linha: match?.linha, subgrupo: match?.subgrupo }));
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
                          {isManual ? (
                            <span className={styles.qtyManualTotal}>{fmt(effectiveQtdManual)}</span>
                          ) : (
                            <input
                              className={styles.qtyInput}
                              type="number"
                              value={effectiveQtdManual}
                              min={0}
                              onChange={(e) => {
                                const v = Math.max(0, Math.round(Number(e.target.value ?? 0)));
                                setItems((prev) => prev.map((x) => (x.itemKey === it.itemKey ? { ...x, qtdManual: v } : x)));
                              }}
                              onBlur={() => { void handleUpdateQtd(it.itemKey, effectiveQtdManual); }}
                            />
                          )}
                        </td>
                        <td className={styles.destinoCell}>
                          {isEditing ? (
                            /* ── Estado: editando ── */
                            <div>
                              <ManualDestinoEditor
                                distribuicao={manualDistribuicao[it.itemKey] ?? {}}
                                allFiliais={filialOptions}
                                onDelta={(filial, delta) => handleManualFilialDelta(it.itemKey, filial, delta)}
                                onSet={(filial, value) => handleManualFilialSet(it.itemKey, filial, value)}
                                onAddFilial={(filial) => handleManualAddFilial(it.itemKey, filial)}
                              />
                              <div className={styles.manualEditActions} data-pdf-hide="">
                                <button
                                  type="button"
                                  className={styles.manualConfirmBtn}
                                  onClick={() => confirmManual(it.itemKey)}
                                >
                                  Confirmar ✓
                                </button>
                                <button
                                  type="button"
                                  className={styles.manualCancelBtn}
                                  onClick={() => cancelManual(it.itemKey)}
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : isConfirmed ? (
                            /* ── Estado: manual confirmado — visual igual ao auto ── */
                            <div>
                              <div className={styles.destinoCellInner}>
                                {(() => {
                                  const cfg = resolveCompany(companyKey);
                                  const manualPartes: DestinoCompraFinalParte[] = Object.entries(manualDistribuicao[it.itemKey] ?? {})
                                    .filter(([, qty]) => qty > 0)
                                    .map(([label, qtd]) => ({ label, qtd }))
                                    .sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));
                                  return manualPartes.length > 0
                                    ? <DestinoCompraFinalBadges partes={manualPartes} />
                                    : <span style={{ color: "#94a3b8", fontSize: 12 }}>Sem distribuição</span>;
                                })()}
                              </div>
                              <div className={styles.manualConfirmedActions} data-pdf-hide="">
                                <button
                                  type="button"
                                  className={styles.manualToggleBtn}
                                  onClick={() => startManualEdit(it.itemKey, partesDestino)}
                                >
                                  Editar
                                </button>
                                <button
                                  type="button"
                                  className={styles.manualToggleBtn}
                                  onClick={() => cancelManual(it.itemKey)}
                                  title="Voltar ao modo automático"
                                >
                                  → Auto
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* ── Estado: automático (padrão) ── */
                            <div>
                              <div className={styles.destinoCellInner}>
                                {partesDestino === undefined
                                  ? "…"
                                  : partesDestino === null
                                    ? "—"
                                    : <DestinoCompraFinalBadges partes={partesDestino} />}
                                {(live === undefined || sugestaoAtual.ideal) ? (
                                  <span style={{ marginLeft: 6 }}>
                                    <CompraIdealCell
                                      ideal={sugestaoAtual.ideal}
                                      loading={live === undefined}
                                      cor={it.corProduto}
                                    />
                                  </span>
                                ) : null}
                                {qtdSugerida !== null && qtdSugerida !== effectiveQtdManual && (() => {
                                  const diff = qtdSugerida - effectiveQtdManual;
                                  const diffFmt = `${diff > 0 ? "+" : ""}${diff}`;
                                  const explicacao =
                                    diff > 0
                                      ? "Sugestão atual maior que a quantidade salva"
                                      : "Sugestão atual menor que a quantidade salva";
                                  const total12m = (vendasRowsK ?? []).reduce((s, r) => s + (r.qtde12m ?? 0), 0);
                                  const total60d = (vendasRowsK ?? []).reduce((s, r) => s + (r.qtde60d ?? 0), 0);
                                  const mediaMensal12m = total12m / 12;
                                  const ritmoMensal60d = total60d / 2;
                                  const tendenciaTexto =
                                    mediaMensal12m <= 0
                                      ? "Sem base de vendas para tendência."
                                      : ritmoMensal60d >= mediaMensal12m
                                        ? `Ritmo recente acima/igual da média (${ritmoMensal60d.toFixed(1)} vs ${mediaMensal12m.toFixed(1)} un/mês).`
                                        : `Ritmo recente abaixo da média (${ritmoMensal60d.toFixed(1)} vs ${mediaMensal12m.toFixed(1)} un/mês).`;
                                  const ajusteDestinoTexto =
                                    partesDestinoSugerido === undefined
                                      ? "Destino: aguardando dados de vendas por filial."
                                      : resumirAjusteEntreDestinos(partesDestino ?? null, partesDestinoSugerido);
                                  return (
                                    <span
                                      className={`${styles.badgeS} ${diff > 0 ? styles.badgeSDiffUp : styles.badgeSDiffDown}`}
                                      style={{ width: "auto", padding: "0 6px" }}
                                      aria-label={`Delta sugestão ${diffFmt}`}
                                      onMouseEnter={(e) => {
                                        setSugestaoDiffTooltip({
                                          x: e.clientX,
                                          y: e.clientY,
                                          diffFmt,
                                          explicacao,
                                          qtdSugerida,
                                          qtdManual: effectiveQtdManual,
                                          mediaMensal12m,
                                          ritmoMensal60d,
                                          tendenciaTexto,
                                          ajusteDestinoTexto,
                                          transitTotal: sugestaoAtual.transitTotal || undefined,
                                          transitDates: sugestaoAtual.transitDates,
                                        });
                                      }}
                                      onMouseLeave={() => setSugestaoDiffTooltip(null)}
                                    >
                                      Sug {diffFmt}
                                    </span>
                                  );
                                })()}
                              </div>
                              <div className={styles.manualConfirmedActions} data-pdf-hide="">
                                <button
                                  type="button"
                                  className={styles.manualToggleBtn}
                                  onClick={() => startManualEdit(it.itemKey, partesDestino)}
                                  title="Editar distribuição por filial manualmente"
                                >
                                  Manual
                                </button>
                              </div>
                            </div>
                          )}
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
                              const total = filiais.reduce((s, f) => s + Math.max(0, f.estoque ?? 0), 0);
                              setEstoqueTooltip({
                                x: e.clientX,
                                y: e.clientY,
                                produto,
                                corDescricao: expandirPorCor ? it.corDescricao : undefined,
                                filiais,
                                total,
                              });
                            };
                            if (cached) {
                              show(cached);
                              return;
                            }
                            const params = new URLSearchParams();
                            params.set("company", companyKey);
                            params.set("produto", produto);
                            if (corProduto) params.set("corProduto", corProduto);
                            fetchEstoquePorFilial(params)
                              .then((data) => {
                                setEstoquePorFilialCache((prev) => ({ ...prev, [cacheKey]: data }));
                                show(data);
                              })
                              .catch(() => show([]));
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
                        <td className={styles.right} data-pdf-hide="">
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => { void handleRemove(it.itemKey); }}
                            title="Remover"
                            aria-label="Remover"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M3 6h18" />
                              <path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                              <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                              <path d="M10 11v6" />
                              <path d="M14 11v6" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {estoqueTooltip && doc && (() => {
        const flipUp =
          typeof window !== "undefined" && estoqueTooltip.y > window.innerHeight * 0.55;
        const style: React.CSSProperties = flipUp
          ? { left: estoqueTooltip.x + 12, top: estoqueTooltip.y - 12, transform: "translateY(-100%)" }
          : { left: estoqueTooltip.x + 12, top: estoqueTooltip.y + 12 };
        return (
        <div
          className={styles.tooltipEstoque}
          style={style}
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
                    <span className={`${styles.tooltipEstoqueFilialQtd}${f.estoque < 0 ? ` ${styles.negative}` : ""}`}>
                      {fmt(f.estoque)}
                    </span>
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
        );
      })()}
      {sugestaoDiffTooltip && (
        <div
          className={styles.tooltipEstoque}
          style={{ left: sugestaoDiffTooltip.x + 12, top: sugestaoDiffTooltip.y + 12 }}
        >
          <div className={styles.tooltipEstoqueHeader}>Delta da sugestão</div>
          <div className={styles.tooltipLine}>
            <strong>Resultado:</strong> {sugestaoDiffTooltip.diffFmt}
          </div>
          <div className={styles.tooltipLine}>{sugestaoDiffTooltip.explicacao}</div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}>
            <strong>Sugerido atual:</strong> {fmt(sugestaoDiffTooltip.qtdSugerida)}
          </div>
          <div className={styles.tooltipLine}>
            <strong>Salvo manual:</strong> {fmt(sugestaoDiffTooltip.qtdManual)}
          </div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}>
            <strong>Media 12m:</strong> {sugestaoDiffTooltip.mediaMensal12m.toFixed(1)} un/mes
          </div>
          <div className={styles.tooltipLine}>
            <strong>Ritmo 60d:</strong> {sugestaoDiffTooltip.ritmoMensal60d.toFixed(1)} un/mes
          </div>
          <div className={styles.tooltipLine}>{sugestaoDiffTooltip.tendenciaTexto}</div>
          <div className={styles.tooltipDivider} />
          <div className={styles.tooltipLine}>
            <strong>Como ajustar por filial:</strong>
          </div>
          <div className={styles.tooltipLine}>{sugestaoDiffTooltip.ajusteDestinoTexto}</div>
          {sugestaoDiffTooltip.transitTotal ? (
            <>
              <div className={styles.tooltipDivider} />
              <div className={styles.tooltipLine}>
                <strong style={{ color: "#0f766e" }}>+{fmt(sugestaoDiffTooltip.transitTotal)} em trânsito</strong>
              </div>
              {sugestaoDiffTooltip.transitDates?.map((label) => (
                <div key={label} className={styles.tooltipLine} style={{ color: "#0f766e", fontSize: 11 }}>
                  {label}
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoSTooltip && (
        <div
          className={styles.metricTooltip}
          style={getTooltipViewportPosition(sugestaoSTooltip.x, sugestaoSTooltip.y)}
        >
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
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>
                  {label}
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoETooltip && (
        <div
          className={styles.metricTooltip}
          style={getTooltipViewportPosition(sugestaoETooltip.x, sugestaoETooltip.y)}
        >
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
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>
                  {label}
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}
      {sugestaoPOTooltip && (
        <div
          className={styles.metricTooltip}
          style={getTooltipViewportPosition(sugestaoPOTooltip.x, sugestaoPOTooltip.y)}
        >
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
                <div key={label} className={styles.metricTooltipLine} style={{ color: "#0d9488", fontSize: 11 }}>
                  {label}
                </div>
              ))}
            </>
          ) : null}
        </div>
      )}

    </div>
  );
}


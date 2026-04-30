"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
// @ts-ignore
import * as XLSX from "xlsx";

import {
  aggregateVendasPorFilialByDisplayLabel,
  compareFilialDisplayOrder,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";
import type { CompraSalva, CompraSalvaItemRow } from "@/lib/types/compra-salva";
import {
  partesDestinoCompraFinal,
  textoDestinoCompraFinal,
  type DestinoCompraFinalParte,
} from "@/lib/utils/compra-final-destino";

import styles from "./ListaCompraSugeridaPage.module.css";

interface ProdutoSugestao {
  produto: string;
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

function getLimiteDiasReposicao(p: { linha?: string; subgrupo?: string }) {
  const linha = normalizeKey(p.linha);
  const subgrupo = normalizeKey(p.subgrupo);
  if (linha === "INDIA") return 90;
  const subgrupos90 = new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]);
  if (subgrupos90.has(subgrupo)) return 90;
  return 60;
}

// Extrai o codFilial do sourceContextKey no formato "lista-loja:{company}:{filial}:{id}"
function parseListaLojaFilial(sourceContextKey: string): string | null {
  if (!sourceContextKey.startsWith("lista-loja:")) return null;
  const parts = sourceContextKey.split(":");
  const filialCtx = parts[2] ?? "";
  if (!filialCtx || filialCtx === "__TODAS__" || filialCtx === "sem-filial") return null;
  return filialCtx;
}

interface SugestaoItemInput {
  vendasMesAtual?: number | null;
  estoqueFilial?: number | null;
  qtde12m?: number | null;
  mesesHistoricoFilial?: number | null;
  diasDesdeUltimaVenda?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
}

function getMesesHistorico(item: Pick<SugestaoItemInput, "mesesHistoricoFilial">): number {
  const meses = Number(item.mesesHistoricoFilial ?? 12);
  if (!Number.isFinite(meses)) return 12;
  return Math.min(12, Math.max(1, meses));
}

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
  } | undefined
): number | null {
  if (!match) return null;
  if (liveData === undefined) return null; // aguarda dados live — não usa fallback de match
  const diasCorridosMes = new Date().getDate();
  const item: SugestaoItemInput = {
    vendasMesAtual: liveData.vendasMesAtual,
    estoqueFilial: liveData.estoqueAtual,
    qtde12m: liveData.qtde12m,
    mesesHistoricoFilial: liveData.mesesHistoricoFilial,
    diasDesdeUltimaVenda: liveData.diasDesdeUltimaVenda,
    linha: match.linha,   // atributo do produto, não depende de filial
    subgrupo: match.subgrupo,
  };

  // Regra Compra: consumo corrente insuficiente para cobrir o período de reposição
  const vendasMes = Number(item.vendasMesAtual ?? 0);
  const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const limiteDias = getLimiteDiasReposicao({ linha: item.linha ?? undefined, subgrupo: item.subgrupo ?? undefined });
  const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;

  // Regra S: pré-computa para aplicar blend quando Final < 60% de S
  const mesesHistorico = getMesesHistorico(item);
  const mediaVendasMes = Number(item.qtde12m ?? 0) / mesesHistorico;
  const sEligivel = mediaVendasMes >= 1 && estoqueAtual <= mediaVendasMes * 2;
  const qtdS = sEligivel ? Math.max(0, Math.ceil((limiteDias / 30) * mediaVendasMes)) : 0;

  if (consumoDiario > 0 && duracaoAtual < limiteDias) {
    const qtdFinal = Math.ceil(consumoDiario * (limiteDias - duracaoAtual));
    if (qtdFinal > 0) {
      if (qtdS > 0 && qtdFinal < 0.6 * qtdS) {
        return Math.round(0.8 * qtdS + 0.4 * qtdFinal);
      }
      return qtdFinal;
    }
  }

  const qtdSuficiente = consumoDiario > 0 && duracaoAtual >= limiteDias;
  if (qtdSuficiente) return null;

  if (qtdS > 0) return qtdS;

  // Regra E: produto parado por falta de estoque (estoque <= 0, dias sem venda >= 30)
  const qtde12m = Number(item.qtde12m ?? 0);
  const diasSemVenda = item.diasDesdeUltimaVenda;
  if (qtde12m > 0 && estoqueAtual <= 0 && diasSemVenda != null && diasSemVenda >= 30) {
    const mesesSemVenda = diasSemVenda / 30;
    const mesesAtivos = mesesHistorico - mesesSemVenda;
    if (mesesAtivos >= 1) {
      const velocidadeAjustada = qtde12m / mesesAtivos;
      if (velocidadeAjustada >= 0.5) {
        const qtdE = Math.max(1, Math.ceil((limiteDias / 30) * velocidadeAjustada));
        return qtdE;
      }
    }
  }

  return null;
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

async function fetchEstoquePorFilial(params: URLSearchParams): Promise<Array<{ filial: string; estoque: number }>> {
  const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: Array<{ filial: string; estoque: number }>; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar estoque por filial");
  return json.data ?? [];
}

async function fetchVendasPorFilialItem(
  params: URLSearchParams
): Promise<Array<{ filial: string; qtde12m: number; qtde60d: number }>> {
  const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: Array<{ filial: string; qtde12m: number; qtde60d: number }>; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar vendas por filial");
  return json.data ?? [];
}

async function fetchVendasItemMetricas(params: URLSearchParams): Promise<{
  qtde12m: number;
  qtde60d: number;
  vendasMesAtual: number;
  diasDesdeUltimaVenda: number | null;
  mesesHistoricoFilial: number | null;
} | null> {
  const res = await fetch(`/api/controle-estoque/vendas-por-filial-item?${params}`, { cache: "no-store" });
  const json = await res.json() as {
    data?: Array<{
      qtde12m: number;
      qtde60d: number;
      qtdeMesAtual?: number;
      diasDesdeUltimaVenda?: number | null;
      mesesHistoricoFilial?: number;
    }>;
    error?: string;
  };
  if (!res.ok) return null;
  const rows = json.data ?? [];
  if (rows.length === 0) return null;

  // Quando vem uma única filial, usa direto; quando agrega múltiplas usa max de histórico e min de dias
  const diasVals = rows.map((r) => r.diasDesdeUltimaVenda ?? null).filter((v): v is number => v !== null);
  const mesesVals = rows.map((r) => Number(r.mesesHistoricoFilial ?? 0)).filter((v) => v > 0);
  return {
    qtde12m: Math.round(rows.reduce((s, r) => s + Number(r.qtde12m ?? 0), 0)),
    qtde60d: Math.round(rows.reduce((s, r) => s + Number(r.qtde60d ?? 0), 0)),
    vendasMesAtual: Math.round(rows.reduce((s, r) => s + Number(r.qtdeMesAtual ?? 0), 0)),
    diasDesdeUltimaVenda: diasVals.length > 0 ? Math.min(...diasVals) : null,
    mesesHistoricoFilial: mesesVals.length > 0 ? Math.max(...mesesVals) : null,
  };
}

async function fetchEstoqueFilialSum(params: URLSearchParams): Promise<number | null> {
  const res = await fetch(`/api/controle-estoque/estoque-por-filial-item?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: Array<{ estoque: number }>; error?: string };
  if (!res.ok) return null;
  const rows = json.data ?? [];
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
  const searchParams = useSearchParams();
  const fromListaLoja = searchParams.get("from") === "lista-loja";
  const listBack = fromListaLoja
    ? `/${companySlug}/lista-loja?view=compras-salvas`
    : `/${companySlug}/controle-estoque/projecao/lista-compra?tab=compras-salvas`;
  const [doc, setDoc] = useState<CompraSalva | null>(null);
  const [items, setItems] = useState<CompraSalvaItemRow[]>([]);
  const [titleEdit, setTitleEdit] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listaRows, setListaRows] = useState<ProdutoSugestao[]>([]);
  const [liveMetrics, setLiveMetrics] = useState<Record<string, { qtde12m: number | null; vendasMesAtual: number | null; estoqueAtual: number | null; diasDesdeUltimaVenda: number | null; mesesHistoricoFilial: number | null }>>({});
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
  const compraSalvaExportRef = useRef<HTMLDivElement>(null);

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
      void fetchVendasPorFilialItem(params)
        .then((data) => {
          const norm = normalizeVendasPorFilialParaExibicao(companyKey, data);
          setVendasPorFilialCache((p) => ({ ...p, [cacheKey]: norm }));
        })
        .catch(() => setVendasPorFilialCache((p) => ({ ...p, [cacheKey]: [] })));
    });
  }, [doc, items, expandirPorCor, companyKey, vendasRefreshKey]);

  const rowsComputed = useMemo(() => {
    return items.map((it) => {
      const produto = it.produto.trim();
      const corProduto = (it.corProduto ?? "").trim();
      const match = listaRows.find((p) => {
        const pProd = (p.produto ?? "").trim();
        const pCor = (p.cor ?? "").trim();
        return pProd === produto && (expandirPorCor ? pCor === corProduto : true);
      });
      const cacheKey = `${produto}||${expandirPorCor ? corProduto : ""}`;
      const live = liveMetrics[cacheKey];
      const estoque = live?.estoqueAtual ?? match?.estoqueAtual ?? null;
      const custoUnit = match?.custoUnitario ?? 0;
      const custoTotal = custoUnit > 0 ? Math.round(it.qtdManual * custoUnit) : 0;
      const qtdSugerida = calcularSugestaoCompleto(match, live);
      return { it, match, estoque, custoUnit, custoTotal, qtdSugerida };
    });
  }, [items, listaRows, expandirPorCor, liveMetrics]);

  const totals = useMemo(() => {
    const totalItens = items.length;
    // Usa qtdSugerida quando disponível, incorporando a diferença no total
    const totalQtdManual = rowsComputed.reduce(
      (s, r) => s + (r.qtdSugerida !== null ? r.qtdSugerida : (r.it.qtdManual ?? 0)),
      0
    );
    const totalCusto = rowsComputed.reduce((s, r) => s + (r.custoTotal ?? 0), 0);
    return { totalItens, totalQtdManual, totalCusto };
  }, [items, rowsComputed]);

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
    const params = new URLSearchParams();
    params.set("company", companyKey);
    await fetch(`/api/controle-estoque/compras-salvas/${compraId}?${params}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ removeItemKey: itemKey }),
    });
    setItems((prev) => prev.filter((i) => i.itemKey !== itemKey));
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

  const handleExportXlsx = () => {
    const rowExcel = rowsComputed.map(({ it, estoque, custoUnit, custoTotal }) => {
      const produtoK = it.produto.trim();
      const corK = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
      const vendasKey = `${produtoK}||${corK ?? ""}`;
      const vendasRows = vendasPorFilialCache[vendasKey];
      const destino =
        vendasRows !== undefined ? textoDestinoCompraFinal(it.qtdManual ?? 0, vendasRows, companyKey) : "";
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
        const safeName = (doc?.title ?? "compra-salva").replace(/[^\w\-]+/g, "_").slice(0, 80);
        pdf.save(`${safeName}.pdf`);
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

      const safeName = (doc?.title ?? "compra-salva").replace(/[^\w\-]+/g, "_").slice(0, 80);
      pdf.save(`${safeName}.pdf`);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className={styles.wrapper}>
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
          <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end" }}>
            <Link href={listBack} className={styles.backButton}>
              ← Compras salvas
            </Link>
            <button type="button" className={styles.backButton} onClick={() => { void handleDeleteCompra(); }}>
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
            <div className={styles.exportActions}>
              <button type="button" className={styles.exportBtn} onClick={handleExportXlsx}>
                Exportar XLSX
              </button>
              <button
                type="button"
                className={styles.exportBtn}
                disabled={exportingPdf || items.length === 0}
                onClick={() => { void handleExportPdf(); }}
              >
                {exportingPdf ? "Exportando PDF…" : "Exportar PDF"}
              </button>
            </div>
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
                    <th style={{ width: 60 }} />
                  </tr>
                </thead>
                <tbody>
                  {rowsComputed.map(({ it, estoque, custoUnit, custoTotal, qtdSugerida }) => {
                    const produtoK = it.produto.trim();
                    const corK = expandirPorCor ? ((it.corProduto ?? "").trim() || undefined) : undefined;
                    const vendasKey = `${produtoK}||${corK ?? ""}`;
                    const vendasRowsK = vendasPorFilialCache[vendasKey];
                    const partesDestino =
                      vendasRowsK === undefined
                        ? undefined
                        : partesDestinoCompraFinal(it.qtdManual ?? 0, vendasRowsK, companyKey);
                    const partesDestinoSugerido =
                      vendasRowsK === undefined || qtdSugerida === null
                        ? undefined
                        : partesDestinoCompraFinal(qtdSugerida, vendasRowsK, companyKey);
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
                              setItems((prev) => prev.map((x) => (x.itemKey === it.itemKey ? { ...x, qtdManual: v } : x)));
                            }}
                            onBlur={() => { void handleUpdateQtd(it.itemKey, it.qtdManual); }}
                          />
                        </td>
                        <td className={styles.destinoCell}>
                          <div className={styles.destinoCellInner}>
                            {partesDestino === undefined
                              ? "…"
                              : partesDestino === null
                                ? "—"
                                : <DestinoCompraFinalBadges partes={partesDestino} />}
                            {qtdSugerida !== null && qtdSugerida !== it.qtdManual && (() => {
                              const diff = qtdSugerida - it.qtdManual;
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
                                      qtdManual: it.qtdManual ?? 0,
                                      mediaMensal12m,
                                      ritmoMensal60d,
                                      tendenciaTexto,
                                      ajusteDestinoTexto,
                                    });
                                  }}
                                  onMouseLeave={() => setSugestaoDiffTooltip(null)}
                                >
                                  Sug {diffFmt}
                                </span>
                              );
                            })()}
                          </div>
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
                        <td className={styles.right}>
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={() => { void handleRemove(it.itemKey); }}
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
            </div>
          )}
        </div>
      )}

      {estoqueTooltip && doc && (
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
      )}
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
        </div>
      )}
    </div>
  );
}

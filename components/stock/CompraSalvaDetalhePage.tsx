"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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

import styles from "./ListaCompraSugeridaPage.module.css";

interface ProdutoSugestao {
  produto: string;
  cor?: string;
  corDescricao?: string;
  descricao: string;
  grade?: string;
  colecao?: string;
  custoUnitario?: number;
  estoqueAtual?: number;
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

type DestinoCompraFinalParte = { label: string; qtd: number };

function normalizeVendasPorFilialParaExibicao(
  companyKey: CompanyKey,
  rows: Array<{ filial: string; qtde12m: number; qtde60d: number }>
): Array<{ filial: string; qtde12m: number; qtde60d: number }> {
  const cfg = resolveCompany(companyKey);
  const merged = aggregateVendasPorFilialByDisplayLabel(rows, cfg);
  return [...merged].sort((a, b) => compareFilialDisplayOrder(a.filial, b.filial, cfg));
}

function partesDestinoCompraFinal(
  qtdManual: number,
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>,
  companyKey: CompanyKey
): DestinoCompraFinalParte[] | null {
  if (qtdManual <= 0) return null;
  const cfg = resolveCompany(companyKey);
  const agregadas = aggregateVendasPorFilialByDisplayLabel(
    vendasPorFilial.map((r) => ({
      filial: r.filial,
      qtde12m: r.qtde12m,
      qtde60d: r.qtde60d ?? 0,
    })),
    cfg
  );

  const medias = agregadas.map((r) => ({
    filial: r.filial,
    m: r.qtde12m / 12,
  }));
  const somaM = medias.reduce((s, r) => s + r.m, 0);
  if (somaM <= 0) {
    return [{ label: "MATRIZ", qtd: qtdManual }];
  }

  const pisos = medias.map((r) => ({
    filial: r.filial,
    piso: Math.floor((qtdManual * r.m) / somaM),
  }));
  const somaPisos = pisos.reduce((s, r) => s + r.piso, 0);
  const sobra = qtdManual - somaPisos;

  let qtdMatriz = sobra;
  const outras: DestinoCompraFinalParte[] = [];
  for (const row of pisos) {
    if (row.filial === "MATRIZ") {
      qtdMatriz += row.piso;
    } else if (row.piso > 0) {
      outras.push({ label: row.filial, qtd: row.piso });
    }
  }

  outras.sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));

  const partes: DestinoCompraFinalParte[] = [];
  if (qtdMatriz > 0) partes.push({ label: "MATRIZ", qtd: qtdMatriz });
  partes.push(...outras);

  return partes;
}

function textoDestinoCompraFinal(
  qtdManual: number,
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>,
  companyKey: CompanyKey
): string {
  const partesH = partesDestinoCompraFinal(qtdManual, vendasPorFilial, companyKey);
  if (partesH === null) return "—";
  return partesH.map((p) => `${p.label}: ${fmt(p.qtd)}`).join(" · ");
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
  const [doc, setDoc] = useState<CompraSalva | null>(null);
  const [items, setItems] = useState<CompraSalvaItemRow[]>([]);
  const [titleEdit, setTitleEdit] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listaRows, setListaRows] = useState<ProdutoSugestao[]>([]);
  const [estoquePorFilialCache, setEstoquePorFilialCache] = useState<
    Record<string, Array<{ filial: string; estoque: number }>>
  >({});
  const [vendasPorFilialCache, setVendasPorFilialCache] = useState<
    Record<string, Array<{ filial: string; qtde12m: number; qtde60d: number }>>
  >({});
  const vendasPorFilialCacheRef = useRef(vendasPorFilialCache);
  vendasPorFilialCacheRef.current = vendasPorFilialCache;
  const destinoVendasFetchRef = useRef(new Set<string>());

 S  const expandirPorCor = doc?.expandirPorCor ?? true;

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

  useEffect(() => {
    if (!doc || items.length === 0) return;
    destinoVendasFetchRef.current.clear();
    setVendasPorFilialCache({});
  }, [doc?.id, expandirPorCor]);

  useEffect(() => {
    if (!doc || items.length === 0) return;
    const produtos = [...new Set(items.map((i) => i.produto.trim()).filter(Boolean))];
    if (produtos.length === 0) return;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    params.set("limit", "8000");
    params.set("qtdCompra", "0");
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
  }, [doc, items, expandirPorCor, companyKey]);

  const rowsComputed = useMemo(() => {
    return items.map((it) => {
      const produto = it.produto.trim();
      const corProduto = (it.corProduto ?? "").trim();
      const match = listaRows.find((p) => {
        const pProd = (p.produto ?? "").trim();
        const pCor = (p.cor ?? "").trim();
        return pProd === produto && (expandirPorCor ? pCor === corProduto : true);
      });
      const estoque = match?.estoqueAtual ?? null;
      const custoUnit = match?.custoUnitario ?? 0;
      const custoTotal = custoUnit > 0 ? Math.round(it.qtdManual * custoUnit) : 0;
      return { it, match, estoque, custoUnit, custoTotal };
    });
  }, [items, listaRows, expandirPorCor]);

  const totals = useMemo(() => {
    const totalItens = items.length;
    const totalQtdManual = items.reduce((s, i) => s + (i.qtdManual ?? 0), 0);
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
      router.push(`/${companySlug}/controle-estoque/projecao/lista-compra?tab=compras-salvas`);
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

  const listBack = `/${companySlug}/controle-estoque/projecao/lista-compra?tab=compras-salvas`;

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
        <>
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
            <button type="button" className={styles.exportBtn} onClick={handleExportXlsx}>
              Exportar XLSX
            </button>
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
                  {rowsComputed.map(({ it, estoque, custoUnit, custoTotal }) => {
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
                              setItems((prev) => prev.map((x) => (x.itemKey === it.itemKey ? { ...x, qtdManual: v } : x)));
                            }}
                            onBlur={() => { void handleUpdateQtd(it.itemKey, it.qtdManual); }}
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
        </>
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
    </div>
  );
}

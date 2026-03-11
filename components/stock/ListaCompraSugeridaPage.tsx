"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CompanyKey } from "@/lib/config/company";
import styles from "./ListaCompraSugeridaPage.module.css";

interface ProdutoSugestao {
  produto: string;
  descricao: string;
  vendas3meses: number;
  valor3meses: number;
  percParticipacao: number;
  qtdSugerida: number;
}

type Curva = "A" | "B" | "C";

interface ProdutoComCurva extends ProdutoSugestao {
  curva: Curva;
  qtdFinal: number;
  percCumulativa: number;
}

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRL2(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function fetchListaCompra(params: URLSearchParams): Promise<ProdutoSugestao[]> {
  const res = await fetch(`/api/controle-estoque/lista-compra-sugerida?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: ProdutoSugestao[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar");
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

/** Calcula curva ABC por faturamento acumulado */
function calcularCurvas(produtos: ProdutoSugestao[], qtdCompra: number): ProdutoComCurva[] {
  const totalGeral = produtos.reduce((s, p) => s + p.valor3meses, 0);
  let cumulative = 0;

  const comCurva = produtos.map((p): ProdutoComCurva => {
    cumulative += p.valor3meses;
    const percCum = totalGeral > 0 ? cumulative / totalGeral : 1;
    const curva: Curva = percCum <= 0.80 ? "A" : percCum <= 0.95 ? "B" : "C";
    return { ...p, curva, qtdFinal: 0, percCumulativa: percCum };
  });

  // Redistribuir qtdCompra apenas entre curva A usando Hamilton
  const curvaA = comCurva.filter(p => p.curva === "A");
  const qtds = hamiltonDistribute(curvaA.map(p => ({ valor: p.valor3meses })), qtdCompra);
  const qtdMap = new Map(curvaA.map((p, i) => [p.produto, qtds[i]]));

  return comCurva.map(p => ({
    ...p,
    qtdFinal: p.curva === "A" ? (qtdMap.get(p.produto) ?? 0) : 0,
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

export default function ListaCompraSugeridaPage({ companyKey }: { companyKey: CompanyKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const categoria = searchParams.get("categoria") ?? "";
  const qtdCompra = Number(searchParams.get("qtdCompra") ?? "0");
  const filial = searchParams.get("filial") ?? "";

  const [produtos, setProdutos] = useState<ProdutoSugestao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams();
    params.set("company", companyKey);
    if (filial) params.set("filial", filial);
    if (categoria) params.set("categoria", categoria);
    params.set("qtdCompra", String(qtdCompra));

    searchParams.getAll("grupos").forEach((g) => params.append("grupos", g));
    searchParams.getAll("linhas").forEach((l) => params.append("linhas", l));
    searchParams.getAll("colecoes").forEach((c) => params.append("colecoes", c));
    searchParams.getAll("subgrupos").forEach((s) => params.append("subgrupos", s));
    searchParams.getAll("grades").forEach((g) => params.append("grades", g));

    setLoading(true);
    setError(null);
    fetchListaCompra(params)
      .then(setProdutos)
      .catch((e) => setError(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoading(false));
  }, [companyKey, searchParams, categoria, qtdCompra, filial]);

  const produtosComCurva = useMemo(
    () => (produtos.length > 0 ? calcularCurvas(produtos, qtdCompra) : []),
    [produtos, qtdCompra]
  );

  const totalCusto = produtosComCurva.reduce((s, p) => {
    if (p.qtdFinal <= 0 || p.vendas3meses <= 0) return s;
    return s + p.qtdFinal * (p.valor3meses / p.vendas3meses);
  }, 0);
  const maxPerc = produtosComCurva.length > 0 ? produtosComCurva[0].percParticipacao : 1;

  const countA = produtosComCurva.filter(p => p.curva === "A").length;
  const countB = produtosComCurva.filter(p => p.curva === "B").length;
  const countC = produtosComCurva.filter(p => p.curva === "C").length;

  const groups: Curva[] = ["A", "B", "C"];

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
                Produtos mais vendidos nos últimos 60 dias — distribuição proporcional (curva A)
              </p>
            </div>
          </div>
          <button type="button" className={styles.backButton} onClick={() => {
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
          }}>
            ← Voltar
          </button>
        </div>
      </div>

      {/* Summary */}
      {!loading && !error && (
        <div className={styles.summaryCard}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>QTD a Comprar</span>
            <span className={styles.summaryValue}>{fmt(qtdCompra)}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Custo Total</span>
            <span className={styles.summaryValue}>{fmtBRL(totalCusto)}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Período Base</span>
            <span className={styles.summaryValueNeutral}>Últimos 60 dias</span>
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

      {/* Table */}
      <div className={styles.tableCard}>
        {loading && <div className={styles.loading}>Calculando lista de compra...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {!loading && !error && produtosComCurva.length === 0 && (
          <div className={styles.empty}>Nenhum produto encontrado para este filtro.</div>
        )}
        {!loading && !error && produtosComCurva.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Produto</th>
                <th className={styles.right}>Faturamento 60 dias</th>
                <th className={styles.right}>Qtd vendida</th>
                <th className={styles.right}>Participação</th>
                <th className={styles.right}>Qtd Sugerida</th>
                <th className={styles.right}>Custo Unit.</th>
                <th className={styles.right}>Custo Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map(curva => {
                const grupo = produtosComCurva.filter(p => p.curva === curva);
                if (grupo.length === 0) return null;
                return (
                  <React.Fragment key={curva}>
                    {/* Separador de seção */}
                    <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                      <td colSpan={8}>
                        <div className={styles.sectionLabel}>
                          <span className={`${styles.curvaBadge} ${CURVA_BADGE_CLASS[curva]}`}>{curva}</span>
                          <span className={styles.sectionTitle}>{CURVA_LABEL[curva]}</span>
                          <span className={styles.sectionCount}>{grupo.length} produtos</span>
                          {curva === "A" && (
                            <span className={styles.sectionNote}>← compra distribuída aqui</span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {grupo.map((p, i) => {
                      const rankGlobal = produtosComCurva.indexOf(p) + 1;
                      return (
                        <tr key={p.produto} className={curva !== "A" ? styles.rowDimmed : ""}>
                          <td>
                            <span className={`${styles.rank} ${i < 3 && curva === "A" ? styles.top : ""}`}>
                              {rankGlobal}
                            </span>
                          </td>
                          <td>
                            <div className={styles.productName}>{p.descricao || p.produto}</div>
                            {p.descricao && p.produto !== p.descricao && (
                              <div className={styles.productCode}>{p.produto}</div>
                            )}
                          </td>
                          <td className={styles.vendas}>{fmtBRL(p.valor3meses)}</td>
                          <td className={styles.vendas}>{fmt(p.vendas3meses)}</td>
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
                          <td className={p.qtdFinal > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}>
                            {p.qtdFinal > 0 ? fmt(p.qtdFinal) : "—"}
                          </td>
                          <td className={`${styles.right} ${p.qtdFinal > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                            {p.qtdFinal > 0 && p.vendas3meses > 0 ? fmtBRL2(p.valor3meses / p.vendas3meses) : "—"}
                          </td>
                          <td className={`${styles.right} ${p.qtdFinal > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                            {p.qtdFinal > 0 && p.vendas3meses > 0 ? fmtBRL(p.qtdFinal * (p.valor3meses / p.vendas3meses)) : "—"}
                          </td>
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
  );
}

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import type { CompanyKey } from "@/lib/config/company";
import styles from "./ListaCompraSugeridaPage.module.css";

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
  descricao: string;
  vendas3meses: number;
  valor3meses: number;
  /** Custo de reposição (cadastro), não preço médio de venda */
  custoUnitario?: number;
  estoqueAtual?: number;
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

// ─── ABC helpers (usados apenas na aba Análise ABC) ───────────────────────────

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

const DIAS_META = 120;

// ─── Componente principal ─────────────────────────────────────────────────────

export default function ListaCompraSugeridaPage({ companyKey }: { companyKey: CompanyKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const categoria = searchParams.get("categoria") ?? "";
  const qtdCompra = Number(searchParams.get("qtdCompra") ?? "0");
  const filial = searchParams.get("filial") ?? "";
  const mode = searchParams.get("mode") ?? "";

  const [activeTab, setActiveTab] = useState<"reposicao" | "abc">("reposicao");

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

  const totalCustoReposicao = reposicaoComCusto.reduce((s, i) => s + i.custoTotal, 0);
  const totalQtdReposicao = reposicaoComCusto.reduce((s, i) => s + i.qtdCompra, 0);

  // ── Aba ABC ────────────────────────────────────────────────────────────────
  const [produtosABC, setProdutosABC] = useState<ProdutoSugestao[]>([]);
  const [loadingABC, setLoadingABC] = useState(false);
  const [errorABC, setErrorABC] = useState<string | null>(null);
  const [abcLoaded, setAbcLoaded] = useState(false);
  const [modoReposicao, setModoReposicao] = useState(false);
  const [incluirCurvaB, setIncluirCurvaB] = useState(false);
  const [incluirCurvaC, setIncluirCurvaC] = useState(false);

  useEffect(() => {
    if (activeTab !== "abc" || abcLoaded) return;
    const params = new URLSearchParams();
    params.set("company", companyKey);
    if (filial) params.set("filial", filial);
    if (categoria) params.set("categoria", categoria);
    params.set("qtdCompra", String(qtdCompra));
    params.set("limit", "2000");
    searchParams.getAll("grupos").forEach((g) => params.append("grupos", g));
    searchParams.getAll("linhas").forEach((l) => params.append("linhas", l));
    searchParams.getAll("colecoes").forEach((c) => params.append("colecoes", c));
    searchParams.getAll("subgrupos").forEach((s) => params.append("subgrupos", s));
    searchParams.getAll("grades").forEach((g) => params.append("grades", g));

    setLoadingABC(true);
    setErrorABC(null);
    fetchListaCompra(params)
      .then(data => { setProdutosABC(data); setAbcLoaded(true); })
      .catch((e) => setErrorABC(e instanceof Error ? e.message : "Erro"))
      .finally(() => setLoadingABC(false));
  }, [activeTab, abcLoaded, companyKey, searchParams, categoria, qtdCompra, filial]);

  const produtosComCurva = useMemo(
    () => (produtosABC.length > 0 ? calcularCurvas(produtosABC, qtdCompra) : []),
    [produtosABC, qtdCompra]
  );

  // Modo Reposição Real: calcula qtd individualmente por produto (meta DIAS_META dias de cobertura)
  const produtosComCurvaFinal = useMemo((): ProdutoComCurva[] => {
    if (!modoReposicao) return produtosComCurva;
    return produtosComCurva.map(p => {
      const curvaAtiva =
        p.curva === "A" ||
        (p.curva === "B" && incluirCurvaB) ||
        (p.curva === "C" && incluirCurvaC);
      if (!curvaAtiva) return { ...p, qtdFinal: 0, qtdSuficiente: false };
      const consumoDiario = p.vendas3meses / 365;
      if (consumoDiario <= 0) return { ...p, qtdFinal: 0, qtdSuficiente: false };
      const estoqueAtual = p.estoqueAtual ?? 0;
      const duracaoAtual = estoqueAtual / consumoDiario;
      if (duracaoAtual >= DIAS_META) return { ...p, qtdFinal: 0, qtdSuficiente: true };
      const qtd = Math.ceil(consumoDiario * (DIAS_META - duracaoAtual));
      return { ...p, qtdFinal: qtd, qtdSuficiente: false };
    });
  }, [produtosComCurva, modoReposicao, incluirCurvaB, incluirCurvaC]);

  const totalCustoABC = produtosComCurvaFinal.reduce((s, p) => {
    if (p.qtdFinal <= 0) return s;
    const cu = p.custoUnitario ?? 0;
    return cu > 0 ? s + p.qtdFinal * cu : s;
  }, 0);
  const totalQtdABC = produtosComCurvaFinal.reduce((s, p) => s + p.qtdFinal, 0);
  const maxPerc = produtosComCurva.length > 0 ? produtosComCurva[0].percParticipacao : 1;
  const countA = produtosComCurva.filter(p => p.curva === "A").length;
  const countB = produtosComCurva.filter(p => p.curva === "B").length;
  const countC = produtosComCurva.filter(p => p.curva === "C").length;
  const groups: Curva[] = ["A", "B", "C"];

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
            onClick={() => setActiveTab("reposicao")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
            </svg>
            Reposição Necessária
          </button>
          <button
            type="button"
            className={`${styles.tab} ${activeTab === "abc" ? styles.tabActive : ""}`}
            onClick={() => setActiveTab("abc")}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10" /><line x1="12" y1="20" x2="12" y2="4" /><line x1="6" y1="20" x2="6" y2="14" />
            </svg>
            Análise ABC
            <span className={styles.tabBadgeInfo}>visual</span>
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
                <span className={styles.summaryValueNeutral}>{reposicaoData.itens.length}</span>
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
                        <span className={styles.sectionCount}>{reposicaoData.itens.length} produto(s)</span>
                      </div>
                    </td>
                  </tr>
                  {reposicaoComCusto.map((item, i) => (
                    <tr key={`${item.produto}-${item.cor ?? ""}-${i}`}>
                      <td>
                        <span className={`${styles.rank} ${i < 3 ? styles.top : ""}`}>{i + 1}</span>
                      </td>
                      <td>
                        <div className={styles.productName}>{item.descricao || item.produto}</div>
                        <div className={styles.productCode}>{item.produto}</div>
                        {item.cor && <div className={styles.productCode}>{item.cor}</div>}
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
                  {reposicaoComCusto.length > 1 && (
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
              <span className={styles.toggleLabelText}>Cálculo por Reposição Real</span>
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
                  Meta: {DIAS_META} dias de cobertura mínima
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
                  {modoReposicao ? `${DIAS_META} dias mínimo` : "Últimos 12 meses"}
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
          <div className={styles.tableCard}>
            {loadingABC && <div className={styles.loading}>Carregando análise ABC...</div>}
            {errorABC && <div className={styles.error}>{errorABC}</div>}
            {!loadingABC && !errorABC && produtosComCurva.length === 0 && (
              <div className={styles.empty}>Nenhum produto encontrado para este filtro.</div>
            )}
            {!loadingABC && !errorABC && produtosComCurva.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th>Produto</th>
                    <th className={styles.right}>Vendas 12 meses</th>
                    <th className={styles.right}>Qtd vendida</th>
                    <th className={styles.right}>Estoque</th>
                    <th className={styles.right}>Duração</th>
                    <th className={styles.right}>Participação</th>
                    <th className={styles.right}>{modoReposicao ? "Qtd a Repor" : "Qtd Proporcional"}</th>
                    <th className={styles.right}>Custo Unit.</th>
                    <th className={styles.right}>Custo Total</th>
                  </tr>
                </thead>
                <tbody>
                  {groups.map(curva => {
                    const grupo = produtosComCurvaFinal.filter(p => p.curva === curva);
                    if (grupo.length === 0) return null;
                    const curvaAtivaModo =
                      curva === "A" ||
                      (curva === "B" && modoReposicao && incluirCurvaB) ||
                      (curva === "C" && modoReposicao && incluirCurvaC);
                    return (
                      <React.Fragment key={curva}>
                        <tr className={`${styles.sectionRow} ${styles[`sectionRow${curva}`]}`}>
                          <td colSpan={10}>
                            <div className={styles.sectionLabel}>
                              <span className={`${styles.curvaBadge} ${CURVA_BADGE_CLASS[curva]}`}>{curva}</span>
                              <span className={styles.sectionTitle}>{CURVA_LABEL[curva]}</span>
                              <span className={styles.sectionCount}>{grupo.length} produtos</span>
                              {curva === "A" && (
                                <span className={styles.sectionNote}>
                                  {modoReposicao ? `← meta: ${DIAS_META} dias` : "← referência proporcional"}
                                </span>
                              )}
                              {modoReposicao && curva !== "A" && curvaAtivaModo && (
                                <span className={styles.sectionNoteIncluida}>← incluída na sugestão</span>
                              )}
                            </div>
                          </td>
                        </tr>
                        {grupo.map((p, i) => {
                          const rankGlobal = produtosComCurvaFinal.findIndex(fp => fp.produto === p.produto) + 1;
                          const isDimmed = !curvaAtivaModo;
                          return (
                            <tr key={p.produto} className={isDimmed ? styles.rowDimmed : ""}>
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
                              <td className={styles.right}>{p.estoqueAtual != null ? fmt(p.estoqueAtual) : "—"}</td>
                              <td className={styles.right}>
                                {(() => {
                                  const consumoDiario = p.vendas3meses / 365;
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
                              <td className={
                                p.qtdFinal > 0
                                  ? styles.qtdSugerida
                                  : p.qtdSuficiente
                                    ? styles.qtdSuficienteTag
                                    : styles.qtdSugeridaZero
                              }>
                                {p.qtdFinal > 0
                                  ? fmt(p.qtdFinal)
                                  : p.qtdSuficiente
                                    ? "quantidade suficiente"
                                    : "—"}
                              </td>
                              <td className={`${styles.right} ${p.qtdFinal > 0 && (p.custoUnitario ?? 0) > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                                {p.qtdFinal > 0 && (p.custoUnitario ?? 0) > 0 ? fmtBRL2(p.custoUnitario!) : "—"}
                              </td>
                              <td className={`${styles.right} ${p.qtdFinal > 0 && (p.custoUnitario ?? 0) > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}`}>
                                {p.qtdFinal > 0 && (p.custoUnitario ?? 0) > 0 ? fmtBRL(p.qtdFinal * p.custoUnitario!) : "—"}
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
        </>
      )}
    </div>
  );
}

"use client";

import React, { useEffect, useState } from "react";
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

function fmt(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

async function fetchListaCompra(params: URLSearchParams): Promise<ProdutoSugestao[]> {
  const res = await fetch(`/api/controle-estoque/lista-compra-sugerida?${params}`, { cache: "no-store" });
  const json = await res.json() as { data?: ProdutoSugestao[]; error?: string };
  if (!res.ok) throw new Error(json.error ?? "Erro ao carregar");
  return json.data ?? [];
}

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

  const maxPerc = produtos.length > 0 ? produtos[0].percParticipacao : 1;
  const totalSugerido = produtos.reduce((s, p) => s + p.qtdSugerida, 0);

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
                Produtos mais vendidos nos últimos 60 dias — distribuição proporcional
              </p>
            </div>
          </div>
          <button type="button" className={styles.backButton} onClick={() => router.back()}>
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
            <span className={styles.summaryLabel}>Total Distribuído</span>
            <span className={styles.summaryValue}>{fmt(totalSugerido)}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Produtos Listados</span>
            <span className={styles.summaryValueNeutral}>{produtos.length}</span>
          </div>
          <div className={styles.summaryDivider} />
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Período Base</span>
            <span className={styles.summaryValueNeutral}>Últimos 60 dias</span>
          </div>
        </div>
      )}

      {/* Table */}
      <div className={styles.tableCard}>
        {loading && <div className={styles.loading}>Calculando lista de compra...</div>}
        {error && <div className={styles.error}>{error}</div>}
        {!loading && !error && produtos.length === 0 && (
          <div className={styles.empty}>Nenhum produto encontrado para este filtro.</div>
        )}
        {!loading && !error && produtos.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 48 }}>#</th>
                <th>Produto</th>
                <th className={styles.right}>Faturamento 60 dias</th>
                <th className={styles.right}>Qtd vendida</th>
                <th className={styles.right}>Participação</th>
                <th className={styles.right}>Qtd Sugerida</th>
              </tr>
            </thead>
            <tbody>
              {produtos.map((p, i) => (
                <tr key={p.produto}>
                  <td>
                    <span className={`${styles.rank} ${i < 3 ? styles.top : ""}`}>
                      {i + 1}
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
                          className={styles.percBarFill}
                          style={{ width: `${Math.min(100, (p.percParticipacao / maxPerc) * 100)}%` }}
                        />
                      </div>
                      <span className={styles.percText}>{p.percParticipacao.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className={p.qtdSugerida > 0 ? styles.qtdSugerida : styles.qtdSugeridaZero}>
                    {p.qtdSugerida > 0 ? fmt(p.qtdSugerida) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

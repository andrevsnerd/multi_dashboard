"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { VendedorProdutoVendaItem } from "@/lib/repositories/vendedores-v2";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./VendedorDetalhePage.module.css";

interface VendedorProdutoDetalhePageProps {
  companyKey: CompanyKey;
  vendedorNome: string;
  filial: string;
  produtoCodigo: string;
  produtoDescricao: string;
  initialStart: string;
  initialEnd: string;
}

async function fetchVendas(
  vendedor: string,
  filial: string,
  produto: string,
  start: string,
  end: string
): Promise<VendedorProdutoVendaItem[]> {
  const searchParams = new URLSearchParams({ filial, produto, start, end });
  const vendedorEncoded = encodeURIComponent(vendedor);
  const response = await fetch(
    `/api/vendedores/${vendedorEncoded}/produto-vendas?${searchParams.toString()}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error("Erro ao carregar vendas");
  const json = (await response.json()) as { data: VendedorProdutoVendaItem[] };
  return json.data ?? [];
}

function formatDate(iso: string): string {
  // iso = "YYYY-MM-DD"
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

export default function VendedorProdutoDetalhePage({
  companyKey,
  vendedorNome,
  filial,
  produtoCodigo,
  produtoDescricao,
  initialStart,
  initialEnd,
}: VendedorProdutoDetalhePageProps) {
  const [data, setData] = useState<VendedorProdutoVendaItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const detalheUrl = useMemo(() => {
    const params = new URLSearchParams({
      vendedor: vendedorNome,
      filial,
      start: initialStart,
      end: initialEnd,
    });
    return `/${companyKey}/vendedores/detalhe?${params.toString()}`;
  }, [companyKey, vendedorNome, filial, initialStart, initialEnd]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchVendas(vendedorNome, filial, produtoCodigo, initialStart, initialEnd)
      .then((list) => {
        if (active) setData(list);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : "Erro ao carregar");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [vendedorNome, filial, produtoCodigo, initialStart, initialEnd]);

  const formatCurrency = (value: number) =>
    value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const formatNumber = (value: number) =>
    value.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const totalFaturamento = data.reduce((acc, p) => acc + p.faturamento, 0);
  const totalQuantidade = data.reduce((acc, p) => acc + p.quantidade, 0);

  return (
    <div className={styles.wrapper}>
      <nav className={styles.breadcrumb}>
        <Link href={`/${companyKey}/vendedores`} className={styles.breadcrumbLink}>
          Vendedores
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <Link href={detalheUrl} className={styles.breadcrumbLink}>
          {vendedorNome}
        </Link>
        <span className={styles.breadcrumbSep}>/</span>
        <span className={styles.breadcrumbCurrent}>{produtoDescricao}</span>
      </nav>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>{produtoDescricao}</h1>
          <span className={styles.filial}>
            {produtoCodigo} · {vendedorNome} · Filial {filial}
          </span>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner} />
          <span>Carregando vendas…</span>
        </div>
      )}

      {!loading && data.length === 0 && !error && (
        <div className={styles.empty}>Nenhuma venda encontrada no período.</div>
      )}

      {!loading && data.length > 0 && (
        <div className={styles.summary}>
          <span className={styles.summaryItem}>
            <strong>Faturamento:</strong> {formatCurrency(totalFaturamento)}
          </span>
          <span className={styles.summaryItem}>
            <strong>Quantidade:</strong> {formatNumber(totalQuantidade)}
          </span>
        </div>
      )}

      {!loading && data.length > 0 && (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>DATA</th>
                <th className={styles.th}>COR</th>
                <th className={styles.th}>FATURAMENTO</th>
                <th className={styles.th}>QTD</th>
              </tr>
            </thead>
            <tbody>
              {data.map((v, i) => (
                <tr key={`${v.data}-${v.cor ?? ""}-${i}`}>
                  <td className={styles.td}>{formatDate(v.data)}</td>
                  <td className={styles.td}>{v.cor || "–"}</td>
                  <td className={styles.td}>{formatCurrency(v.faturamento)}</td>
                  <td className={styles.td}>{formatNumber(v.quantidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

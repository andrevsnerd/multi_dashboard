"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import type { VendedorProdutoItem } from "@/lib/repositories/vendedores-v2";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import DateRangeFilter from "@/components/filters/DateRangeFilter";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./VendedorDetalhePage.module.css";

interface VendedorDetalhePageProps {
  companyKey: CompanyKey;
  companyName: string;
  vendedorNome: string;
  filial: string;
  initialStart: string;
  initialEnd: string;
}

async function fetchProdutos(
  company: string,
  vendedor: string,
  filial: string,
  start: string,
  end: string
): Promise<VendedorProdutoItem[]> {
  const searchParams = new URLSearchParams({
    company,
    filial,
    start,
    end,
  });
  const vendedorEncoded = encodeURIComponent(vendedor);
  const response = await fetch(
    `/api/vendedores/${vendedorEncoded}/produtos?${searchParams.toString()}`,
    { cache: "no-store" }
  );
  if (!response.ok) throw new Error("Erro ao carregar produtos");
  const json = (await response.json()) as { data: VendedorProdutoItem[] };
  return json.data ?? [];
}

export default function VendedorDetalhePage({
  companyKey,
  companyName,
  vendedorNome,
  filial,
  initialStart,
  initialEnd,
}: VendedorDetalhePageProps) {
  const initialRange = useMemo(() => {
    try {
      return {
        startDate: new Date(initialStart),
        endDate: new Date(initialEnd),
      };
    } catch {
      const r = getCurrentMonthRange();
      return { startDate: r.start, endDate: r.end };
    }
  }, [initialStart, initialEnd]);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [data, setData] = useState<VendedorProdutoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    fetchProdutos(
      companyKey,
      vendedorNome,
      filial,
      range.startDate.toISOString(),
      range.endDate.toISOString()
    )
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
  }, [companyKey, vendedorNome, filial, range.startDate, range.endDate]);

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
        <span className={styles.breadcrumbCurrent}>{vendedorNome}</span>
      </nav>

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.title}>{vendedorNome}</h1>
          <span className={styles.filial}>Filial {filial}</span>
        </div>
        <div className={styles.headerRight}>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner} />
          <span>Carregando produtos…</span>
        </div>
      )}

      {!loading && data.length === 0 && !error && (
        <div className={styles.empty}>Nenhum produto encontrado no período.</div>
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
                {companyKey === "scarfme" ? (
                  <>
                    <th className={styles.th}>LINHA</th>
                    <th className={styles.th}>DESCRIÇÃO</th>
                    <th className={styles.th}>COR</th>
                    <th className={styles.th}>GRADE</th>
                    <th className={styles.th}>SUBGRUPO</th>
                    <th className={styles.th}>COLEÇÃO</th>
                  </>
                ) : (
                  <>
                    <th className={styles.th}>GRUPO</th>
                    <th className={styles.th}>DESCRIÇÃO</th>
                    <th className={styles.th}>COR</th>
                  </>
                )}
                <th className={styles.th}>FATURAMENTO</th>
                <th className={styles.th}>QTD</th>
              </tr>
            </thead>
            <tbody>
              {data.map((p, i) => (
                <tr key={`${p.descricao}-${i}`}>
                  {companyKey === "scarfme" ? (
                    <>
                      <td className={styles.td}>{p.linha || "–"}</td>
                      <td className={styles.td}>
                        <div>{p.descricao}</div>
                        {p.codigo && <div className={styles.codigo}>{p.codigo}</div>}
                      </td>
                      <td className={styles.td}>{p.cor || "–"}</td>
                      <td className={styles.td}>{p.grade || "–"}</td>
                      <td className={styles.td}>{p.subgrupo || "–"}</td>
                      <td className={styles.td}>{p.colecao || "–"}</td>
                    </>
                  ) : (
                    <>
                      <td className={styles.td}>{p.grupo || "–"}</td>
                      <td className={styles.td}>
                        <div>{p.descricao}</div>
                        {p.codigo && <div className={styles.codigo}>{p.codigo}</div>}
                      </td>
                      <td className={styles.td}>{p.cor || "–"}</td>
                    </>
                  )}
                  <td className={styles.td}>{formatCurrency(p.faturamento)}</td>
                  <td className={styles.td}>{formatNumber(p.quantidade)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

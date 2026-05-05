"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { VendedorItem } from "@/lib/repositories/vendedores-v2";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import { resolveCompany } from "@/lib/config/company";

import styles from "./VendedoresTable.module.css";

interface VendedoresTableProps {
  data: VendedorItem[];
  loading?: boolean;
  companyKey?: string;
  range: DateRangeValue;
  selectedFilial: string | null;
  selectedGrupos: string[];
  selectedLinhas: string[];
  selectedColecoes: string[];
  selectedSubgrupos: string[];
  selectedGrades: string[];
  selectedProductId?: string | null;
  produtoSearchTerm?: string | null;
  comparisonMode?: "month" | "year";
}

function buildDetalheUrl(
  companyKey: string,
  vendedor: string,
  filial: string,
  start: Date,
  end: Date
): string {
  const params = new URLSearchParams({
    vendedor,
    filial,
    start: start.toISOString(),
    end: end.toISOString(),
  });
  return `/${companyKey}/vendedores/detalhe?${params.toString()}`;
}

export default function VendedoresTable({
  data,
  loading,
  companyKey,
  range,
  selectedFilial,
  selectedGrupos,
  selectedLinhas,
  selectedColecoes,
  selectedSubgrupos,
  selectedGrades,
  selectedProductId,
  produtoSearchTerm,
  comparisonMode,
}: VendedoresTableProps) {
  void selectedFilial;
  void selectedGrupos;
  void selectedLinhas;
  void selectedColecoes;
  void selectedSubgrupos;
  void selectedGrades;
  void selectedProductId;
  void produtoSearchTerm;

  const router = useRouter();
  const [sortColumn, setSortColumn] = useState<keyof VendedorItem>("faturamento");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = (column: keyof VendedorItem) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const aValue = a[sortColumn];
      const bValue = b[sortColumn];

      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;

      if (typeof aValue === "number" && typeof bValue === "number") {
        return sortDirection === "asc" ? aValue - bValue : bValue - aValue;
      }

      if (typeof aValue === "string" && typeof bValue === "string") {
        return sortDirection === "asc"
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }

      return 0;
    });

    return sorted;
  }, [data, sortColumn, sortDirection]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const formatNumber = (value: number) => {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  };

  const formatDecimal = (value: number, decimals = 2) => {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatPercentage = (value: number) => {
    return `${formatDecimal(value, 1)}%`;
  };

  const getFilialDisplayName = (filial: string): string => {
    if (!companyKey) return filial;
    const company = resolveCompany(companyKey);
    return company?.filialDisplayNames?.[filial] ?? filial;
  };

  const formatVendedorName = (fullName: string): string => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return fullName;

    if (parts.length >= 2 && parts[1].length <= 3) {
      if (parts.length >= 3) {
        return `${parts[0]} ${parts[1]} ${parts[2]}`;
      }
      return `${parts[0]} ${parts[1]}`;
    }

    return `${parts[0]} ${parts[1]}`;
  };

  const goToDetalhe = (vendedor: string, filial: string) => {
    if (!companyKey) return;
    const url = buildDetalheUrl(
      companyKey,
      vendedor,
      filial,
      range.startDate,
      range.endDate
    );
    router.push(url);
  };

  if (loading) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (sortedData.length === 0) {
    return (
      <div className={styles.wrapper}>
        <div className={styles.empty}>Nenhum vendedor encontrado</div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.container}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th
                className={`${styles.sortable} ${styles.vendedorHeader}`}
                onClick={() => handleSort("vendedor")}
              >
                VENDEDOR
                {sortColumn === "vendedor" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("faturamento")}
              >
                FATURAMENTO
                {sortColumn === "faturamento" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.numberHeader}`}
                onClick={() => handleSort("quantidadeVendida")}
              >
                QTDE. VENDIDA
                {sortColumn === "quantidadeVendida" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.numberHeader}`}
                onClick={() => handleSort("tickets")}
              >
                TICKETS
                {sortColumn === "tickets" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.currencyHeader}`}
                onClick={() => handleSort("ticketMedio")}
              >
                TICKET MÉDIO
                {sortColumn === "ticketMedio" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.numberHeader}`}
                onClick={() => handleSort("quantidadePorTicket")}
              >
                PEÇAS POR ATENDIMENTO
                {sortColumn === "quantidadePorTicket" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.categoryHeader}`}
                onClick={() => handleSort("categoriaMaisVendida")}
              >
                CATEGORIA MAIS VENDIDA
                {sortColumn === "categoriaMaisVendida" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.percentageHeader}`}
                onClick={() => handleSort("participacaoFilial")}
              >
                PARTICIPAÇÃO FILIAL
                {sortColumn === "participacaoFilial" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((vendedor, index) => {
              const ranking = index + 1;

              return (
                <tr
                  key={`${vendedor.vendedor}-${vendedor.filial}-${index}`}
                  className={styles.vendedorRow}
                  role="button"
                  tabIndex={0}
                  onClick={() => goToDetalhe(vendedor.vendedor, vendedor.filial)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      goToDetalhe(vendedor.vendedor, vendedor.filial);
                    }
                  }}
                >
                  <td className={styles.vendedorCell}>
                    <div className={styles.vendedorInfo}>
                      <div className={styles.rankingNumber}>#{ranking}</div>
                      <div className={styles.vendedorDetails}>
                        <div className={styles.vendedorNameRow}>
                          <div className={styles.vendedorName}>{vendedor.vendedor}</div>
                          {comparisonMode &&
                            vendedor.faturamentoPrevious !== undefined &&
                            vendedor.faturamentoPrevious > 0 &&
                            (() => {
                              const diffPct =
                                ((vendedor.faturamento - vendedor.faturamentoPrevious) /
                                  vendedor.faturamentoPrevious) *
                                100;
                              const isPos = diffPct >= 0;
                              const compLabel =
                                comparisonMode === "month"
                                  ? "mês anterior"
                                  : "mesmo período do ano anterior";
                              return (
                                <span
                                  className={`${styles.vendedorCompareBadge} ${isPos ? styles.compareBadgePos : styles.compareBadgeNeg}`}
                                  title={`Comparativo com ${compLabel}`}
                                >
                                  {isPos ? "↑" : "↓"} {isPos ? "+" : ""}
                                  {diffPct.toFixed(1)}%
                                </span>
                              );
                            })()}
                        </div>
                        <div className={styles.vendedorFilial}>
                          {getFilialDisplayName(vendedor.filial)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className={styles.currencyCell}>
                    {formatCurrency(vendedor.faturamento)}
                  </td>
                  <td className={styles.numberCell}>
                    {formatNumber(vendedor.quantidadeVendida)}
                  </td>
                  <td className={styles.numberCell}>
                    {formatNumber(vendedor.tickets)}
                  </td>
                  <td className={styles.currencyCell}>
                    {formatCurrency(vendedor.ticketMedio)}
                  </td>
                  <td className={styles.numberCell}>
                    {formatDecimal(vendedor.quantidadePorTicket, 2)}
                  </td>
                  <td className={styles.categoryCell}>
                    {vendedor.categoriaMaisVendida || "—"}
                  </td>
                  <td className={styles.percentageCell}>
                    {formatPercentage(vendedor.participacaoFilial)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className={styles.mobileCards}>
          {sortedData.map((vendedor, index) => {
            const ranking = index + 1;

            return (
              <div
                key={`${vendedor.vendedor}-${vendedor.filial}-${index}`}
                className={styles.card}
                role="button"
                tabIndex={0}
                onClick={() => goToDetalhe(vendedor.vendedor, vendedor.filial)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    goToDetalhe(vendedor.vendedor, vendedor.filial);
                  }
                }}
              >
                <div className={styles.cardContent}>
                  <div className={styles.cardLeft}>
                    <div className={styles.cardRankingNumber}>#{ranking}</div>
                    <div className={styles.cardVendedorText}>
                      <div className={styles.cardVendedorNameRow}>
                        <h4 className={styles.cardVendedorName}>
                          {formatVendedorName(vendedor.vendedor)}
                        </h4>
                        {comparisonMode &&
                          vendedor.faturamentoPrevious !== undefined &&
                          vendedor.faturamentoPrevious > 0 &&
                          (() => {
                            const diffPct =
                              ((vendedor.faturamento - vendedor.faturamentoPrevious) /
                                vendedor.faturamentoPrevious) *
                              100;
                            const isPos = diffPct >= 0;
                            const compLabel =
                              comparisonMode === "month"
                                ? "mês anterior"
                                : "mesmo período do ano anterior";
                            return (
                              <span
                                className={`${styles.vendedorCompareBadge} ${isPos ? styles.compareBadgePos : styles.compareBadgeNeg}`}
                                title={`Comparativo com ${compLabel}`}
                              >
                                {isPos ? "↑" : "↓"} {isPos ? "+" : ""}
                                {diffPct.toFixed(1)}%
                              </span>
                            );
                          })()}
                      </div>
                      <div className={styles.cardVendedorFilial}>
                        {getFilialDisplayName(vendedor.filial)}
                      </div>
                    </div>
                  </div>
                  <div className={styles.cardMetricsRow}>
                    <div className={styles.cardMetric}>
                      <span className={styles.cardMetricLabel}>FAT</span>
                      <span className={styles.cardMetricValueHighlight}>
                        {formatCurrency(vendedor.faturamento)}
                      </span>
                    </div>
                    <div className={styles.cardMetric}>
                      <span className={styles.cardMetricLabel}>QTD</span>
                      <span className={styles.cardMetricValue}>
                        {formatNumber(vendedor.quantidadeVendida)}
                      </span>
                    </div>
                    <div className={styles.cardMetric}>
                      <span className={styles.cardMetricLabel}>TKT</span>
                      <span className={styles.cardMetricValue}>
                        {formatNumber(vendedor.tickets)}
                      </span>
                    </div>
                    <div className={styles.cardMetric}>
                      <span className={styles.cardMetricLabel}>PART</span>
                      <span className={styles.cardMetricValue}>
                        {formatPercentage(vendedor.participacaoFilial)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

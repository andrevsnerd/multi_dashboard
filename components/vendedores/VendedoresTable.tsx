"use client";

import { useMemo, useState } from "react";
import type { VendedorItem } from "@/lib/repositories/vendedores";
import { resolveCompany } from "@/lib/config/company";

import styles from "./VendedoresTable.module.css";

interface VendedoresTableProps {
  data: VendedorItem[];
  loading?: boolean;
  companyKey?: string;
}

export default function VendedoresTable({
  data,
  loading,
  companyKey,
}: VendedoresTableProps) {
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

  const formatDecimal = (value: number, decimals: number = 2) => {
    return value.toLocaleString("pt-BR", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const formatPercentage = (value: number) => {
    return `${formatDecimal(value, 1)}%`;
  };

  const getInitial = (name: string): string => {
    if (!name || name === "SEM VENDEDOR") return "?";
    const parts = name.trim().split(" ");
    if (parts.length > 0) {
      return parts[0][0].toUpperCase();
    }
    return name[0].toUpperCase();
  };

  const getFilialDisplayName = (filial: string): string => {
    if (!companyKey) return filial;
    const company = resolveCompany(companyKey);
    return company?.filialDisplayNames?.[filial] ?? filial;
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
                QTDE. POR TICKET
                {sortColumn === "quantidadePorTicket" && (
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
              const initial = getInitial(vendedor.vendedor);
              return (
                <tr key={`${vendedor.vendedor}-${vendedor.filial}-${index}`}>
                  <td className={styles.vendedorCell}>
                    <div className={styles.vendedorInfo}>
                      <div className={styles.vendedorIcon}>
                        {initial}
                      </div>
                      <div className={styles.vendedorDetails}>
                        <div className={styles.vendedorName}>{vendedor.vendedor}</div>
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
                  <td className={styles.percentageCell}>
                    {formatPercentage(vendedor.participacaoFilial)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {sortedData.map((vendedor, index) => {
            const initial = getInitial(vendedor.vendedor);
            return (
              <div key={`${vendedor.vendedor}-${vendedor.filial}-${index}`} className={styles.card}>
                <div className={styles.cardMain}>
                  <div className={styles.cardHeader}>
                    <div className={styles.cardLeft}>
                      <div className={styles.cardVendedorInfo}>
                        <div className={styles.cardVendedorIcon}>
                          {initial}
                        </div>
                        <div>
                          <h4 className={styles.cardVendedorName}>
                            {vendedor.vendedor}
                          </h4>
                          <div className={styles.cardVendedorFilial}>
                            {getFilialDisplayName(vendedor.filial)}
                          </div>
                        </div>
                      </div>
                      <div className={styles.cardRevenue}>
                        <span className={styles.cardRevenueValue}>
                          {formatCurrency(vendedor.faturamento)}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className={styles.cardBody}>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Quantidade Vendida:</span>
                      <span className={styles.cardValue}>
                        {formatNumber(vendedor.quantidadeVendida)}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Tickets:</span>
                      <span className={styles.cardValue}>
                        {formatNumber(vendedor.tickets)}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Ticket Médio:</span>
                      <span className={styles.cardValue}>
                        {formatCurrency(vendedor.ticketMedio)}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Qtde. por Ticket:</span>
                      <span className={styles.cardValue}>
                        {formatDecimal(vendedor.quantidadePorTicket, 2)}
                      </span>
                    </div>
                    <div className={styles.cardRow}>
                      <span className={styles.cardLabel}>Participação Filial:</span>
                      <span className={styles.cardValue}>
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


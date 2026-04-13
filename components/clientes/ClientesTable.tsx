"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClienteRankingItem } from "@/lib/clientes/cliente-types";
import type { DateRangeValue } from "@/components/filters/DateRangeFilter";

import styles from "./ClientesTable.module.css";

interface ClientesTableProps {
  data: ClienteRankingItem[];
  loading?: boolean;
  companyKey: string;
  range: DateRangeValue;
}

export default function ClientesTable({
  data,
  loading,
  companyKey,
  range,
}: ClientesTableProps) {
  const router = useRouter();
  const [sortColumn, setSortColumn] =
    useState<keyof ClienteRankingItem>("tickets");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = (column: keyof ClienteRankingItem) => {
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

  const goToDetalhe = (cliente: ClienteRankingItem) => {
    const params = new URLSearchParams({
      cliente: cliente.nomeCliente,
      start: range.startDate.toISOString(),
      end: range.endDate.toISOString(),
    });
    if (cliente.cpf) {
      params.set("cpf", cliente.cpf);
    }
    if (cliente.chaveCliente) {
      params.set("chave", cliente.chaveCliente);
    }
    router.push(`/${companyKey}/clientes/detalhe?${params.toString()}`);
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
        <div className={styles.empty}>Nenhum cliente encontrado</div>
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
                className={`${styles.sortable} ${styles.dateHeader}`}
              >
                #
              </th>
              <th
                className={`${styles.sortable} ${styles.textHeader}`}
                onClick={() => handleSort("nomeCliente")}
              >
                CLIENTE
                {sortColumn === "nomeCliente" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.textHeader}`}
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
                className={`${styles.sortable} ${styles.textHeader}`}
                onClick={() => handleSort("totalGasto")}
              >
                TOTAL GASTO
                {sortColumn === "totalGasto" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((cliente, index) => (
              <tr
                key={`${cliente.chaveCliente}-${index}`}
                role="button"
                tabIndex={0}
                onClick={() => goToDetalhe(cliente)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    goToDetalhe(cliente);
                  }
                }}
              >
                <td className={styles.dateCell}>#{index + 1}</td>
                <td className={styles.textCell}>{cliente.nomeCliente}</td>
                <td className={styles.textCell}>{formatNumber(cliente.tickets)}</td>
                <td className={styles.textCell}>{formatCurrency(cliente.totalGasto)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
            {sortedData.map((cliente, index) => (
            <div
              key={`${cliente.chaveCliente}-${index}`}
              className={styles.card}
              role="button"
              tabIndex={0}
              onClick={() => goToDetalhe(cliente)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  goToDetalhe(cliente);
                }
              }}
            >
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <div className={styles.cardTitle}>{cliente.nomeCliente}</div>
                  <span className={styles.cardCpfInline}>#{index + 1}</span>
                </div>
                <div className={styles.cardDate}>Tickets: {formatNumber(cliente.tickets)}</div>
              </div>
              <div className={styles.cardContent}>
                <div className={styles.cardRow}>
                  <span className={styles.cardLabel}>Total gasto:</span>
                  <span className={styles.cardValue}>{formatCurrency(cliente.totalGasto)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


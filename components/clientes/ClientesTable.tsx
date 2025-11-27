"use client";

import React, { useMemo, useState } from "react";
import type { ClienteItem } from "@/lib/repositories/clientes";
import { resolveCompany } from "@/lib/config/company";

import styles from "./ClientesTable.module.css";

interface ClientesTableProps {
  data: ClienteItem[];
  loading?: boolean;
  companyKey?: string;
}

export default function ClientesTable({
  data,
  loading,
  companyKey,
}: ClientesTableProps) {
  const [sortColumn, setSortColumn] = useState<keyof ClienteItem>("data");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");

  const handleSort = (column: keyof ClienteItem) => {
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
      
      if (aValue instanceof Date && bValue instanceof Date) {
        return sortDirection === "asc" 
          ? aValue.getTime() - bValue.getTime()
          : bValue.getTime() - aValue.getTime();
      }
      
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

  const formatDate = (date: Date | string) => {
    let dateObj: Date;
    
    if (date instanceof Date) {
      dateObj = date;
    } else if (typeof date === 'string') {
      // Se a string está no formato "YYYY-MM-DD" (sem timezone), 
      // precisamos criar a data no timezone local para evitar problemas
      const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (dateMatch) {
        // Extrair ano, mês e dia diretamente da string e criar Date no timezone local
        const year = parseInt(dateMatch[1], 10);
        const month = parseInt(dateMatch[2], 10) - 1; // Mês é 0-indexed
        const day = parseInt(dateMatch[3], 10);
        dateObj = new Date(year, month, day);
      } else {
        // Se for string ISO com timezone, usar new Date normalmente
        dateObj = new Date(date);
      }
    } else {
      return 'Data inválida';
    }
    
    if (isNaN(dateObj.getTime())) {
      return 'Data inválida';
    }
    
    // Usar toLocaleDateString com timezone local
    return dateObj.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, // Usar timezone do navegador
    });
  };

  const formatEndereco = (cliente: ClienteItem): string => {
    const parts: string[] = [];
    
    if (cliente.endereco) {
      parts.push(cliente.endereco);
    }
    
    if (cliente.complemento) {
      parts.push(cliente.complemento);
    }
    
    if (cliente.bairro) {
      parts.push(cliente.bairro);
    }
    
    // Formato: endereço, complemento - bairro
    if (parts.length === 0) return '';
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return `${parts[0]}, ${parts[1]}`;
    return `${parts[0]}, ${parts[1]} - ${parts[2]}`;
  };

  const formatCPF = (cpf: string): string => {
    if (!cpf) return '';
    // Remove caracteres não numéricos
    const cleaned = cpf.replace(/\D/g, '');
    // Formata como XXX.XXX.XXX-XX
    if (cleaned.length === 11) {
      return cleaned.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
    }
    return cpf;
  };

  const formatTelefone = (telefone: string): string => {
    if (!telefone) return '';
    // Remove caracteres não numéricos
    const cleaned = telefone.replace(/\D/g, '');
    // Formata como (XX) XXXXX-XXXX ou (XX) XXXX-XXXX
    if (cleaned.length === 11) {
      return cleaned.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3');
    } else if (cleaned.length === 10) {
      return cleaned.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3');
    }
    return telefone;
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
                onClick={() => handleSort("data")}
              >
                DATA
                {sortColumn === "data" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.textHeader}`}
                onClick={() => handleSort("nomeCliente")}
              >
                NOME DO CLIENTE
                {sortColumn === "nomeCliente" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th className={styles.textHeader}>TELEFONE</th>
              <th className={styles.textHeader}>CPF</th>
              <th className={styles.textHeader}>ENDEREÇO</th>
              <th
                className={`${styles.sortable} ${styles.textHeader}`}
                onClick={() => handleSort("cidade")}
              >
                CIDADE
                {sortColumn === "cidade" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
              <th
                className={`${styles.sortable} ${styles.textHeader}`}
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
                className={`${styles.sortable} ${styles.textHeader}`}
                onClick={() => handleSort("filial")}
              >
                FILIAL
                {sortColumn === "filial" && (
                  <span className={styles.sortIndicator}>
                    {sortDirection === "asc" ? "↑" : "↓"}
                  </span>
                )}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedData.map((cliente, index) => (
              <tr key={`${cliente.nomeCliente}-${cliente.filial}-${index}`}>
                <td className={styles.dateCell}>{formatDate(cliente.data)}</td>
                <td className={styles.textCell}>{cliente.nomeCliente}</td>
                <td className={styles.textCell}>{formatTelefone(cliente.telefone)}</td>
                <td className={styles.textCell}>{formatCPF(cliente.cpf)}</td>
                <td className={styles.textCell}>{formatEndereco(cliente)}</td>
                <td className={styles.textCell}>{cliente.cidade || '--'}</td>
                <td className={styles.textCell}>{cliente.vendedor}</td>
                <td className={styles.textCell}>
                  {getFilialDisplayName(cliente.filial)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {sortedData.map((cliente, index) => (
            <div key={`${cliente.nomeCliente}-${cliente.filial}-${index}`} className={styles.card}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitleRow}>
                  <div className={styles.cardTitle}>{cliente.nomeCliente}</div>
                  {cliente.cpf && (
                    <span className={styles.cardCpfInline}>({formatCPF(cliente.cpf)})</span>
                  )}
                </div>
                <div className={styles.cardDate}>{formatDate(cliente.data)}</div>
              </div>
              <div className={styles.cardContent}>
                <div className={styles.cardRow}>
                  <span className={styles.cardLabel}>Telefone:</span>
                  <span className={styles.cardValue}>{formatTelefone(cliente.telefone) || '--'}</span>
                </div>
                <div className={styles.cardRow}>
                  <span className={styles.cardLabel}>Endereço:</span>
                  <span className={styles.cardValue}>
                    {formatEndereco(cliente) || '--'}
                    {cliente.cidade && (
                      <span className={styles.cardCityInline}> ({cliente.cidade})</span>
                    )}
                  </span>
                </div>
                <div className={styles.cardRow}>
                  <span className={styles.cardLabel}>Vendedor:</span>
                  <span className={styles.cardValue}>
                    {cliente.vendedor}
                    <span className={styles.cardFilialInline}> {getFilialDisplayName(cliente.filial)}</span>
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


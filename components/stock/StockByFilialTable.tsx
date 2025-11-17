"use client";

import { useMemo } from "react";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";

import styles from "./StockByFilialTable.module.css";

interface StockByFilialTableProps {
  companyKey: CompanyKey;
  data: StockByFilialItem[];
  loading?: boolean;
  showItemsWithoutSales?: boolean;
}

/**
 * Identifica a matriz e organiza as filiais baseado na configuração da empresa
 */
function organizeFiliais(
  companyKey: CompanyKey,
  items: StockByFilialItem[]
): {
  matriz: string | null;
  filiais: string[];
} {
  const company = resolveCompany(companyKey);
  if (!company) {
    return { matriz: null, filiais: [] };
  }

  // Definir matriz baseado na empresa
  let matriz: string | null = null;
  if (companyKey === "nerd") {
    matriz = "NERD";
  } else if (companyKey === "scarfme") {
    matriz = "SCARFME MATRIZ CMS";
  }

  // Obter todas as filiais da configuração de inventory
  const allFiliais = company.filialFilters['inventory'] ?? [];
  
  // Filtrar ecommerce filiais se necessário (para ScarfMe)
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const normalFiliais = allFiliais.filter(f => !ecommerceFilials.includes(f) || f === matriz);

  // Separar matriz das outras filiais
  const otherFiliais = normalFiliais
    .filter(f => f !== matriz)
    .sort();

  return {
    matriz,
    filiais: otherFiliais, // Todas as filiais, sem limite
  };
}

/**
 * Formata a descrição do produto com código em duas linhas
 */
function formatProductDescription(descricao: string, produto: string): {
  name: string;
  code: string;
} {
  // Se a descrição já contém o código, extrair
  if (descricao.includes(`(${produto})`)) {
    const parts = descricao.split(`(${produto})`);
    return {
      name: parts[0].trim(),
      code: produto,
    };
  }
  // Caso contrário, retornar descrição e código separados
  return {
    name: descricao.trim() || "Sem descrição",
    code: produto,
  };
}

export default function StockByFilialTable({
  companyKey,
  data,
  loading,
  showItemsWithoutSales = false,
}: StockByFilialTableProps) {
  const company = resolveCompany(companyKey);
  const { matriz, filiais } = useMemo(
    () => organizeFiliais(companyKey, data),
    [companyKey, data]
  );

  // Filtrar dados baseado no checkbox
  const filteredData = useMemo(() => {
    if (showItemsWithoutSales) {
      return data;
    }
    return data.filter((item) => item.totalVendas > 0);
  }, [data, showItemsWithoutSales]);

  const getFilialData = (
    item: StockByFilialItem,
    filialName: string | null
  ) => {
    if (!filialName) {
      return { stock: 0, sales: 0 };
    }
    // Normalizar nome da filial para comparação (trim e case-insensitive)
    // Usar a mesma normalização que foi usada no backend
    const normalizeFilial = (name: string) => (name || '').trim().toUpperCase();
    const normalizedTarget = normalizeFilial(filialName);
    
    const filialData = item.filiais.find((f) => 
      normalizeFilial(f.filial) === normalizedTarget
    );
    return filialData || { stock: 0, sales: 0 };
  };

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Carregando dados...</div>
      </div>
    );
  }

  if (filteredData.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Nenhum dado disponível</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th>SUBGRUPO</th>
            <th>GRADE</th>
            <th>DESCRIÇÃO</th>
            <th>COR</th>
            <th>VENDAS</th>
            <th>ESTOQUE</th>
            {matriz && <th>MATRIZ</th>}
            {filiais.map((filial) => {
              const displayName = company?.filialDisplayNames?.[filial] || filial;
              return (
                <th key={filial}>{displayName}</th>
              );
            })}
            <th>AÇÃO</th>
          </tr>
        </thead>
        <tbody>
          {filteredData.map((item, rowIndex) => {
            const matrizData = getFilialData(item, matriz);
            const productInfo = formatProductDescription(item.descricao, item.produto);
            return (
              <tr key={`${item.produto}-${item.cor}-${item.grade}-${rowIndex}`}>
                <td className={styles.subgrupoCell}>{item.subgrupo}</td>
                <td>
                  <div className={styles.gradeCell}>{item.grade}</div>
                </td>
                <td className={styles.descricaoCell}>
                  <div className={styles.productName}>{productInfo.name}</div>
                  <div className={styles.productCode}>{productInfo.code}</div>
                </td>
                <td>{item.cor}</td>
                <td className={styles.numberCell}>{item.totalVendas}</td>
                <td className={styles.numberCell}>{item.totalEstoque}</td>
                {matriz && (
                  <td>
                    <div className={styles.filialCell}>
                      <span className={styles.stockValue}>
                        {matrizData.stock}
                      </span>
                      <span className={styles.salesValue}>
                        {matrizData.sales} vendas
                      </span>
                    </div>
                  </td>
                )}
                {filiais.map((filial) => {
                  const filialData = getFilialData(item, filial);
                  return (
                    <td key={filial}>
                      <div className={styles.filialCell}>
                        <span className={styles.stockValue}>
                          {filialData.stock}
                        </span>
                        <span className={styles.salesValue}>
                          {filialData.sales} vendas
                        </span>
                      </div>
                    </td>
                  );
                })}
                <td>
                  <button className={styles.actionButton} type="button">
                    Estoque Normal
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}


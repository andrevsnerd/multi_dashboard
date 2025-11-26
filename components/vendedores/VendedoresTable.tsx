"use client";

import React, { useMemo, useState, useEffect } from "react";
import type { VendedorItem, VendedorProdutoItem } from "@/lib/repositories/vendedores";
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
}: VendedoresTableProps) {
  const [sortColumn, setSortColumn] = useState<keyof VendedorItem>("faturamento");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [expandedVendedores, setExpandedVendedores] = useState<Set<string>>(new Set());
  const [vendedorProdutos, setVendedorProdutos] = useState<Map<string, VendedorProdutoItem[]>>(new Map());
  const [loadingProdutos, setLoadingProdutos] = useState<Set<string>>(new Set());

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

  const getFilialDisplayName = (filial: string): string => {
    if (!companyKey) return filial;
    const company = resolveCompany(companyKey);
    return company?.filialDisplayNames?.[filial] ?? filial;
  };

  const formatVendedorName = (fullName: string): string => {
    const parts = fullName.trim().split(/\s+/);
    if (parts.length <= 1) return fullName;
    
    // Se o segundo nome tem 3 letras ou menos (DA, DOS, DO, etc), pegar o terceiro também
    if (parts.length >= 2 && parts[1].length <= 3) {
      if (parts.length >= 3) {
        return `${parts[0]} ${parts[1]} ${parts[2]}`;
      }
      return `${parts[0]} ${parts[1]}`;
    }
    
    // Se o segundo nome tem mais de 3 letras, parar no segundo
    return `${parts[0]} ${parts[1]}`;
  };

  const getVendedorKey = (vendedor: string, filial: string): string => {
    return `${vendedor}::${filial}`;
  };

  const toggleExpand = async (vendedor: string, filial: string) => {
    const key = getVendedorKey(vendedor, filial);
    const isExpanded = expandedVendedores.has(key);

    if (isExpanded) {
      // Colapsar
      setExpandedVendedores((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      // Expandir
      setExpandedVendedores((prev) => new Set(prev).add(key));

      // Se ainda não carregou os produtos, buscar
      if (!vendedorProdutos.has(key) && !loadingProdutos.has(key)) {
        setLoadingProdutos((prev) => new Set(prev).add(key));

        try {
          const searchParams = new URLSearchParams({
            company: companyKey || '',
            filial: filial,
            start: range.startDate.toISOString(),
            end: range.endDate.toISOString(),
          });

          selectedGrupos.forEach((grupo) => {
            searchParams.append("grupo", grupo);
          });

          selectedLinhas.forEach((linha) => {
            searchParams.append("linha", linha);
          });

          selectedColecoes.forEach((colecao) => {
            searchParams.append("colecao", colecao);
          });

          selectedSubgrupos.forEach((subgrupo) => {
            searchParams.append("subgrupo", subgrupo);
          });

          selectedGrades.forEach((grade) => {
            searchParams.append("grade", grade);
          });

          if (selectedProductId) {
            searchParams.set("produtoId", selectedProductId);
          } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
            searchParams.set("produtoSearchTerm", produtoSearchTerm.trim());
          }

          const vendedorEncoded = encodeURIComponent(vendedor);
          const response = await fetch(
            `/api/vendedores/${vendedorEncoded}/produtos?${searchParams.toString()}`,
            { cache: "no-store" }
          );

          if (response.ok) {
            const json = (await response.json()) as {
              data: VendedorProdutoItem[];
            };
            setVendedorProdutos((prev) => {
              const next = new Map(prev);
              next.set(key, json.data);
              return next;
            });
          }
        } catch (err) {
          console.error('Erro ao carregar produtos do vendedor', err);
        } finally {
          setLoadingProdutos((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
        }
      }
    }
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
              const key = getVendedorKey(vendedor.vendedor, vendedor.filial);
              const isExpanded = expandedVendedores.has(key);
              const produtos = vendedorProdutos.get(key) || [];
              const isLoadingProdutos = loadingProdutos.has(key);
              const ranking = index + 1;
              const badgeText = companyKey === 'scarfme' 
                ? vendedor.subgrupoMaisVendido 
                : vendedor.grupoMaisVendido;

              return (
                <React.Fragment key={`${vendedor.vendedor}-${vendedor.filial}-${index}`}>
                  <tr 
                    className={styles.vendedorRow}
                    onClick={() => toggleExpand(vendedor.vendedor, vendedor.filial)}
                  >
                    <td className={styles.vendedorCell}>
                      <div className={styles.vendedorInfo}>
                        <div className={styles.rankingNumber}>#{ranking}</div>
                        <div className={styles.vendedorDetails}>
                          <div className={styles.vendedorNameRow}>
                            <div className={styles.vendedorName}>{vendedor.vendedor}</div>
                            {badgeText && (
                              <span className={styles.grupoBadge}>{badgeText}</span>
                            )}
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
                    <td className={styles.percentageCell}>
                      {formatPercentage(vendedor.participacaoFilial)}
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${key}-expanded`} className={styles.expandedRow}>
                      <td colSpan={7} className={styles.expandedCell}>
                        {isLoadingProdutos ? (
                          <div className={styles.loadingProdutos}>Carregando produtos...</div>
                        ) : produtos.length === 0 ? (
                          <div className={styles.emptyProdutos}>Nenhum produto encontrado</div>
                        ) : (
                          <div className={styles.produtosContainer}>
                            <table className={styles.produtosTable}>
                              <thead>
                                <tr>
                                  {companyKey === 'scarfme' ? (
                                    <>
                                      <th className={styles.produtoLinhaHeader}>LINHA</th>
                                      <th className={styles.produtoDescricaoHeader}>DESCRIÇÃO</th>
                                      <th className={styles.produtoCorHeader}>COR</th>
                                      <th className={styles.produtoGradeHeader}>GRADE</th>
                                      <th className={styles.produtoSubgrupoHeader}>SUBGRUPO</th>
                                      <th className={styles.produtoColecaoHeader}>COLEÇÃO</th>
                                    </>
                                  ) : (
                                    <>
                                      <th className={styles.produtoGrupoHeader}>GRUPO</th>
                                      <th className={styles.produtoDescricaoHeader}>DESCRIÇÃO</th>
                                      <th className={styles.produtoCorHeader}>COR</th>
                                    </>
                                  )}
                                  <th className={styles.produtoFaturamentoHeader}>FATURAMENTO</th>
                                  <th className={styles.produtoQuantidadeHeader}>QTD</th>
                                </tr>
                              </thead>
                              <tbody>
                                {produtos.map((produto, produtoIndex) => (
                                  <tr key={`${key}-produto-${produtoIndex}`}>
                                    {companyKey === 'scarfme' ? (
                                      <>
                                        <td className={styles.produtoLinhaCell}>{produto.linha || '--'}</td>
                                        <td className={styles.produtoDescricaoCell}>
                                          <div className={styles.produtoDescricaoWrapper}>
                                            <div className={styles.produtoDescricaoText}>{produto.descricao}</div>
                                            {produto.codigo && (
                                              <div className={styles.produtoCodigo}>{produto.codigo}</div>
                                            )}
                                          </div>
                                        </td>
                                        <td className={styles.produtoCorCell}>{produto.cor || '--'}</td>
                                        <td className={styles.produtoGradeCell}>{produto.grade || '--'}</td>
                                        <td className={styles.produtoSubgrupoCell}>{produto.subgrupo || '--'}</td>
                                        <td className={styles.produtoColecaoCell}>{produto.colecao || '--'}</td>
                                      </>
                                    ) : (
                                      <>
                                        <td className={styles.produtoGrupoCell}>{produto.grupo || '--'}</td>
                                        <td className={styles.produtoDescricaoCell}>
                                          <div className={styles.produtoDescricaoWrapper}>
                                            <div className={styles.produtoDescricaoText}>{produto.descricao}</div>
                                            {produto.codigo && (
                                              <div className={styles.produtoCodigo}>{produto.codigo}</div>
                                            )}
                                          </div>
                                        </td>
                                        <td className={styles.produtoCorCell}>{produto.cor || '--'}</td>
                                      </>
                                    )}
                                    <td className={styles.produtoFaturamentoCell}>
                                      {formatCurrency(produto.faturamento)}
                                    </td>
                                    <td className={styles.produtoQuantidadeCell}>
                                      {formatNumber(produto.quantidade)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>

        {/* Mobile: Cards */}
        <div className={styles.mobileCards}>
          {sortedData.map((vendedor, index) => {
            const key = getVendedorKey(vendedor.vendedor, vendedor.filial);
            const isExpanded = expandedVendedores.has(key);
            const produtos = vendedorProdutos.get(key) || [];
            const isLoadingProdutos = loadingProdutos.has(key);
            const ranking = index + 1;
            const badgeText = companyKey === 'scarfme' 
              ? vendedor.subgrupoMaisVendido 
              : vendedor.grupoMaisVendido;

            return (
              <div key={`${vendedor.vendedor}-${vendedor.filial}-${index}`}>
                 <div 
                   className={styles.card}
                   onClick={() => toggleExpand(vendedor.vendedor, vendedor.filial)}
                 >
                   <div className={styles.cardContent}>
                     <div className={styles.cardLeft}>
                       <div className={styles.cardRankingNumber}>#{ranking}</div>
                       <div className={styles.cardVendedorText}>
                         <div className={styles.cardVendedorNameRow}>
                           <h4 className={styles.cardVendedorName}>
                             {formatVendedorName(vendedor.vendedor)}
                           </h4>
                           {badgeText && (
                             <span className={styles.cardGrupoBadge}>{badgeText}</span>
                           )}
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
                {isExpanded && (
                  <div className={styles.cardExpanded}>
                    {isLoadingProdutos ? (
                      <div className={styles.loadingProdutos}>Carregando produtos...</div>
                    ) : produtos.length === 0 ? (
                      <div className={styles.emptyProdutos}>Nenhum produto encontrado</div>
                    ) : (
                      <div className={styles.cardProdutosList}>
                        {produtos.map((produto, produtoIndex) => (
                          <div key={`${key}-produto-${produtoIndex}`} className={styles.cardProdutoItem}>
                            <div className={styles.cardProdutoLeft}>
                              {companyKey === 'nerd' ? (
                                <div className={styles.cardProdutoGrupo}>{produto.grupo || '--'}</div>
                              ) : (
                                <div className={styles.cardProdutoMeta}>
                                  {produto.linha && (
                                    <span className={styles.cardProdutoTag}>{produto.linha}</span>
                                  )}
                                  {produto.colecao && (
                                    <span className={styles.cardProdutoTag}>{produto.colecao}</span>
                                  )}
                                  {produto.subgrupo && (
                                    <span className={styles.cardProdutoTag}>{produto.subgrupo}</span>
                                  )}
                                  {produto.grade && (
                                    <span className={styles.cardProdutoTag}>{produto.grade}</span>
                                  )}
                                  {produto.cor && (
                                    <span className={styles.cardProdutoTag}>{produto.cor}</span>
                                  )}
                                </div>
                              )}
                              <div className={styles.cardProdutoDescricaoWrapper}>
                                <div className={styles.cardProdutoDescricao}>{produto.descricao}</div>
                                {produto.codigo && (
                                  <div className={styles.cardProdutoCodigo}>{produto.codigo}</div>
                                )}
                              </div>
                            </div>
                            <div className={styles.cardProdutoMetrics}>
                              <div className={styles.cardProdutoMetric}>
                                <span className={styles.cardProdutoMetricLabel}>FAT</span>
                                <span className={styles.cardProdutoMetricValue}>
                                  {formatCurrency(produto.faturamento)}
                                </span>
                              </div>
                              <div className={styles.cardProdutoMetric}>
                                <span className={styles.cardProdutoMetricLabel}>QTD</span>
                                <span className={styles.cardProdutoMetricValue}>
                                  {formatNumber(produto.quantidade)}
                                </span>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}


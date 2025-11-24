"use client";

import { useEffect, useMemo, useState } from "react";

import type { CategoryRevenue, ProductRevenue, FilialPerformance } from "@/types/dashboard";
import { isEcommerceFilial, VAREJO_VALUE } from "@/lib/config/company";

import styles from "./RevenueDashboard.module.css";

export interface CompanyRevenueListsProps {
  companyKey: "nerd" | "scarfme";
  startDate: Date;
  endDate: Date;
  filial?: string | null | undefined;
  title?: string;
  subtitle?: string;
}

interface RevenueState {
  products: ProductRevenue[];
  categories: CategoryRevenue[];
  filialPerformance: FilialPerformance[];
}

async function fetchRevenue(
  company: string,
  startDate: Date,
  endDate: Date,
  filial: string | null,
): Promise<RevenueState> {
  const searchParams = new URLSearchParams({
    company,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });
  
  if (filial) {
    searchParams.set('filial', filial);
  }

  const [productsResponse, categoriesResponse, filialResponse] = await Promise.all([
    fetch(`/api/top-products?${searchParams.toString()}`, { cache: "no-store" }),
    fetch(`/api/top-categories?${searchParams.toString()}`, {
      cache: "no-store",
    }),
    fetch(`/api/filial-performance?${searchParams.toString()}`, {
      cache: "no-store",
    }),
  ]);

  if (!productsResponse.ok) {
    throw new Error("Erro ao carregar top produtos");
  }
  if (!categoriesResponse.ok) {
    throw new Error("Erro ao carregar top grupos");
  }
  if (!filialResponse.ok) {
    throw new Error("Erro ao carregar performance por filial");
  }

  const productsJson = (await productsResponse.json()) as { data: ProductRevenue[] };
  const categoriesJson = (await categoriesResponse.json()) as {
    data: CategoryRevenue[];
  };
  const filialJson = (await filialResponse.json()) as {
    data: FilialPerformance[];
  };

  return {
    products: productsJson.data,
    categories: categoriesJson.data,
    filialPerformance: filialJson.data,
  };
}

export default function CompanyRevenueLists({
  companyKey,
  startDate,
  endDate,
  filial = null,
  title = "Top faturamento",
  subtitle = "Produtos e categorias com maior faturamento no período selecionado.",
}: CompanyRevenueListsProps) {
  const [state, setState] = useState<RevenueState>({ products: [], categories: [], filialPerformance: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () => `${startDate.toISOString()}::${endDate.toISOString()}::${filial ?? 'all'}`,
    [startDate, endDate, filial],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const revenue = await fetchRevenue(companyKey, startDate, endDate, filial);
        if (active) {
          setState(revenue);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Não foi possível carregar os dados.",
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [companyKey, rangeKey, startDate, endDate, filial]);

  // Adicionar "VAREJO" como primeiro item apenas para SCARFME
  const filialPerformanceWithVarejo = useMemo(() => {
    if (companyKey !== "scarfme") {
      return state.filialPerformance;
    }

    // Filtrar apenas filiais normais (não e-commerce)
    const varejoFiliais = state.filialPerformance.filter(
      (item) => !isEcommerceFilial(companyKey, item.filial)
    );

    // Se não houver filiais de varejo, retornar a lista original
    if (varejoFiliais.length === 0) {
      return state.filialPerformance;
    }

    // Calcular agregação de VAREJO
    const varejoCurrentRevenue = varejoFiliais.reduce(
      (sum, item) => sum + item.currentRevenue,
      0
    );
    const varejoPreviousRevenue = varejoFiliais.reduce(
      (sum, item) => sum + item.previousRevenue,
      0
    );

    let varejoChangePercentage: number | null = null;
    if (varejoPreviousRevenue > 0) {
      varejoChangePercentage = Number(
        (((varejoCurrentRevenue - varejoPreviousRevenue) / varejoPreviousRevenue) * 100).toFixed(1)
      );
    } else if (varejoCurrentRevenue > 0) {
      varejoChangePercentage = null;
    }

    const varejoItem: FilialPerformance = {
      filial: VAREJO_VALUE,
      filialDisplayName: "VAREJO",
      currentRevenue: varejoCurrentRevenue,
      previousRevenue: varejoPreviousRevenue,
      changePercentage: varejoChangePercentage,
    };

    // Retornar VAREJO primeiro, depois as outras filiais
    return [varejoItem, ...state.filialPerformance];
  }, [state.filialPerformance, companyKey]);

  return (
    <section className={styles.container}>
      {loading ? <div className={styles.loadingBar} /> : null}
      {error ? <div className={`${styles.state} ${styles.error}`}>{error}</div> : null}

      {!error ? (
        <section className={styles.grid}>
          <article className={styles.card}>
            <div className={styles.listHeader}>
              <h3 className={styles.cardTitle}>TOP PRODUTOS</h3>
              <div className={styles.listHeaderRight}>
                <span className={styles.headerLabel}>Vendas</span>
                <span className={styles.headerLabel}>Estoque</span>
              </div>
            </div>
            <ul className={styles.list}>
              {state.products.map((item) => (
                <li key={item.productId} className={styles.listItem}>
                  <div className={styles.itemNameContainer}>
                    <strong className={styles.itemName}>{item.productName}</strong>
                    <p className={styles.itemSubtitle}>{item.productId}</p>
                  </div>
                  <div className={styles.itemMetrics}>
                    <div className={styles.metricRow}>
                      <div className={styles.priceColumn}>
                        <span className={styles.metricValue}>
                          {item.totalRevenue.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </span>
                        <span className={styles.metricLabel}>
                          {item.totalQuantity.toLocaleString("pt-BR")} unid.
                        </span>
                      </div>
                      <div className={styles.stockBadge}>
                        <span className={styles.stockNumber}>
                          {item.stock.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
              {state.products.length === 0 ? (
                <li className={styles.state}>Nenhum produto encontrado.</li>
              ) : null}
            </ul>
          </article>

          <article className={styles.card}>
            <div className={styles.listHeader}>
              <h3 className={styles.cardTitle}>TOP GRUPOS</h3>
              <div className={styles.listHeaderRight}>
                <span className={styles.headerLabel}>Vendas</span>
              </div>
            </div>
            <ul className={styles.list}>
              {(() => {
                const totalRevenue = state.categories.reduce((sum, item) => sum + item.totalRevenue, 0);
                return state.categories.map((item) => {
                  const percentage = totalRevenue > 0 ? (item.totalRevenue / totalRevenue) * 100 : 0;
                  return (
                    <li key={item.categoryId} className={styles.listItem}>
                      <div className={styles.itemNameContainer}>
                        <strong className={styles.itemName}>
                          {item.categoryName}
                          <span className={styles.percentageBadge}>
                            {percentage.toFixed(2)}%
                          </span>
                        </strong>
                      </div>
                      <div className={styles.itemMetrics}>
                        <div className={styles.priceColumn}>
                          <span className={styles.metricValue}>
                            {item.totalRevenue.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                          <span className={styles.metricLabel}>
                            {item.totalQuantity.toLocaleString("pt-BR")} unid.
                          </span>
                        </div>
                      </div>
                    </li>
                  );
                });
              })()}
              {state.categories.length === 0 ? (
                <li className={styles.state}>Nenhum grupo encontrado.</li>
              ) : null}
            </ul>
          </article>

          <article className={styles.card}>
            <div className={styles.listHeader}>
              <h3 className={styles.cardTitle}>PERFORMANCE DETALHADA POR LOJA</h3>
              <div className={styles.listHeaderRight}>
                <span className={styles.headerLabel}>Vendas</span>
                <span className={styles.headerLabel}>Var. %</span>
              </div>
            </div>
            <ul className={styles.list}>
              {filialPerformanceWithVarejo.map((item) => {
                const isPositive = item.changePercentage !== null && item.changePercentage > 0;
                const isNegative = item.changePercentage !== null && item.changePercentage < 0;
                const variationClass = isPositive
                  ? styles.variationPositive
                  : isNegative
                    ? styles.variationNegative
                    : styles.variationNeutral;

                return (
                  <li key={item.filial} className={styles.listItem}>
                    <div className={styles.itemNameContainer}>
                      <strong className={styles.itemName}>{item.filialDisplayName}</strong>
                    </div>
                    <div className={styles.itemMetrics}>
                      <div className={styles.metricRow}>
                        <div className={styles.priceColumn}>
                          <span className={styles.metricValue}>
                            {item.currentRevenue.toLocaleString("pt-BR", {
                              style: "currency",
                              currency: "BRL",
                            })}
                          </span>
                        </div>
                        <div className={`${styles.variationBadge} ${variationClass}`}>
                          {item.changePercentage !== null ? (
                            <>
                              {isPositive ? (
                                <span className={styles.variationArrow}>↑</span>
                              ) : isNegative ? (
                                <span className={styles.variationArrow}>↓</span>
                              ) : null}
                              <span className={styles.variationValue}>
                                {Math.abs(item.changePercentage).toLocaleString("pt-BR", {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}%
                              </span>
                            </>
                          ) : (
                            <span className={styles.variationValue}>--</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
              {filialPerformanceWithVarejo.length === 0 ? (
                <li className={styles.state}>Nenhuma filial encontrada.</li>
              ) : null}
            </ul>
          </article>
        </section>
      ) : null}
    </section>
  );
}




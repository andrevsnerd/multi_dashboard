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
  filialPerformance?: FilialPerformance[];
  title?: string;
  subtitle?: string;
  initialProducts?: ProductRevenue[];
  initialCategories?: CategoryRevenue[];
}

interface RevenueState {
  products: ProductRevenue[];
  categories: CategoryRevenue[];
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

  const [productsResponse, categoriesResponse] = await Promise.all([
    fetch(`/api/top-products?${searchParams.toString()}`, { cache: "no-store" }),
    fetch(`/api/top-categories?${searchParams.toString()}`, {
      cache: "no-store",
    }),
  ]);

  if (!productsResponse.ok) {
    throw new Error("Erro ao carregar top produtos");
  }
  if (!categoriesResponse.ok) {
    throw new Error("Erro ao carregar top grupos");
  }

  const productsJson = (await productsResponse.json()) as { data: ProductRevenue[] };
  const categoriesJson = (await categoriesResponse.json()) as {
    data: CategoryRevenue[];
  };

  return {
    products: productsJson.data,
    categories: categoriesJson.data,
  };
}

export default function CompanyRevenueLists({
  companyKey,
  startDate,
  endDate,
  filial = null,
  filialPerformance: filialPerformanceProp = [],
  title = "Top faturamento",
  subtitle = "Produtos e categorias com maior faturamento no período selecionado.",
  initialProducts,
  initialCategories,
}: CompanyRevenueListsProps) {
  const [state, setState] = useState<RevenueState>({
    products: initialProducts ?? [],
    categories: initialCategories ?? [],
  });
  const [loading, setLoading] = useState(initialProducts === undefined);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () => `${startDate.toISOString()}::${endDate.toISOString()}::${filial ?? 'all'}`,
    [startDate, endDate, filial],
  );

  useEffect(() => {
    if (initialProducts !== undefined) return;

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
  }, [companyKey, rangeKey, startDate, endDate, filial, initialProducts]);

  // SCARFME: adicionar "VAREJO" agregado e agregar filiais com mesmo displayName (PAULISTA, E-COMMERCE)
  const filialPerformanceWithVarejo = useMemo(() => {
    if (companyKey !== "scarfme") {
      return filialPerformanceProp;
    }

    // Filtrar apenas filiais normais (não e-commerce) para o total VAREJO
    const varejoFiliais = filialPerformanceProp.filter(
      (item) => !isEcommerceFilial(companyKey, item.filial)
    );

    if (varejoFiliais.length === 0) {
      return filialPerformanceProp;
    }

    // Agregação de VAREJO (soma de todas as lojas físicas)
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

    // Agregar por filialDisplayName (ex.: duas PAULISTA → uma linha PAULISTA; dois E-COMMERCE → uma linha E-COMMERCE)
    const byDisplayName = new Map<string, FilialPerformance>();
    for (const item of filialPerformanceProp) {
      const name = item.filialDisplayName;
      const existing = byDisplayName.get(name);
      if (!existing) {
        byDisplayName.set(name, {
          filial: item.filial,
          filialDisplayName: name,
          currentRevenue: item.currentRevenue,
          previousRevenue: item.previousRevenue,
          changePercentage: item.changePercentage,
        });
      } else {
        existing.currentRevenue += item.currentRevenue;
        existing.previousRevenue += item.previousRevenue;
        // Recalcular VAR% com totais agregados
        if (existing.previousRevenue > 0) {
          existing.changePercentage = Number(
            (((existing.currentRevenue - existing.previousRevenue) / existing.previousRevenue) * 100).toFixed(1)
          );
        } else if (existing.currentRevenue > 0) {
          existing.changePercentage = null;
        }
      }
    }

    const aggregatedList = Array.from(byDisplayName.values()).sort(
      (a, b) => b.currentRevenue - a.currentRevenue
    );

    return [varejoItem, ...aggregatedList];
  }, [filialPerformanceProp, companyKey]);

  const filialPerformanceTotals = useMemo(() => {
    const list = filialPerformanceWithVarejo;
    const sumAll = () => ({
      currentRevenue: list.reduce((sum, item) => sum + (item.currentRevenue ?? 0), 0),
      previousRevenue: list.reduce((sum, item) => sum + (item.previousRevenue ?? 0), 0),
    });

    const sumVarejoPlusEcommerce = () => {
      const varejo = list.find((item) => item.filial === VAREJO_VALUE);
      const varejoCurrent = varejo?.currentRevenue ?? 0;
      const varejoPrevious = varejo?.previousRevenue ?? 0;

      // E-COMMERCE pode aparecer mais de uma vez (ex.: duas filiais agregadas),
      // então somamos por displayName e excluímos o próprio VAREJO.
      const ecommerceItems = list.filter(
        (item) => item.filial !== VAREJO_VALUE && item.filialDisplayName === "E-COMMERCE"
      );
      const ecommerceCurrent = ecommerceItems.reduce((s, item) => s + (item.currentRevenue ?? 0), 0);
      const ecommercePrevious = ecommerceItems.reduce((s, item) => s + (item.previousRevenue ?? 0), 0);

      return {
        currentRevenue: varejoCurrent + ecommerceCurrent,
        previousRevenue: varejoPrevious + ecommercePrevious,
      };
    };

    const { currentRevenue, previousRevenue } =
      companyKey === "scarfme" ? sumVarejoPlusEcommerce() : sumAll();

    let changePercentage: number | null = null;
    if (previousRevenue > 0) {
      changePercentage = Number((((currentRevenue - previousRevenue) / previousRevenue) * 100).toFixed(1));
    } else if (currentRevenue > 0) {
      changePercentage = null;
    }

    return { currentRevenue, previousRevenue, changePercentage };
  }, [filialPerformanceWithVarejo, companyKey]);

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
                          {typeof item.stock === "number"
                            ? item.stock.toLocaleString("pt-BR")
                            : "—"}
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

              {filialPerformanceWithVarejo.length > 0 ? (
                <li className={styles.listItem}>
                  <div className={styles.itemNameContainer}>
                    <strong className={styles.itemName}>TOTAL</strong>
                  </div>
                  <div className={styles.itemMetrics}>
                    <div className={styles.metricRow}>
                      <div className={styles.priceColumn}>
                        <span className={styles.metricValue}>
                          {filialPerformanceTotals.currentRevenue.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                          })}
                        </span>
                      </div>
                      <div className={`${styles.variationBadge} ${filialPerformanceTotals.changePercentage !== null && filialPerformanceTotals.changePercentage !== 0
                        ? (filialPerformanceTotals.changePercentage > 0 ? styles.variationPositive : styles.variationNegative)
                        : styles.variationNeutral
                        }`}>
                        {filialPerformanceTotals.changePercentage !== null ? (
                          <>
                            {filialPerformanceTotals.changePercentage > 0 ? (
                              <span className={styles.variationArrow}>↑</span>
                            ) : filialPerformanceTotals.changePercentage < 0 ? (
                              <span className={styles.variationArrow}>↓</span>
                            ) : null}
                            <span className={styles.variationValue}>
                              {Math.abs(filialPerformanceTotals.changePercentage).toLocaleString("pt-BR", {
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
              ) : null}

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




"use client";

import { useEffect, useMemo, useState } from "react";

import type { CategoryRevenue, ProductRevenue, FilialPerformance, MetricSummary } from "@/types/dashboard";
import { isEcommerceFilial, VAREJO_VALUE } from "@/lib/config/company";

import styles from "./RevenueDashboard.module.css";

export interface CompanyRevenueListsProps {
  companyKey: "nerd" | "scarfme";
  startDate: Date;
  endDate: Date;
  filial?: string | null | undefined;
  linhas?: string[] | null;
  filialPerformance?: FilialPerformance[];
  summaryRevenue?: MetricSummary | null;
  title?: string;
  subtitle?: string;
  initialProducts?: ProductRevenue[];
  initialCategories?: CategoryRevenue[];
}

interface RevenueState {
  products: ProductRevenue[];
  categories: CategoryRevenue[];
}

function normalizeDisplayName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function aggregateByDisplayName(items: FilialPerformance[]): FilialPerformance[] {
  const byDisplayName = new Map<string, FilialPerformance>();

  for (const item of items) {
    const normalizedName = normalizeDisplayName(item.filialDisplayName);
    const displayName = item.filialDisplayName.replace(/\s+/g, " ").trim();
    const existing = byDisplayName.get(normalizedName);

    if (!existing) {
      byDisplayName.set(normalizedName, {
        filial: item.filial,
        filialDisplayName: displayName,
        currentRevenue: item.currentRevenue,
        previousRevenue: item.previousRevenue,
        changePercentage: item.changePercentage,
      });
      continue;
    }

    existing.currentRevenue += item.currentRevenue;
    existing.previousRevenue += item.previousRevenue;
    if (existing.previousRevenue > 0) {
      existing.changePercentage = Number(
        (((existing.currentRevenue - existing.previousRevenue) / existing.previousRevenue) * 100).toFixed(1)
      );
    } else if (existing.currentRevenue > 0) {
      existing.changePercentage = null;
    }
  }

  return Array.from(byDisplayName.values()).sort((a, b) => b.currentRevenue - a.currentRevenue);
}

async function fetchRevenue(
  company: string,
  startDate: Date,
  endDate: Date,
  filial: string | null,
  linhas: string[] | null,
): Promise<RevenueState> {
  const searchParams = new URLSearchParams({
    company,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  if (filial) {
    searchParams.set('filial', filial);
  }

  (linhas ?? []).forEach((linha) => {
    searchParams.append('linha', linha);
  });

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
  linhas = null,
  filialPerformance: filialPerformanceProp = [],
  summaryRevenue = null,
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
    () => `${startDate.toISOString()}::${endDate.toISOString()}::${filial ?? 'all'}::${(linhas ?? []).join(",")}`,
    [startDate, endDate, filial, linhas],
  );

  // Quando os dados já vêm prontos do dashboard, sincroniza o estado a cada
  // atualização (troca de filtros recarrega o dashboard com novos dados).
  useEffect(() => {
    if (initialProducts === undefined) return;
    setState({
      products: initialProducts ?? [],
      categories: initialCategories ?? [],
    });
    setLoading(false);
  }, [initialProducts, initialCategories]);

  useEffect(() => {
    if (initialProducts !== undefined) return;

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const revenue = await fetchRevenue(companyKey, startDate, endDate, filial, linhas);
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
  }, [companyKey, rangeKey, startDate, endDate, filial, linhas, initialProducts]);

  // SCARFME: adicionar "VAREJO" agregado e agregar filiais com mesmo displayName (PAULISTA, E-COMMERCE)
  const filialPerformanceWithVarejo = useMemo(() => {
    if (companyKey !== "scarfme") {
      return aggregateByDisplayName(filialPerformanceProp);
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

    // Agregar por filialDisplayName (ex.: duas PAULISTA -> uma linha PAULISTA; dois E-COMMERCE -> uma linha E-COMMERCE)
    const aggregatedList = aggregateByDisplayName(filialPerformanceProp);

    return [varejoItem, ...aggregatedList];
  }, [filialPerformanceProp, companyKey]);

  const filialPerformanceTotals = useMemo(() => {
    if (summaryRevenue) {
      return {
        currentRevenue: summaryRevenue.currentValue,
        previousRevenue: summaryRevenue.previousValue,
        changePercentage: summaryRevenue.changePercentage,
      };
    }

    const list = filialPerformanceWithVarejo.filter(
      (item) => normalizeDisplayName(item.filialDisplayName) !== "IBIRAPUERA"
    );
    const fallbackCurrent = list.reduce((sum, item) => sum + (item.currentRevenue ?? 0), 0);
    const fallbackPrevious = list.reduce((sum, item) => sum + (item.previousRevenue ?? 0), 0);
    let changePercentage: number | null = null;
    if (fallbackPrevious > 0) {
      changePercentage = Number((((fallbackCurrent - fallbackPrevious) / fallbackPrevious) * 100).toFixed(1));
    } else if (fallbackCurrent > 0) {
      changePercentage = null;
    }
    return { currentRevenue: fallbackCurrent, previousRevenue: fallbackPrevious, changePercentage };
  }, [summaryRevenue, filialPerformanceWithVarejo]);

  const filialPerformanceDetalhada = useMemo(() => {
    const withoutIbirapuera = filialPerformanceWithVarejo.filter(
      (item) => normalizeDisplayName(item.filialDisplayName) !== "IBIRAPUERA"
    );

    if (filial === VAREJO_VALUE) {
      // Mostrar apenas lojas físicas — sem linha "VAREJO" (redundante com TOTAL) e sem E-COMMERCE
      return withoutIbirapuera.filter(
        (item) =>
          item.filial !== VAREJO_VALUE &&
          !isEcommerceFilial(companyKey, item.filial)
      );
    }

    return withoutIbirapuera;
  }, [filial, companyKey, filialPerformanceWithVarejo]);

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
              {filialPerformanceDetalhada.map((item) => {
                const isPositive = item.changePercentage !== null && item.changePercentage > 0;
                const isNegative = item.changePercentage !== null && item.changePercentage < 0;
                const variationClass = isPositive
                  ? styles.variationPositive
                  : isNegative
                    ? styles.variationNegative
                    : styles.variationNeutral;

                return (
                  <li key={`${normalizeDisplayName(item.filialDisplayName)}-${item.filial}`} className={styles.listItem}>
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

              {filialPerformanceDetalhada.length > 0 ? (
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

              {filialPerformanceDetalhada.length === 0 ? (
                <li className={styles.state}>Nenhuma filial encontrada.</li>
              ) : null}
            </ul>
          </article>
        </section>
      ) : null}
    </section>
  );
}




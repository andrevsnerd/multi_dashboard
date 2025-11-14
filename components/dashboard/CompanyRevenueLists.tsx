"use client";

import { useEffect, useMemo, useState } from "react";

import type { CategoryRevenue, ProductRevenue } from "@/types/dashboard";

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
    throw new Error("Erro ao carregar top categorias");
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
  title = "Top faturamento",
  subtitle = "Produtos e categorias com maior faturamento no período selecionado.",
}: CompanyRevenueListsProps) {
  const [state, setState] = useState<RevenueState>({ products: [], categories: [] });
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

  return (
    <section className={styles.container}>
      {loading ? <div className={styles.loadingBar} /> : null}
      {error ? <div className={`${styles.state} ${styles.error}`}>{error}</div> : null}

      {!error ? (
        <section className={styles.grid}>
          <article className={styles.card}>
            <div className={styles.listHeader}>
              <h3 className={styles.cardTitle}>Top produtos</h3>
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
            <h3 className={styles.cardTitle}>Top categorias</h3>
            <ul className={styles.list}>
              {state.categories.map((item) => (
                <li key={item.categoryId} className={styles.listItem}>
                  <div className={styles.itemNameContainer}>
                    <strong className={styles.itemName}>{item.categoryName}</strong>
                  </div>
                  <div className={styles.itemMetrics}>
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
                </li>
              ))}
              {state.categories.length === 0 ? (
                <li className={styles.state}>Nenhuma categoria encontrada.</li>
              ) : null}
            </ul>
          </article>
        </section>
      ) : null}
    </section>
  );
}




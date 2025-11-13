"use client";

import { useEffect, useMemo, useState } from "react";

import type { CategoryRevenue, ProductRevenue } from "@/types/dashboard";

import styles from "./RevenueDashboard.module.css";

interface CompanyRevenueListsProps {
  companyKey: "nerd" | "scarfme";
  startDate: Date;
  endDate: Date;
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
): Promise<RevenueState> {
  const searchParams = new URLSearchParams({
    company,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
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
  title = "Top faturamento",
  subtitle = "Produtos e categorias com maior faturamento no período selecionado.",
}: CompanyRevenueListsProps) {
  const [state, setState] = useState<RevenueState>({ products: [], categories: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () => `${startDate.toISOString()}::${endDate.toISOString()}`,
    [startDate, endDate],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const revenue = await fetchRevenue(companyKey, startDate, endDate);
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
  }, [companyKey, rangeKey, startDate, endDate]);

  return (
    <section className={styles.container}>
      <header className={styles.header}>
        <div>
          <p className={styles.label}>{title}</p>
          <h2 className={styles.title}>Detalhamento de faturamento</h2>
        </div>
        <p className={styles.periodo}>{subtitle}</p>
      </header>

      {loading ? <div className={styles.loadingBar} /> : null}
      {error ? <div className={`${styles.state} ${styles.error}`}>{error}</div> : null}

      {!error ? (
        <section className={styles.grid}>
          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Top produtos</h3>
            <ul className={styles.list}>
              {state.products.map((item) => (
                <li key={item.productId} className={styles.listItem}>
                  <div>
                    <strong className={styles.itemName}>{item.productName}</strong>
                    <p className={styles.itemSubtitle}>Código: {item.productId}</p>
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
                  <div>
                    <strong className={styles.itemName}>{item.categoryName}</strong>
                    <p className={styles.itemSubtitle}>
                      Código: {item.categoryId ?? "N/A"}
                    </p>
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




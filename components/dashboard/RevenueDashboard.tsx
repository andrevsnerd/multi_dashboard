"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { type CategoryRevenue, type ProductRevenue } from "@/types/dashboard";

import styles from "./RevenueDashboard.module.css";

interface CompanyOption {
  key: "nerd" | "scarfme";
  label: string;
  description: string;
}

const COMPANIES: CompanyOption[] = [
  { key: "nerd", label: "NERD", description: "Filiais NERD (mês atual)" },
  { key: "scarfme", label: "Scarf Me", description: "Filiais Scarf Me (mês atual)" },
];

interface RevenueState {
  products: ProductRevenue[];
  categories: CategoryRevenue[];
}

async function fetchRevenue(company: string): Promise<RevenueState> {
  const [productsResponse, categoriesResponse] = await Promise.all([
    fetch(`/api/top-products?company=${company}&period=current-month`, {
      cache: "no-store",
    }),
    fetch(`/api/top-categories?company=${company}&period=current-month`, {
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

export default function RevenueDashboard() {
  const [selectedCompany, setSelectedCompany] = useState<CompanyOption | null>(null);
  const [state, setState] = useState<RevenueState>({ products: [], categories: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = useCallback((company: CompanyOption) => {
    setSelectedCompany(company);
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      if (!selectedCompany) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const revenue = await fetchRevenue(selectedCompany.key);
        if (active) {
          setState(revenue);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Não foi possível carregar os dados."
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
  }, [selectedCompany]);

  const headerText = useMemo(() => {
    if (!selectedCompany) {
      return "Selecione uma empresa para visualizar os resultados.";
    }
    return `${selectedCompany.label} · Top faturamento do mês atual`;
  }, [selectedCompany]);

  return (
    <div className={styles.container}>
      <div className={styles.selector}>
        {COMPANIES.map((option) => {
          const isActive = option.key === selectedCompany?.key;
          return (
            <button
              key={option.key}
              type="button"
              className={`${styles.selectorButton} ${
                isActive ? styles.selectorButtonActive : ""
              }`}
              onClick={() => handleSelect(option)}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <div className={styles.summary}>
        <h2 className={styles.summaryTitle}>Visão de faturamento</h2>
        <p className={styles.summarySubtitle}>{headerText}</p>
        {loading ? <div className={styles.loadingBar} /> : null}
      </div>

      {error ? (
        <div className={`${styles.state} ${styles.error}`}>{error}</div>
      ) : null}

      {!selectedCompany ? (
        <div className={styles.state}>
          Escolha “NERD” ou “Scarf Me” para aplicar os filtros específicos e carregar o faturamento.
        </div>
      ) : null}

      {selectedCompany && !error ? (
        <section className={styles.grid}>
          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Top produtos por faturamento</h3>
            <ul className={styles.list}>
              {state.products.map((item) => (
                <li key={item.productId} className={styles.listItem}>
                  <div className={styles.itemLabel}>
                    <span className={styles.itemTitle}>{item.productName}</span>
                    <span className={styles.itemSubtitle}>Código {item.productId}</span>
                  </div>
                  <div className={styles.metrics}>
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
                <li className={styles.state}>Nenhum produto encontrado para o período.</li>
              ) : null}
            </ul>
          </article>

          <article className={styles.card}>
            <h3 className={styles.cardTitle}>Top categorias por faturamento</h3>
            <ul className={styles.list}>
              {state.categories.map((item) => (
                <li key={item.categoryId} className={styles.listItem}>
                  <div className={styles.itemLabel}>
                    <span className={styles.itemTitle}>{item.categoryName}</span>
                    <span className={styles.itemSubtitle}>
                      Código {item.categoryId ?? "N/A"}
                    </span>
                  </div>
                  <div className={styles.metrics}>
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
                <li className={styles.state}>Nenhuma categoria encontrada para o período.</li>
              ) : null}
            </ul>
          </article>
        </section>
      ) : null}
    </div>
  );
}



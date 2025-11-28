"use client";

import { useEffect, useMemo, useState } from "react";

import type { DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import type { FilialPerformance } from "@/types/dashboard";
import { isEcommerceFilial, VAREJO_VALUE } from "@/lib/config/company";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./BlackFridayPage.module.css";

interface BlackFridayPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchFilialPerformance(
  company: string,
  startDate: Date,
  endDate: Date,
  filial: string | null,
): Promise<FilialPerformance[]> {
  const searchParams = new URLSearchParams({
    company,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/filial-performance?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar performance por filial");
  }

  const json = (await response.json()) as {
    data: FilialPerformance[];
  };

  return json.data;
}

export default function BlackFridayPage({
  companyKey,
  companyName,
}: BlackFridayPageProps) {
  // Para SCARFME, padrão é VAREJO; para NERD, padrão é null (todas as filiais)
  const [selectedFilial, setSelectedFilial] = useState<string | null>(
    companyKey === "scarfme" ? VAREJO_VALUE : null
  );
  const [filialPerformance, setFilialPerformance] = useState<FilialPerformance[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentDate, setCurrentDate] = useState<string>(() => {
    // Inicializar com a data de hoje (apenas a data, sem hora)
    const today = new Date();
    return today.toDateString();
  });

  // Sempre usar hoje como período
  const getTodayRange = useMemo(() => {
    const today = new Date();
    return {
      startDate: today,
      endDate: today,
    };
  }, [currentDate]); // Recalcula quando currentDate muda

  // Atualizar quando o dia mudar
  useEffect(() => {
    const checkDateChange = () => {
      const today = new Date();
      const todayString = today.toDateString();
      if (todayString !== currentDate) {
        setCurrentDate(todayString);
      }
    };

    // Verificar a cada minuto se o dia mudou
    const interval = setInterval(checkDateChange, 60000);
    return () => clearInterval(interval);
  }, [currentDate]);

  const rangeKey = useMemo(
    () =>
      `${getTodayRange.startDate.toISOString()}::${getTodayRange.endDate.toISOString()}::${selectedFilial ?? "all"}`,
    [getTodayRange.startDate, getTodayRange.endDate, selectedFilial],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const data = await fetchFilialPerformance(
          companyKey,
          getTodayRange.startDate,
          getTodayRange.endDate,
          selectedFilial,
        );
        if (active) {
          setFilialPerformance(data);
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
  }, [companyKey, rangeKey, getTodayRange.startDate, getTodayRange.endDate, selectedFilial]);

  // Filtrar por filial selecionada
  const filteredFilialPerformance = useMemo(() => {
    if (!selectedFilial) {
      return filialPerformance;
    }

    // Se for VAREJO, filtrar apenas filiais normais (não e-commerce)
    if (selectedFilial === VAREJO_VALUE) {
      return filialPerformance.filter(
        (item) => !isEcommerceFilial(companyKey, item.filial)
      );
    }

    // Filtrar pela filial específica
    return filialPerformance.filter((item) => item.filial === selectedFilial);
  }, [filialPerformance, selectedFilial, companyKey]);

  // Adicionar "VAREJO" como primeiro item apenas para SCARFME (quando não há filial selecionada)
  const filialPerformanceWithVarejo = useMemo(() => {
    if (companyKey !== "scarfme" || selectedFilial) {
      return filteredFilialPerformance;
    }

    // Filtrar apenas filiais normais (não e-commerce)
    const varejoFiliais = filteredFilialPerformance.filter(
      (item) => !isEcommerceFilial(companyKey, item.filial)
    );

    // Se não houver filiais de varejo, retornar a lista original
    if (varejoFiliais.length === 0) {
      return filteredFilialPerformance;
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

    const varejoItem: FilialPerformance = {
      filial: VAREJO_VALUE,
      filialDisplayName: "VAREJO",
      currentRevenue: varejoCurrentRevenue,
      previousRevenue: varejoPreviousRevenue,
      changePercentage: null,
    };

    // Retornar VAREJO primeiro, depois as outras filiais
    return [varejoItem, ...filteredFilialPerformance];
  }, [filteredFilialPerformance, companyKey, selectedFilial]);

  // Calcular total
  const totalRevenue = useMemo(() => {
    return filialPerformanceWithVarejo.reduce(
      (sum, item) => sum + item.currentRevenue,
      0
    );
  }, [filialPerformanceWithVarejo]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Black Friday</h1>
        <div className={styles.controls}>
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
          />
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.content}>
        {loading ? <div className={styles.loadingBar} /> : null}
        {error ? (
          <div className={`${styles.state} ${styles.error}`}>{error}</div>
        ) : null}

        {!error ? (
          <article className={styles.card}>
            <div className={styles.listHeader}>
              <div className={styles.cardTitleContainer}>
                <h3 className={styles.cardTitle}>PERFORMANCE {companyName.toUpperCase()}</h3>
                <span className={styles.cardDate}>
                  {getTodayRange.startDate.toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "2-digit",
                    year: "numeric",
                  })}
                </span>
              </div>
              <div className={styles.listHeaderRight}>
                <span className={styles.headerLabel}>Vendas</span>
              </div>
            </div>
            <ul className={styles.list}>
              {filialPerformanceWithVarejo.map((item) => (
                <li key={item.filial} className={styles.listItem}>
                  <div className={styles.itemNameContainer}>
                    <strong className={styles.itemName}>{item.filialDisplayName}</strong>
                  </div>
                  <div className={styles.itemMetrics}>
                    <div className={styles.priceColumn}>
                      <span className={styles.metricValue}>
                        {item.currentRevenue.toLocaleString("pt-BR", {
                          style: "currency",
                          currency: "BRL",
                        })}
                      </span>
                    </div>
                  </div>
                </li>
              ))}
              {filialPerformanceWithVarejo.length === 0 ? (
                <li className={styles.state}>Nenhuma filial encontrada.</li>
              ) : null}
            </ul>
            {filialPerformanceWithVarejo.length > 0 && (
              <div className={styles.totalContainer}>
                <div className={styles.totalLabel}>TOTAL</div>
                <div className={styles.totalValue}>
                  {totalRevenue.toLocaleString("pt-BR", {
                    style: "currency",
                    currency: "BRL",
                  })}
                </div>
              </div>
            )}
          </article>
        ) : null}
      </div>
    </div>
  );
}


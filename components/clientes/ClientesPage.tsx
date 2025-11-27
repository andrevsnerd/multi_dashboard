"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import VendedorFilter from "@/components/filters/VendedorFilter";
import ClientesTable from "@/components/clientes/ClientesTable";
import type { ClienteItem } from "@/lib/repositories/clientes";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ClientesPage.module.css";

interface ClientesPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchClientes(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  vendedor: string | null,
  searchTerm?: string | null,
  last7DaysRange?: DateRangeValue,
): Promise<{ 
  data: ClienteItem[]; 
  count: number; 
  countWeek: number; 
  countWeekPrevious: number; 
  countMonth: number;
  topFilial: { filial: string; count: number } | null;
  filialPerformance: Array<{
    filial: string;
    filialDisplayName: string;
    currentCount: number;
    previousCount: number;
    changePercentage: number | null;
  }>;
  topVendedores: Array<{
    vendedor: string;
    filial: string;
    count: number;
  }>;
}> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (vendedor) {
    searchParams.set("vendedor", vendedor);
  }

  if (searchTerm && searchTerm.trim().length >= 2) {
    searchParams.set("searchTerm", searchTerm.trim());
  }

  // Adicionar range dos últimos 7 dias para o cálculo semanal
  if (last7DaysRange) {
    searchParams.set("last7DaysStart", last7DaysRange.startDate.toISOString());
    searchParams.set("last7DaysEnd", last7DaysRange.endDate.toISOString());
  }

  const response = await fetch(`/api/clientes?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar clientes");
  }

  const json = (await response.json()) as {
    data: ClienteItem[];
    count: number;
    countWeek: number;
    countWeekPrevious: number;
    countMonth: number;
    topFilial: { filial: string; count: number } | null;
    filialPerformance: Array<{
      filial: string;
      filialDisplayName: string;
      currentCount: number;
      previousCount: number;
      changePercentage: number | null;
    }>;
    topVendedores: Array<{
      vendedor: string;
      filial: string;
      count: number;
    }>;
  };

  return json;
}

export default function ClientesPage({
  companyKey,
  companyName,
}: ClientesPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedVendedor, setSelectedVendedor] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [data, setData] = useState<ClienteItem[]>([]);
  const [count, setCount] = useState<number>(0);
  const [countWeek, setCountWeek] = useState<number>(0); // Últimos 7 dias
  const [countWeekPrevious, setCountWeekPrevious] = useState<number>(0); // 7 dias anteriores
  const [countMonth, setCountMonth] = useState<number>(0);
  const [topFilial, setTopFilial] = useState<{ filial: string; count: number } | null>(null);
  const [filialPerformance, setFilialPerformance] = useState<Array<{
    filial: string;
    filialDisplayName: string;
    currentCount: number;
    previousCount: number;
    changePercentage: number | null;
  }>>([]);
  const [topVendedores, setTopVendedores] = useState<Array<{
    vendedor: string;
    filial: string;
    count: number;
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcular períodos para crescimento semanal: últimos 7 dias vs 7 dias anteriores
  const last7DaysRange = useMemo(() => {
    const endDate = range.endDate;
    
    // Últimos 7 dias: de hoje até 7 dias atrás (incluindo hoje)
    const last7DaysEnd = new Date(endDate);
    const last7DaysStart = new Date(endDate);
    last7DaysStart.setDate(last7DaysStart.getDate() - 6); // 7 dias incluindo hoje
    
    return {
      startDate: last7DaysStart,
      endDate: last7DaysEnd,
    };
  }, [range.endDate]);

  const previousWeekRange = useMemo(() => {
    // Semana anterior: os 7 dias antes dos últimos 7 dias (de 8 a 14 dias atrás)
    const previousWeekEnd = new Date(last7DaysRange.startDate);
    previousWeekEnd.setDate(previousWeekEnd.getDate() - 1); // Um dia antes do início dos últimos 7 dias
    const previousWeekStart = new Date(previousWeekEnd);
    previousWeekStart.setDate(previousWeekStart.getDate() - 6); // 7 dias antes
    
    return {
      start: previousWeekStart,
      end: previousWeekEnd,
    };
  }, [last7DaysRange]);

  const previousMonthRange = useMemo(() => {
    const startDate = range.startDate;
    const endDate = range.endDate;
    
    // Calcular quantos dias já se passaram no mês atual
    // Se o período começa no primeiro dia do mês, usar a data final
    // Caso contrário, calcular desde o início do mês atual até a data final
    const currentMonthStart = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const daysInCurrentMonth = Math.ceil((endDate.getTime() - currentMonthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Calcular o mês anterior proporcional
    const previousMonthEnd = new Date(startDate);
    previousMonthEnd.setDate(previousMonthEnd.getDate() - 1); // Um dia antes do início atual
    const previousMonthStart = new Date(previousMonthEnd);
    previousMonthStart.setDate(1); // Primeiro dia do mês anterior
    
    // Ajustar para ter o mesmo número de dias do mês atual
    const previousMonthEndAdjusted = new Date(previousMonthStart);
    previousMonthEndAdjusted.setDate(Math.min(daysInCurrentMonth, previousMonthEnd.getDate()));
    
    return {
      start: previousMonthStart,
      end: previousMonthEndAdjusted,
    };
  }, [range.startDate, range.endDate]);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${selectedVendedor ?? 'all'}::${searchTerm.trim()}`,
    [range.startDate, range.endDate, selectedFilial, selectedVendedor, searchTerm]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await fetchClientes(
          companyKey,
          range,
          selectedFilial,
          selectedVendedor,
          searchTerm.trim().length >= 2 ? searchTerm.trim() : null,
          last7DaysRange
        );
        if (active) {
          setData(result.data);
          setCount(result.count);
          setCountWeek(result.countWeek);
          setCountWeekPrevious(result.countWeekPrevious);
          setCountMonth(result.countMonth);
          setTopFilial(result.topFilial);
          setFilialPerformance(result.filialPerformance || []);
          setTopVendedores(result.topVendedores || []);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível carregar os dados."
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
  }, [companyKey, range, rangeKey, selectedFilial, selectedVendedor, searchTerm]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Clientes</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
          />
          <VendedorFilter
            companyKey={companyKey}
            value={selectedVendedor}
            onChange={setSelectedVendedor}
            range={range}
            filial={selectedFilial}
          />
          <div className={styles.searchContainer}>
            <div className={styles.searchLabel}>Pesquisa</div>
            <div className={styles.searchInputWrapper}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Digite o nome do cliente ou vendedor..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                }}
              />
              {searchTerm && (
                <button
                  type="button"
                  className={styles.clearButton}
                  onClick={() => {
                    setSearchTerm("");
                  }}
                  aria-label="Limpar busca"
                >
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path
                      d="M12 4L4 12M4 4L12 12"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              )}
            </div>
          </div>
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Clientes Cadastrados</span>
            <span className={styles.kpiPeriod}>
              {range.startDate.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              })} - {range.endDate.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
          </div>
          <div className={styles.kpiValue}>{count.toLocaleString("pt-BR")}</div>
          {topFilial && (
            <div className={styles.kpiTopFilial}>
              <span className={styles.kpiTopFilialLabel}>Filial com mais cadastros:</span>
              <span className={styles.kpiTopFilialValue}>
                {topFilial.filial}
                <span className={styles.kpiTopFilialCount}>{topFilial.count.toLocaleString("pt-BR")}</span>
              </span>
            </div>
          )}
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Últimos 7 Dias</span>
            <span className={styles.kpiPeriod}>
              {last7DaysRange.startDate.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              })} - {last7DaysRange.endDate.toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
              })}
            </span>
          </div>
          <div className={styles.kpiValueContainer}>
            <div className={styles.kpiValue}>{countWeek.toLocaleString("pt-BR")}</div>
            {countWeekPrevious > 0 && (
              <span className={`${styles.kpiGrowthPercentInline} ${
                countWeek > countWeekPrevious ? styles.kpiGrowthPositive : countWeek < countWeekPrevious ? styles.kpiGrowthNegative : styles.kpiGrowthNeutral
              }`}>
                {countWeek > countWeekPrevious ? '↑' : countWeek < countWeekPrevious ? '↓' : '→'} {Math.abs(Math.round(((countWeek - countWeekPrevious) / countWeekPrevious) * 100))}%
              </span>
            )}
          </div>
          <div className={styles.kpiGrowth}>
            <div className={styles.kpiGrowthItem}>
              <span className={styles.kpiGrowthLabel}>Média diária:</span>
              <span className={styles.kpiGrowthValue}>{Math.round(countWeek / 7).toLocaleString("pt-BR")}</span>
            </div>
          </div>
        </div>

        <div className={styles.kpiCard}>
          <div className={styles.kpiHeader}>
            <span className={styles.kpiLabel}>Crescimento Mensal</span>
          </div>
          <div className={styles.kpiValueContainer}>
            <div className={styles.kpiValue}>
              {countMonth > 0 
                ? ((count - countMonth) >= 0 ? '+' : '') + (count - countMonth).toLocaleString("pt-BR")
                : '0'
              }
            </div>
            {countMonth > 0 && (
              <span className={`${styles.kpiGrowthPercentInline} ${
                count > countMonth ? styles.kpiGrowthPositive : count < countMonth ? styles.kpiGrowthNegative : styles.kpiGrowthNeutral
              }`}>
                {count > countMonth ? '↑' : count < countMonth ? '↓' : '→'} {Math.abs(Math.round(((count - countMonth) / countMonth) * 100))}%
              </span>
            )}
          </div>
          {countMonth > 0 && (
            <div className={styles.kpiGrowth}>
              <div className={styles.kpiGrowthItem}>
                <span className={styles.kpiGrowthLabel}>
                  Mês anterior
                  <span className={styles.kpiGrowthPeriod}>
                    ({previousMonthRange.start.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })} - {previousMonthRange.end.toLocaleDateString("pt-BR", {
                      day: "2-digit",
                      month: "2-digit",
                    })})
                  </span>:
                </span>
                <span className={styles.kpiGrowthValue}>{countMonth.toLocaleString("pt-BR")}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Cards de Performance por Filial e Top Vendedores */}
      <div className={styles.performanceGrid}>
        <div className={styles.performanceCard}>
          <div className={styles.performanceCardHeader}>
            <h3 className={styles.performanceCardTitle}>CADASTROS POR FILIAL</h3>
            <div className={styles.performanceCardHeaderRight}>
              <span className={styles.performanceHeaderLabel}>Cadastros</span>
              <span className={styles.performanceHeaderLabel}>Var. %</span>
            </div>
          </div>
          <ul className={styles.performanceList}>
            {filialPerformance.length === 0 ? (
              <li className={styles.performanceState}>Nenhuma filial encontrada.</li>
            ) : (
              filialPerformance.map((item) => {
                const isPositive = item.changePercentage !== null && item.changePercentage > 0;
                const isNegative = item.changePercentage !== null && item.changePercentage < 0;
                const variationClass = isPositive
                  ? styles.performanceVariationPositive
                  : isNegative
                    ? styles.performanceVariationNegative
                    : styles.performanceVariationNeutral;

                return (
                  <li key={item.filial} className={styles.performanceListItem}>
                    <div className={styles.performanceItemNameContainer}>
                      <strong className={styles.performanceItemName}>{item.filialDisplayName}</strong>
                    </div>
                    <div className={styles.performanceItemMetrics}>
                      <div className={styles.performanceMetricRow}>
                        <div className={styles.performancePriceColumn}>
                          <span className={styles.performanceMetricValue}>
                            {item.currentCount.toLocaleString("pt-BR")}
                          </span>
                        </div>
                        <div className={`${styles.performanceVariationBadge} ${variationClass}`}>
                          {item.changePercentage !== null ? (
                            <>
                              {isPositive ? (
                                <span className={styles.performanceVariationArrow}>↑</span>
                              ) : isNegative ? (
                                <span className={styles.performanceVariationArrow}>↓</span>
                              ) : null}
                              <span className={styles.performanceVariationValue}>
                                {Math.abs(item.changePercentage).toLocaleString("pt-BR", {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}%
                              </span>
                            </>
                          ) : (
                            <span className={styles.performanceVariationValue}>--</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className={styles.performanceCard}>
          <div className={styles.performanceCardHeader}>
            <h3 className={styles.performanceCardTitle}>TOP 5 VENDEDORES</h3>
            <div className={styles.performanceCardHeaderRight}>
              <span className={styles.performanceHeaderLabel}>Cadastros</span>
            </div>
          </div>
          <ul className={styles.performanceList}>
            {topVendedores.length === 0 ? (
              <li className={styles.performanceState}>Nenhum vendedor encontrado.</li>
            ) : (
              topVendedores.map((item, index) => (
                <li key={`${item.vendedor}-${item.filial}-${index}`} className={styles.performanceListItem}>
                  <div className={styles.performanceItemNameContainer}>
                    <strong className={styles.performanceItemName}>{item.vendedor}</strong>
                    <span className={styles.performanceItemSubtitle}>{item.filial}</span>
                  </div>
                  <div className={styles.performanceItemMetrics}>
                    <div className={styles.performanceMetricRow}>
                      <div className={styles.performancePriceColumn}>
                        <span className={styles.performanceMetricValue}>
                          {item.count.toLocaleString("pt-BR")}
                        </span>
                      </div>
                    </div>
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner}></span>
          <span className={styles.loadingText}>Carregando dados…</span>
        </div>
      )}

      <div className={loading ? styles.contentLoading : undefined}>
        <ClientesTable 
          data={data} 
          loading={loading} 
          companyKey={companyKey}
        />
      </div>
    </div>
  );
}


"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
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
  searchTerm?: string | null,
): Promise<{ data: ClienteItem[]; count: number }> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (searchTerm && searchTerm.trim().length >= 2) {
    searchParams.set("searchTerm", searchTerm.trim());
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
  const [searchTerm, setSearchTerm] = useState("");
  const [data, setData] = useState<ClienteItem[]>([]);
  const [count, setCount] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${searchTerm.trim()}`,
    [range.startDate, range.endDate, selectedFilial, searchTerm]
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
          searchTerm.trim().length >= 2 ? searchTerm.trim() : null
        );
        if (active) {
          setData(result.data);
          setCount(result.count);
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
  }, [companyKey, range, rangeKey, selectedFilial, searchTerm]);

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

      {/* KPI Card */}
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
              year: "numeric",
            })}
          </span>
        </div>
        <div className={styles.kpiValue}>{count.toLocaleString("pt-BR")}</div>
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


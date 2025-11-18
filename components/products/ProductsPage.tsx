"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import SelectFilter from "@/components/filters/SelectFilter";
import SummaryCards from "@/components/dashboard/SummaryCards";
import ProductsTable from "@/components/products/ProductsTable";
import type { ProductDetail } from "@/lib/repositories/products";
import type { SalesSummary } from "@/types/dashboard";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProductsPage.module.css";

interface ProductsPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

const EMPTY_SUMMARY: SalesSummary = {
  totalRevenue: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  totalQuantity: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  totalTickets: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  averageTicket: { currentValue: 0, previousValue: 0, changePercentage: 0 },
  totalStockQuantity: { currentValue: 0, previousValue: 0, changePercentage: null },
  totalStockValue: { currentValue: 0, previousValue: 0, changePercentage: null },
};

async function fetchProducts(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  grupo: string | null
): Promise<ProductDetail[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (grupo) {
    searchParams.set("grupo", grupo);
  }

  const response = await fetch(`/api/products?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar produtos");
  }

  const json = (await response.json()) as {
    data: ProductDetail[];
  };

  return json.data;
}

async function fetchSummary(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  grupo: string | null
): Promise<SalesSummary> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  if (grupo) {
    searchParams.set("grupo", grupo);
  }

  const response = await fetch(`/api/sales-summary?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar resumo de vendas");
  }

  const json = (await response.json()) as {
    data: SalesSummary;
  };

  return json.data;
}

export default function ProductsPage({
  companyKey,
  companyName,
}: ProductsPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedGrupo, setSelectedGrupo] = useState<string | null>(null);
  const [data, setData] = useState<ProductDetail[]>([]);
  const [summary, setSummary] = useState<SalesSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [availableGrupos, setAvailableGrupos] = useState<string[]>([]);

  // Buscar grupos disponíveis para NERD
  useEffect(() => {
    if (companyKey !== "nerd") {
      setAvailableGrupos([]);
      return;
    }

    let active = true;

    async function loadGrupos() {
      try {
        const searchParams = new URLSearchParams({
          company: companyKey,
          start: range.startDate.toISOString(),
          end: range.endDate.toISOString(),
        });

        if (selectedFilial) {
          searchParams.set("filial", selectedFilial);
        }

        const response = await fetch(`/api/products/grupos?${searchParams.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          return;
        }

        const json = (await response.json()) as {
          data: string[];
        };

        if (active) {
          setAvailableGrupos(json.data || []);
        }
      } catch (err) {
        // Silenciosamente falhar
      }
    }

    void loadGrupos();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}::${selectedGrupo ?? 'all'}`,
    [range.startDate, range.endDate, selectedFilial, selectedGrupo]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [productsData, summaryData] = await Promise.all([
          fetchProducts(companyKey, range, selectedFilial, selectedGrupo),
          fetchSummary(companyKey, range, selectedFilial, selectedGrupo),
        ]);
        if (active) {
          setData(productsData);
          setSummary(summaryData);
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
  }, [companyKey, range, rangeKey, selectedFilial, selectedGrupo]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Produtos</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
          />
          {companyKey === "nerd" && (
            <SelectFilter
              label="Grupo"
              value={selectedGrupo}
              options={availableGrupos}
              onChange={setSelectedGrupo}
            />
          )}
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <SummaryCards
        summary={summary}
        companyName={companyName}
        dateRange={range}
      />

      <ProductsTable data={data} loading={loading} />
    </div>
  );
}


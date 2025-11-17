"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import StockByFilialTable from "@/components/stock/StockByFilialTable";
import type { StockByFilialItem } from "@/lib/repositories/stockByFilial";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./StockByFilialPage.module.css";

interface StockByFilialPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchStockByFilial(
  company: string,
  range: DateRangeValue,
  filial: string | null
): Promise<StockByFilialItem[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/stock-by-filial?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar estoque por filial");
  }

  const json = (await response.json()) as {
    data: StockByFilialItem[];
  };

  return json.data;
}

export default function StockByFilialPage({
  companyKey,
  companyName,
}: StockByFilialPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [data, setData] = useState<StockByFilialItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showItemsWithoutSales, setShowItemsWithoutSales] = useState(false);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}`,
    [range.startDate, range.endDate]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const stockData = await fetchStockByFilial(
          companyKey,
          range,
          null // Sempre mostrar todas as filiais nesta página
        );
        if (active) {
          setData(stockData);
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
  }, [companyKey, range, rangeKey]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Estoque por Filial</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          {loading ? (
            <span className={styles.loading}>Carregando dados…</span>
          ) : null}
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      <div className={styles.filterRow}>
        <label className={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={showItemsWithoutSales}
            onChange={(e) => setShowItemsWithoutSales(e.target.checked)}
            className={styles.checkbox}
          />
          <span>Mostrar itens sem vendas</span>
        </label>
      </div>

      <StockByFilialTable
        companyKey={companyKey}
        data={data}
        loading={loading}
        showItemsWithoutSales={showItemsWithoutSales}
      />
    </div>
  );
}


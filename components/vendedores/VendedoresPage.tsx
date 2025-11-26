"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import VendedoresTable from "@/components/vendedores/VendedoresTable";
import type { VendedorItem } from "@/lib/repositories/vendedores";
import { getCurrentMonthRange } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./VendedoresPage.module.css";

interface VendedoresPageProps {
  companyKey: CompanyKey;
  companyName: string;
}

async function fetchVendedores(
  company: string,
  range: DateRangeValue,
  filial: string | null
): Promise<VendedorItem[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/vendedores?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar vendedores");
  }

  const json = (await response.json()) as {
    data: VendedorItem[];
  };

  return json.data;
}

export default function VendedoresPage({
  companyKey,
  companyName,
}: VendedoresPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [data, setData] = useState<VendedorItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}`,
    [range.startDate, range.endDate, selectedFilial]
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const vendedoresData = await fetchVendedores(
          companyKey,
          range,
          selectedFilial
        );
        if (active) {
          setData(vendedoresData);
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
  }, [companyKey, range, rangeKey, selectedFilial]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <h1 className={styles.title}>Vendedores</h1>
        <div className={styles.controls}>
          <DateRangeFilter value={range} onChange={setRange} />
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={setSelectedFilial}
          />
          {error ? <span className={styles.error}>{error}</span> : null}
        </div>
      </div>

      {loading && (
        <div className={styles.loadingBanner}>
          <span className={styles.loadingSpinner}></span>
          <span className={styles.loadingText}>Carregando dados…</span>
        </div>
      )}

      <div className={loading ? styles.contentLoading : undefined}>
        <VendedoresTable data={data} loading={loading} companyKey={companyKey} />
      </div>
    </div>
  );
}


"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import SummaryCards from "@/components/dashboard/SummaryCards";
import CompanyRevenueLists from "@/components/dashboard/CompanyRevenueLists";
import type { SalesSummary } from "@/types/dashboard";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "./CompanyDashboard.module.css";

interface CompanyDashboardProps {
  companyKey: "nerd" | "scarfme";
  companyName: string;
}

const DEFAULT_SUMMARY: SalesSummary = {
  totalRevenue: 0,
  totalQuantity: 0,
  totalTickets: 0,
  averageTicket: 0,
};

async function fetchSummary(company: string, range: DateRangeValue) {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  const response = await fetch(`/api/sales-summary?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar resumo de vendas");
  }

  const json = (await response.json()) as { data: SalesSummary };
  return json.data;
}

export default function CompanyDashboard({
  companyKey,
  companyName,
}: CompanyDashboardProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return {
      startDate: range.start,
      endDate: range.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [summary, setSummary] = useState<SalesSummary>(DEFAULT_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () => `${range.startDate.toISOString()}::${range.endDate.toISOString()}`,
    [range.startDate, range.endDate],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSummary(companyKey, range);
        if (active) {
          setSummary(data);
        }
      } catch (err) {
        if (active) {
          setError(
            err instanceof Error ? err.message : "Não foi possível carregar o resumo.",
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
      <div className={styles.controls}>
        <DateRangeFilter value={range} onChange={setRange} />
        {loading ? <span className={styles.loading}>Atualizando métricas…</span> : null}
        {error ? <span className={styles.error}>{error}</span> : null}
      </div>

      <SummaryCards summary={summary} companyName={companyName} />

      <CompanyRevenueLists
        companyKey={companyKey}
        startDate={range.startDate}
        endDate={range.endDate}
        subtitle="Dados agregados para o intervalo selecionado."
      />
    </div>
  );
}



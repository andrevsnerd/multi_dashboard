"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import SummaryCards from "@/components/dashboard/SummaryCards";
import CompanyRevenueLists from "@/components/dashboard/CompanyRevenueLists";
import type { MetricSummary, SalesSummary } from "@/types/dashboard";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "./CompanyDashboard.module.css";

interface CompanyDashboardProps {
  companyKey: "nerd" | "scarfme";
  companyName: string;
}

const EMPTY_METRIC: MetricSummary = {
  currentValue: 0,
  previousValue: 0,
  changePercentage: 0,
};

const DEFAULT_SUMMARY: SalesSummary = {
  totalRevenue: { ...EMPTY_METRIC },
  totalQuantity: { ...EMPTY_METRIC },
  totalTickets: { ...EMPTY_METRIC },
  averageTicket: { ...EMPTY_METRIC },
};

interface SalesSummaryResponse {
  summary: SalesSummary;
  lastAvailableDate: Date | null;
  availableRange: {
    start: Date | null;
    end: Date | null;
  };
}

async function fetchSummary(
  company: string,
  range: DateRangeValue,
): Promise<SalesSummaryResponse> {
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

  const json = (await response.json()) as {
    data: SalesSummary;
    lastAvailableDate?: string | null;
    availableRange?: {
      start: string | null;
      end: string | null;
    };
  };

  const lastAvailableDate = json.lastAvailableDate
    ? new Date(json.lastAvailableDate)
    : null;
  const availableRange = {
    start: json.availableRange?.start ? new Date(json.availableRange.start) : null,
    end: json.availableRange?.end ? new Date(json.availableRange.end) : null,
  };

  return {
    summary: json.data,
    lastAvailableDate,
    availableRange,
  };
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
  const [lastAvailableDate, setLastAvailableDate] = useState<Date | null>(
    initialRange.endDate,
  );
  const [availableSalesRange, setAvailableSalesRange] = useState<{
    start: Date | null;
    end: Date | null;
  }>({
    start: null,
    end: initialRange.endDate,
  });
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
        const {
          summary: data,
          lastAvailableDate: apiLastAvailableDate,
          availableRange,
        } = await fetchSummary(companyKey, range);
        if (active) {
          setSummary(data);
          setLastAvailableDate(availableRange.end ?? apiLastAvailableDate);
          setAvailableSalesRange(availableRange);
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

  useEffect(() => {
    if (!lastAvailableDate) {
      return;
    }

    if (range.endDate.getTime() <= lastAvailableDate.getTime()) {
      return;
    }

    setRange((prev) => {
      if (prev.endDate.getTime() <= lastAvailableDate.getTime()) {
        return prev;
      }

      const clampedEnd = new Date(lastAvailableDate.getTime());
      const startTime = prev.startDate.getTime();
      const clampedStart =
        startTime > clampedEnd.getTime() ? new Date(clampedEnd.getTime()) : prev.startDate;

      return {
        startDate: clampedStart,
        endDate: clampedEnd,
      };
    });
  }, [lastAvailableDate, range.endDate]);

  return (
    <div className={styles.wrapper}>
      <div className={styles.controls}>
        <DateRangeFilter
          value={range}
          onChange={setRange}
          maxSelectableDate={lastAvailableDate ?? undefined}
          availableRange={
            availableSalesRange.start && availableSalesRange.end
              ? {
                  startDate: availableSalesRange.start,
                  endDate: availableSalesRange.end,
                }
              : undefined
          }
        />
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



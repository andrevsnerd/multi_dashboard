"use client";

import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import SummaryCards from "@/components/dashboard/SummaryCards";
import DailyRevenueChart from "@/components/dashboard/DailyRevenueChart";
import GoalCard from "@/components/dashboard/GoalCard";
import GoalsModal from "@/components/dashboard/GoalsModal";
import EngineButton from "@/components/layout/EngineButton";
import CompanyRevenueLists from "@/components/dashboard/CompanyRevenueLists";
import type {
  MetricSummary,
  SalesSummary,
  FilialPerformance,
  CategoryRevenue,
  ProductRevenue,
} from "@/types/dashboard";
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
  totalStockQuantity: { ...EMPTY_METRIC, changePercentage: null },
  totalStockValue: { ...EMPTY_METRIC, changePercentage: null },
};

interface DailyRevenueData {
  date: string;
  revenue: number;
}

interface DashboardData {
  filialPerformance: FilialPerformance[];
  topProducts: ProductRevenue[];
  topCategories: CategoryRevenue[];
  dailyRevenue: DailyRevenueData[];
  summary: SalesSummary;
  lastAvailableDate: string | null;
  availableRange: { start: string | null; end: string | null };
  goals: Record<string, number>;
}

function buildMetricFromTotals(current: number, previous: number): MetricSummary {
  if (previous === 0 && current === 0) {
    return { currentValue: current, previousValue: previous, changePercentage: 0 };
  }
  const changePercentage =
    previous === 0 ? null : Number((((current - previous) / previous) * 100).toFixed(1));
  return { currentValue: current, previousValue: previous, changePercentage };
}

function computeFilialKpi(rows: FilialPerformance[]): MetricSummary {
  const filtered = rows.filter(
    (item) =>
      item.currentRevenue > 0 &&
      item.filialDisplayName !== "MATRIZ" &&
      item.filialDisplayName !== "VAREJO",
  );

  const byName = new Map<string, { current: number; previous: number }>();
  for (const item of filtered) {
    const key = item.filialDisplayName;
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        current: Number(item.currentRevenue ?? 0),
        previous: Number(item.previousRevenue ?? 0),
      });
    } else {
      existing.current += Number(item.currentRevenue ?? 0);
      existing.previous += Number(item.previousRevenue ?? 0);
    }
  }

  const totalCurrent = Array.from(byName.values()).reduce((s, v) => s + v.current, 0);
  const totalPrevious = Array.from(byName.values()).reduce((s, v) => s + v.previous, 0);
  return buildMetricFromTotals(totalCurrent, totalPrevious);
}

async function fetchDashboardData(
  company: string,
  range: DateRangeValue,
  filial: string | null,
  month: number,
  year: number,
  linhas: string[] | null,
): Promise<DashboardData> {
  const isSameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();

  const effectiveEndDate = isSameDay(range.endDate, new Date()) ? new Date() : range.endDate;

  const params = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: effectiveEndDate.toISOString(),
    month: String(month),
    year: String(year),
  });

  if (filial) {
    params.set("filial", filial);
  }

  (linhas ?? []).forEach((linha) => {
    params.append("linha", linha);
  });

  const response = await fetch(`/api/dashboard-data?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    let message = "Erro ao carregar dados do dashboard";
    try {
      const errJson = (await response.json()) as { error?: string; code?: string };
      if (errJson.error) message = errJson.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  return response.json() as Promise<DashboardData>;
}

export default function CompanyDashboard({
  companyKey,
  companyName,
}: CompanyDashboardProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return { startDate: range.start, endDate: range.end };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [filtrarEletronicos, setFiltrarEletronicos] = useState(companyKey === "nerd");
  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);

  const monthYear = useMemo(() => {
    const date = range.startDate;
    return { month: date.getMonth(), year: date.getFullYear() };
  }, [range.startDate]);

  // Para NERD, o toggle "Eletrônicos" filtra somente a linha ELETRONICOS
  // (mesma lógica da Curva ABC e da página de Produtos).
  const linhas = useMemo<string[] | null>(
    () => (companyKey === "nerd" && filtrarEletronicos ? ["ELETRONICOS"] : null),
    [companyKey, filtrarEletronicos],
  );

  const rangeKey = useMemo(
    () =>
      `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? "all"}::${(linhas ?? []).join(",")}`,
    [range.startDate, range.endDate, selectedFilial, linhas],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchDashboardData(
          companyKey,
          range,
          selectedFilial,
          monthYear.month,
          monthYear.year,
          linhas,
        );
        if (active) {
          setDashboardData(data);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o dashboard.");
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
  }, [companyKey, rangeKey, retryKey, range, selectedFilial, monthYear.month, monthYear.year, linhas]);

  // Recarregar metas quando o modal fechar
  useEffect(() => {
    if (isGoalsModalOpen) return;
    if (!dashboardData) return;
    let active = true;
    async function reloadGoals() {
      const params = new URLSearchParams({
        company: companyKey,
        month: String(monthYear.month),
        year: String(monthYear.year),
      });
      try {
        const res = await fetch(`/api/goals?${params.toString()}`, { cache: "no-store" });
        if (res.ok && active) {
          const json = (await res.json()) as { data: Record<string, number> };
          setDashboardData((prev) => prev ? { ...prev, goals: json.data ?? {} } : prev);
        }
      } catch {
        // silencioso
      }
    }
    void reloadGoals();
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isGoalsModalOpen]);

  const summary: SalesSummary = useMemo(() => {
    if (!dashboardData) return DEFAULT_SUMMARY;
    return {
      ...dashboardData.summary,
      totalRevenue: selectedFilial
        ? dashboardData.summary.totalRevenue
        : computeFilialKpi(dashboardData.filialPerformance),
    };
  }, [dashboardData, selectedFilial]);

  const currentGoal = useMemo(() => {
    if (!dashboardData) return 0;
    const goals = dashboardData.goals;
    if (selectedFilial) return goals[selectedFilial] ?? 0;
    return Object.values(goals).reduce((sum, v) => sum + (v as number), 0);
  }, [dashboardData, selectedFilial]);

  const monthProjection = useMemo(() => {
    if (!dashboardData) return 0;
    const rawRevenue = dashboardData.summary.totalRevenue.currentValue;
    if (rawRevenue === 0) return 0;

    const referenceDate = range.endDate;
    const monthStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1);
    const daysPassed =
      Math.floor((referenceDate.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    if (daysPassed <= 0) return 0;

    const lastDayOfMonth = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth() + 1,
      0,
    );
    const totalDaysInMonth = lastDayOfMonth.getDate();
    return (rawRevenue / daysPassed) * totalDaysInMonth;
  }, [dashboardData, range.endDate]);

  const availableSalesRange = useMemo(() => {
    if (!dashboardData) return { start: null, end: initialRange.endDate };
    return {
      start: dashboardData.availableRange.start
        ? new Date(dashboardData.availableRange.start)
        : null,
      end: dashboardData.availableRange.end
        ? new Date(dashboardData.availableRange.end)
        : initialRange.endDate,
    };
  }, [dashboardData, initialRange.endDate]);

  const handleRetry = () => {
    setError(null);
    setRetryKey((k) => k + 1);
  };

  const currentRevenue = summary.totalRevenue.currentValue;

  return (
    <>
      <div className={styles.wrapper}>
        <div className={styles.headerRow}>
          <div className={styles.controls}>
            <DateRangeFilter
              value={range}
              onChange={setRange}
              availableRange={
                availableSalesRange.start
                  ? {
                      startDate: availableSalesRange.start,
                      endDate: availableSalesRange.end ?? new Date(),
                    }
                  : undefined
              }
            />
            <FilialFilter
              companyKey={companyKey}
              value={selectedFilial}
              onChange={setSelectedFilial}
            />
            {companyKey === "nerd" && (
              <label className={styles.checkboxLabel} title="Filtra apenas produtos da linha Eletrônicos">
                <input
                  type="checkbox"
                  checked={filtrarEletronicos}
                  onChange={(e) => setFiltrarEletronicos(e.target.checked)}
                />
                Eletrônicos
              </label>
            )}
            {error ? (
              <span className={styles.error}>
                {error}
                <button
                  type="button"
                  className={styles.retryButton}
                  onClick={handleRetry}
                >
                  Tentar novamente
                </button>
              </span>
            ) : null}
          </div>
          <EngineButton onMetasClick={() => setIsGoalsModalOpen(true)} />
        </div>

        {loading && (
          <div className={styles.loadingBanner}>
            <span className={styles.loadingSpinner}></span>
            <span className={styles.loadingText}>Atualizando métricas…</span>
          </div>
        )}

        <div className={loading ? styles.contentLoading : undefined}>
          <SummaryCards
            summary={loading ? DEFAULT_SUMMARY : summary}
            companyName={companyName}
            dateRange={range}
          />
        </div>

        <div className={loading ? styles.contentLoading : undefined}>
          <div className={styles.overviewSection}>
            <div className={styles.chartsRow}>
              <GoalCard
                currentValue={loading ? 0 : currentRevenue}
                goal={currentGoal}
                projection={loading ? 0 : monthProjection}
                label={selectedFilial ? "Meta da Filial" : "Meta Geral"}
              />
              <DailyRevenueChart
                companyKey={companyKey}
                startDate={range.startDate}
                endDate={range.endDate}
                filial={selectedFilial}
                linhas={linhas}
                initialData={dashboardData?.dailyRevenue}
              />
            </div>
          </div>

          <CompanyRevenueLists
            companyKey={companyKey}
            startDate={range.startDate}
            endDate={range.endDate}
            filial={selectedFilial}
            linhas={linhas}
            filialPerformance={dashboardData?.filialPerformance ?? []}
            summaryRevenue={summary.totalRevenue}
            initialProducts={dashboardData?.topProducts}
            initialCategories={dashboardData?.topCategories}
          />
        </div>
      </div>

      <GoalsModal
        companyKey={companyKey}
        isOpen={isGoalsModalOpen}
        onClose={() => setIsGoalsModalOpen(false)}
        monthYear={monthYear}
      />
    </>
  );
}

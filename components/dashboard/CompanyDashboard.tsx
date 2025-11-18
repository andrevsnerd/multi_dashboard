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
import type { MetricSummary, SalesSummary } from "@/types/dashboard";
import { getCurrentMonthRange } from "@/lib/utils/date";
import { resolveCompany } from "@/lib/config/company";

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
  filial: string | null,
): Promise<SalesSummaryResponse> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });
  
  if (filial) {
    searchParams.set('filial', filial);
  }

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
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
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
  const [isGoalsModalOpen, setIsGoalsModalOpen] = useState(false);
  const [projectionRevenue, setProjectionRevenue] = useState<number>(0);

  const rangeKey = useMemo(
    () => `${range.startDate.toISOString()}::${range.endDate.toISOString()}::${selectedFilial ?? 'all'}`,
    [range.startDate, range.endDate, selectedFilial],
  );

  // Obter mês/ano do período selecionado
  const monthYear = useMemo(() => {
    const date = range.startDate;
    return {
      month: date.getMonth(),
      year: date.getFullYear(),
    };
  }, [range.startDate]);

  // Carregar metas da API para o mês específico
  const [goals, setGoals] = useState<Record<string, number>>({});
  const [goalsLoading, setGoalsLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadGoals() {
      setGoalsLoading(true);
      try {
        const response = await fetch(
          `/api/goals?company=${companyKey}&month=${monthYear.month}&year=${monthYear.year}`,
          { cache: "no-store" }
        );
        if (active) {
          if (response.ok) {
            const json = (await response.json()) as { data: Record<string, number> };
            setGoals(json.data || {});
          } else {
            setGoals({});
          }
        }
      } catch {
        if (active) {
          setGoals({});
        }
      } finally {
        if (active) {
          setGoalsLoading(false);
        }
      }
    }

    void loadGoals();

    return () => {
      active = false;
    };
  }, [companyKey, monthYear.month, monthYear.year, isGoalsModalOpen]);

  // Calcular meta atual (filial específica ou soma de todas)
  const currentGoal = useMemo(() => {
    if (selectedFilial) {
      return goals[selectedFilial] || 0;
    }
    // Soma de todas as filiais
    return Object.values(goals).reduce((sum, goal) => sum + (goal as number), 0);
  }, [goals, selectedFilial]);

  const currentRevenue = summary.totalRevenue.currentValue;

  // Buscar revenue ajustado para projeção (até o dia anterior)
  useEffect(() => {
    let active = true;

    async function loadProjectionRevenue() {
      try {
        // Calcular range ajustado: até o dia anterior ao endDate
        const adjustedEndDate = new Date(range.endDate);
        adjustedEndDate.setDate(adjustedEndDate.getDate() - 1);
        adjustedEndDate.setHours(23, 59, 59, 999); // Fim do dia anterior

        const adjustedRange = {
          startDate: range.startDate,
          endDate: adjustedEndDate,
        };

        const { summary: projectionSummary } = await fetchSummary(
          companyKey,
          adjustedRange,
          selectedFilial,
        );

        if (active) {
          setProjectionRevenue(projectionSummary.totalRevenue.currentValue);
        }
      } catch (err) {
        // Em caso de erro, usar o revenue atual como fallback
        if (active) {
          setProjectionRevenue(summary.totalRevenue.currentValue);
        }
      }
    }

    void loadProjectionRevenue();

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial, summary.totalRevenue.currentValue]);

  // Calcular projeção do mês
  const monthProjection = useMemo(() => {
    if (projectionRevenue === 0) return 0;

    // Obter data de referência (endDate do range)
    const referenceDate = range.endDate;
    // Usar o dia anterior ao endDate para evitar que o dia atual (incompleto) afete a projeção
    const previousDate = new Date(referenceDate);
    previousDate.setDate(previousDate.getDate() - 1);
    
    const monthStart = new Date(previousDate.getFullYear(), previousDate.getMonth(), 1);
    
    // Calcular dias passados do mês (desde o início do mês até o dia anterior ao endDate)
    const daysPassed = Math.floor((previousDate.getTime() - monthStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // Evitar divisão por zero
    if (daysPassed <= 0) return 0;
    
    // Calcular dias totais do mês
    const lastDayOfMonth = new Date(previousDate.getFullYear(), previousDate.getMonth() + 1, 0);
    const totalDaysInMonth = lastDayOfMonth.getDate();
    
    // Calcular média diária e projeção
    // Projeção = (faturamento atual / dias já passados) * dias totais do mês
    // Usar projectionRevenue que considera vendas apenas até o dia anterior
    const averageDaily = projectionRevenue / daysPassed;
    const projection = averageDaily * totalDaysInMonth;
    
    return projection;
  }, [projectionRevenue, range.endDate]);

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
        } = await fetchSummary(companyKey, range, selectedFilial);
        if (active) {
          setSummary(data);
          setLastAvailableDate(apiLastAvailableDate);
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
            {loading ? <span className={styles.loading}>Atualizando métricas…</span> : null}
            {error ? <span className={styles.error}>{error}</span> : null}
          </div>
          <EngineButton onMetasClick={() => setIsGoalsModalOpen(true)} />
        </div>

        <SummaryCards summary={summary} companyName={companyName} dateRange={range} />

        <div className={styles.overviewSection}>
          <div className={styles.chartsRow}>
            <GoalCard
              currentValue={currentRevenue}
              goal={currentGoal}
              projection={monthProjection}
              label={selectedFilial ? "Meta da Filial" : "Meta Geral"}
            />
            <DailyRevenueChart
              companyKey={companyKey}
              startDate={range.startDate}
              endDate={range.endDate}
              filial={selectedFilial}
            />
          </div>
        </div>

        <CompanyRevenueLists
          companyKey={companyKey}
          startDate={range.startDate}
          endDate={range.endDate}
          filial={selectedFilial}
        />
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



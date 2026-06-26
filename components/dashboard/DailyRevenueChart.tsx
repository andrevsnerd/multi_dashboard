"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

import { useTheme } from "@/components/theme/ThemeContext";
import styles from "./DailyRevenueChart.module.css";

interface DailyRevenueData {
  date: string;
  revenue: number;
}

interface DailyRevenueChartProps {
  companyKey: "nerd" | "scarfme";
  startDate: Date;
  endDate: Date;
  filial?: string | null;
  linhas?: string[] | null;
  initialData?: DailyRevenueData[];
}

async function fetchDailyRevenue(
  company: string,
  startDate: Date,
  endDate: Date,
  filial: string | null,
  linhas: string[] | null,
): Promise<DailyRevenueData[]> {
  const searchParams = new URLSearchParams({
    company,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

  (linhas ?? []).forEach((linha) => {
    searchParams.append("linha", linha);
  });

  const response = await fetch(`/api/daily-revenue?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar faturamento diário");
  }

  const json = (await response.json()) as { data: DailyRevenueData[] };

  return json.data;
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function formatDate(dateString: string): string {
  try {
    const date = parseISO(dateString);
    return format(date, "dd/MM", { locale: ptBR });
  } catch {
    return dateString;
  }
}

export default function DailyRevenueChart({
  companyKey,
  startDate,
  endDate,
  filial = null,
  linhas = null,
  initialData,
}: DailyRevenueChartProps) {
  const [data, setData] = useState<DailyRevenueData[]>(initialData ?? []);
  const [loading, setLoading] = useState(initialData === undefined);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();
  const c =
    theme === "dark"
      ? {
          grid: "rgba(148, 163, 184, 0.16)",
          axis: "#64748b",
          axisText: "#94a3b8",
          line: "#cbd5e1",
          tooltipBg: "#1a2433",
          tooltipBorder: "#29344b",
          tooltipText: "#cbd5e1",
        }
      : {
          grid: "#e2e8f0",
          axis: "#94a3b8",
          axisText: "#64748b",
          line: "#475569",
          tooltipBg: "#fff",
          tooltipBorder: "#e2e8f0",
          tooltipText: "#64748b",
        };

  const rangeKey = useMemo(
    () => `${startDate.toISOString()}::${endDate.toISOString()}::${filial ?? "all"}::${(linhas ?? []).join(",")}`,
    [startDate, endDate, filial, linhas],
  );

  useEffect(() => {
    setMounted(true);
  }, []);

  // Quando os dados já vêm prontos do dashboard (initialData), sincroniza o estado
  // a cada atualização (ex.: troca de filtros recarrega o dashboard com novos dados).
  useEffect(() => {
    if (initialData === undefined) return;
    setData(initialData);
    setLoading(false);
  }, [initialData]);

  useEffect(() => {
    if (initialData !== undefined) return;
    if (!mounted) return;

    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const revenue = await fetchDailyRevenue(companyKey, startDate, endDate, filial, linhas);
        if (active) {
          setData(revenue);
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
  }, [companyKey, rangeKey, startDate, endDate, filial, linhas, mounted, initialData]);

  const maxRevenue = useMemo(() => {
    if (data.length === 0) return 0;
    return Math.max(...data.map((item) => item.revenue));
  }, [data]);

  const chartData = useMemo(() => {
    return data.map((item) => ({
      date: formatDate(item.date),
      dateFull: item.date,
      revenue: item.revenue,
    }));
  }, [data]);

  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Carregando gráfico...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>{error}</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={styles.container}>
        <div className={styles.empty}>Nenhum dado disponível para o período selecionado.</div>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h3 className={styles.title}>FATURAMENTO DIÁRIO</h3>
      </div>
      <div className={styles.chartWrapper}>
        {mounted && (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
            <XAxis
              dataKey="date"
              stroke={c.axis}
              style={{ fontSize: "12px" }}
              tick={{ fill: c.axisText }}
            />
            <YAxis
              stroke={c.axis}
              style={{ fontSize: "12px" }}
              tick={{ fill: c.axisText }}
              tickFormatter={(value) => {
                if (value >= 1000) {
                  return `R$ ${(value / 1000).toFixed(0)}k`;
                }
                return `R$ ${value}`;
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: c.tooltipBg,
                border: `1px solid ${c.tooltipBorder}`,
                borderRadius: "8px",
                padding: "8px 12px",
              }}
              itemStyle={{ color: c.tooltipText }}
              formatter={(value: number) => formatCurrency(value)}
              labelStyle={{ color: c.tooltipText, fontSize: "12px", marginBottom: "4px" }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke={c.line}
              strokeWidth={2}
              dot={{ fill: c.line, r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}


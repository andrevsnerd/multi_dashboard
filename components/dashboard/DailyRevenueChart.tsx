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
}

async function fetchDailyRevenue(
  company: string,
  startDate: Date,
  endDate: Date,
  filial: string | null,
): Promise<DailyRevenueData[]> {
  const searchParams = new URLSearchParams({
    company,
    start: startDate.toISOString(),
    end: endDate.toISOString(),
  });

  if (filial) {
    searchParams.set("filial", filial);
  }

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
}: DailyRevenueChartProps) {
  const [data, setData] = useState<DailyRevenueData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeKey = useMemo(
    () => `${startDate.toISOString()}::${endDate.toISOString()}::${filial ?? "all"}`,
    [startDate, endDate, filial],
  );

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      setError(null);

      try {
        const revenue = await fetchDailyRevenue(companyKey, startDate, endDate, filial);
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
  }, [companyKey, rangeKey, startDate, endDate, filial]);

  const totalRevenue = useMemo(() => {
    return data.reduce((sum, item) => sum + item.revenue, 0);
  }, [data]);

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
        <span className={styles.total}>
          {formatCurrency(totalRevenue)} TOTAL
        </span>
      </div>
      <div className={styles.chartWrapper}>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis
              dataKey="date"
              stroke="#94a3b8"
              style={{ fontSize: "12px" }}
              tick={{ fill: "#64748b" }}
            />
            <YAxis
              stroke="#94a3b8"
              style={{ fontSize: "12px" }}
              tick={{ fill: "#64748b" }}
              tickFormatter={(value) => {
                if (value >= 1000) {
                  return `R$ ${(value / 1000).toFixed(0)}k`;
                }
                return `R$ ${value}`;
              }}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#fff",
                border: "1px solid #e2e8f0",
                borderRadius: "8px",
                padding: "8px 12px",
              }}
              formatter={(value: number) => formatCurrency(value)}
              labelStyle={{ color: "#64748b", fontSize: "12px", marginBottom: "4px" }}
            />
            <Line
              type="monotone"
              dataKey="revenue"
              stroke="#475569"
              strokeWidth={2}
              dot={{ fill: "#475569", r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}


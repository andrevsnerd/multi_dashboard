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

import { useTheme } from "@/components/theme/ThemeContext";
import type { CompanyKey } from "@/lib/config/company";

import styles from "./ProdutoGiroPerformanceChart.module.css";

type Mode = "week" | "month";

interface PerfPoint {
  label: string;
  startIso: string;
  endIso: string;
  vendas: number;
  qtde: number;
  /** Dias já decorridos no período (7 numa semana fechada; <7 na parcial). */
  dias: number;
  partial: boolean;
  /** Variação vs período anterior (%). Na parcial, compara os mesmos dias decorridos. */
  deltaPct: number | null;
  deltaBase: "cheio" | "parcial-equivalente" | null;
}

interface ProdutoGiroPerformanceChartProps {
  companyKey: CompanyKey;
  filial: string | null;
  /** Produtos que o gráfico deve somar (filtros/clique da tela). Vazio = rede inteira. */
  produtoIds?: string[];
  /** true quando `produtoIds` veio dos filtros de dropdown/busca (não de clique em linha). */
  escopoFiltrado?: boolean;
}

function fmtBRL(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtBRLk(n: number): string {
  if (Math.abs(n) >= 1000) return `R$ ${(n / 1000).toFixed(0)}k`;
  return `R$ ${n}`;
}

export default function ProdutoGiroPerformanceChart({
  companyKey,
  filial,
  produtoIds = [],
  escopoFiltrado = false,
}: ProdutoGiroPerformanceChartProps) {
  const { theme } = useTheme();
  const [mode, setMode] = useState<Mode>("week");
  // Chave estável da seleção (ordenada) para deps do fetch.
  const produtosKey = useMemo(() => [...produtoIds].sort().join(","), [produtoIds]);
  const [points, setPoints] = useState<PerfPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ company: companyKey, mode });
    if (filial) params.set("filial", filial);
    produtoIds.forEach((p) => params.append("produto", p));
    fetch(`/api/produto-giro/performance?${params.toString()}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((json: { points?: PerfPoint[]; error?: string }) => {
        if (cancelled) return;
        if (json.error) {
          setError(json.error);
          setPoints([]);
        } else {
          setPoints(json.points ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Não foi possível carregar a performance.");
          setPoints([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // produtosKey resume a seleção; produtoIds é lido dentro do efeito.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyKey, filial, mode, produtosKey]);

  // Variação = últimos DOIS períodos FECHADOS (exclui o período em andamento/parcial),
  // pra comparar maçã com maçã. O ponto parcial ainda aparece na linha (contexto).
  const growth = useMemo(() => {
    const fechados = points.filter((p) => !p.partial);
    if (fechados.length < 2) return null;
    const last = fechados[fechados.length - 1];
    const prev = fechados[fechados.length - 2];
    if (prev.vendas <= 0) return { pct: null as number | null, last, prev };
    return { pct: ((last.vendas - prev.vendas) / prev.vendas) * 100, last, prev };
  }, [points]);

  const c =
    theme === "dark"
      ? {
          grid: "rgba(148, 163, 184, 0.16)",
          axis: "#64748b",
          axisText: "#94a3b8",
          line: "#60a5fa",
          tooltipBg: "#1a2433",
          tooltipBorder: "#29344b",
          tooltipText: "#cbd5e1",
        }
      : {
          grid: "#e2e8f0",
          axis: "#94a3b8",
          axisText: "#64748b",
          line: "#2563eb",
          tooltipBg: "#fff",
          tooltipBorder: "#e2e8f0",
          tooltipText: "#334155",
        };

  const growthPct = growth?.pct ?? null;
  const up = growthPct != null && growthPct >= 0;

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Performance de vendas</h3>
          <p className={styles.subtitle}>
            {mode === "week" ? "Últimas 8 semanas" : "Últimos 6 meses"} · faturamento por{" "}
            {mode === "week" ? "semana" : "mês"}
            {filial ? " (filial selecionada)" : " (rede)"}
            {produtoIds.length > 0
              ? escopoFiltrado
                ? ` · filtrado (${produtoIds.length} produto${produtoIds.length === 1 ? "" : "s"})`
                : ` · ${produtoIds.length} produto${produtoIds.length === 1 ? "" : "s"} selecionado${produtoIds.length === 1 ? "" : "s"}`
              : ""}
          </p>
        </div>
        <div className={styles.headerRight}>
          {growth && (
            <div className={styles.growthBox} title={`${fmtBRL(growth.prev.vendas)} → ${fmtBRL(growth.last.vendas)}`}>
              {growthPct == null ? (
                <span className={styles.growthValueNeutral}>—</span>
              ) : (
                <span className={up ? styles.growthValueUp : styles.growthValueDown}>
                  {up ? "▲" : "▼"} {Math.abs(growthPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                </span>
              )}
              <span className={styles.growthLabel}>
                {mode === "week" ? "sem. fechada vs anterior" : "mês fechado vs anterior"}
              </span>
            </div>
          )}
          <div className={styles.toggle}>
            <button
              type="button"
              className={`${styles.toggleBtn} ${mode === "week" ? styles.toggleBtnActive : ""}`}
              onClick={() => setMode("week")}
            >
              Semana
            </button>
            <button
              type="button"
              className={`${styles.toggleBtn} ${mode === "month" ? styles.toggleBtnActive : ""}`}
              onClick={() => setMode("month")}
            >
              Mês
            </button>
          </div>
        </div>
      </div>

      <div className={styles.chartWrapper}>
        {loading ? (
          <div className={styles.stateMsg}>Carregando…</div>
        ) : error ? (
          <div className={styles.stateMsg}>{error}</div>
        ) : points.length === 0 ? (
          <div className={styles.stateMsg}>Sem dados de performance.</div>
        ) : (
          mounted && (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={points} margin={{ top: 8, right: 20, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={c.grid} />
                <XAxis dataKey="label" stroke={c.axis} style={{ fontSize: 12 }} tick={{ fill: c.axisText }} />
                <YAxis
                  stroke={c.axis}
                  style={{ fontSize: 12 }}
                  tick={{ fill: c.axisText }}
                  tickFormatter={fmtBRLk}
                  width={56}
                />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const p = payload[0]?.payload as PerfPoint;
                    if (!p) return null;
                    const periodo = mode === "week" ? "semana" : "mês";
                    const deltaUp = p.deltaPct != null && p.deltaPct >= 0;
                    return (
                      <div
                        style={{
                          background: c.tooltipBg,
                          border: `1px solid ${c.tooltipBorder}`,
                          borderRadius: 8,
                          padding: "8px 12px",
                          color: c.tooltipText,
                          fontSize: 12,
                          minWidth: 200,
                        }}
                      >
                        <div style={{ fontWeight: 700, marginBottom: 4 }}>
                          {mode === "week" ? "Semana de " : ""}
                          {p.label}
                        </div>
                        <div>
                          Vendido: <strong>{fmtBRL(p.vendas)}</strong>
                        </div>
                        <div style={{ opacity: 0.75 }}>Quantidade: {p.qtde.toLocaleString("pt-BR")} un</div>
                        <div style={{ marginTop: 5, paddingTop: 5, borderTop: `1px solid ${c.tooltipBorder}` }}>
                          {p.deltaPct == null ? (
                            <span style={{ opacity: 0.6 }}>sem {periodo} anterior p/ comparar</span>
                          ) : (
                            <>
                              <span style={{ color: deltaUp ? "#22c55e" : "#ef4444", fontWeight: 700 }}>
                                {deltaUp ? "▲" : "▼"}{" "}
                                {Math.abs(p.deltaPct).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                              </span>{" "}
                              <span style={{ opacity: 0.7 }}>vs {periodo} anterior</span>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="vendas"
                  stroke={c.line}
                  strokeWidth={2.5}
                  dot={{ fill: c.line, r: 4 }}
                  activeDot={{ r: 6 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )
        )}
      </div>
    </div>
  );
}

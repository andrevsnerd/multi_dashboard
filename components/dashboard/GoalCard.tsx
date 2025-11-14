"use client";

import { useMemo, useState, useEffect } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer } from "recharts";

import styles from "./GoalCard.module.css";

interface GoalCardProps {
  currentValue: number;
  goal: number;
  projection?: number;
  label?: string;
}

export default function GoalCard({
  currentValue,
  goal,
  projection,
  label = "Meta",
}: GoalCardProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const percentage = useMemo(() => {
    if (goal === 0) return 0;
    const percent = Math.min((currentValue / goal) * 100, 100);
    return Math.round(percent);
  }, [currentValue, goal]);

  const chartData = useMemo(() => {
    const remaining = Math.max(0, 100 - percentage);
    return [
      { name: "Concluído", value: percentage },
      { name: "Restante", value: remaining },
    ];
  }, [percentage]);

  const formatCurrency = (value: number) => {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      maximumFractionDigits: 0,
    });
  };

  return (
    <div className={styles.container}>
      <div className={styles.chartWrapper}>
        {mounted && (
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
            <Pie
              data={chartData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              startAngle={90}
              endAngle={-270}
              dataKey="value"
            >
              <Cell key="completed" fill="#475569" />
              <Cell key="remaining" fill="#e2e8f0" />
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        )}
        <div className={styles.centerText}>
          <div className={styles.percentage}>{percentage}%</div>
          <div className={styles.label}>{label}</div>
        </div>
      </div>
      <div className={styles.footer}>
        <div className={styles.footerItem}>
          <span className={styles.footerLabel}>Meta</span>
          <span className={styles.footerValue}>{formatCurrency(goal)}</span>
        </div>
        {projection !== undefined && (
          <div className={styles.footerItem}>
            <span className={styles.footerLabel}>Projeção</span>
            <span className={styles.footerValue}>{formatCurrency(projection)}</span>
          </div>
        )}
      </div>
    </div>
  );
}


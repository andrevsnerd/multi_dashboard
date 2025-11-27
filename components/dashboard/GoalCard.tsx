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

  // Calcular status da projeção em relação à meta
  const projectionStatus = useMemo(() => {
    if (!projection || goal === 0) return null;
    
    const projectionPercentage = (projection / goal) * 100;
    const isOnTrack = projection >= goal;
    const difference = projection - goal;
    // Calcular diferença percentual: (projeção - meta) / meta * 100
    const differencePercentage = goal > 0 ? ((projection - goal) / goal) * 100 : 0;
    
    return {
      isOnTrack,
      projectionPercentage,
      difference,
      differencePercentage,
    };
  }, [projection, goal]);

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
        <div className={`${styles.footerItem} ${styles.goalItem}`}>
          <span className={styles.footerLabel}>Meta</span>
          <span className={styles.footerValue}>{formatCurrency(goal)}</span>
        </div>
        {projection !== undefined && projectionStatus && (
          <div 
            className={`${styles.footerItem} ${styles.projectionItem} ${
              projectionStatus.isOnTrack ? styles.projectionOnTrack : styles.projectionOffTrack
            }`}
          >
            <span className={styles.footerLabel}>Projeção</span>
            <div className={styles.projectionValueWrapper}>
              <span className={styles.footerValue}>{formatCurrency(projection)}</span>
              {projectionStatus.isOnTrack ? (
                <span className={styles.projectionBadge}>
                  <svg 
                    width="12" 
                    height="12" 
                    viewBox="0 0 12 12" 
                    fill="none" 
                    xmlns="http://www.w3.org/2000/svg"
                    className={styles.projectionIcon}
                  >
                    <path 
                      d="M6 2L9 5.5H7V10H5V5.5H3L6 2Z" 
                      fill="currentColor"
                    />
                  </svg>
                  {(() => {
                    const diff = projectionStatus.differencePercentage;
                    if (diff >= 1) {
                      return Math.round(diff);
                    } else if (diff >= 0.1) {
                      return diff.toFixed(1);
                    } else if (diff > 0) {
                      return '<0.1';
                    }
                    return '0';
                  })()}%
                </span>
              ) : (
                <span className={styles.projectionBadge}>
                  {(() => {
                    const percent = projectionStatus.projectionPercentage;
                    if (percent >= 1) {
                      return Math.round(percent);
                    } else if (percent >= 0.1) {
                      return percent.toFixed(1);
                    } else if (percent > 0) {
                      return '<0.1';
                    }
                    return '0';
                  })()}%
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


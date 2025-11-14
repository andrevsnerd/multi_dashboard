"use client";

import { useState, useEffect, useMemo } from "react";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";

import styles from "./GoalsModal.module.css";

interface GoalsModalProps {
  companyKey: CompanyKey;
  isOpen: boolean;
  onClose: () => void;
  monthYear: { month: number; year: number };
}

interface GoalData {
  [filial: string]: number;
}

async function loadGoals(companyKey: string, month: number, year: number): Promise<GoalData> {
  try {
    const response = await fetch(
      `/api/goals?company=${companyKey}&month=${month}&year=${year}`,
      { cache: "no-store" }
    );
    if (!response.ok) {
      return {};
    }
    const json = (await response.json()) as { data: GoalData };
    return json.data || {};
  } catch {
    return {};
  }
}

async function saveGoals(companyKey: string, month: number, year: number, goals: GoalData): Promise<void> {
  try {
    await fetch("/api/goals", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        companyKey,
        month,
        year,
        goals,
      }),
    });
  } catch (error) {
    console.error("Erro ao salvar metas:", error);
  }
}

export default function GoalsModal({
  companyKey,
  isOpen,
  onClose,
  monthYear,
}: GoalsModalProps) {
  const company = resolveCompany(companyKey);
  const filiais = company?.filialFilters.sales ?? [];
  const displayNames = company?.filialDisplayNames ?? {};

  const [goals, setGoals] = useState<GoalData>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      loadGoals(companyKey, monthYear.month, monthYear.year)
        .then((loadedGoals) => {
          setGoals(loadedGoals);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, companyKey, monthYear.month, monthYear.year]);

  const handleGoalChange = async (filial: string, value: string) => {
    const numValue = value === "" ? 0 : parseFloat(value) || 0;
    const newGoals = { ...goals, [filial]: numValue };
    setGoals(newGoals);
    await saveGoals(companyKey, monthYear.month, monthYear.year, newGoals);
  };

  const monthName = useMemo(() => {
    const date = new Date(monthYear.year, monthYear.month, 1);
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [monthYear.month, monthYear.year]);

  const totalGoal = useMemo(() => {
    return Object.values(goals).reduce((sum, goal) => sum + goal, 0);
  }, [goals]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <div>
            <h2 className={styles.title}>Configuração de Metas</h2>
            <p className={styles.monthLabel}>{monthName}</p>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Carregando metas...</div>
          ) : (
            <div className={styles.filialList}>
              {filiais.map((filial) => {
                const displayName = displayNames[filial] ?? filial;
                return (
                  <div key={filial} className={styles.filialItem}>
                    <label className={styles.filialLabel}>{displayName}</label>
                    <div className={styles.inputWrapper}>
                      <span className={styles.currency}>R$</span>
                      <input
                        type="number"
                        className={styles.input}
                        value={goals[filial] || ""}
                        onChange={(e) => handleGoalChange(filial, e.target.value)}
                        placeholder="0,00"
                        min="0"
                        step="0.01"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className={styles.totalSection}>
            <span className={styles.totalLabel}>Meta Geral</span>
            <span className={styles.totalValue}>
              {totalGoal.toLocaleString("pt-BR", {
                style: "currency",
                currency: "BRL",
              })}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}


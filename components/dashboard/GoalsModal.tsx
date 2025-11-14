"use client";

import { useState, useEffect, useMemo } from "react";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";

import styles from "./GoalsModal.module.css";

interface GoalsModalProps {
  companyKey: CompanyKey;
  isOpen: boolean;
  onClose: () => void;
}

interface GoalData {
  [filial: string]: number;
}

function getStorageKey(companyKey: string): string {
  return `goals_${companyKey}`;
}

function loadGoals(companyKey: string): GoalData {
  if (typeof window === "undefined") return {};
  const stored = localStorage.getItem(getStorageKey(companyKey));
  return stored ? JSON.parse(stored) : {};
}

function saveGoals(companyKey: string, goals: GoalData): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(getStorageKey(companyKey), JSON.stringify(goals));
}

export default function GoalsModal({
  companyKey,
  isOpen,
  onClose,
}: GoalsModalProps) {
  const company = resolveCompany(companyKey);
  const filiais = company?.filialFilters.sales ?? [];
  const displayNames = company?.filialDisplayNames ?? {};

  const [goals, setGoals] = useState<GoalData>(() => loadGoals(companyKey));

  useEffect(() => {
    if (isOpen) {
      setGoals(loadGoals(companyKey));
    }
  }, [isOpen, companyKey]);

  const handleGoalChange = (filial: string, value: string) => {
    const numValue = value === "" ? 0 : parseFloat(value) || 0;
    const newGoals = { ...goals, [filial]: numValue };
    setGoals(newGoals);
    saveGoals(companyKey, newGoals);
  };

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
          <h2 className={styles.title}>Configuração de Metas</h2>
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


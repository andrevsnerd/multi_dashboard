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
  const allFiliais = company?.filialFilters.sales ?? [];
  const displayNames = company?.filialDisplayNames ?? {};
  const ecommerceFilials = company?.ecommerceFilials ?? [];
  const filialGroups = company?.filialGroups ?? {};

  // Normalizar nomes para comparação (trim e uppercase)
  const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim().toUpperCase());

  // Membros não-canônicos de grupos lógicos (ex.: as 3 Paulistas extras) — excluídos da lista
  const groupNonCanonicals = useMemo(() => {
    const set = new Set<string>();
    for (const members of Object.values(filialGroups)) {
      members.slice(1).forEach(m => set.add(m));
    }
    return set;
  }, [filialGroups]);

  // Filiais normais: sem ecommerce, sem membros não-canônicos de grupos, sem MATRIZ
  const normalFiliais = allFiliais.filter(f => {
    const normalizedFilial = f.trim().toUpperCase();
    if (normalizedEcommerceFilials.includes(normalizedFilial)) return false;
    if (groupNonCanonicals.has(f)) return false;
    if ((displayNames[f] ?? f) === 'MATRIZ') return false;
    return true;
  });
  
  const hasEcommerce = ecommerceFilials.length > 0;
  const ecommerceDisplayName = hasEcommerce 
    ? (ecommerceFilials.map(f => displayNames[f]).find(name => name) || 'E-COMMERCE')
    : null;

  // Criar lista de filiais para exibição (normais + e-commerce agrupado)
  const filiaisToDisplay = useMemo(() => {
    const result: Array<{ key: string; displayName: string; isEcommerce: boolean }> = [];
    
    // Adicionar filiais normais
    normalFiliais.forEach(filial => {
      result.push({
        key: filial,
        displayName: displayNames[filial] ?? filial,
        isEcommerce: false,
      });
    });
    
    // Adicionar e-commerce como uma única entrada (apenas se houver filiais de e-commerce)
    if (hasEcommerce && ecommerceDisplayName) {
      result.push({
        key: 'E-COMMERCE',
        displayName: ecommerceDisplayName,
        isEcommerce: true,
      });
    }
    
    return result;
  }, [normalFiliais, hasEcommerce, ecommerceDisplayName, displayNames]);

  const [goals, setGoals] = useState<GoalData>({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      loadGoals(companyKey, monthYear.month, monthYear.year)
        .then((loadedGoals) => {
          const processedGoals: GoalData = { ...loadedGoals };

          // Agregar e-commerce em uma única entrada
          if (hasEcommerce && ecommerceFilials.length > 0) {
            const normalizedEc = ecommerceFilials.map(f => f.trim().toUpperCase());
            const ecommerceTotal = Object.keys(loadedGoals).reduce((sum, key) => {
              return normalizedEc.includes(key.trim().toUpperCase()) ? sum + (loadedGoals[key] || 0) : sum;
            }, 0);
            Object.keys(processedGoals).forEach(key => {
              if (normalizedEc.includes(key.trim().toUpperCase())) delete processedGoals[key];
            });
            processedGoals['E-COMMERCE'] = ecommerceTotal;
          }

          // Agregar membros não-canônicos de grupos lógicos (ex.: Paulista) na entrada canônica
          for (const [canonical, members] of Object.entries(filialGroups)) {
            const nonCanonicals = members.slice(1);
            if (nonCanonicals.length === 0) continue;
            const total = members.reduce((sum, m) => sum + (processedGoals[m] || 0), 0);
            nonCanonicals.forEach(m => delete processedGoals[m]);
            if (total > 0) processedGoals[canonical] = total;
          }

          // Remover MATRIZ (sem meta)
          Object.keys(processedGoals).forEach(key => {
            if ((displayNames[key] ?? key) === 'MATRIZ') delete processedGoals[key];
          });

          setGoals(processedGoals);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, companyKey, monthYear.month, monthYear.year, hasEcommerce, ecommerceFilials, filialGroups, displayNames]);

  const handleGoalChange = async (filialKey: string, value: string) => {
    const numValue = value === "" ? 0 : parseFloat(value) || 0;
    const newGoals = { ...goals };
    
    // Se for E-COMMERCE, distribuir o valor para todas as filiais de e-commerce
    if (filialKey === 'E-COMMERCE' && hasEcommerce) {
      // Remover valores antigos das filiais de e-commerce
      ecommerceFilials.forEach(filial => {
        delete newGoals[filial];
      });
      
      // Distribuir o valor igualmente entre as filiais de e-commerce
      const valuePerFilial = ecommerceFilials.length > 0 ? numValue / ecommerceFilials.length : 0;
      ecommerceFilials.forEach(filial => {
        newGoals[filial] = valuePerFilial;
      });
      
      // Manter a entrada agregada para exibição
      newGoals['E-COMMERCE'] = numValue;
    } else {
      // Para filiais normais, apenas atualizar o valor
      newGoals[filialKey] = numValue;
    }
    
    setGoals(newGoals);
    
    // Preparar goals para salvar (sem a chave agregada E-COMMERCE)
    const goalsToSave: GoalData = { ...newGoals };
    delete goalsToSave['E-COMMERCE'];
    
    await saveGoals(companyKey, monthYear.month, monthYear.year, goalsToSave);
  };

  const monthName = useMemo(() => {
    const date = new Date(monthYear.year, monthYear.month, 1);
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [monthYear.month, monthYear.year]);

  const totalGoal = useMemo(() => {
    const normalizedEc = ecommerceFilials.map(f => f.trim().toUpperCase());
    return Object.entries(goals).reduce((sum, [key, value]) => {
      if (key === 'E-COMMERCE') return sum + value;
      if (normalizedEc.includes(key.trim().toUpperCase())) return sum;
      if ((displayNames[key] ?? key) === 'MATRIZ') return sum;
      return sum + value;
    }, 0);
  }, [goals, ecommerceFilials, displayNames]);

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
              {filiaisToDisplay.map((filial) => {
                return (
                  <div key={filial.key} className={styles.filialItem}>
                    <label className={styles.filialLabel}>{filial.displayName}</label>
                    <div className={styles.inputWrapper}>
                      <span className={styles.currency}>R$</span>
                      <input
                        type="number"
                        className={styles.input}
                        value={goals[filial.key] || ""}
                        onChange={(e) => handleGoalChange(filial.key, e.target.value)}
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


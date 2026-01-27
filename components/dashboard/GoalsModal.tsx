"use client";

import { useState, useEffect, useMemo } from "react";

import { resolveCompany, type CompanyKey, isEcommerceFilial } from "@/lib/config/company";

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

  // Normalizar nomes para comparação (trim e uppercase)
  const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim().toUpperCase());
  
  // Agrupar filiais: separar normais e e-commerce
  // Filtrar filiais que NÃO são e-commerce (comparação case-insensitive e com trim)
  const normalFiliais = allFiliais.filter(f => {
    const normalizedFilial = f.trim().toUpperCase();
    return !normalizedEcommerceFilials.includes(normalizedFilial);
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
          // Agregar valores de e-commerce se houver múltiplas filiais
          const processedGoals: GoalData = { ...loadedGoals };
          
          if (hasEcommerce && ecommerceFilials.length > 0) {
            // Calcular total de e-commerce (soma de todas as filiais de e-commerce)
            const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim().toUpperCase());
            const ecommerceTotal = Object.keys(loadedGoals).reduce((sum, filialKey) => {
              const normalizedKey = filialKey.trim().toUpperCase();
              if (normalizedEcommerceFilials.includes(normalizedKey)) {
                return sum + (loadedGoals[filialKey] || 0);
              }
              return sum;
            }, 0);
            
            // Remover entradas individuais de e-commerce do processedGoals
            Object.keys(processedGoals).forEach(key => {
              const normalizedKey = key.trim().toUpperCase();
              if (normalizedEcommerceFilials.includes(normalizedKey)) {
                delete processedGoals[key];
              }
            });
            
            // Adicionar entrada agregada para E-COMMERCE
            processedGoals['E-COMMERCE'] = ecommerceTotal;
          }
          
          setGoals(processedGoals);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [isOpen, companyKey, monthYear.month, monthYear.year, hasEcommerce, ecommerceFilials]);

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
    // Calcular total excluindo a entrada agregada E-COMMERCE (já que ela é a soma das filiais individuais)
    const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim().toUpperCase());
    return Object.entries(goals).reduce((sum, [key, value]) => {
      const normalizedKey = key.trim().toUpperCase();
      // Se for a entrada agregada E-COMMERCE, incluir (é a soma total)
      if (key === 'E-COMMERCE') {
        return sum + value;
      }
      // Se for uma filial de e-commerce individual, não incluir (já está na entrada agregada)
      if (normalizedEcommerceFilials.includes(normalizedKey)) {
        return sum;
      }
      // Para filiais normais, incluir
      return sum + value;
    }, 0);
  }, [goals, ecommerceFilials]);

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


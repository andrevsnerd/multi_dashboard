"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth/AuthContext";
import { canMutate } from "@/lib/auth/permissions";
import {
  getFilialGroupMembers,
  normalizeFilialLookupKey,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";

import styles from "./GoalsModal.module.css";

interface GoalsModalProps {
  companyKey: CompanyKey;
  isOpen: boolean;
  onClose: () => void;
  monthYear: { month: number; year: number };
  /** Chamado depois de gravar, com as metas do mês como ficaram salvas (chave = filial do banco). */
  onSaved?: (monthYear: { month: number; year: number }, goals: GoalData) => void;
}

interface GoalData {
  [filial: string]: number;
}

/**
 * Uma linha do modal = uma loja lógica. Grupos multi-CNPJ (PAULISTA, MORUMBI 1,
 * E-COMMERCE) viram uma linha só: a meta exibida é a SOMA dos membros — mesma régua
 * do card de meta, que soma todos os membros do grupo.
 */
interface GoalRow {
  key: string;
  label: string;
  members: string[];
  isEcommerce: boolean;
}

type PendingAction = { type: "close" } | { type: "month"; month: number; year: number };

const ECOMMERCE_ROW_KEY = "E-COMMERCE";

function buildRows(companyKey: CompanyKey): GoalRow[] {
  const company = resolveCompany(companyKey);
  if (!company) return [];
  const displayNames = company.filialDisplayNames ?? {};
  const ecommerce = company.ecommerceFilials ?? [];
  const ecommerceSet = new Set(ecommerce.map(normalizeFilialLookupKey));
  const seen = new Set<string>();
  const rows: GoalRow[] = [];

  for (const filial of company.filialFilters.sales) {
    if (ecommerceSet.has(normalizeFilialLookupKey(filial))) continue;
    if ((displayNames[filial] ?? filial) === "MATRIZ") continue;
    const members = getFilialGroupMembers(company, filial);
    // Grupo: a linha fica na canônica (1º membro = filial ativa); os demais somem.
    const canonical = members[0] ?? filial;
    const groupKey = normalizeFilialLookupKey(canonical);
    if (seen.has(groupKey)) continue;
    seen.add(groupKey);
    rows.push({
      key: canonical,
      label: displayNames[canonical] ?? displayNames[filial] ?? filial,
      members,
      isEcommerce: false,
    });
  }

  if (ecommerce.length > 0) {
    rows.push({
      key: ECOMMERCE_ROW_KEY,
      label: ecommerce.map((f) => displayNames[f]).find(Boolean) ?? "E-COMMERCE",
      members: ecommerce,
      isEcommerce: true,
    });
  }

  return rows;
}

/** Valor de cada linha = soma das metas gravadas para os membros dela. */
function rowValuesFromGoals(rows: GoalRow[], goals: GoalData): Record<string, number> {
  const byKey = new Map<string, number>();
  for (const [filial, value] of Object.entries(goals)) {
    const k = normalizeFilialLookupKey(filial);
    byKey.set(k, (byKey.get(k) ?? 0) + (Number(value) || 0));
  }
  const result: Record<string, number> = {};
  for (const row of rows) {
    result[row.key] = row.members.reduce(
      (sum, m) => sum + (byKey.get(normalizeFilialLookupKey(m)) ?? 0),
      0,
    );
  }
  return result;
}

/** Aceita "180000", "180.000", "180.000,50", "R$ 1.500" e "1500.5". */
function parseMoney(raw: string): number {
  const s = raw.replace(/[R$\s]/g, "");
  if (!s) return 0;
  let normalized: string;
  if (s.includes(",")) {
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    normalized = s.replace(/\./g, "");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

function formatInput(value: number): string {
  if (!value) return "";
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

async function loadGoals(companyKey: string, month: number, year: number): Promise<GoalData> {
  const response = await fetch(
    `/api/goals?company=${companyKey}&month=${month}&year=${year}`,
    { cache: "no-store" },
  );
  if (!response.ok) throw new Error("Não foi possível carregar as metas.");
  const json = (await response.json()) as { data?: GoalData };
  return json.data ?? {};
}

export default function GoalsModal({
  companyKey,
  isOpen,
  onClose,
  monthYear,
  onSaved,
}: GoalsModalProps) {
  const { user } = useAuth();
  const canEdit = canMutate(user);

  // Derivado só de companyKey: referência estável. (Antes, `ecommerceFilials ?? []`
  // criava um array novo a cada render na NERD — sem e-commerce — e o efeito de
  // carga entrava em loop, apagando o que era digitado.)
  const rows = useMemo(() => buildRows(companyKey), [companyKey]);

  const [period, setPeriod] = useState(monthYear);
  const [rawGoals, setRawGoals] = useState<GoalData>({});
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const firstInputRef = useRef<HTMLInputElement | null>(null);

  // Ao abrir, começa no mês do dashboard.
  useEffect(() => {
    if (isOpen) setPeriod({ month: monthYear.month, year: monthYear.year });
  }, [isOpen, monthYear.month, monthYear.year]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoading(true);
    setError(null);
    setFlash(null);
    loadGoals(companyKey, period.month, period.year)
      .then((goals) => {
        if (!active) return;
        const values = rowValuesFromGoals(rows, goals);
        setRawGoals(goals);
        setSaved(values);
        setDraft(Object.fromEntries(rows.map((r) => [r.key, formatInput(values[r.key] ?? 0)])));
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof Error ? err.message : "Erro ao carregar metas.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen, companyKey, period.month, period.year, rows]);

  const values = useMemo(
    () => Object.fromEntries(rows.map((r) => [r.key, parseMoney(draft[r.key] ?? "")])),
    [rows, draft],
  );

  const changedKeys = useMemo(
    () => rows.filter((r) => Math.abs((values[r.key] ?? 0) - (saved[r.key] ?? 0)) >= 0.01).map((r) => r.key),
    [rows, values, saved],
  );
  const isDirty = !loading && changedKeys.length > 0;

  const totalGeral = rows.reduce((sum, r) => sum + (values[r.key] ?? 0), 0);
  const hasEcommerce = rows.some((r) => r.isEcommerce);
  const totalVarejo = rows.reduce((sum, r) => (r.isEcommerce ? sum : sum + (values[r.key] ?? 0)), 0);

  // Fechar a aba / recarregar com alteração pendente → aviso nativo do navegador.
  useEffect(() => {
    if (!isOpen || !isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isOpen, isDirty]);

  const save = useCallback(async (): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      // Parte do que está gravado e troca só os membros das linhas da tela: chave
      // que o modal não conhece (loja antiga/desativada) fica como estava.
      const managed = new Set(rows.flatMap((r) => r.members.map(normalizeFilialLookupKey)));
      const payload: GoalData = {};
      for (const [filial, value] of Object.entries(rawGoals)) {
        if (!managed.has(normalizeFilialLookupKey(filial))) payload[filial] = value;
      }
      for (const row of rows) {
        const value = values[row.key] ?? 0;
        if (value <= 0) continue;
        if (row.isEcommerce) {
          // E-commerce: dividido igualmente entre os CNPJs do rodízio (a soma volta ao
          // total). Centavos que sobram ficam no primeiro, para a soma bater exata.
          const n = row.members.length;
          const each = Math.floor((value / n) * 100) / 100;
          row.members.forEach((m, i) => {
            payload[m] = i === 0 ? Math.round((value - each * (n - 1)) * 100) / 100 : each;
          });
        } else {
          // Grupo de loja: meta inteira na canônica; os outros membros ficam sem chave.
          payload[row.key] = value;
        }
      }

      const response = await fetch("/api/goals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(user?.username ? { "x-auth-username": user.username } : {}),
        },
        body: JSON.stringify({
          companyKey,
          month: period.month,
          year: period.year,
          goals: payload,
        }),
      });
      if (!response.ok) {
        const json = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "Não foi possível salvar as metas.");
      }

      setRawGoals(payload);
      setSaved({ ...values });
      setDraft(Object.fromEntries(rows.map((r) => [r.key, formatInput(values[r.key] ?? 0)])));
      setFlash("Metas salvas");
      onSaved?.(period, payload);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível salvar as metas.");
      return false;
    } finally {
      setSaving(false);
    }
  }, [rows, rawGoals, values, user?.username, companyKey, period, onSaved]);

  const runAction = useCallback(
    (action: PendingAction) => {
      if (action.type === "close") onClose();
      else setPeriod({ month: action.month, year: action.year });
    },
    [onClose],
  );

  const request = useCallback(
    (action: PendingAction) => {
      if (isDirty) setPending(action);
      else runAction(action);
    },
    [isDirty, runAction],
  );

  const shiftMonth = (delta: number) => {
    const d = new Date(period.year, period.month + delta, 1);
    request({ type: "month", month: d.getMonth(), year: d.getFullYear() });
  };

  const copyPreviousMonth = async () => {
    const d = new Date(period.year, period.month - 1, 1);
    setCopying(true);
    setError(null);
    try {
      const goals = await loadGoals(companyKey, d.getMonth(), d.getFullYear());
      const prev = rowValuesFromGoals(rows, goals);
      if (!Object.values(prev).some((v) => v > 0)) {
        setError("O mês anterior não tem metas para copiar.");
        return;
      }
      setDraft(Object.fromEntries(rows.map((r) => [r.key, formatInput(prev[r.key] ?? 0)])));
      setFlash(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro ao copiar metas.");
    } finally {
      setCopying(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (pending) setPending(null);
      else request({ type: "close" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, pending, request]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 2500);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (isOpen && !loading) firstInputRef.current?.focus();
  }, [isOpen, loading]);

  useEffect(() => {
    if (!isOpen) setPending(null);
  }, [isOpen]);

  const monthName = useMemo(() => {
    const date = new Date(period.year, period.month, 1);
    return date.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
  }, [period.month, period.year]);

  if (!isOpen) {
    return null;
  }

  const busy = loading || saving;

  return (
    <div className={styles.overlay} onClick={() => request({ type: "close" })}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        aria-label="Metas do mês"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h2 className={styles.title}>Metas</h2>
          <div className={styles.monthNav}>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => shiftMonth(-1)}
              disabled={busy}
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <span className={styles.monthLabel}>{monthName}</span>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => shiftMonth(1)}
              disabled={busy}
              aria-label="Próximo mês"
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className={styles.closeButton}
            onClick={() => request({ type: "close" })}
            aria-label="Fechar"
          >
            ×
          </button>
        </div>

        <div className={styles.content}>
          {loading ? (
            <div className={styles.loading}>Carregando metas…</div>
          ) : (
            <div className={styles.filialList}>
              {rows.map((row, index) => {
                const changed = changedKeys.includes(row.key);
                return (
                  <label
                    key={row.key}
                    className={`${styles.filialItem} ${changed ? styles.filialItemChanged : ""}`}
                  >
                    <span className={styles.filialLabel}>
                      {row.label}
                      {changed ? <span className={styles.changedDot} aria-label="alterada" /> : null}
                    </span>
                    <span className={styles.inputWrapper}>
                      <span className={styles.currency}>R$</span>
                      <input
                        ref={index === 0 ? firstInputRef : undefined}
                        type="text"
                        inputMode="decimal"
                        className={styles.input}
                        value={draft[row.key] ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, [row.key]: e.target.value }))}
                        onBlur={(e) =>
                          setDraft((d) => ({ ...d, [row.key]: formatInput(parseMoney(e.target.value)) }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && isDirty && canEdit && !saving) void save();
                        }}
                        placeholder="0"
                        disabled={!canEdit || saving}
                      />
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <div className={styles.footer}>
          <div className={styles.totals}>
            <div className={styles.totalItem}>
              <span className={styles.totalLabel}>Meta geral</span>
              <span className={styles.totalValue}>{formatCurrency(totalGeral)}</span>
            </div>
            {hasEcommerce ? (
              <div className={styles.totalItem}>
                <span className={styles.totalLabel}>Só varejo</span>
                <span className={styles.totalValueMuted}>{formatCurrency(totalVarejo)}</span>
              </div>
            ) : null}
          </div>

          {error ? <div className={styles.error}>{error}</div> : null}

          <div className={styles.actions}>
            {canEdit ? (
              <button
                type="button"
                className={styles.linkButton}
                onClick={() => void copyPreviousMonth()}
                disabled={busy || copying}
                title="Preenche com as metas do mês anterior (só grava ao clicar em Salvar)"
              >
                {copying ? "Copiando…" : "Copiar mês anterior"}
              </button>
            ) : (
              <span className={styles.readOnlyNote}>Somente leitura</span>
            )}
            <div className={styles.actionsRight}>
              {flash && !isDirty ? <span className={styles.flash}>✓ {flash}</span> : null}
              {isDirty ? (
                <span className={styles.dirtyNote}>
                  {changedKeys.length} {changedKeys.length === 1 ? "alteração" : "alterações"}
                </span>
              ) : null}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => request({ type: "close" })}
                disabled={saving}
              >
                Fechar
              </button>
              {canEdit ? (
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={() => void save()}
                  disabled={!isDirty || busy}
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {pending ? (
          <div className={styles.confirmOverlay} onClick={() => setPending(null)}>
            <div
              className={styles.confirmBox}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="goals-confirm-title"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 id="goals-confirm-title" className={styles.confirmTitle}>
                Metas não salvas
              </h3>
              <p className={styles.confirmText}>
                Você alterou {changedKeys.length}{" "}
                {changedKeys.length === 1 ? "meta" : "metas"} de {monthName} e ainda não salvou.
              </p>
              {error ? <div className={styles.error}>{error}</div> : null}
              <div className={styles.confirmActions}>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => {
                    const action = pending;
                    setPending(null);
                    runAction(action);
                  }}
                  disabled={saving}
                >
                  Descartar
                </button>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={() => setPending(null)}
                  disabled={saving}
                  autoFocus
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={styles.primaryButton}
                  onClick={async () => {
                    const action = pending;
                    if (await save()) {
                      setPending(null);
                      runAction(action);
                    }
                  }}
                  disabled={saving}
                >
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

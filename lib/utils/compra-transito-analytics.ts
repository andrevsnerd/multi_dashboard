import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";

export type TransitAwareSuggestionType =
  | "COMPRA"
  | "S"
  | "E"
  | "SUFICIENTE"
  | "SEM_SUGESTAO";

export interface TransitAdjustmentResult {
  totalTransit: number;
  relevantTransit: number;
  adjustedQty: number;
  suppressedByTransit: boolean;
  entries: CompraTransitoIndexEntry[];
  nextReceiptDate: string | null;
  lastReceiptDate: string | null;
  deficitWithoutTransit: number;
  deficitWithTransit: number;
}

export interface TransitAwareSuggestionView extends TransitAdjustmentResult {
  type: TransitAwareSuggestionType;
  qty: number;
  originalType: TransitAwareSuggestionType;
  originalQty: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function normalizeDate(value?: string | null): string {
  return (value ?? "").trim().slice(0, 10);
}

function daysUntil(receiptDate: string, today = new Date()): number {
  const value = normalizeDate(receiptDate);
  if (!value) return Number.POSITIVE_INFINITY;
  const target = new Date(`${value}T00:00:00`);
  if (Number.isNaN(target.getTime())) return Number.POSITIVE_INFINITY;
  const diff = target.getTime() - startOfLocalDay(today).getTime();
  return Math.max(0, Math.ceil(diff / MS_PER_DAY));
}

function groupEntriesByDay(
  entries: CompraTransitoIndexEntry[],
  limiteDias: number,
  today = new Date()
): Array<{ day: number; qty: number }> {
  const grouped = new Map<number, number>();
  entries.forEach((entry) => {
    const qty = Math.max(0, Math.round(Number(entry.quantidade ?? 0)));
    if (qty <= 0) return;
    const day = daysUntil(entry.dataRecebimento, today);
    if (!Number.isFinite(day) || day > limiteDias) return;
    grouped.set(day, (grouped.get(day) ?? 0) + qty);
  });
  return [...grouped.entries()]
    .map(([day, qty]) => ({ day, qty }))
    .sort((a, b) => a.day - b.day);
}

function computeCoverageDeficit(input: {
  estoqueAtual: number;
  consumoDiario: number;
  limiteDias: number;
  entries: CompraTransitoIndexEntry[];
}): number {
  const estoqueAtual = Number(input.estoqueAtual ?? 0);
  const consumoDiario = Number(input.consumoDiario ?? 0);
  const limiteDias = Math.max(0, Math.round(Number(input.limiteDias ?? 0)));
  if (limiteDias <= 0 || consumoDiario <= 0) return 0;

  const grouped = groupEntriesByDay(input.entries, limiteDias);
  let required = Math.max(0, -estoqueAtual);
  let arrivalsBefore = 0;

  for (const event of grouped) {
    const deficitBeforeArrival = consumoDiario * event.day - estoqueAtual - arrivalsBefore;
    required = Math.max(required, deficitBeforeArrival);
    arrivalsBefore += event.qty;
  }

  const deficitAtHorizon = consumoDiario * limiteDias - estoqueAtual - arrivalsBefore;
  required = Math.max(required, deficitAtHorizon);
  return Math.max(0, Math.ceil(required));
}

export function summarizeTransitAdjustment(input: {
  baseType: TransitAwareSuggestionType;
  baseQty: number;
  entries: CompraTransitoIndexEntry[];
  estoqueAtual?: number | null;
  vendasMesAtual?: number | null;
  diasCorridosMes: number;
  limiteDias: number;
}): TransitAdjustmentResult {
  const entries = [...(input.entries ?? [])].filter(
    (entry) => Math.max(0, Math.round(Number(entry.quantidade ?? 0))) > 0
  );
  const totalTransit = entries.reduce(
    (sum, entry) => sum + Math.max(0, Math.round(Number(entry.quantidade ?? 0))),
    0
  );
  const nextReceiptDate = entries[0]?.dataRecebimento ?? null;
  const lastReceiptDate = entries[entries.length - 1]?.dataRecebimento ?? null;
  const limiteDias = Math.max(0, Math.round(Number(input.limiteDias ?? 0)));
  const diasCorridosMes = Math.max(0, Math.round(Number(input.diasCorridosMes ?? 0)));
  const vendasMesAtual = Number(input.vendasMesAtual ?? 0);
  const consumoDiario =
    diasCorridosMes > 0 && vendasMesAtual > 0 ? vendasMesAtual / diasCorridosMes : 0;

  const relevantTransit = entries.reduce((sum, entry) => {
    const qty = Math.max(0, Math.round(Number(entry.quantidade ?? 0)));
    return daysUntil(entry.dataRecebimento) <= limiteDias ? sum + qty : sum;
  }, 0);

  const deficitWithoutTransit =
    input.baseType === "COMPRA"
      ? computeCoverageDeficit({
          estoqueAtual: Number(input.estoqueAtual ?? 0),
          consumoDiario,
          limiteDias,
          entries: [],
        })
      : Math.max(0, Math.round(Number(input.baseQty ?? 0)));

  const deficitWithTransit =
    input.baseType === "COMPRA"
      ? computeCoverageDeficit({
          estoqueAtual: Number(input.estoqueAtual ?? 0),
          consumoDiario,
          limiteDias,
          entries,
        })
      : Math.max(0, Math.round(Number(input.baseQty ?? 0))) - Math.max(0, relevantTransit);

  const adjustedQty = Math.max(
    0,
    input.baseType === "COMPRA"
      ? deficitWithTransit
      : Math.ceil(Math.max(0, deficitWithTransit))
  );

  return {
    totalTransit,
    relevantTransit,
    adjustedQty,
    suppressedByTransit:
      Math.max(0, Math.round(Number(input.baseQty ?? 0))) > 0 &&
      adjustedQty === 0 &&
      totalTransit > 0,
    entries,
    nextReceiptDate,
    lastReceiptDate,
    deficitWithoutTransit: Math.max(0, Math.ceil(deficitWithoutTransit)),
    deficitWithTransit: Math.max(0, Math.ceil(deficitWithTransit)),
  };
}

export function applyTransitToSuggestion(input: {
  baseType: TransitAwareSuggestionType;
  baseQty: number;
  entries: CompraTransitoIndexEntry[];
  estoqueAtual?: number | null;
  vendasMesAtual?: number | null;
  diasCorridosMes: number;
  limiteDias: number;
}): TransitAwareSuggestionView {
  const summary = summarizeTransitAdjustment(input);
  const baseQty = Math.max(0, Math.round(Number(input.baseQty ?? 0)));
  const type =
    baseQty > 0
      ? summary.adjustedQty > 0
        ? input.baseType
        : summary.totalTransit > 0
          ? "SUFICIENTE"
          : input.baseType
      : input.baseType;

  return {
    ...summary,
    type,
    qty: summary.adjustedQty,
    originalType: input.baseType,
    originalQty: baseQty,
  };
}

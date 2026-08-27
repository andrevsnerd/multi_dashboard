import type { ReportCellValue } from "./types";
import {
  DIAS_ACABAR_EXCEDE,
  DIAS_ACABAR_SEM_GIRO,
  PROJECAO_HORIZONTE_MESES,
} from "./projecao-vendas";

/** Sentinela de "nunca vendeu" para a coluna Dias parado (espelha o repositório). */
export const DIAS_PARADO_NUNCA = 9999;
/** Sentinela textual de "nunca vendeu" para Última venda (≠ vazio, que é "sem dado"). */
export const ULTIMA_VENDA_NUNCA = "NUNCA";

/** Dias parado: "" (sem dado) | número de dias | "Nunca vendeu" (>= sentinela). */
export function formatDiasParado(value: ReportCellValue): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n >= DIAS_PARADO_NUNCA) return "Nunca vendeu";
  return String(Math.round(n));
}

/** Última venda: "" (sem dado) | "Nunca vendeu" (sentinela) | data ISO → dd/mm/yyyy. */
export function formatDataVenda(value: ReportCellValue): string {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  if (s === ULTIMA_VENDA_NUNCA) return "Nunca vendeu";
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

/**
 * Dias p/ acabar (Projeção de vendas): "" (sem dado) | nº de dias | "Mais de N meses"
 * (o estoque não zera dentro do horizonte) | "Sem giro" (ritmo estimado zero).
 * As sentinelas vivem em [lib/reports/projecao-vendas.ts] e são números altos de propósito,
 * para que a ordenação ascendente mostre primeiro quem acaba mais rápido.
 */
export function formatDiasAcabar(value: ReportCellValue): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n >= DIAS_ACABAR_SEM_GIRO) return "Sem giro";
  if (n >= DIAS_ACABAR_EXCEDE) return `Mais de ${PROJECAO_HORIZONTE_MESES} meses`;
  return String(Math.round(n));
}

/** Data genérica: ISO (yyyy-mm-dd) → dd/mm/yyyy; vazio fica em branco. */
export function formatData(value: ReportCellValue): string {
  if (value === null || value === undefined || value === "") return "";
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

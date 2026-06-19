import type { ReportCellValue } from "./types";

/** Sentinela de "nunca vendeu" para a coluna Dias parado (espelha o repositório). */
export const DIAS_PARADO_NUNCA = 9999;

/** Dias parado: número de dias, ou "Nunca vendeu" quando >= sentinela. */
export function formatDiasParado(value: ReportCellValue): string {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n >= DIAS_PARADO_NUNCA) return "Nunca vendeu";
  return String(Math.round(n));
}

/** Última venda: data ISO (yyyy-mm-dd) → dd/mm/yyyy; vazio/nulo → "Nunca vendeu". */
export function formatDataVenda(value: ReportCellValue): string {
  if (value === null || value === undefined || value === "") return "Nunca vendeu";
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

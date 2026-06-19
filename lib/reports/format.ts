import type { ReportCellValue } from "./types";

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

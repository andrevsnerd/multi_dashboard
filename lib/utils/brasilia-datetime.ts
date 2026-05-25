const BRASILIA_TIME_ZONE = "America/Sao_Paulo";
const SQL_DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

/**
 * Datas do SQL Server (style 120) chegam sem fuso, no horário de Brasília.
 * Parse como -03:00 para não depender do TZ do servidor ou do navegador.
 */
export function parseBrasiliaDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = value.trim();
  if (!normalized) return null;

  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const sqlMatch = normalized.match(SQL_DATETIME_RE);
  if (sqlMatch) {
    const iso = `${sqlMatch[1]}-${sqlMatch[2]}-${sqlMatch[3]}T${sqlMatch[4]}:${sqlMatch[5]}:${sqlMatch[6]}-03:00`;
    const parsed = new Date(iso);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const isoLike = normalized.includes("T") ? normalized : normalized.replace(" ", "T");
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatBrasiliaDateTime(
  value: string | Date | null | undefined,
  options?: Intl.DateTimeFormatOptions
): string {
  if (value == null) return "-";

  const date =
    value instanceof Date
      ? value
      : parseBrasiliaDateTime(value) ?? new Date(value);

  if (Number.isNaN(date.getTime())) {
    return typeof value === "string" ? value : "-";
  }

  return date.toLocaleString("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    ...options,
  });
}

const BRASILIA_TIME_ZONE = "America/Sao_Paulo";

export function parseRomaneioDateTime(value: string): Date {
  const normalized = (value || "").trim();
  if (!normalized) return new Date(Number.NaN);

  if (/[zZ]|[+-]\d{2}:\d{2}$/.test(normalized)) {
    return new Date(normalized);
  }

  if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(normalized)) {
    const isoLike = normalized.replace(/\s+/, "T");
    const parsed = new Date(isoLike);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?$/.test(normalized)) {
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  return new Date(normalized);
}

export function formatRomaneioDateTimeBrasilia(
  value: string,
  options?: Intl.DateTimeFormatOptions
): string {
  const parsed = parseRomaneioDateTime(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleString("pt-BR", {
    timeZone: BRASILIA_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  });
}

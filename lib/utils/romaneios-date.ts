const BRASILIA_TIME_ZONE = "America/Sao_Paulo";

export function parseRomaneioDateTime(value: string): Date {
  const normalized = (value || "").trim();
  if (!normalized) return new Date(Number.NaN);

  // Já tem fuso explícito (Z ou ±HH:MM) → instante absoluto, parse direto.
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(normalized)) {
    return new Date(normalized);
  }

  // Datas do SQL Server chegam SEM fuso, no horário de Brasília. `new Date`
  // sobre uma string sem fuso usa o TZ local da máquina (navegador), então em
  // computadores fora do Brasil o horário sai deslocado. Ancoramos em -03:00
  // para o resultado ser idêntico em qualquer máquina/local.
  const naiveMatch = normalized.match(
    /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/
  );
  if (naiveMatch) {
    const parsed = new Date(`${naiveMatch[1]}T${naiveMatch[2]}-03:00`);
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

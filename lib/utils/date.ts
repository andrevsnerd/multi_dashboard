import { format } from 'date-fns';

export interface NormalizedRange {
  start: Date;
  end: Date;
}

export function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
}

export function endOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1));
}

export function getCurrentMonthRange(): NormalizedRange {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  return {
    start,
    end,
  };
}

export function formatDateForQuery(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

function parseDateInput(value: Date | string): Date {
  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  const dateOnlyMatch = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const [, year, month, day] = dateOnlyMatch;
    const parsed = new Date(0);
    parsed.setFullYear(Number(year), Number(month) - 1, Number(day));
    parsed.setHours(0, 0, 0, 0);
    return parsed;
  }

  return new Date(value);
}

export function normalizeRange(
  start?: Date | string,
  end?: Date | string
): NormalizedRange {
  if (!start || !end) {
    return getCurrentMonthRange();
  }

  const startDate = parseDateInput(start);
  const endDate = parseDateInput(end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return getCurrentMonthRange();
  }

  if (startDate > endDate) {
    return { start: endDate, end: startDate };
  }

  return { start: startDate, end: endDate };
}

export function toUtcStartOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

export function toUtcExclusiveEnd(date: Date): Date {
  const utcStart = toUtcStartOfDay(date);
  return new Date(utcStart.getTime() + 24 * 60 * 60 * 1000);
}

export function normalizeRangeForQuery(range?: {
  start?: Date | string;
  end?: Date | string;
}): NormalizedRange {
  const normalized = normalizeRange(range?.start, range?.end);
  return {
    start: toUtcStartOfDay(normalized.start),
    end: toUtcExclusiveEnd(normalized.end),
  };
}

function addMonthsUtc(date: Date, months: number): Date {
  if (months === 0) {
    return new Date(date.getTime());
  }

  const utcYear = date.getUTCFullYear();
  const utcMonth = date.getUTCMonth();
  const utcDate = date.getUTCDate();
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const utcSeconds = date.getUTCSeconds();
  const utcMilliseconds = date.getUTCMilliseconds();

  const totalMonths = utcYear * 12 + utcMonth + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = ((totalMonths % 12) + 12) % 12;
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0)
  ).getUTCDate();
  const targetDay = Math.min(utcDate, lastDayOfTargetMonth);

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      targetDay,
      utcHours,
      utcMinutes,
      utcSeconds,
      utcMilliseconds
    )
  );
}

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function lastDayOfMonthUtc(date: Date): number {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
  ).getUTCDate();
}

export function shiftRangeByMonths(
  range: NormalizedRange,
  months: number
): NormalizedRange {
  if (months === 0) {
    return {
      start: new Date(range.start.getTime()),
      end: new Date(range.end.getTime()),
    };
  }

  // Regra de comparação por calendário (não por duração em ms):
  // - O endDate é exclusivo (início do dia seguinte ao último dia do período).
  // - Mantemos os mesmos dias do mês (ex.: 1-20 -> 1-20 do mês anterior, com
  //   clamp para o último dia quando o mês de destino é mais curto).
  // - Quando o período atual termina no ÚLTIMO dia do seu mês (mês fechado), o
  //   período anterior abrange o MÊS INTEIRO anterior, independentemente de ter
  //   mais ou menos dias (ex.: maio 1-31 -> abril 1-30; abril 1-30 -> março 1-31).
  const startDate = range.start;
  const inclusiveEnd = new Date(range.end.getTime() - DAY_IN_MS);

  // O período atual cobre o mês inteiro até o fim?
  const coversFullEndOfMonth =
    inclusiveEnd.getUTCDate() === lastDayOfMonthUtc(inclusiveEnd);

  // Deslocar cada extremo por calendário (addMonthsUtc já faz o clamp do dia).
  const previousStart = addMonthsUtc(startDate, months);
  let previousInclusiveEnd = addMonthsUtc(inclusiveEnd, months);

  if (coversFullEndOfMonth) {
    // Forçar o último dia do mês de destino (mês inteiro anterior).
    const lastDay = lastDayOfMonthUtc(previousInclusiveEnd);
    previousInclusiveEnd = new Date(
      Date.UTC(
        previousInclusiveEnd.getUTCFullYear(),
        previousInclusiveEnd.getUTCMonth(),
        lastDay,
        previousInclusiveEnd.getUTCHours(),
        previousInclusiveEnd.getUTCMinutes(),
        previousInclusiveEnd.getUTCSeconds(),
        previousInclusiveEnd.getUTCMilliseconds()
      )
    );
  }

  // Voltar para o fim exclusivo (início do dia seguinte).
  const previousEnd = new Date(previousInclusiveEnd.getTime() + DAY_IN_MS);

  return {
    start: previousStart,
    end: previousEnd,
  };
}

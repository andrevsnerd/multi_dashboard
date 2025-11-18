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

export function normalizeRange(
  start?: Date | string,
  end?: Date | string
): NormalizedRange {
  if (!start || !end) {
    return getCurrentMonthRange();
  }

  const startDate = start instanceof Date ? start : new Date(start);
  const endDate = end instanceof Date ? end : new Date(end);

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

  // Calcular o período anterior mantendo a mesma duração
  // O endDate é exclusivo (início do próximo dia), então precisamos calcular corretamente
  const startDate = range.start;
  const endDate = range.end;
  
  // Calcular a duração em milissegundos (endDate é exclusivo, então já está correto)
  const duration = endDate.getTime() - startDate.getTime();
  
  // Calcular a data de início do período anterior
  const previousStart = addMonthsUtc(startDate, months);
  
  // Calcular a data de fim do período anterior mantendo a mesma duração
  const previousEnd = new Date(previousStart.getTime() + duration);
  
  // Verificar se o período anterior ultrapassa o mês anterior
  const previousMonth = previousStart.getUTCMonth();
  const previousYear = previousStart.getUTCFullYear();
  const nextMonthStart = new Date(Date.UTC(previousYear, previousMonth + 1, 1));
  
  // Se o período anterior ultrapassar o mês, ajustar para terminar no último dia do mês
  if (previousEnd.getTime() > nextMonthStart.getTime()) {
    // Ajustar para o último dia do mês anterior (início do próximo mês, que é exclusivo)
    return {
      start: previousStart,
      end: nextMonthStart,
    };
  }

  return {
    start: previousStart,
    end: previousEnd,
  };
}


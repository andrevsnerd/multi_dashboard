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
  return {
    start: startOfCurrentMonth(),
    end: endOfCurrentMonth(),
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


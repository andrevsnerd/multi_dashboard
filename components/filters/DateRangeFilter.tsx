"use client";

import { useMemo, useState } from "react";
import { DateRange, RangeKeyDict } from "react-date-range";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek, subDays, subMonths } from "date-fns";
import { ptBR } from "date-fns/locale";

import { formatDateForQuery, normalizeRange } from "@/lib/utils/date";

import styles from "./DateRangeFilter.module.css";

import "react-date-range/dist/styles.css";
import "react-date-range/dist/theme/default.css";

export interface DateRangeValue {
  startDate: Date;
  endDate: Date;
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (value: DateRangeValue) => void;
  label?: string;
  maxSelectableDate?: Date;
  availableRange?: DateRangeValue;
}

function formatDisplay(range: DateRangeValue): { primary: string; secondary: string } {
  const sameDay =
    range.startDate.toDateString() === range.endDate.toDateString();
  return {
    primary: sameDay
      ? range.startDate.toLocaleDateString("pt-BR")
      : `${range.startDate.toLocaleDateString("pt-BR")}  ~  ${range.endDate.toLocaleDateString(
          "pt-BR",
        )}`,
    secondary: `${formatDateForQuery(range.startDate)} → ${formatDateForQuery(
      range.endDate,
    )}`,
  };
}

export default function DateRangeFilter({
  value,
  onChange,
  label = "Período",
  maxSelectableDate,
  availableRange,
}: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const normalized = useMemo(
    () => normalizeRange(value.startDate, value.endDate),
    [value.startDate, value.endDate],
  );

  const availableNormalized = useMemo(() => {
    if (!availableRange) {
      return null;
    }
    return normalizeRange(availableRange.startDate, availableRange.endDate);
  }, [availableRange]);

  const effectiveMaxDate = useMemo(() => {
    const base = maxSelectableDate
      ? new Date(maxSelectableDate.getTime())
      : new Date();
    base.setHours(23, 59, 59, 999);
    return base;
  }, [maxSelectableDate]);

  const clampedRange = useMemo(() => {
    const maxTime = effectiveMaxDate.getTime();
    const minTime = availableNormalized?.start.getTime() ?? Number.NEGATIVE_INFINITY;

    let end =
      normalized.end.getTime() > maxTime
        ? new Date(maxTime)
        : normalized.end;

    if (end.getTime() < minTime) {
      end = new Date(minTime);
    }

    let start =
      normalized.start.getTime() > end.getTime()
        ? new Date(end.getTime())
        : normalized.start;

    if (start.getTime() < minTime) {
      start = new Date(minTime);
    }

    return {
      start,
      end,
    };
  }, [normalized.end, normalized.start, effectiveMaxDate, availableNormalized]);

  const presets = useMemo(() => {
    const clampDate = (date: Date) => {
      let clamped = new Date(Math.min(date.getTime(), effectiveMaxDate.getTime()));
      if (availableNormalized && clamped.getTime() < availableNormalized.start.getTime()) {
        clamped = new Date(availableNormalized.start.getTime());
      }
      return clamped;
    };

    return [
      {
        label: "Hoje",
        resolve: () => {
          const day = clampDate(new Date());
          return { startDate: day, endDate: new Date(day.getTime()) };
        },
      },
      {
        label: "Ontem",
        resolve: () => {
          const yesterday = subDays(new Date(), 1);
          const clamped = clampDate(yesterday);
          return { startDate: clamped, endDate: new Date(clamped.getTime()) };
        },
      },
      {
        label: "Essa semana",
        resolve: () => {
          const today = clampDate(new Date());
          let startDate = startOfWeek(today, { weekStartsOn: 1 });
          let endDate = endOfWeek(today, { weekStartsOn: 1 });
          endDate = clampDate(endDate);

          if (endDate.getTime() < startDate.getTime()) {
            startDate = new Date(endDate.getTime());
          }

          return {
            startDate,
            endDate,
          };
        },
      },
      {
        label: "Esse mês",
        resolve: () => {
          const today = clampDate(new Date());
          let startDate = startOfMonth(today);
          let endDate = endOfMonth(today);
          if (availableNormalized && startDate.getTime() < availableNormalized.start.getTime()) {
            startDate = new Date(availableNormalized.start.getTime());
          }
          endDate = clampDate(endDate);

          if (endDate.getTime() < startDate.getTime()) {
            startDate = new Date(endDate.getTime());
          }

          return {
            startDate,
            endDate,
          };
        },
      },
      {
        label: "Última semana",
        resolve: () => {
          const today = clampDate(new Date());
          let startDate = subDays(startOfWeek(today, { weekStartsOn: 1 }), 7);
          let endDate = subDays(endOfWeek(today, { weekStartsOn: 1 }), 7);
          endDate = clampDate(endDate);
          if (availableNormalized && startDate.getTime() < availableNormalized.start.getTime()) {
            startDate = new Date(availableNormalized.start.getTime());
          }
          if (startDate.getTime() > endDate.getTime()) {
            startDate = new Date(endDate.getTime());
          }
          return { startDate, endDate };
        },
      },
      {
        label: "Último mês",
        resolve: () => {
          const today = clampDate(new Date());
          const lastMonth = subMonths(today, 1);
          let startDate = startOfMonth(lastMonth);
          let endDate = endOfMonth(lastMonth);
          endDate = clampDate(endDate);
          if (availableNormalized && startDate.getTime() < availableNormalized.start.getTime()) {
            startDate = new Date(availableNormalized.start.getTime());
          }
          if (startDate.getTime() > endDate.getTime()) {
            startDate = new Date(endDate.getTime());
          }
          return {
            startDate,
            endDate,
          };
        },
      },
    ];
  }, [effectiveMaxDate, availableNormalized]);

  const display = formatDisplay({
    startDate: clampedRange.start,
    endDate: clampedRange.end,
  });

  const selectionRange = {
    startDate: clampedRange.start,
    endDate: clampedRange.end,
    key: "selection",
  };

  const handleSelect = (ranges: RangeKeyDict) => {
    const selected = ranges.selection;
    if (!selected?.startDate || !selected?.endDate) {
      return;
    }

    const clampValue = (date: Date) => {
      let clamped =
        date.getTime() > effectiveMaxDate.getTime()
          ? new Date(effectiveMaxDate.getTime())
          : date;
      if (availableNormalized && clamped.getTime() < availableNormalized.start.getTime()) {
        clamped = new Date(availableNormalized.start.getTime());
      }
      return clamped;
    };

    const endDate = clampValue(selected.endDate);
    const startDate =
      selected.startDate.getTime() > endDate.getTime()
        ? new Date(endDate.getTime())
        : selected.startDate;
    const boundedStart =
      availableNormalized && startDate.getTime() < availableNormalized.start.getTime()
        ? new Date(availableNormalized.start.getTime())
        : startDate;

    onChange({
      startDate: boundedStart,
      endDate,
    });
  };

  return (
    <div className={styles.container}>
      <span className={styles.label}>{label}</span>
      <button
        type="button"
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={() => setIsOpen((prev) => !prev)}
      >
        <span className={styles.buttonValue}>
          <span className={styles.valuePrimary}>{display.primary}</span>
        </span>
        <span>▼</span>
      </button>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            <div className={styles.presets}>
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    const resolved = preset.resolve();
                    onChange(resolved);
                  }}
                  className={styles.presetButton}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <DateRange
              ranges={[selectionRange]}
              onChange={handleSelect}
              direction="horizontal"
              showMonthArrow
              showDateDisplay={false}
              locale={ptBR}
              rangeColors={["#64748b"]}
              maxDate={effectiveMaxDate}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}



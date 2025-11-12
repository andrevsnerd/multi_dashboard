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
}

const PRESETS = [
  {
    label: "Hoje",
    resolve: () => {
      const today = new Date();
      return { startDate: today, endDate: today };
    },
  },
  {
    label: "Ontem",
    resolve: () => {
      const yesterday = subDays(new Date(), 1);
      return { startDate: yesterday, endDate: yesterday };
    },
  },
  {
    label: "Essa semana",
    resolve: () => ({
      startDate: startOfWeek(new Date(), { weekStartsOn: 1 }),
      endDate: endOfWeek(new Date(), { weekStartsOn: 1 }),
    }),
  },
  {
    label: "Esse mês",
    resolve: () => ({
      startDate: startOfMonth(new Date()),
      endDate: endOfMonth(new Date()),
    }),
  },
  {
    label: "Última semana",
    resolve: () => {
      const startDate = subDays(startOfWeek(new Date(), { weekStartsOn: 1 }), 7);
      const endDate = subDays(endOfWeek(new Date(), { weekStartsOn: 1 }), 7);
      return { startDate, endDate };
    },
  },
  {
    label: "Último mês",
    resolve: () => {
      const lastMonth = subMonths(new Date(), 1);
      return {
        startDate: startOfMonth(lastMonth),
        endDate: endOfMonth(lastMonth),
      };
    },
  },
];

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
}: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const normalized = useMemo(
    () => normalizeRange(value.startDate, value.endDate),
    [value.startDate, value.endDate],
  );

  const display = formatDisplay({
    startDate: normalized.start,
    endDate: normalized.end,
  });

  const selectionRange = {
    startDate: normalized.start,
    endDate: normalized.end,
    key: "selection",
  };

  const handleSelect = (ranges: RangeKeyDict) => {
    const selected = ranges.selection;
    if (!selected?.startDate || !selected?.endDate) {
      return;
    }
    onChange({
      startDate: selected.startDate,
      endDate: selected.endDate,
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
          <span className={styles.valueSecondary}>{display.secondary}</span>
        </span>
        <span>▼</span>
      </button>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={() => setIsOpen(false)} />
          <div className={styles.dropdown}>
            <div className={styles.presets}>
              {PRESETS.map((preset) => (
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
              rangeColors={["#6366f1"]}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}



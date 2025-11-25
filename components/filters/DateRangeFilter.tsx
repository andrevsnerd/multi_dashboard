"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { DateRange, RangeKeyDict } from "react-date-range";
import { endOfMonth, endOfWeek, startOfMonth, startOfWeek, startOfYear, subDays, subMonths } from "date-fns";
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
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [isMobile, setIsMobile] = useState(false);
  
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
        label: "Semana passada",
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
        label: "Mês passado",
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
      {
        label: "4 meses",
        resolve: () => {
          const today = clampDate(new Date());
          // Começar no início do mês de 3 meses atrás
          // Ex: se estamos em novembro, começa em agosto (3 meses atrás)
          const threeMonthsAgo = subMonths(today, 3);
          let startDate = startOfMonth(threeMonthsAgo);
          // Terminar no dia atual (ou no maxSelectableDate se for menor)
          let endDate = clampDate(new Date());
          
          // Respeitar o availableRange se existir
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
      {
        label: "Esse Ano",
        resolve: () => {
          const today = clampDate(new Date());
          // Começar no primeiro dia do ano atual
          let startDate = startOfYear(today);
          // Terminar no dia atual (ou no maxSelectableDate se for menor)
          let endDate = clampDate(new Date());
          
          // Respeitar o availableRange se existir
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

  // Detectar mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Calcular posição do dropdown quando abrir
  useEffect(() => {
    if (!isOpen || !containerRef.current) {
      setDropdownStyle({});
      return;
    }
    
    // No mobile, o CSS já define posição fixa, não precisa calcular
    if (isMobile) {
      setDropdownStyle({});
      return;
    }

    const updatePosition = () => {
      if (!containerRef.current) return;

      const containerRect = containerRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const dropdownWidth = 600; // min-width do dropdown

      let left: number | undefined = 0;
      let right: number | undefined = undefined;

      // Verificar se há espaço à direita
      const spaceOnRight = viewportWidth - containerRect.left;
      const spaceOnLeft = containerRect.left;

      // Se não há espaço suficiente à direita, alinhar à direita do container
      if (spaceOnRight < dropdownWidth && spaceOnLeft >= dropdownWidth) {
        right = 0;
        left = undefined;
      } else if (spaceOnRight < dropdownWidth) {
        // Se não há espaço em nenhum lado, ajustar para caber na viewport
        left = Math.max(8, viewportWidth - dropdownWidth - containerRect.left - 8);
      }

      setDropdownStyle({
        left: left !== undefined ? `${left}px` : undefined,
        right: right !== undefined ? `${right}px` : undefined,
      });
    };

    // Usar requestAnimationFrame para garantir que o DOM foi atualizado
    const rafId = requestAnimationFrame(() => {
      updatePosition();
    });
    
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, isMobile]);

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
    <div className={styles.container} ref={containerRef}>
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
          <div 
            className={styles.dropdown} 
            ref={dropdownRef} 
            style={isMobile ? {} : dropdownStyle}
          >
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



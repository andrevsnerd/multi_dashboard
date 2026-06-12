"use client";

import {
  useMemo,
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
} from "react";
import { DateRange, RangeKeyDict } from "react-date-range";
import { endOfMonth, startOfMonth, startOfYear, subDays, subMonths } from "date-fns";
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
  disabled?: boolean;
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

function parseYmdToLocalDate(value: string): Date | null {
  // Espera "yyyy-MM-dd" vindo do <input type="date">
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  const d = new Date(0);
  d.setFullYear(year, month - 1, day);
  d.setHours(0, 0, 0, 0);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export default function DateRangeFilter({
  value,
  onChange,
  label = "Período",
  maxSelectableDate,
  availableRange,
  disabled = false,
}: DateRangeFilterProps) {
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    if (disabled) setIsOpen(false);
  }, [disabled]);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const [isMobile, setIsMobile] = useState(false);
  const [draft, setDraft] = useState<DateRangeValue | null>(null);
  // Mês visível no calendário, controlado por nós para as flechas funcionarem sem "voltar"
  // sozinhas: como `ranges` é recriado a cada render, o react-date-range reposicionava
  // o mês na seleção a cada clique. Controlando shownDate, a navegação fica estável.
  const [shownDate, setShownDate] = useState<Date | null>(null);

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

  const clampDate = useCallback(
    (date: Date) => {
      let clamped =
        date.getTime() > effectiveMaxDate.getTime()
          ? new Date(effectiveMaxDate.getTime())
          : new Date(date.getTime());
      if (availableNormalized && clamped.getTime() < availableNormalized.start.getTime()) {
        clamped = new Date(availableNormalized.start.getTime());
      }
      return clamped;
    },
    [effectiveMaxDate, availableNormalized],
  );

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
    const clampStartToAvailable = (startDate: Date) => {
      if (availableNormalized && startDate.getTime() < availableNormalized.start.getTime()) {
        return new Date(availableNormalized.start.getTime());
      }
      return startDate;
    };
    const rollingMonths = (months: number) => () => {
      const endDate = clampDate(new Date());
      let startDate = clampStartToAvailable(subMonths(endDate, months));
      if (startDate.getTime() > endDate.getTime()) {
        startDate = new Date(endDate.getTime());
      }
      return { startDate, endDate };
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
        label: "Esse mês",
        resolve: () => {
          const today = clampDate(new Date());
          let startDate = clampStartToAvailable(startOfMonth(today));
          const endDate = clampDate(endOfMonth(today));
          if (endDate.getTime() < startDate.getTime()) startDate = new Date(endDate.getTime());
          return { startDate, endDate };
        },
      },
      {
        label: "Mês Passado",
        resolve: () => {
          const today = clampDate(new Date());
          const lastMonth = subMonths(today, 1);
          let startDate = clampStartToAvailable(startOfMonth(lastMonth));
          const endDate = clampDate(endOfMonth(lastMonth));
          if (startDate.getTime() > endDate.getTime()) startDate = new Date(endDate.getTime());
          return { startDate, endDate };
        },
      },
      {
        label: "Esse ano",
        resolve: () => {
          const today = clampDate(new Date());
          let startDate = clampStartToAvailable(startOfYear(today));
          const endDate = clampDate(new Date());
          if (startDate.getTime() > endDate.getTime()) startDate = new Date(endDate.getTime());
          return { startDate, endDate };
        },
      },
      {
        label: "60 dias",
        resolve: () => {
          const endDate = clampDate(new Date());
          let startDate = clampStartToAvailable(subDays(endDate, 59));
          if (startDate.getTime() > endDate.getTime()) {
            startDate = new Date(endDate.getTime());
          }
          return { startDate, endDate };
        },
      },
      {
        label: "12 meses",
        resolve: rollingMonths(12),
      },
      {
        label: "24 meses",
        resolve: rollingMonths(24),
      },
    ];
  }, [clampDate, availableNormalized]);

  // Detectar mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };
    
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const display = formatDisplay({
    startDate: clampedRange.start,
    endDate: clampedRange.end,
  });

  const draftClamped = useMemo(() => {
    const base = draft ?? { startDate: clampedRange.start, endDate: clampedRange.end };
    const norm = normalizeRange(base.startDate, base.endDate);
    const start = clampDate(norm.start);
    const end = clampDate(norm.end);
    if (start.getTime() > end.getTime()) {
      return { startDate: new Date(end.getTime()), endDate: new Date(end.getTime()) };
    }
    return { startDate: start, endDate: end };
  }, [draft, clampedRange.start, clampedRange.end, clampDate]);

  // Desktop: fixed + coords do botão (evita top:100% quando o wrapper estica no layout)
  useLayoutEffect(() => {
    if (!isOpen || isMobile) {
      setDropdownStyle({});
      return;
    }

    const updatePosition = () => {
      const btn = buttonRef.current;
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const gap = 12;
      const horizontalMargin = 12;
      const dropdownWidth = Math.min(500, vw - horizontalMargin * 2);
      const contentHeight = dropdownRef.current?.offsetHeight ?? 360;
      const viewportMax = vh - gap * 2;
      const spaceBelow = vh - rect.bottom - gap;
      const spaceAbove = rect.top - gap;
      // Só recorre a scroll em viewport patologicamente baixa; caso normal nunca tem scroll.
      const needsScroll = contentHeight > viewportMax;

      let top: number;
      if (needsScroll) {
        top = gap;
      } else if (contentHeight <= spaceBelow || spaceBelow >= spaceAbove) {
        // cabe embaixo (ou há mais espaço embaixo): abre para baixo
        top = rect.bottom + gap;
      } else {
        // não cabe embaixo: abre para cima
        top = Math.max(gap, rect.top - gap - contentHeight);
      }

      const next: React.CSSProperties = {
        position: "fixed",
        zIndex: 1001,
        width: dropdownWidth,
        overflowY: needsScroll ? "auto" : "visible",
        top,
        bottom: "auto",
      };
      if (needsScroll) {
        next.maxHeight = viewportMax;
      }

      if (rect.right >= dropdownWidth) {
        next.right = vw - rect.right;
        next.left = "auto";
      } else {
        const left = Math.max(horizontalMargin, Math.min(rect.left, vw - dropdownWidth - horizontalMargin));
        next.left = left;
        next.right = "auto";
      }

      setDropdownStyle(next);
    };

    updatePosition();
    const rafId = requestAnimationFrame(updatePosition);

    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    const panel = dropdownRef.current;
    const ro =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => updatePosition())
        : null;
    if (panel && ro) ro.observe(panel);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      ro?.disconnect();
    };
  }, [isOpen, isMobile]);

  // IMPORTANTE: o react-date-range re-posiciona o mês visível sempre que a prop `ranges`
  // muda de referência (componentDidUpdate -> updateShownDate). Se passarmos um array novo
  // a cada render, as flechas e os selects de mês/ano "voltam" sozinhos e ficam inúteis.
  // Memoizamos por valor (tempo das datas) para a referência só mudar quando a seleção mudar.
  const calendarRanges = useMemo(
    () => [
      {
        startDate: draftClamped.startDate,
        endDate: draftClamped.endDate,
        key: "selection",
      },
    ],
    [draftClamped.startDate, draftClamped.endDate],
  );

  const handleSelect = (ranges: RangeKeyDict) => {
    const selected = ranges.selection;
    if (!selected?.startDate || !selected?.endDate) {
      return;
    }
    const startCandidate = clampDate(selected.startDate);
    const endCandidate = clampDate(selected.endDate);
    const startDate =
      startCandidate.getTime() > endCandidate.getTime()
        ? new Date(endCandidate.getTime())
        : startCandidate;
    setDraft({
      startDate,
      endDate: endCandidate,
    });
  };

  const minSelectable = availableNormalized?.start ?? undefined;
  const maxSelectable = effectiveMaxDate;

  const handleCancel = () => {
    setIsOpen(false);
    setDraft(null);
  };

  const handleApply = () => {
    const norm = normalizeRange(draftClamped.startDate, draftClamped.endDate);
    const nextStart = clampDate(norm.start);
    const nextEnd = clampDate(norm.end);
    const startDate =
      nextStart.getTime() > nextEnd.getTime() ? new Date(nextEnd.getTime()) : nextStart;
    onChange({ startDate, endDate: nextEnd });
    setIsOpen(false);
    setDraft(null);
  };

  return (
    <div className={styles.container} ref={containerRef}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <button
        type="button"
        ref={buttonRef}
        className={`${styles.button} ${isOpen ? styles.buttonActive : ""}`}
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            setIsOpen(false);
            setDraft(null);
            return;
          }
          setDraft({
            startDate: new Date(clampedRange.start.getTime()),
            endDate: new Date(clampedRange.end.getTime()),
          });
          setShownDate(new Date(clampedRange.start.getTime()));
          setIsOpen(true);
        }}
        disabled={disabled}
        aria-disabled={disabled}
      >
        <span className={styles.buttonValue}>
          <span className={styles.valuePrimary}>{display.primary}</span>
        </span>
        <span>▼</span>
      </button>

      {isOpen ? (
        <>
          <div className={styles.backdrop} onClick={handleCancel} />
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
                    setIsOpen(false);
                    setDraft(null);
                  }}
                  className={styles.presetButton}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <div className={styles.calendarArea}>
              <div className={styles.inputsRow}>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Data inicial</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={formatDateForQuery(draftClamped.startDate)}
                    min={minSelectable ? formatDateForQuery(minSelectable) : undefined}
                    max={formatDateForQuery(maxSelectable)}
                    onChange={(e) => {
                      const next = parseYmdToLocalDate(e.target.value);
                      if (!next) return;
                      const start = clampDate(next);
                      let end = clampDate(draftClamped.endDate);
                      if (start.getTime() > end.getTime()) {
                        end = new Date(start.getTime());
                      }
                      setDraft({ startDate: start, endDate: end });
                      setShownDate(new Date(start.getTime()));
                    }}
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Data final</span>
                  <input
                    type="date"
                    className={styles.dateInput}
                    value={formatDateForQuery(draftClamped.endDate)}
                    min={minSelectable ? formatDateForQuery(minSelectable) : undefined}
                    max={formatDateForQuery(maxSelectable)}
                    onChange={(e) => {
                      const next = parseYmdToLocalDate(e.target.value);
                      if (!next) return;
                      const end = clampDate(next);
                      let start = clampDate(draftClamped.startDate);
                      if (end.getTime() < start.getTime()) {
                        start = new Date(end.getTime());
                      }
                      setDraft({ startDate: start, endDate: end });
                      setShownDate(new Date(end.getTime()));
                    }}
                  />
                </label>
              </div>
              <div className={styles.actionsRow}>
                <button type="button" className={styles.actionButton} onClick={handleCancel}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`${styles.actionButton} ${styles.actionPrimary}`}
                  onClick={handleApply}
                >
                  Aplicar
                </button>
              </div>
              <DateRange
                ranges={calendarRanges}
                onChange={handleSelect}
                direction="horizontal"
                showMonthArrow
                showDateDisplay={false}
                locale={ptBR}
                rangeColors={["#64748b"]}
                maxDate={effectiveMaxDate}
                minDate={minSelectable}
                moveRangeOnFirstSelection={false}
                shownDate={shownDate ?? draftClamped.startDate}
                onShownDateChange={(date) => setShownDate(date)}
              />
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}


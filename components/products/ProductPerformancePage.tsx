"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import type { CompanyKey } from "@/lib/config/company";
import type {
  ProductAvailableColor,
  ProductDetailInfo,
  ProductStockByFilial,
  ProductStockProgressDay,
} from "@/lib/repositories/productDetail";
import {
  aggregatedFlags,
  branchFlags,
  collectFilials,
  computePerformance,
  detectPeriods,
  firstActivityIndex,
  lastInStockPeriod,
  summarize,
  type CoverageFilial,
  type CoveragePeriod,
} from "@/lib/utils/product-coverage";
import { getLimiteDiasReposicao } from "@/lib/utils/suggestion-rules";

import styles from "./ProductPerformancePage.module.css";

const NO_COLOR_VALUE = "__SEM_COR__";
const DEFAULT_COVERAGE_DAYS = 60;

interface ProductPerformancePageProps {
  companyKey: CompanyKey;
  companyName: string;
}

interface ProductDetailData {
  detail: ProductDetailInfo;
  stockByFilial: ProductStockByFilial[];
  availableColors: ProductAvailableColor[];
}

type ProductSearchResult = {
  productId: string;
  productName: string;
  matchedColorCode?: string | null;
  matchedColorName?: string | null;
};

const nf0 = new Intl.NumberFormat("pt-BR");
const nf2 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatLongDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })
    .replace(/\./g, "");
}

function formatShortDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function lastNDaysRange(days: number): DateRangeValue {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  return { startDate, endDate };
}

async function searchProducts(company: string, term: string): Promise<ProductSearchResult[]> {
  if (!term || term.trim().length < 2) return [];
  const res = await fetch(
    `/api/products/search?company=${encodeURIComponent(company)}&q=${encodeURIComponent(term)}`,
    { cache: "no-store" }
  );
  if (!res.ok) return [];
  const json = (await res.json()) as { data: ProductSearchResult[] };
  return json.data || [];
}

async function fetchProductDetail(
  productId: string,
  company: string,
  range: DateRangeValue,
  colors: string[]
): Promise<ProductDetailData | null> {
  const params = new URLSearchParams({
    productId,
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
    includeStockProgress: "0",
  });
  if (colors.length > 0) {
    params.set("colors", colors.map((c) => c || NO_COLOR_VALUE).join(","));
  }
  const res = await fetch(`/api/product-detail?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Erro ao carregar dados do produto");
  const json = (await res.json()) as { data: ProductDetailData };
  return json.data;
}

async function fetchStockProgress(
  productId: string,
  company: string,
  range: DateRangeValue,
  colors: string[],
  stockByFilial: ProductStockByFilial[]
): Promise<ProductStockProgressDay[]> {
  const res = await fetch("/api/product-detail/stock-progress", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      productId,
      company,
      colors,
      range: { start: range.startDate.toISOString(), end: range.endDate.toISOString() },
      stockByFilial,
    }),
  });
  if (!res.ok) throw new Error("Erro ao carregar a linha do tempo de estoque");
  const json = (await res.json()) as { data: ProductStockProgressDay[] };
  return json.data ?? [];
}

interface SelectionState {
  startIndex: number;
  endIndex: number;
}

function periodLabel(days: ProductStockProgressDay[], period: CoveragePeriod): string {
  const from = days[period.startIndex]?.dateIso ?? "";
  const to = days[period.endIndex]?.dateIso ?? "";
  const len = period.endIndex - period.startIndex + 1;
  const status = period.inStock ? "Com estoque" : "Sem estoque";
  return `${status} · ${len}d · ${formatShortDate(from)}–${formatShortDate(to)}`;
}

function isSameSelection(period: CoveragePeriod, selection: SelectionState | null): boolean {
  return (
    selection !== null &&
    period.startIndex === selection.startIndex &&
    period.endIndex === selection.endIndex
  );
}

function TimelineRow({
  periods,
  days,
  selection,
  onSelect,
  tall,
}: {
  periods: CoveragePeriod[];
  days: ProductStockProgressDay[];
  selection: SelectionState | null;
  onSelect: (period: CoveragePeriod) => void;
  tall?: boolean;
}) {
  const total = days.length || 1;
  const hasSelection = selection !== null;
  return (
    <div className={`${styles.timelineBar} ${tall ? styles.timelineBarTall : ""}`}>
      {periods.map((period) => {
        const len = period.endIndex - period.startIndex + 1;
        const width = (len / total) * 100;
        const selected = isSameSelection(period, selection);
        const classes = [
          styles.band,
          period.inStock ? styles.bandIn : styles.bandOut,
          selected ? styles.bandSelected : "",
          hasSelection && !selected ? styles.bandDim : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={`${period.startIndex}-${period.endIndex}`}
            type="button"
            className={classes}
            style={{ width: `${width}%` }}
            title={periodLabel(days, period)}
            aria-label={periodLabel(days, period)}
            onClick={() => onSelect(period)}
          />
        );
      })}
    </div>
  );
}

function DateAxis({ days }: { days: ProductStockProgressDay[] }) {
  const ticks = useMemo(() => {
    const n = days.length;
    if (n === 0) return [] as { label: string; left: number }[];
    const out: { label: string; left: number }[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < 7; i += 1) {
      const idx = Math.round((i * (n - 1)) / 6);
      const iso = days[idx]?.dateIso;
      if (!iso) continue;
      const d = new Date(`${iso}T12:00:00`);
      const label = d
        .toLocaleDateString("pt-BR", { month: "short", year: "2-digit" })
        .replace(/\./g, "");
      if (seen.has(label) && i !== 6) continue;
      seen.add(label);
      out.push({ label, left: (idx / (n - 1)) * 100 });
    }
    return out;
  }, [days]);

  return (
    <div className={styles.dateAxis}>
      {ticks.map((tick, i) => (
        <span
          key={`${tick.label}-${i}`}
          className={styles.dateTick}
          style={{ left: `${tick.left}%` }}
        >
          {tick.label}
        </span>
      ))}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  tone?: "default" | "ok" | "danger";
}) {
  return (
    <div className={styles.stat}>
      <span className={styles.statLabel}>{label}</span>
      <span
        className={`${styles.statValue} ${
          tone === "ok" ? styles.toneOk : tone === "danger" ? styles.toneDanger : ""
        }`}
      >
        {value}
      </span>
      {hint && <span className={styles.statHint}>{hint}</span>}
    </div>
  );
}

export default function ProductPerformancePage({
  companyKey,
}: ProductPerformancePageProps) {
  const searchParams = useSearchParams();
  const lastUrlProductId = useRef<string | null>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  const [range, setRange] = useState<DateRangeValue>(() => lastNDaysRange(365));
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [selectedProductName, setSelectedProductName] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<ProductSearchResult[]>([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [selectedColors, setSelectedColors] = useState<string[]>([]);

  const [detailData, setDetailData] = useState<ProductDetailData | null>(null);
  const [stockProgress, setStockProgress] = useState<ProductStockProgressDay[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selection, setSelection] = useState<SelectionState | null>(null);
  // null = usar a cobertura automática do item (regra da Compra Ideal); número = override manual.
  const [coverageOverride, setCoverageOverride] = useState<number | null>(null);

  const selectedColorValue = selectedColors[0]
    ? selectedColors[0]
    : selectedColors.length > 0
      ? NO_COLOR_VALUE
      : "";
  const colorsKey = selectedColors.join("|");
  const rangeKey = `${range.startDate.toISOString()}|${range.endDate.toISOString()}`;

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target as Node)
      ) {
        setShowSearchResults(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Abrir produto a partir de ?productId= (links de outras telas)
  useEffect(() => {
    const id = searchParams.get("productId")?.trim();
    if (!id) {
      lastUrlProductId.current = null;
      return;
    }
    if (lastUrlProductId.current === id) return;
    lastUrlProductId.current = id;
    const name = (searchParams.get("name") ?? id).trim();
    const colorsParam = searchParams.get("colors");
    const colors = colorsParam
      ? colorsParam
          .split(",")
          .map((c) => (c.trim() === NO_COLOR_VALUE ? "" : c.trim()))
          .filter((c) => c || c === "")
      : [];
    setSelectedProductId(id);
    setSelectedProductName(name);
    setSearchTerm(name);
    setShowSearchResults(false);
    setSearchResults([]);
    setSelectedColors(colors);
    setCoverageOverride(null);
  }, [searchParams]);

  // Buscar produtos ao digitar
  useEffect(() => {
    if (!searchTerm || searchTerm.trim().length < 2) {
      setSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    if (
      selectedProductId &&
      selectedProductName &&
      searchTerm.trim() === selectedProductName.trim()
    ) {
      setShowSearchResults(false);
      return;
    }
    let active = true;
    const timeoutId = setTimeout(async () => {
      try {
        const results = await searchProducts(companyKey, searchTerm);
        if (active) {
          setSearchResults(results);
          setShowSearchResults(results.length > 0);
        }
      } catch {
        /* silencioso */
      }
    }, 300);
    return () => {
      active = false;
      clearTimeout(timeoutId);
    };
  }, [searchTerm, companyKey, selectedProductId, selectedProductName]);

  // Carregar detalhe + linha do tempo
  useEffect(() => {
    if (!selectedProductId) {
      setDetailData(null);
      setStockProgress(null);
      return;
    }
    let active = true;
    async function load() {
      const productId = selectedProductId;
      if (!productId) return;
      setLoading(true);
      setError(null);
      try {
        const detail = await fetchProductDetail(productId, companyKey, range, selectedColors);
        if (!active) return;
        if (!detail) {
          setDetailData(null);
          setStockProgress(null);
          return;
        }
        setDetailData(detail);
        const progress = await fetchStockProgress(
          productId,
          companyKey,
          range,
          selectedColors,
          detail.stockByFilial
        );
        if (!active) return;
        setStockProgress(progress);
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "Não foi possível carregar o produto.");
          setStockProgress(null);
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [selectedProductId, companyKey, rangeKey, colorsKey, range, selectedColors]);

  const days = useMemo(() => stockProgress ?? [], [stockProgress]);

  const displayMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const f of detailData?.stockByFilial ?? []) {
      const label = (f.filialDisplayName || f.filial || "").trim();
      if (label) map[label.toUpperCase()] = label;
    }
    return map;
  }, [detailData]);

  const filiais: CoverageFilial[] = useMemo(
    () => collectFilials(days, displayMap),
    [days, displayMap]
  );

  const aggFlags = useMemo(() => aggregatedFlags(days), [days]);
  const aggPeriods = useMemo(() => detectPeriods(aggFlags), [aggFlags]);

  // Cobertura automática do item: mesma regra da Compra Ideal (linha/subgrupo).
  const autoCoverageDays = useMemo(() => {
    if (!detailData) return DEFAULT_COVERAGE_DAYS;
    return getLimiteDiasReposicao({
      linha: detailData.detail.linha ?? null,
      subgrupo: detailData.detail.subgrupo ?? null,
    });
  }, [detailData]);
  const coverageDays = coverageOverride ?? autoCoverageDays;

  // KPIs ancorados na 1ª atividade do produto no período: dias antes de o item
  // existir/ter estoque não contam como ruptura. Status atual usa o estoque real.
  const summary = useMemo(() => {
    const start = firstActivityIndex(days);
    const anchored = aggFlags.slice(start);
    const base = summarize(anchored);
    const currentlyOut = (detailData?.detail.totalStock ?? 0) <= 0;
    return {
      ...base,
      currentlyOut,
      daysSinceLastStock: currentlyOut ? base.daysSinceLastStock : 0,
    };
  }, [days, aggFlags, detailData]);

  const branchPeriods = useMemo(
    () =>
      filiais.map((filial) => ({
        filial,
        periods: detectPeriods(branchFlags(days, filial.key)),
      })),
    [filiais, days]
  );

  // Seleção inicial = último período com estoque do consolidado
  useEffect(() => {
    if (days.length === 0) {
      setSelection(null);
      return;
    }
    const period = lastInStockPeriod(aggPeriods);
    setSelection(
      period
        ? { startIndex: period.startIndex, endIndex: period.endIndex }
        : { startIndex: 0, endIndex: days.length - 1 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockProgress]);

  const performance = useMemo(() => {
    if (!selection || days.length === 0) return null;
    return computePerformance(
      days,
      filiais,
      selection.startIndex,
      selection.endIndex,
      coverageDays
    );
  }, [days, filiais, selection, coverageDays]);

  const handleSelectPeriod = useCallback((period: CoveragePeriod) => {
    setSelection({ startIndex: period.startIndex, endIndex: period.endIndex });
  }, []);

  const handleProductSelect = useCallback((product: ProductSearchResult) => {
    const trimmedName = product.productName.trim();
    const preColor = product.matchedColorCode?.trim() || "";
    setSelectedProductId(product.productId);
    setSelectedProductName(trimmedName);
    setSearchTerm(trimmedName);
    setShowSearchResults(false);
    setSearchResults([]);
    setSelectedColors(preColor ? [preColor] : []);
    setCoverageOverride(null);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchTerm("");
    setSelectedProductId(null);
    setSelectedProductName(null);
    setDetailData(null);
    setStockProgress(null);
    setShowSearchResults(false);
    setSearchResults([]);
    setSelectedColors([]);
    setCoverageOverride(null);
  }, []);

  const rangeStartIso = days[selection?.startIndex ?? 0]?.dateIso ?? "";
  const rangeEndIso = days[selection?.endIndex ?? days.length - 1]?.dateIso ?? "";
  const isRupturePeriod = performance !== null && performance.filialsWithStock === 0;

  const header = (
    <div className={styles.controls}>
      <div className={styles.controlsTop}>
        <div className={styles.titles}>
          <h1 className={styles.pageTitle}>Produto Performance</h1>
          <p className={styles.pageSubtitle}>
            Linha do tempo de cobertura de estoque e sugestão de compra por filial, com base na
            velocidade observada.
          </p>
        </div>
      </div>
      <div className={styles.controlsRow}>
        <div className={styles.rangeWrapper}>
          <DateRangeFilter value={range} onChange={setRange} label="" />
        </div>
        <div className={styles.searchContainer} ref={searchContainerRef}>
          <div className={styles.searchInputWrapper}>
            <span className={styles.searchIcon} aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.35-4.35" />
              </svg>
            </span>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Nome, código ou código de barras"
              value={searchTerm}
              onChange={(e) => {
                const value = e.target.value;
                setSearchTerm(value);
                if (
                  selectedProductId &&
                  selectedProductName &&
                  value.trim() !== selectedProductName.trim()
                ) {
                  setSelectedProductId(null);
                  setSelectedProductName(null);
                  setDetailData(null);
                  setStockProgress(null);
                }
                if (!value) {
                  clearSearch();
                } else {
                  setShowSearchResults(value.trim().length >= 2);
                }
              }}
              onFocus={() => {
                if (
                  searchTerm.trim().length >= 2 &&
                  (!selectedProductId ||
                    (selectedProductName && searchTerm.trim() !== selectedProductName.trim()))
                ) {
                  setShowSearchResults(true);
                }
              }}
            />
            {searchTerm && (
              <button
                type="button"
                className={styles.clearButton}
                onClick={clearSearch}
                aria-label="Limpar busca"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
          {showSearchResults && searchResults.length > 0 && (
            <div className={styles.searchResults}>
              {searchResults.map((product) => (
                <button
                  key={`${product.productId}-${product.matchedColorCode ?? "all"}`}
                  type="button"
                  className={styles.searchResultItem}
                  onClick={() => handleProductSelect(product)}
                >
                  <div className={styles.searchResultName}>{product.productName}</div>
                  <div className={styles.searchResultId}>
                    {product.productId}
                    {product.matchedColorCode
                      ? ` • Cor: ${product.matchedColorName || product.matchedColorCode}`
                      : ""}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
        {detailData && (detailData.availableColors ?? []).length > 0 && (
          <select
            className={styles.colorSelect}
            value={selectedColorValue}
            disabled={loading}
            onChange={(e) => {
              const value = e.target.value;
              setSelectedColors(value ? [value === NO_COLOR_VALUE ? "" : value] : []);
            }}
            aria-label="Filtrar por cor"
          >
            <option value="">Todas as cores</option>
            {(detailData.availableColors ?? []).map(({ code, displayName }) => (
              <option key={code || "sem-cor"} value={code || NO_COLOR_VALUE}>
                {code ? displayName : `${displayName} (sem código)`}
              </option>
            ))}
          </select>
        )}
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );

  if (loading && !detailData) {
    return (
      <div className={styles.wrapper}>
        {header}
        <div className={styles.loadingCard}>
          <span className={styles.spinner} aria-hidden />
          <span>Carregando linha do tempo do produto…</span>
        </div>
      </div>
    );
  }

  if (!selectedProductId || !detailData) {
    return (
      <div className={styles.wrapper}>
        {header}
        <div className={styles.empty}>
          <p>Digite o nome, código do produto ou código de barras para começar a análise.</p>
        </div>
      </div>
    );
  }

  const detail = detailData.detail;
  const hasTimeline = days.length > 0;

  return (
    <div className={styles.wrapper}>
      {header}

      {/* HEADER do produto */}
      <div className={styles.productHeader}>
        <div className={styles.productHeaderLeft}>
          <span className={styles.eyebrow}>
            ANÁLISE DE COBERTURA · <span className={styles.mono}>{detail.productId}</span>
          </span>
          <h2 className={styles.productName}>
            {detail.productName}
            {"grade" in detail && detail.grade ? (
              <span className={styles.grade}> {detail.grade}</span>
            ) : null}
          </h2>
          <p className={styles.productSub}>
            {summary.totalDays} dias com histórico em {filiais.length}{" "}
            {filiais.length === 1 ? "filial" : "filiais"}. Verde indica dias com estoque em alguma
            loja; vermelho, ruptura total.
          </p>
        </div>
        <div className={styles.kpiGrid}>
          <div className={styles.stat}>
            <span className={styles.statLabel}>Cobertura alvo</span>
            <span className={styles.statValue}>
              <input
                type="number"
                min={1}
                max={365}
                value={coverageDays}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCoverageOverride(
                    Number.isFinite(v) && v > 0 ? Math.min(365, Math.round(v)) : 1
                  );
                }}
                className={styles.coverageInput}
                aria-label="Cobertura alvo em dias"
              />
              <span className={styles.statUnit}> dias</span>
            </span>
            <span className={styles.statHint}>
              {coverageOverride === null ? (
                `Automático (${detailData.detail.linha?.trim() || detailData.detail.subgrupo?.trim() || "padrão"})`
              ) : (
                <button
                  type="button"
                  className={styles.linkButton}
                  onClick={() => setCoverageOverride(null)}
                >
                  Voltar ao automático ({autoCoverageDays}d)
                </button>
              )}
            </span>
          </div>
          <Stat
            label="Dias com estoque"
            value={`${summary.pctIn}%`}
            hint={`${summary.inDays}/${summary.totalDays}`}
          />
          <Stat
            label="Maior ruptura"
            value={`${summary.longestOut}d`}
            tone={summary.longestOut > coverageDays ? "danger" : "default"}
          />
          <Stat
            label="Status atual"
            value={summary.currentlyOut ? `${summary.daysSinceLastStock}d sem estoque` : "Em estoque"}
            tone={summary.currentlyOut ? "danger" : "ok"}
          />
        </div>
      </div>

      {!hasTimeline ? (
        <div className={styles.empty}>
          <p>Sem histórico de estoque no período selecionado para este produto.</p>
        </div>
      ) : (
        <>
          {/* LINHA DO TEMPO */}
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>Linha do tempo</h3>
              <div className={styles.legend}>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendIn}`} /> Com estoque
                </span>
                <span className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.legendOut}`} /> Ruptura
                </span>
              </div>
            </div>
            <p className={styles.sectionHint}>
              Clique em qualquer faixa para calcular a performance daquele intervalo.
            </p>

            <div className={styles.timelineCard}>
              <div className={styles.timelineCardHead}>
                <span className={styles.timelineCardLabel}>CONSOLIDADO · QUALQUER FILIAL</span>
                <span className={styles.mono}>
                  {formatShortDate(days[0]?.dateIso ?? "")} →{" "}
                  {formatShortDate(days[days.length - 1]?.dateIso ?? "")}
                </span>
              </div>
              <TimelineRow
                periods={aggPeriods}
                days={days}
                selection={selection}
                onSelect={handleSelectPeriod}
                tall
              />
              <DateAxis days={days} />
            </div>

            <div className={styles.branchCard}>
              <span className={styles.branchCardLabel}>POR FILIAL</span>
              <div className={styles.branchList}>
                {branchPeriods.map(({ filial, periods }) => (
                  <div key={filial.key} className={styles.branchRow}>
                    <div className={styles.branchName}>{filial.label}</div>
                    <TimelineRow
                      periods={periods}
                      days={days}
                      selection={selection}
                      onSelect={handleSelectPeriod}
                    />
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* PAINEL DE PERFORMANCE */}
          {performance && selection && (
            <section className={styles.performancePanel}>
              <div className={styles.performanceLeft}>
                <span className={styles.periodTag}>
                  <span className={styles.periodDot} /> PERÍODO SELECIONADO
                </span>
                <div className={styles.periodTitle}>
                  {formatLongDate(rangeStartIso)} — {formatLongDate(rangeEndIso)}
                </div>
                <span className={styles.mono}>{performance.days} dias</span>

                {isRupturePeriod ? (
                  <div className={styles.ruptureNote}>
                    Nenhuma filial tinha estoque neste intervalo. Selecione um período em verde para
                    calcular a performance e a sugestão de compra.
                  </div>
                ) : (
                  <>
                    <div className={styles.bigStatGrid}>
                      <div className={styles.bigStat}>
                        <span className={styles.bigStatLabel}>Unidades vendidas</span>
                        <span className={styles.bigStatValue}>{nf0.format(performance.totalUnits)}</span>
                      </div>
                      <div className={styles.bigStat}>
                        <span className={styles.bigStatLabel}>Velocidade média</span>
                        <span className={styles.bigStatValue}>
                          {nf2.format(performance.weightedVelocity)}
                          <span className={styles.bigStatUnit}> un/dia</span>
                        </span>
                      </div>
                      <div className={styles.bigStat}>
                        <span className={styles.bigStatLabel}>Filiais com estoque</span>
                        <span className={styles.bigStatValue}>
                          {performance.filialsWithStock}{" "}
                          <span className={styles.bigStatUnit}>de {performance.totalFiliais}</span>
                        </span>
                      </div>
                      <div className={styles.bigStat}>
                        <span className={styles.bigStatLabel}>Cobertura</span>
                        <span className={styles.bigStatValue}>{coverageDays}d</span>
                      </div>
                    </div>
                    <div className={styles.suggestionBox}>
                      <span className={styles.suggestionLabel}>
                        SUGESTÃO DE COMPRA · COBERTURA {coverageDays} DIAS
                      </span>
                      <span className={styles.suggestionValue}>
                        {nf0.format(performance.totalSuggested)}{" "}
                        <span className={styles.suggestionUnit}>unidades</span>
                      </span>
                      <p className={styles.suggestionHint}>
                        Baseado na velocidade observada por filial neste período, distribuídas
                        conforme a tabela ao lado.
                      </p>
                    </div>
                  </>
                )}
              </div>

              <div className={styles.performanceRight}>
                <div className={styles.performanceRightHead}>
                  <h3 className={styles.sectionTitle}>Performance por filial</h3>
                  <span className={styles.sortHint}>ORDENADO POR VELOCIDADE</span>
                </div>
                <table className={styles.perfTable}>
                  <colgroup>
                    <col className={styles.colFilial} />
                    <col className={styles.colDias} />
                    <col className={styles.colVend} />
                    <col className={styles.colVel} />
                    <col className={styles.colEnviar} />
                  </colgroup>
                  <thead>
                    <tr>
                      <th>Filial</th>
                      <th className={styles.tRight}>Dias c/ estoque</th>
                      <th className={styles.tRight}>Vendidos</th>
                      <th>Velocidade</th>
                      <th className={styles.tRight}>Enviar p/ {coverageDays}d</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.filiais.map((f) => {
                      const barWidth =
                        performance.maxVelocity > 0
                          ? (f.velocity / performance.maxVelocity) * 100
                          : 0;
                      return (
                        <tr key={f.key}>
                          <td className={styles.perfFilial}>{f.label}</td>
                          <td className={styles.tRight}>
                            <span className={f.daysInStock === 0 ? styles.zeroDanger : styles.mono}>
                              {f.daysInStock}
                            </span>{" "}
                            <span className={styles.muted}>/{performance.days}</span>
                          </td>
                          <td className={`${styles.tRight} ${styles.mono}`}>
                            {nf0.format(f.unitsSold)}
                          </td>
                          <td>
                            <div className={styles.velCell}>
                              <span className={styles.velBarTrack}>
                                <span
                                  className={styles.velBarFill}
                                  style={{ width: `${barWidth}%` }}
                                />
                              </span>
                              <span className={`${styles.mono} ${styles.velValue}`}>
                                {nf2.format(f.velocity)}
                                <span className={styles.muted}> un/d</span>
                              </span>
                            </div>
                          </td>
                          <td className={`${styles.tRight} ${styles.mono}`}>
                            <span className={f.suggestedQty === 0 ? styles.zeroDanger : ""}>
                              {f.suggestedQty}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={styles.perfFilial}>TOTAL</td>
                      <td className={styles.tRight} />
                      <td className={`${styles.tRight} ${styles.mono}`}>
                        {nf0.format(performance.totalUnits)}
                      </td>
                      <td className={`${styles.mono}`}>
                        {nf2.format(performance.weightedVelocity)}
                        <span className={styles.muted}> un/d</span>
                      </td>
                      <td className={`${styles.tRight} ${styles.mono}`}>
                        {nf0.format(performance.totalSuggested)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                <p className={styles.perfFootnote}>
                  Cálculo: velocidade × cobertura ({coverageDays} dias), arredondado para cima por
                  filial. Filiais sem histórico de estoque no período não recebem sugestão —
                  selecione um período em que elas tinham estoque para projetar.
                </p>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

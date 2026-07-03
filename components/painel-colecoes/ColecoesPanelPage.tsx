"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import { resolveCompany, VAREJO_VALUE, type CompanyKey } from "@/lib/config/company";
import { formatDateForQuery, getCurrentMonthRange } from "@/lib/utils/date";
import { exportColecoesPanelToExcel } from "@/lib/utils/exportColecoesPanelXlsx";

import styles from "./ColecoesPanelPage.module.css";

interface ColecoesPanelPageProps {
  companyKey: CompanyKey;
}

interface ColecaoPanelItem {
  key: string;
  label: string;
  codes: string[];
  subtitle?: string;
  vendas: number;
  qtdVendida: number;
  skus: number;
}

type MetricKey = "vendas" | "qtdVendida" | "skus";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "vendas", label: "Vendas" },
  { key: "qtdVendida", label: "Qtd. vendida" },
  { key: "skus", label: "Peças (SKUs)" },
];

// Teto do preenchimento da barra do item líder: evita que ela encoste na borda
// direita do track, mantendo o mesmo respiro visual das demais barras.
const MAX_BAR_PCT = 92;

function formatCurrency(value: number): string {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatCurrencyCompact(value: number): string {
  if (Math.abs(value) >= 1000) {
    return value.toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
      notation: "compact",
      maximumFractionDigits: 1,
    });
  }
  return formatCurrency(value);
}

function formatInt(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

async function fetchPanel(
  company: string,
  range: DateRangeValue,
  filial: string | null
): Promise<ColecaoPanelItem[]> {
  const searchParams = new URLSearchParams({
    company,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });
  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(`/api/painel-colecoes?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || "Erro ao carregar painel de coleções");
  }

  const json = (await response.json()) as { data: ColecaoPanelItem[] };
  return json.data ?? [];
}

export default function ColecoesPanelPage({ companyKey }: ColecoesPanelPageProps) {
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return { startDate: range.start, endDate: range.end };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("vendas");

  const [items, setItems] = useState<ColecaoPanelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    fetchPanel(companyKey, range, selectedFilial)
      .then((data) => {
        if (active) setItems(data);
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Erro ao carregar dados");
          setItems([]);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [companyKey, range.startDate, range.endDate, selectedFilial]);

  const maxForMetric = useMemo(() => {
    return items.reduce((max, item) => Math.max(max, item[metric] ?? 0), 0);
  }, [items, metric]);

  const totals = useMemo(() => {
    return items.reduce(
      (acc, item) => {
        acc.vendas += item.vendas;
        acc.qtdVendida += item.qtdVendida;
        acc.skus += item.skus;
        return acc;
      },
      { vendas: 0, qtdVendida: 0, skus: 0 }
    );
  }, [items]);

  const filialLabel = useMemo(() => {
    if (!selectedFilial) return "Todas as filiais";
    if (selectedFilial === VAREJO_VALUE) return "VAREJO";
    const company = resolveCompany(companyKey);
    return company?.filialDisplayNames?.[selectedFilial] ?? selectedFilial;
  }, [selectedFilial, companyKey]);

  const periodLabel = `${range.startDate.toLocaleDateString("pt-BR")} – ${range.endDate.toLocaleDateString("pt-BR")}`;
  const metricLabel = METRICS.find((m) => m.key === metric)?.label ?? metric;

  async function handleExportPdf() {
    const node = captureRef.current;
    if (!node || items.length === 0 || exportingPdf) return;

    setExportingPdf(true);
    try {
      await document.fonts.ready;

      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import("html2canvas"),
        import("jspdf"),
      ]);

      const canvas = await html2canvas(node, {
        backgroundColor: "#ffffff",
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
        logging: false,
        scrollX: 0,
        scrollY: -window.scrollY,
        onclone: (cloneDoc) => {
          cloneDoc.querySelectorAll("[data-pdf-hide]").forEach((el) => {
            (el as HTMLElement).style.display = "none";
          });
        },
      });

      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pageWidthMm = doc.internal.pageSize.getWidth();
      const pageHeightMm = doc.internal.pageSize.getHeight();
      const marginMm = 8;
      const usableWidthMm = pageWidthMm - marginMm * 2;
      const usableHeightMm = pageHeightMm - marginMm * 2;

      const drawRatio = Math.min(usableWidthMm / canvas.width, usableHeightMm / canvas.height);
      const drawWidthMm = canvas.width * drawRatio;
      const drawHeightMm = canvas.height * drawRatio;
      const offsetXmm = (pageWidthMm - drawWidthMm) / 2;
      const offsetYmm = marginMm;

      doc.addImage(
        canvas.toDataURL("image/png"),
        "PNG",
        offsetXmm,
        offsetYmm,
        drawWidthMm,
        drawHeightMm,
        undefined,
        "FAST"
      );

      const safeRange = `${formatDateForQuery(range.startDate)}_${formatDateForQuery(range.endDate)}`;
      doc.save(`painel-colecoes_${safeRange}.pdf`);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Erro ao exportar PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  function handleExportXlsx() {
    if (items.length === 0) return;
    const company = resolveCompany(companyKey);
    exportColecoesPanelToExcel({
      items,
      companyName: company?.name ?? companyKey,
      periodLabel,
      filialLabel,
    });
  }

  return (
    <div className={styles.wrapper} ref={captureRef}>
      <header className={styles.header}>
        <div className={styles.headerTop}>
          <div>
            <h1 className={styles.title}>Painel de Coleções</h1>
            <p className={styles.subtitle}>
              Visão comparativa das coleções — vendas e quantidade vendida no
              período; peças (SKUs) = produto × cor cadastrados no catálogo.
            </p>
            <p className={styles.meta}>
              Período: {periodLabel} · Filial: {filialLabel} · Comparando por:{" "}
              {metricLabel}
            </p>
          </div>
          <div className={styles.filters} data-pdf-hide>
            <DateRangeFilter value={range} onChange={setRange} />
            <FilialFilter
              companyKey={companyKey}
              value={selectedFilial}
              onChange={setSelectedFilial}
              module="sales"
              showActiveGroupHint
            />
          </div>
        </div>

        <div className={styles.controls} data-pdf-hide>
          <span className={styles.controlsLabel}>Comparar por</span>
          <div className={styles.segmented} role="tablist" aria-label="Métrica de comparação">
            {METRICS.map((m) => (
              <button
                key={m.key}
                type="button"
                role="tab"
                aria-selected={metric === m.key}
                className={`${styles.segment} ${metric === m.key ? styles.segmentActive : ""}`}
                onClick={() => setMetric(m.key)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div className={styles.exportGroup}>
            <button
              type="button"
              className={styles.exportButton}
              onClick={handleExportXlsx}
              disabled={loading || items.length === 0}
            >
              Exportar XLSX
            </button>
            <button
              type="button"
              className={styles.exportButton}
              onClick={() => void handleExportPdf()}
              disabled={exportingPdf || loading || items.length === 0}
            >
              {exportingPdf ? "Exportando…" : "Exportar PDF"}
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className={styles.error}>{error}</div>
      ) : loading ? (
        <div className={styles.list}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className={`${styles.card} ${styles.cardSkeleton}`} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className={styles.empty}>Nenhuma coleção com vendas no período.</div>
      ) : (
        <div className={styles.list}>
          {items.map((item, index) => {
            const metricValue = item[metric] ?? 0;
            const pct =
              maxForMetric > 0
                ? Math.max(2, (metricValue / maxForMetric) * MAX_BAR_PCT)
                : 0;
            const isFeatured = index === 0;
            const isAggregate = item.codes.length > 1;

            return (
              <article
                key={item.key}
                className={`${styles.card} ${isFeatured ? styles.cardFeatured : ""}`}
              >
                <div className={styles.cardMain}>
                  <div className={styles.identity}>
                    <span className={styles.rank}>{index + 1}</span>
                    <div className={styles.nameBlock}>
                      <div className={styles.nameRow}>
                        <h2 className={styles.name}>{item.label}</h2>
                        {isAggregate && (
                          <span className={styles.aggregateTag}>agregado</span>
                        )}
                        <span className={styles.codes}>
                          {item.codes.map((c) => (
                            <span key={c} className={styles.codeChip}>
                              {c}
                            </span>
                          ))}
                        </span>
                      </div>
                      {item.subtitle && (
                        <p className={styles.cardSubtitle}>{item.subtitle}</p>
                      )}
                    </div>
                  </div>

                  <div className={styles.metrics}>
                    <div className={styles.metric}>
                      <span className={styles.metricLabel}>Vendas</span>
                      <span className={styles.metricValue}>
                        {formatCurrency(item.vendas)}
                      </span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricLabel}>Qtd. vendida</span>
                      <span className={styles.metricValue}>
                        {formatInt(item.qtdVendida)}
                      </span>
                    </div>
                    <div className={styles.metric}>
                      <span className={styles.metricLabel}>Peças (SKUs)</span>
                      <span className={styles.metricValue}>{formatInt(item.skus)}</span>
                    </div>
                  </div>
                </div>

                <div className={styles.barTrack}>
                  <div className={styles.barFill} style={{ width: `${pct}%` }} />
                </div>
              </article>
            );
          })}
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <footer className={styles.totals}>
          <span className={styles.totalsLabel}>Total das coleções acompanhadas</span>
          <div className={styles.totalsValues}>
            <span>
              <strong>{formatCurrencyCompact(totals.vendas)}</strong> em vendas
            </span>
            <span>
              <strong>{formatInt(totals.qtdVendida)}</strong> vendidas
            </span>
            <span>
              <strong>{formatInt(totals.skus)}</strong> peças (SKUs)
            </span>
          </div>
        </footer>
      )}
    </div>
  );
}

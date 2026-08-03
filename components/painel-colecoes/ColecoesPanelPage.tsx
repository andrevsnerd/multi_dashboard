"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MiniAreaChart from "@/components/shared/MiniAreaChart";
import { useTheme } from "@/components/theme/ThemeContext";
import { resolveCompany, VAREJO_VALUE, type CompanyKey } from "@/lib/config/company";
import { paletteForIndex } from "@/lib/presentations/palettes";
import { formatDateForQuery, getCurrentMonthRange } from "@/lib/utils/date";
import { exportColecoesPanelToExcel } from "@/lib/utils/exportColecoesPanelXlsx";
import type { ColecaoDetalheResponse } from "@/app/api/painel-colecoes/detalhe/route";

import ColecaoDetalhePanel from "./ColecaoDetalhePanel";
import styles from "./ColecoesPanelPage.module.css";

type DetalheState = "loading" | "error" | ColecaoDetalheResponse;

interface ColecoesPanelPageProps {
  companyKey: CompanyKey;
}

interface ColecaoPanelMonthPoint {
  label: string;
  val: number;
  disp: string;
}

interface ColecaoPanelItem {
  key: string;
  label: string;
  codes: string[];
  subtitle?: string;
  vendas: number;
  qtdVendida: number;
  skus: number;
  /** Início da coleção ("YYYY-MM-DD") = 1ª entrada de estoque na Matriz. */
  inicio: string | null;
  months: ColecaoPanelMonthPoint[];
  maxV: number;
}

type MetricKey = "vendas" | "qtdVendida" | "skus";
type Theme = "padrao" | "fotos";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "vendas", label: "Vendas" },
  { key: "qtdVendida", label: "Qtd. vendida" },
  { key: "skus", label: "Peças (SKUs)" },
];

const THEMES: { key: Theme; label: string }[] = [
  { key: "padrao", label: "Padrão" },
  { key: "fotos", label: "Com fotos" },
];

// Teto do preenchimento da barra do item líder: evita que ela encoste na borda
// direita do track, mantendo o mesmo respiro visual das demais barras.
const MAX_BAR_PCT = 92;

const hex = (c: string) => (c.startsWith("#") ? c : `#${c}`);

/**
 * Chave da imagem no banco (`presentation_assets`, kind="cover") — a MESMA
 * usada pelo Gerador de Apresentações. Coleções de código único reusam o
 * próprio código (ex.: "X7"), então uma foto já enviada lá aparece aqui sem
 * reenvio. Agregados (ex.: Galisteu) não têm um código único → usam a key do
 * grupo como referência própria.
 */
function coverRefFor(item: ColecaoPanelItem): string {
  return item.codes.length === 1 ? item.codes[0].trim().toUpperCase() : item.key.toUpperCase();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo."));
    reader.readAsDataURL(file);
  });
}

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

/**
 * "YYYY-MM-DD" → "dd/mm/aaaa". Formata partindo a string (nada de `new Date`), que
 * interpretaria a data como UTC e voltaria um dia no fuso do Brasil.
 */
function formatInicio(value: string | null): string | null {
  if (!value) return null;
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return null;
  return `${d}/${m}/${y}`;
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

async function fetchDetalhe(
  company: string,
  codes: string[],
  range: DateRangeValue,
  filial: string | null
): Promise<ColecaoDetalheResponse> {
  const searchParams = new URLSearchParams({
    company,
    codes: codes.join(","),
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });
  if (filial) {
    searchParams.set("filial", filial);
  }

  const response = await fetch(
    `/api/painel-colecoes/detalhe?${searchParams.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error || "Erro ao carregar detalhe da coleção");
  }

  const json = (await response.json()) as { data: ColecaoDetalheResponse };
  return json.data;
}

export default function ColecoesPanelPage({ companyKey }: ColecoesPanelPageProps) {
  const { theme: appTheme } = useTheme();
  const initialRange = useMemo(() => {
    const range = getCurrentMonthRange();
    return { startDate: range.start, endDate: range.end };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [metric, setMetric] = useState<MetricKey>("vendas");
  const [theme, setTheme] = useState<Theme>("fotos");

  const [items, setItems] = useState<ColecaoPanelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  // Cards expandidos + cache do detalhe de performance por coleção. Ambos são
  // zerados quando período/filial mudam (o detalhe fica obsoleto).
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detalhes, setDetalhes] = useState<Record<string, DetalheState>>({});

  // Imagens do tema "Com fotos" — mesmo banco (`presentation_assets`) e mesma
  // rota do Gerador de Apresentações. undefined = ainda não buscada; null =
  // buscada, sem imagem; string = data URL salva.
  const [covers, setCovers] = useState<Record<string, string | null | undefined>>({});
  const [uploadingCoverRef, setUploadingCoverRef] = useState<string | null>(null);
  const [coverError, setCoverError] = useState<string | null>(null);
  // Aviso de onde a foto de um agregado foi espalhada (e o que foi preservado).
  const [coverInfo, setCoverInfo] = useState<string | null>(null);

  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    // Detalhe é dependente de período/filial → invalida ao trocar de filtro.
    setExpanded(new Set());
    setDetalhes({});

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

  // Fotos das coleções (tema "Com fotos") — busca só as que ainda não foram
  // carregadas nesta sessão, no mesmo endereço usado pelo Gerador de
  // Apresentações (`/api/gerador-apresentacoes/assets`, kind="cover").
  useEffect(() => {
    if (theme !== "fotos" || items.length === 0) return;
    let active = true;

    const refs = Array.from(new Set(items.map(coverRefFor)));
    const missing = refs.filter((ref) => !(ref in covers));
    if (missing.length === 0) return;

    Promise.all(
      missing.map(async (ref) => {
        try {
          const res = await fetch(
            `/api/gerador-apresentacoes/assets?company=${companyKey}&colecao=${encodeURIComponent(ref)}`,
            { cache: "no-store" }
          );
          if (!res.ok) return [ref, null] as const;
          const json = (await res.json()) as { cover: string | null };
          return [ref, json.cover ?? null] as const;
        } catch {
          return [ref, null] as const;
        }
      })
    ).then((entries) => {
      if (active) setCovers((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });

    return () => {
      active = false;
    };
  }, [theme, items, companyKey, covers]);

  const handleUploadCover = async (item: ColecaoPanelItem, file: File | undefined) => {
    if (!file) return;
    const ref = coverRefFor(item);
    // Agregado (ex.: Galisteu): a foto também preenche os códigos membros, senão
    // eles ficariam sem imagem no Gerador (que sempre busca por código).
    const spreadTo = item.codes.length > 1 ? item.codes : [];
    setUploadingCoverRef(ref);
    setCoverError(null);
    setCoverInfo(null);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const res = await fetch("/api/gerador-apresentacoes/assets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: companyKey, kind: "cover", ref, dataUrl, spreadTo }),
      });
      const json = (await res.json()) as {
        error?: string;
        applied?: string[];
        skipped?: string[];
      };
      if (!res.ok) throw new Error(json?.error || "Erro ao salvar imagem.");
      setCovers((prev) => ({ ...prev, [ref]: dataUrl }));

      if (spreadTo.length > 0) {
        const partes: string[] = [];
        if (json.applied?.length) {
          partes.push(`aplicada também em ${json.applied.join(", ")} no Gerador`);
        }
        if (json.skipped?.length) {
          partes.push(`${json.skipped.join(", ")} mantiveram a foto própria`);
        }
        if (partes.length) setCoverInfo(`${item.label}: ${partes.join("; ")}.`);
      }
    } catch (e) {
      setCoverError(e instanceof Error ? e.message : "Erro ao salvar a imagem.");
    } finally {
      setUploadingCoverRef(null);
    }
  };

  const toggleExpand = (item: ColecaoPanelItem) => {
    const willExpand = !expanded.has(item.key);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (willExpand) next.add(item.key);
      else next.delete(item.key);
      return next;
    });

    const cached = detalhes[item.key];
    if (willExpand && (!cached || cached === "error")) {
      setDetalhes((prev) => ({ ...prev, [item.key]: "loading" }));
      fetchDetalhe(companyKey, item.codes, range, selectedFilial)
        .then((data) => setDetalhes((prev) => ({ ...prev, [item.key]: data })))
        .catch(() => setDetalhes((prev) => ({ ...prev, [item.key]: "error" })));
    }
  };

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
          <span className={styles.controlsLabel}>Tema</span>
          <div className={styles.segmented} role="tablist" aria-label="Tema do painel">
            {THEMES.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={theme === t.key}
                className={`${styles.segment} ${theme === t.key ? styles.segmentActive : ""}`}
                onClick={() => setTheme(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {theme === "padrao" && (
            <>
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
            </>
          )}
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

      {theme === "fotos" && coverError && (
        <div className={styles.error} data-pdf-hide>
          {coverError}
        </div>
      )}

      {theme === "fotos" && coverInfo && (
        <div className={styles.coverInfo} data-pdf-hide>
          {coverInfo}
        </div>
      )}

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
      ) : theme === "fotos" ? (
        <div className={styles.list}>
          {items.map((item, index) => {
            const palette = paletteForIndex(index);
            const ref = coverRefFor(item);
            const cover = covers[ref] ?? null;
            const isUploading = uploadingCoverRef === ref;

            const isExpanded = expanded.has(item.key);

            return (
              <article
                key={item.key}
                className={`${styles.photoCard} ${styles.photoCardClickable}`}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleExpand(item);
                  }
                }}
              >
                <label
                  className={styles.photoWrap}
                  style={{ background: hex(palette.tint) }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="file"
                    accept="image/*"
                    className={styles.photoHiddenInput}
                    onChange={(e) => void handleUploadCover(item, e.target.files?.[0])}
                  />
                  <div className={styles.photoRing} style={{ borderColor: hex(palette.circ) }} />
                  {cover ? (
                    <img src={cover} alt={item.label} className={styles.photoImg} />
                  ) : (
                    <span className={styles.photoRankBadge} style={{ color: hex(palette.primary) }}>
                      {index + 1}
                    </span>
                  )}
                  <div
                    className={`${styles.photoOverlay} ${isUploading ? styles.photoOverlayVisible : ""}`}
                  >
                    {isUploading ? "Enviando…" : cover ? "Trocar foto" : "Adicionar foto"}
                  </div>
                </label>

                <div className={styles.photoNameBlock}>
                  <span className={styles.photoName} style={{ color: hex(palette.ink) }}>
                    {item.label}
                  </span>
                  {formatInicio(item.inicio) && (
                    <span
                      className={styles.inicioTag}
                      title="Início da coleção: 1ª entrada de estoque na Matriz"
                    >
                      desde {formatInicio(item.inicio)}
                    </span>
                  )}
                  {item.subtitle && (
                    <span className={styles.photoSubtitle}>{item.subtitle}</span>
                  )}
                </div>

                <div className={styles.photoMetrics}>
                  <div className={styles.photoMetric}>
                    <span className={styles.photoMetricValue} style={{ color: hex(palette.ink) }}>
                      {formatCurrency(item.vendas)}
                    </span>
                    <span className={styles.photoMetricLabel} style={{ color: hex(palette.primary) }}>
                      VENDAS
                    </span>
                  </div>
                  <div className={styles.photoMetric}>
                    <span className={styles.photoMetricValue} style={{ color: hex(palette.ink) }}>
                      {formatInt(item.qtdVendida)}
                    </span>
                    <span className={styles.photoMetricLabel}>QTD.</span>
                  </div>
                  <div className={styles.photoMetric}>
                    <span className={styles.photoMetricValue} style={{ color: hex(palette.ink) }}>
                      {formatInt(item.skus)}
                    </span>
                    <span className={styles.photoMetricLabel}>PEÇAS (SKUS)</span>
                  </div>
                </div>

                <div className={styles.photoChart}>
                  <MiniAreaChart
                    months={item.months}
                    maxV={item.maxV}
                    palette={palette}
                    dark={appTheme === "dark"}
                  />
                </div>

                {isExpanded && (
                  <div className={styles.detalheWrap} onClick={(e) => e.stopPropagation()}>
                    <ColecaoDetalhePanel state={detalhes[item.key] ?? "loading"} />
                  </div>
                )}
              </article>
            );
          })}
        </div>
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
            const isExpanded = expanded.has(item.key);

            return (
              <article
                key={item.key}
                className={`${styles.card} ${styles.cardClickable} ${isFeatured ? styles.cardFeatured : ""}`}
                role="button"
                tabIndex={0}
                aria-expanded={isExpanded}
                onClick={() => toggleExpand(item)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleExpand(item);
                  }
                }}
              >
                <div className={styles.cardMain}>
                  <div className={styles.identity}>
                    <span className={styles.rank}>{index + 1}</span>
                    <div className={styles.nameBlock}>
                      <div className={styles.nameRow}>
                        <h2 className={styles.name}>{item.label}</h2>
                        {formatInicio(item.inicio) && (
                          <span
                            className={styles.inicioTag}
                            title="Início da coleção: 1ª entrada de estoque na Matriz"
                          >
                            desde {formatInicio(item.inicio)}
                          </span>
                        )}
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

                {isExpanded && (
                  <div className={styles.detalheWrap} onClick={(e) => e.stopPropagation()}>
                    <ColecaoDetalhePanel state={detalhes[item.key] ?? "loading"} />
                  </div>
                )}
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

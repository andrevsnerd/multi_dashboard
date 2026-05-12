"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import DateRangeFilter, {
  type DateRangeValue,
} from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import MultiSelectFilter from "@/components/filters/MultiSelectFilter";
import type { CompanyKey } from "@/lib/config/company";
import { getCurrentMonthRange } from "@/lib/utils/date";

import styles from "./CollectionReportPage.module.css";

type ReportChannel = "Varejo" | "E-commerce";

interface CollectionReportDetailRow {
  id: string;
  channel: ReportChannel;
  origin: string;
  productId: string;
  productName: string;
  grade: string;
  colorCode: string;
  colorDescription: string;
  quantity: number;
  revenue: number;
}

interface CollectionReportProductRow {
  id: string;
  productName: string;
  retailRevenue: number;
  ecommerceRevenue: number;
  totalRevenue: number;
  details: CollectionReportDetailRow[];
}

interface CollectionReportResponse {
  summary: {
    totalRevenue: number;
    retailRevenue: number;
    ecommerceRevenue: number;
    totalQuantity: number;
    retailQuantity: number;
    ecommerceQuantity: number;
    retailShare: number;
    ecommerceShare: number;
    detectedStartDate: string | null;
    detectedEndDate: string | null;
  };
  topProducts: Array<{
    productName: string;
    retailRevenue: number;
    ecommerceRevenue: number;
    totalRevenue: number;
  }>;
  products: CollectionReportProductRow[];
}

interface CollectionReportAvailableRange {
  startDate: string | null;
  endDate: string | null;
  collectionCode: string | null;
  collectionDescription: string | null;
}

interface CollectionReportPageProps {
  companyKey: CompanyKey;
}

const CHANNEL_COLORS = {
  retail: "#2563eb",
  ecommerce: "#c2410c",
};

const EMPTY_REPORT: CollectionReportResponse = {
  summary: {
    totalRevenue: 0,
    retailRevenue: 0,
    ecommerceRevenue: 0,
    totalQuantity: 0,
    retailQuantity: 0,
    ecommerceQuantity: 0,
    retailShare: 0,
    ecommerceShare: 0,
    detectedStartDate: null,
    detectedEndDate: null,
  },
  topProducts: [],
  products: [],
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function formatNumber(value: number) {
  return value.toLocaleString("pt-BR");
}

function formatDate(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR");
}

function buildSubtitle(
  selectedColecoes: string[],
  detectedStartDate: string | null,
  detectedEndDate: string | null
) {
  const collectionLabel =
    selectedColecoes.length === 0
      ? "Todas as cole\u00e7\u00f5es"
      : selectedColecoes.length === 1
      ? `Cole\u00e7\u00e3o ${selectedColecoes[0]}`
      : `${selectedColecoes.length} cole\u00e7\u00f5es selecionadas`;

  if (detectedStartDate && detectedEndDate) {
    return `${collectionLabel} \u00b7 per\u00edodo encontrado nos dados: ${formatDate(
      detectedStartDate
    )} - ${formatDate(detectedEndDate)}`;
  }

  return `${collectionLabel} \u00b7 sem vendas encontradas no per\u00edodo selecionado`;
}

function buildTitle(
  selectedColecoes: string[],
  collectionDescription: string | null
) {
  if (selectedColecoes.length !== 1) {
    return "Relat\u00f3rio Cole\u00e7\u00e3o";
  }

  const code = selectedColecoes[0];
  const description = collectionDescription?.trim();
  return description
    ? `Relat\u00f3rio Cole\u00e7\u00e3o ${code} - ${description}`
    : `Relat\u00f3rio Cole\u00e7\u00e3o ${code}`;
}

async function fetchReport(
  companyKey: string,
  range: DateRangeValue,
  filial: string | null,
  colecoes: string[]
) {
  const params = new URLSearchParams({
    company: companyKey,
    start: range.startDate.toISOString(),
    end: range.endDate.toISOString(),
  });

  if (filial) {
    params.set("filial", filial);
  }

  colecoes.forEach((colecao) => {
    params.append("colecao", colecao);
  });

  const response = await fetch(`/api/relatorio-colecao?${params.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Erro ao carregar relat\u00f3rio da cole\u00e7\u00e3o.");
  }

  const json = (await response.json()) as { data: CollectionReportResponse };
  return json.data;
}

async function fetchColecoes(companyKey: string, filial: string | null) {
  const params = new URLSearchParams({ company: companyKey });

  if (filial) {
    params.set("filial", filial);
  }

  const response = await fetch(
    `/api/relatorio-colecao/colecoes?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Erro ao carregar cole\u00e7\u00f5es.");
  }

  const json = (await response.json()) as { data: string[] };
  return json.data ?? [];
}

async function fetchCollectionRange(
  companyKey: string,
  filial: string | null,
  colecoes: string[]
) {
  const params = new URLSearchParams({ company: companyKey });

  if (filial) {
    params.set("filial", filial);
  }

  colecoes.forEach((colecao) => {
    params.append("colecao", colecao);
  });

  const response = await fetch(
    `/api/relatorio-colecao/range?${params.toString()}`,
    { cache: "no-store" }
  );

  if (!response.ok) {
    throw new Error("Erro ao carregar per\u00edodo da cole\u00e7\u00e3o.");
  }

  const json = (await response.json()) as { data: CollectionReportAvailableRange };
  return json.data;
}

export default function CollectionReportPage({
  companyKey,
}: CollectionReportPageProps) {
  const initialRange = useMemo(() => {
    const current = getCurrentMonthRange();
    return {
      startDate: current.start,
      endDate: current.end,
    };
  }, []);

  const [range, setRange] = useState<DateRangeValue>(initialRange);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [availableColecoes, setAvailableColecoes] = useState<string[]>([]);
  const [selectedColecoes, setSelectedColecoes] = useState<string[]>([]);
  const [selectedCollectionDescription, setSelectedCollectionDescription] =
    useState<string | null>(null);
  const [report, setReport] = useState<CollectionReportResponse>(EMPTY_REPORT);
  const [expandedProducts, setExpandedProducts] = useState<Record<string, boolean>>(
    {}
  );
  const [loading, setLoading] = useState(false);
  const [loadingColecoes, setLoadingColecoes] = useState(false);
  const [syncingCollectionRange, setSyncingCollectionRange] = useState(false);
  const [isCollectionChanging, setIsCollectionChanging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function loadColecoes() {
      setLoadingColecoes(true);
      try {
        const data = await fetchColecoes(companyKey, selectedFilial);
        if (!active) return;
        setAvailableColecoes(data);
        setSelectedColecoes((current) => {
          const next = current.filter((item) => data.includes(item));
          if (next.length === 0) {
            setSelectedCollectionDescription(null);
          }
          return next;
        });
      } catch {
        if (!active) return;
        setAvailableColecoes([]);
      } finally {
        if (active) {
          setLoadingColecoes(false);
        }
      }
    }

    void loadColecoes();

    return () => {
      active = false;
    };
  }, [companyKey, selectedFilial]);

  useEffect(() => {
    if (selectedColecoes.length === 0) {
      setSelectedCollectionDescription(null);
      setSyncingCollectionRange(false);
      return;
    }

    let active = true;
    setSyncingCollectionRange(true);

    async function syncRangeFromCollection() {
      try {
        const data = await fetchCollectionRange(
          companyKey,
          selectedFilial,
          selectedColecoes
        );

        if (!active || !data.startDate || !data.endDate) {
          if (active) {
            setSelectedCollectionDescription(data.collectionDescription ?? null);
          }
          return;
        }

        const nextStartDate = new Date(data.startDate);
        const nextEndDate = new Date(data.endDate);
        if (
          Number.isNaN(nextStartDate.getTime()) ||
          Number.isNaN(nextEndDate.getTime())
        ) {
          setSelectedCollectionDescription(data.collectionDescription ?? null);
          return;
        }

        setSelectedCollectionDescription(data.collectionDescription ?? null);
        setRange({
          startDate: nextStartDate,
          endDate: nextEndDate,
        });
      } catch {
        // Mantemos o range atual se a consulta falhar.
      } finally {
        if (active) {
          setSyncingCollectionRange(false);
        }
      }
    }

    void syncRangeFromCollection();

    return () => {
      active = false;
    };
  }, [companyKey, selectedColecoes, selectedFilial]);

  useEffect(() => {
    let active = true;

    if (syncingCollectionRange) {
      return () => {
        active = false;
      };
    }

    async function loadReport() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchReport(
          companyKey,
          range,
          selectedFilial,
          selectedColecoes
        );
        if (!active) return;
        setReport(data);
        setExpandedProducts({});
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error
            ? err.message
            : "N\u00e3o foi poss\u00edvel carregar o relat\u00f3rio."
        );
        setReport(EMPTY_REPORT);
      } finally {
        if (active) {
          setLoading(false);
          setIsCollectionChanging(false);
        }
      }
    }

    void loadReport();

    return () => {
      active = false;
    };
  }, [companyKey, range, selectedColecoes, selectedFilial, syncingCollectionRange]);

  const subtitle = useMemo(
    () =>
      buildSubtitle(
        selectedColecoes,
        report.summary.detectedStartDate,
        report.summary.detectedEndDate
      ),
    [
      report.summary.detectedEndDate,
      report.summary.detectedStartDate,
      selectedColecoes,
    ]
  );

  const pageTitle = useMemo(
    () => buildTitle(selectedColecoes, selectedCollectionDescription),
    [selectedColecoes, selectedCollectionDescription]
  );

  const channelData = useMemo(
    () => [
      {
        name: "Varejo",
        value: report.summary.retailRevenue,
        color: CHANNEL_COLORS.retail,
      },
      {
        name: "E-commerce",
        value: report.summary.ecommerceRevenue,
        color: CHANNEL_COLORS.ecommerce,
      },
    ].filter((item) => item.value > 0),
    [report.summary.ecommerceRevenue, report.summary.retailRevenue]
  );

  const topProductsData = useMemo(
    () =>
      report.topProducts.map((item) => ({
        ...item,
        shortName:
          item.productName.length > 24
            ? `${item.productName.slice(0, 24)}...`
            : item.productName,
      })),
    [report.topProducts]
  );

  const hasData = report.products.length > 0;

  return (
    <div className={styles.wrapper}>
      <div className={styles.hero}>
        <div>
          <span className={styles.eyebrow}>{"Relat\u00f3rio Cole\u00e7\u00e3o"}</span>
          <h1 className={styles.title}>{pageTitle}</h1>
          <p className={styles.subtitle}>{subtitle}</p>
          {isCollectionChanging || syncingCollectionRange ? (
            <div className={styles.collectionLoading}>
              <span className={styles.collectionLoadingDot}></span>
              {"Atualizando cole\u00e7\u00e3o e carregando novos dados..."}
            </div>
          ) : null}
        </div>
      </div>

      <div className={styles.filters}>
        <DateRangeFilter value={range} onChange={setRange} />
        <FilialFilter
          companyKey={companyKey}
          value={selectedFilial}
          onChange={setSelectedFilial}
        />
        <MultiSelectFilter
          label={"Cole\u00e7\u00e3o"}
          value={selectedColecoes}
          options={availableColecoes}
          onChange={(value) => {
            setIsCollectionChanging(true);
            setSelectedCollectionDescription(null);
            setSelectedColecoes(value);
          }}
          loading={loadingColecoes}
        />
      </div>

      {error ? <div className={styles.error}>{error}</div> : null}

      <div className={loading ? styles.loadingContent : undefined}>
        <section className={styles.kpiGrid}>
          <article className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Total Faturado Geral</span>
            <strong className={styles.kpiValue}>
              {formatCurrency(report.summary.totalRevenue)}
            </strong>
            <span className={styles.kpiMeta}>Varejo + E-commerce</span>
          </article>
          <article className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Total Faturado Varejo</span>
            <strong className={styles.kpiValue}>
              {formatCurrency(report.summary.retailRevenue)}
            </strong>
            <span className={styles.kpiMeta}>
              {report.summary.retailShare.toFixed(1)}% do total
            </span>
          </article>
          <article className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Total Faturado E-commerce</span>
            <strong className={styles.kpiValue}>
              {formatCurrency(report.summary.ecommerceRevenue)}
            </strong>
            <span className={styles.kpiMeta}>
              {report.summary.ecommerceShare.toFixed(1)}% do total
            </span>
          </article>
          <article className={styles.kpiCard}>
            <span className={styles.kpiLabel}>Total de Produtos Vendidos</span>
            <strong className={styles.kpiValue}>
              {formatNumber(report.summary.totalQuantity)}
            </strong>
            <span className={styles.kpiMeta}>Unidades</span>
          </article>
        </section>

        <section className={styles.chartGrid}>
          <article className={styles.chartCard}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Distribuicao por Canal</h2>
              <p className={styles.sectionText}>
                Participacao do faturamento por canal no periodo filtrado.
              </p>
            </div>
            {channelData.length > 0 ? (
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={320}>
                  <PieChart>
                    <Pie
                      data={channelData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={72}
                      outerRadius={112}
                      paddingAngle={3}
                    >
                      {channelData.map((item) => (
                        <Cell key={item.name} fill={item.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatCurrency(value),
                        name,
                      ]}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className={styles.emptyChart}>Sem dados para exibir.</div>
            )}
          </article>

          <article className={styles.chartCard}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>Top 10 Produtos</h2>
              <p className={styles.sectionText}>
                Ranking por faturamento com separacao entre varejo e e-commerce.
              </p>
            </div>
            {topProductsData.length > 0 ? (
              <div className={styles.chartWrap}>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart
                    data={topProductsData}
                    margin={{ top: 8, right: 12, left: 12, bottom: 36 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="shortName"
                      angle={-20}
                      textAnchor="end"
                      interval={0}
                      height={72}
                      tick={{ fontSize: 11 }}
                    />
                    <YAxis
                      tickFormatter={(value) => formatCurrency(Number(value))}
                      width={92}
                    />
                    <Tooltip
                      formatter={(value: number, name: string) => [
                        formatCurrency(value),
                        name,
                      ]}
                      labelFormatter={(label, payload) =>
                        payload?.[0]?.payload?.productName || String(label)
                      }
                    />
                    <Legend />
                    <Bar
                      dataKey="retailRevenue"
                      name="Varejo"
                      fill={CHANNEL_COLORS.retail}
                      radius={[8, 8, 0, 0]}
                    />
                    <Bar
                      dataKey="ecommerceRevenue"
                      name="E-commerce"
                      fill={CHANNEL_COLORS.ecommerce}
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className={styles.emptyChart}>Sem dados para exibir.</div>
            )}
          </article>
        </section>

        <section className={styles.tableCard}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Analise Detalhada por Produto</h2>
            <p className={styles.sectionText}>
              A tabela replica a leitura do HTML original: totais por produto e
              detalhamento expansivel por grade, cor e canal.
            </p>
          </div>

          {!hasData ? (
            <div className={styles.emptyState}>
              Nenhum registro encontrado para os filtros selecionados.
            </div>
          ) : (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className={styles.alignRight}>Total Varejo</th>
                    <th className={styles.alignRight}>Total E-commerce</th>
                    <th className={styles.alignRight}>Total Geral</th>
                  </tr>
                </thead>
                <tbody>
                  {report.products.map((product) => {
                    const expanded = Boolean(expandedProducts[product.id]);

                    return (
                      <FragmentRow
                        key={product.id}
                        product={product}
                        expanded={expanded}
                        onToggle={() =>
                          setExpandedProducts((current) => ({
                            ...current,
                            [product.id]: !current[product.id],
                          }))
                        }
                      />
                    );
                  })}
                  <tr className={styles.totalRow}>
                    <td>Total Geral</td>
                    <td className={styles.alignRight}>
                      {formatCurrency(report.summary.retailRevenue)}
                    </td>
                    <td className={styles.alignRight}>
                      {formatCurrency(report.summary.ecommerceRevenue)}
                    </td>
                    <td className={styles.alignRight}>
                      {formatCurrency(report.summary.totalRevenue)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      {loading ? (
        <div className={styles.loadingBanner}>{"Carregando relat\u00f3rio..."}</div>
      ) : null}
    </div>
  );
}

function FragmentRow({
  product,
  expanded,
  onToggle,
}: {
  product: CollectionReportProductRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className={styles.productRow}>
        <td>
          <button type="button" className={styles.expandButton} onClick={onToggle}>
            {expanded ? "−" : "+"}
          </button>
          <span className={styles.productName}>{product.productName}</span>
        </td>
        <td className={styles.alignRight}>{formatCurrency(product.retailRevenue)}</td>
        <td className={styles.alignRight}>
          {formatCurrency(product.ecommerceRevenue)}
        </td>
        <td className={styles.alignRight}>
          <strong>{formatCurrency(product.totalRevenue)}</strong>
        </td>
      </tr>
      {expanded ? (
        <tr className={styles.detailRow}>
          <td colSpan={4}>
            <div className={styles.detailPanel}>
              <table className={styles.detailTable}>
                <thead>
                  <tr>
                    <th>Grade</th>
                    <th>Produto</th>
                    <th>Cor</th>
                    <th className={styles.alignRight}>Qtd vendida</th>
                    <th className={styles.alignRight}>Venda liquida</th>
                    <th>Canal / Filial</th>
                  </tr>
                </thead>
                <tbody>
                  {product.details.map((detail) => (
                    <tr key={detail.id}>
                      <td>{detail.grade}</td>
                      <td>{detail.productName}</td>
                      <td>{detail.colorDescription}</td>
                      <td className={styles.alignRight}>
                        {formatNumber(detail.quantity)}
                      </td>
                      <td className={styles.alignRight}>
                        {formatCurrency(detail.revenue)}
                      </td>
                      <td>
                        <span
                          className={
                            detail.channel === "Varejo"
                              ? styles.retailBadge
                              : styles.ecommerceBadge
                          }
                        >
                          {detail.origin}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

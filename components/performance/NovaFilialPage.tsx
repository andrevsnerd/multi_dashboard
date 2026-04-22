"use client";

import { startOfMonth, subMonths } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import {
  CURVA_LABELS,
  getComparableFilialOptions,
  getDefaultNovaFilialPreset,
  getNovaFilialPresets,
  type Curva,
} from "@/lib/performance/novaFilial";
import { formatDateForQuery } from "@/lib/utils/date";

import styles from "./NovaFilialPage.module.css";

interface StoreOption {
  value: string;
  label: string;
}

interface PresetOption {
  id: string;
  label: string;
  description: string;
  model: string;
  target: string;
}

interface SummaryData {
  demandUnitsMonthly: number;
  mixTargetUnitsMonthly: number;
  usefulMixStockUnits: number;
  usefulDemandStockUnits: number;
  currentStockUnits: number;
  shortageUnits: number;
  excessUnits: number;
  depthPerItem: number;
  demandRevenueMonthly: number;
  projectedRevenueWithCurrentStock: number;
  mixCoveragePct: number;
  demandCoveragePct: number;
  revenueCoveragePct: number;
  isStockEnough: boolean;
  activeItems: number;
  activeCategories: number;
  curveAItems: number;
  curveAShortageUnits: number;
}

interface CategoryRow {
  categoria: string;
  categoriaCurva: Curva | null;
  categoriaParticipacao: number;
  avgMonthlySales: number;
  avgMonthlyDemandUnits: number;
  mixTargetQty: number;
  currentStock: number;
  coveredMixUnits: number;
  coveredDemandUnits: number;
  shortageQty: number;
  excessQty: number;
  projectedRevenueWithCurrentStock: number;
  mixCoveragePct: number | null;
  demandCoveragePct: number | null;
}

interface ItemRow {
  key: string;
  categoria: string;
  categoriaCurva: Curva | null;
  categoriaParticipacao: number;
  itemCurva: Curva | null;
  itemParticipacao: number;
  produto: string;
  descricao: string;
  subgrupo: string;
  grade: string;
  cor: string;
  corDescricao: string;
  vendasPeriodo: number;
  avgMonthlySales: number;
  avgMonthlyDemandUnits: number;
  qtdePeriodo: number;
  mixTargetQty: number;
  currentStock: number;
  coveredMixUnits: number;
  coveredDemandUnits: number;
  gapQty: number;
  shortageQty: number;
  excessQty: number;
  avgUnitPrice: number;
  projectedRevenueWithCurrentStock: number;
  uncoveredRevenue: number;
  status: "faltando" | "excesso" | "ok";
}

interface ApiData {
  stores: StoreOption[];
  presets: PresetOption[];
  modelStore: StoreOption;
  targetStore: StoreOption;
  range: {
    start: string;
    end: string;
    monthsCount: number;
  };
  abcLabels: Record<Curva, string>;
  sourceInfo: string[];
  summary: SummaryData;
  modelSummary: {
    vendasPeriodo: number;
    qtdePeriodo: number;
    avgMonthlySales: number;
    avgMonthlyUnits: number;
    mixTargetUnitsMonthly: number;
  };
  categoryRows: CategoryRow[];
  itemRows: ItemRow[];
}

interface Props {
  companyKey: CompanyKey;
}

function fmtInt(value: number) {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtBRL(value: number) {
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

function fmtPct(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "0%";
  return `${value.toFixed(1)}%`;
}

function fmtQty(value: number, maxDigits: number = 1) {
  if (Math.abs(value - Math.round(value)) < 0.05) {
    return fmtInt(Math.round(value));
  }
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: maxDigits,
  });
}

function fmtSignedInt(value: number) {
  const rounded = Math.round(value);
  if (rounded > 0) return `+${fmtInt(rounded)}`;
  if (rounded < 0) return `-${fmtInt(Math.abs(rounded))}`;
  return "0";
}

function fmtDeltaPct(value: number) {
  const delta = value - 100;
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${delta.toFixed(1)}%`;
}

function getInitialRange(): DateRangeValue {
  const now = new Date();
  return {
    startDate: startOfMonth(subMonths(now, 5)),
    endDate: now,
  };
}

function getStatusLabel(status: ItemRow["status"]) {
  if (status === "faltando") return "Falta";
  if (status === "excesso") return "Excesso";
  return "Ok";
}

function getStatusTone(status: ItemRow["status"]) {
  if (status === "faltando") return styles.statusMissing;
  if (status === "excesso") return styles.statusExcess;
  return styles.statusOk;
}

function getCurveTone(curva: Curva | null) {
  if (curva === "A") return styles.curveA;
  if (curva === "B") return styles.curveB;
  if (curva === "C") return styles.curveC;
  return styles.curveEmpty;
}

function getCategoryStatus(row: CategoryRow): ItemRow["status"] {
  if (row.shortageQty > 0) return "faltando";
  if (row.excessQty > 0) return "excesso";
  return "ok";
}

export default function NovaFilialPage({ companyKey }: Props) {
  const localStores = useMemo(() => getComparableFilialOptions(companyKey), [companyKey]);
  const localPresets = useMemo(() => getNovaFilialPresets(companyKey), [companyKey]);
  const defaultPreset = useMemo(() => getDefaultNovaFilialPreset(companyKey), [companyKey]);
  const companyName = useMemo(
    () => resolveCompany(companyKey)?.name ?? companyKey.toUpperCase(),
    [companyKey]
  );

  const [range, setRange] = useState<DateRangeValue>(() => getInitialRange());
  const [selectedModel, setSelectedModel] = useState<string>(
    defaultPreset?.model ?? localStores[0]?.value ?? ""
  );
  const [selectedTarget, setSelectedTarget] = useState<string>(
    defaultPreset?.target ??
      localStores.find((store) => store.value !== (defaultPreset?.model ?? ""))?.value ??
      localStores[0]?.value ??
      ""
  );
  const [statusFilter, setStatusFilter] = useState<"todos" | "faltando" | "excesso">("todos");
  const [showOnlyGap, setShowOnlyGap] = useState(true);
  const [data, setData] = useState<ApiData | null>(null);
  const [resolvedRequestKey, setResolvedRequestKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const requestKey = useMemo(() => {
    if (!selectedModel || !selectedTarget) return null;
    return [
      companyKey,
      selectedModel,
      selectedTarget,
      formatDateForQuery(range.startDate),
      formatDateForQuery(range.endDate),
    ].join("|");
  }, [companyKey, range.endDate, range.startDate, selectedModel, selectedTarget]);

  const loading = requestKey !== null && requestKey !== resolvedRequestKey;

  useEffect(() => {
    if (!selectedModel || !selectedTarget || !requestKey) return;

    const controller = new AbortController();
    const params = new URLSearchParams({
      company: companyKey,
      model: selectedModel,
      target: selectedTarget,
      start: formatDateForQuery(range.startDate),
      end: formatDateForQuery(range.endDate),
    });

    fetch(`/api/nova-filial?${params.toString()}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const json = (await response.json()) as ApiData & { error?: string };
        if (!response.ok || json.error) {
          throw new Error(json.error || "Erro ao carregar a analise");
        }
        setData(json);
        setError(null);
        setResolvedRequestKey(requestKey);
      })
      .catch((fetchError) => {
        if ((fetchError as Error).name === "AbortError") return;
        setError(fetchError instanceof Error ? fetchError.message : "Erro ao carregar a analise");
        setResolvedRequestKey(requestKey);
      });

    return () => controller.abort();
  }, [companyKey, requestKey, range.endDate, range.startDate, selectedModel, selectedTarget]);

  const activePresets = data?.presets ?? localPresets;
  const activeStores = data?.stores ?? localStores.map((store) => ({
    value: store.value,
    label: store.label,
  }));

  const filteredItems = useMemo(() => {
    if (!data) return [];

    return data.itemRows.filter((item) => {
      if (showOnlyGap && item.status === "ok") return false;
      if (statusFilter !== "todos" && item.status !== statusFilter) return false;
      return true;
    });
  }, [data, showOnlyGap, statusFilter]);

  const essentialCurveA = useMemo(() => {
    if (!data) return [];

    return [...data.itemRows]
      .filter((item) => item.itemCurva === "A")
      .sort((a, b) => {
        if (b.shortageQty !== a.shortageQty) return b.shortageQty - a.shortageQty;
        return b.vendasPeriodo - a.vendasPeriodo;
      })
      .slice(0, 20);
  }, [data]);

  const revenueByCategory = useMemo(() => {
    if (!data) return [];

    return [...data.categoryRows]
      .filter((row) => row.avgMonthlyDemandUnits > 0 || row.currentStock > 0)
      .sort((a, b) => b.projectedRevenueWithCurrentStock - a.projectedRevenueWithCurrentStock);
  }, [data]);

  const hasGrade = useMemo(
    () => Boolean(data?.itemRows.some((item) => item.grade && item.grade.trim())),
    [data]
  );

  return (
    <div className={styles.page}>
      <section className={styles.controlPanel}>
        <div className={styles.compactHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Nova Filial</span>
            <h1 className={styles.pageTitle}>Planejamento de estoque ideal</h1>
            <p className={styles.cardText}>
              Compare uma loja referencia com a nova operacao e veja o estoque ideal, o gap e o
              potencial de venda com o que ja existe hoje.
            </p>
          </div>
          <div className={styles.legendInline}>
            <span className={styles.legendTitle}>Curva ABC</span>
            {(["A", "B", "C"] as Curva[]).map((curva) => (
              <div key={curva} className={styles.legendRow}>
                <span className={`${styles.curveBadge} ${getCurveTone(curva)}`}>{curva}</span>
                <span>{(data?.abcLabels ?? CURVA_LABELS)[curva]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Comparacao</h2>
            <p className={styles.cardText}>
              Escolha a loja modelo e a loja nova. Os cenarios abaixo so aceleram a selecao.
            </p>
          </div>
        </div>

        <div className={styles.presetGrid}>
          {activePresets.map((preset) => {
            const isActive = preset.model === selectedModel && preset.target === selectedTarget;
            return (
              <button
                key={preset.id}
                type="button"
                className={`${styles.presetButton} ${isActive ? styles.presetButtonActive : ""}`}
                onClick={() => {
                  setSelectedModel(preset.model);
                  setSelectedTarget(preset.target);
                }}
              >
                <strong>{preset.label}</strong>
                <span>{preset.description}</span>
              </button>
            );
          })}
        </div>

        <div className={styles.filtersRow}>
          <div className={styles.filterBlockWide}>
            <DateRangeFilter value={range} onChange={setRange} label="Periodo analisado" />
          </div>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Loja 1 - Modelo</span>
            <select
              className={styles.select}
              value={selectedModel}
              onChange={(event) => setSelectedModel(event.target.value)}
            >
              {activeStores.map((store) => (
                <option key={store.value} value={store.value}>
                  {store.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Loja 2 - Comparada</span>
            <select
              className={styles.select}
              value={selectedTarget}
              onChange={(event) => setSelectedTarget(event.target.value)}
            >
              {activeStores.map((store) => (
                <option key={store.value} value={store.value}>
                  {store.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {loading ? (
        <section className={styles.loadingCard}>Carregando projecao da nova filial...</section>
      ) : error ? (
        <section className={styles.errorCard}>{error}</section>
      ) : data ? (
        <>
          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Resumo executivo</h2>
                <p className={styles.cardText}>
                  O numero mais importante aqui e o estoque ideal para a nova loja performar de
                  forma parecida com a referencia.
                </p>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.summaryTable}`}>
                <thead>
                  <tr>
                    <th>Nova loja</th>
                    <th>Referencia</th>
                    <th>Empresa</th>
                    <th className={styles.numeric}>Fat. meta mensal</th>
                    <th className={styles.numeric}>Qtd meta</th>
                    <th className={styles.numeric}>Est. ideal</th>
                    <th className={styles.numeric}>Est. util atual</th>
                    <th className={styles.numeric}>Cobertura</th>
                    <th className={styles.numeric}>Rev. est. mes 1</th>
                    <th className={styles.numeric}>Delta receita</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{data.targetStore.label}</td>
                    <td>{data.modelStore.label}</td>
                    <td>{companyName}</td>
                    <td className={styles.numeric}>{fmtBRL(data.summary.demandRevenueMonthly)}</td>
                    <td className={styles.numeric}>{fmtQty(data.summary.demandUnitsMonthly)}</td>
                    <td className={styles.numeric}>{fmtInt(data.summary.mixTargetUnitsMonthly)}</td>
                    <td className={styles.numeric}>{fmtInt(data.summary.usefulMixStockUnits)}</td>
                    <td className={styles.numeric}>{fmtPct(data.summary.mixCoveragePct)}</td>
                    <td className={styles.numeric}>
                      {fmtBRL(data.summary.projectedRevenueWithCurrentStock)}
                    </td>
                    <td
                      className={`${styles.numeric} ${
                        data.summary.revenueCoveragePct >= 100
                          ? styles.deltaPositive
                          : styles.deltaNegative
                      }`}
                    >
                      {fmtDeltaPct(data.summary.revenueCoveragePct)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className={styles.summaryHighlights}>
              <article className={styles.highlightCard}>
                <span className={styles.metricLabel}>Estoque ideal</span>
                <strong className={styles.highlightValue}>
                  {fmtInt(data.summary.mixTargetUnitsMonthly)} pecas
                </strong>
                <span className={styles.highlightMeta}>
                  {fmtInt(data.summary.activeItems)} itens ativos e profundidade media de{" "}
                  {data.summary.depthPerItem.toFixed(1)} pecas por item.
                </span>
              </article>

              <article className={styles.highlightCard}>
                <span className={styles.metricLabel}>Estoque util atual</span>
                <strong className={styles.highlightValue}>
                  {fmtInt(data.summary.usefulMixStockUnits)} pecas
                </strong>
                <span className={styles.highlightMeta}>
                  {fmtInt(data.summary.currentStockUnits)} pecas no total, sendo{" "}
                  {fmtInt(data.summary.excessUnits)} fora do mix ideal.
                </span>
              </article>

              <article className={styles.highlightCard}>
                <span className={styles.metricLabel}>Gap de pecas</span>
                <strong className={styles.highlightValue}>
                  {data.summary.shortageUnits > 0
                    ? `${fmtInt(data.summary.shortageUnits)} faltando`
                    : "Estoque suficiente"}
                </strong>
                <span className={styles.highlightMeta}>
                  Cobertura atual de {fmtPct(data.summary.mixCoveragePct)} do estoque ideal.
                </span>
              </article>

              <article className={styles.highlightCard}>
                <span className={styles.metricLabel}>Receita estimada mes 1</span>
                <strong className={styles.highlightValue}>
                  {fmtBRL(data.summary.projectedRevenueWithCurrentStock)}
                </strong>
                <span className={styles.highlightMeta}>
                  {fmtPct(data.summary.revenueCoveragePct)} da meta mensal de venda.
                </span>
              </article>
            </div>

            <div className={styles.summaryMeta}>
              <span>
                <strong>{data.modelStore.label}</strong>
                {" -> "}
                <strong>{data.targetStore.label}</strong>
              </span>
              <span>
                Periodo: {data.range.start} ate {data.range.end} ({data.range.monthsCount} meses)
              </span>
              <span>
                Curva A critica: {fmtInt(data.summary.curveAItems)} itens com gap de{" "}
                {fmtInt(data.summary.curveAShortageUnits)} pecas
              </span>
            </div>
          </section>

          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Categorias - Curva ABC e gap de estoque</h2>
                <p className={styles.cardText}>
                  O ideal e usar esta tabela para decidir compra. Ela mostra quanto cada categoria
                  precisa ter, quanto ja existe e se a leitura principal e falta ou excesso.
                </p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Curva</th>
                    <th>Categoria</th>
                    <th className={styles.numeric}>Part.</th>
                    <th className={styles.numeric}>Fat./mes</th>
                    <th className={styles.numeric}>Qtd/mes</th>
                    <th className={styles.numeric}>Est. ideal</th>
                    <th className={styles.numeric}>Estoque atual</th>
                    <th className={styles.numeric}>Gap</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categoryRows.map((row) => {
                    const status = getCategoryStatus(row);

                    return (
                      <tr key={row.categoria}>
                        <td>
                          <span className={`${styles.curveBadge} ${getCurveTone(row.categoriaCurva)}`}>
                            {row.categoriaCurva ?? "-"}
                          </span>
                        </td>
                        <td>{row.categoria}</td>
                        <td className={styles.numeric}>{fmtPct(row.categoriaParticipacao)}</td>
                        <td className={styles.numeric}>{fmtBRL(row.avgMonthlySales)}</td>
                        <td className={styles.numeric}>{fmtQty(row.avgMonthlyDemandUnits)}</td>
                        <td className={styles.numeric}>{fmtInt(row.mixTargetQty)}</td>
                        <td className={styles.numeric}>{fmtInt(row.currentStock)}</td>
                        <td
                          className={`${styles.numeric} ${
                            row.shortageQty > 0
                              ? styles.missingCell
                              : row.excessQty > 0
                                ? styles.excessCell
                                : ""
                          }`}
                        >
                          {row.shortageQty > 0
                            ? fmtSignedInt(row.shortageQty)
                            : row.excessQty > 0
                              ? fmtSignedInt(-row.excessQty)
                              : "0"}
                        </td>
                        <td>
                          <span className={`${styles.statusBadge} ${getStatusTone(status)}`}>
                            {getStatusLabel(status)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Receita estimada com o estoque atual</h2>
                <p className={styles.cardText}>
                  Projecao do que a loja tende a vender no primeiro mes mantendo o estoque de hoje.
                </p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th className={styles.numeric}>Est. atual</th>
                    <th className={styles.numeric}>Vel. ref./mes</th>
                    <th className={styles.numeric}>Vendas est.</th>
                    <th className={styles.numeric}>RPP</th>
                    <th className={styles.numeric}>Receita est.</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueByCategory.map((row) => {
                    const avgPrice =
                      row.avgMonthlyDemandUnits > 0
                        ? row.avgMonthlySales / row.avgMonthlyDemandUnits
                        : 0;

                    return (
                      <tr key={`rev-${row.categoria}`}>
                        <td>{row.categoria}</td>
                        <td className={styles.numeric}>{fmtInt(row.currentStock)}</td>
                        <td className={styles.numeric}>{fmtQty(row.avgMonthlyDemandUnits)}</td>
                        <td className={styles.numeric}>{fmtQty(row.coveredDemandUnits)}</td>
                        <td className={styles.numeric}>{fmtBRL(avgPrice)}</td>
                        <td className={styles.numeric}>
                          {fmtBRL(row.projectedRevenueWithCurrentStock)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Top Curva A que nao pode faltar</h2>
                <p className={styles.cardText}>
                  Itens mais sensiveis da Curva A, em ordem de performance da loja modelo.
                </p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Cor</th>
                    {hasGrade ? <th>Grade</th> : null}
                    <th>Categoria</th>
                    <th className={styles.numeric}>Fat./mes</th>
                    <th className={styles.numeric}>Qtd/mes</th>
                    <th className={styles.numeric}>Prof. ideal</th>
                    <th className={styles.numeric}>Estoque atual</th>
                    <th className={styles.numeric}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {essentialCurveA.map((item) => (
                    <tr key={`curve-a-${item.key}`}>
                      <td>
                        <div className={styles.productCell}>
                          <strong>{item.descricao || item.produto}</strong>
                          <span>{item.produto}</span>
                        </div>
                      </td>
                      <td>{item.corDescricao || item.cor || "Sem cor"}</td>
                      {hasGrade ? <td>{item.grade || "-"}</td> : null}
                      <td>
                        <div className={styles.categoryCell}>
                          <span>{item.categoria}</span>
                          <span className={`${styles.curveBadge} ${getCurveTone(item.categoriaCurva)}`}>
                            {item.categoriaCurva ?? "-"}
                          </span>
                        </div>
                      </td>
                      <td className={styles.numeric}>{fmtBRL(item.avgMonthlySales)}</td>
                      <td className={styles.numeric}>{fmtQty(item.avgMonthlyDemandUnits)}</td>
                      <td className={styles.numeric}>{fmtInt(item.mixTargetQty)}</td>
                      <td className={styles.numeric}>{fmtInt(item.currentStock)}</td>
                      <td
                        className={`${styles.numeric} ${
                          item.gapQty < 0 ? styles.missingCell : styles.excessCell
                        }`}
                      >
                        {item.gapQty > 0 ? `+${fmtInt(item.gapQty)}` : fmtInt(item.gapQty)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Detalhe do gap por item</h2>
                <p className={styles.cardText}>
                  Aqui entra o detalhe completo do que falta ou sobra em relacao ao mix ideal.
                </p>
              </div>
              <div className={styles.toolbar}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${
                    statusFilter === "todos" ? styles.toolbarButtonActive : ""
                  }`}
                  onClick={() => setStatusFilter("todos")}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${
                    statusFilter === "faltando" ? styles.toolbarButtonActive : ""
                  }`}
                  onClick={() => setStatusFilter("faltando")}
                >
                  So faltas
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${
                    statusFilter === "excesso" ? styles.toolbarButtonActive : ""
                  }`}
                  onClick={() => setStatusFilter("excesso")}
                >
                  So excessos
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${showOnlyGap ? styles.toolbarButtonActive : ""}`}
                  onClick={() => setShowOnlyGap((current) => !current)}
                >
                  {showOnlyGap ? "Mostrando so gaps" : "Mostrar so gaps"}
                </button>
              </div>
            </div>

            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Status</th>
                    <th>Curva item</th>
                    <th>Curva cat.</th>
                    <th>Produto</th>
                    <th>Cor</th>
                    {hasGrade ? <th>Grade</th> : null}
                    <th>Categoria</th>
                    <th className={styles.numeric}>Fat./mes</th>
                    <th className={styles.numeric}>Qtd/mes</th>
                    <th className={styles.numeric}>Prof. ideal</th>
                    <th className={styles.numeric}>Estoque atual</th>
                    <th className={styles.numeric}>Gap</th>
                    <th className={styles.numeric}>Receita est.</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => (
                    <tr key={item.key}>
                      <td>
                        <span className={`${styles.statusBadge} ${getStatusTone(item.status)}`}>
                          {getStatusLabel(item.status)}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.curveBadge} ${getCurveTone(item.itemCurva)}`}>
                          {item.itemCurva ?? "-"}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.curveBadge} ${getCurveTone(item.categoriaCurva)}`}>
                          {item.categoriaCurva ?? "-"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.productCell}>
                          <strong>{item.descricao || item.produto}</strong>
                          <span>{item.produto}</span>
                        </div>
                      </td>
                      <td>{item.corDescricao || item.cor || "Sem cor"}</td>
                      {hasGrade ? <td>{item.grade || "-"}</td> : null}
                      <td>{item.categoria}</td>
                      <td className={styles.numeric}>{fmtBRL(item.avgMonthlySales)}</td>
                      <td className={styles.numeric}>{fmtQty(item.avgMonthlyDemandUnits)}</td>
                      <td className={styles.numeric}>{fmtInt(item.mixTargetQty)}</td>
                      <td className={styles.numeric}>{fmtInt(item.currentStock)}</td>
                      <td
                        className={`${styles.numeric} ${
                          item.gapQty < 0
                            ? styles.missingCell
                            : item.gapQty > 0
                              ? styles.excessCell
                              : ""
                        }`}
                      >
                        {item.gapQty > 0 ? `+${fmtInt(item.gapQty)}` : fmtInt(item.gapQty)}
                      </td>
                      <td className={styles.numeric}>{fmtBRL(item.projectedRevenueWithCurrentStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

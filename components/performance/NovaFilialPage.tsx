"use client";

import { startOfMonth, subMonths } from "date-fns";
import { useEffect, useMemo, useState } from "react";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import type { CompanyKey } from "@/lib/config/company";
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

export default function NovaFilialPage({ companyKey }: Props) {
  const localStores = useMemo(() => getComparableFilialOptions(companyKey), [companyKey]);
  const localPresets = useMemo(() => getNovaFilialPresets(companyKey), [companyKey]);
  const defaultPreset = useMemo(() => getDefaultNovaFilialPreset(companyKey), [companyKey]);

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

  const hasGrade = useMemo(
    () => Boolean(data?.itemRows.some((item) => item.grade && item.grade.trim())),
    [data]
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroTopline}>Planejamento de sortimento para novas operacoes</div>
        <div className={styles.heroHeader}>
          <div>
            <h1 className={styles.title}>Nova Filial</h1>
            <p className={styles.subtitle}>
              Esta visao projeta o potencial mensal da loja nova com base na loja modelo,
              reaproveitando a mesma logica de Curva ABC da pagina atual e comparando isso
              com o estoque que ja existe na filial de destino.
            </p>
          </div>
          <div className={styles.legendCard}>
            <div className={styles.legendTitle}>Mesma logica da Curva ABC</div>
            {(["A", "B", "C"] as Curva[]).map((curva) => (
              <div key={curva} className={styles.legendRow}>
                <span className={`${styles.curveBadge} ${getCurveTone(curva)}`}>{curva}</span>
                <span>{(data?.abcLabels ?? CURVA_LABELS)[curva]}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.controlPanel}>
        <div className={styles.cardHeader}>
          <div>
            <h2 className={styles.cardTitle}>Comparacao customizavel</h2>
            <p className={styles.cardText}>
              Escolha a loja modelo e a loja comparada. Os cenarios padrao abaixo
              so aceleram o preenchimento.
            </p>
          </div>
        </div>

        <div className={styles.presetGrid}>
          {activePresets.map((preset) => {
            const isActive =
              preset.model === selectedModel && preset.target === selectedTarget;
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
          <section className={styles.relationshipStrip}>
            <div>
              <span className={styles.relationshipLabel}>Loja modelo</span>
              <strong>{data.modelStore.label}</strong>
            </div>
            <div className={styles.relationshipArrow}>→</div>
            <div>
              <span className={styles.relationshipLabel}>Loja comparada</span>
              <strong>{data.targetStore.label}</strong>
            </div>
            <div className={styles.relationshipMeta}>
              {data.range.monthsCount} meses analisados: {data.range.start} ate {data.range.end}
            </div>
          </section>

          <section className={styles.summaryGrid}>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Venda mensal projetada</span>
              <strong className={styles.metricValue}>{fmtBRL(data.summary.demandRevenueMonthly)}</strong>
              <span className={styles.metricSubtext}>
                Media mensal da loja modelo no periodo.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Demanda mensal em pecas</span>
              <strong className={styles.metricValue}>{fmtQty(data.summary.demandUnitsMonthly)}</strong>
              <span className={styles.metricSubtext}>
                Media real de pecas vendidas por mes na loja modelo.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Mix minimo sugerido</span>
              <strong className={styles.metricValue}>{fmtInt(data.summary.mixTargetUnitsMonthly)}</strong>
              <span className={styles.metricSubtext}>
                {fmtInt(data.summary.activeItems)} itens ativos e profundidade media de{" "}
                {data.summary.depthPerItem.toFixed(1)} pecas por item.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Cobertura do mix</span>
              <strong className={styles.metricValue}>{fmtPct(data.summary.mixCoveragePct)}</strong>
              <span className={styles.metricSubtext}>
                {fmtInt(data.summary.usefulMixStockUnits)} pecas uteis no mix sugerido.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Gap de mix</span>
              <strong className={styles.metricValue}>
                {data.summary.isStockEnough ? "Estoque suficiente" : `${fmtInt(data.summary.shortageUnits)} faltando`}
              </strong>
              <span className={styles.metricSubtext}>
                Excesso atual de {fmtInt(data.summary.excessUnits)} pecas.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Venda provavel com estoque atual</span>
              <strong className={styles.metricValue}>
                {fmtBRL(data.summary.projectedRevenueWithCurrentStock)}
              </strong>
              <span className={styles.metricSubtext}>
                {fmtPct(data.summary.revenueCoveragePct)} do potencial de venda mensal.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Cobertura da demanda</span>
              <strong className={styles.metricValue}>{fmtPct(data.summary.demandCoveragePct)}</strong>
              <span className={styles.metricSubtext}>
                {fmtQty(data.summary.usefulDemandStockUnits)} pecas da demanda media ja estao cobertas.
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Curva A que nao pode faltar</span>
              <strong className={styles.metricValue}>{fmtInt(data.summary.curveAItems)} itens</strong>
              <span className={styles.metricSubtext}>
                Gap de {fmtInt(data.summary.curveAShortageUnits)} pecas na Curva A.
              </span>
            </article>
          </section>

          <section className={styles.explainerStrip}>
            <div className={styles.explainerCard}>
              <span className={styles.explainerLabel}>Demanda mensal</span>
              <strong>{fmtQty(data.summary.demandUnitsMonthly)} pecas</strong>
              <p>Quanto a loja modelo realmente vende, em media, por mes.</p>
            </div>
            <div className={styles.explainerCard}>
              <span className={styles.explainerLabel}>Mix minimo sugerido</span>
              <strong>{fmtInt(data.summary.mixTargetUnitsMonthly)} pecas</strong>
              <p>Sortimento minimo por SKU para a nova loja nao perder cobertura de mix.</p>
            </div>
            <div className={styles.explainerCard}>
              <span className={styles.explainerLabel}>Leitura do gap</span>
              <strong>{fmtInt(data.summary.shortageUnits)} faltando</strong>
              <p>Falta mostra o que precisa entrar. Excesso mostra o que sobra fora do mix ideal.</p>
            </div>
          </section>

          <section className={styles.dualCardGrid}>
            <article className={styles.panelCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>Base da projecao</h2>
                  <p className={styles.cardText}>
                    Tudo abaixo parte da performance real da loja modelo no periodo selecionado.
                  </p>
                </div>
              </div>
              <div className={styles.inlineMetrics}>
                <div>
                  <span>Venda no periodo</span>
                  <strong>{fmtBRL(data.modelSummary.vendasPeriodo)}</strong>
                </div>
                <div>
                  <span>Pecas vendidas</span>
                  <strong>{fmtInt(data.modelSummary.qtdePeriodo)}</strong>
                </div>
                <div>
                  <span>Media mensal</span>
                  <strong>{fmtBRL(data.modelSummary.avgMonthlySales)}</strong>
                </div>
                <div>
                  <span>Demanda media mensal</span>
                  <strong>{fmtQty(data.modelSummary.avgMonthlyUnits)}</strong>
                </div>
                <div>
                  <span>Mix minimo sugerido</span>
                  <strong>{fmtInt(data.modelSummary.mixTargetUnitsMonthly)}</strong>
                </div>
              </div>
            </article>

            <article className={styles.panelCard}>
              <div className={styles.cardHeader}>
                <div>
                  <h2 className={styles.cardTitle}>O que responder rapido</h2>
                  <p className={styles.cardText}>
                    Esta filial tende a vender {fmtQty(data.summary.demandUnitsMonthly)} pecas por mes
                    e precisa operar com um mix minimo sugerido de {fmtInt(data.summary.mixTargetUnitsMonthly)} pecas
                    para buscar uma performance similar.
                  </p>
                </div>
              </div>
              <ul className={styles.answerList}>
                <li>
                  Estoque atual {data.summary.isStockEnough ? "suficiente" : "insuficiente"} para o mix sugerido.
                </li>
                <li>
                  Faltam {fmtInt(data.summary.shortageUnits)} pecas e ha excesso de{" "}
                  {fmtInt(data.summary.excessUnits)} pecas.
                </li>
                <li>
                  O estoque atual tende a suportar cerca de{" "}
                  {fmtBRL(data.summary.projectedRevenueWithCurrentStock)} em vendas mensais.
                </li>
                <li>
                  {fmtInt(data.summary.activeCategories)} categorias e {fmtInt(data.summary.activeItems)} itens
                  entram no sortimento ideal.
                </li>
              </ul>
            </article>
          </section>

          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>Categorias por prioridade</h2>
                <p className={styles.cardText}>
                  Curva da categoria, demanda media, mix sugerido, gap atual e quanto o estoque
                  atual consegue sustentar em venda.
                </p>
              </div>
            </div>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Curva</th>
                    <th className={styles.numeric}>Part.</th>
                    <th className={styles.numeric}>Venda media</th>
                    <th className={styles.numeric}>Demanda mes</th>
                    <th className={styles.numeric}>Mix sugerido</th>
                    <th className={styles.numeric}>Estoque atual</th>
                    <th className={styles.numeric}>Gap falta</th>
                    <th className={styles.numeric}>Excesso</th>
                    <th className={styles.numeric}>Cobertura mix</th>
                  </tr>
                </thead>
                <tbody>
                  {data.categoryRows.map((row) => (
                    <tr key={row.categoria}>
                      <td>{row.categoria}</td>
                      <td>
                        <span className={`${styles.curveBadge} ${getCurveTone(row.categoriaCurva)}`}>
                          {row.categoriaCurva ?? "—"}
                        </span>
                      </td>
                      <td className={styles.numeric}>{fmtPct(row.categoriaParticipacao)}</td>
                      <td className={styles.numeric}>{fmtBRL(row.avgMonthlySales)}</td>
                      <td className={styles.numeric}>{fmtQty(row.avgMonthlyDemandUnits)}</td>
                      <td className={styles.numeric}>{fmtInt(row.mixTargetQty)}</td>
                      <td className={styles.numeric}>{fmtInt(row.currentStock)}</td>
                      <td className={`${styles.numeric} ${styles.missingCell}`}>{fmtInt(row.shortageQty)}</td>
                      <td className={`${styles.numeric} ${styles.excessCell}`}>{fmtInt(row.excessQty)}</td>
                      <td className={styles.numeric}>{fmtPct(row.mixCoveragePct)}</td>
                    </tr>
                  ))}
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
                    <th className={styles.numeric}>Venda media</th>
                    <th className={styles.numeric}>Demanda mes</th>
                    <th className={styles.numeric}>Mix sugerido</th>
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
                      {hasGrade ? <td>{item.grade || "—"}</td> : null}
                      <td>
                        <div className={styles.categoryCell}>
                          <span>{item.categoria}</span>
                          <span className={`${styles.curveBadge} ${getCurveTone(item.categoriaCurva)}`}>
                            {item.categoriaCurva ?? "—"}
                          </span>
                        </div>
                      </td>
                      <td className={styles.numeric}>{fmtBRL(item.avgMonthlySales)}</td>
                      <td className={styles.numeric}>{fmtQty(item.avgMonthlyDemandUnits)}</td>
                      <td className={styles.numeric}>{fmtInt(item.mixTargetQty)}</td>
                      <td className={styles.numeric}>{fmtInt(item.currentStock)}</td>
                      <td className={`${styles.numeric} ${item.gapQty < 0 ? styles.missingCell : styles.excessCell}`}>
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
                  A tabela abaixo mostra tudo o que esta faltando ou em excesso em relacao ao mix
                  sugerido da loja modelo. Itens sem gap podem ficar ocultos por padrao.
                </p>
              </div>
              <div className={styles.toolbar}>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${statusFilter === "todos" ? styles.toolbarButtonActive : ""}`}
                  onClick={() => setStatusFilter("todos")}
                >
                  Todos
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${statusFilter === "faltando" ? styles.toolbarButtonActive : ""}`}
                  onClick={() => setStatusFilter("faltando")}
                >
                  So faltas
                </button>
                <button
                  type="button"
                  className={`${styles.toolbarButton} ${statusFilter === "excesso" ? styles.toolbarButtonActive : ""}`}
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
                    <th className={styles.numeric}>Venda media</th>
                    <th className={styles.numeric}>Demanda mes</th>
                    <th className={styles.numeric}>Mix sugerido</th>
                    <th className={styles.numeric}>Estoque atual</th>
                    <th className={styles.numeric}>Gap</th>
                    <th className={styles.numeric}>Venda provavel</th>
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
                          {item.itemCurva ?? "—"}
                        </span>
                      </td>
                      <td>
                        <span className={`${styles.curveBadge} ${getCurveTone(item.categoriaCurva)}`}>
                          {item.categoriaCurva ?? "—"}
                        </span>
                      </td>
                      <td>
                        <div className={styles.productCell}>
                          <strong>{item.descricao || item.produto}</strong>
                          <span>{item.produto}</span>
                        </div>
                      </td>
                      <td>{item.corDescricao || item.cor || "Sem cor"}</td>
                      {hasGrade ? <td>{item.grade || "—"}</td> : null}
                      <td>{item.categoria}</td>
                      <td className={styles.numeric}>{fmtBRL(item.avgMonthlySales)}</td>
                      <td className={styles.numeric}>{fmtQty(item.avgMonthlyDemandUnits)}</td>
                      <td className={styles.numeric}>{fmtInt(item.mixTargetQty)}</td>
                      <td className={styles.numeric}>{fmtInt(item.currentStock)}</td>
                      <td className={`${styles.numeric} ${item.gapQty < 0 ? styles.missingCell : item.gapQty > 0 ? styles.excessCell : ""}`}>
                        {item.gapQty > 0 ? `+${fmtInt(item.gapQty)}` : fmtInt(item.gapQty)}
                      </td>
                      <td className={styles.numeric}>{fmtBRL(item.projectedRevenueWithCurrentStock)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className={styles.panelCard}>
            <div className={styles.cardHeader}>
              <div>
                <h2 className={styles.cardTitle}>De onde vem esta leitura</h2>
                <p className={styles.cardText}>
                  Referencia de dados usada para manter a consistencia com a pagina Curva ABC.
                </p>
              </div>
            </div>
            <ul className={styles.answerList}>
              {data.sourceInfo.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        </>
      ) : null}
    </div>
  );
}

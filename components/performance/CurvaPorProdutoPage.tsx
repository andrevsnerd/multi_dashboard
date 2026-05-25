"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { endOfMonth, startOfMonth } from "date-fns";

import DateRangeFilter, { type DateRangeValue } from "@/components/filters/DateRangeFilter";
import FilialFilter from "@/components/filters/FilialFilter";
import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import {
  buildCompraTransitoIndex,
  fetchComprasTransitoClient,
  getCompraTransitoEntries,
  type CompraTransitoIndex,
} from "@/lib/client/compras-transito";
import { fetchControleEstoqueMetricasItensClient } from "@/lib/client/controle-estoque-metricas";
import {
  buildCurvaPorProdutoKey,
  type CurvaPorProdutoApiResponse,
  type CurvaPorProdutoClassificacao,
  type CurvaPorProdutoSelectedItem,
} from "@/lib/performance/curvaPorProduto";
import { applyTransitToSuggestion } from "@/lib/utils/compra-transito-analytics";
import { formatDateForQuery } from "@/lib/utils/date";
import {
  calcNecessidadeMinimaQty,
  calcTotalPerFilialFiliais,
  combineBaseSuggestionWithNecessidadeMinima,
  formatNecessidadeMinimaFiliaisDescription,
  type FilialNecessidadeMinimaInfo,
  getCombinedNecessidadeMinimaTooltip,
  getNecessidadeMinimaRuleDescription,
  getSuggestionPrincipalBadgeLabel,
} from "@/lib/utils/necessidade-minima";
import {
  getReposicaoBaseType as getSharedReposicaoBaseType,
  getReposicaoCompraView as getSharedReposicaoCompraView,
} from "@/lib/utils/suggestion-rules";
import { exportCurvaPorProdutoCsv } from "@/lib/utils/exportCurvaPorProdutoCsv";
import { exportCurvaPorProdutoXlsx } from "@/lib/utils/exportCurvaPorProdutoXlsx";

import CurvaPorProdutoPickerModal from "./CurvaPorProdutoPickerModal";
import styles from "./CurvaPorProdutoPage.module.css";

type ComparisonMode = "month" | "year";

type MetricasRow = {
  qtde12m: number | null;
  vendasMesAtual: number | null;
  estoqueFilial: number | null;
  diasDesdeUltimaVenda: number | null;
  mesesHistoricoFilial: number | null;
  diasComEstoquePositivo: number | null;
  diasSemEstoque: number | null;
  mesesDisponiveis: number | null;
  velocidadeAjustada: number | null;
  totalNmQty: number | null;
  filiaisNM: FilialNecessidadeMinimaInfo[] | null;
};

const EMPTY_METRICAS_ROW: MetricasRow = {
  qtde12m: null,
  vendasMesAtual: null,
  estoqueFilial: null,
  diasDesdeUltimaVenda: null,
  mesesHistoricoFilial: null,
  diasComEstoquePositivo: null,
  diasSemEstoque: null,
  mesesDisponiveis: null,
  velocidadeAjustada: null,
  totalNmQty: null,
  filiaisNM: null,
};

type SuggestionType = "COMPRA" | "S" | "E" | "PO" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO";

type SuggestionView = {
  text: string;
  tone: "buy" | "s" | "e" | "ok" | "muted";
  summaryText?: string;
  qty?: number;
  baseType?: SuggestionType;
  nmExtraQty?: number;
  combinedWithNm?: boolean;
  title?: string;
  nmFiliais?: FilialNecessidadeMinimaInfo[];
  ruleTooltip?: {
    title: string;
    lines: string[];
  };
};

type DisplayRow = CurvaPorProdutoApiResponse["rows"][number] & {
  estoque: number;
  suggestion: SuggestionView;
};

const METRICAS_CHUNK_SIZE = 40;

interface Props {
  companyKey: CompanyKey;
  month: number;
  year: number;
  compare: ComparisonMode;
}

function fmt(n: number | null | undefined) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "0";
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
}

function fmtCurrency(n: number | null | undefined) {
  const value = Number(n ?? 0);
  if (!Number.isFinite(value)) return "R$ 0";
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function formatSignedPct(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function getComparisonBadge(
  current: number,
  previous: number
): { kind: "pct"; value: number } | { kind: "new" } | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous > 0) return { kind: "pct", value: ((current - previous) / previous) * 100 };
  if (current > 0 && previous <= 0) return { kind: "new" };
  return null;
}

function getInitialRange(month: number, year: number): DateRangeValue {
  const base = new Date(year, month, 1);
  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() === month;
  return {
    startDate: startOfMonth(base),
    endDate: isCurrentMonth ? today : endOfMonth(base),
  };
}

function normalizeKey(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toUpperCase();
}

function getMesesHistoricoFilial(item: { mesesHistoricoFilial?: number | null }): number {
  const meses = Number(item.mesesHistoricoFilial ?? 12);
  if (!Number.isFinite(meses)) return 12;
  return Math.min(12, Math.max(1, meses));
}

function getLimiteDiasReposicao(item: { linha?: string | null; subgrupo?: string | null }) {
  const linha = normalizeKey(item.linha);
  const subgrupo = normalizeKey(item.subgrupo);
  if (linha === "INDIA") return 90;
  if (linha === "ELETRONICOS") return 30;
  if (new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]).has(subgrupo)) return 90;
  return 60;
}

function getSuggestedDelta(
  item: { vendasMesAtual?: number | null; estoqueFilial?: number | null; linha?: string | null; subgrupo?: string | null },
  diasCorridosMes: number
): number | null {
  const vendasMes = Number(item.vendasMesAtual ?? 0);
  if (vendasMes <= 0 || diasCorridosMes <= 0) return 0;
  const consumoDiario = vendasMes / diasCorridosMes;
  if (consumoDiario <= 0) return 0;
  const estoqueAtual = Number(item.estoqueFilial ?? 0);
  const limiteDias = getLimiteDiasReposicao(item);
  const duracaoAtual = estoqueAtual / consumoDiario;
  if (duracaoAtual >= limiteDias) return 0;
  const qtd = Math.ceil(consumoDiario * (limiteDias - duracaoAtual));
  return Number.isFinite(qtd) ? Math.max(0, qtd) : 0;
}

function calcQtdSugestaoS(item: {
  qtde12m?: number | null;
  mesesHistoricoFilial?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
}): number {
  const mediaVendasMes = Number(item.qtde12m ?? 0) / getMesesHistoricoFilial(item);
  const limiteDias = getLimiteDiasReposicao(item);
  return Math.max(0, Math.ceil((limiteDias / 30) * mediaVendasMes));
}

function calcQtdSugestaoEInfo(item: {
  qtde12m?: number | null;
  diasDesdeUltimaVenda?: number | null;
  mesesHistoricoFilial?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
}) {
  const qtde12m = Number(item.qtde12m ?? 0);
  if (qtde12m <= 0) return null;
  const dias = item.diasDesdeUltimaVenda;
  if (dias == null || dias < 30) return null;
  const mesesBase = getMesesHistoricoFilial(item);
  const mesesSemVenda = dias / 30;
  const mesesAtivos = mesesBase - mesesSemVenda;
  if (mesesAtivos < 1) return null;
  const velocidadeAjustada = qtde12m / mesesAtivos;
  if (velocidadeAjustada < 0.5) return null;
  const limiteDias = getLimiteDiasReposicao(item);
  const qtd = Math.max(1, Math.ceil((limiteDias / 30) * velocidadeAjustada));
  return { qtd };
}

function getReposicaoCompraView(
  item: {
    vendasMesAtual?: number | null;
    estoqueFilial?: number | null;
    linha?: string | null;
    subgrupo?: string | null;
    qtde12m?: number | null;
    mesesHistoricoFilial?: number | null;
    diasDesdeUltimaVenda?: number | null;
    diasComEstoquePositivo?: number | null;
    diasSemEstoque?: number | null;
    mesesDisponiveis?: number | null;
    velocidadeAjustada?: number | null;
  },
  diasCorridosMes: number
) {
  const sugestao = getSharedReposicaoCompraView(
    {
      qtde12m: item.qtde12m,
      vendasMesAtual: item.vendasMesAtual,
      estoqueAtual: item.estoqueFilial,
      linha: item.linha,
      subgrupo: item.subgrupo,
      diasDesdeUltimaVenda: item.diasDesdeUltimaVenda,
      mesesHistoricoFilial: item.mesesHistoricoFilial,
      diasComEstoquePositivo: item.diasComEstoquePositivo,
      diasSemEstoque: item.diasSemEstoque,
      mesesDisponiveis: item.mesesDisponiveis,
      velocidadeAjustada: item.velocidadeAjustada,
    },
    diasCorridosMes
  );
  return {
    qtdFinal: sugestao.qtdFinal,
    qtdS: sugestao.qtdS,
    qtdE: sugestao.qtdE,
    qtdPO: sugestao.qtdPO,
    qtdNM: sugestao.qtdNM,
    qtdSuficiente: sugestao.qtdSuficiente,
    poData: sugestao.poData,
  };
}

function getReposicaoBaseType(sugestao: {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO?: number;
  qtdNM?: number;
  qtdSuficiente: boolean;
}): "COMPRA" | "S" | "E" | "PO" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO" {
  return getSharedReposicaoBaseType(sugestao);
}

function buildProductDetalhadoHref(
  companyKey: CompanyKey,
  row: Pick<DisplayRow, "produto" | "descricao" | "corProduto">
): string {
  const params = new URLSearchParams();
  params.set("productId", row.produto.trim());
  params.set("name", (row.descricao || row.produto).trim());
  const color = (row.corProduto ?? "").trim();
  if (color) params.set("colors", color);
  return `/${companyKey}/produto-detalhado?${params.toString()}`;
}

function buildCurveBadgeLabel(curva: CurvaPorProdutoClassificacao | null): string {
  return curva ?? "—";
}

function buildProductInfoLine(row: Pick<DisplayRow, "subgrupo" | "tipoProduto" | "colecao" | "descColecao">) {
  const parts: string[] = [];
  const subgrupo = row.subgrupo?.trim();
  const tipoProduto = row.tipoProduto?.trim();
  const colecao = row.colecao?.trim();
  const descColecao = row.descColecao?.trim();

  if (subgrupo) parts.push(subgrupo);
  if (tipoProduto) parts.push(tipoProduto);

  const colecaoValue = [colecao, descColecao].filter(Boolean).join(" - ");
  if (colecaoValue) parts.push(colecaoValue);

  return parts.join(" | ");
}

function extractSuggestionNumber(value: string): number | "" {
  const match = value.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return "";
  const normalized = match[0].replace(".", "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : "";
}

function getTooltipViewportPosition(x: number, y: number): { left: number; top: number } {
  const offset = 12;
  const tooltipWidth = 340;
  const tooltipHeight = 220;
  const margin = 12;
  if (typeof window === "undefined") {
    return { left: x + offset, top: y + offset };
  }
  const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
  const maxTop = Math.max(margin, window.innerHeight - tooltipHeight - margin);
  const left = Math.min(Math.max(margin, x + offset), maxLeft);
  const topAbove = y - tooltipHeight - offset;
  const topBelow = y + offset;
  const top = topAbove >= margin
    ? topAbove
    : Math.min(Math.max(margin, topBelow), maxTop);
  return { left, top };
}

export default function CurvaPorProdutoPage({ companyKey, month, year, compare }: Props) {
  const [range, setRange] = useState<DateRangeValue>(() => getInitialRange(month, year));
  const [comparisonMode, setComparisonMode] = useState<ComparisonMode>(compare);
  const [selectedFilial, setSelectedFilial] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<CurvaPorProdutoSelectedItem[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CurvaPorProdutoApiResponse | null>(null);
  const [metricas, setMetricas] = useState<Record<string, MetricasRow>>({});
  const [comprasTransitoIndex, setComprasTransitoIndex] = useState<CompraTransitoIndex>(new Map());
  const [suggestionTooltip, setSuggestionTooltip] = useState<null | {
    x: number;
    y: number;
    title: string;
    lines: string[];
  }>(null);

  useEffect(() => {
    let cancelled = false;
    fetchComprasTransitoClient(companyKey)
      .then((docs) => {
        if (!cancelled) setComprasTransitoIndex(buildCompraTransitoIndex(docs));
      })
      .catch(() => {
        if (!cancelled) setComprasTransitoIndex(new Map());
      });
    return () => {
      cancelled = true;
    };
  }, [companyKey]);

  useEffect(() => {
    if (selectedItems.length === 0) return;

    let cancelled = false;

    void fetch("/api/curva-por-produto", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        company: companyKey,
        filial: selectedFilial,
        start: formatDateForQuery(range.startDate),
        end: formatDateForQuery(range.endDate),
        compare: comparisonMode,
        items: selectedItems,
      }),
    })
      .then(async (response) => {
        const json = (await response.json()) as CurvaPorProdutoApiResponse & { error?: string };
        if (!response.ok || json.error) {
          throw new Error(json.error || "Erro ao carregar dados");
        }
        if (!cancelled) setData(json);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Erro ao carregar dados");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [companyKey, comparisonMode, range.endDate, range.startDate, selectedFilial, selectedItems]);

  useEffect(() => {
    if (!data || data.rows.length === 0) return;

    let cancelled = false;

    const limiteDiasMap = new Map<string, number>();
    const prioritizedItems = data.rows
      .slice()
      .sort((a, b) => {
        if (a.represented !== b.represented) return a.represented ? -1 : 1;
        return b.vendas - a.vendas;
      })
      .map((row) => {
        limiteDiasMap.set(buildCurvaPorProdutoKey(row.produto, row.corProduto ?? null), getLimiteDiasReposicao(row));
        return {
          produto: row.produto,
          corProduto: row.corProduto ?? null,
        };
      });

    const loadInChunks = async () => {
      for (let start = 0; start < prioritizedItems.length; start += METRICAS_CHUNK_SIZE) {
        if (cancelled) return;

        const chunk = prioritizedItems.slice(start, start + METRICAS_CHUNK_SIZE);
        try {
          const rows = await fetchControleEstoqueMetricasItensClient({
            company: companyKey,
            filial: selectedFilial,
            includeHistorico: true,
            itens: chunk,
          });

          if (cancelled) return;

          setMetricas((prev) => {
            const next = { ...prev };
            chunk.forEach((item) => {
              next[buildCurvaPorProdutoKey(item.produto, item.corProduto ?? null)] = EMPTY_METRICAS_ROW;
            });
            Object.entries(rows).forEach(([key, value]) => {
              const filiaisNM = calcTotalPerFilialFiliais({
                company: resolveCompany(companyKey),
                vendasPorFilial: value.vendasPorFilial,
                estoquePorFilial: value.estoquePorFilial,
                limiteDias: limiteDiasMap.get(key) ?? 60,
              });
              next[key] = {
                qtde12m: value.resumo.qtde12m,
                vendasMesAtual: value.resumo.vendasMesAtual,
                estoqueFilial: value.resumo.estoqueTotal,
                diasDesdeUltimaVenda: value.resumo.diasDesdeUltimaVenda,
                mesesHistoricoFilial: value.resumo.mesesHistoricoFilial,
                diasComEstoquePositivo: value.resumo.diasComEstoquePositivo,
                diasSemEstoque: value.resumo.diasSemEstoque,
                mesesDisponiveis: value.resumo.mesesDisponiveis,
                velocidadeAjustada: value.resumo.velocidadeAjustada,
                totalNmQty: filiaisNM.reduce((sum, row) => sum + row.qtd, 0),
                filiaisNM,
              };
            });
            return next;
          });
        } catch {
          if (!cancelled && start === 0) setMetricas({});
        }
      }
    };

    void loadInChunks();

    return () => {
      cancelled = true;
    };
  }, [companyKey, data, selectedFilial]);

  const diasCorridosMes = Math.max(1, new Date().getDate());

  const displayRows = useMemo<DisplayRow[]>(() => {
    if (!data) return [];
    return data.rows.map((row) => {
      const key = buildCurvaPorProdutoKey(row.produto, row.corProduto ?? null);
      const currentMetric = metricas[key];
      const hasMetric = Object.prototype.hasOwnProperty.call(metricas, key);
      const semBaseMetric =
        currentMetric?.qtde12m == null &&
        currentMetric?.vendasMesAtual == null &&
        currentMetric?.estoqueFilial == null;
      const compraItem = {
        vendasMesAtual: currentMetric?.vendasMesAtual ?? 0,
        estoqueFilial: currentMetric?.estoqueFilial ?? 0,
        linha: row.linha ?? "",
        subgrupo: row.subgrupo ?? "",
        qtde12m: currentMetric?.qtde12m ?? 0,
        mesesHistoricoFilial: currentMetric?.mesesHistoricoFilial ?? 12,
        diasDesdeUltimaVenda: currentMetric?.diasDesdeUltimaVenda ?? null,
        diasComEstoquePositivo: currentMetric?.diasComEstoquePositivo ?? null,
        diasSemEstoque: currentMetric?.diasSemEstoque ?? null,
        mesesDisponiveis: currentMetric?.mesesDisponiveis ?? null,
        velocidadeAjustada: currentMetric?.velocidadeAjustada ?? null,
      };
      const sugestao = getReposicaoCompraView(compraItem, diasCorridosMes);
      const baseType = getReposicaoBaseType(sugestao);
      const baseQty =
        sugestao.qtdFinal > 0
          ? sugestao.qtdFinal
          : sugestao.qtdS > 0
            ? sugestao.qtdS
            : sugestao.qtdE > 0
              ? sugestao.qtdE
              : sugestao.qtdPO > 0
                ? sugestao.qtdPO
                : sugestao.qtdNM;
      const combined = combineBaseSuggestionWithNecessidadeMinima({
        baseType,
        baseQty,
        totalNmQty: currentMetric?.totalNmQty ?? sugestao.qtdNM,
      });
      const transit = applyTransitToSuggestion({
        baseType: combined.effectiveType,
        baseQty: combined.totalQty,
        entries: getCompraTransitoEntries(comprasTransitoIndex, row.produto, row.corProduto ?? null),
        estoqueAtual: compraItem.estoqueFilial,
        vendasMesAtual: compraItem.vendasMesAtual,
        diasCorridosMes,
        limiteDias: getLimiteDiasReposicao(compraItem),
      });

      let suggestion: SuggestionView = {
        text: !hasMetric ? "Carregando..." : semBaseMetric ? "Sem dados" : "Sem sugestao",
        tone: "muted",
      };
      suggestion = {
        text: suggestion.text,
        tone: suggestion.tone,
        summaryText: suggestion.text,
        qty: 0,
        baseType: combined.effectiveType,
        nmExtraQty: combined.nmExtraQty,
        combinedWithNm: combined.hasCombinedNm,
        nmFiliais: currentMetric?.filiaisNM ?? undefined,
      };
      if (!hasMetric || semBaseMetric) {
        // Mantem o status explicito ate a linha ter metricas consolidadas.
      } else if (transit.qty > 0) {
        const principalLabel = getSuggestionPrincipalBadgeLabel(combined.effectiveType);
        const poInfo = sugestao.poData;
        const summaryText = combined.hasCombinedNm && principalLabel
          ? `${fmt(transit.qty)} ${principalLabel} + NM`
          : combined.effectiveType === "S"
            ? `S ${fmt(transit.qty)}`
          : combined.effectiveType === "E"
              ? `E ${fmt(transit.qty)}`
              : combined.effectiveType === "PO"
                ? `PO ${fmt(transit.qty)}`
              : combined.effectiveType === "NM"
                ? `NM ${fmt(transit.qty)}`
                : fmt(transit.qty);
        suggestion = {
          text: fmt(transit.qty),
          tone: combined.effectiveType === "S" ? "s" : combined.effectiveType === "E" ? "e" : "buy",
          summaryText,
          qty: transit.qty,
          baseType: combined.effectiveType,
          nmExtraQty: combined.nmExtraQty,
          combinedWithNm: combined.hasCombinedNm,
          title: combined.hasCombinedNm
            ? getCombinedNecessidadeMinimaTooltip({
              baseType: combined.effectiveType,
              baseQty: combined.baseQty,
              nmExtraQty: combined.nmExtraQty,
              totalQty: transit.qty,
              filiais: currentMetric?.filiaisNM ?? undefined,
            })
            : combined.effectiveType === "NM"
              ? `${getNecessidadeMinimaRuleDescription()}${currentMetric?.filiaisNM?.length ? ` Filiais NM: ${formatNecessidadeMinimaFiliaisDescription(currentMetric.filiaisNM)}.` : ""}`
              : combined.effectiveType === "PO"
                ? "Potencial oculto: poucos dias com estoque, ruptura prolongada e velocidade alta enquanto disponivel."
              : undefined,
          nmFiliais: currentMetric?.filiaisNM ?? undefined,
          ruleTooltip: combined.effectiveType === "PO" && poInfo
            ? {
              title: "Potencial Oculto (PO)",
              lines: [
                `Base: ${fmt(compraItem.qtde12m)} un em ${fmt(poInfo.diasComEstoquePositivo)} dias com estoque.`,
                `Sem estoque: ${fmt(poInfo.diasSemEstoque)} dias.`,
                `Velocidade ajustada: ${poInfo.velocidadeAjustada.toFixed(1)} un/mês.`,
                `Potencial mensal bruto: ${poInfo.potencialMensalBruto.toFixed(1)} un/mês.`,
                `Trava de segurança: máximo de ${fmt(poInfo.limiteSeguro)} un.`,
                `Qtd sugerida: ${fmt(transit.qty)} un.`,
              ],
            }
            : undefined,
        };
      } else if (combined.effectiveType === "SUFICIENTE" || transit.suppressedByTransit) {
        suggestion = { text: "Quantidade suficiente", tone: "ok", summaryText: "Quantidade suficiente", qty: 0, baseType: combined.effectiveType, nmExtraQty: 0, combinedWithNm: false };
      } else if (combined.effectiveType === "SEM_SUGESTAO" && transit.totalTransit > 0) {
        suggestion = { text: "Em transito", tone: "ok", summaryText: "Em transito", qty: 0, baseType: combined.effectiveType, nmExtraQty: 0, combinedWithNm: false };
      } else if (combined.effectiveType === "SEM_SUGESTAO") {
        suggestion = { text: "Sem sugestao", tone: "muted", summaryText: "Sem sugestao", qty: 0, baseType: combined.effectiveType, nmExtraQty: 0, combinedWithNm: false };
      }

      return {
        ...row,
        estoque: Math.max(0, Math.round(currentMetric?.estoqueFilial ?? 0)),
        suggestion,
      };
    });
  }, [comprasTransitoIndex, data, diasCorridosMes, metricas]);

  const representedRows = useMemo(
    () => displayRows.filter((row) => row.represented).sort((a, b) => b.vendas - a.vendas),
    [displayRows]
  );
  const missingRows = useMemo(
    () => displayRows.filter((row) => !row.represented),
    [displayRows]
  );

  const totalFaturamento = representedRows.reduce((sum, row) => sum + row.vendas, 0);
  const totalQtde = representedRows.reduce((sum, row) => sum + row.qtde, 0);
  const countA = representedRows.filter((row) => row.curva === "A").length;
  const countB = representedRows.filter((row) => row.curva === "B").length;
  const countC = representedRows.filter((row) => row.curva === "C").length;

  const handleExportXlsx = () => {
    exportCurvaPorProdutoXlsx(
      exportRows.map((row) => ({
        ...row,
        "Sugestao de compra": extractSuggestionNumber(String(row["Sugestao de compra"] ?? "")),
      })),
      exportOptions
    );
  };

  const handleExportCsv = () => {
    exportCurvaPorProdutoCsv(exportRows, exportOptions);
  };

  const exportRows = displayRows
    .slice()
    .sort((a, b) => {
      if (a.represented !== b.represented) return a.represented ? -1 : 1;
      return b.vendas - a.vendas;
    })
    .map((row) => {
      const badge = getComparisonBadge(row.vendas, row.vendasPrevious);
      return {
        "Periodo da analise": `${range.startDate.toLocaleDateString("pt-BR")} a ${range.endDate.toLocaleDateString("pt-BR")}`,
        Curva: row.curva ?? "SEM REPRESENTACAO",
        Descricao: row.descricao || row.produto,
        Codigo: row.produto,
        "Codigo de Barras": row.codigoBarra ?? "",
        Categoria: row.categoria || row.linha || "",
        Subgrupo: row.subgrupo ?? "",
        "Tipo Produto": row.tipoProduto ?? "",
        Grade: row.grade ?? "",
        Colecao: row.colecao ?? "",
        "Desc Colecao": row.descColecao ?? "",
        Cor: row.corDescricao || row.corProduto || "",
        "Participacao %": Number(row.percParticipacao.toFixed(2)),
        Faturamento: row.vendas,
        Qtd: row.qtde,
        Estoque: row.estoque,
        "Sugestao de compra": row.suggestion.summaryText ?? row.suggestion.text,
        "Var. vs periodo anterior": badge == null ? "" : badge.kind === "new" ? "NOVO" : Number(badge.value.toFixed(2)),
      };
    });

  const exportOptions = {
    companyKey,
    range,
    filialLabel: data?.displayName ?? selectedFilial,
  };

  return (
    <div className={styles.wrapper}>
      <div className={styles.headerCard}>
        <div className={styles.headerTop}>
          <div>
            <h1 className={styles.title}>Curva por Produto</h1>
            <p className={styles.subtitle}>Selecione produtos e acompanhe a classificacao ABC por periodo e por loja.</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} onClick={() => setModalOpen(true)}>
              {selectedItems.length > 0 ? "Editar produtos" : "Adicionar produtos"}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={handleExportCsv}
              disabled={displayRows.length === 0}
            >
              Exportar CSV
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleExportXlsx}
              disabled={displayRows.length === 0}
            >
              Exportar XLSX
            </button>
          </div>
        </div>

        <div className={styles.filtersRow}>
          <DateRangeFilter
            label=""
            value={range}
            onChange={(nextRange) => {
              setLoading(selectedItems.length > 0);
              setError(null);
              setMetricas({});
              setRange(nextRange);
            }}
          />
          <FilialFilter
            companyKey={companyKey}
            value={selectedFilial}
            onChange={(value) => {
              setLoading(selectedItems.length > 0);
              setError(null);
              setMetricas({});
              setSelectedFilial(value);
            }}
            label=""
          />
          <div className={styles.compareBox}>
            <span className={styles.compareLabel}>Comparacao</span>
            <div className={styles.toggleGroup}>
              <button
                type="button"
                className={`${styles.toggleButton} ${comparisonMode === "month" ? styles.toggleButtonActive : ""}`}
                onClick={() => {
                  setLoading(selectedItems.length > 0);
                  setError(null);
                  setMetricas({});
                  setComparisonMode("month");
                }}
              >
                Mes
              </button>
              <button
                type="button"
                className={`${styles.toggleButton} ${comparisonMode === "year" ? styles.toggleButtonActive : ""}`}
                onClick={() => {
                  setLoading(selectedItems.length > 0);
                  setError(null);
                  setMetricas({});
                  setComparisonMode("year");
                }}
              >
                Ano
              </button>
            </div>
          </div>
        </div>

        <div className={styles.selectionRow}>
          {selectedItems.length === 0 ? (
            <span className={styles.selectionHint}>Nenhum produto selecionado.</span>
          ) : (
            <>
              <span className={styles.selectionHint}>
                {selectedItems.length} produto(s) selecionado(s).
              </span>
              <button
                type="button"
                className={styles.clearButton}
                onClick={() => {
                  setSelectedItems([]);
                  setData(null);
                  setMetricas({});
                  setError(null);
                  setLoading(false);
                }}
              >
                Limpar selecao
              </button>
            </>
          )}
        </div>
      </div>

      {selectedItems.length > 0 && (
        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Base da curva</span>
            <strong className={styles.summaryValue}>
              {data ? fmtCurrency(data.totalScopeRevenue) : "—"}
            </strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Itens representados</span>
            <strong className={styles.summaryValue}>{representedRows.length}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Curva A</span>
            <strong className={styles.summaryValue}>{countA}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Curva B</span>
            <strong className={styles.summaryValue}>{countB}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Curva C</span>
            <strong className={styles.summaryValue}>{countC}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Faturamento</span>
            <strong className={styles.summaryValue}>{fmtCurrency(totalFaturamento)}</strong>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryLabel}>Qtd vendida</span>
            <strong className={styles.summaryValue}>{fmt(totalQtde)}</strong>
          </div>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}
      {selectedItems.length === 0 && (
        <div className={styles.emptyState}>
          <h2 className={styles.emptyTitle}>Monte sua analise</h2>
          <p className={styles.emptyText}>Adicione produtos para ver a curva A/B/C por item, com visao geral da rede ou por loja.</p>
        </div>
      )}
      {selectedItems.length > 0 && loading && <div className={styles.loading}>Carregando analise...</div>}

      {selectedItems.length > 0 && !loading && !error && (
        <>
          <div className={styles.tableCard}>
            {representedRows.length === 0 ? (
              <div className={styles.emptyTable}>Nenhum item selecionado teve representacao no periodo.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className={styles.right}>Participacao</th>
                    <th className={styles.right}>Faturamento</th>
                    <th className={styles.right}>Qtd</th>
                    <th className={styles.right}>Estoque</th>
                    <th>Sugestao de compra</th>
                  </tr>
                </thead>
                <tbody>
                  {representedRows.map((row) => {
                    const comparison = getComparisonBadge(row.vendas, row.vendasPrevious);
                    const productInfoLine = buildProductInfoLine(row);
                    return (
                      <tr key={buildCurvaPorProdutoKey(row.produto, row.corProduto)}>
                        <td>
                          <div className={styles.productBlock}>
                            <div className={styles.productHeader}>
                              <span className={`${styles.curveBadge} ${styles[`curve${buildCurveBadgeLabel(row.curva)}`]}`}>
                                {buildCurveBadgeLabel(row.curva)}
                              </span>
                              <span className={styles.productName}>{row.descricao || row.produto}</span>
                              {(row.corDescricao || row.corProduto) && (
                                <span className={styles.colorBadge}>{row.corDescricao || row.corProduto}</span>
                              )}
                              <Link
                                href={buildProductDetalhadoHref(companyKey, row)}
                                className={styles.productDetailIcon}
                                title="Abrir produto detalhado"
                                aria-label={`Abrir produto detalhado de ${row.descricao || row.produto}`}
                              >
                                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                                  <path
                                    d="M1.75 10C3.3 6.95 6.3 5 10 5C13.7 5 16.7 6.95 18.25 10C16.7 13.05 13.7 15 10 15C6.3 15 3.3 13.05 1.75 10Z"
                                    stroke="currentColor"
                                    strokeWidth="1.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <circle cx="10" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.8" />
                                </svg>
                              </Link>
                              {comparison && (
                                <span
                                  className={`${styles.compareBadge} ${
                                    comparison.kind === "new" || comparison.value >= 0 ? styles.compareUp : styles.compareDown
                                  }`}
                                >
                                  {comparison.kind === "new" ? "NOVO" : formatSignedPct(comparison.value)}
                                </span>
                              )}
                            </div>
                            <div className={styles.productMeta}>
                              {row.produto}
                              {row.codigoBarra ? ` | CB: ${row.codigoBarra}` : ""}
                              {row.categoria ? ` | ${row.categoria}` : row.linha ? ` | ${row.linha}` : ""}
                              {row.grade ? ` · ${row.grade}` : ""}
                            </div>
                            {productInfoLine && (
                              <div className={styles.productSubMeta}>{productInfoLine}</div>
                            )}
                          </div>
                        </td>
                        <td className={styles.right}>{row.percParticipacao.toFixed(1)}%</td>
                        <td className={styles.right}>{fmtCurrency(row.vendas)}</td>
                        <td className={styles.right}>{fmt(row.qtde)}</td>
                        <td className={styles.right}>{fmt(row.estoque)}</td>
                        <td>
                          <span
                            style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}
                            title={row.suggestion.title}
                          >
                            <span className={`${styles.suggestionBadge} ${styles[`suggestion${row.suggestion.tone}`]}`}>
                              {row.suggestion.text}
                            </span>
                            {row.suggestion.baseType === "S" && (
                              <span className={`${styles.suggestionBadge} ${styles.suggestions}`}>
                                S
                              </span>
                            )}
                            {row.suggestion.baseType === "E" && (
                              <span className={`${styles.suggestionBadge} ${styles.suggestione}`}>
                                E
                              </span>
                            )}
                            {row.suggestion.baseType === "NM" && (
                              <span className={`${styles.suggestionBadge} ${styles.suggestionbuy}`} style={{ background: "#7c3aed", borderColor: "#6d28d9", color: "#fff" }}>
                                NM
                              </span>
                            )}
                            {row.suggestion.baseType === "PO" && (
                              <span
                                className={`${styles.suggestionBadge} ${styles.suggestionbuy}`}
                                style={{ background: "#86efac", borderColor: "#22c55e", color: "#14532d", cursor: "help" }}
                                onMouseEnter={(e) => {
                                  if (!row.suggestion.ruleTooltip) return;
                                  setSuggestionTooltip({
                                    x: e.clientX,
                                    y: e.clientY,
                                    title: row.suggestion.ruleTooltip.title,
                                    lines: row.suggestion.ruleTooltip.lines,
                                  });
                                }}
                                onMouseLeave={() => setSuggestionTooltip(null)}
                              >
                                PO
                              </span>
                            )}
                            {row.suggestion.combinedWithNm && (
                              <span className={`${styles.suggestionBadge} ${styles.suggestionbuy}`} style={{ background: "#7c3aed", borderColor: "#6d28d9", color: "#fff" }}>
                                NM
                              </span>
                            )}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {missingRows.length > 0 && (
            <div className={styles.missingCard}>
              <div className={styles.missingHeader}>
                <h2 className={styles.missingTitle}>Sem representacao no periodo</h2>
                <span className={styles.missingCount}>{missingRows.length} item(ns)</span>
              </div>
              <div className={styles.missingList}>
                {missingRows.map((row) => {
                  const infoLine = buildProductInfoLine(row);
                  return (
                    <div key={buildCurvaPorProdutoKey(row.produto, row.corProduto)} className={styles.missingItem}>
                      <div className={styles.missingNameRow}>
                        <div className={styles.missingName}>{row.descricao || row.produto}</div>
                        {(row.corDescricao || row.corProduto) && (
                          <span className={styles.colorBadge}>{row.corDescricao || row.corProduto}</span>
                        )}
                      </div>
                      <div className={styles.missingMeta}>
                      {row.produto}
                      {row.estoque > 0 ? ` · Estoque: ${fmt(row.estoque)}` : ""}
                      {row.suggestion.text ? ` · ${row.suggestion.text}` : ""}
                      </div>
                      {infoLine && <div className={styles.productSubMeta}>{infoLine}</div>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}

      {suggestionTooltip && (
        <div className={styles.ruleTooltip} style={getTooltipViewportPosition(suggestionTooltip.x, suggestionTooltip.y)}>
          <div className={styles.ruleTooltipTitle}>{suggestionTooltip.title}</div>
          {suggestionTooltip.lines.map((line) => (
            <div key={line} className={styles.ruleTooltipLine}>{line}</div>
          ))}
        </div>
      )}

      <CurvaPorProdutoPickerModal
        companyKey={companyKey}
        open={modalOpen}
        selectedItems={selectedItems}
        onClose={() => setModalOpen(false)}
        onApply={(items) => {
          setData(null);
          setMetricas({});
          setError(null);
          setLoading(items.length > 0);
          setSelectedItems(items);
          setModalOpen(false);
        }}
      />
    </div>
  );
}

import { NextResponse } from "next/server";

import { resolveCompany, type CompanyKey } from "@/lib/config/company";
import { liveNamesForIncoming } from "@/lib/server/company-live";
import {
  fetchFilialProdutoSales,
  fetchProdutoEstoqueDetalhadoPorFilial,
} from "@/lib/repositories/performance";
import {
  buildNovaFilialItemKey,
  classifyAbc,
  CURVA_LABELS,
  getComparableFilialOptions,
  getDefaultNovaFilialPreset,
  getNovaFilialPresets,
  type Curva,
} from "@/lib/performance/novaFilial";
import { normalizeRangeForQuery } from "@/lib/utils/date";

export const maxDuration = 300;

interface ModelAggRow {
  produto: string;
  descricao: string;
  categoria: string;
  subgrupo?: string;
  grade?: string;
  cor?: string;
  corDescricao?: string;
  vendasPeriodo: number;
  qtdePeriodo: number;
}

interface StockAggRow {
  produto: string;
  descricao: string;
  categoria: string;
  subgrupo?: string;
  grade?: string;
  cor?: string;
  corDescricao?: string;
  estoqueAtual: number;
}

function parseYmd(value: string | null): Date | null {
  if (!value) return null;
  const parts = value.trim().split("-");
  if (parts.length !== 3) return null;

  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const dt = new Date(year, month - 1, day);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function getDefaultRange() {
  const now = new Date();
  return normalizeRangeForQuery({
    start: new Date(now.getFullYear(), now.getMonth() - 5, 1),
    end: now,
  });
}

function getMonthSpan(start: Date, endExclusive: Date): number {
  const endInclusive = new Date(endExclusive.getTime() - 1);
  const startMonth = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const endMonth = endInclusive.getUTCFullYear() * 12 + endInclusive.getUTCMonth();
  return Math.max(1, endMonth - startMonth + 1);
}

function formatUtcDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function splitMembers(
  companyKey: CompanyKey,
  members: string[]
): { posMembers: string[]; ecommerceMembers: string[] } {
  const company = resolveCompany(companyKey);
  const ecommerceSet = new Set(company?.ecommerceFilials ?? []);

  return {
    posMembers: members.filter((member) => !ecommerceSet.has(member)),
    ecommerceMembers: members.filter((member) => ecommerceSet.has(member)),
  };
}

function mergeModelRows(rows: Awaited<ReturnType<typeof fetchFilialProdutoSales>>): Map<string, ModelAggRow> {
  const map = new Map<string, ModelAggRow>();

  rows.forEach((row) => {
    const key = buildNovaFilialItemKey(row.produto, row.cor ?? "");
    const current = map.get(key);
    if (current) {
      current.vendasPeriodo += row.vendas;
      current.qtdePeriodo += row.qtde;
      if (!current.descricao && row.descricao) current.descricao = row.descricao;
      if (!current.categoria && row.categoria) current.categoria = row.categoria;
      if (!current.subgrupo && row.subgrupo) current.subgrupo = row.subgrupo;
      if (!current.grade && row.grade) current.grade = row.grade;
      if (!current.corDescricao && row.corDescricao) current.corDescricao = row.corDescricao;
      return;
    }

    map.set(key, {
      produto: row.produto,
      descricao: row.descricao,
      categoria: row.categoria,
      subgrupo: row.subgrupo,
      grade: row.grade,
      cor: row.cor,
      corDescricao: row.corDescricao,
      vendasPeriodo: row.vendas,
      qtdePeriodo: row.qtde,
    });
  });

  return map;
}

function mergeStockRows(
  rows: Awaited<ReturnType<typeof fetchProdutoEstoqueDetalhadoPorFilial>>
): Map<string, StockAggRow> {
  const map = new Map<string, StockAggRow>();

  rows.forEach((row) => {
    const key = buildNovaFilialItemKey(row.produto, row.cor ?? "");
    const current = map.get(key);
    if (current) {
      current.estoqueAtual += row.estoque;
      if (!current.descricao && row.descricao) current.descricao = row.descricao;
      if (!current.categoria && row.categoria) current.categoria = row.categoria;
      if (!current.subgrupo && row.subgrupo) current.subgrupo = row.subgrupo;
      if (!current.grade && row.grade) current.grade = row.grade;
      if (!current.corDescricao && row.corDescricao) current.corDescricao = row.corDescricao;
      return;
    }

    map.set(key, {
      produto: row.produto,
      descricao: row.descricao,
      categoria: row.categoria,
      subgrupo: row.subgrupo,
      grade: row.grade,
      cor: row.cor,
      corDescricao: row.corDescricao,
      estoqueAtual: row.estoque,
    });
  });

  return map;
}

function getRequiredMonthlyUnits(qtdePeriodo: number, monthsCount: number): number {
  if (qtdePeriodo <= 0) return 0;
  return Math.max(1, Math.ceil(qtdePeriodo / monthsCount));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") as CompanyKey | null;
  const modelParam = searchParams.get("model");
  const targetParam = searchParams.get("target");
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");

  if (!companyKey) {
    return NextResponse.json({ error: "Parametro company e obrigatorio" }, { status: 400 });
  }

  const company = resolveCompany(companyKey);
  if (!company) {
    return NextResponse.json({ error: "Empresa nao encontrada" }, { status: 404 });
  }

  const presets = getNovaFilialPresets(companyKey);
  const defaultPreset = getDefaultNovaFilialPreset(companyKey);
  const storeOptions = getComparableFilialOptions(companyKey);
  const storeMap = new Map(storeOptions.map((option) => [option.value, option]));

  const fallbackModel = defaultPreset?.model ?? storeOptions[0]?.value ?? null;
  const fallbackTarget =
    defaultPreset?.target ??
    storeOptions.find((option) => option.value !== fallbackModel)?.value ??
    storeOptions[0]?.value ??
    null;

  const selectedModel = modelParam && storeMap.has(modelParam) ? modelParam : fallbackModel;
  const selectedTarget = targetParam && storeMap.has(targetParam) ? targetParam : fallbackTarget;

  if (!selectedModel || !selectedTarget) {
    return NextResponse.json(
      { error: "Nao foi possivel resolver as lojas disponiveis para comparacao" },
      { status: 400 }
    );
  }

  const resolvedRange = (() => {
    const start = parseYmd(startParam);
    const end = parseYmd(endParam);
    if (start && end) {
      return normalizeRangeForQuery({ start, end });
    }
    return getDefaultRange();
  })();

  const monthsCount = getMonthSpan(resolvedRange.start, resolvedRange.end);
  const endInclusive = new Date(resolvedRange.end.getTime() - 1);

  const modelMembers = storeMap.get(selectedModel)?.members ?? [selectedModel];
  const targetMembers = storeMap.get(selectedTarget)?.members ?? [selectedTarget];

  const modelSplit = splitMembers(companyKey, modelMembers);
  const targetSplit = splitMembers(companyKey, targetMembers);

  // Normaliza os nomes (config estática) para o nome vivo do banco (match por COD_FILIAL).
  const [modelPos, modelEcom, targetPos, targetEcom] = await Promise.all([
    liveNamesForIncoming(modelSplit.posMembers),
    liveNamesForIncoming(modelSplit.ecommerceMembers),
    liveNamesForIncoming(targetSplit.posMembers),
    liveNamesForIncoming(targetSplit.ecommerceMembers),
  ]);

  try {
    const [modelSalesRows, targetStockRows] = await Promise.all([
      fetchFilialProdutoSales(
        companyKey,
        modelPos ?? modelSplit.posMembers,
        modelEcom ?? modelSplit.ecommerceMembers,
        resolvedRange,
        "month",
        { groupByCor: true, limit: 5000 }
      ),
      fetchProdutoEstoqueDetalhadoPorFilial(
        companyKey,
        targetPos ?? targetSplit.posMembers,
        targetEcom ?? targetSplit.ecommerceMembers,
        { groupByCor: true }
      ),
    ]);

    const modelMap = mergeModelRows(modelSalesRows);
    const stockMap = mergeStockRows(targetStockRows);

    const modelCategoryBase = Array.from(modelMap.values()).reduce<
      Map<string, { categoria: string; vendasPeriodo: number; qtdePeriodo: number }>
    >((acc, item) => {
      const category = item.categoria?.trim() || "SEM CATEGORIA";
      const current = acc.get(category);
      if (current) {
        current.vendasPeriodo += item.vendasPeriodo;
        current.qtdePeriodo += item.qtdePeriodo;
      } else {
        acc.set(category, {
          categoria: category,
          vendasPeriodo: item.vendasPeriodo,
          qtdePeriodo: item.qtdePeriodo,
        });
      }
      return acc;
    }, new Map());

    const classifiedCategories = classifyAbc(
      Array.from(modelCategoryBase.values()),
      (item) => item.vendasPeriodo
    );
    const categoryCurveMap = new Map(
      classifiedCategories.map((item) => [
        item.categoria,
        {
          curva: item.curva,
          percParticipacao: item.percParticipacao,
          percCumulativo: item.percCumulativo,
        },
      ])
    );

    const classifiedItems = classifyAbc(
      Array.from(modelMap.entries()).map(([key, item]) => ({ key, ...item })),
      (item) => item.vendasPeriodo
    );
    const itemCurveMap = new Map(
      classifiedItems.map((item) => [
        item.key,
        {
          curva: item.curva,
          percParticipacao: item.percParticipacao,
          percCumulativo: item.percCumulativo,
        },
      ])
    );

    const allKeys = new Set<string>([...modelMap.keys(), ...stockMap.keys()]);
    const itemRows = Array.from(allKeys).map((key) => {
      const modelItem = modelMap.get(key);
      const stockItem = stockMap.get(key);
      const categoria = modelItem?.categoria || stockItem?.categoria || "SEM CATEGORIA";
      const mixTargetQty = modelItem
        ? getRequiredMonthlyUnits(modelItem.qtdePeriodo, monthsCount)
        : 0;
      const avgMonthlySales = modelItem ? modelItem.vendasPeriodo / monthsCount : 0;
      const avgMonthlyDemandUnits = modelItem ? modelItem.qtdePeriodo / monthsCount : 0;
      const avgUnitPrice =
        modelItem && modelItem.qtdePeriodo > 0
          ? modelItem.vendasPeriodo / modelItem.qtdePeriodo
          : 0;
      const currentStock = stockItem?.estoqueAtual ?? 0;
      const safeCurrentStock = Math.max(currentStock, 0);
      const coveredMixUnits = Math.min(safeCurrentStock, mixTargetQty);
      const coveredDemandUnits = Math.min(safeCurrentStock, avgMonthlyDemandUnits);
      const projectedRevenueWithCurrentStock = coveredDemandUnits * avgUnitPrice;
      const gapQty = currentStock - mixTargetQty;
      const shortageQty = Math.max(mixTargetQty - currentStock, 0);
      const excessQty = Math.max(currentStock - mixTargetQty, 0);

      let status: "faltando" | "excesso" | "ok";
      if (!modelItem && currentStock !== 0) status = "excesso";
      else if (gapQty < 0) status = "faltando";
      else if (gapQty > 0) status = "excesso";
      else status = "ok";

      const itemCurve = itemCurveMap.get(key) ?? null;
      const categoryCurve = categoryCurveMap.get(categoria) ?? null;

      return {
        key,
        categoria,
        categoriaCurva: categoryCurve?.curva ?? null,
        categoriaParticipacao: categoryCurve?.percParticipacao ?? 0,
        itemCurva: itemCurve?.curva ?? null,
        itemParticipacao: itemCurve?.percParticipacao ?? 0,
        produto: modelItem?.produto ?? stockItem?.produto ?? "",
        descricao: modelItem?.descricao ?? stockItem?.descricao ?? "",
        subgrupo: modelItem?.subgrupo ?? stockItem?.subgrupo ?? "",
        grade: modelItem?.grade ?? stockItem?.grade ?? "",
        cor: modelItem?.cor ?? stockItem?.cor ?? "",
        corDescricao: modelItem?.corDescricao ?? stockItem?.corDescricao ?? "",
        vendasPeriodo: modelItem?.vendasPeriodo ?? 0,
        avgMonthlySales,
        avgMonthlyDemandUnits,
        qtdePeriodo: modelItem?.qtdePeriodo ?? 0,
        mixTargetQty,
        currentStock,
        coveredMixUnits,
        coveredDemandUnits,
        gapQty,
        shortageQty,
        excessQty,
        avgUnitPrice,
        projectedRevenueWithCurrentStock,
        uncoveredRevenue: Math.max(avgMonthlySales - projectedRevenueWithCurrentStock, 0),
        status,
      };
    });

    itemRows.sort((a, b) => {
      if (b.vendasPeriodo !== a.vendasPeriodo) return b.vendasPeriodo - a.vendasPeriodo;
      if (Math.abs(b.gapQty) !== Math.abs(a.gapQty)) return Math.abs(b.gapQty) - Math.abs(a.gapQty);
      return a.descricao.localeCompare(b.descricao, "pt-BR");
    });

    const categoryRows = Array.from(
      itemRows.reduce<
        Map<
          string,
          {
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
          }
        >
      >((acc, item) => {
        const current = acc.get(item.categoria);
        if (current) {
          current.avgMonthlySales += item.avgMonthlySales;
          current.avgMonthlyDemandUnits += item.avgMonthlyDemandUnits;
          current.mixTargetQty += item.mixTargetQty;
          current.currentStock += item.currentStock;
          current.coveredMixUnits += item.coveredMixUnits;
          current.coveredDemandUnits += item.coveredDemandUnits;
          current.shortageQty += item.shortageQty;
          current.excessQty += item.excessQty;
          current.projectedRevenueWithCurrentStock += item.projectedRevenueWithCurrentStock;
          return acc;
        }

        acc.set(item.categoria, {
          categoria: item.categoria,
          categoriaCurva: item.categoriaCurva,
          categoriaParticipacao: item.categoriaParticipacao,
          avgMonthlySales: item.avgMonthlySales,
          avgMonthlyDemandUnits: item.avgMonthlyDemandUnits,
          mixTargetQty: item.mixTargetQty,
          currentStock: item.currentStock,
          coveredMixUnits: item.coveredMixUnits,
          coveredDemandUnits: item.coveredDemandUnits,
          shortageQty: item.shortageQty,
          excessQty: item.excessQty,
          projectedRevenueWithCurrentStock: item.projectedRevenueWithCurrentStock,
        });
        return acc;
      }, new Map())
    ).map(([, value]) => ({
      ...value,
      mixCoveragePct:
        value.mixTargetQty > 0
          ? (value.coveredMixUnits / value.mixTargetQty) * 100
          : null,
      demandCoveragePct:
        value.avgMonthlyDemandUnits > 0
          ? (value.coveredDemandUnits / value.avgMonthlyDemandUnits) * 100
          : null,
    }));

    categoryRows.sort((a, b) => b.avgMonthlySales - a.avgMonthlySales);

    const demandUnitsMonthly = itemRows.reduce((acc, item) => acc + item.avgMonthlyDemandUnits, 0);
    const mixTargetUnitsMonthly = itemRows.reduce((acc, item) => acc + item.mixTargetQty, 0);
    const usefulMixStockUnits = itemRows.reduce((acc, item) => acc + item.coveredMixUnits, 0);
    const usefulDemandStockUnits = itemRows.reduce((acc, item) => acc + item.coveredDemandUnits, 0);
    const currentStockUnits = itemRows.reduce((acc, item) => acc + Math.max(item.currentStock, 0), 0);
    const shortageUnits = itemRows.reduce((acc, item) => acc + item.shortageQty, 0);
    const excessUnits = itemRows.reduce((acc, item) => acc + item.excessQty, 0);
    const demandRevenueMonthly = itemRows.reduce((acc, item) => acc + item.avgMonthlySales, 0);
    const projectedRevenueWithCurrentStock = itemRows.reduce(
      (acc, item) => acc + item.projectedRevenueWithCurrentStock,
      0
    );
    const activeModelItems = itemRows.filter((item) => item.mixTargetQty > 0);
    const curveAItems = itemRows.filter((item) => item.itemCurva === "A");
    const curveAShortageUnits = curveAItems.reduce((acc, item) => acc + item.shortageQty, 0);

    return NextResponse.json(
      {
        companyKey,
        stores: storeOptions.map((option) => ({
          value: option.value,
          label: option.label,
        })),
        presets,
        modelStore: {
          value: selectedModel,
          label: storeMap.get(selectedModel)?.label ?? selectedModel,
        },
        targetStore: {
          value: selectedTarget,
          label: storeMap.get(selectedTarget)?.label ?? selectedTarget,
        },
        range: {
          start: formatUtcDate(resolvedRange.start),
          end: formatUtcDate(endInclusive),
          monthsCount,
        },
        abcLabels: CURVA_LABELS,
        sourceInfo: [
          "Vendas e mix da loja modelo seguem a mesma regra de Curva ABC da pagina atual: acumulado ate 80% = A, ate 95% = B, restante = C.",
          "Estoque atual da loja comparada vem do saldo atual por produto/cor da tabela de estoque por filial.",
          "Demanda mensal = media real de pecas vendidas por mes na loja modelo.",
          "Mix minimo sugerido = sortimento minimo por SKU para a nova loja operar com profundidade semelhante.",
        ],
        summary: {
          demandUnitsMonthly,
          mixTargetUnitsMonthly,
          usefulMixStockUnits,
          usefulDemandStockUnits,
          currentStockUnits,
          shortageUnits,
          excessUnits,
          depthPerItem: activeModelItems.length > 0 ? mixTargetUnitsMonthly / activeModelItems.length : 0,
          demandRevenueMonthly,
          projectedRevenueWithCurrentStock,
          mixCoveragePct: mixTargetUnitsMonthly > 0 ? (usefulMixStockUnits / mixTargetUnitsMonthly) * 100 : 0,
          demandCoveragePct:
            demandUnitsMonthly > 0 ? (usefulDemandStockUnits / demandUnitsMonthly) * 100 : 0,
          revenueCoveragePct:
            demandRevenueMonthly > 0
              ? (projectedRevenueWithCurrentStock / demandRevenueMonthly) * 100
              : 0,
          isStockEnough: shortageUnits <= 0,
          activeItems: activeModelItems.length,
          activeCategories: categoryRows.filter((item) => item.avgMonthlySales > 0).length,
          curveAItems: curveAItems.length,
          curveAShortageUnits,
        },
        modelSummary: {
          vendasPeriodo: itemRows.reduce((acc, item) => acc + item.vendasPeriodo, 0),
          qtdePeriodo: itemRows.reduce((acc, item) => acc + item.qtdePeriodo, 0),
          avgMonthlySales: demandRevenueMonthly,
          avgMonthlyUnits: demandUnitsMonthly,
          mixTargetUnitsMonthly,
        },
        categoryRows,
        itemRows,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Erro ao carregar analise da nova filial:", error);
    return NextResponse.json(
      { error: "Erro ao carregar analise da nova filial" },
      { status: 500 }
    );
  }
}

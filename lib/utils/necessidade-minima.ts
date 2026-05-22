import type { CompanyConfig } from "@/lib/config/company";
import {
  aggregateEstoquePorFilialByDisplayLabel,
  aggregateVendasPorFilialByDisplayLabel,
  normalizeFilialLookupKey,
} from "@/lib/config/company";
import { calcNecessidadeMinimaQtyAdjusted } from "@/lib/utils/suggestion-rules";

export const NECESSIDADE_MINIMA_VENDAS_STEP = 5;

export function calcNecessidadeMinimaQty(input: {
  estoqueAtual?: number | null;
  qtde12m?: number | null;
  velocidadeAjustada?: number | null;
  mesesDisponiveis?: number | null;
  diasComEstoquePositivo?: number | null;
}): number {
  return calcNecessidadeMinimaQtyAdjusted(input);
}

export type SuggestionBaseType = "COMPRA" | "S" | "E" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO";

export type FilialNecessidadeMinimaInfo = {
  filial: string;
  qtd: number;
  qtde12m: number;
};

export function calcNecessidadeMinimaPorFilial(input: {
  company: CompanyConfig | null | undefined;
  vendasPorFilial: Array<{
    filial: string;
    qtde12m: number;
    qtde60d?: number;
    velocidadeAjustada?: number | null;
    mesesDisponiveis?: number | null;
    diasComEstoquePositivo?: number | null;
  }>;
  estoquePorFilial: Array<{ filial: string; estoque: number }>;
}): FilialNecessidadeMinimaInfo[] {
  const vendasAgregadas = aggregateVendasPorFilialByDisplayLabel(
    input.vendasPorFilial.map((row) => ({
      filial: row.filial,
      qtde12m: Number(row.qtde12m ?? 0),
      qtde60d: Number(row.qtde60d ?? 0),
    })),
    input.company
  );
  const estoqueMap = new Map<string, number>(
    aggregateEstoquePorFilialByDisplayLabel(input.estoquePorFilial, input.company).map((row) => [
      normalizeFilialLookupKey(row.filial),
      Number(row.estoque ?? 0),
    ])
  );
  const vendasInfoMap = new Map(
    input.vendasPorFilial.map((row) => [
      normalizeFilialLookupKey(row.filial),
      {
        velocidadeAjustada: row.velocidadeAjustada,
        mesesDisponiveis: row.mesesDisponiveis,
        diasComEstoquePositivo: row.diasComEstoquePositivo,
      },
    ])
  );

  return vendasAgregadas
    .map((row) => {
      const filialKey = normalizeFilialLookupKey(row.filial);
      const estoqueAtual = estoqueMap.get(filialKey) ?? 0;
      const vendasInfo = vendasInfoMap.get(filialKey);
      const qtd = calcNecessidadeMinimaQty({
        estoqueAtual,
        qtde12m: row.qtde12m,
        velocidadeAjustada: vendasInfo?.velocidadeAjustada,
        mesesDisponiveis: vendasInfo?.mesesDisponiveis,
        diasComEstoquePositivo: vendasInfo?.diasComEstoquePositivo,
      });
      return qtd > 0 ? { filial: row.filial, qtd, qtde12m: Number(row.qtde12m ?? 0) } : null;
    })
    .filter((row): row is FilialNecessidadeMinimaInfo => row != null);
}

export function calcTotalNecessidadeMinimaPorFilial(input: {
  company: CompanyConfig | null | undefined;
  vendasPorFilial: Array<{
    filial: string;
    qtde12m: number;
    qtde60d?: number;
    velocidadeAjustada?: number | null;
    mesesDisponiveis?: number | null;
    diasComEstoquePositivo?: number | null;
  }>;
  estoquePorFilial: Array<{ filial: string; estoque: number }>;
}): number {
  return calcNecessidadeMinimaPorFilial(input).reduce((sum, row) => sum + row.qtd, 0);
}

export function combineBaseSuggestionWithNecessidadeMinima(input: {
  baseType: SuggestionBaseType;
  baseQty: number;
  totalNmQty: number;
}) {
  const baseQty = Math.max(0, Math.round(Number(input.baseQty ?? 0)));
  const totalNmQty = Math.max(0, Math.round(Number(input.totalNmQty ?? 0)));
  const nmExtraQty = Math.max(0, totalNmQty - baseQty);
  const totalQty = baseQty + nmExtraQty;
  const hasBaseSuggestion = baseQty > 0 && input.baseType !== "NM";
  const hasCombinedNm = hasBaseSuggestion && nmExtraQty > 0;
  const effectiveType: SuggestionBaseType =
    totalQty <= 0
      ? input.baseType
      : input.baseType === "SUFICIENTE" || input.baseType === "SEM_SUGESTAO"
        ? "NM"
        : input.baseType;

  return {
    effectiveType,
    baseQty,
    totalNmQty,
    nmExtraQty,
    totalQty,
    hasBaseSuggestion,
    hasCombinedNm,
    hasOnlyNm: totalQty > 0 && !hasBaseSuggestion,
  };
}

export function getSuggestionPrincipalBadgeLabel(type: SuggestionBaseType): string | null {
  if (type === "COMPRA") return "COMPRA";
  if (type === "S") return "S";
  if (type === "E") return "E";
  if (type === "NM") return "NM";
  return null;
}

export function getNecessidadeMinimaRuleDescription(): string {
  return "NM: estoque zerado, minimo de 3 vendas em 12 meses e velocidade ajustada de pelo menos 0,5 un./mes. Sugestao fixa de 1 unidade.";
}

export function formatNecessidadeMinimaFiliaisDescription(
  filiais: FilialNecessidadeMinimaInfo[] | null | undefined
): string {
  const rows = (filiais ?? []).filter((row) => Math.max(0, Number(row.qtd ?? 0)) > 0);
  if (rows.length === 0) return "";
  return rows
    .map((row) => {
      const vendas = Math.max(0, Math.round(Number(row.qtde12m ?? 0)));
      const qtd = Math.max(0, Math.round(Number(row.qtd ?? 0)));
      return `${row.filial} (${vendas} vendas): ${qtd} ${qtd === 1 ? "unidade" : "unidades"}`;
    })
    .join(" | ");
}

export function getCombinedNecessidadeMinimaTooltip(input: {
  baseType: SuggestionBaseType;
  baseQty: number;
  nmExtraQty: number;
  totalQty: number;
  filiais?: FilialNecessidadeMinimaInfo[] | null;
}): string {
  const principalLabel =
    input.baseType === "COMPRA"
      ? "regra principal"
      : input.baseType === "S"
        ? "regra S"
        : input.baseType === "E"
          ? "regra E"
          : "regra NM";

  const nmTotal =
    Math.max(0, Math.round(Number(input.baseQty ?? 0))) +
    Math.max(0, Math.round(Number(input.nmExtraQty ?? 0)));
  const filiaisText = formatNecessidadeMinimaFiliaisDescription(input.filiais);
  return `Sugestao final = ${principalLabel} (${input.baseQty}) + NM nao coberta (+${input.nmExtraQty}) = ${input.totalQty}. NM total da rede: ${nmTotal}. ${getNecessidadeMinimaRuleDescription()}${filiaisText ? ` Detalhe por filial: ${filiaisText}.` : ""}`;
}

import type { CompanyConfig } from "@/lib/config/company";
import {
  aggregateEstoquePorFilialByDisplayLabel,
  aggregateVendasPorFilialByDisplayLabel,
  normalizeFilialLookupKey,
} from "@/lib/config/company";

export const NECESSIDADE_MINIMA_VENDAS_STEP = 5;

export function calcNecessidadeMinimaQty(input: {
  estoqueAtual?: number | null;
  qtde12m?: number | null;
}): number {
  const estoqueAtual = Number(input.estoqueAtual ?? 0);
  if (estoqueAtual > 0) return 0;

  const qtde12m = Math.floor(Number(input.qtde12m ?? 0));
  if (!Number.isFinite(qtde12m) || qtde12m <= 0) return 0;

  return Math.floor(qtde12m / NECESSIDADE_MINIMA_VENDAS_STEP);
}

export type SuggestionBaseType = "COMPRA" | "S" | "E" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO";

export type FilialNecessidadeMinimaInfo = {
  filial: string;
  qtd: number;
};

export function calcNecessidadeMinimaPorFilial(input: {
  company: CompanyConfig | null | undefined;
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>;
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

  return vendasAgregadas
    .map((row) => {
      const estoqueAtual = estoqueMap.get(normalizeFilialLookupKey(row.filial)) ?? 0;
      const qtd = calcNecessidadeMinimaQty({
        estoqueAtual,
        qtde12m: row.qtde12m,
      });
      return qtd > 0 ? { filial: row.filial, qtd } : null;
    })
    .filter((row): row is FilialNecessidadeMinimaInfo => row != null);
}

export function calcTotalNecessidadeMinimaPorFilial(input: {
  company: CompanyConfig | null | undefined;
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>;
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
  return "NM: estoque zerado e 1 unidade a cada 5 vendas nos últimos 12 meses.";
}

export function getCombinedNecessidadeMinimaTooltip(input: {
  baseType: SuggestionBaseType;
  baseQty: number;
  nmExtraQty: number;
  totalQty: number;
}): string {
  const principalLabel =
    input.baseType === "COMPRA"
      ? "regra principal"
      : input.baseType === "S"
        ? "regra S"
        : input.baseType === "E"
          ? "regra E"
          : "regra NM";

  return `Sugestão final = ${principalLabel} (${input.baseQty}) + NM não coberta (+${input.nmExtraQty}) = ${input.totalQty}. ${getNecessidadeMinimaRuleDescription()}`;
}

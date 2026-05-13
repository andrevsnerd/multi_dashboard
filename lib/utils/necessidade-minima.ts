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

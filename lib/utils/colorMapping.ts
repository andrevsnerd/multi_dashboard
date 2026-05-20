import colorMapping from '@/lib/config/colorMapping.json';

export function getMappedColorDescription(
  corProduto: string | null | undefined
): string {
  const codigoCor = (corProduto || '').trim().toUpperCase();
  if (!codigoCor) {
    return '';
  }

  return ((colorMapping as Record<string, string>)[codigoCor] || '').trim().toUpperCase();
}

/**
 * Obtém a descrição da cor usando o mapeamento fixo como prioridade.
 * Se não encontrar no mapeamento, retorna a cor do banco de dados (fallback).
 */
export function getColorDescription(
  corProduto: string | null | undefined,
  corBanco: string | null | undefined
): string {
  const corMapeada = getMappedColorDescription(corProduto);

  if (corMapeada) {
    return corMapeada;
  }

  return (corBanco || '').trim().toUpperCase();
}

export function normalizeColor(cor: string | null | undefined): string {
  return (cor || '').trim().toUpperCase();
}

import colorMapping from '@/lib/config/colorMapping.json';

/**
 * Obtém a descrição da cor usando o mapeamento fixo como prioridade.
 * Se não encontrar no mapeamento, retorna a cor do banco de dados (fallback).
 * 
 * @param corProduto - Código da cor do produto (COR_PRODUTO)
 * @param corBanco - Descrição da cor do banco de dados (fallback)
 * @returns Descrição da cor normalizada
 */
export function getColorDescription(
  corProduto: string | null | undefined,
  corBanco: string | null | undefined
): string {
  // Normalizar código da cor (trim e uppercase)
  const codigoCor = (corProduto || '').trim().toUpperCase();
  
  // Buscar no mapeamento fixo primeiro
  const corMapeada = (colorMapping as Record<string, string>)[codigoCor];
  
  if (corMapeada) {
    return corMapeada.trim().toUpperCase();
  }
  
  // Se não encontrou no mapeamento, usar a cor do banco (fallback)
  return (corBanco || '').trim().toUpperCase();
}

/**
 * Normaliza uma descrição de cor (trim + uppercase)
 */
export function normalizeColor(cor: string | null | undefined): string {
  return (cor || '').trim().toUpperCase();
}


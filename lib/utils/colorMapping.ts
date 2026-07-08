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
 * Obtém a descrição da cor priorizando o CADASTRO DO PRÓPRIO PRODUTO (`corBanco`,
 * vindo de PRODUTO_CORES / DESC_COR_PRODUTO da venda/estoque do produto).
 *
 * O código de cor (COR_PRODUTO) é escopado POR PRODUTO no Linx: o mesmo código
 * (ex.: "I2") significa cores diferentes em produtos diferentes. Por isso o mapa
 * global fixo (colorMapping.json), keyado só pelo código, NÃO pode ganhar do
 * cadastro do produto — ele só entra como fallback quando o produto não traz
 * descrição própria (corBanco vazio).
 */
export function getColorDescription(
  corProduto: string | null | undefined,
  corBanco: string | null | undefined
): string {
  const doProduto = (corBanco || '').trim().toUpperCase();

  if (doProduto) {
    return doProduto;
  }

  return getMappedColorDescription(corProduto);
}

export function normalizeColor(cor: string | null | undefined): string {
  return (cor || '').trim().toUpperCase();
}

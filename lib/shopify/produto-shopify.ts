/**
 * Produto vendido no Shopify que ainda NÃO tem cadastro (vínculo) no Linx.
 *
 * Nas telas que somam o Shopify, o item vinculado aparece como o produto do Linx;
 * o sem vínculo aparece com o nome do Shopify e o id `SHOPIFY:<product_id>` —
 * e leva o selo "Shopify" ao lado do nome (ver components/shopify/ShopifyBadge).
 * Arquivo sem `server-only`: é usado tanto pela API quanto pelas telas.
 */
export const PREFIXO_PRODUTO_SHOPIFY = "SHOPIFY:";

export function idProdutoShopify(productIdOuTitulo: string): string {
  return `${PREFIXO_PRODUTO_SHOPIFY}${productIdOuTitulo}`;
}

export function isProdutoSoShopify(productId: string | null | undefined): boolean {
  return !!productId && productId.startsWith(PREFIXO_PRODUTO_SHOPIFY);
}

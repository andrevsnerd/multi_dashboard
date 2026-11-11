import styles from "./ShopifyBadge.module.css";

/**
 * Selo "Shopify" ao lado do nome de um produto que veio do Shopify SEM cadastro
 * no Linx (o nome mostrado é o do Shopify). Use em qualquer tela que some o
 * Shopify — junto com `isProdutoSoShopify` de lib/shopify/produto-shopify.
 */
export function ShopifyBadge({ title = "Produto do Shopify sem cadastro no Linx — nome do Shopify" }: { title?: string }) {
  return (
    <span className={styles.badge} title={title}>
      Shopify
    </span>
  );
}

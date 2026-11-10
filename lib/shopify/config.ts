import "server-only";

/**
 * Shopify = fonte ALTERNATIVA do e-commerce, fora do Linx, para acompanhar venda em
 * tempo real. NUNCA somar com o faturamento do Linx (FATURAMENTO/W_FATURAMENTO_PROD_02):
 * os mesmos pedidos viram NF no Linx depois — somar conta a venda duas vezes. O número
 * oficial de faturamento continua sendo a regra canônica do CLAUDE.md.
 *
 * Cada empresa é uma loja Shopify numa ORGANIZAÇÃO diferente, então cada uma tem o seu
 * app no Dev Dashboard. Credencial por empresa (SHOPIFY_<EMPRESA>_CLIENT_ID/SECRET) com
 * fallback para a geral (SHOPIFY_CLIENT_ID/SECRET), que é o app da NERD.
 */

export type ShopifyCompany = "nerd" | "scarfme";

export const SHOPIFY_COMPANIES: readonly ShopifyCompany[] = ["nerd", "scarfme"];

export const SHOPIFY_API_VERSION = "2026-10";

/** Fuso das duas lojas (ianaTimezone do Shopify). Dia de venda = dia em São Paulo. */
export const SHOPIFY_TIMEZONE = "America/Sao_Paulo";

export interface ShopifyCredentials {
  company: ShopifyCompany;
  shop: string;
  clientId: string;
  clientSecret: string;
}

function env(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : undefined;
}

export function isShopifyCompany(value: unknown): value is ShopifyCompany {
  return value === "nerd" || value === "scarfme";
}

export function getShopifyCredentials(company: ShopifyCompany): ShopifyCredentials | null {
  const prefix = `SHOPIFY_${company.toUpperCase()}`;
  const shop = env(`${prefix}_SHOP`);
  const clientId = env(`${prefix}_CLIENT_ID`) ?? env("SHOPIFY_CLIENT_ID");
  const clientSecret = env(`${prefix}_CLIENT_SECRET`) ?? env("SHOPIFY_CLIENT_SECRET");
  if (!shop || !clientId || !clientSecret) return null;
  return { company, shop: shop.toLowerCase(), clientId, clientSecret };
}

/** Webhook chega com X-Shopify-Shop-Domain: descobre de qual empresa é. */
export function companyForShopDomain(domain: string | null | undefined): ShopifyCompany | null {
  const normalized = (domain ?? "").trim().toLowerCase();
  if (!normalized) return null;
  for (const company of SHOPIFY_COMPANIES) {
    if (getShopifyCredentials(company)?.shop === normalized) return company;
  }
  return null;
}

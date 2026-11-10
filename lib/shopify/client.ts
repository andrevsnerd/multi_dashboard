import "server-only";

import {
  SHOPIFY_API_VERSION,
  getShopifyCredentials,
  type ShopifyCompany,
} from "@/lib/shopify/config";

/**
 * Cliente da Admin API (GraphQL) do Shopify.
 *
 * Autenticação: apps do Dev Dashboard não têm token fixo (shpat_). O servidor troca
 * Client ID + Secret por um token de 24h (client credentials grant). Guardamos em memória
 * do processo e renovamos 10 min antes de vencer; um 401 descarta o token e tenta de novo.
 */

type CachedToken = { token: string; expiresAt: number };

const tokenCache = new Map<ShopifyCompany, CachedToken>();
const tokenInFlight = new Map<ShopifyCompany, Promise<string>>();

const RENEW_MARGIN_MS = 10 * 60 * 1000;
/**
 * O token vale 24h, mas guardamos no máximo 1h: escopo novo aprovado na loja (ex.:
 * read_all_orders, 10/11/2026) só aparece em token novo — assim entra em até 1h.
 */
const MAX_CACHE_MS = 60 * 60 * 1000;

export class ShopifyError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ShopifyError";
  }
}

function credentialsOrThrow(company: ShopifyCompany) {
  const creds = getShopifyCredentials(company);
  if (!creds) {
    throw new ShopifyError(
      `Shopify não configurado para ${company}: defina SHOPIFY_${company.toUpperCase()}_SHOP e as credenciais do app.`,
    );
  }
  return creds;
}

async function requestToken(company: ShopifyCompany): Promise<string> {
  const creds = credentialsOrThrow(company);
  const response = await fetch(`https://${creds.shop}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
    }),
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    // O Shopify devolve HTML no erro de OAuth: extrai só o <title> (ex.: app_not_installed).
    const title = /<title>([^<]+)<\/title>/i.exec(text)?.[1]?.trim();
    throw new ShopifyError(
      `Falha ao obter token do Shopify (${company}): HTTP ${response.status}${title ? ` — ${title}` : ""}`,
      response.status,
    );
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new ShopifyError(`Shopify (${company}) não devolveu access_token.`);
  const ttlMs = Math.min((json.expires_in ?? 86_400) * 1000, MAX_CACHE_MS + RENEW_MARGIN_MS);
  tokenCache.set(company, { token: json.access_token, expiresAt: Date.now() + ttlMs });
  return json.access_token;
}

/** Descarta o token em cache (próxima chamada pede um novo, com os escopos atuais). */
export function clearShopifyToken(company: ShopifyCompany): void {
  tokenCache.delete(company);
}

async function getAccessToken(company: ShopifyCompany): Promise<string> {
  const cached = tokenCache.get(company);
  if (cached && cached.expiresAt - RENEW_MARGIN_MS > Date.now()) return cached.token;
  let pending = tokenInFlight.get(company);
  if (!pending) {
    pending = requestToken(company).finally(() => tokenInFlight.delete(company));
    tokenInFlight.set(company, pending);
  }
  return pending;
}

type GraphqlResponse<T> = {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
  extensions?: {
    cost?: { throttleStatus?: { currentlyAvailable?: number; restoreRate?: number } };
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Executa uma query/mutation GraphQL. Repete em THROTTLED, 429 e 5xx (até 5 vezes). */
export async function shopifyGraphql<T>(
  company: ShopifyCompany,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const creds = credentialsOrThrow(company);
  let retriedAuth = false;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const token = await getAccessToken(company);
    const response = await fetch(
      `https://${creds.shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query, variables }),
        cache: "no-store",
      },
    );

    if (response.status === 401 && !retriedAuth) {
      tokenCache.delete(company);
      retriedAuth = true;
      continue;
    }
    if (response.status === 429 || response.status >= 500) {
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
      continue;
    }
    if (!response.ok) {
      throw new ShopifyError(
        `Shopify (${company}) HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`,
        response.status,
      );
    }

    const json = (await response.json()) as GraphqlResponse<T>;
    const throttled = json.errors?.some((e) => e.extensions?.code === "THROTTLED");
    if (throttled) {
      const restore = json.extensions?.cost?.throttleStatus?.restoreRate ?? 100;
      await sleep(Math.max(1000, Math.ceil((1000 / restore) * 1000)));
      continue;
    }
    if (json.errors?.length) {
      throw new ShopifyError(
        `Shopify (${company}) GraphQL: ${json.errors.map((e) => e.message).join(" | ")}`,
      );
    }
    if (!json.data) throw new ShopifyError(`Shopify (${company}) respondeu sem data.`);
    return json.data;
  }

  throw new ShopifyError(`Shopify (${company}) continuou limitando após várias tentativas.`, 429);
}

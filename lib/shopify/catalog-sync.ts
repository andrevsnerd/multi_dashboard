import "server-only";

import { getNeonSql } from "@/lib/db/neon";
import { shopifyGraphql } from "@/lib/shopify/client";
import type { ShopifyCompany } from "@/lib/shopify/config";
import {
  pruneShopifyVariants,
  upsertShopifyVariants,
  type ShopifyVariantRow,
} from "@/lib/shopify/catalog-store";
import {
  acquireShopifySyncLock,
  getShopifySyncState,
  saveShopifySyncState,
} from "@/lib/shopify/orders-store";

/**
 * Varredura do catálogo do Shopify (todas as variantes, de todos os status) para o Neon.
 * Retomável: guarda o cursor em "<empresa>#catalog" e continua na chamada seguinte.
 * Ao completar, apaga do espelho o que não apareceu na varredura (variante excluída).
 * Scarf Me ≈ 15 mil variantes = ~75 páginas de 200.
 */

const PAGE_SIZE = 200;

const QUERY = `query($first: Int!, $after: String) {
  productVariants(first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id sku barcode title inventoryQuantity
      selectedOptions { name value }
      product { id title status productType vendor }
    }
  }
}`;

type GqlVariant = {
  id: string;
  sku: string | null;
  barcode: string | null;
  title: string | null;
  inventoryQuantity: number | null;
  selectedOptions: Array<{ name: string; value: string }>;
  product: { id: string; title: string; status: string | null; productType: string | null; vendor: string | null };
};

const numericId = (gid: string) => gid.split("/").pop() ?? gid;
const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

function mapVariant(v: GqlVariant): ShopifyVariantRow {
  return {
    variant_id: numericId(v.id),
    product_id: numericId(v.product.id),
    product_title: v.product.title,
    product_status: v.product.status,
    product_type: clean(v.product.productType),
    vendor: clean(v.product.vendor),
    variant_title: clean(v.title),
    sku: clean(v.sku),
    barcode: clean(v.barcode),
    options: v.selectedOptions,
    inventory_qty: v.inventoryQuantity,
  };
}

export interface CatalogSyncResult {
  ran: boolean;
  reason?: string;
  variantes: number;
  complete: boolean;
  error?: string;
}

export async function runShopifyCatalogSync(
  company: ShopifyCompany,
  options: { budgetMs?: number; restart?: boolean } = {},
): Promise<CatalogSyncResult> {
  const key = `${company}#catalog` as const;
  const budgetMs = options.budgetMs ?? 40_000;
  const acquired = await acquireShopifySyncLock(key, Math.ceil(budgetMs / 1000) + 60, 0);
  if (!acquired) return { ran: false, reason: "em-execucao", variantes: 0, complete: false };

  const state = await getShopifySyncState(key);
  // query_since guarda o INÍCIO da varredura em curso (para o prune no final).
  let cursor = options.restart ? null : state?.cursor ?? null;
  // Hora do BANCO, nunca a desta máquina: o prune compara com synced_at = now() do Neon, e
  // relógio local adiantado apagava variantes válidas (10/11/2026: 1.661 → 861 na NERD).
  const [{ agora }] = (await getNeonSql().query(`SELECT now() AS agora`)) as Array<{ agora: Date | string }>;
  const sweepStart =
    cursor && state?.query_since ? new Date(state.query_since).toISOString() : new Date(agora).toISOString();

  const startedAt = Date.now();
  let count = 0;
  let complete = false;
  try {
    while (Date.now() - startedAt < budgetMs) {
      const data = await shopifyGraphql<{
        productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlVariant[] };
      }>(company, QUERY, { first: PAGE_SIZE, after: cursor });
      const page = data.productVariants;
      await upsertShopifyVariants(company, page.nodes.map(mapVariant));
      count += page.nodes.length;
      if (page.pageInfo.hasNextPage && page.pageInfo.endCursor) {
        cursor = page.pageInfo.endCursor;
        continue;
      }
      complete = true;
      cursor = null;
      break;
    }
    if (complete) await pruneShopifyVariants(company, sweepStart);
    await saveShopifySyncState(key, {
      query_since: complete ? null : sweepStart,
      cursor,
      last_updated_at: null,
      complete,
      error: null,
      ordersSynced: count,
    });
    return { ran: true, variantes: count, complete };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await saveShopifySyncState(key, {
      query_since: sweepStart,
      cursor,
      last_updated_at: null,
      complete: false,
      error: message.slice(0, 500),
      ordersSynced: count,
    });
    return { ran: true, variantes: count, complete: false, error: message };
  }
}

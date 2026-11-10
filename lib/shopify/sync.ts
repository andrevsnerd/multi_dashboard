import "server-only";

import { shopifyGraphql } from "@/lib/shopify/client";
import type { ShopifyCompany } from "@/lib/shopify/config";
import {
  acquireShopifySyncLock,
  deleteShopifyOrder,
  getShopifySyncState,
  saveShopifySyncState,
  upsertShopifyOrders,
  type ShopifyOrderLineRow,
  type ShopifyOrderRow,
  type ShopifyRefundRow,
} from "@/lib/shopify/orders-store";

/**
 * Sincronização Shopify → Neon.
 *
 * - Tempo real: webhook (orders/create, orders/updated, refunds/create, orders/delete)
 *   chama `syncShopifyOrderById`.
 * - Rede de segurança: `runShopifyIncrementalSync` varre pedidos por updated_at
 *   (ascendente) e guarda cursor, então é retomável — a carga inicial anda em várias
 *   execuções curtas sem estourar o tempo da função.
 */

// Custo medido: 15 pedidos × 30 itens = 147 pontos pedidos (teto por query = 1000).
const ORDERS_PAGE_SIZE = 50;
const LINES_PAGE_SIZE = 30;
/** Volta 2 min no updated_at ao reiniciar a varredura: cobre relógio e empate de segundo. */
const SINCE_OVERLAP_MS = 2 * 60 * 1000;

const MONEY = `shopMoney { amount }`;

const ORDER_FIELDS = `
  id name createdAt processedAt updatedAt cancelledAt test
  displayFinancialStatus displayFulfillmentStatus sourceName paymentGatewayNames
  subtotalPriceSet { ${MONEY} }
  currentSubtotalPriceSet { ${MONEY} }
  totalDiscountsSet { ${MONEY} }
  totalShippingPriceSet { ${MONEY} }
  totalRefundedSet { ${MONEY} }
  totalPriceSet { ${MONEY} }
  customer { id displayName email }
  shippingAddress { city provinceCode }
  refunds(first: 10) {
    id createdAt
    totalRefundedSet { ${MONEY} }
    refundShippingLines(first: 5) { nodes { subtotalAmountSet { ${MONEY} } } }
  }
  lineItems(first: ${LINES_PAGE_SIZE}) {
    pageInfo { hasNextPage endCursor }
    nodes { ...LineFields }
  }
`;

const LINE_FRAGMENT = `
  fragment LineFields on LineItem {
    id sku title variantTitle vendor quantity currentQuantity
    originalUnitPriceSet { ${MONEY} }
    discountAllocations { allocatedAmountSet { ${MONEY} } }
    variant { id barcode }
    product { id productType }
  }
`;

type Money = { shopMoney: { amount: string } } | null;

type GqlLine = {
  id: string;
  sku: string | null;
  title: string;
  variantTitle: string | null;
  vendor: string | null;
  quantity: number;
  currentQuantity: number;
  originalUnitPriceSet: Money;
  discountAllocations: Array<{ allocatedAmountSet: Money }>;
  variant: { id: string; barcode: string | null } | null;
  product: { id: string; productType: string | null } | null;
};

type GqlOrder = {
  id: string;
  name: string;
  createdAt: string;
  processedAt: string | null;
  updatedAt: string;
  cancelledAt: string | null;
  test: boolean;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  sourceName: string | null;
  paymentGatewayNames: string[];
  subtotalPriceSet: Money;
  currentSubtotalPriceSet: Money;
  totalDiscountsSet: Money;
  totalShippingPriceSet: Money;
  totalRefundedSet: Money;
  totalPriceSet: Money;
  customer: { id: string; displayName: string | null; email: string | null } | null;
  shippingAddress: { city: string | null; provinceCode: string | null } | null;
  refunds: Array<{
    id: string;
    createdAt: string;
    totalRefundedSet: Money;
    refundShippingLines: { nodes: Array<{ subtotalAmountSet: Money }> };
  }>;
  lineItems: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlLine[] };
};

const amount = (m: Money) => {
  const n = Number(m?.shopMoney?.amount ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
/** gid://shopify/Order/123 → "123" */
const numericId = (gid: string | null | undefined) => (gid ? gid.split("/").pop() ?? gid : null);
const clean = (s: string | null | undefined) => {
  const t = (s ?? "").trim();
  return t.length > 0 ? t : null;
};

function mapLine(orderId: string, line: GqlLine): ShopifyOrderLineRow {
  const unit = amount(line.originalUnitPriceSet);
  const discountTotal = line.discountAllocations.reduce((sum, d) => sum + amount(d.allocatedAmountSet), 0);
  // Desconto proporcional ao que sobrou (item devolvido/removido sai junto com o desconto dele).
  const share = line.quantity > 0 ? line.currentQuantity / line.quantity : 0;
  const discount = round2(discountTotal * share);
  return {
    order_id: orderId,
    line_id: numericId(line.id) ?? line.id,
    sku: clean(line.sku),
    barcode: clean(line.variant?.barcode),
    product_id: numericId(line.product?.id),
    variant_id: numericId(line.variant?.id),
    product_type: clean(line.product?.productType),
    vendor: clean(line.vendor),
    title: line.title,
    variant_title: clean(line.variantTitle),
    quantity: line.quantity,
    current_quantity: line.currentQuantity,
    unit_price: round2(unit),
    discount,
    net: round2(unit * line.currentQuantity - discount),
  };
}

function mapOrder(order: GqlOrder, lines: GqlLine[]) {
  const orderId = numericId(order.id) ?? order.id;
  const row: ShopifyOrderRow = {
    order_id: orderId,
    name: order.name,
    created_at: order.createdAt,
    processed_at: order.processedAt,
    updated_at: order.updatedAt,
    cancelled_at: order.cancelledAt,
    is_test: order.test,
    financial_status: order.displayFinancialStatus,
    fulfillment_status: order.displayFulfillmentStatus,
    source_name: order.sourceName,
    gateways: order.paymentGatewayNames.length ? order.paymentGatewayNames.join(", ") : null,
    subtotal: amount(order.subtotalPriceSet),
    current_subtotal: amount(order.currentSubtotalPriceSet),
    total_discounts: amount(order.totalDiscountsSet),
    total_shipping: amount(order.totalShippingPriceSet),
    total_refunded: amount(order.totalRefundedSet),
    total_price: amount(order.totalPriceSet),
    items_qty: lines.reduce((sum, l) => sum + l.currentQuantity, 0),
    customer_id: numericId(order.customer?.id),
    customer_name: clean(order.customer?.displayName),
    customer_email: clean(order.customer?.email),
    ship_city: clean(order.shippingAddress?.city),
    ship_state: clean(order.shippingAddress?.provinceCode),
  };
  // Devolução = valor reembolsado menos o frete reembolsado, na DATA do reembolso (mesma
  // conta do relatório de vendas do Shopify: inclui reembolso só em dinheiro, sem item).
  const refunds: ShopifyRefundRow[] = order.refunds.map((r) => {
    const shipping = r.refundShippingLines.nodes.reduce((sum, n) => sum + amount(n.subtotalAmountSet), 0);
    const total = amount(r.totalRefundedSet);
    return {
      order_id: orderId,
      refund_id: numericId(r.id) ?? r.id,
      created_at: r.createdAt,
      // Cancelamento de pedido não pago grava "reembolso" só de frete com total 0: não vira
      // devolução negativa.
      amount: round2(Math.max(0, total - shipping)),
      shipping: round2(shipping),
    };
  });
  return { row, lines: lines.map((l) => mapLine(orderId, l)), refunds };
}

/** Pedido com mais de 30 itens: busca o resto das linhas. */
async function completeLines(company: ShopifyCompany, order: GqlOrder): Promise<GqlLine[]> {
  const lines = [...order.lineItems.nodes];
  let cursor = order.lineItems.pageInfo.endCursor;
  let hasNext = order.lineItems.pageInfo.hasNextPage;
  while (hasNext && cursor) {
    const data = await shopifyGraphql<{
      order: { lineItems: GqlOrder["lineItems"] } | null;
    }>(
      company,
      `query($id: ID!, $after: String) {
         order(id: $id) {
           lineItems(first: 100, after: $after) {
             pageInfo { hasNextPage endCursor }
             nodes { ...LineFields }
           }
         }
       }
       ${LINE_FRAGMENT}`,
      { id: order.id, after: cursor },
    );
    const page = data.order?.lineItems;
    if (!page) break;
    lines.push(...page.nodes);
    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
  }
  return lines;
}

async function persist(company: ShopifyCompany, orders: GqlOrder[]) {
  const rows: ShopifyOrderRow[] = [];
  const lines: ShopifyOrderLineRow[] = [];
  const refunds: ShopifyRefundRow[] = [];
  for (const order of orders) {
    const allLines = order.lineItems.pageInfo.hasNextPage
      ? await completeLines(company, order)
      : order.lineItems.nodes;
    const mapped = mapOrder(order, allLines);
    rows.push(mapped.row);
    lines.push(...mapped.lines);
    refunds.push(...mapped.refunds);
  }
  await upsertShopifyOrders(company, rows, lines, refunds);
}

/** Busca um pedido no Shopify e grava (usado pelo webhook). */
export async function syncShopifyOrderById(company: ShopifyCompany, orderGidOrId: string | number) {
  const gid = String(orderGidOrId).startsWith("gid://")
    ? String(orderGidOrId)
    : `gid://shopify/Order/${orderGidOrId}`;
  const data = await shopifyGraphql<{ order: GqlOrder | null }>(
    company,
    `query($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } } ${LINE_FRAGMENT}`,
    { id: gid },
  );
  if (!data.order) {
    // Pedido sumiu (apagado) — tira do espelho.
    await deleteShopifyOrder(company, numericId(gid) ?? gid);
    return { found: false };
  }
  await persist(company, [data.order]);
  return { found: true, name: data.order.name };
}

export async function removeShopifyOrder(company: ShopifyCompany, orderId: string | number) {
  await deleteShopifyOrder(company, String(orderId));
}

export interface IncrementalSyncResult {
  ran: boolean;
  reason?: string;
  ordersSynced: number;
  complete: boolean;
  error?: string;
}

/**
 * Varredura incremental por updated_at. Para em `budgetMs` e guarda o cursor; a próxima
 * chamada continua de onde parou. Sem `force`, não roda se a última foi há < minIntervalSeconds.
 */
export async function runShopifyIncrementalSync(
  company: ShopifyCompany,
  options: { budgetMs?: number; minIntervalSeconds?: number } = {},
): Promise<IncrementalSyncResult> {
  const budgetMs = options.budgetMs ?? 20_000;
  const lockSeconds = Math.ceil(budgetMs / 1000) + 60;
  const acquired = await acquireShopifySyncLock(company, lockSeconds, options.minIntervalSeconds ?? 0);
  if (!acquired) return { ran: false, reason: "recente-ou-em-execucao", ordersSynced: 0, complete: false };

  const state = await getShopifySyncState(company);
  const startedAt = Date.now();
  let querySince = state?.query_since ? new Date(state.query_since).toISOString() : null;
  let cursor = state?.cursor ?? null;
  let maxUpdated: string | null = null;
  let synced = 0;
  let complete = false;

  try {
    while (Date.now() - startedAt < budgetMs) {
      const filter = querySince ? `updated_at:>='${querySince}'` : null;
      const data = await shopifyGraphql<{
        orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlOrder[] };
      }>(
        company,
        `query($first: Int!, $after: String, $query: String) {
           orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
             pageInfo { hasNextPage endCursor }
             nodes { ${ORDER_FIELDS} }
           }
         }
         ${LINE_FRAGMENT}`,
        { first: ORDERS_PAGE_SIZE, after: cursor, query: filter },
      );

      const page = data.orders;
      if (page.nodes.length > 0) {
        await persist(company, page.nodes);
        synced += page.nodes.length;
        const last = page.nodes[page.nodes.length - 1].updatedAt;
        if (!maxUpdated || last > maxUpdated) maxUpdated = last;
      }

      if (page.pageInfo.hasNextPage && page.pageInfo.endCursor) {
        cursor = page.pageInfo.endCursor;
        continue;
      }

      // Varredura chegou ao fim: a próxima começa do último updated_at visto (com folga).
      complete = true;
      const reference = maxUpdated ?? state?.last_updated_at ?? null;
      querySince = reference
        ? new Date(new Date(reference).getTime() - SINCE_OVERLAP_MS).toISOString()
        : querySince;
      cursor = null;
      break;
    }

    await saveShopifySyncState(company, {
      query_since: querySince,
      cursor,
      last_updated_at: maxUpdated,
      complete,
      error: null,
      ordersSynced: synced,
    });
    return { ran: true, ordersSynced: synced, complete };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Guarda o progresso até aqui (cursor da última página gravada) e o erro.
    await saveShopifySyncState(company, {
      query_since: querySince,
      cursor,
      last_updated_at: maxUpdated,
      complete: false,
      error: message.slice(0, 500),
      ordersSynced: synced,
    });
    return { ran: true, ordersSynced: synced, complete: false, error: message };
  }
}

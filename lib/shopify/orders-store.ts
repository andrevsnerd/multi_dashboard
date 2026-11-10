import "server-only";

import { getNeonSql } from "@/lib/db/neon";
import type { ShopifyCompany } from "@/lib/shopify/config";

/**
 * Espelho dos pedidos do Shopify no Neon. O dashboard lê daqui (rápido, sem gastar a
 * cota da API do Shopify); quem escreve é a sincronização (webhook + varredura por
 * updated_at). Upsert idempotente: reprocessar o mesmo pedido não duplica nada.
 */

export interface ShopifyOrderRow {
  order_id: string;
  name: string;
  created_at: string;
  processed_at: string | null;
  updated_at: string;
  cancelled_at: string | null;
  is_test: boolean;
  financial_status: string | null;
  fulfillment_status: string | null;
  source_name: string | null;
  gateways: string | null;
  /** Itens já com desconto, antes de devolução/edição. */
  subtotal: number;
  /** Itens com desconto, já sem os itens devolvidos/removidos = VENDA LÍQUIDA. */
  current_subtotal: number;
  total_discounts: number;
  total_shipping: number;
  total_refunded: number;
  total_price: number;
  items_qty: number;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  ship_city: string | null;
  ship_state: string | null;
}

export interface ShopifyOrderLineRow {
  order_id: string;
  line_id: string;
  sku: string | null;
  barcode: string | null;
  product_id: string | null;
  variant_id: string | null;
  product_type: string | null;
  vendor: string | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  current_quantity: number;
  unit_price: number;
  discount: number;
  /** unit_price × current_quantity − desconto proporcional. */
  net: number;
}

export interface ShopifyRefundRow {
  order_id: string;
  refund_id: string;
  created_at: string;
  /** Reembolsado − frete reembolsado = devolução de venda (abate no dia do reembolso). */
  amount: number;
  shipping: number;
}

export interface ShopifySyncState {
  company: ShopifyCompany;
  query_since: string | null;
  cursor: string | null;
  last_updated_at: string | null;
  last_run_at: string | null;
  last_complete_at: string | null;
  last_error: string | null;
  orders_synced: number;
}

// ---------------------------------------------------------------------------
// DDL — memoiza a promessa e tolera corrida entre instâncias (ver memória
// ensure-table-ddl-corrida: CREATE ... IF NOT EXISTS não é atômico).
// ---------------------------------------------------------------------------

const DDL = [
  `CREATE TABLE IF NOT EXISTS shopify_orders (
     company TEXT NOT NULL,
     order_id TEXT NOT NULL,
     name TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL,
     processed_at TIMESTAMPTZ,
     updated_at TIMESTAMPTZ NOT NULL,
     cancelled_at TIMESTAMPTZ,
     is_test BOOLEAN NOT NULL DEFAULT FALSE,
     financial_status TEXT,
     fulfillment_status TEXT,
     source_name TEXT,
     gateways TEXT,
     subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
     current_subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
     total_discounts NUMERIC(14,2) NOT NULL DEFAULT 0,
     total_shipping NUMERIC(14,2) NOT NULL DEFAULT 0,
     total_refunded NUMERIC(14,2) NOT NULL DEFAULT 0,
     total_price NUMERIC(14,2) NOT NULL DEFAULT 0,
     items_qty INTEGER NOT NULL DEFAULT 0,
     customer_id TEXT,
     customer_name TEXT,
     customer_email TEXT,
     ship_city TEXT,
     ship_state TEXT,
     synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (company, order_id)
   )`,
  `CREATE INDEX IF NOT EXISTS shopify_orders_company_created_idx
     ON shopify_orders (company, created_at)`,
  `CREATE TABLE IF NOT EXISTS shopify_order_lines (
     company TEXT NOT NULL,
     order_id TEXT NOT NULL,
     line_id TEXT NOT NULL,
     sku TEXT,
     barcode TEXT,
     product_id TEXT,
     variant_id TEXT,
     product_type TEXT,
     vendor TEXT,
     title TEXT NOT NULL,
     variant_title TEXT,
     quantity INTEGER NOT NULL DEFAULT 0,
     current_quantity INTEGER NOT NULL DEFAULT 0,
     unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
     discount NUMERIC(14,2) NOT NULL DEFAULT 0,
     net NUMERIC(14,2) NOT NULL DEFAULT 0,
     PRIMARY KEY (company, order_id, line_id)
   )`,
  `CREATE INDEX IF NOT EXISTS shopify_order_lines_sku_idx
     ON shopify_order_lines (company, sku)`,
  `CREATE TABLE IF NOT EXISTS shopify_refunds (
     company TEXT NOT NULL,
     refund_id TEXT NOT NULL,
     order_id TEXT NOT NULL,
     created_at TIMESTAMPTZ NOT NULL,
     amount NUMERIC(14,2) NOT NULL DEFAULT 0,
     shipping NUMERIC(14,2) NOT NULL DEFAULT 0,
     PRIMARY KEY (company, refund_id)
   )`,
  `CREATE INDEX IF NOT EXISTS shopify_refunds_company_created_idx
     ON shopify_refunds (company, created_at)`,
  `CREATE TABLE IF NOT EXISTS shopify_sync_state (
     company TEXT PRIMARY KEY,
     query_since TIMESTAMPTZ,
     cursor TEXT,
     last_updated_at TIMESTAMPTZ,
     last_run_at TIMESTAMPTZ,
     last_complete_at TIMESTAMPTZ,
     last_error TEXT,
     orders_synced INTEGER NOT NULL DEFAULT 0,
     locked_until TIMESTAMPTZ
   )`,
];

const TOLERATED_DDL_CODES = new Set(["23505", "42P07", "42710"]);

let ensurePromise: Promise<void> | null = null;

export function ensureShopifyTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      const sql = getNeonSql();
      for (const statement of DDL) {
        try {
          await sql.query(statement);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (!code || !TOLERATED_DDL_CODES.has(code)) throw error;
        }
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

/** Grava pedidos + itens + reembolsos (substitui itens/reembolsos do pedido, numa transação). */
export async function upsertShopifyOrders(
  company: ShopifyCompany,
  orders: ShopifyOrderRow[],
  lines: ShopifyOrderLineRow[],
  refunds: ShopifyRefundRow[],
): Promise<void> {
  if (orders.length === 0) return;
  await ensureShopifyTables();
  const sql = getNeonSql();
  const ids = orders.map((o) => o.order_id);

  await sql.transaction([
    sql.query(
      `INSERT INTO shopify_orders AS t (
         company, order_id, name, created_at, processed_at, updated_at, cancelled_at, is_test,
         financial_status, fulfillment_status, source_name, gateways, subtotal, current_subtotal,
         total_discounts, total_shipping, total_refunded, total_price, items_qty, customer_id,
         customer_name, customer_email, ship_city, ship_state, synced_at)
       SELECT $1, x.order_id, x.name, x.created_at, x.processed_at, x.updated_at, x.cancelled_at,
         x.is_test, x.financial_status, x.fulfillment_status, x.source_name, x.gateways, x.subtotal,
         x.current_subtotal, x.total_discounts, x.total_shipping, x.total_refunded, x.total_price,
         x.items_qty, x.customer_id, x.customer_name, x.customer_email, x.ship_city, x.ship_state,
         now()
       FROM jsonb_to_recordset($2::jsonb) AS x(
         order_id text, name text, created_at timestamptz, processed_at timestamptz,
         updated_at timestamptz, cancelled_at timestamptz, is_test boolean, financial_status text,
         fulfillment_status text, source_name text, gateways text, subtotal numeric,
         current_subtotal numeric, total_discounts numeric, total_shipping numeric,
         total_refunded numeric, total_price numeric, items_qty integer, customer_id text,
         customer_name text, customer_email text, ship_city text, ship_state text)
       ON CONFLICT (company, order_id) DO UPDATE SET
         name = EXCLUDED.name, created_at = EXCLUDED.created_at,
         processed_at = EXCLUDED.processed_at, updated_at = EXCLUDED.updated_at,
         cancelled_at = EXCLUDED.cancelled_at, is_test = EXCLUDED.is_test,
         financial_status = EXCLUDED.financial_status,
         fulfillment_status = EXCLUDED.fulfillment_status, source_name = EXCLUDED.source_name,
         gateways = EXCLUDED.gateways, subtotal = EXCLUDED.subtotal,
         current_subtotal = EXCLUDED.current_subtotal, total_discounts = EXCLUDED.total_discounts,
         total_shipping = EXCLUDED.total_shipping, total_refunded = EXCLUDED.total_refunded,
         total_price = EXCLUDED.total_price, items_qty = EXCLUDED.items_qty,
         customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name,
         customer_email = EXCLUDED.customer_email, ship_city = EXCLUDED.ship_city,
         ship_state = EXCLUDED.ship_state, synced_at = now()
       WHERE t.updated_at <= EXCLUDED.updated_at`,
      [company, JSON.stringify(orders)],
    ),
    sql.query(`DELETE FROM shopify_order_lines WHERE company = $1 AND order_id = ANY($2::text[])`, [
      company,
      ids,
    ]),
    sql.query(
      `INSERT INTO shopify_order_lines (
         company, order_id, line_id, sku, barcode, product_id, variant_id, product_type, vendor,
         title, variant_title, quantity, current_quantity, unit_price, discount, net)
       SELECT $1, x.order_id, x.line_id, x.sku, x.barcode, x.product_id, x.variant_id,
         x.product_type, x.vendor, x.title, x.variant_title, x.quantity, x.current_quantity,
         x.unit_price, x.discount, x.net
       FROM jsonb_to_recordset($2::jsonb) AS x(
         order_id text, line_id text, sku text, barcode text, product_id text, variant_id text,
         product_type text, vendor text, title text, variant_title text, quantity integer,
         current_quantity integer, unit_price numeric, discount numeric, net numeric)
       ON CONFLICT (company, order_id, line_id) DO NOTHING`,
      [company, JSON.stringify(lines)],
    ),
    sql.query(`DELETE FROM shopify_refunds WHERE company = $1 AND order_id = ANY($2::text[])`, [company, ids]),
    sql.query(
      `INSERT INTO shopify_refunds (company, refund_id, order_id, created_at, amount, shipping)
       SELECT $1, x.refund_id, x.order_id, x.created_at, x.amount, x.shipping
       FROM jsonb_to_recordset($2::jsonb) AS x(
         refund_id text, order_id text, created_at timestamptz, amount numeric, shipping numeric)
       ON CONFLICT (company, refund_id) DO NOTHING`,
      [company, JSON.stringify(refunds)],
    ),
  ]);
}

export async function deleteShopifyOrder(company: ShopifyCompany, orderId: string): Promise<void> {
  await ensureShopifyTables();
  const sql = getNeonSql();
  await sql.transaction([
    sql.query(`DELETE FROM shopify_refunds WHERE company = $1 AND order_id = $2`, [company, orderId]),
    sql.query(`DELETE FROM shopify_order_lines WHERE company = $1 AND order_id = $2`, [company, orderId]),
    sql.query(`DELETE FROM shopify_orders WHERE company = $1 AND order_id = $2`, [company, orderId]),
  ]);
}

// ---------------------------------------------------------------------------
// Estado da sincronização (cursor + trava simples entre instâncias)
// ---------------------------------------------------------------------------

export async function getShopifySyncState(company: ShopifyCompany): Promise<ShopifySyncState | null> {
  await ensureShopifyTables();
  const sql = getNeonSql();
  const rows = (await sql.query(
    `SELECT company, query_since, cursor, last_updated_at, last_run_at, last_complete_at,
            last_error, orders_synced
       FROM shopify_sync_state WHERE company = $1`,
    [company],
  )) as ShopifySyncState[];
  return rows[0] ?? null;
}

/**
 * Pega a trava da sincronização por `seconds`. Devolve false se outra execução está
 * rodando, ou (sem force) se a última rodou há menos de `minIntervalSeconds`.
 */
export async function acquireShopifySyncLock(
  company: ShopifyCompany,
  seconds: number,
  minIntervalSeconds: number,
): Promise<boolean> {
  await ensureShopifyTables();
  const sql = getNeonSql();
  await sql.query(
    `INSERT INTO shopify_sync_state (company) VALUES ($1) ON CONFLICT (company) DO NOTHING`,
    [company],
  );
  const rows = (await sql.query(
    `UPDATE shopify_sync_state
        SET locked_until = now() + make_interval(secs => $2)
      WHERE company = $1
        AND (locked_until IS NULL OR locked_until < now())
        AND (last_run_at IS NULL OR last_run_at < now() - make_interval(secs => $3))
      RETURNING company`,
    [company, seconds, minIntervalSeconds],
  )) as Array<{ company: string }>;
  return rows.length > 0;
}

export async function saveShopifySyncState(
  company: ShopifyCompany,
  patch: {
    query_since: string | null;
    cursor: string | null;
    last_updated_at: string | null;
    complete: boolean;
    error: string | null;
    ordersSynced: number;
  },
): Promise<void> {
  const sql = getNeonSql();
  await sql.query(
    `UPDATE shopify_sync_state
        SET query_since = $2, cursor = $3,
            last_updated_at = GREATEST(last_updated_at, $4::timestamptz),
            last_run_at = now(),
            last_complete_at = CASE WHEN $5 THEN now() ELSE last_complete_at END,
            last_error = $6,
            orders_synced = orders_synced + $7,
            locked_until = NULL
      WHERE company = $1`,
    [
      company,
      patch.query_since,
      patch.cursor,
      patch.last_updated_at,
      patch.complete,
      patch.error,
      patch.ordersSynced,
    ],
  );
}

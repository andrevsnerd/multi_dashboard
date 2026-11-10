import "server-only";

import { getNeonSql } from "@/lib/db/neon";
import type { ShopifyCompany } from "@/lib/shopify/config";
import { ensureShopifyTables } from "@/lib/shopify/orders-store";

/**
 * Consultas do Shopify para o MCP (mesmo espelho no Neon da página /shopify).
 * Mesma regra de venda da página: pedido pago (inclui parcial/reembolsado), não-teste,
 * venda = itens com desconto, SEM frete (frete sempre separado). Dia = dia em São Paulo.
 * Visão operacional do site — nunca somar com o faturamento do Linx.
 */

const PAGO = `('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')`;
const PENDENTE = `('PENDING','AUTHORIZED')`;

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/** [início, fim) do período em São Paulo (fim inclusivo no dia). */
function periodo(inicio: string, fim: string): [string, string] {
  const a = new Date(`${inicio}T00:00:00-03:00`);
  const b = new Date(new Date(`${fim}T00:00:00-03:00`).getTime() + 86_400_000);
  return [a.toISOString(), b.toISOString()];
}

export type StatusPedido = "pagos" | "pendentes" | "cancelados" | "todos";

function filtroStatus(status: StatusPedido) {
  if (status === "pagos") return `AND o.cancelled_at IS NULL AND o.financial_status IN ${PAGO}`;
  if (status === "pendentes") return `AND o.cancelled_at IS NULL AND o.financial_status IN ${PENDENTE}`;
  if (status === "cancelados") return `AND o.cancelled_at IS NOT NULL`;
  return "";
}

/** Lista de pedidos do período (mais recentes primeiro) + totais do filtro. */
export async function listarPedidosShopify(
  company: ShopifyCompany,
  f: { inicio: string; fim: string; status?: StatusPedido; busca?: string; uf?: string; limite?: number },
) {
  await ensureShopifyTables();
  const sql = getNeonSql();
  const [a, b] = periodo(f.inicio, f.fim);
  const params: unknown[] = [company, a, b];
  let extra = filtroStatus(f.status ?? "todos");
  if (f.busca?.trim()) {
    params.push(`%${f.busca.trim()}%`);
    extra += ` AND (o.name ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.customer_email ILIKE $${params.length}
                    OR EXISTS (SELECT 1 FROM shopify_order_lines l WHERE l.company = o.company AND l.order_id = o.order_id
                               AND (l.title ILIKE $${params.length} OR l.sku ILIKE $${params.length})))`;
  }
  if (f.uf?.trim()) {
    params.push(f.uf.trim().toUpperCase());
    extra += ` AND o.ship_state = $${params.length}`;
  }
  const where = `o.company = $1 AND NOT o.is_test AND o.created_at >= $2 AND o.created_at < $3 ${extra}`;
  const limite = Math.min(500, Math.max(1, f.limite ?? 100));
  const [tot] = (await sql.query(
    `SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(o.subtotal),0) AS venda, COALESCE(SUM(o.total_shipping),0) AS frete,
            COALESCE(SUM(o.total_price),0) AS total, COALESCE(SUM(o.items_qty),0)::int AS pecas
       FROM shopify_orders o WHERE ${where}`,
    params,
  )) as Array<Record<string, unknown>>;
  const rows = (await sql.query(
    `SELECT o.name, o.created_at, o.financial_status, o.fulfillment_status, o.cancelled_at, o.subtotal,
            o.current_subtotal, o.total_discounts, o.total_shipping, o.total_refunded, o.total_price, o.items_qty,
            o.customer_name, o.customer_email, o.ship_city, o.ship_state, o.gateways, o.source_name
       FROM shopify_orders o WHERE ${where}
      ORDER BY o.created_at DESC LIMIT ${limite}`,
    params,
  )) as Array<Record<string, unknown>>;
  return {
    totais: {
      pedidos: num(tot?.pedidos),
      venda: num(tot?.venda),
      frete: num(tot?.frete),
      totalComFrete: num(tot?.total),
      pecas: num(tot?.pecas),
    },
    truncado: num(tot?.pedidos) > rows.length,
    pedidos: rows.map((r) => ({
      pedido: r.name,
      data: iso(r.created_at),
      status: r.cancelled_at ? "CANCELADO" : r.financial_status,
      envio: r.fulfillment_status,
      venda: num(r.subtotal),
      vendaAtual: num(r.current_subtotal),
      desconto: num(r.total_discounts),
      frete: num(r.total_shipping),
      reembolsado: num(r.total_refunded),
      total: num(r.total_price),
      pecas: num(r.items_qty),
      cliente: r.customer_name ?? null,
      email: r.customer_email ?? null,
      cidade: r.ship_city ?? null,
      uf: r.ship_state ?? null,
      pagamento: r.gateways ?? null,
      canal: r.source_name ?? null,
    })),
  };
}

/** Um pedido completo: cabeçalho, itens (com o produto do Linx quando vinculado) e reembolsos. */
export async function buscarPedidoShopify(company: ShopifyCompany, numero: string) {
  await ensureShopifyTables();
  const sql = getNeonSql();
  const nome = numero.trim().startsWith("#") ? numero.trim() : `#${numero.trim()}`;
  const [o] = (await sql.query(
    `SELECT * FROM shopify_orders WHERE company = $1 AND name = $2`,
    [company, nome],
  )) as Array<Record<string, unknown>>;
  if (!o) return null;
  const itens = (await sql.query(
    `SELECT l.title, l.variant_title, l.sku, l.barcode, l.quantity, l.current_quantity, l.unit_price, l.discount, l.net,
            m.status AS vinculo, m.produto, m.cor_produto, m.desc_produto, m.desc_cor, m.codigo_barra
       FROM shopify_order_lines l
       LEFT JOIN shopify_variant_map m ON m.company = l.company AND m.variant_id = l.variant_id
      WHERE l.company = $1 AND l.order_id = $2
      ORDER BY l.net DESC`,
    [company, o.order_id],
  )) as Array<Record<string, unknown>>;
  const reembolsos = (await sql.query(
    `SELECT created_at, amount, shipping FROM shopify_refunds WHERE company = $1 AND order_id = $2 ORDER BY created_at`,
    [company, o.order_id],
  )) as Array<Record<string, unknown>>;
  return {
    pedido: o.name,
    data: iso(o.created_at),
    status: o.cancelled_at ? "CANCELADO" : o.financial_status,
    canceladoEm: iso(o.cancelled_at),
    envio: o.fulfillment_status,
    canal: o.source_name,
    pagamento: o.gateways,
    cliente: { nome: o.customer_name, email: o.customer_email, cidade: o.ship_city, uf: o.ship_state },
    valores: {
      venda: num(o.subtotal),
      vendaAtual: num(o.current_subtotal),
      desconto: num(o.total_discounts),
      frete: num(o.total_shipping),
      reembolsado: num(o.total_refunded),
      total: num(o.total_price),
    },
    itens: itens.map((i) => ({
      nomeShopify: i.title,
      variante: i.variant_title,
      sku: i.sku,
      qtde: num(i.quantity),
      qtdeAtual: num(i.current_quantity),
      precoUnit: num(i.unit_price),
      desconto: num(i.discount),
      venda: num(i.net),
      linx:
        i.vinculo === "vinculado" && i.produto
          ? { produto: i.produto, descricao: i.desc_produto, cor: i.cor_produto, descCor: i.desc_cor, codigoBarra: i.codigo_barra }
          : null,
    })),
    reembolsos: reembolsos.map((r) => ({ data: iso(r.created_at), valor: num(r.amount), frete: num(r.shipping) })),
  };
}

/** Clientes do período: quem comprou, quanto, e se é cliente novo ou recorrente. */
export async function rankingClientesShopify(
  company: ShopifyCompany,
  f: { inicio: string; fim: string; busca?: string; limite?: number },
) {
  await ensureShopifyTables();
  const sql = getNeonSql();
  const [a, b] = periodo(f.inicio, f.fim);
  const params: unknown[] = [company, a, b];
  let busca = "";
  if (f.busca?.trim()) {
    params.push(`%${f.busca.trim()}%`);
    busca = `AND (o.customer_name ILIKE $${params.length} OR o.customer_email ILIKE $${params.length})`;
  }
  const limite = Math.min(500, Math.max(1, f.limite ?? 50));
  const rows = (await sql.query(
    `WITH per AS (
       SELECT COALESCE(o.customer_id, LOWER(o.customer_email), o.customer_name) AS cli,
              MIN(o.customer_name) AS nome, MIN(o.customer_email) AS email,
              MIN(o.ship_city) AS cidade, MIN(o.ship_state) AS uf,
              COUNT(*)::int AS pedidos, SUM(o.subtotal) AS venda, SUM(o.total_shipping) AS frete,
              SUM(o.items_qty)::int AS pecas, MAX(o.created_at) AS ultimo
         FROM shopify_orders o
        WHERE o.company = $1 AND NOT o.is_test AND o.cancelled_at IS NULL AND o.financial_status IN ${PAGO}
          AND o.created_at >= $2 AND o.created_at < $3 ${busca}
        GROUP BY 1
     ), hist AS (
       SELECT COALESCE(o.customer_id, LOWER(o.customer_email), o.customer_name) AS cli,
              MIN(o.created_at) AS primeiro, COUNT(*)::int AS pedidos_total, SUM(o.subtotal) AS venda_total
         FROM shopify_orders o
        WHERE o.company = $1 AND NOT o.is_test AND o.cancelled_at IS NULL AND o.financial_status IN ${PAGO}
        GROUP BY 1
     )
     SELECT per.*, hist.primeiro, hist.pedidos_total, hist.venda_total
       FROM per LEFT JOIN hist USING (cli)
      ORDER BY per.venda DESC LIMIT ${limite}`,
    params,
  )) as Array<Record<string, unknown>>;
  const [tot] = (await sql.query(
    `SELECT COUNT(DISTINCT COALESCE(o.customer_id, LOWER(o.customer_email), o.customer_name))::int AS clientes
       FROM shopify_orders o
      WHERE o.company = $1 AND NOT o.is_test AND o.cancelled_at IS NULL AND o.financial_status IN ${PAGO}
        AND o.created_at >= $2 AND o.created_at < $3 ${busca}`,
    params,
  )) as Array<{ clientes: number }>;
  return {
    clientesNoPeriodo: tot?.clientes ?? 0,
    clientes: rows.map((r) => ({
      nome: r.nome ?? null,
      email: r.email ?? null,
      cidade: r.cidade ?? null,
      uf: r.uf ?? null,
      pedidos: num(r.pedidos),
      venda: num(r.venda),
      frete: num(r.frete),
      pecas: num(r.pecas),
      ultimoPedido: iso(r.ultimo),
      primeiroPedido: iso(r.primeiro),
      novo: r.primeiro ? new Date(String(iso(r.primeiro))) >= new Date(a) : null,
      historico: { pedidos: num(r.pedidos_total), venda: num(r.venda_total) },
    })),
  };
}

/**
 * Produtos vendidos no período. Item vinculado ao Linx sai na visão do Linx (produto × cor +
 * código de barras, somando todas as vitrines do Shopify); sem vínculo, nome do Shopify.
 * Frete do pedido rateado pelo valor de cada item.
 */
export async function produtosVendidosShopify(
  company: ShopifyCompany,
  f: { inicio: string; fim: string; busca?: string; limite?: number },
) {
  await ensureShopifyTables();
  const sql = getNeonSql();
  const [a, b] = periodo(f.inicio, f.fim);
  const params: unknown[] = [company, a, b];
  let busca = "";
  if (f.busca?.trim()) {
    params.push(`%${f.busca.trim()}%`);
    const p = `$${params.length}`;
    busca = `AND (l.title ILIKE ${p} OR l.sku ILIKE ${p} OR m.produto ILIKE ${p} OR m.desc_produto ILIKE ${p} OR m.codigo_barra ILIKE ${p})`;
  }
  const limite = Math.min(1000, Math.max(1, f.limite ?? 50));
  const rows = (await sql.query(
    `WITH linhas AS (
       SELECT l.product_id, l.title, l.sku, l.current_quantity, l.net, o.total_shipping,
              SUM(l.net) OVER (PARTITION BY l.order_id) AS net_pedido, l.order_id,
              CASE WHEN m.status = 'vinculado' AND m.produto IS NOT NULL THEN m.produto END AS linx_produto,
              CASE WHEN m.status = 'vinculado' AND m.produto IS NOT NULL THEN m.cor_produto END AS linx_cor,
              m.desc_produto, m.desc_cor, m.codigo_barra
         FROM shopify_order_lines l
         JOIN shopify_orders o ON o.company = l.company AND o.order_id = l.order_id
         LEFT JOIN shopify_variant_map m ON m.company = l.company AND m.variant_id = l.variant_id
        WHERE o.company = $1 AND NOT o.is_test AND o.financial_status IN ${PAGO}
          AND o.created_at >= $2 AND o.created_at < $3 AND l.current_quantity > 0 ${busca}
     )
     SELECT linx_produto, linx_cor, MIN(desc_produto) AS desc_produto, MIN(desc_cor) AS desc_cor,
            MIN(codigo_barra) AS codigo_barra, MIN(title) AS titulo,
            ARRAY_REMOVE(ARRAY_AGG(DISTINCT sku), NULL) AS skus,
            SUM(current_quantity)::int AS pecas, SUM(net) AS venda, COUNT(DISTINCT order_id)::int AS pedidos,
            SUM(CASE WHEN net_pedido > 0 THEN total_shipping * net / net_pedido ELSE 0 END) AS frete
       FROM linhas
      GROUP BY linx_produto, linx_cor,
               CASE WHEN linx_produto IS NULL THEN product_id END,
               CASE WHEN linx_produto IS NULL AND product_id IS NULL THEN title END
      ORDER BY venda DESC LIMIT ${limite}`,
    params,
  )) as Array<Record<string, unknown>>;
  return rows.map((r) =>
    r.linx_produto
      ? {
          linx: {
            produto: String(r.linx_produto).trim(),
            descricao: r.desc_produto,
            cor: r.linx_cor,
            descCor: r.desc_cor,
            codigoBarra: r.codigo_barra,
          },
          nomeShopify: r.titulo,
          pecas: num(r.pecas),
          pedidos: num(r.pedidos),
          venda: num(r.venda),
          frete: num(r.frete),
        }
      : {
          linx: null,
          nomeShopify: r.titulo,
          skus: r.skus,
          pecas: num(r.pecas),
          pedidos: num(r.pedidos),
          venda: num(r.venda),
          frete: num(r.frete),
        },
  );
}

import "server-only";

import { getNeonSql } from "@/lib/db/neon";
import type { ShopifyCompany } from "@/lib/shopify/config";
import { fetchShopifyResumo } from "@/lib/shopify/dashboard";

/**
 * Shopify na página da Black Friday (Scarf Me, pedido do dono em 10/11/2026): a loja
 * "E-COMMERCE" (notas do Linx, só em dia útil e depois do pedido) sai e entra
 * "SHOPIFY SCARFME" — venda no DIA DO PEDIDO, em tempo real.
 *
 * Cada linha do pedido vira o produto × cor do Linx pelo vínculo confirmado
 * (shopify_variant_map, status 'vinculado'). Conferido em 10/11/2026: 100% dos 127 itens da
 * Black que venderam no e-commerce estão vinculados; pedido × NF bate ao centavo em 98,6%.
 * Frete é do pedido: rateado entre os itens pelo valor de cada um (igual à página Shopify).
 */

export const LOJA_SHOPIFY: Record<ShopifyCompany, string> = { scarfme: "SHOPIFY SCARFME", nerd: "SHOPIFY NERD" };

const PAGO = `('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')`;

export interface ShopifyVendaItemDia {
  /** Dia do pedido em São Paulo (YYYY-MM-DD). */
  ymd: string;
  produto: string;
  cor: string;
  corDesc: string | null;
  /** Venda líquida do item (sem frete). */
  v: number;
  /** Frete do pedido rateado para o item. */
  f: number;
  q: number;
}

/** Venda por dia × produto × cor do Linx, só dos produtos pedidos, de `inicio` até agora. */
export async function fetchShopifyVendasBlack(
  company: ShopifyCompany,
  produtos: string[],
  inicio: string,
): Promise<ShopifyVendaItemDia[]> {
  if (produtos.length === 0) return [];
  const sql = getNeonSql();
  const rows = (await sql.query(
    `WITH linhas AS (
       SELECT to_char(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS ymd,
              TRIM(m.produto) AS produto, TRIM(m.cor_produto) AS cor, m.desc_cor,
              l.net, l.current_quantity AS q, o.total_shipping,
              SUM(l.net) OVER (PARTITION BY l.order_id) AS net_pedido
         FROM shopify_order_lines l
         JOIN shopify_orders o ON o.company = l.company AND o.order_id = l.order_id
         JOIN shopify_variant_map m ON m.company = l.company AND m.variant_id = l.variant_id
        WHERE l.company = $1 AND NOT o.is_test AND o.financial_status IN ${PAGO}
          AND o.created_at >= ($2::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
          AND l.current_quantity > 0
          AND m.status = 'vinculado' AND m.produto IS NOT NULL
     )
     SELECT ymd, produto, cor, MIN(desc_cor) AS cor_desc, SUM(net)::float AS v, SUM(q)::int AS q,
            SUM(CASE WHEN net_pedido > 0 THEN total_shipping * net / net_pedido ELSE 0 END)::float AS f
       FROM linhas
      WHERE UPPER(produto) = ANY($3::text[])
      GROUP BY ymd, produto, cor`,
    [company, inicio, produtos.map((p) => p.trim().toUpperCase())],
  )) as Array<{ ymd: string; produto: string; cor: string | null; cor_desc: string | null; v: number; q: number; f: number }>;
  return rows.map((r) => ({
    ymd: r.ymd,
    produto: r.produto,
    cor: r.cor ?? "",
    corDesc: r.cor_desc,
    v: Number(r.v ?? 0),
    f: Number(r.f ?? 0),
    q: Number(r.q ?? 0),
  }));
}

/** Venda total da loja Shopify no período (denominador do "% da venda da loja"). */
export async function fetchShopifyTotalLoja(company: ShopifyCompany, inicio: string, fim: string) {
  const r = await fetchShopifyResumo(company, inicio, fim);
  return {
    vendas: r.kpis.venda,
    frete: r.kpis.freteLiquido,
    qtde: r.kpis.itens,
    tickets: r.kpis.pedidos,
  };
}

import "server-only";

import { getNeonSql } from "@/lib/db/neon";
import type { ShopifyCompany } from "@/lib/shopify/config";
import { ensureShopifyTables, getShopifySyncState } from "@/lib/shopify/orders-store";

/**
 * Leitura da página Shopify (tempo real), a partir do espelho no Neon.
 *
 * Definição de VENDA (Shopify) = mesma conta do relatório de vendas do Shopify (net sales):
 *   Σ subtotal (itens com desconto, SEM frete) dos pedidos CRIADOS no período
 *   − Σ devoluções (reembolso − frete reembolsado) FEITAS no período.
 * Cada parte na sua data, como a troca no Linx abate no dia da troca. Conferido em
 * 10/11/2026 contra o ShopifyQL (01–09/11).
 * Pedido PAGO (inclui parcial/reembolsado) entra no dia em que foi feito, mesmo que
 * depois seja cancelado: o cancelamento com estorno sai como devolução no dia do estorno.
 * Pedido que nunca foi pago (Pix/boleto expirado e cancelado) não entra em momento nenhum;
 * pendentes ainda abertos ficam à parte. Pedidos de teste nunca entram.
 *
 * Diferença conhecida para o relatório do Shopify (fechada ao centavo em 01–09/11 e
 * 12–31/10/2026): o Shopify também conta pedido NÃO pago na criação e o estorna no
 * cancelamento, e lança item adicionado a pedido antigo (edição) no dia da edição —
 * aqui a edição fica na data do pedido.
 * É uma visão operacional: NUNCA somar com o faturamento do Linx.
 */

const PAID = `('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')`;
const PENDING = `('PENDING','AUTHORIZED')`;
const VALID = `o.company = $1 AND NOT o.is_test`;
const SALE = `${VALID} AND o.financial_status IN ${PAID}`;

const DAY_MS = 86_400_000;
/** São Paulo não tem horário de verão desde 2019: offset fixo. */
const BRT_OFFSET = "-03:00";

export interface ShopifyKpis {
  /** Venda líquida = vendaPedidos − devolucoes. */
  venda: number;
  /** Σ subtotal dos pedidos criados no período (antes das devoluções). */
  vendaPedidos: number;
  pedidos: number;
  ticketMedio: number;
  itens: number;
  descontos: number;
  /** Frete cobrado nos pedidos do período (data do pedido). */
  frete: number;
  /** Frete devolvido nos estornos do período (data do estorno). */
  freteEstornado: number;
  /** frete − freteEstornado: é o que entra em "venda + frete" (= "Vendas totais" do Shopify). */
  freteLiquido: number;
  devolucoes: number;
  pendentesQtd: number;
  pendentesValor: number;
  canceladosQtd: number;
  canceladosValor: number;
  clientes: number;
}

export interface ShopifySeriePoint {
  /** Hora (0–23) quando o período é um dia só; senão a data YYYY-MM-DD. */
  key: string;
  label: string;
  venda: number;
  pedidos: number;
  /** Frete líquido do bucket (pedido − estorno de frete). */
  frete: number;
  vendaAnterior: number;
  freteAnterior: number;
}

export interface ShopifyPedido {
  orderId: string;
  name: string;
  createdAt: string;
  status: string | null;
  fulfillment: string | null;
  cancelado: boolean;
  venda: number;
  frete: number;
  itens: number;
  cliente: string | null;
  cidade: string | null;
  uf: string | null;
  pagamento: string | null;
}

export interface ShopifyTopProduto {
  productId: string | null;
  /** Vínculo confirmado no Linx (null = sem vínculo: mostrar o nome do Shopify). */
  linx: { produto: string; cor: string | null; descProduto: string | null; descCor: string | null; codigoBarra: string | null } | null;
  titulo: string;
  skus: string[];
  tipo: string | null;
  qtde: number;
  venda: number;
  /** Frete do pedido rateado pelo valor de cada item (frete é do pedido, não do produto). */
  frete: number;
}

export interface ShopifyRanking {
  chave: string;
  pedidos: number;
  venda: number;
  frete: number;
}

export interface ShopifyResumo {
  periodo: { start: string; end: string; parcial: boolean; porHora: boolean };
  anterior: { start: string; end: string };
  kpis: ShopifyKpis;
  kpisAnterior: ShopifyKpis;
  serie: ShopifySeriePoint[];
  pedidos: ShopifyPedido[];
  topProdutos: ShopifyTopProduto[];
  estados: ShopifyRanking[];
  pagamentos: ShopifyRanking[];
  sync: {
    ultimaExecucao: string | null;
    ultimaCompleta: string | null;
    ultimoPedidoAtualizado: string | null;
    erro: string | null;
    cargaInicialCompleta: boolean;
  };
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function brtMidnight(date: string): Date {
  return new Date(`${date}T00:00:00${BRT_OFFSET}`);
}

function brtDateString(d: Date): string {
  return new Date(d.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function todayBrt(): string {
  return brtDateString(new Date());
}

async function fetchKpis(company: ShopifyCompany, from: Date, to: Date): Promise<ShopifyKpis> {
  const sql = getNeonSql();
  const ok = `o.financial_status IN ${PAID}`;
  const rows = (await sql.query(
    `WITH ped AS (
       SELECT
         COALESCE(SUM(o.subtotal) FILTER (WHERE ${ok}), 0) AS venda_pedidos,
         COUNT(*) FILTER (WHERE ${ok}) AS pedidos,
         COALESCE(SUM(o.items_qty) FILTER (WHERE ${ok}), 0) AS itens,
         COALESCE(SUM(o.total_discounts) FILTER (WHERE ${ok}), 0) AS descontos,
         COALESCE(SUM(o.total_shipping) FILTER (WHERE ${ok}), 0) AS frete,
         COUNT(*) FILTER (WHERE o.cancelled_at IS NULL AND o.financial_status IN ${PENDING}) AS pendentes_qtd,
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.cancelled_at IS NULL AND o.financial_status IN ${PENDING}), 0) AS pendentes_valor,
         COUNT(*) FILTER (WHERE o.cancelled_at IS NOT NULL) AS cancelados_qtd,
         COALESCE(SUM(o.subtotal) FILTER (WHERE o.cancelled_at IS NOT NULL), 0) AS cancelados_valor,
         COUNT(DISTINCT COALESCE(o.customer_id, o.customer_email)) FILTER (WHERE ${ok}) AS clientes
       FROM shopify_orders o
       WHERE ${VALID} AND o.created_at >= $2 AND o.created_at < $3
     ), dev AS (
       SELECT COALESCE(SUM(r.amount), 0) AS devolucoes, COALESCE(SUM(r.shipping), 0) AS frete_estornado
         FROM shopify_refunds r
         JOIN shopify_orders o ON o.company = r.company AND o.order_id = r.order_id
        WHERE ${SALE} AND r.company = $1 AND r.created_at >= $2 AND r.created_at < $3
     )
     SELECT * FROM ped, dev`,
    [company, from.toISOString(), to.toISOString()],
  )) as Array<Record<string, unknown>>;
  const r = rows[0] ?? {};
  const vendaPedidos = num(r.venda_pedidos);
  const devolucoes = num(r.devolucoes);
  const venda = vendaPedidos - devolucoes;
  const pedidos = num(r.pedidos);
  return {
    venda,
    vendaPedidos,
    pedidos,
    ticketMedio: pedidos > 0 ? venda / pedidos : 0,
    itens: num(r.itens),
    descontos: num(r.descontos),
    frete: num(r.frete),
    freteEstornado: num(r.frete_estornado),
    freteLiquido: num(r.frete) - num(r.frete_estornado),
    devolucoes,
    pendentesQtd: num(r.pendentes_qtd),
    pendentesValor: num(r.pendentes_valor),
    canceladosQtd: num(r.cancelados_qtd),
    canceladosValor: num(r.cancelados_valor),
    clientes: num(r.clientes),
  };
}

async function fetchSerie(
  company: ShopifyCompany,
  from: Date,
  to: Date,
  porHora: boolean,
): Promise<Map<string, { venda: number; pedidos: number; frete: number }>> {
  const sql = getNeonSql();
  const bucket = (col: string) =>
    porHora
      ? `EXTRACT(HOUR FROM ${col} AT TIME ZONE 'America/Sao_Paulo')::int::text`
      : `to_char(${col} AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`;
  // Pedido entra na hora/dia em que foi criado; devolução sai na hora/dia do reembolso.
  const rows = (await sql.query(
    `SELECT k, SUM(v) AS venda, SUM(p) AS pedidos, SUM(f) AS frete FROM (
       SELECT ${bucket("o.created_at")} AS k, o.subtotal AS v, 1 AS p, o.total_shipping AS f
         FROM shopify_orders o
        WHERE ${SALE} AND o.created_at >= $2 AND o.created_at < $3
       UNION ALL
       SELECT ${bucket("r.created_at")} AS k, -r.amount AS v, 0 AS p, -r.shipping AS f
         FROM shopify_refunds r
         JOIN shopify_orders o ON o.company = r.company AND o.order_id = r.order_id
        WHERE ${SALE} AND r.company = $1 AND r.created_at >= $2 AND r.created_at < $3
     ) t
     GROUP BY k`,
    [company, from.toISOString(), to.toISOString()],
  )) as Array<{ k: string; venda: unknown; pedidos: unknown; frete: unknown }>;
  return new Map(rows.map((r) => [r.k, { venda: num(r.venda), pedidos: num(r.pedidos), frete: num(r.frete) }]));
}

export async function fetchShopifyResumo(
  company: ShopifyCompany,
  startInput: string,
  endInput: string,
): Promise<ShopifyResumo> {
  await ensureShopifyTables();
  const sql = getNeonSql();

  const start = isoDate.test(startInput) ? startInput : todayBrt();
  let end = isoDate.test(endInput) ? endInput : start;
  if (end < start) end = start;

  const dias = Math.round((brtMidnight(end).getTime() - brtMidnight(start).getTime()) / DAY_MS) + 1;
  const porHora = dias === 1;
  const from = brtMidnight(start);
  const fullTo = new Date(brtMidnight(end).getTime() + DAY_MS);
  const now = new Date();
  const parcial = fullTo > now;
  // Período em andamento: compara com o anterior cortado no mesmo ponto (ex.: hoje até
  // agora × ontem até a mesma hora), senão a comparação favorece o período fechado.
  const to = parcial ? now : fullTo;
  const shift = dias * DAY_MS;
  const prevFrom = new Date(from.getTime() - shift);
  const prevTo = new Date(to.getTime() - shift);

  const [kpis, kpisAnterior, serieAtual, serieAnterior, pedidosRows, topRows, estadosRows, pagRows, state] =
    await Promise.all([
      fetchKpis(company, from, to),
      fetchKpis(company, prevFrom, prevTo),
      fetchSerie(company, from, to, porHora),
      fetchSerie(company, prevFrom, prevTo, porHora),
      sql.query(
        `SELECT o.order_id, o.name, o.created_at, o.financial_status, o.fulfillment_status,
                o.cancelled_at, o.current_subtotal, o.total_shipping, o.items_qty, o.customer_name,
                o.ship_city, o.ship_state, o.gateways
           FROM shopify_orders o
          WHERE ${VALID} AND o.created_at >= $2 AND o.created_at < $3
          ORDER BY o.created_at DESC
          LIMIT 40`,
        [company, from.toISOString(), to.toISOString()],
      ) as Promise<Array<Record<string, unknown>>>,
      sql.query(
        // Frete é do pedido: rateado entre os itens pelo valor de cada um.
        // Item com vínculo confirmado no Linx aparece como no Linx (produto × cor + código de
        // barras) e soma todas as vitrines do Shopify daquele item; sem vínculo, nome do Shopify.
        `WITH linhas AS (
           SELECT l.product_id, l.title, l.product_type, l.sku, l.current_quantity, l.net,
                  o.total_shipping, SUM(l.net) OVER (PARTITION BY l.order_id) AS net_pedido,
                  CASE WHEN m.status = 'vinculado' AND m.produto IS NOT NULL THEN m.produto END AS linx_produto,
                  CASE WHEN m.status = 'vinculado' AND m.produto IS NOT NULL THEN m.cor_produto END AS linx_cor,
                  m.desc_produto, m.desc_cor, m.codigo_barra
             FROM shopify_order_lines l
             JOIN shopify_orders o ON o.company = l.company AND o.order_id = l.order_id
             LEFT JOIN shopify_variant_map m ON m.company = l.company AND m.variant_id = l.variant_id
            WHERE ${SALE} AND o.created_at >= $2 AND o.created_at < $3 AND l.current_quantity > 0
         )
         SELECT CASE WHEN linx_produto IS NULL THEN product_id END AS product_id,
                linx_produto, linx_cor, MIN(desc_produto) AS desc_produto, MIN(desc_cor) AS desc_cor,
                MIN(codigo_barra) AS codigo_barra,
                MIN(title) AS titulo, MIN(product_type) AS tipo,
                ARRAY_REMOVE(ARRAY_AGG(DISTINCT sku), NULL) AS skus,
                SUM(current_quantity) AS qtde, SUM(net) AS venda,
                SUM(CASE WHEN net_pedido > 0 THEN total_shipping * net / net_pedido ELSE 0 END) AS frete
           FROM linhas
          GROUP BY linx_produto, linx_cor,
                   CASE WHEN linx_produto IS NULL THEN product_id END,
                   CASE WHEN linx_produto IS NULL AND product_id IS NULL THEN title END
          ORDER BY venda DESC
          LIMIT 20`,
        [company, from.toISOString(), to.toISOString()],
      ) as Promise<Array<Record<string, unknown>>>,
      sql.query(
        `SELECT COALESCE(o.ship_state, '—') AS chave, COUNT(*) AS pedidos, SUM(o.subtotal) AS venda, SUM(o.total_shipping) AS frete
           FROM shopify_orders o
          WHERE ${SALE} AND o.created_at >= $2 AND o.created_at < $3
          GROUP BY 1 ORDER BY venda DESC LIMIT 12`,
        [company, from.toISOString(), to.toISOString()],
      ) as Promise<Array<Record<string, unknown>>>,
      sql.query(
        `SELECT COALESCE(o.gateways, '—') AS chave, COUNT(*) AS pedidos, SUM(o.subtotal) AS venda, SUM(o.total_shipping) AS frete
           FROM shopify_orders o
          WHERE ${SALE} AND o.created_at >= $2 AND o.created_at < $3
          GROUP BY 1 ORDER BY venda DESC LIMIT 8`,
        [company, from.toISOString(), to.toISOString()],
      ) as Promise<Array<Record<string, unknown>>>,
      getShopifySyncState(company),
    ]);

  const serie: ShopifySeriePoint[] = [];
  if (porHora) {
    const lastHour = parcial ? Number(new Date(now.getTime() - 3 * 3600_000).toISOString().slice(11, 13)) : 23;
    for (let h = 0; h <= lastHour; h += 1) {
      const k = String(h);
      serie.push({
        key: k,
        label: `${String(h).padStart(2, "0")}h`,
        venda: serieAtual.get(k)?.venda ?? 0,
        pedidos: serieAtual.get(k)?.pedidos ?? 0,
        frete: serieAtual.get(k)?.frete ?? 0,
        vendaAnterior: serieAnterior.get(k)?.venda ?? 0,
        freteAnterior: serieAnterior.get(k)?.frete ?? 0,
      });
    }
  } else {
    for (let i = 0; i < dias; i += 1) {
      const day = brtDateString(new Date(from.getTime() + i * DAY_MS + 12 * 3600_000));
      if (parcial && day > todayBrt()) break;
      const prevDay = brtDateString(new Date(prevFrom.getTime() + i * DAY_MS + 12 * 3600_000));
      serie.push({
        key: day,
        label: `${day.slice(8, 10)}/${day.slice(5, 7)}`,
        venda: serieAtual.get(day)?.venda ?? 0,
        pedidos: serieAtual.get(day)?.pedidos ?? 0,
        frete: serieAtual.get(day)?.frete ?? 0,
        vendaAnterior: serieAnterior.get(prevDay)?.venda ?? 0,
        freteAnterior: serieAnterior.get(prevDay)?.frete ?? 0,
      });
    }
  }

  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

  return {
    periodo: { start, end, parcial, porHora },
    anterior: { start: brtDateString(prevFrom), end: brtDateString(new Date(prevTo.getTime() - 1)) },
    kpis,
    kpisAnterior,
    serie,
    pedidos: pedidosRows.map((r) => ({
      orderId: String(r.order_id),
      name: String(r.name),
      createdAt: iso(r.created_at) ?? "",
      status: (r.financial_status as string) ?? null,
      fulfillment: (r.fulfillment_status as string) ?? null,
      cancelado: r.cancelled_at != null,
      venda: num(r.current_subtotal),
      frete: num(r.total_shipping),
      itens: num(r.items_qty),
      cliente: (r.customer_name as string) ?? null,
      cidade: (r.ship_city as string) ?? null,
      uf: (r.ship_state as string) ?? null,
      pagamento: (r.gateways as string) ?? null,
    })),
    topProdutos: topRows.map((r) => ({
      productId: (r.product_id as string) ?? null,
      linx: r.linx_produto
        ? {
            produto: String(r.linx_produto).trim(),
            cor: (r.linx_cor as string | null)?.trim() ?? null,
            descProduto: (r.desc_produto as string | null)?.trim() ?? null,
            descCor: (r.desc_cor as string | null)?.trim() ?? null,
            codigoBarra: (r.codigo_barra as string | null) ?? null,
          }
        : null,
      titulo: String(r.titulo ?? "—"),
      skus: Array.isArray(r.skus) ? (r.skus as string[]) : [],
      tipo: (r.tipo as string) ?? null,
      qtde: num(r.qtde),
      venda: num(r.venda),
      frete: num(r.frete),
    })),
    estados: estadosRows.map((r) => ({ chave: String(r.chave), pedidos: num(r.pedidos), venda: num(r.venda), frete: num(r.frete) })),
    pagamentos: pagRows.map((r) => ({ chave: String(r.chave), pedidos: num(r.pedidos), venda: num(r.venda), frete: num(r.frete) })),
    sync: {
      ultimaExecucao: iso(state?.last_run_at),
      ultimaCompleta: iso(state?.last_complete_at),
      ultimoPedidoAtualizado: iso(state?.last_updated_at),
      erro: state?.last_error ?? null,
      cargaInicialCompleta: !!state?.last_complete_at,
    },
  };
}

import "server-only";

import { query } from "@/lib/db/connection";
import { getNeonSql } from "@/lib/db/neon";
import type { ShopifyCompany } from "@/lib/shopify/config";
import { fetchShopifyKpis, fetchShopifySerie } from "@/lib/shopify/dashboard";
import { ensureShopifyTables } from "@/lib/shopify/orders-store";
import { normalizeRangeForQuery, shiftRangeByMonths } from "@/lib/utils/date";
import type { CategoryRevenue, DateRangeInput, ProductRevenue } from "@/types/dashboard";

/**
 * Parte SHOPIFY da tela principal (dashboard) — pedido do dono em 10–11/11/2026.
 * Scarf Me: substitui o E-COMMERCE do Linx. NERD: entra como filial nova.
 * Não toca em nada das filiais do Linx: a rota soma esta parte ao que o Linx já devolve.
 *
 * Regras (as mesmas da página Shopify):
 *   - pedido pago (inclui parcial/reembolsado), não-teste, no dia do PEDIDO (São Paulo);
 *   - sem filtro de linha: venda = Σ subtotal − devoluções no dia (fetchShopifyKpis/Serie);
 *     com filtro de linha (ex.: NERD "Eletrônicos"): soma por item, só itens vinculados
 *     ao Linx cuja LINHA está no filtro (item sem vínculo não tem linha → fica de fora);
 *   - frete: separado; com `comFrete` entra somado (frete do pedido rateado por item);
 *   - item vinculado ao Linx aparece como o produto do Linx (código + descrição); sem
 *     vínculo, com o nome do Shopify (código "SHOPIFY:<id>").
 *   - período anterior = mesmos dias do mês anterior (igual ao e-commerce do Linx).
 */

const PAGO = `('PAID','PARTIALLY_PAID','PARTIALLY_REFUNDED','REFUNDED')`;
const esc = (s: string) => s.replace(/'/g, "''");
const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

export interface ParteShopify {
  receita: { atual: number; anterior: number };
  pecas: { atual: number; anterior: number };
  pedidos: { atual: number; anterior: number };
  frete: { atual: number; anterior: number };
  ultimaVenda: Date | null;
  /** YYYY-MM-DD → receita do dia (já com frete quando comFrete). */
  porDia: Map<string, number>;
  /** Todos os produtos do período (sem corte), receita já com frete quando comFrete. */
  produtos: ProductRevenue[];
  categorias: CategoryRevenue[];
}

interface Linha {
  ymd: string;
  order_id: string;
  product_id: string | null;
  title: string;
  produto: string | null;
  net: number;
  q: number;
  f: number;
  created_at: string;
}

function limitesBrt(range: { start: Date; end: Date }) {
  // normalizeRangeForQuery devolve 00:00 UTC do 1º dia e o dia seguinte ao último (exclusivo):
  // as datas são as do usuário; o Shopify é cortado nesses dias no relógio de São Paulo.
  const a = range.start.toISOString().slice(0, 10);
  const b = range.end.toISOString().slice(0, 10);
  return { from: new Date(`${a}T00:00:00-03:00`), to: new Date(`${b}T00:00:00-03:00`) };
}

async function linhasDoPeriodo(company: ShopifyCompany, from: Date, to: Date): Promise<Linha[]> {
  const sql = getNeonSql();
  const rows = (await sql.query(
    `WITH l AS (
       SELECT to_char(o.created_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD') AS ymd,
              l.order_id, l.product_id, l.title, o.created_at,
              CASE WHEN m.status = 'vinculado' AND m.produto IS NOT NULL THEN TRIM(m.produto) END AS produto,
              l.net, l.current_quantity AS q, o.total_shipping,
              SUM(l.net) OVER (PARTITION BY l.order_id) AS net_pedido
         FROM shopify_order_lines l
         JOIN shopify_orders o ON o.company = l.company AND o.order_id = l.order_id
         LEFT JOIN shopify_variant_map m ON m.company = l.company AND m.variant_id = l.variant_id
        WHERE o.company = $1 AND NOT o.is_test AND o.financial_status IN ${PAGO}
          AND o.created_at >= $2 AND o.created_at < $3 AND l.current_quantity > 0
     )
     SELECT ymd, order_id, product_id, title, produto, created_at, net::float AS net, q::int AS q,
            (CASE WHEN net_pedido > 0 THEN total_shipping * net / net_pedido ELSE 0 END)::float AS f
       FROM l`,
    [company, from.toISOString(), to.toISOString()],
  )) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    ymd: String(r.ymd),
    order_id: String(r.order_id),
    product_id: (r.product_id as string) ?? null,
    title: String(r.title ?? ""),
    produto: (r.produto as string) ?? null,
    net: Number(r.net ?? 0),
    q: Number(r.q ?? 0),
    f: Number(r.f ?? 0),
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** Cadastro do Linx dos produtos vinculados: descrição, grupo (categoria) e linha. */
async function cadastroLinx(produtos: string[]) {
  const out = new Map<string, { desc: string; grupo: string; linha: string }>();
  const lista = [...new Set(produtos.map(up))].filter(Boolean);
  for (let i = 0; i < lista.length; i += 500) {
    const rows = await query<{ PRODUTO: string; DESC_PRODUTO: string | null; GRUPO_PRODUTO: string | null; LINHA: string | null }>(
      `SELECT LTRIM(RTRIM(PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(DESC_PRODUTO,''))) AS DESC_PRODUTO,
              LTRIM(RTRIM(ISNULL(GRUPO_PRODUTO,''))) AS GRUPO_PRODUTO, LTRIM(RTRIM(ISNULL(LINHA,''))) AS LINHA
         FROM PRODUTOS WHERE PRODUTO IN (${lista.slice(i, i + 500).map((p) => `'${esc(p)}'`).join(",")})`,
    );
    for (const r of rows) out.set(up(r.PRODUTO), { desc: r.DESC_PRODUTO ?? "", grupo: r.GRUPO_PRODUTO ?? "", linha: r.LINHA ?? "" });
  }
  return out;
}

export async function fetchParteShopifyDashboard(params: {
  company: ShopifyCompany;
  range: DateRangeInput;
  linhas: string[] | null;
  comFrete: boolean;
}): Promise<ParteShopify> {
  const { company, linhas, comFrete } = params;
  await ensureShopifyTables();
  const atual = normalizeRangeForQuery({ start: params.range.start, end: params.range.end });
  const anterior = shiftRangeByMonths(atual, -1);
  const A = limitesBrt(atual);
  const P = limitesBrt(anterior);
  const filtraLinha = !!linhas && linhas.length > 0;
  const linhasSet = new Set((linhas ?? []).map(up));

  const [lAtual, lAnterior] = await Promise.all([
    linhasDoPeriodo(company, A.from, A.to),
    filtraLinha ? linhasDoPeriodo(company, P.from, P.to) : Promise.resolve([] as Linha[]),
  ]);
  const cad = await cadastroLinx([...lAtual, ...lAnterior].map((l) => l.produto).filter((p): p is string => !!p));
  const passa = (l: Linha) => !filtraLinha || (!!l.produto && linhasSet.has(up(cad.get(up(l.produto))?.linha)));
  const atuais = lAtual.filter(passa);
  const anteriores = lAnterior.filter(passa);
  const comF = (v: number, f: number) => v + (comFrete ? f : 0);

  // ── totais e curva diária ──
  let receita: ParteShopify["receita"];
  let pecas: ParteShopify["pecas"];
  let pedidos: ParteShopify["pedidos"];
  let frete: ParteShopify["frete"];
  const porDia = new Map<string, number>();
  if (!filtraLinha) {
    const [kA, kP, serie] = await Promise.all([
      fetchShopifyKpis(company, A.from, A.to),
      fetchShopifyKpis(company, P.from, P.to),
      fetchShopifySerie(company, A.from, A.to, false),
    ]);
    receita = { atual: comF(kA.venda, kA.freteLiquido), anterior: comF(kP.venda, kP.freteLiquido) };
    pecas = { atual: kA.itens, anterior: kP.itens };
    pedidos = { atual: kA.pedidos, anterior: kP.pedidos };
    frete = { atual: kA.freteLiquido, anterior: kP.freteLiquido };
    for (const [dia, s] of serie) porDia.set(dia, comF(s.venda, s.frete));
  } else {
    const soma = (ls: Linha[]) => ({
      v: ls.reduce((a, l) => a + l.net, 0),
      f: ls.reduce((a, l) => a + l.f, 0),
      q: ls.reduce((a, l) => a + l.q, 0),
      p: new Set(ls.map((l) => l.order_id)).size,
    });
    const sa = soma(atuais);
    const sp = soma(anteriores);
    receita = { atual: comF(sa.v, sa.f), anterior: comF(sp.v, sp.f) };
    pecas = { atual: sa.q, anterior: sp.q };
    pedidos = { atual: sa.p, anterior: sp.p };
    frete = { atual: sa.f, anterior: sp.f };
    for (const l of atuais) porDia.set(l.ymd, (porDia.get(l.ymd) ?? 0) + comF(l.net, l.f));
  }

  // ── produtos (visão Linx quando vinculado; nome do Shopify quando não) ──
  const prod = new Map<string, ProductRevenue>();
  const cat = new Map<string, CategoryRevenue>();
  for (const l of atuais) {
    const c = l.produto ? cad.get(up(l.produto)) : undefined;
    const id = l.produto ? l.produto : `SHOPIFY:${l.product_id ?? l.title}`;
    const nome = l.produto ? c?.desc || l.produto : l.title;
    const v = comF(l.net, l.f);
    const p = prod.get(id) ?? { productId: id, productName: nome, totalRevenue: 0, totalQuantity: 0, stock: 0 };
    p.totalRevenue += v;
    p.totalQuantity += l.q;
    prod.set(id, p);
    const catId = l.produto ? c?.grupo || "SEM GRUPO" : "SHOPIFY (SEM VÍNCULO)";
    const k = cat.get(catId) ?? { categoryId: catId, categoryName: catId, totalRevenue: 0, totalQuantity: 0 };
    k.totalRevenue += v;
    k.totalQuantity += l.q;
    cat.set(catId, k);
  }

  const ultima = atuais.reduce<string | null>((m, l) => (!m || l.created_at > m ? l.created_at : m), null);
  return {
    receita,
    pecas,
    pedidos,
    frete,
    ultimaVenda: ultima ? new Date(ultima) : null,
    porDia,
    produtos: [...prod.values()].sort((a, b) => b.totalRevenue - a.totalRevenue),
    categorias: [...cat.values()].sort((a, b) => b.totalRevenue - a.totalRevenue),
  };
}

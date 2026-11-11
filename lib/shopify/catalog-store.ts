import "server-only";

import { getNeonSql } from "@/lib/db/neon";
import type { ShopifyCompany } from "@/lib/shopify/config";
import { ensureShopifyTables } from "@/lib/shopify/orders-store";

/**
 * Catálogo do Shopify (variantes) + vínculo de cada variante com o Linx.
 *
 * O vínculo é SÓ nosso (Neon): não altera nada no Shopify (decisão do dono, 10/11/2026).
 * Grão = variante Shopify → produto × cor (× tamanho quando dá para saber) do Linx.
 *
 * `origem`: 'auto' = o motor de vínculo pode recalcular; 'manual' = alguém decidiu na
 * tela e o motor NUNCA sobrescreve.
 * `status`:
 *   vinculado  — aponta para um produto do Linx (código exato ou confirmado à mão)
 *   sugerido   — o motor achou um candidato (por nome, ou falta a cor) e precisa de OK
 *   nao_linx   — não é produto do Linx (vale-presente, taxa…), de propósito sem vínculo
 *   pendente   — nada encontrado
 */

export type MapaStatus = "vinculado" | "sugerido" | "nao_linx" | "pendente";
export type MapaOrigem = "auto" | "manual";

export interface ShopifyVariantRow {
  variant_id: string;
  product_id: string;
  product_title: string;
  product_status: string | null;
  product_type: string | null;
  vendor: string | null;
  variant_title: string | null;
  sku: string | null;
  barcode: string | null;
  options: Array<{ name: string; value: string }>;
  inventory_qty: number | null;
}

export interface MapaComponente {
  codigo: string;
  produto: string;
  cor: string | null;
  tamanho: number | null;
  descProduto: string | null;
}

export interface ShopifyVariantMapRow {
  variant_id: string;
  status: MapaStatus;
  origem: MapaOrigem;
  metodo: string | null;
  score: number | null;
  produto: string | null;
  cor_produto: string | null;
  tamanho: number | null;
  desc_produto: string | null;
  desc_cor: string | null;
  componentes: MapaComponente[] | null;
  updated_by?: string | null;
}

const DDL = [
  `CREATE TABLE IF NOT EXISTS shopify_variants (
     company TEXT NOT NULL,
     variant_id TEXT NOT NULL,
     product_id TEXT NOT NULL,
     product_title TEXT NOT NULL,
     product_status TEXT,
     product_type TEXT,
     vendor TEXT,
     variant_title TEXT,
     sku TEXT,
     barcode TEXT,
     options JSONB NOT NULL DEFAULT '[]'::jsonb,
     inventory_qty INTEGER,
     synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (company, variant_id)
   )`,
  `CREATE INDEX IF NOT EXISTS shopify_variants_product_idx ON shopify_variants (company, product_id)`,
  `CREATE TABLE IF NOT EXISTS shopify_variant_map (
     company TEXT NOT NULL,
     variant_id TEXT NOT NULL,
     status TEXT NOT NULL,
     origem TEXT NOT NULL DEFAULT 'auto',
     metodo TEXT,
     score NUMERIC(5,3),
     produto TEXT,
     cor_produto TEXT,
     tamanho INTEGER,
     desc_produto TEXT,
     desc_cor TEXT,
     componentes JSONB,
     updated_by TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (company, variant_id)
   )`,
  `CREATE INDEX IF NOT EXISTS shopify_variant_map_produto_idx ON shopify_variant_map (company, produto, cor_produto)`,
  // Código de barras do Linx do produto×cor(×tamanho) vinculado — o MAIS CURTO (regra do
  // dashboard). Derivado do Linx, guardado aqui p/ a página Shopify não consultar o Linx.
  `ALTER TABLE shopify_variant_map ADD COLUMN IF NOT EXISTS codigo_barra TEXT`,
  // Lotes anteriores: a MESMA peça do Shopify com outro código de produto no Linx (reposição
  // e coleção nova ganham código novo — "PILAR 09/24", "PILAR C 11/24"). O vínculo principal
  // (shopify_variant_map) é o do SKU; estes são os códigos antigos que ainda faturam.
  `CREATE TABLE IF NOT EXISTS shopify_variant_linx_extra (
     company TEXT NOT NULL,
     variant_id TEXT NOT NULL,
     produto TEXT NOT NULL,
     cor_produto TEXT NOT NULL DEFAULT '',
     desc_produto TEXT,
     desc_cor TEXT,
     origem TEXT NOT NULL DEFAULT 'auto',
     metodo TEXT,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (company, variant_id, produto, cor_produto)
   )`,
  `CREATE INDEX IF NOT EXISTS shopify_variant_linx_extra_produto_idx ON shopify_variant_linx_extra (company, produto, cor_produto)`,
];

const TOLERATED = new Set(["23505", "42P07", "42710"]);
let ensurePromise: Promise<void> | null = null;

export function ensureCatalogTables(): Promise<void> {
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await ensureShopifyTables();
      const sql = getNeonSql();
      for (const statement of DDL) {
        try {
          await sql.query(statement);
        } catch (error) {
          const code = (error as { code?: string }).code;
          if (!code || !TOLERATED.has(code)) throw error;
        }
      }
    })().catch((error) => {
      ensurePromise = null;
      throw error;
    });
  }
  return ensurePromise;
}

export async function upsertShopifyVariants(company: ShopifyCompany, rows: ShopifyVariantRow[]) {
  if (rows.length === 0) return;
  await ensureCatalogTables();
  const sql = getNeonSql();
  await sql.query(
    `INSERT INTO shopify_variants AS t (company, variant_id, product_id, product_title, product_status,
       product_type, vendor, variant_title, sku, barcode, options, inventory_qty, synced_at)
     SELECT $1, x.variant_id, x.product_id, x.product_title, x.product_status, x.product_type, x.vendor,
       x.variant_title, x.sku, x.barcode, COALESCE(x.options, '[]'::jsonb), x.inventory_qty, now()
     FROM jsonb_to_recordset($2::jsonb) AS x(variant_id text, product_id text, product_title text,
       product_status text, product_type text, vendor text, variant_title text, sku text, barcode text,
       options jsonb, inventory_qty integer)
     ON CONFLICT (company, variant_id) DO UPDATE SET
       product_id = EXCLUDED.product_id, product_title = EXCLUDED.product_title,
       product_status = EXCLUDED.product_status, product_type = EXCLUDED.product_type,
       vendor = EXCLUDED.vendor, variant_title = EXCLUDED.variant_title, sku = EXCLUDED.sku,
       barcode = EXCLUDED.barcode, options = EXCLUDED.options,
       inventory_qty = EXCLUDED.inventory_qty, synced_at = now()`,
    [company, JSON.stringify(rows)],
  );
}

/** Depois de uma varredura COMPLETA do catálogo: tira o que sumiu do Shopify. */
export async function pruneShopifyVariants(company: ShopifyCompany, sweepStartedAt: string) {
  const sql = getNeonSql();
  await sql.transaction([
    sql.query(
      `DELETE FROM shopify_variant_map m WHERE m.company = $1 AND NOT EXISTS (
         SELECT 1 FROM shopify_variants v WHERE v.company = m.company AND v.variant_id = m.variant_id
           AND v.synced_at >= $2)`,
      [company, sweepStartedAt],
    ),
    sql.query(`DELETE FROM shopify_variants WHERE company = $1 AND synced_at < $2`, [company, sweepStartedAt]),
  ]);
}

export async function listAllShopifyVariants(company: ShopifyCompany): Promise<ShopifyVariantRow[]> {
  await ensureCatalogTables();
  const sql = getNeonSql();
  return (await sql.query(
    `SELECT variant_id, product_id, product_title, product_status, product_type, vendor, variant_title,
            sku, barcode, options, inventory_qty
       FROM shopify_variants WHERE company = $1`,
    [company],
  )) as ShopifyVariantRow[];
}

export async function listVariantMaps(company: ShopifyCompany): Promise<Map<string, ShopifyVariantMapRow>> {
  await ensureCatalogTables();
  const sql = getNeonSql();
  const rows = (await sql.query(
    `SELECT variant_id, status, origem, metodo, score::float AS score, produto, cor_produto, tamanho,
            desc_produto, desc_cor, componentes, updated_by
       FROM shopify_variant_map WHERE company = $1`,
    [company],
  )) as ShopifyVariantMapRow[];
  return new Map(rows.map((r) => [r.variant_id, r]));
}

/** Grava vínculos. `onlyAuto` = não toca em linha que já é manual (usado pelo motor). */
export async function saveVariantMaps(
  company: ShopifyCompany,
  rows: ShopifyVariantMapRow[],
  options: { onlyAuto: boolean; updatedBy?: string | null },
) {
  if (rows.length === 0) return;
  await ensureCatalogTables();
  const sql = getNeonSql();
  const guard = options.onlyAuto ? `WHERE t.origem = 'auto'` : "";
  for (let i = 0; i < rows.length; i += 2000) {
    const chunk = rows.slice(i, i + 2000);
    await sql.query(
      `INSERT INTO shopify_variant_map AS t (company, variant_id, status, origem, metodo, score, produto,
         cor_produto, tamanho, desc_produto, desc_cor, componentes, updated_by, updated_at)
       SELECT $1, x.variant_id, x.status, x.origem, x.metodo, x.score, x.produto, x.cor_produto,
         x.tamanho, x.desc_produto, x.desc_cor, x.componentes, $3, now()
       FROM jsonb_to_recordset($2::jsonb) AS x(variant_id text, status text, origem text, metodo text,
         score numeric, produto text, cor_produto text, tamanho integer, desc_produto text,
         desc_cor text, componentes jsonb)
       ON CONFLICT (company, variant_id) DO UPDATE SET
         status = EXCLUDED.status, origem = EXCLUDED.origem, metodo = EXCLUDED.metodo,
         score = EXCLUDED.score, produto = EXCLUDED.produto, cor_produto = EXCLUDED.cor_produto,
         tamanho = EXCLUDED.tamanho, desc_produto = EXCLUDED.desc_produto,
         desc_cor = EXCLUDED.desc_cor, componentes = EXCLUDED.componentes,
         updated_by = EXCLUDED.updated_by, updated_at = now()
       ${guard}`,
      [company, JSON.stringify(chunk), options.updatedBy ?? null],
    );
  }
}

export async function deleteVariantMaps(company: ShopifyCompany, variantIds: string[]) {
  if (variantIds.length === 0) return;
  const sql = getNeonSql();
  await sql.query(`DELETE FROM shopify_variant_map WHERE company = $1 AND variant_id = ANY($2::text[])`, [
    company,
    variantIds,
  ]);
}

// ---------------------------------------------------------------------------
// Leitura para a tela de mapeamento
// ---------------------------------------------------------------------------

export interface MapaResumo {
  /** Filtro de status do Shopify aplicado aos cartões ('todos' = sem filtro). */
  statusShopify: string;
  variantes: number;
  produtos: number;
  porStatus: Record<MapaStatus, number>;
  produtosARevisar: number;
  ativos: { variantes: number; vinculadas: number };
}

export interface MapaVarianteView {
  variantId: string;
  titulo: string | null;
  sku: string | null;
  barcode: string | null;
  options: Array<{ name: string; value: string }>;
  estoque: number | null;
  status: MapaStatus;
  origem: MapaOrigem;
  metodo: string | null;
  score: number | null;
  produto: string | null;
  cor: string | null;
  tamanho: number | null;
  descProduto: string | null;
  descCor: string | null;
  componentes: MapaComponente[] | null;
  atualizadoPor: string | null;
  /** Outros códigos de produto do Linx da mesma peça (lotes anteriores). */
  lotes: Array<{ produto: string; cor: string; descProduto: string | null; descCor: string | null }>;
}

export interface MapaProdutoView {
  productId: string;
  titulo: string;
  statusShopify: string | null;
  tipo: string | null;
  contagem: Record<MapaStatus, number>;
  variantes: MapaVarianteView[];
}

export async function fetchMapaResumo(company: ShopifyCompany, statusShopify = "todos"): Promise<MapaResumo> {
  await ensureCatalogTables();
  const sql = getNeonSql();
  // Os cartões seguem o mesmo filtro de status do Shopify da lista (padrão da tela: ativos) —
  // rascunho antigo fora da loja não infla o "a revisar". O progresso de ativos é sempre de ativos.
  const filtra = !!statusShopify && statusShopify !== "todos";
  const f = (cond: string) => (filtra ? `(${cond}) AND v.product_status = $2` : cond);
  const [tot] = (await sql.query(
    `SELECT COUNT(*) FILTER (WHERE ${f("TRUE")})::int AS variantes,
            COUNT(DISTINCT v.product_id) FILTER (WHERE ${f("TRUE")})::int AS produtos,
            COUNT(*) FILTER (WHERE ${f("COALESCE(m.status,'pendente') = 'vinculado'")})::int AS vinculado,
            COUNT(*) FILTER (WHERE ${f("m.status = 'sugerido'")})::int AS sugerido,
            COUNT(*) FILTER (WHERE ${f("m.status = 'nao_linx'")})::int AS nao_linx,
            COUNT(*) FILTER (WHERE ${f("COALESCE(m.status,'pendente') = 'pendente'")})::int AS pendente,
            COUNT(DISTINCT v.product_id) FILTER (WHERE ${f("COALESCE(m.status,'pendente') IN ('sugerido','pendente')")})::int AS revisar,
            COUNT(*) FILTER (WHERE v.product_status = 'ACTIVE')::int AS ativos,
            COUNT(*) FILTER (WHERE v.product_status = 'ACTIVE' AND m.status IN ('vinculado','nao_linx'))::int AS ativos_ok
       FROM shopify_variants v
       LEFT JOIN shopify_variant_map m ON m.company = v.company AND m.variant_id = v.variant_id
      WHERE v.company = $1`,
    filtra ? [company, statusShopify] : [company],
  )) as Array<Record<string, number>>;
  return {
    statusShopify: filtra ? statusShopify : "todos",
    variantes: tot?.variantes ?? 0,
    produtos: tot?.produtos ?? 0,
    porStatus: {
      vinculado: tot?.vinculado ?? 0,
      sugerido: tot?.sugerido ?? 0,
      nao_linx: tot?.nao_linx ?? 0,
      pendente: tot?.pendente ?? 0,
    },
    produtosARevisar: tot?.revisar ?? 0,
    ativos: { variantes: tot?.ativos ?? 0, vinculadas: tot?.ativos_ok ?? 0 },
  };
}

export async function fetchMapaProdutos(
  company: ShopifyCompany,
  filtros: { status?: string; statusShopify?: string; busca?: string; pagina?: number; porPagina?: number },
): Promise<{ total: number; produtos: MapaProdutoView[] }> {
  await ensureCatalogTables();
  const sql = getNeonSql();
  const porPagina = Math.min(100, Math.max(10, filtros.porPagina ?? 40));
  const pagina = Math.max(1, filtros.pagina ?? 1);

  const where: string[] = ["v.company = $1"];
  const params: unknown[] = [company];
  if (filtros.statusShopify && filtros.statusShopify !== "todos") {
    params.push(filtros.statusShopify);
    where.push(`v.product_status = $${params.length}`);
  }
  if (filtros.busca && filtros.busca.trim()) {
    params.push(`%${filtros.busca.trim()}%`);
    const p = `$${params.length}`;
    where.push(`(v.product_title ILIKE ${p} OR v.sku ILIKE ${p} OR v.barcode ILIKE ${p}
                 OR m.produto ILIKE ${p} OR m.desc_produto ILIKE ${p})`);
  }

  // Filtro de status é por PRODUTO: "a revisar" = produto com alguma variante sugerida/pendente.
  let having = "";
  if (filtros.status === "revisar") having = `HAVING COUNT(*) FILTER (WHERE COALESCE(m.status,'pendente') IN ('sugerido','pendente')) > 0`;
  else if (filtros.status && ["vinculado", "sugerido", "nao_linx", "pendente"].includes(filtros.status)) {
    params.push(filtros.status);
    having = `HAVING COUNT(*) FILTER (WHERE COALESCE(m.status,'pendente') = $${params.length}) > 0`;
  }

  const base = `FROM shopify_variants v
     LEFT JOIN shopify_variant_map m ON m.company = v.company AND m.variant_id = v.variant_id
     WHERE ${where.join(" AND ")}
     GROUP BY v.product_id ${having}`;

  const [{ total }] = (await sql.query(`SELECT COUNT(*)::int AS total FROM (SELECT v.product_id ${base}) t`, params)) as Array<{ total: number }>;
  const offsetParam = params.length + 1;
  const ids = (await sql.query(
    `SELECT v.product_id, MIN(v.product_title) AS titulo,
            MIN(CASE v.product_status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END) AS ordem
     ${base}
     ORDER BY ordem, COUNT(*) FILTER (WHERE COALESCE(m.status,'pendente') IN ('sugerido','pendente')) DESC, titulo
     LIMIT ${porPagina} OFFSET $${offsetParam}`,
    [...params, (pagina - 1) * porPagina],
  )) as Array<{ product_id: string }>;

  if (ids.length === 0) return { total, produtos: [] };

  const rows = (await sql.query(
    `SELECT v.product_id, v.product_title, v.product_status, v.product_type, v.variant_id, v.variant_title,
            v.sku, v.barcode, v.options, v.inventory_qty,
            COALESCE(m.status, 'pendente') AS status, COALESCE(m.origem, 'auto') AS origem, m.metodo,
            m.score::float AS score, m.produto, m.cor_produto, m.tamanho, m.desc_produto, m.desc_cor,
            m.componentes, m.updated_by,
            (SELECT json_agg(json_build_object('produto', x.produto, 'cor', x.cor_produto,
                     'descProduto', x.desc_produto, 'descCor', x.desc_cor) ORDER BY x.produto)
               FROM shopify_variant_linx_extra x
              WHERE x.company = v.company AND x.variant_id = v.variant_id) AS lotes
       FROM shopify_variants v
       LEFT JOIN shopify_variant_map m ON m.company = v.company AND m.variant_id = v.variant_id
      WHERE v.company = $1 AND v.product_id = ANY($2::text[])
      ORDER BY v.variant_title`,
    [company, ids.map((r) => r.product_id)],
  )) as Array<Record<string, unknown>>;

  const byProduct = new Map<string, MapaProdutoView>();
  for (const id of ids) {
    byProduct.set(id.product_id, {
      productId: id.product_id,
      titulo: "",
      statusShopify: null,
      tipo: null,
      contagem: { vinculado: 0, sugerido: 0, nao_linx: 0, pendente: 0 },
      variantes: [],
    });
  }
  for (const r of rows) {
    const p = byProduct.get(String(r.product_id));
    if (!p) continue;
    p.titulo = String(r.product_title);
    p.statusShopify = (r.product_status as string) ?? null;
    p.tipo = (r.product_type as string) ?? null;
    const status = r.status as MapaStatus;
    p.contagem[status] += 1;
    p.variantes.push({
      variantId: String(r.variant_id),
      titulo: (r.variant_title as string) ?? null,
      sku: (r.sku as string) ?? null,
      barcode: (r.barcode as string) ?? null,
      options: (r.options as MapaVarianteView["options"]) ?? [],
      estoque: (r.inventory_qty as number) ?? null,
      status,
      origem: r.origem as MapaOrigem,
      metodo: (r.metodo as string) ?? null,
      score: (r.score as number) ?? null,
      produto: (r.produto as string) ?? null,
      cor: (r.cor_produto as string) ?? null,
      tamanho: (r.tamanho as number) ?? null,
      descProduto: (r.desc_produto as string) ?? null,
      descCor: (r.desc_cor as string) ?? null,
      componentes: (r.componentes as MapaComponente[]) ?? null,
      atualizadoPor: (r.updated_by as string) ?? null,
      lotes: (r.lotes as MapaVarianteView["lotes"]) ?? [],
    });
  }
  return { total, produtos: [...byProduct.values()] };
}

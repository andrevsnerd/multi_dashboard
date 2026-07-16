import sql from "mssql";

import {
  getFilialLabelForDisplay,
  isEcommerceFilial,
  VAREJO_VALUE,
  type CompanyKey,
} from "@/lib/config/company";
import { resolveCompanyLive, liveNameForIncoming } from "@/lib/server/company-live";
import { withRequest } from "@/lib/db/connection";
import { RequestLike } from "@/lib/db/proxy";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { canonicalKey } from "@/lib/reports/keys";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchProdutoQtdePorFilial } from "@/lib/repositories/performance";

/**
 * Relatório de Coleção (Relatório Claude + comparativos entre coleções).
 *
 * TODAS as vendas/faturamento seguem a REGRA ÚNICA validada "com trocas" (ver
 * CLAUDE.md): reaproveitam `fetchProductsWithDetails` (produto × cor, com trocas,
 * FATOR_DESCONTO_VENDA e cancelamentos tratados) e `fetchProdutoQtdePorFilial`
 * (mesma lógica, decomposta por filial) para o detalhamento por loja/canal.
 * NUNCA somar de `W_CTB_LOJA_VENDA_PEDIDO_PRODUTO` nem usar desconto absoluto.
 */

type ReportChannel = "Varejo" | "E-commerce";

export interface CollectionReportQueryParams {
  company?: string;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
  filial?: string | null;
  colecoes?: string[] | null;
}

export interface CollectionReportDetailRow {
  id: string;
  channel: ReportChannel;
  origin: string;
  productId: string;
  productName: string;
  grade: string;
  colorCode: string;
  colorDescription: string;
  quantity: number;
  revenue: number;
}

export interface CollectionReportProductRow {
  id: string;
  productName: string;
  retailRevenue: number;
  ecommerceRevenue: number;
  totalRevenue: number;
  details: CollectionReportDetailRow[];
}

export interface CollectionReportResponse {
  summary: {
    totalRevenue: number;
    retailRevenue: number;
    ecommerceRevenue: number;
    totalQuantity: number;
    retailQuantity: number;
    ecommerceQuantity: number;
    retailShare: number;
    ecommerceShare: number;
    detectedStartDate: string | null;
    detectedEndDate: string | null;
  };
  topProducts: Array<{
    productName: string;
    retailRevenue: number;
    ecommerceRevenue: number;
    totalRevenue: number;
  }>;
  products: CollectionReportProductRow[];
}

export interface CollectionReportAvailableRange {
  startDate: string | null;
  endDate: string | null;
  collectionCode: string | null;
  collectionDescription: string | null;
}

function resolveRange(range?: { start?: string | Date; end?: string | Date }) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

function normalizeCollectionValues(values?: string[] | null): string[] {
  return (values ?? [])
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value !== "");
}

function shouldIncludeSalesChannel(company?: string, filial?: string | null) {
  if (company !== "scarfme") {
    return false;
  }

  if (!filial || filial === VAREJO_VALUE) {
    return true;
  }

  return !isEcommerceFilial(company, filial);
}

function shouldIncludeEcommerceChannel(company?: string, filial?: string | null) {
  if (company !== "scarfme") {
    return false;
  }

  if (!filial) {
    return true;
  }

  return isEcommerceFilial(company, filial);
}

async function buildSalesFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  filial: string | null | undefined,
  paramPrefix: string,
  tableAlias = "vp"
): Promise<string> {
  const company = await resolveCompanyLive(companySlug);

  if (!company) {
    return "";
  }

  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  filial = await liveNameForIncoming(filial);

  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const salesFiliais = company.filialFilters.sales.filter(
    (value) => !ecommerceFilials.has(value)
  );

  if (filial && filial !== VAREJO_VALUE) {
    request.input(`${paramPrefix}Filial`, sql.VarChar, filial);
    return `AND ${tableAlias}.FILIAL = @${paramPrefix}Filial`;
  }

  if (salesFiliais.length === 0) {
    return "";
  }

  salesFiliais.forEach((value, index) => {
    request.input(`${paramPrefix}Filial${index}`, sql.VarChar, value);
  });

  const placeholders = salesFiliais
    .map((_, index) => `@${paramPrefix}Filial${index}`)
    .join(", ");

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

async function buildEcommerceFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  filial: string | null | undefined,
  paramPrefix: string,
  tableAlias = "f"
): Promise<string> {
  const company = await resolveCompanyLive(companySlug);

  if (!company) {
    return "";
  }

  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  filial = await liveNameForIncoming(filial);

  const ecommerceFiliais = company.ecommerceFilials ?? [];

  if (filial) {
    request.input(`${paramPrefix}Filial`, sql.VarChar, filial);
    return `AND ${tableAlias}.FILIAL = @${paramPrefix}Filial`;
  }

  if (ecommerceFiliais.length === 0) {
    return "";
  }

  ecommerceFiliais.forEach((value, index) => {
    request.input(`${paramPrefix}Filial${index}`, sql.VarChar, value);
  });

  const placeholders = ecommerceFiliais
    .map((_, index) => `@${paramPrefix}Filial${index}`)
    .join(", ");

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

/**
 * Filtro de coleção validado para as tabelas de venda física: casa pela COLECAO
 * da tabela MESTRE `p.COLECAO` (PRODUTOS). As tabelas de venda (LOJA_VENDA_PRODUTO
 * `vp` e LOJA_VENDA_TROCA `vt`) NÃO possuem coluna COLECAO — por isso todas as
 * queries que usam este filtro fazem JOIN em PRODUTOS `p` e a coleção vem sempre
 * de lá (mesmo padrão de `fetchProductsWithDetails`, que também resolve por
 * `p.COLECAO`). Registra os @params UMA vez e devolve uma função por alias de
 * venda — o alias é mantido só por compatibilidade dos chamadores.
 */
function prepColecaoFilter(
  request: sql.Request | RequestLike,
  colecoes: string[] | null | undefined,
  prefix: string
): (saleAlias: string) => string {
  const list = normalizeCollectionValues(colecoes);
  if (list.length === 0) return () => "";
  list.forEach((c, i) => request.input(`${prefix}${i}`, sql.VarChar, c));
  const ph = list.map((_, i) => `@${prefix}${i}`).join(", ");
  return () =>
    `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${ph})`;
}

function buildEcommerceCollectionFilter(
  request: sql.Request | RequestLike,
  colecoes: string[],
  paramPrefix: string
) {
  if (colecoes.length === 0) {
    return "";
  }

  if (colecoes.length === 1) {
    request.input(`${paramPrefix}Colecao`, sql.VarChar, colecoes[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @${paramPrefix}Colecao`;
  }

  colecoes.forEach((value, index) => {
    request.input(`${paramPrefix}Colecao${index}`, sql.VarChar, value);
  });

  const placeholders = colecoes
    .map((_, index) => `@${paramPrefix}Colecao${index}`)
    .join(", ");

  return `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})`;
}

function getDetailId(parts: string[]) {
  return parts.map((value) => value.trim()).join("|");
}

/**
 * Escopo de filiais (POS/e-commerce) a considerar, respeitando o filtro `filial`
 * — mesma semântica que `fetchProductsWithDetails` aplica aos totais.
 */
function resolveFilialScope(
  ecommerceFilials: Set<string>,
  salesFiliais: string[],
  specific: string | null | undefined
): { posNames: string[]; ecomNames: string[] } {
  const allPos = salesFiliais.filter((f) => !ecommerceFilials.has(f));
  const allEcom = salesFiliais.filter((f) => ecommerceFilials.has(f));

  if (specific && specific !== VAREJO_VALUE) {
    if (ecommerceFilials.has(specific)) return { posNames: [], ecomNames: [specific] };
    return { posNames: [specific], ecomNames: [] };
  }
  if (specific === VAREJO_VALUE) return { posNames: allPos, ecomNames: [] };
  return { posNames: allPos, ecomNames: allEcom };
}

/**
 * MIN/MAX das datas de venda da coleção no período (para o rótulo "período
 * detectado" do cabeçalho). Datas — não faturamento — então é uma consulta
 * enxuta nas tabelas validadas (LOJA_VENDA_PRODUTO / FATURAMENTO), nunca W_CTB.
 */
async function fetchColecaoDetectedRange(
  company: string | undefined,
  filial: string | null | undefined,
  colecoes: string[]
): Promise<{ start: Date | null; end: Date | null }> {
  let detectedStart: Date | null = null;
  let detectedEnd: Date | null = null;

  // O proxy de DB (HTTP/JSON) devolve datas como STRING, não como Date — então
  // normalizamos aqui antes de comparar/`toISOString()` (com driver direto já
  // vem Date; `new Date(Date)` é idempotente). Evita "toISOString is not a function".
  const toDate = (value: unknown): Date | null => {
    if (!value) return null;
    const d = value instanceof Date ? value : new Date(value as string);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  const earlier = (a: Date | null, b: Date | null): Date | null =>
    a && b ? (a.getTime() <= b.getTime() ? a : b) : a ?? b;
  const later = (a: Date | null, b: Date | null): Date | null =>
    a && b ? (a.getTime() >= b.getTime() ? a : b) : a ?? b;

  await withRequest(async (request) => {
    if (shouldIncludeSalesChannel(company, filial)) {
      const salesFilial = filial && filial !== VAREJO_VALUE ? filial : VAREJO_VALUE;
      const filialFilter = await buildSalesFilialFilter(request, company, salesFilial, "dateSales", "f");
      const colecao = prepColecaoFilter(request, colecoes, "dateSalesCol");
      const res = await request.query<{ startDate: Date | null; endDate: Date | null }>(`
        SELECT MIN(vp.DATA_VENDA) AS startDate, MAX(vp.DATA_VENDA) AS endDate
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
        WHERE ISNULL(vp.QTDE_CANCELADA, 0) = 0
          ${filialFilter}
          ${colecao("vp")}
      `);
      const row = res.recordset[0];
      detectedStart = earlier(detectedStart, toDate(row?.startDate));
      detectedEnd = later(detectedEnd, toDate(row?.endDate));
    }

    if (shouldIncludeEcommerceChannel(company, filial)) {
      const ecommerceFilial = filial && isEcommerceFilial(company, filial) ? filial : null;
      const filialFilter = await buildEcommerceFilialFilter(request, company, ecommerceFilial, "dateEcom");
      const colecao = buildEcommerceCollectionFilter(request, colecoes, "dateEcom");
      const res = await request.query<{ startDate: Date | null; endDate: Date | null }>(`
        SELECT MIN(f.EMISSAO) AS startDate, MAX(f.EMISSAO) AS endDate
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          ${filialFilter}
          ${colecao}
      `);
      const row = res.recordset[0];
      detectedStart = earlier(detectedStart, toDate(row?.startDate));
      detectedEnd = later(detectedEnd, toDate(row?.endDate));
    }
  });

  return { start: detectedStart, end: detectedEnd };
}

interface SkuMeta {
  productId: string;
  productName: string;
  productKey: string; // productName.toUpperCase() — chave de agrupamento por produto
  grade: string;
  colorCode: string;
  colorDescription: string;
}

export async function fetchCollectionReport({
  company,
  range,
  filial,
  colecoes,
}: CollectionReportQueryParams = {}): Promise<CollectionReportResponse> {
  const emptySummary = {
    totalRevenue: 0,
    retailRevenue: 0,
    ecommerceRevenue: 0,
    totalQuantity: 0,
    retailQuantity: 0,
    ecommerceQuantity: 0,
    retailShare: 0,
    ecommerceShare: 0,
    detectedStartDate: null,
    detectedEndDate: null,
  };

  if (company !== "scarfme") {
    return { summary: emptySummary, topProducts: [], products: [] };
  }

  const rangeInput = { start: range?.start, end: range?.end };
  const normRange = normalizeRangeForQuery(rangeInput);
  const normalizedCollections = normalizeCollectionValues(colecoes);

  const isNetworkScope = filial == null; // rede inteira = varejo + e-commerce
  const specific =
    filial && filial !== VAREJO_VALUE ? await liveNameForIncoming(filial) : filial ?? null;
  const scopeIsEcom = !!(
    specific &&
    specific !== VAREJO_VALUE &&
    isEcommerceFilial(company, specific)
  );

  // ── Totais validados (com trocas) por produto × cor ────────────────────────
  // filial null => varejo + e-commerce mesclados (mesma regra do resto do app).
  const [totalProducts, retailProducts, detectedRange] = await Promise.all([
    fetchProductsWithDetails({
      company,
      filial: filial ?? null,
      colecoes: normalizedCollections,
      range: rangeInput,
      groupByColor: true,
    }),
    // Split de canal: só precisamos do varejo isolado quando o escopo é a rede
    // inteira (aí e-commerce = total − varejo, por SKU).
    isNetworkScope
      ? fetchProductsWithDetails({
          company,
          filial: VAREJO_VALUE,
          colecoes: normalizedCollections,
          range: rangeInput,
          groupByColor: true,
        })
      : Promise.resolve(null),
    fetchColecaoDetectedRange(company, filial ?? null, normalizedCollections),
  ]);

  const retailRevByKey = new Map<string, number>();
  const retailQtyByKey = new Map<string, number>();
  for (const d of retailProducts ?? []) {
    const k = canonicalKey(d.productId, d.corProduto);
    retailRevByKey.set(k, (retailRevByKey.get(k) ?? 0) + (d.totalRevenue ?? 0));
    retailQtyByKey.set(k, (retailQtyByKey.get(k) ?? 0) + (d.totalQuantity ?? 0));
  }

  // Metadados por SKU (produto × cor) para montar os `details`.
  const skuMeta = new Map<string, SkuMeta>();
  const productMap = new Map<string, CollectionReportProductRow>();

  for (const d of totalProducts) {
    const productId = String(d.productId ?? "").trim();
    if (!productId) continue;
    const productName = (d.productName ?? "").trim() || productId;
    const productKey = productName.toUpperCase();
    const skuK = canonicalKey(productId, d.corProduto);
    skuMeta.set(skuK, {
      productId,
      productName,
      productKey,
      grade: d.grade && d.grade !== "-" ? String(d.grade) : "-",
      colorCode: d.corProduto ? String(d.corProduto).trim() : "",
      colorDescription: d.descCorProduto?.trim() || "-",
    });

    const total = d.totalRevenue ?? 0;
    let retail: number;
    let ecom: number;
    if (isNetworkScope) {
      retail = retailRevByKey.get(skuK) ?? 0;
      ecom = total - retail;
    } else if (scopeIsEcom) {
      retail = 0;
      ecom = total;
    } else {
      retail = total;
      ecom = 0;
    }

    let product = productMap.get(productKey);
    if (!product) {
      product = {
        id: productKey,
        productName,
        retailRevenue: 0,
        ecommerceRevenue: 0,
        totalRevenue: 0,
        details: [],
      };
      productMap.set(productKey, product);
    }
    product.retailRevenue += retail;
    product.ecommerceRevenue += ecom;
    product.totalRevenue += total;
  }

  // ── Detalhamento por filial (validado, com trocas) para os `details` ───────
  const companyLive = await resolveCompanyLive(company);
  if (companyLive && skuMeta.size > 0) {
    const ecommerceFilials = new Set(companyLive.ecommerceFilials ?? []);
    const salesFiliais = companyLive.filialFilters.sales ?? [];
    const { posNames, ecomNames } = resolveFilialScope(ecommerceFilials, salesFiliais, specific);

    const perFilial = await fetchProdutoQtdePorFilial(
      company as CompanyKey,
      posNames,
      ecomNames,
      normRange,
      { groupByCor: true }
    ).catch(() => []);

    for (const r of perFilial) {
      const skuK = canonicalKey(r.produto, r.cor || null);
      const meta = skuMeta.get(skuK);
      if (!meta) continue; // fora desta coleção
      const isEcom = ecommerceFilials.has(r.filial);
      const channel: ReportChannel = isEcom ? "E-commerce" : "Varejo";
      const origin = getFilialLabelForDisplay(companyLive, r.filial) || channel;
      const product = productMap.get(meta.productKey);
      if (!product) continue;
      product.details.push({
        id: getDetailId([channel, origin, meta.productId, meta.grade, meta.colorCode, meta.colorDescription]),
        channel,
        origin,
        productId: meta.productId,
        productName: meta.productName,
        grade: meta.grade,
        colorCode: meta.colorCode,
        colorDescription: meta.colorDescription,
        quantity: r.qtde,
        revenue: r.vendas,
      });
    }
  }

  const products = Array.from(productMap.values())
    .map((product) => ({
      ...product,
      details: product.details.sort((a, b) => b.revenue - a.revenue),
    }))
    .sort((a, b) => b.totalRevenue - a.totalRevenue);

  // ── Totais / KPIs (com trocas) ─────────────────────────────────────────────
  const totalRevenue = totalProducts.reduce((s, d) => s + (d.totalRevenue ?? 0), 0);
  const totalQuantity = totalProducts.reduce((s, d) => s + (d.totalQuantity ?? 0), 0);

  let retailRevenue: number;
  let ecommerceRevenue: number;
  let retailQuantity: number;
  let ecommerceQuantity: number;
  if (isNetworkScope) {
    retailRevenue = (retailProducts ?? []).reduce((s, d) => s + (d.totalRevenue ?? 0), 0);
    retailQuantity = (retailProducts ?? []).reduce((s, d) => s + (d.totalQuantity ?? 0), 0);
    ecommerceRevenue = totalRevenue - retailRevenue;
    ecommerceQuantity = totalQuantity - retailQuantity;
  } else if (scopeIsEcom) {
    retailRevenue = 0;
    retailQuantity = 0;
    ecommerceRevenue = totalRevenue;
    ecommerceQuantity = totalQuantity;
  } else {
    retailRevenue = totalRevenue;
    retailQuantity = totalQuantity;
    ecommerceRevenue = 0;
    ecommerceQuantity = 0;
  }

  return {
    summary: {
      totalRevenue,
      retailRevenue,
      ecommerceRevenue,
      totalQuantity,
      retailQuantity,
      ecommerceQuantity,
      retailShare: totalRevenue > 0 ? (retailRevenue / totalRevenue) * 100 : 0,
      ecommerceShare: totalRevenue > 0 ? (ecommerceRevenue / totalRevenue) * 100 : 0,
      detectedStartDate: detectedRange.start ? detectedRange.start.toISOString() : null,
      detectedEndDate: detectedRange.end ? detectedRange.end.toISOString() : null,
    },
    topProducts: products.slice(0, 10).map((product) => ({
      productName: product.productName,
      retailRevenue: product.retailRevenue,
      ecommerceRevenue: product.ecommerceRevenue,
      totalRevenue: product.totalRevenue,
    })),
    products,
  };
}

export async function fetchCollectionReportColecoes({
  company,
  range,
  filial,
}: Omit<CollectionReportQueryParams, "colecoes"> = {}): Promise<string[]> {
  if (company !== "scarfme") {
    return [];
  }

  return withRequest(async (request) => {
    const hasRange = Boolean(range?.start && range?.end);

    if (hasRange) {
      const { start, end } = resolveRange(range);
      request.input("startDate", sql.DateTime, start);
      request.input("endDate", sql.DateTime, end);
    }

    const values = new Set<string>();

    if (shouldIncludeSalesChannel(company, filial)) {
      const salesFilial = filial && filial !== VAREJO_VALUE ? filial : VAREJO_VALUE;
      const filialFilter = await buildSalesFilialFilter(request, company, salesFilial, "salesOptions");
      const result = await request.query<{ colecao: string | null }>(`
        SELECT DISTINCT UPPER(LTRIM(RTRIM(COALESCE(vp.COLECAO, p.COLECAO, '')))) AS colecao
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.QTDE > 0
          AND COALESCE(vp.COLECAO, p.COLECAO, '') <> ''
          ${hasRange ? "AND vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate" : ""}
          ${filialFilter}
      `);

      for (const row of result.recordset) {
        const value = row.colecao?.trim();
        if (value) {
          values.add(value);
        }
      }
    }

    if (shouldIncludeEcommerceChannel(company, filial)) {
      const ecommerceFilial = filial && isEcommerceFilial(company, filial) ? filial : null;
      const filialFilter = await buildEcommerceFilialFilter(
        request,
        company,
        ecommerceFilial,
        "ecomOptions"
      );
      const result = await request.query<{ colecao: string | null }>(`
        SELECT DISTINCT UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL
          AND f.NF_SAIDA = fp.NF_SAIDA
          AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
        WHERE f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          AND ISNULL(p.COLECAO, '') <> ''
          ${hasRange ? "AND f.EMISSAO >= @startDate AND f.EMISSAO < @endDate" : ""}
          ${filialFilter}
      `);

      for (const row of result.recordset) {
        const value = row.colecao?.trim();
        if (value) {
          values.add(value);
        }
      }
    }

    return Array.from(values).sort((a, b) => a.localeCompare(b, "pt-BR"));
  });
}

export async function fetchCollectionReportAvailableRange({
  company,
  filial,
  colecoes,
}: Omit<CollectionReportQueryParams, "range"> = {}): Promise<CollectionReportAvailableRange> {
  if (company !== "scarfme") {
    return {
      startDate: null,
      endDate: null,
      collectionCode: null,
      collectionDescription: null,
    };
  }

  const normalizedCollections = normalizeCollectionValues(colecoes);
  if (normalizedCollections.length === 0) {
    return {
      startDate: null,
      endDate: null,
      collectionCode: null,
      collectionDescription: null,
    };
  }

  return withRequest(async (request) => {
    let detectedStartDate: Date | null = null;
    let detectedEndDate: Date | null = null;
    let collectionDescription: string | null = null;

    // Proxy de DB devolve datas como string → normaliza p/ Date (ver
    // fetchColecaoDetectedRange). Evita "toISOString is not a function".
    const toDate = (value: unknown): Date | null => {
      if (!value) return null;
      const d = value instanceof Date ? value : new Date(value as string);
      return Number.isNaN(d.getTime()) ? null : d;
    };
    const earlier = (a: Date | null, b: Date | null): Date | null =>
      a && b ? (a.getTime() <= b.getTime() ? a : b) : a ?? b;
    const later = (a: Date | null, b: Date | null): Date | null =>
      a && b ? (a.getTime() >= b.getTime() ? a : b) : a ?? b;

    if (shouldIncludeSalesChannel(company, filial)) {
      const salesFilial = filial && filial !== VAREJO_VALUE ? filial : VAREJO_VALUE;
      const filialFilter = await buildSalesFilialFilter(
        request,
        company,
        salesFilial,
        "salesRange",
        "f"
      );
      const colecao = prepColecaoFilter(request, normalizedCollections, "salesRangeCol");
      const result = await request.query<{
        startDate: Date | null;
        endDate: Date | null;
      }>(`
        SELECT
          MIN(vp.DATA_VENDA) AS startDate,
          MAX(vp.DATA_VENDA) AS endDate
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
        WHERE ISNULL(vp.QTDE_CANCELADA, 0) = 0
          ${filialFilter}
          ${colecao("vp")}
      `);

      const row = result.recordset[0];
      detectedStartDate = earlier(detectedStartDate, toDate(row?.startDate));
      detectedEndDate = later(detectedEndDate, toDate(row?.endDate));
    }

    if (shouldIncludeEcommerceChannel(company, filial)) {
      const ecommerceFilial = filial && isEcommerceFilial(company, filial) ? filial : null;
      const filialFilter = await buildEcommerceFilialFilter(
        request,
        company,
        ecommerceFilial,
        "ecomRange"
      );
      const collectionFilter = buildEcommerceCollectionFilter(
        request,
        normalizedCollections,
        "ecomRange"
      );
      const result = await request.query<{
        startDate: Date | null;
        endDate: Date | null;
        collectionDescription: string | null;
      }>(`
        SELECT
          MIN(f.EMISSAO) AS startDate,
          MAX(f.EMISSAO) AS endDate,
          MAX(NULLIF(LTRIM(RTRIM(ISNULL(fp.DESC_COLECAO, ''))), '')) AS collectionDescription
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL
          AND f.NF_SAIDA = fp.NF_SAIDA
          AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
        WHERE f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          ${filialFilter}
          ${collectionFilter}
      `);

      const row = result.recordset[0];
      detectedStartDate = earlier(detectedStartDate, toDate(row?.startDate));
      detectedEndDate = later(detectedEndDate, toDate(row?.endDate));
      if (!collectionDescription && row?.collectionDescription?.trim()) {
        collectionDescription = row.collectionDescription.trim();
      }
    }

    return {
      startDate: detectedStartDate ? detectedStartDate.toISOString() : null,
      endDate: detectedEndDate ? detectedEndDate.toISOString() : null,
      collectionCode: normalizedCollections.length === 1 ? normalizedCollections[0] : null,
      collectionDescription,
    };
  });
}

export interface CollectionMonthlyPoint {
  year: number;
  month: number;
  revenue: number;
}

export interface CollectionComparativeExtras {
  /** Série mensal de venda líquida (varejo + e-commerce), ordenada. */
  monthly: CollectionMonthlyPoint[];
  /** Venda bruta (antes do desconto) — apenas canal físico. */
  grossSales: number;
  /** Desconto concedido (R$) — apenas canal físico. */
  discountSales: number;
}

/**
 * Extras do Relatório Comparativo entre Coleções: série mensal de venda líquida
 * (varejo + e-com) e desconto concedido (canal físico). Usa a REGRA ÚNICA
 * validada "com trocas" (mesma CTE de `fetchProdutoQtdePorFilial`): base
 * LOJA_VENDA_PRODUTO com FATOR_DESCONTO_VENDA, deduzindo trocas de item e trocas
 * puras (LOJA_VENDA_TROCA). O e-commerce não separa desconto na fonte
 * (FATURAMENTO), então gross/desconto refletem só o físico.
 */
export async function fetchCollectionComparativeExtras({
  company,
  range,
  filial,
  colecoes,
}: CollectionReportQueryParams = {}): Promise<CollectionComparativeExtras> {
  const empty: CollectionComparativeExtras = { monthly: [], grossSales: 0, discountSales: 0 };
  if (company !== "scarfme") return empty;

  const normalizedCollections = normalizeCollectionValues(colecoes);

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input("startDate", sql.DateTime, start);
    request.input("endDate", sql.DateTime, end);

    const monthlyMap = new Map<string, CollectionMonthlyPoint>();
    let grossSales = 0;
    let discountSales = 0;

    const addMonthly = (year: number, month: number, revenue: number) => {
      const key = `${year}-${month}`;
      const cur = monthlyMap.get(key);
      if (cur) cur.revenue += revenue;
      else monthlyMap.set(key, { year, month, revenue });
    };

    if (shouldIncludeSalesChannel(company, filial)) {
      const salesFilial = filial && filial !== VAREJO_VALUE ? filial : VAREJO_VALUE;
      const filialFilter = await buildSalesFilialFilter(request, company, salesFilial, "extrasSales", "f");
      const colecao = prepColecaoFilter(request, normalizedCollections, "extrasSalesCol");
      // CTE validada "com trocas" (espelha fetchProdutoQtdePorFilial), agregada por mês.
      // gross/desconto vêm da base física (antes de troca); net abate trocas.
      const result = await request.query<{ y: number; m: number; net: number; gross: number; disc: number }>(`
        WITH vendas_base AS (
          SELECT
            vp.TICKET, vp.CODIGO_FILIAL, vp.PRODUTO, ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
            vp.TAMANHO, vp.QTDE, vp.PRECO_LIQUIDO, vp.DATA_VENDA,
            CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate AND vp.DATA_VENDA < @endDate
            AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
            ${filialFilter}
            ${colecao("vp")}
        ),
        trocas_item AS (
          SELECT
            vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO, vt.TAMANHO,
            SUM(vt.QTDE) AS QTDE_TROCA,
            CAST(SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
          FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vt.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vt.PRODUTO
          WHERE vt.QTDE_CANCELADA = 0
            AND v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate
            ${filialFilter}
            ${colecao("vt")}
          GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, ISNULL(vt.COR_PRODUTO, ''), vt.TAMANHO
        ),
        TrocasPuras AS (
          SELECT
            v.DATA_VENDA,
            CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC
          FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vt.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vt.PRODUTO
          WHERE vt.QTDE_CANCELADA = 0
            AND v.DATA_VENDA >= @startDate AND v.DATA_VENDA < @endDate
            AND NOT EXISTS (
              SELECT 1 FROM LOJA_VENDA_PRODUTO vp2 WITH (NOLOCK)
              WHERE vp2.TICKET = vt.TICKET AND vp2.CODIGO_FILIAL = vt.CODIGO_FILIAL
                AND vp2.PRODUTO = vt.PRODUTO AND ISNULL(vp2.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
                AND ISNULL(vp2.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
                AND ISNULL(vp2.QTDE_CANCELADA, 0) = 0
            )
            ${filialFilter}
            ${colecao("vt")}
        ),
        VendasComNumero AS (
          SELECT
            vb.DATA_VENDA, vb.QTDE, vb.PRECO_LIQUIDO, vb.DESCONTO_VENDA, vb.TICKET, vb.CODIGO_FILIAL,
            vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO,
            ROW_NUMBER() OVER (
              PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
              ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ) AS RN
          FROM vendas_base vb
        ),
        movimentos AS (
          SELECT
            vcn.DATA_VENDA AS DT,
            CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6)) AS GROSS,
            vcn.DESCONTO_VENDA AS DISC,
            CAST(
              CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6))
              - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6))
              - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))
            AS DECIMAL(38,6)) AS NET
          FROM VendasComNumero vcn
          LEFT JOIN trocas_item ti
            ON ti.TICKET = vcn.TICKET AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
            AND ti.PRODUTO = vcn.PRODUTO AND ti.COR_PRODUTO = vcn.COR_PRODUTO
            AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
          UNION ALL
          SELECT tp.DATA_VENDA AS DT, CAST(0 AS DECIMAL(38,6)) AS GROSS,
                 CAST(0 AS DECIMAL(38,6)) AS DISC, tp.VALOR_LIQUIDO_CALC AS NET
          FROM TrocasPuras tp
        )
        SELECT YEAR(DT) AS y, MONTH(DT) AS m,
               SUM(NET) AS net, SUM(GROSS) AS gross, SUM(DISC) AS disc
        FROM movimentos
        GROUP BY YEAR(DT), MONTH(DT)
      `);
      for (const row of result.recordset) {
        addMonthly(Number(row.y), Number(row.m), Number(row.net ?? 0));
        grossSales += Number(row.gross ?? 0);
        discountSales += Number(row.disc ?? 0);
      }
    }

    if (shouldIncludeEcommerceChannel(company, filial)) {
      const ecommerceFilial = filial && isEcommerceFilial(company, filial) ? filial : null;
      const filialFilter = await buildEcommerceFilialFilter(request, company, ecommerceFilial, "extrasEcom");
      const collectionFilter = buildEcommerceCollectionFilter(request, normalizedCollections, "extrasEcom");
      const result = await request.query<{ y: number; m: number; net: number }>(`
        SELECT
          YEAR(f.EMISSAO) AS y,
          MONTH(f.EMISSAO) AS m,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS net
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL
          AND f.NF_SAIDA = fp.NF_SAIDA
          AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
        WHERE f.EMISSAO >= @startDate
          AND f.EMISSAO < @endDate
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          ${filialFilter}
          ${collectionFilter}
        GROUP BY YEAR(f.EMISSAO), MONTH(f.EMISSAO)
      `);
      for (const row of result.recordset) {
        addMonthly(Number(row.y), Number(row.m), Number(row.net ?? 0));
      }
    }

    const monthly = Array.from(monthlyMap.values()).sort((a, b) =>
      a.year !== b.year ? a.year - b.year : a.month - b.month
    );

    return { monthly, grossSales, discountSales };
  });
}

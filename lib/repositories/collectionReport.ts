import sql from "mssql";

import {
  getFilialLabelForDisplay,
  isEcommerceFilial,
  resolveCompany,
  VAREJO_VALUE,
} from "@/lib/config/company";
import { withRequest } from "@/lib/db/connection";
import { RequestLike } from "@/lib/db/proxy";
import { normalizeRangeForQuery } from "@/lib/utils/date";

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

interface SalesDetailRecord {
  productId: string;
  productName: string | null;
  grade: string | null;
  colorCode: string | null;
  colorDescription: string | null;
  origin: string | null;
  totalQuantity: number | null;
  totalRevenue: number | null;
  firstSaleDate: Date | null;
  lastSaleDate: Date | null;
}

interface EcommerceDetailRecord {
  productId: string;
  productName: string | null;
  grade: string | null;
  colorCode: string | null;
  colorDescription: string | null;
  origin: string | null;
  totalQuantity: number | null;
  totalRevenue: number | null;
  firstSaleDate: Date | null;
  lastSaleDate: Date | null;
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

function buildSalesFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  filial: string | null | undefined,
  paramPrefix: string,
  tableAlias = "vp"
) {
  const company = resolveCompany(companySlug);

  if (!company) {
    return "";
  }

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

function buildEcommerceFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  filial: string | null | undefined,
  paramPrefix: string,
  tableAlias = "f"
) {
  const company = resolveCompany(companySlug);

  if (!company) {
    return "";
  }

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

function buildSalesCollectionFilter(
  request: sql.Request | RequestLike,
  colecoes: string[],
  paramPrefix: string
) {
  if (colecoes.length === 0) {
    return "";
  }

  if (colecoes.length === 1) {
    request.input(`${paramPrefix}Colecao`, sql.VarChar, colecoes[0]);
    return `AND UPPER(LTRIM(RTRIM(COALESCE(vp.COLECAO, p.COLECAO, '')))) = @${paramPrefix}Colecao`;
  }

  colecoes.forEach((value, index) => {
    request.input(`${paramPrefix}Colecao${index}`, sql.VarChar, value);
  });

  const placeholders = colecoes
    .map((_, index) => `@${paramPrefix}Colecao${index}`)
    .join(", ");

  return `AND UPPER(LTRIM(RTRIM(COALESCE(vp.COLECAO, p.COLECAO, '')))) IN (${placeholders})`;
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

function mapOriginLabel(companySlug: string | undefined, origin: string | null | undefined) {
  const company = resolveCompany(companySlug);
  const rawOrigin = origin?.trim() || "";
  return rawOrigin ? getFilialLabelForDisplay(company, rawOrigin) : "";
}

function getDetailId(parts: string[]) {
  return parts.map((value) => value.trim()).join("|");
}

function normalizeProductName(value: string | null | undefined, productId: string) {
  const trimmed = value?.trim();
  return trimmed || productId.trim();
}

function aggregateProductRows(
  companySlug: string | undefined,
  channel: ReportChannel,
  rows: Array<SalesDetailRecord | EcommerceDetailRecord>,
  detectedRange: { start: Date | null; end: Date | null },
  totals: { revenue: number; quantity: number }
) {
  const productMap = new Map<string, CollectionReportProductRow>();

  for (const row of rows) {
    const productId = row.productId?.trim() || "";
    if (!productId) {
      continue;
    }

    const productName = normalizeProductName(row.productName, productId);
    const productKey = productName.toUpperCase();
    const grade = row.grade?.trim() || "-";
    const colorCode = row.colorCode?.trim() || "";
    const colorDescription = row.colorDescription?.trim() || "-";
    const origin = mapOriginLabel(companySlug, row.origin) || channel;
    const quantity = Number(row.totalQuantity ?? 0);
    const revenue = Number(row.totalRevenue ?? 0);

    if (!productMap.has(productKey)) {
      productMap.set(productKey, {
        id: productKey,
        productName,
        retailRevenue: 0,
        ecommerceRevenue: 0,
        totalRevenue: 0,
        details: [],
      });
    }

    const product = productMap.get(productKey)!;
    if (channel === "Varejo") {
      product.retailRevenue += revenue;
    } else {
      product.ecommerceRevenue += revenue;
    }
    product.totalRevenue += revenue;

    product.details.push({
      id: getDetailId([channel, origin, productId, grade, colorCode, colorDescription]),
      channel,
      origin,
      productId,
      productName,
      grade,
      colorCode,
      colorDescription,
      quantity,
      revenue,
    });

    totals.revenue += revenue;
    totals.quantity += quantity;

    const firstSaleDate = row.firstSaleDate ? new Date(row.firstSaleDate) : null;
    const lastSaleDate = row.lastSaleDate ? new Date(row.lastSaleDate) : null;

    if (firstSaleDate && (!detectedRange.start || firstSaleDate < detectedRange.start)) {
      detectedRange.start = firstSaleDate;
    }

    if (lastSaleDate && (!detectedRange.end || lastSaleDate > detectedRange.end)) {
      detectedRange.end = lastSaleDate;
    }
  }

  return productMap;
}

async function fetchSalesDetails(
  request: sql.Request | RequestLike,
  company: string | undefined,
  filial: string | null | undefined,
  colecoes: string[]
) {
  if (!shouldIncludeSalesChannel(company, filial)) {
    return [] as SalesDetailRecord[];
  }

  const salesFilial = filial && filial !== VAREJO_VALUE ? filial : VAREJO_VALUE;
  const filialFilter = buildSalesFilialFilter(request, company, salesFilial, "sales");
  const collectionFilter = buildSalesCollectionFilter(request, colecoes, "sales");

  const query = `
    SELECT
      vp.PRODUTO AS productId,
      MAX(COALESCE(p.DESC_PRODUTO, vp.DESC_PRODUTO, vp.PRODUTO)) AS productName,
      MAX(CONVERT(VARCHAR, p.GRADE)) AS grade,
      MAX(CONVERT(VARCHAR, vp.COR_PRODUTO)) AS colorCode,
      MAX(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO, '')) AS colorDescription,
      MAX(vp.FILIAL) AS origin,
      SUM(vp.QTDE) AS totalQuantity,
      SUM(
        CASE
          WHEN vp.QTDE_CANCELADA > 0 THEN 0
          ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
        END
      ) AS totalRevenue,
      MIN(vp.DATA_VENDA) AS firstSaleDate,
      MAX(vp.DATA_VENDA) AS lastSaleDate
    FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
    LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
    WHERE vp.DATA_VENDA >= @startDate
      AND vp.DATA_VENDA < @endDate
      AND vp.QTDE > 0
      ${filialFilter}
      ${collectionFilter}
    GROUP BY
      vp.PRODUTO,
      vp.FILIAL,
      CONVERT(VARCHAR, p.GRADE),
      CONVERT(VARCHAR, vp.COR_PRODUTO)
    ORDER BY totalRevenue DESC
  `;

  const result = await request.query<SalesDetailRecord>(query);
  return result.recordset;
}

async function fetchEcommerceDetails(
  request: sql.Request | RequestLike,
  company: string | undefined,
  filial: string | null | undefined,
  colecoes: string[]
) {
  if (!shouldIncludeEcommerceChannel(company, filial)) {
    return [] as EcommerceDetailRecord[];
  }

  const ecommerceFilial = filial && isEcommerceFilial(company, filial) ? filial : null;
  const filialFilter = buildEcommerceFilialFilter(
    request,
    company,
    ecommerceFilial,
    "ecom"
  );
  const collectionFilter = buildEcommerceCollectionFilter(request, colecoes, "ecom");

  const query = `
    SELECT
      fp.PRODUTO AS productId,
      MAX(COALESCE(p.DESC_PRODUTO, fp.PRODUTO)) AS productName,
      MAX(CONVERT(VARCHAR, p.GRADE)) AS grade,
      MAX(CONVERT(VARCHAR, fp.COR_PRODUTO)) AS colorCode,
      MAX(COALESCE(c.DESC_COR, '')) AS colorDescription,
      MAX(f.FILIAL) AS origin,
      SUM(fp.QTDE) AS totalQuantity,
      SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
      MIN(f.EMISSAO) AS firstSaleDate,
      MAX(f.EMISSAO) AS lastSaleDate
    FROM FATURAMENTO f WITH (NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
      ON f.FILIAL = fp.FILIAL
      AND f.NF_SAIDA = fp.NF_SAIDA
      AND f.SERIE_NF = fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
    LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON fp.COR_PRODUTO = c.COR
    WHERE f.EMISSAO >= @startDate
      AND f.EMISSAO < @endDate
      AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
      AND fp.QTDE > 0
      ${filialFilter}
      ${collectionFilter}
    GROUP BY
      fp.PRODUTO,
      f.FILIAL,
      CONVERT(VARCHAR, p.GRADE),
      CONVERT(VARCHAR, fp.COR_PRODUTO)
    ORDER BY totalRevenue DESC
  `;

  const result = await request.query<EcommerceDetailRecord>(query);
  return result.recordset;
}

export async function fetchCollectionReport({
  company,
  range,
  filial,
  colecoes,
}: CollectionReportQueryParams = {}): Promise<CollectionReportResponse> {
  if (company !== "scarfme") {
    return {
      summary: {
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
      },
      topProducts: [],
      products: [],
    };
  }

  const normalizedCollections = normalizeCollectionValues(colecoes);

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input("startDate", sql.DateTime, start);
    request.input("endDate", sql.DateTime, end);

    const salesRows = await fetchSalesDetails(
      request,
      company,
      filial,
      normalizedCollections
    );
    const ecommerceRows = await fetchEcommerceDetails(
      request,
      company,
      filial,
      normalizedCollections
    );

    const detectedRange = { start: null as Date | null, end: null as Date | null };
    const retailTotals = { revenue: 0, quantity: 0 };
    const ecommerceTotals = { revenue: 0, quantity: 0 };

    const retailMap = aggregateProductRows(
      company,
      "Varejo",
      salesRows,
      detectedRange,
      retailTotals
    );
    const ecommerceMap = aggregateProductRows(
      company,
      "E-commerce",
      ecommerceRows,
      detectedRange,
      ecommerceTotals
    );

    const mergedProducts = new Map<string, CollectionReportProductRow>();

    for (const product of retailMap.values()) {
      mergedProducts.set(product.id, {
        ...product,
        details: [...product.details],
      });
    }

    for (const product of ecommerceMap.values()) {
      const existing = mergedProducts.get(product.id);
      if (!existing) {
        mergedProducts.set(product.id, {
          ...product,
          details: [...product.details],
        });
        continue;
      }

      existing.retailRevenue += product.retailRevenue;
      existing.ecommerceRevenue += product.ecommerceRevenue;
      existing.totalRevenue += product.totalRevenue;
      existing.details.push(...product.details);
    }

    const products = Array.from(mergedProducts.values())
      .map((product) => ({
        ...product,
        details: product.details.sort((a, b) => b.revenue - a.revenue),
      }))
      .sort((a, b) => b.totalRevenue - a.totalRevenue);

    const totalRevenue = retailTotals.revenue + ecommerceTotals.revenue;
    const totalQuantity = retailTotals.quantity + ecommerceTotals.quantity;

    return {
      summary: {
        totalRevenue,
        retailRevenue: retailTotals.revenue,
        ecommerceRevenue: ecommerceTotals.revenue,
        totalQuantity,
        retailQuantity: retailTotals.quantity,
        ecommerceQuantity: ecommerceTotals.quantity,
        retailShare: totalRevenue > 0 ? (retailTotals.revenue / totalRevenue) * 100 : 0,
        ecommerceShare: totalRevenue > 0 ? (ecommerceTotals.revenue / totalRevenue) * 100 : 0,
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
  });
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
      const filialFilter = buildSalesFilialFilter(request, company, salesFilial, "salesOptions");
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
      const filialFilter = buildEcommerceFilialFilter(
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

    if (shouldIncludeSalesChannel(company, filial)) {
      const salesFilial = filial && filial !== VAREJO_VALUE ? filial : VAREJO_VALUE;
      const filialFilter = buildSalesFilialFilter(
        request,
        company,
        salesFilial,
        "salesRange"
      );
      const collectionFilter = buildSalesCollectionFilter(
        request,
        normalizedCollections,
        "salesRange"
      );
      const result = await request.query<{
        startDate: Date | null;
        endDate: Date | null;
      }>(`
        SELECT
          MIN(vp.DATA_VENDA) AS startDate,
          MAX(vp.DATA_VENDA) AS endDate
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.QTDE > 0
          ${filialFilter}
          ${collectionFilter}
      `);

      const row = result.recordset[0];
      if (row?.startDate && (!detectedStartDate || row.startDate < detectedStartDate)) {
        detectedStartDate = row.startDate;
      }
      if (row?.endDate && (!detectedEndDate || row.endDate > detectedEndDate)) {
        detectedEndDate = row.endDate;
      }
    }

    if (shouldIncludeEcommerceChannel(company, filial)) {
      const ecommerceFilial = filial && isEcommerceFilial(company, filial) ? filial : null;
      const filialFilter = buildEcommerceFilialFilter(
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
      if (row?.startDate && (!detectedStartDate || row.startDate < detectedStartDate)) {
        detectedStartDate = row.startDate;
      }
      if (row?.endDate && (!detectedEndDate || row.endDate > detectedEndDate)) {
        detectedEndDate = row.endDate;
      }
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

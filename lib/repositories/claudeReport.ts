import sql from "mssql";

import { resolveCompany, VAREJO_VALUE, type CompanyConfig } from "@/lib/config/company";
import { withRequest } from "@/lib/db/connection";
import { RequestLike } from "@/lib/db/proxy";
import { fetchTopProdutosUltimos3Meses } from "@/lib/repositories/controleEstoque";
import { fetchAvailableColecoesWithDescriptions } from "@/lib/repositories/products";
import {
  formatDateForQuery,
  normalizeRangeForQuery,
  shiftRangeByMonths,
  type NormalizedRange,
} from "@/lib/utils/date";

type SalesChannel = "LOJA" | "E-COMMERCE";

interface SalesRow {
  date: string;
  channel: SalesChannel;
  filial: string;
  filialDisplay: string;
  operator: string;
  product: string;
  description: string;
  line: string;
  subgrupo: string;
  tipoProduto: string;
  colecao: string;
  grade: string;
  cor: string;
  corDescricao: string;
  codigoBarra: string;
  quantity: number;
  revenue: number;
}

interface StockRow {
  product: string;
  cor: string;
  stock: number;
}

interface AbcItem {
  skuKey: string;
  product: string;
  description: string;
  line: string;
  subgrupo: string;
  tipoProduto: string;
  colecao: string;
  grade: string;
  cor: string;
  corDescricao: string;
  codigoBarra: string;
  revenue: number;
  quantity: number;
  stock: number;
  suggestion: number;
  curve: "A" | "B" | "C";
  rank: number;
  share: number;
  cumulativeShare: number;
}

interface ShareRankingRow {
  label: string;
  revenue: number;
  quantity: number;
  skus: number;
  share: number;
  recentRevenue: number;
  recentShare: number;
  deltaPp: number;
}

interface CurveSummaryRow {
  curve: "A" | "B" | "C";
  skus: number;
  quantity: number;
  revenue: number;
  stock: number;
  share: number;
}

interface BranchRankingRow {
  filial: string;
  operator: string;
  revenue: number;
  quantity: number;
  share: number;
}

interface BranchProfileRow {
  filial: string;
  revenue: number;
  growth: number;
  collections: string;
  color: string;
}

interface StockBucketRow {
  label: string;
  count: number;
  pct: number;
}

interface StoryRow {
  title: string;
  text: string;
}

interface RecommendationRow {
  title: string;
  text: string;
}

interface ChannelMixSummary {
  hasEcommerce: boolean;
  physicalRevenue: number;
  physicalUnits: number;
  physicalShare: number;
  physicalTicket: number;
  physicalActiveCount: number;
  ecommerceRevenue: number;
  ecommerceUnits: number;
  ecommerceShare: number;
  ecommerceTicket: number;
  ecommerceGrowth: number;
  note: string;
}

interface ClosingSummary {
  headline: string;
  body: string;
  badge: string;
}

export interface ClaudeReportRequest {
  filial?: string | null;
  range: {
    start?: string | Date;
    end?: string | Date;
  };
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
}

export interface ClaudeReportPayload {
  scopeLabel: string;
  gradeLabel: string;
  appliedFilters: {
    colecoes: string[];
    subgrupos: string[];
    grades: string[];
  };
  presentation: {
    badge: string;
    coverTitle: string;
    metaLine: string;
    summaryLead: string;
    performanceLead: string;
    closingLead: string;
  };
  range: {
    start: string;
    end: string;
    label: string;
    recentLabel: string;
    months: number;
  };
  summary: {
    totalRevenue: number;
    totalUnits: number;
    skuCount: number;
    activeStoreCount: number;
    retention: number;
    yoyNetwork: number;
    yoyLabel: string;
    monthProjected: number;
    monthProjectionYoy: number;
    monthActual: number;
    monthPrevious: number;
    monthCurrentLabel: string;
    monthPreviousLabel: string;
    stockTotal: number;
    coverageMonths: number;
    ruptureCount: number;
    openPurchaseCount: number;
  };
  curveSummary: CurveSummaryRow[];
  topCurveA: AbcItem[];
  yearSummary: Array<{
    year: number;
    revenue: number;
    quantity: number;
  }>;
  typeRanking: ShareRankingRow[];
  collectionRanking: ShareRankingRow[];
  colorRanking: ShareRankingRow[];
  subgroupRanking: ShareRankingRow[];
  branchRanking: BranchRankingRow[];
  branchProfiles: BranchProfileRow[];
  growthLabel: string;
  channelMix: ChannelMixSummary;
  stockBuckets: StockBucketRow[];
  ruptureTable: AbcItem[];
  purchaseByCurve: Array<{
    curve: "A" | "B" | "C";
    count: number;
  }>;
  warmingTypes: ShareRankingRow[];
  coolingCollections: ShareRankingRow[];
  movementTable: ShareRankingRow[];
  story: StoryRow[];
  closing: ClosingSummary;
  recommendations: RecommendationRow[];
}

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const REPORT_EXCLUDED_FILIAIS = new Set(["SCARF ME - MATRIZ", "SCARFME - IBIRAPUERA LLL"]);

function cleanText(value: unknown): string {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/\u200b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLikeValue(value: string): string {
  return cleanText(value).toUpperCase();
}

function uniqueValues(values?: string[] | null): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => escapeLikeValue(value))
        .filter(Boolean)
    )
  );
}

function buildCollectionLabelMap(options: Array<{ value: string; label: string }>): Map<string, string> {
  return new Map(
    options
      .map((option) => [escapeLikeValue(option.value), cleanText(option.label)] as const)
      .filter((entry) => entry[0] && entry[1])
  );
}

function resolveCollectionLabel(value: string, labelMap: Map<string, string>): string {
  const normalized = escapeLikeValue(value);
  return labelMap.get(normalized) ?? cleanText(value);
}

function formatPctText(value: number): string {
  const signal = value > 0 ? "+" : "";
  return `${signal}${value.toFixed(1).replace(".", ",")}%`;
}

function monthLabelFromDate(date: Date): string {
  return `${MONTHS_PT[date.getUTCMonth()]}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function dateRangeLabel(start: Date, endInclusive: Date): string {
  return `${monthLabelFromDate(start)} a ${monthLabelFromDate(endInclusive)}`;
}

function monthsBetween(start: Date, endInclusive: Date): number {
  return (endInclusive.getUTCFullYear() - start.getUTCFullYear()) * 12
    + (endInclusive.getUTCMonth() - start.getUTCMonth())
    + 1;
}

function shiftRangeByDays(range: NormalizedRange, days: number): NormalizedRange {
  const delta = days * 24 * 60 * 60 * 1000;
  return {
    start: new Date(range.start.getTime() + delta),
    end: new Date(range.end.getTime() + delta),
  };
}

function previousEquivalentRange(range: NormalizedRange): NormalizedRange {
  const durationMs = range.end.getTime() - range.start.getTime();
  return {
    start: new Date(range.start.getTime() - durationMs),
    end: new Date(range.start.getTime()),
  };
}

function normalizeFilialKey(value: string): string {
  return cleanText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeOperator(rawName: string): { display: string; operator: string } {
  let raw = cleanText(rawName).toUpperCase();
  let operator = "";

  const hyphenMatch = raw.match(/\s-\s([A-Z]{3,5})$/);
  if (hyphenMatch) {
    operator = hyphenMatch[1] ?? "";
    raw = raw.replace(/\s-\s[A-Z]{3,5}$/, "").trim();
  } else {
    const tokenMatch = raw.match(/\b([A-Z]{3,5})$/);
    if (tokenMatch && raw.includes(" ")) {
      operator = tokenMatch[1] ?? "";
      raw = raw.replace(/\b[A-Z]{3,5}$/, "").trim().replace(/[-\s]+$/, "");
    }
  }

  raw = raw
    .replace(/^SCARF ?ME\b/, "")
    .replace(/^SCARFME\b/, "")
    .replace(/^NERD\b/, "")
    .trim()
    .replace(/^[-\s]+|[-\s]+$/g, "");

  const replacements: Record<string, string> = {
    "IGUATEMI SP": "IGUATEMI SP",
    "SCARF ME HIGIENOPOLIS 2": "HIGIENOPOLIS 2",
    "ME PAULISTA FFF": "PAULISTA FFF",
    "PAULISTA RSR": "PAULISTA RSR",
  };

  const displayBase = replacements[raw] ?? raw;
  const display = displayBase.startsWith("ME ") ? displayBase.slice(3) : displayBase;
  return {
    display: display || cleanText(rawName),
    operator,
  };
}

function buildScopeMaps(company: CompanyConfig) {
  const ecommerceSet = new Set(company.ecommerceFilials ?? []);
  const members = company.filialFilters.sales.filter((filial) => !REPORT_EXCLUDED_FILIAIS.has(filial));
  const groups = company.filialGroups ?? {};
  const canonicalToMembers = new Map<string, string[]>();
  const nonCanonicalMembers = new Set<string>();

  Object.entries(groups).forEach(([canonical, groupMembers]) => {
    canonicalToMembers.set(canonical, groupMembers);
    groupMembers.forEach((member) => {
      if (member !== canonical) {
        nonCanonicalMembers.add(member);
      }
    });
  });

  const ecommerceMembers = members.filter((filial) => ecommerceSet.has(filial));
  let ecommerceCanonical: string | null = null;
  if (ecommerceMembers.length > 0) {
    ecommerceCanonical = ecommerceMembers[0] ?? null;
    if (ecommerceCanonical) {
      canonicalToMembers.set(ecommerceCanonical, ecommerceMembers);
      ecommerceMembers.slice(1).forEach((member) => nonCanonicalMembers.add(member));
    }
  }

  const memberToCanonical = new Map<string, string>();
  canonicalToMembers.forEach((groupMembers, canonical) => {
    memberToCanonical.set(normalizeFilialKey(canonical), canonical);
    groupMembers.forEach((member) => {
      memberToCanonical.set(normalizeFilialKey(member), canonical);
    });
  });

  return {
    ecommerceSet,
    canonicalToMembers,
    nonCanonicalMembers,
    memberToCanonical,
    ecommerceCanonical,
    physicalMembers: members.filter((filial) => !ecommerceSet.has(filial)),
    ecommerceMembers,
  };
}

function resolveCanonicalFilial(
  rawFilial: string,
  company: CompanyConfig,
  maps: ReturnType<typeof buildScopeMaps>
): string {
  const normalized = normalizeFilialKey(rawFilial);
  const direct = maps.memberToCanonical.get(normalized);
  if (direct) {
    return direct;
  }

  for (const filial of company.filialFilters.sales) {
    if (normalizeFilialKey(filial) === normalized) {
      return filial;
    }
  }

  return rawFilial;
}

function resolveScope(filial: string | null | undefined, company: CompanyConfig) {
  const maps = buildScopeMaps(company);
  const canonical = filial ? resolveCanonicalFilial(filial, company, maps) : null;

  if (!canonical) {
    return {
      displayName: "Rede Geral",
      posMembers: maps.physicalMembers,
      ecommerceMembers: maps.ecommerceMembers,
      maps,
    };
  }

  if (canonical === VAREJO_VALUE) {
    return {
      displayName: "Varejo",
      posMembers: maps.physicalMembers,
      ecommerceMembers: [] as string[],
      maps,
    };
  }

  if (canonical === maps.ecommerceCanonical) {
    return {
      displayName: company.filialDisplayNames?.[canonical] ?? "E-COMMERCE",
      posMembers: [] as string[],
      ecommerceMembers: maps.ecommerceMembers,
      maps,
    };
  }

  const members = maps.canonicalToMembers.get(canonical) ?? [canonical];
    return {
      displayName: company.filialDisplayNames?.[canonical] ?? canonical,
      posMembers: members.filter((member) => !maps.ecommerceSet.has(member) && !REPORT_EXCLUDED_FILIAIS.has(member)),
      ecommerceMembers: [] as string[],
      maps,
    };
}

function addArrayFilter(
  request: sql.Request | RequestLike,
  values: string[] | null | undefined,
  paramBase: string,
  sqlExpression: string
): string {
  const normalized = uniqueValues(values);
  if (normalized.length === 0) {
    return "";
  }

  if (normalized.length === 1) {
    request.input(paramBase, sql.VarChar, normalized[0]);
    return ` AND UPPER(LTRIM(RTRIM(${sqlExpression}))) = @${paramBase}`;
  }

  normalized.forEach((value, index) => {
    request.input(`${paramBase}${index}`, sql.VarChar, value);
  });
  const placeholders = normalized.map((_, index) => `@${paramBase}${index}`).join(", ");
  return ` AND UPPER(LTRIM(RTRIM(${sqlExpression}))) IN (${placeholders})`;
}

function buildSalesRows(
  rawRows: Array<{
    DATA: Date;
    CANAL: SalesChannel;
    FILIAL: string;
    PRODUTO: string;
    DESCRICAO: string;
    LINHA: string;
    SUBGRUPO: string;
    TIPO_PRODUTO: string;
    COLECAO: string;
    GRADE: string;
    COR: string;
    COR_DESCRICAO: string;
    CODIGO_BARRA: string;
    QTDE: number;
    RECEITA: number;
  }>,
  company: CompanyConfig,
  maps: ReturnType<typeof buildScopeMaps>
): SalesRow[] {
  return rawRows
    .map((row) => {
      const filial = cleanText(row.FILIAL);
      const canonical = row.CANAL === "LOJA"
        ? resolveCanonicalFilial(filial, company, maps)
        : maps.ecommerceCanonical ?? filial;
      const operatorInfo = normalizeOperator(canonical);
      const filialDisplay = row.CANAL === "E-COMMERCE"
        ? "E-COMMERCE"
        : company.filialDisplayNames?.[canonical] ?? operatorInfo.display;

      return {
        date: formatDateForQuery(row.DATA),
        channel: row.CANAL,
        filial,
        filialDisplay,
        operator: row.CANAL === "E-COMMERCE" ? "WEB" : operatorInfo.operator,
        product: cleanText(row.PRODUTO),
        description: cleanText(row.DESCRICAO),
        line: cleanText(row.LINHA),
        subgrupo: cleanText(row.SUBGRUPO),
        tipoProduto: cleanText(row.TIPO_PRODUTO),
        colecao: cleanText(row.COLECAO),
        grade: cleanText(row.GRADE),
        cor: cleanText(row.COR),
        corDescricao: cleanText(row.COR_DESCRICAO),
        codigoBarra: cleanText(row.CODIGO_BARRA),
        quantity: Math.round(Number(row.QTDE ?? 0)),
        revenue: Number(row.RECEITA ?? 0),
      };
    })
    .filter((row) => row.product && row.revenue > 0);
}

async function querySalesRows(
  range: NormalizedRange,
  posMembers: string[],
  ecommerceMembers: string[],
  filters: {
    colecoes?: string[] | null;
    subgrupos?: string[] | null;
    grades?: string[] | null;
  },
  company: CompanyConfig,
  maps: ReturnType<typeof buildScopeMaps>
): Promise<SalesRow[]> {
  const [posRows, ecommerceRows] = await Promise.all([
    posMembers.length > 0
      ? withRequest(async (request) => {
          request.input("posStart", sql.DateTime, range.start);
          request.input("posEnd", sql.DateTime, range.end);
          posMembers.forEach((filial, index) => {
            request.input(`posFilial${index}`, sql.VarChar, filial);
          });

          const filialPlaceholders = posMembers.map((_, index) => `@posFilial${index}`).join(", ");
          const colecaoFilter = addArrayFilter(
            request,
            filters.colecoes,
            "posColecao",
            "COALESCE(vp.COLECAO, p.COLECAO, '')"
          );
          const subgrupoFilter = addArrayFilter(
            request,
            filters.subgrupos,
            "posSubgrupo",
            "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')"
          );
          const gradeFilter = addArrayFilter(
            request,
            filters.grades,
            "posGrade",
            "CONVERT(VARCHAR, p.GRADE)"
          );

          const query = `
            SELECT
              CAST(vp.DATA_VENDA AS DATE) AS DATA,
              'LOJA' AS CANAL,
              ISNULL(vp.FILIAL, '') AS FILIAL,
              ISNULL(vp.PRODUTO, '') AS PRODUTO,
              UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))) AS LINHA,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))))) AS SUBGRUPO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, ''))))) AS TIPO_PRODUTO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(COALESCE(vp.COLECAO, p.COLECAO), ''))))) AS COLECAO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), ''))))) AS GRADE,
              ISNULL(vp.COR_PRODUTO, '') AS COR,
              MAX(ISNULL(COALESCE(cb.DESC_COR, vp.DESC_COR_PRODUTO), '')) AS COR_DESCRICAO,
              ISNULL(pbsel.CODIGO_BARRA, '') AS CODIGO_BARRA,
              SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS QTDE,
              SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) ELSE 0 END) AS RECEITA
            FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
            LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR = vp.COR_PRODUTO
            LEFT JOIN (
              SELECT
                pb.PRODUTO,
                ISNULL(pb.COR_PRODUTO, '') AS COR_PRODUTO,
                MIN(pb.CODIGO_BARRA) AS CODIGO_BARRA
              FROM PRODUTOS_BARRA pb WITH (NOLOCK)
              WHERE ISNULL(pb.CODIGO_BARRA, '') <> ''
              GROUP BY pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '')
            ) pbsel
              ON pbsel.PRODUTO = vp.PRODUTO
             AND pbsel.COR_PRODUTO = ISNULL(vp.COR_PRODUTO, '')
            WHERE vp.DATA_VENDA >= @posStart
              AND vp.DATA_VENDA < @posEnd
              AND vp.QTDE > 0
              AND vp.FILIAL IN (${filialPlaceholders})
              ${colecaoFilter}
              ${subgrupoFilter}
              ${gradeFilter}
            GROUP BY
              CAST(vp.DATA_VENDA AS DATE),
              ISNULL(vp.FILIAL, ''),
              ISNULL(vp.PRODUTO, ''),
              UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))),
              ISNULL(vp.COR_PRODUTO, ''),
              ISNULL(pbsel.CODIGO_BARRA, '')
            HAVING SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) ELSE 0 END) > 0
          `;

          const result = await request.query(query);
          return buildSalesRows(result.recordset as never[], company, maps);
        })
      : Promise.resolve([] as SalesRow[]),
    ecommerceMembers.length > 0
      ? withRequest(async (request) => {
          request.input("ecomStart", sql.DateTime, range.start);
          request.input("ecomEnd", sql.DateTime, range.end);
          ecommerceMembers.forEach((filial, index) => {
            request.input(`ecomFilial${index}`, sql.VarChar, filial);
          });

          const filialPlaceholders = ecommerceMembers.map((_, index) => `@ecomFilial${index}`).join(", ");
          const colecaoFilter = addArrayFilter(
            request,
            filters.colecoes,
            "ecomColecao",
            "COALESCE(p.COLECAO, '')"
          );
          const subgrupoFilter = addArrayFilter(
            request,
            filters.subgrupos,
            "ecomSubgrupo",
            "COALESCE(p.SUBGRUPO_PRODUTO, '')"
          );
          const gradeFilter = addArrayFilter(
            request,
            filters.grades,
            "ecomGrade",
            "CONVERT(VARCHAR, p.GRADE)"
          );

          const query = `
            SELECT
              CAST(f.EMISSAO AS DATE) AS DATA,
              'E-COMMERCE' AS CANAL,
              ISNULL(f.FILIAL, '') AS FILIAL,
              ISNULL(fp.PRODUTO, '') AS PRODUTO,
              UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))) AS LINHA,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, ''))))) AS SUBGRUPO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, ''))))) AS TIPO_PRODUTO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, ''))))) AS COLECAO,
              MAX(UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), ''))))) AS GRADE,
              ISNULL(fp.COR_PRODUTO, '') AS COR,
              MAX(ISNULL(cb.DESC_COR, '')) AS COR_DESCRICAO,
              ISNULL(pbsel.CODIGO_BARRA, '') AS CODIGO_BARRA,
              SUM(CASE WHEN fp.QTDE > 0 THEN fp.QTDE ELSE 0 END) AS QTDE,
              SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS RECEITA
            FROM FATURAMENTO f WITH (NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
              ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
            LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR = fp.COR_PRODUTO
            LEFT JOIN (
              SELECT
                pb.PRODUTO,
                ISNULL(pb.COR_PRODUTO, '') AS COR_PRODUTO,
                MIN(pb.CODIGO_BARRA) AS CODIGO_BARRA
              FROM PRODUTOS_BARRA pb WITH (NOLOCK)
              WHERE ISNULL(pb.CODIGO_BARRA, '') <> ''
              GROUP BY pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '')
            ) pbsel
              ON pbsel.PRODUTO = fp.PRODUTO
             AND pbsel.COR_PRODUTO = ISNULL(fp.COR_PRODUTO, '')
            WHERE CAST(f.EMISSAO AS DATE) >= CAST(@ecomStart AS DATE)
              AND CAST(f.EMISSAO AS DATE) < CAST(@ecomEnd AS DATE)
              AND f.NOTA_CANCELADA = 0
              AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              AND fp.QTDE > 0
              AND f.FILIAL IN (${filialPlaceholders})
              ${colecaoFilter}
              ${subgrupoFilter}
              ${gradeFilter}
            GROUP BY
              CAST(f.EMISSAO AS DATE),
              ISNULL(f.FILIAL, ''),
              ISNULL(fp.PRODUTO, ''),
              UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))),
              ISNULL(fp.COR_PRODUTO, ''),
              ISNULL(pbsel.CODIGO_BARRA, '')
            HAVING SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) > 0
          `;

          const result = await request.query(query);
          return buildSalesRows(result.recordset as never[], company, maps);
        })
      : Promise.resolve([] as SalesRow[]),
  ]);

  return [...posRows, ...ecommerceRows];
}

async function queryCurrentStock(
  members: string[],
  company: CompanyConfig
): Promise<Map<string, number>> {
  if (members.length === 0) {
    return new Map();
  }

  const normalizedMembers = Array.from(new Set(members.map(normalizeFilialKey)));
  const rows = await withRequest(async (request) => {
    normalizedMembers.forEach((filial, index) => {
      request.input(`stockFilial${index}`, sql.VarChar, filial);
    });
    const placeholders = normalizedMembers.map((_, index) => `@stockFilial${index}`).join(", ");
    const query = `
      SELECT
        ISNULL(e.PRODUTO, '') AS PRODUTO,
        ISNULL(e.COR_PRODUTO, '') AS COR,
        CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS POSITIVE_STOCK,
        CAST(SUM(CASE WHEN ISNULL(e.ESTOQUE, 0) < 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS NEGATIVE_STOCK,
        COUNT(CASE WHEN ISNULL(e.ESTOQUE, 0) > 0 THEN 1 END) AS POSITIVE_COUNT
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE UPPER(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(ISNULL(e.FILIAL, ''))), CHAR(9), ' '), NCHAR(0x00A0), ' '), '  ', ' ')) IN (${placeholders})
      GROUP BY ISNULL(e.PRODUTO, ''), ISNULL(e.COR_PRODUTO, '')
      HAVING ABS(SUM(ISNULL(e.ESTOQUE, 0))) > 0
    `;
    const result = await request.query<{
      PRODUTO: string;
      COR: string;
      POSITIVE_STOCK: number;
      NEGATIVE_STOCK: number;
      POSITIVE_COUNT: number;
    }>(query);
    return result.recordset;
  });

  const stockMap = new Map<string, number>();
  rows.forEach((row) => {
    const positiveStock = Number(row.POSITIVE_STOCK ?? 0);
    const negativeStock = Number(row.NEGATIVE_STOCK ?? 0);
    const positiveCount = Number(row.POSITIVE_COUNT ?? 0);
    const finalStock = positiveCount > 0 ? positiveStock : positiveStock + negativeStock;
    stockMap.set(buildSkuKey(cleanText(row.PRODUTO), cleanText(row.COR)), Math.round(finalStock));
  });
  return stockMap;
}

function buildSkuKey(product: string, cor: string): string {
  return `${cleanText(product)}||${cleanText(cor)}`;
}

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function computeRecentWindow(rows: SalesRow[]): { start: Date; end: Date } {
  const maxDate = rows.length > 0
    ? rows.map((row) => toUtcDate(row.date)).sort((a, b) => a.getTime() - b.getTime())[rows.length - 1]
    : new Date();
  const start = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth() - 5, 1));
  return { start, end: maxDate };
}

function buildShareRanking(
  rows: SalesRow[],
  recentStart: Date,
  labelSelector: (row: SalesRow) => string
): ShareRankingRow[] {
  const grouped = new Map<string, { revenue: number; quantity: number; skus: Set<string> }>();
  const recentGrouped = new Map<string, number>();

  rows.forEach((row) => {
    const label = cleanText(labelSelector(row));
    if (!label) {
      return;
    }
    const skuKey = buildSkuKey(row.product, row.cor);
    const current = grouped.get(label) ?? { revenue: 0, quantity: 0, skus: new Set<string>() };
    current.revenue += row.revenue;
    current.quantity += row.quantity;
    current.skus.add(skuKey);
    grouped.set(label, current);

    if (toUtcDate(row.date).getTime() >= recentStart.getTime()) {
      recentGrouped.set(label, (recentGrouped.get(label) ?? 0) + row.revenue);
    }
  });

  const totalRevenue = Array.from(grouped.values()).reduce((sum, item) => sum + item.revenue, 0);
  const totalRecent = Array.from(recentGrouped.values()).reduce((sum, value) => sum + value, 0);

  return Array.from(grouped.entries())
    .map(([label, item]) => {
      const recentRevenue = recentGrouped.get(label) ?? 0;
      const share = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
      const recentShare = totalRecent > 0 ? (recentRevenue / totalRecent) * 100 : 0;
      return {
        label,
        revenue: item.revenue,
        quantity: item.quantity,
        skus: item.skus.size,
        share,
        recentRevenue,
        recentShare,
        deltaPp: recentShare - share,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

function classifyAbc(items: Array<{ skuKey: string; revenue: number }>): Map<string, { curve: "A" | "B" | "C" }> {
  const sorted = [...items].sort((a, b) => b.revenue - a.revenue);
  const total = sorted.reduce((sum, item) => sum + item.revenue, 0);
  const result = new Map<string, { curve: "A" | "B" | "C" }>();
  let cumulative = 0;

  sorted.forEach((item) => {
    cumulative += total > 0 ? (item.revenue / total) * 100 : 0;
    const curve: "A" | "B" | "C" = cumulative <= 80 ? "A" : cumulative <= 95 ? "B" : "C";
    result.set(item.skuKey, { curve });
  });

  return result;
}

function comparableFullYears(rows: SalesRow[]): [number | null, number | null] {
  if (rows.length === 0) {
    return [null, null];
  }

  const maxDate = rows.map((row) => toUtcDate(row.date)).sort((a, b) => a.getTime() - b.getTime())[rows.length - 1];
  const lastCompleteYear = maxDate.getUTCMonth() === 11 && maxDate.getUTCDate() >= 28
    ? maxDate.getUTCFullYear()
    : maxDate.getUTCFullYear() - 1;
  const years = new Set(rows.map((row) => toUtcDate(row.date).getUTCFullYear()));
  if (!years.has(lastCompleteYear) || !years.has(lastCompleteYear - 1)) {
    return [null, null];
  }
  return [lastCompleteYear, lastCompleteYear - 1];
}

function buildEmptyPayload(range: NormalizedRange, scopeLabel: string, gradeLabel: string): ClaudeReportPayload {
  const endInclusive = new Date(range.end.getTime() - 24 * 60 * 60 * 1000);
  return {
    scopeLabel,
    gradeLabel,
    appliedFilters: {
      colecoes: [],
      subgrupos: [],
      grades: [],
    },
    presentation: {
      badge: "VISAO GERAL",
      coverTitle: "A historia do mix geral em 0 filiais.",
      metaLine: `${scopeLabel} - SEM FILTROS`,
      summaryLead: "O mix geral",
      performanceLead: "o mix geral",
      closingLead: "A leitura consolidada da rede",
    },
    range: {
      start: formatDateForQuery(range.start),
      end: formatDateForQuery(endInclusive),
      label: dateRangeLabel(range.start, endInclusive),
      recentLabel: dateRangeLabel(range.start, endInclusive),
      months: monthsBetween(range.start, endInclusive),
    },
    summary: {
      totalRevenue: 0,
      totalUnits: 0,
      skuCount: 0,
      activeStoreCount: 0,
      retention: 0,
      yoyNetwork: 0,
      yoyLabel: "var. comparavel",
      monthProjected: 0,
      monthProjectionYoy: 0,
      monthActual: 0,
      monthPrevious: 0,
      monthCurrentLabel: monthLabelFromDate(endInclusive),
      monthPreviousLabel: `${MONTHS_PT[endInclusive.getUTCMonth()]}/${String(endInclusive.getUTCFullYear() - 1).slice(-2)}`,
      stockTotal: 0,
      coverageMonths: 0,
      ruptureCount: 0,
      openPurchaseCount: 0,
    },
    curveSummary: [],
    topCurveA: [],
    yearSummary: [],
    typeRanking: [],
    collectionRanking: [],
    colorRanking: [],
    subgroupRanking: [],
    branchRanking: [],
    branchProfiles: [],
    growthLabel: "comparativo anterior",
    channelMix: {
      hasEcommerce: false,
      physicalRevenue: 0,
      physicalUnits: 0,
      physicalShare: 0,
      physicalTicket: 0,
      physicalActiveCount: 0,
      ecommerceRevenue: 0,
      ecommerceUnits: 0,
      ecommerceShare: 0,
      ecommerceTicket: 0,
      ecommerceGrowth: 0,
      note: "Sem dados suficientes para leitura por canais.",
    },
    stockBuckets: [],
    ruptureTable: [],
    purchaseByCurve: [
      { curve: "A", count: 0 },
      { curve: "B", count: 0 },
      { curve: "C", count: 0 },
    ],
    warmingTypes: [],
    coolingCollections: [],
    movementTable: [],
    story: [],
    closing: {
      headline: "Leitura indisponivel para o recorte.",
      body: "Nao houve vendas suficientes no periodo para fechar uma conclusao executiva.",
      badge: "Sem leitura",
    },
    recommendations: [],
  };
}

function singularOrPluralLabel(kind: "colecao" | "subgrupo" | "grade", values: string[]): string {
  if (kind === "colecao") {
    return values.length === 1 ? `Colecao ${values[0]}` : `${values.length} colecoes`;
  }
  if (kind === "subgrupo") {
    return values.length === 1 ? `Subgrupo ${values[0]}` : `${values.length} subgrupos`;
  }
  return values.length === 1 ? `Grade ${values[0]}` : `${values.length} grades`;
}

function formatSelectionPreview(
  values: string[],
  singularLabel: string,
  pluralLabel: string
): string {
  if (values.length === 0) {
    return "";
  }

  if (values.length === 1) {
    return `${singularLabel} ${values[0]}`;
  }

  if (values.length === 2) {
    return `${pluralLabel} ${values.join(" e ")}`;
  }

  return `${pluralLabel} ${values.slice(0, 2).join(", ")} +${values.length - 2}`;
}

function buildPresentationContext({
  scopeLabel,
  activeStoreCount,
  colecoes,
  subgrupos,
  grades,
}: {
  scopeLabel: string;
  activeStoreCount: number;
  colecoes: string[];
  subgrupos: string[];
  grades: string[];
}) {
  const parts: string[] = [];
  if (colecoes.length > 0) {
    parts.push(`COLECAO ${colecoes.length === 1 ? colecoes[0] : `${colecoes.length} SELECIONADAS`}`);
  }
  if (subgrupos.length > 0) {
    parts.push(`SUBGRUPO ${subgrupos.length === 1 ? subgrupos[0] : `${subgrupos.length} SELECIONADOS`}`);
  }
  if (grades.length > 0) {
    parts.push(`GRADE ${grades.length === 1 ? grades[0] : `${grades.length} SELECIONADAS`}`);
  }

  const filterKinds = [
    colecoes.length > 0 ? "colecao" : null,
    subgrupos.length > 0 ? "subgrupo" : null,
    grades.length > 0 ? "grade" : null,
  ].filter(Boolean) as Array<"colecao" | "subgrupo" | "grade">;

  if (filterKinds.length === 0) {
    return {
      badge: "VISAO GERAL",
      coverTitle: `A historia do mix geral em ${activeStoreCount} filiais.`,
      metaLine: `${scopeLabel} - SEM FILTROS`,
      summaryLead: "O mix geral",
      performanceLead: "o mix geral",
      closingLead: "A leitura consolidada da rede",
    };
  }

  if (filterKinds.length === 1) {
    const kind = filterKinds[0]!;
    const values = kind === "colecao" ? colecoes : kind === "subgrupo" ? subgrupos : grades;
    const singleValue = values[0] ?? "SELECIONADO";
    const badge = values.length === 1 ? singleValue : singularOrPluralLabel(kind, values).toUpperCase();

    if (kind === "colecao") {
      return {
        badge,
        coverTitle: values.length === 1
          ? `A historia da colecao ${singleValue} em ${activeStoreCount} filiais.`
          : `A historia das colecoes selecionadas em ${activeStoreCount} filiais.`,
        metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
        summaryLead: values.length === 1 ? `A colecao ${singleValue}` : "As colecoes selecionadas",
        performanceLead: values.length === 1 ? `a colecao ${singleValue}` : "as colecoes selecionadas",
        closingLead: values.length === 1 ? `A colecao ${singleValue}` : "As colecoes selecionadas",
      };
    }

    if (kind === "subgrupo") {
      return {
        badge,
        coverTitle: values.length === 1
          ? `A historia do subgrupo ${singleValue} em ${activeStoreCount} filiais.`
          : `A historia dos subgrupos selecionados em ${activeStoreCount} filiais.`,
        metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
        summaryLead: values.length === 1 ? `O subgrupo ${singleValue}` : "Os subgrupos selecionados",
        performanceLead: values.length === 1 ? `o subgrupo ${singleValue}` : "os subgrupos selecionados",
        closingLead: values.length === 1 ? `O subgrupo ${singleValue}` : "Os subgrupos selecionados",
      };
    }

    return {
      badge,
      coverTitle: values.length === 1
        ? `A historia da grade ${singleValue} em ${activeStoreCount} filiais.`
        : `A historia das grades selecionadas em ${activeStoreCount} filiais.`,
      metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
      summaryLead: values.length === 1 ? `A grade ${singleValue}` : "As grades selecionadas",
      performanceLead: values.length === 1 ? `a grade ${singleValue}` : "as grades selecionadas",
      closingLead: values.length === 1 ? `A grade ${singleValue}` : "As grades selecionadas",
    };
  }

  const joinedBadge = [
    colecoes.length === 1 ? colecoes[0] : null,
    subgrupos.length === 1 ? subgrupos[0] : null,
    grades.length === 1 ? grades[0] : null,
  ].filter(Boolean).join(" · ");

  const titleFocusParts = [
    grades.length > 0 ? formatSelectionPreview(grades, "Grade", "Grades") : "",
    subgrupos.length > 0 ? formatSelectionPreview(subgrupos, "Subgrupo", "Subgrupos") : "",
    colecoes.length > 0 ? formatSelectionPreview(colecoes, "Colecao", "Colecoes") : "",
  ].filter(Boolean);
  const readableFocus = titleFocusParts.join(" | ");

  return {
    badge: joinedBadge && joinedBadge.length <= 26 ? joinedBadge : "RECORTE",
    coverTitle: `${readableFocus}: historia em ${activeStoreCount} filiais.`,
    metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
    summaryLead: readableFocus ? `O mix de ${readableFocus}` : "O mix filtrado",
    performanceLead: readableFocus ? `o mix de ${readableFocus}` : "o mix filtrado",
    closingLead: readableFocus ? `O mix de ${readableFocus}` : "O mix filtrado",
  };
}

export async function fetchClaudeReport({
  filial,
  range,
  colecoes,
  subgrupos,
  grades,
}: ClaudeReportRequest): Promise<ClaudeReportPayload> {
  const company = resolveCompany("scarfme");
  if (!company) {
    throw new Error("Empresa scarfme nao encontrada.");
  }

  const normalizedRange = normalizeRangeForQuery(range);
  const endInclusive = new Date(normalizedRange.end.getTime() - 24 * 60 * 60 * 1000);
  const scope = resolveScope(filial ?? null, company);
  const selectedColecoes = uniqueValues(colecoes);
  const selectedSubgrupos = uniqueValues(subgrupos);
  const selectedGrades = uniqueValues(grades);
  const gradeLabel = selectedGrades[0] ?? "MIX";

  const suggestionRowsPromise = fetchTopProdutosUltimos3Meses({
    company: "scarfme",
    filial: filial ?? null,
    colecoes: selectedColecoes,
    subgrupos: selectedSubgrupos,
    grades: selectedGrades,
    qtdCompra: 100000,
    porCor: true,
    limit: 5000,
    allowedFiliais: [...scope.posMembers, ...scope.ecommerceMembers],
  }).catch((error) => {
    console.warn("[fetchClaudeReport] Falha ao carregar sugestoes de compra; seguindo sem sugestoes.", error);
    return [];
  });

  const collectionOptionsPromise = fetchAvailableColecoesWithDescriptions({
    company: "scarfme",
    range: normalizedRange,
    filial: filial ?? null,
    subgrupos: selectedSubgrupos,
    grades: selectedGrades,
  }).catch((error) => {
    console.warn("[fetchClaudeReport] Falha ao carregar rotulos de colecao; usando valores crus.", error);
    return [];
  });

  const [salesRows, previousStoreRows, stockMap, suggestionRows, collectionOptions] = await Promise.all([
    querySalesRows(
      normalizedRange,
      scope.posMembers,
      scope.ecommerceMembers,
      { colecoes: selectedColecoes, subgrupos: selectedSubgrupos, grades: selectedGrades },
      company,
      scope.maps
    ),
    querySalesRows(
      previousEquivalentRange(normalizedRange),
      scope.posMembers,
      scope.ecommerceMembers,
      { colecoes: selectedColecoes, subgrupos: selectedSubgrupos, grades: selectedGrades },
      company,
      scope.maps
    ),
    queryCurrentStock([...scope.posMembers, ...scope.ecommerceMembers], company),
    suggestionRowsPromise,
    collectionOptionsPromise,
  ]);

  const collectionLabelMap = buildCollectionLabelMap(collectionOptions);
  const selectedCollectionLabels = selectedColecoes.map((value) => resolveCollectionLabel(value, collectionLabelMap));
  const labeledSalesRows = salesRows.map((row) => ({
    ...row,
    colecao: resolveCollectionLabel(row.colecao, collectionLabelMap),
  }));
  const labeledPreviousStoreRows = previousStoreRows.map((row) => ({
    ...row,
    colecao: resolveCollectionLabel(row.colecao, collectionLabelMap),
  }));

  if (salesRows.length === 0) {
    const emptyPayload = buildEmptyPayload(normalizedRange, scope.displayName, gradeLabel);
    emptyPayload.presentation = buildPresentationContext({
      scopeLabel: scope.displayName,
      activeStoreCount: 0,
      colecoes: selectedCollectionLabels,
      subgrupos: selectedSubgrupos,
      grades: selectedGrades,
    });
    return emptyPayload;
  }

  const suggestionMap = new Map<string, number>();
  suggestionRows.forEach((row) => {
    suggestionMap.set(
      buildSkuKey(cleanText(row.produto), cleanText(row.cor ?? "")),
      Math.max(0, Math.round(Number(row.qtdSugerida ?? 0)))
    );
  });

  const recentWindow = computeRecentWindow(labeledSalesRows);
  const recentLabel = dateRangeLabel(recentWindow.start, recentWindow.end);

  const abcMap = new Map<string, Omit<AbcItem, "curve" | "rank" | "share" | "cumulativeShare">>();
  labeledSalesRows.forEach((row) => {
    const skuKey = buildSkuKey(row.product, row.cor);
    const current = abcMap.get(skuKey) ?? {
      skuKey,
      product: row.product,
      description: row.description,
      line: row.line,
      subgrupo: row.subgrupo,
      tipoProduto: row.tipoProduto,
      colecao: row.colecao,
      grade: row.grade,
      cor: row.cor,
      corDescricao: row.corDescricao,
      codigoBarra: row.codigoBarra,
      revenue: 0,
      quantity: 0,
      stock: stockMap.get(skuKey) ?? 0,
      suggestion: suggestionMap.get(skuKey) ?? 0,
    };

    current.revenue += row.revenue;
    current.quantity += row.quantity;
    if (!current.description && row.description) current.description = row.description;
    if (!current.line && row.line) current.line = row.line;
    if (!current.subgrupo && row.subgrupo) current.subgrupo = row.subgrupo;
    if (!current.tipoProduto && row.tipoProduto) current.tipoProduto = row.tipoProduto;
    if (!current.colecao && row.colecao) current.colecao = row.colecao;
    if (!current.grade && row.grade) current.grade = row.grade;
    if (!current.corDescricao && row.corDescricao) current.corDescricao = row.corDescricao;
    if (!current.codigoBarra && row.codigoBarra) current.codigoBarra = row.codigoBarra;
    abcMap.set(skuKey, current);
  });

  const abcClassification = classifyAbc(
    Array.from(abcMap.values()).map((item) => ({ skuKey: item.skuKey, revenue: item.revenue }))
  );
  const totalRevenue = labeledSalesRows.reduce((sum, row) => sum + row.revenue, 0);
  let cumulativeShare = 0;

  const abcItems: AbcItem[] = Array.from(abcMap.values())
    .sort((a, b) => b.revenue - a.revenue)
    .map((item, index) => {
      const share = totalRevenue > 0 ? (item.revenue / totalRevenue) * 100 : 0;
      cumulativeShare += share;
      return {
        ...item,
        curve: abcClassification.get(item.skuKey)?.curve ?? "C",
        rank: index + 1,
        share,
        cumulativeShare,
      };
    });

  const curveSummaryMap = new Map<"A" | "B" | "C", CurveSummaryRow>();
  (["A", "B", "C"] as const).forEach((curve) => {
    curveSummaryMap.set(curve, { curve, skus: 0, quantity: 0, revenue: 0, stock: 0, share: 0 });
  });
  abcItems.forEach((item) => {
    const row = curveSummaryMap.get(item.curve)!;
    row.skus += 1;
    row.quantity += item.quantity;
    row.revenue += item.revenue;
    row.stock += item.stock;
  });
  curveSummaryMap.forEach((row) => {
    row.share = totalRevenue > 0 ? (row.revenue / totalRevenue) * 100 : 0;
  });
  const curveSummary = Array.from(curveSummaryMap.values());

  const typeRanking = buildShareRanking(labeledSalesRows, recentWindow.start, (row) => row.tipoProduto);
  const collectionRanking = buildShareRanking(labeledSalesRows, recentWindow.start, (row) => row.colecao);
  const colorRanking = buildShareRanking(labeledSalesRows, recentWindow.start, (row) => row.corDescricao || row.cor);
  const subgroupRanking = buildShareRanking(labeledSalesRows, recentWindow.start, (row) => row.subgrupo);

  const physicalRows = labeledSalesRows;
  const previousPhysicalRows = labeledPreviousStoreRows;
  const activeStoreCount = new Set(
    physicalRows.filter((row) => row.revenue > 0).map((row) => row.filialDisplay)
  ).size;

  const branchCurrentMap = new Map<string, BranchRankingRow>();
  physicalRows.forEach((row) => {
    const current = branchCurrentMap.get(row.filialDisplay) ?? {
      filial: row.filialDisplay,
      operator: row.operator || "",
      revenue: 0,
      quantity: 0,
      share: 0,
    };
    current.revenue += row.revenue;
    current.quantity += row.quantity;
    if (!current.operator && row.operator) current.operator = row.operator;
    branchCurrentMap.set(row.filialDisplay, current);
  });
  const totalPhysicalRevenue = Array.from(branchCurrentMap.values()).reduce((sum, row) => sum + row.revenue, 0);
  const branchRanking = Array.from(branchCurrentMap.values())
    .map((row) => ({
      ...row,
      share: totalPhysicalRevenue > 0 ? (row.revenue / totalPhysicalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const previousBranchRevenue = new Map<string, number>();
  previousPhysicalRows.forEach((row) => {
    previousBranchRevenue.set(
      row.filialDisplay,
      (previousBranchRevenue.get(row.filialDisplay) ?? 0) + row.revenue
    );
  });
  const branchProfiles = branchRanking.slice(0, 6).map((row) => {
    const storeRows = physicalRows.filter((item) => item.filialDisplay === row.filial);
    const collectionTotals = new Map<string, number>();
    const colorTotals = new Map<string, number>();
    storeRows.forEach((item) => {
      if (item.colecao) {
        collectionTotals.set(item.colecao, (collectionTotals.get(item.colecao) ?? 0) + item.revenue);
      }
      const color = item.corDescricao || item.cor;
      if (color) {
        colorTotals.set(color, (colorTotals.get(color) ?? 0) + item.revenue);
      }
    });
    const topCollections = Array.from(collectionTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([label]) => label);
    const topColor = Array.from(colorTotals.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "sem destaque";
    const previousRevenue = previousBranchRevenue.get(row.filial) ?? 0;
    const growth = previousRevenue > 0 ? ((row.revenue / previousRevenue) - 1) * 100 : 0;

    return {
      filial: row.filial,
      revenue: row.revenue,
      growth,
      collections: topCollections.length > 0 ? topCollections.join(" · ") : "sem destaque",
      color: topColor,
    };
  });

  const storeRows = labeledSalesRows.filter((row) => row.channel === "LOJA");
  const ecommerceRows = labeledSalesRows.filter((row) => row.channel === "E-COMMERCE");
  const previousEcommerceRows = labeledPreviousStoreRows.filter((row) => row.channel === "E-COMMERCE");
  const physicalRevenue = storeRows.reduce((sum, row) => sum + row.revenue, 0);
  const physicalUnits = storeRows.reduce((sum, row) => sum + row.quantity, 0);
  const ecommerceRevenue = ecommerceRows.reduce((sum, row) => sum + row.revenue, 0);
  const ecommerceUnits = ecommerceRows.reduce((sum, row) => sum + row.quantity, 0);
  const ecommercePreviousRevenue = previousEcommerceRows.reduce((sum, row) => sum + row.revenue, 0);
  const ecommerceGrowth = ecommercePreviousRevenue > 0
    ? ((ecommerceRevenue / ecommercePreviousRevenue) - 1) * 100
    : 0;
  const channelMix: ChannelMixSummary = {
    hasEcommerce: ecommerceRevenue > 0,
    physicalRevenue,
    physicalUnits,
    physicalShare: totalRevenue > 0 ? (physicalRevenue / totalRevenue) * 100 : 0,
    physicalTicket: physicalUnits > 0 ? physicalRevenue / physicalUnits : 0,
    physicalActiveCount: new Set(storeRows.filter((row) => row.revenue > 0).map((row) => row.filialDisplay)).size,
    ecommerceRevenue,
    ecommerceUnits,
    ecommerceShare: totalRevenue > 0 ? (ecommerceRevenue / totalRevenue) * 100 : 0,
    ecommerceTicket: ecommerceUnits > 0 ? ecommerceRevenue / ecommerceUnits : 0,
    ecommerceGrowth,
    note: ecommerceRevenue > 0
      ? ecommercePreviousRevenue > 0
        ? `E-commerce responde por ${formatPctText(totalRevenue > 0 ? (ecommerceRevenue / totalRevenue) * 100 : 0)} do faturamento do recorte e varia ${formatPctText(ecommerceGrowth)} contra o range anterior equivalente.`
        : `E-commerce responde por ${formatPctText(totalRevenue > 0 ? (ecommerceRevenue / totalRevenue) * 100 : 0)} do faturamento do recorte e ja merece leitura propria de mix.`
      : "O recorte atual esta concentrado nas operacoes fisicas.",
  };

  const yearSummaryMap = new Map<number, { revenue: number; quantity: number }>();
  labeledSalesRows.forEach((row) => {
    const year = toUtcDate(row.date).getUTCFullYear();
    const current = yearSummaryMap.get(year) ?? { revenue: 0, quantity: 0 };
    current.revenue += row.revenue;
    current.quantity += row.quantity;
    yearSummaryMap.set(year, current);
  });
  const yearSummary = Array.from(yearSummaryMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([year, values]) => ({ year, revenue: values.revenue, quantity: values.quantity }));

  const [lastFullYear, previousFullYear] = comparableFullYears(labeledSalesRows);
  let yoyNetwork = 0;
  let yoyLabel = "var. comparavel";
  if (lastFullYear && previousFullYear) {
    const currentTotal = yearSummary.find((row) => row.year === lastFullYear)?.revenue ?? 0;
    const previousTotal = yearSummary.find((row) => row.year === previousFullYear)?.revenue ?? 0;
    yoyNetwork = previousTotal > 0 ? ((currentTotal / previousTotal) - 1) * 100 : 0;
    yoyLabel = `${lastFullYear} vs ${previousFullYear}`;
  }

  const maxDate = labeledSalesRows.map((row) => toUtcDate(row.date)).sort((a, b) => a.getTime() - b.getTime())[labeledSalesRows.length - 1];
  const currentMonthRows = labeledSalesRows.filter((row) => {
    const date = toUtcDate(row.date);
    return date.getUTCFullYear() === maxDate.getUTCFullYear() && date.getUTCMonth() === maxDate.getUTCMonth();
  });
  const observedDays = new Set(currentMonthRows.map((row) => row.date)).size || 1;
  const daysInMonth = new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth() + 1, 0)).getUTCDate();
  const monthActual = currentMonthRows.reduce((sum, row) => sum + row.revenue, 0);
  const monthProjected = observedDays > 0 ? (monthActual / observedDays) * daysInMonth : monthActual;
  const previousSameMonth = shiftRangeByMonths(
    normalizeRangeForQuery({
      start: new Date(Date.UTC(maxDate.getUTCFullYear(), maxDate.getUTCMonth(), 1)),
      end: maxDate,
    }),
    -12
  );
  const monthPreviousRows = await querySalesRows(
    previousSameMonth,
    scope.posMembers,
    scope.ecommerceMembers,
    { colecoes, subgrupos, grades },
    company,
    scope.maps
  );
  const monthPrevious = monthPreviousRows.reduce((sum, row) => sum + row.revenue, 0);
  const monthProjectionYoy = monthPrevious > 0 ? ((monthProjected / monthPrevious) - 1) * 100 : 0;

  const stockTotal = abcItems.reduce((sum, item) => sum + Math.max(0, item.stock), 0);
  const months = monthsBetween(normalizedRange.start, endInclusive);
  const averageMonthlyUnits = abcItems.reduce((sum, item) => sum + item.quantity, 0) / Math.max(months, 1);
  const coverageMonths = averageMonthlyUnits > 0 ? stockTotal / averageMonthlyUnits : 0;
  const ruptureTable = abcItems
    .filter((item) => item.curve === "A" && item.stock <= 0)
    .sort((a, b) => b.quantity - a.quantity);
  const ruptureCount = abcItems.filter((item) => item.stock <= 0 && item.quantity > 0).length;
  const openPurchaseCount = abcItems.filter((item) => item.suggestion > 0).length;

  const purchaseByCurveMap = new Map<"A" | "B" | "C", number>([
    ["A", 0],
    ["B", 0],
    ["C", 0],
  ]);
  abcItems.forEach((item) => {
    if (item.suggestion > 0) {
      purchaseByCurveMap.set(item.curve, (purchaseByCurveMap.get(item.curve) ?? 0) + 1);
    }
  });
  const purchaseByCurve = (["A", "B", "C"] as const).map((curve) => ({
    curve,
    count: purchaseByCurveMap.get(curve) ?? 0,
  }));

  const stockBuckets: StockBucketRow[] = [
    { label: "Em ruptura", count: abcItems.filter((item) => item.stock <= 0).length, pct: 0 },
    { label: "Critico", count: abcItems.filter((item) => item.stock >= 1 && item.stock <= 2).length, pct: 0 },
    { label: "Baixo", count: abcItems.filter((item) => item.stock >= 3 && item.stock <= 5).length, pct: 0 },
    { label: "Razoavel", count: abcItems.filter((item) => item.stock >= 6 && item.stock <= 10).length, pct: 0 },
    { label: "Confortavel", count: abcItems.filter((item) => item.stock >= 11 && item.stock <= 30).length, pct: 0 },
    { label: "Elevado", count: abcItems.filter((item) => item.stock >= 31).length, pct: 0 },
  ].map((row) => ({
    ...row,
    pct: abcItems.length > 0 ? (row.count / abcItems.length) * 100 : 0,
  }));

  const fullAbcSet = new Set(
    abcItems.filter((item) => item.curve === "A").map((item) => item.skuKey)
  );
  const recentSalesRows = labeledSalesRows.filter((row) => toUtcDate(row.date).getTime() >= recentWindow.start.getTime());
  const recentAbc = classifyAbc(
    Array.from(
      recentSalesRows.reduce((acc, row) => {
        const skuKey = buildSkuKey(row.product, row.cor);
        acc.set(skuKey, (acc.get(skuKey) ?? 0) + row.revenue);
        return acc;
      }, new Map<string, number>())
    ).map(([skuKey, revenue]) => ({ skuKey, revenue }))
  );
  const recentA = new Set(
    Array.from(recentAbc.entries())
      .filter(([, value]) => value.curve === "A")
      .map(([skuKey]) => skuKey)
  );
  const retention = fullAbcSet.size > 0
    ? (Array.from(fullAbcSet).filter((skuKey) => recentA.has(skuKey)).length / fullAbcSet.size) * 100
    : 0;

  const warmingTypes = [...typeRanking].sort((a, b) => b.deltaPp - a.deltaPp).slice(0, 3);
  const coolingCollections = [...collectionRanking].sort((a, b) => a.deltaPp - b.deltaPp).slice(0, 3);
  const movementTable = [...typeRanking]
    .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
    .slice(0, 5);
  const warmingCollections = [...collectionRanking]
    .filter((row) => row.deltaPp > 0)
    .sort((a, b) => b.deltaPp - a.deltaPp)
    .slice(0, 2);

  const topCurve = curveSummary.sort((a, b) => b.share - a.share)[0]?.curve ?? "A";
  const hottestType = warmingTypes[0]?.label ?? "sortimento";
  const coolingCollection = coolingCollections[0]?.label ?? "colecoes legadas";
  const topStore = branchRanking[0] ?? null;

  const story: StoryRow[] = [
    {
      title: "A rede cresce em base consolidada",
      text: `${months} meses somam ${totalRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} e ${Math.round(abcItems.reduce((sum, item) => sum + item.quantity, 0)).toLocaleString("pt-BR")} unidades. ${yoyLabel} ficou em ${yoyNetwork.toFixed(1).replace(".", ",")}%`,
    },
    {
      title: `${topCurve} e o motor do mix`,
      text: `Curva A concentra ${(curveSummary.find((row) => row.curve === "A")?.share ?? 0).toFixed(1).replace(".", ",")}% do faturamento e segue como ancora comercial.`,
    },
    {
      title: `${hottestType} ganha peso recente`,
      text: warmingTypes[0]
        ? `Na janela ${recentLabel}, ${hottestType.toLowerCase()} acelerou ${warmingTypes[0].deltaPp.toFixed(1).replace(".", ",")}pp de participacao sobre o periodo total.`
        : "A composicao recente indica mudancas de demanda importantes.",
    },
    {
      title: channelMix.hasEcommerce ? "Canais lideres concentram a alavanca" : "Filiais lideres concentram a alavanca",
      text: topStore
        ? `${topStore.filial} responde por ${topStore.share.toFixed(1).replace(".", ",")}% da rede consolidada.`
        : "A distribuicao entre filiais precisa de leitura dedicada.",
    },
    {
      title: "Estoque total existe, mas a execucao pressiona",
      text: `${ruptureCount} SKUs ativos estao em ruptura e ${openPurchaseCount} itens pedem reposicao. O gargalo e operacional, nao comercial.`,
    },
  ];

  const recommendations: RecommendationRow[] = [
    {
      title: "Acelerar reposicao dos itens Curva A",
      text: `${purchaseByCurveMap.get("A") ?? 0} SKUs A com alerta e ${ruptureCount} rupturas ativas exigem prioridade imediata.`,
    },
    {
      title: `Apostar nos tipos em aquecimento: ${warmingTypes.map((item) => item.label).slice(0, 2).join(", ") || "mix emergente"}`,
      text: "Direcionar compras e profundidade de estoque para o que vem ganhando participacao na janela recente.",
    },
    {
      title: `Replicar aprendizados de ${topStore?.filial ?? (channelMix.hasEcommerce ? "operacoes lideres" : "lojas lideres")}`,
      text: "Usar o perfil comercial da lider como referencia para mix, sortimento e transferencia entre filiais.",
    },
    {
      title: "Monitorar filiais em maior variacao",
      text: "O comparativo com o range anterior equivalente ajuda a separar aceleracao saudavel de ruido de base pequena.",
    },
    {
      title: `Revisar colecoes em desaceleracao como ${coolingCollection}`,
      text: "Decidir cedo entre aprofundar, reduzir ou substituir exposicao para liberar caixa e espaco.",
    },
  ];

  const presentation = buildPresentationContext({
    scopeLabel: scope.displayName,
    activeStoreCount,
    colecoes: selectedCollectionLabels,
    subgrupos: selectedSubgrupos,
    grades: selectedGrades,
  });

  const ruptureShare = abcItems.length > 0 ? (ruptureCount / abcItems.length) * 100 : 0;
  const closing: ClosingSummary = monthProjectionYoy <= -10
    ? {
        headline: `${presentation.closingLead} em dois ritmos.`,
        body: `O historico segue relevante, mas ${monthLabelFromDate(maxDate)} desacelera ${formatPctText(monthProjectionYoy)} contra a base anterior e pede leitura imediata de demanda, estoque e execucao comercial.`,
        badge: "Atencao imediata",
      }
    : ruptureShare >= 25
      ? {
          headline: `${presentation.closingLead} cresce com pressao operacional.`,
          body: `${formatPctText(ruptureShare)} da carteira ativa esta em ruptura e a rede precisa priorizar reposicao, profundidade e redistribuicao entre operacoes para sustentar venda real.`,
          badge: "Pressao operacional",
        }
      : yoyNetwork >= 10
        ? {
            headline: `${presentation.closingLead} segue forte.`,
            body: `O recorte sustenta ${formatPctText(yoyNetwork)} em ${yoyLabel}, com base de venda consistente e gargalos concentrados em execucao fina de mix e reposicao.`,
            badge: "Crescimento forte",
          }
        : {
            headline: `${presentation.closingLead} pede calibragem fina.`,
            body: `A leitura consolidada nao aponta ruptura estrutural, mas o recorte pede ajustes de mix, priorizacao comercial e monitoramento da janela recente para ganhar tracao.`,
            badge: "Calibragem",
          };

  const dominantGrade = gradeLabel === "MIX"
    ? abcItems.reduce((acc, item) => {
        const key = item.grade || "MIX";
        acc.set(key, (acc.get(key) ?? 0) + item.quantity);
        return acc;
      }, new Map<string, number>())
    : null;
  const resolvedGradeLabel = dominantGrade
    ? Array.from(dominantGrade.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? gradeLabel
    : gradeLabel;

  return {
    scopeLabel: scope.displayName,
    gradeLabel: resolvedGradeLabel,
    appliedFilters: {
      colecoes: selectedCollectionLabels,
      subgrupos: selectedSubgrupos,
      grades: selectedGrades,
    },
    presentation,
    range: {
      start: formatDateForQuery(normalizedRange.start),
      end: formatDateForQuery(endInclusive),
      label: dateRangeLabel(normalizedRange.start, endInclusive),
      recentLabel,
      months,
    },
    summary: {
      totalRevenue,
      totalUnits: abcItems.reduce((sum, item) => sum + item.quantity, 0),
      skuCount: abcItems.length,
      activeStoreCount,
      retention,
      yoyNetwork,
      yoyLabel,
      monthProjected,
      monthProjectionYoy,
      monthActual,
      monthPrevious,
      monthCurrentLabel: monthLabelFromDate(maxDate),
      monthPreviousLabel: `${MONTHS_PT[maxDate.getUTCMonth()]}/${String(maxDate.getUTCFullYear() - 1).slice(-2)}`,
      stockTotal,
      coverageMonths,
      ruptureCount,
      openPurchaseCount,
    },
    curveSummary,
    topCurveA: abcItems.filter((item) => item.curve === "A").slice(0, 10),
    yearSummary,
    typeRanking,
    collectionRanking,
    colorRanking,
    subgroupRanking,
    branchRanking,
    branchProfiles,
    growthLabel: "range anterior equivalente",
    channelMix,
    stockBuckets,
    ruptureTable,
    purchaseByCurve,
    warmingTypes,
    coolingCollections,
    movementTable,
    story,
    closing,
    recommendations,
  };
}

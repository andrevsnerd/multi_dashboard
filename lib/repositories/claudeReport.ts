import sql from "mssql";

import { VAREJO_VALUE, type CompanyConfig } from "@/lib/config/company";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { withRequest } from "@/lib/db/connection";
import { RequestLike } from "@/lib/db/proxy";
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
  generalShare?: number;
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

interface SlideAuditMeta {
  source: string;
  queryBase: string;
  effectiveRange: string;
  appliedFilters: string;
  formula: string;
  checks: string;
}

interface ReportAudit {
  flags: {
    comparableRecentWindow: boolean;
    equivalentWindowComparison: boolean;
    stockTotalUsesScopeInventory: boolean;
    ruptureScopeUsesSoldSkus: boolean;
  };
  slides: Record<string, SlideAuditMeta>;
}

export interface ClaudeReportRequest {
  /** Slug da empresa (padrão 'scarfme'). A curva ABC por SKU/receita funciona para qualquer empresa. */
  company?: string;
  filial?: string | null;
  range: {
    start?: string | Date;
    end?: string | Date;
  };
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grupos?: string[] | null;
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
    previousEquivalentLabel: string;
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
    activeStockTotal: number;
    stockScopeSkuCount: number;
    coverageMonths: number;
    ruptureCount: number;
    openPurchaseCount: number;
    retentionComparable: boolean;
  };
  curveSummary: CurveSummaryRow[];
  topCurveA: AbcItem[];
  yearSummary: Array<{
    year: number;
    revenue: number;
    quantity: number;
    note: string;
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
  warmingTypes: ShareRankingRow[];
  coolingCollections: ShareRankingRow[];
  movementTable: ShareRankingRow[];
  story: StoryRow[];
  closing: ClosingSummary;
  recommendations: RecommendationRow[];
  audit: ReportAudit;
}

const MONTHS_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const REPORT_EXCLUDED_FILIAIS = new Set(["SCARF ME - MATRIZ"]);
const DRIFT_MIN_PP = 0.25;

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

function hasMeaningfulDrift(value: number): boolean {
  return Math.abs(Number(value ?? 0)) >= DRIFT_MIN_PP;
}

function monthLabelFromDate(date: Date): string {
  return `${MONTHS_PT[date.getUTCMonth()]}/${String(date.getUTCFullYear()).slice(-2)}`;
}

function dateRangeLabel(start: Date, endInclusive: Date): string {
  const sYear = start.getUTCFullYear();
  const eYear = endInclusive.getUTCFullYear();
  const sMonth = start.getUTCMonth();
  const eMonth = endInclusive.getUTCMonth();
  const eLabel = `${MONTHS_PT[eMonth]}/${String(eYear).slice(-2)}`;

  if (sYear === eYear && sMonth === eMonth) {
    const startDay = start.getUTCDate();
    const endDay = endInclusive.getUTCDate();
    const lastDay = new Date(Date.UTC(eYear, eMonth + 1, 0)).getUTCDate();
    if (startDay === 1 && endDay === lastDay) return eLabel;
    return `${startDay}–${endDay} de ${eLabel}`;
  }

  if (sYear === eYear) {
    return `${MONTHS_PT[sMonth]} a ${eLabel}`;
  }

  return `${monthLabelFromDate(start)} a ${eLabel}`;
}

function monthsBetween(start: Date, endInclusive: Date): number {
  const days = Math.round((endInclusive.getTime() - start.getTime()) / 86_400_000) + 1;
  return parseFloat((days / 30.44).toFixed(1));
}

function shiftRangeByDays(range: NormalizedRange, days: number): NormalizedRange {
  const delta = days * 24 * 60 * 60 * 1000;
  return {
    start: new Date(range.start.getTime() + delta),
    end: new Date(range.end.getTime() + delta),
  };
}

function shiftRangeByYears(range: NormalizedRange, years: number): NormalizedRange {
  const start = new Date(range.start);
  const end = new Date(range.end);
  start.setUTCFullYear(start.getUTCFullYear() + years);
  end.setUTCFullYear(end.getUTCFullYear() + years);
  return { start, end };
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

function normalizeFilialFilterValue(value: string): string {
  return cleanText(value)
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toUpperCase();
}

function buildNormalizedFilialSqlExpr(column: string): string {
  return `
    UPPER(
      REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              REPLACE(
                REPLACE(LTRIM(RTRIM(ISNULL(${column}, ''))), NCHAR(0x00A0), ' '),
                CHAR(9), ' '
              ),
              NCHAR(0x2010), '-'
            ),
            NCHAR(0x2011), '-'
          ),
          NCHAR(0x2013), '-'
        ),
        '  ', ' '
      )
    )
  `;
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
    .filter((row) => row.product && row.revenue !== 0);
}

async function querySalesRows(
  range: NormalizedRange,
  posMembers: string[],
  ecommerceMembers: string[],
  filters: {
    colecoes?: string[] | null;
    subgrupos?: string[] | null;
    grupos?: string[] | null;
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
            "COALESCE(p.COLECAO, '')"
          );
          const subgrupoFilter = addArrayFilter(
            request,
            filters.subgrupos,
            "posSubgrupo",
            "COALESCE(p.SUBGRUPO_PRODUTO, '')"
          );
          const grupoFilter = addArrayFilter(
            request,
            filters.grupos,
            "posGrupo",
            "COALESCE(p.GRUPO_PRODUTO, '')"
          );
          const gradeFilter = addArrayFilter(
            request,
            filters.grades,
            "posGrade",
            "CONVERT(VARCHAR, p.GRADE)"
          );
          const trocaColecaoFilter = addArrayFilter(
            request,
            filters.colecoes,
            "troColecao",
            "COALESCE(p.COLECAO, '')"
          );
          const trocaSubgrupoFilter = addArrayFilter(
            request,
            filters.subgrupos,
            "troSubgrupo",
            "COALESCE(p.SUBGRUPO_PRODUTO, '')"
          );
          const trocaGrupoFilter = addArrayFilter(
            request,
            filters.grupos,
            "troGrupo",
            "COALESCE(p.GRUPO_PRODUTO, '')"
          );
          const trocaGradeFilter = addArrayFilter(
            request,
            filters.grades,
            "troGrade",
            "CONVERT(VARCHAR, p.GRADE)"
          );

          const query = `
            WITH vendas_cte AS (
              SELECT
                CAST(vp.DATA_VENDA AS DATE) AS DATA,
                ISNULL(f.FILIAL, '') AS FILIAL,
                ISNULL(vp.PRODUTO, '') AS PRODUTO,
                UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
                UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,
                UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS SUBGRUPO,
                UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, '')))) AS TIPO_PRODUTO,
                UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS COLECAO,
                UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS GRADE,
                ISNULL(vp.COR_PRODUTO, '') AS COR,
                ISNULL(cb.DESC_COR, '') AS COR_DESCRICAO,
                ISNULL(pbsel.CODIGO_BARRA, '') AS CODIGO_BARRA,
                vp.QTDE AS QTDE,
                CAST((vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS RECEITA
              FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
              INNER JOIN LOJA_VENDA v WITH (NOLOCK)
                ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
              LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
              LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
              LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR = vp.COR_PRODUTO
              LEFT JOIN (
                SELECT pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '') AS COR_PRODUTO, MIN(pb.CODIGO_BARRA) AS CODIGO_BARRA
                FROM PRODUTOS_BARRA pb WITH (NOLOCK)
                WHERE ISNULL(pb.CODIGO_BARRA, '') <> ''
                GROUP BY pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '')
              ) pbsel ON pbsel.PRODUTO = vp.PRODUTO AND pbsel.COR_PRODUTO = ISNULL(vp.COR_PRODUTO, '')
              WHERE vp.DATA_VENDA >= @posStart
                AND vp.DATA_VENDA < @posEnd
                AND vp.QTDE_CANCELADA = 0
                AND vp.QTDE > 0
                AND f.FILIAL IN (${filialPlaceholders})
                ${colecaoFilter}
                ${subgrupoFilter}
                ${grupoFilter}
                ${gradeFilter}
            ),
            trocas_cte AS (
              SELECT
                CAST(v.DATA_VENDA AS DATE) AS DATA,
                ISNULL(f.FILIAL, '') AS FILIAL,
                ISNULL(vt.PRODUTO, '') AS PRODUTO,
                UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
                UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,
                UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS SUBGRUPO,
                UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, '')))) AS TIPO_PRODUTO,
                UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS COLECAO,
                UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS GRADE,
                ISNULL(vt.COR_PRODUTO, '') AS COR,
                ISNULL(cb.DESC_COR, '') AS COR_DESCRICAO,
                ISNULL(pbsel.CODIGO_BARRA, '') AS CODIGO_BARRA,
                -vt.QTDE AS QTDE,
                CAST(-(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS RECEITA
              FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
              INNER JOIN LOJA_VENDA v WITH (NOLOCK)
                ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
              LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vt.CODIGO_FILIAL
              LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vt.PRODUTO
              LEFT JOIN CORES_BASICAS cb WITH (NOLOCK) ON cb.COR = vt.COR_PRODUTO
              LEFT JOIN (
                SELECT pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '') AS COR_PRODUTO, MIN(pb.CODIGO_BARRA) AS CODIGO_BARRA
                FROM PRODUTOS_BARRA pb WITH (NOLOCK)
                WHERE ISNULL(pb.CODIGO_BARRA, '') <> ''
                GROUP BY pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '')
              ) pbsel ON pbsel.PRODUTO = vt.PRODUTO AND pbsel.COR_PRODUTO = ISNULL(vt.COR_PRODUTO, '')
              WHERE vt.QTDE_CANCELADA = 0
                AND v.DATA_VENDA >= @posStart
                AND v.DATA_VENDA < @posEnd
                AND f.FILIAL IN (${filialPlaceholders})
                ${trocaColecaoFilter}
                ${trocaSubgrupoFilter}
                ${trocaGrupoFilter}
                ${trocaGradeFilter}
            )
            SELECT
              DATA,
              'LOJA' AS CANAL,
              FILIAL,
              PRODUTO,
              MAX(DESCRICAO) AS DESCRICAO,
              MAX(LINHA) AS LINHA,
              MAX(SUBGRUPO) AS SUBGRUPO,
              MAX(TIPO_PRODUTO) AS TIPO_PRODUTO,
              MAX(COLECAO) AS COLECAO,
              MAX(GRADE) AS GRADE,
              COR,
              MAX(COR_DESCRICAO) AS COR_DESCRICAO,
              MAX(CODIGO_BARRA) AS CODIGO_BARRA,
              SUM(QTDE) AS QTDE,
              SUM(RECEITA) AS RECEITA
            FROM (
              SELECT * FROM vendas_cte
              UNION ALL
              SELECT * FROM trocas_cte
            ) combined
            WHERE PRODUTO <> '' AND FILIAL <> ''
            GROUP BY DATA, FILIAL, PRODUTO, COR
            HAVING SUM(RECEITA) <> 0
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
          const grupoFilter = addArrayFilter(
            request,
            filters.grupos,
            "ecomGrupo",
            "COALESCE(p.GRUPO_PRODUTO, '')"
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
              ${grupoFilter}
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

  const normalizedMembers = Array.from(new Set(members.map(normalizeFilialFilterValue)));
  const rows = await withRequest(async (request) => {
    const filialExpr = buildNormalizedFilialSqlExpr("e.FILIAL");
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
      WHERE ${filialExpr} IN (${placeholders})
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
    // Negativos NUNCA são contabilizados na soma de estoque. POSITIVE_STOCK já é a
    // soma APENAS dos saldos positivos por filial — idêntico ao SUM(MAX(0, estoque))
    // por filial da página /curva-abc. Saldos negativos (rupturas) viram 0, e o SKU
    // segue marcado como ruptura pela regra estoque <= 0.
    const positiveStock = Number(row.POSITIVE_STOCK ?? 0);
    stockMap.set(buildSkuKey(cleanText(row.PRODUTO), cleanText(row.COR)), Math.round(positiveStock));
  });
  return stockMap;
}

function buildSkuKey(product: string, cor: string): string {
  return `${cleanText(product)}||${cleanText(cor)}`;
}

function toUtcDate(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function computeRecentWindow(range: NormalizedRange): { start: Date; end: Date } {
  const endInclusive = new Date(range.end.getTime() - 86_400_000);
  const rollingStart = new Date(Date.UTC(endInclusive.getUTCFullYear(), endInclusive.getUTCMonth() - 5, 1));
  const start = rollingStart.getTime() < range.start.getTime() ? range.start : rollingStart;
  return { start, end: endInclusive };
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
      badge: "VISÃO GERAL",
      coverTitle: "A história do mix geral em 0 filiais.",
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
      previousEquivalentLabel: dateRangeLabel(range.start, endInclusive),
      months: monthsBetween(range.start, endInclusive),
    },
    summary: {
      totalRevenue: 0,
      totalUnits: 0,
      skuCount: 0,
      activeStoreCount: 0,
      retention: 0,
      yoyNetwork: 0,
      yoyLabel: "var. comparável",
      monthProjected: 0,
      monthProjectionYoy: 0,
      monthActual: 0,
      monthPrevious: 0,
      monthCurrentLabel: monthLabelFromDate(endInclusive),
      monthPreviousLabel: `${MONTHS_PT[endInclusive.getUTCMonth()]}/${String(endInclusive.getUTCFullYear() - 1).slice(-2)}`,
      stockTotal: 0,
      activeStockTotal: 0,
      stockScopeSkuCount: 0,
      coverageMonths: 0,
      ruptureCount: 0,
      openPurchaseCount: 0,
      retentionComparable: false,
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
    warmingTypes: [],
    coolingCollections: [],
    movementTable: [],
    story: [],
    closing: {
      headline: "Leitura indisponível para o recorte.",
      body: "Não houve vendas suficientes no período para fechar uma conclusão executiva.",
      badge: "Sem leitura",
    },
    recommendations: [],
    audit: {
      flags: {
        comparableRecentWindow: false,
        equivalentWindowComparison: true,
        stockTotalUsesScopeInventory: true,
        ruptureScopeUsesSoldSkus: true,
      },
      slides: buildAuditSlides({
        scopeLabel,
        filterSummary: `Escopo ${scopeLabel} | Sem filtros específicos`,
        rangeLabel: dateRangeLabel(range.start, endInclusive),
        recentLabel: dateRangeLabel(range.start, endInclusive),
        previousEquivalentLabel: dateRangeLabel(range.start, endInclusive),
        comparableRecentWindow: false,
      }),
    },
  };
}

function singularOrPluralLabel(kind: "colecao" | "subgrupo" | "grade", values: string[]): string {
  if (kind === "colecao") {
    return values.length === 1 ? `Coleção ${values[0]}` : `${values.length} coleções`;
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

function formatAuditFilters(scopeLabel: string, colecoes: string[], subgrupos: string[], grades: string[]): string {
  const parts = [`Escopo ${scopeLabel}`];
  if (colecoes.length > 0) parts.push(`Coleções ${colecoes.join(", ")}`);
  if (subgrupos.length > 0) parts.push(`Subgrupos ${subgrupos.join(", ")}`);
  if (grades.length > 0) parts.push(`Grades ${grades.join(", ")}`);
  return parts.join(" | ");
}

function buildAuditSlides({
  scopeLabel,
  filterSummary,
  rangeLabel,
  recentLabel,
  previousEquivalentLabel,
  comparableRecentWindow,
}: {
  scopeLabel: string;
  filterSummary: string;
  rangeLabel: string;
  recentLabel: string;
  previousEquivalentLabel: string;
  comparableRecentWindow: boolean;
}): Record<string, SlideAuditMeta> {
  const salesSource = "W_CTB_LOJA_VENDA_PEDIDO_PRODUTO (lojas) + FATURAMENTO/W_FATURAMENTO_PROD_02 (e-commerce)";
  const salesQuery = "Vendas líquidas agregadas por produto/cor, filial, coleção, tipo, subgrupo e cor dentro do range filtrado.";
  const stockSource = "ESTOQUE_PRODUTOS";
  const stockQuery = "Saldo atual consolidado por produto/cor nas filiais do escopo filtrado.";
  const salesRange = `Período principal ${rangeLabel}. Janela equivalente anterior ${previousEquivalentLabel}.`;
  const driftRange = comparableRecentWindow
    ? `Período total ${rangeLabel}. Janela recente comparável ${recentLabel}.`
    : `Período total ${rangeLabel}. Sem janela recente comparável distinta dentro do recorte.`;

  return {
    cover: {
      source: salesSource,
      queryBase: salesQuery,
      effectiveRange: salesRange,
      appliedFilters: filterSummary,
      formula: "Receita, unidades e escopo consolidados do recorte ativo.",
      checks: "Slide introdutório; não adiciona cálculo próprio além do consolidado do relatório.",
    },
    summary: {
      source: salesSource,
      queryBase: salesQuery,
      effectiveRange: salesRange,
      appliedFilters: filterSummary,
      formula: "Faturamento total, unidades, SKUs ativos, Curva A e comparativos YoY/projeção mensal do recorte.",
      checks: "SKUs ativos significam SKUs com venda no período filtrado.",
    },
    curveAbc: {
      source: salesSource,
      queryBase: "Classificação ABC por participação acumulada de receita dos SKUs vendidos no período.",
      effectiveRange: `Período total ${rangeLabel}.`,
      appliedFilters: filterSummary,
      formula: "Curva A até 80 por cento da receita acumulada; Curva B até 95 por cento; Curva C acima disso.",
      checks: "A curva considera apenas SKUs com venda no período filtrado.",
    },
    topCurveA: {
      source: `${salesSource} + ${stockSource}`,
      queryBase: "Ranking dos SKUs Curva A por faturamento, com saldo atual por produto/cor.",
      effectiveRange: `Período de vendas ${rangeLabel}; estoque no instante da consulta.`,
      appliedFilters: filterSummary,
      formula: "Top 10 SKUs Curva A por receita do período; estoque é o saldo atual do mesmo SKU.",
      checks: "Estoque é fotografia atual; vendas pertencem ao período filtrado.",
    },
    timeCompare: {
      source: salesSource,
      queryBase: "Mesma janela do calendário deslocada em 1 e 2 anos; projeção do mês corrente pelos dias observados.",
      effectiveRange: `Janela atual ${rangeLabel}. Janelas equivalentes ${previousEquivalentLabel} e ano anterior correspondente.`,
      appliedFilters: filterSummary,
      formula: "Compara recortes equivalentes no tempo, não necessariamente anos fechados.",
      checks: "O slide não deve ser lido como ano calendário cheio quando o range é parcial.",
    },
    typeRanking: {
      source: salesSource,
      queryBase: "Share por tipo_produto com participação total e participação na janela recente.",
      effectiveRange: driftRange,
      appliedFilters: filterSummary,
      formula: "Share total = receita do tipo / receita total; delta pp = share recente menos share total.",
      checks: comparableRecentWindow
        ? "A janela recente é comparável e distinta do período total."
        : "Sem janela recente distinta; use o slide como ranking, não como leitura de drift.",
    },
    collectionRanking: {
      source: salesSource,
      queryBase: "Share por coleção rotulada, com comparação da janela recente.",
      effectiveRange: driftRange,
      appliedFilters: filterSummary,
      formula: "Share e delta pp por coleção sobre o faturamento do recorte.",
      checks: comparableRecentWindow
        ? "Coleções aquecendo/esfriando usam somente movimentos acima do piso material configurado."
        : "Sem janela recente distinta; a leitura é descritiva, não de aceleração.",
    },
    colorRanking: {
      source: salesSource,
      queryBase: "Share por cor_descricao ou cor sobre o faturamento do período.",
      effectiveRange: `Período total ${rangeLabel}.`,
      appliedFilters: filterSummary,
      formula: "Receita da cor / receita total do recorte.",
      checks: "Não há componente temporal adicional além do período filtrado.",
    },
    subgroupRanking: {
      source: salesSource,
      queryBase: "Share por subgrupo com leitura de volume, ticket e quantidade de SKUs.",
      effectiveRange: `Período total ${rangeLabel}.`,
      appliedFilters: filterSummary,
      formula: "Ticket médio = receita do subgrupo / unidades do subgrupo.",
      checks: "Subgrupos refletem somente SKUs com venda no período.",
    },
    channelMix: {
      source: salesSource,
      queryBase: "Separação das vendas por canal LOJA versus E-COMMERCE.",
      effectiveRange: salesRange,
      appliedFilters: filterSummary,
      formula: "Share do canal = receita do canal / receita total do recorte.",
      checks: "Ticket do canal usa receita dividida por unidades do próprio canal.",
    },
    branchRanking: {
      source: salesSource,
      queryBase: "Agrupamento por filialDisplay consolidando receita, unidades e participação relativa.",
      effectiveRange: `Período total ${rangeLabel}.`,
      appliedFilters: filterSummary,
      formula: `Participação da filial = receita da filial / receita ${scopeLabel === "Rede Geral" ? "física" : "do escopo"} consolidada.`,
      checks: "No ranking consolidado, o e-commerce entra como uma operação própria quando existe.",
    },
    branchProfile: {
      source: salesSource,
      queryBase: "Top filiais/operações com mix de coleções, cor líder e crescimento contra janela equivalente anterior.",
      effectiveRange: salesRange,
      appliedFilters: filterSummary,
      formula: "Crescimento = receita atual / receita da janela equivalente anterior menos 1.",
      checks: "A composição do mix é calculada pela própria receita da filial no período.",
    },
    stockCurrent: {
      source: `${stockSource} + ${salesSource}`,
      queryBase: `${stockQuery} Cobertura e rupturas são cruzadas com os SKUs que venderam no período.`,
      effectiveRange: `Estoque atual no instante da consulta; vendas do período ${rangeLabel}.`,
      appliedFilters: filterSummary,
      formula: "Estoque total = soma dos saldos positivos do escopo. Cobertura comparável = estoque atual dos SKUs vendidos / venda média mensal dos SKUs vendidos.",
      checks: "Ruptura considera somente SKUs com venda no período e estoque menor ou igual a zero.",
    },
    ruptureFocus: {
      source: `${stockSource} + ${salesSource}`,
      queryBase: "Lista de SKUs Curva A com venda no período e saldo atual menor ou igual a zero.",
      effectiveRange: `Vendas ${rangeLabel}; estoque no instante da consulta.`,
      appliedFilters: filterSummary,
      formula: "Ruptura A = SKU Curva A vendido no período com estoque atual menor ou igual a zero.",
      checks: "Faturamento em risco reflete venda histórica do período, não perda futura projetada.",
    },
    ruptureDetail: {
      source: `${stockSource} + ${salesSource}`,
      queryBase: "Buckets de saldo atual dos SKUs vendidos e tabela dos SKUs Curva A em ruptura.",
      effectiveRange: `Vendas ${rangeLabel}; estoque no instante da consulta.`,
      appliedFilters: filterSummary,
      formula: "Buckets classificam saldo atual; a tabela detalha somente os SKUs Curva A já em ruptura.",
      checks: "O total de rupturas pode ser maior do que a tabela, porque a tabela prioriza Curva A.",
    },
    drift: {
      source: salesSource,
      queryBase: "Comparação entre share total do período e share da janela recente por tipo e coleção.",
      effectiveRange: driftRange,
      appliedFilters: filterSummary,
      formula: "Delta em pp = participação recente menos participação total; piso material de 0,25 pp.",
      checks: comparableRecentWindow
        ? "Drift habilitado: existe janela recente distinta dentro do período."
        : "Drift desabilitado: o recorte é curto demais para formar uma janela recente distinta.",
    },
    story: {
      source: `${salesSource} + ${stockSource}`,
      queryBase: "Síntese textual montada sobre os agregados principais do recorte.",
      effectiveRange: `${salesRange} Estoque atual consultado no momento da geração.`,
      appliedFilters: filterSummary,
      formula: "Cada ato reaproveita as métricas já auditadas em vendas, curva, canais, estoque e rupturas.",
      checks: "A narrativa não cria números novos; apenas interpreta os blocos anteriores.",
    },
    closing: {
      source: `${salesSource} + ${stockSource}`,
      queryBase: "Conclusão e recomendações derivadas dos agregados principais do relatório.",
      effectiveRange: `${salesRange} Estoque atual consultado no momento da geração.`,
      appliedFilters: filterSummary,
      formula: "Headline e texto final mudam conforme projeção mensal, pressão de ruptura, crescimento e drift material.",
      checks: "As recomendações dependem diretamente das métricas anteriores; não são inferências fora do payload.",
    },
  };
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
    parts.push(`COLEÇÃO ${colecoes.length === 1 ? colecoes[0] : `${colecoes.length} SELECIONADAS`}`);
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
      badge: "VISÃO GERAL",
      coverTitle: `A história do mix geral em ${activeStoreCount} filiais.`,
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
          ? `A história da coleção ${singleValue} em ${activeStoreCount} filiais.`
          : `A história das coleções selecionadas em ${activeStoreCount} filiais.`,
        metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
        summaryLead: values.length === 1 ? `A coleção ${singleValue}` : "As coleções selecionadas",
        performanceLead: values.length === 1 ? `a coleção ${singleValue}` : "as coleções selecionadas",
        closingLead: values.length === 1 ? `A coleção ${singleValue}` : "As coleções selecionadas",
      };
    }

    if (kind === "subgrupo") {
      return {
        badge,
        coverTitle: values.length === 1
          ? `A história do subgrupo ${singleValue} em ${activeStoreCount} filiais.`
          : `A história dos subgrupos selecionados em ${activeStoreCount} filiais.`,
        metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
        summaryLead: values.length === 1 ? `O subgrupo ${singleValue}` : "Os subgrupos selecionados",
        performanceLead: values.length === 1 ? `o subgrupo ${singleValue}` : "os subgrupos selecionados",
        closingLead: values.length === 1 ? `O subgrupo ${singleValue}` : "Os subgrupos selecionados",
      };
    }

    return {
      badge,
      coverTitle: values.length === 1
        ? `A história da grade ${singleValue} em ${activeStoreCount} filiais.`
        : `A história das grades selecionadas em ${activeStoreCount} filiais.`,
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
    colecoes.length > 0 ? formatSelectionPreview(colecoes, "Coleção", "Coleções") : "",
  ].filter(Boolean);
  const readableFocus = titleFocusParts.join(" | ");

  return {
    badge: joinedBadge && joinedBadge.length <= 26 ? joinedBadge : "RECORTE",
    coverTitle: `${readableFocus}: história em ${activeStoreCount} filiais.`,
    metaLine: `${scopeLabel} - ${parts.join(" - ")}`,
    summaryLead: readableFocus ? `O mix de ${readableFocus}` : "O mix filtrado",
    performanceLead: readableFocus ? `o mix de ${readableFocus}` : "o mix filtrado",
    closingLead: readableFocus ? `O mix de ${readableFocus}` : "O mix filtrado",
  };
}

export async function fetchClaudeReport({
  company: companySlug = "scarfme",
  filial,
  range,
  colecoes,
  subgrupos,
  grupos,
  grades,
}: ClaudeReportRequest): Promise<ClaudeReportPayload> {
  const company = await resolveCompanyLive(companySlug);
  if (!company) {
    throw new Error(`Empresa ${companySlug} não encontrada.`);
  }

  const normalizedRange = normalizeRangeForQuery(range);
  const previousRange = previousEquivalentRange(normalizedRange);
  const endInclusive = new Date(normalizedRange.end.getTime() - 24 * 60 * 60 * 1000);
  const scope = resolveScope(filial ?? null, company);

  // O estoque da curva ABC deve incluir o DEPÓSITO/MATRIZ. A matriz é excluída das
  // VENDAS (via REPORT_EXCLUDED_FILIAIS — ela não vende, é depósito), mas guarda
  // inventário real que precisa entrar no estoque/rupturas — espelha a página
  // /curva-abc, que soma a matriz no estoque de rede. Só na rede/varejo: ao filtrar
  // uma loja específica ou o e-commerce, a matriz não entra.
  const canonicalSelecionado = filial ? resolveCanonicalFilial(filial, company, scope.maps) : null;
  const incluirMatrizNoEstoque =
    canonicalSelecionado === null || canonicalSelecionado === VAREJO_VALUE;
  const matrizStockMembers = incluirMatrizNoEstoque
    ? company.filialFilters.sales.filter((f) => REPORT_EXCLUDED_FILIAIS.has(f))
    : [];

  const selectedColecoes = uniqueValues(colecoes);
  const selectedSubgrupos = uniqueValues(subgrupos);
  const selectedGrupos = uniqueValues(grupos);
  const selectedGrades = uniqueValues(grades);
  const gradeLabel = selectedGrades[0] ?? "MIX";

  const collectionOptionsPromise = fetchAvailableColecoesWithDescriptions({
    company: companySlug,
    range: normalizedRange,
    filial: filial ?? null,
    subgrupos: selectedSubgrupos,
    grades: selectedGrades,
  }).catch((error) => {
    console.warn("[fetchClaudeReport] Falha ao carregar rotulos de colecao; usando valores crus.", error);
    return [];
  });

  const salesFilters = { colecoes: selectedColecoes, subgrupos: selectedSubgrupos, grupos: selectedGrupos, grades: selectedGrades };
  const hasTypeFilters = selectedSubgrupos.length > 0 || selectedGrupos.length > 0 || selectedGrades.length > 0;
  const [salesRows, previousStoreRows, priorYear1Rows, priorYear2Rows, generalTypeRows, stockMap, collectionOptions] = await Promise.all([
    querySalesRows(normalizedRange, scope.posMembers, scope.ecommerceMembers, salesFilters, company, scope.maps),
    querySalesRows(previousRange, scope.posMembers, scope.ecommerceMembers, salesFilters, company, scope.maps),
    querySalesRows(shiftRangeByYears(normalizedRange, -1), scope.posMembers, scope.ecommerceMembers, salesFilters, company, scope.maps),
    querySalesRows(shiftRangeByYears(normalizedRange, -2), scope.posMembers, scope.ecommerceMembers, salesFilters, company, scope.maps),
    hasTypeFilters
      ? querySalesRows(normalizedRange, scope.posMembers, scope.ecommerceMembers, { colecoes: selectedColecoes }, company, scope.maps)
      : Promise.resolve([] as SalesRow[]),
    queryCurrentStock([...scope.posMembers, ...scope.ecommerceMembers, ...matrizStockMembers], company),
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

  const recentWindow = computeRecentWindow(normalizedRange);
  const recentLabel = dateRangeLabel(recentWindow.start, recentWindow.end);
  const previousEquivalentLabel = dateRangeLabel(previousRange.start, new Date(previousRange.end.getTime() - 86_400_000));
  const retentionComparable = recentWindow.start.getTime() > normalizedRange.start.getTime();

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
      suggestion: 0,
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

  const typeRankingRaw = buildShareRanking(labeledSalesRows, recentWindow.start, (row) => row.tipoProduto);
  const generalShareMap = hasTypeFilters && generalTypeRows.length > 0
    ? new Map(buildShareRanking(generalTypeRows.map((r) => ({ ...r, colecao: resolveCollectionLabel(r.colecao, collectionLabelMap) })), recentWindow.start, (row) => row.tipoProduto).map((r) => [r.label, r.share]))
    : null;
  const typeRanking = typeRankingRaw.map((r) => ({
    ...r,
    generalShare: generalShareMap?.get(r.label),
  }));
  const collectionRankingRaw = buildShareRanking(labeledSalesRows, recentWindow.start, (row) => row.colecao);
  const generalColShareMap = hasTypeFilters && generalTypeRows.length > 0
    ? new Map(buildShareRanking(generalTypeRows.map((r) => ({ ...r, colecao: resolveCollectionLabel(r.colecao, collectionLabelMap) })), recentWindow.start, (row) => row.colecao).map((r) => [r.label, r.share]))
    : null;
  const collectionRanking = collectionRankingRaw.map((r) => ({
    ...r,
    generalShare: generalColShareMap?.get(r.label),
  }));
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
        : `E-commerce responde por ${formatPctText(totalRevenue > 0 ? (ecommerceRevenue / totalRevenue) * 100 : 0)} do faturamento do recorte e já merece leitura própria de mix.`
      : "O recorte atual está concentrado nas operações físicas.",
  };

  const currentYear = endInclusive.getUTCFullYear();
  const sumRows = (rows: typeof labeledSalesRows) => rows.reduce(
    (acc, r) => { acc.revenue += r.revenue; acc.quantity += r.quantity; return acc; },
    { revenue: 0, quantity: 0 }
  );
  const prior2Range = shiftRangeByYears(normalizedRange, -2);
  const prior1Range = shiftRangeByYears(normalizedRange, -1);
  const prior2End = new Date(prior2Range.end.getTime() - 86_400_000);
  const prior1End = new Date(prior1Range.end.getTime() - 86_400_000);
  const prior2 = sumRows(priorYear2Rows);
  const prior1 = sumRows(priorYear1Rows);
  const current = sumRows(labeledSalesRows);
  const yearSummary = [
    ...(prior2.revenue > 0 ? [{ year: currentYear - 2, ...prior2, note: dateRangeLabel(prior2Range.start, prior2End) }] : []),
    ...(prior1.revenue > 0 ? [{ year: currentYear - 1, ...prior1, note: dateRangeLabel(prior1Range.start, prior1End) }] : []),
    { year: currentYear, ...current, note: dateRangeLabel(normalizedRange.start, endInclusive) },
  ];

  const [lastFullYear, previousFullYear] = comparableFullYears(labeledSalesRows);
  let yoyNetwork = 0;
  let yoyLabel = "var. comparável";
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
  // Project prior period (same days in prior year) to a full month — same logic as monthProjected
  const priorObservedDays = new Set(priorYear1Rows.map((row) => row.date)).size || observedDays;
  const monthPrevious = priorObservedDays > 0 ? (prior1.revenue / priorObservedDays) * daysInMonth : prior1.revenue;
  const monthProjectionYoy = monthPrevious > 0 ? ((monthProjected / monthPrevious) - 1) * 100 : 0;

  const stockTotal = Array.from(stockMap.values()).reduce((sum, stock) => sum + Math.max(0, stock), 0);
  const activeStockTotal = abcItems.reduce((sum, item) => sum + Math.max(0, item.stock), 0);
  const stockScopeSkuCount = Array.from(stockMap.values()).filter((stock) => stock > 0).length;
  const months = monthsBetween(normalizedRange.start, endInclusive);
  const averageMonthlyUnits = abcItems.reduce((sum, item) => sum + item.quantity, 0) / Math.max(months, 1);
  const coverageMonths = averageMonthlyUnits > 0 ? activeStockTotal / averageMonthlyUnits : 0;
  const ruptureTable = abcItems
    .filter((item) => item.curve === "A" && item.stock <= 0)
    .sort((a, b) => b.quantity - a.quantity);
  const ruptureCount = abcItems.filter((item) => item.stock <= 0 && item.quantity > 0).length;
  const openPurchaseCount = 0;

  const stockBuckets: StockBucketRow[] = [
    { label: "Em ruptura", count: abcItems.filter((item) => item.stock <= 0).length, pct: 0 },
    { label: "Crítico", count: abcItems.filter((item) => item.stock >= 1 && item.stock <= 2).length, pct: 0 },
    { label: "Baixo", count: abcItems.filter((item) => item.stock >= 3 && item.stock <= 5).length, pct: 0 },
    { label: "Razoável", count: abcItems.filter((item) => item.stock >= 6 && item.stock <= 10).length, pct: 0 },
    { label: "Confortável", count: abcItems.filter((item) => item.stock >= 11 && item.stock <= 30).length, pct: 0 },
    { label: "Elevado", count: abcItems.filter((item) => item.stock >= 31).length, pct: 0 },
  ].map((row) => ({
    ...row,
    pct: abcItems.length > 0 ? (row.count / abcItems.length) * 100 : 0,
  }));

  const fullAbcSet = new Set(abcItems.filter((item) => item.curve === "A").map((item) => item.skuKey));
  const recentSalesRows = retentionComparable
    ? labeledSalesRows.filter((row) => toUtcDate(row.date).getTime() >= recentWindow.start.getTime())
    : [];
  const recentAbc = retentionComparable
    ? classifyAbc(
        Array.from(
          recentSalesRows.reduce((acc, row) => {
            const skuKey = buildSkuKey(row.product, row.cor);
            acc.set(skuKey, (acc.get(skuKey) ?? 0) + row.revenue);
            return acc;
          }, new Map<string, number>())
        ).map(([skuKey, revenue]) => ({ skuKey, revenue }))
      )
    : new Map<string, { curve: "A" | "B" | "C" }>();
  const recentA = retentionComparable
    ? new Set(
        Array.from(recentAbc.entries())
          .filter(([, value]) => value.curve === "A")
          .map(([skuKey]) => skuKey)
      )
    : new Set<string>();
  const retention = retentionComparable && fullAbcSet.size > 0
    ? (Array.from(fullAbcSet).filter((skuKey) => recentA.has(skuKey)).length / fullAbcSet.size) * 100
    : 0;

  const warmingTypes = retentionComparable
    ? [...typeRanking]
      .filter((row) => row.deltaPp >= DRIFT_MIN_PP)
      .sort((a, b) => b.deltaPp - a.deltaPp)
      .slice(0, 3)
    : [];
  const coolingCollections = retentionComparable
    ? [...collectionRanking]
      .filter((row) => row.deltaPp <= -DRIFT_MIN_PP)
      .sort((a, b) => a.deltaPp - b.deltaPp)
      .slice(0, 3)
    : [];
  const movementTable = retentionComparable
    ? [...typeRanking]
      .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp) || b.revenue - a.revenue)
      .slice(0, 5)
    : [];
  const topCurve = curveSummary.sort((a, b) => b.share - a.share)[0]?.curve ?? "A";
  const hottestType = warmingTypes[0]?.label ?? "sortimento";
  const coolingCollection = coolingCollections[0]?.label ?? "coleções legadas";
  const topStore = branchRanking[0] ?? null;

  const story: StoryRow[] = [
    {
      title: "A rede cresce em base consolidada",
      text: `${months} meses somam ${totalRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} e ${Math.round(abcItems.reduce((sum, item) => sum + item.quantity, 0)).toLocaleString("pt-BR")} unidades. ${yoyLabel} ficou em ${yoyNetwork.toFixed(1).replace(".", ",")}%`,
    },
    {
      title: `${topCurve} é o motor do mix`,
      text: `Curva A concentra ${(curveSummary.find((row) => row.curve === "A")?.share ?? 0).toFixed(1).replace(".", ",")}% do faturamento e segue como âncora comercial.`,
    },
    {
      title: `${hottestType} ganha peso recente`,
      text: warmingTypes[0]
        ? `Na janela ${recentLabel}, ${hottestType.toLowerCase()} acelerou ${warmingTypes[0].deltaPp.toFixed(1).replace(".", ",")}pp de participação sobre o período total.`
        : "A composição recente indica mudanças de demanda importantes.",
    },
    {
      title: channelMix.hasEcommerce ? "Canais líderes concentram a alavanca" : "Filiais líderes concentram a alavanca",
      text: topStore
        ? `${topStore.filial} responde por ${topStore.share.toFixed(1).replace(".", ",")}% da rede consolidada.`
        : "A distribuição entre filiais precisa de leitura dedicada.",
    },
    {
      title: "Estoque total existe, mas a execução pressiona",
      text: `${ruptureCount} SKUs ativos estão em ruptura e os gargalos estão concentrados em disponibilidade imediata, não em falta de demanda.`,
    },
  ];

  const recommendations: RecommendationRow[] = [
    {
      title: "Priorizar as rupturas de Curva A",
      text: `${ruptureTable.length} itens A já romperam estoque e concentram o maior risco de perda de venda no curto prazo.`,
    },
    {
      title: `Apostar nos tipos em aquecimento: ${warmingTypes.map((item) => item.label).slice(0, 2).join(", ") || "mix emergente"}`,
      text: "Direcionar compras e profundidade de estoque para o que vem ganhando participação na janela recente.",
    },
    {
      title: `Replicar aprendizados de ${topStore?.filial ?? (channelMix.hasEcommerce ? "operações líderes" : "lojas líderes")}`,
      text: "Usar o perfil comercial da líder como referência para mix, sortimento e transferência entre filiais.",
    },
    {
      title: "Monitorar filiais em maior variação",
      text: "O comparativo com o range anterior equivalente ajuda a separar aceleração saudável de ruído de base pequena.",
    },
    {
      title: `Revisar coleções em desaceleração como ${coolingCollection}`,
      text: "Decidir cedo entre aprofundar, reduzir ou substituir exposição para liberar caixa e espaço.",
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
        body: `O histórico segue relevante, mas ${monthLabelFromDate(maxDate)} desacelera ${formatPctText(monthProjectionYoy)} contra a base anterior e pede leitura imediata de demanda, estoque e execução comercial.`,
        badge: "Atenção imediata",
      }
    : ruptureShare >= 25
      ? {
          headline: `${presentation.closingLead} cresce com pressão operacional.`,
          body: `${formatPctText(ruptureShare)} da carteira ativa está em ruptura e a rede precisa priorizar reposição, profundidade e redistribuição entre operações para sustentar venda real.`,
          badge: "Pressão operacional",
        }
      : yoyNetwork >= 10
        ? {
            headline: `${presentation.closingLead} segue forte.`,
            body: `O recorte sustenta ${formatPctText(yoyNetwork)} em ${yoyLabel}, com base de venda consistente e gargalos concentrados em execução fina de mix e reposição.`,
            badge: "Crescimento forte",
          }
        : {
            headline: `${presentation.closingLead} pede calibragem fina.`,
            body: `O recorte soma ${totalRevenue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}, com cobertura média de ${coverageMonths.toFixed(1).replace(".", ",")} meses e ${ruptureCount} SKUs em ruptura (${formatPctText(ruptureShare)} da carteira ativa). ${topStore ? `${topStore.filial} lidera ${topStore.share.toFixed(1).replace(".", ",")}% da receita do recorte.` : "A distribuição entre operações segue pulverizada."} ${warmingTypes[0] ? `${warmingTypes[0].label} ganhou ${warmingTypes[0].deltaPp.toFixed(1).replace(".", ",")}pp na janela recente.` : "O mix recente ficou estável, sem acelerações relevantes."} ${coolingCollections[0] ? `${coolingCollections[0].label} perdeu ${Math.abs(coolingCollections[0].deltaPp).toFixed(1).replace(".", ",")}pp e merece revisão de exposição.` : "Nenhuma coleção perdeu participação de forma material."}`,
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
  const filterSummary = formatAuditFilters(scope.displayName, selectedCollectionLabels, selectedSubgrupos, selectedGrades);
  const audit: ReportAudit = {
    flags: {
      comparableRecentWindow: retentionComparable,
      equivalentWindowComparison: true,
      stockTotalUsesScopeInventory: true,
      ruptureScopeUsesSoldSkus: true,
    },
    slides: buildAuditSlides({
      scopeLabel: scope.displayName,
      filterSummary,
      rangeLabel: dateRangeLabel(normalizedRange.start, endInclusive),
      recentLabel,
      previousEquivalentLabel,
      comparableRecentWindow: retentionComparable,
    }),
  };

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
      previousEquivalentLabel,
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
      activeStockTotal,
      stockScopeSkuCount,
      coverageMonths,
      ruptureCount,
      openPurchaseCount,
      retentionComparable,
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
    warmingTypes,
    coolingCollections,
    movementTable,
    story,
    closing,
    recommendations,
    audit,
  };
}

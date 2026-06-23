import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { resolveCompanyLive, liveNameForIncoming } from "@/lib/server/company-live";
import { getFilialLabelForDisplay, isEcommerceFilial, VAREJO_VALUE } from "@/lib/config/company";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import { ROW_COR_FIELD } from "@/lib/reports/keys";
import type { ReportFilters, ReportResult, ReportRow } from "@/lib/reports/types";

/** Limite alto; a página pode reduzir. Sinaliza `truncated` quando o universo excede. */
const DEFAULT_LIMIT = 5000;

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** Data → ISO 'yyyy-mm-dd' (o formatador "date" da tela espera esse formato). */
function toIsoDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Registra os parâmetros de uma lista IN(...) UMA vez e devolve uma função que monta
 * a cláusula para um `columnExpr` qualquer — permite reusar os MESMOS @params em dois
 * SELECTs (POS e e-commerce) com aliases de coluna diferentes, sem duplicar inputs.
 */
function prepInList(
  request: sql.Request | RequestLike,
  values: string[] | null | undefined,
  prefix: string
): (columnExpr: string) => string {
  const list = (values ?? []).map((v) => v.trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return () => "";
  list.forEach((v, i) => request.input(`${prefix}${i}`, sql.VarChar, v));
  const placeholders = list.map((_, i) => `@${prefix}${i}`).join(", ");
  return (columnExpr) => `AND UPPER(LTRIM(RTRIM(ISNULL(${columnExpr}, '')))) IN (${placeholders})`;
}

interface RawRow {
  DATA_VENDA: Date | null;
  TICKET: string | null;
  FILIAL_RAW: string | null;
  VENDEDOR_NOME: string | null;
  PRODUTO: string | null;
  COR_PRODUTO: string | null;
  COR_DESCRICAO: string | null;
  DESCRICAO: string | null;
  TAMANHO: number | null;
  QTDE: number | null;
  PRECO_LIQUIDO: number | null;
  VALOR_LIQUIDO: number | null;
  LINHA: string | null;
  GRUPO: string | null;
  SUBGRUPO: string | null;
  GRADE: string | null;
  TIPO: string | null;
  TOTAL_ROWS: number | null;
}

/**
 * Análise "Histórico de vendas" (nível de transação, sem agrupar).
 *
 * Cada linha = um item vendido em um ticket de loja (LOJA_VENDA_PRODUTO), com a
 * data, a filial e o vendedor. Escopo: vendas de loja/POS (e-commerce não tem
 * vendedor por item). Exclui itens cancelados (QTDE_CANCELADA = 0). Mais recentes
 * primeiro; o `limit` corta os mais antigos quando excede.
 */
export async function fetchVendasHistorico(filters: ReportFilters): Promise<ReportResult> {
  const company = await resolveCompanyLive(filters.company);
  const range = normalizeRangeForQuery({ start: filters.start, end: filters.end });
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;

  const result = await withRequest(async (request) => {
    request.input("vhStart", sql.DateTime, range.start);
    request.input("vhEnd", sql.DateTime, range.end);
    request.input("vhLimit", sql.Int, limit);

    // ── Quais fontes incluir + escopo de filial ───────────────────────────────
    // POS = vendas de loja (LOJA_VENDA, com vendedor). E-COMMERCE = faturamento
    // (FATURAMENTO/W_FATURAMENTO_PROD_02, natureza 100.02/100.022, sem vendedor),
    // mesmo escopo do resto do app. Sem filial selecionada: traz as duas fontes.
    const ecommerce = company?.ecommerceFilials ?? [];
    const posFiliais = (company?.filialFilters.sales ?? []).filter((f) => !ecommerce.includes(f));
    const specific = await liveNameForIncoming(filters.filial);

    let includePos = true;
    let includeEcom = true;
    let posFilialClause = "";
    if (specific && specific !== VAREJO_VALUE) {
      if (isEcommerceFilial(filters.company as string, specific)) {
        includePos = false; // selecionou E-COMMERCE → só faturamento
      } else {
        includeEcom = false; // selecionou uma loja → só POS dessa loja
        request.input("vhFilial", sql.VarChar, specific);
        posFilialClause = "AND f.FILIAL = @vhFilial";
      }
    } else if (specific === VAREJO_VALUE) {
      includeEcom = false; // varejo = só lojas físicas
    }
    if (includePos && !posFilialClause && posFiliais.length > 0) {
      posFiliais.forEach((f, i) => request.input(`vhPosF${i}`, sql.VarChar, f));
      posFilialClause = `AND f.FILIAL IN (${posFiliais.map((_, i) => `@vhPosF${i}`).join(", ")})`;
    }
    let ecomFilialClause = "";
    if (includeEcom && ecommerce.length > 0) {
      ecommerce.forEach((f, i) => request.input(`vhEcomF${i}`, sql.VarChar, f));
      ecomFilialClause = `AND f.FILIAL IN (${ecommerce.map((_, i) => `@vhEcomF${i}`).join(", ")})`;
    } else if (includeEcom) {
      includeEcom = false; // empresa sem filiais de e-commerce
    }

    // ── Filtros de atributo (mesmos aliases p/cb nos dois SELECTs → reusa @params) ─
    const grupo = prepInList(request, filters.grupos, "vhGrupo");
    const sub = prepInList(request, filters.subgrupos, "vhSub");
    const linha = prepInList(request, filters.linhas, "vhLinha");
    const grade = prepInList(request, filters.grades, "vhGrade");
    const colecao = prepInList(request, filters.colecoes, "vhCol");
    const tipo = prepInList(request, filters.tipos, "vhTipo");
    const cor = prepInList(request, filters.cores, "vhCor");
    const attrClauses = `
          ${grupo("p.GRUPO_PRODUTO")}
          ${sub("p.SUBGRUPO_PRODUTO")}
          ${linha("p.LINHA")}
          ${grade("CONVERT(VARCHAR, p.GRADE)")}
          ${colecao("p.COLECAO")}
          ${tipo("p.TIPO_PRODUTO")}
          ${cor("cb.DESC_COR")}`;

    // ── Filtro de produto (id específico ou busca textual) — por fonte ─────────
    let posProdClause = "";
    let ecomProdClause = "";
    if (filters.produtoId) {
      request.input("vhProdId", sql.VarChar, filters.produtoId);
      posProdClause = "AND vp.PRODUTO = @vhProdId";
      ecomProdClause = "AND fp.PRODUTO = @vhProdId";
    } else if (filters.produtoSearchTerm && filters.produtoSearchTerm.trim().length >= 2) {
      request.input("vhProdTerm", sql.VarChar, `%${filters.produtoSearchTerm.trim()}%`);
      posProdClause =
        "AND (vp.PRODUTO LIKE @vhProdTerm OR p.DESC_PRODUTO LIKE @vhProdTerm OR vp.CODIGO_BARRA LIKE @vhProdTerm)";
      ecomProdClause = "AND (fp.PRODUTO LIKE @vhProdTerm OR p.DESC_PRODUTO LIKE @vhProdTerm)";
    }

    const posSelect = `
        SELECT
          vp.DATA_VENDA,
          LTRIM(RTRIM(vp.TICKET)) AS TICKET,
          f.FILIAL AS FILIAL_RAW,
          LTRIM(RTRIM(ISNULL(lvd.VENDEDOR_APELIDO, ISNULL(lvd.NOME_VENDEDOR, CAST(v.VENDEDOR AS VARCHAR))))) AS VENDEDOR_NOME,
          LTRIM(RTRIM(CAST(vp.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          LTRIM(RTRIM(ISNULL(CAST(vp.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR_PRODUTO,
          LTRIM(RTRIM(ISNULL(cb.DESC_COR, ''))) AS COR_DESCRICAO,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
          CAST(vp.TAMANHO AS INT) AS TAMANHO,
          vp.QTDE,
          CAST(vp.PRECO_LIQUIDO AS DECIMAL(38,6)) AS PRECO_LIQUIDO,
          CAST(vp.QTDE * vp.PRECO_LIQUIDO
            - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS VALOR_LIQUIDO,
          UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,
          UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) AS GRUPO,
          UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS SUBGRUPO,
          UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS GRADE,
          UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, '')))) AS TIPO
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN LOJA_VENDEDORES lvd WITH (NOLOCK)
          ON LTRIM(RTRIM(CAST(lvd.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR)))
          AND lvd.CODIGO_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON p.PRODUTO = vp.PRODUTO
        LEFT JOIN CORES_BASICAS cb WITH (NOLOCK)
          ON cb.COR = vp.COR_PRODUTO
        WHERE vp.DATA_VENDA >= @vhStart
          AND vp.DATA_VENDA < @vhEnd
          AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
          ${posFilialClause}
          ${attrClauses}
          ${posProdClause}`;

    // E-commerce: faturamento; sem vendedor; ticket = NF; preço unit = fp.PRECO.
    const ecomSelect = `
        SELECT
          CAST(f.EMISSAO AS DATETIME) AS DATA_VENDA,
          LTRIM(RTRIM(CAST(f.NF_SAIDA AS VARCHAR(30)))) AS TICKET,
          f.FILIAL AS FILIAL_RAW,
          '' AS VENDEDOR_NOME,
          LTRIM(RTRIM(CAST(fp.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
          LTRIM(RTRIM(ISNULL(CAST(fp.COR_PRODUTO AS VARCHAR(20)), ''))) AS COR_PRODUTO,
          LTRIM(RTRIM(ISNULL(cb.DESC_COR, ''))) AS COR_DESCRICAO,
          UPPER(LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, '')))) AS DESCRICAO,
          CAST(NULL AS INT) AS TAMANHO,
          fp.QTDE,
          CAST(ISNULL(fp.PRECO, CASE WHEN fp.QTDE <> 0 THEN fp.VALOR_LIQUIDO / fp.QTDE ELSE fp.VALOR_LIQUIDO END) AS DECIMAL(38,6)) AS PRECO_LIQUIDO,
          CAST(ISNULL(fp.VALOR_LIQUIDO, 0) AS DECIMAL(38,6)) AS VALOR_LIQUIDO,
          UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,
          UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) AS GRUPO,
          UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS SUBGRUPO,
          UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS GRADE,
          UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, '')))) AS TIPO
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON p.PRODUTO = fp.PRODUTO
        LEFT JOIN CORES_BASICAS cb WITH (NOLOCK)
          ON cb.COR = fp.COR_PRODUTO
        WHERE CAST(f.EMISSAO AS DATE) >= CAST(@vhStart AS DATE)
          AND CAST(f.EMISSAO AS DATE) < CAST(@vhEnd AS DATE)
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          ${ecomFilialClause}
          ${attrClauses}
          ${ecomProdClause}`;

    const parts: string[] = [];
    if (includePos) parts.push(posSelect);
    if (includeEcom) parts.push(ecomSelect);
    if (parts.length === 0) parts.push(`${posSelect} AND 1 = 0`); // nada a trazer

    const query = `
      WITH base AS (
        ${parts.join("\n        UNION ALL\n")}
      )
      SELECT TOP (@vhLimit) *, COUNT(*) OVER() AS TOTAL_ROWS
      FROM base
      ORDER BY DATA_VENDA DESC, TICKET DESC
    `;

    return request.query<RawRow>(query);
  });

  const recordset = result.recordset;
  const total = recordset.length > 0 ? Number(recordset[0].TOTAL_ROWS ?? recordset.length) : 0;
  const truncated = total > limit;

  const rows: ReportRow[] = recordset.map((r) => {
    const corCode = (r.COR_PRODUTO ?? "").trim();
    const filialLabel = company
      ? getFilialLabelForDisplay(company, (r.FILIAL_RAW ?? "").trim())
      : (r.FILIAL_RAW ?? "").trim();
    return {
      [ROW_COR_FIELD]: corCode, // código cru da cor (join entre análises / código de barra)
      DATA_VENDA: toIsoDate(r.DATA_VENDA),
      TICKET: (r.TICKET ?? "").trim(),
      FILIAL: filialLabel,
      VENDEDOR: (r.VENDEDOR_NOME ?? "").trim(),
      PRODUTO: (r.PRODUTO ?? "").trim(),
      COR: corCode,
      COR_DESCRICAO: (r.COR_DESCRICAO ?? "").trim(),
      DESCRICAO: (r.DESCRICAO ?? "").trim(),
      TAMANHO: r.TAMANHO != null ? roundInt(r.TAMANHO) : null,
      QTDE: roundInt(r.QTDE),
      PRECO_LIQUIDO: round2(r.PRECO_LIQUIDO),
      VALOR: round2(r.VALOR_LIQUIDO),
      LINHA: (r.LINHA ?? "").trim(),
      GRUPO: (r.GRUPO ?? "").trim(),
      SUBGRUPO: (r.SUBGRUPO ?? "").trim(),
      GRADE: (r.GRADE ?? "").trim(),
      TIPO: (r.TIPO ?? "").trim(),
    };
  });

  await applyColecaoLabels(filters.company, rows);

  return { rows, total, truncated };
}

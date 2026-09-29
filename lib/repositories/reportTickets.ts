import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { buildFilialFilter } from "@/lib/repositories/clientes";
import { buildEcommerceFilialFilter } from "@/lib/repositories/ecommerce";
import { liveNameForIncoming, resolveCompanyLive } from "@/lib/server/company-live";
import { getFilialLabelForDisplay, VAREJO_VALUE } from "@/lib/config/company";
import { MAX_TAMANHOS_GRADE } from "@/lib/utils/grade-tamanhos";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import type {
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Máximo de LINHAS DE ITEM devolvidas (tickets são cortados inteiros, nunca no meio). */
const DEFAULT_LIMIT = 20000;
/** Teto duro do que a consulta lê do banco (proteção contra período aberto na rede toda). */
const MAX_SQL_ROWS = 200000;

/** Collation sem acento e sem caixa — o banco é CI_AS (sensível a acento). */
const COL_CI_AI = "COLLATE Latin1_General_CI_AI";

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Cláusula `AND UPPER(col) IN (...)` para uma lista de valores — mesma forma usada em
 * `fetchSalesTotals`, para os filtros do Gerador valerem igual aqui.
 */
function inListClause(
  request: sql.Request | RequestLike,
  values: string[] | null | undefined,
  prefix: string,
  columnExpr: string
): string {
  const list = (values ?? []).map((v) => (v ?? "").trim().toUpperCase()).filter(Boolean);
  if (list.length === 0) return "";
  list.forEach((v, i) => request.input(`${prefix}${i}`, sql.VarChar, v));
  const placeholders = list.map((_, i) => `@${prefix}${i}`).join(", ");
  return `AND UPPER(LTRIM(RTRIM(ISNULL(${columnExpr}, '')))) IN (${placeholders})`;
}

/**
 * Descrição do cadastro com os espaços repetidos colapsados: o Linx tem centenas de
 * nomes com espaço duplo no meio, e quem digita o nome como aparece na tela (um espaço)
 * nunca acharia o produto. Ver [[desc-produto-espaco-duplo-busca]].
 */
export function descNormalizada(alias: string): string {
  let expr = `LTRIM(RTRIM(ISNULL(${alias}.DESC_PRODUTO, '')))`;
  for (let i = 0; i < 4; i += 1) expr = `REPLACE(${expr}, '  ', ' ')`;
  return expr;
}

/** Busca por nome do produto: casa PALAVRA A PALAVRA, sem acento e sem caixa. */
function nomeClause(
  request: sql.Request | RequestLike,
  termo: string | null | undefined,
  prefix: string
): string {
  const t = (termo ?? "").trim();
  if (t.length < 2) return "";
  const palavras = t.split(/\s+/).filter(Boolean).slice(0, 8);
  if (palavras.length === 0) return "";
  const desc = `${descNormalizada("p")} ${COL_CI_AI}`;
  return palavras
    .map((palavra, i) => {
      request.input(`${prefix}${i}`, sql.VarChar, `%${palavra}%`);
      return `AND ${desc} LIKE @${prefix}${i}`;
    })
    .join("\n          ");
}

/**
 * Join da descrição de cor. A cor é ESCOPADA POR PRODUTO no Linx (o mesmo código é outra
 * cor em outro produto), então casa em PRODUTO_CORES e nunca no mapa global — igual ao
 * `fetchSalesTotals`. Ver [[cor-escopada-por-produto-vs-mapa-global]]. O `TRY_CONVERT(INT)`
 * tolera o zero à esquerda ('06' vs '6'), ver [[cor-produto-formato-duas-fontes]].
 */
export function coresJoin(alias: string, joinAlias: string): string {
  return `LEFT JOIN (
          SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
          FROM PRODUTO_CORES WITH (NOLOCK)
          GROUP BY PRODUTO, COR_PRODUTO
        ) ${joinAlias}
          ON RTRIM(LTRIM(${joinAlias}.PRODUTO)) = RTRIM(LTRIM(${alias}.PRODUTO))
          AND (
            RTRIM(LTRIM(CAST(${joinAlias}.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(${alias}.COR_PRODUTO AS VARCHAR(20))))
            OR TRY_CONVERT(INT, ${joinAlias}.COR_PRODUTO) = TRY_CONVERT(INT, ${alias}.COR_PRODUTO)
          )`;
}

/**
 * Rótulo do tamanho: `LOJA_VENDA_PRODUTO.TAMANHO` é ORDINAL 1-based da grade, e o rótulo
 * ("P", "M", "38") vive em `PRODUTOS_TAMANHOS.TAMANHO_1..TAMANHO_48` — nunca no nome da
 * grade, que é texto livre. Ver [[grade-tamanhos-posicional-linx]].
 */
function tamanhoLabelExpr(): string {
  const branches = Array.from(
    { length: MAX_TAMANHOS_GRADE },
    (_, i) => `WHEN ${i + 1} THEN LTRIM(RTRIM(ISNULL(CAST(pt.TAMANHO_${i + 1} AS VARCHAR(20)), '')))`
  ).join(" ");
  return `CASE m.TAMANHO ${branches} ELSE '' END`;
}

/** Linha crua do banco: um item de ticket. */
interface TicketItemRaw {
  /** LOJA = ticket do POS; ECOMMERCE = nota fiscal (o "ticket" do site). */
  canal: "LOJA" | "ECOMMERCE";
  codigoFilial: string;
  filial: string;
  ticket: string;
  dataVenda: string | null;
  vendedor: string;
  cliente: string;
  produto: string;
  descricao: string;
  cor: string;
  corDescricao: string;
  tamanho: number;
  tamanhoLabel: string;
  /** 1 quando a grade tem MAIS DE UM tamanho (as posições são preenchidas em ordem). */
  multiTamanho: number;
  codigoBarra: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  colecao: string;
  grade: string;
  qtde: number;
  /** Preço do CADASTRO (PRODUTOS.PRECO_REPOSICAO_1). `null` = sem preço cadastrado. */
  precoUnitario: number | null;
  desconto: number;
  valorItem: number;
}

/** Ticket montado em memória: cabeçalho + itens. */
interface TicketAgg {
  key: string;
  canal: "LOJA" | "ECOMMERCE";
  codigoFilial: string;
  filialLabel: string;
  ticket: string;
  dataVenda: string | null;
  vendedor: string;
  cliente: string;
  valorTicket: number;
  pecas: number;
  itens: TicketItemRaw[];
}

/**
 * Filtros de PRODUTO do Gerador (grupo, linha, subgrupo, grade, coleção, tipo, cor, nome,
 * lista de produtos, pares produto|cor) como um trecho de WHERE sobre uma linha de item.
 * Espera `p` = PRODUTOS e, quando `needsCores`, o join `coresJoin(itemAlias, "cf")`.
 * Compartilhado pela venda de loja (LOJA_VENDA_PRODUTO) e pela do e-commerce
 * (W_FATURAMENTO_PROD_02) — mesma semântica nas duas.
 */
export function buildItemFilterClauses(
  request: sql.Request | RequestLike,
  filters: ReportFilters,
  prefix: string,
  itemAlias: string
): { whereSql: string; needsCores: boolean; active: boolean } {
  const a = itemAlias;
  // ── Filtros de atributo do produto (todos opcionais; '' quando vazios) ──
  const grupoClause = inListClause(request, filters.grupos, `${prefix}Grupo`, "p.GRUPO_PRODUTO");
  const linhaClause = inListClause(request, filters.linhas, `${prefix}Linha`, "p.LINHA");
  const subgrupoClause = inListClause(request, filters.subgrupos, `${prefix}Subgrupo`, "p.SUBGRUPO_PRODUTO");
  const gradeClause = inListClause(request, filters.grades, `${prefix}Grade`, "CONVERT(VARCHAR, p.GRADE)");
  const colecaoClause = inListClause(request, filters.colecoes, `${prefix}Colecao`, "p.COLECAO");
  const tipoClause = inListClause(request, filters.tipos, `${prefix}Tipo`, "p.TIPO_PRODUTO");
  const corClause = inListClause(request, filters.cores, `${prefix}Cor`, "cf.DESC_COR");
  const buscaNomeClause = nomeClause(request, filters.produtoSearchTerm, `${prefix}Nome`);

  // Produto específico / lista de produtos (chips) / pares produto|cor (código de barra).
  const produtoIdsList = (filters.produtoIds ?? []).map((p) => (p ?? "").trim()).filter(Boolean);
  const produtoUnico = (filters.produtoId ?? "").trim();
  const alvoProdutos = Array.from(
    new Set([...(produtoUnico ? [produtoUnico] : []), ...produtoIdsList])
  );
  let produtoClause = "";
  if (alvoProdutos.length > 0) {
    alvoProdutos.forEach((p, i) => request.input(`${prefix}Prod${i}`, sql.VarChar, p));
    const placeholders = alvoProdutos.map((_, i) => `@${prefix}Prod${i}`).join(", ");
    produtoClause = `AND LTRIM(RTRIM(${a}.PRODUTO)) IN (${placeholders})`;
  }

  // Pares "PRODUTO|COR": o código de barra identifica a variação, então restringe à cor.
  const pares = (filters.produtoChaves ?? [])
    .map((k) => (k ?? "").trim())
    .filter(Boolean)
    .map((k) => {
      const idx = k.indexOf("|");
      return idx < 0 ? null : { produto: k.slice(0, idx).trim(), cor: k.slice(idx + 1).trim() };
    })
    .filter((p): p is { produto: string; cor: string } => !!p && !!p.produto);
  let paresClause = "";
  if (pares.length > 0) {
    const ors = pares.map((par, i) => {
      request.input(`${prefix}PcP${i}`, sql.VarChar, par.produto);
      request.input(`${prefix}PcC${i}`, sql.VarChar, par.cor);
      return `(LTRIM(RTRIM(${a}.PRODUTO)) = @${prefix}PcP${i} AND (LTRIM(RTRIM(CAST(${a}.COR_PRODUTO AS VARCHAR(20)))) = @${prefix}PcC${i} OR TRY_CONVERT(INT, ${a}.COR_PRODUTO) = TRY_CONVERT(INT, @${prefix}PcC${i})))`;
    });
    paresClause = `AND (${ors.join(" OR ")})`;
  }

  // `produtoClause` e `paresClause` são ADITIVAS entre si (um produto colado pelo código
  // e outro pelo barra convivem), então valem como um OR quando as duas existem.
  const escolhaProdutoClause =
    produtoClause && paresClause
      ? `AND ((${produtoClause.slice(4)}) OR (${paresClause.slice(4)}))`
      : produtoClause || paresClause;

  const active = Boolean(
    grupoClause ||
      linhaClause ||
      subgrupoClause ||
      gradeClause ||
      colecaoClause ||
      tipoClause ||
      corClause ||
      buscaNomeClause ||
      escolhaProdutoClause
  );

  const whereSql = [
    grupoClause,
    linhaClause,
    subgrupoClause,
    gradeClause,
    colecaoClause,
    tipoClause,
    corClause,
    buscaNomeClause,
    escolhaProdutoClause,
  ]
    .filter(Boolean)
    .join("\n        ");
  return { whereSql, needsCores: Boolean(corClause), active };
}

/**
 * Monta os CTEs da regra canônica de venda líquida "com trocas" no grão de ITEM de ticket
 * (`movimento`) + o recorte `tickets_alvo` dos filtros de produto. Compartilhado entre
 * "Tickets detalhados" e "Vendas por preço" — só o SELECT final muda entre as duas.
 * Registra no `request` os parâmetros de período/filial/filtros.
 */
export async function buildTicketsMovimentoSql(
  request: sql.Request | RequestLike,
  filters: ReportFilters
): Promise<{ withClause: string; ticketsAlvoJoin: string }> {
  const { start, end } = normalizeRangeForQuery({ start: filters.start, end: filters.end });
  request.input("tkStart", sql.DateTime, start);
  request.input("tkEnd", sql.DateTime, end);

  // Filial: o mesmo escopo das outras análises do Gerador (alias `f` = FILIAIS).
  const filialClause = await buildFilialFilter(
    request,
    filters.company,
    "sales",
    filters.filial ?? null,
    "f"
  );

  const {
    whereSql: filtroItemSql,
    needsCores,
    active: filtroDeProdutoAtivo,
  } = buildItemFilterClauses(request, filters, "tk", "m");

  /**
   * Tickets alvo: os que contêm ao menos UM item casando com os filtros de produto. O
   * SELECT final volta por aqui para trazer o ticket inteiro. Sem filtro de produto a
   * CTE é dispensada (todos os tickets do período entram).
   */
  const ticketsAlvoCte = filtroDeProdutoAtivo
    ? `,
    tickets_alvo AS (
      SELECT DISTINCT m.CODIGO_FILIAL, m.TICKET
      FROM movimento m
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = m.PRODUTO
      ${needsCores ? coresJoin("m", "cf") : ""}
      WHERE 1 = 1
        ${filtroItemSql}
    )`
    : "";

  const ticketsAlvoJoin = filtroDeProdutoAtivo
    ? `INNER JOIN tickets_alvo ta
        ON ta.CODIGO_FILIAL = m.CODIGO_FILIAL AND ta.TICKET = m.TICKET`
    : "";

  const withClause = `
    WITH vendas_base AS (
      SELECT
        vp.TICKET,
        vp.CODIGO_FILIAL,
        vp.PRODUTO,
        ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
        ISNULL(vp.TAMANHO, 0) AS TAMANHO,
        vp.QTDE,
        vp.PRECO_LIQUIDO,
        LTRIM(RTRIM(ISNULL(CAST(vp.CODIGO_BARRA AS VARCHAR(100)), ''))) AS CODIGO_BARRA,
        CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA
      FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = vp.CODIGO_FILIAL
      WHERE vp.DATA_VENDA >= @tkStart
        AND vp.DATA_VENDA < @tkEnd
        AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
        ${filialClause}
    ),
    trocas_item AS (
      SELECT
        vt.TICKET,
        vt.CODIGO_FILIAL,
        vt.PRODUTO,
        ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
        ISNULL(vt.TAMANHO, 0) AS TAMANHO,
        SUM(vt.QTDE) AS QTDE_TROCA,
        CAST(SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
      WHERE vt.QTDE_CANCELADA = 0
        AND v.DATA_VENDA >= @tkStart
        AND v.DATA_VENDA < @tkEnd
      GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, ISNULL(vt.COR_PRODUTO, ''), ISNULL(vt.TAMANHO, 0)
    ),
    trocas_puras AS (
      SELECT
        vt.TICKET,
        vt.CODIGO_FILIAL,
        vt.PRODUTO,
        ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
        ISNULL(vt.TAMANHO, 0) AS TAMANHO,
        '' AS CODIGO_BARRA,
        vt.PRECO_LIQUIDO,
        CAST(0 AS DECIMAL(38,6)) AS DESCONTO_VENDA,
        CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
        (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = vt.CODIGO_FILIAL
      WHERE vt.QTDE_CANCELADA = 0
        AND v.DATA_VENDA >= @tkStart
        AND v.DATA_VENDA < @tkEnd
        AND NOT EXISTS (
          SELECT 1
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          WHERE vp.TICKET = vt.TICKET
            AND vp.CODIGO_FILIAL = vt.CODIGO_FILIAL
            AND vp.PRODUTO = vt.PRODUTO
            AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
            AND ISNULL(vp.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
            AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
        )
        ${filialClause}
    ),
    vendas_num AS (
      SELECT
        vb.*,
        ROW_NUMBER() OVER (
          PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
        ) AS RN
      FROM vendas_base vb
    ),
    movimento AS (
      SELECT
        vn.TICKET,
        vn.CODIGO_FILIAL,
        vn.PRODUTO,
        vn.COR_PRODUTO,
        vn.TAMANHO,
        vn.CODIGO_BARRA,
        vn.PRECO_LIQUIDO,
        vn.DESCONTO_VENDA,
        CAST((
          CAST(vn.PRECO_LIQUIDO * vn.QTDE AS DECIMAL(38,6))
          - CAST(vn.DESCONTO_VENDA AS DECIMAL(38,6))
          - CAST(CASE WHEN vn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))
        ) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
        (vn.QTDE - CASE WHEN vn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
      FROM vendas_num vn
      LEFT JOIN trocas_item ti
        ON ti.TICKET = vn.TICKET
        AND ti.CODIGO_FILIAL = vn.CODIGO_FILIAL
        AND ti.PRODUTO = vn.PRODUTO
        AND ti.COR_PRODUTO = vn.COR_PRODUTO
        AND ti.TAMANHO = vn.TAMANHO
      UNION ALL
      SELECT
        tp.TICKET,
        tp.CODIGO_FILIAL,
        tp.PRODUTO,
        tp.COR_PRODUTO,
        tp.TAMANHO,
        tp.CODIGO_BARRA,
        tp.PRECO_LIQUIDO,
        tp.DESCONTO_VENDA,
        tp.VALOR_LIQUIDO_CALC,
        tp.QTDE_LIQUIDA_CALC
      FROM trocas_puras tp
    )${ticketsAlvoCte}`;

  return { withClause, ticketsAlvoJoin };
}

/**
 * Quais canais entram numa análise por ticket, pela filial escolhida — mesma régua de
 * `fetchSalesTotals`: "todas as filiais" = loja + e-commerce (só onde a empresa tem
 * e-commerce); filial de e-commerce = só as notas (o grupo inteiro, rodízio MSC↔AKS);
 * "Varejo" ou uma loja = só o POS.
 */
export async function resolveCanaisTicket(
  filters: ReportFilters
): Promise<{ incluiLoja: boolean; incluiEcommerce: boolean }> {
  const company = await resolveCompanyLive(filters.company);
  const ecommerceFilials = company?.ecommerceFilials ?? [];
  const filialLive = filters.filial ? await liveNameForIncoming(filters.filial) : null;
  const filialEhEcommerce = !!filialLive && ecommerceFilials.includes(filialLive);
  return {
    incluiLoja: !filialEhEcommerce,
    incluiEcommerce: ecommerceFilials.length > 0 && (filters.filial == null || filialEhEcommerce),
  };
}

/**
 * CTEs da venda do E-COMMERCE no grão de item de nota (`ecom_itens`: nota × produto × cor).
 * O e-commerce não tem ticket: a "venda" é a NOTA FISCAL, identidade FILIAL + NF_SAIDA +
 * SERIE_NF (a mesma chave do `fetchEcommerceSummary`). Regra canônica do e-commerce
 * (CLAUDE.md): `FATURAMENTO` + `W_FATURAMENTO_PROD_02`, `NOTA_CANCELADA = 0`,
 * `NATUREZA_SAIDA IN ('100.02','100.022')`, valor = `SUM(VALOR_LIQUIDO)`; recorte de data
 * igual ao do `fetchEcommerceSummary`. Desconto do item = `VALOR − VALOR_LIQUIDO` (fecha
 * com o `FATURAMENTO.DESCONTO` do cabeçalho). Não há tamanho: essa visão não abre a grade.
 *
 * Filtros de produto escolhem a NOTA (`notas_alvo`, semi-join) e ela vem inteira — mesma
 * semântica do `tickets_alvo` da loja.
 */
export async function buildEcommerceItensSql(
  request: sql.Request | RequestLike,
  filters: ReportFilters
): Promise<string> {
  const { start, end } = normalizeRangeForQuery({ start: filters.start, end: filters.end });
  request.input("ecStart", sql.DateTime, start);
  request.input("ecEnd", sql.DateTime, end);

  // null = todas as filiais de e-commerce da empresa; filial de e-commerce = o grupo todo.
  const filial = filters.filial && filters.filial !== VAREJO_VALUE ? filters.filial : null;
  const filialClause = await buildEcommerceFilialFilter(request, filters.company, filial, "f");

  const baseWhere = `CAST(f.EMISSAO AS DATE) >= CAST(@ecStart AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@ecEnd AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialClause}`;

  const { whereSql, needsCores, active } = buildItemFilterClauses(request, filters, "ec", "fp");
  const notasAlvoCte = active
    ? `notas_alvo AS (
      SELECT DISTINCT fp.FILIAL, fp.NF_SAIDA, fp.SERIE_NF
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
      ${needsCores ? coresJoin("fp", "cf") : ""}
      WHERE ${baseWhere}
        ${whereSql}
    ),`
    : "";
  const notasAlvoJoin = active
    ? `INNER JOIN notas_alvo na
        ON na.FILIAL = f.FILIAL AND na.NF_SAIDA = f.NF_SAIDA AND na.SERIE_NF = f.SERIE_NF`
    : "";

  return `
    WITH ${notasAlvoCte}
    ecom_itens AS (
      SELECT
        f.FILIAL,
        f.NF_SAIDA,
        f.SERIE_NF,
        fp.PRODUTO,
        ISNULL(fp.COR_PRODUTO, '') AS COR_PRODUTO,
        MAX(f.EMISSAO) AS EMISSAO,
        MAX(LTRIM(RTRIM(ISNULL(f.NOME_CLIFOR, '')))) AS CLIENTE,
        SUM(ISNULL(fp.QTDE, 0)) AS QTDE,
        CAST(SUM(ISNULL(fp.VALOR, 0) - ISNULL(fp.VALOR_LIQUIDO, 0)) AS DECIMAL(38,6)) AS DESCONTO,
        CAST(SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS DECIMAL(38,6)) AS VALOR
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      ${notasAlvoJoin}
      WHERE ${baseWhere}
      GROUP BY f.FILIAL, f.NF_SAIDA, f.SERIE_NF, fp.PRODUTO, ISNULL(fp.COR_PRODUTO, '')
    )`;
}

/** Itens das NOTAS do e-commerce, no mesmo formato dos itens de ticket da loja. */
async function fetchTicketItensEcommerce(
  filters: ReportFilters
): Promise<{ rows: TicketItemRaw[]; capped: boolean }> {
  return withRequest(async (request) => {
    const ecomWith = await buildEcommerceItensSql(request, filters);
    const query = `
      ${ecomWith}
      SELECT TOP ${MAX_SQL_ROWS}
        -- Identidade da nota = filial + NF + série (a numeração é por CNPJ).
        LTRIM(RTRIM(e.FILIAL)) + '|NF|' + LTRIM(RTRIM(e.SERIE_NF)) AS codigoFilial,
        LTRIM(RTRIM(e.FILIAL)) AS filial,
        LTRIM(RTRIM(e.NF_SAIDA)) AS ticket,
        CONVERT(VARCHAR(10), e.EMISSAO, 23) AS dataVenda,
        '' AS vendedor,
        e.CLIENTE AS cliente,
        LTRIM(RTRIM(e.PRODUTO)) AS produto,
        ${descNormalizada("p")} AS descricao,
        LTRIM(RTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS cor,
        ISNULL(LTRIM(RTRIM(cf.DESC_COR)), '') AS corDescricao,
        0 AS tamanho,
        '' AS tamanhoLabel,
        0 AS multiTamanho,
        '' AS codigoBarra,
        LTRIM(RTRIM(ISNULL(CAST(p.GRUPO_PRODUTO AS VARCHAR(60)), ''))) AS grupo,
        LTRIM(RTRIM(ISNULL(CAST(p.SUBGRUPO_PRODUTO AS VARCHAR(60)), ''))) AS subgrupo,
        LTRIM(RTRIM(ISNULL(CAST(p.LINHA AS VARCHAR(60)), ''))) AS linha,
        LTRIM(RTRIM(ISNULL(CAST(p.COLECAO AS VARCHAR(60)), ''))) AS colecao,
        LTRIM(RTRIM(ISNULL(CAST(p.GRADE AS VARCHAR(60)), ''))) AS grade,
        e.QTDE AS qtde,
        COALESCE(
          NULLIF(CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2)), 0),
          NULLIF(CAST(pp.PRECO1 AS DECIMAL(18, 2)), 0)
        ) AS precoUnitario,
        e.DESCONTO AS desconto,
        e.VALOR AS valorItem
      FROM ecom_itens e
      LEFT JOIN PRODUTOS p WITH (NOLOCK)
        ON p.PRODUTO = e.PRODUTO
      LEFT JOIN PRODUTOS_PRECOS pp WITH (NOLOCK)
        ON LTRIM(RTRIM(pp.PRODUTO)) = LTRIM(RTRIM(e.PRODUTO))
        AND LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)) = '01'
      ${coresJoin("e", "cf")}
      ORDER BY e.EMISSAO DESC, e.FILIAL, e.NF_SAIDA, e.PRODUTO
    `;
    const result = await request.query<TicketItemRaw>(query);
    const recs = result.recordset;
    return {
      capped: recs.length >= MAX_SQL_ROWS,
      rows: recs.map<TicketItemRaw>((r) => ({
        ...normalizeItemRaw(r),
        canal: "ECOMMERCE",
      })),
    };
  });
}

/** Normaliza a linha crua do banco (trim/número) — igual para loja e e-commerce. */
function normalizeItemRaw(r: TicketItemRaw): Omit<TicketItemRaw, "canal"> {
  return {
    codigoFilial: (r.codigoFilial ?? "").trim(),
    filial: (r.filial ?? "").trim(),
    ticket: (r.ticket ?? "").trim(),
    dataVenda: r.dataVenda ?? null,
    vendedor: (r.vendedor ?? "").trim(),
    cliente: (r.cliente ?? "").trim(),
    produto: (r.produto ?? "").trim(),
    descricao: (r.descricao ?? "").trim(),
    cor: (r.cor ?? "").trim(),
    corDescricao: (r.corDescricao ?? "").trim(),
    tamanho: Number(r.tamanho ?? 0),
    tamanhoLabel: (r.tamanhoLabel ?? "").trim(),
    multiTamanho: Number(r.multiTamanho ?? 0),
    codigoBarra: (r.codigoBarra ?? "").trim(),
    grupo: (r.grupo ?? "").trim(),
    subgrupo: (r.subgrupo ?? "").trim(),
    linha: (r.linha ?? "").trim(),
    colecao: (r.colecao ?? "").trim(),
    grade: (r.grade ?? "").trim(),
    qtde: Number(r.qtde ?? 0),
    precoUnitario:
      r.precoUnitario != null && Number(r.precoUnitario) > 0 ? Number(r.precoUnitario) : null,
    desconto: Number(r.desconto ?? 0),
    valorItem: Number(r.valorItem ?? 0),
  };
}

/**
 * Análise "Tickets detalhados": os tickets do período abertos item por item.
 *
 * ── Faturamento ─────────────────────────────────────────────────────────────────
 * Segue a regra ÚNICA e validada de venda líquida "com trocas" (CLAUDE.md), no MESMO
 * formato de `fetchSalesTotals` ([lib/services/salesTotals.ts]) — a diferença é só o GRÃO
 * do SELECT final (aqui: ticket × produto × cor × tamanho; lá: totais):
 *   - base `LOJA_VENDA_PRODUTO` com `INNER JOIN LOJA_VENDA` e `ISNULL(QTDE_CANCELADA,0)=0`;
 *   - desconto = `QTDE × PRECO_LIQUIDO × ISNULL(FATOR_DESCONTO_VENDA,0)` (fator, não absoluto);
 *   - abate as trocas de item (`LOJA_VENDA_TROCA` casada por ticket/produto/cor/tamanho, uma
 *     única vez por combinação via `RN = 1`) e soma as trocas puras/devoluções como movimento
 *     negativo;
 *   - `VALOR_LIQUIDO = (PRECO_LIQUIDO × QTDE) − DESCONTO_VENDA − VALOR_TROCA`.
 * Nenhuma linha é descartada antes de somar (nem as negativas da devolução) — filtrar as
 * linhas da regra global infla o faturamento, ver [[vendas-nunca-filtrar-linhas-da-regra-global]].
 *
 * ── Semântica dos filtros ───────────────────────────────────────────────────────
 * Os filtros de PRODUTO (nome, lista de produtos, grupo, linha, subgrupo, grade, coleção,
 * cor, tipo) escolhem quais TICKETS entram — e o ticket vem INTEIRO, com todos os seus
 * itens. É o que se quer ao perguntar "o que mais sai junto com a capa de couro?".
 * Período e filial, por serem do próprio ticket, recortam normalmente.
 *
 * ── Preço ───────────────────────────────────────────────────────────────────────
 * "Preço Linx" (`PRECO_UNITARIO`) é o preço CADASTRADO, NÃO o `PRECO_LIQUIDO` da linha de
 * venda: o caixa pode bater um valor diferente do cadastro, e foi o que gerou o relato
 * (ticket 00014022, item N4.8M.0004 → saiu a 358 com o cadastro em 398). O preço
 * efetivamente cobrado não se perde: `Valor + Desconto` devolve `PRECO_LIQUIDO × QTDE`.
 *
 * Fonte primária: `PRODUTOS.PRECO_REPOSICAO_1` — a mesma tabela mestre que o resto do
 * Gerador usa para custo/preço ([[gerador-custo-preco-da-tabela-mestre]]). Reserva:
 * `PRODUTOS_PRECOS.PRECO1` da tabela de preço DO PRÓPRIO TICKET (`LOJA_VENDA
 * .CODIGO_TAB_PRECO`, hoje '01' em 100% dos 32.331 tickets NERD de 12 meses). A reserva
 * existe porque 84 produtos ativos têm o preço sugerido zerado e só têm preço na tabela —
 * sem ela a coluna sairia em branco justamente neles. As duas fontes concordam em 15.834
 * de 15.918 produtos ativos e acertam o preço batido o MESMO número de vezes, então a
 * escolha da primária é por consistência com o resto do Gerador, não por precisão.
 *
 * ── Escopo ──────────────────────────────────────────────────────────────────────
 * Só venda de loja física (POS): ticket e vendedor não existem no e-commerce
 * (`FATURAMENTO`/nota fiscal), então o e-commerce fica fora desta análise.
 */
export async function fetchTickets(filters: ReportFilters): Promise<ReportResult> {
  const company = await resolveCompanyLive(filters.company);

  const canais = await resolveCanaisTicket(filters);

  const fetchItensLoja = () => withRequest(async (request) => {
    const { withClause, ticketsAlvoJoin } = await buildTicketsMovimentoSql(request, filters);

    const query = `
      ${withClause}
      SELECT TOP ${MAX_SQL_ROWS}
        LTRIM(RTRIM(m.CODIGO_FILIAL)) AS codigoFilial,
        LTRIM(RTRIM(ISNULL(CAST(f.FILIAL AS VARCHAR(60)), ''))) AS filial,
        LTRIM(RTRIM(m.TICKET)) AS ticket,
        CONVERT(VARCHAR(10), v.DATA_VENDA, 23) AS dataVenda,
        MAX(ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR(20)))))) AS vendedor,
        MAX(ISNULL(LTRIM(RTRIM(cli.NOME)), '')) AS cliente,
        LTRIM(RTRIM(m.PRODUTO)) AS produto,
        MAX(${descNormalizada("p")}) AS descricao,
        LTRIM(RTRIM(CAST(m.COR_PRODUTO AS VARCHAR(20)))) AS cor,
        MAX(ISNULL(LTRIM(RTRIM(cf.DESC_COR)), '')) AS corDescricao,
        m.TAMANHO AS tamanho,
        MAX(${tamanhoLabelExpr()}) AS tamanhoLabel,
        MAX(CASE WHEN LTRIM(RTRIM(ISNULL(CAST(pt.TAMANHO_2 AS VARCHAR(20)), ''))) <> '' THEN 1 ELSE 0 END) AS multiTamanho,
        MAX(m.CODIGO_BARRA) AS codigoBarra,
        MAX(LTRIM(RTRIM(ISNULL(CAST(p.GRUPO_PRODUTO AS VARCHAR(60)), '')))) AS grupo,
        MAX(LTRIM(RTRIM(ISNULL(CAST(p.SUBGRUPO_PRODUTO AS VARCHAR(60)), '')))) AS subgrupo,
        MAX(LTRIM(RTRIM(ISNULL(CAST(p.LINHA AS VARCHAR(60)), '')))) AS linha,
        MAX(LTRIM(RTRIM(ISNULL(CAST(p.COLECAO AS VARCHAR(60)), '')))) AS colecao,
        MAX(LTRIM(RTRIM(ISNULL(CAST(p.GRADE AS VARCHAR(60)), '')))) AS grade,
        SUM(m.QTDE_LIQUIDA_CALC) AS qtde,
        MAX(COALESCE(
          NULLIF(CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2)), 0),
          NULLIF(CAST(pp.PRECO1 AS DECIMAL(18, 2)), 0)
        )) AS precoUnitario,
        SUM(m.DESCONTO_VENDA) AS desconto,
        SUM(m.VALOR_LIQUIDO_CALC) AS valorItem
      FROM movimento m
      ${ticketsAlvoJoin}
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = m.CODIGO_FILIAL AND v.TICKET = m.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = m.CODIGO_FILIAL
      LEFT JOIN PRODUTOS p WITH (NOLOCK)
        ON p.PRODUTO = m.PRODUTO
      LEFT JOIN PRODUTOS_TAMANHOS pt WITH (NOLOCK)
        ON LTRIM(RTRIM(CONVERT(VARCHAR(60), pt.GRADE))) = LTRIM(RTRIM(CONVERT(VARCHAR(60), p.GRADE)))
      LEFT JOIN PRODUTOS_PRECOS pp WITH (NOLOCK)
        ON LTRIM(RTRIM(pp.PRODUTO)) = LTRIM(RTRIM(m.PRODUTO))
        AND LTRIM(RTRIM(pp.CODIGO_TAB_PRECO)) = COALESCE(NULLIF(LTRIM(RTRIM(v.CODIGO_TAB_PRECO)), ''), '01')
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR(20))))
      LEFT JOIN (
        SELECT LTRIM(RTRIM(CPF_CGC)) AS CPF, MAX(LTRIM(RTRIM(CLIENTE_VAREJO))) AS NOME
        FROM CLIENTES_VAREJO WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ISNULL(CPF_CGC, ''))) <> ''
        GROUP BY LTRIM(RTRIM(CPF_CGC))
      ) cli
        ON cli.CPF = LTRIM(RTRIM(ISNULL(CAST(v.CODIGO_CLIENTE AS VARCHAR(30)), '')))
      ${coresJoin("m", "cf")}
      GROUP BY
        m.CODIGO_FILIAL,
        m.TICKET,
        m.PRODUTO,
        m.COR_PRODUTO,
        m.TAMANHO,
        v.DATA_VENDA,
        LTRIM(RTRIM(ISNULL(CAST(f.FILIAL AS VARCHAR(60)), '')))
      ORDER BY v.DATA_VENDA DESC, LTRIM(RTRIM(m.CODIGO_FILIAL)), LTRIM(RTRIM(m.TICKET)), LTRIM(RTRIM(m.PRODUTO))
    `;

    const result = await request.query<TicketItemRaw>(query);
    const recs = result.recordset;

    return {
      capped: recs.length >= MAX_SQL_ROWS,
      rows: recs.map<TicketItemRaw>((r) => ({
        ...normalizeItemRaw(r),
        canal: "LOJA",
      })),
    };
  });

  const vazio = { rows: [] as TicketItemRaw[], capped: false };
  const [loja, ecom] = await Promise.all([
    canais.incluiLoja ? fetchItensLoja() : Promise.resolve(vazio),
    canais.incluiEcommerce ? fetchTicketItensEcommerce(filters) : Promise.resolve(vazio),
  ]);
  const capped = loja.capped || ecom.capped;
  const rowsRaw = [...loja.rows, ...ecom.rows];

  // ── Monta os tickets em memória (ordem de chegada = a do ORDER BY do SQL) ──
  const byTicket = new Map<string, TicketAgg>();
  for (const item of rowsRaw) {
    const key = `${item.codigoFilial} ${item.ticket} ${item.dataVenda ?? ""}`;
    let agg = byTicket.get(key);
    if (!agg) {
      agg = {
        key,
        canal: item.canal,
        codigoFilial: item.codigoFilial,
        filialLabel: company ? getFilialLabelForDisplay(company, item.filial) : item.filial,
        ticket: item.ticket,
        dataVenda: item.dataVenda,
        vendedor: item.vendedor,
        cliente: item.cliente,
        valorTicket: 0,
        pecas: 0,
        itens: [],
      };
      byTicket.set(key, agg);
    }
    agg.itens.push(item);
    // Valor do ticket = soma dos itens pela regra líquida (inclui as linhas negativas de
    // devolução — nunca se descarta linha antes de somar).
    agg.valorTicket += item.valorItem;
    agg.pecas += item.qtde;
  }

  // Loja e e-commerce intercalados pela data (mais recente primeiro). O sort é estável,
  // então dentro do mesmo dia cada canal mantém a ordem do seu SQL.
  const tickets = Array.from(byTicket.values()).sort((a, b) =>
    (b.dataVenda ?? "").localeCompare(a.dataVenda ?? "")
  );

  // ── KPIs sobre TODOS os tickets encontrados (antes do corte de exibição) ──
  const totalFaturado = tickets.reduce((s, t) => s + t.valorTicket, 0);
  const totalPecas = tickets.reduce((s, t) => s + t.pecas, 0);
  // "Tickets" usa o MESMO critério do resto do sistema (`fetchSalesTotals`, dashboard,
  // Curva ABC): conta o ticket que tem AO MENOS UM item com quantidade líquida positiva —
  // não a soma do ticket. A diferença aparece na troca 1×1 (−1 + 1 = 0 líquido): ela conta
  // como ticket. O ticket que é só devolução continua LISTADO nas linhas (em vermelho no
  // XLSX) — ele existe e o dono quer vê-lo —, mas fica fora da contagem.
  //
  // ⚠️ A IDENTIDADE do ticket aqui é (filial, ticket, data), não o número solto. O número é
  // sequencial POR LOJA e se repete entre as lojas, então num período com mais de uma
  // filial esta contagem fica ACIMA da de `fetchSalesTotals`, que faz
  // `COUNT(DISTINCT TICKET)` sem a filial e funde tickets de lojas diferentes (ago/26 NERD:
  // 2.801 aqui × 2.498 lá → ticket médio R$ 296,91 × R$ 332,92). O faturamento e as peças
  // batem ao centavo; só a contagem de tickets do salesTotals é que está subestimada.
  const ticketsComVenda = tickets.filter((t) => t.itens.some((i) => i.qtde > 0)).length;
  const ticketsSoDevolucao = tickets.length - ticketsComVenda;
  const summary: ReportSummaryMetric[] = [
    { label: "Tickets", value: ticketsComVenda, format: "int" },
    ...(ticketsSoDevolucao > 0
      ? [{ label: "Troca/devolução", value: ticketsSoDevolucao, format: "int" as const }]
      : []),
    { label: "Faturamento", value: round2(totalFaturado), format: "currency" },
    { label: "Peças", value: roundInt(totalPecas), format: "int" },
    {
      label: "Ticket médio",
      value: ticketsComVenda > 0 ? round2(totalFaturado / ticketsComVenda) : 0,
      format: "currency",
    },
    {
      label: "Peças por ticket",
      value: ticketsComVenda > 0 ? Math.round((totalPecas / ticketsComVenda) * 100) / 100 : 0,
      format: "number",
    },
    {
      label: "Preço médio por peça",
      value: totalPecas > 0 ? round2(totalFaturado / totalPecas) : 0,
      format: "currency",
    },
  ];

  // ── Corte: sempre por TICKET INTEIRO, para o XLSX nunca mostrar meio ticket ──
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const totalRows = rowsRaw.length;
  const mantidos: TicketAgg[] = [];
  let acumulado = 0;
  for (const t of tickets) {
    if (acumulado > 0 && acumulado + t.itens.length > limit) break;
    mantidos.push(t);
    acumulado += t.itens.length;
    if (acumulado >= limit) break;
  }
  // Teto do SQL batido: o último ticket pode ter vindo pela metade — descarta-o.
  if (capped && mantidos.length > 1 && mantidos.length === tickets.length) mantidos.pop();
  const truncated = capped || mantidos.length < tickets.length;

  const rows: ReportRow[] = [];
  for (const t of mantidos) {
    for (const item of t.itens) {
      rows.push({
        // Chave oculta do ticket para o export agrupar: no e-commerce as 5 filiais viram o
        // mesmo rótulo "E-COMMERCE" e o nº da nota se repete entre CNPJs.
        __ticketKey: t.key,
        CANAL: t.canal === "ECOMMERCE" ? "E-commerce" : "Loja",
        TICKET: t.ticket,
        DATA_VENDA: t.dataVenda,
        FILIAL: t.filialLabel,
        VENDEDOR: t.canal === "ECOMMERCE" ? "E-COMMERCE" : t.vendedor || "SEM VENDEDOR",
        CLIENTE: t.cliente,
        VALOR_TICKET: round2(t.valorTicket),
        PECAS_TICKET: roundInt(t.pecas),
        ITENS_TICKET: t.itens.length,
        PRODUTO: item.produto,
        DESCRICAO: item.descricao,
        COR_DESCRICAO: item.corDescricao,
        COR: item.cor,
        // Tamanho só aparece quando a GRADE tem mais de um tamanho — numa grade de tamanho
        // único o rótulo é a própria dimensão ("90X90") e repetiria a coluna Grade. Sem
        // rótulo cadastrado, cai no ordinal cru (melhor que em branco para conferir).
        TAMANHO:
          item.multiTamanho === 1
            ? item.tamanhoLabel || (item.tamanho > 0 ? String(item.tamanho) : "")
            : "",
        QTDE_ITEM: roundInt(item.qtde),
        // Preço de tabela do cadastro; em branco quando o produto não tem preço cadastrado
        // (melhor que R$ 0,00, que se confundiria com brinde).
        PRECO_UNITARIO: item.precoUnitario != null ? round2(item.precoUnitario) : null,
        DESCONTO_ITEM: round2(item.desconto),
        VALOR_ITEM: round2(item.valorItem),
        GRUPO: item.grupo,
        SUBGRUPO: item.subgrupo,
        LINHA: item.linha,
        COLECAO: item.colecao,
        GRADE: item.grade,
        CODIGO_BARRA: item.codigoBarra,
      });
    }
  }

  return { rows, total: totalRows, truncated, summary };
}

import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { buildFilialFilter } from "@/lib/repositories/clientes";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { getFilialLabelForDisplay } from "@/lib/config/company";
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
function descNormalizada(alias: string): string {
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
function coresJoin(alias: string, joinAlias: string): string {
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
  precoUnitario: number;
  desconto: number;
  valorItem: number;
}

/** Ticket montado em memória: cabeçalho + itens. */
interface TicketAgg {
  key: string;
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
 * ── Escopo ──────────────────────────────────────────────────────────────────────
 * Só venda de loja física (POS): ticket e vendedor não existem no e-commerce
 * (`FATURAMENTO`/nota fiscal), então o e-commerce fica fora desta análise.
 */
export async function fetchTickets(filters: ReportFilters): Promise<ReportResult> {
  const company = await resolveCompanyLive(filters.company);

  const { rows: rowsRaw, capped } = await withRequest(async (request) => {
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

    // ── Filtros de atributo do produto (todos opcionais; '' quando vazios) ──
    const grupoClause = inListClause(request, filters.grupos, "tkGrupo", "p.GRUPO_PRODUTO");
    const linhaClause = inListClause(request, filters.linhas, "tkLinha", "p.LINHA");
    const subgrupoClause = inListClause(request, filters.subgrupos, "tkSubgrupo", "p.SUBGRUPO_PRODUTO");
    const gradeClause = inListClause(request, filters.grades, "tkGrade", "CONVERT(VARCHAR, p.GRADE)");
    const colecaoClause = inListClause(request, filters.colecoes, "tkColecao", "p.COLECAO");
    const tipoClause = inListClause(request, filters.tipos, "tkTipo", "p.TIPO_PRODUTO");
    const corClause = inListClause(request, filters.cores, "tkCor", "cf.DESC_COR");
    const buscaNomeClause = nomeClause(request, filters.produtoSearchTerm, "tkNome");

    // Produto específico / lista de produtos (chips) / pares produto|cor (código de barra).
    const produtoIdsList = (filters.produtoIds ?? []).map((p) => (p ?? "").trim()).filter(Boolean);
    const produtoUnico = (filters.produtoId ?? "").trim();
    const alvoProdutos = Array.from(
      new Set([...(produtoUnico ? [produtoUnico] : []), ...produtoIdsList])
    );
    let produtoClause = "";
    if (alvoProdutos.length > 0) {
      alvoProdutos.forEach((p, i) => request.input(`tkProd${i}`, sql.VarChar, p));
      const placeholders = alvoProdutos.map((_, i) => `@tkProd${i}`).join(", ");
      produtoClause = `AND LTRIM(RTRIM(m.PRODUTO)) IN (${placeholders})`;
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
        request.input(`tkPcP${i}`, sql.VarChar, par.produto);
        request.input(`tkPcC${i}`, sql.VarChar, par.cor);
        return `(LTRIM(RTRIM(m.PRODUTO)) = @tkPcP${i} AND (LTRIM(RTRIM(CAST(m.COR_PRODUTO AS VARCHAR(20)))) = @tkPcC${i} OR TRY_CONVERT(INT, m.COR_PRODUTO) = TRY_CONVERT(INT, @tkPcC${i})))`;
      });
      paresClause = `AND (${ors.join(" OR ")})`;
    }

    // `produtoClause` e `paresClause` são ADITIVAS entre si (um produto colado pelo código
    // e outro pelo barra convivem), então valem como um OR quando as duas existem.
    const escolhaProdutoClause =
      produtoClause && paresClause
        ? `AND ((${produtoClause.slice(4)}) OR (${paresClause.slice(4)}))`
        : produtoClause || paresClause;

    const filtroDeProdutoAtivo = Boolean(
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
        ${corClause ? coresJoin("m", "cf") : ""}
        WHERE 1 = 1
          ${grupoClause}
          ${linhaClause}
          ${subgrupoClause}
          ${gradeClause}
          ${colecaoClause}
          ${tipoClause}
          ${corClause}
          ${buscaNomeClause}
          ${escolhaProdutoClause}
      )`
      : "";

    const ticketsAlvoJoin = filtroDeProdutoAtivo
      ? `INNER JOIN tickets_alvo ta
          ON ta.CODIGO_FILIAL = m.CODIGO_FILIAL AND ta.TICKET = m.TICKET`
      : "";

    const query = `
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
      )${ticketsAlvoCte}
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
        MAX(m.PRECO_LIQUIDO) AS precoUnitario,
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
        precoUnitario: Number(r.precoUnitario ?? 0),
        desconto: Number(r.desconto ?? 0),
        valorItem: Number(r.valorItem ?? 0),
      })),
    };
  });

  // ── Monta os tickets em memória (ordem de chegada = a do ORDER BY do SQL) ──
  const byTicket = new Map<string, TicketAgg>();
  for (const item of rowsRaw) {
    const key = `${item.codigoFilial} ${item.ticket} ${item.dataVenda ?? ""}`;
    let agg = byTicket.get(key);
    if (!agg) {
      agg = {
        key,
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

  const tickets = Array.from(byTicket.values());

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
        TICKET: t.ticket,
        DATA_VENDA: t.dataVenda,
        FILIAL: t.filialLabel,
        VENDEDOR: t.vendedor || "SEM VENDEDOR",
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
        PRECO_UNITARIO: round2(item.precoUnitario),
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

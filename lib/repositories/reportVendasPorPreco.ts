import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import {
  buildEcommerceItensSql,
  buildTicketsMovimentoSql,
  resolveCanaisTicket,
} from "@/lib/repositories/reportTickets";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { getFilialLabelForDisplay } from "@/lib/config/company";
import type {
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Máximo de tickets devolvidos à tela (os KPIs consideram todos os encontrados). */
const DEFAULT_LIMIT = 20000;
/** Teto duro do que a consulta lê do banco (proteção contra período aberto na rede toda). */
const MAX_SQL_ROWS = 200000;

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

interface TicketRaw {
  canal: "LOJA" | "ECOMMERCE";
  codigoFilial: string;
  filial: string;
  ticket: string;
  dataVenda: string | null;
  vendedor: string;
  cliente: string;
  cpf: string;
  valorTicket: number;
  pecas: number;
  itens: number;
  desconto: number;
  temVenda: number;
}

/**
 * Análise "Vendas por preço": os tickets do período com valor líquido IGUAL OU MAIOR que
 * `filters.valorMinimoTicket`, uma linha por ticket — loja física E e-commerce.
 *
 * Faturamento: exatamente os mesmos CTEs de "Tickets detalhados" (`buildTicketsMovimentoSql`
 * — regra canônica "com trocas", ver CLAUDE.md); aqui o SELECT final só sobe o grão de
 * item para ticket e corta pelo valor no `HAVING`. Por isso o valor de um ticket nesta
 * análise é, ao centavo, o "Valor do ticket" da análise detalhada.
 *
 * Filtros de produto (grupo, linha, subgrupo, cor…) escolhem os TICKETS que contêm ao
 * menos um item casando (CTE `tickets_alvo`); o valor comparado com o mínimo é sempre o
 * do ticket INTEIRO. Identidade do ticket = (filial, ticket, data) — o número é
 * sequencial por loja ([[salestotals-count-distinct-ticket-sem-filial]]).
 *
 * E-commerce: não tem ticket — a "venda" é a NOTA FISCAL (`FATURAMENTO`, identidade
 * filial + NF + série, a mesma do `fetchEcommerceSummary`). Entra pela regra canônica do
 * e-commerce: `NOTA_CANCELADA = 0`, `NATUREZA_SAIDA IN ('100.02','100.022')`,
 * valor = `SUM(W_FATURAMENTO_PROD_02.VALOR_LIQUIDO)`. Mesmo escopo de `fetchSalesTotals`:
 * "todas as filiais" soma loja + e-commerce, filial de e-commerce traz só as notas (o
 * grupo inteiro do rodízio), "Varejo" ou uma loja trazem só o POS.
 */
export async function fetchVendasPorPreco(filters: ReportFilters): Promise<ReportResult> {
  const company = await resolveCompanyLive(filters.company);
  const valorMinimo =
    filters.valorMinimoTicket != null && filters.valorMinimoTicket > 0
      ? filters.valorMinimoTicket
      : null;

  // Qual canal entra, pela filial escolhida (mesma régua de fetchSalesTotals).
  const { incluiLoja, incluiEcommerce } = await resolveCanaisTicket(filters);

  const vazio = { rows: [] as TicketRaw[], capped: false };
  const [loja, ecom] = await Promise.all([
    incluiLoja ? fetchLoja(filters, valorMinimo) : Promise.resolve(vazio),
    incluiEcommerce ? fetchEcommerce(filters, valorMinimo) : Promise.resolve(vazio),
  ]);
  const capped = loja.capped || ecom.capped;
  const rowsRaw = [...loja.rows, ...ecom.rows].sort(
    (a, b) =>
      b.valorTicket - a.valorTicket || (b.dataVenda ?? "").localeCompare(a.dataVenda ?? "")
  );

  // ── KPIs sobre TODOS os tickets encontrados (antes do corte de exibição) ──
  // "Tickets" no mesmo critério do resto do sistema: ao menos um item com qtde líquida > 0
  // (o ticket que é só devolução só aparece quando não há valor mínimo).
  const totalFaturado = rowsRaw.reduce((s, t) => s + t.valorTicket, 0);
  const totalPecas = rowsRaw.reduce((s, t) => s + t.pecas, 0);
  const ticketsComVenda = rowsRaw.filter((t) => t.temVenda === 1).length;
  const summary: ReportSummaryMetric[] = [
    { label: "Tickets", value: ticketsComVenda, format: "int" },
    { label: "Faturamento", value: round2(totalFaturado), format: "currency" },
    { label: "Peças", value: Math.round(totalPecas), format: "int" },
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
  ];

  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const mantidos = rowsRaw.slice(0, limit);

  const rows: ReportRow[] = mantidos.map((t) => ({
    CANAL: t.canal === "ECOMMERCE" ? "E-commerce" : "Loja",
    TICKET: t.ticket,
    DATA_VENDA: t.dataVenda,
    FILIAL: company ? getFilialLabelForDisplay(company, t.filial) : t.filial,
    VENDEDOR: t.canal === "ECOMMERCE" ? "E-COMMERCE" : t.vendedor || "SEM VENDEDOR",
    CLIENTE: t.cliente,
    CPF: t.cpf,
    VALOR_TICKET: round2(t.valorTicket),
    PECAS_TICKET: Math.round(t.pecas),
    ITENS_TICKET: t.itens,
    DESCONTO_TICKET: round2(t.desconto),
    PRECO_MEDIO_PECA: t.pecas > 0 ? round2(t.valorTicket / t.pecas) : null,
  }));

  return {
    rows,
    total: rowsRaw.length,
    truncated: capped || mantidos.length < rowsRaw.length,
    summary,
  };
}

/** Parte da loja física (POS): mesmos CTEs de "Tickets detalhados". */
async function fetchLoja(
  filters: ReportFilters,
  valorMinimo: number | null
): Promise<{ rows: TicketRaw[]; capped: boolean }> {
  return withRequest(async (request) => {
    const { withClause, ticketsAlvoJoin } = await buildTicketsMovimentoSql(request, filters);

    let havingClause = "";
    if (valorMinimo != null) {
      request.input("vpValorMin", sql.Decimal(18, 2), valorMinimo);
      // Compara o valor já arredondado ao centavo — o mesmo que aparece na tela.
      havingClause = "HAVING ROUND(SUM(i.VALOR), 2) >= @vpValorMin";
    }

    const query = `
      ${withClause},
      itens AS (
        SELECT
          m.CODIGO_FILIAL,
          m.TICKET,
          m.PRODUTO,
          m.COR_PRODUTO,
          m.TAMANHO,
          SUM(m.QTDE_LIQUIDA_CALC) AS QTDE,
          SUM(m.DESCONTO_VENDA) AS DESCONTO,
          SUM(m.VALOR_LIQUIDO_CALC) AS VALOR
        FROM movimento m
        ${ticketsAlvoJoin}
        GROUP BY m.CODIGO_FILIAL, m.TICKET, m.PRODUTO, m.COR_PRODUTO, m.TAMANHO
      )
      SELECT TOP ${MAX_SQL_ROWS}
        LTRIM(RTRIM(i.CODIGO_FILIAL)) AS codigoFilial,
        LTRIM(RTRIM(ISNULL(CAST(f.FILIAL AS VARCHAR(60)), ''))) AS filial,
        LTRIM(RTRIM(i.TICKET)) AS ticket,
        CONVERT(VARCHAR(10), v.DATA_VENDA, 23) AS dataVenda,
        MAX(ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR(20)))))) AS vendedor,
        MAX(ISNULL(LTRIM(RTRIM(cli.NOME)), '')) AS cliente,
        MAX(LTRIM(RTRIM(ISNULL(CAST(v.CODIGO_CLIENTE AS VARCHAR(30)), '')))) AS cpf,
        SUM(i.VALOR) AS valorTicket,
        SUM(i.QTDE) AS pecas,
        COUNT(*) AS itens,
        SUM(i.DESCONTO) AS desconto,
        MAX(CASE WHEN i.QTDE > 0 THEN 1 ELSE 0 END) AS temVenda
      FROM itens i
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = i.CODIGO_FILIAL AND v.TICKET = i.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = i.CODIGO_FILIAL
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR(20))))
      LEFT JOIN (
        SELECT LTRIM(RTRIM(CPF_CGC)) AS CPF, MAX(LTRIM(RTRIM(CLIENTE_VAREJO))) AS NOME
        FROM CLIENTES_VAREJO WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ISNULL(CPF_CGC, ''))) <> ''
        GROUP BY LTRIM(RTRIM(CPF_CGC))
      ) cli
        ON cli.CPF = LTRIM(RTRIM(ISNULL(CAST(v.CODIGO_CLIENTE AS VARCHAR(30)), '')))
      GROUP BY
        i.CODIGO_FILIAL,
        i.TICKET,
        v.DATA_VENDA,
        LTRIM(RTRIM(ISNULL(CAST(f.FILIAL AS VARCHAR(60)), '')))
      ${havingClause}
      ORDER BY SUM(i.VALOR) DESC, v.DATA_VENDA DESC
    `;

    const result = await request.query<TicketRaw>(query);
    const recs = result.recordset;
    return {
      capped: recs.length >= MAX_SQL_ROWS,
      rows: recs.map<TicketRaw>((r) => ({
        canal: "LOJA",
        codigoFilial: (r.codigoFilial ?? "").trim(),
        filial: (r.filial ?? "").trim(),
        ticket: (r.ticket ?? "").trim(),
        dataVenda: r.dataVenda ?? null,
        vendedor: (r.vendedor ?? "").trim(),
        cliente: (r.cliente ?? "").trim(),
        cpf: (r.cpf ?? "").trim(),
        valorTicket: Number(r.valorTicket ?? 0),
        pecas: Number(r.pecas ?? 0),
        itens: Number(r.itens ?? 0),
        desconto: Number(r.desconto ?? 0),
        temVenda: Number(r.temVenda ?? 0),
      })),
    };
  });
}

/**
 * Parte do e-commerce: uma "venda" = uma nota fiscal. Os itens vêm de
 * `buildEcommerceItensSql` (regra canônica do e-commerce, compartilhada com "Tickets
 * detalhados"); aqui só sobe o grão de item para nota e corta pelo valor.
 */
async function fetchEcommerce(
  filters: ReportFilters,
  valorMinimo: number | null
): Promise<{ rows: TicketRaw[]; capped: boolean }> {
  return withRequest(async (request) => {
    const ecomWith = await buildEcommerceItensSql(request, filters);

    let havingClause = "";
    if (valorMinimo != null) {
      request.input("ecValorMin", sql.Decimal(18, 2), valorMinimo);
      havingClause = "HAVING ROUND(SUM(i.VALOR), 2) >= @ecValorMin";
    }

    const query = `
      ${ecomWith}
      SELECT TOP ${MAX_SQL_ROWS}
        LTRIM(RTRIM(i.FILIAL)) AS filial,
        LTRIM(RTRIM(i.NF_SAIDA)) AS ticket,
        CONVERT(VARCHAR(10), MAX(i.EMISSAO), 23) AS dataVenda,
        MAX(i.CLIENTE) AS cliente,
        SUM(i.VALOR) AS valorTicket,
        SUM(i.QTDE) AS pecas,
        COUNT(*) AS itens,
        SUM(i.DESCONTO) AS desconto,
        MAX(CASE WHEN i.QTDE > 0 THEN 1 ELSE 0 END) AS temVenda
      FROM ecom_itens i
      GROUP BY i.FILIAL, i.NF_SAIDA, i.SERIE_NF
      ${havingClause}
      ORDER BY SUM(i.VALOR) DESC
    `;

    const result = await request.query<TicketRaw>(query);
    const recs = result.recordset;
    return {
      capped: recs.length >= MAX_SQL_ROWS,
      rows: recs.map<TicketRaw>((r) => ({
        canal: "ECOMMERCE",
        codigoFilial: "",
        filial: (r.filial ?? "").trim(),
        ticket: (r.ticket ?? "").trim(),
        dataVenda: r.dataVenda ?? null,
        vendedor: "",
        cliente: (r.cliente ?? "").trim(),
        cpf: "",
        valorTicket: Number(r.valorTicket ?? 0),
        pecas: Number(r.pecas ?? 0),
        itens: Number(r.itens ?? 0),
        desconto: Number(r.desconto ?? 0),
        temVenda: Number(r.temVenda ?? 0),
      })),
    };
  });
}

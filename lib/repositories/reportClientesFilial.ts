import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import { buildFilialFilter } from "@/lib/repositories/clientes";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
} from "@/lib/config/company";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { FILIAL_COMPRAS_COL_PREFIX } from "@/lib/reports/clientes-filial";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

const DEFAULT_LIMIT = 5000;
/** Filial oculta desta análise (loja fechada) — não vira coluna. Ver [[ibirapuera-desativada]]. */
const EXCLUDED_FILIAL_LABELS = new Set(["IBIRAPUERA"]);
function isExcludedLabel(label: string): boolean {
  return EXCLUDED_FILIAL_LABELS.has(label.trim().toUpperCase());
}

/**
 * Chave canônica do cliente por NOME. O SQL agrupa CLIENTE_VAREJO de forma
 * case-insensitive (collation padrão) e ignora espaços nas pontas; o rollup em JS
 * precisa fazer o MESMO, senão variações de caixa ("Fabiana" vs "FABIANA") vindas de
 * filiais diferentes viram linhas separadas com contagem partida. Espelha o ranking de
 * clientes (`fetchClientesRankingCompras`), que agrupa por nome no próprio SQL.
 */
function nomeKey(nome: string): string {
  return nome.trim().toUpperCase();
}

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/** Linha crua por (cliente, filial) devolvida pela agregação de vendas no período. */
interface VendaClienteFilialRow {
  nomeCliente: string;
  filial: string;
  tickets: number;
  totalGasto: number;
  pecas: number;
}

/** Atributos de cadastro (CLIENTES_VAREJO) por nome do cliente. */
interface ClienteCadastro {
  cpf: string;
  cidade: string;
  endereco: string;
  telefone: string;
}

/** Acumulador por cliente (rolando as filiais). */
interface Agg {
  nomeCliente: string; // nome de exibição (primeira grafia vista)
  totalGasto: number;
  pecas: number;
  tickets: number;
  ticketsByLabel: Map<string, number>;
}

function minIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}
function maxIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

/** Divide um array em lotes de tamanho fixo (limite de parâmetros do IN no SQL Server). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Busca os atributos de cadastro (CPF, cidade, endereço, telefone) para um conjunto de
 * nomes de cliente. Como NÃO há FK entre as vendas e CLIENTES_VAREJO, o link é por nome;
 * quando há mais de um cadastro para o mesmo nome, vale o mais recente (CADASTRAMENTO).
 * O mapa é indexado por `nomeKey` (case-insensitive) para casar com o rollup das vendas.
 */
async function fetchCadastroPorNome(nomes: string[]): Promise<Map<string, ClienteCadastro>> {
  const out = new Map<string, ClienteCadastro>();
  const unique = Array.from(new Set(nomes.map((n) => n.trim()).filter(Boolean)));

  for (const slice of chunk(unique, 1000)) {
    // eslint-disable-next-line no-await-in-loop
    await withRequest(async (request) => {
      slice.forEach((nome, idx) => request.input(`n${idx}`, sql.VarChar, nome));
      const placeholders = slice.map((_, idx) => `@n${idx}`).join(", ");
      const query = `
        SELECT
          LTRIM(RTRIM(cv.CLIENTE_VAREJO)) AS nome,
          LTRIM(RTRIM(ISNULL(cv.CPF_CGC, ''))) AS cpf,
          LTRIM(RTRIM(ISNULL(cv.CIDADE, ''))) AS cidade,
          LTRIM(RTRIM(ISNULL(cv.ENDERECO, ''))) AS endereco,
          CASE
            WHEN cv.DDD IS NOT NULL AND LTRIM(RTRIM(cv.DDD)) <> '' AND cv.TELEFONE IS NOT NULL
            THEN LTRIM(RTRIM(cv.DDD)) + ' ' + LTRIM(RTRIM(cv.TELEFONE))
            ELSE ISNULL(LTRIM(RTRIM(cv.TELEFONE)), '')
          END AS telefone,
          cv.CADASTRAMENTO
        FROM CLIENTES_VAREJO cv WITH (NOLOCK)
        WHERE LTRIM(RTRIM(cv.CLIENTE_VAREJO)) IN (${placeholders})
        ORDER BY cv.CADASTRAMENTO DESC
      `;
      const result = await request.query<{
        nome: string;
        cpf: string;
        cidade: string;
        endereco: string;
        telefone: string;
      }>(query);
      // Ordenado por CADASTRAMENTO DESC → o primeiro que aparece para cada nome é o mais recente.
      for (const row of result.recordset) {
        const key = nomeKey(row.nome ?? "");
        if (!key || out.has(key)) continue;
        out.set(key, {
          cpf: row.cpf?.trim() || "",
          cidade: row.cidade?.trim() || "",
          endereco: row.endereco?.trim() || "",
          telefone: row.telefone?.trim() || "",
        });
      }
    });
  }

  return out;
}

/** 1ª e última compra por cliente (nome), indexadas por `nomeKey`. */
interface PrimeiraUltima {
  primeira: string | null;
  ultima: string | null;
}

/**
 * 1ª/última compra do cliente na REDE inteira da empresa, SEM se prender ao período: o
 * período só define quem entra na lista (comprou nele), mas a 1ª compra pode ser bem antes.
 * MIN/MAX de DATA_VENDA no cabeçalho de vendas (todas as filiais da empresa), por nome.
 */
async function fetchPrimeiraUltimaCompra(
  companySlug: string | undefined,
  nomes: string[]
): Promise<Map<string, PrimeiraUltima>> {
  const out = new Map<string, PrimeiraUltima>();
  const unique = Array.from(new Set(nomes.map((n) => n.trim()).filter(Boolean)));

  for (const slice of chunk(unique, 1000)) {
    // eslint-disable-next-line no-await-in-loop
    await withRequest(async (request) => {
      // Rede inteira da empresa (filial = null): 1ª compra é "onde/quando o cliente
      // começou", independente do filtro de filial da tela.
      const filialFilter = await buildFilialFilter(request, companySlug, "sales", null, "v");
      slice.forEach((nome, idx) => request.input(`n${idx}`, sql.VarChar, nome));
      const placeholders = slice.map((_, idx) => `@n${idx}`).join(", ");
      const query = `
        SELECT
          LTRIM(RTRIM(v.CLIENTE_VAREJO)) AS nome,
          CONVERT(VARCHAR(10), MIN(v.DATA_VENDA), 23) AS primeira,
          CONVERT(VARCHAR(10), MAX(v.DATA_VENDA), 23) AS ultima
        FROM W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ISNULL(v.CLIENTE_VAREJO, ''))) IN (${placeholders})
          ${filialFilter}
        GROUP BY LTRIM(RTRIM(v.CLIENTE_VAREJO))
      `;
      const result = await request.query<{ nome: string; primeira: string | null; ultima: string | null }>(query);
      for (const row of result.recordset) {
        const key = nomeKey(row.nome ?? "");
        if (!key) continue;
        // Case/acento podem devolver mais de uma grafia → consolida por min/max.
        const cur = out.get(key);
        out.set(key, {
          primeira: minIso(cur?.primeira ?? null, row.primeira ?? null),
          ultima: maxIso(cur?.ultima ?? null, row.ultima ?? null),
        });
      }
    });
  }

  return out;
}

/**
 * Análise "Clientes por Filial": uma linha por cliente (nome) que comprou no período,
 * com total gasto, peças (itens), tickets e — dinamicamente — uma coluna por filial com o
 * número de tickets do cliente naquela loja. A 1ª e a última compra são do histórico
 * COMPLETO do cliente (não se prendem ao período). Os atributos de cadastro
 * (CPF/cidade/endereço/telefone) vêm de CLIENTES_VAREJO (link por nome).
 *
 * Escopo/fórmula alinhados com o ranking de clientes (`fetchClientesRankingCompras`):
 * faturamento = (PRECO_LIQUIDO*QTDE - DESCONTO_VENDA) dos itens não cancelados; ticket =
 * (FILIAL, PEDIDO, TICKET) que fechou com valor > 0; vendas sem nome ficam de fora.
 */
export async function fetchClientesFilial(filters: ReportFilters): Promise<ReportResult> {
  const company = await resolveCompanyLive(filters.company);

  const rowsRaw = await withRequest(async (request) => {
    const { start, end } = normalizeRangeForQuery({ start: filters.start, end: filters.end });
    request.input("startDate", sql.DateTime, start);
    request.input("endDate", sql.DateTime, end);

    const filialFilter = await buildFilialFilter(
      request,
      filters.company,
      "sales",
      filters.filial ?? null,
      "v"
    );

    // 1ª agregação: itens → ticket (valor e peças por ticket, não cancelados).
    // 2ª: junta o cabeçalho (cliente/filial) e agrega por (cliente, filial) no período.
    const query = `
      WITH itens_por_ticket AS (
        SELECT
          vp.FILIAL,
          vp.PEDIDO,
          vp.TICKET,
          SUM(
            CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
                 ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0) END
          ) AS totalTicket,
          SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS pecasTicket
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
        GROUP BY vp.FILIAL, vp.PEDIDO, vp.TICKET
      ),
      ticket_cliente AS (
        SELECT
          LTRIM(RTRIM(v.CLIENTE_VAREJO)) AS nomeCliente,
          LTRIM(RTRIM(CAST(v.FILIAL AS VARCHAR))) AS filial,
          ipt.totalTicket,
          ipt.pecasTicket
        FROM itens_por_ticket ipt
        INNER JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
          ON v.FILIAL = ipt.FILIAL AND v.PEDIDO = ipt.PEDIDO AND v.TICKET = ipt.TICKET
        WHERE v.DATA_VENDA >= @startDate
          AND v.DATA_VENDA < @endDate
          AND LTRIM(RTRIM(ISNULL(v.CLIENTE_VAREJO, ''))) <> ''
          ${filialFilter}
      )
      SELECT
        nomeCliente,
        filial,
        COUNT(*) AS tickets,
        SUM(totalTicket) AS totalGasto,
        SUM(pecasTicket) AS pecas
      FROM ticket_cliente
      WHERE totalTicket > 0
      GROUP BY nomeCliente, filial
    `;

    const result = await request.query<{
      nomeCliente: string;
      filial: string;
      tickets: number;
      totalGasto: number;
      pecas: number;
    }>(query);

    return result.recordset.map<VendaClienteFilialRow>((r) => ({
      nomeCliente: r.nomeCliente?.trim() || "",
      filial: r.filial?.trim() || "",
      tickets: r.tickets ?? 0,
      totalGasto: r.totalGasto ?? 0,
      pecas: r.pecas ?? 0,
    }));
  });

  // Rótulos de filial: "todas as filiais" (sem filtro) semeia todas as lojas operacionais;
  // com filtro específico, só as que aparecem nos dados. Sempre acrescenta as vistas nos dados.
  const labelSet = new Set<string>();
  if (!filters.filial && company) {
    for (const f of getOperationalFilials(company, "sales")) {
      const label = getFilialLabelForDisplay(company, f);
      if (!isExcludedLabel(label)) labelSet.add(label);
    }
  }

  // Rollup por cliente (nome, case-insensitive), somando as filiais.
  const byCliente = new Map<string, Agg>();
  for (const r of rowsRaw) {
    if (!r.nomeCliente) continue;
    const label = company ? getFilialLabelForDisplay(company, r.filial) : r.filial;
    if (isExcludedLabel(label)) continue;
    labelSet.add(label);

    const key = nomeKey(r.nomeCliente);
    let agg = byCliente.get(key);
    if (!agg) {
      agg = {
        nomeCliente: r.nomeCliente,
        totalGasto: 0,
        pecas: 0,
        tickets: 0,
        ticketsByLabel: new Map(),
      };
      byCliente.set(key, agg);
    }
    agg.totalGasto += r.totalGasto;
    agg.pecas += r.pecas;
    agg.tickets += r.tickets;
    agg.ticketsByLabel.set(label, (agg.ticketsByLabel.get(label) ?? 0) + r.tickets);
  }

  const orderedLabels = Array.from(labelSet).sort((a, b) =>
    company ? compareFilialDisplayOrder(a, b, company) : a.localeCompare(b, "pt-BR")
  );
  const dynamicColumns: ReportColumnDef[] = orderedLabels.map((label) => ({
    key: `${FILIAL_COMPRAS_COL_PREFIX}${label}`,
    defaultLabel: label,
    type: "int" as const,
  }));

  const aggs = Array.from(byCliente.values()).sort((a, b) => b.totalGasto - a.totalGasto);
  const total = aggs.length;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const truncated = total > limit;
  const sliced = truncated ? aggs.slice(0, limit) : aggs;

  // Só para os clientes exibidos: atributos de cadastro + 1ª/última compra (histórico completo).
  const nomesSliced = sliced.map((a) => a.nomeCliente);
  const [cadastro, primeiraUltima] = await Promise.all([
    fetchCadastroPorNome(nomesSliced),
    fetchPrimeiraUltimaCompra(filters.company, nomesSliced),
  ]);

  const rows: ReportRow[] = sliced.map((agg) => {
    const key = nomeKey(agg.nomeCliente);
    const cad = cadastro.get(key);
    const pu = primeiraUltima.get(key);
    const row: ReportRow = {
      CPF: cad?.cpf ?? "",
      CLIENTE: agg.nomeCliente,
      TOTAL_GASTO: round2(agg.totalGasto),
      PECAS: roundInt(agg.pecas),
      TICKETS: roundInt(agg.tickets),
      PRIMEIRA_COMPRA: pu?.primeira ?? null,
      ULTIMA_COMPRA: pu?.ultima ?? null,
      CIDADE: cad?.cidade ?? "",
      ENDERECO: cad?.endereco ?? "",
      TELEFONE: cad?.telefone ?? "",
    };
    for (const label of orderedLabels) {
      row[`${FILIAL_COMPRAS_COL_PREFIX}${label}`] = roundInt(agg.ticketsByLabel.get(label) ?? 0);
    }
    return row;
  });

  const totalFaturado = aggs.reduce((s, a) => s + a.totalGasto, 0);
  const totalTickets = aggs.reduce((s, a) => s + a.tickets, 0);
  const summary: ReportSummaryMetric[] = [
    { label: "Clientes", value: total, format: "int" },
    { label: "Total gasto", value: round2(totalFaturado), format: "currency" },
    { label: "Tickets", value: totalTickets, format: "int" },
    {
      label: "Ticket médio",
      value: totalTickets > 0 ? round2(totalFaturado / totalTickets) : 0,
      format: "currency",
    },
  ];

  return { rows, total, truncated, dynamicColumns, summary };
}

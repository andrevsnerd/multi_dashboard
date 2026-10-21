import { withRequest } from "@/lib/db/connection";
import { getFilialLabelForDisplay } from "@/lib/config/company";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  buildEcommerceItensSql,
  buildItemFilterClauses,
  buildTicketsMovimentoSql,
  coresJoin,
  descNormalizada,
  resolveCanaisTicket,
} from "@/lib/repositories/reportTickets";
import { listFornecedoresByCompany } from "@/lib/utils/fornecedores-store";
import { productMatchesFornecedor } from "@/lib/utils/fornecedor-matcher";
import {
  MAX_COLUNAS_PRODUTO,
  RANKING_CANAL_FIELD,
  SIDE_PRODUTOS,
  SIDE_VENDEDOR_PRODUTO,
  VENDEDOR_OUTROS_COL,
  VENDEDOR_PRODUTO_COL_PREFIX,
} from "@/lib/reports/ranking-vendedores";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Teto do que cada consulta lê do banco (proteção contra período aberto na rede toda). */
const MAX_SQL_ROWS = 200000;
/** Teto da tabela auxiliar vendedor × produto (vai inteira para a tela e o XLSX). */
const MAX_VENDEDOR_PRODUTO_ROWS = 60000;

const ECOM_KEY = "__ECOMMERCE__";
const SEM_VENDEDOR_KEY = "__SEM_VENDEDOR__";

function round2(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}
/**
 * Valor de LINHA com casas de sobra: a tela e o XLSX exibem com 2, mas o TOTAL (fórmula no
 * Excel) soma o exato — arredondar linha a linha e somar desviava centavos e o % somava
 * 99,99. Ver [[produto-giro-arredondamento-somar-exato]].
 */
function round4(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : 0;
}

/** Linha crua: o que UM vendedor vendeu de UM produto × cor em UM ticket (ou nota). */
interface ItemVendedorRaw {
  canal: "LOJA" | "ECOMMERCE";
  codigoFilial: string;
  filial: string;
  ticket: string;
  vendedorCodigo: string;
  vendedor: string;
  produto: string;
  cor: string;
  descricao: string;
  qtde: number;
  valor: number;
  /** 1 quando alguma linha do item tem quantidade líquida > 0 (critério do `fetchSalesTotals`). */
  temVenda: number;
}

function normalize(r: ItemVendedorRaw, canal: ItemVendedorRaw["canal"]): ItemVendedorRaw {
  return {
    canal,
    codigoFilial: (r.codigoFilial ?? "").trim(),
    filial: (r.filial ?? "").trim(),
    ticket: (r.ticket ?? "").trim(),
    vendedorCodigo: (r.vendedorCodigo ?? "").trim(),
    vendedor: (r.vendedor ?? "").trim(),
    produto: (r.produto ?? "").trim(),
    cor: (r.cor ?? "").trim(),
    descricao: (r.descricao ?? "").trim(),
    qtde: Number(r.qtde ?? 0),
    valor: Number(r.valor ?? 0),
    temVenda: Number(r.temVenda ?? 0),
  };
}

/**
 * Itens vendidos na LOJA (POS) pela regra canônica "com trocas", no grão
 * ticket × vendedor × produto × cor. O SQL é o MESMO de "Tickets detalhados"
 * (`buildTicketsMovimentoSql`); a única diferença é o filtro de produto repetido no SELECT
 * final: lá ele escolhe o ticket e o ticket vem inteiro, aqui só conta o item filtrado.
 */
async function fetchItensLoja(
  filters: ReportFilters
): Promise<{ rows: ItemVendedorRaw[]; capped: boolean }> {
  return withRequest(async (request) => {
    const { withClause, ticketsAlvoJoin } = await buildTicketsMovimentoSql(request, filters);
    const { whereSql, needsCores } = buildItemFilterClauses(request, filters, "rv", "m");

    const query = `
      ${withClause}
      SELECT TOP ${MAX_SQL_ROWS}
        LTRIM(RTRIM(m.CODIGO_FILIAL)) AS codigoFilial,
        MAX(LTRIM(RTRIM(ISNULL(CAST(f.FILIAL AS VARCHAR(60)), '')))) AS filial,
        LTRIM(RTRIM(m.TICKET)) AS ticket,
        LTRIM(RTRIM(ISNULL(CAST(v.VENDEDOR AS VARCHAR(20)), ''))) AS vendedorCodigo,
        MAX(ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), '')) AS vendedor,
        LTRIM(RTRIM(m.PRODUTO)) AS produto,
        LTRIM(RTRIM(CAST(m.COR_PRODUTO AS VARCHAR(20)))) AS cor,
        MAX(${descNormalizada("p")}) AS descricao,
        SUM(m.QTDE_LIQUIDA_CALC) AS qtde,
        SUM(m.VALOR_LIQUIDO_CALC) AS valor,
        MAX(CASE WHEN m.QTDE_LIQUIDA_CALC > 0 THEN 1 ELSE 0 END) AS temVenda
      FROM movimento m
      ${ticketsAlvoJoin}
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = m.CODIGO_FILIAL AND v.TICKET = m.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = m.CODIGO_FILIAL
      LEFT JOIN PRODUTOS p WITH (NOLOCK)
        ON p.PRODUTO = m.PRODUTO
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR(20))))
      ${needsCores ? coresJoin("m", "cf") : ""}
      WHERE 1 = 1
        ${whereSql}
      GROUP BY
        m.CODIGO_FILIAL,
        m.TICKET,
        LTRIM(RTRIM(ISNULL(CAST(v.VENDEDOR AS VARCHAR(20)), ''))),
        m.PRODUTO,
        m.COR_PRODUTO
    `;
    const result = await request.query<ItemVendedorRaw>(query);
    const recs = result.recordset;
    return {
      capped: recs.length >= MAX_SQL_ROWS,
      rows: recs.map((r) => normalize(r, "LOJA")),
    };
  });
}

/**
 * Itens vendidos no E-COMMERCE (regra canônica do e-commerce, nota = ticket), no mesmo
 * formato. Não há vendedor no site: a linha vira "E-COMMERCE" no ranking.
 */
async function fetchItensEcommerce(
  filters: ReportFilters
): Promise<{ rows: ItemVendedorRaw[]; capped: boolean }> {
  return withRequest(async (request) => {
    const ecomWith = await buildEcommerceItensSql(request, filters);
    const { whereSql, needsCores } = buildItemFilterClauses(request, filters, "rve", "e");

    const query = `
      ${ecomWith}
      SELECT TOP ${MAX_SQL_ROWS}
        LTRIM(RTRIM(e.FILIAL)) + '|NF|' + LTRIM(RTRIM(e.SERIE_NF)) AS codigoFilial,
        LTRIM(RTRIM(e.FILIAL)) AS filial,
        LTRIM(RTRIM(e.NF_SAIDA)) AS ticket,
        '' AS vendedorCodigo,
        '' AS vendedor,
        LTRIM(RTRIM(e.PRODUTO)) AS produto,
        LTRIM(RTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) AS cor,
        ${descNormalizada("p")} AS descricao,
        e.QTDE AS qtde,
        e.VALOR AS valor,
        CASE WHEN e.QTDE > 0 THEN 1 ELSE 0 END AS temVenda
      FROM ecom_itens e
      LEFT JOIN PRODUTOS p WITH (NOLOCK)
        ON p.PRODUTO = e.PRODUTO
      ${needsCores ? coresJoin("e", "cf") : ""}
      WHERE 1 = 1
        ${whereSql}
    `;
    const result = await request.query<ItemVendedorRaw>(query);
    const recs = result.recordset;
    return {
      capped: recs.length >= MAX_SQL_ROWS,
      rows: recs.map((r) => normalize(r, "ECOMMERCE")),
    };
  });
}

interface VendedorAgg {
  key: string;
  codigo: string;
  nome: string;
  ecommerce: boolean;
  qtde: number;
  valor: number;
  tickets: Set<string>;
  /** Peças por filial (o vendedor pode ter vendido em mais de uma loja). */
  filiais: Map<string, number>;
  porProduto: Map<string, { qtde: number; valor: number; tickets: Set<string> }>;
}

interface ProdutoAgg {
  produto: string;
  descricao: string;
  qtde: number;
  valor: number;
  tickets: Set<string>;
  porVendedor: Map<string, number>;
}

/** Algum filtro de PRODUTO ativo? Sem nenhum, o ranking é de "todos os produtos". */
function temFiltroDeProduto(filters: ReportFilters): boolean {
  const has = (v: string[] | null | undefined) => (v ?? []).some((x) => (x ?? "").trim());
  return Boolean(
    has(filters.grupos) ||
      has(filters.linhas) ||
      has(filters.subgrupos) ||
      has(filters.grades) ||
      has(filters.colecoes) ||
      has(filters.cores) ||
      has(filters.tipos) ||
      has(filters.produtoIds) ||
      has(filters.produtoChaves) ||
      (filters.produtoId ?? "").trim() ||
      (filters.produtoSearchTerm ?? "").trim().length >= 2 ||
      filters.fornecedor
  );
}

/**
 * Análise "Ranking de vendedores": quem mais vendeu os produtos filtrados.
 *
 * ── Faturamento ─────────────────────────────────────────────────────────────────
 * Regra ÚNICA de venda líquida "com trocas" (CLAUDE.md), reaproveitando o SQL de
 * "Tickets detalhados" (`buildTicketsMovimentoSql`, conferido ao centavo contra
 * `vendas-faturamento`) e, no e-commerce, `buildEcommerceItensSql`. Nada de SQL de venda
 * novo: só o SELECT final agrupa por vendedor × produto e aplica o filtro de produto ao
 * ITEM. Nenhuma linha é descartada antes de somar — a devolução entra negativa no vendedor
 * do ticket da troca. Ver [[vendas-nunca-filtrar-linhas-da-regra-global]].
 *
 * ── Tickets ─────────────────────────────────────────────────────────────────────
 * Identidade filial + número ([[salestotals-count-distinct-ticket-sem-filial]]); conta o
 * ticket com ao menos um item FILTRADO de quantidade líquida > 0 — mesmo critério do
 * `fetchSalesTotals`. Cada ticket tem um só vendedor, então a soma das linhas fecha com o
 * total.
 */
export async function fetchRankingVendedores(filters: ReportFilters): Promise<ReportResult> {
  const company = await resolveCompanyLive(filters.company);
  const canais = await resolveCanaisTicket(filters);

  const vazio = { rows: [] as ItemVendedorRaw[], capped: false };
  const [loja, ecom] = await Promise.all([
    canais.incluiLoja ? fetchItensLoja(filters) : Promise.resolve(vazio),
    canais.incluiEcommerce ? fetchItensEcommerce(filters) : Promise.resolve(vazio),
  ]);
  let itens = [...loja.rows, ...ecom.rows];
  const capped = loja.capped || ecom.capped;

  // Fornecedor (NERD): filtra o ITEM antes de somar — o pós-filtro do runReport trabalha em
  // linhas de produto e não serve para linhas de vendedor.
  if (filters.fornecedor && filters.company) {
    const fornecedores = await listFornecedoresByCompany(filters.company);
    itens = itens.filter((i) =>
      productMatchesFornecedor(fornecedores, filters.fornecedor as string, {
        produto: i.produto,
        cor: i.cor,
        descricao: i.descricao,
      })
    );
  }

  const filialLabel = (filial: string) =>
    company ? getFilialLabelForDisplay(company, filial) : filial;

  // ── Agrega por vendedor e por produto ──
  const vendedores = new Map<string, VendedorAgg>();
  const produtos = new Map<string, ProdutoAgg>();
  const ticketsComVenda = new Set<string>();
  let totalQtde = 0;
  let totalValor = 0;

  for (const item of itens) {
    const ecommerce = item.canal === "ECOMMERCE";
    const vKey = ecommerce ? ECOM_KEY : item.vendedorCodigo || SEM_VENDEDOR_KEY;
    const ticketKey = `${item.codigoFilial}|${item.ticket}`;

    let v = vendedores.get(vKey);
    if (!v) {
      v = {
        key: vKey,
        codigo: ecommerce ? "" : item.vendedorCodigo,
        nome: ecommerce
          ? "E-COMMERCE"
          : item.vendedor || (item.vendedorCodigo ? `VENDEDOR ${item.vendedorCodigo}` : "SEM VENDEDOR"),
        ecommerce,
        qtde: 0,
        valor: 0,
        tickets: new Set(),
        filiais: new Map(),
        porProduto: new Map(),
      };
      vendedores.set(vKey, v);
    }
    v.qtde += item.qtde;
    v.valor += item.valor;
    if (item.temVenda === 1) {
      v.tickets.add(ticketKey);
      ticketsComVenda.add(ticketKey);
    }
    const fLabel = ecommerce ? "E-COMMERCE" : filialLabel(item.filial);
    v.filiais.set(fLabel, (v.filiais.get(fLabel) ?? 0) + item.qtde);

    let vp = v.porProduto.get(item.produto);
    if (!vp) {
      vp = { qtde: 0, valor: 0, tickets: new Set() };
      v.porProduto.set(item.produto, vp);
    }
    vp.qtde += item.qtde;
    vp.valor += item.valor;
    if (item.temVenda === 1) vp.tickets.add(ticketKey);

    let p = produtos.get(item.produto);
    if (!p) {
      p = {
        produto: item.produto,
        descricao: item.descricao,
        qtde: 0,
        valor: 0,
        tickets: new Set(),
        porVendedor: new Map(),
      };
      produtos.set(item.produto, p);
    }
    if (!p.descricao && item.descricao) p.descricao = item.descricao;
    p.qtde += item.qtde;
    p.valor += item.valor;
    if (item.temVenda === 1) p.tickets.add(ticketKey);
    p.porVendedor.set(vKey, (p.porVendedor.get(vKey) ?? 0) + item.qtde);

    totalQtde += item.qtde;
    totalValor += item.valor;
  }

  // ── Ordem: peças, depois faturamento. O e-commerce não é vendedor: vai no fim, sem posição ──
  const byRanking = (a: { qtde: number; valor: number; nome?: string }, b: typeof a) =>
    b.qtde - a.qtde || b.valor - a.valor || (a.nome ?? "").localeCompare(b.nome ?? "");
  const ranqueados = Array.from(vendedores.values())
    .filter((v) => !v.ecommerce)
    .sort(byRanking);
  const ecomAgg = vendedores.get(ECOM_KEY) ?? null;
  const ordemVendedores = ecomAgg ? [...ranqueados, ecomAgg] : ranqueados;

  const produtosOrdenados = Array.from(produtos.values()).sort(
    (a, b) =>
      b.qtde - a.qtde || b.valor - a.valor || a.descricao.localeCompare(b.descricao)
  );

  // ── Colunas por produto: só com filtro de produto e 2+ produtos (com 1, repetiria o total) ──
  const comColunasPorProduto = temFiltroDeProduto(filters) && produtosOrdenados.length >= 2;
  const produtosEmColuna = comColunasPorProduto
    ? produtosOrdenados.slice(0, MAX_COLUNAS_PRODUTO)
    : [];
  const restantes = comColunasPorProduto
    ? produtosOrdenados.slice(MAX_COLUNAS_PRODUTO)
    : [];
  const restantesSet = new Set(restantes.map((p) => p.produto));

  const dynamicColumns: ReportColumnDef[] = produtosEmColuna.map((p) => ({
    key: `${VENDEDOR_PRODUTO_COL_PREFIX}${p.produto}`,
    defaultLabel: p.descricao ? `${p.descricao} (${p.produto})` : p.produto,
    type: "int",
  }));
  if (restantes.length > 0) {
    dynamicColumns.push({
      key: VENDEDOR_OUTROS_COL,
      defaultLabel: `Outros ${restantes.length} produtos`,
      type: "int",
    });
  }

  const nomeVendedor = new Map(ordemVendedores.map((v) => [v.key, v.nome] as const));
  const filialPrincipal = (v: VendedorAgg) =>
    Array.from(v.filiais.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f)
      .join(" / ");

  // ── Linhas: uma por vendedor ──
  const rows: ReportRow[] = ordemVendedores.map((v) => {
    const posicao = v.ecommerce ? null : ranqueados.indexOf(v) + 1;
    const row: ReportRow = {
      [RANKING_CANAL_FIELD]: v.ecommerce ? "ECOMMERCE" : "LOJA",
      POSICAO: posicao,
      VENDEDOR: v.nome,
      VENDEDOR_CODIGO: v.codigo,
      FILIAL: filialPrincipal(v),
      QTDE: Math.round(v.qtde),
      PARTICIPACAO: totalQtde !== 0 ? round4((v.qtde / totalQtde) * 100) : 0,
      FATURAMENTO: round4(v.valor),
      TICKETS: v.tickets.size,
      PECAS_POR_TICKET: v.tickets.size > 0 ? round2(v.qtde / v.tickets.size) : null,
      PRECO_MEDIO: v.qtde > 0 ? round2(v.valor / v.qtde) : null,
      PRODUTOS_DISTINTOS: Array.from(v.porProduto.values()).filter((x) => x.qtde > 0).length,
    };
    for (const p of produtosEmColuna) {
      row[`${VENDEDOR_PRODUTO_COL_PREFIX}${p.produto}`] = Math.round(
        v.porProduto.get(p.produto)?.qtde ?? 0
      );
    }
    if (restantes.length > 0) {
      let outros = 0;
      for (const [prod, x] of v.porProduto) if (restantesSet.has(prod)) outros += x.qtde;
      row[VENDEDOR_OUTROS_COL] = Math.round(outros);
    }
    return row;
  });

  // ── Tabela auxiliar 1: os produtos filtrados, do mais vendido ao menos ──
  const produtosRows: ReportRow[] = produtosOrdenados.map((p, i) => {
    // Destaque = vendedor (de loja) que mais vendeu o produto.
    let topKey: string | null = null;
    let topQtde = 0;
    let vendedoresComVenda = 0;
    for (const [vKey, q] of p.porVendedor) {
      if (vKey === ECOM_KEY) continue;
      if (q > 0) vendedoresComVenda += 1;
      if (q > topQtde) {
        topQtde = q;
        topKey = vKey;
      }
    }
    return {
      POSICAO: i + 1,
      PRODUTO: p.produto,
      DESCRICAO: p.descricao,
      QTDE: Math.round(p.qtde),
      PARTICIPACAO: totalQtde !== 0 ? round4((p.qtde / totalQtde) * 100) : 0,
      FATURAMENTO: round4(p.valor),
      TICKETS: p.tickets.size,
      VENDEDORES: vendedoresComVenda,
      DESTAQUE: topKey ? (nomeVendedor.get(topKey) ?? "") : "",
      DESTAQUE_QTDE: topKey ? Math.round(topQtde) : null,
    };
  });

  // ── Tabela auxiliar 2: vendedor × produto (só faz sentido com mais de um produto) ──
  const vendedorProdutoRows: ReportRow[] = [];
  if (produtosOrdenados.length > 1) {
    const descricaoDe = new Map(produtosOrdenados.map((p) => [p.produto, p.descricao] as const));
    outer: for (const v of ordemVendedores) {
      const linhas = Array.from(v.porProduto.entries()).sort(
        (a, b) => b[1].qtde - a[1].qtde || b[1].valor - a[1].valor
      );
      for (const [prod, x] of linhas) {
        if (vendedorProdutoRows.length >= MAX_VENDEDOR_PRODUTO_ROWS) break outer;
        vendedorProdutoRows.push({
          [RANKING_CANAL_FIELD]: v.ecommerce ? "ECOMMERCE" : "LOJA",
          POSICAO: v.ecommerce ? null : ranqueados.indexOf(v) + 1,
          VENDEDOR: v.nome,
          FILIAL: filialPrincipal(v),
          PRODUTO: prod,
          DESCRICAO: descricaoDe.get(prod) ?? "",
          QTDE: Math.round(x.qtde),
          FATURAMENTO: round4(x.valor),
          TICKETS: x.tickets.size,
        });
      }
    }
  }

  const summary: ReportSummaryMetric[] = [
    { label: "Vendedores", value: ranqueados.filter((v) => v.qtde > 0).length, format: "int" },
    { label: "Peças", value: Math.round(totalQtde), format: "int" },
    { label: "Faturamento", value: round2(totalValor), format: "currency" },
    { label: "Tickets", value: ticketsComVenda.size, format: "int" },
    { label: "Produtos", value: produtosOrdenados.filter((p) => p.qtde > 0).length, format: "int" },
  ];
  if (ecomAgg) {
    summary.push({ label: "Peças no e-commerce", value: Math.round(ecomAgg.qtde), format: "int" });
  }

  return {
    rows,
    total: rows.length,
    truncated: capped,
    summary,
    dynamicColumns,
    sideTables: {
      [SIDE_PRODUTOS]: produtosRows,
      [SIDE_VENDEDOR_PRODUTO]: vendedorProdutoRows,
    },
  };
}

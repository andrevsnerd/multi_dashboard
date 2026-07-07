/**
 * Loja Raio X — raio-x de performance de UMA loja (filial).
 *
 * Três fontes, todas escopadas a uma filial (ou grupo lógico expandido):
 *  1. fetchFaturamentoMensalLoja  — faturamento/tickets/qtd por mês (12 meses).
 *  2. fetchVendedoresMatrizMensal — matriz vendedor × mês (valor + qtd).
 *  3. fetchRupturasLoja           — produtos vendidos no mês analisado que estão
 *     zerados na loja + onde há estoque na rede.
 *
 * Fonte de vendas = LOJA_VENDA_PRODUTO (POS), mesmo join/valor da tela Vendedores
 * (lib/repositories/vendedores-v2.ts) para que os números batam entre as abas.
 * Filiais e-commerce (ScarfMe) usam FATURAMENTO no lugar do POS na linha do tempo.
 */

import sql from "mssql";

import {
  getFilialGroupMembers,
  getFilialLabelForDisplay,
  isEcommerceFilial,
  VAREJO_VALUE,
} from "@/lib/config/company";
import { resolveCompanyLive, liveNameForIncoming } from "@/lib/server/company-live";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchVendedoresList } from "@/lib/repositories/vendedores-v2";

const MESES_ABREV = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

export interface MesMetric {
  ano: number;
  mes: number; // 1-12
  ym: string; // "YYYY-MM"
  label: string; // "jul/25"
  faturamento: number;
  tickets: number;
  quantidade: number;
  ticketMedio: number;
}

export interface VendedorLinha {
  vendedor: string;
  porMes: Record<string, { valor: number; qtd: number }>;
  totalValor: number;
  totalQtd: number;
}

export interface VendedoresMatriz {
  meses: string[]; // ["YYYY-MM", ...] 12 meses em ordem cronológica
  vendedores: VendedorLinha[];
}

export interface RupturaItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  qtdVendida: number;
  faturamento: number;
  estoqueLoja: number; // <= 0 (é ruptura)
  estoqueRede: number;
  ondeTemEstoque: Array<{ filial: string; estoque: number }>;
}

// ── Helpers de escopo ────────────────────────────────────────────────────────

/** Expande a filial selecionada (pode ser grupo lógico) para os nomes ERP (FILIAIS.FILIAL). */
async function resolveFilialNames(
  company: string | undefined,
  filial: string | null | undefined
): Promise<string[]> {
  const cfg = await resolveCompanyLive(company);
  const live = (await liveNameForIncoming(filial)) ?? (filial ?? "").trim();
  if (!cfg || !live || live === VAREJO_VALUE) return [];
  const members = getFilialGroupMembers(cfg, live)
    .map((s) => s.trim())
    .filter(Boolean);
  return members.length ? Array.from(new Set(members)) : [live];
}

function buildFilialIn(
  request: sql.Request | RequestLike,
  names: string[],
  alias: string,
  param: string
): string {
  if (!names.length) return "";
  names.forEach((n, i) => request.input(`${param}${i}`, sql.VarChar, n));
  return `AND ${alias}.FILIAL IN (${names.map((_, i) => `@${param}${i}`).join(", ")})`;
}

function buildLinhaTokens(
  request: sql.Request | RequestLike,
  linhas: string[] | null | undefined,
  param: string
): { join: string; where: string } {
  const list = (linhas ?? []).map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!list.length) return { join: "", where: "" };
  list.forEach((l, i) => request.input(`${param}${i}`, sql.VarChar, l));
  return {
    join: "LEFT JOIN PRODUTOS p_lx WITH (NOLOCK) ON p_lx.PRODUTO = vp.PRODUTO",
    where: `AND UPPER(LTRIM(RTRIM(ISNULL(p_lx.LINHA, '')))) IN (${list
      .map((_, i) => `@${param}${i}`)
      .join(", ")})`,
  };
}

/**
 * Chave produto+cor para casar vendas (fetchProductsWithDetails) com estoque
 * (fetchStockByFilial). As duas fontes trazem a DESCRIÇÃO da cor (CORES_BASICAS.DESC_COR),
 * não o código — então casamos por descrição normalizada (ver memória cor-produto-formato-duas-fontes).
 */
function corKeyFromDesc(desc: string | null | undefined): string {
  return (desc ?? "").trim().toUpperCase();
}

/** Lista dos últimos `n` meses (inclui o mês atual), em ordem cronológica. */
function ultimosMeses(n: number): Array<{ ano: number; mes: number; ym: string; label: string }> {
  const now = new Date();
  const baseAno = now.getUTCFullYear();
  const baseMes = now.getUTCMonth(); // 0-11
  const out: Array<{ ano: number; mes: number; ym: string; label: string }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(baseAno, baseMes - i, 1));
    const ano = d.getUTCFullYear();
    const mes = d.getUTCMonth() + 1;
    out.push({
      ano,
      mes,
      ym: `${ano}-${String(mes).padStart(2, "0")}`,
      label: `${MESES_ABREV[mes - 1]}/${String(ano).slice(2)}`,
    });
  }
  return out;
}

/** Início (inclusive) e fim (exclusivo) de um mês YYYY-MM, como Date UTC. */
export function monthRange(ym: string): { start: Date; end: Date } {
  const [ano, mes] = ym.split("-").map((v) => Number(v));
  const start = new Date(Date.UTC(ano, (mes || 1) - 1, 1));
  const end = new Date(Date.UTC(ano, mes || 1, 1));
  return { start, end };
}

// ── 1. Faturamento mensal (12 meses) ─────────────────────────────────────────

export async function fetchFaturamentoMensalLoja(params: {
  company?: string;
  filial?: string | null;
  linhas?: string[] | null;
}): Promise<MesMetric[]> {
  const { company, filial, linhas } = params;
  const meses = ultimosMeses(12);
  const start = monthRange(meses[0].ym).start;
  const end = monthRange(meses[meses.length - 1].ym).end;
  const ecom = isEcommerceFilial(company, filial);
  const names = await resolveFilialNames(company, filial);

  const rows = await withRequest(async (request) => {
    request.input("lxStart", sql.DateTime, start);
    request.input("lxEnd", sql.DateTime, end);

    if (ecom) {
      const filialFilter = buildFilialIn(request, names, "f", "lxEf");
      const query = `
        SELECT
          YEAR(f.EMISSAO) AS y,
          MONTH(f.EMISSAO) AS m,
          SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS faturamento,
          SUM(ISNULL(fp.QTDE, 0)) AS quantidade,
          COUNT(DISTINCT CONCAT(CAST(f.FILIAL AS VARCHAR(30)), '|', CAST(f.NF_SAIDA AS VARCHAR(30)))) AS tickets
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= @lxStart AND f.EMISSAO < @lxEnd
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND fp.QTDE > 0
          ${filialFilter}
        GROUP BY YEAR(f.EMISSAO), MONTH(f.EMISSAO)
      `;
      const r = await request.query<{ y: number; m: number; faturamento: number; quantidade: number; tickets: number }>(query);
      return r.recordset;
    }

    const filialFilter = buildFilialIn(request, names, "f", "lxPf");
    const linha = buildLinhaTokens(request, linhas, "lxLinha");
    const query = `
      WITH Base AS (
        SELECT
          YEAR(vp.DATA_VENDA) AS y,
          MONTH(vp.DATA_VENDA) AS m,
          CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
               ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END AS valor,
          CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END AS qtde_eff,
          CASE WHEN vp.QTDE_CANCELADA = 0 AND vp.QTDE > 0
               THEN CONCAT(CAST(vp.CODIGO_FILIAL AS VARCHAR(30)), '|', CAST(vp.TICKET AS VARCHAR(30))) ELSE NULL END AS tk
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        ${linha.join}
        WHERE vp.DATA_VENDA >= @lxStart AND vp.DATA_VENDA < @lxEnd AND vp.QTDE > 0
          ${filialFilter}
          ${linha.where}
      )
      SELECT y, m,
        SUM(valor) AS faturamento,
        SUM(qtde_eff) AS quantidade,
        COUNT(DISTINCT tk) AS tickets
      FROM Base
      GROUP BY y, m
    `;
    const r = await request.query<{ y: number; m: number; faturamento: number; quantidade: number; tickets: number }>(query);
    return r.recordset;
  });

  const byKey = new Map<string, { faturamento: number; quantidade: number; tickets: number }>();
  for (const row of rows) {
    const ym = `${Number(row.y)}-${String(Number(row.m)).padStart(2, "0")}`;
    byKey.set(ym, {
      faturamento: Number(row.faturamento ?? 0),
      quantidade: Number(row.quantidade ?? 0),
      tickets: Number(row.tickets ?? 0),
    });
  }

  return meses.map((m) => {
    const d = byKey.get(m.ym) ?? { faturamento: 0, quantidade: 0, tickets: 0 };
    const faturamento = Math.round(d.faturamento * 100) / 100;
    return {
      ano: m.ano,
      mes: m.mes,
      ym: m.ym,
      label: m.label,
      faturamento,
      tickets: d.tickets,
      quantidade: d.quantidade,
      ticketMedio: d.tickets > 0 ? Math.round((faturamento / d.tickets) * 100) / 100 : 0,
    };
  });
}

// ── 2. Matriz vendedor × mês (12 meses) ──────────────────────────────────────

export async function fetchVendedoresMatrizMensal(params: {
  company?: string;
  filial?: string | null;
  linhas?: string[] | null;
}): Promise<VendedoresMatriz> {
  const { company, filial, linhas } = params;
  const meses = ultimosMeses(12);
  const start = monthRange(meses[0].ym).start;
  const end = monthRange(meses[meses.length - 1].ym).end;

  if (isEcommerceFilial(company, filial)) {
    return { meses: meses.map((m) => m.ym), vendedores: [] };
  }

  const names = await resolveFilialNames(company, filial);

  const rows = await withRequest(async (request) => {
    request.input("lxStart", sql.DateTime, start);
    request.input("lxEnd", sql.DateTime, end);
    const filialFilter = buildFilialIn(request, names, "f", "lxVf");
    const linha = buildLinhaTokens(request, linhas, "lxVLinha");
    const query = `
      WITH Base AS (
        SELECT
          LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) AS cod,
          ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR)))) AS apelido,
          YEAR(vp.DATA_VENDA) AS y,
          MONTH(vp.DATA_VENDA) AS m,
          CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
               ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END AS valor,
          CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END AS qtde_eff
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
          ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
        ${linha.join}
        WHERE vp.DATA_VENDA >= @lxStart AND vp.DATA_VENDA < @lxEnd AND vp.QTDE > 0
          ${filialFilter}
          ${linha.where}
      )
      SELECT cod, MAX(apelido) AS apelido, y, m,
        SUM(valor) AS valor, SUM(qtde_eff) AS qtd
      FROM Base
      GROUP BY cod, y, m
      HAVING SUM(valor) <> 0
    `;
    const r = await request.query<{ cod: string; apelido: string; y: number; m: number; valor: number; qtd: number }>(query);
    return r.recordset;
  });

  const mesesYm = meses.map((m) => m.ym);
  const map = new Map<string, VendedorLinha>();
  for (const row of rows) {
    const nome = (row.apelido ?? "").trim() || "SEM VENDEDOR";
    const ym = `${Number(row.y)}-${String(Number(row.m)).padStart(2, "0")}`;
    let linhaV = map.get(nome);
    if (!linhaV) {
      linhaV = { vendedor: nome, porMes: {}, totalValor: 0, totalQtd: 0 };
      map.set(nome, linhaV);
    }
    const valor = Math.round(Number(row.valor ?? 0) * 100) / 100;
    const qtd = Number(row.qtd ?? 0);
    const cur = linhaV.porMes[ym] ?? { valor: 0, qtd: 0 };
    cur.valor = Math.round((cur.valor + valor) * 100) / 100;
    cur.qtd += qtd;
    linhaV.porMes[ym] = cur;
    linhaV.totalValor = Math.round((linhaV.totalValor + valor) * 100) / 100;
    linhaV.totalQtd += qtd;
  }

  const vendedores = Array.from(map.values()).sort((a, b) => b.totalValor - a.totalValor);
  return { meses: mesesYm, vendedores };
}

// ── 3. Rupturas do mês analisado ─────────────────────────────────────────────

interface EstoqueProdutoFilial {
  produto: string;
  corDesc: string; // descrição normalizada
  filial: string; // rótulo de exibição
  estoque: number;
}

/**
 * Estoque positivo por produto+cor+filial APENAS para uma lista de produtos.
 * Substitui o scan da rede inteira (fetchStockByFilial) — leve e rápido: WHERE PRODUTO IN (...).
 */
async function fetchEstoquePorProdutos(
  company: string | undefined,
  produtoIds: string[]
): Promise<EstoqueProdutoFilial[]> {
  const ids = Array.from(new Set(produtoIds.map((p) => p.trim()).filter(Boolean)));
  if (ids.length === 0) return [];
  const cfg = await resolveCompanyLive(company);
  const inventoryFiliais = cfg?.filialFilters?.inventory ?? [];
  if (inventoryFiliais.length === 0) return [];

  return withRequest(async (request) => {
    ids.forEach((p, i) => request.input(`rxProd${i}`, sql.VarChar, p));
    inventoryFiliais.forEach((f, i) => request.input(`rxFil${i}`, sql.VarChar, f));
    const query = `
      SELECT
        e.PRODUTO AS produto,
        ISNULL(c.DESC_COR, '') AS corDesc,
        e.FILIAL AS filial,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE e.PRODUTO IN (${ids.map((_, i) => `@rxProd${i}`).join(", ")})
        AND e.FILIAL IN (${inventoryFiliais.map((_, i) => `@rxFil${i}`).join(", ")})
      GROUP BY e.PRODUTO, c.DESC_COR, e.FILIAL
      HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    `;
    const r = await request.query<{ produto: string; corDesc: string; filial: string; estoque: number }>(query);
    return r.recordset.map((row) => ({
      produto: (row.produto ?? "").trim(),
      corDesc: corKeyFromDesc(row.corDesc),
      filial: getFilialLabelForDisplay(cfg ?? null, (row.filial ?? "").trim()),
      estoque: Math.round(Number(row.estoque ?? 0)),
    }));
  });
}

// ── Resumo leve de vendedores de UM mês (para o Diagnóstico) ─────────────────

export interface VendedorMesResumo {
  vendedor: string;
  valor: number;
  tickets: number;
}

/**
 * Vendedores de UM mês (query rápida de período único, igual à tela Vendedores) —
 * evita a matriz de 12 meses no caminho crítico do Diagnóstico.
 */
export async function fetchVendedoresMesResumo(params: {
  company?: string;
  filial?: string | null;
  mes: string; // YYYY-MM
  linhas?: string[] | null;
}): Promise<VendedorMesResumo[]> {
  const { company, filial, mes, linhas } = params;
  if (isEcommerceFilial(company, filial)) return [];
  const range = monthRange(mes);
  const filials = await resolveFilialNames(company, filial);
  const lista = await fetchVendedoresList({
    company,
    filial: null,
    filials,
    range: { start: range.start, end: range.end },
    linhas: linhas ?? undefined,
    light: true,
  });
  const map = new Map<string, VendedorMesResumo>();
  for (const v of lista) {
    const nome = (v.vendedor ?? "").trim() || "SEM VENDEDOR";
    const cur = map.get(nome) ?? { vendedor: nome, valor: 0, tickets: 0 };
    cur.valor = Math.round((cur.valor + (v.faturamento ?? 0)) * 100) / 100;
    cur.tickets += v.tickets ?? 0;
    map.set(nome, cur);
  }
  return Array.from(map.values());
}

export async function fetchRupturasLoja(params: {
  company?: string;
  filial?: string | null;
  mes: string; // YYYY-MM
  linhas?: string[] | null;
}): Promise<RupturaItem[]> {
  const { company, filial, mes, linhas } = params;
  const range = monthRange(mes);

  const [produtos, cfg] = await Promise.all([
    fetchProductsWithDetails({
      company,
      range: { start: range.start, end: range.end },
      filial: filial ?? null,
      groupByColor: true,
      linhas: linhas ?? undefined,
    }),
    resolveCompanyLive(company),
  ]);

  // Só os produtos em ruptura (vendeu no mês + zerado na loja).
  const emRuptura = produtos.filter((p) => (p.totalQuantity ?? 0) > 0 && (p.stock ?? 0) <= 0);
  if (emRuptura.length === 0) return [];

  // Estoque na rede só desses produtos (query leve, escopada por PRODUTO IN).
  const estoque = await fetchEstoquePorProdutos(company, emRuptura.map((p) => p.productId));

  const lojaNames = new Set(
    (await resolveFilialNames(company, filial)).map((n) => getFilialLabelForDisplay(cfg ?? null, n))
  );

  const stockMap = new Map<string, Array<{ filial: string; estoque: number }>>();
  const stockPorProduto = new Map<string, Map<string, number>>();
  for (const e of estoque) {
    const arr = stockMap.get(`${e.produto}|${e.corDesc}`) ?? [];
    arr.push({ filial: e.filial, estoque: e.estoque });
    stockMap.set(`${e.produto}|${e.corDesc}`, arr);
    const agg = stockPorProduto.get(e.produto) ?? new Map<string, number>();
    agg.set(e.filial, (agg.get(e.filial) ?? 0) + e.estoque);
    stockPorProduto.set(e.produto, agg);
  }

  return emRuptura
    .map((p) => {
      const prod = (p.productId ?? "").trim();
      const corDesc = corKeyFromDesc(p.descCorProduto);
      let onde = (stockMap.get(`${prod}|${corDesc}`) ?? []).filter((f) => !lojaNames.has(f.filial));
      // Fallback: sem descrição de cor casável, mostra estoque do produto (qualquer cor).
      if (onde.length === 0 && !corDesc) {
        const agg = stockPorProduto.get(prod);
        if (agg) {
          onde = Array.from(agg.entries())
            .filter(([filial]) => !lojaNames.has(filial))
            .map(([filial, estoque]) => ({ filial, estoque }));
        }
      }
      onde.sort((a, b) => b.estoque - a.estoque);
      return {
        produto: prod,
        cor: (p.corProduto ?? "").trim(),
        corDescricao: (p.descCorProduto ?? "").trim(),
        descricao: (p.productName ?? "").trim(),
        qtdVendida: Math.round(p.totalQuantity ?? 0),
        faturamento: Math.round((p.totalRevenue ?? 0) * 100) / 100,
        estoqueLoja: Math.round(p.stock ?? 0),
        estoqueRede: Math.round(p.estoqueRede ?? onde.reduce((s, f) => s + f.estoque, 0)),
        ondeTemEstoque: onde,
      };
    })
    .sort((a, b) => b.faturamento - a.faturamento);
}

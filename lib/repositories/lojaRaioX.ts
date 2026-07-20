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
  getOperationalFilials,
  compareFilialDisplayOrder,
  isEcommerceFilial,
  VAREJO_VALUE,
  type CompanyKey,
} from "@/lib/config/company";
import { resolveCompanyLive, liveNameForIncoming } from "@/lib/server/company-live";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchVendedoresList } from "@/lib/repositories/vendedores-v2";
import { canonicalKey } from "@/lib/reports/keys";
import { isCompraTransitoDateActive } from "@/lib/utils/compra-transito-status";
import { listComprasTransitoFull } from "@/lib/utils/compra-transito-store";
import { listProdutosDescontinuados } from "@/lib/utils/produto-descontinuado-store";
import { buildDescontinuadoKeySet, isProdutoDescontinuado } from "@/lib/utils/produtos-descontinuados";
import { shiftRangeByMonths, toUtcStartOfDay, type NormalizedRange } from "@/lib/utils/date";
import { getControleEstoqueMetricasItensBatched } from "@/lib/server/controle-estoque-metricas";
import {
  buildControleEstoqueItemKey,
  dedupeControleEstoqueItens,
  type ControleEstoqueItemMetricas,
} from "@/lib/utils/controle-estoque-metricas";
import {
  calcCompraIdealFromResumo,
  type CompraIdealResult,
  type CompraIdealStatus,
} from "@/lib/utils/compra-ideal";
import { getMappedColorDescription } from "@/lib/utils/colorMapping";
import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";

/** Intervalo [start, end) — end exclusivo, padrão do app. */
export interface Range {
  start: Date;
  end: Date;
}

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
  /** True no mês corrente (barra parcial: dados só até hoje). */
  parcial?: boolean;
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
  subgrupo: string | null;
  grade: string | null;
  /** Marcado como descontinuado na tela Produtos Descontinuados. */
  descontinuado: boolean;
  /** Já existe compra em trânsito ativa (a caminho) para este produto/cor. */
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null; // chegada mais próxima (YYYY-MM-DD)
  qtdVendida: number;
  faturamento: number;
  estoqueLoja: number; // <= 0 (é ruptura)
  estoqueRede: number;
  ondeTemEstoque: Array<{ filial: string; estoque: number }>;
  /**
   * Compra Ideal — MESMA regra global de Lista Loja / Curva ABC
   * (`calcCompraIdealFromResumo`), computada só na aba Rupturas (`withCompraIdeal`).
   * Escopo = a loja selecionada; na visão REDE = soma da necessidade por loja.
   * `compraIdeal` é o resultado completo (só no escopo de UMA loja → alimenta o
   * CompraIdealCell com tooltip); `null` na rede, onde só a soma faz sentido.
   */
  compraIdeal: CompraIdealResult | null;
  /** Quantidade a repor (loja: max(0, compraIdeal); rede: soma da necessidade por loja). */
  compraIdealQtd: number;
  compraIdealStatus: CompraIdealStatus | null;
  /** Compras em trânsito (peças a caminho) consideradas no cálculo. */
  compraIdealTransito: number;
  /** Custo unitário canônico (máx. das vendas por loja; fallback = custo do produto). */
  custoUnitario: number;
}

/** Situação de um item na comparação entre o mês analisado e o mês de comparação. */
export type SituacaoComparacao = "ruptura" | "tinha_estoque" | "cresceu" | "estavel";

export interface ComparacaoProdutoItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
  qtdAnalisado: number;
  fatAnalisado: number;
  qtdComparacao: number;
  fatComparacao: number;
  /** fatComparacao − fatAnalisado (positivo = comparação vendeu mais). */
  diffFat: number;
  estoqueLoja: number; // estoque ATUAL na loja (foto de hoje)
  /** Saldo reconstruído no fim do mês analisado (null = mês corrente/sem reconstrução). */
  estoqueFimMesAnalisado: number | null;
  /** Se ruptura, foi total (mês todo sem produto) ou no meio do mês (zerou). */
  rupturaTipo: "total" | "meio" | null;
  temNaRede: boolean; // tem estoque positivo em outra loja da rede
  situacao: SituacaoComparacao;
}

export interface ComparacaoProdutosResult {
  /** Faltou produto: vendia na comparação e ficou sem estoque no mês analisado. */
  ruptura: ComparacaoProdutoItem[];
  /** Tinha estoque mas vendeu menos (performance/demanda). */
  tinhaEstoque: ComparacaoProdutoItem[];
  /** Compensaram: venderam MAIS que na comparação. */
  cresceu: ComparacaoProdutoItem[];
  rupturaCount: number;
  tinhaEstoqueCount: number;
  cresceuCount: number;
  /** R$ perdido por ruptura (soma dos diffs desses produtos). */
  rupturaFat: number;
  /** R$ a menos com estoque em casa (soma dos diffs). */
  tinhaEstoqueFat: number;
  /** R$ ganho pelos produtos que cresceram (soma dos ganhos). */
  cresceuFat: number;
  /** rupturaFat + tinhaEstoqueFat − cresceuFat — fecha com o gap dos KPIs (mesma fórmula). */
  gapProdutos: number;
  /** Algum bucket excedeu o limite exibido. */
  truncado: boolean;
}

/** Item da aba Produtos: vendas antes × depois + estoque hoje + dias de cobertura. */
export interface ProdutoVendaEstoqueItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
  /** Vendas no mês de referência (antes) — quantidade e faturamento. */
  qtdAntes: number;
  fatAntes: number;
  /** Vendas no mês analisado (depois). */
  qtdDepois: number;
  fatDepois: number;
  /** Estoque ATUAL na loja/rede (foto de hoje). */
  estoque: number;
  /** Dias até acabar no ritmo recente; 0 se já zerado; null se sem giro (não vende). */
  acabaEmDias: number | null;
}

export interface ProdutosVendaEstoqueResult {
  /** Vendeu (antes e/ou depois) e está ZERADO hoje. */
  semEstoque: ProdutoVendaEstoqueItem[];
  /** Vendeu (antes e/ou depois) e TEM estoque hoje. */
  comEstoque: ProdutoVendaEstoqueItem[];
  diasAntes: number;
  diasDepois: number;
  truncado: boolean;
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

/**
 * Escopo de filiais para as queries agregadas. Loja específica (ou grupo) → só ela;
 * SEM filial (visão REDE) → TODAS as lojas físicas da empresa (registry, exclui e-commerce).
 * Nunca devolve vazio p/ empresa válida — evita varrer o banco inteiro sem filtro.
 */
async function filiaisEscopo(
  company: string | undefined,
  filial: string | null | undefined
): Promise<string[]> {
  const cfg = await resolveCompanyLive(company);
  if (!cfg) return [];
  const ecommerce = new Set(cfg.ecommerceFilials ?? []);
  const todasFisicas = (cfg.filialFilters?.sales ?? []).filter((f) => !ecommerce.has(f));
  const live = (await liveNameForIncoming(filial)) ?? (filial ?? "").trim();
  if (!live || live === VAREJO_VALUE) return todasFisicas; // visão rede
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
 * Filtro de LINHA (NERD) reutilizável em qualquer perna da query — recebe o alias da
 * tabela PRODUTOS e a coluna de PRODUTO da tabela de origem, para poder ser aplicado
 * tanto às vendas (vp.PRODUTO) quanto às trocas (vt.PRODUTO) na mesma consulta.
 */
function buildLinhaFilter(
  request: sql.Request | RequestLike,
  linhas: string[] | null | undefined,
  produtosAlias: string,
  produtoCol: string,
  param: string
): { join: string; where: string } {
  const list = (linhas ?? []).map((l) => l.trim().toUpperCase()).filter(Boolean);
  if (!list.length) return { join: "", where: "" };
  list.forEach((l, i) => request.input(`${param}${i}`, sql.VarChar, l));
  return {
    join: `LEFT JOIN PRODUTOS ${produtosAlias} WITH (NOLOCK) ON ${produtosAlias}.PRODUTO = ${produtoCol}`,
    where: `AND UPPER(LTRIM(RTRIM(ISNULL(${produtosAlias}.LINHA, '')))) IN (${list
      .map((_, i) => `@${param}${i}`)
      .join(", ")})`,
  };
}

/**
 * Chave produto+cor para casar vendas (fetchProductsWithDetails) com estoque
 * (fetchStockByFilial). As duas fontes trazem a DESCRIÇÃO da cor (PRODUTO_CORES.DESC_COR_PRODUTO, per-produto),
 * não o código — então casamos por descrição normalizada (ver memória cor-produto-formato-duas-fontes).
 */
function corKeyFromDesc(desc: string | null | undefined): string {
  return (desc ?? "").trim().toUpperCase();
}

// ── Descontinuado + trânsito (badges nos itens de produto) ───────────────────

/** Set de chaves de produto descontinuado da empresa (tela Produtos Descontinuados). */
async function loadDescontinuadoSet(company: string | undefined): Promise<Set<string>> {
  if (!company) return new Set<string>();
  try {
    return buildDescontinuadoKeySet(await listProdutosDescontinuados(company as CompanyKey));
  } catch {
    return new Set<string>();
  }
}

/** Quantidade a caminho + data de chegada mais próxima para um produto/cor. */
export interface TransitoInfo {
  quantidade: number;
  dataRecebimento: string | null; // YYYY-MM-DD
}

/**
 * Índice de compras EM TRÂNSITO ativas da empresa, para sinalizar que um produto em
 * ruptura já está a caminho. Casa por produto×cor (canonicalKey, tolera zero à esquerda
 * — ver [[cor-produto-formato-duas-fontes]]); compras sem cor caem num índice por produto
 * (valem p/ qualquer cor daquele produto). Retorna um lookup (produto, cor) → info, ou null.
 */
async function loadTransitoLookup(
  company: string | undefined
): Promise<(produto: string, cor: string | null | undefined) => TransitoInfo | null> {
  const byKey = new Map<string, TransitoInfo>();
  const byProduto = new Map<string, TransitoInfo>();
  if (!company) return () => null;

  const merge = (m: Map<string, TransitoInfo>, k: string, qtd: number, data: string | null) => {
    const cur = m.get(k);
    if (!cur) {
      m.set(k, { quantidade: qtd, dataRecebimento: data });
      return;
    }
    cur.quantidade += qtd;
    if (data && (!cur.dataRecebimento || data < cur.dataRecebimento)) cur.dataRecebimento = data;
  };

  try {
    const compras = await listComprasTransitoFull(company).catch(() => []);
    const today = new Date();
    for (const c of compras) {
      for (const it of c.items ?? []) {
        if (!isCompraTransitoDateActive(it.dataRecebimento, today)) continue;
        const qtd = Math.max(0, Math.round(Number(it.quantidade ?? 0)));
        const data = (it.dataRecebimento ?? "").slice(0, 10) || null;
        const cor = it.corProduto ?? null;
        if (cor != null && String(cor).trim() !== "") {
          merge(byKey, canonicalKey(it.produto, cor), qtd, data);
        } else {
          merge(byProduto, String(it.produto ?? "").trim(), qtd, data);
        }
      }
    }
  } catch {
    /* trânsito indisponível — sem badge */
  }

  return (produto, cor) =>
    byKey.get(canonicalKey(produto, cor)) ?? byProduto.get(String(produto ?? "").trim()) ?? null;
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

/** Índice absoluto de mês (ano*12 + mês0) — para calcular deslocamento entre dois YYYY-MM. */
function monthIndex(ym: string): number {
  const [ano, mes] = ym.split("-").map((v) => Number(v));
  return ano * 12 + ((mes || 1) - 1);
}

export interface JanelaAnalise {
  range: Range;
  /** True quando o mês analisado é o corrente (janela parcial [1..hoje]). */
  isMesCorrente: boolean;
  /** Dia de corte quando parcial (ex.: 8); null em mês fechado. */
  diaCorte: number | null;
  /** Dias efetivos na janela (mês inteiro, ou até hoje se corrente). */
  dias: number;
}

/**
 * Janela do mês analisado, "maçã com maçã": mês inteiro quando fechado; parcial
 * [início do mês, início de amanhã) quando é o mês corrente (só até hoje). Assim a
 * comparação nunca coloca dias parciais do mês atual contra um mês inteiro anterior.
 */
export function analyzedWindow(mes: string): JanelaAnalise {
  const { start, end } = monthRange(mes);
  const now = new Date();
  const isMesCorrente = now.getTime() >= start.getTime() && now.getTime() < end.getTime();
  if (!isMesCorrente) {
    const dias = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return { range: { start, end }, isMesCorrente: false, diaCorte: null, dias };
  }
  const hoje = toUtcStartOfDay(now); // meia-noite UTC do dia corrente
  const endExcl = new Date(hoje.getTime() + 86_400_000); // inclui o dia de hoje
  const diaCorte = hoje.getUTCDate();
  return { range: { start, end: endExcl }, isMesCorrente: true, diaCorte, dias: diaCorte };
}

/**
 * Janela do mês de comparação alinhada por dia à janela analisada, reusando a regra
 * validada do dashboard (`shiftRangeByMonths`): mesma faixa de dias em qualquer mês
 * (mês fechado → mês inteiro; janela parcial → mesmos N dias do outro mês).
 */
export function comparacaoWindow(
  analisadoRange: Range,
  mesAnalisado: string,
  mesComparacao: string
): Range {
  const delta = monthIndex(mesComparacao) - monthIndex(mesAnalisado);
  const shifted = shiftRangeByMonths(analisadoRange as NormalizedRange, delta);
  return { start: shifted.start, end: shifted.end };
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
  const names = await filiaisEscopo(company, filial);

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

    const filialFilterV = buildFilialIn(request, names, "f", "lxPf");
    const filialFilterT = buildFilialIn(request, names, "ft", "lxTf");
    const linhaV = buildLinhaFilter(request, linhas, "p_lv", "vp.PRODUTO", "lxLinhaV");
    const linhaT = buildLinhaFilter(request, linhas, "p_lt", "vt.PRODUTO", "lxLinhaT");
    // Faturamento LÍQUIDO CANÔNICO por mês (mesma regra de lib/services/salesTotals.ts):
    //   vendas (preço×qtde − desconto, cancelados = 0) − trocas (LOJA_VENDA_TROCA).
    // No agregado mensal, subtrair a soma das trocas equivale ao pareamento linha-a-linha
    // do salesTotals (cada troca entra uma vez), então os totais batem com o dashboard.
    const query = `
      WITH Vendas AS (
        SELECT
          YEAR(vp.DATA_VENDA) AS y,
          MONTH(vp.DATA_VENDA) AS m,
          SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
               ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - (vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) END) AS valor,
          SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS qtde_eff,
          COUNT(DISTINCT CASE WHEN vp.QTDE_CANCELADA = 0 AND vp.QTDE > 0
               THEN CONCAT(CAST(vp.CODIGO_FILIAL AS VARCHAR(30)), '|', CAST(vp.TICKET AS VARCHAR(30))) ELSE NULL END) AS tickets
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        ${linhaV.join}
        WHERE vp.DATA_VENDA >= @lxStart AND vp.DATA_VENDA < @lxEnd AND vp.QTDE > 0
          ${filialFilterV}
          ${linhaV.where}
        GROUP BY YEAR(vp.DATA_VENDA), MONTH(vp.DATA_VENDA)
      ),
      Trocas AS (
        SELECT
          YEAR(v.DATA_VENDA) AS y,
          MONTH(v.DATA_VENDA) AS m,
          SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS valorTroca,
          SUM(vt.QTDE) AS qtdeTroca
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS ft WITH (NOLOCK) ON ft.COD_FILIAL = vt.CODIGO_FILIAL
        ${linhaT.join}
        WHERE v.DATA_VENDA >= @lxStart AND v.DATA_VENDA < @lxEnd AND vt.QTDE_CANCELADA = 0
          ${filialFilterT}
          ${linhaT.where}
        GROUP BY YEAR(v.DATA_VENDA), MONTH(v.DATA_VENDA)
      )
      SELECT
        COALESCE(Vendas.y, Trocas.y) AS y,
        COALESCE(Vendas.m, Trocas.m) AS m,
        ISNULL(Vendas.valor, 0) - ISNULL(Trocas.valorTroca, 0) AS faturamento,
        ISNULL(Vendas.qtde_eff, 0) - ISNULL(Trocas.qtdeTroca, 0) AS quantidade,
        ISNULL(Vendas.tickets, 0) AS tickets
      FROM Vendas
      FULL OUTER JOIN Trocas ON Vendas.y = Trocas.y AND Vendas.m = Trocas.m
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

  const mesCorrenteYm = analyzedWindow(meses[meses.length - 1].ym).isMesCorrente
    ? meses[meses.length - 1].ym
    : null;

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
      parcial: m.ym === mesCorrenteYm,
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

  const names = await filiaisEscopo(company, filial);

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
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(e.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, e.COR_PRODUTO))
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

// ── Reconstrução de estoque histórico (disponibilidade no mês analisado) ─────
//
// O ERP NÃO guarda snapshot histórico de estoque por SKU (as tabelas
// ESTOQUE_PRODUTOS_HISTORICO / LJ_BLOCOX_ESTOQUEMENSAL existem mas ficam vazias).
// Então reconstruímos o saldo de um mês passado REBOBINANDO, a partir da foto de
// hoje (ESTOQUE_PRODUTOS), todos os canais de movimento datados — o mesmo modelo
// que o próprio ERP usa (colunas QTDE_* de ESTOQUE_PRODUTOS_HISTORICO):
//   saldo(T) = hoje
//              − entradas com data >= T   (loja + romaneio + troca/devolução)
//              + saídas   com data >= T   (venda + saída loja + saída romaneio)
//              − ajuste de inventário com data >= T
//
// Como o mês corrente tem "fim" no futuro, não há movimento após ele e a fórmula
// devolve o saldo de hoje automaticamente (sem caso especial).
//
// GOTCHA (validado em dados reais): estoque no ERP fica NEGATIVO/fantasma (vende no
// negativo). Um produto pode ter saldo −30 e mesmo assim ter vendido o mês todo.
// Por isso a reconstrução sozinha engana; cruzamos com a CADÊNCIA de vendas (até
// que dia do mês vendeu) — se vendeu até perto do fim, tinha produto (é performance,
// não ruptura), independente do saldo negativo.

export interface DisponibilidadeMes {
  estoqueHoje: number;
  estoqueInicioMes: number;
  estoqueFimMes: number;
  /** Dia do mês (1-31) da última venda na loja; null se não vendeu no mês. */
  ultimaVendaDia: number | null;
  diasNoMes: number;
  /** Recebeu entrada (transferência/romaneio/devolução) durante o mês. */
  reposicaoNoMes: boolean;
  isMesCorrente: boolean;
}

interface CanalRow {
  produto: string;
  cor: string;
  apos: number; // movimento com data >= fim do mês (para rebobinar até o fim)
  durante: number; // movimento dentro do mês [início, fim)
}

/**
 * Reconstrói a disponibilidade (saldo início/fim do mês + cadência de venda) de um
 * conjunto de produtos numa loja, para classificar ruptura de forma realista.
 * Escopo: filial(is) por nome + lista de produtos (IN). Chave = `produto|corCodigo`.
 */
async function fetchDisponibilidadeMes(params: {
  company?: string;
  filial?: string | null;
  range: Range; // janela alinhada do mês analisado
  produtoIds: string[];
}): Promise<Map<string, DisponibilidadeMes>> {
  const { company, filial, range, produtoIds } = params;
  const ids = Array.from(new Set(produtoIds.map((p) => p.trim()).filter(Boolean)));
  const out = new Map<string, DisponibilidadeMes>();
  if (ids.length === 0) return out;

  const names = await resolveFilialNames(company, filial);
  if (names.length === 0) return out;

  const { start, end } = range;
  const now = new Date();
  const isMesCorrente = end.getTime() > now.getTime();
  const diasNoMes = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const key = (p: string, c: string) => `${p.trim()}|${(c ?? "").trim()}`;

  // Aplica produto IN + filial IN (por nome) num request, com prefixos únicos.
  const bindScope = (request: RequestLike, pAlias: string, fAlias: string, prefix: string) => {
    ids.forEach((p, i) => request.input(`${prefix}p${i}`, sql.VarChar, p));
    names.forEach((n, i) => request.input(`${prefix}f${i}`, sql.VarChar, n));
    const prodIn = `${pAlias}.PRODUTO IN (${ids.map((_, i) => `@${prefix}p${i}`).join(", ")})`;
    const filIn = `RTRIM(${fAlias}.FILIAL) IN (${names.map((_, i) => `@${prefix}f${i}`).join(", ")})`;
    return { prodIn, filIn };
  };

  // Roda um canal com janela dupla (apos >= fim / durante [início,fim)).
  const runCanal = async (
    buildSql: (
      req: RequestLike,
      scope: { prodIn: string; filIn: string },
      dateCol: string
    ) => string,
    pAlias: string,
    fAlias: string,
    dateCol: string,
    prefix: string
  ): Promise<CanalRow[]> =>
    withRequest(async (request) => {
      request.input(`${prefix}Start`, sql.DateTime, start);
      request.input(`${prefix}End`, sql.DateTime, end);
      const scope = bindScope(request, pAlias, fAlias, prefix);
      const r = await request.query<{ produto: string; cor: string; apos: number; durante: number }>(
        buildSql(request, scope, dateCol)
      );
      return r.recordset.map((row) => ({
        produto: (row.produto ?? "").trim(),
        cor: (row.cor ?? "").trim(),
        apos: Number(row.apos ?? 0),
        durante: Number(row.durante ?? 0),
      }));
    });

  const janela = (dateCol: string, prefix: string, qtdExpr: string) => `
        SUM(CASE WHEN ${dateCol} >= @${prefix}End THEN ${qtdExpr} ELSE 0 END) AS apos,
        SUM(CASE WHEN ${dateCol} >= @${prefix}Start AND ${dateCol} < @${prefix}End THEN ${qtdExpr} ELSE 0 END) AS durante`;

  const [estoqueRows, vendaRows, ljEntRows, ljSaiRows, prodEntRows, prodSaiRows, trocaRows, ajusteRows] =
    await Promise.all([
      // Saldo de HOJE (ESTOQUE_PRODUTOS) por produto+cor na loja.
      withRequest(async (request) => {
        const scope = bindScope(request, "e", "e", "est");
        const r = await request.query<{ produto: string; cor: string; est: number }>(`
          SELECT RTRIM(e.PRODUTO) AS produto, RTRIM(ISNULL(e.COR_PRODUTO,'')) AS cor,
                 SUM(e.ESTOQUE) AS est
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          WHERE ${scope.prodIn} AND ${scope.filIn}
          GROUP BY e.PRODUTO, e.COR_PRODUTO`);
        return r.recordset.map((row) => ({
          produto: (row.produto ?? "").trim(),
          cor: (row.cor ?? "").trim(),
          est: Number(row.est ?? 0),
        }));
      }),
      // Vendas (saída) — filial por CODIGO_FILIAL → nome via FILIAIS. Traz também o dia da última venda no mês.
      withRequest(async (request) => {
        request.input("vdStart", sql.DateTime, start);
        request.input("vdEnd", sql.DateTime, end);
        ids.forEach((p, i) => request.input(`vdp${i}`, sql.VarChar, p));
        names.forEach((n, i) => request.input(`vdf${i}`, sql.VarChar, n));
        const r = await request.query<{ produto: string; cor: string; apos: number; durante: number; ultimaDia: number | null }>(`
          SELECT RTRIM(vp.PRODUTO) AS produto, RTRIM(ISNULL(vp.COR_PRODUTO,'')) AS cor,
                 SUM(CASE WHEN vp.DATA_VENDA >= @vdEnd THEN (CASE WHEN vp.QTDE_CANCELADA>0 THEN 0 ELSE vp.QTDE END) ELSE 0 END) AS apos,
                 SUM(CASE WHEN vp.DATA_VENDA >= @vdStart AND vp.DATA_VENDA < @vdEnd THEN (CASE WHEN vp.QTDE_CANCELADA>0 THEN 0 ELSE vp.QTDE END) ELSE 0 END) AS durante,
                 MAX(CASE WHEN vp.DATA_VENDA >= @vdStart AND vp.DATA_VENDA < @vdEnd AND vp.QTDE_CANCELADA=0 AND vp.QTDE>0 THEN DAY(vp.DATA_VENDA) ELSE NULL END) AS ultimaDia
          FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
          INNER JOIN FILIAIS f WITH (NOLOCK) ON RTRIM(f.COD_FILIAL) = RTRIM(vp.CODIGO_FILIAL)
          WHERE vp.PRODUTO IN (${ids.map((_, i) => `@vdp${i}`).join(", ")})
            AND RTRIM(f.FILIAL) IN (${names.map((_, i) => `@vdf${i}`).join(", ")})
          GROUP BY vp.PRODUTO, vp.COR_PRODUTO`);
        return r.recordset.map((row) => ({
          produto: (row.produto ?? "").trim(),
          cor: (row.cor ?? "").trim(),
          apos: Number(row.apos ?? 0),
          durante: Number(row.durante ?? 0),
          ultimaDia: row.ultimaDia == null ? null : Number(row.ultimaDia),
        }));
      }),
      // Entrada de loja (transferência que chegou).
      runCanal(
        (_r, s, dc) => `
          SELECT RTRIM(lep.PRODUTO) AS produto, RTRIM(ISNULL(lep.COR_PRODUTO,'')) AS cor,
                 ${janela(dc, "ljE", "lep.QTDE_ENTRADA")}
          FROM LOJA_ENTRADAS le WITH (NOLOCK)
          INNER JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            ON lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL
          WHERE ${s.prodIn} AND ${s.filIn}
          GROUP BY lep.PRODUTO, lep.COR_PRODUTO`,
        "lep",
        "le",
        "le.EMISSAO",
        "ljE"
      ),
      // Saída de loja (transferência que saiu).
      runCanal(
        (_r, s, dc) => `
          SELECT RTRIM(lsp.PRODUTO) AS produto, RTRIM(ISNULL(lsp.COR_PRODUTO,'')) AS cor,
                 ${janela(dc, "ljS", "lsp.QTDE_SAIDA")}
          FROM LOJA_SAIDAS ls WITH (NOLOCK)
          INNER JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
            ON lsp.ROMANEIO_PRODUTO = ls.ROMANEIO_PRODUTO AND lsp.FILIAL = ls.FILIAL
          WHERE ${s.prodIn} AND ${s.filIn}
          GROUP BY lsp.PRODUTO, lsp.COR_PRODUTO`,
        "lsp",
        "ls",
        "ls.EMISSAO",
        "ljS"
      ),
      // Entrada de romaneio nativo (ESTOQUE_PROD_ENT).
      runCanal(
        (_r, s, dc) => `
          SELECT RTRIM(pe.PRODUTO) AS produto, RTRIM(ISNULL(pe.COR_PRODUTO,'')) AS cor,
                 ${janela(dc, "pE", "pe.QTDE")}
          FROM ESTOQUE_PROD_ENT en WITH (NOLOCK)
          INNER JOIN ESTOQUE_PROD1_ENT pe WITH (NOLOCK) ON pe.ROMANEIO_PRODUTO = en.ROMANEIO_PRODUTO
          WHERE ${s.prodIn} AND ${s.filIn}
          GROUP BY pe.PRODUTO, pe.COR_PRODUTO`,
        "pe",
        "pe",
        "en.EMISSAO",
        "pE"
      ),
      // Saída de romaneio nativo (ESTOQUE_PROD_SAI).
      runCanal(
        (_r, s, dc) => `
          SELECT RTRIM(ps.PRODUTO) AS produto, RTRIM(ISNULL(ps.COR_PRODUTO,'')) AS cor,
                 ${janela(dc, "pS", "ps.QTDE")}
          FROM ESTOQUE_PROD_SAI sa WITH (NOLOCK)
          INNER JOIN ESTOQUE_PROD1_SAI ps WITH (NOLOCK) ON ps.ROMANEIO_PRODUTO = sa.ROMANEIO_PRODUTO
          WHERE ${s.prodIn} AND ${s.filIn}
          GROUP BY ps.PRODUTO, ps.COR_PRODUTO`,
        "ps",
        "ps",
        "sa.EMISSAO",
        "pS"
      ),
      // Troca/devolução (volta ao estoque = entrada) — filial por CODIGO_FILIAL.
      withRequest(async (request) => {
        request.input("trStart", sql.DateTime, start);
        request.input("trEnd", sql.DateTime, end);
        ids.forEach((p, i) => request.input(`trp${i}`, sql.VarChar, p));
        names.forEach((n, i) => request.input(`trf${i}`, sql.VarChar, n));
        const r = await request.query<{ produto: string; cor: string; apos: number; durante: number }>(`
          SELECT RTRIM(t.PRODUTO) AS produto, RTRIM(ISNULL(t.COR_PRODUTO,'')) AS cor,
                 SUM(CASE WHEN t.DATA_VENDA >= @trEnd THEN t.QTDE ELSE 0 END) AS apos,
                 SUM(CASE WHEN t.DATA_VENDA >= @trStart AND t.DATA_VENDA < @trEnd THEN t.QTDE ELSE 0 END) AS durante
          FROM LOJA_VENDA_TROCA t WITH (NOLOCK)
          INNER JOIN FILIAIS f WITH (NOLOCK) ON RTRIM(f.COD_FILIAL) = RTRIM(t.CODIGO_FILIAL)
          WHERE t.QTDE_CANCELADA = 0
            AND t.PRODUTO IN (${ids.map((_, i) => `@trp${i}`).join(", ")})
            AND RTRIM(f.FILIAL) IN (${names.map((_, i) => `@trf${i}`).join(", ")})
          GROUP BY t.PRODUTO, t.COR_PRODUTO`);
        return r.recordset.map((row) => ({
          produto: (row.produto ?? "").trim(),
          cor: (row.cor ?? "").trim(),
          apos: Number(row.apos ?? 0),
          durante: Number(row.durante ?? 0),
        }));
      }),
      // Ajuste de inventário (delta assinado) — ESTOQUE_PROD_CTG_AJUSTE + CONTAGEM.
      withRequest(async (request) => {
        request.input("ajStart", sql.DateTime, start);
        request.input("ajEnd", sql.DateTime, end);
        ids.forEach((p, i) => request.input(`ajp${i}`, sql.VarChar, p));
        names.forEach((n, i) => request.input(`ajf${i}`, sql.VarChar, n));
        const r = await request.query<{ produto: string; cor: string; apos: number; durante: number }>(`
          SELECT RTRIM(a.PRODUTO) AS produto, RTRIM(ISNULL(a.COR_PRODUTO,'')) AS cor,
                 SUM(CASE WHEN c.EMISSAO >= @ajEnd THEN ISNULL(a.QTDE_AJUSTE,0) ELSE 0 END) AS apos,
                 SUM(CASE WHEN c.EMISSAO >= @ajStart AND c.EMISSAO < @ajEnd THEN ISNULL(a.QTDE_AJUSTE,0) ELSE 0 END) AS durante
          FROM ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK)
          INNER JOIN ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
          WHERE c.ESTOQUE_AJUSTADO = 1
            AND a.PRODUTO IN (${ids.map((_, i) => `@ajp${i}`).join(", ")})
            AND RTRIM(c.FILIAL) IN (${names.map((_, i) => `@ajf${i}`).join(", ")})
          GROUP BY a.PRODUTO, a.COR_PRODUTO`);
        return r.recordset.map((row) => ({
          produto: (row.produto ?? "").trim(),
          cor: (row.cor ?? "").trim(),
          apos: Number(row.apos ?? 0),
          durante: Number(row.durante ?? 0),
        }));
      }),
    ]);

  // Indexa cada canal por produto|cor.
  const idx = (rows: CanalRow[]) => {
    const m = new Map<string, CanalRow>();
    for (const r of rows) m.set(key(r.produto, r.cor), r);
    return m;
  };
  const estM = new Map(estoqueRows.map((r) => [key(r.produto, r.cor), r.est]));
  const vendaM = new Map(vendaRows.map((r) => [key(r.produto, r.cor), r]));
  const ljEntM = idx(ljEntRows);
  const ljSaiM = idx(ljSaiRows);
  const prodEntM = idx(prodEntRows);
  const prodSaiM = idx(prodSaiRows);
  const trocaM = idx(trocaRows);
  const ajusteM = idx(ajusteRows);

  // Universo = todas as chaves vistas em qualquer canal.
  const chaves = new Set<string>([
    ...estM.keys(),
    ...vendaM.keys(),
    ...ljEntM.keys(),
    ...ljSaiM.keys(),
    ...prodEntM.keys(),
    ...prodSaiM.keys(),
    ...trocaM.keys(),
    ...ajusteM.keys(),
  ]);

  for (const k of chaves) {
    const estoqueHoje = estM.get(k) ?? 0;
    const venda = vendaM.get(k);
    const ent = (m: Map<string, CanalRow>, w: "apos" | "durante") => m.get(k)?.[w] ?? 0;

    const entradasApos = ent(ljEntM, "apos") + ent(prodEntM, "apos") + ent(trocaM, "apos");
    const saidasApos = (venda?.apos ?? 0) + ent(ljSaiM, "apos") + ent(prodSaiM, "apos");
    const ajusteApos = ent(ajusteM, "apos");
    const estoqueFimMes = estoqueHoje - entradasApos + saidasApos - ajusteApos;

    const entradasDur = ent(ljEntM, "durante") + ent(prodEntM, "durante") + ent(trocaM, "durante");
    const saidasDur = (venda?.durante ?? 0) + ent(ljSaiM, "durante") + ent(prodSaiM, "durante");
    const ajusteDur = ent(ajusteM, "durante");
    const estoqueInicioMes = estoqueFimMes - entradasDur + saidasDur - ajusteDur;

    out.set(k, {
      estoqueHoje: Math.round(estoqueHoje),
      estoqueInicioMes: Math.round(estoqueInicioMes),
      estoqueFimMes: Math.round(estoqueFimMes),
      ultimaVendaDia: venda?.ultimaDia ?? null,
      diasNoMes,
      reposicaoNoMes: entradasDur > 0,
      isMesCorrente,
    });
  }
  return out;
}

/**
 * Classifica a disponibilidade de um item no mês (combinando saldo reconstruído +
 * cadência de venda), corrigindo o artefato de estoque negativo do ERP.
 *  - "tinha_estoque": vendeu até perto do fim do mês (tinha produto), OU saldo fim > 0.
 *  - "ruptura_total": começou o mês sem saldo e não recebeu reposição.
 *  - "ruptura_meio":  começou com saldo mas zerou no meio (parou de vender cedo, sem reposição).
 */
export function classificarDisponibilidade(
  d: DisponibilidadeMes | undefined
): "tinha_estoque" | "ruptura_total" | "ruptura_meio" | "desconhecido" {
  if (!d) return "desconhecido";
  const { estoqueInicioMes, estoqueFimMes, ultimaVendaDia, diasNoMes, reposicaoNoMes, isMesCorrente } = d;
  // Vendeu até perto do fim (últimos ~20% do mês ou 5 dias) → tinha produto (corrige negativo-fantasma).
  const limiteTardio = Math.max(diasNoMes - 5, Math.ceil(diasNoMes * 0.8));
  const vendeuTarde = ultimaVendaDia != null && ultimaVendaDia >= limiteTardio;
  if (vendeuTarde) return "tinha_estoque";
  // Mês corrente: usa saldo de hoje como disponibilidade.
  if (isMesCorrente) return estoqueFimMes > 0 ? "tinha_estoque" : "ruptura_meio";
  if (estoqueFimMes > 0) return "tinha_estoque";
  // Fim do mês zerado/negativo:
  if (estoqueInicioMes <= 0 && !reposicaoNoMes) return "ruptura_total";
  return "ruptura_meio";
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
  range: Range; // janela alinhada
  linhas?: string[] | null;
}): Promise<VendedorMesResumo[]> {
  const { company, filial, range, linhas } = params;
  if (isEcommerceFilial(company, filial)) return [];
  const filials = await filiaisEscopo(company, filial);
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

// ── Compra Ideal na aba Rupturas (regra global, igual à Curva ABC) ───────────
//
// Reusa a MESMA pipeline de "Compra sugerida por Curva ABC" / Distribuição Matriz:
// métricas de ritmo/estoque por loja EM LOTE (`getControleEstoqueMetricasItensBatched`,
// 1 chamada por loja, nunca N+1 por item) + trânsito da rede + `calcCompraIdealFromResumo`.
// Assim o número bate com Lista Loja, Curva ABC e Compras Salvas para o mesmo produto×loja.
//
// Só rodamos isto na aba Rupturas (parâmetro `withCompraIdeal`) — o Diagnóstico usa
// fetchRupturasLoja apenas para a CONTAGEM/faturamento e não paga esse custo.

/** Quantas lojas calcular em paralelo (cada uma já batcheia os itens internamente). */
const COMPRA_IDEAL_FILIAL_CONCURRENCY = 3;
/** Teto de itens enriquecidos com Compra Ideal (rupturas já vêm ordenadas por faturamento). */
const COMPRA_IDEAL_RUPTURA_LIMIT = 1200;

const TRANSIT_DESC_PREFIX = " desc ";

/** Espelha reportCompraSugeridaAbc/distribuicaoMatriz: casa trânsito por descrição de cor. */
function transitDescKey(
  produto: string | null | undefined,
  corProduto: string | null | undefined,
  corDescricao?: string | null
): string | null {
  const doProduto = (corDescricao ?? "").trim();
  const base = doProduto || getMappedColorDescription(corProduto);
  const raw = base.trim().toUpperCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  if (!raw) return null;
  return `${TRANSIT_DESC_PREFIX}${String(produto ?? "").trim()}||${raw}`;
}

/** Índice de compras em trânsito ativas por (produto × cor canônica) — pool da rede. */
async function buildCompraTransitIndex(
  company: string | undefined
): Promise<Map<string, CompraTransitoIndexEntry[]>> {
  const idx = new Map<string, CompraTransitoIndexEntry[]>();
  if (!company) return idx;
  const compras = await listComprasTransitoFull(company).catch(() => []);
  const today = new Date();
  for (const c of compras) {
    for (const it of c.items ?? []) {
      if (!isCompraTransitoDateActive(it.dataRecebimento, today)) continue;
      const entry: CompraTransitoIndexEntry = {
        itemKey: it.itemKey ?? "",
        produto: it.produto,
        corProduto: it.corProduto ?? null,
        quantidade: Number(it.quantidade ?? 0),
        dataRecebimento: it.dataRecebimento,
        title: c.title ?? "",
        confirmedAt: c.confirmedAt ?? "",
      };
      const k = canonicalKey(it.produto, it.corProduto ?? null);
      idx.set(k, [...(idx.get(k) ?? []), entry]);
      const dk = transitDescKey(it.produto, it.corProduto, it.corDescricao);
      if (dk) idx.set(dk, [...(idx.get(dk) ?? []), entry]);
    }
  }
  return idx;
}

function resolveTransit(
  transitIndex: Map<string, CompraTransitoIndexEntry[]>,
  produto: string,
  codigoCor: string | null | undefined,
  corDescricao: string | null | undefined
): CompraTransitoIndexEntry[] {
  let transit = transitIndex.get(canonicalKey(produto, codigoCor ?? null)) ?? [];
  if (transit.length === 0) {
    const dk = transitDescKey(produto, codigoCor, corDescricao);
    if (dk) transit = transitIndex.get(dk) ?? [];
  }
  return transit;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

type MetricasMap = Record<string, ControleEstoqueItemMetricas>;

/**
 * Enriquece os itens de ruptura com a Compra Ideal (regra global). Muta `items` in-place.
 * Escopo:
 *  - LOJA específica → 1 lote de métricas dessa loja; guarda o `CompraIdealResult` completo
 *    (alimenta o CompraIdealCell com tooltip, idêntico à Curva ABC daquela filial).
 *  - REDE (sem filial) → calcula por loja e SOMA a necessidade (max(0, compraIdeal) dos itens
 *    em REPOR) — mesma consolidação de "Compra sugerida por Curva ABC" (rede = soma por loja).
 */
async function attachCompraIdealRupturas(params: {
  company: string | undefined;
  filial: string | null | undefined;
  cfg: Awaited<ReturnType<typeof resolveCompanyLive>>;
  items: RupturaItem[];
  meta: Map<string, { linha: string | null; subgrupo: string | null; cost: number }>;
}): Promise<void> {
  const { company, filial, cfg, items, meta } = params;
  if (!company || items.length === 0) return;

  const live = (await liveNameForIncoming(filial)) ?? (filial ?? "").trim();
  const isRede = !live || live === VAREJO_VALUE;

  // Lojas do escopo. Loja específica → a própria (o batched resolve grupo→canônica ativa).
  // Rede → todas as lojas físicas operacionais (canônicas ativas, sem e-commerce), como no ABC.
  const filiaisScope = isRede
    ? getOperationalFilials(cfg ?? null, "sales")
        .filter((f) => !isEcommerceFilial(company, f))
        .sort((a, b) => compareFilialDisplayOrder(a, b, cfg ?? null))
    : [filial as string];
  if (filiaisScope.length === 0) return;

  const alvo = items.slice(0, COMPRA_IDEAL_RUPTURA_LIMIT);
  const itensInput = dedupeControleEstoqueItens(
    alvo.map((r) => ({ produto: r.produto, corProduto: r.cor || null }))
  );

  const [metricasPorFilial, transitIndex] = await Promise.all([
    mapWithConcurrency(filiaisScope, COMPRA_IDEAL_FILIAL_CONCURRENCY, (name) =>
      getControleEstoqueMetricasItensBatched({
        company,
        filial: name,
        includeHistorico: true,
        itens: itensInput,
      }).catch(() => ({}) as MetricasMap)
    ),
    buildCompraTransitIndex(company),
  ]);

  for (const item of alvo) {
    const itemKey = buildControleEstoqueItemKey(item.produto, item.cor || null);
    const metaItem = meta.get(itemKey) ?? { linha: null, subgrupo: null, cost: 0 };
    const transit = resolveTransit(transitIndex, item.produto, item.cor, item.corDescricao);

    // Custo unitário canônico = máx. do custo das vendas por loja (igual à Curva ABC);
    // fallback para o custo do produto quando nenhuma loja tem venda com custo.
    let custoMax = 0;

    if (!isRede) {
      const resumo = metricasPorFilial[0]?.[itemKey]?.resumo ?? null;
      const ideal = calcCompraIdealFromResumo(resumo, transit, {
        linha: metaItem.linha,
        subgrupo: metaItem.subgrupo,
        company,
      });
      custoMax = Number(resumo?.custoUnitario ?? 0);
      item.compraIdeal = ideal;
      item.compraIdealStatus = ideal.status;
      item.compraIdealQtd = ideal.status === "REPOR" ? Math.max(0, ideal.compraIdeal) : 0;
      item.compraIdealTransito = ideal.emTransito;
    } else {
      let soma = 0;
      filiaisScope.forEach((_, idx) => {
        const resumo = metricasPorFilial[idx]?.[itemKey]?.resumo ?? null;
        custoMax = Math.max(custoMax, Number(resumo?.custoUnitario ?? 0));
        const ideal = calcCompraIdealFromResumo(resumo, transit, {
          linha: metaItem.linha,
          subgrupo: metaItem.subgrupo,
          company,
        });
        if (ideal.status === "REPOR") soma += Math.max(0, ideal.compraIdeal);
      });
      item.compraIdeal = null; // soma da rede não tem um único resumo/tooltip
      item.compraIdealQtd = soma;
      item.compraIdealStatus = soma > 0 ? "REPOR" : "OK";
      item.compraIdealTransito = transit.reduce((s, e) => s + Math.max(0, Number(e.quantidade ?? 0)), 0);
    }

    item.custoUnitario = custoMax > 0 ? Math.round(custoMax * 100) / 100 : Math.round(metaItem.cost * 100) / 100;
  }
}

export async function fetchRupturasLoja(params: {
  company?: string;
  filial?: string | null;
  range: Range; // janela alinhada do mês analisado
  linhas?: string[] | null;
  /** Calcula a Compra Ideal (regra global) por item — só na aba Rupturas (caro). */
  withCompraIdeal?: boolean;
}): Promise<RupturaItem[]> {
  const { company, filial, range, linhas, withCompraIdeal } = params;

  const [produtos, cfg, descSet, transito] = await Promise.all([
    fetchProductsWithDetails({
      company,
      range: { start: range.start, end: range.end },
      filial: filial ?? null,
      groupByColor: true,
      linhas: linhas ?? undefined,
    }),
    resolveCompanyLive(company),
    loadDescontinuadoSet(company),
    loadTransitoLookup(company),
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

  const itens: RupturaItem[] = emRuptura
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
      const t = transito(prod, p.corProduto);
      return {
        produto: prod,
        cor: (p.corProduto ?? "").trim(),
        corDescricao: (p.descCorProduto ?? "").trim(),
        descricao: (p.productName ?? "").trim(),
        subgrupo: p.subgrupo ?? null,
        grade: p.grade ?? null,
        descontinuado: isProdutoDescontinuado(descSet, prod),
        emTransito: !!t && t.quantidade > 0,
        transitoQtd: t?.quantidade ?? 0,
        transitoData: t?.dataRecebimento ?? null,
        qtdVendida: Math.round(p.totalQuantity ?? 0),
        faturamento: Math.round((p.totalRevenue ?? 0) * 100) / 100,
        estoqueLoja: Math.round(p.stock ?? 0),
        estoqueRede: Math.round(p.estoqueRede ?? onde.reduce((s, f) => s + f.estoque, 0)),
        ondeTemEstoque: onde,
        compraIdeal: null,
        compraIdealQtd: 0,
        compraIdealStatus: null,
        compraIdealTransito: 0,
        custoUnitario: 0,
      };
    })
    .sort((a, b) => b.faturamento - a.faturamento);

  if (withCompraIdeal) {
    // Metadados canônicos (linha/subgrupo/custo) da MESMA fonte de produto do app,
    // necessários para a cobertura-alvo por linha da Compra Ideal + custo de fallback.
    const meta = new Map<string, { linha: string | null; subgrupo: string | null; cost: number }>();
    for (const p of emRuptura) {
      meta.set(buildControleEstoqueItemKey(p.productId, p.corProduto ?? null), {
        linha: p.linha ?? null,
        subgrupo: p.subgrupo ?? null,
        cost: Number(p.cost ?? 0),
      });
    }
    await attachCompraIdealRupturas({ company, filial, cfg, items: itens, meta });
  }

  return itens;
}

// ── Comparação de produtos: mês analisado vs mês de comparação ───────────────

/**
 * Cruza o que vendeu no mês de comparação com o que vendeu no mês analisado (por
 * produto×cor), trazendo o estoque ATUAL na loja e se há estoque na rede. Responde:
 * "o que vendeu no mês bom?", "o que faltou agora (ruptura) vs o que tinha e vendeu
 * menos (performance)?". Ordenado pela diferença de faturamento (maior lacuna primeiro).
 */
export async function fetchComparacaoProdutosLoja(params: {
  company?: string;
  filial?: string | null;
  /** Janela alinhada do mês analisado (parcial no mês corrente). */
  rangeAnalisado: Range;
  /** Janela alinhada do mês de comparação (mesma faixa de dias). */
  rangeComparacao: Range;
  linhas?: string[] | null;
  /** Máx. de itens por bucket (ruptura / tinha estoque / cresceu). */
  limit?: number;
}): Promise<ComparacaoProdutosResult> {
  const { company, filial, rangeAnalisado, rangeComparacao, linhas, limit = 100 } = params;

  const [prodA, prodB, descSet, transito] = await Promise.all([
    fetchProductsWithDetails({
      company,
      range: { start: rangeAnalisado.start, end: rangeAnalisado.end },
      filial: filial ?? null,
      groupByColor: true,
      linhas: linhas ?? undefined,
    }),
    fetchProductsWithDetails({
      company,
      range: { start: rangeComparacao.start, end: rangeComparacao.end },
      filial: filial ?? null,
      groupByColor: true,
      linhas: linhas ?? undefined,
    }),
    loadDescontinuadoSet(company),
    loadTransitoLookup(company),
  ]);

  interface Acc {
    produto: string;
    cor: string;
    corDescricao: string;
    descricao: string;
    subgrupo: string | null;
    grade: string | null;
    qtdA: number;
    fatA: number;
    qtdB: number;
    fatB: number;
    estoqueLoja: number;
  }
  const map = new Map<string, Acc>();
  const key = (id: string | null | undefined, cor: string | null | undefined) =>
    `${(id ?? "").trim()}|${(cor ?? "").trim()}`;

  const upsert = (p: (typeof prodA)[number], which: "A" | "B") => {
    const k = key(p.productId, p.corProduto);
    let e = map.get(k);
    if (!e) {
      e = {
        produto: (p.productId ?? "").trim(),
        cor: (p.corProduto ?? "").trim(),
        corDescricao: (p.descCorProduto ?? "").trim(),
        descricao: (p.productName ?? "").trim(),
        subgrupo: p.subgrupo ?? null,
        grade: p.grade ?? null,
        qtdA: 0,
        fatA: 0,
        qtdB: 0,
        fatB: 0,
        estoqueLoja: Math.round(p.stock ?? 0),
      };
      map.set(k, e);
    }
    // Estoque é snapshot atual (mesmo nos dois fetches); mantém o valor disponível.
    if (p.stock != null) e.estoqueLoja = Math.round(p.stock);
    if (!e.descricao && p.productName) e.descricao = p.productName.trim();
    if (!e.corDescricao && p.descCorProduto) e.corDescricao = p.descCorProduto.trim();
    if (!e.subgrupo && p.subgrupo) e.subgrupo = p.subgrupo;
    if (!e.grade && p.grade) e.grade = p.grade;
    if (which === "A") {
      e.qtdA = Math.round(p.totalQuantity ?? 0);
      e.fatA = Math.round((p.totalRevenue ?? 0) * 100) / 100;
    } else {
      e.qtdB = Math.round(p.totalQuantity ?? 0);
      e.fatB = Math.round((p.totalRevenue ?? 0) * 100) / 100;
    }
  };
  prodA.forEach((p) => upsert(p, "A"));
  prodB.forEach((p) => upsert(p, "B"));

  // Itens que CAÍRAM (venderam menos que na comparação) → candidatos a ruptura/performance.
  // Só para esses reconstruímos a disponibilidade do mês analisado (query escopada).
  const caiuIds = Array.from(map.values())
    .filter((e) => e.fatB - e.fatA > 0.005)
    .map((e) => e.produto);

  // Disponibilidade no mês analisado (reconstrução real) + estoque na rede HOJE (para "onde puxar").
  const [disp, estoqueRede] = await Promise.all([
    fetchDisponibilidadeMes({ company, filial, range: rangeAnalisado, produtoIds: caiuIds }),
    fetchEstoquePorProdutos(
      company,
      Array.from(map.values())
        .filter((e) => e.estoqueLoja <= 0)
        .map((e) => e.produto)
    ),
  ]);
  const naRede = new Set(estoqueRede.map((e) => e.produto));

  const ruptura: ComparacaoProdutoItem[] = [];
  const tinhaEstoque: ComparacaoProdutoItem[] = [];
  const cresceu: ComparacaoProdutoItem[] = [];
  let rupturaFat = 0;
  let tinhaEstoqueFat = 0;
  let cresceuFat = 0;

  for (const e of map.values()) {
    const diffFat = Math.round((e.fatB - e.fatA) * 100) / 100;
    const d = disp.get(`${e.produto}|${e.cor}`);
    let situacao: SituacaoComparacao;
    let rupturaTipo: "total" | "meio" | null = null;
    if (diffFat > 0) {
      // Classificação REALISTA: saldo reconstruído na janela + cadência de venda
      // (corrige o estoque negativo-fantasma do ERP). Fallback p/ estoque de hoje
      // quando não há dado de movimento (produto sem histórico).
      const cls = classificarDisponibilidade(d);
      if (cls === "ruptura_total" || cls === "ruptura_meio") {
        situacao = "ruptura";
        rupturaTipo = cls === "ruptura_total" ? "total" : "meio";
      } else if (cls === "tinha_estoque") {
        situacao = "tinha_estoque";
      } else {
        // desconhecido → cai no sinal antigo (estoque de hoje).
        situacao = e.estoqueLoja <= 0 ? "ruptura" : "tinha_estoque";
        if (situacao === "ruptura") rupturaTipo = "meio";
      }
    } else if (diffFat < 0) {
      situacao = "cresceu";
    } else {
      situacao = "estavel";
    }

    const t = transito(e.produto, e.cor);
    const item: ComparacaoProdutoItem = {
      produto: e.produto,
      cor: e.cor,
      corDescricao: e.corDescricao,
      descricao: e.descricao,
      subgrupo: e.subgrupo,
      grade: e.grade,
      descontinuado: isProdutoDescontinuado(descSet, e.produto),
      emTransito: !!t && t.quantidade > 0,
      transitoQtd: t?.quantidade ?? 0,
      transitoData: t?.dataRecebimento ?? null,
      qtdAnalisado: e.qtdA,
      fatAnalisado: e.fatA,
      qtdComparacao: e.qtdB,
      fatComparacao: e.fatB,
      diffFat,
      estoqueLoja: e.estoqueLoja,
      estoqueFimMesAnalisado: d && !d.isMesCorrente ? d.estoqueFimMes : null,
      rupturaTipo,
      temNaRede: e.estoqueLoja <= 0 && naRede.has(e.produto),
      situacao,
    };

    if (situacao === "ruptura") {
      ruptura.push(item);
      rupturaFat += diffFat;
    } else if (situacao === "tinha_estoque") {
      tinhaEstoque.push(item);
      tinhaEstoqueFat += diffFat;
    } else if (situacao === "cresceu") {
      cresceu.push(item);
      cresceuFat += -diffFat;
    }
  }

  // Maior lacuna primeiro em cada bucket (cresceu = maior ganho primeiro).
  ruptura.sort((a, b) => b.diffFat - a.diffFat);
  tinhaEstoque.sort((a, b) => b.diffFat - a.diffFat);
  cresceu.sort((a, b) => a.diffFat - b.diffFat);

  const round2 = (v: number) => Math.round(v * 100) / 100;
  const truncado = ruptura.length > limit || tinhaEstoque.length > limit || cresceu.length > limit;

  return {
    ruptura: ruptura.slice(0, limit),
    tinhaEstoque: tinhaEstoque.slice(0, limit),
    cresceu: cresceu.slice(0, limit),
    rupturaCount: ruptura.length,
    tinhaEstoqueCount: tinhaEstoque.length,
    cresceuCount: cresceu.length,
    rupturaFat: round2(rupturaFat),
    tinhaEstoqueFat: round2(tinhaEstoqueFat),
    cresceuFat: round2(cresceuFat),
    gapProdutos: round2(rupturaFat + tinhaEstoqueFat - cresceuFat),
    truncado,
  };
}

// ── Aba Produtos: vendas antes × depois + estoque hoje + dias de cobertura ───

/**
 * Lista os produtos (produto×cor) que venderam na referência (antes) e/ou no mês
 * analisado (depois), com o estoque ATUAL e uma estimativa de "acaba em" (dias de
 * cobertura no ritmo recente). Separa em SEM estoque (zerado hoje) e COM estoque —
 * para ver de relance o que performou e se ainda temos para vender.
 *
 * "Acaba em" = estoque ÷ (vendas/dia). Ritmo = janela DEPOIS (atual); se não vendeu
 * agora, cai para o ritmo da janela ANTES (referência). Sem giro em nenhuma → null.
 */
export async function fetchProdutosVendaEstoque(params: {
  company?: string;
  filial?: string | null;
  rangeAnalisado: Range; // "depois" (atual)
  rangeComparacao: Range; // "antes" (referência)
  linhas?: string[] | null;
  limit?: number;
}): Promise<ProdutosVendaEstoqueResult> {
  const { company, filial, rangeAnalisado, rangeComparacao, linhas, limit = 300 } = params;

  const [prodDepois, prodAntes, descSet, transito] = await Promise.all([
    fetchProductsWithDetails({
      company,
      range: { start: rangeAnalisado.start, end: rangeAnalisado.end },
      filial: filial ?? null,
      groupByColor: true,
      linhas: linhas ?? undefined,
    }),
    fetchProductsWithDetails({
      company,
      range: { start: rangeComparacao.start, end: rangeComparacao.end },
      filial: filial ?? null,
      groupByColor: true,
      linhas: linhas ?? undefined,
    }),
    loadDescontinuadoSet(company),
    loadTransitoLookup(company),
  ]);

  const diasDepois = Math.max(1, Math.round((rangeAnalisado.end.getTime() - rangeAnalisado.start.getTime()) / 86_400_000));
  const diasAntes = Math.max(1, Math.round((rangeComparacao.end.getTime() - rangeComparacao.start.getTime()) / 86_400_000));

  interface Acc {
    produto: string;
    cor: string;
    corDescricao: string;
    descricao: string;
    subgrupo: string | null;
    grade: string | null;
    qtdAntes: number;
    fatAntes: number;
    qtdDepois: number;
    fatDepois: number;
    estoque: number;
  }
  const map = new Map<string, Acc>();
  const key = (id: string | null | undefined, cor: string | null | undefined) =>
    `${(id ?? "").trim()}|${(cor ?? "").trim()}`;

  const upsert = (p: (typeof prodDepois)[number], which: "antes" | "depois") => {
    const k = key(p.productId, p.corProduto);
    let e = map.get(k);
    if (!e) {
      e = {
        produto: (p.productId ?? "").trim(),
        cor: (p.corProduto ?? "").trim(),
        corDescricao: (p.descCorProduto ?? "").trim(),
        descricao: (p.productName ?? "").trim(),
        subgrupo: p.subgrupo ?? null,
        grade: p.grade ?? null,
        qtdAntes: 0,
        fatAntes: 0,
        qtdDepois: 0,
        fatDepois: 0,
        estoque: Math.round(p.stock ?? 0),
      };
      map.set(k, e);
    }
    if (p.stock != null) e.estoque = Math.round(p.stock);
    if (!e.descricao && p.productName) e.descricao = p.productName.trim();
    if (!e.corDescricao && p.descCorProduto) e.corDescricao = p.descCorProduto.trim();
    if (!e.subgrupo && p.subgrupo) e.subgrupo = p.subgrupo;
    if (!e.grade && p.grade) e.grade = p.grade;
    if (which === "antes") {
      e.qtdAntes = Math.round(p.totalQuantity ?? 0);
      e.fatAntes = Math.round((p.totalRevenue ?? 0) * 100) / 100;
    } else {
      e.qtdDepois = Math.round(p.totalQuantity ?? 0);
      e.fatDepois = Math.round((p.totalRevenue ?? 0) * 100) / 100;
    }
  };
  prodDepois.forEach((p) => upsert(p, "depois"));
  prodAntes.forEach((p) => upsert(p, "antes"));

  const semEstoque: ProdutoVendaEstoqueItem[] = [];
  const comEstoque: ProdutoVendaEstoqueItem[] = [];

  for (const e of map.values()) {
    // Só quem vendeu em alguma das janelas (ignora quem não vendeu em nenhuma).
    if (e.qtdAntes <= 0 && e.qtdDepois <= 0) continue;

    // Ritmo de venda: atual (depois); cai para referência (antes) se não vende agora.
    const rateDepois = e.qtdDepois / diasDepois;
    const rateAntes = e.qtdAntes / diasAntes;
    const rate = rateDepois > 0 ? rateDepois : rateAntes;

    let acabaEmDias: number | null;
    if (e.estoque <= 0) acabaEmDias = 0;
    else if (rate > 0) acabaEmDias = Math.max(0, Math.round(e.estoque / rate));
    else acabaEmDias = null; // tem estoque mas sem giro

    const t = transito(e.produto, e.cor);
    const item: ProdutoVendaEstoqueItem = {
      produto: e.produto,
      cor: e.cor,
      corDescricao: e.corDescricao,
      descricao: e.descricao,
      subgrupo: e.subgrupo,
      grade: e.grade,
      descontinuado: isProdutoDescontinuado(descSet, e.produto),
      emTransito: !!t && t.quantidade > 0,
      transitoQtd: t?.quantidade ?? 0,
      transitoData: t?.dataRecebimento ?? null,
      qtdAntes: e.qtdAntes,
      fatAntes: e.fatAntes,
      qtdDepois: e.qtdDepois,
      fatDepois: e.fatDepois,
      estoque: e.estoque,
      acabaEmDias,
    };
    if (e.estoque <= 0) semEstoque.push(item);
    else comEstoque.push(item);
  }

  // Sem estoque: os maiores vendedores (antes/depois) que faltam primeiro.
  const peso = (i: ProdutoVendaEstoqueItem) => Math.max(i.qtdDepois, i.qtdAntes);
  semEstoque.sort((a, b) => peso(b) - peso(a) || b.fatAntes - a.fatAntes);
  // Com estoque: os que acabam antes primeiro (urgência de reposição); sem giro por último.
  comEstoque.sort((a, b) => {
    const da = a.acabaEmDias ?? Number.POSITIVE_INFINITY;
    const db = b.acabaEmDias ?? Number.POSITIVE_INFINITY;
    return da - db || peso(b) - peso(a);
  });

  const truncado = semEstoque.length > limit || comEstoque.length > limit;
  return {
    semEstoque: semEstoque.slice(0, limit),
    comEstoque: comEstoque.slice(0, limit),
    diasAntes,
    diasDepois,
    truncado,
  };
}

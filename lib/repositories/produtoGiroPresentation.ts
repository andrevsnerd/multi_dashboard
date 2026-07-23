import sql from "mssql";

import { type CompanyKey, VAREJO_VALUE } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { withRequest } from "@/lib/db/connection";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { fetchFilialProdutoSales, type FilialProdutoSalesRow } from "@/lib/repositories/performance";
import { fetchSalesTotals } from "@/lib/services/salesTotals";

/**
 * Monta o payload do deck "Relatório Giro de Produtos" do Gerador de Apresentações.
 *
 * TODA venda/faturamento vem das MESMAS funções canônicas ("com trocas") da página
 * Produto Giro — `fetchFilialProdutoSales` (produto×cor por período/escopo) e
 * `fetchSalesTotals` (série semanal). Nenhum SQL de venda novo é escrito (regra do
 * CLAUDE.md). A orquestração (loop de dias, buckets por filial, buckets semanais)
 * replica as rotas já validadas de `/api/produto-giro/{diario,filiais,performance}`,
 * garantindo que os números do deck batem com a tela.
 */

// Matriz fica de fora do detalhamento por loja/dia (mesma regra das rotas da Produto Giro).
const MATRIZ_FILIAIS: Record<string, string[]> = {
  scarfme: ["SCARF ME - MATRIZ"],
  nerd: ["NERD"],
};

const MESES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MS_DIA = 24 * 60 * 60 * 1000;
const MAX_DIAS = 62;
const DAY_CONCURRENCY = 6;
const MAX_PRODUTO_IDS = 1500;

export interface ProdutoGiroPresentationParams {
  company?: string;
  filial?: string | null;
  range?: { start?: string; end?: string };
  porCor?: boolean;
  /** Produtos selecionados explicitamente (picker). */
  produtoIds?: string[] | null;
  /** Filtros de escopo (aplicados sobre a base retornada, deriva os produtoIds). */
  grupos?: string[] | null;
  subgrupos?: string[] | null;
  colecoes?: string[] | null;
  grades?: string[] | null;
  search?: string | null;
  /** Título estilizado da capa (opcional). */
  coverTitle?: string;
}

export interface GiroPeriod {
  start: string;
  end: string;
  label: string;
  short: string;
  dias: number;
}
export interface GiroKpis {
  unidades: number;
  faturamento: number;
  ticket: number;
  mediaDiariaUn: number;
  coresComVenda: number;
  coresAtivas: number;
  firstHalfUn: number;
  secondHalfUn: number;
  secondHalfVsFirstPct: number | null;
  splitLabelFirst: string;
  splitLabelSecond: string;
}
export interface GiroChannel {
  hasEcommerce: boolean;
  ecomShare: number;
  retailShare: number;
  ecomVendas: number;
  retailVendas: number;
  ecomUn: number;
  retailUn: number;
  ecomUnShare: number;
}
export interface GiroDailyPoint {
  iso: string;
  label: string;
  qtde: number;
  vendas: number;
  movingAvg: number | null;
  isRecent: boolean;
}
export interface GiroDaily {
  points: GiroDailyPoint[];
  pico: { label: string; qtde: number } | null;
  virada: { label: string } | null;
  fechamento3dUn: number;
  maxQtde: number;
}
export interface GiroWeeklyPoint {
  label: string;
  vendas: number;
  qtde: number;
  partial: boolean;
  deltaPct: number | null;
  deltaBase: "cheio" | "parcial-equivalente" | null;
  dias: number;
}
export interface GiroThreeDay {
  curVendas: number;
  prevVendas: number;
  curUn: number;
  prevUn: number;
  pctVendas: number | null;
  pctUn: number | null;
  curLabel: string;
  prevLabel: string;
  dias: number;
}
export interface GiroWeekly {
  points: GiroWeeklyPoint[];
  three: GiroThreeDay | null;
}
export interface GiroColor {
  nome: string;
  qtd: number;
  venda: number;
  pct: number;
}
export interface GiroStore {
  key: string;
  label: string;
  ecommerce: boolean;
  vendas: number;
  qtde: number;
  pct: number;
}
export interface GiroHeatColor {
  nome: string;
  porDia: Record<string, number>;
  total: number;
}
export interface GiroHeat {
  colors: GiroHeatColor[];
  days: string[];
  max: number;
}
export interface GiroInsight {
  titulo: string;
  texto: string;
}
export interface ProdutoGiroPresentationPayload {
  company: string;
  porCor: boolean;
  dimensao: "cores" | "itens";
  title: string;
  subtitle: string;
  meta: { productLabel: string; filialLabel: string };
  period: GiroPeriod;
  kpis: GiroKpis;
  channel: GiroChannel;
  daily: GiroDaily;
  weekly: GiroWeekly;
  topColors: GiroColor[];
  colorMix: { segments: GiroColor[]; othersUn: number; othersPct: number; total: number };
  stores: { buckets: GiroStore[]; totalVendas: number };
  heat: GiroHeat;
  synthesis: GiroInsight[];
}

// ─── helpers ───────────────────────────────────────────────────────────────

function fmtDateShort(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${String(d).padStart(2, "0")}/${MESES_PT[(m ?? 1) - 1]}`;
}
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}
function fmtCurrency(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function fmtPct(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function normUpper(v: string | null | undefined): string {
  return (v ?? "").trim().toUpperCase();
}

/** Lista de dias 'yyyy-MM-dd' de start a end (inclusive), tetada em MAX_DIAS. */
function listDays(startYmd: string, endYmd: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const [ye, me, de] = endYmd.split("-").map(Number);
  const cur = new Date(Date.UTC(ys, ms - 1, ds, 12, 0, 0));
  const end = new Date(Date.UTC(ye, me - 1, de, 12, 0, 0));
  while (cur.getTime() <= end.getTime() && out.length < MAX_DIAS) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function segundaDaSemana(d: Date): Date {
  const diff = (d.getDay() + 6) % 7;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
}

/** Contagem de cores ativas (cadastro) dos produtos — não é SQL de venda. */
async function fetchCoresAtivas(produtoIds: string[]): Promise<number | null> {
  const ids = Array.from(new Set(produtoIds.map((p) => p.trim()).filter(Boolean)));
  if (ids.length === 0) return null;
  try {
    return await withRequest(async (request) => {
      ids.forEach((id, i) => request.input(`pc${i}`, sql.VarChar, id));
      const placeholders = ids.map((_, i) => `@pc${i}`).join(", ");
      const res = await request.query<{ N: number }>(`
        SELECT COUNT(DISTINCT LTRIM(RTRIM(ISNULL(pb.COR_PRODUTO, '')))) AS N
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO IN (${placeholders})
          AND LTRIM(RTRIM(ISNULL(pb.COR_PRODUTO, ''))) <> ''
      `);
      const n = Number(res.recordset?.[0]?.N ?? 0);
      return n > 0 ? n : null;
    });
  } catch {
    return null;
  }
}

/** Resolve os membros POS/e-commerce do escopo (mesma semântica das rotas da Produto Giro). */
function resolveScope(
  company: NonNullable<Awaited<ReturnType<typeof resolveCompanyDynamic>>>,
  companyKey: string,
  filial: string | null
): { posMembers: string[]; ecomMembers: string[]; ecommerceFilials: Set<string> } {
  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const todasFiliais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));

  let escopoFiliais: string[];
  if (!filial || filial === VAREJO_VALUE) {
    escopoFiliais = todasFiliais;
  } else {
    const filialGroups = company.filialGroups ?? {};
    escopoFiliais = filialGroups[filial] ?? [filial];
  }
  const posMembers = escopoFiliais.filter((f) => !ecommerceFilials.has(f));
  const ecomMembersAll = escopoFiliais.filter((f) => ecommerceFilials.has(f));
  const ecomMembers = filial === VAREJO_VALUE ? [] : ecomMembersAll;
  return { posMembers, ecomMembers, ecommerceFilials };
}

// ─── principal ───────────────────────────────────────────────────────────────

export async function fetchProdutoGiroPresentation(
  params: ProdutoGiroPresentationParams
): Promise<ProdutoGiroPresentationPayload> {
  const companyKey = (params.company ?? "") as CompanyKey;
  const filial = params.filial && params.filial.trim() ? params.filial.trim() : null;
  const porCor = params.porCor !== false;
  const dimensao: "cores" | "itens" = porCor ? "cores" : "itens";

  const company = await resolveCompanyDynamic(companyKey);
  if (!company) {
    throw new Error("Empresa não encontrada");
  }
  const { posMembers, ecomMembers } = resolveScope(company, companyKey, filial);
  const displayNames = company.filialDisplayNames ?? {};
  const filialGroups = company.filialGroups ?? {};

  const startStr = params.range?.start ?? "";
  const endStr = params.range?.end ?? "";
  const normalizedRange = normalizeRangeForQuery({ start: startStr, end: endStr });

  const explicitIds = (params.produtoIds ?? []).map((p) => p.trim()).filter(Boolean);
  const grupos = (params.grupos ?? []).map(normUpper).filter(Boolean);
  const subgrupos = (params.subgrupos ?? []).map(normUpper).filter(Boolean);
  const colecoes = (params.colecoes ?? []).map(normUpper).filter(Boolean);
  const grades = (params.grades ?? []).map(normUpper).filter(Boolean);
  const search = (params.search ?? "").trim().toLowerCase();

  // ── Base produto×cor do período (fonte única de KPIs / top cores / donut) ──
  const baseRaw = await fetchFilialProdutoSales(
    companyKey,
    posMembers,
    ecomMembers,
    normalizedRange,
    "month",
    {
      groupByCor: porCor,
      produtoIds: explicitIds.length > 0 ? explicitIds : null,
      includePrevious: false,
      limit: explicitIds.length > 0 ? 0 : 2000,
    }
  );

  // Aplica os filtros de escopo sobre os campos retornados (deriva o conjunto final).
  const base = baseRaw.filter((r) => {
    if (grupos.length && !grupos.includes(normUpper(r.categoria))) return false;
    if (subgrupos.length && !subgrupos.includes(normUpper(r.subgrupo))) return false;
    if (colecoes.length && !colecoes.includes(normUpper(r.colecao))) return false;
    if (grades.length && !grades.includes(normUpper(r.grade))) return false;
    if (search) {
      const hay = `${r.descricao ?? ""} ${r.produto ?? ""} ${r.codigoBarra ?? ""} ${r.corDescricao ?? ""} ${r.categoria ?? ""} ${r.subgrupo ?? ""} ${r.colecao ?? ""}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return r.vendas !== 0 || r.qtde !== 0;
  });

  const produtoIds = Array.from(new Set(base.map((r) => r.produto.trim()).filter(Boolean))).slice(
    0,
    MAX_PRODUTO_IDS
  );

  const totalVendas = base.reduce((s, r) => s + r.vendas, 0);
  const totalQtde = base.reduce((s, r) => s + r.qtde, 0);

  // ── Agregação por cor/item (top cores + donut) ──
  const colorAgg = new Map<string, { nome: string; qtd: number; venda: number }>();
  for (const r of base) {
    const nome = porCor
      ? (r.corDescricao || r.cor || "—").toString().trim().toUpperCase()
      : (r.descricao || r.produto).toString().trim();
    const cur = colorAgg.get(nome) ?? { nome, qtd: 0, venda: 0 };
    cur.qtd += r.qtde;
    cur.venda += r.vendas;
    colorAgg.set(nome, cur);
  }
  const colorsSorted = Array.from(colorAgg.values())
    .filter((c) => c.qtd !== 0 || c.venda !== 0)
    .sort((a, b) => b.qtd - a.qtd);
  const coresComVenda = colorsSorted.filter((c) => c.qtd > 0).length;

  const topColors: GiroColor[] = colorsSorted.slice(0, 8).map((c) => ({
    nome: c.nome,
    qtd: c.qtd,
    venda: c.venda,
    pct: totalQtde > 0 ? (c.qtd / totalQtde) * 100 : 0,
  }));

  const donutTop = colorsSorted.slice(0, 7);
  const donutTail = colorsSorted.slice(7);
  const othersUn = donutTail.reduce((s, c) => s + c.qtd, 0);
  const colorMix = {
    segments: donutTop.map((c) => ({
      nome: c.nome,
      qtd: c.qtd,
      venda: c.venda,
      pct: totalQtde > 0 ? (c.qtd / totalQtde) * 100 : 0,
    })),
    othersUn,
    othersPct: totalQtde > 0 ? (othersUn / totalQtde) * 100 : 0,
    total: Math.round(totalQtde),
  };

  const coresAtivas = (await fetchCoresAtivas(produtoIds)) ?? coresComVenda;

  // ── Vendas por dia (× item×cor) — ritmo diário + heatmap ──
  const diasList = startStr && endStr ? listDays(startStr, endStr) : [];

  const heatAgg = new Map<string, { nome: string; porDia: Record<string, number>; total: number }>();
  const totaisPorDia = new Map<string, { qtde: number; vendas: number }>();

  await mapWithConcurrency(diasList, DAY_CONCURRENCY, async (dia) => {
    const range = normalizeRangeForQuery({ start: dia, end: dia });
    const rows = await fetchFilialProdutoSales(companyKey, posMembers, ecomMembers, range, "month", {
      groupByCor: porCor,
      produtoIds: produtoIds.length > 0 ? produtoIds : null,
      includePrevious: false,
      limit: produtoIds.length > 0 ? 0 : 2000,
    });
    for (const r of rows) {
      // Respeita os mesmos filtros de escopo aplicados na base.
      if (grupos.length && !grupos.includes(normUpper(r.categoria))) continue;
      if (subgrupos.length && !subgrupos.includes(normUpper(r.subgrupo))) continue;
      if (colecoes.length && !colecoes.includes(normUpper(r.colecao))) continue;
      if (grades.length && !grades.includes(normUpper(r.grade))) continue;
      const qtd = Math.round(Number(r.qtde ?? 0));
      const val = Number(r.vendas ?? 0);
      const nome = porCor
        ? (r.corDescricao || r.cor || "—").toString().trim().toUpperCase()
        : (r.descricao || r.produto).toString().trim();
      const item = heatAgg.get(nome) ?? { nome, porDia: {}, total: 0 };
      item.porDia[dia] = (item.porDia[dia] ?? 0) + qtd;
      item.total += qtd;
      heatAgg.set(nome, item);
      const tot = totaisPorDia.get(dia) ?? { qtde: 0, vendas: 0 };
      tot.qtde += qtd;
      tot.vendas += val;
      totaisPorDia.set(dia, tot);
    }
  });

  const recentCut = diasList.slice(-3);
  const recentSet = new Set(recentCut);
  const dailyRaw = diasList.map((iso) => {
    const t = totaisPorDia.get(iso) ?? { qtde: 0, vendas: 0 };
    return { iso, qtde: t.qtde, vendas: t.vendas };
  });
  const dailyPoints: GiroDailyPoint[] = dailyRaw.map((d, i) => {
    const window = dailyRaw.slice(Math.max(0, i - 2), i + 1);
    const movingAvg = window.length > 0 ? window.reduce((s, w) => s + w.qtde, 0) / window.length : null;
    return {
      iso: d.iso,
      label: fmtDateShort(d.iso),
      qtde: d.qtde,
      vendas: d.vendas,
      movingAvg,
      isRecent: recentSet.has(d.iso),
    };
  });
  const maxDayQtde = Math.max(...dailyPoints.map((d) => d.qtde), 1);
  const picoPoint = dailyPoints.reduce<GiroDailyPoint | null>(
    (best, d) => (best === null || d.qtde > best.qtde ? d : best),
    null
  );
  const fechamento3dUn = dailyPoints.filter((d) => d.isRecent).reduce((s, d) => s + d.qtde, 0);

  // "Virada": dia (após o 3º) que maximiza (média dos dias seguintes) − (média dos anteriores).
  let virada: { label: string } | null = null;
  if (dailyPoints.length >= 6) {
    let bestGain = -Infinity;
    let bestIdx = -1;
    for (let i = 3; i < dailyPoints.length - 2; i++) {
      const before = dailyPoints.slice(0, i);
      const after = dailyPoints.slice(i);
      const mb = before.reduce((s, d) => s + d.qtde, 0) / (before.length || 1);
      const ma = after.reduce((s, d) => s + d.qtde, 0) / (after.length || 1);
      const gain = ma - mb;
      if (gain > bestGain) {
        bestGain = gain;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0 && bestGain > 0) virada = { label: dailyPoints[bestIdx].label };
  }

  const heatColors: GiroHeatColor[] = Array.from(heatAgg.values())
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12)
    .map((c) => ({ nome: c.nome, porDia: c.porDia, total: c.total }));
  const heatMax = Math.max(1, ...heatColors.flatMap((c) => Object.values(c.porDia)));

  // ── Aceleração 2ª metade vs 1ª (unidades) ──
  const half = Math.floor(diasList.length / 2);
  const firstHalfDays = diasList.slice(0, half);
  const secondHalfDays = diasList.slice(half);
  const sumDays = (days: string[]) =>
    days.reduce((s, d) => s + (totaisPorDia.get(d)?.qtde ?? 0), 0);
  const firstHalfUn = sumDays(firstHalfDays);
  const secondHalfUn = sumDays(secondHalfDays);
  const secondHalfVsFirstPct = firstHalfUn > 0 ? ((secondHalfUn - firstHalfUn) / firstHalfUn) * 100 : null;
  const splitLabelFirst =
    firstHalfDays.length > 0 ? `${fmtDateShort(firstHalfDays[0])}–${fmtDateShort(firstHalfDays[firstHalfDays.length - 1])}` : "";
  const splitLabelSecond =
    secondHalfDays.length > 0 ? `${fmtDateShort(secondHalfDays[0])}–${fmtDateShort(secondHalfDays[secondHalfDays.length - 1])}` : "";

  // ── Vendas por filial (buckets) + composição por canal ──
  const stores = await buildStores(companyKey, company, filial, produtoIds, normalizedRange, {
    displayNames,
    filialGroups,
  });

  const ecomBucket = stores.buckets.find((b) => b.ecommerce);
  const retailBuckets = stores.buckets.filter((b) => !b.ecommerce);
  const ecomVendas = ecomBucket?.vendas ?? 0;
  const retailVendas = retailBuckets.reduce((s, b) => s + b.vendas, 0);
  const ecomUn = ecomBucket?.qtde ?? 0;
  const retailUn = retailBuckets.reduce((s, b) => s + b.qtde, 0);
  const channelTotal = ecomVendas + retailVendas;
  const channelUnTotal = ecomUn + retailUn;
  const channel: GiroChannel = {
    hasEcommerce: ecomVendas > 0,
    ecomShare: channelTotal > 0 ? (ecomVendas / channelTotal) * 100 : 0,
    retailShare: channelTotal > 0 ? (retailVendas / channelTotal) * 100 : 0,
    ecomVendas,
    retailVendas,
    ecomUn,
    retailUn,
    ecomUnShare: channelUnTotal > 0 ? (ecomUn / channelUnTotal) * 100 : 0,
  };

  // ── Série semanal + salto dos últimos 3 dias (now-relative, como a Produto Giro) ──
  const weekly = await buildWeekly(companyKey, filial, produtoIds);

  // ── KPIs ──
  const dias22 = diasList.length || 1;
  const unidades = Math.round(totalQtde);
  const ticket = totalQtde > 0 ? totalVendas / totalQtde : 0;
  const kpis: GiroKpis = {
    unidades,
    faturamento: totalVendas,
    ticket,
    mediaDiariaUn: unidades / dias22,
    coresComVenda,
    coresAtivas,
    firstHalfUn,
    secondHalfUn,
    secondHalfVsFirstPct,
    splitLabelFirst,
    splitLabelSecond,
  };

  // ── Rótulos / período ──
  const year = endStr ? new Date(`${endStr}T00:00:00`).getFullYear() : new Date().getFullYear();
  const period: GiroPeriod = {
    start: startStr,
    end: endStr,
    label: startStr && endStr ? `${fmtDateShort(startStr)} a ${fmtDateShort(endStr)} de ${year}` : "",
    short: startStr && endStr ? `${fmtDateShort(startStr)}–${fmtDateShort(endStr)}/${year}` : "",
    dias: dias22,
  };

  const productLabel = buildProductLabel(base, params.coverTitle);
  const filialLabel = filial && filial !== VAREJO_VALUE ? displayNames[filial] ?? filial : filial === VAREJO_VALUE ? "Lojas físicas" : "Rede (todas as filiais)";
  const title = (params.coverTitle?.trim() || productLabel || "Produtos").trim();

  const synthesis = buildSynthesis({
    kpis,
    channel,
    daily: { fechamento3dUn },
    weekly,
    topColors,
    dimensao,
  });

  return {
    company: companyKey,
    porCor,
    dimensao,
    title,
    subtitle: `Ritmo de vendas, aceleração recente e desempenho por ${porCor ? "cor" : "produto"}.`,
    meta: { productLabel, filialLabel },
    period,
    kpis,
    channel,
    daily: {
      points: dailyPoints,
      pico: picoPoint ? { label: picoPoint.label, qtde: picoPoint.qtde } : null,
      virada,
      fechamento3dUn,
      maxQtde: maxDayQtde,
    },
    weekly,
    topColors,
    colorMix,
    stores,
    heat: { colors: heatColors, days: diasList, max: heatMax },
    synthesis,
  };
}

// ─── vendas por filial (buckets) ──────────────────────────────────────────────

async function buildStores(
  companyKey: CompanyKey,
  company: NonNullable<Awaited<ReturnType<typeof resolveCompanyDynamic>>>,
  filial: string | null,
  produtoIds: string[],
  normalizedRange: ReturnType<typeof normalizeRangeForQuery>,
  cfg: { displayNames: Record<string, string>; filialGroups: Record<string, string[]> }
): Promise<{ buckets: GiroStore[]; totalVendas: number }> {
  const ecommerceFilials = new Set(company.ecommerceFilials ?? []);
  const matrizSet = new Set(MATRIZ_FILIAIS[companyKey] ?? []);
  const todasFiliais = (company.filialFilters.sales ?? []).filter((f) => !matrizSet.has(f));
  const { displayNames, filialGroups } = cfg;

  let universo = todasFiliais;
  if (filial && filial !== VAREJO_VALUE) {
    const members = filialGroups[filial] ?? [filial];
    universo = todasFiliais.filter((f) => members.includes(f));
  } else if (filial === VAREJO_VALUE) {
    universo = todasFiliais.filter((f) => !ecommerceFilials.has(f));
  }

  const memberToCanonical = new Map<string, string>();
  for (const [canon, members] of Object.entries(filialGroups)) {
    for (const m of members) memberToCanonical.set(m, canon);
  }
  const posUniverso = universo.filter((f) => !ecommerceFilials.has(f));
  const ecomUniverso = universo.filter((f) => ecommerceFilials.has(f));

  type Bucket = { key: string; label: string; ecommerce: boolean; posMembers: string[]; ecomMembers: string[] };
  const posBuckets = new Map<string, Bucket>();
  for (const f of posUniverso) {
    const canon = memberToCanonical.get(f) ?? f;
    let b = posBuckets.get(canon);
    if (!b) {
      b = { key: canon, label: displayNames[canon] ?? canon, ecommerce: false, posMembers: [], ecomMembers: [] };
      posBuckets.set(canon, b);
    }
    b.posMembers.push(f);
  }
  const buckets: Bucket[] = Array.from(posBuckets.values());
  if (ecomUniverso.length > 0) {
    buckets.push({ key: "__ecommerce__", label: "E-commerce", ecommerce: true, posMembers: [], ecomMembers: ecomUniverso });
  }

  const raw = await mapWithConcurrency(buckets, DAY_CONCURRENCY, async (b) => {
    const rows = await fetchFilialProdutoSales(companyKey, b.posMembers, b.ecomMembers, normalizedRange, "month", {
      groupByCor: false,
      produtoIds: produtoIds.length > 0 ? produtoIds : null,
      includePrevious: false,
      limit: 0,
    });
    let vendas = 0;
    let qtde = 0;
    for (const r of rows) {
      vendas += Number(r.vendas ?? 0);
      qtde += Number(r.qtde ?? 0);
    }
    return { key: b.key, label: b.label, ecommerce: b.ecommerce, vendas, qtde: Math.round(qtde) };
  });

  const totalVendasExato = raw.reduce((s, b) => s + b.vendas, 0);
  const outBuckets: GiroStore[] = raw
    .filter((b) => Math.round(b.vendas) !== 0 || b.qtde !== 0)
    .map((b) => ({
      key: b.key,
      label: b.label,
      ecommerce: b.ecommerce,
      vendas: b.vendas,
      qtde: b.qtde,
      pct: totalVendasExato > 0 ? (b.vendas / totalVendasExato) * 100 : 0,
    }))
    .sort((a, b) => b.vendas - a.vendas);

  return { buckets: outBuckets, totalVendas: totalVendasExato };
}

// ─── série semanal + salto 3 dias (now-relative) ─────────────────────────────

async function buildWeekly(
  companyKey: CompanyKey,
  filial: string | null,
  produtoIds: string[]
): Promise<GiroWeekly> {
  const now = new Date();
  const hoje = inicioDoDia(now);
  const COUNT = 8;
  const semanaAtual = segundaDaSemana(now);

  interface WBucket {
    label: string;
    start: Date;
    endInclusive: Date;
    endEffective: Date;
    dias: number;
    partial: boolean;
  }
  const buckets: WBucket[] = [];
  for (let i = COUNT - 1; i >= 0; i--) {
    const start = new Date(semanaAtual.getFullYear(), semanaAtual.getMonth(), semanaAtual.getDate() - i * 7);
    const endInclusive = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    const partial = i === 0;
    const endEffective = partial ? hoje : endInclusive;
    const dias = Math.max(1, Math.round((inicioDoDia(endEffective).getTime() - start.getTime()) / MS_DIA) + 1);
    buckets.push({
      label: `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`,
      start,
      endInclusive,
      endEffective,
      dias,
      partial,
    });
  }

  const idsOrNull = produtoIds.length > 0 ? produtoIds : null;
  const somaVendas = async (start: Date, endInclusive: Date) => {
    const range = normalizeRangeForQuery({ start, end: endInclusive });
    const totals = await fetchSalesTotals({
      company: companyKey,
      range,
      filial,
      comparisonMode: "month",
      produtoIds: idsOrNull,
    });
    return { vendas: Math.round(totals.vendas), qtde: Math.round(totals.qtde) };
  };

  const bases = await Promise.all(buckets.map(async (b) => ({ b, ...(await somaVendas(b.start, b.endEffective)) })));

  const points: GiroWeeklyPoint[] = [];
  let three: GiroThreeDay | null = null;

  for (let idx = 0; idx < bases.length; idx++) {
    const cur = bases[idx];
    const prev = bases[idx - 1];
    let deltaPct: number | null = null;
    let deltaBase: "cheio" | "parcial-equivalente" | null = null;

    if (prev) {
      if (cur.b.partial) {
        const prevStart = prev.b.start;
        const prevEndEquivalente = new Date(
          prevStart.getFullYear(),
          prevStart.getMonth(),
          prevStart.getDate() + (cur.b.dias - 1)
        );
        const prevEq = await somaVendas(prevStart, prevEndEquivalente);
        deltaBase = "parcial-equivalente";
        if (prevEq.vendas > 0) deltaPct = ((cur.vendas - prevEq.vendas) / prevEq.vendas) * 100;
        three = {
          curVendas: cur.vendas,
          prevVendas: prevEq.vendas,
          curUn: cur.qtde,
          prevUn: prevEq.qtde,
          pctVendas: prevEq.vendas > 0 ? ((cur.vendas - prevEq.vendas) / prevEq.vendas) * 100 : null,
          pctUn: prevEq.qtde > 0 ? ((cur.qtde - prevEq.qtde) / prevEq.qtde) * 100 : null,
          curLabel: `${String(cur.b.start.getDate()).padStart(2, "0")}/${String(cur.b.start.getMonth() + 1).padStart(2, "0")}–${String(cur.b.endEffective.getDate()).padStart(2, "0")}/${String(cur.b.endEffective.getMonth() + 1).padStart(2, "0")}`,
          prevLabel: `${String(prevStart.getDate()).padStart(2, "0")}/${String(prevStart.getMonth() + 1).padStart(2, "0")}–${String(prevEndEquivalente.getDate()).padStart(2, "0")}/${String(prevEndEquivalente.getMonth() + 1).padStart(2, "0")}`,
          dias: cur.b.dias,
        };
      } else {
        deltaBase = "cheio";
        if (prev.vendas > 0) deltaPct = ((cur.vendas - prev.vendas) / prev.vendas) * 100;
      }
    }

    points.push({
      label: cur.b.label,
      vendas: cur.vendas,
      qtde: cur.qtde,
      partial: cur.b.partial,
      deltaPct,
      deltaBase,
      dias: cur.b.dias,
    });
  }

  return { points, three };
}

// ─── narrativas ───────────────────────────────────────────────────────────────

function buildProductLabel(base: FilialProdutoSalesRow[], coverTitle?: string): string {
  if (coverTitle?.trim()) return coverTitle.trim();
  const nomes = Array.from(new Set(base.map((r) => (r.descricao || r.produto).trim()).filter(Boolean)));
  if (nomes.length === 0) return "Produtos";
  if (nomes.length === 1) return nomes[0];
  if (nomes.length <= 3) return nomes.join(" · ");
  return `${nomes.slice(0, 2).join(" · ")} +${nomes.length - 2}`;
}

function buildSynthesis(input: {
  kpis: GiroKpis;
  channel: GiroChannel;
  daily: { fechamento3dUn: number };
  weekly: GiroWeekly;
  topColors: GiroColor[];
  dimensao: "cores" | "itens";
}): GiroInsight[] {
  const { kpis, channel, daily, weekly, topColors, dimensao } = input;
  const dimLabel = dimensao === "cores" ? "cores" : "itens";
  const out: GiroInsight[] = [];

  if (kpis.secondHalfVsFirstPct != null) {
    out.push({
      titulo: "↗ ACELERAÇÃO",
      texto:
        `A segunda metade do período vendeu ${kpis.secondHalfVsFirstPct >= 0 ? "+" : ""}${fmtPct(kpis.secondHalfVsFirstPct)} ` +
        `em unidades frente à primeira (${fmtInt(kpis.secondHalfUn)} vs ${fmtInt(kpis.firstHalfUn)} un).`,
    });
  }

  const top3 = topColors.slice(0, 3);
  if (top3.length > 0) {
    const top3Share = top3.reduce((s, c) => s + c.pct, 0);
    out.push({
      titulo: "🎯 CONCENTRAÇÃO",
      texto:
        `${top3.map((c) => c.nome).join(", ")} respondem por ${fmtPct(top3Share)} do volume. ` +
        `São os ${dimLabel} a proteger de ruptura.`,
    });
  }

  if (weekly.three && weekly.three.pctVendas != null) {
    out.push({
      titulo: "🔥 ÚLTIMOS DIAS",
      texto:
        `Os ${weekly.three.dias} dias finais somaram ${fmtInt(daily.fechamento3dUn)} un e a parcial ` +
        `semanal ${weekly.three.pctVendas >= 0 ? "cresceu" : "caiu"} ${weekly.three.pctVendas >= 0 ? "+" : ""}${fmtPct(weekly.three.pctVendas)} ` +
        `contra os mesmos dias da semana anterior.`,
    });
  }

  if (channel.hasEcommerce) {
    out.push({
      titulo: "🛒 CANAL",
      texto:
        `E-commerce responde por ${fmtPct(channel.ecomShare)} do faturamento ` +
        `(${fmtCurrency(channel.ecomVendas)}) e ${fmtPct(channel.ecomUnShare)} das unidades.`,
    });
  } else {
    out.push({
      titulo: "🏬 LOJAS FÍSICAS",
      texto: `Todo o faturamento (${fmtCurrency(channel.retailVendas)}) saiu das lojas físicas no período.`,
    });
  }

  return out.slice(0, 4);
}

import {
  fetchCollectionReport,
  fetchCollectionComparativeExtras,
} from "@/lib/repositories/collectionReport";
import { fetchProdutosCustoPrecoMestre } from "@/lib/repositories/products";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { paletteForIndex, type CollectionPalette } from "@/lib/presentations/palettes";

/**
 * Dados do "Relatório Comparativo entre Coleções". Uma entrada por coleção +
 * totais da rede. Reaproveita fontes já provadas:
 *  - `fetchCollectionReport`  → venda líquida, peças, qtd por SKU (base de custo).
 *  - `fetchCollectionComparativeExtras` → série mensal + desconto (canal físico).
 *  - `fetchSalesTotals`       → tickets (contagem de transações).
 *  - `fetchProdutosCustoPrecoMestre` → custo (CUSTO_REPOSICAO1) p/ markup e margem.
 * As paletas por coleção vêm de `paletteForIndex` (distintas até 12, depois ciclam).
 */

export interface ComparativoKpi {
  big: string;
  lbl: string;
  sub: string;
  /** Usa a cor de accent (destaque) no sub. */
  accentSub: boolean;
}

export interface ComparativoMonthPoint {
  label: string;
  val: number;
  disp: string;
}

export type Veredito = "RENOVAR" | "REAVALIAR" | "ENCERRAR";

export interface ComparativoColecaoSlide {
  key: string;
  code: string;
  title: string;
  palette: CollectionPalette;
  eyebrow: string;
  page: string;
  subtitle: Array<{ text: string; bold?: boolean }>;
  kpis: ComparativoKpi[];
  chartTitle: string;
  maxV: number;
  months: ComparativoMonthPoint[];
  growthBig: string;
  growthText: string;
  hiLabel: string;
  hiValue: string;
  footer: string;
  // métricas cruas p/ o slide de decisão
  vlTotal: number;
  margemAbs: number;
  mesesAtivos: number;
  vlPorMes: number;
  veredito: Veredito;
}

export interface ComparativoColecoesPayload {
  period: { start: string; end: string; label: string; statLabel: string };
  totals: {
    vendaLiquida: number;
    margemBruta: number;
    colecoes: number;
  };
  slides: ComparativoColecaoSlide[];
}

export interface ComparativoColecoesParams {
  company?: string;
  filial?: string | null;
  range?: { start?: string; end?: string };
  /** Lista de coleções: { code, label } (label = descrição para o título). */
  colecoes: Array<{ code: string; label?: string }>;
}

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function brl0(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function brlCompact(v: number): string {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} mi`;
  if (abs >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")} mil`;
  return brl0(v);
}
function chartDisp(v: number): string {
  if (v >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")}k`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}
function pct1(v: number): string {
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}
function intBR(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}

/** Executa `worker` sobre `items` com concorrência limitada (evita saturar o proxy). */
async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return out;
}

function vereditoFor(vlPorMes: number): Veredito {
  if (vlPorMes >= 60_000) return "RENOVAR";
  if (vlPorMes >= 35_000) return "REAVALIAR";
  return "ENCERRAR";
}

function buildMonths(monthly: Array<{ year: number; month: number; revenue: number }>): ComparativoMonthPoint[] {
  return monthly.map((m) => ({
    label: MESES_CURTOS[m.month - 1] ?? String(m.month),
    val: Math.max(0, m.revenue),
    disp: chartDisp(Math.max(0, m.revenue)),
  }));
}

async function buildOneCollection(
  params: ComparativoColecoesParams,
  col: { code: string; label?: string },
  index: number
): Promise<ComparativoColecaoSlide> {
  const { company, filial, range } = params;
  const palette = paletteForIndex(index);
  const norm = normalizeRangeForQuery({ start: range?.start, end: range?.end });

  const [report, extras, totals] = await Promise.all([
    fetchCollectionReport({ company, filial, range, colecoes: [col.code] }),
    fetchCollectionComparativeExtras({ company, filial, range, colecoes: [col.code] }),
    fetchSalesTotals({
      company,
      range: norm,
      filial: filial ?? null,
      colecoes: [col.code],
    }),
  ]);

  const vl = report.summary.totalRevenue;
  const qtde = report.summary.totalQuantity;
  const tickets = totals.tickets;
  const ticketMedio = tickets > 0 ? vl / tickets : 0;

  // Custo (base de markup e margem): qtd por produto × CUSTO_REPOSICAO1.
  const qtyByProduct = new Map<string, number>();
  for (const p of report.products) {
    for (const d of p.details) {
      const pid = d.productId.trim();
      if (pid) qtyByProduct.set(pid, (qtyByProduct.get(pid) ?? 0) + d.quantity);
    }
  }
  const custoMap = await fetchProdutosCustoPrecoMestre(Array.from(qtyByProduct.keys()));
  let cost = 0;
  for (const [pid, qty] of qtyByProduct) {
    const c = custoMap.get(pid)?.custo ?? 0;
    cost += c * qty;
  }
  const markup = cost > 0 ? vl / cost : 0;
  const margemAbs = cost > 0 ? vl - cost : vl;

  // Desconto (canal físico).
  const descontoPct = extras.grossSales > 0 ? (extras.discountSales / extras.grossSales) * 100 : 0;

  // Série mensal escalada para casar com a VL canônica (a série usa a mesma
  // fórmula/fonte, então o ajuste é mínimo — só garante soma == VL do KPI).
  const rawMonths = buildMonths(extras.monthly);
  const rawSum = rawMonths.reduce((s, m) => s + m.val, 0);
  const scale = rawSum > 0 ? vl / rawSum : 1;
  const months = rawMonths.map((m) => ({ ...m, val: m.val * scale, disp: chartDisp(m.val * scale) }));
  const mesesAtivos = months.filter((m) => m.val > 0).length || 1;
  const vlPorMes = vl / mesesAtivos;

  const maxV = Math.max(...months.map((m) => m.val), 1) * 1.08;

  // Pico + crescimento (do primeiro mês ativo ao pico).
  let peakIdx = 0;
  months.forEach((m, i) => {
    if (m.val > months[peakIdx].val) peakIdx = i;
  });
  const firstActiveIdx = months.findIndex((m) => m.val > 0);
  const firstVal = firstActiveIdx >= 0 ? months[firstActiveIdx].val : 0;
  const peakVal = months[peakIdx]?.val ?? 0;
  const growthNum = firstVal > 0 && peakIdx !== firstActiveIdx ? ((peakVal - firstVal) / firstVal) * 100 : 0;
  const growthBig = growthNum !== 0 ? `${growthNum > 0 ? "+" : "−"}${Math.abs(Math.round(growthNum))}%` : "estável";
  const peakMonthName = extras.monthly[peakIdx] ? MESES_LONGOS[extras.monthly[peakIdx].month - 1] : "";
  const isWeekly = months.length <= 1;
  const chartTitle = isWeekly ? "VENDA LÍQUIDA NO PERÍODO" : "EVOLUÇÃO MENSAL · VENDA LÍQUIDA";
  const growthText =
    growthNum > 0
      ? `de crescimento até o pico em ${peakMonthName || "seu melhor mês"}. ${
          peakVal > 0 && vl > 0 ? `O mês de pico concentrou ${Math.round((peakVal / vl) * 100)}% da venda líquida.` : ""
        }`
      : growthNum < 0
        ? `de variação da abertura ao pico — coleção com curva concentrada no início do período.`
        : `Curva estável ao longo do período analisado.`;

  const name = col.label?.trim() || col.code;
  const detectedStart = report.summary.detectedStartDate?.slice(0, 10) ?? range?.start ?? "";
  const detectedEnd = report.summary.detectedEndDate?.slice(0, 10) ?? range?.end ?? "";
  const fmtDMY = (iso: string) => {
    if (!iso) return "";
    const d = new Date(`${iso}T00:00:00`);
    return `${String(d.getDate()).padStart(2, "0")} ${MESES_CURTOS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
  };

  const pageNum = String(index + 1).padStart(2, "0");

  return {
    key: col.code,
    code: col.code,
    title: name,
    palette,
    eyebrow: `${pageNum} · PANORAMA GERAL`,
    page: pageNum,
    subtitle: [
      { text: "A coleção " },
      { text: name, bold: true },
      { text: " gerou " },
      { text: brl0(vl), bold: true },
      { text: ` em venda líquida sobre ${intBR(tickets)} tickets no período, com ` },
      { text: `${intBR(qtde)} peças`, bold: true },
      { text: " vendidas." },
    ],
    kpis: [
      { big: brl0(vl), lbl: "VENDA LÍQUIDA", sub: `${intBR(qtde)} peças vendidas`, accentSub: true },
      { big: brl0(ticketMedio), lbl: "TICKET MÉDIO", sub: `${intBR(tickets)} tickets no período`, accentSub: false },
      { big: markup > 0 ? `${markup.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}×` : "—", lbl: "MARKUP MÉDIO", sub: "margem premium", accentSub: false },
      { big: pct1(descontoPct), lbl: "DESCONTO MÉDIO", sub: `${brl0(extras.discountSales)} concedidos`, accentSub: true },
    ],
    chartTitle,
    maxV,
    months,
    growthBig,
    growthText,
    hiLabel: isWeekly ? "PERÍODO" : "MÊS DE PICO",
    hiValue: isWeekly
      ? `${brl0(vl)}`
      : `${peakMonthName || "—"} · ${brl0(peakVal)}`,
    footer: `SCARF·ME  ·  COLEÇÃO ${name.toUpperCase()}  ·  ${fmtDMY(detectedStart)} — ${fmtDMY(detectedEnd)}`,
    vlTotal: vl,
    margemAbs,
    mesesAtivos,
    vlPorMes,
    veredito: vereditoFor(vlPorMes),
  };
}

export async function fetchComparativoColecoes(
  params: ComparativoColecoesParams
): Promise<ComparativoColecoesPayload> {
  const { company, range, colecoes } = params;
  if (company !== "scarfme" || colecoes.length === 0) {
    return {
      period: { start: range?.start ?? "", end: range?.end ?? "", label: "", statLabel: "" },
      totals: { vendaLiquida: 0, margemBruta: 0, colecoes: 0 },
      slides: [],
    };
  }

  // Constrói cada coleção (ordem provisória = ordem recebida) com concorrência
  // limitada, depois ordena por VL desc e re-atribui paleta/página/eyebrow —
  // assim a paleta segue a posição final e fica distinta até 12.
  const built = await mapPool(colecoes, 4, (col, i) => buildOneCollection(params, col, i));
  const sorted = [...built].sort((a, b) => b.vlTotal - a.vlTotal);
  const slides = sorted.map((slide, i) => {
    const palette = paletteForIndex(i);
    const pageNum = String(i + 1).padStart(2, "0");
    return { ...slide, palette, page: pageNum, eyebrow: `${pageNum} · PANORAMA GERAL` };
  });

  const vendaLiquida = slides.reduce((s, c) => s + c.vlTotal, 0);
  const margemBruta = slides.reduce((s, c) => s + c.margemAbs, 0);

  const startIso = range?.start ?? "";
  const endIso = range?.end ?? "";
  const startD = startIso ? new Date(`${startIso}T00:00:00`) : null;
  const endD = endIso ? new Date(`${endIso}T00:00:00`) : null;
  const year = endD?.getFullYear() ?? new Date().getFullYear();
  const label =
    startD && endD
      ? `${MESES_LONGOS[startD.getMonth()]} — ${MESES_LONGOS[endD.getMonth()]} ${year}`
      : "";
  const statLabel =
    startD && endD
      ? `${MESES_CURTOS[startD.getMonth()].toUpperCase()} — ${MESES_CURTOS[endD.getMonth()].toUpperCase()} ${year}`
      : "";

  return {
    period: { start: startIso, end: endIso, label, statLabel },
    totals: { vendaLiquida, margemBruta, colecoes: slides.length },
    slides,
  };
}

export { brlCompact };

import sql from "mssql";

import { withRequest } from "@/lib/db/connection";
import {
  fetchCollectionReport,
  fetchCollectionComparativeExtras,
} from "@/lib/repositories/collectionReport";
import { paletteForIndex, type CollectionPalette } from "@/lib/presentations/palettes";

/**
 * Dados do "Comparativo Resumido entre Coleções" — versão enxuta do comparativo
 * completo. UMA carta compacta por coleção (não um slide inteiro), com só três
 * números + a série mensal:
 *  - Venda líquida e quantidade vendida  → `fetchCollectionReport` (fonte global).
 *  - Peças (SKUs) = produto × cor CADASTRADOS no catálogo (PRODUTOS_BARRA),
 *    mesma métrica/decisão do Painel de Coleções (independe de período/filial).
 *  - Evolução mensal da venda líquida     → `fetchCollectionComparativeExtras`.
 * Paletas por posição via `paletteForIndex` (distintas até 12, depois ciclam).
 */

export interface ResumoMonthPoint {
  label: string;
  val: number;
  disp: string;
}

export interface ResumoColecaoCard {
  key: string;
  code: string;
  title: string;
  palette: CollectionPalette;
  vl: number;
  qtde: number;
  skus: number;
  months: ResumoMonthPoint[];
  maxV: number;
}

export interface ComparativoResumidoPayload {
  period: { start: string; end: string; label: string; statLabel: string };
  totals: { vendaLiquida: number; qtde: number; skus: number; colecoes: number };
  cards: ResumoColecaoCard[];
}

export interface ComparativoResumidoParams {
  company?: string;
  filial?: string | null;
  range?: { start?: string; end?: string };
  colecoes: Array<{ code: string; label?: string }>;
}

const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MESES_LONGOS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function chartDisp(v: number): string {
  if (v >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString("pt-BR")}k`;
  return `R$ ${Math.round(v).toLocaleString("pt-BR")}`;
}

/** Executa `worker` com concorrência limitada (evita saturar o proxy do banco). */
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

/**
 * Peças (SKUs) CADASTRADAS por código — métrica de CATÁLOGO (PRODUTOS_BARRA join
 * PRODUTOS.COLECAO). Cor canônica via TRY_CONVERT(INT) colapsa '06' == '6' para
 * não contar a mesma variação duas vezes. Espelha o Painel de Coleções.
 */
async function fetchSkusCadastradosPorCodigo(codes: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const normalized = Array.from(new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean)));
  if (normalized.length === 0) return out;

  return withRequest(async (req) => {
    normalized.forEach((code, idx) => req.input(`col${idx}`, sql.VarChar, code));
    const placeholders = normalized.map((_, idx) => `@col${idx}`).join(", ");

    const corCanonica = `
      CASE
        WHEN TRY_CONVERT(INT, LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))) IS NOT NULL
          THEN CAST(TRY_CONVERT(INT, LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20))))) AS VARCHAR(20))
        ELSE UPPER(LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))))
      END`;

    const result = await req.query<{ colecao: string; skus: number }>(
      `SELECT
         UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao,
         COUNT(DISTINCT
           LTRIM(RTRIM(CAST(pb.PRODUTO AS VARCHAR(60)))) + '|' + ${corCanonica}
         ) AS skus
       FROM PRODUTOS_BARRA pb WITH (NOLOCK)
       INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
       WHERE UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})
         AND pb.COR_PRODUTO IS NOT NULL
         AND LTRIM(RTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) <> ''
       GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, ''))))`
    );

    for (const row of result.recordset) {
      out.set((row.colecao ?? "").trim().toUpperCase(), Number(row.skus ?? 0));
    }
    return out;
  }).catch(() => out);
}

async function buildOneCard(
  params: ComparativoResumidoParams,
  col: { code: string; label?: string },
  skus: number
): Promise<Omit<ResumoColecaoCard, "palette">> {
  const { company, filial, range } = params;

  const [report, extras] = await Promise.all([
    fetchCollectionReport({ company, filial, range, colecoes: [col.code] }),
    fetchCollectionComparativeExtras({ company, filial, range, colecoes: [col.code] }),
  ]);

  const vl = report.summary.totalRevenue;
  const qtde = report.summary.totalQuantity;

  // Série mensal escalada para casar com a VL canônica (mesma técnica do
  // comparativo completo — a soma dos meses passa a bater com o KPI de VL).
  const rawMonths = extras.monthly.map((m) => ({
    label: MESES_CURTOS[m.month - 1] ?? String(m.month),
    val: Math.max(0, m.revenue),
  }));
  const rawSum = rawMonths.reduce((s, m) => s + m.val, 0);
  const scale = rawSum > 0 ? vl / rawSum : 1;
  const months: ResumoMonthPoint[] = rawMonths.map((m) => ({
    label: m.label,
    val: m.val * scale,
    disp: chartDisp(m.val * scale),
  }));
  const maxV = Math.max(...months.map((m) => m.val), 1) * 1.08;

  const title = col.label?.trim() || col.code;

  return {
    key: col.code,
    code: col.code,
    title,
    vl,
    qtde,
    skus,
    months,
    maxV,
  };
}

export async function fetchComparativoResumido(
  params: ComparativoResumidoParams
): Promise<ComparativoResumidoPayload> {
  const { company, range, colecoes } = params;

  if (company !== "scarfme" || colecoes.length === 0) {
    return {
      period: { start: range?.start ?? "", end: range?.end ?? "", label: "", statLabel: "" },
      totals: { vendaLiquida: 0, qtde: 0, skus: 0, colecoes: 0 },
      cards: [],
    };
  }

  const skusByCode = await fetchSkusCadastradosPorCodigo(colecoes.map((c) => c.code));

  const built = await mapPool(colecoes, 4, (col) =>
    buildOneCard(params, col, skusByCode.get(col.code.trim().toUpperCase()) ?? 0)
  );

  // Ordena por venda líquida desc e atribui paleta pela posição final.
  const cards: ResumoColecaoCard[] = [...built]
    .sort((a, b) => b.vl - a.vl)
    .map((card, i) => ({ ...card, palette: paletteForIndex(i) }));

  const vendaLiquida = cards.reduce((s, c) => s + c.vl, 0);
  const qtde = cards.reduce((s, c) => s + c.qtde, 0);
  const skus = cards.reduce((s, c) => s + c.skus, 0);

  const startIso = range?.start ?? "";
  const endIso = range?.end ?? "";
  const startD = startIso ? new Date(`${startIso}T00:00:00`) : null;
  const endD = endIso ? new Date(`${endIso}T00:00:00`) : null;
  const year = endD?.getFullYear() ?? new Date().getFullYear();
  const label =
    startD && endD ? `${MESES_LONGOS[startD.getMonth()]} — ${MESES_LONGOS[endD.getMonth()]} ${year}` : "";
  const statLabel =
    startD && endD
      ? `${MESES_CURTOS[startD.getMonth()].toUpperCase()} — ${MESES_CURTOS[endD.getMonth()].toUpperCase()} ${year}`
      : "";

  return {
    period: { start: startIso, end: endIso, label, statLabel },
    totals: { vendaLiquida, qtde, skus, colecoes: cards.length },
    cards,
  };
}

/**
 * Export "Controle Performance" para XLSX (client-side) com múltiplas abas.
 *
 * Abas:
 * - "Resumo": KPIs por filial + %/Δ das categorias (linhas/grupos)
 * - "Produtos (Geral)": lista de produtos com coluna Filial (para filtros no Excel)
 * - Uma aba por filial: KPIs, categorias e produtos
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - xlsx tipos incompletos
import * as XLSX from "xlsx";
import { formatDateForQuery } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

type ComparisonMode = "month" | "year";

interface SummaryCategoryData {
  pct: number;
  deltaPct: number | null;
}

interface SummaryFilialRow {
  filial: string;
  displayName: string;
  meta: number;
  vendas: number;
  vendasPrevious: number;
  qtde: number;
  projecao: number;
  projecaoPct: number | null;
  categories: Record<string, SummaryCategoryData>;
}

interface ControlePerformanceSummaryResponse {
  filiais: SummaryFilialRow[];
  categories: string[];
  range?: { start: string; end: string };
}

interface ProdutoRow {
  produto: string;
  descricao: string;
  categoria: string;
  grade?: string;
  vendas: number;
  qtde: number;
  custo: number;
  vendasPrevious: number;
}

interface FilialResponse {
  filial: string;
  displayName: string;
  vendas: number;
  vendasPrevious: number;
  qtde: number;
  meta: number;
  projecao: number;
  projecaoPct: number | null;
  categories: Record<string, { pct: number; deltaPct: number | null }>;
  categoryList: string[];
  range?: { start: string; end: string };
  produtos: ProdutoRow[];
}

interface ProdutoVendedorRow {
  vendedor: string;
  produto: string;
  descricao: string;
  categoria: string;
  grade: string;
  vendas: number;
  qtde: number;
  vendasPrevious: number;
}

export interface ExportControlePerformanceXlsxOptions {
  companyKey: CompanyKey;
  range: { startDate: Date; endDate: Date };
  comparisonMode: ComparisonMode;
}

function autoWidth(ws: XLSX.WorkSheet): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      const len = cell ? String(cell.v ?? "").length : 0;
      colWidths[C] = Math.min(Math.max(colWidths[C] ?? 10, len + 2), 60);
    }
  }
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
}

function safeSheetName(name: string): string {
  const cleaned = name
    .replace(/[\[\]\*\?\/\\:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "Filial").slice(0, 31);
}

function pctDelta(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function buildProdutoVendedorIndex(rows: ProdutoVendedorRow[]): Map<string, Map<string, { vendas: number; qtde: number }>> {
  const map = new Map<string, Map<string, { vendas: number; qtde: number }>>();
  rows.forEach((r) => {
    const key = `${r.produto}||${r.categoria ?? ""}||${r.grade ?? ""}`;
    if (!map.has(key)) map.set(key, new Map());
    const byVend = map.get(key)!;
    const vend = (r.vendedor || "SEM VENDEDOR").trim() || "SEM VENDEDOR";
    const agg = byVend.get(vend) ?? { vendas: 0, qtde: 0 };
    agg.vendas += r.vendas ?? 0;
    agg.qtde += r.qtde ?? 0;
    byVend.set(vend, agg);
  });
  return map;
}

function getVendedorResumo(
  byVendedor: Map<string, { vendas: number; qtde: number }> | undefined,
  totalVendas: number,
  topN: number = 3
): { vendedorPrincipal: string; vendedorPrincipalPct: number | "" } {
  if (!byVendedor || byVendedor.size === 0) {
    return { vendedorPrincipal: "", vendedorPrincipalPct: "" };
  }
  const entries = Array.from(byVendedor.entries())
    .map(([vendedor, agg]) => ({ vendedor, vendas: agg.vendas, qtde: agg.qtde }))
    .sort((a, b) => b.vendas - a.vendas);
  const top = entries[0];
  const pct = totalVendas > 0 ? (top.vendas / totalVendas) * 100 : 0;
  return {
    vendedorPrincipal: top.vendedor,
    vendedorPrincipalPct: totalVendas > 0 ? Number(pct.toFixed(1)) : "",
  };
}

async function fetchSummary(options: ExportControlePerformanceXlsxOptions): Promise<ControlePerformanceSummaryResponse> {
  const params = new URLSearchParams({
    company: options.companyKey,
    month: String(options.range.startDate.getMonth()),
    year: String(options.range.startDate.getFullYear()),
    start: formatDateForQuery(options.range.startDate),
    end: formatDateForQuery(options.range.endDate),
    compare: options.comparisonMode,
  });
  const res = await fetch(`/api/controle-performance?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error("Falha ao buscar dados do controle-performance");
  return (await res.json()) as ControlePerformanceSummaryResponse;
}

async function fetchFilial(
  companyKey: CompanyKey,
  filial: string,
  range: { startDate: Date; endDate: Date },
  comparisonMode: ComparisonMode
): Promise<FilialResponse> {
  const params = new URLSearchParams({
    company: companyKey,
    filial,
    month: String(range.startDate.getMonth()),
    year: String(range.startDate.getFullYear()),
    start: formatDateForQuery(range.startDate),
    end: formatDateForQuery(range.endDate),
    compare: comparisonMode,
  });
  const res = await fetch(`/api/controle-performance/filial?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Falha ao buscar dados da filial: ${filial}`);
  return (await res.json()) as FilialResponse;
}

async function fetchFilialProdutosVendedores(
  companyKey: CompanyKey,
  filial: string,
  range: { startDate: Date; endDate: Date },
  comparisonMode: ComparisonMode
): Promise<ProdutoVendedorRow[]> {
  const params = new URLSearchParams({
    company: companyKey,
    filial,
    month: String(range.startDate.getMonth()),
    year: String(range.startDate.getFullYear()),
    start: formatDateForQuery(range.startDate),
    end: formatDateForQuery(range.endDate),
    compare: comparisonMode,
  });
  const res = await fetch(`/api/controle-performance/filial/produtos-vendedores?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { produtosVendedores?: ProdutoVendedorRow[] };
  return json.produtosVendedores ?? [];
}

export async function exportControlePerformanceXlsx(
  options: ExportControlePerformanceXlsxOptions
): Promise<void> {
  const summary = await fetchSummary(options);
  const comparisonLabel = options.comparisonMode === "year" ? "mesmo período do ano anterior" : "mês anterior";

  const workbook = XLSX.utils.book_new();
  const dateStr = new Date().toISOString().split("T")[0];
  const periodLabel = summary.range ? `${summary.range.start}_a_${summary.range.end}` : dateStr;

  // ─── ABA: RESUMO ────────────────────────────────────────────────────────────
  const resumoHeaders = [
    "Filial",
    "Meta",
    "Vendas",
    `Vendas (vs ${comparisonLabel})`,
    `Variação % (vs ${comparisonLabel})`,
    "Qtde Itens",
    "Projeção",
    "Projeção % Meta",
    ...summary.categories.flatMap((cat) => [`${cat} %`, `${cat} Variação %`]),
  ];

  const resumoRows = summary.filiais.map((f) => {
    const growth = pctDelta(f.vendas, f.vendasPrevious);
    return [
      f.displayName,
      Math.round(f.meta ?? 0),
      Math.round(f.vendas ?? 0),
      Math.round(f.vendasPrevious ?? 0),
      growth === null ? "" : Number(growth.toFixed(1)),
      Math.round(f.qtde ?? 0),
      Math.round(f.projecao ?? 0),
      f.projecaoPct === null ? "" : Number(f.projecaoPct.toFixed(1)),
      ...summary.categories.flatMap((cat) => {
        const cd = f.categories?.[cat];
        const pct = cd?.pct;
        const delta = cd?.deltaPct;
        return [
          typeof pct === "number" && Number.isFinite(pct) ? Number(pct.toFixed(1)) : "",
          typeof delta === "number" && Number.isFinite(delta) ? Number(delta.toFixed(1)) : "",
        ];
      }),
    ];
  });

  const wsResumo = XLSX.utils.aoa_to_sheet([resumoHeaders, ...resumoRows]);
  autoWidth(wsResumo);
  XLSX.utils.book_append_sheet(workbook, wsResumo, "Resumo");

  // ─── Buscar filiais (detalhe) ───────────────────────────────────────────────
  const filiaisDetalhe = await Promise.all(
    summary.filiais.map(async (f) => fetchFilial(options.companyKey, f.filial, options.range, options.comparisonMode))
  );

  const filiaisProdutosVendedores = await Promise.all(
    summary.filiais.map(async (f) => fetchFilialProdutosVendedores(options.companyKey, f.filial, options.range, options.comparisonMode))
  );

  // ─── ABA: PRODUTOS (GERAL) ─────────────────────────────────────────────────
  const produtosHeaders = [
    "Filial",
    "Produto",
    "Descrição",
    "Categoria",
    "Grade",
    "Vendedor principal",
    "Vendedor principal (% vendas)",
    "Qtde",
    "Vendas",
    `Vendas (vs ${comparisonLabel})`,
    `Variação % (vs ${comparisonLabel})`,
    "Custo Unit.",
    "Custo Total",
    "Lucro Bruto (Vendas - Custo Total)",
    "Preço Médio (Vendas/Qtde)",
    "Markup (Preço Médio/Custo)",
  ];

  const produtosRows: (string | number)[][] = [];
  filiaisDetalhe.forEach((fd, idx) => {
    const pvIndex = buildProdutoVendedorIndex(filiaisProdutosVendedores[idx] ?? []);
    fd.produtos?.forEach((p) => {
      const delta = pctDelta(p.vendas, p.vendasPrevious);
      const custoTotal = (p.qtde ?? 0) * (p.custo ?? 0);
      const lucro = (p.vendas ?? 0) - custoTotal;
      const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
      const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
      const key = `${p.produto}||${p.categoria ?? ""}||${p.grade ?? ""}`;
      const vendResumo = getVendedorResumo(pvIndex.get(key), p.vendas ?? 0, 3);
      produtosRows.push([
        fd.displayName,
        p.produto,
        p.descricao || "",
        p.categoria || "",
        p.grade ?? "",
        vendResumo.vendedorPrincipal,
        vendResumo.vendedorPrincipalPct,
        Math.round(p.qtde ?? 0),
        Math.round(p.vendas ?? 0),
        Math.round(p.vendasPrevious ?? 0),
        delta === null ? "" : Number(delta.toFixed(1)),
        Number((p.custo ?? 0).toFixed(2)),
        Number(custoTotal.toFixed(2)),
        Number(lucro.toFixed(2)),
        Number(precoMedio.toFixed(2)),
        markup === null ? "" : Number(markup.toFixed(2)),
      ]);
    });
  });

  const wsProdutos = XLSX.utils.aoa_to_sheet([produtosHeaders, ...produtosRows]);
  autoWidth(wsProdutos);
  XLSX.utils.book_append_sheet(workbook, wsProdutos, "Produtos (Geral)");

  // ─── Abas por filial ───────────────────────────────────────────────────────
  filiaisDetalhe.forEach((fd, idx) => {
    const sheetName = safeSheetName(fd.displayName || fd.filial);
    const pvIndex = buildProdutoVendedorIndex(filiaisProdutosVendedores[idx] ?? []);

    const kpiAoa: (string | number)[][] = [
      ["FILIAL", fd.displayName || fd.filial],
      ["VENDAS", Math.round(fd.vendas ?? 0)],
      ["VENDAS (COMPARAÇÃO)", Math.round(fd.vendasPrevious ?? 0)],
      ["CRESCIMENTO %", (() => {
        const g = pctDelta(fd.vendas, fd.vendasPrevious);
        return g === null ? "" : Number(g.toFixed(1));
      })()],
      ["QTDE ITENS", Math.round(fd.qtde ?? 0)],
      ["META", Math.round(fd.meta ?? 0)],
      ["PROJEÇÃO", Math.round(fd.projecao ?? 0)],
      ["PROJEÇÃO % META", fd.projecaoPct === null ? "" : Number(fd.projecaoPct.toFixed(1))],
    ];

    const catHeaders = ["Categoria", "% Participação", "Δ% (comparação)"];
    const catRows = (fd.categoryList ?? []).map((cat) => {
      const v = fd.categories?.[cat];
      return [
        cat,
        typeof v?.pct === "number" ? Number(v.pct.toFixed(1)) : "",
        typeof v?.deltaPct === "number" ? Number(v.deltaPct.toFixed(1)) : "",
      ];
    });

    const prodHeadersFilial = [
      "Produto",
      "Descrição",
      "Categoria",
      "Grade",
      "Vendedor principal",
      "Vendedor principal (% vendas)",
      "Qtde",
      "Vendas",
      `Vendas (vs ${comparisonLabel})`,
      `Variação % (vs ${comparisonLabel})`,
      "Custo Unit.",
      "Custo Total",
      "Lucro Bruto",
      "Preço Médio",
      "Markup",
    ];
    const prodRowsFilial = (fd.produtos ?? []).map((p) => {
      const delta = pctDelta(p.vendas, p.vendasPrevious);
      const custoTotal = (p.qtde ?? 0) * (p.custo ?? 0);
      const lucro = (p.vendas ?? 0) - custoTotal;
      const precoMedio = p.qtde > 0 ? p.vendas / p.qtde : 0;
      const markup = p.custo > 0 && precoMedio > 0 ? precoMedio / p.custo : null;
      const key = `${p.produto}||${p.categoria ?? ""}||${p.grade ?? ""}`;
      const vendResumo = getVendedorResumo(pvIndex.get(key), p.vendas ?? 0, 3);
      return [
        p.produto,
        p.descricao || "",
        p.categoria || "",
        p.grade ?? "",
        vendResumo.vendedorPrincipal,
        vendResumo.vendedorPrincipalPct,
        Math.round(p.qtde ?? 0),
        Math.round(p.vendas ?? 0),
        Math.round(p.vendasPrevious ?? 0),
        delta === null ? "" : Number(delta.toFixed(1)),
        Number((p.custo ?? 0).toFixed(2)),
        Number(custoTotal.toFixed(2)),
        Number(lucro.toFixed(2)),
        Number(precoMedio.toFixed(2)),
        markup === null ? "" : Number(markup.toFixed(2)),
      ];
    });

    const aoa: (string | number)[][] = [
      ...kpiAoa,
      [],
      ["CATEGORIAS / LINHAS"],
      catHeaders,
      ...catRows,
      [],
      ["PRODUTOS"],
      prodHeadersFilial,
      ...prodRowsFilial,
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    autoWidth(ws);
    XLSX.utils.book_append_sheet(workbook, ws, sheetName);
  });

  const filename = `controle-performance-${options.companyKey}-${periodLabel}-${dateStr}.xlsx`;
  XLSX.writeFile(workbook, filename);
}


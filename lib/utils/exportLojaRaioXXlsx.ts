/**
 * Export "Loja Raio X" para XLSX (client-side, multi-abas). Busca os dados direto
 * da API (independente do que já está carregado nas abas da tela) para garantir
 * que o export sempre saia completo, mesmo que o usuário não tenha aberto todas
 * as abas.
 *
 * Estilizado com ExcelJS (mesma linguagem visual do export de Aumentos e Descontos):
 * títulos, cabeçalhos coloridos, zebra, bordas, formatos numéricos e freeze/autofilter.
 * Abas: Resumo, Diferença de Produtos, Produtos (vendas x estoque), Vendedores, Rupturas.
 */
import type { CompanyKey } from "@/lib/config/company";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSWorksheet = any;

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// ── Paleta / formatos (espelham o export de Aumentos e Descontos) ────────────
const FONT = "Calibri";
const CUR_FMT = "R$ #,##0.00";
const INT_FMT = "#,##0";
const NAVY = "FF1E3A5F"; // cabeçalho padrão (dashboard)
const RED = "FF7F1D1D"; // ruptura / faltou produto
const RED_ZEBRA = "FFFDECEC";
const AMBER = "FF854D0E"; // tinha estoque, vendeu menos
const AMBER_ZEBRA = "FFFDF3E3";
const GREEN = "FF14532D"; // cresceu / com estoque
const GREEN_ZEBRA = "FFEAF7EE";
const ZEBRA_NEUTRO = "FFF3F6FA";
const TOTAL_FILL = "FFEDEFF3";
const GREY_TEXT = "FF64748B";
const DARK_TEXT = "FF334155";
const POS_GREEN = "FF15803D"; // texto verde (ganho)
const NEG_RED = "FFB91C1C"; // texto vermelho (perda)

const THIN = {
  top: { style: "thin" as const }, left: { style: "thin" as const },
  bottom: { style: "thin" as const }, right: { style: "thin" as const },
};
const HAIR = {
  top: { style: "hair" as const }, left: { style: "hair" as const },
  bottom: { style: "hair" as const }, right: { style: "hair" as const },
};

const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });

interface Col {
  label: string;
  width: number;
  fmt?: string;
  align?: "left" | "right" | "center";
}

function ymLabel(ym: string): string {
  const [ano, mes] = ym.split("-").map(Number);
  return `${MESES_ABREV[(mes || 1) - 1]}/${String(ano).slice(2)}`;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function round2(v: number | null | undefined): number | "" {
  if (v == null || !Number.isFinite(v)) return "";
  return Math.round(v * 100) / 100;
}

/** "2026-07-20" → "20/07". Vazio se inválido. */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : "";
}

/** Texto da célula "Em trânsito" para o item (vazio quando não há compra a caminho). */
function transitoCell(item: { emTransito: boolean; transitoQtd: number; transitoData: string | null }): string {
  if (!item.emTransito) return "";
  const qtd = item.transitoQtd > 0 ? `+${item.transitoQtd} un` : "Sim";
  const data = item.transitoData ? ` (${shortDate(item.transitoData)})` : "";
  return `${qtd}${data}`;
}

// ── Helpers de renderização estilizada ───────────────────────────────────────

/** Escreve as linhas de título/contexto mescladas em toda a largura. Retorna a linha do cabeçalho. */
function writeTitle(ws: ExcelJSWorksheet, titleLines: string[], ncols: number): number {
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, ncols);
    tr.getCell(1).font = {
      bold: i === 0,
      size: i === 0 ? 14 : 10,
      name: FONT,
      color: { argb: i === 0 ? DARK_TEXT : GREY_TEXT },
    };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    if (i === 0) tr.height = 22;
  });
  return titleLines.length + 1;
}

/** Faixa colorida de seção (full-width, texto branco). */
function writeBand(ws: ExcelJSWorksheet, rowNum: number, label: string, fill: string, ncols: number): void {
  const row = ws.getRow(rowNum);
  row.getCell(1).value = label;
  ws.mergeCells(rowNum, 1, rowNum, ncols);
  row.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = solid(fill);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: FONT };
    cell.alignment = { horizontal: "left", vertical: "middle" };
  });
  row.height = 20;
}

/** Cabeçalho de tabela colorido. */
function writeHeader(ws: ExcelJSWorksheet, rowNum: number, cols: Col[], fill: string): void {
  const hr = ws.getRow(rowNum);
  cols.forEach((c, i) => (hr.getCell(i + 1).value = c.label));
  hr.height = 24;
  hr.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = solid(fill);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: FONT };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = THIN;
  });
}

/** Escreve as linhas de dados com zebra + bordas hair. Retorna a próxima linha livre. */
function writeRows(
  ws: ExcelJSWorksheet,
  startRow: number,
  cols: Col[],
  rows: (string | number)[][],
  zebra: string | null
): number {
  rows.forEach((vals, i) => {
    const xrow = ws.getRow(startRow + i);
    cols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const v = vals[ci];
      cell.value = v === "" || v == null ? "" : v;
      if (c.fmt && typeof v === "number" && Number.isFinite(v)) cell.numFmt = c.fmt;
      cell.alignment = { horizontal: c.align ?? "left", vertical: "middle" };
      cell.font = { size: 10, name: FONT };
      cell.border = HAIR;
      if (zebra && i % 2 === 1) cell.fill = solid(zebra);
    });
    xrow.height = 16;
  });
  return startRow + rows.length;
}

// ── Tipos (espelham o payload de /api/loja-raio-x) ───────────────────────────

interface MesMetric {
  ym: string;
  label: string;
  faturamento: number;
  tickets: number;
  quantidade: number;
  ticketMedio: number;
}
interface Janela {
  parcial: boolean;
  analisadoLabel: string;
  comparacaoLabel: string | null;
}
interface PrincipalData {
  analyzed: MesMetric | null;
  comparacao: MesMetric | null;
  isMesmo: boolean;
  janela: Janela;
  decomposicao: { gap: number; porAtendimentos: number; porTicketMedio: number } | null;
}
interface ComparacaoProdutoItem {
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
  diffFat: number;
  estoqueLoja: number;
  estoqueFimMesAnalisado: number | null;
  temNaRede: boolean;
}
interface ComparacaoData {
  ruptura: ComparacaoProdutoItem[];
  tinhaEstoque: ComparacaoProdutoItem[];
  cresceu: ComparacaoProdutoItem[];
  rupturaCount: number;
  tinhaEstoqueCount: number;
  cresceuCount: number;
  rupturaFat: number;
  tinhaEstoqueFat: number;
  cresceuFat: number;
  truncado: boolean;
}
interface ProdutoVendaEstoqueItem {
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
  qtdAntes: number;
  fatAntes: number;
  qtdDepois: number;
  fatDepois: number;
  estoque: number;
  acabaEmDias: number | null;
}
interface ProdutosEstoqueData {
  semEstoque: ProdutoVendaEstoqueItem[];
  comEstoque: ProdutoVendaEstoqueItem[];
  truncado: boolean;
}
interface VendedorLinha {
  vendedor: string;
  porMes: Record<string, { valor: number; qtd: number }>;
  totalValor: number;
  totalQtd: number;
}
interface VendedoresData {
  meses: string[];
  vendedores: VendedorLinha[];
}
interface RupturaItem {
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
  qtdVendida: number;
  faturamento: number;
  estoqueLoja: number;
  ondeTemEstoque: Array<{ filial: string; estoque: number }>;
}

export interface ExportLojaRaioXOptions {
  companyKey: CompanyKey;
  filial: string | null;
  mes: string; // YYYY-MM analisado
  comparar: string; // "auto" ou YYYY-MM
  isRede: boolean;
  filialLabel?: string | null;
}

async function fetchSection<T>(params: URLSearchParams): Promise<T> {
  const res = await fetch(`/api/loja-raio-x?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || "Falha ao buscar dados do Loja Raio X");
  }
  const json = await res.json();
  return json.data as T;
}

function baseParams(options: ExportLojaRaioXOptions, section: string): URLSearchParams {
  const params = new URLSearchParams({ company: options.companyKey, section });
  if (options.filial) params.set("filial", options.filial);
  return params;
}

export async function exportLojaRaioXXlsx(options: ExportLojaRaioXOptions): Promise<void> {
  // 1. Principal primeiro — resolve o mês de comparação real (auto = melhor mês).
  const principalParams = baseParams(options, "principal");
  principalParams.set("mes", options.mes);
  if (options.comparar !== "auto") principalParams.set("comparar", options.comparar);
  const principal = await fetchSection<PrincipalData>(principalParams);

  if (!principal.analyzed) {
    alert("Não há dados para exportar neste período.");
    return;
  }

  const compYm = principal.comparacao?.ym ?? null;
  const temComparacao = !!compYm && !principal.isMesmo;

  // 2. Demais seções em paralelo (vendedores e rupturas independem da comparação).
  const rupturasParams = baseParams(options, "rupturas");
  rupturasParams.set("mes", options.mes);
  const vendedoresParams = baseParams(options, "vendedores");

  const [vendedores, rupturas, comparacao, produtosEstoque] = await Promise.all([
    fetchSection<VendedoresData>(vendedoresParams),
    fetchSection<RupturaItem[]>(rupturasParams),
    temComparacao
      ? (() => {
          const p = baseParams(options, "comparacao");
          p.set("mes", options.mes);
          p.set("comparar", compYm!);
          return fetchSection<ComparacaoData>(p);
        })()
      : Promise.resolve(null),
    temComparacao
      ? (() => {
          const p = baseParams(options, "produtos-estoque");
          p.set("mes", options.mes);
          p.set("comparar", compYm!);
          return fetchSection<ProdutosEstoqueData>(p);
        })()
      : Promise.resolve(null),
  ]);

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const escopoLabel = options.isRede ? "Rede (todas as lojas)" : options.filialLabel ?? options.filial ?? "—";
  // ScarfMe exige subgrupo + grade em todo item de produto (grade só existe p/ scarfme).
  const showGradeSubgrupo = options.companyKey === "scarfme";
  const gsCols: Col[] = showGradeSubgrupo
    ? [
        { label: "Subgrupo", width: 16, align: "left" },
        { label: "Grade", width: 12, align: "left" },
      ]
    : [];

  const { analyzed, comparacao: comparacaoMes, janela, decomposicao } = principal;
  const contexto = [
    `${options.companyKey.toUpperCase()}  ·  Escopo: ${escopoLabel}`,
    `Mês analisado: ${janela.analisadoLabel}${janela.parcial ? " (parcial)" : ""}`,
    temComparacao && janela.comparacaoLabel ? `Comparação: ${janela.comparacaoLabel}` : "",
  ].filter(Boolean);

  // ─── ABA: RESUMO (KPIs + resumo por grupo) ──────────────────────────────
  buildResumoSheet(workbook, {
    analyzed: analyzed!,
    comparacaoMes,
    janela,
    decomposicao,
    isMesmo: principal.isMesmo,
    contexto,
    comparacao,
  });

  // ─── ABAS: DIFERENÇA DE PRODUTOS (uma aba por grupo) ────────────────────
  if (comparacao) {
    buildDiferencaSheets(workbook, comparacao, { janela, gsCols, showGradeSubgrupo, contexto });
  }

  // ─── ABAS: PRODUTOS VENDIDOS (sem estoque / com estoque) ────────────────
  if (produtosEstoque) {
    buildProdutosSheets(workbook, produtosEstoque, { janela, gsCols, showGradeSubgrupo, contexto });
  }

  // ─── ABA: VENDEDORES ─────────────────────────────────────────────────────
  if (vendedores.vendedores.length > 0) {
    buildVendedoresSheet(workbook, vendedores, contexto);
  }

  // ─── ABA: RUPTURAS ───────────────────────────────────────────────────────
  buildRupturasSheet(workbook, rupturas, { janela, gsCols, showGradeSubgrupo, isRede: options.isRede, contexto });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toISOString().split("T")[0];
  const escopoSlug = options.isRede ? "rede" : safeFilenamePart(options.filialLabel ?? options.filial ?? "loja");
  a.download = `loja-raio-x-${options.companyKey}-${escopoSlug}-${options.mes}-${dateStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Tabela genérica: 1 aba = 1 tabela limpa (título + cabeçalho + linhas) ────
function buildTableSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  opts: {
    name: string;
    titleLines: string[];
    headerFill: string;
    zebra: string;
    cols: Col[];
    rows: (string | number)[][];
    note?: string | null;
    freezeFirstCol?: boolean;
    /** Colunas (1-based) a destacar em negrito nas linhas de dados (ex.: totais). */
    boldCols?: number[];
    emptyMessage?: string;
  }
): void {
  const { name, titleLines, headerFill, zebra, cols, rows, note, freezeFirstCol, boldCols, emptyMessage } = opts;
  const ncols = cols.length;
  const ws: ExcelJSWorksheet = workbook.addWorksheet(name.slice(0, 31));
  ws.columns = cols.map((c) => ({ width: c.width }));

  const headerRowNum = writeTitle(ws, titleLines, ncols);
  writeHeader(ws, headerRowNum, cols, headerFill);
  writeRows(ws, headerRowNum + 1, cols, rows, zebra);

  if (boldCols?.length) {
    for (let i = 0; i < rows.length; i++) {
      const xrow = ws.getRow(headerRowNum + 1 + i);
      for (const c of boldCols) {
        xrow.getCell(c).font = { size: 10, name: FONT, bold: true, color: { argb: DARK_TEXT } };
      }
    }
  }

  const afterRows = headerRowNum + 1 + rows.length;
  if (rows.length === 0 && emptyMessage) {
    const ec = ws.getRow(afterRows).getCell(1);
    ec.value = emptyMessage;
    ws.mergeCells(afterRows, 1, afterRows, ncols);
    ec.font = { italic: true, size: 10, name: FONT, color: { argb: GREY_TEXT } };
  }
  if (note) {
    const noteRow = afterRows + (rows.length === 0 && emptyMessage ? 2 : 1);
    const nc = ws.getRow(noteRow).getCell(1);
    nc.value = note;
    ws.mergeCells(noteRow, 1, noteRow, ncols);
    nc.font = { italic: true, size: 10, name: FONT, color: { argb: GREY_TEXT } };
  }

  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: ncols } };
  ws.views = [{ state: "frozen", ySplit: headerRowNum, ...(freezeFirstCol ? { xSplit: 1 } : {}) }];
}

// ── Aba Resumo (estilo dashboard de KPIs) ────────────────────────────────────
function buildResumoSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  data: {
    analyzed: MesMetric;
    comparacaoMes: MesMetric | null;
    janela: Janela;
    decomposicao: { gap: number; porAtendimentos: number; porTicketMedio: number } | null;
    isMesmo: boolean;
    contexto: string[];
    comparacao: ComparacaoData | null;
  }
): void {
  const { analyzed, comparacaoMes, janela, decomposicao, isMesmo, contexto, comparacao } = data;
  const ncols = 4;
  const ws: ExcelJSWorksheet = workbook.addWorksheet("Resumo");
  ws.columns = [{ width: 34 }, { width: 20 }, { width: 20 }, { width: 20 }];

  let r = writeTitle(ws, ["Loja Raio X — Resumo", ...contexto], ncols);

  // Cabeçalho da tabela de indicadores.
  const cols: Col[] = [
    { label: "Indicador", width: 34, align: "left" },
    { label: janela.analisadoLabel, width: 20, align: "right" },
    { label: comparacaoMes ? janela.comparacaoLabel ?? "Comparação" : "Comparação", width: 20, align: "right" },
    { label: "Diferença", width: 20, align: "right" },
  ];
  writeBand(ws, r, "Indicadores", NAVY, ncols);
  r += 1;
  writeHeader(ws, r, cols, NAVY);
  const headerRowNum = r;
  r += 1;

  interface IndicRow {
    label: string;
    an: number;
    comp: number | "";
    diff: number | "";
    fmt: string;
  }
  const indic: IndicRow[] = [
    {
      label: "Faturamento (R$)",
      an: round2(analyzed.faturamento) as number,
      comp: comparacaoMes ? (round2(comparacaoMes.faturamento) as number) : "",
      diff: comparacaoMes ? (round2(analyzed.faturamento - comparacaoMes.faturamento) as number) : "",
      fmt: CUR_FMT,
    },
    {
      label: "Tickets",
      an: analyzed.tickets,
      comp: comparacaoMes ? comparacaoMes.tickets : "",
      diff: comparacaoMes ? analyzed.tickets - comparacaoMes.tickets : "",
      fmt: INT_FMT,
    },
    {
      label: "Ticket médio (R$)",
      an: round2(analyzed.ticketMedio) as number,
      comp: comparacaoMes ? (round2(comparacaoMes.ticketMedio) as number) : "",
      diff: comparacaoMes ? (round2(analyzed.ticketMedio - comparacaoMes.ticketMedio) as number) : "",
      fmt: CUR_FMT,
    },
    {
      label: "Peças vendidas",
      an: analyzed.quantidade,
      comp: comparacaoMes ? comparacaoMes.quantidade : "",
      diff: comparacaoMes ? analyzed.quantidade - comparacaoMes.quantidade : "",
      fmt: INT_FMT,
    },
  ];

  indic.forEach((row, i) => {
    const xrow = ws.getRow(r + i);
    const cells: (string | number)[] = [row.label, row.an, row.comp, row.diff];
    cells.forEach((v, ci) => {
      const cell = xrow.getCell(ci + 1);
      cell.value = v === "" || v == null ? "" : v;
      if (ci > 0 && typeof v === "number" && Number.isFinite(v)) cell.numFmt = row.fmt;
      cell.alignment = { horizontal: ci === 0 ? "left" : "right", vertical: "middle" };
      cell.border = HAIR;
      const isDiff = ci === 3 && typeof v === "number" && Number.isFinite(v) && v !== 0;
      cell.font = {
        size: 10,
        name: FONT,
        bold: ci === 0 || ci === 3,
        color: isDiff ? { argb: (v as number) > 0 ? POS_GREEN : NEG_RED } : undefined,
      };
      if (i % 2 === 1) cell.fill = solid(ZEBRA_NEUTRO);
    });
    xrow.height = 16;
  });
  r += indic.length;

  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: ncols } };

  if (decomposicao && !isMesmo) {
    r += 1;
    writeBand(ws, r, "Decomposição do gap (faturamento = tickets × ticket médio)", NAVY, ncols);
    r += 1;
    const decomp: Array<[string, number]> = [
      ["Gap total (R$)", round2(decomposicao.gap) as number],
      ["Por tickets — volume (R$)", round2(decomposicao.porAtendimentos) as number],
      ["Por ticket médio — valor (R$)", round2(decomposicao.porTicketMedio) as number],
    ];
    decomp.forEach(([label, value], i) => {
      const xrow = ws.getRow(r + i);
      const lc = xrow.getCell(1);
      lc.value = label;
      lc.font = { size: 10, name: FONT, color: { argb: DARK_TEXT } };
      lc.alignment = { horizontal: "left", vertical: "middle" };
      const vc = xrow.getCell(2);
      vc.value = value;
      vc.numFmt = CUR_FMT;
      vc.font = { bold: true, size: 11, name: FONT };
      vc.alignment = { horizontal: "right", vertical: "middle" };
      xrow.getCell(1).border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
      xrow.getCell(2).border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
    });
    r += decomp.length;
  }

  if (isMesmo) {
    r += 1;
    const note = ws.getRow(r).getCell(1);
    note.value = "Nota: mês analisado é o próprio mês de comparação — sem gap/decomposição.";
    ws.mergeCells(r, 1, r, ncols);
    note.font = { italic: true, size: 10, name: FONT, color: { argb: GREY_TEXT } };
  }

  // Resumo por grupo da comparação (as listas detalhadas vão em abas próprias).
  if (comparacao) {
    r += 1;
    writeBand(ws, r, "Diferença de produtos — resumo por grupo", NAVY, ncols);
    r += 1;
    const grpHeader = ws.getRow(r);
    ["Grupo", "Qtd SKUs", "Faturamento (R$)"].forEach((l, i) => (grpHeader.getCell(i + 1).value = l));
    grpHeader.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      if (colNum > 3) return;
      cell.fill = solid(NAVY);
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: FONT };
      cell.alignment = { horizontal: colNum === 1 ? "left" : "center", vertical: "middle" };
      cell.border = THIN;
    });
    r += 1;
    const grpRows: Array<[string, number, number, string]> = [
      ["🔴 Faltou produto", comparacao.rupturaCount, round2(comparacao.rupturaFat) as number, RED],
      ["🟡 Tinha estoque, vendeu menos", comparacao.tinhaEstoqueCount, round2(comparacao.tinhaEstoqueFat) as number, AMBER],
      ["🟢 Compensou (cresceu)", comparacao.cresceuCount, round2(comparacao.cresceuFat) as number, GREEN],
    ];
    grpRows.forEach(([label, qtd, fat, color], i) => {
      const xrow = ws.getRow(r + i);
      const c1 = xrow.getCell(1);
      c1.value = label;
      c1.font = { size: 10, name: FONT, bold: true, color: { argb: color } };
      c1.alignment = { horizontal: "left", vertical: "middle" };
      const c2 = xrow.getCell(2);
      c2.value = qtd;
      c2.numFmt = INT_FMT;
      c2.alignment = { horizontal: "right", vertical: "middle" };
      c2.font = { size: 10, name: FONT };
      const c3 = xrow.getCell(3);
      c3.value = fat;
      c3.numFmt = CUR_FMT;
      c3.alignment = { horizontal: "right", vertical: "middle" };
      c3.font = { size: 10, name: FONT };
      [c1, c2, c3].forEach((cell) => {
        cell.border = HAIR;
        if (i % 2 === 1) cell.fill = solid(ZEBRA_NEUTRO);
      });
      xrow.height = 16;
    });
  }

  ws.views = [{ state: "frozen", ySplit: headerRowNum }];
}

// ── Abas Diferença de Produtos (uma aba por grupo) ───────────────────────────
function buildDiferencaSheets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  comparacao: ComparacaoData,
  ctx: { janela: Janela; gsCols: Col[]; showGradeSubgrupo: boolean; contexto: string[] }
): void {
  const { janela, gsCols, showGradeSubgrupo, contexto } = ctx;
  const anLabel = janela.analisadoLabel;
  const compLabel = janela.comparacaoLabel ?? "";

  const cols: Col[] = [
    { label: "Produto", width: 14, align: "left" },
    { label: "Descrição", width: 30, align: "left" },
    { label: "Cor", width: 16, align: "left" },
    ...gsCols,
    { label: `Qtd (${compLabel})`, width: 12, fmt: INT_FMT, align: "right" },
    { label: `Fat (${compLabel})`, width: 14, fmt: CUR_FMT, align: "right" },
    { label: `Qtd (${anLabel})`, width: 12, fmt: INT_FMT, align: "right" },
    { label: `Fat (${anLabel})`, width: 14, fmt: CUR_FMT, align: "right" },
    { label: "Diferença (R$)", width: 15, fmt: CUR_FMT, align: "right" },
    { label: "Estoque no mês", width: 13, fmt: INT_FMT, align: "right" },
    { label: "Estoque hoje", width: 12, fmt: INT_FMT, align: "right" },
    { label: "Tem na rede", width: 12, align: "center" },
    { label: "Descontinuado", width: 13, align: "center" },
    { label: "Em trânsito", width: 16, align: "left" },
  ];

  const rowsFor = (items: ComparacaoProdutoItem[], showTransito: boolean): (string | number)[][] =>
    items.map((p) => [
      p.produto,
      p.descricao || "",
      p.corDescricao || p.cor || "",
      ...(showGradeSubgrupo ? [p.subgrupo || "", p.grade || ""] : []),
      p.qtdComparacao,
      round2(p.fatComparacao),
      p.qtdAnalisado,
      round2(p.fatAnalisado),
      round2(p.diffFat),
      p.estoqueFimMesAnalisado ?? p.estoqueLoja,
      p.estoqueLoja,
      p.temNaRede ? "Sim" : "Não",
      p.descontinuado ? "Sim" : "Não",
      showTransito ? transitoCell(p) : "",
    ]);

  const note = comparacao.truncado ? "Nota: lista truncada — mostrando os maiores do grupo." : null;

  const groups = [
    { name: "Faltou Produto", title: "Faltou produto (ruptura)", fill: RED, zebra: RED_ZEBRA, items: comparacao.ruptura, count: comparacao.rupturaCount, fat: comparacao.rupturaFat, transito: true },
    { name: "Tinha Estoque", title: "Tinha estoque, vendeu menos", fill: AMBER, zebra: AMBER_ZEBRA, items: comparacao.tinhaEstoque, count: comparacao.tinhaEstoqueCount, fat: comparacao.tinhaEstoqueFat, transito: false },
    { name: "Cresceu", title: "Compensou (cresceu)", fill: GREEN, zebra: GREEN_ZEBRA, items: comparacao.cresceu, count: comparacao.cresceuCount, fat: comparacao.cresceuFat, transito: false },
  ];

  for (const g of groups) {
    if (g.items.length === 0) continue; // sem itens → não cria aba vazia
    buildTableSheet(workbook, {
      name: g.name,
      titleLines: [
        g.title,
        `${g.count.toLocaleString("pt-BR")} SKUs  ·  ${(round2(g.fat) as number).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
        ...contexto,
      ],
      headerFill: g.fill,
      zebra: g.zebra,
      cols,
      rows: rowsFor(g.items, g.transito),
      note,
    });
  }
}

// ── Abas Produtos vendidos (sem estoque / com estoque) ───────────────────────
function buildProdutosSheets(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  produtosEstoque: ProdutosEstoqueData,
  ctx: { janela: Janela; gsCols: Col[]; showGradeSubgrupo: boolean; contexto: string[] }
): void {
  const { janela, gsCols, showGradeSubgrupo, contexto } = ctx;
  const anLabel = janela.analisadoLabel;
  const compLabel = janela.comparacaoLabel ?? "";

  const cols: Col[] = [
    { label: "Produto", width: 14, align: "left" },
    { label: "Descrição", width: 30, align: "left" },
    { label: "Cor", width: 16, align: "left" },
    ...gsCols,
    { label: `Vendas antes (${compLabel})`, width: 15, fmt: INT_FMT, align: "right" },
    { label: `Fat antes (${compLabel})`, width: 15, fmt: CUR_FMT, align: "right" },
    { label: `Vendas depois (${anLabel})`, width: 15, fmt: INT_FMT, align: "right" },
    { label: `Fat depois (${anLabel})`, width: 15, fmt: CUR_FMT, align: "right" },
    { label: "Estoque", width: 11, fmt: INT_FMT, align: "right" },
    { label: "Acaba em (dias)", width: 14, align: "right" },
    { label: "Descontinuado", width: 13, align: "center" },
    { label: "Em trânsito", width: 16, align: "left" },
  ];

  const rowsFor = (items: ProdutoVendaEstoqueItem[], showTransito: boolean): (string | number)[][] =>
    items.map((p) => [
      p.produto,
      p.descricao || "",
      p.corDescricao || p.cor || "",
      ...(showGradeSubgrupo ? [p.subgrupo || "", p.grade || ""] : []),
      p.qtdAntes,
      round2(p.fatAntes),
      p.qtdDepois,
      round2(p.fatDepois),
      p.estoque,
      p.acabaEmDias == null ? "sem giro" : p.acabaEmDias <= 0 ? "esgotado" : p.acabaEmDias,
      p.descontinuado ? "Sim" : "Não",
      showTransito ? transitoCell(p) : "",
    ]);

  const note = produtosEstoque.truncado ? "Nota: lista truncada — mostrando os principais do grupo." : null;

  buildTableSheet(workbook, {
    name: "Sem Estoque",
    titleLines: [
      "Produtos vendidos — SEM estoque hoje",
      `${produtosEstoque.semEstoque.length.toLocaleString("pt-BR")} produtos`,
      ...contexto,
    ],
    headerFill: RED,
    zebra: RED_ZEBRA,
    cols,
    rows: rowsFor(produtosEstoque.semEstoque, true),
    note,
    emptyMessage: "Nenhum produto vendido está zerado hoje.",
  });

  buildTableSheet(workbook, {
    name: "Com Estoque",
    titleLines: [
      "Produtos vendidos — COM estoque hoje",
      `${produtosEstoque.comEstoque.length.toLocaleString("pt-BR")} produtos`,
      ...contexto,
    ],
    headerFill: GREEN,
    zebra: GREEN_ZEBRA,
    cols,
    rows: rowsFor(produtosEstoque.comEstoque, false),
    note,
    emptyMessage: "Nenhum produto vendido com estoque no período.",
  });
}

// ── Aba Vendedores (matriz mês a mês) ────────────────────────────────────────
function buildVendedoresSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  vendedores: VendedoresData,
  contexto: string[]
): void {
  const cols: Col[] = [
    { label: "Vendedor", width: 26, align: "left" },
    ...vendedores.meses.flatMap((ym): Col[] => [
      { label: `${ymLabel(ym)} (R$)`, width: 13, fmt: CUR_FMT, align: "right" },
      { label: `${ymLabel(ym)} (pç)`, width: 10, fmt: INT_FMT, align: "right" },
    ]),
    { label: "Total (R$)", width: 15, fmt: CUR_FMT, align: "right" },
    { label: "Total (pç)", width: 11, fmt: INT_FMT, align: "right" },
  ];
  const ncols = cols.length;

  const ws: ExcelJSWorksheet = workbook.addWorksheet("Vendedores");
  ws.columns = cols.map((c) => ({ width: c.width }));

  const r = writeTitle(ws, ["Vendedores — mês a mês", ...contexto], ncols);
  writeHeader(ws, r, cols, NAVY);
  const headerRowNum = r;

  const rows: (string | number)[][] = vendedores.vendedores.map((v) => [
    v.vendedor,
    ...vendedores.meses.flatMap((ym) => {
      const cell = v.porMes[ym];
      return [cell ? (round2(cell.valor) as number | "") : "", cell ? cell.qtd : ""];
    }),
    round2(v.totalValor),
    v.totalQtd,
  ]);
  writeRows(ws, headerRowNum + 1, cols, rows, ZEBRA_NEUTRO);

  // Destaca as duas colunas de Total em negrito.
  const totalValCol = ncols - 1;
  const totalQtdCol = ncols;
  for (let i = 0; i < rows.length; i++) {
    const xrow = ws.getRow(headerRowNum + 1 + i);
    [totalValCol, totalQtdCol].forEach((c) => {
      const cell = xrow.getCell(c);
      cell.font = { size: 10, name: FONT, bold: true, color: { argb: DARK_TEXT } };
    });
  }

  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: ncols } };
  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRowNum }];
}

// ── Aba Rupturas ─────────────────────────────────────────────────────────────
function buildRupturasSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  rupturas: RupturaItem[],
  ctx: { janela: Janela; gsCols: Col[]; showGradeSubgrupo: boolean; isRede: boolean; contexto: string[] }
): void {
  const { janela, gsCols, showGradeSubgrupo, isRede, contexto } = ctx;
  const cols: Col[] = [
    { label: "Produto", width: 14, align: "left" },
    { label: "Descrição", width: 30, align: "left" },
    { label: "Cor", width: 16, align: "left" },
    ...gsCols,
    { label: "Vendeu (qtd)", width: 12, fmt: INT_FMT, align: "right" },
    { label: "Faturou (R$)", width: 14, fmt: CUR_FMT, align: "right" },
    { label: isRede ? "Estoque rede" : "Estoque loja", width: 13, fmt: INT_FMT, align: "right" },
    { label: "Onde tem estoque", width: 40, align: "left" },
    { label: "Descontinuado", width: 13, align: "center" },
    { label: "Em trânsito", width: 16, align: "left" },
  ];
  const ncols = cols.length;

  const ws: ExcelJSWorksheet = workbook.addWorksheet("Rupturas");
  ws.columns = cols.map((c) => ({ width: c.width }));

  const r = writeTitle(
    ws,
    [`Rupturas — ${janela.analisadoLabel}`, `${rupturas.length} produtos zerados`, ...contexto],
    ncols
  );
  writeHeader(ws, r, cols, RED);
  const headerRowNum = r;

  const rows: (string | number)[][] = rupturas.map((rup) => [
    rup.produto,
    rup.descricao || "",
    rup.corDescricao || rup.cor || "",
    ...(showGradeSubgrupo ? [rup.subgrupo || "", rup.grade || ""] : []),
    rup.qtdVendida,
    round2(rup.faturamento),
    rup.estoqueLoja,
    rup.ondeTemEstoque.length === 0
      ? "Zerado em toda a rede"
      : rup.ondeTemEstoque.map((f) => `${f.filial}: ${f.estoque}`).join("; "),
    rup.descontinuado ? "Sim" : "Não",
    transitoCell(rup),
  ]);
  writeRows(ws, headerRowNum + 1, cols, rows, RED_ZEBRA);

  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: ncols } };
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];
}

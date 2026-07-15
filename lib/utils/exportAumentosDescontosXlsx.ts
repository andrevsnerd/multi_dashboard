import type {
  AumentoDescontoRow,
  AumentosDescontosResumo,
} from "@/lib/repositories/aumentosDescontos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSWorksheet = any;

export interface ExportAumentosDescontosOptions {
  companyKey: string;
  companyName: string;
  filialLabel?: string | null;
  periodoLabel?: string;
  filtrosResumo?: string;
  isScarfme: boolean;
  descontos: AumentoDescontoRow[];
  aumentos: AumentoDescontoRow[];
  resumo: AumentosDescontosResumo;
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

/** Letra(s) da coluna do Excel a partir do número (1 → A, 27 → AA). */
function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

const HEADER_FILL_DESC = "FF7F1D1D"; // vinho (descontos)
const HEADER_FILL_AUM = "FF14532D"; // verde escuro (aumentos)
const HEADER_FILL_DASH = "FF1E3A5F"; // navy (dashboard)
const ZEBRA_DESC = "FFFDECEC";
const ZEBRA_AUM = "FFEAF7EE";
const CUR_FMT = "R$ #,##0.00";
const PCT_FMT = '#,##0.0"%"';
const INT_FMT = "#,##0";

interface DetailColumn {
  key: keyof AumentoDescontoRow;
  label: string;
  width: number;
  fmt?: string;
  align?: "left" | "right" | "center";
}

/**
 * Export estilizado (ExcelJS) da página "Aumentos e Descontos" com 3 abas:
 * um Dashboard de KPIs e duas abas detalhadas (Descontos e Aumentos), cada uma
 * com produto × cor, valor sugerido, valor real vendido, diferença (R$) e %.
 * Mesma linguagem visual dos demais exports do app.
 */
export async function exportAumentosDescontosXlsx(
  options: ExportAumentosDescontosOptions
): Promise<void> {
  const { descontos, aumentos, resumo, isScarfme, companyKey } = options;

  if (descontos.length === 0 && aumentos.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const contexto = [
    `${options.companyName}  ·  Filial: ${options.filialLabel ?? "Todas"}`,
    options.periodoLabel ? `Período: ${options.periodoLabel}` : "",
    options.filtrosResumo ?? "",
  ].filter(Boolean);

  buildDashboardSheet(ExcelJS, workbook, resumo, contexto);
  buildDetailSheet(ExcelJS, workbook, {
    name: "Descontos",
    title: "Descontos — vendas abaixo do preço sugerido",
    headerFill: HEADER_FILL_DESC,
    zebraFill: ZEBRA_DESC,
    valorLabel: "Desconto (R$)",
    percLabel: "% Desconto",
    isScarfme,
    contexto,
    rows: descontos,
  });
  buildDetailSheet(ExcelJS, workbook, {
    name: "Aumentos",
    title: "Aumentos — vendas acima do preço sugerido",
    headerFill: HEADER_FILL_AUM,
    zebraFill: ZEBRA_AUM,
    valorLabel: "Aumento (R$)",
    percLabel: "% Aumento",
    isScarfme,
    contexto,
    rows: aumentos,
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dateStr = new Date().toISOString().split("T")[0];
  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  a.download = `aumentos-descontos-${companyKey}${filialPart}-${dateStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Aba Dashboard ────────────────────────────────────────────────────────────
function buildDashboardSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ExcelJS: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  resumo: AumentosDescontosResumo,
  contexto: string[]
): void {
  const ws: ExcelJSWorksheet = workbook.addWorksheet("Dashboard");
  ws.columns = [{ width: 40 }, { width: 24 }];

  let r = 1;
  const titleCell = ws.getRow(r).getCell(1);
  titleCell.value = "Aumentos e Descontos — Resumo";
  ws.mergeCells(r, 1, r, 2);
  titleCell.font = { bold: true, size: 15, name: "Calibri", color: { argb: "FF1E3A5F" } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };
  ws.getRow(r).height = 24;
  r += 1;

  for (const line of contexto) {
    const c = ws.getRow(r).getCell(1);
    c.value = line;
    ws.mergeCells(r, 1, r, 2);
    c.font = { size: 10, name: "Calibri", color: { argb: "FF64748B" } };
    r += 1;
  }
  r += 1;

  const section = (label: string, fill: string) => {
    const row = ws.getRow(r);
    row.getCell(1).value = label;
    ws.mergeCells(r, 1, r, 2);
    row.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fill } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
      cell.alignment = { horizontal: "left", vertical: "middle" };
    });
    row.height = 20;
    r += 1;
  };

  const kpi = (label: string, value: number, fmt: string) => {
    const row = ws.getRow(r);
    const lc = row.getCell(1);
    lc.value = label;
    lc.font = { size: 10, name: "Calibri", color: { argb: "FF334155" } };
    lc.alignment = { horizontal: "left", vertical: "middle" };
    const vc = row.getCell(2);
    vc.value = value;
    vc.numFmt = fmt;
    vc.font = { bold: true, size: 11, name: "Calibri" };
    vc.alignment = { horizontal: "right", vertical: "middle" };
    row.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
      cell.border = { bottom: { style: "hair", color: { argb: "FFE2E8F0" } } };
    });
    r += 1;
  };

  section("Descontos (vendeu abaixo do sugerido)", HEADER_FILL_DESC);
  kpi("Total concedido em descontos", resumo.totalDescontoValor, CUR_FMT);
  kpi("Desconto médio (%)", resumo.descontoMedioPerc, PCT_FMT);
  kpi("Itens (produto × cor) com desconto", resumo.itensDesconto, INT_FMT);
  kpi("Quantidade vendida com desconto", resumo.qtdeDesconto, INT_FMT);
  r += 1;

  section("Aumentos (vendeu acima do sugerido)", HEADER_FILL_AUM);
  kpi("Total praticado em aumentos", resumo.totalAumentoValor, CUR_FMT);
  kpi("Aumento médio (%)", resumo.aumentoMedioPerc, PCT_FMT);
  kpi("Itens (produto × cor) com aumento", resumo.itensAumento, INT_FMT);
  kpi("Quantidade vendida com aumento", resumo.qtdeAumento, INT_FMT);
  r += 1;

  section("Totais do período", HEADER_FILL_DASH);
  kpi("Vendas no período (base global)", resumo.vendasPeriodo, CUR_FMT);
  kpi("Valor sugerido total", resumo.valorSugeridoTotal, CUR_FMT);
  kpi("Valor real vendido total", resumo.valorRealTotal, CUR_FMT);
  kpi("Impacto líquido (aumento − desconto)", resumo.totalAumentoValor - resumo.totalDescontoValor, CUR_FMT);
  kpi("Itens vendidos ao preço sugerido", resumo.itensPrecoJusto, INT_FMT);
  kpi("Itens sem preço sugerido (fora da análise)", resumo.itensSemPrecoSugerido, INT_FMT);
}

// ── Abas detalhadas (Descontos / Aumentos) ────────────────────────────────────
interface DetailSheetOpts {
  name: string;
  title: string;
  headerFill: string;
  zebraFill: string;
  valorLabel: string;
  percLabel: string;
  isScarfme: boolean;
  contexto: string[];
  rows: AumentoDescontoRow[];
}

function buildDetailSheet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ExcelJS: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workbook: any,
  opts: DetailSheetOpts
): void {
  const cols: DetailColumn[] = [
    { key: "produto", label: "Código", width: 14, align: "left" },
    { key: "descricao", label: "Descrição", width: 32, align: "left" },
    { key: "corDescricao", label: "Cor", width: 16, align: "left" },
    { key: "linha", label: "Linha", width: 16, align: "left" },
    ...(opts.isScarfme
      ? ([
          { key: "subgrupo" as const, label: "Subgrupo", width: 16, align: "left" as const },
          { key: "grade" as const, label: "Grade", width: 12, align: "left" as const },
        ])
      : ([{ key: "grupo" as const, label: "Grupo", width: 16, align: "left" as const }])),
    { key: "qtde", label: "Qtde", width: 10, fmt: INT_FMT, align: "right" },
    // Preços unitários lado a lado (sugerido vs. real médio).
    { key: "precoSugerido", label: "Preço sugerido", width: 15, fmt: CUR_FMT, align: "right" },
    { key: "precoMedioReal", label: "Preço médio real", width: 16, fmt: CUR_FMT, align: "right" },
    // Valores totais lado a lado (sugerido vs. real).
    { key: "valorSugerido", label: "Valor sugerido", width: 16, fmt: CUR_FMT, align: "right" },
    { key: "valorReal", label: "Valor real vendido", width: 17, fmt: CUR_FMT, align: "right" },
    // Impacto: médio por unidade antes do total, seguido do %.
    { key: "valorMedioUnit", label: `${opts.valorLabel.replace(" (R$)", "")} médio/unid.`, width: 16, fmt: CUR_FMT, align: "right" },
    { key: "valor", label: opts.valorLabel, width: 15, fmt: CUR_FMT, align: "right" },
    { key: "percentual", label: opts.percLabel, width: 12, fmt: PCT_FMT, align: "right" },
  ];

  const columnCount = cols.length;
  const titleLines = [opts.title, `${opts.rows.length.toLocaleString("pt-BR")} item(ns)`, ...opts.contexto];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws: ExcelJSWorksheet = workbook.addWorksheet(opts.name, {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });
  ws.columns = cols.map((c) => ({ width: c.width }));

  // Títulos
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, columnCount);
    tr.getCell(1).font = {
      bold: i === 0,
      size: i === 0 ? 13 : 10,
      name: "Calibri",
      color: { argb: i === 0 ? "FF334155" : "FF64748B" },
    };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // Cabeçalho
  const headerRow = ws.getRow(headerRowNum);
  cols.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label;
  });
  headerRow.height = 22;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.headerFill } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: columnCount } };

  const valorColIndex = cols.findIndex((c) => c.key === "valor") + 1;
  const percColIndex = cols.findIndex((c) => c.key === "percentual") + 1;

  // Dados
  opts.rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    cols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const raw = row[c.key];
      cell.value = raw as string | number;
      if (c.fmt) cell.numFmt = c.fmt;
      cell.alignment = { horizontal: c.align ?? "left", vertical: "middle" };
    });
    xrow.height = 16;
    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      if (!cell.font) cell.font = { size: 10, name: "Calibri" };
      // Destaca a diferença (valor e %) em negrito colorido.
      if (colNum === valorColIndex || colNum === percColIndex) {
        cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: opts.headerFill } };
      }
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      if (i % 2 === 1) {
        const existingFont = cell.font;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.zebraFill } };
        cell.font = existingFont;
      }
    });
  });

  // Linha TOTAL (soma de Valor sugerido, Valor real e a diferença)
  const lastDataRow = firstDataRow + opts.rows.length - 1;
  if (opts.rows.length > 0) {
    const totalRowNum = lastDataRow + 1;
    const totalRow = ws.getRow(totalRowNum);
    totalRow.getCell(1).value = "TOTAL";
    const sumCols = cols
      .map((c, i) => ({ c, idx: i + 1 }))
      .filter(({ c }) => c.key === "valorSugerido" || c.key === "valorReal" || c.key === "valor");
    for (const { c, idx } of sumCols) {
      const L = colLetter(idx);
      totalRow.getCell(idx).value = {
        formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`,
        result: opts.rows.reduce((s, row) => s + Number(row[c.key] ?? 0), 0),
      };
      totalRow.getCell(idx).numFmt = CUR_FMT;
    }
    totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      cell.font = { bold: true, size: 10, name: "Calibri" };
      cell.alignment = { horizontal: colNum === 1 ? "left" : "right", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
    });
  }
}

import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatData } from "@/lib/reports/format";
import { FILIAL_COMPRAS_COL_PREFIX } from "@/lib/reports/clientes-filial";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  return `${fmt(start)}_${fmt(end)}`;
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

function numFmtFor(type: ColumnType | undefined): string | null {
  if (type === "currency") return "R$ #,##0.00";
  if (type === "int") return "#,##0";
  if (type === "number" || type === "percent") return "#,##0.00";
  return null;
}

/** Largura padrão por chave conhecida; colunas de filial (dinâmicas) usam o rótulo. */
function widthFor(key: string, label: string, type: ColumnType | undefined): number {
  const fixed: Record<string, number> = {
    CPF: 15,
    CLIENTE: 28,
    TOTAL_GASTO: 15,
    PECAS: 9,
    TICKETS: 9,
    PRIMEIRA_COMPRA: 13,
    ULTIMA_COMPRA: 13,
    CIDADE: 18,
    ENDERECO: 28,
    TELEFONE: 16,
  };
  if (fixed[key]) return fixed[key];
  if (key.startsWith(FILIAL_COMPRAS_COL_PREFIX)) {
    return Math.min(22, Math.max(11, label.length + 2));
  }
  if (type === "currency") return 15;
  if (type === "int" || type === "number" || type === "percent") return 11;
  return Math.min(28, Math.max(12, label.length + 2));
}

/**
 * Export estilizado (ExcelJS) da análise "Clientes por Filial": cabeçalho escuro com
 * autofiltro, linhas zebradas, formatos numéricos/moeda, CPF preservado como texto (evita
 * o Excel comer zero à esquerda ou virar notação científica) e uma linha TOTAL no rodapé
 * somando peças/tickets/total gasto e os tickets por filial. Mesma linguagem visual do
 * export "Compra sugerida ABC" ([lib/utils/exportCompraSugeridaAbcXlsx.ts]).
 */
export async function exportClientesFilialXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    companyKey: string;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    sheetName?: string;
    columnTypes?: Record<string, ColumnType>;
  }
): Promise<void> {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }
  if (columns.length === 0) {
    alert("Selecione ao menos uma coluna");
    return;
  }

  const types = options.columnTypes ?? {};
  const typeOf = (key: string): ColumnType | undefined => types[key];

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

  const workbook = new ExcelJS.Workbook();

  const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const titleLines = [
    "Clientes por Filial",
    `Filial: ${options.filialLabel ?? "Todas as filiais"}  ·  Período: ${fmtDate(options.range.startDate)} a ${fmtDate(options.range.endDate)}  ·  ${rows.length.toLocaleString("pt-BR")} cliente(s)`,
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet((options.sheetName ?? "Clientes por filial").slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });

  ws.columns = columns.map((c) => ({ width: widthFor(c.key, c.label, typeOf(c.key)) }));

  // ── Linhas de título ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, columns.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 10, name: "Calibri", color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Cabeçalho ──
  const headerRow = ws.getRow(headerRowNum);
  columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label || c.key;
  });
  headerRow.height = 20;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: columns.length },
  };

  // ── Linhas de dados ──
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F6FA" } };
  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    columns.forEach((c, ci) => {
      const t = typeOf(c.key);
      const raw = row[c.key];
      const cell = xrow.getCell(ci + 1);

      if (c.key === "CPF") {
        // Texto forçado: evita o Excel converter em número (perde zero à esquerda / vira notação científica).
        cell.value = raw != null ? String(raw) : "";
        cell.numFmt = "@";
      } else if (t === "date") {
        cell.value = formatData(raw);
      } else if (t === "currency" || t === "int" || t === "number" || t === "percent") {
        const num = Number(raw);
        cell.value = Number.isFinite(num) ? num : 0;
      } else {
        cell.value = (raw ?? "") as string | number;
      }
    });
    xrow.height = 16;

    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const key = columns[colNum - 1]?.key ?? "";
      const t = typeOf(key);
      const fmt = key === "CPF" ? null : numFmtFor(t);
      if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      cell.font = { size: 10, name: "Calibri" };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      if (i % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  });

  // ── Linha TOTAL (rodapé): soma peças, tickets, total gasto e tickets por filial ──
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRowNum = lastDataRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";
  const sumKeys = new Set(["TOTAL_GASTO", "PECAS", "TICKETS"]);
  columns.forEach((c, i) => {
    const isFilialCol = c.key.startsWith(FILIAL_COMPRAS_COL_PREFIX);
    if (!sumKeys.has(c.key) && !isFilialCol) return;
    const L = colLetter(i + 1);
    const sum = rows.reduce((s, row) => {
      const n = Number(row[c.key]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    totalRow.getCell(i + 1).value = {
      formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`,
      result: sum,
    };
  });
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const key = columns[colNum - 1]?.key ?? "";
    const fmt = numFmtFor(typeOf(key));
    if (fmt) {
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  });

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  a.download = `clientes-por-filial-${options.companyKey}${filialPart}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

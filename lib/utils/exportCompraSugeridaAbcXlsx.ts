import type { ColumnType, ReportCellValue, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { COMPRA_FILIAL_COL_PREFIX } from "@/lib/reports/compra-sugerida-abc";

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

/**
 * Exporta a análise "Compra sugerida por Curva ABC" para XLSX com FÓRMULAS dinâmicas
 * (via ExcelJS — o exportador genérico usa SheetJS, que só escreve valores):
 *  - Compra total = SOMA das colunas das lojas da linha (=B+C+…). Editar a quantidade de
 *    qualquer loja recalcula a Compra total no Excel.
 *  - Custo total = Compra total × Custo unitário (recalcula junto).
 *  - Linha TOTAL no rodapé somando Compra total, Custo total e cada loja — o valor total
 *    da compra acompanha qualquer edição.
 *
 * Detecta as colunas por chave: `COMPRA_FILIAL::{loja}` (lojas), COMPRA_TOTAL, CUSTO_TOTAL,
 * CUSTO_UNITARIO. As demais saem como valores crus.
 */
export async function exportCompraSugeridaAbcXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    reportLabel: string;
    companyKey: string;
    range: { startDate: Date; endDate: Date };
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

  // Índices (1-based para o Excel) das colunas especiais.
  const filialCols: number[] = [];
  let compraTotalCol = 0;
  let custoTotalCol = 0;
  let custoUnitCol = 0;
  columns.forEach((c, i) => {
    const n = i + 1;
    if (c.key.startsWith(COMPRA_FILIAL_COL_PREFIX)) filialCols.push(n);
    else if (c.key === "COMPRA_TOTAL") compraTotalCol = n;
    else if (c.key === "CUSTO_TOTAL") custoTotalCol = n;
    else if (c.key === "CUSTO_UNITARIO") custoUnitCol = n;
  });

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet((options.sheetName ?? "Compra sugerida").slice(0, 31), {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  // Larguras: identidade mais larga, números compactos.
  ws.columns = columns.map((c) => {
    if (c.key === "DESCRICAO") return { width: 32 };
    if (c.key === "COR_DESCRICAO" || c.key === "COLECAO") return { width: 16 };
    const t = types[c.key];
    if (t === "currency") return { width: 14 };
    return { width: 12 };
  });

  // ── Cabeçalho ──
  const headerRow = ws.addRow(columns.map((c) => c.label || c.key));
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

  const firstDataRow = 2;
  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    // Valores crus (formulas sobrescrevem depois). Numéricos saem como número p/ somar/formatar.
    const values = columns.map((c) => {
      const t = types[c.key];
      const v = row[c.key];
      if (t === "text" || t === "dataVenda" || t === "date" || t === undefined) {
        return (v ?? "") as ReportCellValue;
      }
      const num = Number(v);
      return Number.isFinite(num) ? num : 0;
    });
    const xrow = ws.addRow(values);
    xrow.height = 15;

    // Compra total = soma das colunas das lojas desta linha (dinâmica no Excel).
    if (compraTotalCol > 0 && filialCols.length > 0) {
      const formula = filialCols.map((c) => `${colLetter(c)}${r}`).join("+");
      xrow.getCell(compraTotalCol).value = {
        formula,
        result: Number(row.COMPRA_TOTAL ?? 0),
      };
    }
    // Custo total = Compra total × Custo unitário (recalcula junto).
    if (custoTotalCol > 0 && custoUnitCol > 0 && compraTotalCol > 0) {
      xrow.getCell(custoTotalCol).value = {
        formula: `${colLetter(custoUnitCol)}${r}*${colLetter(compraTotalCol)}${r}`,
        result: Number(row.CUSTO_TOTAL ?? 0),
      };
    }

    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const c = columns[colNum - 1];
      const fmt = numFmtFor(types[c.key]);
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
    });
  });

  // ── Linha TOTAL (rodapé) ──
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRow = ws.addRow([]);
  totalRow.getCell(1).value = "TOTAL";
  const sumCols = [...filialCols];
  if (compraTotalCol > 0) sumCols.push(compraTotalCol);
  if (custoTotalCol > 0) sumCols.push(custoTotalCol);
  for (const c of sumCols) {
    const L = colLetter(c);
    totalRow.getCell(c).value = { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})` };
  }
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const c = columns[colNum - 1];
    const fmt = c ? numFmtFor(types[c.key]) : null;
    if (fmt) {
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
    cell.border = {
      top: { style: "thin" }, bottom: { style: "thin" },
    };
  });

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFilenamePart(options.reportLabel)}-${options.companyKey}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

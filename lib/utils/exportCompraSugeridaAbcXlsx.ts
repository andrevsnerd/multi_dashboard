import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { COMPRA_FILIAL_COL_PREFIX } from "@/lib/reports/compra-sugerida-abc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

type CellValue = string | number | boolean | null;

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
 * Papel da coluna no export "compra por loja":
 *  - filial: quantidade editável de uma loja (entra na soma da Compra total)
 *  - compraTotal: Compra total da linha = SOMA das colunas das lojas (fórmula)
 *  - custoTotal: Custo total = Custo unit. × Compra total (fórmula)
 *  - custoUnit: custo unitário (valor de referência)
 *  - value: coluna comum (texto/número), sai como valor cru
 */
export type CompraLojaRole = "filial" | "compraTotal" | "custoTotal" | "custoUnit" | "value";

export interface CompraLojaExportColumn {
  key: string;
  label: string;
  role: CompraLojaRole;
  /** Tipo p/ formatação (currency/int/...). filial→int, custoUnit/custoTotal→currency por padrão. */
  type?: ColumnType;
}

export interface CompraPorLojaExportOptions {
  /** Base do nome do arquivo. */
  fileLabel: string;
  companyKey: string;
  sheetName?: string;
  /** Linhas de contexto exibidas antes do cabeçalho (ex.: empresa · filtro · período). */
  titleLines?: string[];
  /** Período para o sufixo do nome do arquivo. */
  dateRange?: { startDate: Date; endDate: Date } | null;
}

/**
 * Núcleo do export "compra por loja" com FÓRMULAS dinâmicas (ExcelJS — o genérico SheetJS só
 * escreve valores): Compra total = SOMA das colunas das lojas, Custo total = Custo unit. ×
 * Compra total, e uma linha TOTAL no rodapé. Editar a quantidade de qualquer loja recalcula
 * tudo no Excel. Reutilizado pelo Gerador de Relatórios e pela Curva ABC.
 */
export async function exportCompraPorLojaXlsx(
  rows: Array<Record<string, CellValue>>,
  columns: CompraLojaExportColumn[],
  options: CompraPorLojaExportOptions
): Promise<void> {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }
  if (columns.length === 0) {
    alert("Selecione ao menos uma coluna");
    return;
  }

  // Cor de destaque das células de loja com quantidade > 0 (facilita ler o que cada loja compra).
  const FILIAL_HIGHLIGHT_ARGB = "FFDAEEF3";

  // Índices (1-based) das colunas especiais.
  const filialCols: number[] = [];
  let compraTotalCol = 0;
  let custoTotalCol = 0;
  let custoUnitCol = 0;
  const filialColSet = new Set<number>();
  columns.forEach((c, i) => {
    const n = i + 1;
    if (c.role === "filial") {
      filialCols.push(n);
      filialColSet.add(n);
    }
    else if (c.role === "compraTotal") compraTotalCol = n;
    else if (c.role === "custoTotal") custoTotalCol = n;
    else if (c.role === "custoUnit") custoUnitCol = n;
  });

  // Tipo efetivo p/ formatação por papel.
  const typeOf = (c: CompraLojaExportColumn): ColumnType | undefined => {
    if (c.role === "filial" || c.role === "compraTotal") return c.type ?? "int";
    if (c.role === "custoUnit" || c.role === "custoTotal") return c.type ?? "currency";
    return c.type;
  };

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

  const workbook = new ExcelJS.Workbook();
  const titleLines = options.titleLines ?? [];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet((options.sheetName ?? "Compra por loja").slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });

  // Larguras.
  ws.columns = columns.map((c) => {
    if (c.key === "DESCRICAO") return { width: 32 };
    if (c.key === "COR_DESCRICAO" || c.key === "COLECAO") return { width: 16 };
    if (typeOf(c) === "currency") return { width: 14 };
    return { width: 12 };
  });

  // ── Linhas de título (contexto), mescladas em toda a largura ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, columns.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 12 : 10, name: "Calibri", color: { argb: "FF334155" } };
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

  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    columns.forEach((c, ci) => {
      const t = typeOf(c);
      const v = row[c.key];
      const cell = xrow.getCell(ci + 1);
      if (t === "text" || t === "dataVenda" || t === "date" || t === undefined) {
        cell.value = (v ?? "") as CellValue;
      } else {
        const num = Number(v);
        cell.value = Number.isFinite(num) ? num : 0;
      }
    });
    xrow.height = 15;

    // Compra total = soma das colunas das lojas desta linha (dinâmica no Excel).
    if (compraTotalCol > 0 && filialCols.length > 0) {
      xrow.getCell(compraTotalCol).value = {
        formula: filialCols.map((c) => `${colLetter(c)}${r}`).join("+"),
        result: Number(row[columns[compraTotalCol - 1].key] ?? 0),
      };
    }
    // Custo total = Custo unit. × Compra total (recalcula junto).
    if (custoTotalCol > 0 && custoUnitCol > 0 && compraTotalCol > 0) {
      xrow.getCell(custoTotalCol).value = {
        formula: `${colLetter(custoUnitCol)}${r}*${colLetter(compraTotalCol)}${r}`,
        result: Number(row[columns[custoTotalCol - 1].key] ?? 0),
      };
    }

    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const fmt = numFmtFor(typeOf(columns[colNum - 1]));
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
      // Célula de loja com quantidade > 0 ganha fundo destacado.
      if (filialColSet.has(colNum) && Number(cell.value ?? 0) > 0) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILIAL_HIGHLIGHT_ARGB } };
      }
    });
  });

  // ── Linha TOTAL (rodapé) ──
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRowNum = lastDataRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";
  const sumCols = [...filialCols];
  if (compraTotalCol > 0) sumCols.push(compraTotalCol);
  if (custoTotalCol > 0) sumCols.push(custoTotalCol);
  for (const c of sumCols) {
    const L = colLetter(c);
    totalRow.getCell(c).value = { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})` };
  }
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const fmt = columns[colNum - 1] ? numFmtFor(typeOf(columns[colNum - 1])) : null;
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
  const rangePart = options.dateRange
    ? `-${formatDateRange(options.dateRange.startDate, options.dateRange.endDate)}`
    : "";
  a.download = `${safeFilenamePart(options.fileLabel)}-${options.companyKey}${rangePart}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Wrapper do Gerador de Relatórios: mapeia as colunas do preset (por chave) para os papéis
 * do núcleo e delega. Mantém a assinatura usada pela página do gerador.
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
  const types = options.columnTypes ?? {};
  const mapped: CompraLojaExportColumn[] = columns.map((c) => {
    if (c.key.startsWith(COMPRA_FILIAL_COL_PREFIX)) return { key: c.key, label: c.label, role: "filial", type: "int" };
    if (c.key === "COMPRA_TOTAL") return { key: c.key, label: c.label, role: "compraTotal", type: "int" };
    if (c.key === "CUSTO_TOTAL") return { key: c.key, label: c.label, role: "custoTotal", type: "currency" };
    if (c.key === "CUSTO_UNITARIO") return { key: c.key, label: c.label, role: "custoUnit", type: "currency" };
    return { key: c.key, label: c.label, role: "value", type: types[c.key] };
  });
  await exportCompraPorLojaXlsx(rows as Array<Record<string, CellValue>>, mapped, {
    fileLabel: options.reportLabel,
    companyKey: options.companyKey,
    sheetName: options.sheetName,
    dateRange: options.range,
  });
}

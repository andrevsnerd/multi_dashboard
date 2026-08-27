import type { ColumnType, ReportCellValue, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatData, formatDataVenda, formatDiasAcabar, formatDiasParado } from "@/lib/reports/format";
import { ROW_COLECAO_COD_FIELD, ROW_COLECAO_DESC_FIELD } from "@/lib/reports/keys";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

export interface OutCol {
  key: string;
  label: string;
  type: ColumnType | undefined;
  get: (row: ReportRow) => ReportCellValue;
}

export function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

export function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  return `${fmt(start)}_${fmt(end)}`;
}

/**
 * Monta as colunas de saída na ordem do preset: aplica os formatadores de data/dias
 * parado e desdobra "Coleção" em descrição + código. Compartilhado com o export em abas.
 */
export function buildOutCols(
  columns: ReportPresetColumn[],
  columnTypes?: Record<string, ColumnType>
): OutCol[] {
  const types = columnTypes ?? {};
  const outCols: OutCol[] = [];
  for (const colDef of columns) {
    const label = colDef.label || colDef.key;
    const t = types[colDef.key];

    if (colDef.key === "COLECAO") {
      outCols.push({
        key: colDef.key,
        label,
        type: undefined,
        get: (row) => {
          const desc = row[ROW_COLECAO_DESC_FIELD];
          if (desc != null && String(desc).trim() !== "") return desc as ReportCellValue;
          return (row[ROW_COLECAO_COD_FIELD] ?? row.COLECAO ?? "") as ReportCellValue;
        },
      });
      outCols.push({
        key: "COLECAO_COD",
        label: "Cód. coleção",
        type: undefined,
        get: (row) => (row[ROW_COLECAO_COD_FIELD] ?? "") as ReportCellValue,
      });
      continue;
    }

    const get =
      t === "diasParado"
        ? (row: ReportRow) => formatDiasParado(row[colDef.key])
        : t === "diasAcabar"
          ? (row: ReportRow) => formatDiasAcabar(row[colDef.key])
          : t === "dataVenda"
            ? (row: ReportRow) => formatDataVenda(row[colDef.key])
            : t === "date"
              ? (row: ReportRow) => formatData(row[colDef.key])
              : (row: ReportRow) => row[colDef.key] ?? "";

    outCols.push({ key: colDef.key, label, type: t, get });
  }
  return outCols;
}

/** Letra(s) da coluna do Excel a partir do número (1 -> A, 27 -> AA). */
export function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

export function numFmtFor(type: ColumnType | undefined): string | null {
  if (type === "currency") return "R$ #,##0.00";
  if (type === "int") return "#,##0";
  if (type === "number") return "#,##0.00";
  if (type === "percent") return '#,##0.00"%"';
  return null;
}

export function widthFor(key: string, label: string, type: ColumnType | undefined): number {
  const fixed: Record<string, number> = {
    CURVA: 9,
    PRODUTO: 14,
    DESCRICAO: 34,
    COR: 12,
    COR_DESCRICAO: 16,
    CODIGO_BARRA: 18,
    GRUPO: 18,
    SUBGRUPO: 18,
    LINHA: 16,
    TIPO: 14,
    GRADE: 10,
    COLECAO: 18,
    COLECAO_COD: 14,
  };
  if (fixed[key]) return fixed[key];
  if (type === "currency") return 14;
  if (type === "int" || type === "number" || type === "percent") return 12;
  if (type === "date" || type === "dataVenda" || type === "diasParado") return 16;
  return Math.min(28, Math.max(11, label.length + 2));
}

export function isNumericType(type: ColumnType | undefined): boolean {
  return type === "currency" || type === "int" || type === "number" || type === "percent";
}

export function isSummableColumn(key: string, type: ColumnType | undefined): boolean {
  if (!isNumericType(type)) return false;
  const nonSummable = new Set([
    // Projeção de vendas: dias/ritmo/cobertura são por item — somar não significa nada.
    "DIAS_PARA_ACABAR",
    "RITMO_MES",
    "RITMO_DIA",
    "COBERTURA_MESES",
    "BASE_MESES",
    "MESES_PARADO",
    "TICKET_MEDIO",
    "CUSTO_UNITARIO",
    "MARKUP",
    "MARGEM_PERC",
    "PARTICIPACAO_PERC",
    "PARTICIPACAO_ACUM_PERC",
    "DURACAO_ESTOQUE",
    "PRECO_SUGERIDO",
  ]);
  return !nonSummable.has(key);
}

function buildTitleLines(
  reportLabel: string,
  range: { startDate: Date; endDate: Date },
  rowsCount: number,
  filialLabel?: string | null
): string[] {
  const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return [
    reportLabel,
    `${filialLabel ? `Filial: ${filialLabel}  ·  ` : ""}Período: ${fmtDate(range.startDate)} a ${fmtDate(range.endDate)}  ·  ${rowsCount.toLocaleString("pt-BR")} registro(s)`,
  ];
}

/**
 * Export estilizado (ExcelJS) do Gerador de Relatórios.
 *
 * Mantém a ordem e os rótulos do preset ativo, mas aplica um visual mais agradável:
 * título/contexto, cabeçalho escuro com autofiltro, painel congelado, larguras ajustadas,
 * zebra nas linhas, formatação numérica e uma linha TOTAL apenas para métricas aditivas.
 */
export async function exportRelatorioXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    reportLabel: string;
    companyKey: string;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    sheetName?: string;
    /** Tipos por coluna; só diasParado/dataVenda/date são formatados como texto. */
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

  const outCols = buildOutCols(columns, options.columnTypes);

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const titleLines = buildTitleLines(options.reportLabel, options.range, rows.length, options.filialLabel);
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;
  const summableCols = outCols
    .map((col, idx) => ({ col, idx: idx + 1 }))
    .filter(({ col }) => isSummableColumn(col.key, col.type));

  const ws = workbook.addWorksheet((options.sheetName ?? "Relatório").slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });

  ws.columns = outCols.map((c) => ({ width: widthFor(c.key, c.label, c.type) }));

  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, outCols.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 10, name: "Calibri", color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  const headerRow = ws.getRow(headerRowNum);
  outCols.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label;
  });
  headerRow.height = 22;
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
    to: { row: headerRowNum, column: outCols.length },
  };

  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF6F8FB" } };
  const CURVA_TONE: Record<string, { fill: string; font: string }> = {
    A: { fill: "FFE8F7EE", font: "FF166534" },
    B: { fill: "FFFEF3C7", font: "FF92400E" },
    C: { fill: "FFF1F5F9", font: "FF475569" },
  };

  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    xrow.height = 16;

    outCols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const raw = c.get(row);

      if (isNumericType(c.type)) {
        const num = Number(raw);
        cell.value = Number.isFinite(num) ? num : 0;
      } else {
        cell.value = (raw ?? "") as string | number;
      }

      const fmt = numFmtFor(c.type);
      if (c.key === "CURVA") {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }

      cell.font = {
        size: 10,
        name: "Calibri",
        bold: c.key === "FATURAMENTO" || c.key === "CUSTO_TOTAL" || c.key === "MARGEM",
        color: c.key === "FATURAMENTO" ? { argb: "FF1E3A5F" } : undefined,
      };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };

      if (c.key === "CURVA") {
        const tone = CURVA_TONE[String(raw ?? "").trim().toUpperCase()];
        if (tone) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
          cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: tone.font } };
        }
      } else if (i % 2 === 1) {
        cell.fill = ZEBRA_FILL;
      }
    });
  });

  if (summableCols.length > 0) {
    const lastDataRow = firstDataRow + rows.length - 1;
    const totalRowNum = lastDataRow + 1;
    const totalRow = ws.getRow(totalRowNum);
    totalRow.getCell(1).value = "TOTAL";

    for (const { col, idx } of summableCols) {
      const letter = colLetter(idx);
      const sum = rows.reduce((acc, row) => {
        const num = Number(col.get(row));
        return acc + (Number.isFinite(num) ? num : 0);
      }, 0);
      totalRow.getCell(idx).value = {
        formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
        result: sum,
      };
    }

    totalRow.height = 18;
    totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const col = outCols[colNum - 1];
      const fmt = col ? numFmtFor(col.type) : null;
      if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
      cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: "FF1E3A5F" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
    });
  }

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  await downloadXlsxWorkbook(
    workbook,
    `${safeFilenamePart(options.reportLabel)}-${options.companyKey}${filialPart}-${formatDateRange(
      options.range.startDate,
      options.range.endDate
    )}.xlsx`
  );
}

/** Serializa o workbook e dispara o download no navegador. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function downloadXlsxWorkbook(workbook: any, filename: string): Promise<void> {
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

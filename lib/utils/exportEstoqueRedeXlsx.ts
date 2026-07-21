import type { ColumnType, ReportCellValue, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatData, formatDataVenda, formatDiasParado } from "@/lib/reports/format";
import { ROW_COLECAO_COD_FIELD, ROW_COLECAO_DESC_FIELD } from "@/lib/reports/keys";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

/** Prefixo das colunas dinâmicas de estoque por filial (espelha o front / reportEstoque.ts). */
const FILIAL_COL_PREFIX = "ESTOQUE_FILIAL::";

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
 * Coluna de saída já resolvida: rótulo, extrator de valor, tipo e se é uma coluna de
 * estoque (para o heat-map de cores). `isStock` cobre o Estoque total e as colunas
 * dinâmicas por filial.
 */
interface OutCol {
  label: string;
  key: string;
  type: ColumnType | undefined;
  isStock: boolean;
  get: (row: ReportRow) => ReportCellValue;
}

/**
 * Export estilizado (ExcelJS) da análise "Estoque por filial".
 *
 * Mesma linguagem visual dos outros exports do Gerador (cabeçalho escuro, autofiltro,
 * painel congelado, zebra e formatos numéricos) — mais um heat-map nas colunas de
 * estoque (Estoque total + colunas por filial):
 *   • negativo  → fundo vermelho claro, texto vermelho em negrito
 *   • zerado    → fundo cinza claro, texto acinzentado
 *   • positivo  → fundo verde bem suave, texto verde
 * As colunas de estoque não recebem zebra (a cor da célula já as diferencia); as demais
 * colunas (código, cor, descrição, custo, ...) seguem zebradas para leitura em linha.
 */
export async function exportEstoqueRedeXlsx(
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
  const isStockKey = (key: string) => key === "ESTOQUE_TOTAL" || key.startsWith(FILIAL_COL_PREFIX);

  // ── Colunas de saída (mesma resolução do export genérico: COLECAO vira 2 colunas,
  //    diasParado/dataVenda/date viram texto). ──
  const outCols: OutCol[] = [];
  for (const colDef of columns) {
    const label = colDef.label || colDef.key;
    const t = typeOf(colDef.key);

    if (colDef.key === "COLECAO") {
      outCols.push({
        label,
        key: colDef.key,
        type: undefined,
        isStock: false,
        get: (row) => {
          const desc = row[ROW_COLECAO_DESC_FIELD];
          if (desc != null && String(desc).trim() !== "") return desc as ReportCellValue;
          return (row[ROW_COLECAO_COD_FIELD] ?? row.COLECAO ?? "") as ReportCellValue;
        },
      });
      outCols.push({
        label: "Cód. coleção",
        key: "COLECAO_COD",
        type: undefined,
        isStock: false,
        get: (row) => (row[ROW_COLECAO_COD_FIELD] ?? "") as ReportCellValue,
      });
      continue;
    }

    const get =
      t === "diasParado"
        ? (row: ReportRow) => formatDiasParado(row[colDef.key])
        : t === "dataVenda"
          ? (row: ReportRow) => formatDataVenda(row[colDef.key])
          : t === "date"
            ? (row: ReportRow) => formatData(row[colDef.key])
            : (row: ReportRow) => row[colDef.key] ?? "";

    outCols.push({ label, key: colDef.key, type: t, isStock: isStockKey(colDef.key), get });
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const fmtDate = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const titleLines = [
    "Estoque por filial",
    `${options.filialLabel && options.filialLabel !== "todas-filiais" ? `Filial: ${options.filialLabel}  ·  ` : ""}Saldo atual  ·  Gerado em ${fmtDate(options.range.endDate)}  ·  ${rows.length.toLocaleString("pt-BR")} item(ns)`,
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet((options.sheetName ?? "Estoque por filial").slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowNum, xSplit: 0 }],
  });

  // ── Larguras ──
  ws.columns = outCols.map((c) => {
    if (c.isStock) return { width: Math.min(14, Math.max(9, c.label.length + 2)) };
    if (c.type === "currency") return { width: 14 };
    if (c.key === "DESCRICAO") return { width: 30 };
    if (c.key === "PRODUTO") return { width: 14 };
    return { width: Math.min(30, Math.max(11, c.label.length + 2)) };
  });

  // ── Título ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, outCols.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 10, name: "Calibri", color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Cabeçalho ──
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

  // ── Cores do heat-map de estoque ──
  const HEAT = {
    neg: { fill: "FFFDE8E8", font: "FFB91C1C" }, // vermelho claro / vermelho forte
    zero: { fill: "FFF1F5F9", font: "FF94A3B8" }, // cinza claro / cinza médio
    pos: { fill: "FFEAF7EE", font: "FF166534" }, // verde bem suave / verde escuro
  };
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF6F8FB" } };
  const HAIR_BORDER = {
    top: { style: "hair" as const }, left: { style: "hair" as const },
    bottom: { style: "hair" as const }, right: { style: "hair" as const },
  };

  // ── Linhas de dados ──
  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    xrow.height = 16;

    outCols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const raw = c.get(row);
      const t = c.type;

      // Valor
      if (t === "currency" || t === "int" || t === "number" || t === "percent") {
        const num = Number(raw);
        cell.value = Number.isFinite(num) ? num : 0;
      } else {
        cell.value = (raw ?? "") as string | number;
      }

      // Formato numérico + alinhamento
      const fmt = numFmtFor(t);
      if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      cell.border = HAIR_BORDER;

      // Cor: colunas de estoque recebem heat-map; as demais, zebra + fonte padrão.
      if (c.isStock) {
        const num = Number(raw);
        const v = Number.isFinite(num) ? num : 0;
        const tone = v < 0 ? HEAT.neg : v === 0 ? HEAT.zero : HEAT.pos;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
        cell.font = { size: 10, name: "Calibri", bold: v < 0, color: { argb: tone.font } };
      } else {
        cell.font = { size: 10, name: "Calibri" };
        if (i % 2 === 1) cell.fill = ZEBRA_FILL;
      }
    });
  });

  // ── Linha TOTAL (rodapé): soma o Estoque total e cada coluna por filial ──
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRowNum = lastDataRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";
  outCols.forEach((c, i) => {
    if (!c.isStock) return;
    const L = colLetter(i + 1);
    const sum = rows.reduce((s, row) => {
      const n = Number(c.get(row));
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    totalRow.getCell(i + 1).value = {
      formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`,
      result: sum,
    };
  });
  totalRow.height = 18;
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const c = outCols[colNum - 1];
    if (c?.isStock) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: "FF1E3A5F" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
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
  a.download = `estoque-por-filial-${options.companyKey}${filialPart}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import * as XLSX from "xlsx";

import type { ColumnType, ReportCellValue, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatData, formatDataVenda, formatDiasParado } from "@/lib/reports/format";
import { ROW_COLECAO_COD_FIELD, ROW_COLECAO_DESC_FIELD } from "@/lib/reports/keys";

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  return `${fmt(start)}_${fmt(end)}`;
}

/**
 * Exporta as linhas do relatório para XLSX usando EXATAMENTE a ordem e os
 * rótulos das colunas do preset ativo. Reusa o padrão `json_to_sheet` dos
 * exportadores existentes (ex.: exportCurvaAbcSimpleXlsx).
 */
export function exportRelatorioXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    reportLabel: string;
    companyKey: string;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    sheetName?: string;
    /** Tipos por coluna; só diasParado/dataVenda são formatados (ex.: "Nunca vendeu"). Demais saem crus (melhor p/ Excel). */
    columnTypes?: Record<string, ColumnType>;
  }
): void {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }
  if (columns.length === 0) {
    alert("Selecione ao menos uma coluna");
    return;
  }

  const types = options.columnTypes ?? {};

  // Colunas de saída (label + extrator). COLECAO ("DESC (COD)" na tela) vira DUAS
  // colunas no XLSX: descrição e código separados.
  type OutCol = { label: string; get: (row: ReportRow) => ReportCellValue };
  const outCols: OutCol[] = [];
  for (const colDef of columns) {
    const label = colDef.label || colDef.key;
    const t = types[colDef.key];

    if (colDef.key === "COLECAO") {
      outCols.push({
        label,
        get: (row) => (row[ROW_COLECAO_DESC_FIELD] ?? row.COLECAO ?? "") as ReportCellValue,
      });
      outCols.push({
        label: "Cód. coleção",
        get: (row) => (row[ROW_COLECAO_COD_FIELD] ?? "") as ReportCellValue,
      });
      continue;
    }

    // Só diasParado/dataVenda/date viram texto; números seguem crus (melhor p/ Excel).
    const get =
      t === "diasParado"
        ? (row: ReportRow) => formatDiasParado(row[colDef.key])
        : t === "dataVenda"
          ? (row: ReportRow) => formatDataVenda(row[colDef.key])
          : t === "date"
            ? (row: ReportRow) => formatData(row[colDef.key])
            : (row: ReportRow) => row[colDef.key] ?? "";
    outCols.push({ label, get });
  }

  // Cada linha vira um objeto na ordem definida, com a chave = rótulo da coluna de saída.
  const orderedRows = rows.map((row) => {
    const out: Record<string, ReportCellValue> = {};
    for (const c of outCols) out[c.label] = c.get(row);
    return out;
  });

  const header = outCols.map((c) => c.label);
  const worksheet = XLSX.utils.json_to_sheet(orderedRows, { header });
  const workbook = XLSX.utils.book_new();
  const sheetName = (options.sheetName ?? "Relatório").slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `${safeFilenamePart(options.reportLabel)}-${options.companyKey}${filialPart}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;

  XLSX.writeFile(workbook, filename);
}

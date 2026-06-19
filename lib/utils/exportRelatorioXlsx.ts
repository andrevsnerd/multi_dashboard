import * as XLSX from "xlsx";

import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatDataVenda, formatDiasParado } from "@/lib/reports/format";

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
  // Cada linha vira um objeto na ordem do preset, com a chave = rótulo exibido.
  const orderedRows = rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const colDef of columns) {
      const label = colDef.label || colDef.key;
      const t = types[colDef.key];
      // Apenas estas duas colunas precisam virar texto (ex.: "Nunca vendeu");
      // valores numéricos (currency/percent/int) seguem crus — melhor p/ cálculo no Excel.
      if (t === "diasParado") out[label] = formatDiasParado(row[colDef.key]);
      else if (t === "dataVenda") out[label] = formatDataVenda(row[colDef.key]);
      else out[label] = row[colDef.key] ?? "";
    }
    return out;
  });

  const header = columns.map((c) => c.label || c.key);
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

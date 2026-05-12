import type { CompanyKey } from "@/lib/config/company";
import {
  formatCurvaAbcSimpleDateRange,
  type CurvaAbcSimpleXlsxRow,
} from "@/lib/utils/exportCurvaAbcSimpleXlsx";

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function escapeCsvValue(value: string | number): string {
  const text = String(value ?? "");
  if (/[",;\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function exportCurvaAbcSimpleCsv(
  rows: CurvaAbcSimpleXlsxRow[],
  options: {
    companyKey: CompanyKey;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
  }
): void {
  if (rows.length === 0) {
    alert("Nao ha dados para exportar");
    return;
  }

  const headers = Object.keys(rows[0]);
  const csvLines = [
    headers.map(escapeCsvValue).join(";"),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvValue(row[header as keyof CurvaAbcSimpleXlsxRow] ?? ""))
        .join(";")
    ),
  ];

  const csvContent = `\uFEFF${csvLines.join("\r\n")}`;
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `curva-abc-visao-simples-${options.companyKey}${filialPart}-${safeFilenamePart(
    formatCurvaAbcSimpleDateRange(options.range.startDate, options.range.endDate)
  )}.csv`;

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

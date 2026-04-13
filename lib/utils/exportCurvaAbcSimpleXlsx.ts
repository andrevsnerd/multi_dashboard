// @ts-ignore - xlsx tipos incompletos
import * as XLSX from "xlsx";
import type { CompanyKey } from "@/lib/config/company";

export interface CurvaAbcSimpleXlsxRow {
  "#": number;
  Curva: string;
  Descrição: string;
  Código: string;
  Categoria: string;
  Grade: string;
  "Participação %": number;
  "% acumulado": number;
  Faturamento: number;
  Qtd: number;
  Estoque: number;
  Markup: number | "";
  "Var. vs período anterior": number | string;
}

function formatDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const e = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${s}_${e}`;
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

/** Uma aba, mesma lógica da tabela da tela (sem detalhar vendas por filial). */
export function exportCurvaAbcSimpleXlsx(
  rows: CurvaAbcSimpleXlsxRow[],
  options: {
    companyKey: CompanyKey;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
  }
): void {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Curva ABC");

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `curva-abc-visao-simples-${options.companyKey}${filialPart}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

import * as XLSX from "xlsx";

import type { CompanyKey } from "@/lib/config/company";

export interface CurvaPorProdutoXlsxRow {
  "Periodo da analise": string;
  Curva: string;
  Descricao: string;
  Codigo: string;
  "Codigo de Barras": string;
  Categoria: string;
  Subgrupo: string;
  "Tipo Produto": string;
  Grade: string;
  Colecao: string;
  "Desc Colecao": string;
  Cor: string;
  "Participacao %": number;
  Faturamento: number;
  Qtd: number;
  Estoque: number;
  "Sugestao de compra": string | number;
  "Var. vs periodo anterior": number | string;
}

export function formatCurvaPorProdutoDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const e = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${s} a ${e}`;
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

export function exportCurvaPorProdutoXlsx(
  rows: CurvaPorProdutoXlsxRow[],
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

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Curva por Produto");

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `curva-por-produto-${options.companyKey}${filialPart}-${safeFilenamePart(formatCurvaPorProdutoDateRange(
    options.range.startDate,
    options.range.endDate
  ))}.xlsx`;

  XLSX.writeFile(workbook, filename);
}

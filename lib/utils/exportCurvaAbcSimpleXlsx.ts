import * as XLSX from "xlsx";
import type { CompanyKey } from "@/lib/config/company";

export interface CurvaAbcSimpleXlsxRow {
  RANK: number;
  CURVA: string;
  PRODUTO: string;
  DESCRICAO: string;
  COR_DESCRICAO: string;
  QTDE: number;
  ESTOQUE: number;
  CODIGO_BARRA: string;
  LINHA: string;
  SUBGRUPO: string;
  TIPO_PRODUTO: string;
  COLECAO: string;
  GRADE: string;
  PERC_PARTICIPACAO: number;
  PERC_ACUMULADA: number;
  VENDAS: number;
  MARKUP: number | "";
  COMPRA_IDEAL: number | "";
  VAR_VS_PERIODO_ANTERIOR: number | string;
}

export function formatCurvaAbcSimpleDateRange(start: Date, end: Date): string {
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

  const orderedRows = rows.map((row) => ({
    RANK: row.RANK,
    CURVA: row.CURVA,
    PRODUTO: row.PRODUTO,
    DESCRICAO: row.DESCRICAO,
    COR_DESCRICAO: row.COR_DESCRICAO,
    QTDE: row.QTDE,
    ESTOQUE: row.ESTOQUE,
    CODIGO_BARRA: row.CODIGO_BARRA,
    LINHA: row.LINHA,
    SUBGRUPO: row.SUBGRUPO,
    TIPO_PRODUTO: row.TIPO_PRODUTO,
    COLECAO: row.COLECAO,
    GRADE: row.GRADE,
    PERC_PARTICIPACAO: row.PERC_PARTICIPACAO,
    PERC_ACUMULADA: row.PERC_ACUMULADA,
    VENDAS: row.VENDAS,
    MARKUP: row.MARKUP,
    COMPRA_IDEAL: row.COMPRA_IDEAL,
    VAR_VS_PERIODO_ANTERIOR: row.VAR_VS_PERIODO_ANTERIOR,
  }));

  const worksheet = XLSX.utils.json_to_sheet(orderedRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Curva ABC");

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `curva-abc-visao-simples-${options.companyKey}${filialPart}-${formatCurvaAbcSimpleDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

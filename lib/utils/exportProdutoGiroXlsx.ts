import * as XLSX from "xlsx";
import type { CompanyKey } from "@/lib/config/company";

export interface ProdutoGiroXlsxRow {
  PRODUTO: string;
  DESCRICAO: string;
  COR: string;
  CATEGORIA: string;
  SUBGRUPO: string;
  COLECAO: string;
  GRADE: string;
  VENDAS: number;
  QTDE: number;
  MEDIA_DIARIA: number;
  ESTOQUE: number;
  DURACAO_DIAS: number | "";
  ACABA_EM: string;
  COMPRA_SUGERIDA: number | "";
  STATUS: string;
  /** Lente de transferência (opcional; presente só quando "Ver transferências" está ligado). */
  TRANSFERENCIA?: number | "";
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function formatDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const e = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${s.replace(/\//g, "-")}_${e.replace(/\//g, "-")}`;
}

/** Linha da aba "Performance" (venda real por semana/mês). */
export interface ProdutoGiroPerfXlsxRow {
  PERIODO: string;
  INICIO: string;
  FIM: string;
  VENDAS: number;
  QTDE: number;
  VAR_PCT_VS_ANTERIOR: number | "";
}

/**
 * Exporta a tabela (item × cor) numa aba e, opcionalmente, a performance por período
 * numa segunda aba. Ambas já refletem os filtros/escopo da tela (quem monta as linhas é a página).
 */
export function exportProdutoGiroXlsx(
  rows: ProdutoGiroXlsxRow[],
  options: {
    companyKey: CompanyKey;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    performance?: ProdutoGiroPerfXlsxRow[];
    performanceLabel?: string;
  }
): void {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Larguras aproximadas por coluna (ordem = chaves do objeto).
  const cols = [
    { wch: 14 }, // PRODUTO
    { wch: 40 }, // DESCRICAO
    { wch: 18 }, // COR
    { wch: 18 }, // CATEGORIA
    { wch: 18 }, // SUBGRUPO
    { wch: 16 }, // COLECAO
    { wch: 10 }, // GRADE
    { wch: 14 }, // VENDAS
    { wch: 8 }, // QTDE
    { wch: 12 }, // MEDIA_DIARIA
    { wch: 10 }, // ESTOQUE
    { wch: 12 }, // DURACAO_DIAS
    { wch: 12 }, // ACABA_EM
    { wch: 16 }, // COMPRA_SUGERIDA
    { wch: 12 }, // STATUS
  ];
  if (rows[0]?.TRANSFERENCIA !== undefined) cols.push({ wch: 14 }); // TRANSFERENCIA
  worksheet["!cols"] = cols;

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Produto Giro");

  // Segunda aba: performance por período (venda real por semana/mês), quando fornecida.
  if (options.performance && options.performance.length > 0) {
    const perfSheet = XLSX.utils.json_to_sheet(options.performance);
    perfSheet["!cols"] = [
      { wch: 16 }, // PERIODO
      { wch: 12 }, // INICIO
      { wch: 12 }, // FIM
      { wch: 14 }, // VENDAS
      { wch: 10 }, // QTDE
      { wch: 18 }, // VAR_PCT_VS_ANTERIOR
    ];
    XLSX.utils.book_append_sheet(workbook, perfSheet, options.performanceLabel ?? "Performance");
  }

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `produto-giro-${options.companyKey}${filialPart}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

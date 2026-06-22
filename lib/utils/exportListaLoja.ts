import * as XLSX from "xlsx";

type XlsxCellValue = string | number | boolean | null;

export interface ExportListaLojaOptions {
  companyKey: string;
  companyName: string;
  listaNome: string;
  filialNome?: string | null;
  filtroAplicado?: string;
  rows: Array<Record<string, XlsxCellValue>>;
}

function getHeaders(rows: Array<Record<string, XlsxCellValue>>): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue;
      seen.add(key);
      headers.push(key);
    }
  }

  return headers;
}

function addAutoWidths(worksheet: XLSX.WorkSheet, rows: Array<Record<string, XlsxCellValue>>) {
  const headers = getHeaders(rows);
  worksheet["!cols"] = headers.map((header) => {
    const maxLength = Math.max(
      header.length,
      ...rows.map((row) => {
        const value = row[header];
        if (value == null) return 0;
        return String(value).length;
      })
    );
    const detailColumn =
      header.includes("FILIAIS") ||
      header.includes("DETALHE_") ||
      header.includes("VALOR_12M_");
    return { wch: Math.min(Math.max(maxLength + 2, 12), detailColumn ? 90 : 55) };
  });
}

export function exportListaLojaToXlsx(options: ExportListaLojaOptions): void {
  const { companyKey, companyName, listaNome, filialNome, filtroAplicado, rows } = options;
  const workbook = XLSX.utils.book_new();

  const resumoData: Array<Record<string, XlsxCellValue>> = [
    { METRICA: "Empresa", VALOR: companyName },
    { METRICA: "Company Key", VALOR: companyKey },
    { METRICA: "Lista", VALOR: listaNome },
    { METRICA: "Filial", VALOR: filialNome || "" },
    { METRICA: "Filtro aplicado", VALOR: filtroAplicado || "Todos" },
    { METRICA: "Total de itens", VALOR: rows.length },
    { METRICA: "Itens a repor", VALOR: rows.filter((row) => row.STATUS === "Repor").length },
    { METRICA: "Itens em excesso", VALOR: rows.filter((row) => row.STATUS === "Excesso").length },
    { METRICA: "Itens OK", VALOR: rows.filter((row) => row.STATUS === "OK").length },
    { METRICA: "Compra ideal total (un.)", VALOR: rows.reduce((s, row) => s + (Number(row.COMPRA_IDEAL) || 0), 0) },
    { METRICA: "Exportado em", VALOR: new Date().toLocaleString("pt-BR") },
  ];

  const resumoWs = XLSX.utils.json_to_sheet(resumoData);
  resumoWs["!cols"] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(workbook, resumoWs, "Resumo");

  const itensWs = XLSX.utils.json_to_sheet(rows, { header: getHeaders(rows) });
  addAutoWidths(itensWs, rows);
  XLSX.utils.book_append_sheet(workbook, itensWs, "Itens");

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeLista = listaNome
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 60);
  const filename = `lista-loja-${companyKey}-${safeLista || "lista"}-${dateStr}.xlsx`;

  XLSX.writeFile(workbook, filename);
}

export interface ExportCompraIdealPorFilialOptions {
  companyKey: string;
  companyName: string;
  listaNome: string;
  filtroAplicado?: string;
  /** Rótulos das lojas, na ordem das colunas (cada um é a chave da coluna nas linhas). */
  colunasFiliais: string[];
  rows: Array<Record<string, XlsxCellValue>>;
}

/**
 * Export focado: uma linha por item, uma coluna por loja com a Compra Ideal daquela loja
 * (mesmo número que aparece ao filtrar a lista por aquela loja) e um total da rede.
 */
export function exportCompraIdealPorFilialToXlsx(options: ExportCompraIdealPorFilialOptions): void {
  const { companyKey, companyName, listaNome, filtroAplicado, colunasFiliais, rows } = options;
  const workbook = XLSX.utils.book_new();

  const totalGeral = rows.reduce((s, row) => s + (Number(row["TOTAL REDE"]) || 0), 0);
  const resumoData: Array<Record<string, XlsxCellValue>> = [
    { METRICA: "Empresa", VALOR: companyName },
    { METRICA: "Company Key", VALOR: companyKey },
    { METRICA: "Lista", VALOR: listaNome },
    { METRICA: "Filtro aplicado", VALOR: filtroAplicado || "Todos" },
    { METRICA: "Total de itens", VALOR: rows.length },
    { METRICA: "Lojas", VALOR: colunasFiliais.length },
    { METRICA: "Compra ideal total da rede (un.)", VALOR: totalGeral },
    ...colunasFiliais.map((label) => ({
      METRICA: `Compra ideal — ${label} (un.)`,
      VALOR: rows.reduce((s, row) => s + (Number(row[label]) || 0), 0),
    })),
    { METRICA: "Exportado em", VALOR: new Date().toLocaleString("pt-BR") },
  ];

  const resumoWs = XLSX.utils.json_to_sheet(resumoData);
  resumoWs["!cols"] = [{ wch: 40 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(workbook, resumoWs, "Resumo");

  const headers = getHeaders(rows);
  const itensWs = XLSX.utils.json_to_sheet(rows, { header: headers });
  const filialHeaders = new Set([...colunasFiliais, "TOTAL REDE"]);
  itensWs["!cols"] = headers.map((header) => {
    if (filialHeaders.has(header)) {
      return { wch: Math.max(header.length + 1, 8) };
    }
    const maxLength = Math.max(
      header.length,
      ...rows.map((row) => (row[header] == null ? 0 : String(row[header]).length))
    );
    return { wch: Math.min(Math.max(maxLength + 2, 12), 45) };
  });
  XLSX.utils.book_append_sheet(workbook, itensWs, "Compra Ideal por Loja");

  const dateStr = new Date().toISOString().slice(0, 10);
  const safeLista = listaNome
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 60);
  const filename = `compra-ideal-por-loja-${companyKey}-${safeLista || "lista"}-${dateStr}.xlsx`;

  XLSX.writeFile(workbook, filename);
}

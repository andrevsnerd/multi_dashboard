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

function addAutoWidths(worksheet: XLSX.WorkSheet, rows: Array<Record<string, XlsxCellValue>>) {
  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];
  worksheet["!cols"] = headers.map((header) => {
    const maxLength = Math.max(
      header.length,
      ...rows.map((row) => {
        const value = row[header];
        if (value == null) return 0;
        return String(value).length;
      })
    );
    return { wch: Math.min(Math.max(maxLength + 2, 12), 55) };
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
    { METRICA: "Itens sugeridos", VALOR: rows.filter((row) => row.STATUS === "Sugerido").length },
    { METRICA: "Itens barrados", VALOR: rows.filter((row) => row.STATUS === "Barrado").length },
    { METRICA: "Exportado em", VALOR: new Date().toLocaleString("pt-BR") },
  ];

  const resumoWs = XLSX.utils.json_to_sheet(resumoData);
  resumoWs["!cols"] = [{ wch: 24 }, { wch: 60 }];
  XLSX.utils.book_append_sheet(workbook, resumoWs, "Resumo");

  const itensWs = XLSX.utils.json_to_sheet(rows);
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

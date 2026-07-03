// @ts-ignore - xlsx não tem tipos perfeitos
import * as XLSX from "xlsx";

export interface ColecaoPanelExportItem {
  label: string;
  codes: string[];
  vendas: number;
  qtdVendida: number;
  skus: number;
}

interface ExportColecoesPanelOptions {
  items: ColecaoPanelExportItem[];
  companyName: string;
  periodLabel: string;
  filialLabel: string;
}

/** Exporta o Painel de Coleções para Excel: aba de resumo + aba com a tabela comparativa. */
export function exportColecoesPanelToExcel(options: ExportColecoesPanelOptions): void {
  const { items, companyName, periodLabel, filialLabel } = options;

  const workbook = XLSX.utils.book_new();

  // ===== ABA 1: Resumo =====
  const resumoData = [
    { Campo: "Empresa", Valor: companyName },
    { Campo: "Período", Valor: periodLabel },
    { Campo: "Filial", Valor: filialLabel },
  ];
  const resumoWorksheet = XLSX.utils.json_to_sheet(resumoData);
  resumoWorksheet["!cols"] = [{ wch: 12 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(workbook, resumoWorksheet, "Resumo");

  // ===== ABA 2: Coleções =====
  const totals = items.reduce(
    (acc, item) => {
      acc.vendas += item.vendas;
      acc.qtdVendida += item.qtdVendida;
      acc.skus += item.skus;
      return acc;
    },
    { vendas: 0, qtdVendida: 0, skus: 0 }
  );

  const rows = [
    ...items.map((item) => ({
      "Coleção": item.label,
      "Código(s)": item.codes.join(", "),
      "Vendas (R$)": item.vendas,
      "Qtd. vendida": item.qtdVendida,
      "Peças (SKUs)": item.skus,
    })),
    {
      "Coleção": "TOTAL",
      "Código(s)": "",
      "Vendas (R$)": totals.vendas,
      "Qtd. vendida": totals.qtdVendida,
      "Peças (SKUs)": totals.skus,
    },
  ];

  const colecoesWorksheet = XLSX.utils.json_to_sheet(rows);
  colecoesWorksheet["!cols"] = [
    { wch: Math.max(20, ...items.map((i) => i.label.length + 2)) },
    { wch: 16 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
  ];
  XLSX.utils.book_append_sheet(workbook, colecoesWorksheet, "Coleções");

  const dateStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `painel-colecoes_${dateStr}.xlsx`);
}

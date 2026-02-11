// @ts-ignore - xlsx não tem tipos perfeitos
import * as XLSX from "xlsx";
import type { VendedorItem } from "@/lib/repositories/vendedores-v2";
import type { VendedorProdutoItem } from "@/lib/repositories/vendedores-v2";

function formatDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const e = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${s}_${e}`;
}

export function exportVendedoresToExcel(
  data: VendedorItem[],
  companyKey: string,
  range: { startDate: Date; endDate: Date }
): void {
  if (data.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const rows = data.map((v) => ({
    Vendedor: v.vendedor,
    Filial: v.filial,
    Faturamento: v.faturamento,
    "Quantidade Vendida": v.quantidadeVendida,
    Tickets: v.tickets,
    "Ticket Médio": v.ticketMedio,
    "Quantidade por Ticket": v.quantidadePorTicket,
    "Participação Filial (%)": v.participacaoFilial,
    "Grupo Mais Vendido": v.grupoMaisVendido ?? "",
    "Subgrupo Mais Vendido": v.subgrupoMaisVendido ?? "",
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Vendedores");
  const filename = `vendedores-${companyKey}-${formatDateRange(range.startDate, range.endDate)}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

export function exportVendedorProdutosToExcel(
  data: VendedorProdutoItem[],
  companyKey: string,
  vendedorNome: string,
  range: { startDate: Date; endDate: Date }
): void {
  if (data.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const isScarfme = companyKey === "scarfme";

  const rows = data.map((p) => {
    if (isScarfme) {
      return {
        Linha: p.linha ?? "",
        Descricao: p.descricao,
        Codigo: p.codigo ?? "",
        Cor: p.cor ?? "",
        Grade: p.grade ?? "",
        Subgrupo: p.subgrupo ?? "",
        Colecao: p.colecao ?? "",
        Faturamento: p.faturamento,
        Quantidade: p.quantidade,
      };
    }
    return {
      Grupo: p.grupo ?? "",
      Descricao: p.descricao,
      Codigo: p.codigo ?? "",
      Cor: p.cor ?? "",
      Faturamento: p.faturamento,
      Quantidade: p.quantidade,
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  const sheetName = "Produtos".substring(0, 31);
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const safeName = vendedorNome.replace(/[/\\?*[\]:]/g, "_").substring(0, 30);
  const filename = `vendedor-produtos-${companyKey}-${safeName}-${formatDateRange(range.startDate, range.endDate)}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

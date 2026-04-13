// @ts-ignore - xlsx não tem tipos perfeitos
import * as XLSX from "xlsx";

import type { ClienteRankingItem } from "@/lib/clientes/cliente-types";

function formatDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const e = end.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  return `${s}_${e}`;
}

/** Exporta só o ranking já carregado na tela — instantâneo, sem chamadas ao servidor. */
export function exportClientesToExcel(
  data: ClienteRankingItem[],
  companyKey: string,
  range: { startDate: Date; endDate: Date }
): void {
  if (data.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const rows = data.map((c) => ({
    Cliente: c.nomeCliente,
    CPF: c.cpf ?? "",
    Tickets: c.tickets,
    "Total gasto": c.totalGasto,
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Clientes");
  const filename = `clientes-${companyKey}-${formatDateRange(range.startDate, range.endDate)}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

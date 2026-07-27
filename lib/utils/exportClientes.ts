import type { ClienteRankingItem } from "@/lib/clientes/cliente-types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  return `${fmt(start)}_${fmt(end)}`;
}

interface ColSpec {
  header: string;
  key: keyof ClienteRankingItem | "rank";
  width: number;
  align: "left" | "right" | "center";
  numFmt?: string;
  /** Texto forçado (evita o Excel comer zero à esquerda do CPF / virar notação científica). */
  asText?: boolean;
}

const COLUMNS: ColSpec[] = [
  { header: "#", key: "rank", width: 6, align: "center" },
  { header: "CLIENTE", key: "nomeCliente", width: 32, align: "left" },
  { header: "CPF", key: "cpf", width: 18, align: "left", asText: true },
  { header: "TELEFONE", key: "telefone", width: 16, align: "left", asText: true },
  { header: "ENDEREÇO", key: "endereco", width: 34, align: "left" },
  { header: "CIDADE", key: "cidade", width: 20, align: "left" },
  { header: "TICKETS", key: "tickets", width: 10, align: "right", numFmt: "#,##0" },
  { header: "TOTAL GASTO", key: "totalGasto", width: 16, align: "right", numFmt: 'R$ #,##0.00' },
];

/**
 * Export estilizado (ExcelJS) do ranking de clientes já carregado na tela.
 * Cabeçalho com título descritivo (empresa · período · nº de clientes), cabeçalho de coluna
 * escuro com autofiltro, linhas zebradas, CPF/telefone preservados como texto e uma linha
 * TOTAL somando tickets e total gasto. Mesma linguagem visual dos demais exports do painel
 * ([lib/utils/exportClientesFilialXlsx.ts]).
 */
export async function exportClientesToExcel(
  data: ClienteRankingItem[],
  companyKey: string,
  range: { startDate: Date; endDate: Date }
): Promise<void> {
  if (data.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

  const workbook = new ExcelJS.Workbook();

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const titleLines = [
    `Ranking de Clientes — ${companyKey.toUpperCase()}`,
    `Período: ${fmtDate(range.startDate)} a ${fmtDate(range.endDate)}  ·  ${data.length.toLocaleString("pt-BR")} cliente(s)`,
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet("Clientes", {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });

  ws.columns = COLUMNS.map((c) => ({ width: c.width }));

  // ── Título ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, COLUMNS.length);
    tr.getCell(1).font = {
      bold: i === 0,
      size: i === 0 ? 13 : 10,
      name: "Calibri",
      color: { argb: "FF334155" },
    };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Cabeçalho de colunas ──
  const headerRow = ws.getRow(headerRowNum);
  COLUMNS.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.header;
  });
  headerRow.height = 20;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: COLUMNS.length },
  };

  // ── Linhas de dados ──
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F6FA" } };
  data.forEach((cliente, i) => {
    const xrow = ws.getRow(firstDataRow + i);
    COLUMNS.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      if (c.key === "rank") {
        cell.value = i + 1;
      } else if (c.asText) {
        cell.value = (cliente[c.key] as string) ?? "";
        cell.numFmt = "@";
      } else if (c.numFmt) {
        const num = Number(cliente[c.key]);
        cell.value = Number.isFinite(num) ? num : 0;
        cell.numFmt = c.numFmt;
      } else {
        cell.value = (cliente[c.key] as string) ?? "";
      }
      cell.alignment = { horizontal: c.align, vertical: "middle" };
      cell.font = { size: 10, name: "Calibri" };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      if (i % 2 === 1) cell.fill = ZEBRA_FILL;
    });
    xrow.height = 16;
  });

  // ── Linha TOTAL ──
  const lastDataRow = firstDataRow + data.length - 1;
  const totalRow = ws.getRow(lastDataRow + 1);
  totalRow.getCell(1).value = "TOTAL";
  COLUMNS.forEach((c, i) => {
    if (c.key !== "tickets" && c.key !== "totalGasto") return;
    const key = c.key;
    const L = ws.getColumn(i + 1).letter;
    const sum = data.reduce((s, cliente) => {
      const n = Number(cliente[key]);
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    const cell = totalRow.getCell(i + 1);
    cell.value = { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`, result: sum };
    cell.numFmt = c.numFmt;
  });
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.font = { bold: true, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
    if (!cell.alignment) cell.alignment = { vertical: "middle" };
  });

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `clientes-${companyKey}-${formatDateRange(range.startDate, range.endDate)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

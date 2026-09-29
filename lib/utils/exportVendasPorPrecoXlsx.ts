import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatData } from "@/lib/reports/format";
import { buildReportFilename } from "@/lib/utils/reportFilename";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

/** Colunas guardadas como TEXTO (zero à esquerda do ticket/CPF não pode sumir). */
const TEXT_KEYS = new Set(["TICKET", "CPF"]);
/** Colunas somadas na linha TOTAL e com média na linha MÉDIA POR TICKET. */
const SUM_KEYS = new Set(["VALOR_TICKET", "PECAS_TICKET", "ITENS_TICKET", "DESCONTO_TICKET"]);

function colLetter(n: number): string {
  let s = "";
  let x = n;
  while (x > 0) {
    const m = (x - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

function numFmtFor(type: ColumnType | undefined): string | null {
  if (type === "currency") return "R$ #,##0.00";
  if (type === "int") return "#,##0";
  if (type === "number" || type === "percent") return "#,##0.00";
  return null;
}

function widthFor(key: string, label: string, type: ColumnType | undefined): number {
  const fixed: Record<string, number> = {
    CANAL: 11,
    TICKET: 12,
    DATA_VENDA: 12,
    FILIAL: 20,
    VENDEDOR: 22,
    CLIENTE: 28,
    CPF: 15,
    VALOR_TICKET: 16,
    PECAS_TICKET: 9,
    ITENS_TICKET: 9,
    DESCONTO_TICKET: 13,
    PRECO_MEDIO_PECA: 14,
  };
  if (fixed[key]) return fixed[key];
  if (type === "currency") return 15;
  if (type === "int" || type === "number" || type === "percent") return 11;
  return Math.min(28, Math.max(12, label.length + 2));
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });

/**
 * Export estilizado (ExcelJS) da análise "Vendas por preço": uma linha por ticket, mesma
 * linguagem visual dos outros exports do Gerador (faixa de título, cabeçalho azul-escuro
 * com autofiltro, zebra, moeda) + rodapé com TOTAL e MÉDIA POR TICKET em fórmula.
 */
export async function exportVendasPorPrecoXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    companyKey: string;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    valorMinimo?: number | null;
    sheetName?: string;
    columnTypes?: Record<string, ColumnType>;
  }
): Promise<void> {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }
  if (columns.length === 0) {
    alert("Selecione ao menos uma coluna");
    return;
  }

  const types = options.columnTypes ?? {};
  const typeOf = (key: string): ColumnType | undefined => types[key];

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const faixa =
    options.valorMinimo != null && options.valorMinimo > 0
      ? `Tickets a partir de ${brl(options.valorMinimo)}`
      : "Todos os tickets";
  const titleLines = [
    "Vendas por preço",
    `${faixa}  ·  Filial: ${options.filialLabel ?? "Todas as filiais"}  ·  Período: ${fmtDate(options.range.startDate)} a ${fmtDate(options.range.endDate)}  ·  ${rows.length.toLocaleString("pt-BR")} ticket(s)`,
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet((options.sheetName ?? "Vendas por preço").slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });
  ws.columns = columns.map((c) => ({ width: widthFor(c.key, c.label, typeOf(c.key)) }));

  // ── Título ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, columns.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 10, name: "Calibri", color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Cabeçalho ──
  const headerRow = ws.getRow(headerRowNum);
  columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label || c.key;
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
    to: { row: headerRowNum, column: columns.length },
  };

  // ── Dados ──
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F6FA" } };
  rows.forEach((row, i) => {
    const xrow = ws.getRow(firstDataRow + i);
    columns.forEach((c, ci) => {
      const t = typeOf(c.key);
      const raw = row[c.key];
      const cell = xrow.getCell(ci + 1);
      if (TEXT_KEYS.has(c.key)) {
        cell.value = raw != null ? String(raw) : "";
        cell.numFmt = "@";
      } else if (t === "date") {
        cell.value = formatData(raw);
      } else if (t === "currency" || t === "int" || t === "number" || t === "percent") {
        // Vazio fica vazio (ex.: preço médio de ticket sem peça), não vira 0.
        if (raw == null || raw === "") {
          cell.value = null;
        } else {
          const num = Number(raw);
          cell.value = Number.isFinite(num) ? num : null;
        }
      } else {
        cell.value = (raw ?? "") as string | number;
      }
    });
    xrow.height = 16;
    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const key = columns[colNum - 1]?.key ?? "";
      const fmt = TEXT_KEYS.has(key) ? null : numFmtFor(typeOf(key));
      if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      cell.font = { size: 10, name: "Calibri", bold: key === "VALOR_TICKET" };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      if (i % 2 === 1) cell.fill = ZEBRA_FILL;
    });
  });

  // ── Rodapé: TOTAL e MÉDIA POR TICKET (fórmulas, recalculam se filtrar/editar) ──
  const lastDataRow = firstDataRow + rows.length - 1;
  const footer = [
    { label: "TOTAL", fn: "SUM" },
    { label: "MÉDIA POR TICKET", fn: "AVERAGE" },
  ] as const;
  footer.forEach((f, fi) => {
    const xrow = ws.getRow(lastDataRow + 1 + fi);
    xrow.getCell(1).value = f.label;
    columns.forEach((c, i) => {
      if (!SUM_KEYS.has(c.key)) return;
      const L = colLetter(i + 1);
      const vals = rows.map((r) => Number(r[c.key])).filter((n) => Number.isFinite(n));
      const sum = vals.reduce((s, n) => s + n, 0);
      xrow.getCell(i + 1).value = {
        formula: `${f.fn}(${L}${firstDataRow}:${L}${lastDataRow})`,
        result: f.fn === "SUM" ? sum : vals.length > 0 ? sum / vals.length : 0,
      };
    });
    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const key = columns[colNum - 1]?.key ?? "";
      let fmt = numFmtFor(typeOf(key));
      // Média de peças/itens com casas decimais (2,35 peças por ticket).
      if (f.fn === "AVERAGE" && typeOf(key) === "int") fmt = "#,##0.00";
      if (fmt && SUM_KEYS.has(key)) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
      cell.font = { bold: true, size: 10, name: "Calibri" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
      cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
    });
  });

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildReportFilename({
    base: "vendas-por-preco",
    hint:
      options.valorMinimo != null && options.valorMinimo > 0
        ? `acima-${Math.round(options.valorMinimo)}`
        : null,
    companyKey: options.companyKey,
    filialLabel: options.filialLabel,
    range: options.range,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

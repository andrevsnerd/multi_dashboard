import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import {
  buildOutCols,
  colLetter,
  downloadXlsxWorkbook,
  formatDateRange,
  isNumericType,
  isSummableColumn,
  numFmtFor,
  safeFilenamePart,
  widthFor,
  type OutCol,
} from "./exportRelatorioXlsx";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

/** Máximo de abas geradas; o excedente é somado numa aba "Outros". */
const MAX_ABAS_DEFAULT = 40;
const SEM_VALOR_LABEL = "(Sem informação)";

const NAVY = "FF1E3A5F";
const NAVY_SOFT = "FFE2E8F0";
const ZEBRA = "FFF6F8FB";
const KPI_FILL = "FFF1F5F9";
const SLATE = "FF334155";

const FMT_CURRENCY = "R$ #,##0.00";
const FMT_INT = "#,##0";
const FMT_PERCENT = '#,##0.0"%"';

interface AbaGroup {
  /** Chave normalizada de agrupamento. */
  key: string;
  /** Rótulo exibido na aba / no resumo. */
  label: string;
  rows: ReportRow[];
  faturamento: number;
  qtde: number;
  custo: number;
  margem: number;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const fmtDate = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Nome de aba válido no Excel: sem : \ / ? * [ ], até 31 chars e único no workbook. */
function sheetName(label: string, used: Set<string>): string {
  const base = (label.replace(/[:\\/?*[\]]/g, "-").trim() || "Aba").slice(0, 31);
  let name = base;
  let i = 2;
  while (used.has(name.toUpperCase())) {
    const suffix = ` (${i})`;
    name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    i += 1;
  }
  used.add(name.toUpperCase());
  return name;
}

/**
 * Agrupa as linhas pela dimensão escolhida, preservando a ordem de entrada dentro de cada
 * grupo (as linhas chegam já ordenadas pela tela — por padrão faturamento desc, então cada
 * aba sai com os itens do maior para o menor). Abas ordenadas por faturamento desc.
 */
function groupRows(
  rows: ReportRow[],
  rowField: string,
  labelOf?: (value: string) => string
): AbaGroup[] {
  const byKey = new Map<string, AbaGroup>();
  for (const row of rows) {
    const raw = String(row[rowField] ?? "").trim();
    const key = raw.toUpperCase();
    let group = byKey.get(key);
    if (!group) {
      const label = raw === "" ? SEM_VALOR_LABEL : (labelOf?.(raw) ?? raw);
      group = { key, label, rows: [], faturamento: 0, qtde: 0, custo: 0, margem: 0 };
      byKey.set(key, group);
    }
    group.rows.push(row);
    group.faturamento += num(row.FATURAMENTO);
    group.qtde += num(row.QTDE);
    group.custo += num(row.CUSTO_TOTAL);
    group.margem += num(row.MARGEM);
  }
  return Array.from(byKey.values()).sort((a, b) => b.faturamento - a.faturamento);
}

/** Junta os grupos além do limite de abas numa única aba "Outros". */
function capGroups(groups: AbaGroup[], max: number): AbaGroup[] {
  if (groups.length <= max) return groups;
  const kept = groups.slice(0, max - 1);
  const rest = groups.slice(max - 1);
  const outros: AbaGroup = {
    key: "__OUTROS__",
    label: `Outros (${rest.length})`,
    rows: rest.flatMap((g) => g.rows),
    faturamento: rest.reduce((a, g) => a + g.faturamento, 0),
    qtde: rest.reduce((a, g) => a + g.qtde, 0),
    custo: rest.reduce((a, g) => a + g.custo, 0),
    margem: rest.reduce((a, g) => a + g.margem, 0),
  };
  return [...kept, outros];
}

interface KpiCell {
  label: string;
  value: number;
  fmt: "currency" | "int" | "percent";
}

function kpiNumFmt(fmt: KpiCell["fmt"]): string {
  if (fmt === "currency") return FMT_CURRENCY;
  if (fmt === "int") return FMT_INT;
  return FMT_PERCENT;
}

/** Painel de totais da aba: rótulos numa linha, valores destacados na seguinte. */
function writeKpiPanel(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  rowNum: number,
  kpis: KpiCell[],
  colCount: number
): void {
  const labelRow = ws.getRow(rowNum);
  const valueRow = ws.getRow(rowNum + 1);
  labelRow.height = 15;
  valueRow.height = 20;

  // Cada KPI ocupa 2 colunas quando há espaço; senão, 1 coluna por KPI.
  const span = colCount >= kpis.length * 2 ? 2 : 1;
  kpis.forEach((kpi, i) => {
    const from = i * span + 1;
    const to = from + span - 1;
    if (to > colCount) return; // sem espaço nesta planilha — não estoura as colunas
    if (to > from) {
      ws.mergeCells(rowNum, from, rowNum, to);
      ws.mergeCells(rowNum + 1, from, rowNum + 1, to);
    }

    const lc = labelRow.getCell(from);
    lc.value = kpi.label;
    lc.font = { size: 9, name: "Calibri", bold: true, color: { argb: "FF64748B" } };
    lc.alignment = { horizontal: "center", vertical: "middle" };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPI_FILL } };
    lc.border = { top: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };

    const vc = valueRow.getCell(from);
    vc.value = kpi.value;
    vc.numFmt = kpiNumFmt(kpi.fmt);
    vc.font = { size: 12, name: "Calibri", bold: true, color: { argb: NAVY } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    vc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: KPI_FILL } };
    vc.border = { bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } };
  });
}

/** Cabeçalho escuro da tabela + autofiltro. */
function writeHeader(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  rowNum: number,
  labels: string[]
): void {
  const headerRow = ws.getRow(rowNum);
  labels.forEach((label, i) => {
    headerRow.getCell(i + 1).value = label;
  });
  headerRow.height = 22;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.autoFilter = {
    from: { row: rowNum, column: 1 },
    to: { row: rowNum, column: labels.length },
  };
}

const CURVA_TONE: Record<string, { fill: string; font: string }> = {
  A: { fill: "FFE8F7EE", font: "FF166534" },
  B: { fill: "FFFEF3C7", font: "FF92400E" },
  C: { fill: "FFF1F5F9", font: "FF475569" },
};

/** Linhas de dados (zebra, formatação, tom da curva). Devolve a última linha escrita. */
function writeDataRows(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  firstDataRow: number,
  rows: ReportRow[],
  outCols: OutCol[]
): number {
  rows.forEach((row, i) => {
    const xrow = ws.getRow(firstDataRow + i);
    xrow.height = 16;
    outCols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const raw = c.get(row);

      if (isNumericType(c.type)) {
        cell.value = num(raw);
      } else {
        cell.value = (raw ?? "") as string | number;
      }

      const fmt = numFmtFor(c.type);
      if (c.key === "CURVA") {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }

      cell.font = {
        size: 10,
        name: "Calibri",
        bold: c.key === "FATURAMENTO" || c.key === "CUSTO_TOTAL" || c.key === "MARGEM",
        color: c.key === "FATURAMENTO" ? { argb: NAVY } : undefined,
      };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };

      if (c.key === "CURVA") {
        const tone = CURVA_TONE[String(raw ?? "").trim().toUpperCase()];
        if (tone) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
          cell.font = { size: 10, name: "Calibri", bold: true, color: { argb: tone.font } };
        }
      } else if (i % 2 === 1) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }
    });
  });
  return firstDataRow + rows.length - 1;
}

/** Linha TOTAL (só métricas aditivas) com fórmula SUM sobre o bloco de dados da aba. */
function writeTotalRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ws: any,
  totalRowNum: number,
  firstDataRow: number,
  lastDataRow: number,
  rows: ReportRow[],
  outCols: OutCol[]
): void {
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";

  outCols.forEach((col, i) => {
    if (!isSummableColumn(col.key, col.type)) return;
    const letter = colLetter(i + 1);
    const sum = rows.reduce((acc, row) => acc + num(col.get(row)), 0);
    totalRow.getCell(i + 1).value = {
      formula: `SUM(${letter}${firstDataRow}:${letter}${lastDataRow})`,
      result: sum,
    };
  });

  totalRow.height = 18;
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const col = outCols[colNum - 1];
    const fmt = col ? numFmtFor(col.type) : null;
    if (fmt) {
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: NAVY } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_SOFT } };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  });
}

/** Colunas da aba Resumo (uma linha por aba gerada). */
const RESUMO_COLS: Array<{ header: string; width: number; fmt: string | null }> = [
  { header: "", width: 30, fmt: null }, // rótulo da dimensão (preenchido em runtime)
  { header: "Itens", width: 10, fmt: FMT_INT },
  { header: "Qtde", width: 12, fmt: FMT_INT },
  { header: "Faturamento", width: 16, fmt: FMT_CURRENCY },
  { header: "Part. (%)", width: 12, fmt: FMT_PERCENT },
  { header: "Preço médio", width: 14, fmt: FMT_CURRENCY },
  { header: "Custo total", width: 16, fmt: FMT_CURRENCY },
  { header: "Margem (R$)", width: 16, fmt: FMT_CURRENCY },
  { header: "Margem (%)", width: 12, fmt: FMT_PERCENT },
];

/**
 * Export do Gerador de Relatórios QUEBRADO EM ABAS por um filtro (ex.: 5 subgrupos
 * selecionados → 5 abas). Cada aba traz os itens daquele valor na ordem da tela (top
 * primeiro) + o painel de totais só daquela aba. A primeira aba ("Resumo") compara todas.
 *
 * Não há consulta extra: o agrupamento usa o valor da dimensão que já vem em cada linha.
 */
export async function exportRelatorioAbasXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    reportLabel: string;
    companyKey: string;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    columnTypes?: Record<string, ColumnType>;
    /** Dimensão que quebra as abas (ver lib/reports/abas.ts). */
    dimensao: { id: string; label: string; rowField: string; hideColumns: string[] };
    /** Rótulo amigável de um valor (ex.: coleção: código → "VERÃO 25 (0125)"). */
    labelOf?: (value: string) => string;
    /** Máximo de abas (default 40); o excedente vira a aba "Outros". */
    maxAbas?: number;
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

  const { dimensao } = options;
  const groups = capGroups(
    groupRows(rows, dimensao.rowField, options.labelOf),
    Math.max(2, options.maxAbas ?? MAX_ABAS_DEFAULT)
  );
  if (groups.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  // Dentro da aba o valor da dimensão é constante (está no título) — não repete a coluna.
  const hide = new Set(dimensao.hideColumns);
  const abaColumns = columns.filter((c) => !hide.has(c.key));
  const outCols = buildOutCols(abaColumns.length > 0 ? abaColumns : columns, options.columnTypes);

  const totalGeral = groups.reduce((a, g) => a + g.faturamento, 0);
  const qtdeGeral = groups.reduce((a, g) => a + g.qtde, 0);
  const custoGeral = groups.reduce((a, g) => a + g.custo, 0);
  const margemGeral = groups.reduce((a, g) => a + g.margem, 0);

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();
  const usedNames = new Set<string>();

  // ---------- aba Resumo (comparativo entre as abas) ----------
  const resumoHeaderRow = 5;
  const resumo = workbook.addWorksheet(sheetName("Resumo", usedNames), {
    views: [{ state: "frozen", ySplit: resumoHeaderRow }],
  });
  resumo.columns = RESUMO_COLS.map((c) => ({ width: c.width }));

  const resumoTitle = [
    `${options.reportLabel} — por ${dimensao.label.toLowerCase()}`,
    `${options.filialLabel ? `Filial: ${options.filialLabel}  ·  ` : ""}Período: ${fmtDate(
      options.range.startDate
    )} a ${fmtDate(options.range.endDate)}  ·  ${groups.length} aba(s)  ·  ${rows.length.toLocaleString(
      "pt-BR"
    )} registro(s)`,
  ];
  resumoTitle.forEach((line, i) => {
    const tr = resumo.getRow(i + 1);
    tr.getCell(1).value = line;
    resumo.mergeCells(i + 1, 1, i + 1, RESUMO_COLS.length);
    tr.getCell(1).font = {
      bold: i === 0,
      size: i === 0 ? 13 : 10,
      name: "Calibri",
      color: { argb: SLATE },
    };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  writeKpiPanel(
    resumo,
    3,
    [
      { label: "Faturamento", value: totalGeral, fmt: "currency" },
      { label: "Qtde vendida", value: qtdeGeral, fmt: "int" },
      { label: "Preço médio", value: qtdeGeral > 0 ? totalGeral / qtdeGeral : 0, fmt: "currency" },
      { label: "Margem (R$)", value: margemGeral, fmt: "currency" },
      {
        label: "Margem (%)",
        value: totalGeral !== 0 ? (margemGeral / totalGeral) * 100 : 0,
        fmt: "percent",
      },
    ],
    RESUMO_COLS.length
  );

  writeHeader(
    resumo,
    resumoHeaderRow,
    RESUMO_COLS.map((c, i) => (i === 0 ? dimensao.label : c.header))
  );

  const writeResumoRow = (
    rowNum: number,
    values: (string | number)[],
    style: "data" | "total",
    zebra = false
  ) => {
    const r = resumo.getRow(rowNum);
    r.height = style === "total" ? 18 : 16;
    values.forEach((v, ci) => {
      const cell = r.getCell(ci + 1);
      cell.value = v;
      const fmt = RESUMO_COLS[ci]?.fmt ?? null;
      if (fmt && typeof v === "number") {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      if (style === "total") {
        cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: NAVY } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY_SOFT } };
        cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
        return;
      }
      cell.font = { size: 10, name: "Calibri", bold: ci === 0 || ci === 3 };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });
  };

  groups.forEach((g, i) => {
    writeResumoRow(
      resumoHeaderRow + 1 + i,
      [
        g.label,
        g.rows.length,
        g.qtde,
        g.faturamento,
        totalGeral !== 0 ? (g.faturamento / totalGeral) * 100 : 0,
        g.qtde > 0 ? g.faturamento / g.qtde : 0,
        g.custo,
        g.margem,
        g.faturamento !== 0 ? (g.margem / g.faturamento) * 100 : 0,
      ],
      "data",
      i % 2 === 1
    );
  });

  writeResumoRow(
    resumoHeaderRow + 1 + groups.length,
    [
      "TOTAL",
      rows.length,
      qtdeGeral,
      totalGeral,
      totalGeral !== 0 ? 100 : 0,
      qtdeGeral > 0 ? totalGeral / qtdeGeral : 0,
      custoGeral,
      margemGeral,
      totalGeral !== 0 ? (margemGeral / totalGeral) * 100 : 0,
    ],
    "total"
  );

  // ---------- uma aba por valor da dimensão ----------
  const headerRowNum = 6;
  for (const group of groups) {
    const ws = workbook.addWorksheet(sheetName(group.label, usedNames), {
      views: [{ state: "frozen", ySplit: headerRowNum }],
    });
    ws.columns = outCols.map((c) => ({ width: widthFor(c.key, c.label, c.type) }));

    const titleLines = [
      `${dimensao.label}: ${group.label}`,
      `${options.filialLabel ? `Filial: ${options.filialLabel}  ·  ` : ""}Período: ${fmtDate(
        options.range.startDate
      )} a ${fmtDate(options.range.endDate)}  ·  ${group.rows.length.toLocaleString(
        "pt-BR"
      )} item(ns)`,
    ];
    titleLines.forEach((line, i) => {
      const tr = ws.getRow(i + 1);
      tr.getCell(1).value = line;
      ws.mergeCells(i + 1, 1, i + 1, outCols.length);
      tr.getCell(1).font = {
        bold: i === 0,
        size: i === 0 ? 13 : 10,
        name: "Calibri",
        color: { argb: SLATE },
      };
      tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
    });

    writeKpiPanel(
      ws,
      3,
      [
        { label: "Faturamento", value: group.faturamento, fmt: "currency" },
        { label: "Qtde vendida", value: group.qtde, fmt: "int" },
        {
          label: "Preço médio",
          value: group.qtde > 0 ? group.faturamento / group.qtde : 0,
          fmt: "currency",
        },
        { label: "Custo total", value: group.custo, fmt: "currency" },
        { label: "Margem (R$)", value: group.margem, fmt: "currency" },
        {
          label: "Margem (%)",
          value: group.faturamento !== 0 ? (group.margem / group.faturamento) * 100 : 0,
          fmt: "percent",
        },
        {
          label: "Part. (%) no total",
          value: totalGeral !== 0 ? (group.faturamento / totalGeral) * 100 : 0,
          fmt: "percent",
        },
      ],
      outCols.length
    );

    writeHeader(ws, headerRowNum, outCols.map((c) => c.label));
    const firstDataRow = headerRowNum + 1;
    if (group.rows.length > 0) {
      const lastDataRow = writeDataRows(ws, firstDataRow, group.rows, outCols);
      writeTotalRow(ws, lastDataRow + 1, firstDataRow, lastDataRow, group.rows, outCols);
    }
  }

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  await downloadXlsxWorkbook(
    workbook,
    `${safeFilenamePart(options.reportLabel)}-abas-${safeFilenamePart(dimensao.label)}-${
      options.companyKey
    }${filialPart}-${formatDateRange(options.range.startDate, options.range.endDate)}.xlsx`
  );
}

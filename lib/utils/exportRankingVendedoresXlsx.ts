import type {
  ColumnType,
  ReportPresetColumn,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";
import {
  RANKING_CANAL_FIELD,
  VENDEDOR_OUTROS_COL,
  VENDEDOR_PRODUTO_COL_PREFIX,
} from "@/lib/reports/ranking-vendedores";
import { buildReportFilename } from "@/lib/utils/reportFilename";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSSheet = any;

// ── Paleta (mesma linguagem dos outros exports do Gerador) ──
const NAVY = "FF1E3A5F";
const SLATE = "FF475569";
const TEAL = "FF0F766E";
const TEXT = "FF334155";
const MUTED = "FF64748B";
const BAND = "FFE8EEF7";
const ZEBRA = "FFF4F6FA";
const TOTAL_FILL = "FFEDEFF3";
const ECOM_FILL = "FFF1F5F9";
const MEDAL: Record<number, string> = { 1: "FFFDE68A", 2: "FFE5E7EB", 3: "FFFED7AA" };
/** Mapa de calor das colunas por produto: do mais claro ao mais forte. */
const HEAT = ["FFEFF6FF", "FFDBEAFE", "FFBFDBFE", "FF93C5FD", "FF60A5FA"];

/** Linhas de produto mostradas no bloco do topo; o resto fica na aba "Produtos". */
const PRODUTOS_NO_TOPO = 15;
/** Largura do bloco do topo (produtos + KPIs), em colunas. */
const BLOCK_COLS = 8;
const BLOCK_WIDTHS = [6, 26, 18, 10, 10, 15, 13, 13];

const solid = (argb: string) => ({ type: "pattern" as const, pattern: "solid" as const, fgColor: { argb } });
const thin = { style: "thin" as const };
const hair = { style: "hair" as const };
const BORDER_THIN = { top: thin, left: thin, bottom: thin, right: thin };
const BORDER_HAIR = { top: hair, left: hair, bottom: hair, right: hair };

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

const isProdutoCol = (key: string) =>
  key.startsWith(VENDEDOR_PRODUTO_COL_PREFIX) || key === VENDEDOR_OUTROS_COL;

/** Formato numérico; zero aparece como "–" nas colunas por produto (lê melhor que 0). */
function numFmtFor(key: string, type: ColumnType | undefined): string | null {
  if (key === "POSICAO") return '0"º"';
  if (isProdutoCol(key)) return '#,##0;-#,##0;"–"';
  if (type === "currency") return "R$ #,##0.00";
  if (type === "percent") return '0.0"%"';
  if (type === "int") return "#,##0";
  if (type === "number") return "#,##0.00";
  return null;
}

function widthFor(key: string, label: string, type: ColumnType | undefined): number {
  const fixed: Record<string, number> = {
    POSICAO: 6,
    VENDEDOR: 26,
    VENDEDOR_CODIGO: 12,
    FILIAL: 18,
    QTDE: 10,
    PARTICIPACAO: 10,
    FATURAMENTO: 15,
    TICKETS: 9,
    PECAS_POR_TICKET: 10,
    PRECO_MEDIO: 13,
    PRODUTOS_DISTINTOS: 11,
  };
  if (fixed[key]) return fixed[key];
  if (isProdutoCol(key)) return 13;
  if (type === "currency") return 15;
  if (type === "int" || type === "number" || type === "percent") return 11;
  return Math.min(28, Math.max(12, label.length + 2));
}

const num = (v: ReportRow[string]): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const fmtDate = (d: Date) =>
  d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2 });
const int = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });

function heatFill(value: number, max: number) {
  if (value <= 0 || max <= 0) return null;
  const idx = Math.min(HEAT.length - 1, Math.floor((value / max) * HEAT.length));
  return solid(HEAT[idx]!);
}

/** Título de aba: linha grande + linha de contexto, mescladas na largura da tabela. */
function writeTitle(ws: ExcelJSSheet, width: number, title: string, lines: string[]): number {
  const t = ws.getRow(1);
  t.getCell(1).value = title;
  ws.mergeCells(1, 1, 1, width);
  t.height = 26;
  t.getCell(1).font = { bold: true, size: 16, name: "Calibri", color: { argb: NAVY } };
  t.getCell(1).alignment = { vertical: "middle" };
  lines.forEach((line, i) => {
    const r = ws.getRow(2 + i);
    r.getCell(1).value = line;
    ws.mergeCells(2 + i, 1, 2 + i, width);
    r.getCell(1).font = { size: 10, name: "Calibri", color: { argb: MUTED }, italic: i > 0 };
  });
  return 2 + lines.length; // próxima linha livre
}

function sectionBand(ws: ExcelJSSheet, rowNum: number, width: number, text: string) {
  const r = ws.getRow(rowNum);
  r.getCell(1).value = text;
  ws.mergeCells(rowNum, 1, rowNum, width);
  r.height = 20;
  r.getCell(1).font = { bold: true, size: 11, name: "Calibri", color: { argb: NAVY } };
  r.getCell(1).fill = solid(BAND);
  r.getCell(1).alignment = { vertical: "middle", indent: 1 };
}

function styleHeaderCell(cell: ExcelJSCell, fill: string) {
  cell.fill = solid(fill);
  cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = BORDER_THIN;
}

function bodyFont(extra?: Record<string, unknown>) {
  return { size: 10, name: "Calibri", color: { argb: TEXT }, ...extra };
}

/**
 * Export estilizado (ExcelJS) do "Ranking de vendedores".
 *
 * Aba "Ranking": no topo, QUAIS produtos foram filtrados (do mais vendido ao menos, com
 * peças, faturamento e o vendedor destaque de cada um), os totais em cartões e o ranking:
 * pódio em ouro/prata/bronze, uma coluna por produto com mapa de calor (quem mais vendeu
 * cada item salta à vista) e linha TOTAL em fórmula. O e-commerce, que não é vendedor, vem
 * por último, fora da numeração.
 * Aba "Produtos": a lista completa dos produtos. Aba "Vendedor × Produto": o cruzamento
 * inteiro, para filtrar no Excel (só existe com mais de um produto).
 */
export async function exportRankingVendedoresXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    companyKey: string;
    companyName?: string;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    columnTypes?: Record<string, ColumnType>;
    summary?: ReportSummaryMetric[];
    produtos: ReportRow[];
    vendedorProduto: ReportRow[];
    /** Descrição legível dos filtros usados (ex.: 'Busca: "alça"', "Grupo: CAPAS"). */
    filtros: string[];
    /** Pedaço do nome do arquivo (termo buscado, produto…). */
    fileHint?: string | null;
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
  const kpi = (label: string) => options.summary?.find((m) => m.label === label)?.value ?? null;

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const filialTxt = options.filialLabel && options.filialLabel !== "todas-filiais"
    ? options.filialLabel
    : "Todas as filiais";
  const periodoTxt = `${fmtDate(options.range.startDate)} a ${fmtDate(options.range.endDate)}`;
  const contexto = [options.companyName, `Filial: ${filialTxt}`, `Período: ${periodoTxt}`]
    .filter(Boolean)
    .join("  ·  ");
  const filtroTxt =
    options.filtros.length > 0
      ? `Filtro: ${options.filtros.join("  ·  ")}`
      : "Filtro: nenhum — ranking de TODOS os produtos vendidos no período";

  const produtos = options.produtos ?? [];
  const umProduto = produtos.length === 1;

  // ════════════════════════ Aba 1: Ranking ════════════════════════
  const width = Math.max(columns.length, BLOCK_COLS);
  const ws = workbook.addWorksheet("Ranking", {
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = Array.from({ length: width }, (_, i) => {
    const c = columns[i];
    const w = c ? widthFor(c.key, c.label, typeOf(c.key)) : 10;
    return { width: Math.max(w, BLOCK_WIDTHS[i] ?? 0) };
  });

  let r = writeTitle(ws, width, "Ranking de vendedores", [contexto, filtroTxt]);
  r += 1;

  // ── Bloco: produtos filtrados ──
  if (produtos.length > 0) {
    const titulo =
      options.filtros.length > 0
        ? umProduto
          ? "PRODUTO FILTRADO"
          : `PRODUTOS FILTRADOS (${int(produtos.length)}) — do mais vendido ao menos vendido`
        : `PRODUTOS MAIS VENDIDOS NO PERÍODO (${int(produtos.length)} produtos no total)`;
    sectionBand(ws, r, BLOCK_COLS, titulo);
    r += 1;

    // Cabeçalho do bloco: #, Produto (2 colunas), Peças, %, Faturamento, Destaque (2 colunas).
    const hdr = ws.getRow(r);
    const hdrCells: Array<[number, string]> = [
      [1, "#"], [2, "Produto"], [4, "Peças"], [5, "% peças"], [6, "Faturamento"], [7, "Vendedor destaque"],
    ];
    for (const [c, label] of hdrCells) hdr.getCell(c).value = label;
    ws.mergeCells(r, 2, r, 3);
    ws.mergeCells(r, 7, r, 8);
    for (let c = 1; c <= BLOCK_COLS; c += 1) styleHeaderCell(hdr.getCell(c), SLATE);
    hdr.height = 18;
    r += 1;

    produtos.slice(0, PRODUTOS_NO_TOPO).forEach((p, i) => {
      const row = ws.getRow(r);
      const pos = num(p.POSICAO) ?? i + 1;
      row.getCell(1).value = pos;
      row.getCell(2).value = `${String(p.DESCRICAO ?? "")}  (${String(p.PRODUTO ?? "")})`;
      row.getCell(4).value = num(p.QTDE);
      row.getCell(5).value = num(p.PARTICIPACAO);
      row.getCell(6).value = num(p.FATURAMENTO);
      const dq = num(p.DESTAQUE_QTDE);
      row.getCell(7).value = p.DESTAQUE ? `${String(p.DESTAQUE)}${dq != null ? ` — ${int(dq)} pç` : ""}` : "—";
      ws.mergeCells(r, 2, r, 3);
      ws.mergeCells(r, 7, r, 8);
      for (let c = 1; c <= BLOCK_COLS; c += 1) {
        const cell = row.getCell(c);
        cell.font = bodyFont({ bold: c === 4 || (pos <= 3 && c === 1) });
        cell.border = BORDER_HAIR;
        if (i % 2 === 1) cell.fill = solid(ZEBRA);
      }
      if (MEDAL[pos]) row.getCell(1).fill = solid(MEDAL[pos]!);
      row.getCell(1).numFmt = '0"º"';
      row.getCell(1).alignment = { horizontal: "center" };
      row.getCell(4).numFmt = "#,##0";
      row.getCell(5).numFmt = '0.0"%"';
      row.getCell(6).numFmt = "R$ #,##0.00";
      r += 1;
    });
    if (produtos.length > PRODUTOS_NO_TOPO) {
      const resto = ws.getRow(r);
      resto.getCell(1).value = `… e mais ${int(produtos.length - PRODUTOS_NO_TOPO)} produtos — lista completa na aba "Produtos".`;
      ws.mergeCells(r, 1, r, BLOCK_COLS);
      resto.getCell(1).font = bodyFont({ italic: true, color: { argb: MUTED } });
      r += 1;
    }
    r += 1;
  }

  // ── Cartões de totais ──
  const cards: Array<{ label: string; value: string }> = [
    { label: "PEÇAS", value: int(kpi("Peças") ?? 0) },
    { label: "FATURAMENTO", value: brl(kpi("Faturamento") ?? 0) },
    { label: "TICKETS", value: int(kpi("Tickets") ?? 0) },
    { label: "VENDEDORES", value: int(kpi("Vendedores") ?? 0) },
  ];
  cards.forEach((card, i) => {
    const c1 = 1 + i * 2;
    ws.mergeCells(r, c1, r, c1 + 1);
    ws.mergeCells(r + 1, c1, r + 1, c1 + 1);
    const lab = ws.getRow(r).getCell(c1);
    const val = ws.getRow(r + 1).getCell(c1);
    lab.value = card.label;
    val.value = card.value;
    lab.font = { size: 8, bold: true, name: "Calibri", color: { argb: MUTED } };
    val.font = { size: 14, bold: true, name: "Calibri", color: { argb: NAVY } };
    for (const cell of [lab, val]) {
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = solid(ZEBRA);
    }
    lab.border = { top: thin, left: thin, right: thin };
    val.border = { bottom: thin, left: thin, right: thin };
  });
  ws.getRow(r + 1).height = 24;
  r += 2;
  const pecasEcom = kpi("Peças no e-commerce");
  if (pecasEcom != null) {
    const nota = ws.getRow(r);
    nota.getCell(1).value = `Inclui ${int(pecasEcom)} peça(s) vendidas no e-commerce (linha à parte, no fim do ranking).`;
    ws.mergeCells(r, 1, r, BLOCK_COLS);
    nota.getCell(1).font = bodyFont({ italic: true, size: 9, color: { argb: MUTED } });
    r += 1;
  }
  r += 1;

  // ── Ranking ──
  sectionBand(ws, r, width, "RANKING DE VENDEDORES — por peças vendidas");
  r += 1;
  const headerRowNum = r;
  const temColunaProduto = columns.some((c) => isProdutoCol(c.key));
  const header = ws.getRow(headerRowNum);
  columns.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.value = c.label || c.key;
    styleHeaderCell(cell, isProdutoCol(c.key) ? TEAL : NAVY);
  });
  header.height = temColunaProduto ? 54 : 20;
  r += 1;

  // Loja primeiro (na ordem da tela), e-commerce sempre no fim.
  const lojaRows = rows.filter((x) => x[RANKING_CANAL_FIELD] !== "ECOMMERCE");
  const ecomRows = rows.filter((x) => x[RANKING_CANAL_FIELD] === "ECOMMERCE");
  const ordered = [...lojaRows, ...ecomRows];

  // Máximo de cada coluna por produto (só vendedores) para o mapa de calor.
  const maxPorColuna = new Map<string, number>();
  for (const c of columns) {
    if (!isProdutoCol(c.key)) continue;
    maxPorColuna.set(c.key, Math.max(0, ...lojaRows.map((x) => num(x[c.key]) ?? 0)));
  }

  const firstDataRow = r;
  ordered.forEach((row, i) => {
    const xrow = ws.getRow(r);
    const ecommerce = row[RANKING_CANAL_FIELD] === "ECOMMERCE";
    const pos = num(row.POSICAO);
    columns.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const t = typeOf(c.key);
      const raw = row[c.key];
      const fmt = numFmtFor(c.key, t);
      if (c.key === "POSICAO" && ecommerce) {
        cell.value = "—";
      } else if (fmt) {
        cell.value = num(raw);
        cell.numFmt = fmt;
      } else {
        cell.value = raw == null ? "" : String(raw);
      }
      cell.alignment = {
        horizontal: c.key === "POSICAO" || isProdutoCol(c.key) ? "center" : fmt ? "right" : "left",
        vertical: "middle",
      };
      cell.border = BORDER_HAIR;
      cell.font = bodyFont({
        bold: c.key === "QTDE" || (pos != null && pos <= 3 && (c.key === "POSICAO" || c.key === "VENDEDOR")),
        italic: ecommerce,
        color: { argb: ecommerce ? MUTED : TEXT },
      });
      if (ecommerce) cell.fill = solid(ECOM_FILL);
      else if (i % 2 === 1) cell.fill = solid(ZEBRA);
      if (!ecommerce && isProdutoCol(c.key)) {
        const heat = heatFill(num(raw) ?? 0, maxPorColuna.get(c.key) ?? 0);
        if (heat) cell.fill = heat;
      }
      if (!ecommerce && pos != null && MEDAL[pos] && (c.key === "POSICAO" || c.key === "VENDEDOR")) {
        cell.fill = solid(MEDAL[pos]!);
      }
    });
    xrow.height = 17;
    r += 1;
  });
  const lastDataRow = r - 1;

  // ── TOTAL (fórmulas: recalculam se a pessoa filtrar/editar no Excel) ──
  const totalRow = ws.getRow(r);
  const colIdx = (key: string) => columns.findIndex((c) => c.key === key) + 1;
  const labelCol = colIdx("VENDEDOR") || 1;
  totalRow.getCell(labelCol).value = "TOTAL";
  const sumKeys = new Set(["QTDE", "FATURAMENTO", "TICKETS", "PARTICIPACAO"]);
  const range = (ci: number) => `${colLetter(ci)}${firstDataRow}:${colLetter(ci)}${lastDataRow}`;
  const sumOf = (key: string) => ordered.reduce((s, x) => s + (num(x[key]) ?? 0), 0);
  columns.forEach((c, i) => {
    const ci = i + 1;
    const cell = totalRow.getCell(ci);
    if (sumKeys.has(c.key) || isProdutoCol(c.key)) {
      cell.value = { formula: `SUM(${range(ci)})`, result: sumOf(c.key) };
    } else if (c.key === "PRECO_MEDIO" && colIdx("QTDE") && colIdx("FATURAMENTO")) {
      const q = `${colLetter(colIdx("QTDE"))}${r}`;
      const f = `${colLetter(colIdx("FATURAMENTO"))}${r}`;
      const qtd = sumOf("QTDE");
      cell.value = { formula: `IF(${q}=0,"",${f}/${q})`, result: qtd ? sumOf("FATURAMENTO") / qtd : "" };
    } else if (c.key === "PECAS_POR_TICKET" && colIdx("QTDE") && colIdx("TICKETS")) {
      const q = `${colLetter(colIdx("QTDE"))}${r}`;
      const t = `${colLetter(colIdx("TICKETS"))}${r}`;
      const tk = sumOf("TICKETS");
      cell.value = { formula: `IF(${t}=0,"",${q}/${t})`, result: tk ? sumOf("QTDE") / tk : "" };
    }
    const fmt = c.key === "POSICAO" ? null : numFmtFor(c.key, typeOf(c.key));
    if (fmt) cell.numFmt = isProdutoCol(c.key) ? "#,##0" : fmt;
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: NAVY } };
    cell.fill = solid(TOTAL_FILL);
    cell.border = { top: thin, bottom: { style: "double" as const } };
    cell.alignment = { horizontal: isProdutoCol(c.key) ? "center" : fmt ? "right" : "left", vertical: "middle" };
  });
  totalRow.height = 19;

  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: columns.length },
  };
  // Com colunas por produto a tabela fica larga: trava # e Vendedor ao rolar para o lado.
  if (temColunaProduto) {
    const xSplit = Math.max(colIdx("POSICAO"), colIdx("VENDEDOR"));
    if (xSplit > 0) ws.views = [{ state: "frozen", xSplit, ySplit: 0 }];
  }

  // ════════════════════════ Aba 2: Produtos ════════════════════════
  if (produtos.length > 0) {
    const pCols: Array<{ key: string; label: string; width: number; fmt?: string }> = [
      { key: "POSICAO", label: "#", width: 6, fmt: '0"º"' },
      { key: "PRODUTO", label: "Código", width: 14 },
      { key: "DESCRICAO", label: "Produto", width: 40 },
      { key: "QTDE", label: "Peças", width: 10, fmt: "#,##0" },
      { key: "PARTICIPACAO", label: "% das peças", width: 11, fmt: '0.0"%"' },
      { key: "FATURAMENTO", label: "Faturamento", width: 15, fmt: "R$ #,##0.00" },
      { key: "TICKETS", label: "Tickets", width: 9, fmt: "#,##0" },
      { key: "VENDEDORES", label: "Vendedores que venderam", width: 13, fmt: "#,##0" },
      { key: "DESTAQUE", label: "Vendedor destaque", width: 26 },
      { key: "DESTAQUE_QTDE", label: "Peças do destaque", width: 11, fmt: "#,##0" },
    ];
    const wp = workbook.addWorksheet("Produtos");
    wp.columns = pCols.map((c) => ({ width: c.width }));
    const next = writeTitle(wp, pCols.length, "Produtos — do mais vendido ao menos vendido", [contexto, filtroTxt]);
    const hRow = next + 1;
    pCols.forEach((c, i) => {
      const cell = wp.getRow(hRow).getCell(i + 1);
      cell.value = c.label;
      styleHeaderCell(cell, NAVY);
    });
    wp.getRow(hRow).height = 30;
    produtos.forEach((p, i) => {
      const xrow = wp.getRow(hRow + 1 + i);
      const pos = num(p.POSICAO) ?? i + 1;
      pCols.forEach((c, ci) => {
        const cell = xrow.getCell(ci + 1);
        cell.value = c.fmt ? num(p[c.key]) : String(p[c.key] ?? "");
        if (c.fmt) cell.numFmt = c.fmt;
        cell.font = bodyFont({ bold: c.key === "QTDE" });
        cell.border = BORDER_HAIR;
        cell.alignment = { horizontal: c.key === "POSICAO" ? "center" : c.fmt ? "right" : "left" };
        if (i % 2 === 1) cell.fill = solid(ZEBRA);
      });
      if (MEDAL[pos]) xrow.getCell(1).fill = solid(MEDAL[pos]!);
    });
    const tr = hRow + 1 + produtos.length;
    const totRow = wp.getRow(tr);
    totRow.getCell(3).value = "TOTAL";
    pCols.forEach((c, ci) => {
      if (!["QTDE", "PARTICIPACAO", "FATURAMENTO", "TICKETS"].includes(c.key)) return;
      const L = colLetter(ci + 1);
      totRow.getCell(ci + 1).value = {
        formula: `SUM(${L}${hRow + 1}:${L}${tr - 1})`,
        result: produtos.reduce((s, p) => s + (num(p[c.key]) ?? 0), 0),
      };
      totRow.getCell(ci + 1).numFmt = c.fmt;
    });
    for (let ci = 1; ci <= pCols.length; ci += 1) {
      const cell = totRow.getCell(ci);
      cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: NAVY } };
      cell.fill = solid(TOTAL_FILL);
      cell.border = { top: thin, bottom: { style: "double" as const } };
    }
    // Tickets do total = soma por produto (um ticket com 2 produtos conta nos dois).
    const nota = wp.getRow(tr + 1);
    nota.getCell(1).value =
      "Tickets por produto: um ticket com dois produtos filtrados conta nos dois — o total de tickets distintos está na aba Ranking.";
    wp.mergeCells(tr + 1, 1, tr + 1, pCols.length);
    nota.getCell(1).font = bodyFont({ italic: true, size: 9, color: { argb: MUTED } });
    wp.views = [{ state: "frozen", ySplit: hRow }];
    wp.autoFilter = { from: { row: hRow, column: 1 }, to: { row: hRow, column: pCols.length } };
  }

  // ════════════════════════ Aba 3: Vendedor × Produto ════════════════════════
  const vp = options.vendedorProduto ?? [];
  if (vp.length > 0 && !umProduto) {
    const vCols: Array<{ key: string; label: string; width: number; fmt?: string }> = [
      { key: "POSICAO", label: "# vendedor", width: 9, fmt: '0"º"' },
      { key: "VENDEDOR", label: "Vendedor", width: 26 },
      { key: "FILIAL", label: "Filial", width: 18 },
      { key: "PRODUTO", label: "Código", width: 14 },
      { key: "DESCRICAO", label: "Produto", width: 40 },
      { key: "QTDE", label: "Peças", width: 10, fmt: "#,##0" },
      { key: "FATURAMENTO", label: "Faturamento", width: 15, fmt: "R$ #,##0.00" },
      { key: "TICKETS", label: "Tickets", width: 9, fmt: "#,##0" },
    ];
    const wv = workbook.addWorksheet("Vendedor × Produto");
    wv.columns = vCols.map((c) => ({ width: c.width }));
    const next = writeTitle(wv, vCols.length, "Vendedor × Produto", [contexto, filtroTxt]);
    const hRow = next + 1;
    vCols.forEach((c, i) => {
      const cell = wv.getRow(hRow).getCell(i + 1);
      cell.value = c.label;
      styleHeaderCell(cell, NAVY);
    });
    wv.getRow(hRow).height = 20;
    // Faixa alternada POR VENDEDOR (não por linha): os produtos de cada um ficam juntos.
    let bloco = -1;
    let anterior = "";
    vp.forEach((x, i) => {
      const vend = String(x.VENDEDOR ?? "");
      const primeiraDoVendedor = vend !== anterior;
      if (primeiraDoVendedor) {
        bloco += 1;
        anterior = vend;
      }
      const ecommerce = x[RANKING_CANAL_FIELD] === "ECOMMERCE";
      const xrow = wv.getRow(hRow + 1 + i);
      vCols.forEach((c, ci) => {
        const cell = xrow.getCell(ci + 1);
        if (c.key === "POSICAO" && ecommerce) cell.value = "—";
        else cell.value = c.fmt ? num(x[c.key]) : String(x[c.key] ?? "");
        if (c.fmt) cell.numFmt = c.fmt;
        const repetido = !primeiraDoVendedor && (c.key === "VENDEDOR" || c.key === "FILIAL" || c.key === "POSICAO");
        cell.font = bodyFont({
          bold: c.key === "QTDE" || (primeiraDoVendedor && c.key === "VENDEDOR"),
          italic: ecommerce,
          color: { argb: repetido || ecommerce ? MUTED : TEXT },
        });
        cell.alignment = { horizontal: c.key === "POSICAO" ? "center" : c.fmt ? "right" : "left" };
        cell.border = primeiraDoVendedor ? { ...BORDER_HAIR, top: thin } : BORDER_HAIR;
        if (bloco % 2 === 1) cell.fill = solid(ZEBRA);
      });
    });
    wv.views = [{ state: "frozen", ySplit: hRow }];
    wv.autoFilter = { from: { row: hRow, column: 1 }, to: { row: hRow, column: vCols.length } };
  }

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = buildReportFilename({
    base: "ranking-vendedores",
    hint: options.fileHint ?? null,
    companyKey: options.companyKey,
    filialLabel: options.filialLabel,
    range: options.range,
  });
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

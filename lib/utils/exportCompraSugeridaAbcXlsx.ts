import type { ColumnType, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { COMPRA_FILIAL_COL_PREFIX } from "@/lib/reports/compra-sugerida-abc";
import { ROW_RUPTURA_FIELD } from "@/lib/reports/keys";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

type CellValue = string | number | boolean | null;

/** Minúsculo, sem acento, só letras/números separados por hífen — nome de arquivo limpo. */
function slugifyFilenamePart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Apelido curto pro nome do arquivo a partir dos filtros ativos: cada posição só entra
 * quando aquele filtro é ESPECÍFICO (exatamente 1 valor selecionado) — várias seleções ou
 * nenhuma ficam de fora, e o nome sai genérico. Ex.: fornecedor "Volt" sozinho → "volt";
 * grupo "CAPAS" sozinho → "capas". Usado por todos os exports de compra sugerida (Curva ABC
 * e Gerador de Relatórios) pra refletir o filtro aplicado sem virar um nome gigante.
 */
export function buildCompraSugeridaFileHint(singleValueFilters: Array<string | null | undefined>): string {
  return singleValueFilters
    .map((v) => (v ? slugifyFilenamePart(v) : ""))
    .filter(Boolean)
    .join("-");
}

function formatDateRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "-");
  return `${fmt(start)}_a_${fmt(end)}`;
}

/** Letra(s) da coluna do Excel a partir do número (1 → A, 27 → AA). */
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

/**
 * Papel da coluna no export "compra por loja":
 *  - filial: quantidade editável de uma loja (entra na soma da Compra total)
 *  - compraTotal: Compra total da linha = SOMA das colunas das lojas (fórmula)
 *  - custoTotal: Custo total = Custo unit. × Compra total (fórmula)
 *  - custoUnit: custo unitário (valor de referência)
 *  - value: coluna comum (texto/número), sai como valor cru
 */
export type CompraLojaRole = "filial" | "compraTotal" | "custoTotal" | "custoUnit" | "value";

export interface CompraLojaExportColumn {
  key: string;
  label: string;
  role: CompraLojaRole;
  /** Tipo p/ formatação (currency/int/...). filial→int, custoUnit/custoTotal→currency por padrão. */
  type?: ColumnType;
}

export interface CompraPorLojaExportOptions {
  /** Base do nome do arquivo. */
  fileLabel: string;
  companyKey: string;
  sheetName?: string;
  /** Linhas de contexto exibidas antes do cabeçalho (ex.: empresa · filtro · período). */
  titleLines?: string[];
  /** Período para o sufixo do nome do arquivo. */
  dateRange?: { startDate: Date; endDate: Date } | null;
  /**
   * Chave da coluna usada como categoria (ex.: GRUPO, LINHA): agrupa as linhas em blocos
   * contíguos (ordem de 1ª aparição na lista) com uma faixa de título entre eles — mesmo
   * visual do cabeçalho (fundo azul-escuro, texto branco). Sem isso, a lista sai "achatada",
   * na ordem em que os dados chegaram.
   */
  categoryKey?: string;
}

// Cores fixas do layout "compra por loja" (compartilhadas por todos os exports de compra
// sugerida — Curva ABC e Gerador de Relatórios).
const BANNER_FILL_ARGB = "FF1E3A5F";
const RUPTURA_ROW_FILL_ARGB = "FFF9D2E3";
const FILIAL_POSITIVE_FILL_ARGB = "FFD8EFCB";
const FILIAL_POSITIVE_FONT_ARGB = "FF1F6B34";
const FILIAL_ZERO_FONT_ARGB = "FFC0C6CC";
const TOTAL_CELL_FILL_ARGB = "FFF2F5F9";
const FOOTER_ROW_FILL_ARGB = "FFEDEFF3";

/**
 * Família = descrição até a primeira palavra com dígito, incluindo também a palavra anterior
 * quando ela é um marcador curto de modelo (≤3 letras, ex.: "IP" em "IP 17", "SG" em "SG S23")
 * — assim "IP16", "IP 17" e "SG S23" cortam no mesmo lugar ("CP COURO MAGSAFE"), com ou sem
 * espaço entre a marca e o número. Heurística best-effort para agrupar variantes do mesmo
 * produto adjacentes — não é regra de cadastro, só organização visual do export.
 */
function splitFamilyAndModel(descricao: string): { family: string; model: number | null } {
  const raw = String(descricao ?? "").trim();
  if (!raw) return { family: "", model: null };
  const words = raw.split(/\s+/);
  const idx = words.findIndex((w) => /\d/.test(w));
  if (idx <= 0) return { family: raw.toUpperCase(), model: null };

  const digits = words[idx].replace(/\D+/g, "");
  const model = digits ? parseInt(digits, 10) : null;

  let cut = idx;
  const prevWord = words[cut - 1];
  if (cut - 1 > 0 && prevWord && /^[A-Za-zÀ-ÿ]{1,3}$/.test(prevWord)) cut -= 1;

  const family = words.slice(0, cut).join(" ").toUpperCase();
  return { family: family || raw.toUpperCase(), model: Number.isFinite(model as number) ? model : null };
}

type PlanItem =
  | { kind: "banner"; label: string }
  | { kind: "row"; row: Record<string, CellValue> };

/**
 * Monta a ordem final de exibição: sem `categoryKey`, devolve tudo "achatado" na ordem
 * recebida (comportamento anterior). Com `categoryKey`, agrupa por categoria (ordem de 1ª
 * aparição, faixa de título antes de cada bloco) e, dentro dela: itens normais primeiro —
 * em blocos de "família" (ver `splitFamilyAndModel`) ordenados por custo unit. decrescente,
 * dentro da família por modelo crescente e depois por descrição (empate = ordem original,
 * sort estável) — e por fim os itens de ruptura (`ROW_RUPTURA_FIELD`), ordenados por Custo
 * total decrescente.
 */
function planRows(
  rows: Array<Record<string, CellValue>>,
  categoryKey: string | undefined,
  custoUnitKey: string | undefined,
  custoTotalKey: string | undefined
): PlanItem[] {
  if (!categoryKey) return rows.map((row) => ({ kind: "row", row }));

  const byCategory = new Map<string, Record<string, CellValue>[]>();
  for (const row of rows) {
    const cat = String(row[categoryKey] ?? "").trim() || "(sem grupo)";
    const arr = byCategory.get(cat) ?? [];
    arr.push(row);
    byCategory.set(cat, arr);
  }

  const plan: PlanItem[] = [];
  for (const [cat, catRows] of byCategory) {
    plan.push({ kind: "banner", label: cat });

    const normal = catRows.filter((r) => Number(r[ROW_RUPTURA_FIELD] ?? 0) !== 1);
    const ruptura = catRows.filter((r) => Number(r[ROW_RUPTURA_FIELD] ?? 0) === 1);

    const families = new Map<string, { rows: Record<string, CellValue>[]; maxCusto: number }>();
    for (const row of normal) {
      const { family } = splitFamilyAndModel(String(row.DESCRICAO ?? ""));
      const key = family || "—";
      const entry = families.get(key) ?? { rows: [], maxCusto: 0 };
      const custo = custoUnitKey ? Number(row[custoUnitKey] ?? 0) : 0;
      entry.maxCusto = Math.max(entry.maxCusto, custo);
      entry.rows.push(row);
      families.set(key, entry);
    }

    const orderedFamilies = Array.from(families.values()).sort((a, b) => b.maxCusto - a.maxCusto);
    for (const fam of orderedFamilies) {
      const withKeys = fam.rows.map((row, idx) => {
        const { model } = splitFamilyAndModel(String(row.DESCRICAO ?? ""));
        return { row, idx, model, desc: String(row.DESCRICAO ?? "").toUpperCase() };
      });
      withKeys.sort((a, b) => {
        const am = a.model ?? Number.POSITIVE_INFINITY;
        const bm = b.model ?? Number.POSITIVE_INFINITY;
        if (am !== bm) return am - bm;
        if (a.desc !== b.desc) return a.desc.localeCompare(b.desc, "pt-BR");
        return a.idx - b.idx; // empate real (mesmo modelo/descrição) → ordem original
      });
      for (const w of withKeys) plan.push({ kind: "row", row: w.row });
    }

    const rupturaSorted = [...ruptura].sort(
      (a, b) => Number((custoTotalKey ? b[custoTotalKey] : 0) ?? 0) - Number((custoTotalKey ? a[custoTotalKey] : 0) ?? 0)
    );
    for (const row of rupturaSorted) plan.push({ kind: "row", row });
  }
  return plan;
}

/**
 * Núcleo do export "compra por loja" com FÓRMULAS dinâmicas (ExcelJS — o genérico SheetJS só
 * escreve valores): Compra total = SOMA das colunas das lojas, Custo total = Custo unit. ×
 * Compra total, e uma linha TOTAL no rodapé. Editar a quantidade de qualquer loja recalcula
 * tudo no Excel. Reutilizado pelo Gerador de Relatórios e pela Curva ABC.
 */
export async function exportCompraPorLojaXlsx(
  rows: Array<Record<string, CellValue>>,
  columns: CompraLojaExportColumn[],
  options: CompraPorLojaExportOptions
): Promise<void> {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }
  if (columns.length === 0) {
    alert("Selecione ao menos uma coluna");
    return;
  }

  // Índices (1-based) das colunas especiais.
  const filialCols: number[] = [];
  let compraTotalCol = 0;
  let custoTotalCol = 0;
  let custoUnitCol = 0;
  const filialColSet = new Set<number>();
  columns.forEach((c, i) => {
    const n = i + 1;
    if (c.role === "filial") {
      filialCols.push(n);
      filialColSet.add(n);
    }
    else if (c.role === "compraTotal") compraTotalCol = n;
    else if (c.role === "custoTotal") custoTotalCol = n;
    else if (c.role === "custoUnit") custoUnitCol = n;
  });

  // Tipo efetivo p/ formatação por papel.
  const typeOf = (c: CompraLojaExportColumn): ColumnType | undefined => {
    if (c.role === "filial" || c.role === "compraTotal") return c.type ?? "int";
    if (c.role === "custoUnit" || c.role === "custoTotal") return c.type ?? "currency";
    return c.type;
  };

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

  const workbook = new ExcelJS.Workbook();
  const titleLines = options.titleLines ?? [];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet((options.sheetName ?? "Compra por loja").slice(0, 31), {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });

  // Larguras.
  ws.columns = columns.map((c) => {
    if (c.key === "DESCRICAO") return { width: 32 };
    if (c.key === "COR_DESCRICAO" || c.key === "COLECAO") return { width: 16 };
    if (typeOf(c) === "currency") return { width: 14 };
    return { width: 12 };
  });

  // ── Linhas de título (contexto), mescladas em toda a largura ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, columns.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 12 : 10, name: "Calibri", color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Cabeçalho ──
  const headerRow = ws.getRow(headerRowNum);
  columns.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label || c.key;
  });
  headerRow.height = 20;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANNER_FILL_ARGB } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });

  // ── Linhas de dados (agrupadas por categoria, se configurado) ──
  const custoUnitKeyName = custoUnitCol > 0 ? columns[custoUnitCol - 1].key : undefined;
  const custoTotalKeyName = custoTotalCol > 0 ? columns[custoTotalCol - 1].key : undefined;
  const plan = planRows(rows, options.categoryKey, custoUnitKeyName, custoTotalKeyName);

  plan.forEach((item, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);

    if (item.kind === "banner") {
      xrow.getCell(1).value = item.label;
      ws.mergeCells(r, 1, r, columns.length);
      xrow.height = 18;
      xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BANNER_FILL_ARGB } };
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
        cell.alignment = { horizontal: "left", vertical: "middle" };
      });
      return;
    }

    const row = item.row;
    const isRuptura = Number(row[ROW_RUPTURA_FIELD] ?? 0) === 1;

    columns.forEach((c, ci) => {
      const t = typeOf(c);
      const v = row[c.key];
      const cell = xrow.getCell(ci + 1);
      if (t === "text" || t === "dataVenda" || t === "date" || t === undefined) {
        cell.value = (v ?? "") as CellValue;
      } else {
        const num = Number(v);
        cell.value = Number.isFinite(num) ? num : 0;
      }
    });
    xrow.height = 15;

    // Compra total = soma das colunas das lojas desta linha (dinâmica no Excel).
    if (compraTotalCol > 0 && filialCols.length > 0) {
      xrow.getCell(compraTotalCol).value = {
        formula: filialCols.map((c) => `${colLetter(c)}${r}`).join("+"),
        result: Number(row[columns[compraTotalCol - 1].key] ?? 0),
      };
    }
    // Custo total = Custo unit. × Compra total (recalcula junto).
    if (custoTotalCol > 0 && custoUnitCol > 0 && compraTotalCol > 0) {
      xrow.getCell(custoTotalCol).value = {
        formula: `${colLetter(custoUnitCol)}${r}*${colLetter(compraTotalCol)}${r}`,
        result: Number(row[columns[custoTotalCol - 1].key] ?? 0),
      };
    }

    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
      const fmt = numFmtFor(typeOf(columns[colNum - 1]));
      if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      cell.font = { size: 10, name: "Calibri" };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };

      // Linha de ruptura (item que só apareceu na análise de Rupturas, não na lista
      // principal): fundo rosa na linha inteira. O positivo de loja continua marcado só
      // pela cor da fonte (não sobrepõe o rosa com o verde de destaque).
      if (isRuptura) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RUPTURA_ROW_FILL_ARGB } };
      }

      // Célula de loja: positivo = verde e negrito (+ fundo verde-claro fora de linha rosa);
      // zero = cinza-claro, sem destaque.
      if (filialColSet.has(colNum)) {
        const positive = Number(cell.value ?? 0) > 0;
        if (positive) {
          cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: FILIAL_POSITIVE_FONT_ARGB } };
          if (!isRuptura) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILIAL_POSITIVE_FILL_ARGB } };
          }
        } else {
          cell.font = { size: 10, name: "Calibri", color: { argb: FILIAL_ZERO_FONT_ARGB } };
        }
      }

      // Compra total / Custo total: fundo destacado + negrito (fora de linha rosa, que já
      // cobre a linha inteira).
      if ((colNum === compraTotalCol || colNum === custoTotalCol) && !isRuptura) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_CELL_FILL_ARGB } };
        cell.font = { bold: true, size: 10, name: "Calibri" };
      }
    });
  });

  // ── Linha TOTAL (rodapé) ──
  const lastDataRow = firstDataRow + plan.length - 1;
  const totalRowNum = lastDataRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";
  const sumCols = [...filialCols];
  if (compraTotalCol > 0) sumCols.push(compraTotalCol);
  if (custoTotalCol > 0) sumCols.push(custoTotalCol);
  for (const c of sumCols) {
    const L = colLetter(c);
    totalRow.getCell(c).value = { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})` };
  }
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const fmt = columns[colNum - 1] ? numFmtFor(typeOf(columns[colNum - 1])) : null;
    if (fmt) {
      cell.numFmt = fmt;
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FOOTER_ROW_FILL_ARGB } };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  });

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const rangePart = options.dateRange
    ? `-${formatDateRange(options.dateRange.startDate, options.dateRange.endDate)}`
    : "";
  a.download = `${slugifyFilenamePart(options.fileLabel)}-${options.companyKey}${rangePart}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Wrapper do Gerador de Relatórios: mapeia as colunas do preset (por chave) para os papéis
 * do núcleo e delega. Mantém a assinatura usada pela página do gerador.
 */
export async function exportCompraSugeridaAbcXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    reportLabel: string;
    companyKey: string;
    range: { startDate: Date; endDate: Date };
    sheetName?: string;
    columnTypes?: Record<string, ColumnType>;
  }
): Promise<void> {
  const types = options.columnTypes ?? {};
  const mapped: CompraLojaExportColumn[] = columns.map((c) => {
    if (c.key.startsWith(COMPRA_FILIAL_COL_PREFIX)) return { key: c.key, label: c.label, role: "filial", type: "int" };
    if (c.key === "COMPRA_TOTAL") return { key: c.key, label: c.label, role: "compraTotal", type: "int" };
    if (c.key === "CUSTO_TOTAL") return { key: c.key, label: c.label, role: "custoTotal", type: "currency" };
    if (c.key === "CUSTO_UNITARIO") return { key: c.key, label: c.label, role: "custoUnit", type: "currency" };
    return { key: c.key, label: c.label, role: "value", type: types[c.key] };
  });

  // Categoria = a 1ª coluna líder da empresa (GRUPO no NERD, LINHA no ScarfMe) — mesma
  // convenção de lib/reports/company-columns.ts. Código de barra (sempre anexado no fim
  // pelo runReport) volta pra logo depois da categoria — layout fixo deste export.
  const categoryKey = options.companyKey === "scarfme" ? "LINHA" : "GRUPO";
  const codigoBarraIdx = mapped.findIndex((c) => c.key === "CODIGO_BARRA");
  if (codigoBarraIdx > -1) {
    const [codigoBarraCol] = mapped.splice(codigoBarraIdx, 1);
    const categoryIdx = mapped.findIndex((c) => c.key === categoryKey);
    mapped.splice(categoryIdx > -1 ? categoryIdx + 1 : 0, 0, codigoBarraCol);
  }

  await exportCompraPorLojaXlsx(rows as Array<Record<string, CellValue>>, mapped, {
    fileLabel: options.reportLabel,
    companyKey: options.companyKey,
    sheetName: options.sheetName,
    dateRange: options.range,
    categoryKey,
  });
}

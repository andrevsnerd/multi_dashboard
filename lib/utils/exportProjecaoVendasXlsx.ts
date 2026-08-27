import type { ColumnType, ReportCellValue, ReportPresetColumn, ReportRow } from "@/lib/reports/types";
import { formatData, formatDataVenda, formatDiasAcabar, formatDiasParado } from "@/lib/reports/format";
import { ROW_COLECAO_COD_FIELD, ROW_COLECAO_DESC_FIELD } from "@/lib/reports/keys";
import {
  DIAS_ACABAR_EXCEDE,
  DIAS_ACABAR_SEM_GIRO,
  PROJECAO_MES_COL_PREFIX,
} from "@/lib/reports/projecao-vendas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
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

interface OutCol {
  label: string;
  key: string;
  type: ColumnType | undefined;
  /** Coluna de mês projetado (recebe a faixa e o heat-map de projeção). */
  isMes: boolean;
  get: (row: ReportRow) => ReportCellValue;
}

/**
 * Export estilizado (ExcelJS) da análise "Projeção de vendas".
 *
 * Mesma linguagem visual dos outros exports do Gerador (título + contexto, cabeçalho
 * escuro com autofiltro, painel congelado, zebra, formatos numéricos, linha TOTAL) mais
 * três coisas próprias desta análise:
 *
 *  1. FAIXA "Projeção mensal" acima do bloco de colunas de mês — deixa claro, de relance,
 *     onde termina a identidade do item e onde começa a projeção.
 *  2. HEAT-MAP nas células de mês: mês sem projeção fica apagado, mês com projeção fica
 *     azul suave e o ÚLTIMO mês com projeção (onde o estoque zera) sai destacado em âmbar
 *     — é a leitura "o estoque acaba aqui" sem precisar conferir a coluna de dias.
 *  3. Semáforo em "Dias p/ acabar" (urgência) e em "Confiança" (qualidade da estimativa).
 *     As sentinelas viram texto ("Sem giro", "Mais de N meses"); o resto sai como número,
 *     para continuar ordenável e filtrável no Excel.
 *
 * O congelamento horizontal para nas colunas antes do primeiro mês: você rola a projeção
 * para a direita sem perder de vista qual item é cada linha.
 */
export async function exportProjecaoVendasXlsx(
  rows: ReportRow[],
  columns: ReportPresetColumn[],
  options: {
    companyKey: string;
    /** Data-base da projeção (hoje) — vai no subtítulo e no nome do arquivo. */
    dataBase: Date;
    filialLabel?: string | null;
    sheetName?: string;
    columnTypes?: Record<string, ColumnType>;
    /** Meses da janela do ritmo (para o subtítulo explicar de onde veio o número). */
    janelaMeses: number;
    sazonalidade: boolean;
    /** true = projeção limitada pelo estoque; false = demanda pura (modo pré-compra). */
    considerarEstoque: boolean;
    /** Trecho opcional no nome do arquivo (ex.: nome do produto / categoria filtrada). */
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

  // ── Colunas de saída (mesma resolução dos outros exports: COLECAO vira 2 colunas;
  //    diasParado/dataVenda/date viram texto formatado). ──
  const outCols: OutCol[] = [];
  for (const colDef of columns) {
    const label = colDef.label || colDef.key;
    const t = typeOf(colDef.key);

    if (colDef.key === "COLECAO") {
      outCols.push({
        label,
        key: colDef.key,
        type: undefined,
        isMes: false,
        get: (row) => {
          const desc = row[ROW_COLECAO_DESC_FIELD];
          if (desc != null && String(desc).trim() !== "") return desc as ReportCellValue;
          return (row[ROW_COLECAO_COD_FIELD] ?? row.COLECAO ?? "") as ReportCellValue;
        },
      });
      outCols.push({
        label: "Cód. coleção",
        key: "COLECAO_COD",
        type: undefined,
        isMes: false,
        get: (row) => (row[ROW_COLECAO_COD_FIELD] ?? "") as ReportCellValue,
      });
      continue;
    }

    const get =
      t === "diasParado"
        ? (row: ReportRow) => formatDiasParado(row[colDef.key])
        : t === "dataVenda"
          ? (row: ReportRow) => formatDataVenda(row[colDef.key])
          : t === "date"
            ? (row: ReportRow) => formatData(row[colDef.key])
            : (row: ReportRow) => row[colDef.key] ?? "";

    outCols.push({
      label,
      key: colDef.key,
      type: t,
      isMes: colDef.key.startsWith(PROJECAO_MES_COL_PREFIX),
      get,
    });
  }

  const mesIdxs = outCols.map((c, i) => (c.isMes ? i : -1)).filter((i) => i >= 0);
  const primeiroMes = mesIdxs.length > 0 ? mesIdxs[0]! : -1;
  const ultimoMes = mesIdxs.length > 0 ? mesIdxs[mesIdxs.length - 1]! : -1;

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const titleLines = [
    "Projeção de vendas",
    `${options.filialLabel && options.filialLabel !== "todas-filiais" ? `Filial: ${options.filialLabel}  ·  ` : ""}Data-base ${fmtDate(options.dataBase)}  ·  ${rows.length.toLocaleString("pt-BR")} item(ns)`,
    `Ritmo: média dos ${options.janelaMeses} meses que terminam no último mês com venda de cada item  ·  Sazonalidade: ${options.sazonalidade ? "aplicada" : "não aplicada (ritmo plano)"}  ·  ${
      options.considerarEstoque
        ? "Projeção LIMITADA ao estoque atual (zera quando o estoque acaba), sem reposição"
        : "Projeção = DEMANDA do histórico, SEM teto de estoque (modo de análise pré-compra)"
    }`,
  ];
  // Faixa da projeção (uma linha, só quando há colunas de mês) logo acima do cabeçalho.
  const bandRowNum = primeiroMes >= 0 ? titleLines.length + 1 : 0;
  const headerRowNum = titleLines.length + (primeiroMes >= 0 ? 2 : 1);
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet((options.sheetName ?? "Projeção de vendas").slice(0, 31), {
    // Congela as linhas de título/cabeçalho e as colunas de identidade (tudo antes do 1º mês).
    views: [{ state: "frozen", ySplit: headerRowNum, xSplit: primeiroMes > 0 ? primeiroMes : 0 }],
  });

  // ── Larguras ──
  ws.columns = outCols.map((c) => {
    if (c.isMes) return { width: 9 };
    if (c.type === "currency") return { width: 14 };
    if (c.key === "DESCRICAO") return { width: 32 };
    if (c.key === "PRODUTO") return { width: 14 };
    if (c.key === "BASE_RITMO") return { width: 22 };
    if (c.key === "ORIGEM_RITMO") return { width: 22 };
    return { width: Math.min(30, Math.max(11, c.label.length + 2)) };
  });

  // ── Título ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, outCols.length);
    tr.getCell(1).font = {
      bold: i === 0,
      size: i === 0 ? 13 : 10,
      name: "Calibri",
      color: { argb: i === 0 ? "FF334155" : "FF64748B" },
    };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Faixa "Projeção mensal" sobre o bloco de meses ──
  if (bandRowNum > 0 && primeiroMes >= 0) {
    const band = ws.getRow(bandRowNum);
    band.height = 18;
    band.getCell(primeiroMes + 1).value = options.considerarEstoque
      ? "Projeção mensal (un) — até o estoque acabar"
      : "Demanda mensal projetada (un) — sem teto de estoque";
    if (ultimoMes > primeiroMes) {
      ws.mergeCells(bandRowNum, primeiroMes + 1, bandRowNum, ultimoMes + 1);
    }
    const bandCell = band.getCell(primeiroMes + 1);
    bandCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    bandCell.font = { bold: true, size: 10, name: "Calibri", color: { argb: "FFFFFFFF" } };
    bandCell.alignment = { horizontal: "center", vertical: "middle" };
  }

  // ── Cabeçalho ──
  const headerRow = ws.getRow(headerRowNum);
  outCols.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label;
  });
  headerRow.height = 22;
  headerRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const isMes = outCols[colNum - 1]?.isMes ?? false;
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: isMes ? "FF1D4ED8" : "FF1E3A5F" },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: "Calibri" };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: outCols.length },
  };

  // ── Paleta ──
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF6F8FB" } };
  const HAIR_BORDER = {
    top: { style: "hair" as const }, left: { style: "hair" as const },
    bottom: { style: "hair" as const }, right: { style: "hair" as const },
  };
  const MES_VAZIO = { fill: "FFF8FAFC", font: "FFCBD5E1" };
  const MES_ATIVO = { fill: "FFEAF2FE", font: "FF1E40AF" };
  const MES_ACABA = { fill: "FFFEF3C7", font: "FF92400E" }; // âmbar: o estoque zera aqui
  /** Semáforo de urgência da coluna "Dias p/ acabar". */
  const urgencia = (dias: number) => {
    if (dias >= DIAS_ACABAR_SEM_GIRO) return { fill: "FFF1F5F9", font: "FF94A3B8", bold: false };
    if (dias >= DIAS_ACABAR_EXCEDE) return { fill: "FFEFF6FF", font: "FF475569", bold: false };
    if (dias <= 30) return { fill: "FFFDE8E8", font: "FFB91C1C", bold: true };
    if (dias <= 60) return { fill: "FFFFF1E0", font: "FFC2410C", bold: true };
    if (dias <= 90) return { fill: "FFFEF9C3", font: "FF854D0E", bold: false };
    return { fill: "FFEAF7EE", font: "FF166534", bold: false };
  };
  const CONFIANCA_TOM: Record<string, { fill: string; font: string }> = {
    Alta: { fill: "FFEAF7EE", font: "FF166534" },
    Média: { fill: "FFFEF9C3", font: "FF854D0E" },
    Baixa: { fill: "FFF1F5F9", font: "FF64748B" },
  };

  // ── Linhas de dados ──
  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    xrow.height = 16;

    // Último mês com projeção > 0 desta linha: é onde o estoque zera.
    let mesFinalIdx = -1;
    for (const ci of mesIdxs) {
      const n = Number(outCols[ci]!.get(row));
      if (Number.isFinite(n) && n > 0) mesFinalIdx = ci;
    }

    outCols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const raw = c.get(row);
      const t = c.type;

      // ── Valor ──
      if (t === "diasAcabar") {
        const n = Number(raw);
        // Sentinela vira texto; dia real continua número (ordenável/filtrável no Excel).
        cell.value = Number.isFinite(n) && n < DIAS_ACABAR_EXCEDE ? n : formatDiasAcabar(raw);
      } else if (t === "currency" || t === "int" || t === "number" || t === "percent") {
        const num = Number(raw);
        cell.value = Number.isFinite(num) ? num : 0;
      } else {
        cell.value = (raw ?? "") as string | number;
      }

      // ── Formato numérico + alinhamento ──
      const fmt = t === "diasAcabar" ? "#,##0" : numFmtFor(t);
      if (fmt) {
        cell.numFmt = fmt;
        cell.alignment = { horizontal: "right", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "left", vertical: "middle" };
      }
      if (c.isMes) cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = HAIR_BORDER;

      // ── Cor ──
      if (c.isMes) {
        const n = Number(raw);
        const v = Number.isFinite(n) ? n : 0;
        const tone = v <= 0 ? MES_VAZIO : ci === mesFinalIdx ? MES_ACABA : MES_ATIVO;
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
        cell.font = {
          size: 10,
          name: "Calibri",
          bold: ci === mesFinalIdx && v > 0,
          color: { argb: tone.font },
        };
      } else if (t === "diasAcabar") {
        const n = Number(raw);
        const tone = urgencia(Number.isFinite(n) ? n : DIAS_ACABAR_SEM_GIRO);
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
        cell.font = { size: 10, name: "Calibri", bold: tone.bold, color: { argb: tone.font } };
      } else if (c.key === "CONFIANCA") {
        const tone = CONFIANCA_TOM[String(raw ?? "")] ?? null;
        if (tone) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
          cell.font = { size: 10, name: "Calibri", color: { argb: tone.font } };
        } else {
          cell.font = { size: 10, name: "Calibri" };
          if (i % 2 === 1) cell.fill = ZEBRA_FILL;
        }
      } else {
        cell.font = { size: 10, name: "Calibri" };
        if (i % 2 === 1) cell.fill = ZEBRA_FILL;
      }
    });
  });

  // ── Linha TOTAL: soma os meses e as colunas de quantidade/valor (não médias) ──
  const SOMAVEIS = new Set([
    "ESTOQUE_REDE",
    "VALOR_ESTOQUE",
    "QTDE_3M",
    "QTDE_12M",
    "BASE_QTDE",
    "PROJECAO_TOTAL",
    "SOBRA_HORIZONTE",
  ]);
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRowNum = lastDataRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";
  outCols.forEach((c, i) => {
    if (!c.isMes && !SOMAVEIS.has(c.key)) return;
    const L = colLetter(i + 1);
    const sum = rows.reduce((s, row) => {
      const n = Number(c.get(row));
      return s + (Number.isFinite(n) ? n : 0);
    }, 0);
    totalRow.getCell(i + 1).value = {
      formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`,
      result: sum,
    };
  });
  totalRow.height = 18;
  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    const c = outCols[colNum - 1];
    if (c && (c.isMes || SOMAVEIS.has(c.key))) {
      cell.numFmt = c.type === "currency" ? "R$ #,##0.00" : "#,##0";
      cell.alignment = { horizontal: c.isMes ? "center" : "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: "FF1E3A5F" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  });

  // ── Legenda (fecha o arquivo explicando as cores e a regra do ritmo) ──
  const legendaRow = totalRowNum + 2;
  const legenda = ws.getRow(legendaRow);
  legenda.getCell(1).value =
    (options.considerarEstoque
      ? "Legenda: célula azul = venda projetada no mês · célula âmbar = mês em que o estoque zera · célula apagada = sem projeção.  "
      : "Legenda: célula azul = demanda projetada no mês (sem teto de estoque) · célula apagada = sem demanda.  ") +
    "Ritmo = média mensal da janela que termina no último mês COM venda do item (meses zerados no meio da janela contam; " +
    "os posteriores viram \"Parado há (meses)\").  Estoque considera só saldos positivos.  " +
    "Demanda 12 meses e Falta p/ atender NUNCA usam teto de estoque — são os mesmos números nos dois modos.";
  ws.mergeCells(legendaRow, 1, legendaRow, Math.max(1, outCols.length));
  legenda.getCell(1).font = { size: 9, name: "Calibri", color: { argb: "FF64748B" }, italic: true };
  legenda.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
  legenda.height = 28;

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const hintPart = options.fileHint ? `-${safeFilenamePart(options.fileHint)}` : "";
  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const dataPart = options.dataBase
    .toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
    .replace(/\//g, "-");
  a.download = `projecao-vendas-${options.companyKey}${filialPart}${hintPart}-${dataPart}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

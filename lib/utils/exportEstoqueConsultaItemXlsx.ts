// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

export interface EstoqueConsultaExportRow {
  produto: string;
  descricao: string;
  cor: string;
  linha: string;
  subgrupo: string;
  grade: string;
  colecao: string;
  total: number;
  porFilial: Record<string, number>;
  /**
   * Rótulo do tamanho (P/M/G) quando a linha é a quebra de um item; vazio/ausente na
   * linha agrupada. É por essa coluna que o rodapé TOTAL soma só as agrupadas — sem
   * isso a quebra entraria em dobro no total.
   */
  tamanho?: string;
}

export interface ExportEstoqueConsultaItemOptions {
  companyKey: string;
  companyName: string;
  filialLabel?: string | null;
  filtrosResumo?: string;
  rows: EstoqueConsultaExportRow[];
  filiaisColumns: string[];
}

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

/**
 * Export estilizado (ExcelJS) da página "Estoque Consulta" (item × cor × filial):
 * cabeçalho escuro com autofiltro, linhas zebradas, negativos em vermelho e uma linha
 * TOTAL somando o estoque total e cada filial. Mesma linguagem visual dos demais exports
 * do app ([lib/utils/exportClientesFilialXlsx.ts], [lib/utils/exportCompraSugeridaAbcXlsx.ts]).
 */
export async function exportEstoqueConsultaItemXlsx(
  options: ExportEstoqueConsultaItemOptions
): Promise<void> {
  const { rows, filiaisColumns, companyKey } = options;
  const isScarfme = companyKey === "scarfme";

  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;

  const workbook = new ExcelJS.Workbook();

  // A coluna Tamanho só entra quando há quebra por tamanho (grade P/M/G) — nos demais
  // casos o export sai exatamente como sempre foi.
  const temTamanhos = rows.some((row) => Boolean(row.tamanho));

  const fixedCols: Array<{ key: keyof EstoqueConsultaExportRow; label: string; width: number }> = [
    { key: "produto", label: "Código", width: 12 },
    { key: "descricao", label: "Descrição", width: 30 },
    { key: "cor", label: "Cor", width: 14 },
    { key: "linha", label: "Linha", width: 16 },
    { key: "subgrupo", label: "Subgrupo", width: 16 },
    ...(isScarfme
      ? ([
          { key: "grade" as const, label: "Grade", width: 12 },
          ...(temTamanhos ? [{ key: "tamanho" as const, label: "Tamanho", width: 10 }] : []),
          { key: "colecao" as const, label: "Coleção", width: 14 },
        ])
      : []),
  ];

  const tamanhoColPos = fixedCols.findIndex((c) => c.key === "tamanho");
  const tamanhoColIndex = tamanhoColPos >= 0 ? tamanhoColPos + 1 : 0;
  const totalColIndex = fixedCols.length + 1;
  const filialStartIndex = totalColIndex + 1;
  const columnCount = filialStartIndex + filiaisColumns.length - 1;

  const titleLines = [
    "Estoque Consulta",
    `${options.companyName}  ·  Filial: ${options.filialLabel ?? "Todas"}  ·  ${rows
      .filter((row) => !row.tamanho)
      .length.toLocaleString("pt-BR")} item(ns)`,
    ...(options.filtrosResumo ? [options.filtrosResumo] : []),
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet("Estoque consulta", {
    views: [{ state: "frozen", ySplit: headerRowNum }],
  });

  ws.columns = [
    ...fixedCols.map((c) => ({ width: c.width })),
    { width: 14 },
    ...filiaisColumns.map((f) => ({ width: Math.min(16, Math.max(10, f.length + 2)) })),
  ];

  // ── Linhas de título ──
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, columnCount);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 10, name: "Calibri", color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // ── Cabeçalho ──
  const headerRow = ws.getRow(headerRowNum);
  fixedCols.forEach((c, i) => {
    headerRow.getCell(i + 1).value = c.label;
  });
  headerRow.getCell(totalColIndex).value = "Estoque total";
  filiaisColumns.forEach((f, i) => {
    headerRow.getCell(filialStartIndex + i).value = f;
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
    to: { row: headerRowNum, column: columnCount },
  };

  // ── Linhas de dados ──
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F6FA" } };
  // Mesma "pegada" de destaque do export de compra sugerida / compra ideal
  // ([lib/utils/exportCompraSugeridaAbcXlsx.ts]): fundo pastel + fonte escura da mesma
  // matiz em negrito. Aqui a paleta muda conforme o caso:
  //   · filial positiva  → verde
  //   · Estoque total    → amarelo (destaca a coluna consolidada)
  //   · negativo         → vermelho/rosa
  //   · zero             → cinza-claro, sem fundo
  const GREEN_TONE = { fill: "FFD8EFCB", font: "FF1F6B34" };
  const YELLOW_TONE = { fill: "FFF9F2C1", font: "FF8A6A0B" };
  const RED_TONE = { fill: "FFFAD3DC", font: "FFB01138" };
  const ZERO_FONT_ARGB = "FFC0C6CC";

  /**
   * Pinta uma célula de quantidade conforme o sinal. `positiveTone` é a paleta usada
   * quando o valor é positivo (verde nas filiais, amarelo no Estoque total).
   */
  const paintQtyCell = (
    cell: ExcelJSCell,
    value: number,
    positiveTone: { fill: string; font: string }
  ) => {
    if (value === 0) {
      cell.font = { size: 10, name: "Calibri", color: { argb: ZERO_FONT_ARGB } };
      return;
    }
    const tone = value > 0 ? positiveTone : RED_TONE;
    cell.font = { bold: true, size: 10, name: "Calibri", color: { argb: tone.font } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
  };

  rows.forEach((row, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);

    fixedCols.forEach((c, ci) => {
      const raw = (row[c.key] as string) || "";
      // Célula de Tamanho fica REALMENTE vazia na linha agrupada: é o que o SUMIF do
      // rodapé usa para somar só as agrupadas e ignorar as quebras.
      if (c.key === "tamanho" && !raw) return;
      xrow.getCell(ci + 1).value = raw;
    });

    const totalCell = xrow.getCell(totalColIndex);
    totalCell.value = row.total;
    totalCell.numFmt = "#,##0";
    totalCell.alignment = { horizontal: "right", vertical: "middle" };
    paintQtyCell(totalCell, row.total, YELLOW_TONE);

    filiaisColumns.forEach((f, fi) => {
      const value = row.porFilial[f] ?? 0;
      const cell = xrow.getCell(filialStartIndex + fi);
      cell.value = value;
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right", vertical: "middle" };
      paintQtyCell(cell, value, GREEN_TONE);
    });

    xrow.height = 16;
    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
      if (!cell.font) cell.font = { size: 10, name: "Calibri" };
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      // Zebra só onde não há destaque: o verde do positivo não pode ser sobrescrito.
      if (i % 2 === 1 && !cell.fill) {
        const existingFont = cell.font;
        cell.fill = ZEBRA_FILL;
        cell.font = existingFont;
      }
    });
  });

  // ── Linha TOTAL (rodapé) ──
  const lastDataRow = firstDataRow + rows.length - 1;
  const totalRowNum = lastDataRow + 1;
  const totalRow = ws.getRow(totalRowNum);
  totalRow.getCell(1).value = "TOTAL";

  // Com quebra por tamanho as linhas de P/M/G repetem o mesmo estoque da agrupada, então
  // o rodapé soma só onde a coluna Tamanho está vazia (= linhas agrupadas).
  const agrupadas = rows.filter((row) => !row.tamanho);
  const tamanhoRange =
    tamanhoColIndex > 0
      ? `${colLetter(tamanhoColIndex)}${firstDataRow}:${colLetter(tamanhoColIndex)}${lastDataRow}`
      : null;
  const somaFormula = (L: string) =>
    tamanhoRange
      ? `SUMIF(${tamanhoRange},"",${L}${firstDataRow}:${L}${lastDataRow})`
      : `SUM(${L}${firstDataRow}:${L}${lastDataRow})`;

  const totalColLetter = colLetter(totalColIndex);
  totalRow.getCell(totalColIndex).value = {
    formula: somaFormula(totalColLetter),
    result: agrupadas.reduce((s, row) => s + row.total, 0),
  };

  filiaisColumns.forEach((f, fi) => {
    const col = filialStartIndex + fi;
    const L = colLetter(col);
    totalRow.getCell(col).value = {
      formula: somaFormula(L),
      result: agrupadas.reduce((s, row) => s + (row.porFilial[f] ?? 0), 0),
    };
  });

  totalRow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell, colNum: number) => {
    if (colNum === totalColIndex || colNum >= filialStartIndex) {
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "right", vertical: "middle" };
    }
    cell.font = { bold: true, size: 10, name: "Calibri" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEFF3" } };
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
  const dateStr = new Date().toISOString().split("T")[0];
  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  a.download = `estoque-consulta-item-${companyKey}${filialPart}-${dateStr}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

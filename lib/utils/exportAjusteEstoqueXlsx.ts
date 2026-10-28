// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ExcelJSCell = any;

export interface AjusteExportItem {
  produto: string;
  descProduto: string;
  cor: string;
  descCor: string;
  qtde: number;
  saldoAnterior?: number | null;
  saldoFinal?: number | null;
}

export interface AjusteExportKpis {
  fonte: "snapshot" | "contagem" | "movimento" | "ajuste";
  modo: "inventario" | "zerar" | null;
  totais: {
    itens: number | null;
    comDiferenca: number;
    positivos: number;
    negativos: number;
    somaDelta: number;
    saldoAtualTotal: number | null;
    saldoFinalTotal: number | null;
    itensSaldoNegativo: number | null;
  };
  unidadesEntrada?: number;
  unidadesSaida?: number;
  naoEncontrados: number;
  ambiguos: number;
  invalidas: number;
}

export interface ExportAjusteEstoqueOptions {
  companyKey: string;
  companyName: string;
  nome: string;
  filial: string;
  /** Data como gravada no Linx (ISO); exibida sem conversão de fuso. */
  emissao: string;
  responsavel?: string;
  kpis: AjusteExportKpis | null;
  itens: AjusteExportItem[];
}

const FONTE_LABEL: Record<AjusteExportKpis["fonte"], string> = {
  snapshot: "Saldos guardados no momento do ajuste.",
  contagem: "Saldos lidos da contagem física registrada no Linx.",
  movimento:
    "Saldos reconstruídos pelos movimentos do Linx (estoque atual − o que entrou e saiu depois do ajuste), só dos itens ajustados.",
  ajuste: "Saldos e escopo não foram guardados para este ajuste — o Linx só grava os itens com diferença.",
};

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function fmtDataLinx(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

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
 * Export estilizado (ExcelJS) de um ajuste de estoque já feito (inventário, zerar
 * filial ou ajuste de item), numa aba só: cabeçalho com filial/data/responsável,
 * bloco "Resumo" com os mesmos KPIs da tela e a tabela item a item (saldo anterior,
 * ajuste, saldo após) com linha TOTAL. Mesma linguagem visual de
 * [lib/utils/exportEstoqueConsultaItemXlsx.ts].
 */
export async function exportAjusteEstoqueXlsx(options: ExportAjusteEstoqueOptions): Promise<void> {
  const { itens, kpis } = options;
  if (itens.length === 0) {
    alert("Não há itens para exportar");
    return;
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const comSaldo = itens.some((it) => it.saldoFinal != null);
  const cols: Array<{ key: string; label: string; width: number; num?: boolean }> = [
    { key: "produto", label: "Produto", width: 14 },
    { key: "descProduto", label: "Descrição", width: 42 },
    { key: "cor", label: "Cor", width: 20 },
    ...(comSaldo ? [{ key: "saldoAnterior", label: "Saldo anterior", width: 15, num: true }] : []),
    { key: "qtde", label: "Ajuste", width: 12, num: true },
    ...(comSaldo ? [{ key: "saldoFinal", label: "Saldo após", width: 13, num: true }] : []),
    { key: "tipo", label: "Movimento", width: 13 },
  ];
  const columnCount = cols.length;
  const colIndex = (key: string) => cols.findIndex((c) => c.key === key) + 1;

  const ws = workbook.addWorksheet("Ajuste", {
    pageSetup: { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = cols.map((c) => ({ width: c.width }));

  const FONT = "Calibri";
  const SLATE = "FF334155";
  const MUTED = "FF64748B";
  const NAVY = "FF1E3A5F";
  const GREEN_TONE = { fill: "FFD8EFCB", font: "FF1F6B34" };
  const RED_TONE = { fill: "FFFAD3DC", font: "FFB01138" };
  const ZEBRA_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F6FA" } };
  const LABEL_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFEDEFF3" } };

  let rowNum = 1;
  const textLine = (text: string, font: Record<string, unknown>, height?: number) => {
    const r = ws.getRow(rowNum);
    r.getCell(1).value = text;
    ws.mergeCells(rowNum, 1, rowNum, columnCount);
    r.getCell(1).font = { name: FONT, ...font };
    r.getCell(1).alignment = { horizontal: "left", vertical: "middle", wrapText: true };
    if (height) r.height = height;
    rowNum++;
  };

  // ── Cabeçalho ──
  const tipo = kpis?.modo === "inventario" ? "Inventário" : kpis?.modo === "zerar" ? "Zerar filial" : "Ajuste";
  textLine(`Ajuste de Estoque · ${options.nome}`, { bold: true, size: 14, color: { argb: NAVY } }, 22);
  textLine(
    [
      options.companyName,
      `Filial: ${options.filial || "—"}`,
      `Data: ${options.emissao ? fmtDataLinx(options.emissao) : "—"}`,
      ...(options.responsavel ? [`Responsável: ${options.responsavel}`] : []),
      `Tipo: ${tipo}`,
    ].join("  ·  "),
    { size: 10, color: { argb: SLATE } }
  );
  textLine(`Gerado em ${new Date().toLocaleString("pt-BR")}`, { size: 9, italic: true, color: { argb: MUTED } });
  rowNum++;

  // ── Resumo (rótulo em A:B, valor em C) ──
  textLine("Resumo", { bold: true, size: 11, color: { argb: NAVY } });
  const t = kpis?.totais;
  const somaDelta = t?.somaDelta ?? itens.reduce((s, it) => s + it.qtde, 0);
  const unidadesEntrada = kpis?.unidadesEntrada ?? itens.reduce((s, it) => s + Math.max(0, it.qtde), 0);
  const unidadesSaida = kpis?.unidadesSaida ?? itens.reduce((s, it) => s + Math.max(0, -it.qtde), 0);
  const resumo: Array<[string, number | null, "pos" | "neg" | "delta" | null]> = [
    ["Saldo anterior (total)", t?.saldoAtualTotal ?? null, null],
    ["Saldo final após ajuste", t?.saldoFinalTotal ?? null, null],
    ["Variação líquida (un)", somaDelta, "delta"],
    ["Itens no escopo", t?.itens ?? null, null],
    ["Itens com diferença", t?.comDiferenca ?? itens.filter((it) => it.qtde !== 0).length, null],
    ["Itens com entrada (+)", t?.positivos ?? itens.filter((it) => it.qtde > 0).length, "pos"],
    ["Itens com saída (−)", t?.negativos ?? itens.filter((it) => it.qtde < 0).length, "neg"],
    ["Unidades que entraram", unidadesEntrada, "pos"],
    ["Unidades que saíram", unidadesSaida, "neg"],
  ];
  for (const [label, valor, tom] of resumo) {
    const r = ws.getRow(rowNum);
    ws.mergeCells(rowNum, 1, rowNum, 2);
    const lc = r.getCell(1);
    lc.value = label;
    lc.font = { name: FONT, size: 10, color: { argb: SLATE } };
    lc.fill = LABEL_FILL;
    lc.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    const vc = r.getCell(3);
    vc.value = valor ?? "—";
    vc.numFmt = tom === "delta" ? "+#,##0;-#,##0;0" : "#,##0";
    vc.alignment = { horizontal: "right", vertical: "middle" };
    const cor =
      valor == null || valor === 0
        ? SLATE
        : tom === "pos" || (tom === "delta" && valor > 0)
          ? GREEN_TONE.font
          : tom === "neg" || (tom === "delta" && valor < 0)
            ? RED_TONE.font
            : SLATE;
    vc.font = { name: FONT, size: 10, bold: true, color: { argb: cor } };
    for (const c of [1, 2, 3]) {
      r.getCell(c).border = { top: { style: "hair" }, bottom: { style: "hair" } };
    }
    r.height = 17;
    rowNum++;
  }

  // ── Observações ──
  const notas: string[] = [];
  if (kpis) notas.push(FONTE_LABEL[kpis.fonte]);
  if (kpis?.naoEncontrados) notas.push(`⚠ ${kpis.naoEncontrados} código(s) do arquivo não encontrado(s).`);
  if (kpis?.ambiguos) notas.push(`⚠ ${kpis.ambiguos} código(s) ambíguo(s) — ignorado(s).`);
  if (kpis?.invalidas) notas.push(`⚠ ${kpis.invalidas} linha(s) inválida(s) no arquivo.`);
  if (t?.itensSaldoNegativo) {
    notas.push(`ℹ ${t.itensSaldoNegativo} item(ns) estavam com saldo negativo antes do ajuste.`);
  }
  if (notas.length > 0) {
    rowNum++;
    for (const n of notas) textLine(n, { size: 9, italic: true, color: { argb: MUTED } });
  }
  rowNum++;

  // ── Tabela de itens ──
  const headerRowNum = rowNum;
  const headerRow = ws.getRow(headerRowNum);
  cols.forEach((c, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = c.label;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10, name: FONT };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  headerRow.height = 20;
  ws.autoFilter = {
    from: { row: headerRowNum, column: 1 },
    to: { row: headerRowNum, column: columnCount },
  };
  ws.views = [{ state: "frozen", ySplit: headerRowNum }];

  // Maiores movimentos primeiro (o que mais pesou no ajuste aparece no topo).
  const ordenados = [...itens].sort(
    (a, b) => Math.abs(b.qtde) - Math.abs(a.qtde) || a.produto.localeCompare(b.produto)
  );
  const firstDataRow = headerRowNum + 1;
  ordenados.forEach((it, i) => {
    const xrow = ws.getRow(firstDataRow + i);
    const values: Record<string, string | number | null> = {
      produto: it.produto,
      descProduto: it.descProduto,
      cor: it.descCor ? `${it.cor} · ${it.descCor}` : it.cor,
      saldoAnterior: it.saldoAnterior ?? null,
      qtde: it.qtde,
      saldoFinal: it.saldoFinal ?? null,
      tipo: it.qtde > 0 ? "Entrada" : it.qtde < 0 ? "Saída" : "—",
    };
    cols.forEach((c, ci) => {
      const cell = xrow.getCell(ci + 1);
      const v = values[c.key];
      if (v != null) cell.value = v;
      cell.font = { size: 10, name: FONT };
      if (c.num) {
        cell.numFmt = c.key === "qtde" ? "+#,##0;-#,##0;0" : "#,##0";
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
    });

    const tone = it.qtde > 0 ? GREEN_TONE : it.qtde < 0 ? RED_TONE : null;
    if (tone) {
      for (const key of ["qtde", "tipo"]) {
        const cell = xrow.getCell(colIndex(key));
        cell.font = { bold: true, size: 10, name: FONT, color: { argb: tone.font } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fill } };
      }
    }
    if (comSaldo && (it.saldoFinal ?? 0) < 0) {
      xrow.getCell(colIndex("saldoFinal")).font = {
        bold: true, size: 10, name: FONT, color: { argb: RED_TONE.font },
      };
    }

    xrow.height = 16;
    xrow.eachCell({ includeEmpty: true }, (cell: ExcelJSCell) => {
      cell.border = {
        top: { style: "hair" }, left: { style: "hair" },
        bottom: { style: "hair" }, right: { style: "hair" },
      };
      if (i % 2 === 1 && !cell.fill) cell.fill = ZEBRA_FILL;
    });
  });

  // ── Linha TOTAL ──
  const lastDataRow = firstDataRow + ordenados.length - 1;
  const totalRow = ws.getRow(lastDataRow + 1);
  totalRow.getCell(1).value = "TOTAL";
  totalRow.getCell(2).value = `${ordenados.length.toLocaleString("pt-BR")} item(ns)`;
  const somaCol = (key: string, result: number) => {
    const ci = colIndex(key);
    const L = colLetter(ci);
    const cell = totalRow.getCell(ci);
    cell.value = { formula: `SUM(${L}${firstDataRow}:${L}${lastDataRow})`, result };
    cell.numFmt = key === "qtde" ? "+#,##0;-#,##0;0" : "#,##0";
    cell.alignment = { horizontal: "right", vertical: "middle" };
  };
  if (comSaldo) somaCol("saldoAnterior", ordenados.reduce((s, it) => s + (it.saldoAnterior ?? 0), 0));
  somaCol("qtde", ordenados.reduce((s, it) => s + it.qtde, 0));
  if (comSaldo) somaCol("saldoFinal", ordenados.reduce((s, it) => s + (it.saldoFinal ?? 0), 0));
  for (let c = 1; c <= columnCount; c++) {
    const cell = totalRow.getCell(c);
    cell.font = { bold: true, size: 10, name: FONT };
    cell.fill = LABEL_FILL;
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  }

  // ── Download ──
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const dataPart = options.emissao ? options.emissao.slice(0, 10) : new Date().toISOString().slice(0, 10);
  a.download = `ajuste-estoque-${options.companyKey}-${safeFilenamePart(options.nome)}-${dataPart}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

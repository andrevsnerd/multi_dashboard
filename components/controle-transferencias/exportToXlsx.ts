// Export XLSX do Controle de Transferências (ExcelJS).
//
// Três camadas, cada uma para um uso:
//  1. "Resumo"           — KPIs + matriz Origem × Destino (quanto sai de onde para onde).
//  2. Uma aba por ORIGEM — pick list de conferência: blocos por destino, subtotais,
//     coluna "Conferido" com dropdown e página já formatada para impressão.
//  3. "Base (dinâmica)"  — tabela plana com autofiltro, pronta para tabela dinâmica.
//
// Estilo alinhado com os outros exports do dashboard (ver exportDistribuicaoMatriz.ts).

import type { CompanyKey } from "@/lib/config/company";

export interface TransferXlsxItem {
  produto: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  cor: string;
  curva?: string;
  origem: string;
  destino: string;
  quantidade: number;
  estoqueOrigem?: number;
  estoqueDestino?: number;
  vendas30dOrigem?: number;
  vendas30dDestino?: number;
}

export interface TransferXlsxGroup {
  origem: string;
  totalQuantidade: number;
  destinationGroups: {
    destino: string;
    totalQuantidade: number;
    items: TransferXlsxItem[];
  }[];
}

// ── Paleta ──────────────────────────────────────────────────────────────────
const NAVY = "FF1E3A5F";
const NAVY_SOFT = "FF334155";
const GREEN = "FF16A34A";
const GREEN_SOFT = "FFDCFCE7";
const GREEN_TEXT = "FF15803D";
const AMBER_SOFT = "FFFEF3C7";
const AMBER_TEXT = "FFB45309";
const SLATE_SOFT = "FFF1F5F9";
const SLATE_TEXT = "FF64748B";
const INK = "FF1E293B";
const ZEBRA = "FFF8FAFC";
const GRID = "FFE2E8F0";
const WHITE = "FFFFFFFF";

const HAIR = {
  top: { style: "hair" as const, color: { argb: GRID } },
  left: { style: "hair" as const, color: { argb: GRID } },
  bottom: { style: "hair" as const, color: { argb: GRID } },
  right: { style: "hair" as const, color: { argb: GRID } },
};

const CURVA_STYLE: Record<string, { fill: string; text: string }> = {
  A: { fill: GREEN_SOFT, text: GREEN_TEXT },
  B: { fill: AMBER_SOFT, text: AMBER_TEXT },
  C: { fill: SLATE_SOFT, text: SLATE_TEXT },
};

// ── Helpers ─────────────────────────────────────────────────────────────────
function hojeBr(): string {
  return new Date().toLocaleDateString("pt-BR");
}

function stamp(): string {
  return new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
}

/** "CACHECOL LISO (12345)" → "CACHECOL LISO" (o código já tem coluna própria). */
function nomeProduto(item: TransferXlsxItem): string {
  const limpo = item.descricao?.replace(`(${item.produto})`, "").trim();
  return limpo || item.descricao?.trim() || item.produto;
}

/** Excel: máx. 31 chars, sem : \ / ? * [ ] e nome único no workbook. */
function nomeAba(base: string, usados: Set<string>): string {
  const limpo = (base || "Aba").replace(/[:\\/?*[\]]/g, "-").trim().slice(0, 31) || "Aba";
  let nome = limpo;
  let n = 2;
  while (usados.has(nome.toUpperCase())) {
    const sufixo = ` (${n})`;
    nome = `${limpo.slice(0, 31 - sufixo.length)}${sufixo}`;
    n += 1;
  }
  usados.add(nome.toUpperCase());
  return nome;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ── Export ──────────────────────────────────────────────────────────────────
export async function exportTransfersToXlsx(
  transfers: TransferXlsxGroup[],
  companyKey: CompanyKey,
  options: {
    companyName?: string;
    dateRange?: { startDate: Date; endDate: Date };
    /** Filial de origem selecionada na tela (só compõe o nome do arquivo). */
    filialSelecionada?: string | null;
  } = {}
): Promise<void> {
  const items = transfers.flatMap((g) => g.destinationGroups.flatMap((d) => d.items));
  if (items.length === 0) {
    alert("Não há transferências para exportar.");
    return;
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Dashboard";
  workbook.created = new Date();

  const scarfme = companyKey === "scarfme";
  const periodo = options.dateRange
    ? `${options.dateRange.startDate.toLocaleDateString("pt-BR")} a ${options.dateRange.endDate.toLocaleDateString("pt-BR")}`
    : null;
  const subtitulo = [
    options.companyName || null,
    periodo ? `Período analisado: ${periodo}` : null,
    `Gerado em ${hojeBr()}`,
  ]
    .filter(Boolean)
    .join("  ·  ");

  const usados = new Set<string>();

  // ══ 1. RESUMO ═════════════════════════════════════════════════════════════
  const destinosSet = new Set<string>();
  transfers.forEach((g) => g.destinationGroups.forEach((d) => destinosSet.add(d.destino)));
  const destinos = Array.from(destinosSet).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const ws = workbook.addWorksheet(nomeAba("Resumo", usados), {
    views: [{ showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  const totalCols = Math.max(10, destinos.length + 2);

  ws.getColumn(1).width = 34;
  for (let c = 2; c <= totalCols; c += 1) ws.getColumn(c).width = 15;

  // Faixa de título
  ws.mergeCells(1, 1, 1, totalCols);
  const t1 = ws.getCell(1, 1);
  t1.value = "Controle de Transferências";
  t1.font = { bold: true, size: 16, color: { argb: WHITE } };
  t1.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  t1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
  ws.getRow(1).height = 30;

  ws.mergeCells(2, 1, 2, totalCols);
  const t2 = ws.getCell(2, 1);
  t2.value = subtitulo;
  t2.font = { size: 10, color: { argb: NAVY_SOFT } };
  t2.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
  t2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SLATE_SOFT } };
  ws.getRow(2).height = 20;

  // KPIs
  const totalUnidades = items.reduce((s, i) => s + i.quantidade, 0);
  const rotas = transfers.reduce((s, g) => s + g.destinationGroups.length, 0);
  const kpis: Array<[string, number]> = [
    ["Itens a transferir", items.length],
    ["Unidades", totalUnidades],
    ["Origens", transfers.length],
    ["Destinos", destinos.length],
    ["Rotas origem → destino", rotas],
  ];
  const kpiRow = 4;
  ws.getRow(kpiRow).height = 16;
  ws.getRow(kpiRow + 1).height = 26;
  kpis.forEach(([label, valor], i) => {
    const col = i * 2 + 1;
    ws.mergeCells(kpiRow, col, kpiRow, col + 1);
    const lc = ws.getCell(kpiRow, col);
    lc.value = label.toUpperCase();
    lc.font = { size: 8, bold: true, color: { argb: SLATE_TEXT } };
    lc.alignment = { horizontal: "center", vertical: "middle" };
    lc.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SLATE_SOFT } };

    ws.mergeCells(kpiRow + 1, col, kpiRow + 1, col + 1);
    const vc = ws.getCell(kpiRow + 1, col);
    vc.value = valor;
    vc.numFmt = "#,##0";
    vc.font = { size: 16, bold: true, color: { argb: NAVY } };
    vc.alignment = { horizontal: "center", vertical: "middle" };
    vc.border = { bottom: { style: "medium", color: { argb: NAVY } } };
  });

  // Matriz Origem × Destino
  const matrizTitleRow = kpiRow + 3;
  ws.mergeCells(matrizTitleRow, 1, matrizTitleRow, totalCols);
  const mt = ws.getCell(matrizTitleRow, 1);
  mt.value = "Unidades por rota — linha = origem, coluna = destino";
  mt.font = { bold: true, size: 11, color: { argb: NAVY } };
  mt.alignment = { vertical: "middle" };
  ws.getRow(matrizTitleRow).height = 22;

  const matrizHeaderRow = matrizTitleRow + 1;
  const hRow = ws.getRow(matrizHeaderRow);
  hRow.height = 32;
  ["Origem", ...destinos, "Total"].forEach((h, i) => {
    const cell = hRow.getCell(i + 1);
    cell.value = h;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = {
      horizontal: i === 0 ? "left" : "center",
      vertical: "middle",
      wrapText: true,
      indent: i === 0 ? 1 : 0,
    };
    cell.border = HAIR;
  });

  transfers.forEach((g, gi) => {
    const r = ws.getRow(matrizHeaderRow + 1 + gi);
    r.height = 18;
    const zebra = gi % 2 === 1;
    const porDestino = new Map(g.destinationGroups.map((d) => [d.destino, d.totalQuantidade]));

    const origemCell = r.getCell(1);
    origemCell.value = g.origem;
    origemCell.font = { size: 10, bold: true, color: { argb: NAVY_SOFT } };
    origemCell.alignment = { vertical: "middle", indent: 1 };
    origemCell.border = HAIR;
    if (zebra) origemCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };

    // Célula em branco = nada a enviar nessa rota; verde = unidades a enviar.
    destinos.forEach((d, di) => {
      const cell = r.getCell(di + 2);
      const qtd = porDestino.get(d) ?? 0;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = HAIR;
      if (qtd > 0) {
        cell.value = qtd;
        cell.numFmt = "#,##0";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_SOFT } };
        cell.font = { size: 10, bold: true, color: { argb: GREEN_TEXT } };
      } else if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
      }
    });

    const totCell = r.getCell(destinos.length + 2);
    totCell.value = g.totalQuantidade;
    totCell.numFmt = "#,##0";
    totCell.font = { size: 10, bold: true, color: { argb: NAVY } };
    totCell.alignment = { horizontal: "center", vertical: "middle" };
    totCell.border = HAIR;
    if (zebra) totCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
  });

  // Rodapé da matriz
  const matrizTotalRow = ws.getRow(matrizHeaderRow + 1 + transfers.length);
  matrizTotalRow.height = 18;
  matrizTotalRow.getCell(1).value = "TOTAL";
  destinos.forEach((d, di) => {
    const soma = transfers.reduce(
      (s, g) => s + (g.destinationGroups.find((x) => x.destino === d)?.totalQuantidade ?? 0),
      0
    );
    const cell = matrizTotalRow.getCell(di + 2);
    cell.value = soma;
    cell.numFmt = "#,##0";
  });
  const totGeral = matrizTotalRow.getCell(destinos.length + 2);
  totGeral.value = totalUnidades;
  totGeral.numFmt = "#,##0";
  for (let c = 1; c <= destinos.length + 2; c += 1) {
    const cell = matrizTotalRow.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: NAVY } };
    cell.alignment = {
      horizontal: c === 1 ? "left" : "center",
      vertical: "middle",
      indent: c === 1 ? 1 : 0,
    };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRID } };
    cell.border = {
      top: { style: "thin", color: { argb: NAVY } },
      bottom: { style: "thin", color: { argb: NAVY } },
    };
  }

  // Legenda
  const legendaRow = matrizHeaderRow + transfers.length + 3;
  ws.mergeCells(legendaRow, 1, legendaRow, totalCols);
  const lg = ws.getCell(legendaRow, 1);
  lg.value =
    "Cada filial de origem tem uma aba própria com a lista de conferência (marque em “Conferido”). A aba “Base (dinâmica)” tem tudo em linha única, com filtro, para montar tabela dinâmica.";
  lg.font = { size: 9, italic: true, color: { argb: SLATE_TEXT } };
  lg.alignment = { vertical: "middle" };

  // ══ 2. UMA ABA POR ORIGEM (pick list) ═════════════════════════════════════
  const colunas: Array<{ h: string; w: number; align: "left" | "center" | "right" }> = [
    { h: "Conferido", w: 11, align: "center" },
    { h: "Destino", w: 26, align: "left" },
    { h: "Produto", w: 11, align: "left" },
    { h: "Descrição", w: 46, align: "left" },
    { h: "Cor", w: 18, align: "left" },
    { h: "Código de barras", w: 18, align: "left" },
    ...(scarfme
      ? [
          { h: "Subgrupo", w: 16, align: "left" as const },
          { h: "Grade", w: 11, align: "center" as const },
        ]
      : []),
    { h: "Curva", w: 8, align: "center" },
    { h: "Estoque origem", w: 13, align: "center" },
    { h: "Estoque destino", w: 13, align: "center" },
    { h: "Vendas 30d destino", w: 13, align: "center" },
    { h: "Qtd a transferir", w: 14, align: "center" },
  ];
  const QTD_COL = colunas.length;
  const CONF_COL = 1;
  const CURVA_COL = colunas.findIndex((c) => c.h === "Curva") + 1;

  transfers.forEach((group) => {
    const sheet = workbook.addWorksheet(nomeAba(group.origem, usados), {
      views: [{ state: "frozen", ySplit: 4, showGridLines: false }],
      pageSetup: {
        orientation: "landscape",
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        printTitlesRow: "4:4",
        margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
      },
    });
    colunas.forEach((c, i) => {
      sheet.getColumn(i + 1).width = c.w;
    });

    // Cabeçalho da aba
    sheet.mergeCells(1, 1, 1, colunas.length);
    const st1 = sheet.getCell(1, 1);
    st1.value = `Saídas de ${group.origem}`;
    st1.font = { bold: true, size: 15, color: { argb: WHITE } };
    st1.alignment = { vertical: "middle", indent: 1 };
    st1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    sheet.getRow(1).height = 28;

    const totalItensOrigem = group.destinationGroups.reduce((s, d) => s + d.items.length, 0);
    sheet.mergeCells(2, 1, 2, colunas.length);
    const st2 = sheet.getCell(2, 1);
    st2.value =
      `${group.totalQuantidade.toLocaleString("pt-BR")} unidade(s)  ·  ` +
      `${totalItensOrigem.toLocaleString("pt-BR")} item(ns)  ·  ` +
      `${group.destinationGroups.length} destino(s)  ·  ${subtitulo}`;
    st2.font = { size: 10, color: { argb: NAVY_SOFT } };
    st2.alignment = { vertical: "middle", indent: 1 };
    st2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SLATE_SOFT } };
    sheet.getRow(2).height = 18;

    // Cabeçalho de colunas na linha 4 (linha 3 fica de respiro); é a linha congelada
    // e a que se repete em toda página impressa.
    const headerRow = sheet.getRow(4);
    headerRow.height = 28;
    colunas.forEach((c, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = c.h;
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
      cell.font = { bold: true, size: 9, color: { argb: WHITE } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.border = HAIR;
    });

    let r = 5;
    group.destinationGroups.forEach((destGroup) => {
      // Faixa do destino
      sheet.mergeCells(r, 1, r, colunas.length);
      const banner = sheet.getCell(r, 1);
      banner.value =
        `➜  ${destGroup.destino}     ·     ` +
        `${destGroup.totalQuantidade.toLocaleString("pt-BR")} un     ·     ` +
        `${destGroup.items.length} item(ns)`;
      banner.font = { bold: true, size: 11, color: { argb: WHITE } };
      banner.alignment = { vertical: "middle", indent: 1 };
      banner.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN } };
      sheet.getRow(r).height = 22;
      r += 1;

      const primeiraLinha = r;
      destGroup.items.forEach((item, idx) => {
        const row = sheet.getRow(r);
        row.height = 16;
        const zebra = idx % 2 === 1;

        const valores: Array<string | number> = [
          "", // Conferido — preenchido à mão
          item.destino,
          item.codigo || item.produto,
          nomeProduto(item),
          item.cor,
          item.codigoBarra ?? "",
          ...(scarfme ? [item.subgrupo ?? "", item.grade ?? ""] : []),
          item.curva ?? "",
          item.estoqueOrigem ?? 0,
          item.estoqueDestino ?? 0,
          item.vendas30dDestino ?? 0,
          item.quantidade,
        ];

        valores.forEach((v, i) => {
          const cell = row.getCell(i + 1);
          const col = colunas[i];
          if (v !== "") cell.value = v;
          cell.font = { size: 10, color: { argb: INK } };
          cell.alignment = {
            horizontal: col.align,
            vertical: "middle",
            indent: col.align === "left" ? 1 : 0,
          };
          cell.border = HAIR;
          if (typeof v === "number") cell.numFmt = "#,##0";
          if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
        });

        // Curva com cor de badge
        const curva = (item.curva ?? "").toUpperCase();
        if (CURVA_COL > 0 && CURVA_STYLE[curva]) {
          const cell = row.getCell(CURVA_COL);
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CURVA_STYLE[curva].fill } };
          cell.font = { size: 10, bold: true, color: { argb: CURVA_STYLE[curva].text } };
        }

        // Quantidade em destaque
        const qtd = row.getCell(QTD_COL);
        qtd.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_SOFT } };
        qtd.font = { size: 11, bold: true, color: { argb: GREEN_TEXT } };

        // "Conferido": sempre branco (para escrever/imprimir) e com dropdown.
        const conf = row.getCell(CONF_COL);
        conf.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WHITE } };
        conf.border = {
          top: { style: "thin", color: { argb: GRID } },
          left: { style: "thin", color: { argb: GRID } },
          bottom: { style: "thin", color: { argb: GRID } },
          right: { style: "thin", color: { argb: GRID } },
        };
        conf.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: ['"OK,Parcial,Falta"'],
        };

        r += 1;
      });

      // Subtotal do destino (fórmula: se a pessoa ajustar a quantidade, o total acompanha)
      const sub = sheet.getRow(r);
      sub.height = 18;
      sheet.mergeCells(r, 1, r, QTD_COL - 1);
      const subLabel = sheet.getCell(r, 1);
      subLabel.value = `Subtotal ${destGroup.destino}`;
      subLabel.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
      const qtdLetter = sheet.getColumn(QTD_COL).letter;
      const subVal = sub.getCell(QTD_COL);
      subVal.value = { formula: `SUM(${qtdLetter}${primeiraLinha}:${qtdLetter}${r - 1})` };
      subVal.numFmt = "#,##0";
      for (let c = 1; c <= QTD_COL; c += 1) {
        const cell = sub.getCell(c);
        cell.font = { bold: true, size: 10, color: { argb: NAVY } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRID } };
        cell.border = { top: { style: "thin", color: { argb: NAVY } } };
        if (c === QTD_COL) cell.alignment = { horizontal: "center", vertical: "middle" };
      }
      r += 2; // respiro entre destinos
    });

    // Total da origem
    const tot = sheet.getRow(r);
    tot.height = 22;
    sheet.mergeCells(r, 1, r, QTD_COL - 1);
    const totLabel = sheet.getCell(r, 1);
    totLabel.value = `TOTAL — ${group.origem}`;
    totLabel.alignment = { horizontal: "right", vertical: "middle", indent: 1 };
    const totVal = tot.getCell(QTD_COL);
    totVal.value = group.totalQuantidade;
    totVal.numFmt = "#,##0";
    totVal.alignment = { horizontal: "center", vertical: "middle" };
    for (let c = 1; c <= QTD_COL; c += 1) {
      const cell = tot.getCell(c);
      cell.font = { bold: true, size: 11, color: { argb: WHITE } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    }
  });

  // ══ 3. BASE PARA TABELA DINÂMICA ══════════════════════════════════════════
  const baseHeaders = [
    "Origem",
    "Destino",
    "Produto",
    "Descrição",
    "Cor",
    "Código de barras",
    ...(scarfme ? ["Subgrupo", "Grade"] : []),
    "Curva",
    "Estoque origem",
    "Vendas 30d origem",
    "Estoque destino",
    "Vendas 30d destino",
    "Qtd a transferir",
  ];
  const baseWidths = [26, 26, 11, 46, 18, 18, ...(scarfme ? [16, 11] : []), 8, 14, 15, 14, 15, 14];

  const base = workbook.addWorksheet(nomeAba("Base (dinâmica)", usados), {
    views: [{ state: "frozen", ySplit: 1 }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  baseHeaders.forEach((h, i) => {
    base.getColumn(i + 1).width = baseWidths[i] ?? Math.max(12, h.length + 2);
  });

  const bHeader = base.getRow(1);
  bHeader.height = 26;
  baseHeaders.forEach((h, i) => {
    const cell = bHeader.getCell(i + 1);
    cell.value = h;
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = HAIR;
  });
  base.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: baseHeaders.length } };

  items.forEach((item, idx) => {
    const row = base.getRow(idx + 2);
    row.height = 16;
    const zebra = idx % 2 === 1;
    const valores: Array<string | number> = [
      item.origem,
      item.destino,
      item.codigo || item.produto,
      nomeProduto(item),
      item.cor,
      item.codigoBarra ?? "",
      ...(scarfme ? [item.subgrupo ?? "", item.grade ?? ""] : []),
      item.curva ?? "",
      item.estoqueOrigem ?? 0,
      item.vendas30dOrigem ?? 0,
      item.estoqueDestino ?? 0,
      item.vendas30dDestino ?? 0,
      item.quantidade,
    ];
    valores.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v;
      cell.font = { size: 10, color: { argb: INK } };
      cell.alignment = {
        horizontal: typeof v === "number" ? "center" : "left",
        vertical: "middle",
        indent: typeof v === "number" ? 0 : 1,
      };
      cell.border = HAIR;
      if (typeof v === "number") cell.numFmt = "#,##0";
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } };
    });
    const qtd = row.getCell(baseHeaders.length);
    qtd.font = { size: 10, bold: true, color: { argb: GREEN_TEXT } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const sufixoFilial = options.filialSelecionada
    ? `-${options.filialSelecionada
        .toLowerCase()
        .replace(/[^a-z0-9]+/gi, "-")
        .replace(/^-|-$/g, "")}`
    : "";
  triggerDownload(blob, `transferencias-${companyKey}${sufixoFilial}-${stamp()}.xlsx`);
}

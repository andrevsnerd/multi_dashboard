// Export da Distribuição Matriz — Excel (ExcelJS, colorido por status) e PDF (jsPDF + autoTable).
//
// Reflete a tela: uma coluna por loja com a QUANTIDADE A ENVIAR, célula colorida pelo status
// (zerada=vermelho, bem abaixo=laranja, abaixo=amarelo, no mínimo=verde, não estoca=cinza).
// Colunas fixas: Produto, Código, Cor, Material, Grade, Matriz e Total a enviar.

import type { DistribuicaoItem, LojaDistStatus } from "@/lib/utils/distribuicao-matriz";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCell = any;

export interface ExportDistribuicaoInput {
  items: DistribuicaoItem[];
  filiais: string[]; // chaves de coluna (na ordem exibida)
  labels: Record<string, string>;
  companyKey: string;
  matrizLabel?: string;
}

/** Paleta por status — argb para Excel, rgb para PDF. */
const STATUS_COLORS: Record<
  LojaDistStatus,
  { fillArgb: string; fontArgb: string; fillRgb: [number, number, number]; fontRgb: [number, number, number] }
> = {
  SEM_ESTOQUE: { fillArgb: "FFFDE8E8", fontArgb: "FFB91C1C", fillRgb: [253, 232, 232], fontRgb: [185, 28, 28] },
  CRITICO: { fillArgb: "FFFFEDD5", fontArgb: "FFC2410C", fillRgb: [255, 237, 213], fontRgb: [194, 65, 12] },
  BAIXO: { fillArgb: "FFFEF9C3", fontArgb: "FFA16207", fillRgb: [254, 249, 195], fontRgb: [161, 98, 7] },
  OK: { fillArgb: "FFEAF7EE", fontArgb: "FF166534", fillRgb: [234, 247, 238], fontRgb: [22, 101, 52] },
  SEM_VENDA: { fillArgb: "FFF1F5F9", fontArgb: "FF94A3B8", fillRgb: [241, 245, 249], fontRgb: [148, 163, 184] },
  NOVO: { fillArgb: "FFEAF7EE", fontArgb: "FF166534", fillRgb: [234, 247, 238], fontRgb: [22, 101, 52] },
};

function today(): string {
  return new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
}
function nomeProduto(item: DistribuicaoItem): string {
  return item.descricao?.replace(`(${item.produto})`, "").trim() || item.descricao || item.produto;
}

// ────────────────────────────────────────────────────────────────────────────
//  EXCEL
// ────────────────────────────────────────────────────────────────────────────
export async function exportDistribuicaoMatrizXlsx({
  items,
  filiais,
  labels,
  companyKey,
  matrizLabel = "MATRIZ",
}: ExportDistribuicaoInput): Promise<void> {
  if (items.length === 0) {
    alert("Não há itens para exportar.");
    return;
  }

  const excelJsMod = await import("exceljs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ExcelJS = (excelJsMod as any).default ?? excelJsMod;
  const workbook = new ExcelJS.Workbook();

  const fixed = ["Produto", "Código", "Cor", "Material", "Grade", matrizLabel];
  const headers = [...fixed, ...filiais.map((f) => labels[f] ?? f), "Total a enviar"];
  const firstFilialCol = fixed.length + 1; // 1-based
  const totalCol = firstFilialCol + filiais.length;

  const titleLines = [
    "Distribuição Matriz — sugestão de envio por loja",
    `Gerado em ${today()}  ·  ${items.length.toLocaleString("pt-BR")} item(ns)  ·  valor por loja = unidades a enviar (célula colorida pelo status do estoque)`,
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet("Distribuição Matriz", {
    views: [{ state: "frozen", ySplit: headerRowNum, xSplit: 1 }],
  });

  ws.columns = headers.map((h, i) => {
    if (i === 0) return { width: 34 }; // Produto
    if (i < fixed.length) return { width: Math.max(10, h.length + 2) };
    return { width: Math.max(9, h.length + 2) };
  });

  // Título
  titleLines.forEach((line, i) => {
    const tr = ws.getRow(i + 1);
    tr.getCell(1).value = line;
    ws.mergeCells(i + 1, 1, i + 1, headers.length);
    tr.getCell(1).font = { bold: i === 0, size: i === 0 ? 13 : 10, color: { argb: "FF334155" } };
    tr.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
  });

  // Cabeçalho
  const headerRow = ws.getRow(headerRowNum);
  headers.forEach((h, i) => (headerRow.getCell(i + 1).value = h));
  headerRow.height = 22;
  headerRow.eachCell({ includeEmpty: true }, (cell: AnyCell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 10 };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.border = {
      top: { style: "thin" }, left: { style: "thin" },
      bottom: { style: "thin" }, right: { style: "thin" },
    };
  });
  ws.autoFilter = { from: { row: headerRowNum, column: 1 }, to: { row: headerRowNum, column: headers.length } };

  const HAIR = {
    top: { style: "hair" as const }, left: { style: "hair" as const },
    bottom: { style: "hair" as const }, right: { style: "hair" as const },
  };

  // Linhas
  items.forEach((item, i) => {
    const r = firstDataRow + i;
    const xrow = ws.getRow(r);
    xrow.height = 16;
    const lojaBy = new Map(item.lojas.map((l) => [l.filial, l]));

    const setText = (col: number, value: string | number) => {
      const cell = xrow.getCell(col);
      cell.value = value;
      cell.font = { size: 10 };
      cell.alignment = { horizontal: typeof value === "number" ? "right" : "left", vertical: "middle" };
      cell.border = HAIR;
      if (i % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FB" } };
    };

    setText(1, nomeProduto(item));
    setText(2, item.codigo);
    setText(3, item.cor);
    setText(4, item.subgrupo ?? "");
    setText(5, item.grade ?? "");
    // Matriz (estoque) em destaque
    const mcell = xrow.getCell(6);
    mcell.value = item.matrizEstoque;
    mcell.numFmt = "#,##0";
    mcell.font = { size: 10, bold: true, color: { argb: "FF1E293B" } };
    mcell.alignment = { horizontal: "right", vertical: "middle" };
    mcell.border = HAIR;

    // Filiais — valor = enviar, cor por status
    filiais.forEach((filial, fi) => {
      const cell = xrow.getCell(firstFilialCol + fi);
      const loja = lojaBy.get(filial);
      const enviar = loja?.enviar ?? 0;
      const status = (loja?.status ?? "SEM_VENDA") as LojaDistStatus;
      const tone = STATUS_COLORS[status];
      cell.value = enviar;
      cell.numFmt = "#,##0";
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: tone.fillArgb } };
      cell.font = { size: 10, bold: enviar > 0, color: { argb: tone.fontArgb } };
      cell.border = HAIR;
    });

    // Total a enviar
    const tcell = xrow.getCell(totalCol);
    tcell.value = item.totalEnviar;
    tcell.numFmt = "#,##0";
    tcell.font = { size: 10, bold: true, color: { argb: "FF166534" } };
    tcell.alignment = { horizontal: "right", vertical: "middle" };
    tcell.border = HAIR;
  });

  // Rodapé TOTAL
  const lastDataRow = firstDataRow + items.length - 1;
  const totalRow = ws.getRow(lastDataRow + 1);
  totalRow.getCell(1).value = "TOTAL";
  for (let c = firstFilialCol; c <= totalCol; c++) {
    let sum = 0;
    for (let r = firstDataRow; r <= lastDataRow; r++) sum += Number(ws.getRow(r).getCell(c).value ?? 0);
    const cell = totalRow.getCell(c);
    cell.value = sum;
    cell.numFmt = "#,##0";
    cell.alignment = { horizontal: c === totalCol ? "right" : "center", vertical: "middle" };
  }
  totalRow.height = 18;
  totalRow.eachCell({ includeEmpty: true }, (cell: AnyCell) => {
    cell.font = { bold: true, size: 10, color: { argb: "FF1E3A5F" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { top: { style: "thin" }, bottom: { style: "thin" } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer as ArrayBuffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `distribuicao-matriz-${companyKey}-${today()}.xlsx`);
}

// ────────────────────────────────────────────────────────────────────────────
//  PDF
// ────────────────────────────────────────────────────────────────────────────
export async function exportDistribuicaoMatrizPdf({
  items,
  filiais,
  labels,
  companyKey,
  matrizLabel = "MATRIZ",
}: ExportDistribuicaoInput): Promise<void> {
  if (items.length === 0) {
    alert("Não há itens para exportar.");
    return;
  }

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const autoTable = (autoTableMod as any).default ?? autoTableMod;

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const margin = 8;

  doc.setFontSize(16);
  doc.setTextColor(30, 58, 95);
  doc.setFont("helvetica", "bold");
  doc.text("Distribuição Matriz", margin, 12);
  doc.setFontSize(9);
  doc.setTextColor(107, 114, 128);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Gerado em ${today()}  ·  ${items.length} item(ns)  ·  valor por loja = unidades a enviar`,
    margin,
    17
  );

  const head = [["Produto", "Código", "Cor", matrizLabel, ...filiais.map((f) => labels[f] ?? f), "Total"]];
  const fixedCount = 4; // Produto, Código, Cor, Matriz
  const totalColIdx = fixedCount + filiais.length;

  // Grid de status por linha × filial (para colorir no didParseCell).
  const statusGrid: LojaDistStatus[][] = items.map((item) => {
    const by = new Map(item.lojas.map((l) => [l.filial, l]));
    return filiais.map((f) => (by.get(f)?.status ?? "SEM_VENDA") as LojaDistStatus);
  });

  const body = items.map((item) => {
    const by = new Map(item.lojas.map((l) => [l.filial, l]));
    return [
      nomeProduto(item),
      item.codigo,
      item.cor,
      String(item.matrizEstoque),
      ...filiais.map((f) => String(by.get(f)?.enviar ?? 0)),
      String(item.totalEnviar),
    ];
  });

  autoTable(doc, {
    head,
    body,
    startY: 21,
    margin: { left: margin, right: margin },
    styles: { fontSize: 6.5, cellPadding: 1.5, textColor: [31, 41, 55], lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: [30, 58, 95], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 6.5, halign: "center" },
    columnStyles: {
      0: { cellWidth: 46, halign: "left", overflow: "ellipsize" },
      1: { cellWidth: 20, halign: "left" },
      2: { cellWidth: 22, halign: "left", overflow: "ellipsize" },
      3: { cellWidth: 14, halign: "center", fontStyle: "bold" },
      [totalColIdx]: { cellWidth: 14, halign: "center", fontStyle: "bold", textColor: [22, 101, 52] },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: AnyCell) => {
      if (data.section !== "body") return;
      const col = data.column.index;
      if (col >= fixedCount && col < totalColIdx) {
        const status = statusGrid[data.row.index]?.[col - fixedCount];
        if (status) {
          const tone = STATUS_COLORS[status];
          data.cell.styles.fillColor = tone.fillRgb;
          data.cell.styles.textColor = tone.fontRgb;
          data.cell.styles.halign = "center";
          if (Number(data.cell.raw) > 0) data.cell.styles.fontStyle = "bold";
        }
      }
    },
  });

  doc.save(`distribuicao-matriz-${companyKey}-${today()}.pdf`);
}

// ────────────────────────────────────────────────────────────────────────────
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

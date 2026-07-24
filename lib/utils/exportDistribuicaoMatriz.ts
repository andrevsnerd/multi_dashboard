// Export da Distribuição Matriz — Excel (ExcelJS) e PDF (jsPDF + autoTable).
//
// Pick-list de envio: cada coluna de loja é preenchida SOMENTE quando há algo a enviar,
// com o valor em VERDE. Loja que não recebe fica em branco. Colunas de contexto:
// Produto, Código, Cor, Material, Grade, Matriz (estoque) e Total a enviar.

import type { DistribuicaoItem } from "@/lib/utils/distribuicao-matriz";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCell = any;

export interface ExportDistribuicaoInput {
  items: DistribuicaoItem[];
  filiais: string[]; // chaves de coluna (na ordem exibida)
  labels: Record<string, string>;
  companyKey: string;
  matrizLabel?: string;
}

// Verde do "enviar" (mesmo tom da badge da tela).
const GREEN_FILL_ARGB = "FFDCFCE7";
const GREEN_FONT_ARGB = "FF16A34A";
const GREEN_FILL_RGB: [number, number, number] = [220, 252, 231];
const GREEN_FONT_RGB: [number, number, number] = [22, 163, 74];
const ZEBRA_ARGB = "FFF6F8FB";

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
    "Distribuição Matriz — o que enviar para cada loja",
    `Gerado em ${today()}  ·  ${items.length.toLocaleString("pt-BR")} item(ns)  ·  células verdes = unidades a enviar (em branco = não enviar)`,
  ];
  const headerRowNum = titleLines.length + 1;
  const firstDataRow = headerRowNum + 1;

  const ws = workbook.addWorksheet("Distribuição Matriz", {
    views: [{ state: "frozen", ySplit: headerRowNum, xSplit: 1 }],
  });

  ws.columns = headers.map((h, i) => {
    if (i === 0) return { width: 34 };
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
    const zebra = i % 2 === 1;
    const lojaBy = new Map(item.lojas.map((l) => [l.filial, l]));

    const setText = (col: number, value: string | number) => {
      const cell = xrow.getCell(col);
      cell.value = value;
      cell.font = { size: 10 };
      cell.alignment = { horizontal: typeof value === "number" ? "right" : "left", vertical: "middle" };
      cell.border = HAIR;
      if (zebra) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_ARGB } };
    };

    setText(1, nomeProduto(item));
    setText(2, item.codigo);
    setText(3, item.cor);
    setText(4, item.subgrupo ?? "");
    setText(5, item.grade ?? "");
    // Matriz (estoque) — contexto, em destaque
    const mcell = xrow.getCell(6);
    mcell.value = item.matrizEstoque;
    mcell.numFmt = "#,##0";
    mcell.font = { size: 10, bold: true, color: { argb: "FF1E293B" } };
    mcell.alignment = { horizontal: "right", vertical: "middle" };
    mcell.border = HAIR;
    if (zebra) mcell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_ARGB } };

    // Filiais — SÓ preenche (verde) quando há envio; senão fica em branco.
    filiais.forEach((filial, fi) => {
      const cell = xrow.getCell(firstFilialCol + fi);
      const enviar = lojaBy.get(filial)?.enviar ?? 0;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      cell.border = HAIR;
      if (enviar > 0) {
        cell.value = enviar;
        cell.numFmt = "#,##0";
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREEN_FILL_ARGB } };
        cell.font = { size: 10, bold: true, color: { argb: GREEN_FONT_ARGB } };
      } else if (zebra) {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_ARGB } };
      }
    });

    // Total a enviar
    const tcell = xrow.getCell(totalCol);
    tcell.value = item.totalEnviar;
    tcell.numFmt = "#,##0";
    tcell.font = { size: 10, bold: true, color: { argb: GREEN_FONT_ARGB } };
    tcell.alignment = { horizontal: "right", vertical: "middle" };
    tcell.border = HAIR;
    if (zebra) tcell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA_ARGB } };
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

  const [{ default: jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
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
  doc.text(`Gerado em ${today()}  ·  ${items.length} item(ns)  ·  verde = unidades a enviar`, margin, 17);

  const head = [["Produto", "Código", "Cor", matrizLabel, ...filiais.map((f) => labels[f] ?? f), "Total"]];
  const fixedCount = 4; // Produto, Código, Cor, Matriz
  const totalColIdx = fixedCount + filiais.length;

  const body = items.map((item) => {
    const by = new Map(item.lojas.map((l) => [l.filial, l]));
    return [
      nomeProduto(item),
      item.codigo,
      item.cor,
      String(item.matrizEstoque),
      ...filiais.map((f) => {
        const e = by.get(f)?.enviar ?? 0;
        return e > 0 ? String(e) : ""; // em branco quando não envia
      }),
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
      [totalColIdx]: { cellWidth: 14, halign: "center", fontStyle: "bold", textColor: GREEN_FONT_RGB },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    didParseCell: (data: AnyCell) => {
      if (data.section !== "body") return;
      const col = data.column.index;
      if (col >= fixedCount && col < totalColIdx) {
        data.cell.styles.halign = "center";
        if (String(data.cell.raw ?? "").trim() !== "") {
          data.cell.styles.fillColor = GREEN_FILL_RGB;
          data.cell.styles.textColor = GREEN_FONT_RGB;
          data.cell.styles.fontStyle = "bold";
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

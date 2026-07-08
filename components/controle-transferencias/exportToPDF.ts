import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanyKey } from '@/lib/config/company';
import { resolveCompany } from '@/lib/config/company';

interface TransferItemExport {
  produto: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  cor: string;
  origem: string;
  destino: string;
  quantidade: number;
  estoqueOrigem?: number;
}

interface TransferByOriginAndDestination {
  origem: string;
  destinationGroups: {
    destino: string;
    items: TransferItemExport[];
    totalQuantidade: number;
  }[];
  totalQuantidade: number;
  totalItens?: number;
}

function getItemKey(item: TransferItemExport): string {
  return `${item.produto}|${item.cor}|${item.origem}|${item.destino}`;
}

export function exportTransfersToPDF(
  transfers: TransferByOriginAndDestination[],
  companyKey: CompanyKey,
  dateRange?: { startDate: Date; endDate: Date },
  markedKeys?: Set<string>
): void {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const company = resolveCompany(companyKey);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;
  const contentWidth = pageWidth - (margin * 2);

  // Cores (em RGB para jsPDF)
  const colorBlue = [59, 130, 246]; // #3b82f6
  const colorBlueDark = [37, 99, 235]; // #2563eb
  const colorGreen = [34, 197, 94]; // #22c55e
  const colorGreenDark = [21, 128, 61]; // #15803d
  const colorGray = [107, 114, 128]; // #6b7280
  const colorLightGray = [249, 250, 251]; // #f9fafb
  const colorBorder = [229, 231, 235]; // #e5e7eb
  const colorRowRealizada = [226, 232, 240]; // fundo cinza claro para linha "realizada"

  let currentY = margin;

  // Título principal
  doc.setFontSize(20);
  doc.setTextColor(colorBlue[0], colorBlue[1], colorBlue[2]);
  doc.setFont('helvetica', 'bold');
  doc.text('Controle de Transferências', margin, currentY);
  currentY += 8;

  // Informações do período
  if (dateRange) {
    doc.setFontSize(10);
    doc.setTextColor(colorGray[0], colorGray[1], colorGray[2]);
    doc.setFont('helvetica', 'normal');
    const startDateStr = dateRange.startDate.toLocaleDateString('pt-BR');
    const endDateStr = dateRange.endDate.toLocaleDateString('pt-BR');
    doc.text(`Período: ${startDateStr} a ${endDateStr}`, margin, currentY);
    currentY += 6;
  }

  currentY += 5;

  // Para cada grupo de origem
  transfers.forEach((group, groupIndex) => {
    // Verificar se precisa de nova página
    if (currentY > pageHeight - 60) {
      doc.addPage();
      currentY = margin;
    }

    // Header principal: Filial de origem (azul)
    const headerHeight = 25;
    doc.setFillColor(colorBlue[0], colorBlue[1], colorBlue[2]);
    doc.roundedRect(margin, currentY, contentWidth, headerHeight, 3, 3, 'F');
    
    // Texto do header
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont('helvetica', 'bold');
    doc.text(group.origem, margin + 5, currentY + 12);
    
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text('Filial de origem', margin + 5, currentY + 18);

    // Total de itens no canto direito
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    const totalText = `${group.totalQuantidade}`;
    const totalWidth = doc.getTextWidth(totalText);
    doc.text(totalText, margin + contentWidth - totalWidth - 5, currentY + 12);
    
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    const labelText = 'Total de itens';
    const labelWidth = doc.getTextWidth(labelText);
    doc.text(labelText, margin + contentWidth - labelWidth - 5, currentY + 18);

    currentY += headerHeight + 5;

    // Para cada grupo de destino
    group.destinationGroups.forEach((destGroup, destIndex) => {
      // Verificar se precisa de nova página antes do header de destino
      if (currentY > pageHeight - 80) {
        doc.addPage();
        currentY = margin;
      }

      // Header menor: Filial de destino (verde)
      const destHeaderHeight = 18;
      doc.setFillColor(colorGreen[0], colorGreen[1], colorGreen[2]);
      doc.roundedRect(margin, currentY, contentWidth, destHeaderHeight, 2, 2, 'F');
      
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text(`Transferir para: ${destGroup.destino}`, margin + 5, currentY + 10);
      
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const destTotalText = `${destGroup.totalQuantidade} un`;
      const destTotalWidth = doc.getTextWidth(destTotalText);
      doc.text(destTotalText, margin + contentWidth - destTotalWidth - 5, currentY + 10);

      currentY += destHeaderHeight + 3;

      // Linhas marcadas como "realizada" (para fundo cinza no PDF)
      const realizadaRows = markedKeys
        ? destGroup.items.map(item => markedKeys.has(getItemKey(item)))
        : [];

      // Preparar dados da tabela (incluindo Realizada)
      const tableData = destGroup.items.map(item => {
        const estoqueOrigem = item.estoqueOrigem ?? 0;
        const itemKey = getItemKey(item);
        const row: any[] = [
          item.codigo,
          item.codigoBarra || '-',
          estoqueOrigem.toString(),
        ];

        // Adicionar subgrupo e grade se for scarfme
        if (companyKey === 'scarfme') {
          row.push(item.subgrupo || '-');
          row.push(item.grade || '-');
        }

        row.push(
          item.descricao,
          item.cor,
          item.destino,
          item.quantidade.toString(),
          markedKeys?.has(itemKey) ? 'Sim' : '-'
        );

        return row;
      });

      // Cabeçalhos da tabela (incluindo Realizada)
      const headers: string[] = [
        'Produto',
        'Código de Barras',
        `Estoque ${group.origem}`,
      ];

      if (companyKey === 'scarfme') {
        headers.push('Subgrupo', 'Grade');
      }

      headers.push('Descrição', 'Cor', 'Destino', 'Quantidade', 'Realizada');

      const numCols = headers.length;
      const quantidadeColIndex = numCols - 2;
      const realizadaColIndex = numCols - 1;
      // Larguras fixas que somam contentWidth (277mm)
      const colStylesScarfme: Record<number, { cellWidth: number; halign: string; overflow?: 'ellipsize' }> = {
        0: { cellWidth: 20, halign: 'left' },           // Produto
        1: { cellWidth: 26, halign: 'center' },         // Código de Barras
        2: { cellWidth: 18, halign: 'center' },         // Estoque
        3: { cellWidth: 18, halign: 'center' },         // Subgrupo
        4: { cellWidth: 16, halign: 'center' },         // Grade
        5: { cellWidth: 100, halign: 'left', overflow: 'ellipsize' },  // Descrição
        6: { cellWidth: 20, halign: 'left' },          // Cor
        7: { cellWidth: 30, halign: 'left' },          // Destino
        [quantidadeColIndex]: { cellWidth: 18, halign: 'center' },
        [realizadaColIndex]: { cellWidth: 15, halign: 'center' },
      };
      const colStylesNerd: Record<number, { cellWidth: number; halign: string; overflow?: 'ellipsize' }> = {
        0: { cellWidth: 24, halign: 'left' },          // Produto
        1: { cellWidth: 28, halign: 'center' },         // Código de Barras
        2: { cellWidth: 22, halign: 'center' },         // Estoque
        3: { cellWidth: 114, halign: 'left', overflow: 'ellipsize' }, // Descrição
        4: { cellWidth: 22, halign: 'left' },           // Cor
        5: { cellWidth: 36, halign: 'left' },           // Destino
        [quantidadeColIndex]: { cellWidth: 20, halign: 'center' },
        [realizadaColIndex]: { cellWidth: 15, halign: 'center' },
      };
      const columnStyles = companyKey === 'scarfme' ? colStylesScarfme : colStylesNerd;
      (columnStyles[quantidadeColIndex] as { cellWidth: number; halign: string; fontStyle?: string }).fontStyle = 'bold';

      // Criar tabela
      autoTable(doc, {
        head: [headers],
        body: tableData,
        startY: currentY,
        margin: { left: margin, right: margin },
        tableWidth: 'wrap',
        styles: {
          fontSize: 7,
          cellPadding: 2,
          textColor: [31, 41, 55], // #1f2937
        },
        headStyles: {
          fillColor: [colorLightGray[0], colorLightGray[1], colorLightGray[2]] as [number, number, number],
          textColor: [colorGray[0], colorGray[1], colorGray[2]] as [number, number, number],
          fontStyle: 'bold',
          fontSize: 7,
          cellPadding: 2,
        },
        bodyStyles: {
          cellPadding: 2,
        },
        alternateRowStyles: {
          fillColor: [255, 255, 255],
        },
        columnStyles: columnStyles as any,
        didParseCell: (data: any) => {
          if (data.section === 'body') {
            if (realizadaRows[data.row.index]) {
              data.cell.styles.fillColor = colorRowRealizada as [number, number, number];
            }
          }
        },
        didDrawPage: (data: any) => {
          currentY = data.cursor.y;
        },
      });

      // Atualizar posição Y após a tabela
      const finalY = (doc as any).lastAutoTable?.finalY || currentY;
      currentY = finalY + 10;

      // Adicionar espaço entre grupos de destino
      if (destIndex < group.destinationGroups.length - 1) {
        currentY += 5;
      }
    });

    // Adicionar espaço entre grupos de origem
    if (groupIndex < transfers.length - 1) {
      currentY += 10;
    }
  });

  // Salvar PDF
  const fileName = `Transferencias_${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
}

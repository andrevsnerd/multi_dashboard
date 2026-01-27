import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { CompanyKey } from '@/lib/config/company';
import { resolveCompany } from '@/lib/config/company';

interface TransferByOriginAndDestination {
  origem: string;
  destinationGroups: {
    destino: string;
    items: Array<{
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
    }>;
    totalQuantidade: number;
  }[];
  totalQuantidade: number;
  totalItens?: number;
}

export function exportTransfersToPDF(
  transfers: TransferByOriginAndDestination[],
  companyKey: CompanyKey,
  dateRange?: { startDate: Date; endDate: Date }
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

  let currentY = margin;

  // Título principal
  doc.setFontSize(20);
  doc.setTextColor(...colorBlue);
  doc.setFont('helvetica', 'bold');
  doc.text('Controle de Transferências', margin, currentY);
  currentY += 8;

  // Informações do período
  if (dateRange) {
    doc.setFontSize(10);
    doc.setTextColor(...colorGray);
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
    doc.setFillColor(...colorBlue);
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
      doc.setFillColor(...colorGreen);
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

      // Preparar dados da tabela
      const tableData = destGroup.items.map(item => {
        const estoqueOrigem = item.estoqueOrigem ?? 0;
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
          item.quantidade.toString()
        );

        return row;
      });

      // Cabeçalhos da tabela
      const headers: string[] = [
        'Produto',
        'Código de Barras',
        `Estoque ${group.origem}`,
      ];

      if (companyKey === 'scarfme') {
        headers.push('Subgrupo', 'Grade');
      }

      headers.push('Descrição', 'Cor', 'Destino', 'Quantidade');

      // Criar tabela
      autoTable(doc, {
        head: [headers],
        body: tableData,
        startY: currentY,
        margin: { left: margin, right: margin },
        styles: {
          fontSize: 8,
          cellPadding: 3,
          textColor: [31, 41, 55], // #1f2937
        },
        headStyles: {
          fillColor: colorLightGray,
          textColor: colorGray,
          fontStyle: 'bold',
          fontSize: 7,
        },
        alternateRowStyles: {
          fillColor: [255, 255, 255],
        },
        columnStyles: {
          0: { cellWidth: 30, halign: 'left' }, // Produto
          1: { cellWidth: 35, halign: 'center' }, // Código de Barras
          2: { cellWidth: 30, halign: 'center' }, // Estoque
          ...(companyKey === 'scarfme' ? {
            3: { cellWidth: 30, halign: 'center' }, // Subgrupo
            4: { cellWidth: 25, halign: 'center' }, // Grade
          } : {}),
          [companyKey === 'scarfme' ? 5 : 3]: { cellWidth: 'auto', halign: 'left' }, // Descrição
          [companyKey === 'scarfme' ? 6 : 4]: { cellWidth: 30, halign: 'left' }, // Cor
          [companyKey === 'scarfme' ? 7 : 5]: { cellWidth: 40, halign: 'left' }, // Destino
          [companyKey === 'scarfme' ? 8 : 6]: { cellWidth: 25, halign: 'center', fontStyle: 'bold' }, // Quantidade
        },
        didDrawPage: (data: any) => {
          // Atualizar posição Y após desenhar a tabela
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

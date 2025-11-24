import { jsPDF } from 'jspdf';
import type { StockByFilialItem } from '@/lib/repositories/stockByFilial';
import type { DateRangeValue } from '@/components/filters/DateRangeFilter';
import { resolveCompany, type CompanyKey } from '@/lib/config/company';

interface TransferAction {
  produto: string;
  descricao: string;
  codigo: string;
  cor: string;
  quantidade: number;
  origem: string;
  destino: string;
}

interface PurchaseAction {
  produto: string;
  descricao: string;
  codigo: string;
  cor: string;
  quantidade: number;
  filiais: string[];
}

/**
 * Calcula a projeção de venda do mês baseado no período selecionado
 */
function calculateMonthlyProjection(
  totalVendas: number,
  dateRange?: DateRangeValue
): number {
  if (!dateRange) {
    return totalVendas;
  }

  const start = new Date(dateRange.startDate);
  const end = new Date(dateRange.endDate);
  
  const daysInPeriod = Math.max(
    1,
    Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
  );

  const vendaDiaria = totalVendas / daysInPeriod;
  return vendaDiaria * 30;
}

/**
 * Formata a descrição do produto com código
 */
function formatProductDescription(descricao: string, produto: string): {
  name: string;
  code: string;
} {
  if (descricao.includes(`(${produto})`)) {
    const parts = descricao.split(`(${produto})`);
    return {
      name: parts[0].trim(),
      code: produto,
    };
  }
  return {
    name: descricao.trim() || "Sem descrição",
    code: produto,
  };
}

/**
 * Analisa os dados de estoque e gera as ações necessárias
 */
export function analyzeStockActions(
  data: StockByFilialItem[],
  companyKey: CompanyKey,
  dateRange?: DateRangeValue
): {
  transfers: TransferAction[];
  purchases: PurchaseAction[];
} {
  const company = resolveCompany(companyKey);
  if (!company) {
    return { transfers: [], purchases: [] };
  }

  // Identificar matriz e filiais
  let matriz: string | null = null;
  let ecommerce: string | null = null;
  if (companyKey === "nerd") {
    matriz = "NERD";
  } else if (companyKey === "scarfme") {
    matriz = "SCARF ME - MATRIZ";
    ecommerce = "SCARFME MATRIZ CMS";
  }

  const allFiliais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];
  const normalFiliais = allFiliais.filter(f => 
    !ecommerceFilials.includes(f) && f !== matriz
  );
  const filiais = normalFiliais.sort();
  const filiaisCount = filiais.length;

  const transfers: TransferAction[] = [];
  const purchases: PurchaseAction[] = [];

  data.forEach((item) => {
    const totalEstoque = item.totalEstoque;
    const totalVendas = item.totalVendas;
    const projecaoVendaMes = calculateMonthlyProjection(totalVendas, dateRange);
    const finalEstoqueMes = totalEstoque - projecaoVendaMes;

    // REGRA 1: SEM VENDAS - AGUARDAR (mesma lógica da tabela)
    // Se Qtd_Vendida == 0 ou Projeção venda MÊS == 0
    if (totalVendas === 0 || projecaoVendaMes === 0) {
      return;
    }

    const productInfo = formatProductDescription(item.descricao, item.produto);
    
    // Calcular venda diária e estoques
    const vendaDiaria = projecaoVendaMes / 30;
    const estoqueMinimo = Math.max(15, vendaDiaria * 15);
    const estoqueIdeal = Math.max(20, vendaDiaria * 25);
    
    // Calcular número de filiais sem matriz (já calculado em filiaisCount)
    // Verificar se alguma filial com vendas tem estoque < 1
    const filiaisComVendas = item.filiais.filter(f => f.sales > 0);
    const algumaFilialComEstoqueBaixo = filiaisComVendas.some(f => f.stock < 1);
    
    // REGRA 2: TRANSFERIR (mesma lógica da tabela)
    // Se estoque total >= (número de filiais sem matriz) × 2 E alguma filial com vendas tem estoque < 1
    if (totalEstoque >= (filiaisCount * 2) && algumaFilialComEstoqueBaixo) {
      // Encontrar filiais com estoque disponível para transferir
      const filiaisComEstoque = item.filiais.filter(f => f.stock >= 2);
      
      if (filiaisComEstoque.length > 0) {
        // Para cada filial com estoque baixo, tentar transferir de uma filial com estoque
        const filiaisComEstoqueBaixo = filiaisComVendas.filter(f => f.stock < 1);
        
        filiaisComEstoqueBaixo.forEach((filialDestino) => {
          // Encontrar a melhor origem (preferir matriz, depois ecommerce, depois filiais com mais estoque)
          let melhorOrigem = filiaisComEstoque.find(f => f.filial === matriz);
          
          if (!melhorOrigem && ecommerce) {
            melhorOrigem = filiaisComEstoque.find(f => f.filial === ecommerce);
          }
          
          if (!melhorOrigem) {
            // Ordenar por estoque decrescente e pegar a primeira
            melhorOrigem = [...filiaisComEstoque].sort((a, b) => b.stock - a.stock)[0];
          }

          if (melhorOrigem) {
            // Calcular quantidade a transferir baseado na necessidade
            // Calcular necessidade da filial destino
            const vendaDiariaDestino = filialDestino.sales / (dateRange ? 
              Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30);
            const estoqueMinimoDestino = Math.max(15, vendaDiariaDestino * 15);
            const estoqueIdealDestino = Math.max(20, vendaDiariaDestino * 25);
            const estoqueAtualDestino = filialDestino.stock;
            
            // Quantidade necessária para atingir pelo menos o estoque mínimo
            const quantidadeNecessaria = Math.max(estoqueMinimoDestino - estoqueAtualDestino, 2);
            
            // Quantidade disponível na origem (deixar pelo menos 1 na origem)
            const quantidadeDisponivel = melhorOrigem.stock - 1;
            
            const quantidade = Math.min(quantidadeNecessaria, quantidadeDisponivel);

            if (quantidade > 0) {
              // Verificar se já existe uma transferência para este destino
              const transferExists = transfers.some(t => 
                t.produto === item.produto && 
                t.cor === item.cor && 
                t.destino === (company.filialDisplayNames?.[filialDestino.filial] || filialDestino.filial)
              );

              if (!transferExists) {
                transfers.push({
                  produto: item.produto,
                  descricao: productInfo.name,
                  codigo: productInfo.code,
                  cor: item.cor,
                  quantidade: Math.ceil(quantidade),
                  origem: company.filialDisplayNames?.[melhorOrigem.filial] || melhorOrigem.filial,
                  destino: company.filialDisplayNames?.[filialDestino.filial] || filialDestino.filial,
                });
              }
            }
          }
        });
      }
    }

    // REGRA 2: COMPRAR
    // Se Final EST MÊS < estoque_minimo
    // Reutilizar vendaDiaria, estoqueMinimo e estoqueIdeal já calculados acima
    if (finalEstoqueMes < estoqueMinimo) {
      const quantidade = Math.ceil(estoqueIdeal - finalEstoqueMes);
      
      // Identificar filiais que precisam de estoque (com vendas e estoque baixo)
      const filiaisQuePrecisam: string[] = [];
      const filiaisAdicionadas = new Set<string>();
      
      // Adicionar filiais com vendas e estoque baixo
      filiaisComVendas.forEach((filial) => {
        const estoqueFilial = filial.stock;
        const estoqueMinimoFilial = Math.max(15, (filial.sales / (dateRange ? 
          Math.max(1, Math.ceil((new Date(dateRange.endDate).getTime() - new Date(dateRange.startDate).getTime()) / (1000 * 60 * 60 * 24))) : 30) * 30) * 15);
        
        if (estoqueFilial < estoqueMinimoFilial) {
          const displayName = company.filialDisplayNames?.[filial.filial] || filial.filial;
          if (!filiaisAdicionadas.has(displayName)) {
            filiaisQuePrecisam.push(displayName);
            filiaisAdicionadas.add(displayName);
          }
        }
      });

      // Se não houver filiais específicas com estoque baixo, adicionar todas as filiais com vendas
      if (filiaisQuePrecisam.length === 0) {
        filiaisComVendas.forEach((filial) => {
          const displayName = company.filialDisplayNames?.[filial.filial] || filial.filial;
          if (!filiaisAdicionadas.has(displayName)) {
            filiaisQuePrecisam.push(displayName);
            filiaisAdicionadas.add(displayName);
          }
        });
      }

      // Se ainda não houver filiais, adicionar matriz ou primeira filial
      if (filiaisQuePrecisam.length === 0) {
        if (matriz) {
          const displayName = company.filialDisplayNames?.[matriz] || matriz;
          filiaisQuePrecisam.push(displayName);
        } else if (filiais.length > 0) {
          const displayName = company.filialDisplayNames?.[filiais[0]] || filiais[0];
          filiaisQuePrecisam.push(displayName);
        }
      }

      if (filiaisQuePrecisam.length > 0 && quantidade > 0) {
        purchases.push({
          produto: item.produto,
          descricao: productInfo.name,
          codigo: productInfo.code,
          cor: item.cor,
          quantidade,
          filiais: filiaisQuePrecisam,
        });
      }
    }
  });

  return { transfers, purchases };
}

/**
 * Gera um PDF com as ações de estoque
 */
export function generateStockActionsPDF(
  data: StockByFilialItem[],
  companyKey: CompanyKey,
  companyName: string,
  dateRange?: DateRangeValue
): void {
  const { transfers, purchases } = analyzeStockActions(data, companyKey, dateRange);

  const doc = new jsPDF();
  
  // Configurações
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 20;
  const lineHeight = 8;
  let yPos = margin;

  // Função para adicionar nova página se necessário
  const checkNewPage = (requiredSpace: number) => {
    if (yPos + requiredSpace > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      yPos = margin;
    }
  };

  // Título
  doc.setFontSize(20);
  doc.setFont('helvetica', 'bold');
  doc.text('Relatório de Ações de Estoque', pageWidth / 2, yPos, { align: 'center' });
  yPos += lineHeight * 2.5;

  // Informações da empresa e período
  doc.setFontSize(11);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(80, 80, 80);
  doc.text(`Empresa: ${companyName}`, margin, yPos);
  yPos += lineHeight * 1.2;
  
  if (dateRange) {
    const startDate = new Date(dateRange.startDate).toLocaleDateString('pt-BR');
    const endDate = new Date(dateRange.endDate).toLocaleDateString('pt-BR');
    doc.text(`Período: ${startDate} a ${endDate}`, margin, yPos);
    yPos += lineHeight * 1.2;
  }
  
  doc.text(`Data de geração: ${new Date().toLocaleDateString('pt-BR')} ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, margin, yPos);
  yPos += lineHeight * 2;
  doc.setTextColor(0, 0, 0);

  // Seção de Transferências
  if (transfers.length > 0) {
    checkNewPage(lineHeight * 4);
    
    // Título da seção com fundo
    doc.setFillColor(59, 130, 246); // Azul
    doc.roundedRect(margin, yPos - 5, pageWidth - margin * 2, lineHeight * 1.8, 3, 3, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(`TRANSFERÊNCIAS (${transfers.length})`, margin + 8, yPos + lineHeight * 0.6);
    yPos += lineHeight * 2.5;
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    
    transfers.forEach((transfer, index) => {
      checkNewPage(lineHeight * 6);
      
      // Número do item
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(59, 130, 246);
      doc.text(`${index + 1}.`, margin, yPos);
      
      // Produto - linha principal
      const productText = `${transfer.descricao}`;
      const codeText = `Código: ${transfer.codigo} | Cor: ${transfer.cor}`;
      const actionText = `TRANSFERIR ${transfer.quantidade} unidade(s)`;
      const fromToText = `De: ${transfer.origem} → Para: ${transfer.destino}`;
      
      // Quebrar texto se necessário
      const maxWidth = pageWidth - margin * 2 - 15;
      const splitProduct = doc.splitTextToSize(productText, maxWidth);
      const splitCode = doc.splitTextToSize(codeText, maxWidth);
      const splitAction = doc.splitTextToSize(actionText, maxWidth);
      const splitFromTo = doc.splitTextToSize(fromToText, maxWidth);
      
      let xPos = margin + 12;
      let currentY = yPos;
      
      // Nome do produto (negrito)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      splitProduct.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.9;
      });
      
      // Código e cor (menor, cinza)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      splitCode.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.8;
      });
      
      currentY += lineHeight * 0.3;
      
      // Ação (azul, negrito)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(59, 130, 246);
      splitAction.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.9;
      });
      
      // Origem e destino (normal)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      splitFromTo.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.9;
      });
      
      yPos = currentY + lineHeight * 1.2;
      
      // Linha separadora sutil
      if (index < transfers.length - 1) {
        doc.setDrawColor(220, 220, 220);
        doc.line(margin, yPos - lineHeight * 0.3, pageWidth - margin, yPos - lineHeight * 0.3);
        yPos += lineHeight * 0.5;
      }
    });
    
    yPos += lineHeight * 1.5;
  }

  // Seção de Compras
  if (purchases.length > 0) {
    checkNewPage(lineHeight * 4);
    
    // Título da seção com fundo
    doc.setFillColor(249, 115, 22); // Laranja
    doc.roundedRect(margin, yPos - 5, pageWidth - margin * 2, lineHeight * 1.8, 3, 3, 'F');
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(255, 255, 255);
    doc.text(`COMPRAS (${purchases.length})`, margin + 8, yPos + lineHeight * 0.6);
    yPos += lineHeight * 2.5;
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(11);
    doc.setFont('helvetica', 'normal');
    
    purchases.forEach((purchase, index) => {
      checkNewPage(lineHeight * 6);
      
      // Número do item
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(12);
      doc.setTextColor(249, 115, 22);
      doc.text(`${index + 1}.`, margin, yPos);
      
      // Produto - linha principal
      const productText = `${purchase.descricao}`;
      const codeText = `Código: ${purchase.codigo} | Cor: ${purchase.cor}`;
      const actionText = `COMPRAR ${purchase.quantidade} unidade(s)`;
      const filiaisText = purchase.filiais.length > 2 
        ? `Para: ${purchase.filiais.slice(0, -1).join(', ')} e ${purchase.filiais[purchase.filiais.length - 1]}`
        : `Para: ${purchase.filiais.join(' e ')}`;
      
      // Quebrar texto se necessário
      const maxWidth = pageWidth - margin * 2 - 15;
      const splitProduct = doc.splitTextToSize(productText, maxWidth);
      const splitCode = doc.splitTextToSize(codeText, maxWidth);
      const splitAction = doc.splitTextToSize(actionText, maxWidth);
      const splitFiliais = doc.splitTextToSize(filiaisText, maxWidth);
      
      let xPos = margin + 12;
      let currentY = yPos;
      
      // Nome do produto (negrito)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(0, 0, 0);
      splitProduct.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.9;
      });
      
      // Código e cor (menor, cinza)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(100, 100, 100);
      splitCode.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.8;
      });
      
      currentY += lineHeight * 0.3;
      
      // Ação (laranja, negrito)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(249, 115, 22);
      splitAction.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.9;
      });
      
      // Filiais (normal)
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(10);
      doc.setTextColor(0, 0, 0);
      splitFiliais.forEach((line: string) => {
        doc.text(line, xPos, currentY);
        currentY += lineHeight * 0.9;
      });
      
      yPos = currentY + lineHeight * 1.2;
      
      // Linha separadora sutil
      if (index < purchases.length - 1) {
        doc.setDrawColor(220, 220, 220);
        doc.line(margin, yPos - lineHeight * 0.3, pageWidth - margin, yPos - lineHeight * 0.3);
        yPos += lineHeight * 0.5;
      }
    });
  }

  // Se não houver ações
  if (transfers.length === 0 && purchases.length === 0) {
    doc.setFontSize(12);
    doc.setFont('helvetica', 'italic');
    doc.text('Nenhuma ação necessária no momento.', pageWidth / 2, yPos, { align: 'center' });
  }

  // Salvar PDF
  const fileName = `acoes-estoque-${companyName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`;
  doc.save(fileName);
}


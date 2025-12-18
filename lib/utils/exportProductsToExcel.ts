import ExcelJS from 'exceljs';
import type { ProductDetail } from '@/lib/repositories/products';
import type { SalesSummary } from '@/types/dashboard';
import type { DateRangeValue } from '@/components/filters/DateRangeFilter';
import type { CompanyKey } from '@/lib/config/company';

interface ExportProductsOptions {
  products: ProductDetail[];
  summary: SalesSummary;
  companyKey: CompanyKey;
  companyName: string;
  dateRange: DateRangeValue;
  groupByColor: boolean;
  acimaDoTicket: boolean;
  filters?: {
    filial?: string | null;
    grupos?: string[];
    linhas?: string[];
    colecoes?: string[];
    subgrupos?: string[];
    grades?: string[];
  };
}

/**
 * Mapeia os campos do ProductDetail para os nomes originais das colunas do banco de dados
 */
function getColumnMapping(
  companyKey: CompanyKey,
  groupByColor: boolean,
  acimaDoTicket: boolean
): Array<{
  key: keyof ProductDetail;
  dbName: string;
  type: 'string' | 'number' | 'date';
}> {
  const columns: Array<{
    key: keyof ProductDetail;
    dbName: string;
    type: 'string' | 'number' | 'date';
  }> = [
    { key: 'productId', dbName: 'PRODUTO', type: 'string' },
    { key: 'productName', dbName: 'DESC_PRODUTO', type: 'string' },
  ];

  // Grade apenas para scarfme
  if (companyKey === 'scarfme') {
    columns.push({ key: 'grade', dbName: 'GRADE', type: 'string' });
  }

  // Cor apenas quando groupByColor está ativo
  if (groupByColor) {
    columns.push({ key: 'corProduto', dbName: 'COR_PRODUTO', type: 'string' });
    columns.push({ key: 'descCorProduto', dbName: 'DESC_COR_PRODUTO', type: 'string' });
  }

  // Faturamento (calculado de PRECO_LIQUIDO * QTDE - DESCONTO_VENDA)
  columns.push({ key: 'totalRevenue', dbName: 'FATURAMENTO', type: 'number' });
  
  // Quantidade (SUM(QTDE))
  columns.push({ key: 'totalQuantity', dbName: 'QTD', type: 'number' });
  
  // Preço médio (calculado: FATURAMENTO / QTD)
  columns.push({ key: 'averagePrice', dbName: 'PRECO_MEDIO', type: 'number' });

  // Campos específicos para "acima do ticket"
  if (acimaDoTicket) {
    columns.push({ key: 'suggestedPrice', dbName: 'PRECO_REPOSICAO_1', type: 'number' });
    // Diferença e Diferença Total são calculados, não vêm do banco diretamente
    // Mas vamos adicionar campos calculados
  }

  // Custo (AVG(CUSTO))
  columns.push({ key: 'cost', dbName: 'CUSTO', type: 'number' });

  // Markup apenas quando não está em "acima do ticket"
  if (!acimaDoTicket) {
    columns.push({ key: 'markup', dbName: 'MARKUP', type: 'number' });
  }

  // Estoque
  columns.push({ key: 'stock', dbName: 'ESTOQUE', type: 'number' });

  // Estoque rede apenas para scarfme
  if (companyKey === 'scarfme') {
    columns.push({ key: 'estoqueRede', dbName: 'ESTOQUE_REDE', type: 'number' });
  }

  return columns;
}

/**
 * Formata a data para exibição
 */
function formatDate(date: Date): string {
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

/**
 * Exporta produtos para Excel com duas abas: KPIs e Produtos
 */
export function exportProductsToExcel(options: ExportProductsOptions): void {
  const {
    products,
    summary,
    companyKey,
    companyName,
    dateRange,
    groupByColor,
    acimaDoTicket,
    filters,
  } = options;

  const workbook = new ExcelJS.Workbook();

  // ===== ABA 1: KPIs =====
  const kpiData: Array<Record<string, string | number>> = [
    { Métrica: 'Vendas Total', Valor: summary.totalRevenue.currentValue },
    { Métrica: 'Vendas Total (Período Anterior)', Valor: summary.totalRevenue.previousValue },
    { Métrica: 'Variação Vendas (%)', Valor: summary.totalRevenue.changePercentage ?? '--' },
    { Métrica: '', Valor: '' }, // Linha em branco
    { Métrica: 'Produtos Vendidos', Valor: summary.totalQuantity.currentValue },
    { Métrica: 'Produtos Vendidos (Período Anterior)', Valor: summary.totalQuantity.previousValue },
    { Métrica: 'Variação Quantidade (%)', Valor: summary.totalQuantity.changePercentage ?? '--' },
    { Métrica: '', Valor: '' }, // Linha em branco
    { Métrica: 'Ticket Médio', Valor: summary.averageTicket.currentValue },
    { Métrica: 'Ticket Médio (Período Anterior)', Valor: summary.averageTicket.previousValue },
    { Métrica: 'Variação Ticket Médio (%)', Valor: summary.averageTicket.changePercentage ?? '--' },
    { Métrica: '', Valor: '' }, // Linha em branco
    { Métrica: 'Total de Tickets', Valor: summary.totalTickets.currentValue },
    { Métrica: 'Total de Tickets (Período Anterior)', Valor: summary.totalTickets.previousValue },
    { Métrica: 'Variação Tickets (%)', Valor: summary.totalTickets.changePercentage ?? '--' },
    { Métrica: '', Valor: '' }, // Linha em branco
    { Métrica: 'Estoque Total (Quantidade)', Valor: summary.totalStockQuantity.currentValue },
    { Métrica: 'Estoque Total (Valor)', Valor: summary.totalStockValue.currentValue },
    { Métrica: '', Valor: '' }, // Linha em branco
    { Métrica: 'Período', Valor: `${formatDate(dateRange.startDate)} a ${formatDate(dateRange.endDate)}` },
    { Métrica: 'Empresa', Valor: companyName },
  ];

  // Adicionar filtros aplicados
  if (filters) {
    kpiData.push({ Métrica: '', Valor: '' });
    kpiData.push({ Métrica: 'Filtros Aplicados', Valor: '' });
    
    if (filters.filial) {
      kpiData.push({ Métrica: 'Filial', Valor: filters.filial });
    }
    if (filters.grupos && filters.grupos.length > 0) {
      kpiData.push({ Métrica: 'Grupos', Valor: filters.grupos.join(', ') });
    }
    if (filters.linhas && filters.linhas.length > 0) {
      kpiData.push({ Métrica: 'Linhas', Valor: filters.linhas.join(', ') });
    }
    if (filters.colecoes && filters.colecoes.length > 0) {
      kpiData.push({ Métrica: 'Coleções', Valor: filters.colecoes.join(', ') });
    }
    if (filters.subgrupos && filters.subgrupos.length > 0) {
      kpiData.push({ Métrica: 'Subgrupos', Valor: filters.subgrupos.join(', ') });
    }
    if (filters.grades && filters.grades.length > 0) {
      kpiData.push({ Métrica: 'Grades', Valor: filters.grades.join(', ') });
    }
    kpiData.push({ Métrica: 'Agrupar por Cor', Valor: groupByColor ? 'Sim' : 'Não' });
    kpiData.push({ Métrica: 'Acima do Ticket', Valor: acimaDoTicket ? 'Sim' : 'Não' });
  }

  const kpiWorksheet = workbook.addWorksheet('KPIs');
  kpiWorksheet.columns = [
    { header: 'Métrica', key: 'Métrica', width: 40 },
    { header: 'Valor', key: 'Valor', width: 20 },
  ];
  kpiData.forEach((row) => {
    kpiWorksheet.addRow(row);
  });

  // ===== ABA 2: PRODUTOS =====
  const columnMapping = getColumnMapping(companyKey, groupByColor, acimaDoTicket);
  
  // Preparar dados dos produtos com nomes originais do banco
  const productsData = products.map((product) => {
    const row: Record<string, string | number | null> = {};
    
    columnMapping.forEach(({ key, dbName, type }) => {
      let value = product[key];
      
      if (value === null || value === undefined) {
        row[dbName] = null;
        return;
      }

      if (type === 'number') {
        // Garantir que números sejam números
        row[dbName] = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
      } else if (type === 'string') {
        row[dbName] = String(value);
      } else {
        // Para date ou qualquer outro tipo (incluindo boolean), converter para string
        // Se for uma data (objeto com toISOString), converter para ISO string
        const valueAsAny = value as any;
        if (type === 'date' && valueAsAny && typeof valueAsAny === 'object' && typeof valueAsAny.toISOString === 'function') {
          try {
            row[dbName] = valueAsAny.toISOString();
          } catch {
            row[dbName] = String(value);
          }
        } else {
          row[dbName] = String(value);
        }
      }
    });

    // Adicionar campos calculados para "acima do ticket"
    if (acimaDoTicket) {
      if (product.suggestedPrice !== null && product.suggestedPrice !== undefined) {
        const diferenca = product.averagePrice - product.suggestedPrice;
        const diferencaTotal = diferenca * product.totalQuantity;
        row['DIFERENCA'] = diferenca;
        row['DIFERENCA_TOTAL'] = diferencaTotal;
      } else {
        row['DIFERENCA'] = null;
        row['DIFERENCA_TOTAL'] = null;
      }
    }

    return row;
  });

  // Criar worksheet com os dados
  const productsWorksheet = workbook.addWorksheet('Produtos');

  // Preparar colunas
  const columns = columnMapping.map(({ dbName }) => ({
    header: dbName,
    key: dbName,
    width: Math.min(
      Math.max(
        dbName.length,
        ...productsData.map((row) => {
          const value = row[dbName];
          return value ? String(value).length : 0;
        })
      ) + 2,
      50
    ),
  }));

  // Adicionar colunas calculadas se necessário
  if (acimaDoTicket) {
    columns.push({ header: 'DIFERENCA', key: 'DIFERENCA', width: 15 });
    columns.push({ header: 'DIFERENCA_TOTAL', key: 'DIFERENCA_TOTAL', width: 18 });
  }

  productsWorksheet.columns = columns;

  // Adicionar dados
  productsData.forEach((row) => {
    productsWorksheet.addRow(row);
  });

  // Gerar nome do arquivo
  const dateStr = new Date().toISOString().split('T')[0];
  const filename = `produtos-por-venda-${companyKey}-${dateStr}.xlsx`;

  // Fazer download
  workbook.xlsx.writeBuffer().then((buffer) => {
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  });
}


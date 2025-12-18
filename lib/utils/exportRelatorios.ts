import ExcelJS from 'exceljs';

/**
 * Formata data para o formato usado pelo Python (dd/mm/yyyy)
 */
function formatarDataParaCSV(date: Date | string | null | undefined): string {
  if (!date) return '';
  
  let dateObj: Date;
  
  if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === 'string') {
    dateObj = new Date(date);
    if (isNaN(dateObj.getTime())) {
      return String(date);
    }
  } else {
    return '';
  }
  
  // Formato dd/mm/yyyy
  const dia = String(dateObj.getDate()).padStart(2, '0');
  const mes = String(dateObj.getMonth() + 1).padStart(2, '0');
  const ano = dateObj.getFullYear();
  
  return `${dia}/${mes}/${ano}`;
}

/**
 * Formata número para CSV (usa vírgula como decimal, como no Python)
 */
function formatarNumeroParaCSV(value: number | null | undefined): string {
  if (value == null || value === undefined) return '';
  if (typeof value !== 'number') return String(value);
  
  // Usar vírgula como separador decimal
  return String(value).replace('.', ',');
}

/**
 * Exporta dados para Excel (XLSX) - igual ao script Python
 */
export function exportToExcel(
  data: Record<string, any>[],
  nomeRelatorio: string
): void {
  if (data.length === 0) {
    alert('Não há dados para exportar');
    return;
  }

  // Preservar ordem das colunas (como aparecem no primeiro registro)
  const primeiraLinha = data[0];
  const colunas = Object.keys(primeiraLinha);
  
  // Lista de colunas que provavelmente são datas (baseado no script Python)
  const colunasData = [
    'DATA_REPOSICAO', 'DATA_PARA_TRANSFERENCIA', 'DATA_CADASTRAMENTO',
    'ULTIMA_SAIDA', 'ULTIMA_ENTRADA', 'DATA_AJUSTE',
    'DATA_VENDA',
    'EMISSAO', 'DATA_SAIDA', 'ENTREGA'
  ];
  
  // Converter datas para formato Excel (será formatado automaticamente como dd/mm/yyyy)
  const dadosFormatados = data.map(row => {
    const novoRow: Record<string, any> = {};
    colunas.forEach(col => {
      let valor = row[col];
      
      // Verificar se é uma coluna de data ou se parece com data
      const ehData = colunasData.includes(col) || 
                     (valor && typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}/.test(valor));
      
      if (ehData && valor) {
        // Se já for Date object, manter
        if (valor instanceof Date) {
          novoRow[col] = valor;
        } 
        // Se for string (ISO ou outro formato), converter para Date
        else if (typeof valor === 'string') {
          const date = new Date(valor);
          if (!isNaN(date.getTime())) {
            novoRow[col] = date;
          } else {
            novoRow[col] = valor;
          }
        } else {
          novoRow[col] = valor;
        }
      } else {
        novoRow[col] = valor;
      }
    });
    return novoRow;
  });

  // Criar workbook e worksheet
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(nomeRelatorio.substring(0, 31)); // Limite de 31 caracteres para nome da sheet

  // Adicionar cabeçalhos
  worksheet.columns = colunas.map((col) => ({
    header: col,
    key: col,
    width: Math.min(
      Math.max(
        col.length,
        ...dadosFormatados.map((row) => {
          const value = row[col];
          return value != null ? String(value).length : 0;
        })
      ) + 2,
      50
    ),
  }));

  // Definir formato de data para colunas de data (dd/mm/yyyy)
  colunas.forEach((col, colIndex) => {
    const firstValue = dadosFormatados[0]?.[col];
    if (firstValue instanceof Date) {
      worksheet.getColumn(colIndex + 1).numFmt = 'dd/mm/yyyy';
    }
  });

  // Adicionar dados
  dadosFormatados.forEach((row) => {
    worksheet.addRow(row);
  });

  // Gerar nome do arquivo (sem timestamp, como no script Python)
  const filename = `${nomeRelatorio}.xlsx`;

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

/**
 * Exporta dados para CSV - igual ao script Python (sep=';', decimal=',', encoding='utf-8-sig')
 */
export function exportToCSV(
  data: Record<string, any>[],
  nomeRelatorio: string
): void {
  if (data.length === 0) {
    alert('Não há dados para exportar');
    return;
  }

  // Preservar ordem das colunas
  const primeiraLinha = data[0];
  const colunas = Object.keys(primeiraLinha);

  // Converter valores para formato CSV (como o pandas faz)
  const formatarValor = (value: any): string => {
    if (value == null || value === undefined) return '';
    
    // Datas
    if (value instanceof Date) {
      return formatarDataParaCSV(value);
    }
    
    // Strings que parecem datas ISO
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return formatarDataParaCSV(date);
      }
    }
    
    // Números
    if (typeof value === 'number') {
      return formatarNumeroParaCSV(value);
    }
    
    // Booleanos
    if (typeof value === 'boolean') {
      return value ? 'True' : 'False';
    }
    
    // Strings e outros
    return String(value);
  };

  // Criar linhas CSV
  const rows: string[] = [];

  // Cabeçalho
  rows.push(colunas.join(';'));

  // Dados
  data.forEach((row) => {
    const values = colunas.map((col) => {
      const value = formatarValor(row[col]);
      
      // Escapar valores que contêm separador, aspas ou quebras de linha
      if (value.includes(';') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      
      return value;
    });
    rows.push(values.join(';'));
  });

  // Criar conteúdo CSV
  const csvContent = rows.join('\n');

  // Adicionar BOM para UTF-8 (utf-8-sig do Python)
  const BOM = '\uFEFF';
  const blob = new Blob([BOM + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });

  // Criar link de download
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // Gerar nome do arquivo (sem timestamp, como no script Python)
  link.download = `${nomeRelatorio}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

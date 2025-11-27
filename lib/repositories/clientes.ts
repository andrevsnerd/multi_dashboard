import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, getCurrentMonthRange } from '@/lib/utils/date';

export interface ClienteItem {
  data: Date;
  nomeCliente: string;
  telefone: string;
  cpf: string;
  endereco: string;
  complemento: string;
  bairro: string;
  cidade: string;
  vendedor: string;
  filial: string;
}

export interface ClientesQueryParams {
  company?: string;
  filial?: string | null;
  vendedor?: string | null;
  range?: {
    start?: Date | string;
    end?: Date | string;
  };
  searchTerm?: string;
}

function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'c'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  const isScarfme = companySlug === 'scarfme';
  const filiais = company.filialFilters[module] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar apenas ela
  // IMPORTANTE: Usar LTRIM/RTRIM para remover espaços e garantir correspondência exata
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('filial', sql.VarChar, specificFilial);
    return `AND LTRIM(RTRIM(CAST(${tableAlias}.FILIAL AS VARCHAR))) = LTRIM(RTRIM(CAST(@filial AS VARCHAR)))`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`filial${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@filial${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para scarfme: se for "Todas as filiais" (null), incluir também ecommerce
  // Para outras empresas: usar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === null) {
    // Incluir todas as filiais (normais + ecommerce)
    const allFiliais = filiais; // Já inclui todas as filiais da lista
    
    if (allFiliais.length === 0) {
      return '';
    }

    allFiliais.forEach((filial, index) => {
      request.input(`filial${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@filial${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  if (filiais.length === 0) {
    return '';
  }

  filiais.forEach((filial, index) => {
    request.input(`filial${index}`, sql.VarChar, filial);
  });

  const placeholders = filiais
    .map((_, index) => `@filial${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

export async function fetchClientes({
  company,
  filial,
  vendedor,
  range,
  searchTerm,
}: ClientesQueryParams = {}): Promise<ClienteItem[]> {
  return withRequest(async (request) => {
    // IMPORTANTE: O frontend envia datas como ISO strings (toISOString())
    // que converte para UTC. Precisamos converter de volta para o timezone local
    // para obter a data correta que o usuário selecionou.
    const parseDateToString = (dateStr: string | Date): string => {
      // Se já é Date, usar diretamente
      if (dateStr instanceof Date) {
        const year = dateStr.getFullYear();
        const month = String(dateStr.getMonth() + 1).padStart(2, '0');
        const day = String(dateStr.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      
      // Se é string ISO (ex: "2025-11-01T00:00:00.000Z"), converter para Date
      // e então extrair ano/mês/dia no timezone LOCAL (não UTC)
      const d = new Date(dateStr);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    let startDateStr: string;
    let endDateStr: string;
    
    if (range?.start && range?.end) {
      // Converter ISO string para Date e extrair data no timezone local
      const startDate = range.start instanceof Date ? range.start : new Date(range.start);
      startDateStr = parseDateToString(startDate);
      
      // Para o endDate, adicionar 1 dia (exclusivo) para incluir todo o dia final
      const endDate = range.end instanceof Date ? range.end : new Date(range.end);
      const endDatePlusOne = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
      endDateStr = parseDateToString(endDatePlusOne);
    } else {
      const defaultRange = getCurrentMonthRange();
      startDateStr = parseDateToString(defaultRange.start);
      const endDatePlusOne = new Date(defaultRange.end.getFullYear(), defaultRange.end.getMonth(), defaultRange.end.getDate() + 1);
      endDateStr = parseDateToString(endDatePlusOne);
    }
    
    // Log para debug
    console.log('[fetchClientes] Datas processadas:', { 
      originalStart: range?.start, 
      originalEnd: range?.end,
      startDateStr, 
      endDateStr 
    });
    
    // Usar sql.Date ao invés de sql.DateTime para evitar problemas de timezone
    request.input('startDate', sql.Date, startDateStr);
    request.input('endDate', sql.Date, endDateStr);

    const filialFilter = buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'cv'
    );
    
    console.log('[fetchClientes] Filtros:', {
      company,
      filial,
      vendedor,
      searchTerm,
      filialFilter: filialFilter.substring(0, 200), // Primeiros 200 chars
    });

    // Filtro de vendedor
    let vendedorFilter = '';
    if (vendedor && vendedor.trim() !== '') {
      // Filtrar por código do vendedor ou nome do vendedor
      // Pode ser código (ex: "7433") ou nome (ex: "ANA")
      const vendedorPattern = vendedor.trim();
      request.input('vendedorFilter', sql.VarChar, vendedorPattern);
      vendedorFilter = `AND (
        LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = @vendedorFilter
        OR LTRIM(RTRIM(ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, '')))) = @vendedorFilter
      )`;
    }

    // Filtro de pesquisa por nome do cliente ou vendedor
    let searchFilter = '';
    if (searchTerm && searchTerm.trim().length >= 2) {
      const searchPattern = `%${searchTerm.trim()}%`;
      request.input('searchTerm', sql.VarChar, searchPattern);
      searchFilter = `AND (
        cv.CLIENTE_VAREJO LIKE @searchTerm 
        OR ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)) LIKE @searchTerm
      )`;
    }

    // Query para buscar clientes cadastrados no período
    // Baseado no script Python: buscar diretamente de CLIENTES_VAREJO usando CADASTRAMENTO
    // Fazer join com LOJA_VENDEDORES para obter nome do vendedor
    // Usar CAST para comparar apenas a parte de data, ignorando hora/minuto/segundo
    const clientesQuery = `
      SELECT 
        CAST(cv.CADASTRAMENTO AS DATE) AS data,
        ISNULL(cv.CLIENTE_VAREJO, 'SEM NOME') AS nomeCliente,
        CASE 
          WHEN cv.DDD IS NOT NULL AND cv.TELEFONE IS NOT NULL 
          THEN cv.DDD + ' ' + cv.TELEFONE 
          ELSE ISNULL(cv.TELEFONE, '') 
        END AS telefone,
        ISNULL(cv.CPF_CGC, '') AS cpf,
        ISNULL(cv.ENDERECO, '') AS endereco,
        ISNULL(cv.COMPLEMENTO, '') AS complemento,
        ISNULL(cv.BAIRRO, '') AS bairro,
        ISNULL(cv.CIDADE, '') AS cidade,
        ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)) AS vendedor,
        cv.FILIAL AS filial
      FROM CLIENTES_VAREJO cv WITH (NOLOCK)
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
      WHERE CAST(cv.CADASTRAMENTO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(cv.CADASTRAMENTO AS DATE) < CAST(@endDate AS DATE)
        ${filialFilter}
        ${vendedorFilter}
        ${searchFilter}
      ORDER BY cv.CADASTRAMENTO ASC, cv.CLIENTE_VAREJO
    `;

    try {
      // Log da query completa para debug
      console.log('[fetchClientes] Query SQL completa:');
      console.log(clientesQuery);
      
      const result = await request.query<{
        data: Date;
        nomeCliente: string;
        telefone: string;
        cpf: string;
        endereco: string;
        complemento: string;
        bairro: string;
        cidade: string;
        vendedor: string;
        filial: string;
      }>(clientesQuery);

      console.log(`[fetchClientes] Resultado: ${result.recordset.length} clientes encontrados`);
      
      // Log de amostra dos primeiros 5 registros com mais detalhes
      if (result.recordset.length > 0) {
        console.log('[fetchClientes] Amostra dos primeiros 5 registros (RAW do SQL):');
        result.recordset.slice(0, 5).forEach((row, idx) => {
          const dataRaw = row.data;
          const dataType = typeof dataRaw;
          const dataStr = dataRaw instanceof Date 
            ? dataRaw.toISOString() 
            : String(dataRaw);
          console.log(`  ${idx + 1}. Data (tipo: ${dataType}): ${dataStr}, Nome: "${row.nomeCliente}", Filial: "${row.filial}", Vendedor: "${row.vendedor}"`);
        });
        
        // Verificar se há clientes com nome vazio ou NULL
        const clientesSemNome = result.recordset.filter(r => !r.nomeCliente || r.nomeCliente.trim() === '' || r.nomeCliente === 'SEM NOME');
        if (clientesSemNome.length > 0) {
          console.log(`[fetchClientes] AVISO: ${clientesSemNome.length} clientes sem nome ou com nome vazio`);
        }
        
        // Verificar datas fora do período esperado
        // IMPORTANTE: Extrair data diretamente da string ISO, não usar getFullYear/getMonth/getDate
        const datasForaPeriodo: string[] = [];
        result.recordset.forEach((row) => {
          const dataRaw = row.data;
          let dataStr: string;
          
          if (dataRaw instanceof Date) {
            // Extrair diretamente da string ISO para evitar problemas de timezone
            const isoString = dataRaw.toISOString();
            const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
            dataStr = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
          } else if (typeof dataRaw === 'string') {
            const match = dataRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
            dataStr = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
          } else {
            return;
          }
          
          if (dataStr && (dataStr < startDateStr || dataStr >= endDateStr)) {
            datasForaPeriodo.push(dataStr);
          }
        });
        
        if (datasForaPeriodo.length > 0) {
          console.log(`[fetchClientes] AVISO: ${datasForaPeriodo.length} registros com datas fora do período esperado (${startDateStr} a ${endDateStr}):`);
          const datasUnicas = [...new Set(datasForaPeriodo)].sort();
          console.log(`  Datas: ${datasUnicas.join(', ')}`);
        }
        
        // Verificar duplicatas por nome + data
        // IMPORTANTE: Extrair data diretamente da string ISO, não usar getFullYear/getMonth/getDate
        const duplicatas = new Map<string, number>();
        result.recordset.forEach((row) => {
          const dataRaw = row.data;
          let dataStr: string;
          
          if (dataRaw instanceof Date) {
            // Extrair diretamente da string ISO para evitar problemas de timezone
            const isoString = dataRaw.toISOString();
            const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
            dataStr = match ? `${match[1]}-${match[2]}-${match[3]}` : '';
          } else if (typeof dataRaw === 'string') {
            const match = dataRaw.match(/^(\d{4})-(\d{2})-(\d{2})/);
            dataStr = match ? `${match[1]}-${match[2]}-${match[3]}` : String(dataRaw);
          } else {
            return;
          }
          
          if (!dataStr) return;
          
          const key = `${dataStr}_${(row.nomeCliente || '').trim().toUpperCase()}`;
          duplicatas.set(key, (duplicatas.get(key) || 0) + 1);
        });
        
        const duplicatasEncontradas = Array.from(duplicatas.entries()).filter(([_, count]) => count > 1);
        if (duplicatasEncontradas.length > 0) {
          console.log(`[fetchClientes] AVISO: ${duplicatasEncontradas.length} clientes duplicados (mesmo nome + data):`);
          duplicatasEncontradas.slice(0, 10).forEach(([key, count]) => {
            console.log(`  ${key}: ${count} ocorrências`);
          });
        }
      }

      return result.recordset.map((row) => {
        // Converter data para Date object, tratando tanto Date quanto string
        // IMPORTANTE: O SQL retorna CAST(cv.CADASTRAMENTO AS DATE) que vem como "2025-11-01T00:00:00.000Z"
        // Precisamos extrair a data diretamente da string ISO, não usar getFullYear/getMonth/getDate
        // que são afetados pelo timezone local
        let dataDate: Date;
        
        if (row.data instanceof Date) {
          // Se já é Date, extrair a data diretamente da string ISO (toISOString)
          // para evitar problemas de timezone
          const isoString = row.data.toISOString();
          const dateMatch = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (dateMatch) {
            const year = parseInt(dateMatch[1], 10);
            const month = parseInt(dateMatch[2], 10) - 1; // Mês é 0-indexed
            const day = parseInt(dateMatch[3], 10);
            dataDate = new Date(year, month, day);
          } else {
            // Fallback: usar getFullYear/getMonth/getDate (pode ter problema de timezone)
            const year = row.data.getFullYear();
            const month = row.data.getMonth();
            const day = row.data.getDate();
            dataDate = new Date(year, month, day);
          }
        } else if (typeof row.data === 'string') {
          // Se a string está no formato "YYYY-MM-DD" (sem timezone),
          // criar Date no timezone local para evitar conversão UTC
          const dateMatch = row.data.match(/^(\d{4})-(\d{2})-(\d{2})/);
          if (dateMatch) {
            const year = parseInt(dateMatch[1], 10);
            const month = parseInt(dateMatch[2], 10) - 1; // Mês é 0-indexed
            const day = parseInt(dateMatch[3], 10);
            dataDate = new Date(year, month, day);
          } else {
            // Se for string ISO com timezone, extrair data diretamente da string
            const dateMatch = row.data.match(/^(\d{4})-(\d{2})-(\d{2})/);
            if (dateMatch) {
              const year = parseInt(dateMatch[1], 10);
              const month = parseInt(dateMatch[2], 10) - 1;
              const day = parseInt(dateMatch[3], 10);
              dataDate = new Date(year, month, day);
            } else {
              // Fallback
              const d = new Date(row.data);
              const isoString = d.toISOString();
              const match = isoString.match(/^(\d{4})-(\d{2})-(\d{2})/);
              if (match) {
                dataDate = new Date(parseInt(match[1], 10), parseInt(match[2], 10) - 1, parseInt(match[3], 10));
              } else {
                dataDate = new Date();
              }
            }
          }
        } else {
          dataDate = new Date();
        }
        
        // Log detalhado para os primeiros registros processados
        const isFirstFew = result.recordset.indexOf(row) < 3;
        if (isFirstFew) {
          console.log(`[fetchClientes] Processando registro ${result.recordset.indexOf(row) + 1}:`);
          console.log(`  Data RAW: ${row.data} (tipo: ${typeof row.data}, isDate: ${row.data instanceof Date})`);
          if (row.data instanceof Date) {
            console.log(`  Data RAW (toISOString): ${row.data.toISOString()}`);
            console.log(`  Data RAW (getFullYear/Month/Date - AFETADO POR TIMEZONE): ${row.data.getFullYear()}/${row.data.getMonth() + 1}/${row.data.getDate()}`);
          }
          console.log(`  Data processada: ${dataDate.toISOString()} (${dataDate.toLocaleDateString('pt-BR')})`);
          console.log(`  Nome: "${row.nomeCliente}"`);
        }
        
        return {
          data: dataDate,
          nomeCliente: row.nomeCliente || 'SEM NOME',
          telefone: row.telefone || '',
          cpf: row.cpf || '',
          endereco: row.endereco || '',
          complemento: row.complemento || '',
          bairro: row.bairro || '',
          cidade: row.cidade || '',
          vendedor: row.vendedor || 'SEM VENDEDOR',
          filial: row.filial || '',
        };
      });
    } catch (error) {
      console.error('Erro ao buscar clientes:', error);
      throw error;
    }
  });
}

export async function fetchClientesCount({
  company,
  filial,
  vendedor,
  range,
  searchTerm,
}: ClientesQueryParams = {}): Promise<number> {
  return withRequest(async (request) => {
    // IMPORTANTE: O frontend envia datas como ISO strings (toISOString())
    // que converte para UTC. Precisamos converter de volta para o timezone local
    // para obter a data correta que o usuário selecionou.
    const parseDateToString = (dateStr: string | Date): string => {
      // Se já é Date, usar diretamente
      if (dateStr instanceof Date) {
        const year = dateStr.getFullYear();
        const month = String(dateStr.getMonth() + 1).padStart(2, '0');
        const day = String(dateStr.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      
      // Se é string ISO (ex: "2025-11-01T00:00:00.000Z"), converter para Date
      // e então extrair ano/mês/dia no timezone LOCAL (não UTC)
      const d = new Date(dateStr);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    let startDateStr: string;
    let endDateStr: string;
    
    if (range?.start && range?.end) {
      // Converter ISO string para Date e extrair data no timezone local
      const startDate = range.start instanceof Date ? range.start : new Date(range.start);
      startDateStr = parseDateToString(startDate);
      
      // Para o endDate, adicionar 1 dia (exclusivo) para incluir todo o dia final
      const endDate = range.end instanceof Date ? range.end : new Date(range.end);
      const endDatePlusOne = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
      endDateStr = parseDateToString(endDatePlusOne);
    } else {
      const defaultRange = getCurrentMonthRange();
      startDateStr = parseDateToString(defaultRange.start);
      const endDatePlusOne = new Date(defaultRange.end.getFullYear(), defaultRange.end.getMonth(), defaultRange.end.getDate() + 1);
      endDateStr = parseDateToString(endDatePlusOne);
    }
    
    // Usar sql.Date ao invés de sql.DateTime para evitar problemas de timezone
    request.input('startDate', sql.Date, startDateStr);
    request.input('endDate', sql.Date, endDateStr);

    const filialFilter = buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'cv'
    );

    // Filtro de vendedor
    let vendedorFilter = '';
    if (vendedor && vendedor.trim() !== '') {
      const vendedorPattern = vendedor.trim();
      request.input('vendedorFilter', sql.VarChar, vendedorPattern);
      vendedorFilter = `AND (
        LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = @vendedorFilter
        OR LTRIM(RTRIM(ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, '')))) = @vendedorFilter
      )`;
    }

    let searchFilter = '';
    if (searchTerm && searchTerm.trim().length >= 2) {
      const searchPattern = `%${searchTerm.trim()}%`;
      request.input('searchTerm', sql.VarChar, searchPattern);
      searchFilter = `AND (
        cv.CLIENTE_VAREJO LIKE @searchTerm 
        OR ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)) LIKE @searchTerm
      )`;
    }

    // IMPORTANTE: Não usar DISTINCT no COUNT, pois pode haver clientes com mesmo nome mas registros diferentes
    // O script Python não usa DISTINCT, então devemos seguir o mesmo padrão
    const countQuery = `
      SELECT COUNT(*) AS total
      FROM CLIENTES_VAREJO cv WITH (NOLOCK)
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
      WHERE CAST(cv.CADASTRAMENTO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(cv.CADASTRAMENTO AS DATE) < CAST(@endDate AS DATE)
        ${filialFilter}
        ${vendedorFilter}
        ${searchFilter}
    `;
    
    console.log('[fetchClientesCount] Query COUNT:', countQuery);

    const result = await request.query<{ total: number }>(countQuery);
    return result.recordset[0]?.total || 0;
  });
}

// Função para buscar lista de vendedores únicos que cadastraram clientes no período
export async function fetchVendedoresList({
  company,
  filial,
  range,
}: {
  company?: string;
  filial?: string | null;
  range?: {
    start?: Date | string;
    end?: Date | string;
  };
}): Promise<Array<{ codigo: string; nome: string }>> {
  return withRequest(async (request) => {
    // Processar datas da mesma forma que fetchClientes
    const parseDateToString = (dateStr: string | Date): string => {
      if (dateStr instanceof Date) {
        const year = dateStr.getFullYear();
        const month = String(dateStr.getMonth() + 1).padStart(2, '0');
        const day = String(dateStr.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
      
      const d = new Date(dateStr);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };
    
    let startDateStr: string;
    let endDateStr: string;
    
    if (range?.start && range?.end) {
      const startDate = range.start instanceof Date ? range.start : new Date(range.start);
      startDateStr = parseDateToString(startDate);
      
      const endDate = range.end instanceof Date ? range.end : new Date(range.end);
      const endDatePlusOne = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + 1);
      endDateStr = parseDateToString(endDatePlusOne);
    } else {
      const defaultRange = getCurrentMonthRange();
      startDateStr = parseDateToString(defaultRange.start);
      const endDatePlusOne = new Date(defaultRange.end.getFullYear(), defaultRange.end.getMonth(), defaultRange.end.getDate() + 1);
      endDateStr = parseDateToString(endDatePlusOne);
    }
    
    request.input('startDate', sql.Date, startDateStr);
    request.input('endDate', sql.Date, endDateStr);

    const filialFilter = buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'cv'
    );

    // Query para buscar vendedores únicos que cadastraram clientes no período
    const vendedoresQuery = `
      SELECT DISTINCT
        LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) AS codigo,
        LTRIM(RTRIM(ISNULL(lv.VENDEDOR_APELIDO, ISNULL(lv.NOME_VENDEDOR, cv.VENDEDOR)))) AS nome
      FROM CLIENTES_VAREJO cv WITH (NOLOCK)
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
      WHERE CAST(cv.CADASTRAMENTO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(cv.CADASTRAMENTO AS DATE) < CAST(@endDate AS DATE)
        ${filialFilter}
        AND LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) IS NOT NULL
        AND LTRIM(RTRIM(CAST(cv.VENDEDOR AS VARCHAR))) <> ''
      ORDER BY nome
    `;

    try {
      const result = await request.query<{
        codigo: string;
        nome: string;
      }>(vendedoresQuery);

      return result.recordset.map((row) => ({
        codigo: row.codigo || '',
        nome: row.nome || row.codigo || 'SEM VENDEDOR',
      }));
    } catch (error) {
      console.error('Erro ao buscar lista de vendedores:', error);
      throw error;
    }
  });
}

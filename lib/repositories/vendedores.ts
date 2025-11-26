import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery } from '@/lib/utils/date';

export interface VendedorItem {
  vendedor: string;
  filial: string;
  faturamento: number;
  quantidadeVendida: number;
  tickets: number;
  ticketMedio: number;
  quantidadePorTicket: number;
  participacaoFilial: number;
  grupoMaisVendido?: string;
  subgrupoMaisVendido?: string;
}

export interface VendedorProdutoItem {
  grupo?: string;
  linha?: string;
  colecao?: string;
  subgrupo?: string;
  grade?: string;
  descricao: string;
  faturamento: number;
  quantidade: number;
}

export interface VendedoresQueryParams {
  company?: string;
  filial?: string | null;
  range?: {
    start?: Date | string;
    end?: Date | string;
  };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
}

function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp'
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
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input('filial', sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @filial`;
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

export async function fetchVendedores({
  company,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: VendedoresQueryParams = {}): Promise<VendedorItem[]> {
  return withRequest(async (request) => {
    const { start, end } = normalizeRangeForQuery(range);
    
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'vp'
    );

    // Filtros adicionais por grupo/linha/coleção/subgrupo/grade
    const buildListFilter = (
      fieldExpression: string,
      values: string[] | undefined,
      paramBase: string
    ): string => {
      if (!values || values.length === 0) {
        return '';
      }

      const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== '');
      if (nonEmpty.length === 0) {
        return '';
      }

      nonEmpty.forEach((value, index) => {
        request.input(`${paramBase}${index}`, sql.VarChar, value);
      });

      const placeholders = nonEmpty
        .map((_, index) => `@${paramBase}${index}`)
        .join(', ');

      return `AND ${fieldExpression} IN (${placeholders})`;
    };

    const grupoFilter = buildListFilter(
      "COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')",
      grupos,
      'grupo'
    );

    const linhaFilter = buildListFilter(
      "COALESCE(vp.LINHA, p.LINHA, '')",
      linhas,
      'linha'
    );

    const colecaoFilter = buildListFilter(
      "COALESCE(vp.COLECAO, p.COLECAO, '')",
      colecoes,
      'colecao'
    );

    const subgrupoFilter = buildListFilter(
      "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')",
      subgrupos,
      'subgrupo'
    );

    const gradeFilter = buildListFilter(
      "CONVERT(VARCHAR, p.GRADE)",
      grades,
      'grade'
    );

    // Query para buscar dados dos vendedores
    // Primeiro, buscar faturamento total por filial para calcular participação
    const filialTotalQuery = `
      SELECT 
        vp.FILIAL,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS totalFaturamentoFilial
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY vp.FILIAL
    `;

    // Query principal para buscar dados dos vendedores
    // Usar VENDEDOR_APELIDO da tabela W_CTB_LOJA_VENDA_PEDIDO para obter o nome completo
    const vendedoresQuery = `
      SELECT 
        ISNULL(MAX(v.VENDEDOR_APELIDO), ISNULL(MAX(vp.VENDEDOR), 'SEM VENDEDOR')) AS vendedor,
        vp.FILIAL AS filial,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS faturamento,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END
        ) AS quantidadeVendida,
        COUNT(DISTINCT CASE
          WHEN vp.QTDE_CANCELADA = 0 AND vp.QTDE > 0
          THEN vp.TICKET
          ELSE NULL
        END) AS tickets
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        ON v.FILIAL = vp.FILIAL 
        AND v.PEDIDO = vp.PEDIDO 
        AND v.TICKET = vp.TICKET
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY vp.VENDEDOR, vp.FILIAL
      HAVING SUM(
        CASE
          WHEN vp.QTDE_CANCELADA > 0 THEN 0
          ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
        END
      ) > 0
    `;

    // Query para buscar grupo/subgrupo mais vendido por vendedor
    // Usar ROW_NUMBER para pegar o grupo/subgrupo com maior faturamento
    const grupoMaisVendidoQuery = `
      WITH GrupoVendas AS (
        SELECT 
          ISNULL(v.VENDEDOR_APELIDO, vp.VENDEDOR) AS vendedor,
          vp.VENDEDOR AS vendedorCodigo,
          vp.FILIAL AS filial,
          ISNULL(vp.GRUPO_PRODUTO, 'SEM GRUPO') AS grupo,
          ISNULL(vp.SUBGRUPO_PRODUTO, 'SEM SUBGRUPO') AS subgrupo,
          SUM(
            CASE
              WHEN vp.QTDE_CANCELADA > 0 THEN 0
              ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
            END
          ) AS faturamentoGrupo,
          ROW_NUMBER() OVER (
            PARTITION BY ISNULL(v.VENDEDOR_APELIDO, vp.VENDEDOR), vp.FILIAL 
            ORDER BY SUM(
              CASE
                WHEN vp.QTDE_CANCELADA > 0 THEN 0
                ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
              END
            ) DESC
          ) AS rn
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
          ON v.FILIAL = vp.FILIAL 
          AND v.PEDIDO = vp.PEDIDO 
          AND v.TICKET = vp.TICKET
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
        GROUP BY ISNULL(v.VENDEDOR_APELIDO, vp.VENDEDOR), vp.VENDEDOR, vp.FILIAL, vp.GRUPO_PRODUTO, vp.SUBGRUPO_PRODUTO
        HAVING SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) > 0
      )
      SELECT 
        vendedor,
        filial,
        grupo,
        subgrupo
      FROM GrupoVendas
      WHERE rn = 1
    `;

    const [filialTotalResult, vendedoresResult, grupoMaisVendidoResult] = await Promise.all([
      request.query<{ FILIAL: string; totalFaturamentoFilial: number }>(filialTotalQuery),
      request.query<{
        vendedor: string;
        filial: string;
        faturamento: number;
        quantidadeVendida: number;
        tickets: number;
      }>(vendedoresQuery),
      request.query<{
        vendedor: string;
        filial: string;
        grupo: string;
        subgrupo: string;
        faturamentoGrupo: number;
      }>(grupoMaisVendidoQuery),
    ]);

    // Criar mapa de faturamento total por filial
    const filialTotalMap = new Map<string, number>();
    filialTotalResult.recordset.forEach((row) => {
      filialTotalMap.set(row.FILIAL, row.totalFaturamentoFilial || 0);
    });

    // Criar mapa de grupo/subgrupo mais vendido por vendedor
    const grupoMaisVendidoMap = new Map<string, { grupo?: string; subgrupo?: string }>();
    const isScarfme = company === 'scarfme';
    
    grupoMaisVendidoResult.recordset.forEach((row) => {
      const key = `${row.vendedor}::${row.filial}`;
      grupoMaisVendidoMap.set(key, {
        grupo: row.grupo && row.grupo !== 'SEM GRUPO' ? row.grupo : undefined,
        subgrupo: row.subgrupo && row.subgrupo !== 'SEM SUBGRUPO' ? row.subgrupo : undefined,
      });
    });

    // Processar resultados e calcular métricas
    const vendedores: VendedorItem[] = vendedoresResult.recordset.map((row) => {
      const faturamento = row.faturamento || 0;
      const quantidadeVendida = row.quantidadeVendida || 0;
      const tickets = row.tickets || 0;
      const totalFaturamentoFilial = filialTotalMap.get(row.filial) || 0;

      const ticketMedio = tickets > 0 ? faturamento / tickets : 0;
      const quantidadePorTicket = tickets > 0 ? quantidadeVendida / tickets : 0;
      const participacaoFilial = totalFaturamentoFilial > 0 
        ? (faturamento / totalFaturamentoFilial) * 100 
        : 0;

      const key = `${row.vendedor}::${row.filial}`;
      const grupoMaisVendido = grupoMaisVendidoMap.get(key);

      return {
        vendedor: row.vendedor || 'SEM VENDEDOR',
        filial: row.filial,
        faturamento,
        quantidadeVendida,
        tickets,
        ticketMedio,
        quantidadePorTicket,
        participacaoFilial,
        grupoMaisVendido: isScarfme ? undefined : grupoMaisVendido?.grupo,
        subgrupoMaisVendido: isScarfme ? grupoMaisVendido?.subgrupo : undefined,
      };
    });

    // Ordenar por faturamento (decrescente)
    return vendedores.sort((a, b) => b.faturamento - a.faturamento);
  });
}

export interface VendedorProdutosQueryParams {
  company?: string;
  vendedor: string;
  filial: string;
  range?: {
    start?: Date | string;
    end?: Date | string;
  };
  grupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  subgrupos?: string[];
  grades?: string[];
}

export async function fetchVendedorProdutos({
  company,
  vendedor,
  filial,
  range,
  grupos,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: VendedorProdutosQueryParams): Promise<VendedorProdutoItem[]> {
  return withRequest(async (request) => {
    const { start, end } = normalizeRangeForQuery(range);
    
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('vendedor', sql.VarChar, vendedor);
    request.input('filial', sql.VarChar, filial);

    // Filtros adicionais por grupo/linha/coleção/subgrupo/grade
    const buildListFilter = (
      fieldExpression: string,
      values: string[] | undefined,
      paramBase: string
    ): string => {
      if (!values || values.length === 0) {
        return '';
      }

      const nonEmpty = values.map((v) => v.trim()).filter((v) => v !== '');
      if (nonEmpty.length === 0) {
        return '';
      }

      nonEmpty.forEach((value, index) => {
        request.input(`${paramBase}${index}`, sql.VarChar, value);
      });

      const placeholders = nonEmpty
        .map((_, index) => `@${paramBase}${index}`)
        .join(', ');

      return `AND ${fieldExpression} IN (${placeholders})`;
    };

    const grupoFilter = buildListFilter(
      "COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '')",
      grupos,
      'grupo'
    );

    const linhaFilter = buildListFilter(
      "COALESCE(vp.LINHA, p.LINHA, '')",
      linhas,
      'linha'
    );

    const colecaoFilter = buildListFilter(
      "COALESCE(vp.COLECAO, p.COLECAO, '')",
      colecoes,
      'colecao'
    );

    const subgrupoFilter = buildListFilter(
      "COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')",
      subgrupos,
      'subgrupo'
    );

    const gradeFilter = buildListFilter(
      "CONVERT(VARCHAR, p.GRADE)",
      grades,
      'grade'
    );

    // Query para buscar produtos vendidos pelo vendedor
    // Usar VENDEDOR_APELIDO para fazer o match
    // Não usar buildFilialFilter aqui pois já estamos filtrando diretamente por filial
    const produtosQuery = `
      SELECT 
        ISNULL(MAX(vp.GRUPO_PRODUTO), 'SEM GRUPO') AS grupo,
        ISNULL(MAX(COALESCE(vp.LINHA, p.LINHA, '')), '') AS linha,
        ISNULL(MAX(COALESCE(vp.COLECAO, p.COLECAO, '')), '') AS colecao,
        ISNULL(MAX(COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, '')), '') AS subgrupo,
        ISNULL(MAX(CONVERT(VARCHAR, p.GRADE)), '') AS grade,
        ISNULL(MAX(vp.DESC_PRODUTO), 'SEM DESCRIÇÃO') AS descricao,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END
        ) AS faturamento,
        SUM(
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END
        ) AS quantidade
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        ON v.FILIAL = vp.FILIAL 
        AND v.PEDIDO = vp.PEDIDO 
        AND v.TICKET = vp.TICKET
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND vp.FILIAL = @filial
        AND (
          ISNULL(v.VENDEDOR_APELIDO, vp.VENDEDOR) = @vendedor
          OR vp.VENDEDOR = @vendedor
        )
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY vp.PRODUTO, vp.DESC_PRODUTO
      HAVING SUM(
        CASE
          WHEN vp.QTDE_CANCELADA > 0 THEN 0
          ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
        END
      ) > 0
      ORDER BY faturamento DESC
    `;

    const produtosResult = await request.query<{
      grupo: string;
      linha: string;
      colecao: string;
      subgrupo: string;
      grade: string;
      descricao: string;
      faturamento: number;
      quantidade: number;
    }>(produtosQuery);

    return produtosResult.recordset.map((row) => ({
      grupo: row.grupo && row.grupo !== 'SEM GRUPO' ? row.grupo : undefined,
      linha: row.linha && row.linha !== '' ? row.linha : undefined,
      colecao: row.colecao && row.colecao !== '' ? row.colecao : undefined,
      subgrupo: row.subgrupo && row.subgrupo !== '' ? row.subgrupo : undefined,
      grade: row.grade && row.grade !== '' ? row.grade : undefined,
      descricao: row.descricao || 'SEM DESCRIÇÃO',
      faturamento: row.faturamento || 0,
      quantidade: row.quantidade || 0,
    }));
  });
}


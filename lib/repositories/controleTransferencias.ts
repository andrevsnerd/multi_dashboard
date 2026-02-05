import sql from 'mssql';

import { resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import { getColorDescription, normalizeColor } from '@/lib/utils/colorMapping';

export interface ControleTransferenciasParams {
  company?: string;
  filial?: string | null;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
}

export interface FilialData {
  filial: string;
  stock: number;
  sales: number;
  salesLast30Days: number;
  ultimaEntrada?: Date | null; // Data da última entrada na filial
}

export interface ProdutoTransferencia {
  produto: string;
  cor: string;
  /** Código da cor no sistema (ex.: código do banco) */
  codigoCor?: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  filiais: FilialData[];
  totalVendas: number;
  totalEstoque: number;
}

function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  specificFilial?: string | null,
  prefix: string = 'e'
): string {
  if (!companySlug) {
    return '';
  }

  const company = resolveCompany(companySlug);

  if (!company) {
    return '';
  }

  const filiais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar apenas ela
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    const filialParam = `filial${prefix}`;
    request.input(filialParam, sql.VarChar, specificFilial);
    return `AND ${prefix}.FILIAL = @${filialParam}`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (companySlug === 'scarfme' && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`filial${prefix}${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@filial${prefix}${index}`)
      .join(', ');

    return `AND ${prefix}.FILIAL IN (${placeholders})`;
  }

  // Para todas as filiais (incluindo ecommerce se for scarfme)
  if (filiais.length === 0) {
    return '';
  }

  filiais.forEach((filial, index) => {
    request.input(`filial${prefix}${index}`, sql.VarChar, filial);
  });

  const placeholders = filiais
    .map((_, index) => `@filial${prefix}${index}`)
    .join(', ');

  return `AND ${prefix}.FILIAL IN (${placeholders})`;
}

/**
 * Busca dados otimizados para cálculo de transferências
 * Query simplificada focada apenas no necessário
 */
export async function fetchControleTransferencias({
  company,
  filial,
  range,
}: ControleTransferenciasParams = {}): Promise<ProdutoTransferencia[]> {
  return withRequest(async (request) => {
    const { start, end } = normalizeRangeForQuery({
      start: range?.start,
      end: range?.end,
    });

    // Calcular data de 30 dias atrás
    const thirtyDaysAgo = new Date(end);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('thirtyDaysAgo', sql.DateTime, thirtyDaysAgo);

    const estoqueFilialFilter = buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = buildFilialFilter(request, company, filial, 'vp');

    // Verificar se precisa buscar vendas de e-commerce (ScarfMe e filial null)
    const companyConfig = resolveCompany(company);
    const isScarfme = company === 'scarfme';
    const shouldIncludeEcommerce = isScarfme && filial === null;
    const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
    
    // Criar filtro de filial para e-commerce
    let ecommerceFilialFilter = '';
    if (shouldIncludeEcommerce && ecommerceFilials.length > 0) {
      ecommerceFilials.forEach((filialName, index) => {
        request.input(`ecommerceFilial${index}`, sql.VarChar, filialName);
      });
      const placeholders = ecommerceFilials
        .map((_, index) => `@ecommerceFilial${index}`)
        .join(', ');
      ecommerceFilialFilter = `AND f.FILIAL IN (${placeholders})`;
    }

    // Query otimizada: busca estoque agrupado por produto+cor+filial
    const estoqueQuery = `
      SELECT 
        e.PRODUTO AS produto,
        e.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        e.FILIAL AS filial,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
      GROUP BY e.PRODUTO, e.COR_PRODUTO, c.DESC_COR, e.FILIAL
    `;

    // Query otimizada: busca vendas do período
    const vendasQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    // Query otimizada: busca vendas dos últimos 30 dias
    const vendasLast30DaysQuery = `
      SELECT 
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendas
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @thirtyDaysAgo
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    // Query para buscar vendas de e-commerce do período (apenas ScarfMe quando filial é null)
    const ecommerceVendasQuery = shouldIncludeEcommerce ? `
      SELECT 
        fp.PRODUTO AS produto,
        fp.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        f.FILIAL AS filial,
        SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON fp.COR_PRODUTO = c.COR
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND CAST(fp.QTDE AS FLOAT) > 0
        ${ecommerceFilialFilter}
      GROUP BY fp.PRODUTO, fp.COR_PRODUTO, c.DESC_COR, f.FILIAL
    ` : 'SELECT NULL AS produto, NULL AS corProduto, NULL AS corBanco, NULL AS filial, 0 AS vendas WHERE 1=0';

    // Query para buscar vendas de e-commerce dos últimos 30 dias
    const ecommerceVendasLast30DaysQuery = shouldIncludeEcommerce ? `
      SELECT 
        fp.PRODUTO AS produto,
        fp.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        f.FILIAL AS filial,
        SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON fp.COR_PRODUTO = c.COR
      WHERE CAST(f.EMISSAO AS DATE) >= CAST(@thirtyDaysAgo AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND CAST(fp.QTDE AS FLOAT) > 0
        ${ecommerceFilialFilter}
      GROUP BY fp.PRODUTO, fp.COR_PRODUTO, c.DESC_COR, f.FILIAL
    ` : 'SELECT NULL AS produto, NULL AS corProduto, NULL AS corBanco, NULL AS filial, 0 AS vendas WHERE 1=0';

    // Query para buscar última data de entrada por produto+cor+filial
    // Busca em ESTOQUE_PROD_ENT e também em LOJA_ENTRADAS_PRODUTO (priorizando a mais recente)
    // Criar filtro de filial para a query de entrada (usando alias E, mas com prefixo diferente para evitar conflito de variáveis)
    const ultimaEntradaFilialFilter = buildFilialFilter(request, company, filial, 'ent');
    // Ajustar o filtro para usar o alias E na query (substituir 'ent.' por 'E.')
    const ultimaEntradaFilialFilterAjustado = ultimaEntradaFilialFilter.replace(/ent\./g, 'E.');
    // Criar filtro para LOJA_ENTRADAS (usando prefixo 'le' para evitar conflito)
    const lojaEntradasFilialFilter = buildFilialFilter(request, company, filial, 'le');
    // Ajustar o filtro para usar o alias LE na query (substituir 'le.' por 'LE.')
    const lojaEntradasFilialFilterAjustado = lojaEntradasFilialFilter.replace(/le\./g, 'LE.');
    const ultimaEntradaQuery = `
      SELECT 
        produto,
        corProduto,
        corBanco,
        filial,
        MAX(ultimaEntrada) AS ultimaEntrada
      FROM (
        -- Entradas de ESTOQUE_PROD_ENT
        SELECT 
          P.PRODUTO AS produto,
          P.COR_PRODUTO AS corProduto,
          ISNULL(c.DESC_COR, '') AS corBanco,
          E.FILIAL AS filial,
          E.EMISSAO AS ultimaEntrada
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
          ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON P.COR_PRODUTO = c.COR
        WHERE P.PRODUTO IS NOT NULL
          ${ultimaEntradaFilialFilterAjustado}
        
        UNION ALL
        
        -- Entradas de LOJA_ENTRADAS_PRODUTO
        SELECT 
          LEP.PRODUTO AS produto,
          LEP.COR_PRODUTO AS corProduto,
          ISNULL(c.DESC_COR, '') AS corBanco,
          LE.FILIAL AS filial,
          LE.EMISSAO AS ultimaEntrada
        FROM LOJA_ENTRADAS_PRODUTO AS LEP WITH (NOLOCK)
        INNER JOIN LOJA_ENTRADAS AS LE WITH (NOLOCK)
          ON LEP.FILIAL = LE.FILIAL
          AND LEP.ROMANEIO_PRODUTO = LE.ROMANEIO_PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON LEP.COR_PRODUTO = c.COR
        WHERE LEP.PRODUTO IS NOT NULL
          ${lojaEntradasFilialFilterAjustado}
      ) AS todas_entradas
      GROUP BY produto, corProduto, corBanco, filial
    `;

    // Query para informações do produto (descrição e código)
    // Para scarfme, também buscar subgrupo e grade
    // isScarfme já foi declarado acima, reutilizar
    const subgrupoFieldEstoque = isScarfme ? ', ISNULL(p.SUBGRUPO_PRODUTO, \'\') AS subgrupo' : '';
    const gradeFieldEstoque = isScarfme ? ', ISNULL(CONVERT(VARCHAR, p.GRADE), \'\') AS grade' : '';
    const subgrupoFieldVendas = isScarfme ? ', ISNULL(COALESCE(vp.SUBGRUPO_PRODUTO, p.SUBGRUPO_PRODUTO), \'\') AS subgrupo' : '';
    const gradeFieldVendas = isScarfme ? ', ISNULL(CONVERT(VARCHAR, p.GRADE), \'\') AS grade' : '';
    
    const produtoInfoQuery = `
      SELECT DISTINCT
        e.PRODUTO AS produto,
        e.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        ISNULL(p.DESC_PRODUTO, '') AS descricao
        ${subgrupoFieldEstoque}
        ${gradeFieldEstoque}
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
      WHERE 1=1
        ${estoqueFilialFilter}
      
      UNION
      
      SELECT DISTINCT
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        ISNULL(vp.DESC_PRODUTO, '') AS descricao
        ${subgrupoFieldVendas}
        ${gradeFieldVendas}
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
      WHERE vp.DATA_VENDA >= @thirtyDaysAgo
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
    `;

    // Query para buscar códigos de barras
    const codigoBarraQuery = `
      SELECT DISTINCT
        pb.PRODUTO AS produto,
        pb.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, ''), '') AS corBanco,
        pb.CODIGO_BARRA AS codigoBarra
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON pb.COR_PRODUTO = c.COR
      WHERE pb.CODIGO_BARRA IS NOT NULL
        AND pb.CODIGO_BARRA <> ''
    `;

    // Executar todas as queries em paralelo
    const [estoqueResult, vendasResult, vendasLast30DaysResult, ecommerceVendasResult, ecommerceVendasLast30DaysResult, produtoInfoResult, codigoBarraResult, ultimaEntradaResult] = await Promise.all([
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        positiveStock: number | null;
        negativeStock: number | null;
      }>(estoqueQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(vendasQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(vendasLast30DaysQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(ecommerceVendasQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendas: number | null;
      }>(ecommerceVendasLast30DaysQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        descricao: string;
        subgrupo?: string;
        grade?: string;
      }>(produtoInfoQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        codigoBarra: string | null;
      }>(codigoBarraQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        ultimaEntrada: Date | null;
      }>(ultimaEntradaQuery),
    ]);

    // Chave estável por código de produto e código de cor (evita duplicatas quando corBanco vem diferente das queries)
    const getChaveStable = (produto: string, corProduto: string | null | undefined): string => {
      const p = (produto || '').trim();
      const c = (corProduto || '').trim().toUpperCase();
      return `${p}|${c}`;
    };

    // Função auxiliar para normalizar filial (usar em todos os lugares)
    const normalizeFilial = (filial: string | null | undefined): string => {
      return (filial || '').trim().toUpperCase();
    };

    // Criar mapeamento reverso de filialDisplayNames para encontrar nome canônico
    // Se "LEBLON" está mapeado para "NERD LEBLON", precisamos encontrar "NERD LEBLON" quando vier "LEBLON"
    // companyConfig já foi declarado acima, reutilizar
    const filialCanonicoMap = new Map<string, string>();
    if (companyConfig?.filialDisplayNames) {
      // Criar mapeamento reverso: displayName -> nomeCanonico
      Object.entries(companyConfig.filialDisplayNames).forEach(([canonico, display]) => {
        const canonicoNormalizado = normalizeFilial(canonico);
        const displayNormalizado = normalizeFilial(display);
        // Mapear tanto o nome canônico quanto o display name para o nome canônico
        filialCanonicoMap.set(canonicoNormalizado, canonicoNormalizado);
        filialCanonicoMap.set(displayNormalizado, canonicoNormalizado);
      });
    }

    // Função para obter nome canônico da filial
    // Sempre retorna o nome canônico (do filtro) para garantir consistência
    const getFilialCanonico = (filial: string): string => {
      const normalizado = normalizeFilial(filial);
      
      // 1. Verificar correspondência exata com filiais do filtro (prioridade máxima)
      if (companyConfig?.filialFilters?.inventory) {
        for (const filialFiltro of companyConfig.filialFilters.inventory) {
          const filialFiltroNormalizada = normalizeFilial(filialFiltro);
          if (normalizado === filialFiltroNormalizada) {
            return filialFiltroNormalizada; // Retornar nome canônico do filtro
          }
        }
      }
      
      // 2. Verificar se existe no mapeamento reverso (display name -> canônico)
      if (filialCanonicoMap.has(normalizado)) {
        return filialCanonicoMap.get(normalizado)!;
      }
      
      // 3. Verificar correspondência parcial com filiais do filtro
      // Ex: "LEBLON" deve mapear para "NERD LEBLON" se "NERD LEBLON" está no filtro
      if (companyConfig?.filialFilters?.inventory) {
        for (const filialFiltro of companyConfig.filialFilters.inventory) {
          const filialFiltroNormalizada = normalizeFilial(filialFiltro);
          // Se o nome do banco está contido no nome do filtro ou vice-versa
          if (normalizado.includes(filialFiltroNormalizada) || filialFiltroNormalizada.includes(normalizado)) {
            // Sempre preferir o nome do filtro (mais completo e canônico)
            return filialFiltroNormalizada;
          }
        }
      }
      
      // 4. Verificar correspondência com display names
      if (companyConfig?.filialDisplayNames) {
        for (const [canonico, display] of Object.entries(companyConfig.filialDisplayNames)) {
          const canonicoNormalizado = normalizeFilial(canonico);
          const displayNormalizado = normalizeFilial(display);
          if (normalizado === displayNormalizado || normalizado === canonicoNormalizado) {
            return canonicoNormalizado; // Retornar nome canônico
          }
        }
      }
      
      // 5. Se não encontrou correspondência, retornar normalizado
      // (pode ser uma filial não mapeada, mas pelo menos está normalizada)
      return normalizado;
    };

    // Processar resultados
    const estoqueMap = new Map<string, Map<string, number>>();
    const vendasMap = new Map<string, Map<string, number>>();
    const vendasLast30DaysMap = new Map<string, Map<string, number>>();
    const ultimaEntradaMap = new Map<string, Map<string, Date | null>>(); // produto+cor -> filial -> data
    const produtoInfoMap = new Map<string, { descricao: string; cor: string; subgrupo?: string; grade?: string }>();
    const codigoBarraMap = new Map<string, string>();

    // Processar estoque (chave estável por produto+corProduto para evitar duplicatas)
    estoqueResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      
      if (!estoqueMap.has(chave)) {
        estoqueMap.set(chave, new Map());
      }
      
      const filialMap = estoqueMap.get(chave)!;
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const stock = positiveStock + negativeStock;
      
      // Usar nome canônico da filial para agrupar
      const filialCanonico = getFilialCanonico(row.filial);
      filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + stock);
    });

    // Processar vendas normais (chave estável)
    vendasResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      
      if (!vendasMap.has(chave)) {
        vendasMap.set(chave, new Map());
      }
      
      const filialMap = vendasMap.get(chave)!;
      const vendas = Number(row.vendas ?? 0);
      
      // Usar nome canônico da filial para agrupar
      const filialCanonico = getFilialCanonico(row.filial);
      filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + vendas);
    });

    // Processar vendas de e-commerce (agregar com vendas normais, chave estável)
    if (shouldIncludeEcommerce) {
      ecommerceVendasResult.recordset.forEach(row => {
        const produto = row.produto?.trim() || '';
        if (!produto) return; // Ignorar linhas vazias da query dummy
        
        const chave = getChaveStable(produto, row.corProduto);
        
        if (!vendasMap.has(chave)) {
          vendasMap.set(chave, new Map());
        }
        
        const filialMap = vendasMap.get(chave)!;
        const vendas = Number(row.vendas ?? 0);
        
        // Usar nome canônico da filial para agrupar
        const filialCanonico = getFilialCanonico(row.filial);
        filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + vendas);
      });
    }

    // Processar vendas últimos 30 dias (normais, chave estável)
    vendasLast30DaysResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      
      if (!vendasLast30DaysMap.has(chave)) {
        vendasLast30DaysMap.set(chave, new Map());
      }
      
      const filialMap = vendasLast30DaysMap.get(chave)!;
      const vendas = Number(row.vendas ?? 0);
      
      // Usar nome canônico da filial para agrupar
      const filialCanonico = getFilialCanonico(row.filial);
      filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + vendas);
    });

    // Processar vendas de e-commerce dos últimos 30 dias (chave estável)
    if (shouldIncludeEcommerce) {
      ecommerceVendasLast30DaysResult.recordset.forEach(row => {
        const produto = row.produto?.trim() || '';
        if (!produto) return; // Ignorar linhas vazias da query dummy
        
        const chave = getChaveStable(produto, row.corProduto);
        
        if (!vendasLast30DaysMap.has(chave)) {
          vendasLast30DaysMap.set(chave, new Map());
        }
        
        const filialMap = vendasLast30DaysMap.get(chave)!;
        const vendas = Number(row.vendas ?? 0);
        
        // Usar nome canônico da filial para agrupar
        const filialCanonico = getFilialCanonico(row.filial);
        filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + vendas);
      });
    }

    // Processar informações do produto (chave estável; preferir descrição/cor não vazias ao mesclar)
    produtoInfoResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      const descricao = row.descricao?.trim() || '';
      const corDisplay = getColorDescription(row.corProduto, row.corBanco);
      
      const existente = produtoInfoMap.get(chave);
      if (!existente) {
        produtoInfoMap.set(chave, {
          descricao,
          cor: corDisplay,
          subgrupo: isScarfme ? (row.subgrupo?.trim() || undefined) : undefined,
          grade: isScarfme ? (row.grade?.trim() || undefined) : undefined,
        });
      } else {
        // Mesclar: preferir descrição e cor não vazias
        if (descricao && !existente.descricao) existente.descricao = descricao;
        if (corDisplay && !existente.cor) existente.cor = corDisplay;
        if (isScarfme && row.subgrupo?.trim() && !existente.subgrupo) existente.subgrupo = row.subgrupo.trim();
        if (isScarfme && row.grade?.trim() && !existente.grade) existente.grade = row.grade.trim();
      }
    });

    // Processar códigos de barras (chave estável produto+corProduto)
    codigoBarraResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const codigoBarra = row.codigoBarra?.trim() || '';
      
      if (!codigoBarra) return;
      
      const chaveProdutoCor = getChaveStable(produto, row.corProduto);
      if (!codigoBarraMap.has(chaveProdutoCor)) {
        codigoBarraMap.set(chaveProdutoCor, codigoBarra);
      }
      
      if (!codigoBarraMap.has(produto)) {
        codigoBarraMap.set(produto, codigoBarra);
      }
    });

    // Processar última entrada por produto+cor+filial (chave estável)
    ultimaEntradaResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      const filialCanonico = getFilialCanonico(row.filial);
      const ultimaEntrada = row.ultimaEntrada ? new Date(row.ultimaEntrada) : null;
      
      if (!ultimaEntradaMap.has(chave)) {
        ultimaEntradaMap.set(chave, new Map());
      }
      
      const filialMap = ultimaEntradaMap.get(chave)!;
      const dataExistente = filialMap.get(filialCanonico);
      if (!dataExistente || (ultimaEntrada && (!dataExistente || ultimaEntrada > dataExistente))) {
        filialMap.set(filialCanonico, ultimaEntrada);
      }
    });

    // Combinar dados
    const produtosMap = new Map<string, ProdutoTransferencia>();
    const allChaves = new Set([
      ...estoqueMap.keys(),
      ...vendasMap.keys(),
      ...vendasLast30DaysMap.keys(),
    ]);

    allChaves.forEach(chave => {
      const [produto, corProduto] = chave.split('|');
      const produtoInfo = produtoInfoMap.get(chave) || {
        descricao: '',
        cor: getColorDescription(corProduto, ''),
      };
      
      const estoquePorFilial = estoqueMap.get(chave) || new Map();
      const vendasPorFilial = vendasMap.get(chave) || new Map();
      const vendasLast30DaysPorFilial = vendasLast30DaysMap.get(chave) || new Map();
      const ultimaEntradaPorFilial = ultimaEntradaMap.get(chave) || new Map();
      
      // Obter todas as filiais únicas
      const todasFiliais = new Set([
        ...estoquePorFilial.keys(),
        ...vendasPorFilial.keys(),
        ...vendasLast30DaysPorFilial.keys(),
        ...ultimaEntradaPorFilial.keys(),
      ]);

      // Reconhecimento de vendas sempre em últimos 30 dias (evita queda de transferências ao virar o mês)
      const filiais: FilialData[] = Array.from(todasFiliais).map(filial => ({
        filial,
        stock: estoquePorFilial.get(filial) || 0,
        sales: vendasLast30DaysPorFilial.get(filial) || 0,
        salesLast30Days: vendasLast30DaysPorFilial.get(filial) || 0,
        ultimaEntrada: ultimaEntradaPorFilial.get(filial) || null,
      }));

      const totalVendas = Array.from(vendasLast30DaysPorFilial.values()).reduce((sum, v) => sum + v, 0);
      const totalEstoque = Array.from(estoquePorFilial.values()).reduce((sum, v) => sum + v, 0);

      // Formatar descrição do produto
      let descricao = produtoInfo.descricao;
      let codigo = produto;
      
      if (descricao.includes(`(${produto})`)) {
        const parts = descricao.split(`(${produto})`);
        descricao = parts[0].trim();
        codigo = produto;
      }

      // Buscar código de barras (prioridade: produto+cor, depois apenas produto)
      const codigoBarra = codigoBarraMap.get(chave) || codigoBarraMap.get(produto) || undefined;

      produtosMap.set(chave, {
        produto,
        cor: produtoInfo.cor,
        codigoCor: corProduto || undefined,
        descricao: descricao || 'Sem descrição',
        codigo,
        codigoBarra,
        subgrupo: produtoInfo.subgrupo,
        grade: produtoInfo.grade,
        filiais,
        totalVendas,
        totalEstoque,
      });
    });

    // Mesclar entradas que representam o mesmo produto+cor de exibição (ex.: códigos 051545 e 051548 → AZUL).
    // Só mesclar quando a cor de exibição for não vazia; senão manter chave original (produto|corProduto)
    // para não agrupar cores diferentes que tenham descrição vazia.
    const mergedByDisplayCor = new Map<string, ProdutoTransferencia>();
    const chaveDisplay = (p: ProdutoTransferencia) =>
      `${(p.produto || '').trim()}|${(p.cor || '').trim().toUpperCase()}`;

    produtosMap.forEach((item, chaveOriginal) => {
      const corPreenchida = (item.cor || '').trim().length > 0;
      const key = corPreenchida ? chaveDisplay(item) : chaveOriginal;
      const existente = mergedByDisplayCor.get(key);
      if (!existente) {
        mergedByDisplayCor.set(key, { ...item });
        return;
      }
      // Mesclar: somar estoque/vendas por filial, manter descrição/código de barras não vazios
      const filiaisMap = new Map<string, FilialData>();
      [...existente.filiais, ...item.filiais].forEach((f) => {
        const filial = f.filial;
        if (!filiaisMap.has(filial)) {
          filiaisMap.set(filial, {
            filial,
            stock: 0,
            sales: 0,
            salesLast30Days: 0,
            ultimaEntrada: null,
          });
        }
        const acc = filiaisMap.get(filial)!;
        acc.stock += f.stock;
        acc.sales += f.sales;
        acc.salesLast30Days += f.salesLast30Days;
        acc.ultimaEntrada =
          !acc.ultimaEntrada && f.ultimaEntrada
            ? f.ultimaEntrada
            : acc.ultimaEntrada && f.ultimaEntrada
              ? (acc.ultimaEntrada > f.ultimaEntrada ? acc.ultimaEntrada : f.ultimaEntrada)
              : acc.ultimaEntrada ?? f.ultimaEntrada ?? null;
      });
      mergedByDisplayCor.set(key, {
        ...existente,
        codigoCor: existente.codigoCor || item.codigoCor,
        descricao: existente.descricao || item.descricao,
        codigoBarra: existente.codigoBarra || item.codigoBarra,
        subgrupo: existente.subgrupo || item.subgrupo,
        grade: existente.grade || item.grade,
        filiais: Array.from(filiaisMap.values()),
        totalVendas: existente.totalVendas + item.totalVendas,
        totalEstoque: existente.totalEstoque + item.totalEstoque,
      });
    });

    return Array.from(mergedByDisplayCor.values());
  });
}

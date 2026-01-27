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
}

export interface ProdutoTransferencia {
  produto: string;
  cor: string;
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

    // Query para informações do produto (descrição e código)
    // Para scarfme, também buscar subgrupo e grade
    const isScarfme = company === 'scarfme';
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
      WHERE vp.DATA_VENDA >= @startDate
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
    const [estoqueResult, vendasResult, vendasLast30DaysResult, produtoInfoResult, codigoBarraResult] = await Promise.all([
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
    ]);

    // Função auxiliar para normalizar filial (usar em todos os lugares)
    const normalizeFilial = (filial: string | null | undefined): string => {
      return (filial || '').trim().toUpperCase();
    };

    // Criar mapeamento reverso de filialDisplayNames para encontrar nome canônico
    // Se "LEBLON" está mapeado para "NERD LEBLON", precisamos encontrar "NERD LEBLON" quando vier "LEBLON"
    const companyConfig = resolveCompany(company);
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
    const produtoInfoMap = new Map<string, { descricao: string; cor: string; subgrupo?: string; grade?: string }>();
    const codigoBarraMap = new Map<string, string>();

    // Processar estoque
    estoqueResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const corNormalizada = getColorDescription(row.corProduto, row.corBanco);
      const chave = `${produto}|${corNormalizada}`;
      
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

    // Processar vendas
    vendasResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const corNormalizada = getColorDescription(row.corProduto, row.corBanco);
      const chave = `${produto}|${corNormalizada}`;
      
      if (!vendasMap.has(chave)) {
        vendasMap.set(chave, new Map());
      }
      
      const filialMap = vendasMap.get(chave)!;
      const vendas = Number(row.vendas ?? 0);
      
      // Usar nome canônico da filial para agrupar
      const filialCanonico = getFilialCanonico(row.filial);
      filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + vendas);
    });

    // Processar vendas últimos 30 dias
    vendasLast30DaysResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const corNormalizada = getColorDescription(row.corProduto, row.corBanco);
      const chave = `${produto}|${corNormalizada}`;
      
      if (!vendasLast30DaysMap.has(chave)) {
        vendasLast30DaysMap.set(chave, new Map());
      }
      
      const filialMap = vendasLast30DaysMap.get(chave)!;
      const vendas = Number(row.vendas ?? 0);
      
      // Usar nome canônico da filial para agrupar
      const filialCanonico = getFilialCanonico(row.filial);
      filialMap.set(filialCanonico, (filialMap.get(filialCanonico) || 0) + vendas);
    });

    // Processar informações do produto
    produtoInfoResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const corNormalizada = getColorDescription(row.corProduto, row.corBanco);
      const chave = `${produto}|${corNormalizada}`;
      
      if (!produtoInfoMap.has(chave)) {
        produtoInfoMap.set(chave, {
          descricao: row.descricao?.trim() || '',
          cor: corNormalizada,
          subgrupo: isScarfme ? (row.subgrupo?.trim() || undefined) : undefined,
          grade: isScarfme ? (row.grade?.trim() || undefined) : undefined,
        });
      }
    });

    // Processar códigos de barras
    // Prioridade: PRODUTO+COR+TAMANHO > PRODUTO+COR > PRODUTO
    codigoBarraResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const corNormalizada = getColorDescription(row.corProduto, row.corBanco);
      const codigoBarra = row.codigoBarra?.trim() || '';
      
      if (!codigoBarra) return;
      
      // Tentar chave mais específica primeiro (produto+cor)
      const chaveProdutoCor = `${produto}|${corNormalizada}`;
      if (!codigoBarraMap.has(chaveProdutoCor)) {
        codigoBarraMap.set(chaveProdutoCor, codigoBarra);
      }
      
      // Também mapear apenas por produto (fallback)
      if (!codigoBarraMap.has(produto)) {
        codigoBarraMap.set(produto, codigoBarra);
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
      const [produto, cor] = chave.split('|');
      const produtoInfo = produtoInfoMap.get(chave) || { descricao: '', cor };
      
      const estoquePorFilial = estoqueMap.get(chave) || new Map();
      const vendasPorFilial = vendasMap.get(chave) || new Map();
      const vendasLast30DaysPorFilial = vendasLast30DaysMap.get(chave) || new Map();
      
      // Obter todas as filiais únicas
      const todasFiliais = new Set([
        ...estoquePorFilial.keys(),
        ...vendasPorFilial.keys(),
        ...vendasLast30DaysPorFilial.keys(),
      ]);

      const filiais: FilialData[] = Array.from(todasFiliais).map(filial => ({
        filial,
        stock: estoquePorFilial.get(filial) || 0,
        sales: vendasPorFilial.get(filial) || 0,
        salesLast30Days: vendasLast30DaysPorFilial.get(filial) || 0,
      }));

      const totalVendas = Array.from(vendasPorFilial.values()).reduce((sum, v) => sum + v, 0);
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

    return Array.from(produtosMap.values());
  });
}

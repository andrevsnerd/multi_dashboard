import sql from 'mssql';

import { getActiveFilial, getFilialGroupMembers, resolveCompany, VAREJO_VALUE } from '@/lib/config/company';
import { resolveCompanyLive, liveNameForIncoming } from '@/lib/server/company-live';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { withRequest } from '@/lib/db/connection';
import { syncProdutoNovoLabels } from '@/lib/repositories/produtosNovos';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import { getColorDescription } from '@/lib/utils/colorMapping';
import { buildProdutoLabelLookupKey } from '@/lib/utils/produto-labels-store';

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
  /** Vendas dos últimos 60 dias — usado na demanda ponderada */
  vendas60d: number;
  /** Vendas dos últimos 12 meses — base da demanda histórica ponderada */
  vendas12m: number;
  ultimaEntrada?: Date | null;
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

async function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  specificFilial?: string | null,
  prefix: string = 'e'
): Promise<string> {
  if (!companySlug) {
    return '';
  }

  const company = await resolveCompanyLive(companySlug);

  if (!company) {
    return '';
  }

  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  specificFilial = await liveNameForIncoming(specificFilial);

  const filiais = company.filialFilters['inventory'] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar ela ou o grupo que ela representa
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    const members = getFilialGroupMembers(company, specificFilial);
    if (members.length > 1) {
      members.forEach((f, index) => {
        request.input(`filial${prefix}Group${index}`, sql.VarChar, f);
      });
      const placeholders = members
        .map((_, index) => `@filial${prefix}Group${index}`)
        .join(', ');
      return `AND ${prefix}.FILIAL IN (${placeholders})`;
    }

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
  const resolvedCompany = resolveCompany(company);
  const blockedLabelKeys = resolvedCompany
    ? new Set(
        (await syncProdutoNovoLabels(resolvedCompany.key)).produtos.map((item) =>
          buildProdutoLabelLookupKey(item.produto, item.corCodigo)
        )
      )
    : null;

  return withRequest(async (request) => {
    const { start, end } = normalizeRangeForQuery({
      start: range?.start,
      end: range?.end,
    });

    // Calcular janelas temporais para demanda ponderada
    const thirtyDaysAgo = new Date(end);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const sixtyDaysAgo = new Date(end);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

    const twelveMonthsAgo = new Date(end);
    twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);

    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('thirtyDaysAgo', sql.DateTime, thirtyDaysAgo);
    request.input('sixtyDaysAgo', sql.DateTime, sixtyDaysAgo);
    request.input('twelveMonthsAgo', sql.DateTime, twelveMonthsAgo);

    // minStartDate = mais antiga entre startDate, 30d, 60d e 12m
    // twelveMonthsAgo é sempre a mais antiga — usada como piso único da query combinada
    const minStartDate = twelveMonthsAgo;
    request.input('minStartDate', sql.DateTime, minStartDate);

    const estoqueFilialFilter = await buildFilialFilter(request, company, filial, 'e');
    const vendasFilialFilter = await buildFilialFilter(request, company, filial, 'vp');

    // Verificar se precisa buscar vendas de e-commerce (ScarfMe e filial null)
    // Usa resolveCompanyDynamic (grupos do admin + filial ativa) — a MESMA régua
    // usada na execução da saída e na gravação da transferência, para que tela,
    // cooldown, contadores e "Realizadas" usem todos a filial ATIVA como chave.
    const companyConfig = await resolveCompanyDynamic(company);
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
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(e.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, e.COR_PRODUTO))
      WHERE 1=1
        ${estoqueFilialFilter}
      GROUP BY e.PRODUTO, e.COR_PRODUTO, c.DESC_COR, e.FILIAL
    `;

    // Query combinada: período, 30d, 60d e 12m em um único scan da tabela de vendas.
    // @minStartDate = twelveMonthsAgo — cobre todos os horizontes temporais de uma vez.
    const vendasCombinedQuery = `
      SELECT
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        vp.FILIAL AS filial,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
                 WHEN vp.DATA_VENDA >= @startDate THEN vp.QTDE
                 ELSE 0 END) AS vendasPeriodo,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
                 WHEN vp.DATA_VENDA >= @thirtyDaysAgo THEN vp.QTDE
                 ELSE 0 END) AS vendasLast30Days,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
                 WHEN vp.DATA_VENDA >= @sixtyDaysAgo THEN vp.QTDE
                 ELSE 0 END) AS vendas60d,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0
                 WHEN vp.DATA_VENDA >= @twelveMonthsAgo THEN vp.QTDE
                 ELSE 0 END) AS vendas12m
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(vp.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(vp.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, vp.COR_PRODUTO))
      WHERE vp.DATA_VENDA >= @minStartDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
      GROUP BY vp.PRODUTO, vp.COR_PRODUTO, COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), vp.FILIAL
    `;

    // Query combinada de e-commerce: período, 30d, 60d e 12m em um único scan
    // Sem CAST na coluna f.EMISSAO para habilitar uso de índice (GN-5)
    const ecommerceCombinedQuery = shouldIncludeEcommerce ? `
      SELECT
        fp.PRODUTO AS produto,
        fp.COR_PRODUTO AS corProduto,
        ISNULL(c.DESC_COR, '') AS corBanco,
        f.FILIAL AS filial,
        SUM(CASE WHEN f.EMISSAO >= CAST(@startDate AS DATE) THEN CAST(fp.QTDE AS FLOAT) ELSE 0 END) AS vendasPeriodo,
        SUM(CASE WHEN f.EMISSAO >= CAST(@thirtyDaysAgo AS DATE) THEN CAST(fp.QTDE AS FLOAT) ELSE 0 END) AS vendasLast30Days,
        SUM(CASE WHEN f.EMISSAO >= CAST(@sixtyDaysAgo AS DATE) THEN CAST(fp.QTDE AS FLOAT) ELSE 0 END) AS vendas60d,
        SUM(CASE WHEN f.EMISSAO >= CAST(@twelveMonthsAgo AS DATE) THEN CAST(fp.QTDE AS FLOAT) ELSE 0 END) AS vendas12m
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(fp.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(fp.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, fp.COR_PRODUTO))
      WHERE f.EMISSAO >= CAST(@minStartDate AS DATE)
        AND f.EMISSAO < DATEADD(day, 1, CAST(@endDate AS DATE))
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND CAST(fp.QTDE AS FLOAT) > 0
        ${ecommerceFilialFilter}
      GROUP BY fp.PRODUTO, fp.COR_PRODUTO, c.DESC_COR, f.FILIAL
    ` : 'SELECT NULL AS produto, NULL AS corProduto, NULL AS corBanco, NULL AS filial, 0 AS vendasPeriodo, 0 AS vendasLast30Days, 0 AS vendas60d, 0 AS vendas12m WHERE 1=0';

    // Query para buscar última data de entrada por produto+cor+filial
    // Busca em ESTOQUE_PROD_ENT e também em LOJA_ENTRADAS_PRODUTO (priorizando a mais recente)
    // Criar filtro de filial para a query de entrada (usando alias E, mas com prefixo diferente para evitar conflito de variáveis)
    const ultimaEntradaFilialFilter = await buildFilialFilter(request, company, filial, 'ent');
    // Ajustar o filtro para usar o alias E na query (substituir 'ent.' por 'E.')
    const ultimaEntradaFilialFilterAjustado = ultimaEntradaFilialFilter.replace(/ent\./g, 'E.');
    // Criar filtro para LOJA_ENTRADAS (usando prefixo 'le' para evitar conflito)
    const lojaEntradasFilialFilter = await buildFilialFilter(request, company, filial, 'le');
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
        LEFT JOIN (
          SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
          FROM PRODUTO_CORES WITH (NOLOCK)
          GROUP BY PRODUTO, COR_PRODUTO
        ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(P.PRODUTO))
           AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(P.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, P.COR_PRODUTO))
        WHERE P.PRODUTO IS NOT NULL
          AND E.EMISSAO >= DATEADD(day, -180, @endDate)
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
        LEFT JOIN (
          SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
          FROM PRODUTO_CORES WITH (NOLOCK)
          GROUP BY PRODUTO, COR_PRODUTO
        ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(LEP.PRODUTO))
           AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(LEP.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, LEP.COR_PRODUTO))
        WHERE LEP.PRODUTO IS NOT NULL
          AND LE.EMISSAO >= DATEADD(day, -180, @endDate)
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
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(e.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(e.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, e.COR_PRODUTO))
      WHERE 1=1
        ${estoqueFilialFilter}

      UNION ALL

      SELECT DISTINCT
        vp.PRODUTO AS produto,
        vp.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, vp.DESC_COR_PRODUTO), '') AS corBanco,
        ISNULL(vp.DESC_PRODUTO, '') AS descricao
        ${subgrupoFieldVendas}
        ${gradeFieldVendas}
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(vp.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(vp.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, vp.COR_PRODUTO))
      WHERE vp.DATA_VENDA >= @thirtyDaysAgo
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        ${vendasFilialFilter}
    `;

    // Query para buscar códigos de barras — limitada aos produtos desta empresa/filial
    // para evitar scan total de PRODUTOS_BARRA
    const codigoBarraQuery = `
      SELECT DISTINCT
        pb.PRODUTO AS produto,
        pb.COR_PRODUTO AS corProduto,
        ISNULL(COALESCE(c.DESC_COR, ''), '') AS corBanco,
        pb.CODIGO_BARRA AS codigoBarra
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(pb.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, pb.COR_PRODUTO))
      WHERE pb.CODIGO_BARRA IS NOT NULL
        AND pb.CODIGO_BARRA <> ''
        AND pb.PRODUTO IN (
          SELECT DISTINCT e.PRODUTO
          FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
          WHERE 1=1
          ${estoqueFilialFilter}
        )
    `;

    // Executar todas as queries em paralelo (reduzido de 8 para 6 queries)
    const [estoqueResult, vendasCombinedResult, ecommerceCombinedResult, produtoInfoResult, codigoBarraResult, ultimaEntradaResult] = await Promise.all([
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(estoqueQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendasPeriodo: number | null;
        vendasLast30Days: number | null;
        vendas60d: number | null;
        vendas12m: number | null;
      }>(vendasCombinedQuery),
      request.query<{
        produto: string;
        corProduto: string | null;
        corBanco: string;
        filial: string;
        vendasPeriodo: number | null;
        vendasLast30Days: number | null;
        vendas60d: number | null;
        vendas12m: number | null;
      }>(ecommerceCombinedQuery),
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

    // Pré-construir mapa de lookup de filiais (O(1) por chamada em vez de 4 varreduras lineares)
    // Os resultsets do SQL já vêm filtrados pelo IN clause, então o mapa cobre todos os casos reais.
    const filialLookupMap = new Map<string, string>();
    const filialFiltersInventory = companyConfig?.filialFilters?.inventory ?? [];
    const filialGroupCanonicalMap = new Map<string, string>();

    for (const [canonical, members] of Object.entries(companyConfig?.filialGroups ?? {})) {
      const normalizedCanonical = normalizeFilial(canonical);
      filialGroupCanonicalMap.set(normalizedCanonical, normalizedCanonical);

      members.forEach((member) => {
        filialGroupCanonicalMap.set(normalizeFilial(member), normalizedCanonical);
      });
    }

    // E-commerce também é uma filial lógica única na dashboard, mesmo quando
    // o ERP expõe múltiplas entidades/códigos para esse mesmo estoque.
    const ecommerceCanonical = normalizeFilial(companyConfig?.ecommerceFilials?.[0]);
    if (ecommerceCanonical) {
      filialGroupCanonicalMap.set(ecommerceCanonical, ecommerceCanonical);

      (companyConfig?.ecommerceFilials ?? []).forEach((member) => {
        filialGroupCanonicalMap.set(normalizeFilial(member), ecommerceCanonical);
      });
    }

    // Passo 1: correspondências exatas com filiais configuradas (maior prioridade)
    for (const filialFiltro of filialFiltersInventory) {
      const norm = normalizeFilial(filialFiltro);
      filialLookupMap.set(norm, norm);
    }

    // Passo 2: display names → canônico
    if (companyConfig?.filialDisplayNames) {
      for (const [canonico, display] of Object.entries(companyConfig.filialDisplayNames)) {
        const normCanonico = normalizeFilial(canonico);
        const normDisplay = normalizeFilial(display);
        if (!filialLookupMap.has(normDisplay)) filialLookupMap.set(normDisplay, normCanonico);
        if (!filialLookupMap.has(normCanonico)) filialLookupMap.set(normCanonico, normCanonico);
      }
    }

    // Passo 3: correspondência parcial — palavras do nome configurado (ex: "LEBLON" → "NERD LEBLON")
    for (const filialFiltro of filialFiltersInventory) {
      const normFiltro = normalizeFilial(filialFiltro);
      for (const parte of normFiltro.split(/\s+/).filter(p => p.length > 3)) {
        if (!filialLookupMap.has(parte)) filialLookupMap.set(parte, normFiltro);
      }
    }

    // Lookup O(1): todos os casos reais estão pré-indexados acima
    const getFilialCanonico = (filial: string): string => {
      const normalizado = normalizeFilial(filial);
      const mapped = filialLookupMap.get(normalizado) ?? normalizado;
      const groupCanonical = filialGroupCanonicalMap.get(mapped)
        ?? filialGroupCanonicalMap.get(normalizado)
        ?? mapped;
      // Colapsa para o MEMBRO ATIVO do grupo via getActiveFilial — exatamente a
      // mesma função/config que a saída usa. Idempotente: getActiveFilial(ativa) =
      // ativa, então o canônico da tela == o nome gravado em transferencia_pendente
      // (origem/destino), fazendo cooldown, contadores e "Realizadas" casarem.
      // Para filiais sem grupo, getActiveFilial é identidade (mantém o nome).
      return getActiveFilial(companyConfig, groupCanonical);
    };

    // Processar resultados
    const estoqueComponentMap   = new Map<string, Map<string, { positiveStock: number; negativeStock: number; positiveCount: number }>>();
    const estoqueMap            = new Map<string, Map<string, number>>();
    const vendasMap             = new Map<string, Map<string, number>>();
    const vendasLast30DaysMap   = new Map<string, Map<string, number>>();
    const vendas60dMap          = new Map<string, Map<string, number>>();
    const vendas12mMap          = new Map<string, Map<string, number>>();
    const ultimaEntradaMap      = new Map<string, Map<string, Date | null>>();
    const produtoInfoMap        = new Map<string, { descricao: string; cor: string; subgrupo?: string; grade?: string }>();
    const codigoBarraMap        = new Map<string, string>();

    // Processar estoque por componentes para aplicar a regra correta também
    // na agregação de filiais lógicas (ex.: E-COMMERCE, PAULISTA).
    estoqueResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      
      if (!estoqueComponentMap.has(chave)) {
        estoqueComponentMap.set(chave, new Map());
      }
      
      const filialMap = estoqueComponentMap.get(chave)!;
      const positiveStock = Number(row.positiveStock ?? 0);
      const negativeStock = Number(row.negativeStock ?? 0);
      const positiveCount = Number(row.positiveCount ?? 0);
      
      // Usar nome canônico da filial para agrupar
      const filialCanonico = getFilialCanonico(row.filial);
      const existente = filialMap.get(filialCanonico) ?? {
        positiveStock: 0,
        negativeStock: 0,
        positiveCount: 0,
      };

      filialMap.set(filialCanonico, {
        positiveStock: existente.positiveStock + positiveStock,
        negativeStock: existente.negativeStock + negativeStock,
        positiveCount: existente.positiveCount + positiveCount,
      });
    });

    estoqueComponentMap.forEach((filialMap, chave) => {
      const finalMap = new Map<string, number>();

      filialMap.forEach((components, filial) => {
        // Negativos NUNCA são contabilizados: soma só os saldos positivos.
        const stock = Math.max(0, components.positiveStock);
        finalMap.set(filial, stock);
      });

      estoqueMap.set(chave, finalMap);
    });

    // Helper: acumula um valor num Map<chave, Map<filial, number>>
    const acumular = (
      mapa: Map<string, Map<string, number>>,
      chave: string,
      filial: string,
      qtd: number
    ) => {
      if (!mapa.has(chave)) mapa.set(chave, new Map());
      const fm = mapa.get(chave)!;
      fm.set(filial, (fm.get(filial) || 0) + qtd);
    };

    // Processar vendas normais combinadas (período, 30d, 60d e 12m em uma única passagem)
    vendasCombinedResult.recordset.forEach(row => {
      const produto = row.produto?.trim() || '';
      const chave = getChaveStable(produto, row.corProduto);
      const filial = getFilialCanonico(row.filial);

      acumular(vendasMap,           chave, filial, Number(row.vendasPeriodo   ?? 0));
      acumular(vendasLast30DaysMap, chave, filial, Number(row.vendasLast30Days ?? 0));
      acumular(vendas60dMap,        chave, filial, Number(row.vendas60d        ?? 0));
      acumular(vendas12mMap,        chave, filial, Number(row.vendas12m        ?? 0));
    });

    // Processar vendas de e-commerce combinadas (período, 30d, 60d e 12m)
    if (shouldIncludeEcommerce) {
      ecommerceCombinedResult.recordset.forEach(row => {
        const produto = row.produto?.trim() || '';
        if (!produto) return;

        const chave = getChaveStable(produto, row.corProduto);
        const filial = getFilialCanonico(row.filial);

        acumular(vendasMap,           chave, filial, Number(row.vendasPeriodo   ?? 0));
        acumular(vendasLast30DaysMap, chave, filial, Number(row.vendasLast30Days ?? 0));
        acumular(vendas60dMap,        chave, filial, Number(row.vendas60d        ?? 0));
        acumular(vendas12mMap,        chave, filial, Number(row.vendas12m        ?? 0));
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
      if (blockedLabelKeys?.has(buildProdutoLabelLookupKey(produto, corProduto))) {
        return;
      }
      const produtoInfo = produtoInfoMap.get(chave) || {
        descricao: '',
        cor: getColorDescription(corProduto, ''),
      };

      const estoquePorFilial         = estoqueMap.get(chave)          || new Map();
      const vendasPorFilial          = vendasMap.get(chave)            || new Map();
      const vendasLast30DaysPorFilial = vendasLast30DaysMap.get(chave) || new Map();
      const vendas60dPorFilial       = vendas60dMap.get(chave)         || new Map();
      const vendas12mPorFilial       = vendas12mMap.get(chave)         || new Map();
      const ultimaEntradaPorFilial   = ultimaEntradaMap.get(chave)     || new Map();

      // Obter todas as filiais únicas
      const todasFiliais = new Set([
        ...estoquePorFilial.keys(),
        ...vendasPorFilial.keys(),
        ...vendasLast30DaysPorFilial.keys(),
        ...ultimaEntradaPorFilial.keys(),
      ]);

      const filiais: FilialData[] = Array.from(todasFiliais).map(filial => ({
        filial,
        stock:           estoquePorFilial.get(filial)          || 0,
        sales:           vendasLast30DaysPorFilial.get(filial) || 0,
        salesLast30Days: vendasLast30DaysPorFilial.get(filial) || 0,
        vendas60d:       vendas60dPorFilial.get(filial)        || 0,
        vendas12m:       vendas12mPorFilial.get(filial)        || 0,
        ultimaEntrada:   ultimaEntradaPorFilial.get(filial)    || null,
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
            vendas60d: 0,
            vendas12m: 0,
            ultimaEntrada: null,
          });
        }
        const acc = filiaisMap.get(filial)!;
        acc.stock           += f.stock;
        acc.sales           += f.sales;
        acc.salesLast30Days += f.salesLast30Days;
        acc.vendas60d       += f.vendas60d;
        acc.vendas12m       += f.vendas12m;
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

import sql from 'mssql';

import { isEcommerceFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { resolveCompanyLive, liveNameForIncoming } from '@/lib/server/company-live';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import { fetchMultipleProductsStock, fetchMultipleProductsStockByColor } from '@/lib/repositories/inventory';
import {
  fetchTopProductsEcommerce,
} from '@/lib/repositories/ecommerce';
import { getColecaoDescMap } from '@/lib/repositories/colecao';
import { getColorDescription } from '@/lib/utils/colorMapping';
import type { ProdutoAgrupadoMember } from '@/lib/utils/produtos-agrupados';

export interface ProductDetail {
  productId: string;
  productName: string;
  totalRevenue: number;
  totalQuantity: number;
  averagePrice: number;
  cost: number;
  markup: number;
  stock: number;
  revenueVariance: number | null; // null se for novo produto
  quantityVariance: number | null; // null se for novo produto
  isNew: boolean; // true se não teve vendas no período anterior
  corProduto?: string | null; // Código da cor do produto
  descCorProduto?: string | null; // Descrição da cor do produto
  grupo?: string | null; // GRUPO_PRODUTO (parte descritiva)
  subgrupo?: string | null; // SUBGRUPO_PRODUTO (parte descritiva)
  linha?: string | null; // LINHA (parte descritiva)
  tipo?: string | null; // TIPO_PRODUTO (parte descritiva)
  grade?: string | null; // Grade do produto (apenas para scarfme)
  estoqueRede?: number; // Estoque total em todas as filiais (apenas para scarfme)
  suggestedPrice?: number | null; // Preço sugerido (REVENDA da tabela PRODUTOS)
  registrationDate?: string | null; // Data de cadastramento do produto (DATA_CADASTRAMENTO)
  isGroupedProduct?: boolean;
  groupId?: string | null;
  groupedMembers?: ProdutoAgrupadoMember[];
  descontinuado?: boolean; // true se o produto está marcado como descontinuado
}

export interface ProductsQueryParams {
  company?: string;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
  filial?: string | null;
  grupo?: string | null;
  grupos?: string[] | null;
  linha?: string | null;
  linhas?: string[] | null;
  colecao?: string | null;
  colecoes?: string[] | null;
  subgrupo?: string | null;
  subgrupos?: string[] | null;
  grade?: string | null;
  grades?: string[] | null;
  groupByColor?: boolean; // Se true, agrupa produtos por cor
  produtoId?: string;
  /**
   * Restringe a consulta a uma LISTA de códigos de produto (scoping da mesma query
   * validada, não lógica nova). É ADITIVO: combina com `produtoId`/`produtoSearchTerm`
   * e com os filtros de categoria. Usado pela análise "Projeção de vendas" do Gerador,
   * que mede a série mensal de uma seleção de itens (24 consultas, uma por mês) e
   * precisa que cada uma seja leve.
   */
  produtoIds?: string[] | null;
  produtoSearchTerm?: string;
  acimaDoTicket?: boolean; // Se true, filtra apenas vendas acima do preço sugerido
  filterByRegistrationDate?: boolean; // Se true, filtra produtos pela data de cadastramento ao invés da data de venda
}

export interface SelectOption {
  value: string;
  label: string;
}

function resolveRange(range?: { start?: string | Date; end?: string | Date }) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

function normalizeUniqueUpper(values: string[] | null | undefined): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => value.trim().toUpperCase())
        .filter(Boolean)
    )
  );
}

/**
 * Normaliza o código de cor para uso como CHAVE de agregação, tolerando os dois
 * formatos que chegam das fontes (varejo manda '06', e-commerce manda '6'/' 06').
 * Espelha o TRY_CONVERT(INT) do SQL: se for numérico, remove zeros à esquerda;
 * senão, só faz trim/upper. Sem isso, a mesma cor vira duas linhas no merge
 * varejo+ecommerce. Ver memória [[cor-produto-formato-duas-fontes]].
 */
function normalizeCorKey(cor: string | null | undefined): string {
  const trimmed = String(cor ?? '').trim();
  if (trimmed === '') return '';
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  return trimmed.toUpperCase();
}

/**
 * Registra a lista de códigos de produto UMA vez e devolve só os placeholders
 * ("@p0, @p1, …") — quem chama monta o `IN` com o alias de coluna que precisa
 * (vp.PRODUTO, fp.PRODUTO, p.PRODUTO), reusando os mesmos @params em cada variante
 * da query. Devolve '' quando não há lista (nenhum filtro aplicado).
 */
function buildProdutoIdsPlaceholders(
  request: sql.Request | RequestLike,
  produtoIds: string[] | null | undefined,
  paramBase: string
): string {
  const list = Array.from(
    new Set((produtoIds ?? []).map((p) => String(p ?? '').trim()).filter(Boolean))
  );
  if (list.length === 0) return '';
  list.forEach((value, index) => request.input(`${paramBase}${index}`, sql.VarChar, value));
  return list.map((_, index) => `@${paramBase}${index}`).join(', ');
}

function buildInFilter(
  request: sql.Request | RequestLike,
  values: string[] | null | undefined,
  paramBase: string,
  sqlExpression: string
): string {
  const normalizedValues = normalizeUniqueUpper(values);
  if (normalizedValues.length === 0) {
    return '';
  }

  if (normalizedValues.length === 1) {
    request.input(paramBase, sql.VarChar, normalizedValues[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(${sqlExpression}, '')))) = @${paramBase}`;
  }

  normalizedValues.forEach((value, index) => {
    request.input(`${paramBase}${index}`, sql.VarChar, value);
  });

  const placeholders = normalizedValues
    .map((_, index) => `@${paramBase}${index}`)
    .join(', ');

  return `AND UPPER(LTRIM(RTRIM(ISNULL(${sqlExpression}, '')))) IN (${placeholders})`;
}

async function buildScarfmeEcommerceFilialFilterForProducts(
  request: sql.Request | RequestLike,
  filial: string | null | undefined,
  tableAlias: string = 'f',
  paramBase: string = 'ecomFilial'
): Promise<string> {
  const company = await resolveCompanyLive('scarfme');
  if (!company) {
    return '';
  }

  // Normaliza o nome vindo do front para o nome vivo do banco (match por COD_FILIAL).
  filial = await liveNameForIncoming(filial);

  const ecommerceFilials = company.ecommerceFilials ?? [];

  if (filial && filial !== VAREJO_VALUE) {
    if (!ecommerceFilials.includes(filial)) {
      return 'AND 1=0';
    }
  } else if (filial === VAREJO_VALUE) {
    return 'AND 1=0';
  }

  if (ecommerceFilials.length === 0) {
    return '';
  }

  ecommerceFilials.forEach((filialNome, index) => {
    request.input(`${paramBase}${index}`, sql.VarChar, filialNome);
  });

  const placeholders = ecommerceFilials
    .map((_, index) => `@${paramBase}${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

async function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp',
  paramBase: string = 'filial'
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

  const isScarfme = companySlug === 'scarfme';
  const filiais = company.filialFilters[module] ?? [];
  const ecommerceFilials = company.ecommerceFilials ?? [];

  // Se uma filial específica foi selecionada, usar apenas ela
  if (specificFilial && specificFilial !== VAREJO_VALUE) {
    request.input(paramBase, sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @${paramBase}`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`${paramBase}${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@${paramBase}${index}`)
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
      request.input(`${paramBase}${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@${paramBase}${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`${paramBase}${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
    .map((_, index) => `@${paramBase}${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

/**
 * Cria filtro de grupo para NERD e ScarfMe (suporta múltiplos valores)
 */
function buildGrupoFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  grupo: string | null | undefined,
  grupos: string[] | null | undefined
): string {
  if (companySlug !== 'nerd' && companySlug !== 'scarfme') {
    return '';
  }
  
  // Usar array se fornecido, senão usar valor único (compatibilidade)
  const gruposList = grupos && grupos.length > 0 
    ? grupos 
    : grupo 
      ? [grupo] 
      : [];
  
  if (gruposList.length === 0) {
    return '';
  }
  
  // Normalizar grupos
  const gruposNormalizados = gruposList.map(g => g.trim().toUpperCase());
  
  if (gruposNormalizados.length === 1) {
    request.input('grupo', sql.VarChar, gruposNormalizados[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) = @grupo
      OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupo
    )`;
  }
  
  // Múltiplos grupos - usar IN
  gruposNormalizados.forEach((g, index) => {
    request.input(`grupo${index}`, sql.VarChar, g);
  });
  
  const placeholders = gruposNormalizados
    .map((_, index) => `@grupo${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.GRUPO_PRODUTO, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de linha para ScarfMe e NERD (ex.: Eletrônicos) — suporta múltiplos valores
 */
function buildLinhaFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  linha: string | null | undefined,
  linhas: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme' && companySlug !== 'nerd') {
    return '';
  }
  
  const linhasList = linhas && linhas.length > 0 
    ? linhas 
    : linha 
      ? [linha] 
      : [];
  
  if (linhasList.length === 0) {
    return '';
  }
  
  const linhasNormalizadas = linhasList.map(l => l.trim().toUpperCase());
  
  if (linhasNormalizadas.length === 1) {
    request.input('linha', sql.VarChar, linhasNormalizadas[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) = @linha
      OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linha
    )`;
  }
  
  linhasNormalizadas.forEach((l, index) => {
    request.input(`linha${index}`, sql.VarChar, l);
  });
  
  const placeholders = linhasNormalizadas
    .map((_, index) => `@linha${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de coleção para ScarfMe (suporta múltiplos valores)
 */
function buildColecaoFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  colecao: string | null | undefined,
  colecoes: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const colecoesList = colecoes && colecoes.length > 0 
    ? colecoes 
    : colecao 
      ? [colecao] 
      : [];
  
  if (colecoesList.length === 0) {
    return '';
  }
  
  const colecoesNormalizadas = colecoesList.map(c => c.trim().toUpperCase());
  
  if (colecoesNormalizadas.length === 1) {
    request.input('colecao', sql.VarChar, colecoesNormalizadas[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) = @colecao
      OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecao
    )`;
  }
  
  colecoesNormalizadas.forEach((c, index) => {
    request.input(`colecao${index}`, sql.VarChar, c);
  });
  
  const placeholders = colecoesNormalizadas
    .map((_, index) => `@colecao${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.COLECAO, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de subgrupo para ScarfMe (suporta múltiplos valores)
 */
function buildSubgrupoFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  subgrupo: string | null | undefined,
  subgrupos: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const subgruposList = subgrupos && subgrupos.length > 0 
    ? subgrupos 
    : subgrupo 
      ? [subgrupo] 
      : [];
  
  if (subgruposList.length === 0) {
    return '';
  }
  
  const subgruposNormalizados = subgruposList.map(s => s.trim().toUpperCase());
  
  if (subgruposNormalizados.length === 1) {
    request.input('subgrupo', sql.VarChar, subgruposNormalizados[0]);
    return `AND (
      UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) = @subgrupo
      OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupo
    )`;
  }
  
  subgruposNormalizados.forEach((s, index) => {
    request.input(`subgrupo${index}`, sql.VarChar, s);
  });
  
  const placeholders = subgruposNormalizados
    .map((_, index) => `@subgrupo${index}`)
    .join(', ');
  
  return `AND (
    UPPER(LTRIM(RTRIM(ISNULL(vp.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})
    OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})
  )`;
}

/**
 * Cria filtro de grade para ScarfMe (suporta múltiplos valores)
 */
function buildGradeFilterForProducts(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  grade: string | null | undefined,
  grades: string[] | null | undefined
): string {
  if (companySlug !== 'scarfme') {
    return '';
  }
  
  const gradesList = grades && grades.length > 0 
    ? grades 
    : grade 
      ? [grade] 
      : [];
  
  if (gradesList.length === 0) {
    return '';
  }
  
  const gradesNormalizadas = gradesList.map(g => g.trim().toUpperCase());
  
  if (gradesNormalizadas.length === 1) {
    request.input('grade', sql.VarChar, gradesNormalizadas[0]);
    return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = @grade`;
  }
  
  gradesNormalizadas.forEach((g, index) => {
    request.input(`grade${index}`, sql.VarChar, g);
  });
  
  const placeholders = gradesNormalizadas
    .map((_, index) => `@grade${index}`)
    .join(', ');
  
  return `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) IN (${placeholders})`;
}

/**
 * Busca produtos com todas as informações necessárias para a página de produtos
 * Inclui faturamento, quantidade, preço médio, custo, markup, estoque e variações
 */
export async function fetchProductsWithDetails({
  company,
  range,
  filial,
  grupo,
  grupos,
  linha,
  linhas,
  colecao,
  colecoes,
  subgrupo,
  subgrupos,
  grade,
  grades,
  groupByColor = false,
  produtoId,
  produtoIds,
  produtoSearchTerm,
  acimaDoTicket = false,
  filterByRegistrationDate = false,
}: ProductsQueryParams = {}): Promise<ProductDetail[]> {
  // Se for e-commerce, usar função específica de e-commerce
  if (isEcommerceFilial(company, filial)) {
    return fetchProductsWithDetailsEcommerce({ company, range, filial, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor, produtoId, produtoIds, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate });
  }

  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (company === 'scarfme' && filial === null) {
    const [salesProducts, ecommerceProducts] = await Promise.all([
      fetchProductsWithDetailsSales({ company, range, filial: VAREJO_VALUE, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor, produtoId, produtoIds, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate }),
      fetchProductsWithDetailsEcommerce({ company, range, filial: null, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor, produtoId, produtoIds, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate }),
    ]);

    // Agregar produtos por productId (e cor se groupByColor estiver ativo).
    // IMPORTANTE: varejo e e-commerce vêm de fontes diferentes — o varejo manda
    // PRODUTO como CHAR com padding ('07.A1.00B3  ') e a cor como '06', enquanto o
    // e-commerce manda limpos ('07.A1.00B3', '6'). Sem normalizar AMBOS (trim no id
    // + normalizeCorKey na cor), a mesma variação vira duas linhas. Ver memória
    // [[cor-produto-formato-duas-fontes]].
    const productMap = new Map<string, ProductDetail>();
    const getKey = (product: ProductDetail) =>
      groupByColor && product.corProduto
        ? `${String(product.productId ?? '').trim()}-${normalizeCorKey(product.corProduto)}`
        : String(product.productId ?? '').trim();

    // Adicionar produtos de vendas normais
    salesProducts.forEach((product) => {
      const key = getKey(product);
      productMap.set(key, { ...product, productId: String(product.productId ?? '').trim() });
    });

    // Agregar produtos de ecommerce
    ecommerceProducts.forEach((product) => {
      const key = getKey(product);
      const existing = productMap.get(key);
      if (existing) {
        existing.totalRevenue += product.totalRevenue;
        existing.totalQuantity += product.totalQuantity;
        existing.averagePrice = existing.totalRevenue / existing.totalQuantity;
        // Manter o custo e estoque da venda normal (já foi buscado)
        if (existing.cost > 0) {
          existing.markup = existing.averagePrice / existing.cost;
        }
        // Preservar grade se não existir no produto existente
        if (!existing.grade && product.grade) {
          existing.grade = product.grade;
        }
        // Preservar partes descritivas se não existirem no produto existente
        if (!existing.grupo && product.grupo) existing.grupo = product.grupo;
        if (!existing.subgrupo && product.subgrupo) existing.subgrupo = product.subgrupo;
        if (!existing.linha && product.linha) existing.linha = product.linha;
        if (!existing.tipo && product.tipo) existing.tipo = product.tipo;
      } else {
        productMap.set(key, { ...product, productId: String(product.productId ?? '').trim() });
      }
    });

    // Converter para array
    const aggregatedProducts = Array.from(productMap.values());

    // Recalcular estoque por cor/produto para todas as filiais da empresa
    if (aggregatedProducts.length > 0) {
      if (groupByColor) {
        const productsWithColor = aggregatedProducts.map((p) => ({
          productId: p.productId,
          corProduto: p.corProduto || null,
        }));
        const stockMap = await fetchMultipleProductsStockByColor(productsWithColor, {
          company,
          filial: null,
        });

        aggregatedProducts.forEach((product) => {
          const pid = String(product.productId ?? '').trim();
          const cor = product.corProduto ? String(product.corProduto).trim() : null;
          const key = cor ? `${pid}-${cor}` : `${pid}-null`;
          const s = stockMap.get(key) ?? 0;
          product.stock = s;
          product.estoqueRede = s;
        });
      } else {
        const productIds = Array.from(new Set(aggregatedProducts.map((p) => p.productId)));
        const stockMap = await fetchMultipleProductsStock(productIds, {
          company,
          filial: null,
        });

        aggregatedProducts.forEach((product) => {
          const pid = String(product.productId ?? '').trim();
          const s = stockMap.get(pid) ?? 0;
          product.stock = s;
          product.estoqueRede = s;
        });
      }
    }

    // Ordenar por revenue
    return aggregatedProducts.sort((a, b) => b.totalRevenue - a.totalRevenue);
  }

  // Função normal para vendas de loja
  return fetchProductsWithDetailsSales({ company, range, filial, grupo, grupos, linha, linhas, colecao, colecoes, subgrupo, subgrupos, grade, grades, groupByColor, produtoId, produtoIds, produtoSearchTerm, acimaDoTicket, filterByRegistrationDate });
}

/**
 * Busca produtos com detalhes para vendas normais (não e-commerce)
 */
async function fetchProductsWithDetailsSales({
  company,
  range,
  filial,
  grupo,
  grupos,
  linha,
  linhas,
  colecao,
  colecoes,
  subgrupo,
  subgrupos,
  grade,
  grades,
  groupByColor = false,
  produtoId,
  produtoIds,
  produtoSearchTerm,
  acimaDoTicket = false,
  filterByRegistrationDate = false,
}: ProductsQueryParams = {}): Promise<ProductDetail[]> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    // Calcular período anterior para comparação
    const previousRange = shiftRangeByMonths({ start, end }, -1);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const salesFilialFilter = await buildFilialFilter(request, company, 'sales', filial, 'f', 'salesFilial');
    const salesCheckFilialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp_check', 'salesCheckFilial');
    const historicalFilialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp', 'historicalFilial');
    const grupoFilter = buildGrupoFilterForProducts(request, company, grupo, grupos);
    const linhaFilter = buildLinhaFilterForProducts(request, company, linha, linhas);
    const colecaoFilter = buildColecaoFilterForProducts(request, company, colecao, colecoes);
    const subgrupoFilter = buildSubgrupoFilterForProducts(request, company, subgrupo, subgrupos);
    const gradeFilter = buildGradeFilterForProducts(request, company, grade, grades);

    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoId', sql.VarChar, produtoId);
      produtoFilter = `AND vp.PRODUTO = @produtoId`;
    } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
      const searchPattern = `%${produtoSearchTerm.trim()}%`;
      request.input('produtoSearchTerm', sql.VarChar, searchPattern);
      produtoFilter = `AND vp.DESC_PRODUTO LIKE @produtoSearchTerm`;
    }
    // Lista de produtos: ADITIVA (soma-se ao caso acima em vez de substituí-lo). Emitida
    // com o alias vp.PRODUTO porque os `replace` logo abaixo reescrevem o alias para as
    // variantes da query (pos = vp, trocas puras = vt).
    const produtoIdsIn = buildProdutoIdsPlaceholders(request, produtoIds, 'prodIdsList');
    if (produtoIdsIn) produtoFilter += ` AND vp.PRODUTO IN (${produtoIdsIn})`;

    const posGrupoFilter = grupoFilter.replace(/vp\.GRUPO_PRODUTO/g, 'p.GRUPO_PRODUTO');
    const posLinhaFilter = linhaFilter.replace(/vp\.LINHA/g, 'p.LINHA');
    const posColecaoFilter = colecaoFilter.replace(/vp\.COLECAO/g, 'p.COLECAO');
    const posSubgrupoFilter = subgrupoFilter.replace(/vp\.SUBGRUPO_PRODUTO/g, 'p.SUBGRUPO_PRODUTO');
    const posProdutoFilter = produtoFilter
      .replace(/vp\.DESC_PRODUTO/g, 'p.DESC_PRODUTO')
      .replace(/vp\.PRODUTO/g, 'vp.PRODUTO');
    const pureTradeProdutoFilter = posProdutoFilter.replace(/vp\.PRODUTO/g, 'vt.PRODUTO');

    // Definir campos de agrupamento e seleção baseado em groupByColor
    const groupByFields = groupByColor
      ? 'vf.PRODUTO, vf.COR_PRODUTO'
      : 'vf.PRODUTO';
    
    const colorSelectFields = groupByColor
      ? `NULLIF(vf.COR_PRODUTO, '') AS corProduto,
         MAX(COALESCE(c.DESC_COR, '')) AS descCorProduto,`
      : '';

    // Adicionar campo grade apenas para scarfme
    const gradeSelectField = company === 'scarfme'
      ? 'MAX(CONVERT(VARCHAR, p.GRADE)) AS grade,'
      : '';

    // Query para período atual
    // Se acimaDoTicket estiver ativo, filtrar apenas vendas individuais onde PRECO_LIQUIDO > preço sugerido
    const suggestedPriceField = 'CASE WHEN p.PRECO_REPOSICAO_1 IS NULL OR p.PRECO_REPOSICAO_1 = 0 THEN NULL ELSE CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2)) END';
    
    let acimaDoTicketFilter = '';
    if (acimaDoTicket) {
      acimaDoTicketFilter = `AND p.PRECO_REPOSICAO_1 IS NOT NULL 
         AND p.PRECO_REPOSICAO_1 > 0 
         AND vp.PRECO_LIQUIDO > CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2))`;
      
      // Para NERD, remover linha ASSISTENCIA nesta visão
      if (company === 'nerd') {
        acimaDoTicketFilter += `
         AND UPPER(LTRIM(RTRIM(ISNULL(vp.LINHA, '')))) <> 'ASSISTENCIA'
         AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) <> 'ASSISTENCIA'`;
      }
    }
    const pureTradeAcimaDoTicketFilter = acimaDoTicketFilter
      .replace(/vp\.PRECO_LIQUIDO/g, 'vt.PRECO_LIQUIDO')
      .replace(/vp\.LINHA/g, 'p.LINHA');
    
    // Se filterByRegistrationDate for true, filtrar produtos pela data de cadastramento no período
    // e ainda filtrar vendas pelo período também
    const currentRegistrationDateFilter = filterByRegistrationDate
      ? `AND p.DATA_CADASTRAMENTO >= @startDate
        AND p.DATA_CADASTRAMENTO < @endDate
        AND p.DATA_CADASTRAMENTO IS NOT NULL`
      : '';

    const buildNetProductsQuery = ({
      startParam,
      endParam,
      revenueAlias,
      quantityAlias,
      applyRegistrationDateFilter = false,
    }: {
      startParam: string;
      endParam: string;
      revenueAlias: string;
      quantityAlias: string;
      applyRegistrationDateFilter?: boolean;
    }) => `
      WITH vendas_base AS (
        SELECT
          vp.TICKET,
          vp.CODIGO_FILIAL,
          vp.PRODUTO,
          ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
          vp.TAMANHO,
          vp.QTDE,
          vp.PRECO_LIQUIDO,
          vp.CUSTO,
          CAST((vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA, 0)) AS DECIMAL(38,6)) AS DESCONTO_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL
          AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON p.PRODUTO = vp.PRODUTO
        WHERE vp.DATA_VENDA >= @${startParam}
          AND vp.DATA_VENDA < @${endParam}
          AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
          ${salesFilialFilter}
          ${posGrupoFilter}
          ${posLinhaFilter}
          ${posColecaoFilter}
          ${posSubgrupoFilter}
          ${gradeFilter}
          ${posProdutoFilter}
          ${acimaDoTicketFilter}
          ${applyRegistrationDateFilter ? currentRegistrationDateFilter : ''}
      ),
      trocas_item AS (
        SELECT
          vt.TICKET,
          vt.CODIGO_FILIAL,
          vt.PRODUTO,
          ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
          vt.TAMANHO,
          SUM(vt.QTDE) AS QTDE_TROCA,
          CAST(SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL
          AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON p.PRODUTO = vt.PRODUTO
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @${startParam}
          AND v.DATA_VENDA < @${endParam}
          ${salesFilialFilter}
          ${posGrupoFilter}
          ${posLinhaFilter}
          ${posColecaoFilter}
          ${posSubgrupoFilter}
          ${gradeFilter}
          ${pureTradeProdutoFilter}
          ${pureTradeAcimaDoTicketFilter}
          ${applyRegistrationDateFilter ? currentRegistrationDateFilter : ''}
        GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, ISNULL(vt.COR_PRODUTO, ''), vt.TAMANHO
      ),
      TrocasPuras AS (
        SELECT
          vt.PRODUTO,
          ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
          CAST((0 - vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (0 - vt.QTDE) AS QTDE_LIQUIDA_CALC,
          CAST(NULL AS DECIMAL(18, 6)) AS CUSTO
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL
          AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
          ON f.COD_FILIAL = vt.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK)
          ON p.PRODUTO = vt.PRODUTO
        WHERE vt.QTDE_CANCELADA = 0
          AND v.DATA_VENDA >= @${startParam}
          AND v.DATA_VENDA < @${endParam}
          AND NOT EXISTS (
            SELECT 1
            FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            WHERE vp.TICKET = vt.TICKET
              AND vp.CODIGO_FILIAL = vt.CODIGO_FILIAL
              AND vp.PRODUTO = vt.PRODUTO
              AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
              AND ISNULL(vp.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
              AND ISNULL(vp.QTDE_CANCELADA, 0) = 0
          )
          ${salesFilialFilter}
          ${posGrupoFilter}
          ${posLinhaFilter}
          ${posColecaoFilter}
          ${posSubgrupoFilter}
          ${gradeFilter}
          ${pureTradeProdutoFilter}
          ${pureTradeAcimaDoTicketFilter}
          ${applyRegistrationDateFilter ? currentRegistrationDateFilter : ''}
      ),
      VendasComNumero AS (
        SELECT
          vb.PRODUTO,
          vb.COR_PRODUTO,
          vb.TAMANHO,
          vb.QTDE,
          vb.PRECO_LIQUIDO,
          vb.CUSTO,
          vb.DESCONTO_VENDA,
          vb.TICKET,
          vb.CODIGO_FILIAL,
          ROW_NUMBER() OVER (
            PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
            ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ) AS RN
        FROM vendas_base vb
      ),
      vendas_finais AS (
        SELECT
          vcn.PRODUTO,
          vcn.COR_PRODUTO,
          CAST(
            CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6))
            - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6))
            - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))
          AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
          (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC,
          CAST(vcn.CUSTO AS DECIMAL(18,6)) AS CUSTO
        FROM VendasComNumero vcn
        LEFT JOIN trocas_item ti
          ON ti.TICKET = vcn.TICKET
          AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
          AND ti.PRODUTO = vcn.PRODUTO
          AND ti.COR_PRODUTO = vcn.COR_PRODUTO
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
        UNION ALL
        SELECT
          tp.PRODUTO,
          tp.COR_PRODUTO,
          tp.VALOR_LIQUIDO_CALC,
          tp.QTDE_LIQUIDA_CALC,
          tp.CUSTO
        FROM TrocasPuras tp
      )
      SELECT
        vf.PRODUTO AS productId,
        MAX(ISNULL(p.DESC_PRODUTO, '')) AS productName,
        MAX(COALESCE(p.GRUPO_PRODUTO, '')) AS grupo,
        MAX(COALESCE(p.SUBGRUPO_PRODUTO, '')) AS subgrupo,
        MAX(COALESCE(p.LINHA, '')) AS linha,
        MAX(COALESCE(p.TIPO_PRODUTO, '')) AS tipo,
        ${gradeSelectField}
        ${colorSelectFields}
        MAX(p.DATA_CADASTRAMENTO) AS registrationDate,
        SUM(vf.VALOR_LIQUIDO_CALC) AS ${revenueAlias},
        SUM(vf.QTDE_LIQUIDA_CALC) AS ${quantityAlias},
        AVG(vf.CUSTO) AS cost,
        MAX(${suggestedPriceField}) AS suggestedPrice
      FROM vendas_finais vf
      LEFT JOIN PRODUTOS p WITH (NOLOCK)
        ON vf.PRODUTO = p.PRODUTO
      ${groupByColor ? `LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON RTRIM(LTRIM(c.PRODUTO)) = RTRIM(LTRIM(vf.PRODUTO))
         AND (RTRIM(LTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(vf.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, vf.COR_PRODUTO))` : ''}
      GROUP BY ${groupByFields}
    `;
    
    // Query base para produtos com vendas
    let currentQuery = buildNetProductsQuery({
      startParam: 'startDate',
      endParam: 'endDate',
      revenueAlias: 'totalRevenue',
      quantityAlias: 'totalQuantity',
      applyRegistrationDateFilter: filterByRegistrationDate,
    });

    // Se filterByRegistrationDate estiver ativo, adicionar produtos sem venda no final
    if (filterByRegistrationDate && !acimaDoTicket) {
      // Função auxiliar para adaptar filtros para usar apenas tabela p (produtos sem venda)
      const adaptFilterForProductsOnly = (filter: string): string => {
        if (!filter) return '';
        // Remover referências a vp. e manter apenas p.
        return filter
          .replace(/UPPER\(LTRIM\(RTRIM\(ISNULL\(vp\.([^,)]+), ''\)\)\)\)/g, 'UPPER(LTRIM(RTRIM(ISNULL(p.$1, \'\'))))')
          .replace(/vp\.([A-Z_]+)/g, 'p.$1')
          .replace(/OR UPPER\(LTRIM\(RTRIM\(ISNULL\(vp\.([^,)]+), ''\)\)\)\)/g, '');
      };

      let produtoSemVendaProdutoFilter = '';
      
      if (produtoId) {
        produtoSemVendaProdutoFilter = `AND p.PRODUTO = @produtoId`;
      } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
        produtoSemVendaProdutoFilter = `AND p.DESC_PRODUTO LIKE @produtoSearchTerm`;
      }
      // Reusa os MESMOS @params já registrados acima, só troca o alias da coluna.
      if (produtoIdsIn) produtoSemVendaProdutoFilter += ` AND p.PRODUTO IN (${produtoIdsIn})`;

      // Para produtos sem venda, não agrupamos por cor (não há vendas para diferenciar)
      const produtoSemVendaColorFields = groupByColor
        ? `NULL AS corProduto, NULL AS descCorProduto,`
        : '';

      // Adaptar filtros para usar apenas tabela p
      const produtoSemVendaGrupoFilter = adaptFilterForProductsOnly(grupoFilter);
      const produtoSemVendaLinhaFilter = adaptFilterForProductsOnly(linhaFilter);
      const produtoSemVendaColecaoFilter = adaptFilterForProductsOnly(colecaoFilter);
      const produtoSemVendaSubgrupoFilter = adaptFilterForProductsOnly(subgrupoFilter);
      const produtoSemVendaGradeFilter = adaptFilterForProductsOnly(gradeFilter);

      // Query para produtos cadastrados no período mas sem vendas
      const produtosSemVendaQuery = `
        UNION ALL
        SELECT 
          p.PRODUTO AS productId,
          p.DESC_PRODUTO AS productName,
          COALESCE(p.GRUPO_PRODUTO, '') AS grupo,
          COALESCE(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
          COALESCE(p.LINHA, '') AS linha,
          COALESCE(p.TIPO_PRODUTO, '') AS tipo,
          ${gradeSelectField}
          ${produtoSemVendaColorFields}
          p.DATA_CADASTRAMENTO AS registrationDate,
          0 AS totalRevenue,
          0 AS totalQuantity,
          NULL AS cost,
          ${suggestedPriceField} AS suggestedPrice
        FROM PRODUTOS p WITH (NOLOCK)
        LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp_check WITH (NOLOCK)
          ON p.PRODUTO = vp_check.PRODUTO
          AND vp_check.DATA_VENDA >= @startDate
          AND vp_check.DATA_VENDA < @endDate
          ${salesCheckFilialFilter}
        WHERE p.DATA_CADASTRAMENTO >= @startDate
          AND p.DATA_CADASTRAMENTO < @endDate
          AND p.DATA_CADASTRAMENTO IS NOT NULL
          AND vp_check.PRODUTO IS NULL
          ${produtoSemVendaGrupoFilter}
          ${produtoSemVendaLinhaFilter}
          ${produtoSemVendaColecaoFilter}
          ${produtoSemVendaSubgrupoFilter}
          ${produtoSemVendaGradeFilter}
          ${produtoSemVendaProdutoFilter}
      `;

      currentQuery += produtosSemVendaQuery;
    }

    // Query para período anterior
    const previousQuery = buildNetProductsQuery({
      startParam: 'previousStartDate',
      endParam: 'previousEndDate',
      revenueAlias: 'previousRevenue',
      quantityAlias: 'previousQuantity',
    });

    // Query para verificar se o produto já teve vendas em algum momento antes do período atual
    const hasEverSoldColorSelectFields = groupByColor
      ? 'vp.COR_PRODUTO AS corProduto,'
      : '';
    const historicalGroupByFields = groupByColor
      ? 'vp.PRODUTO, vp.COR_PRODUTO'
      : 'vp.PRODUTO';

    const hasEverSoldQuery = `
      SELECT 
        vp.PRODUTO AS productId,
        ${hasEverSoldColorSelectFields}
        COUNT(*) AS saleCount
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA < @startDate
        ${historicalFilialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
      GROUP BY ${historicalGroupByFields}
    `;

    const [currentResult, previousResult, hasEverSoldResult] = await Promise.all([
      request.query<{
        productId: string;
        productName: string;
        grupo: string | null;
        subgrupo?: string | null;
        linha?: string | null;
        tipo?: string | null;
        grade?: string | null;
        corProduto?: string | null;
        descCorProduto?: string | null;
        registrationDate?: string | Date | null;
        totalRevenue: number | null;
        totalQuantity: number | null;
        cost: number | null;
        suggestedPrice: number | null;
      }>(currentQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        previousRevenue: number | null;
        previousQuantity: number | null;
      }>(previousQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        saleCount: number;
      }>(hasEverSoldQuery),
    ]);

    // Criar mapa do período anterior (chave inclui cor se groupByColor estiver ativo)
    const previousMap = new Map<string, { revenue: number; quantity: number }>();
    previousResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      previousMap.set(key, {
        revenue: Number(row.previousRevenue ?? 0),
        quantity: Number(row.previousQuantity ?? 0),
      });
    });

    // Criar mapa de produtos que já tiveram vendas antes do período atual
    const hasEverSoldMap = new Map<string, boolean>();
    hasEverSoldResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      hasEverSoldMap.set(key, true);
    });

    const products = currentResult.recordset.map((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const cost = Number(row.cost ?? 0);
      const suggestedPrice = row.suggestedPrice != null && row.suggestedPrice > 0 ? Number(row.suggestedPrice) : null;
      const grupo = (row.grupo && row.grupo.trim() !== '') ? row.grupo.trim() : null;
      const subgrupo = (row.subgrupo && row.subgrupo.trim() !== '') ? row.subgrupo.trim() : null;
      const linha = (row.linha && row.linha.trim() !== '') ? row.linha.trim() : null;
      const tipo = (row.tipo && row.tipo.trim() !== '') ? row.tipo.trim() : null;

      // Obter chave para buscar dados do período anterior (inclui cor se groupByColor estiver ativo)
      const previousKey = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      const previous = previousMap.get(previousKey) ?? { revenue: 0, quantity: 0 };
      const previousRevenue = previous.revenue;
      const previousQuantity = previous.quantity;
      
      // Verificar se o produto já teve vendas em algum momento antes do período atual
      const hasEverSold = hasEverSoldMap.has(previousKey);
      
      const averagePrice = quantity > 0 ? revenue / quantity : 0;
      const markup = cost > 0 ? averagePrice / cost : 0;
      
      // Calcular variações
      // isNew só é true se não teve vendas no período anterior E nunca teve vendas antes
      const isNew = previousRevenue === 0 && previousQuantity === 0 && !hasEverSold;
      
      // Se não teve vendas no período anterior mas já teve antes, mostrar 0% em vez de null
      const revenueVariance = isNew
        ? null
        : previousRevenue === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));
      const quantityVariance = isNew
        ? null
        : previousQuantity === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((quantity - previousQuantity) / previousQuantity) * 100).toFixed(1));

      // Processar informações de cor
      const corProduto = groupByColor ? (row.corProduto || null) : null;
      const descCorProduto = groupByColor 
        ? getColorDescription(row.corProduto, row.descCorProduto)
        : null;

      // Processar grade apenas para scarfme
      const grade = company === 'scarfme' 
        ? (row.grade && row.grade.trim() !== '' ? row.grade.trim() : null)
        : undefined;

      // Processar data de cadastramento
      let registrationDate: string | null = null;
      if (row.registrationDate) {
        if (row.registrationDate instanceof Date) {
          registrationDate = row.registrationDate.toISOString();
        } else if (typeof row.registrationDate === 'string') {
          registrationDate = row.registrationDate;
        }
      }

      return {
        productId: row.productId,
        productName: row.productName || 'Sem descrição',
        totalRevenue: revenue,
        totalQuantity: quantity,
        averagePrice,
        cost,
        markup,
        stock: 0, // Será preenchido abaixo
        revenueVariance,
        quantityVariance,
        isNew,
        corProduto,
        descCorProduto,
        grupo,
        subgrupo,
        linha,
        tipo,
        grade,
        estoqueRede: 0, // Será preenchido abaixo para scarfme
        suggestedPrice,
        registrationDate,
      };
    });

    // Buscar estoque para todos os produtos de uma vez
    if (products.length > 0) {
      if (groupByColor) {
        // Quando groupByColor está ativo, buscar estoque por produto e cor
        const productsWithColor = products.map((p) => ({
          productId: p.productId,
          corProduto: p.corProduto || null,
        }));
        const stockMap = await fetchMultipleProductsStockByColor(productsWithColor, {
          company,
          filial,
        });

        // Adicionar estoque a cada produto usando a chave "productId-corProduto" (trim para garantir match)
        products.forEach((product) => {
          const pid = String(product.productId ?? '').trim();
          const cor = product.corProduto ? String(product.corProduto).trim() : null;
          const key = cor ? `${pid}-${cor}` : `${pid}-null`;
          product.stock = stockMap.get(key) ?? 0;
        });

        // Para scarfme, buscar estoque rede por cor em todas as filiais (sem filtro de filial no SQL)
        if (company === 'scarfme') {
          const productsWithColor = products.map((p) => ({
            productId: p.productId,
            corProduto: p.corProduto || null,
          }));
          const stockRedeMap = await fetchMultipleProductsStockByColor(productsWithColor, {
            company,
            filial: null,
          });

          products.forEach((product) => {
            const pid = String(product.productId ?? '').trim();
            const cor = product.corProduto ? String(product.corProduto).trim() : null;
            const key = cor ? `${pid}-${cor}` : `${pid}-null`;
            product.estoqueRede = stockRedeMap.get(key) ?? 0;
          });

          if (filial === null) {
            products.forEach((product) => {
              product.stock = product.estoqueRede;
            });
          }
        }
      } else {
        // Quando groupByColor não está ativo, usar a função original
        const productIds = products.map((p) => p.productId);
        const stockMap = await fetchMultipleProductsStock(productIds, {
          company,
          filial,
        });

        // Adicionar estoque a cada produto
        products.forEach((product) => {
          const pid = String(product.productId ?? '').trim();
          product.stock = stockMap.get(pid) ?? 0;
        });

        // Para scarfme, buscar estoque rede em todas as filiais (sem filtro de filial no SQL)
        if (company === 'scarfme') {
          const stockRedeMap = await fetchMultipleProductsStock(productIds, {
            company,
            filial: null,
          });

          products.forEach((product) => {
            const pid = String(product.productId ?? '').trim();
            product.estoqueRede = stockRedeMap.get(pid) ?? 0;
          });

          if (filial === null) {
            products.forEach((product) => {
              product.stock = product.estoqueRede;
            });
          }
        }
      }
    }

    // Filtrar produtos quando acimaDoTicket estiver ativo: apenas produtos com preço médio > preço sugerido
    let filteredProducts = products;
    if (acimaDoTicket) {
      filteredProducts = products.filter(product => {
        return product.suggestedPrice !== null 
          && product.suggestedPrice > 0 
          && product.averagePrice > product.suggestedPrice;
      });
    }

    // Ordenar produtos: quando filterByRegistrationDate está ativo, produtos sem venda vão para o final
    return filteredProducts.sort((a, b) => {
      if (filterByRegistrationDate) {
        // Produtos com venda primeiro (revenue > 0), depois produtos sem venda (revenue = 0)
        const aHasRevenue = a.totalRevenue > 0;
        const bHasRevenue = b.totalRevenue > 0;
        if (aHasRevenue !== bHasRevenue) {
          return aHasRevenue ? -1 : 1;
        }
      }
      // Ordenar por revenue descendente
      return b.totalRevenue - a.totalRevenue;
    });
  });
}

/**
 * Busca produtos com detalhes para e-commerce
 */
async function fetchProductsWithDetailsEcommerce({
  company,
  range,
  filial,
  grupo,
  grupos,
  linha,
  linhas,
  colecao,
  colecoes,
  subgrupo,
  subgrupos,
  grade,
  grades,
  groupByColor = false,
  produtoId,
  produtoIds,
  produtoSearchTerm,
  acimaDoTicket = false,
  filterByRegistrationDate = false,
}: ProductsQueryParams = {}): Promise<ProductDetail[]> {
  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    // Calcular período anterior para comparação
    const previousRange = shiftRangeByMonths({ start, end }, -1);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    // Construir filtro de filial para e-commerce
    let filialFilter = '';
    if (company) {
      const companyConfig = await resolveCompanyLive(company);
      const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
      
      if (filial && filial !== VAREJO_VALUE) {
        if (!ecommerceFilials.includes(filial)) {
          filialFilter = 'AND 1=0';
        } else {
          ecommerceFilials.forEach((ecommerceFilial, index) => {
            request.input(`filial${index}`, sql.VarChar, ecommerceFilial);
          });
          const placeholders = ecommerceFilials
            .map((_, index) => `@filial${index}`)
            .join(', ');
          filialFilter = `AND f.FILIAL IN (${placeholders})`;
        }
      } else if (ecommerceFilials.length > 0) {
        ecommerceFilials.forEach((filial, index) => {
          request.input(`filial${index}`, sql.VarChar, filial);
        });
        const placeholders = ecommerceFilials
          .map((_, index) => `@filial${index}`)
          .join(', ');
        filialFilter = `AND f.FILIAL IN (${placeholders})`;
      }
    }

    // Para e-commerce, construir filtros usando apenas p (não temos vp)
    // Criar filtros específicos para e-commerce para evitar problemas com substituição de strings
    let grupoFilter = '';
    let linhaFilter = '';
    let colecaoFilter = '';
    let subgrupoFilter = '';
    let gradeFilter = '';
    
    let produtoFilter = '';
    if (produtoId) {
      request.input('produtoIdEcommerce', sql.VarChar, produtoId);
      produtoFilter = `AND fp.PRODUTO = @produtoIdEcommerce`;
    } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
      const searchPattern = `%${produtoSearchTerm.trim()}%`;
      request.input('produtoSearchTermEcommerce', sql.VarChar, searchPattern);
      produtoFilter = `AND p.DESC_PRODUTO LIKE @produtoSearchTermEcommerce`;
    }
    // Lista de produtos: ADITIVA (ver a mesma regra na variante de loja/POS).
    const produtoIdsIn = buildProdutoIdsPlaceholders(request, produtoIds, 'prodIdsListEcom');
    if (produtoIdsIn) produtoFilter += ` AND fp.PRODUTO IN (${produtoIdsIn})`;
    
    // Filtro de grupo para e-commerce
    const gruposList = grupos && grupos.length > 0 ? grupos : grupo ? [grupo] : [];
    if (company === 'scarfme' && gruposList.length > 0) {
      const gruposNormalizados = gruposList.map(g => g.trim().toUpperCase());
      if (gruposNormalizados.length === 1) {
        request.input('grupoEcommerce', sql.VarChar, gruposNormalizados[0]);
        grupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = @grupoEcommerce`;
      } else {
        gruposNormalizados.forEach((g, index) => {
          request.input(`grupoEcommerce${index}`, sql.VarChar, g);
        });
        const placeholders = gruposNormalizados.map((_, index) => `@grupoEcommerce${index}`).join(', ');
        grupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) IN (${placeholders})`;
      }
    }

    // Filtro de linha para e-commerce
    const linhasList = linhas && linhas.length > 0 ? linhas : linha ? [linha] : [];
    if (company === 'scarfme' && linhasList.length > 0) {
      const linhasNormalizadas = linhasList.map(l => l.trim().toUpperCase());
      if (linhasNormalizadas.length === 1) {
        request.input('linhaEcommerce', sql.VarChar, linhasNormalizadas[0]);
        linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = @linhaEcommerce`;
      } else {
        linhasNormalizadas.forEach((l, index) => {
          request.input(`linhaEcommerce${index}`, sql.VarChar, l);
        });
        const placeholders = linhasNormalizadas.map((_, index) => `@linhaEcommerce${index}`).join(', ');
        linhaFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) IN (${placeholders})`;
      }
    }
    
    // Filtro de coleção para e-commerce
    const colecoesList = colecoes && colecoes.length > 0 ? colecoes : colecao ? [colecao] : [];
    if (company === 'scarfme' && colecoesList.length > 0) {
      const colecoesNormalizadas = colecoesList.map(c => c.trim().toUpperCase());
      if (colecoesNormalizadas.length === 1) {
        request.input('colecaoEcommerce', sql.VarChar, colecoesNormalizadas[0]);
        colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = @colecaoEcommerce`;
      } else {
        colecoesNormalizadas.forEach((c, index) => {
          request.input(`colecaoEcommerce${index}`, sql.VarChar, c);
        });
        const placeholders = colecoesNormalizadas.map((_, index) => `@colecaoEcommerce${index}`).join(', ');
        colecaoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})`;
      }
    }
    
    // Filtro de subgrupo para e-commerce
    const subgruposList = subgrupos && subgrupos.length > 0 ? subgrupos : subgrupo ? [subgrupo] : [];
    if (company === 'scarfme' && subgruposList.length > 0) {
      const subgruposNormalizados = subgruposList.map(s => s.trim().toUpperCase());
      if (subgruposNormalizados.length === 1) {
        request.input('subgrupoEcommerce', sql.VarChar, subgruposNormalizados[0]);
        subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = @subgrupoEcommerce`;
      } else {
        subgruposNormalizados.forEach((s, index) => {
          request.input(`subgrupoEcommerce${index}`, sql.VarChar, s);
        });
        const placeholders = subgruposNormalizados.map((_, index) => `@subgrupoEcommerce${index}`).join(', ');
        subgrupoFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) IN (${placeholders})`;
      }
    }
    
    // Filtro de grade para e-commerce
    const gradesList = grades && grades.length > 0 ? grades : grade ? [grade] : [];
    if (company === 'scarfme' && gradesList.length > 0) {
      const gradesNormalizadas = gradesList.map(g => g.trim().toUpperCase());
      if (gradesNormalizadas.length === 1) {
        request.input('gradeEcommerce', sql.VarChar, gradesNormalizadas[0]);
        gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = @gradeEcommerce`;
      } else {
        gradesNormalizadas.forEach((g, index) => {
          request.input(`gradeEcommerce${index}`, sql.VarChar, g);
        });
        const placeholders = gradesNormalizadas.map((_, index) => `@gradeEcommerce${index}`).join(', ');
        gradeFilter = `AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) IN (${placeholders})`;
      }
    }

    // Definir campos de agrupamento e seleção baseado em groupByColor
    const ecommerceGroupByFields = groupByColor 
      ? 'fp.PRODUTO, fp.COR_PRODUTO'
      : 'fp.PRODUTO';
    
    const ecommerceColorSelectFields = groupByColor
      ? `fp.COR_PRODUTO AS corProduto,`
      : '';

    // Adicionar campo grade apenas para scarfme
    const ecommerceGradeSelectField = company === 'scarfme'
      ? 'MAX(CONVERT(VARCHAR, p.GRADE)) AS grade,'
      : '';

    // Query para período atual
    // Se acimaDoTicket estiver ativo, filtrar apenas vendas individuais onde PRECO > preço sugerido
    const ecommerceSuggestedPriceField = 'CASE WHEN p.PRECO_REPOSICAO_1 IS NULL OR p.PRECO_REPOSICAO_1 = 0 THEN NULL ELSE CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2)) END';
    
    let ecommerceAcimaDoTicketFilter = '';
    if (acimaDoTicket) {
      ecommerceAcimaDoTicketFilter = `AND p.PRECO_REPOSICAO_1 IS NOT NULL 
         AND p.PRECO_REPOSICAO_1 > 0 
         AND fp.PRECO > CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2))`;
      
      // Para NERD, remover linha ASSISTENCIA nesta visão
      if (company === 'nerd') {
        ecommerceAcimaDoTicketFilter += `
         AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) <> 'ASSISTENCIA'`;
      }
    }
    
    // Query base para produtos com vendas
    let currentQuery = `
      SELECT
        fp.PRODUTO AS productId,
        MAX(p.DESC_PRODUTO) AS productName,
        MAX(COALESCE(p.GRUPO_PRODUTO, '')) AS grupo,
        MAX(COALESCE(p.SUBGRUPO_PRODUTO, '')) AS subgrupo,
        MAX(COALESCE(p.LINHA, '')) AS linha,
        MAX(COALESCE(p.TIPO_PRODUTO, '')) AS tipo,
        ${ecommerceGradeSelectField}
        ${ecommerceColorSelectFields}
        MAX(p.DATA_CADASTRAMENTO) AS registrationDate,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity,
        AVG(ISNULL(fp.CUSTO_NA_DATA, 0)) AS cost,
        MAX(${ecommerceSuggestedPriceField}) AS suggestedPrice
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE ${filterByRegistrationDate
        ? `f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND p.DATA_CADASTRAMENTO >= @startDate
        AND p.DATA_CADASTRAMENTO < @endDate
        AND p.DATA_CADASTRAMENTO IS NOT NULL
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')`
        : `f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')`}
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
        ${ecommerceAcimaDoTicketFilter}
      GROUP BY ${ecommerceGroupByFields}
      ${acimaDoTicket ? `HAVING MAX(${ecommerceSuggestedPriceField}) IS NOT NULL
        AND (SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) / NULLIF(SUM(fp.QTDE), 0)) > MAX(${ecommerceSuggestedPriceField})` : ''}
    `;

    // Se filterByRegistrationDate estiver ativo, adicionar produtos sem venda no final
    if (filterByRegistrationDate && !acimaDoTicket) {
      let produtoSemVendaProdutoFilter = '';
      
      if (produtoId) {
        produtoSemVendaProdutoFilter = `AND p.PRODUTO = @produtoIdEcommerce`;
      } else if (produtoSearchTerm && produtoSearchTerm.trim().length >= 2) {
        produtoSemVendaProdutoFilter = `AND p.DESC_PRODUTO LIKE @produtoSearchTermEcommerce`;
      }
      // Reusa os MESMOS @params registrados acima, só troca o alias da coluna.
      if (produtoIdsIn) produtoSemVendaProdutoFilter += ` AND p.PRODUTO IN (${produtoIdsIn})`;

      // Para produtos sem venda, não agrupamos por cor (não há vendas para diferenciar)
      const produtoSemVendaColorFields = groupByColor
        ? `NULL AS corProduto,`
        : '';

      // Query para produtos cadastrados no período mas sem vendas de e-commerce
      // Nota: Para produtos sem venda, não podemos filtrar por filial diretamente (não há vendas),
      // então o filtro de filial é ignorado para produtos sem venda
      const produtosSemVendaQuery = `
        UNION ALL
        SELECT
          p.PRODUTO AS productId,
          p.DESC_PRODUTO AS productName,
          COALESCE(p.GRUPO_PRODUTO, '') AS grupo,
          COALESCE(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
          COALESCE(p.LINHA, '') AS linha,
          COALESCE(p.TIPO_PRODUTO, '') AS tipo,
          ${ecommerceGradeSelectField}
          ${produtoSemVendaColorFields}
          p.DATA_CADASTRAMENTO AS registrationDate,
          0 AS totalRevenue,
          0 AS totalQuantity,
          NULL AS cost,
          ${ecommerceSuggestedPriceField} AS suggestedPrice
        FROM PRODUTOS p WITH (NOLOCK)
        LEFT JOIN FATURAMENTO f_check WITH (NOLOCK)
          ON f_check.NOTA_CANCELADA = 0
          AND f_check.NATUREZA_SAIDA IN ('100.02', '100.022')
        LEFT JOIN W_FATURAMENTO_PROD_02 fp_check WITH (NOLOCK)
          ON f_check.FILIAL = fp_check.FILIAL
          AND f_check.NF_SAIDA = fp_check.NF_SAIDA
          AND f_check.SERIE_NF = fp_check.SERIE_NF
          AND fp_check.PRODUTO = p.PRODUTO
          AND f_check.EMISSAO >= @startDate
          AND f_check.EMISSAO < @endDate
          ${filialFilter.replace(/f\./g, 'f_check.')}
        WHERE p.DATA_CADASTRAMENTO >= @startDate
          AND p.DATA_CADASTRAMENTO < @endDate
          AND p.DATA_CADASTRAMENTO IS NOT NULL
          AND fp_check.PRODUTO IS NULL
          ${grupoFilter}
          ${linhaFilter}
          ${colecaoFilter}
          ${subgrupoFilter}
          ${gradeFilter}
          ${produtoSemVendaProdutoFilter}
      `;

      currentQuery += produtosSemVendaQuery;
    }

    // Query para período anterior
    const previousEcommerceColorSelectFields = groupByColor
      ? 'fp.COR_PRODUTO AS corProduto,'
      : '';

    const previousQuery = `
      SELECT 
        fp.PRODUTO AS productId,
        ${previousEcommerceColorSelectFields}
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS previousRevenue,
        SUM(fp.QTDE) AS previousQuantity
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO >= @previousStartDate
        AND f.EMISSAO < @previousEndDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
        ${produtoFilter}
      GROUP BY ${ecommerceGroupByFields}
    `;

    // Query para verificar se o produto já teve vendas em algum momento antes do período atual (e-commerce)
    const hasEverSoldEcommerceColorSelectFields = groupByColor
      ? 'fp.COR_PRODUTO AS corProduto,'
      : '';

    const hasEverSoldEcommerceQuery = `
      SELECT 
        fp.PRODUTO AS productId,
        ${hasEverSoldEcommerceColorSelectFields}
        COUNT(*) AS saleCount
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO < @startDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ${filialFilter}
        ${grupoFilter}
        ${linhaFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      GROUP BY ${ecommerceGroupByFields}
    `;

    const [currentResult, previousResult, hasEverSoldResult] = await Promise.all([
      request.query<{
        productId: string;
        productName: string;
        grupo?: string | null;
        subgrupo?: string | null;
        linha?: string | null;
        tipo?: string | null;
        grade?: string | null;
        corProduto?: string | null;
        registrationDate?: string | Date | null;
        totalRevenue: number | null;
        totalQuantity: number | null;
        cost: number | null;
        suggestedPrice: number | null;
      }>(currentQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        previousRevenue: number | null;
        previousQuantity: number | null;
      }>(previousQuery),
      request.query<{
        productId: string;
        corProduto?: string | null;
        saleCount: number;
      }>(hasEverSoldEcommerceQuery),
    ]);

    // Criar mapa do período anterior (chave inclui cor se groupByColor estiver ativo)
    const previousMap = new Map<string, { revenue: number; quantity: number }>();
    previousResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      previousMap.set(key, {
        revenue: Number(row.previousRevenue ?? 0),
        quantity: Number(row.previousQuantity ?? 0),
      });
    });

    // Criar mapa de produtos que já tiveram vendas antes do período atual (e-commerce)
    const hasEverSoldMap = new Map<string, boolean>();
    hasEverSoldResult.recordset.forEach((row) => {
      const key = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      hasEverSoldMap.set(key, true);
    });

    const products = currentResult.recordset.map((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const cost = Number(row.cost ?? 0);
      const suggestedPrice = row.suggestedPrice != null && row.suggestedPrice > 0 ? Number(row.suggestedPrice) : null;
      
      // Obter chave para buscar dados do período anterior (inclui cor se groupByColor estiver ativo)
      const previousKey = groupByColor && row.corProduto
        ? `${row.productId}-${row.corProduto}`
        : row.productId;
      const previous = previousMap.get(previousKey) ?? { revenue: 0, quantity: 0 };
      const previousRevenue = previous.revenue;
      const previousQuantity = previous.quantity;
      
      // Verificar se o produto já teve vendas em algum momento antes do período atual
      const hasEverSold = hasEverSoldMap.has(previousKey);
      
      const averagePrice = quantity > 0 ? revenue / quantity : 0;
      const markup = cost > 0 ? averagePrice / cost : 0;
      
      // Calcular variações
      // isNew só é true se não teve vendas no período anterior E nunca teve vendas antes
      const isNew = previousRevenue === 0 && previousQuantity === 0 && !hasEverSold;
      
      // Se não teve vendas no período anterior mas já teve antes, mostrar 0% em vez de null
      const revenueVariance = isNew
        ? null
        : previousRevenue === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((revenue - previousRevenue) / previousRevenue) * 100).toFixed(1));
      const quantityVariance = isNew
        ? null
        : previousQuantity === 0
          ? (hasEverSold ? 0 : null) // Se já teve vendas antes, mostrar 0%, senão null
          : Number((((quantity - previousQuantity) / previousQuantity) * 100).toFixed(1));

      // Processar informações de cor
      const corProduto = groupByColor ? (row.corProduto || null) : null;
      const descCorProduto = groupByColor 
        ? getColorDescription(row.corProduto, null)
        : null;

      // Processar grade apenas para scarfme
      const grade = company === 'scarfme'
        ? (row.grade && row.grade.trim() !== '' ? row.grade.trim() : null)
        : undefined;

      // Partes descritivas
      const grupo = (row.grupo && row.grupo.trim() !== '') ? row.grupo.trim() : null;
      const subgrupo = (row.subgrupo && row.subgrupo.trim() !== '') ? row.subgrupo.trim() : null;
      const linha = (row.linha && row.linha.trim() !== '') ? row.linha.trim() : null;
      const tipo = (row.tipo && row.tipo.trim() !== '') ? row.tipo.trim() : null;

      // Processar data de cadastramento
      let registrationDate: string | null = null;
      if (row.registrationDate) {
        if (row.registrationDate instanceof Date) {
          registrationDate = row.registrationDate.toISOString();
        } else if (typeof row.registrationDate === 'string') {
          registrationDate = row.registrationDate;
        }
      }

      return {
        productId: row.productId,
        productName: row.productName || 'Sem descrição',
        totalRevenue: revenue,
        totalQuantity: quantity,
        averagePrice,
        cost,
        markup,
        stock: 0, // Será preenchido abaixo
        revenueVariance,
        quantityVariance,
        isNew,
        corProduto,
        descCorProduto,
        grupo,
        subgrupo,
        linha,
        tipo,
        grade,
        estoqueRede: 0, // Será preenchido abaixo para scarfme
        suggestedPrice,
        registrationDate,
      };
    });

    // Buscar estoque para todos os produtos de uma vez
    // IMPORTANTE: Para e-commerce, quando filial é null, buscar estoque apenas das filiais de e-commerce
    if (products.length > 0) {
      if (groupByColor) {
        // Quando groupByColor está ativo, buscar estoque por produto e cor
        const productsWithColor = products.map((p) => ({
          productId: p.productId,
          corProduto: p.corProduto || null,
        }));
        const stockMap = await fetchMultipleProductsStockByColor(productsWithColor, {
          company,
          filial,
          ecommerceOnly: !filial, // Se filial é null, buscar apenas filiais de e-commerce
        });

        // Adicionar estoque a cada produto usando a chave "productId-corProduto" (trim para garantir match)
        products.forEach((product) => {
          const pid = String(product.productId ?? '').trim();
          const cor = product.corProduto ? String(product.corProduto).trim() : null;
          const key = cor ? `${pid}-${cor}` : `${pid}-null`;
          product.stock = stockMap.get(key) ?? 0;
        });

        // Para scarfme, buscar estoque rede por cor em todas as filiais (sem filtro de filial no SQL)
        if (company === 'scarfme') {
          const productsWithColor = products.map((p) => ({
            productId: p.productId,
            corProduto: p.corProduto || null,
          }));
          const stockRedeMap = await fetchMultipleProductsStockByColor(productsWithColor, {
            company,
            filial: null,
          });

          products.forEach((product) => {
            const pid = String(product.productId ?? '').trim();
            const cor = product.corProduto ? String(product.corProduto).trim() : null;
            const key = cor ? `${pid}-${cor}` : `${pid}-null`;
            product.estoqueRede = stockRedeMap.get(key) ?? 0;
          });

          if (filial === null) {
            products.forEach((product) => {
              product.stock = product.estoqueRede;
            });
          }
        }
      } else {
        // Quando groupByColor não está ativo, usar a função original
        const productIds = products.map((p) => p.productId);
        const stockMap = await fetchMultipleProductsStock(productIds, {
          company,
          filial,
          ecommerceOnly: !filial,
        });

        // Adicionar estoque a cada produto
        products.forEach((product) => {
          const pid = String(product.productId ?? '').trim();
          product.stock = stockMap.get(pid) ?? 0;
        });

        // Para scarfme, buscar estoque rede em todas as filiais (sem filtro de filial no SQL)
        if (company === 'scarfme') {
          const stockRedeMap = await fetchMultipleProductsStock(productIds, {
            company,
            filial: null,
          });

          products.forEach((product) => {
            const pid = String(product.productId ?? '').trim();
            product.estoqueRede = stockRedeMap.get(pid) ?? 0;
          });

          if (filial === null) {
            products.forEach((product) => {
              product.stock = product.estoqueRede;
            });
          }
        }
      }
    }

    // Filtrar produtos quando acimaDoTicket estiver ativo: apenas produtos com preço médio > preço sugerido
    let filteredProducts = products;
    if (acimaDoTicket) {
      filteredProducts = products.filter(product => {
        return product.suggestedPrice !== null 
          && product.suggestedPrice > 0 
          && product.averagePrice > product.suggestedPrice;
      });
    }

    // Ordenar produtos: quando filterByRegistrationDate está ativo, produtos sem venda vão para o final
    return filteredProducts.sort((a, b) => {
      if (filterByRegistrationDate) {
        // Produtos com venda primeiro (revenue > 0), depois produtos sem venda (revenue = 0)
        const aHasRevenue = a.totalRevenue > 0;
        const bHasRevenue = b.totalRevenue > 0;
        if (aHasRevenue !== bHasRevenue) {
          return aHasRevenue ? -1 : 1;
        }
      }
      // Ordenar por revenue descendente
      return b.totalRevenue - a.totalRevenue;
    });
  });
}

/**
 * Busca grupos disponíveis para NERD
 * Busca apenas grupos de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableGrupos({
  company,
  range,
  filial,
  linhas,
  colecoes,
  subgrupos,
  grades,
}: Omit<ProductsQueryParams, 'grupo'> & {
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
} = {}): Promise<string[]> {
  if (company === 'scarfme') {
    return withRequest(async (request) => {
      const { start, end } = resolveRange(range);
      request.input('startDate', sql.DateTime, start);
      request.input('endDate', sql.DateTime, end);

      const retailFilialFilter = await buildFilialFilter(
        request,
        company,
        'sales',
        filial,
        'f',
        'availableGruposRetailFilial'
      );
      const retailLinhaFilter = buildInFilter(request, linhas, 'availableGruposRetailLinha', 'p.LINHA');
      const retailColecaoFilter = buildInFilter(request, colecoes, 'availableGruposRetailColecao', 'p.COLECAO');
      const retailSubgrupoFilter = buildInFilter(request, subgrupos, 'availableGruposRetailSubgrupo', 'p.SUBGRUPO_PRODUTO');
      const retailGradeFilter = buildInFilter(request, grades, 'availableGruposRetailGrade', 'CONVERT(VARCHAR, p.GRADE)');

      const ecommerceFilialFilter = await buildScarfmeEcommerceFilialFilterForProducts(
        request,
        filial,
        'f',
        'availableGruposEcomFilial'
      );
      const ecommerceLinhaFilter = buildInFilter(request, linhas, 'availableGruposEcomLinha', 'p.LINHA');
      const ecommerceColecaoFilter = buildInFilter(request, colecoes, 'availableGruposEcomColecao', 'p.COLECAO');
      const ecommerceSubgrupoFilter = buildInFilter(request, subgrupos, 'availableGruposEcomSubgrupo', 'p.SUBGRUPO_PRODUTO');
      const ecommerceGradeFilter = buildInFilter(request, grades, 'availableGruposEcomGrade', 'CONVERT(VARCHAR, p.GRADE)');

      try {
        const retailResult = await request.query<{ grupo: string | null }>(`
          SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) AS grupo
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE_CANCELADA = 0
            AND vp.QTDE > 0
            AND ISNULL(p.GRUPO_PRODUTO, '') <> ''
            ${retailFilialFilter}
            ${retailLinhaFilter}
            ${retailColecaoFilter}
            ${retailSubgrupoFilter}
            ${retailGradeFilter}
          ORDER BY grupo
        `);
        const ecommerceResult = await request.query<{ grupo: string | null }>(`
          SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) AS grupo
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
          WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
            AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND fp.QTDE > 0
            AND ISNULL(p.GRUPO_PRODUTO, '') <> ''
            ${ecommerceFilialFilter}
            ${ecommerceLinhaFilter}
            ${ecommerceColecaoFilter}
            ${ecommerceSubgrupoFilter}
            ${ecommerceGradeFilter}
          ORDER BY grupo
        `);

        const grupos = [...retailResult.recordset, ...ecommerceResult.recordset]
          .map((row) => row.grupo?.trim().toUpperCase() || '')
          .filter((grupo) => grupo !== '');

        return [...new Set(grupos)].sort();
      } catch (error) {
        console.error('Erro ao buscar grupos (scarfme):', error);
        return [];
      }
    });
  }

  if (company !== 'nerd') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    // Aplicar filtros dependentes (apenas para ScarfMe, mas não aplicamos aqui pois é NERD)
    // Para NERD, não há filtros dependentes de outros campos

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '') AS grupo
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.GRUPO_PRODUTO, p.GRUPO_PRODUTO, '') <> ''
        ${filialFilter}
      ORDER BY grupo
    `;

    try {
      const result = await request.query<{ grupo: string }>(query);
      const grupos = result.recordset
        .map((row) => {
          const grupo = row.grupo?.trim() || '';
          return grupo.toUpperCase();
        })
        .filter((grupo) => grupo !== '');
      
      // Remover duplicatas após normalização
      const gruposUnicos = [...new Set(grupos)].sort();
      
      return gruposUnicos;
    } catch (error) {
      console.error('Erro ao buscar grupos:', error);
      return [];
    }
  });
}

/**
 * Busca linhas disponíveis para ScarfMe
 * Busca apenas linhas de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableLinhas({
  company,
  range,
  filial,
  colecoes,
  subgrupos,
  grades,
}: Omit<ProductsQueryParams, 'linha'> & {
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
} = {}): Promise<string[]> {
  // NERD: linhas disponíveis a partir das vendas do período/filial (mesma fonte
  // e padrão do path NERD de fetchAvailableGrupos). ScarfMe segue abaixo.
  if (company === 'nerd') {
    return withRequest(async (request) => {
      const { start, end } = resolveRange(range);
      request.input('startDate', sql.DateTime, start);
      request.input('endDate', sql.DateTime, end);

      const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');

      const query = `
        SELECT DISTINCT
          COALESCE(vp.LINHA, p.LINHA, '') AS linha
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          AND COALESCE(vp.LINHA, p.LINHA, '') <> ''
          ${filialFilter}
        ORDER BY linha
      `;

      try {
        const result = await request.query<{ linha: string }>(query);
        const linhas = result.recordset
          .map((row) => (row.linha?.trim() || '').toUpperCase())
          .filter((linha) => linha !== '');
        return [...new Set(linhas)].sort();
      } catch (error) {
        console.error('Erro ao buscar linhas (NERD):', error);
        return [];
      }
    });
  }

  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    const colecaoFilter = buildColecaoFilterForProducts(request, company, null, colecoes);
    const subgrupoFilter = buildSubgrupoFilterForProducts(request, company, null, subgrupos);
    const gradeFilter = buildGradeFilterForProducts(request, company, null, grades);

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.LINHA, p.LINHA, '') AS linha
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.LINHA, p.LINHA, '') <> ''
        ${filialFilter}
        ${colecaoFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      ORDER BY linha
    `;

    try {
      const result = await request.query<{ linha: string }>(query);
      const linhas = result.recordset
        .map((row) => {
          const linha = row.linha?.trim() || '';
          return linha.toUpperCase();
        })
        .filter((linha) => linha !== '');
      
      const linhasUnicas = [...new Set(linhas)].sort();
      
      return linhasUnicas;
    } catch (error) {
      console.error('Erro ao buscar linhas:', error);
      return [];
    }
  });
}

/**
 * Busca coleções disponíveis para ScarfMe
 * Busca apenas coleções de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableColecoes({
  company,
  range,
  filial,
  linhas,
  subgrupos,
  grades,
}: Omit<ProductsQueryParams, 'colecao'> & {
  linhas?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
} = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    const linhaFilter = buildLinhaFilterForProducts(request, company, null, linhas);
    const subgrupoFilter = buildSubgrupoFilterForProducts(request, company, null, subgrupos);
    const gradeFilter = buildGradeFilterForProducts(request, company, null, grades);

    const query = `
      SELECT DISTINCT 
        COALESCE(vp.COLECAO, p.COLECAO, '') AS colecao
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.COLECAO, p.COLECAO, '') <> ''
        ${filialFilter}
        ${linhaFilter}
        ${subgrupoFilter}
        ${gradeFilter}
      ORDER BY colecao
    `;

    try {
      const result = await request.query<{ colecao: string }>(query);
      const colecoes = result.recordset
        .map((row) => {
          const colecao = row.colecao?.trim() || '';
          return colecao.toUpperCase();
        })
        .filter((colecao) => colecao !== '');
      
      const colecoesUnicas = [...new Set(colecoes)].sort();
      
      return colecoesUnicas;
    } catch (error) {
      console.error('Erro ao buscar coleções:', error);
      return [];
    }
  });
}

export async function fetchAvailableColecoesWithDescriptions({
  company,
  range,
  filial,
  linhas,
  subgrupos,
  grades,
}: Omit<ProductsQueryParams, 'colecao'> & {
  linhas?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
} = {}): Promise<SelectOption[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const retailFilialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    const retailLinhaFilter = buildLinhaFilterForProducts(request, company, null, linhas);
    const retailSubgrupoFilter = buildSubgrupoFilterForProducts(request, company, null, subgrupos);
    const retailGradeFilter = buildGradeFilterForProducts(request, company, null, grades);

    const retailResult = await request.query<{ colecao: string | null }>(`
      SELECT DISTINCT
        UPPER(LTRIM(RTRIM(COALESCE(vp.COLECAO, p.COLECAO, '')))) AS colecao
      FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
      WHERE vp.DATA_VENDA >= @startDate
        AND vp.DATA_VENDA < @endDate
        AND vp.QTDE > 0
        AND COALESCE(vp.COLECAO, p.COLECAO, '') <> ''
        ${retailFilialFilter}
        ${retailLinhaFilter}
        ${retailSubgrupoFilter}
        ${retailGradeFilter}
      ORDER BY colecao
    `);

    const ecommerceFilialFilter = await buildScarfmeEcommerceFilialFilterForProducts(
      request,
      filial,
      'f',
      'availableColecoesEcomFilial'
    );
    const ecommerceLinhaFilter = buildInFilter(request, linhas, 'availableColecoesEcomLinha', 'p.LINHA');
    const ecommerceSubgrupoFilter = buildInFilter(
      request,
      subgrupos,
      'availableColecoesEcomSubgrupo',
      'p.SUBGRUPO_PRODUTO'
    );
    const ecommerceGradeFilter = buildInFilter(
      request,
      grades,
      'availableColecoesEcomGrade',
      'CONVERT(VARCHAR, p.GRADE)'
    );

    const ecommerceResult = await request.query<{ colecao: string | null; descricao: string | null }>(`
      SELECT
        UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) AS colecao,
        MAX(NULLIF(LTRIM(RTRIM(ISNULL(fp.DESC_COLECAO, ''))), '')) AS descricao
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
      WHERE f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND CAST(fp.QTDE AS FLOAT) > 0
        AND ISNULL(p.COLECAO, '') <> ''
        ${ecommerceFilialFilter}
        ${ecommerceLinhaFilter}
        ${ecommerceSubgrupoFilter}
        ${ecommerceGradeFilter}
      GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, ''))))
    `);

    // Descrição SEMPRE da tabela mestre COLECOES (ver [[colecao-fonte-mestre-COLECOES]]).
    // Antes o rótulo só ganhava descrição quando a coleção tinha venda de E-COMMERCE no
    // período e a linha do faturamento trazia DESC_COLECAO — no varejo o rótulo era o
    // código pelado ("Y7"). Por isso várias coleções apareciam sem nome nos inputs.
    // O faturamento continua como fallback (cobre código fora da COLECOES).
    const descByCode = await getColecaoDescMap().catch(() => new Map<string, string>());

    const codes = new Set<string>();
    const fallbackDesc = new Map<string, string>();

    retailResult.recordset.forEach((row) => {
      const value = row.colecao?.trim().toUpperCase() || '';
      if (value) codes.add(value);
    });

    ecommerceResult.recordset.forEach((row) => {
      const value = row.colecao?.trim().toUpperCase() || '';
      if (!value) return;
      codes.add(value);
      const descricao = row.descricao?.trim() || '';
      if (descricao && descricao.toUpperCase() !== value) fallbackDesc.set(value, descricao);
    });

    const labelByCollection = new Map<string, string>();
    codes.forEach((value) => {
      const descricao = (descByCode.get(value) || fallbackDesc.get(value) || '').trim();
      labelByCollection.set(
        value,
        descricao && descricao.toUpperCase() !== value ? `${descricao} (${value})` : value
      );
    });

    return Array.from(labelByCollection.entries())
      .sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'))
      .map(([value, label]) => ({ value, label }));
  });
}

/**
 * Busca subgrupos disponíveis para ScarfMe
 * Busca apenas subgrupos de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableSubgrupos({
  company,
  range,
  filial,
  linhas,
  colecoes,
  grades,
}: Omit<ProductsQueryParams, 'subgrupo'> & {
  linhas?: string[] | null;
  colecoes?: string[] | null;
  grades?: string[] | null;
} = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const retailFilialFilter = await buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'f',
      'availableSubgruposRetailFilial'
    );
    const retailLinhaFilter = buildInFilter(
      request,
      linhas,
      'availableSubgruposRetailLinha',
      'p.LINHA'
    );
    const retailColecaoFilter = buildInFilter(
      request,
      colecoes,
      'availableSubgruposRetailColecao',
      'p.COLECAO'
    );
    const retailGradeFilter = buildInFilter(
      request,
      grades,
      'availableSubgruposRetailGrade',
      'CONVERT(VARCHAR, p.GRADE)'
    );

    const ecommerceFilialFilter = await buildScarfmeEcommerceFilialFilterForProducts(
      request,
      filial,
      'f',
      'availableSubgruposEcomFilial'
    );
    const ecommerceLinhaFilter = buildInFilter(
      request,
      linhas,
      'availableSubgruposEcomLinha',
      'p.LINHA'
    );
    const ecommerceColecaoFilter = buildInFilter(
      request,
      colecoes,
      'availableSubgruposEcomColecao',
      'p.COLECAO'
    );
    const ecommerceGradeFilter = buildInFilter(
      request,
      grades,
      'availableSubgruposEcomGrade',
      'CONVERT(VARCHAR, p.GRADE)'
    );

    try {
      const retailResult = await request.query<{ subgrupo: string | null }>(`
          SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS subgrupo
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE_CANCELADA = 0
            AND vp.QTDE > 0
            AND ISNULL(p.SUBGRUPO_PRODUTO, '') <> ''
            ${retailFilialFilter}
            ${retailLinhaFilter}
            ${retailColecaoFilter}
            ${retailGradeFilter}
          ORDER BY subgrupo
        `);
      const ecommerceResult = await request.query<{ subgrupo: string | null }>(`
          SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) AS subgrupo
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
          WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
            AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND fp.QTDE > 0
            AND ISNULL(p.SUBGRUPO_PRODUTO, '') <> ''
            ${ecommerceFilialFilter}
            ${ecommerceLinhaFilter}
            ${ecommerceColecaoFilter}
            ${ecommerceGradeFilter}
          ORDER BY subgrupo
        `);

      const subgrupos = [...retailResult.recordset, ...ecommerceResult.recordset]
        .map((row) => row.subgrupo?.trim().toUpperCase() || '')
        .filter((subgrupo) => subgrupo !== '');
      
      const subgruposUnicos = [...new Set(subgrupos)].sort();
      
      return subgruposUnicos;
    } catch (error) {
      console.error('Erro ao buscar subgrupos:', error);
      return [];
    }
  });
}

/**
 * Busca grades disponíveis para ScarfMe
 * Busca apenas grades de produtos que tiveram vendas no período e filial selecionados
 */
export async function fetchAvailableGrades({
  company,
  range,
  filial,
  linhas,
  colecoes,
  subgrupos,
}: Omit<ProductsQueryParams, 'grade'> & {
  linhas?: string[] | null;
  colecoes?: string[] | null;
  subgrupos?: string[] | null;
} = {}): Promise<string[]> {
  if (company !== 'scarfme') {
    return [];
  }

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const retailFilialFilter = await buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'f',
      'availableGradesRetailFilial'
    );
    const retailLinhaFilter = buildInFilter(
      request,
      linhas,
      'availableGradesRetailLinha',
      'p.LINHA'
    );
    const retailColecaoFilter = buildInFilter(
      request,
      colecoes,
      'availableGradesRetailColecao',
      'p.COLECAO'
    );
    const retailSubgrupoFilter = buildInFilter(
      request,
      subgrupos,
      'availableGradesRetailSubgrupo',
      'p.SUBGRUPO_PRODUTO'
    );

    const ecommerceFilialFilter = await buildScarfmeEcommerceFilialFilterForProducts(
      request,
      filial,
      'f',
      'availableGradesEcomFilial'
    );
    const ecommerceLinhaFilter = buildInFilter(
      request,
      linhas,
      'availableGradesEcomLinha',
      'p.LINHA'
    );
    const ecommerceColecaoFilter = buildInFilter(
      request,
      colecoes,
      'availableGradesEcomColecao',
      'p.COLECAO'
    );
    const ecommerceSubgrupoFilter = buildInFilter(
      request,
      subgrupos,
      'availableGradesEcomSubgrupo',
      'p.SUBGRUPO_PRODUTO'
    );

    try {
      const retailResult = await request.query<{ grade: string | null }>(`
          SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS grade
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
          WHERE vp.DATA_VENDA >= @startDate
            AND vp.DATA_VENDA < @endDate
            AND vp.QTDE_CANCELADA = 0
            AND vp.QTDE > 0
            AND p.GRADE IS NOT NULL
            ${retailFilialFilter}
            ${retailLinhaFilter}
            ${retailColecaoFilter}
            ${retailSubgrupoFilter}
          ORDER BY grade
        `);
      const ecommerceResult = await request.query<{ grade: string | null }>(`
          SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS grade
          FROM FATURAMENTO f WITH (NOLOCK)
          JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
          LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
          WHERE CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
            AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND fp.QTDE > 0
            AND p.GRADE IS NOT NULL
            ${ecommerceFilialFilter}
            ${ecommerceLinhaFilter}
            ${ecommerceColecaoFilter}
            ${ecommerceSubgrupoFilter}
          ORDER BY grade
        `);

      const grades = [...retailResult.recordset, ...ecommerceResult.recordset]
        .map((row) => row.grade?.trim().toUpperCase() || '')
        .filter((grade) => grade !== '');
      
      const gradesUnicas = [...new Set(grades)].sort();

      return gradesUnicas;
    } catch (error) {
      console.error('Erro ao buscar grades:', error);
      return [];
    }
  });
}

/**
 * Tipos de produto (TIPO_PRODUTO) que tiveram venda no período/filial.
 * Usado como fonte de opções do filtro "Tipo" no Gerador de Relatórios.
 * Cobre as vendas de loja (varejo); para os fins do relatório isso é suficiente.
 */
export async function fetchAvailableTipos({
  company,
  range,
  filial,
}: Pick<ProductsQueryParams, 'company' | 'range' | 'filial'> = {}): Promise<string[]> {
  if (!company) return [];

  return withRequest(async (request) => {
    const { start, end } = resolveRange(range);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const filialFilter = await buildFilialFilter(
      request,
      company,
      'sales',
      filial,
      'f',
      'availableTiposFilial'
    );

    try {
      const result = await request.query<{ tipo: string | null }>(`
        SELECT DISTINCT
          UPPER(LTRIM(RTRIM(ISNULL(p.TIPO_PRODUTO, '')))) AS tipo
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
          ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
        WHERE vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE_CANCELADA = 0
          AND vp.QTDE > 0
          AND ISNULL(p.TIPO_PRODUTO, '') <> ''
          ${filialFilter}
        ORDER BY tipo
      `);

      return result.recordset
        .map((row) => row.tipo?.trim() ?? '')
        .filter(Boolean);
    } catch (error) {
      console.error('Erro ao buscar tipos:', error);
      return [];
    }
  });
}

/** Custo de reposição + preço sugerido por produto, direto da tabela mestre PRODUTOS. */
export interface ProdutoCustoPrecoMestre {
  /** CUSTO_REPOSICAO1 (custo de reposição atual do produto). */
  custo: number;
  /** PRECO_REPOSICAO_1 (preço de revenda sugerido); null quando ausente/zero. */
  precoSugerido: number | null;
}

/**
 * Busca custo e preço sugerido de produtos diretamente da tabela mestre PRODUTOS
 * (`CUSTO_REPOSICAO1` e `PRECO_REPOSICAO_1`), independente de venda. Esses dados
 * existem para todo produto cadastrado — por isso são usados em análises de estoque,
 * onde o custo/preço vindo das vendas zera para itens que não venderam no período.
 * Valores são por PRODUTO (a rede valoriza estoque no nível do produto, não da cor).
 * Faz busca em lotes (IN tem limite de parâmetros no SQL Server).
 */
export async function fetchProdutosCustoPrecoMestre(
  produtos: string[]
): Promise<Map<string, ProdutoCustoPrecoMestre>> {
  const ids = [...new Set(produtos.map((p) => (p ?? '').trim()).filter(Boolean))];
  const out = new Map<string, ProdutoCustoPrecoMestre>();
  if (ids.length === 0) return out;

  const CHUNK = 1000;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    await withRequest(async (request) => {
      chunk.forEach((id, i) => request.input(`cpm${i}`, sql.VarChar, id));
      const placeholders = chunk.map((_, i) => `@cpm${i}`).join(', ');
      const query = `
        SELECT
          p.PRODUTO AS produto,
          MAX(ISNULL(CAST(p.CUSTO_REPOSICAO1 AS DECIMAL(18, 2)), 0)) AS custo,
          MAX(CASE
            WHEN p.PRECO_REPOSICAO_1 IS NULL OR p.PRECO_REPOSICAO_1 = 0 THEN NULL
            ELSE CAST(p.PRECO_REPOSICAO_1 AS DECIMAL(18, 2))
          END) AS precoSugerido
        FROM PRODUTOS p WITH (NOLOCK)
        WHERE p.PRODUTO IN (${placeholders})
        GROUP BY p.PRODUTO
      `;
      const result = await request.query<{
        produto: string;
        custo: number | null;
        precoSugerido: number | null;
      }>(query);
      for (const r of result.recordset) {
        const produto = (r.produto ?? '').trim();
        if (!produto) continue;
        out.set(produto, {
          custo: Number(r.custo ?? 0) || 0,
          precoSugerido:
            r.precoSugerido != null && Number(r.precoSugerido) > 0 ? Number(r.precoSugerido) : null,
        });
      }
    });
  }

  return out;
}

/** Código de barra "menor" (interno) por produto×cor, vindo de PRODUTOS_BARRA. */
export interface CodigoBarraPorProdutoCor {
  produto: string;
  /** COR_PRODUTO bruto do ERP ('' quando sem cor). */
  cor: string;
  codigoBarra: string;
}

/**
 * Retorna o código de barra preferencial (o MENOR/interno, não o EAN grande) por
 * produto×cor. Replica o ranking canônico do export oficial (exportar_todos_relatorios.py):
 * TIPO_COD_BAR=3 → códigos curtos (<=8) → TIPO_COD_BAR=1 → resto; desempate por data e código.
 * Busca em lotes (IN tem limite de parâmetros no SQL Server).
 */
export async function fetchMenorCodigoBarra(
  produtos: string[]
): Promise<CodigoBarraPorProdutoCor[]> {
  const ids = [...new Set(produtos.map((p) => (p ?? '').trim()).filter(Boolean))];
  const out: CodigoBarraPorProdutoCor[] = [];
  if (ids.length === 0) return out;

  const CHUNK = 1000;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    await withRequest(async (request) => {
      chunk.forEach((id, i) => request.input(`cb${i}`, sql.VarChar, id));
      const placeholders = chunk.map((_, i) => `@cb${i}`).join(', ');
      const query = `
        ;WITH Ranked AS (
          SELECT
            LTRIM(RTRIM(pb.PRODUTO)) AS produto,
            ISNULL(LTRIM(RTRIM(pb.COR_PRODUTO)), '') AS cor,
            LTRIM(RTRIM(pb.CODIGO_BARRA)) AS codigoBarra,
            ROW_NUMBER() OVER (
              PARTITION BY pb.PRODUTO, ISNULL(pb.COR_PRODUTO, '')
              ORDER BY
                CASE
                  WHEN LTRIM(RTRIM(CAST(pb.TIPO_COD_BAR AS VARCHAR(10)))) = '3' THEN 0
                  WHEN LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) <= 8 THEN 1
                  WHEN LTRIM(RTRIM(CAST(pb.TIPO_COD_BAR AS VARCHAR(10)))) = '1' THEN 2
                  ELSE 3
                END,
                pb.DATA_PARA_TRANSFERENCIA DESC,
                pb.CODIGO_BARRA
            ) AS rn
          FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE ISNULL(pb.INATIVO, 0) = 0
            AND pb.CODIGO_BARRA IS NOT NULL
            AND LTRIM(RTRIM(pb.CODIGO_BARRA)) <> ''
            AND pb.PRODUTO IN (${placeholders})
        )
        SELECT produto, cor, codigoBarra
        FROM Ranked
        WHERE rn = 1
      `;
      const result = await request.query<{ produto: string; cor: string; codigoBarra: string }>(query);
      for (const r of result.recordset) {
        out.push({
          produto: (r.produto ?? '').trim(),
          cor: (r.cor ?? '').trim(),
          codigoBarra: (r.codigoBarra ?? '').trim(),
        });
      }
    });
  }

  return out;
}

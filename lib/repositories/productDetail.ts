import sql from 'mssql';

import { resolveCompany, isEcommerceFilial, getActiveFilial, type CompanyModule, VAREJO_VALUE } from '@/lib/config/company';
import { resolveCompanyLive, liveNameForIncoming } from '@/lib/server/company-live';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { withRequest } from '@/lib/db/connection';
import { RequestLike } from '@/lib/db/proxy';
import { eachDayOfInterval, subMilliseconds } from 'date-fns';

import { normalizeRangeForQuery, shiftRangeByMonths } from '@/lib/utils/date';
import { getColorDescription } from '@/lib/utils/colorMapping';

/**
 * Verifica se deve agregar dados de ecommerce para scarfme
 */
function shouldAggregateEcommerce(
  company: string | undefined,
  filial: string | null | undefined
): boolean {
  if (!company || filial !== null) {
    return false;
  }
  
  const companyConfig = resolveCompany(company);
  const isScarfme = company === 'scarfme';
  const hasEcommerce = (companyConfig?.ecommerceFilials?.length ?? 0) > 0;
  
  return isScarfme && hasEcommerce;
}

async function buildEcommerceFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  specificFilial?: string | null,
  tableAlias: string = 'f'
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

  // Se uma filial específica foi selecionada
  if (specificFilial) {
    request.input('ecommerceFilial', sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @ecommerceFilial`;
  }

  // Caso contrário, usar todas as filiais de e-commerce da empresa
  const ecommerceFilials = company.ecommerceFilials ?? [];
  
  if (ecommerceFilials.length === 0) {
    return '';
  }

  ecommerceFilials.forEach((filial, index) => {
    request.input(`ecommerceFilial${index}`, sql.VarChar, filial);
  });

  const placeholders = ecommerceFilials
    .map((_, index) => `@ecommerceFilial${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

async function buildFilialFilter(
  request: sql.Request | RequestLike,
  companySlug: string | undefined,
  module: CompanyModule,
  specificFilial?: string | null,
  tableAlias: string = 'vp',
  paramPrefix: string = 'filial'
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
    request.input(paramPrefix, sql.VarChar, specificFilial);
    return `AND ${tableAlias}.FILIAL = @${paramPrefix}`;
  }

  // Para scarfme: se for "VAREJO", mostrar apenas filiais normais (sem ecommerce)
  if (isScarfme && specificFilial === VAREJO_VALUE) {
    const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));
    
    if (normalFiliais.length === 0) {
      return '';
    }

    normalFiliais.forEach((filial, index) => {
      request.input(`${paramPrefix}${index}`, sql.VarChar, filial);
    });

    const placeholders = normalFiliais
      .map((_, index) => `@${paramPrefix}${index}`)
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
      request.input(`${paramPrefix}${index}`, sql.VarChar, filial);
    });

    const placeholders = allFiliais
      .map((_, index) => `@${paramPrefix}${index}`)
      .join(', ');

    return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
  }

  // Para outras empresas (ou comportamento padrão): usar apenas filiais normais (sem ecommerce)
  const normalFiliais = filiais.filter(f => !ecommerceFilials.includes(f));

  if (normalFiliais.length === 0) {
    return '';
  }

  normalFiliais.forEach((filial, index) => {
    request.input(`${paramPrefix}${index}`, sql.VarChar, filial);
  });

  const placeholders = normalFiliais
    .map((_, index) => `@${paramPrefix}${index}`)
    .join(', ');

  return `AND ${tableAlias}.FILIAL IN (${placeholders})`;
}

export interface ProductDetailInfo {
  productId: string;
  productName: string;
  /** Grade do produto (scarfme); ex.: P, M, G */
  grade?: string | null;
  /** Linha do produto (PRODUTOS.LINHA) — usada na regra de cobertura. */
  linha?: string | null;
  /** Subgrupo do produto (PRODUTOS.SUBGRUPO_PRODUTO) — usado na regra de cobertura. */
  subgrupo?: string | null;
  grupo?: string | null;
  tipoProduto?: string | null;
  colecao?: string | null;
  descColecao?: string | null;
  /** Data de cadastro do produto (PRODUTOS.DATA_CADASTRAMENTO). */
  registrationDate: Date | null;
  /**
   * Código de barras da variação (produto × cor). Só é preenchido quando UMA cor
   * está selecionada, pois o código de barras é por cor. null caso contrário.
   */
  barcode: string | null;
  lastEntryDate: Date | null;
  lastEntryFilial: string | null;
  totalRevenue: number;
  totalQuantity: number;
  totalStock: number;
  totalMarkup: number;
  averagePrice: number;
  averageCost: number;
  /** Custo cadastrado (PRODUTOS.CUSTO_REPOSICAO1) */
  registeredCost: number;
  /** Preço de venda cadastrado (PRODUTOS.PRECO_REPOSICAO_1) */
  registeredPrice: number;
  topFilial: string | null;
  topFilialDisplayName: string | null;
  topFilialRevenue: number;
  topColor: string | null;
  topColorCode: string | null;
  topColorDisplayName: string | null;
  topColorQuantity: number;
  topColorMarkup: number;
  revenueVariance: number | null;
}

export interface ProductStockByFilial {
  filial: string;
  filialDisplayName: string;
  activeFilialRaw?: string;
  stock: number;
  revenue: number;
  quantity: number;
  revenueVariance: number | null;
}

export interface ProductSaleHistory {
  date: Date;
  filial: string;
  filialDisplayName: string;
  quantity: number;
  revenue: number;
  /** Desconto concedido nessas vendas (R$). Soma de DESCONTO_VENDA; 0 no e-commerce. */
  desconto: number;
  vendedor: string | null;
  color: string | null;
  colorDisplayName: string | null;
}

const vendorAliasCache = new Map<string, string>();

/** Série diária: entradas, saídas (vendas + movimentações de estoque) e saldo estimado ao fim de cada dia. */
export interface ProductStockProgressDay {
  dateIso: string;
  entries: number;
  sales: number;
  /** Saídas de estoque não-venda no dia (transferências, etc. via ESTOQUE_PROD1_SAI), exceto ajustes. */
  stockExits: number;
  /** Ajuste de estoque líquido no dia (+entrada de ajuste, −saída de ajuste), reconhecido como no extrato (admin). */
  adjustments: number;
  /** true quando o saldo estimado ao fim do dia é zero ou negativo. */
  outOfStock: boolean;
  stockGeral: number;
  stockByFilial: Record<string, number>;
  entriesByFilial: { filialDisplayName: string; qty: number }[];
  salesByFilial: { filialDisplayName: string; qty: number }[];
  exitsByFilial: { filialDisplayName: string; qty: number }[];
  /** Ajustes por filial (qty com sinal: + entrada de ajuste, − saída de ajuste). */
  adjustmentsByFilial: { filialDisplayName: string; qty: number }[];
}

function toLocalIsoDay(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

type StockMovementRow = { d: Date; filial: string; qty: number };
/** Linha de movimento de estoque já classificada como ajuste ou não. */
type ClassifiedMovementRow = StockMovementRow & { ajuste: boolean };

/**
 * Reconhece "ajuste de estoque" a partir dos campos de tipo do romaneio, exatamente
 * como o extrato de produto (resolveLinxTipoMovimento em app/api/extrato-produto).
 * Apenas reclassifica movimentos já presentes em ESTOQUE_PROD_ENT/SAI — não soma novas fontes.
 */
function isAjusteMovimento(...candidates: Array<string | number | null | undefined>): boolean {
  const t = candidates
    .filter((v) => v != null && String(v).trim() !== '')
    .map((v) => String(v).trim().toUpperCase())
    .join(' | ');
  return (
    /AJUST/.test(t) ||
    /INVENT/.test(t) ||
    /ACERT/.test(t) ||
    /BALAN/.test(t) ||
    /CONTAG/.test(t) ||
    /AVULS/.test(t) ||
    /DEFEIT/.test(t) ||
    /MOV\.?\s*INTERNA/.test(t) ||
    /MOVIMENTA(C|Ç)(A|Ã)O\s+INTERNA/.test(t)
  );
}

type StockAggregationRow = {
  positiveStock?: number | null;
  negativeStock?: number | null;
  positiveCount?: number | null;
};

function mergeSalesDailyRows(a: StockMovementRow[], b: StockMovementRow[]): StockMovementRow[] {
  const map = new Map<string, number>();
  const add = (rows: StockMovementRow[]) => {
    for (const r of rows) {
      const iso = toLocalIsoDay(r.d);
      if (!iso) continue;
      const f = (r.filial || '').trim();
      const key = `${iso}\0${f}`;
      map.set(key, (map.get(key) ?? 0) + Number(r.qty ?? 0));
    }
  };
  add(a);
  add(b);
  return Array.from(map.entries()).map(([key, qty]) => {
    const [iso, filial] = key.split('\0');
    return { d: new Date(`${iso}T12:00:00`), filial, qty };
  });
}

function getDisplayedStock(row: StockAggregationRow): number {
  // Negativos NUNCA são contabilizados: estoque = soma só dos saldos positivos.
  const positiveStock = Number(row.positiveStock ?? 0);
  return Math.max(0, positiveStock);
}

function toNonNegativeStock(value: number): number {
  return value > 0 ? value : 0;
}

export interface ProductDetailParams {
  productId: string;
  company?: string;
  range?: {
    start?: string | Date;
    end?: string | Date;
  };
  filial?: string | null;
  /** Filtro por códigos de cor (COR_PRODUTO). Quando informado, restringe detalhe, estoque e vendas a essas cores. */
  colors?: string[];
}

export interface ProductAvailableColor {
  code: string;
  description: string;
  displayName: string;
}

/**
 * Retorna as cores disponíveis para o produto que tenham estoque positivo nas filiais da empresa.
 */
export async function fetchProductAvailableColors(
  productId: string,
  company?: string
): Promise<ProductAvailableColor[]> {
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    // A lista de cores precisa refletir todas as variações do produto.
    // Não restringimos por estoque positivo nem por filial para evitar perder cores válidas.
    const query = `
      WITH cores_produto AS (
        SELECT ISNULL(e.COR_PRODUTO, '') AS COR, '' AS DESC_ORIGEM
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.PRODUTO = @productId

        UNION

        SELECT ISNULL(vp.COR_PRODUTO, '') AS COR, ISNULL(vp.DESC_COR_PRODUTO, '') AS DESC_ORIGEM
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = @productId

        UNION

        SELECT ISNULL(fp.COR_PRODUTO, '') AS COR, '' AS DESC_ORIGEM
        FROM W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        WHERE fp.PRODUTO = @productId

        UNION

        SELECT ISNULL(pb.COR_PRODUTO, '') AS COR, '' AS DESC_ORIGEM
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO = @productId

        UNION

        SELECT ISNULL(pc.COR_PRODUTO, '') AS COR, ISNULL(pc.DESC_COR_PRODUTO, '') AS DESC_ORIGEM
        FROM PRODUTO_CORES pc WITH (NOLOCK)
        WHERE pc.PRODUTO = @productId
      )
      SELECT
        cp.COR,
        -- Descrição do CADASTRO DO PRODUTO (DESC_ORIGEM: PRODUTO_CORES / venda do
        -- próprio produto) tem prioridade; CORES_BASICAS (global) só como fallback,
        -- pois o mesmo código de cor descreve cores diferentes por produto.
        ISNULL(MAX(NULLIF(LTRIM(RTRIM(cp.DESC_ORIGEM)), '')), MAX(NULLIF(LTRIM(RTRIM(c.DESC_COR)), ''))) AS DESC_COR
      FROM cores_produto cp
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON cp.COR = c.COR
      GROUP BY cp.COR
    `;
    const result = await request.query<{ COR: string; DESC_COR: string }>(query);
    return buildColorList(result.recordset);
  });
}

export interface BarcodeResolution {
  codigoBarras: string;
  produto: string;
  /** Código da cor (COR_PRODUTO) que o código de barras representa. */
  corCodigo: string | null;
  /** Descrição/nome da cor (display). */
  corDescricao: string | null;
  /** Tamanho/grade da variação, quando houver. */
  tamanho: string | null;
  descricaoProduto: string | null;
}

/**
 * Resolve um CÓDIGO DE BARRAS para a variação exata (produto + cor + tamanho)
 * via PRODUTOS_BARRA. Um código de barras já identifica produto E cor juntos,
 * então isto devolve a chave necessária para consultar a ficha daquela variação.
 * Retorna null quando o código não existe.
 */
export async function resolveBarcode(codigoBarras: string): Promise<BarcodeResolution | null> {
  const code = (codigoBarras || '').trim();
  if (!code) return null;

  return withRequest(async (request) => {
    request.input('codigoBarras', sql.VarChar, code);
    const query = `
      SELECT TOP 1
        LTRIM(RTRIM(pb.CODIGO_BARRA)) AS codigoBarras,
        pb.PRODUTO AS produto,
        ISNULL(pb.COR_PRODUTO, '') AS corCodigo,
        -- Cor é escopada por PRODUTO: a descrição do cadastro do próprio produto
        -- (PRODUTO_CORES) manda; CORES_BASICAS (global) só como fallback.
        ISNULL(NULLIF(LTRIM(RTRIM(pc.DESC_COR_PRODUTO)), ''), ISNULL(c.DESC_COR, '')) AS corDescricao,
        ISNULL(CONVERT(VARCHAR, pb.TAMANHO), '') AS tamanho,
        ISNULL(p.DESC_PRODUTO, '') AS descricaoProduto
      FROM PRODUTOS_BARRA pb WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
      LEFT JOIN PRODUTO_CORES pc WITH (NOLOCK)
        ON pc.PRODUTO = pb.PRODUTO
        AND (RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(pb.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, pc.COR_PRODUTO) = TRY_CONVERT(INT, pb.COR_PRODUTO))
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = pb.COR_PRODUTO
      WHERE LTRIM(RTRIM(pb.CODIGO_BARRA)) = @codigoBarras
    `;
    const result = await request.query<{
      codigoBarras: string;
      produto: string;
      corCodigo: string;
      corDescricao: string;
      tamanho: string;
      descricaoProduto: string;
    }>(query);

    const row = result.recordset[0];
    if (!row || !(row.produto ?? '').trim()) return null;

    const corCodigo = (row.corCodigo ?? '').trim() || null;
    return {
      codigoBarras: (row.codigoBarras ?? '').trim() || code,
      produto: (row.produto ?? '').trim(),
      corCodigo,
      corDescricao:
        getColorDescription(corCodigo || undefined, row.corDescricao) ||
        (row.corDescricao ?? '').trim() ||
        null,
      tamanho: (row.tamanho ?? '').trim() || null,
      descricaoProduto: (row.descricaoProduto ?? '').trim() || null,
    };
  });
}

/** Ordem das cores principais (primeiras na lista). Comparação case-insensitive. */
const PRINCIPAL_COLORS_ORDER = [
  'preto',
  'branco',
  'off white',
  'marinho',
  'cinza',
  'nude',
  'bege',
  'camel',
  'creme',
  'natural',
  'azul marinho',
  'vermelho',
  'azul',
  'rosa',
  'verde',
  'amarelo',
  'laranja',
  'marrom',
  'dourado',
  'prata',
];

function buildColorList(recordset: { COR: string; DESC_COR: string }[]): ProductAvailableColor[] {
  const seen = new Set<string>();
  const list: ProductAvailableColor[] = [];
  for (const row of recordset) {
    const code = (row.COR ?? '').trim();
    if (seen.has(code)) continue;
    seen.add(code);
    const description = (row.DESC_COR ?? '').trim();
    const displayName = getColorDescription(code || undefined, description) || description || (code || 'Sem cor');
    list.push({ code: code || '', description, displayName });
  }
  const descriptionsWithCode = new Set(
    list
      .filter((item) => item.code && item.description)
      .map((item) => item.description.toUpperCase().trim())
  );
  const filtered = list.filter((item) => {
    if (item.code) return true;
    const descriptionKey = item.description.toUpperCase().trim();
    return !descriptionKey || !descriptionsWithCode.has(descriptionKey);
  });
  const norm = (s: string) => (s || '').toLowerCase().trim().replace(/-/g, ' ');
  return filtered.sort((a, b) => {
    const nameA = norm(a.displayName);
    const nameB = norm(b.displayName);
    const idxA = PRINCIPAL_COLORS_ORDER.findIndex((p) => nameA === p || nameA.startsWith(p + ' '));
    const idxB = PRINCIPAL_COLORS_ORDER.findIndex((p) => nameB === p || nameB.startsWith(p + ' '));
    if (idxA >= 0 && idxB >= 0) return idxA - idxB;
    if (idxA >= 0) return -1;
    if (idxB >= 0) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
}

async function resolveVendorAliasMap(
  request: sql.Request | RequestLike,
  codes: string[]
): Promise<Map<string, string>> {
  const uniqueCodes = [...new Set(codes.map((code) => String(code ?? '').trim()).filter(Boolean))];
  const aliases = new Map<string, string>();
  const missingCodes = uniqueCodes.filter((code) => !vendorAliasCache.has(code));

  if (missingCodes.length > 0) {
    missingCodes.forEach((code, index) => request.input(`vend${index}`, sql.VarChar, code));
    const inList = missingCodes.map((_, index) => `@vend${index}`).join(', ');
    const aliasQuery = `
      SELECT
        LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) AS codigo,
        LTRIM(RTRIM(ISNULL(VENDEDOR_APELIDO, ISNULL(NOME_VENDEDOR, VENDEDOR)))) AS apelido
      FROM LOJA_VENDEDORES WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST(VENDEDOR AS VARCHAR))) IN (${inList})
    `;
    const aliasResult = await request.query<{ codigo: string; apelido: string }>(aliasQuery);
    (aliasResult.recordset ?? []).forEach((row) => {
      const codigo = String(row.codigo ?? '').trim();
      const apelido = String(row.apelido ?? row.codigo ?? '').trim();
      if (codigo) {
        vendorAliasCache.set(codigo, apelido || codigo);
      }
    });
    missingCodes.forEach((code) => {
      if (!vendorAliasCache.has(code)) {
        vendorAliasCache.set(code, code);
      }
    });
  }

  uniqueCodes.forEach((code) => {
    aliases.set(code, vendorAliasCache.get(code) ?? code);
  });

  return aliases;
}

/** Adiciona parâmetros de cor ao request uma vez; retorna função que gera o fragmento SQL por alias. */
export interface UpdateProductColorParams {
  productId: string;
  currentCode: string;
  newCode: string;
  description: string;
}

export async function updateProductColorRegistration(
  params: UpdateProductColorParams
): Promise<{ code: string; description: string; updatedProductRows: number }> {
  const productId = String(params.productId ?? '').trim();
  const currentCode = String(params.currentCode ?? '').trim();
  const newCode = String(params.newCode ?? '').trim().toUpperCase();
  const description = String(params.description ?? '').trim().toUpperCase();

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('currentCode', sql.VarChar, currentCode);
    request.input('newCode', sql.VarChar, newCode);
    request.input('description', sql.VarChar, description);

    const query = `
      SET XACT_ABORT ON;
      BEGIN TRAN;

      IF EXISTS (
        SELECT 1
        FROM CORES_BASICAS WITH (UPDLOCK, HOLDLOCK)
        WHERE LTRIM(RTRIM(COR)) = @newCode
      )
      BEGIN
        UPDATE CORES_BASICAS
        SET DESC_COR = @description
        WHERE LTRIM(RTRIM(COR)) = @newCode;
      END
      ELSE
      BEGIN
        INSERT INTO CORES_BASICAS (COR, DESC_COR, USO_PRODUTOS, USO_MATERIAIS, GRUPO_CORES, COR_SORTIDA)
        VALUES (@newCode, @description, 1, 0, ' ', 0);
      END

      DECLARE @updatedBarra int = 0;
      DECLARE @updatedEstoque int = 0;
      DECLARE @updatedProdutoCores int = 0;

      IF @productId <> ''
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM PRODUTO_CORES WITH (UPDLOCK, HOLDLOCK)
          WHERE LTRIM(RTRIM(PRODUTO)) = @productId
            AND LTRIM(RTRIM(COR_PRODUTO)) = @newCode
        )
        BEGIN
          UPDATE PRODUTO_CORES
          SET DESC_COR_PRODUTO = @description,
              COR = @newCode
          WHERE LTRIM(RTRIM(PRODUTO)) = @productId
            AND LTRIM(RTRIM(COR_PRODUTO)) = @newCode;
          SET @updatedProdutoCores = @@ROWCOUNT;
        END
        ELSE
        BEGIN
          INSERT INTO PRODUTO_CORES (PRODUTO, COR_PRODUTO, DESC_COR_PRODUTO, COR)
          VALUES (@productId, @newCode, @description, @newCode);
          SET @updatedProdutoCores = @@ROWCOUNT;
        END
      END

      IF @productId <> '' AND @currentCode <> @newCode
      BEGIN
        UPDATE PRODUTOS_BARRA
        SET COR_PRODUTO = @newCode
        WHERE LTRIM(RTRIM(PRODUTO)) = @productId
          AND LTRIM(RTRIM(ISNULL(COR_PRODUTO, ''))) = @currentCode;
        SET @updatedBarra = @@ROWCOUNT;

        UPDATE ESTOQUE_PRODUTOS
        SET COR_PRODUTO = @newCode
        WHERE LTRIM(RTRIM(PRODUTO)) = @productId
          AND LTRIM(RTRIM(ISNULL(COR_PRODUTO, ''))) = @currentCode;
        SET @updatedEstoque = @@ROWCOUNT;
      END

      COMMIT;

      SELECT
        @newCode AS code,
        @description AS description,
        (@updatedProdutoCores + @updatedBarra + @updatedEstoque) AS updatedProductRows;
    `;

    const result = await request.query<{
      code: string;
      description: string;
      updatedProductRows: number;
    }>(query);

    const row = result.recordset[0];
    return {
      code: String(row?.code ?? newCode).trim(),
      description: String(row?.description ?? description).trim(),
      updatedProductRows: Number(row?.updatedProductRows ?? 0),
    };
  });
}

function buildColorFilter(
  request: sql.Request | RequestLike,
  colors: string[] | undefined
): (tableAlias: string) => string {
  if (!colors || colors.length === 0) return () => '';
  const hasEmpty = colors.some((c) => c === '' || c === null || c === undefined);
  const normalized = colors.filter((c) => c != null && c !== '').map((c) => String(c).trim());
  const allCodes = [...new Set(normalized)];
  allCodes.forEach((c, i) => {
    request.input(`colorFilter${i}`, sql.VarChar, c);
  });
  const placeholders = allCodes.map((_, i) => `@colorFilter${i}`).join(', ');
  return (tableAlias: string) => {
    if (allCodes.length === 0 && hasEmpty) {
      return `AND (${tableAlias}.COR_PRODUTO IS NULL OR ${tableAlias}.COR_PRODUTO = '')`;
    }
    if (allCodes.length === 0) return '';
    const inClause = `(${tableAlias}.COR_PRODUTO IN (${placeholders})`;
    if (hasEmpty) {
      return `AND (${inClause} OR ${tableAlias}.COR_PRODUTO IS NULL OR ${tableAlias}.COR_PRODUTO = '')`;
    }
    return `AND ${inClause})`;
  };
}

function resolveRange(range?: { start?: string | Date; end?: string | Date }) {
  return normalizeRangeForQuery({
    start: range?.start,
    end: range?.end,
  });
}

/**
 * Busca dados de ecommerce de um produto específico
 */
async function fetchProductDetailEcommerce({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<{
  totalRevenue: number;
  totalQuantity: number;
  previousRevenue: number;
  revenueByFilial: Map<string, number>;
  quantityByFilial: Map<string, number>;
  quantityByColor: Map<string, number>;
  revenueByColor: Map<string, number>;
}> {
  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const filialFilter = await buildEcommerceFilialFilter(request, company, filial, 'f');
    const colorFilterFp = buildColorFilter(request, colors)('fp');

    // Buscar vendas do período atual (com filtro de cor)
    const currentSalesQuery = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity,
        f.FILIAL,
        fp.COR_PRODUTO
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
        ${colorFilterFp}
      GROUP BY f.FILIAL, fp.COR_PRODUTO
    `;

    // Buscar vendas do período anterior (com filtro de cor)
    const previousSalesQuery = `
      SELECT 
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@previousStartDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@previousEndDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
        ${colorFilterFp}
      GROUP BY f.FILIAL
    `;

    const [currentSalesResult, previousSalesResult] = await Promise.all([
      request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        FILIAL: string;
        COR_PRODUTO: string | null;
      }>(currentSalesQuery),
      request.query<{
        totalRevenue: number | null;
        FILIAL: string;
      }>(previousSalesQuery),
    ]);

    let totalRevenue = 0;
    let totalQuantity = 0;
    let previousRevenue = 0;
    const revenueByFilial = new Map<string, number>();
    const quantityByFilial = new Map<string, number>();
    const quantityByColor = new Map<string, number>();
    const revenueByColor = new Map<string, number>();

    currentSalesResult.recordset.forEach((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const filial = (row.FILIAL || '').trim();
      const cor = row.COR_PRODUTO || 'SEM COR';

      totalRevenue += revenue;
      totalQuantity += quantity;

      revenueByFilial.set(filial, (revenueByFilial.get(filial) ?? 0) + revenue);
      quantityByFilial.set(filial, (quantityByFilial.get(filial) ?? 0) + quantity);
      quantityByColor.set(cor, (quantityByColor.get(cor) ?? 0) + quantity);
      revenueByColor.set(cor, (revenueByColor.get(cor) ?? 0) + revenue);
    });

    previousSalesResult.recordset.forEach((row) => {
      previousRevenue += Number(row.totalRevenue ?? 0);
    });

    return {
      totalRevenue,
      totalQuantity,
      previousRevenue,
      revenueByFilial,
      quantityByFilial,
      quantityByColor,
      revenueByColor,
    };
  });
}

/**
 * Busca dados detalhados de um produto específico
 */
export async function fetchProductDetail({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<ProductDetailInfo> {
  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductDetail({ productId, company, range, filial: VAREJO_VALUE, colors }),
      fetchProductDetailEcommerce({ productId, company, range, filial: null, colors }),
    ]);

    // Calcular previousRevenue do salesResult
    const salesPreviousRevenue = salesResult.revenueVariance !== null && salesResult.totalRevenue > 0
      ? salesResult.totalRevenue / (1 + salesResult.revenueVariance / 100)
      : 0;

    // Agregar dados
    const totalRevenue = salesResult.totalRevenue + ecommerceResult.totalRevenue;
    const totalQuantity = salesResult.totalQuantity + ecommerceResult.totalQuantity;
    const previousRevenue = salesPreviousRevenue + ecommerceResult.previousRevenue;

    // Agregar revenue por filial para encontrar topFilial
    const allRevenueByFilial = new Map(salesResult.topFilial ? [[salesResult.topFilial, salesResult.topFilialRevenue]] : []);
    ecommerceResult.revenueByFilial.forEach((revenue, filialName) => {
      allRevenueByFilial.set(filialName, (allRevenueByFilial.get(filialName) ?? 0) + revenue);
    });

    // Encontrar topFilial
    let topFilial: string | null = null;
    let topFilialDisplayName: string | null = null;
    let topFilialRevenue = 0;
    const companyConfig = await resolveCompanyLive(company);
    const displayNames = companyConfig?.filialDisplayNames ?? {};
    allRevenueByFilial.forEach((revenue, filialName) => {
      if (revenue > topFilialRevenue) {
        topFilialRevenue = revenue;
        topFilial = filialName;
        // Normalizar o nome da filial (trim) e aplicar mapeamento
        const normalizedFilial = filialName.trim();
        topFilialDisplayName = displayNames[normalizedFilial] ?? displayNames[filialName] ?? filialName;
      }
    });

    // Agregar quantity por cor
    const allQuantityByColor = new Map<string, number>();
    // Adicionar cores do salesResult (precisamos buscar isso de outra forma ou usar uma aproximação)
    // Por enquanto, vamos manter o topColor do salesResult, mas podemos melhorar isso depois

    const revenueVariance =
      previousRevenue === 0
        ? (totalRevenue > 0 ? null : 0)
        : Number((((totalRevenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

    // Recalcular média e markup
    const averageCost = salesResult.averageCost; // Usar o mesmo custo (ecommerce não tem custo detalhado)
    const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
    const totalMarkup = averageCost > 0 ? averagePrice / averageCost : 0;

    return {
      ...salesResult,
      totalRevenue,
      totalQuantity,
      totalMarkup,
      averagePrice,
      topFilial,
      topFilialDisplayName,
      topFilialRevenue,
      revenueVariance,
      registeredCost: salesResult.registeredCost,
      registeredPrice: salesResult.registeredPrice,
    };
  }

  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    const colorFilter = buildColorFilter(request, colors);
    const colorFilterVp = colorFilter('vp');
    const colorFilterE = colorFilter('e');

    // Buscar dados básicos do produto, última entrada e preço/custo cadastrados
    const productQuery = `
      SELECT TOP 1
        p.PRODUTO AS productId,
        p.DESC_PRODUTO AS productName,
        ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS grade,
        ISNULL(p.LINHA, '') AS linha,
        ISNULL(p.SUBGRUPO_PRODUTO, '') AS subgrupo,
        ISNULL(p.GRUPO_PRODUTO, '') AS grupo,
        ISNULL(p.TIPO_PRODUTO, '') AS tipoProduto,
        ISNULL(p.COLECAO, '') AS colecao,
        ISNULL(col.DESC_COLECAO, '') AS descColecao,
        ISNULL(p.CUSTO_REPOSICAO1, 0) AS registeredCost,
        ISNULL(p.PRECO_REPOSICAO_1, 0) AS registeredPrice,
        p.DATA_CADASTRAMENTO AS registrationDate,
        (
          SELECT TOP 1
            E.EMISSAO
          FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_ENT AS P1 WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P1.ROMANEIO_PRODUTO
          WHERE P1.PRODUTO = @productId
          ORDER BY E.EMISSAO DESC
        ) AS lastEntryDate,
        (
          SELECT TOP 1
            E.FILIAL
          FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
          LEFT JOIN ESTOQUE_PROD1_ENT AS P1 WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P1.ROMANEIO_PRODUTO
          WHERE P1.PRODUTO = @productId
          ORDER BY E.EMISSAO DESC
        ) AS lastEntryFilial
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN COLECOES col WITH (NOLOCK) ON col.COLECAO = p.COLECAO
      WHERE p.PRODUTO = @productId
    `;

    const productResult = await request.query<{
      productId: string;
      productName: string | null;
      grade: string | null;
      linha: string | null;
      subgrupo: string | null;
      grupo: string | null;
      tipoProduto: string | null;
      colecao: string | null;
      descColecao: string | null;
      registeredCost: number;
      registeredPrice: number;
      registrationDate: Date | null;
      lastEntryDate: Date | null;
      lastEntryFilial: string | null;
    }>(productQuery);

    const productRow = productResult.recordset[0] ?? {
      productId,
      productName: null,
      grade: null,
      linha: null,
      subgrupo: null,
      grupo: null,
      tipoProduto: null,
      colecao: null,
      descColecao: null,
      registeredCost: 0,
      registeredPrice: 0,
      registrationDate: null,
      lastEntryDate: null,
      lastEntryFilial: null,
    };

    const companyConfig = await resolveCompanyLive(company);
    const displayNames = companyConfig?.filialDisplayNames ?? {};

    // Buscar vendas do período atual
    const currentSalesQuery = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          c.DESC_COR,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT 
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(QTDE) AS QTDE_TROCA,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT 
          *,
          ISNULL(QTDE_TROCA_ITEM, 0) AS QTDE_TROCA,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT 
        SUM(TOTAL_VENDA - VALOR_TROCA) AS totalRevenue,
        SUM(TOTAL_QTDE_VENDA - QTDE_TROCA) AS totalQuantity,
        FILIAL,
        COR_PRODUTO,
        -- Descrição da cor do CADASTRO DO PRODUTO (DESC_COR_PRODUTO da venda) manda;
        -- CORES_BASICAS (DESC_COR, global) só como fallback.
        ISNULL(NULLIF(LTRIM(RTRIM(DESC_COR_PRODUTO)), ''), ISNULL(DESC_COR, '')) AS corBanco,
        AVG(
          CASE
            WHEN QTDE_CANCELADA > 0 THEN NULL
            ELSE CUSTO
          END
        ) AS cost
      FROM vendas_finais
      GROUP BY FILIAL, COR_PRODUTO, ISNULL(NULLIF(LTRIM(RTRIM(DESC_COR_PRODUTO)), ''), ISNULL(DESC_COR, ''))
    `;

    // Buscar vendas do período anterior
    const previousSalesQuery = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @previousStartDate
          AND vp.DATA_VENDA < @previousEndDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT 
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT 
          *,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT 
        SUM(TOTAL_VENDA - VALOR_TROCA) AS totalRevenue
      FROM vendas_finais
      GROUP BY FILIAL
    `;

    // Buscar estoque por filial
    const stockQuery = `
      SELECT 
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
      ${colorFilterE}
      GROUP BY e.FILIAL
    `;

    const [currentSalesResult, previousSalesResult, stockResult] = await Promise.all([
      request.query<{
        totalRevenue: number | null;
        totalQuantity: number | null;
        FILIAL: string;
        COR_PRODUTO: string | null;
        corBanco: string;
        cost: number | null;
      }>(currentSalesQuery),
      request.query<{
        totalRevenue: number | null;
        FILIAL: string;
      }>(previousSalesQuery),
      request.query<{
        FILIAL: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(stockQuery),
    ]);

    // Calcular totais
    let totalRevenue = 0;
    let totalQuantity = 0;
    let previousRevenue = 0;
    let totalCostWeighted = 0; // Custo total ponderado por quantidade

    const revenueByFilial = new Map<string, number>();
    const quantityByFilial = new Map<string, number>();
    const quantityByColor = new Map<string, number>();
    const revenueByColor = new Map<string, number>();
    const costByColor = new Map<string, number>();
    const colorCodeMap = new Map<string, string>(); // Map cor -> código
    const colorDescMap = new Map<string, string>(); // Map cor -> descrição

    currentSalesResult.recordset.forEach((row) => {
      const revenue = Number(row.totalRevenue ?? 0);
      const quantity = Number(row.totalQuantity ?? 0);
      const filial = row.FILIAL;
      const cor = row.COR_PRODUTO || 'SEM COR';

      totalRevenue += revenue;
      totalQuantity += quantity;

      revenueByFilial.set(filial, (revenueByFilial.get(filial) ?? 0) + revenue);
      quantityByFilial.set(filial, (quantityByFilial.get(filial) ?? 0) + quantity);
      quantityByColor.set(cor, (quantityByColor.get(cor) ?? 0) + quantity);
      revenueByColor.set(cor, (revenueByColor.get(cor) ?? 0) + revenue);
      
      if (row.cost) {
        const cost = Number(row.cost);
        costByColor.set(cor, cost);
        totalCostWeighted += cost * quantity; // Acumular custo ponderado
      }

      // Armazenar código e descrição da cor
      if (row.COR_PRODUTO) {
        colorCodeMap.set(cor, row.COR_PRODUTO);
        const colorDesc = getColorDescription(row.COR_PRODUTO, row.corBanco);
        colorDescMap.set(cor, colorDesc);
      }
    });

    previousSalesResult.recordset.forEach((row) => {
      previousRevenue += Number(row.totalRevenue ?? 0);
    });

    // Encontrar loja top
    let topFilial: string | null = null;
    let topFilialDisplayName: string | null = null;
    let topFilialRevenue = 0;
    revenueByFilial.forEach((revenue, filial) => {
      if (revenue > topFilialRevenue) {
        topFilialRevenue = revenue;
        topFilial = filial;
        // Normalizar o nome da filial (trim) e aplicar mapeamento
        const normalizedFilial = filial.trim();
        topFilialDisplayName = displayNames[normalizedFilial] ?? displayNames[filial] ?? filial;
      }
    });

    // Encontrar cor mais vendida
    let topColor: string | null = null;
    let topColorCode: string | null = null;
    let topColorDisplayName: string | null = null;
    let topColorQuantity = 0;
    let topColorMarkup = 0;

    quantityByColor.forEach((quantity, color) => {
      if (quantity > topColorQuantity && color !== 'SEM COR') {
        topColorQuantity = quantity;
        topColor = color;
        topColorCode = colorCodeMap.get(color) ?? null;
        topColorDisplayName = colorDescMap.get(color) ?? null;
        const revenue = revenueByColor.get(color) ?? 0;
        const cost = costByColor.get(color) ?? 0;
        topColorMarkup = cost > 0 ? revenue / quantity / cost : 0;
      }
    });

    // Calcular estoque total
    let totalStock = 0;
    stockResult.recordset.forEach((row) => {
      totalStock += toNonNegativeStock(getDisplayedStock(row));
    });

    // Calcular variação de receita
    const revenueVariance =
      previousRevenue === 0
        ? (totalRevenue > 0 ? null : 0)
        : Number((((totalRevenue - previousRevenue) / previousRevenue) * 100).toFixed(1));

    // Calcular markup: preferir cadastrado (registeredPrice/registeredCost) quando ambos > 0
    const registeredCost = Number(productRow.registeredCost ?? 0);
    const registeredPrice = Number(productRow.registeredPrice ?? 0);
    const averageCost = totalQuantity > 0 ? totalCostWeighted / totalQuantity : 0;
    const averagePrice = totalQuantity > 0 ? totalRevenue / totalQuantity : 0;
    const totalMarkup =
      registeredCost > 0 && registeredPrice > 0
        ? registeredPrice / registeredCost
        : averageCost > 0
          ? averagePrice / averageCost
          : 0;

    // Converter lastEntryDate para Date se existir
    let lastEntryDate: Date | null = null;
    if (productRow.lastEntryDate) {
      lastEntryDate = productRow.lastEntryDate instanceof Date
        ? productRow.lastEntryDate
        : new Date(productRow.lastEntryDate);
    }

    // Converter registrationDate para Date se existir
    let registrationDate: Date | null = null;
    if (productRow.registrationDate) {
      registrationDate = productRow.registrationDate instanceof Date
        ? productRow.registrationDate
        : new Date(productRow.registrationDate);
    }

    // Aplicar mapeamento para lastEntryFilial
    const lastEntryFilialDisplayName = productRow.lastEntryFilial
      ? (displayNames[productRow.lastEntryFilial] ?? productRow.lastEntryFilial)
      : null;

    // Código de barras (produto × cor): só faz sentido com UMA cor selecionada,
    // pois cada cor tem o seu. Mesma regra de "menor código" do export (não EAN).
    let barcode: string | null = null;
    const singleColor =
      colors && colors.length === 1 ? String(colors[0] ?? '').trim() : null;
    if (singleColor !== null) {
      request.input('barcodeCor', sql.VarChar, singleColor);
      const barcodeQuery = `
        SELECT TOP 1 LTRIM(RTRIM(pb.CODIGO_BARRA)) AS codigoBarra
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE ISNULL(pb.INATIVO, 0) = 0
          AND pb.CODIGO_BARRA IS NOT NULL
          AND LTRIM(RTRIM(pb.CODIGO_BARRA)) <> ''
          AND pb.PRODUTO = @productId
          AND (
            LTRIM(RTRIM(ISNULL(pb.COR_PRODUTO, ''))) = @barcodeCor
            OR TRY_CONVERT(INT, pb.COR_PRODUTO) = TRY_CONVERT(INT, @barcodeCor)
          )
        ORDER BY
          CASE
            WHEN LTRIM(RTRIM(CAST(pb.TIPO_COD_BAR AS VARCHAR(10)))) = '3' THEN 0
            WHEN LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) <= 8 THEN 1
            WHEN LTRIM(RTRIM(CAST(pb.TIPO_COD_BAR AS VARCHAR(10)))) = '1' THEN 2
            ELSE 3
          END,
          pb.DATA_PARA_TRANSFERENCIA DESC,
          pb.CODIGO_BARRA
      `;
      const barcodeResult = await request.query<{ codigoBarra: string }>(barcodeQuery);
      barcode = (barcodeResult.recordset[0]?.codigoBarra ?? '').trim() || null;
    }

    return {
      productId: productRow.productId,
      productName: productRow.productName || 'Produto não encontrado',
      grade: (productRow.grade ?? '').trim() || null,
      linha: (productRow.linha ?? '').trim() || null,
      subgrupo: (productRow.subgrupo ?? '').trim() || null,
      grupo: (productRow.grupo ?? '').trim() || null,
      tipoProduto: (productRow.tipoProduto ?? '').trim() || null,
      colecao: (productRow.colecao ?? '').trim() || null,
      descColecao: (productRow.descColecao ?? '').trim() || null,
      registrationDate,
      barcode,
      lastEntryDate,
      lastEntryFilial: lastEntryFilialDisplayName,
      totalRevenue,
      totalQuantity,
      totalStock,
      totalMarkup,
      averagePrice,
      averageCost,
      registeredCost,
      registeredPrice,
      topFilial,
      topFilialDisplayName,
      topFilialRevenue,
      topColor,
      topColorCode,
      topColorDisplayName,
      topColorQuantity,
      topColorMarkup,
      revenueVariance,
    };
  });
}

/**
 * Busca estoque e vendas por filial de um produto (apenas ecommerce)
 */
async function fetchProductStockByFilialEcommerce({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<ProductStockByFilial[]> {
  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const companyConfig = await resolveCompanyLive(company);
    if (!companyConfig) {
      return [];
    }

    const colorFilter = buildColorFilter(request, colors);
    const colorFilterE = colorFilter('e');
    const colorFilterFp = colorFilter('fp');

    // Construir o filtro de filiais de ecommerce uma vez e reutilizar
    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
    let estoqueFilialFilter = '';
    let vendasFilialFilter = '';
    
    if (filial) {
      request.input('ecommerceFilial', sql.VarChar, filial);
      estoqueFilialFilter = `AND e.FILIAL = @ecommerceFilial`;
      vendasFilialFilter = `AND f.FILIAL = @ecommerceFilial`;
    } else if (ecommerceFilials.length > 0) {
      ecommerceFilials.forEach((filialName, index) => {
        request.input(`ecommerceFilial${index}`, sql.VarChar, filialName);
      });
      const placeholders = ecommerceFilials
        .map((_, index) => `@ecommerceFilial${index}`)
        .join(', ');
      estoqueFilialFilter = `AND e.FILIAL IN (${placeholders})`;
      vendasFilialFilter = `AND f.FILIAL IN (${placeholders})`;
    }

    // Buscar estoque por filial (com filtro de cor)
    const stockQuery = `
      SELECT 
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
        ${estoqueFilialFilter}
        ${colorFilterE}
      GROUP BY e.FILIAL
    `;

    // Buscar vendas por filial - período atual (com filtro de cor)
    const currentSalesQuery = `
      SELECT 
        f.FILIAL,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
        SUM(fp.QTDE) AS totalQuantity
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${vendasFilialFilter}
        ${colorFilterFp}
      GROUP BY f.FILIAL
    `;

    // Buscar vendas por filial - período anterior (com filtro de cor)
    const previousSalesQuery = `
      SELECT 
        f.FILIAL,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@previousStartDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@previousEndDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${vendasFilialFilter}
        ${colorFilterFp}
      GROUP BY f.FILIAL
    `;

    const [stockResult, currentSalesResult, previousSalesResult] = await Promise.all([
      request.query<{
        FILIAL: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(stockQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
        totalQuantity: number | null;
      }>(currentSalesQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
      }>(previousSalesQuery),
    ]);

    // Criar mapas
    const stockMap = new Map<string, number>();
    stockResult.recordset.forEach((row) => {
      stockMap.set(row.FILIAL, getDisplayedStock(row));
    });

    const currentRevenueMap = new Map<string, number>();
    const currentQuantityMap = new Map<string, number>();
    currentSalesResult.recordset.forEach((row) => {
      currentRevenueMap.set(row.FILIAL, Number(row.totalRevenue ?? 0));
      currentQuantityMap.set(row.FILIAL, Number(row.totalQuantity ?? 0));
    });

    const previousRevenueMap = new Map<string, number>();
    previousSalesResult.recordset.forEach((row) => {
      previousRevenueMap.set(row.FILIAL, Number(row.totalRevenue ?? 0));
    });

    // Obter todas as filiais únicas
    const allFiliais = new Set<string>();
    stockMap.forEach((_, filial) => allFiliais.add(filial));
    currentRevenueMap.forEach((_, filial) => allFiliais.add(filial));

    const displayNames = companyConfig.filialDisplayNames ?? {};
    const aggByDisplayName = new Map<string, { stock: number; revenue: number; quantity: number; previousRevenue: number }>();

    allFiliais.forEach((filial) => {
      const normalizedFilial = filial.trim();
      const filialDisplayName = displayNames[normalizedFilial] ?? displayNames[filial] ?? filial;
      const existing = aggByDisplayName.get(filialDisplayName) ?? { stock: 0, revenue: 0, quantity: 0, previousRevenue: 0 };
      existing.stock += stockMap.get(filial) ?? 0;
      existing.revenue += currentRevenueMap.get(filial) ?? 0;
      existing.quantity += currentQuantityMap.get(filial) ?? 0;
      existing.previousRevenue += previousRevenueMap.get(filial) ?? 0;
      aggByDisplayName.set(filialDisplayName, existing);
    });

    const result: ProductStockByFilial[] = [];
    aggByDisplayName.forEach((agg, filialDisplayName) => {
      const revenueVariance =
        agg.previousRevenue === 0
          ? (agg.revenue > 0 ? null : 0)
          : Number((((agg.revenue - agg.previousRevenue) / agg.previousRevenue) * 100).toFixed(1));
      result.push({
        filial: filialDisplayName,
        filialDisplayName,
        stock: agg.stock,
        revenue: agg.revenue,
        quantity: agg.quantity,
        revenueVariance,
      });
    });

    return result.sort((a, b) => b.revenue - a.revenue);
  });
}

/**
 * Busca estoque e vendas por filial de um produto
 */
export async function fetchProductStockByFilial({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<ProductStockByFilial[]> {
  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductStockByFilial({ productId, company, range, filial: VAREJO_VALUE, colors }),
      fetchProductStockByFilialEcommerce({ productId, company, range, filial: null, colors }),
    ]);

    const companyConfig = await resolveCompanyLive(company);
    const ecommerceFilials = companyConfig?.ecommerceFilials ?? [];
    
    // Agregar por filial - usar nome normalizado (trim) como chave para evitar duplicatas
    const filialMap = new Map<string, ProductStockByFilial>();
    
    // Adicionar resultados de vendas normais, excluindo filiais de e-commerce
    salesResult.forEach((item) => {
      const normalizedFilial = (item.filial || '').trim();
      // Excluir filiais de e-commerce do resultado de vendas normais
      if (!ecommerceFilials.includes(normalizedFilial) && !ecommerceFilials.includes(item.filial)) {
        filialMap.set(normalizedFilial, { ...item, filial: normalizedFilial });
      }
    });

    // Adicionar resultados de e-commerce
    ecommerceResult.forEach((item) => {
      const normalizedFilial = (item.filial || '').trim();
      const existing = filialMap.get(normalizedFilial);
      if (existing) {
        existing.revenue += item.revenue;
        existing.quantity += item.quantity;
        // Adicionar estoque do ecommerce ao estoque existente
        existing.stock += item.stock;
        // Garantir que o filialDisplayName está mapeado corretamente
        existing.filialDisplayName = item.filialDisplayName;
        // Recalcular revenueVariance
        const previousRevenue = existing.revenueVariance !== null && existing.revenue > 0
          ? existing.revenue / (1 + existing.revenueVariance / 100)
          : 0;
        const itemPreviousRevenue = item.revenueVariance !== null && item.revenue > 0
          ? item.revenue / (1 + item.revenueVariance / 100)
          : 0;
        const totalPreviousRevenue = previousRevenue + itemPreviousRevenue;
        existing.revenueVariance =
          totalPreviousRevenue === 0
            ? (existing.revenue > 0 ? null : 0)
            : Number((((existing.revenue - totalPreviousRevenue) / totalPreviousRevenue) * 100).toFixed(1));
      } else {
        filialMap.set(normalizedFilial, { ...item, filial: normalizedFilial });
      }
    });

    return Array.from(filialMap.values()).sort((a, b) => b.revenue - a.revenue);
  }

  const { start, end } = resolveRange(range);
  const previousRange = shiftRangeByMonths({ start, end }, -1);

  // Usa config dinâmica para respeitar a filial ativa definida no admin (Grupos de Filiais)
  const companyConfig = await resolveCompanyDynamic(company);
  if (!companyConfig) return [];

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    request.input('previousStartDate', sql.DateTime, previousRange.start);
    request.input('previousEndDate', sql.DateTime, previousRange.end);

    const colorFilter = buildColorFilter(request, colors);
    const colorFilterVp = colorFilter('vp');
    const colorFilterE = colorFilter('e');

    // Buscar estoque por filial - buscar de todas as filiais e filtrar depois
    // Isso garante que encontramos estoque mesmo se o nome da filial no banco não corresponder exatamente
    const stockQuery = `
      SELECT 
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
        SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
        COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO = @productId
      ${colorFilterE}
      GROUP BY e.FILIAL
    `;

    // Buscar vendas por filial - período atual
    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp', 'vendasFilial');
    const currentSalesQuery = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT 
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(QTDE) AS QTDE_TROCA,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT 
          *,
          ISNULL(QTDE_TROCA_ITEM, 0) AS QTDE_TROCA,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT 
        FILIAL,
        SUM(TOTAL_VENDA - VALOR_TROCA) AS totalRevenue,
        SUM(TOTAL_QTDE_VENDA - QTDE_TROCA) AS totalQuantity
      FROM vendas_finais
      GROUP BY FILIAL
    `;

    // Buscar vendas por filial - período anterior
    const previousSalesQuery = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @previousStartDate
          AND vp.DATA_VENDA < @previousEndDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT 
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT 
          *,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT 
        FILIAL,
        SUM(TOTAL_VENDA - VALOR_TROCA) AS totalRevenue
      FROM vendas_finais
      GROUP BY FILIAL
    `;

    const [stockResult, currentSalesResult, previousSalesResult] = await Promise.all([
      request.query<{
        FILIAL: string;
        positiveStock: number | null;
        negativeStock: number | null;
        positiveCount: number | null;
      }>(stockQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
        totalQuantity: number | null;
      }>(currentSalesQuery),
      request.query<{
        FILIAL: string;
        totalRevenue: number | null;
      }>(previousSalesQuery),
    ]);

    // Criar mapas - normalizar nomes das filiais (trim) para garantir correspondência
    const stockMap = new Map<string, number>();
    stockResult.recordset.forEach((row) => {
      const normalizedFilial = (row.FILIAL || '').trim();
      stockMap.set(normalizedFilial, getDisplayedStock(row));
    });

    const currentRevenueMap = new Map<string, number>();
    const currentQuantityMap = new Map<string, number>();
    currentSalesResult.recordset.forEach((row) => {
      const normalizedFilial = (row.FILIAL || '').trim();
      currentRevenueMap.set(normalizedFilial, Number(row.totalRevenue ?? 0));
      currentQuantityMap.set(normalizedFilial, Number(row.totalQuantity ?? 0));
    });

    const previousRevenueMap = new Map<string, number>();
    previousSalesResult.recordset.forEach((row) => {
      const normalizedFilial = (row.FILIAL || '').trim();
      previousRevenueMap.set(normalizedFilial, Number(row.totalRevenue ?? 0));
    });

    // Obter todas as filiais únicas
    const allFiliais = new Set<string>();
    stockMap.forEach((_, filial) => allFiliais.add(filial));
    currentRevenueMap.forEach((_, filial) => allFiliais.add(filial));

    const displayNames = companyConfig.filialDisplayNames ?? {};
    // Usar filiais de inventory para incluir todas as filiais da empresa (incluindo matriz)
    const filiais = companyConfig.filialFilters['inventory'] ?? [];
    const normalizedFiliais = filiais.map(f => f.trim());
    const ecommerceFilials = companyConfig.ecommerceFilials ?? [];
    const normalizedEcommerceFilials = ecommerceFilials.map(f => f.trim());

    // Agregar por filialDisplayName para não repetir a mesma filial (ex.: vários códigos → "E-COMMERCE")
    const aggByDisplayName = new Map<string, { stock: number; revenue: number; quantity: number; previousRevenue: number; activeFilialRaw?: string }>();

    allFiliais.forEach((filialName) => {
      if (!normalizedFiliais.includes(filialName)) return;
      if (filial === VAREJO_VALUE && normalizedEcommerceFilials.includes(filialName)) return;

      const filialDisplayName = displayNames[filialName] ?? filialName;
      const existing = aggByDisplayName.get(filialDisplayName) ?? { stock: 0, revenue: 0, quantity: 0, previousRevenue: 0 };

      // Estoque: usa somente a filial ativa do grupo (evita somar saldos de CNPJs antigos/inativos)
      const activeFilialForStock = getActiveFilial(companyConfig, filialName);
      const isActiveFilial = activeFilialForStock.trim().toUpperCase() === filialName.trim().toUpperCase();
      if (isActiveFilial) {
        existing.stock += Math.max(0, stockMap.get(filialName) ?? 0);
        // Só expõe o código da filial ativa se a filial pertence a um grupo com múltiplos membros
        const groupMembers = Object.values(companyConfig.filialGroups ?? {}).find((members) =>
          members.some((m) => m.trim().toUpperCase() === filialName.trim().toUpperCase())
        );
        if (groupMembers && groupMembers.length > 1) {
          existing.activeFilialRaw = filialName;
        }
      }

      // Vendas: soma todas as entidades do grupo (histórico completo)
      existing.revenue += currentRevenueMap.get(filialName) ?? 0;
      existing.quantity += currentQuantityMap.get(filialName) ?? 0;
      existing.previousRevenue += previousRevenueMap.get(filialName) ?? 0;
      aggByDisplayName.set(filialDisplayName, existing);
    });

    const result: ProductStockByFilial[] = [];
    aggByDisplayName.forEach((agg, filialDisplayName) => {
      const revenueVariance =
        agg.previousRevenue === 0
          ? (agg.revenue > 0 ? null : 0)
          : Number((((agg.revenue - agg.previousRevenue) / agg.previousRevenue) * 100).toFixed(1));
      result.push({
        filial: filialDisplayName,
        filialDisplayName,
        activeFilialRaw: agg.activeFilialRaw,
        stock: agg.stock,
        revenue: agg.revenue,
        quantity: agg.quantity,
        revenueVariance,
      });
    });

    // Ordenar por revenue (maior primeiro)
    return result.sort((a, b) => b.revenue - a.revenue);
  });
}

/**
 * Busca histórico de vendas de um produto (apenas ecommerce)
 */
async function fetchProductSaleHistoryEcommerce({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<ProductSaleHistory[]> {
  const { start, end } = resolveRange(range);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const companyConfig = await resolveCompanyLive(company);
    if (!companyConfig) {
      return [];
    }

    const filialFilter = await buildEcommerceFilialFilter(request, company, filial, 'f');
    const colorFilterFp = buildColorFilter(request, colors)('fp');

    const query = `
      SELECT 
        CAST(f.EMISSAO AS DATE) AS date,
        f.FILIAL,
        SUM(fp.QTDE) AS quantity,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS revenue,
        NULL AS vendedor,
        fp.COR_PRODUTO AS color,
        -- Cor escopada por PRODUTO: cadastro do produto (PRODUTO_CORES) manda;
        -- CORES_BASICAS (global) só como fallback.
        ISNULL(NULLIF(LTRIM(RTRIM(pc.DESC_COR_PRODUTO)), ''), ISNULL(c.DESC_COR, '')) AS corBanco
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      LEFT JOIN PRODUTO_CORES pc WITH (NOLOCK)
        ON pc.PRODUTO = fp.PRODUTO
        AND (RTRIM(LTRIM(CAST(pc.COR_PRODUTO AS VARCHAR(20)))) = RTRIM(LTRIM(CAST(fp.COR_PRODUTO AS VARCHAR(20)))) OR TRY_CONVERT(INT, pc.COR_PRODUTO) = TRY_CONVERT(INT, fp.COR_PRODUTO))
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON fp.COR_PRODUTO = c.COR
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
        ${colorFilterFp}
      GROUP BY
        CAST(f.EMISSAO AS DATE),
        f.FILIAL,
        fp.COR_PRODUTO,
        ISNULL(NULLIF(LTRIM(RTRIM(pc.DESC_COR_PRODUTO)), ''), ISNULL(c.DESC_COR, ''))
      ORDER BY
        CAST(f.EMISSAO AS DATE) DESC,
        f.FILIAL
    `;

    const result = await request.query<{
      date: Date;
      FILIAL: string;
      quantity: number;
      revenue: number;
      vendedor: string | null;
      color: string | null;
      corBanco: string;
    }>(query);

    const displayNames = companyConfig.filialDisplayNames ?? {};

    return result.recordset.map((row) => {
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      const colorDisplayName = row.color
        ? getColorDescription(row.color, row.corBanco)
        : null;

      return {
        date,
        filial: row.FILIAL,
        filialDisplayName: (() => {
          const normalizedFilial = (row.FILIAL || '').trim();
          return displayNames[normalizedFilial] ?? displayNames[row.FILIAL] ?? row.FILIAL;
        })(),
        quantity: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
        desconto: 0,
        vendedor: row.vendedor ?? null,
        color: row.color,
        colorDisplayName,
      };
    });
  });
}

/**
 * Busca histórico de vendas de um produto
 */
export async function fetchProductSaleHistory({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<ProductSaleHistory[]> {
  // Para scarfme com "Todas as filiais" (null), agregar vendas normais + ecommerce
  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductSaleHistory({ productId, company, range, filial: VAREJO_VALUE, colors }),
      fetchProductSaleHistoryEcommerce({ productId, company, range, filial: null, colors }),
    ]);

    // Combinar e ordenar por data
    const combined = [...salesResult, ...ecommerceResult];
    return combined.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  const { start, end } = resolveRange(range);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const companyConfig = await resolveCompanyLive(company);
    if (!companyConfig) {
      return [];
    }

    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    const colorFilterVp = buildColorFilter(request, colors)('vp');

    // Mesma base de cálculo que fetchProductDetail (TOTAL_VENDA - VALOR_TROCA por item/troca)
    const query = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          c.DESC_COR,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT 
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(QTDE) AS QTDE_TROCA,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT 
          *,
          ISNULL(QTDE_TROCA_ITEM, 0) AS QTDE_TROCA,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT
        CAST(vf.DATA_VENDA AS DATE) AS date,
        vf.FILIAL,
        SUM(vf.TOTAL_QTDE_VENDA - vf.QTDE_TROCA) AS quantity,
        SUM(vf.TOTAL_VENDA - vf.VALOR_TROCA) AS revenue,
        SUM(CASE WHEN vf.QTDE_CANCELADA > 0 THEN 0 ELSE ISNULL(vf.DESCONTO_VENDA, 0) END) AS desconto,
        vf.VENDEDOR AS vendedor,
        vf.COR_PRODUTO AS color,
        -- Descrição da cor do CADASTRO DO PRODUTO (DESC_COR_PRODUTO da venda) manda;
        -- CORES_BASICAS (DESC_COR, global) só como fallback.
        ISNULL(NULLIF(LTRIM(RTRIM(vf.DESC_COR_PRODUTO)), ''), ISNULL(vf.DESC_COR, '')) AS corBanco
      FROM vendas_finais vf
      GROUP BY
        CAST(vf.DATA_VENDA AS DATE),
        vf.FILIAL,
        vf.VENDEDOR,
        vf.COR_PRODUTO,
        ISNULL(NULLIF(LTRIM(RTRIM(vf.DESC_COR_PRODUTO)), ''), ISNULL(vf.DESC_COR, ''))
      HAVING
        SUM(vf.TOTAL_QTDE_VENDA - vf.QTDE_TROCA) <> 0
        OR SUM(vf.TOTAL_VENDA - vf.VALOR_TROCA) <> 0
      ORDER BY
        CAST(vf.DATA_VENDA AS DATE) DESC,
        vf.FILIAL
    `;

    const result = await request.query<{
      date: Date;
      FILIAL: string;
      quantity: number;
      revenue: number;
      desconto: number;
      vendedor: string | null;
      color: string | null;
      corBanco: string;
    }>(query);

    const displayNames = companyConfig.filialDisplayNames ?? {};
    const codigosVendedor = [
      ...new Set(
        (result.recordset ?? [])
          .map((r) => String(r.vendedor ?? '').trim())
          .filter(Boolean)
      ),
    ];
    const apelidoByCodigo =
      codigosVendedor.length > 0
        ? await resolveVendorAliasMap(request, codigosVendedor)
        : new Map<string, string>();

    return result.recordset.map((row) => {
      const date = row.date instanceof Date ? row.date : new Date(row.date);
      const colorDisplayName = row.color
        ? getColorDescription(row.color, row.corBanco)
        : null;
      const vendedorCodigo = String(row.vendedor ?? '').trim();
      const vendedorNome = vendedorCodigo
        ? (apelidoByCodigo.get(vendedorCodigo) ?? vendedorCodigo)
        : null;

      return {
        date,
        filial: row.FILIAL,
        filialDisplayName: (() => {
          const normalizedFilial = (row.FILIAL || '').trim();
          return displayNames[normalizedFilial] ?? displayNames[row.FILIAL] ?? row.FILIAL;
        })(),
        quantity: Number(row.quantity ?? 0),
        revenue: Number(row.revenue ?? 0),
        desconto: Number(row.desconto ?? 0),
        vendedor: vendedorNome,
        color: row.color,
        colorDisplayName,
      };
    });
  });
}

async function fetchProductSaleHistoryComparisonEcommerce({
  productId,
  company,
  range,
  filial,
  colors,
}: ProductDetailParams): Promise<ProductSaleHistory[]> {
  const { start, end } = resolveRange(range);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const companyConfig = await resolveCompanyLive(company);
    if (!companyConfig) {
      return [];
    }

    const filialFilter = await buildEcommerceFilialFilter(request, company, filial, 'f');
    const colorFilterFp = buildColorFilter(request, colors)('fp');

    const query = `
      SELECT
        CAST(f.EMISSAO AS DATE) AS date,
        f.FILIAL,
        SUM(fp.QTDE) AS quantity,
        SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS revenue
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND CAST(f.EMISSAO AS DATE) >= CAST(@startDate AS DATE)
        AND CAST(f.EMISSAO AS DATE) < CAST(@endDate AS DATE)
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
        ${colorFilterFp}
      GROUP BY CAST(f.EMISSAO AS DATE), f.FILIAL
      ORDER BY CAST(f.EMISSAO AS DATE) DESC, f.FILIAL
    `;

    const result = await request.query<{
      date: Date;
      FILIAL: string;
      quantity: number;
      revenue: number;
    }>(query);

    const displayNames = companyConfig.filialDisplayNames ?? {};

    return result.recordset.map((row) => ({
      date: row.date instanceof Date ? row.date : new Date(row.date),
      filial: row.FILIAL,
      filialDisplayName: (() => {
        const normalizedFilial = (row.FILIAL || '').trim();
        return displayNames[normalizedFilial] ?? displayNames[row.FILIAL] ?? row.FILIAL;
      })(),
      quantity: Number(row.quantity ?? 0),
      revenue: Number(row.revenue ?? 0),
      desconto: 0,
      vendedor: null,
      color: null,
      colorDisplayName: null,
    }));
  });
}

export async function fetchProductSaleHistoryComparison(
  params: ProductDetailParams
): Promise<ProductSaleHistory[]> {
  const { productId, company, range, filial, colors } = params;

  if (shouldAggregateEcommerce(company, filial)) {
    const [salesResult, ecommerceResult] = await Promise.all([
      fetchProductSaleHistoryComparison({ productId, company, range, filial: VAREJO_VALUE, colors }),
      fetchProductSaleHistoryComparisonEcommerce({ productId, company, range, filial: null, colors }),
    ]);

    return [...salesResult, ...ecommerceResult].sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  const { start, end } = resolveRange(range);

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);

    const companyConfig = await resolveCompanyLive(company);
    if (!companyConfig) {
      return [];
    }

    const filialFilter = await buildFilialFilter(request, company, 'sales', filial, 'vp');
    const colorFilterVp = buildColorFilter(request, colors)('vp');

    const query = `
      WITH vendas_base AS (
        SELECT
          vp.*,
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA,
          CASE
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(QTDE) AS QTDE_TROCA,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT
          *,
          ISNULL(QTDE_TROCA_ITEM, 0) AS QTDE_TROCA,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT
        CAST(vf.DATA_VENDA AS DATE) AS date,
        vf.FILIAL,
        SUM(vf.TOTAL_QTDE_VENDA - vf.QTDE_TROCA) AS quantity,
        SUM(vf.TOTAL_VENDA - vf.VALOR_TROCA) AS revenue
      FROM vendas_finais vf
      GROUP BY CAST(vf.DATA_VENDA AS DATE), vf.FILIAL
      HAVING
        SUM(vf.TOTAL_QTDE_VENDA - vf.QTDE_TROCA) <> 0
        OR SUM(vf.TOTAL_VENDA - vf.VALOR_TROCA) <> 0
      ORDER BY CAST(vf.DATA_VENDA AS DATE) DESC, vf.FILIAL
    `;

    const result = await request.query<{
      date: Date;
      FILIAL: string;
      quantity: number;
      revenue: number;
    }>(query);

    const displayNames = companyConfig.filialDisplayNames ?? {};

    return result.recordset.map((row) => ({
      date: row.date instanceof Date ? row.date : new Date(row.date),
      filial: row.FILIAL,
      filialDisplayName: (() => {
        const normalizedFilial = (row.FILIAL || '').trim();
        return displayNames[normalizedFilial] ?? displayNames[row.FILIAL] ?? row.FILIAL;
      })(),
      quantity: Number(row.quantity ?? 0),
      revenue: Number(row.revenue ?? 0),
      desconto: 0,
      vendedor: null,
      color: null,
      colorDisplayName: null,
    }));
  });
}

async function fetchStockEntriesDailyRows(
  params: ProductDetailParams
): Promise<ClassifiedMovementRow[]> {
  const { start, end } = resolveRange(params.range);
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, params.productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const companyConfig = await resolveCompanyLive(params.company);
    if (!companyConfig) {
      return [];
    }
    const filialFilter = await buildFilialFilter(request, params.company, 'inventory', params.filial, 'E', 'entF');
    const colorFilterP = buildColorFilter(request, params.colors)('P');
    // Agrupa também por tipo de romaneio/entrada para reconhecer ajustes (mesma classificação do extrato admin).
    const query = `
      SELECT
        CAST(E.EMISSAO AS DATE) AS d,
        E.FILIAL AS filial,
        E.TIPO_ROMANEIO AS tipoRomaneio,
        E.TIPO_ENTRADA AS tipoEntrada,
        SUM(ISNULL(P.QTDE, 0)) AS qty
      FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
      INNER JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      WHERE P.PRODUTO = @productId
        AND E.EMISSAO >= @startDate
        AND E.EMISSAO < @endDate
        ${filialFilter}
        ${colorFilterP}
      GROUP BY CAST(E.EMISSAO AS DATE), E.FILIAL, E.TIPO_ROMANEIO, E.TIPO_ENTRADA
    `;
    const result = await request.query<{
      d: Date;
      filial: string;
      tipoRomaneio: string | null;
      tipoEntrada: number | null;
      qty: number | null;
    }>(query);
    return (result.recordset ?? []).map((r) => ({
      d: r.d instanceof Date ? r.d : new Date(r.d),
      filial: r.filial ?? '',
      qty: Number(r.qty ?? 0),
      ajuste: isAjusteMovimento(r.tipoRomaneio, r.tipoEntrada),
    }));
  });
}

/** Saídas de estoque não-venda por dia (ESTOQUE_PROD_SAI / ESTOQUE_PROD1_SAI). */
async function fetchStockExitsDailyRows(
  params: ProductDetailParams
): Promise<ClassifiedMovementRow[]> {
  const { start, end } = resolveRange(params.range);
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, params.productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const companyConfig = await resolveCompanyLive(params.company);
    if (!companyConfig) return [];
    const filialFilter = await buildFilialFilter(request, params.company, 'inventory', params.filial, 'ES', 'exitF');
    const colorFilterP = buildColorFilter(request, params.colors)('P');
    // Agrupa também por tipo de romaneio para reconhecer ajustes (mesma classificação do extrato admin).
    const query = `
      SELECT
        CAST(ES.EMISSAO AS DATE) AS d,
        ES.FILIAL AS filial,
        ES.TIPO_ROMANEIO AS tipoRomaneio,
        SUM(ISNULL(P.QTDE, 0)) AS qty
      FROM ESTOQUE_PROD_SAI AS ES WITH (NOLOCK)
      INNER JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) ON ES.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      WHERE P.PRODUTO = @productId
        AND ES.EMISSAO >= @startDate
        AND ES.EMISSAO < @endDate
        ${filialFilter}
        ${colorFilterP}
      GROUP BY CAST(ES.EMISSAO AS DATE), ES.FILIAL, ES.TIPO_ROMANEIO
    `;
    const result = await request.query<{
      d: Date;
      filial: string;
      tipoRomaneio: string | null;
      qty: number | null;
    }>(query);
    return (result.recordset ?? []).map((r) => ({
      d: r.d instanceof Date ? r.d : new Date(r.d),
      filial: r.filial ?? '',
      qty: Number(r.qty ?? 0),
      ajuste: isAjusteMovimento(r.tipoRomaneio),
    }));
  });
}

/**
 * Ajustes de contagem de inventário por dia (ESTOQUE_PROD_CONTAGEM + ESTOQUE_PROD_CTG_AJUSTE),
 * mesma fonte #6 do extrato admin. QTDE_AJUSTE já vem com sinal (+ aumenta estoque, − diminui).
 *
 * Esses ajustes são aplicados DIRETO no estoque pelo módulo de contagem do Linx, sem gerar
 * romaneio em ESTOQUE_PROD_ENT/SAI — por isso entram aqui como fonte independente. A reconciliação
 * mostrou que praticamente não há sobreposição com os ajustes de ENT/SAI (mecanismos distintos),
 * então somar as duas fontes na categoria "Ajuste" não duplica contagem.
 */
async function fetchStockCountAdjustmentsDailyRows(
  params: ProductDetailParams
): Promise<StockMovementRow[]> {
  const { start, end } = resolveRange(params.range);
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, params.productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const companyConfig = await resolveCompanyLive(params.company);
    if (!companyConfig) return [];
    const filialFilter = await buildFilialFilter(request, params.company, 'inventory', params.filial, 'c', 'ctgF');
    // Match de cor robusto: a tabela de ajuste de contagem pode ter COR_PRODUTO com padding.
    let colorFilter = '';
    const cleanColors = (params.colors ?? [])
      .filter((c) => c != null && c !== '')
      .map((c) => String(c).trim());
    if (cleanColors.length > 0) {
      cleanColors.forEach((c, i) => request.input(`ctgColor${i}`, sql.VarChar, c));
      const ph = cleanColors.map((_, i) => `@ctgColor${i}`).join(', ');
      colorFilter = `AND RTRIM(LTRIM(ISNULL(CAST(a.COR_PRODUTO AS VARCHAR(20)), ''))) IN (${ph})`;
    }
    const query = `
      SELECT
        CAST(c.EMISSAO AS DATE) AS d,
        c.FILIAL AS filial,
        SUM(ISNULL(a.QTDE_AJUSTE, 0)) AS qty
      FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
      INNER JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
      WHERE RTRIM(LTRIM(CAST(a.PRODUTO AS VARCHAR(50)))) = @productId
        AND c.ESTOQUE_AJUSTADO = 1
        AND c.EMISSAO >= @startDate
        AND c.EMISSAO < @endDate
        ${filialFilter}
        ${colorFilter}
      GROUP BY CAST(c.EMISSAO AS DATE), c.FILIAL
    `;
    const result = await request.query<{ d: Date; filial: string; qty: number | null }>(query);
    return (result.recordset ?? []).map((r) => ({
      d: r.d instanceof Date ? r.d : new Date(r.d),
      filial: r.filial ?? '',
      qty: Number(r.qty ?? 0),
    }));
  });
}

async function fetchStockSalesDailyRetailRows(
  params: ProductDetailParams
): Promise<StockMovementRow[]> {
  const { start, end } = resolveRange(params.range);
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, params.productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const companyConfig = await resolveCompanyLive(params.company);
    if (!companyConfig) {
      return [];
    }
    const filialFilter = await buildFilialFilter(request, params.company, 'sales', params.filial, 'vp', 'sdRetail');
    const colorFilterVp = buildColorFilter(request, params.colors)('vp');
    const query = `
      WITH vendas_base AS (
        SELECT 
          vp.*,
          c.DESC_COR,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE (vp.PRECO_LIQUIDO * vp.QTDE) - ISNULL(vp.DESCONTO_VENDA, 0)
          END AS TOTAL_VENDA,
          CASE 
            WHEN vp.QTDE_CANCELADA > 0 THEN 0
            ELSE vp.QTDE
          END AS TOTAL_QTDE_VENDA
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
        WHERE vp.PRODUTO = @productId
          AND vp.DATA_VENDA >= @startDate
          AND vp.DATA_VENDA < @endDate
          AND vp.QTDE > 0
          ${filialFilter}
          ${colorFilterVp}
      ),
      trocas_item AS (
        SELECT 
          TICKET,
          CODIGO_FILIAL,
          PRODUTO,
          COR_PRODUTO,
          TAMANHO,
          SUM(QTDE) AS QTDE_TROCA,
          SUM(PRECO_LIQUIDO * QTDE) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
      ),
      vendas_com_troca AS (
        SELECT 
          vb.*,
          ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
          ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM
        FROM vendas_base vb
        LEFT JOIN trocas_item ti ON ti.TICKET = vb.TICKET 
          AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
          AND ti.PRODUTO = vb.PRODUTO
          AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
          AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
      ),
      vendas_finais AS (
        SELECT 
          *,
          ISNULL(QTDE_TROCA_ITEM, 0) AS QTDE_TROCA,
          ISNULL(VALOR_TROCA_ITEM, 0) AS VALOR_TROCA
        FROM vendas_com_troca
      )
      SELECT 
        CAST(vf.DATA_VENDA AS DATE) AS d,
        vf.FILIAL AS filial,
        SUM(vf.TOTAL_QTDE_VENDA - vf.QTDE_TROCA) AS qty
      FROM vendas_finais vf
      GROUP BY CAST(vf.DATA_VENDA AS DATE), vf.FILIAL
    `;
    const result = await request.query<{ d: Date; filial: string; qty: number | null }>(query);
    return (result.recordset ?? []).map((r) => ({
      d: r.d instanceof Date ? r.d : new Date(r.d),
      filial: r.filial ?? '',
      qty: Number(r.qty ?? 0),
    }));
  });
}

async function fetchStockSalesDailyEcommerceRows(
  params: ProductDetailParams
): Promise<StockMovementRow[]> {
  const { start, end } = resolveRange(params.range);
  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, params.productId);
    request.input('startDate', sql.DateTime, start);
    request.input('endDate', sql.DateTime, end);
    const companyConfig = await resolveCompanyLive(params.company);
    if (!companyConfig) {
      return [];
    }
    const filialFilter = await buildEcommerceFilialFilter(request, params.company, params.filial, 'f');
    const colorFilterFp = buildColorFilter(request, params.colors)('fp');
    const query = `
      SELECT 
        CAST(f.EMISSAO AS DATE) AS d,
        f.FILIAL AS filial,
        SUM(fp.QTDE) AS qty
      FROM FATURAMENTO f WITH (NOLOCK)
      JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
      WHERE fp.PRODUTO = @productId
        AND f.EMISSAO >= @startDate
        AND f.EMISSAO < @endDate
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        AND fp.QTDE > 0
        ${filialFilter}
        ${colorFilterFp}
      GROUP BY CAST(f.EMISSAO AS DATE), f.FILIAL
    `;
    const result = await request.query<{ d: Date; filial: string; qty: number | null }>(query);
    return (result.recordset ?? []).map((r) => ({
      d: r.d instanceof Date ? r.d : new Date(r.d),
      filial: r.filial ?? '',
      qty: Number(r.qty ?? 0),
    }));
  });
}

/**
 * Entradas (romaneios) e saídas (vendas, mesma lógica do histórico) por dia;
 * saldo ao fim do dia = estoque atual da tela menos (entradas − vendas) acumulados no período, recalculado dia a dia.
 */
export async function fetchProductStockProgressSeries(
  params: ProductDetailParams,
  stockByFilial: ProductStockByFilial[]
): Promise<ProductStockProgressDay[]> {
  const companyConfig = await resolveCompanyLive(params.company);
  if (!companyConfig) {
    return [];
  }

  const displayNames = companyConfig.filialDisplayNames ?? {};
  const ecFiliais = companyConfig.ecommerceFilials ?? [];
  const normDispKey = (raw: string) => {
    const t = (raw || '').trim();
    const name = displayNames[t] ?? displayNames[raw] ?? raw;
    return name.toUpperCase().trim();
  };
  const dispLabel = (raw: string) => {
    const t = (raw || '').trim();
    return (displayNames[t] ?? displayNames[raw] ?? raw).trim();
  };

  const isEcFilial =
    params.filial != null &&
    params.filial !== VAREJO_VALUE &&
    ecFiliais.some((f) => f.trim() === params.filial?.trim());

  let entryRows: ClassifiedMovementRow[];
  let saleRows: StockMovementRow[];
  let exitRows: ClassifiedMovementRow[];
  let countRows: StockMovementRow[];

  if (shouldAggregateEcommerce(params.company, params.filial)) {
    const [e, sr, se, ex, ct] = await Promise.all([
      fetchStockEntriesDailyRows({ ...params, filial: null }),
      fetchStockSalesDailyRetailRows({ ...params, filial: VAREJO_VALUE }),
      fetchStockSalesDailyEcommerceRows({ ...params, filial: null }),
      fetchStockExitsDailyRows({ ...params, filial: null }),
      fetchStockCountAdjustmentsDailyRows({ ...params, filial: null }),
    ]);
    entryRows = e;
    saleRows = mergeSalesDailyRows(sr, se);
    exitRows = ex;
    countRows = ct;
  } else if (isEcFilial) {
    [entryRows, saleRows, exitRows, countRows] = await Promise.all([
      fetchStockEntriesDailyRows(params),
      fetchStockSalesDailyEcommerceRows(params),
      fetchStockExitsDailyRows(params),
      fetchStockCountAdjustmentsDailyRows(params),
    ]);
  } else {
    [entryRows, saleRows, exitRows, countRows] = await Promise.all([
      fetchStockEntriesDailyRows(params),
      fetchStockSalesDailyRetailRows(params),
      fetchStockExitsDailyRows(params),
      fetchStockCountAdjustmentsDailyRows(params),
    ]);
  }

  const { start, end } = resolveRange(params.range);
  const lastInclusive = subMilliseconds(end, 1);
  let calendarDays: Date[];
  try {
    calendarDays = eachDayOfInterval({ start, end: lastInclusive });
  } catch {
    return [];
  }

  const closingMap = new Map<string, number>();
  for (const row of stockByFilial) {
    const k = normDispKey(row.filialDisplayName || row.filial);
    closingMap.set(k, (closingMap.get(k) ?? 0) + Number(row.stock ?? 0));
  }

  // Entradas e saídas normais ficam separadas dos ajustes. O ajuste é líquido por filial
  // (+ entrada de ajuste de ESTOQUE_PROD_ENT, − saída de ajuste de ESTOQUE_PROD_SAI).
  // Isto apenas reclassifica movimentos já presentes nas tabelas — o total de impacto no
  // estoque é idêntico ao anterior, então o saldo rebobinado não muda.
  const totalE = new Map<string, number>();
  const totalS = new Map<string, number>();
  const totalSE = new Map<string, number>();
  const totalADJ = new Map<string, number>();
  for (const r of entryRows) {
    const k = normDispKey(dispLabel(r.filial));
    if (r.ajuste) totalADJ.set(k, (totalADJ.get(k) ?? 0) + r.qty);
    else totalE.set(k, (totalE.get(k) ?? 0) + r.qty);
  }
  for (const r of saleRows) {
    const k = normDispKey(dispLabel(r.filial));
    totalS.set(k, (totalS.get(k) ?? 0) + r.qty);
  }
  for (const r of exitRows) {
    const k = normDispKey(dispLabel(r.filial));
    if (r.ajuste) totalADJ.set(k, (totalADJ.get(k) ?? 0) - r.qty);
    else totalSE.set(k, (totalSE.get(k) ?? 0) + r.qty);
  }
  // Ajustes de contagem (QTDE_AJUSTE já com sinal: + aumenta, − diminui).
  for (const r of countRows) {
    const k = normDispKey(dispLabel(r.filial));
    totalADJ.set(k, (totalADJ.get(k) ?? 0) + r.qty);
  }

  const allKeys = new Set<string>([
    ...closingMap.keys(),
    ...totalE.keys(),
    ...totalS.keys(),
    ...totalSE.keys(),
    ...totalADJ.keys(),
  ]);
  const running = new Map<string, number>();
  for (const k of allKeys) {
    const close = closingMap.get(k) ?? 0;
    const te = totalE.get(k) ?? 0;
    const ts = totalS.get(k) ?? 0;
    const tse = totalSE.get(k) ?? 0;
    const tadj = totalADJ.get(k) ?? 0;
    // Rebobina para o início do período: estoque atual menos entradas/ajustes-de-entrada,
    // mais todas as saídas (vendas, mov. estoque e ajustes-de-saída).
    running.set(k, close - te + ts + tse - tadj);
  }

  const byDayEntry = new Map<string, Map<string, number>>();
  const byDaySale = new Map<string, Map<string, number>>();
  const byDayExit = new Map<string, Map<string, number>>();
  const byDayAdjust = new Map<string, Map<string, number>>();
  const addDay = (m: Map<string, Map<string, number>>, iso: string, dispK: string, q: number) => {
    if (!q) return;
    if (!m.has(iso)) m.set(iso, new Map());
    const inner = m.get(iso)!;
    inner.set(dispK, (inner.get(dispK) ?? 0) + q);
  };
  for (const r of entryRows) {
    const iso = toLocalIsoDay(r.d);
    if (!iso) continue;
    addDay(r.ajuste ? byDayAdjust : byDayEntry, iso, normDispKey(dispLabel(r.filial)), r.qty);
  }
  for (const r of saleRows) {
    const iso = toLocalIsoDay(r.d);
    if (!iso) continue;
    addDay(byDaySale, iso, normDispKey(dispLabel(r.filial)), r.qty);
  }
  for (const r of exitRows) {
    const iso = toLocalIsoDay(r.d);
    if (!iso) continue;
    // Ajuste de saída entra no líquido com sinal negativo.
    addDay(r.ajuste ? byDayAdjust : byDayExit, iso, normDispKey(dispLabel(r.filial)), r.ajuste ? -r.qty : r.qty);
  }
  for (const r of countRows) {
    const iso = toLocalIsoDay(r.d);
    if (!iso) continue;
    // Contagem entra na categoria Ajuste com o sinal de QTDE_AJUSTE.
    addDay(byDayAdjust, iso, normDispKey(dispLabel(r.filial)), r.qty);
  }

  const toFilialList = (inner: Map<string, number> | undefined) => {
    if (!inner || inner.size === 0) return [];
    return Array.from(inner.entries())
      .filter(([, q]) => q > 0)
      .map(([k, qty]) => ({ filialDisplayName: k, qty }))
      .sort((a, b) => a.filialDisplayName.localeCompare(b.filialDisplayName, 'pt-BR'));
  };
  // Ajustes podem ter sinal negativo (saída de ajuste); mantém todos os não-zero.
  const toAdjustList = (inner: Map<string, number> | undefined) => {
    if (!inner || inner.size === 0) return [];
    return Array.from(inner.entries())
      .filter(([, q]) => q !== 0)
      .map(([k, qty]) => ({ filialDisplayName: k, qty }))
      .sort((a, b) => a.filialDisplayName.localeCompare(b.filialDisplayName, 'pt-BR'));
  };

  const out: ProductStockProgressDay[] = [];
  for (const day of calendarDays) {
    const iso = toLocalIsoDay(day);
    const em = byDayEntry.get(iso);
    const sm = byDaySale.get(iso);
    const xm = byDayExit.get(iso);
    const adm = byDayAdjust.get(iso);
    let dayEntries = 0;
    let daySales = 0;
    let dayExits = 0;
    let dayAdjust = 0;
    if (em) {
      em.forEach((q, dispK) => {
        dayEntries += q;
        running.set(dispK, (running.get(dispK) ?? 0) + q);
      });
    }
    if (sm) {
      sm.forEach((q, dispK) => {
        daySales += q;
        running.set(dispK, (running.get(dispK) ?? 0) - q);
      });
    }
    if (xm) {
      xm.forEach((q, dispK) => {
        dayExits += q;
        running.set(dispK, (running.get(dispK) ?? 0) - q);
      });
    }
    if (adm) {
      // q já tem sinal: + entrada de ajuste, − saída de ajuste.
      adm.forEach((q, dispK) => {
        dayAdjust += q;
        running.set(dispK, (running.get(dispK) ?? 0) + q);
      });
    }
    let stockGeral = 0;
    const stockByFilialOut: Record<string, number> = {};
    running.forEach((v, k) => {
      const rounded = Math.round(v);
      stockByFilialOut[k] = rounded;
      stockGeral += toNonNegativeStock(rounded);
    });
    const stockGeralRounded = Math.round(stockGeral);
    out.push({
      dateIso: iso,
      entries: Math.round(dayEntries),
      sales: Math.round(daySales),
      stockExits: Math.round(dayExits),
      adjustments: Math.round(dayAdjust),
      outOfStock: stockGeralRounded <= 0,
      stockGeral: stockGeralRounded,
      stockByFilial: stockByFilialOut,
      entriesByFilial: toFilialList(em),
      salesByFilial: toFilialList(sm),
      exitsByFilial: toFilialList(xm),
      adjustmentsByFilial: toAdjustList(adm),
    });
  }

  return out;
}

// --- Preços e custos editáveis (como no script alterar_custo_produto.py) ---

export interface ProductPrecoItem {
  codTabela: string;
  descTabela: string;
  valor: number;
  origem: 'PRODUTOS_PRECOS';
  campo: string;
}

export interface ProductCustoItem {
  codTabela: string;
  descTabela: string;
  valor: number;
  origem: 'PRODUTOS';
  campo: string;
}

/**
 * Busca todos os preços de venda do produto (PRODUTOS_PRECOS: PRECO1-4 por CODIGO_TAB_PRECO).
 */
export async function fetchProductPrecos(
  productId: string,
  _company?: string
): Promise<ProductPrecoItem[]> {
  const codigoLimpo = String(productId).trim();

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, codigoLimpo);

    const query = `
      SELECT pp.PRODUTO, CONCAT(pp.CODIGO_TAB_PRECO, '-P1') AS COD_TABELA,
        CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO1') AS DESC_TABELA,
        ISNULL(pp.PRECO1, 0) AS VALOR, 'PRODUTOS_PRECOS' AS ORIGEM, 'PRECO1' AS CAMPO
      FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
      LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
      WHERE pp.PRODUTO = @productId
      UNION ALL
      SELECT pp.PRODUTO, CONCAT(pp.CODIGO_TAB_PRECO, '-P2'),
        CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO2'), ISNULL(pp.PRECO2, 0), 'PRODUTOS_PRECOS', 'PRECO2'
      FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
      LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
      WHERE pp.PRODUTO = @productId
      UNION ALL
      SELECT pp.PRODUTO, CONCAT(pp.CODIGO_TAB_PRECO, '-P3'),
        CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO3'), ISNULL(pp.PRECO3, 0), 'PRODUTOS_PRECOS', 'PRECO3'
      FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
      LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
      WHERE pp.PRODUTO = @productId
      UNION ALL
      SELECT pp.PRODUTO, CONCAT(pp.CODIGO_TAB_PRECO, '-P4'),
        CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO4'), ISNULL(pp.PRECO4, 0), 'PRODUTOS_PRECOS', 'PRECO4'
      FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
      LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
      WHERE pp.PRODUTO = @productId
      ORDER BY COD_TABELA
    `;

    const result = await request.query<{
      COD_TABELA: string;
      DESC_TABELA: string;
      VALOR: number;
      ORIGEM: string;
      CAMPO: string;
    }>(query);

    return result.recordset.map((row) => ({
      codTabela: String(row.COD_TABELA ?? '').trim(),
      descTabela: String(row.DESC_TABELA ?? '').trim(),
      valor: Number(row.VALOR ?? 0),
      origem: 'PRODUTOS_PRECOS' as const,
      campo: String(row.CAMPO ?? 'PRECO1').trim(),
    }));
  });
}

/**
 * Busca todos os custos do produto (PRODUTOS: CUSTO_REPOSICAO1-4).
 */
export async function fetchProductCustos(
  productId: string,
  _company?: string
): Promise<ProductCustoItem[]> {
  const codigoLimpo = String(productId).trim();

  return withRequest(async (request) => {
    request.input('productId', sql.VarChar, codigoLimpo);

    const query = `
      SELECT PRODUTO, '00' AS COD_TABELA, 'TABELA ORIGINAL' AS DESC_TABELA,
        ISNULL(CUSTO_REPOSICAO1, 0) AS VALOR, 'PRODUTOS' AS ORIGEM, 'CUSTO_REPOSICAO1' AS CAMPO
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @productId
      UNION ALL
      SELECT PRODUTO, '01', 'TABELA PADRAO', ISNULL(CUSTO_REPOSICAO2, 0), 'PRODUTOS', 'CUSTO_REPOSICAO2'
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @productId
      UNION ALL
      SELECT PRODUTO, '02', 'TABELA ALTERNATIVA', ISNULL(CUSTO_REPOSICAO3, 0), 'PRODUTOS', 'CUSTO_REPOSICAO3'
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @productId
      UNION ALL
      SELECT PRODUTO, '03', 'TABELA EXTRA', ISNULL(CUSTO_REPOSICAO4, 0), 'PRODUTOS', 'CUSTO_REPOSICAO4'
      FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @productId
      ORDER BY COD_TABELA
    `;

    const result = await request.query<{
      COD_TABELA: string;
      DESC_TABELA: string;
      VALOR: number;
      ORIGEM: string;
      CAMPO: string;
    }>(query);

    return result.recordset.map((row) => ({
      codTabela: String(row.COD_TABELA ?? '').trim(),
      descTabela: String(row.DESC_TABELA ?? '').trim(),
      valor: Number(row.VALOR ?? 0),
      origem: 'PRODUTOS' as const,
      campo: String(row.CAMPO ?? 'CUSTO_REPOSICAO1').trim(),
    }));
  });
}

export interface UpdatePrecoCustoParams {
  productId: string;
  codTabela: string;
  origem: 'PRODUTOS' | 'PRODUTOS_PRECOS';
  campo: string;
  novoValor: number;
}

/**
 * Atualiza um preço (PRODUTOS_PRECOS) ou custo (PRODUTOS). Lógica igual ao script alterar_custo_produto.py.
 */
export async function updateProductPrecoOrCusto(
  params: UpdatePrecoCustoParams
): Promise<{ success: boolean; rowsAffected: number; message: string }> {
  const { productId, codTabela, origem, campo, novoValor } = params;
  const produto = String(productId).trim();
  const codTabelaTrim = codTabela?.trim() ?? '';

  return withRequest(async (request) => {
    try {
      if (origem === 'PRODUTOS') {
        const query = `
          UPDATE PRODUTOS SET ${sanitizeColumnName(campo)} = @novoValor WHERE PRODUTO = @productId
        `;
        request.input('productId', sql.VarChar, produto);
        request.input('novoValor', sql.Decimal(18, 4), novoValor);
        const result = await request.query(query);
        const rows = (result as { rowsAffected?: number[] }).rowsAffected ?? [];
        const rowsAffected = Array.isArray(rows) ? (rows[0] ?? 0) : 0;
        return {
          success: true,
          rowsAffected,
          message: rowsAffected > 0 ? `${rowsAffected} registro(s) alterado(s) com sucesso.` : 'Nenhum registro alterado.',
        };
      }

      if (origem === 'PRODUTOS_PRECOS') {
        const codTabelaLimpo = codTabelaTrim.includes('-') ? codTabelaTrim.split('-')[0] : codTabelaTrim;
        const query = `
          UPDATE PRODUTOS_PRECOS SET ${sanitizeColumnName(campo)} = @novoValor
          WHERE PRODUTO = @productId AND CODIGO_TAB_PRECO = @codTabela
        `;
        request.input('productId', sql.VarChar, produto);
        request.input('novoValor', sql.Decimal(18, 4), novoValor);
        request.input('codTabela', sql.VarChar, codTabelaLimpo);
        const result = await request.query(query);
        const rows = (result as { rowsAffected?: number[] }).rowsAffected ?? [];
        const rowsAffected = Array.isArray(rows) ? (rows[0] ?? 0) : 0;
        return {
          success: true,
          rowsAffected,
          message: rowsAffected > 0 ? `${rowsAffected} registro(s) alterado(s) com sucesso.` : 'Nenhum registro alterado.',
        };
      }

      return { success: false, rowsAffected: 0, message: 'Origem inválida.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { success: false, rowsAffected: 0, message: `Erro: ${message}` };
    }
  });
}

function sanitizeColumnName(name: string): string {
  const allowed = [
    'CUSTO_REPOSICAO1', 'CUSTO_REPOSICAO2', 'CUSTO_REPOSICAO3', 'CUSTO_REPOSICAO4',
    'PRECO1', 'PRECO2', 'PRECO3', 'PRECO4',
  ];
  const n = name?.trim() ?? '';
  if (allowed.includes(n)) return n;
  return 'PRECO1';
}

import { query } from '@/lib/db/connection';

export interface RawData {
  produtos: Record<string, unknown>[];
  estoque: Record<string, unknown>[];
  produtosBarra: {
    PRODUTO: string;
    COR_PRODUTO: string | null;
    TAMANHO: string | null;
    CODIGO_BARRA: string | null;
  }[];
  vendas: Record<string, unknown>[];
  ecommerce: Record<string, unknown>[];
  entradas: Record<string, unknown>[];
  cores: {
    COR: string;
    DESC_COR: string;
  }[];
}

export function fetchProducts() {
  return query<Record<string, unknown>>('SELECT * FROM PRODUTOS');
}

export function fetchInventory() {
  return query<Record<string, unknown>>('SELECT * FROM ESTOQUE_PRODUTOS');
}

export function fetchProductBarcodes() {
  return query<{
    PRODUTO: string;
    COR_PRODUTO: string | null;
    TAMANHO: string | null;
    CODIGO_BARRA: string | null;
  }>(
    'SELECT PRODUTO, COR_PRODUTO, TAMANHO, CODIGO_BARRA FROM PRODUTOS_BARRA'
  );
}

export function fetchSales() {
  const queryText = `
    WITH VendasBase AS (
      SELECT 
        vp.TICKET,
        vp.CODIGO_FILIAL,
        vp.DATA_VENDA,
        vp.PRODUTO,
        vp.COR_PRODUTO,
        vp.TAMANHO,
        vp.QTDE,
        vp.QTDE_CANCELADA,
        vp.PRECO_LIQUIDO,
        vp.DESCONTO_ITEM,
        vp.CUSTO,
        vp.FATOR_VENDA_LIQ,
        f.FILIAL,
        v.VENDEDOR,
        CAST((vp.QTDE * vp.PRECO_LIQUIDO * vp.FATOR_DESCONTO_VENDA) AS DECIMAL(38,6)) AS DESCONTO_VENDA,
        v.VALOR_TIKET,
        v.VALOR_VENDA_BRUTA,
        v.CODIGO_TAB_PRECO,
        v.CODIGO_DESCONTO,
        v.OPERACAO_VENDA,
        v.DATA_HORA_CANCELAMENTO,
        p.DESC_PRODUTO,
        p.GRUPO_PRODUTO,
        p.SUBGRUPO_PRODUTO,
        p.LINHA,
        p.COLECAO,
        p.GRIFFE,
        p.GRADE,
        c.DESC_COR AS DESC_COR_PRODUTO
      FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
        AND v.TICKET = vp.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = vp.CODIGO_FILIAL
      LEFT JOIN PRODUTOS p WITH (NOLOCK) 
        ON p.PRODUTO = vp.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) 
        ON c.COR = vp.COR_PRODUTO
      WHERE vp.DATA_VENDA >= '2024-01-01'
    ),
    TrocasItem AS (
      SELECT 
        vt.TICKET,
        vt.CODIGO_FILIAL,
        vt.PRODUTO,
        vt.COR_PRODUTO,
        vt.TAMANHO,
        SUM(vt.QTDE) AS QTDE_TROCA,
        CAST(SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      WHERE vt.QTDE_CANCELADA = 0
      GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
    ),
    TrocasPuras AS (
      SELECT 
        vt.TICKET,
        vt.CODIGO_FILIAL,
        v.DATA_VENDA,
        vt.PRODUTO,
        vt.COR_PRODUTO,
        vt.TAMANHO,
        0 AS QTDE,
        0 AS QTDE_CANCELADA,
        vt.PRECO_LIQUIDO,
        vt.DESCONTO_ITEM,
        vt.CUSTO,
        NULL AS FATOR_VENDA_LIQ,
        f.FILIAL,
        v.VENDEDOR,
        0 AS DESCONTO_VENDA,
        v.VALOR_TIKET,
        v.VALOR_VENDA_BRUTA,
        v.CODIGO_TAB_PRECO,
        v.CODIGO_DESCONTO,
        v.OPERACAO_VENDA,
        v.DATA_HORA_CANCELAMENTO,
        p.DESC_PRODUTO,
        p.GRUPO_PRODUTO,
        p.SUBGRUPO_PRODUTO,
        p.LINHA,
        p.COLECAO,
        p.GRIFFE,
        p.GRADE,
        c.DESC_COR AS DESC_COR_PRODUTO,
        vt.QTDE AS QTDE_TROCA_ITEM,
        CAST((vt.PRECO_LIQUIDO * vt.QTDE) AS DECIMAL(38,6)) AS VALOR_TROCA_ITEM
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA v WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
        AND v.TICKET = vt.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK)
        ON f.COD_FILIAL = vt.CODIGO_FILIAL
      LEFT JOIN PRODUTOS p WITH (NOLOCK) 
        ON p.PRODUTO = vt.PRODUTO
      LEFT JOIN CORES_BASICAS c WITH (NOLOCK) 
        ON c.COR = vt.COR_PRODUTO
      WHERE vt.QTDE_CANCELADA = 0
        AND v.DATA_VENDA >= '2024-01-01'
        AND NOT EXISTS (
          SELECT 1 
          FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
          WHERE vp.TICKET = vt.TICKET
            AND vp.CODIGO_FILIAL = vt.CODIGO_FILIAL
            AND vp.PRODUTO = vt.PRODUTO
            AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
            AND ISNULL(vp.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
        )
    ),
    VendasComNumero AS (
      SELECT 
        vb.*,
        ROW_NUMBER() OVER (
          PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
          ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
        ) AS RN
      FROM VendasBase vb
    )
    SELECT 
      vcn.*,
      CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA,
      CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6)) AS VALOR_TROCA,
      CAST((CAST(vcn.PRECO_LIQUIDO * vcn.QTDE AS DECIMAL(38,6)) - CAST(vcn.DESCONTO_VENDA AS DECIMAL(38,6)) - CAST(CASE WHEN vcn.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS DECIMAL(38,6))) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
      (vcn.QTDE - CASE WHEN vcn.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END) AS QTDE_LIQUIDA_CALC
    FROM VendasComNumero vcn
    LEFT JOIN TrocasItem ti ON ti.TICKET = vcn.TICKET 
      AND ti.CODIGO_FILIAL = vcn.CODIGO_FILIAL
      AND ti.PRODUTO = vcn.PRODUTO
      AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vcn.COR_PRODUTO, '')
      AND ISNULL(ti.TAMANHO, 0) = ISNULL(vcn.TAMANHO, 0)
    
    UNION ALL
    
    SELECT 
      tp.*,
      tp.QTDE_TROCA_ITEM AS QTDE_TROCA,
      CAST(tp.VALOR_TROCA_ITEM AS DECIMAL(38,6)) AS VALOR_TROCA,
      CAST((0 - tp.VALOR_TROCA_ITEM) AS DECIMAL(38,6)) AS VALOR_LIQUIDO_CALC,
      (0 - tp.QTDE_TROCA_ITEM) AS QTDE_LIQUIDA_CALC
    FROM TrocasPuras tp
  `;

  return query<Record<string, unknown>>(queryText);
}

export function fetchEcommerce() {
  const queryText = `
    SELECT f.NF_SAIDA,
           f.SERIE_NF,
           f.FILIAL,
           f.NOME_CLIFOR,
           fp.PRODUTO,
           fp.COR_PRODUTO,
           f.MOEDA,
           f.CAMBIO_NA_DATA,
           fp.ITEM,
           fp.ENTREGA,
           fp.PEDIDO_COR,
           fp.PEDIDO,
           fp.CAIXA,
           fp.ROMANEIO,
           fp.PACKS,
           fp.CUSTO_NA_DATA,
           fp.QTDE,
           fp.PRECO,
           fp.MPADRAO_PRECO,
           fp.DESCONTO_ITEM,
           fp.MPADRAO_DESCONTO_ITEM,
           fp.VALOR,
           fp.MPADRAO_VALOR,
           fp.VALOR_PRODUCAO,
           fp.MPADRAO_VALOR_PRODUCAO,
           fp.DIF_PRODUCAO,
           fp.MPADRAO_DIF_PRODUCAO,
           fp.VALOR_LIQUIDO,
           fp.MPADRAO_VALOR_LIQUIDO,
           fp.DIF_PRODUCAO_LIQUIDO,
           fp.MPADRAO_DIF_PRODUCAO_LIQUIDO,
           fp.F1, fp.F2, fp.F3, fp.F4, fp.F5, fp.F6, fp.F7, fp.F8, fp.F9, fp.F10,
           fp.F11, fp.F12, fp.F13, fp.F14, fp.F15, fp.F16, fp.F17, fp.F18, fp.F19, fp.F20,
           fp.F21, fp.F22, fp.F23, fp.F24, fp.F25, fp.F26, fp.F27, fp.F28, fp.F29, fp.F30,
           fp.F31, fp.F32, fp.F33, fp.F34, fp.F35, fp.F36, fp.F37, fp.F38, fp.F39, fp.F40,
           fp.F41, fp.F42, fp.F43, fp.F44, fp.F45, fp.F46, fp.F47, fp.F48,
           f.EMISSAO,
           f.CONDICAO_PGTO,
           f.NATUREZA_SAIDA,
           f.GERENTE,
           f.REPRESENTANTE,
           f.DATA_SAIDA,
           f.TRANSPORTADORA,
           f.TRANSP_REDESPACHO,
           f.EMPRESA,
           f.TIPO_FATURAMENTO,
           p.DESC_PRODUTO,
           p.COLECAO,
           p.TABELA_OPERACOES,
           p.TABELA_MEDIDAS,
           p.TIPO_PRODUTO,
           p.GRUPO_PRODUTO,
           p.SUBGRUPO_PRODUTO,
           p.LINHA,
           p.GRADE,
           p.GRIFFE,
           p.CARTELA,
           p.REVENDA,
           p.MODELAGEM,
           p.FABRICANTE,
           p.ESTILISTA,
           p.MODELISTA,
           fp.DESC_COLECAO,
           fl.REGIAO,
           cv.UF
    FROM FATURAMENTO f WITH (NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
      ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON fp.PRODUTO = p.PRODUTO
    LEFT JOIN FILIAIS fl WITH (NOLOCK) ON f.FILIAL = fl.FILIAL
    LEFT JOIN CLIENTES_VAREJO cv WITH (NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
    WHERE f.EMISSAO >= '2024-01-01'
      AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
  `;

  return query<Record<string, unknown>>(queryText);
}

export function fetchInventoryEntries() {
  const queryText = `
    SELECT E.ROMANEIO_PRODUTO,
           E.EMISSAO,
           E.FILIAL,
           P.PRODUTO,
           P.COR_PRODUTO,
           P.QTDE AS QTDE_TOTAL
    FROM ESTOQUE_PROD_ENT AS E
    LEFT JOIN ESTOQUE_PROD1_ENT AS P ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
  `;

  return query<Record<string, unknown>>(queryText);
}

export function fetchCoreColors() {
  return query<{
    COR: string;
    DESC_COR: string;
  }>('SELECT COR, DESC_COR FROM CORES_BASICAS');
}

export async function fetchAllRaw(): Promise<RawData> {
  const [
    produtos,
    estoque,
    produtosBarra,
    vendas,
    ecommerce,
    entradas,
    cores,
  ] = await Promise.all([
    fetchProducts(),
    fetchInventory(),
    fetchProductBarcodes(),
    fetchSales(),
    fetchEcommerce(),
    fetchInventoryEntries(),
    fetchCoreColors(),
  ]);

  return {
    produtos,
    estoque,
    produtosBarra,
    vendas,
    ecommerce,
    entradas,
    cores,
  };
}


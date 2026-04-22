import { query } from '@/lib/db/connection';

export const FILIAIS_CONSIDERADAS = [
  'SCARF ME - HIGIENOPOLIS 2',
  'SCARFME - IBIRAPUERA LLL',
  'SCARFME ME - PAULISTA FFF',
  'SCARF ME - PAULISTA RSR',
  'SCARF ME - PAULISTA FFFR',
  'SCARFME MATRIZ CMS',
  'SCARF ME - MATRIZ',
  'SCARF ME - MATRIZ LLL',
  'SCARF ME MATRIZ - FFF',
  'SCARF ME MATRIZ - RSR',
  'SCARFME LLL - GALEAO RJ',
  'MSC COMERCIO DE LENCOS LT',
  'CIDADE DE SP - LLL',
  'GUARULHOS - RSR',
  'IGUATEMI SP - JJJ',
  'MORUMBI - JJJ',
  'NERD CAMPINAS',
  'NERD CENTER NORTE',
  'NERD ELDORADO',
  'NERD HIGIENOPOLIS',
  'NERD LEBLON',
  'NERD MORUMBI RDRRRJ',
  'NERD MORUMBI RDRRX',
  'NERD TIJUCA RDRRX',
  'NERD VILLA LOBOS',
  'OSCAR FREIRE - FSZ',
  'VILLA LOBOS - LLL',
];

// Queries atualizadas a partir de exportar_todos_relatorios.py
export const RELATORIO_QUERIES = {
  produtos: 'SELECT * FROM PRODUTOS',
  
  estoque: 'SELECT * FROM ESTOQUE_PRODUTOS',
  
  produtos_barra: 'SELECT PRODUTO, COR_PRODUTO, TAMANHO, CODIGO_BARRA FROM PRODUTOS_BARRA',
  
  vendas: `
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
        (vp.QTDE * vp.PRECO_LIQUIDO * vp.FATOR_DESCONTO_VENDA) AS DESCONTO_VENDA,
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
        lv.VENDEDOR_APELIDO
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
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
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
        SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
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
        lv.VENDEDOR_APELIDO,
        vt.QTDE AS QTDE_TROCA_ITEM,
        (vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA_ITEM
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
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
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
      vb.FILIAL,
      vb.DATA_VENDA,
      vb.PRODUTO,
      vb.DESC_PRODUTO,
      vb.COR_PRODUTO,
      vb.DESC_COR_PRODUTO,
      vb.TAMANHO,
      vb.GRADE,
      vb.TICKET,
      vb.CODIGO_FILIAL,
      vb.QTDE,
      vb.QTDE_CANCELADA,
      vb.PRECO_LIQUIDO,
      vb.DESCONTO_ITEM,
      vb.DESCONTO_VENDA,
      vb.FATOR_VENDA_LIQ,
      vb.CUSTO,
      vb.GRUPO_PRODUTO,
      vb.SUBGRUPO_PRODUTO,
      vb.LINHA,
      vb.COLECAO,
      vb.GRIFFE,
      vb.VENDEDOR,
      vb.VALOR_TIKET,
      vb.DESCONTO_VENDA AS DESCONTO,
      vb.VALOR_VENDA_BRUTA,
      vb.CODIGO_TAB_PRECO,
      vb.CODIGO_DESCONTO,
      vb.OPERACAO_VENDA,
      vb.DATA_HORA_CANCELAMENTO,
      ISNULL(vb.VENDEDOR_APELIDO, vb.VENDEDOR) AS VENDEDOR_APELIDO,
      CASE WHEN vb.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA_ITEM,
      CASE WHEN vb.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS VALOR_TROCA_ITEM,
      0 AS QTDE_TROCA_TICKET,
      0 AS VALOR_TROCA_TICKET
    FROM VendasComNumero vb
    LEFT JOIN TrocasItem ti ON ti.TICKET = vb.TICKET 
      AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
      AND ti.PRODUTO = vb.PRODUTO
      AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
      AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
    
    UNION ALL
    
    SELECT 
      tp.FILIAL,
      tp.DATA_VENDA,
      tp.PRODUTO,
      tp.DESC_PRODUTO,
      tp.COR_PRODUTO,
      tp.DESC_COR_PRODUTO,
      tp.TAMANHO,
      tp.GRADE,
      tp.TICKET,
      tp.CODIGO_FILIAL,
      tp.QTDE,
      tp.QTDE_CANCELADA,
      tp.PRECO_LIQUIDO,
      tp.DESCONTO_ITEM,
      tp.DESCONTO_VENDA,
      tp.FATOR_VENDA_LIQ,
      tp.CUSTO,
      tp.GRUPO_PRODUTO,
      tp.SUBGRUPO_PRODUTO,
      tp.LINHA,
      tp.COLECAO,
      tp.GRIFFE,
      tp.VENDEDOR,
      tp.VALOR_TIKET,
      tp.DESCONTO_VENDA AS DESCONTO,
      tp.VALOR_VENDA_BRUTA,
      tp.CODIGO_TAB_PRECO,
      tp.CODIGO_DESCONTO,
      tp.OPERACAO_VENDA,
      tp.DATA_HORA_CANCELAMENTO,
      ISNULL(tp.VENDEDOR_APELIDO, tp.VENDEDOR) AS VENDEDOR_APELIDO,
      tp.QTDE_TROCA_ITEM,
      tp.VALOR_TROCA_ITEM,
      0 AS QTDE_TROCA_TICKET,
      0 AS VALOR_TROCA_TICKET
    FROM TrocasPuras tp
  `,
  
  ecommerce: `
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
           fp.UF
    FROM FATURAMENTO f WITH(NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK)
      ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
    WHERE f.EMISSAO >= '2025-01-01'
      AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
  `,
  
  entradas: `
    SELECT E.ROMANEIO_PRODUTO, E.EMISSAO, E.FILIAL, P.PRODUTO,
           P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL,
           E.TIPO_ENTRADA, E.TIPO_ROMANEIO
    FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
    LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
      ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
    WHERE E.EMISSAO >= '2025-01-01'
      AND P.PRODUTO IS NOT NULL
  `,

  saidas: `
    SELECT S.ROMANEIO_PRODUTO, S.EMISSAO, S.FILIAL, S.FILIAL_DESTINO,
           P.PRODUTO, P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL,
           S.TIPO_ROMANEIO
    FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
    LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
      ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
      AND S.FILIAL = P.FILIAL
    WHERE S.EMISSAO >= '2025-01-01'
      AND P.PRODUTO IS NOT NULL
  `,
  
  cores: 'SELECT COR, DESC_COR FROM CORES_BASICAS',

  filiais: 'SELECT COD_FILIAL, FILIAL FROM FILIAIS WITH (NOLOCK)',
};

export type RelatorioType = keyof typeof RELATORIO_QUERIES;

export interface RelatorioData {
  type: RelatorioType;
  data: Record<string, unknown>[];
  processed?: boolean;
}

/**
 * Executa uma query de relatório
 */
export async function executarQueryRelatorio(
  tipo: RelatorioType
): Promise<Record<string, unknown>[]> {
  const queryText = RELATORIO_QUERIES[tipo];
  return await query<Record<string, unknown>>(queryText);
}









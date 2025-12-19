import { query } from '@/lib/db/connection';

// Queries exatas do script Python
export const RELATORIO_QUERIES = {
  produtos: 'SELECT * FROM PRODUTOS',
  
  estoque: 'SELECT * FROM ESTOQUE_PRODUTOS',
  
  produtos_barra: 'SELECT PRODUTO, COR_PRODUTO, TAMANHO, CODIGO_BARRA FROM PRODUTOS_BARRA',
  
  vendas: `
    SELECT vp.FILIAL, vp.DATA_VENDA, vp.PRODUTO, vp.DESC_PRODUTO,
           vp.COR_PRODUTO, vp.DESC_COR_PRODUTO, vp.TAMANHO, p.GRADE, 
           vp.PEDIDO, vp.TICKET, vp.CODIGO_FILIAL, vp.QTDE, vp.QTDE_CANCELADA, 
           vp.PRECO_LIQUIDO, vp.DESCONTO_ITEM, vp.DESCONTO_VENDA, 
           vp.FATOR_VENDA_LIQ, vp.CUSTO, vp.GRUPO_PRODUTO, 
           vp.SUBGRUPO_PRODUTO, vp.LINHA, vp.COLECAO, vp.GRIFFE, 
           vp.VENDEDOR, v.VALOR_TIKET, v.DESCONTO, v.VALOR_VENDA_BRUTA, 
           v.CODIGO_TAB_PRECO, v.CODIGO_DESCONTO, v.OPERACAO_VENDA, 
           v.DATA_HORA_CANCELAMENTO, v.VENDEDOR_APELIDO,
           ISNULL(troca_item.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
           ISNULL(troca_item.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM,
           ISNULL(troca_ticket.QTDE_TROCA_TICKET, 0) AS QTDE_TROCA_TICKET,
           ISNULL(troca_ticket.VALOR_TROCA_TICKET, 0) AS VALOR_TROCA_TICKET
    FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
    LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        ON v.FILIAL = vp.FILIAL AND v.PEDIDO = vp.PEDIDO AND v.TICKET = vp.TICKET
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
    LEFT JOIN (
        SELECT 
            TICKET,
            CODIGO_FILIAL,
            PRODUTO,
            COR_PRODUTO,
            TAMANHO,
            SUM(QTDE) AS QTDE_TROCA,
            SUM((PRECO_LIQUIDO * QTDE) - ISNULL(DESCONTO_ITEM, 0)) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
    ) troca_item ON troca_item.TICKET = vp.TICKET 
        AND troca_item.CODIGO_FILIAL = vp.CODIGO_FILIAL
        AND troca_item.PRODUTO = vp.PRODUTO
        AND ISNULL(troca_item.COR_PRODUTO, '') = ISNULL(vp.COR_PRODUTO, '')
        AND ISNULL(troca_item.TAMANHO, 0) = ISNULL(vp.TAMANHO, 0)
    LEFT JOIN (
        SELECT 
            TICKET,
            CODIGO_FILIAL,
            SUM(QTDE) AS QTDE_TROCA_TICKET,
            SUM((PRECO_LIQUIDO * QTDE) - ISNULL(DESCONTO_ITEM, 0)) AS VALOR_TROCA_TICKET
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL
    ) troca_ticket ON troca_ticket.TICKET = vp.TICKET 
        AND troca_ticket.CODIGO_FILIAL = vp.CODIGO_FILIAL
    WHERE vp.DATA_VENDA >= '2024-01-01'
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
  `,
  
  entradas: `
    SELECT E.ROMANEIO_PRODUTO, E.EMISSAO, E.FILIAL, P.PRODUTO,
           P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL
    FROM ESTOQUE_PROD_ENT AS E
    LEFT JOIN ESTOQUE_PROD1_ENT AS P ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
  `,
  
  cores: 'SELECT COR, DESC_COR FROM CORES_BASICAS',
};

export type RelatorioType = keyof typeof RELATORIO_QUERIES;

export interface RelatorioData {
  type: RelatorioType;
  data: Record<string, any>[];
  processed?: boolean;
}

/**
 * Executa uma query de relatório
 */
export async function executarQueryRelatorio(
  tipo: RelatorioType
): Promise<Record<string, any>[]> {
  const queryText = RELATORIO_QUERIES[tipo];
  return await query<Record<string, any>>(queryText);
}









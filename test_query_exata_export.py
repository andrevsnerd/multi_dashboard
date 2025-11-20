#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testa a query EXATA do script de exportação com todos os LEFT JOINs
"""

import pyodbc
import pandas as pd

# Config conexão
DB_CONFIG = {
    'server': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server"""
    try:
        conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                   f"SERVER={DB_CONFIG['server']};"
                   f"DATABASE={DB_CONFIG['database']};"
                   f"UID={DB_CONFIG['username']};"
                   f"PWD={DB_CONFIG['password']};")
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"[ERRO] Erro conexao: {e}")
        raise

def main():
    """Testa query exata"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'
    
    print("="*80)
    print("TESTE: Query EXATA do exportar_todos_relatorios.py")
    print("="*80)
    
    # Query EXATA do exportar_todos_relatorios.py (linhas 285-315)
    # IMPORTANTE: Usa LEFT JOINs para PRODUTOS, FILIAIS e CLIENTES_VAREJO
    query = f"""
        SELECT f.NF_SAIDA, f.SERIE_NF, f.FILIAL, f.NOME_CLIFOR, fp.PRODUTO,
               fp.COR_PRODUTO, f.MOEDA, f.CAMBIO_NA_DATA, fp.ITEM, fp.ENTREGA,
               fp.PEDIDO_COR, fp.PEDIDO, fp.CAIXA, fp.ROMANEIO, fp.PACKS,
               fp.CUSTO_NA_DATA, fp.QTDE, fp.PRECO, fp.MPADRAO_PRECO,
               fp.DESCONTO_ITEM, fp.MPADRAO_DESCONTO_ITEM, fp.VALOR,
               fp.MPADRAO_VALOR, fp.VALOR_PRODUCAO, fp.MPADRAO_VALOR_PRODUCAO,
               fp.DIF_PRODUCAO, fp.MPADRAO_DIF_PRODUCAO, fp.VALOR_LIQUIDO,
               fp.MPADRAO_VALOR_LIQUIDO, fp.DIF_PRODUCAO_LIQUIDO,
               fp.MPADRAO_DIF_PRODUCAO_LIQUIDO,
               f.EMISSAO, f.CONDICAO_PGTO, f.NATUREZA_SAIDA, f.GERENTE,
               f.REPRESENTANTE, f.DATA_SAIDA, f.TRANSPORTADORA,
               f.TRANSP_REDESPACHO, f.EMPRESA, f.TIPO_FATURAMENTO,
               p.DESC_PRODUTO, p.COLECAO, p.TABELA_OPERACOES, p.TABELA_MEDIDAS,
               p.TIPO_PRODUTO, p.GRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, p.LINHA,
               p.GRADE, p.GRIFFE, p.CARTELA, p.REVENDA, p.MODELAGEM, p.FABRICANTE,
               p.ESTILISTA, p.MODELISTA, fp.DESC_COLECAO, fl.REGIAO, cv.UF
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
        LEFT JOIN FILIAIS fl WITH(NOLOCK) ON f.FILIAL = fl.FILIAL
        LEFT JOIN CLIENTES_VAREJO cv WITH(NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df = pd.read_sql(query, conn)
    
    print(f"Total de registros: {len(df):,}")
    print(f"Soma VALOR_LIQUIDO: {df['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
    print(f"Soma QTDE: {df['QTDE'].fillna(0).sum():,.0f}")
    print()
    print(f"Esperado:")
    print(f"  VALOR_LIQUIDO: 400,056.09")
    print(f"  QTDE: 1,845")
    print()
    print(f"Diferença:")
    print(f"  VALOR_LIQUIDO: {df['VALOR_LIQUIDO'].fillna(0).sum() - 400056.09:,.2f}")
    print(f"  QTDE: {df['QTDE'].fillna(0).sum() - 1845:,.0f}")
    
    # Verificar se há registros com produto NULL
    produtos_null = df[df['PRODUTO'].isna()]
    if len(produtos_null) > 0:
        print(f"\n[AVISO] {len(produtos_null):,} registros com PRODUTO NULL")
    
    # Verificar se há registros com VALOR_LIQUIDO NULL
    valor_null = df[df['VALOR_LIQUIDO'].isna()]
    if len(valor_null) > 0:
        print(f"[AVISO] {len(valor_null):,} registros com VALOR_LIQUIDO NULL")
        print(f"  VALOR desses: {valor_null['VALOR'].fillna(0).sum():,.2f}")
    
    # Testar incluindo natureza 100.71
    print("\n" + "="*80)
    print("TESTE: Incluindo NATUREZA_SAIDA = '100.71'")
    print("="*80)
    
    query_com_10071 = f"""
        SELECT 
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde,
            COUNT(*) AS total_rows
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022', '100.71')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df_10071 = pd.read_sql(query_com_10071, conn)
    row = df_10071.iloc[0]
    
    print(f"Total VALOR_LIQUIDO (incluindo 100.71): {row['total_valor_liquido']:,.2f}")
    print(f"Total QTDE: {row['total_qtde']:,.0f}")
    print(f"Total registros: {row['total_rows']:,}")
    print(f"Diferença: {row['total_valor_liquido'] - 400056.09:,.2f}")
    
    conn.close()

if __name__ == '__main__':
    main()


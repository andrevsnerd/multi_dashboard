#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script simples para mostrar a diferença entre as queries
"""

import pyodbc
import pandas as pd

DB_CONFIG = {
    'server': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
               f"SERVER={DB_CONFIG['server']};"
               f"DATABASE={DB_CONFIG['database']};"
               f"UID={DB_CONFIG['username']};"
               f"PWD={DB_CONFIG['password']};")
    return pyodbc.connect(conn_str)

def main():
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'
    
    print("="*80)
    print("COMPARACAO: Sistema vs Planilha")
    print("="*80)
    print()
    
    # QUERY 1: Como o sistema estava (ERRADO - exclui dia 20)
    print("QUERY 1: Sistema ANTES da correcao (com < em vez de <=)")
    print("-"*80)
    query_errada = f"""
        SELECT 
            COUNT(*) AS total_rows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde,
            MIN(f.EMISSAO) AS primeira_data,
            MAX(f.EMISSAO) AS ultima_data
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= '{START_DATE}T00:00:00'
          AND f.EMISSAO < '{END_DATE}T00:00:00'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df1 = pd.read_sql(query_errada, conn)
    row1 = df1.iloc[0]
    print(f"Registros: {row1['total_rows']:,}")
    print(f"VALOR_LIQUIDO: {row1['total_valor_liquido']:,.2f}")
    print(f"QTDE: {row1['total_qtde']:,.0f}")
    print(f"Ultima data: {row1['ultima_data']}")
    print(f"Diferença do esperado: {row1['total_valor_liquido'] - 400056.09:,.2f}")
    print()
    
    # QUERY 2: Como o sistema está agora (CORRETO - inclui dia 20)
    print("QUERY 2: Sistema DEPOIS da correcao (com <= incluindo dia 20)")
    print("-"*80)
    query_correta = f"""
        SELECT 
            COUNT(*) AS total_rows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde,
            MIN(f.EMISSAO) AS primeira_data,
            MAX(f.EMISSAO) AS ultima_data
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}'
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df2 = pd.read_sql(query_correta, conn)
    row2 = df2.iloc[0]
    print(f"Registros: {row2['total_rows']:,}")
    print(f"VALOR_LIQUIDO: {row2['total_valor_liquido']:,.2f}")
    print(f"QTDE: {row2['total_qtde']:,.0f}")
    print(f"Ultima data: {row2['ultima_data']}")
    print(f"Diferença do esperado: {row2['total_valor_liquido'] - 400056.09:,.2f}")
    print()
    
    # QUERY 3: Query exata do script Python (com LEFT JOINs)
    print("QUERY 3: Query EXATA do script Python (exportar_todos_relatorios.py)")
    print("-"*80)
    query_exata = f"""
        SELECT 
            COUNT(*) AS total_rows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde
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
    df3 = pd.read_sql(query_exata, conn)
    row3 = df3.iloc[0]
    print(f"Registros: {row3['total_rows']:,}")
    print(f"VALOR_LIQUIDO: {row3['total_valor_liquido']:,.2f}")
    print(f"QTDE: {row3['total_qtde']:,.0f}")
    print(f"Diferença do esperado: {row3['total_valor_liquido'] - 400056.09:,.2f}")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Esperado na planilha: 400,056.09")
    print()
    print(f"1. Sistema ANTES (errado):     {row1['total_valor_liquido']:>12,.2f}  (diferença: {row1['total_valor_liquido'] - 400056.09:>10,.2f})")
    print(f"2. Sistema DEPOIS (correto):   {row2['total_valor_liquido']:>12,.2f}  (diferença: {row2['total_valor_liquido'] - 400056.09:>10,.2f})")
    print(f"3. Query exata do Python:      {row3['total_valor_liquido']:>12,.2f}  (diferença: {row3['total_valor_liquido'] - 400056.09:>10,.2f})")
    print()
    print("MELHORIA:")
    print(f"  De {row1['total_valor_liquido']:,.2f} para {row2['total_valor_liquido']:,.2f}")
    print(f"  Ganho: {row2['total_valor_liquido'] - row1['total_valor_liquido']:,.2f}")
    print()
    print("AINDA FALTA:")
    print(f"  {400056.09 - row3['total_valor_liquido']:,.2f} para chegar ao valor da planilha")
    print()
    print("="*80)
    print("O QUE SIGNIFICA:")
    print("="*80)
    print("1. O problema principal (filtro de data) foi CORRIGIDO")
    print("2. Ainda falta 625.60, que pode ser:")
    print("   - Algum registro que a planilha inclui mas a query nao")
    print("   - Algum calculo diferente na planilha")
    print("   - Arredondamento")
    print()
    
    # Verificar registros do dia 20
    print("="*80)
    print("VERIFICACAO: Registros do DIA 20")
    print("="*80)
    query_dia20 = f"""
        SELECT 
            COUNT(*) AS total_rows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) = '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df_dia20 = pd.read_sql(query_dia20, conn)
    row_dia20 = df_dia20.iloc[0]
    print(f"Registros no dia 20: {row_dia20['total_rows']:,}")
    print(f"VALOR_LIQUIDO do dia 20: {row_dia20['total_valor_liquido']:,.2f}")
    print(f"QTDE do dia 20: {row_dia20['total_qtde']:,.0f}")
    print()
    print("Esses registros eram EXCLUIDOS pela query antiga (com <)")
    print("Agora sao INCLUIDOS pela query nova (com <=)")
    
    conn.close()

if __name__ == '__main__':
    main()


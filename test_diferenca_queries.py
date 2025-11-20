#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Compara a query do sistema com a query do Python para encontrar a diferença
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
    print("COMPARANDO: Query Sistema vs Query Python")
    print("="*80)
    print()
    
    # QUERY DO SISTEMA (sem LEFT JOINs extras, sem produtoJoin quando não há filtros)
    print("QUERY DO SISTEMA (sem LEFT JOINs extras)")
    print("-"*80)
    query_sistema = f"""
        SELECT 
            COUNT(*) AS total_rows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}'
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df_sistema = pd.read_sql(query_sistema, conn)
    row_sistema = df_sistema.iloc[0]
    print(f"Registros: {row_sistema['total_rows']:,}")
    print(f"VALOR_LIQUIDO: {row_sistema['total_valor_liquido']:,.2f}")
    print(f"QTDE: {row_sistema['total_qtde']:,.0f}")
    print()
    
    # QUERY DO PYTHON (com LEFT JOINs)
    print("QUERY DO PYTHON (com LEFT JOINs)")
    print("-"*80)
    query_python = f"""
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
    df_python = pd.read_sql(query_python, conn)
    row_python = df_python.iloc[0]
    print(f"Registros: {row_python['total_rows']:,}")
    print(f"VALOR_LIQUIDO: {row_python['total_valor_liquido']:,.2f}")
    print(f"QTDE: {row_python['total_qtde']:,.0f}")
    print()
    
    # DIFERENÇA
    print("="*80)
    print("DIFERENCA")
    print("="*80)
    diff_rows = row_python['total_rows'] - row_sistema['total_rows']
    diff_valor = row_python['total_valor_liquido'] - row_sistema['total_valor_liquido']
    diff_qtde = row_python['total_qtde'] - row_sistema['total_qtde']
    
    print(f"Registros: {diff_rows:,} a mais na query Python")
    print(f"VALOR_LIQUIDO: {diff_valor:,.2f} a mais na query Python")
    print(f"QTDE: {diff_qtde:,.0f} a mais na query Python")
    print()
    
    # Verificar se os LEFT JOINs estão causando duplicatas
    print("="*80)
    print("VERIFICANDO: LEFT JOINs causam duplicatas?")
    print("="*80)
    
    query_verificar_duplicatas = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            fp.ITEM,
            COUNT(*) AS vezes_aparece
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
        GROUP BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM
        HAVING COUNT(*) > 1
    """
    
    df_duplicatas = pd.read_sql(query_verificar_duplicatas, conn)
    if len(df_duplicatas) > 0:
        print(f"[AVISO] Encontradas {len(df_duplicatas):,} duplicatas causadas pelos LEFT JOINs!")
        print("Primeiras 10:")
        print(df_duplicatas.head(10).to_string(index=False))
    else:
        print("[OK] Nenhuma duplicata causada pelos LEFT JOINs")
    
    conn.close()
    
    print()
    print("="*80)
    print("CONCLUSAO")
    print("="*80)
    if diff_rows > 0:
        print(f"Os LEFT JOINs estao retornando {diff_rows:,} registros a mais.")
        print("Isso pode ser porque:")
        print("1. FILIAIS tem multiplos registros para a mesma filial")
        print("2. CLIENTES_VAREJO tem multiplos registros para o mesmo cliente")
        print("3. PRODUTOS tem algum problema")
    else:
        print("Os LEFT JOINs nao estao causando duplicatas.")

if __name__ == '__main__':
    main()


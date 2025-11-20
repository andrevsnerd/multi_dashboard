#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Identifica qual LEFT JOIN está causando duplicatas
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
    print("IDENTIFICANDO: Qual LEFT JOIN causa duplicatas?")
    print("="*80)
    print()
    
    # BASE: Sem LEFT JOINs
    query_base = f"""
        SELECT COUNT(*) AS total_rows
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}'
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df_base = pd.read_sql(query_base, conn)
    base_rows = df_base.iloc[0]['total_rows']
    print(f"BASE (sem LEFT JOINs): {base_rows:,} registros")
    print()
    
    # + PRODUTOS
    query_produtos = f"""
        SELECT COUNT(*) AS total_rows
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}'
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df_produtos = pd.read_sql(query_produtos, conn)
    produtos_rows = df_produtos.iloc[0]['total_rows']
    print(f"+ PRODUTOS: {produtos_rows:,} registros (diferença: {produtos_rows - base_rows:+,})")
    print()
    
    # + FILIAIS
    query_filiais = f"""
        SELECT COUNT(*) AS total_rows
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
        LEFT JOIN FILIAIS fl WITH(NOLOCK) ON f.FILIAL = fl.FILIAL
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}'
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    df_filiais = pd.read_sql(query_filiais, conn)
    filiais_rows = df_filiais.iloc[0]['total_rows']
    print(f"+ FILIAIS: {filiais_rows:,} registros (diferença: {filiais_rows - produtos_rows:+,})")
    print()
    
    # + CLIENTES_VAREJO
    query_completo = f"""
        SELECT COUNT(*) AS total_rows
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
    df_completo = pd.read_sql(query_completo, conn)
    completo_rows = df_completo.iloc[0]['total_rows']
    print(f"+ CLIENTES_VAREJO: {completo_rows:,} registros (diferença: {completo_rows - filiais_rows:+,})")
    print()
    
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Base: {base_rows:,}")
    print(f"Com PRODUTOS: {produtos_rows:,} (+{produtos_rows - base_rows:,})")
    print(f"Com FILIAIS: {filiais_rows:,} (+{filiais_rows - produtos_rows:,})")
    print(f"Com CLIENTES_VAREJO: {completo_rows:,} (+{completo_rows - filiais_rows:,})")
    print()
    
    # Verificar quantos registros há em CLIENTES_VAREJO para o mesmo cliente
    print("="*80)
    print("VERIFICANDO: CLIENTES_VAREJO tem duplicatas?")
    print("="*80)
    query_verificar_cv = f"""
        SELECT 
            f.NOME_CLIFOR,
            COUNT(DISTINCT cv.CLIENTE_VAREJO) AS qtd_registros_cv,
            COUNT(*) AS vezes_aparece
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN CLIENTES_VAREJO cv WITH(NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
        GROUP BY f.NOME_CLIFOR
        HAVING COUNT(DISTINCT cv.CLIENTE_VAREJO) > 1 OR COUNT(*) > COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF + '-' + fp.ITEM)
        ORDER BY vezes_aparece DESC
    """
    df_cv = pd.read_sql(query_verificar_cv, conn)
    if len(df_cv) > 0:
        print(f"Encontrados {len(df_cv):,} clientes com problemas")
        print("Primeiros 10:")
        print(df_cv.head(10).to_string(index=False))
    else:
        print("Nenhum problema encontrado com CLIENTES_VAREJO")
    
    conn.close()

if __name__ == '__main__':
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testa variações de GRADE para encontrar o problema
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
    
    FILIAL_ECOMMERCE = 'SCARFME MATRIZ CMS'
    GRADE_BUSCAR = 'U7'
    
    print("="*80)
    print("TESTE: Variacoes de GRADE U7")
    print("="*80)
    print()
    
    # TESTE 1: Verificar todas as GRADES que contêm "U7" ou "u7"
    print("TESTE 1: GRADES que contem 'U7' ou 'u7'")
    print("-"*80)
    query_variacoes = f"""
        SELECT DISTINCT
            p.GRADE,
            CONVERT(VARCHAR, p.GRADE) AS grade_str,
            LEN(CONVERT(VARCHAR, p.GRADE)) AS tamanho,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND (
            CONVERT(VARCHAR, p.GRADE) LIKE '%U7%'
            OR CONVERT(VARCHAR, p.GRADE) LIKE '%u7%'
            OR CONVERT(VARCHAR, p.GRADE) LIKE '%U 7%'
            OR CONVERT(VARCHAR, p.GRADE) LIKE '%u 7%'
          )
        GROUP BY p.GRADE, CONVERT(VARCHAR, p.GRADE), LEN(CONVERT(VARCHAR, p.GRADE))
        ORDER BY estoque_positivo DESC
    """
    
    df_variacoes = pd.read_sql(query_variacoes, conn)
    if len(df_variacoes) > 0:
        print("GRADES encontradas que contem U7:")
        print(df_variacoes.to_string(index=False))
        total_variacoes = df_variacoes['estoque_positivo'].sum()
        print(f"\nTotal estoque (variacoes de U7): {total_variacoes:,.0f}")
    else:
        print("Nenhuma GRADE encontrada contendo 'U7'")
    print()
    
    # TESTE 2: Verificar se a planilha está usando um filtro diferente
    # Talvez esteja filtrando por produtos que VENDERAM com grade U7, não estoque
    print("TESTE 2: Verificar se a planilha filtra por VENDAS com GRADE U7")
    print("-"*80)
    query_vendas = f"""
        SELECT 
            COUNT(DISTINCT fp.PRODUTO) AS total_produtos_vendidos,
            SUM(fp.QTDE) AS total_qtde_vendida
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
        WHERE f.FILIAL = '{FILIAL_ECOMMERCE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE_BUSCAR}'
    """
    
    df_vendas = pd.read_sql(query_vendas, conn)
    print(f"Produtos VENDIDOS com GRADE U7: {df_vendas.iloc[0]['total_produtos_vendidos']:,}")
    print()
    
    # TESTE 3: Verificar estoque dos produtos que VENDERAM com GRADE U7
    print("TESTE 3: Estoque dos produtos que VENDERAM com GRADE U7")
    print("-"*80)
    query_estoque_vendidos = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND e.PRODUTO IN (
              SELECT DISTINCT fp.PRODUTO
              FROM FATURAMENTO f WITH(NOLOCK)
              JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
                  ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
              LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
              WHERE f.FILIAL = '{FILIAL_ECOMMERCE}'
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
                AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE_BUSCAR}'
          )
    """
    
    df_estoque_vendidos = pd.read_sql(query_estoque_vendidos, conn)
    print(f"Produtos com estoque: {df_estoque_vendidos.iloc[0]['total_produtos']:,}")
    print(f"Estoque total: {df_estoque_vendidos.iloc[0]['estoque_positivo']:,.0f}")
    print()
    
    # TESTE 4: Verificar se há diferença na forma como a GRADE é armazenada
    print("TESTE 4: Analise detalhada das GRADES")
    print("-"*80)
    query_detalhes = f"""
        SELECT TOP 20
            e.PRODUTO,
            p.DESC_PRODUTO,
            p.GRADE,
            CONVERT(VARCHAR, p.GRADE) AS grade_str,
            LEN(CONVERT(VARCHAR, p.GRADE)) AS tamanho,
            e.ESTOQUE,
            ASCII(SUBSTRING(CONVERT(VARCHAR, p.GRADE), 1, 1)) AS primeiro_char_ascii
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
        ORDER BY e.ESTOQUE DESC
    """
    
    df_detalhes = pd.read_sql(query_detalhes, conn)
    print("Primeiros 20 produtos com maior estoque:")
    print(df_detalhes[['PRODUTO', 'DESC_PRODUTO', 'GRADE', 'grade_str', 'ESTOQUE']].to_string(index=False))
    print()
    
    # TESTE 5: Verificar se a planilha está usando uma lógica diferente
    # Talvez esteja somando apenas produtos que têm estoque E que têm grade U7
    # Mas sem fazer JOIN, apenas verificando se o produto tem grade U7
    print("TESTE 5: Estoque de produtos que TEM grade U7 (sem filtro no JOIN)")
    print("-"*80)
    query_sem_filtro_join = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND EXISTS (
              SELECT 1
              FROM PRODUTOS p2 WITH (NOLOCK)
              WHERE p2.PRODUTO = e.PRODUTO
                AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p2.GRADE), '')))) = '{GRADE_BUSCAR}'
          )
    """
    
    df_sem_filtro = pd.read_sql(query_sem_filtro_join, conn)
    print(f"Produtos: {df_sem_filtro.iloc[0]['total_produtos']:,}")
    print(f"Estoque: {df_sem_filtro.iloc[0]['estoque_positivo']:,.0f}")
    print()
    
    # TESTE 6: Verificar todas as filiais para ver se há estoque U7 em outras
    print("TESTE 6: Estoque GRADE U7 em TODAS as filiais")
    print("-"*80)
    query_todas_filiais = f"""
        SELECT 
            e.FILIAL,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.ESTOQUE > 0
          AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE_BUSCAR}'
        GROUP BY e.FILIAL
        ORDER BY estoque_positivo DESC
    """
    
    df_todas = pd.read_sql(query_todas_filiais, conn)
    if len(df_todas) > 0:
        print("Estoque U7 por FILIAL:")
        print(df_todas.to_string(index=False))
        total_todas = df_todas['estoque_positivo'].sum()
        print(f"\nTOTAL (todas as filiais): {total_todas:,.0f}")
    else:
        print("Nenhum estoque encontrado com GRADE U7 em nenhuma filial")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Esperado na planilha (e-commerce, GRADE U7): 109")
    print(f"Estoque direto com filtro U7: 0")
    print(f"Estoque de produtos que VENDERAM com U7: {df_estoque_vendidos.iloc[0]['estoque_positivo']:,.0f}")
    print(f"Estoque usando EXISTS: {df_sem_filtro.iloc[0]['estoque_positivo']:,.0f}")
    
    conn.close()

if __name__ == '__main__':
    main()


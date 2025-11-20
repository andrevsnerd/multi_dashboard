#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testa o estoque com filtro de coleção U7 para e-commerce
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
    COLECAO = 'U7'
    
    print("="*80)
    print("TESTE: Estoque com filtro COLECAO U7 para E-COMMERCE")
    print("="*80)
    print()
    print(f"FILIAL: {FILIAL_ECOMMERCE}")
    print(f"COLECAO: {COLECAO}")
    print()
    
    # TESTE 1: Query com LEFT JOIN (como estava antes)
    print("TESTE 1: Query com LEFT JOIN (ANTES da correcao)")
    print("-"*80)
    query_left = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO
    """
    
    df_left = pd.read_sql(query_left, conn)
    total_left = df_left['positiveStock'].sum() if len(df_left) > 0 else 0
    produtos_left = len(df_left)
    
    print(f"Total de produtos: {produtos_left:,}")
    print(f"Estoque total (apenas positivos): {total_left:,.0f}")
    print()
    
    # TESTE 2: Query com INNER JOIN (como deve ser após correção)
    print("TESTE 2: Query com INNER JOIN (DEPOIS da correcao)")
    print("-"*80)
    query_inner = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO
    """
    
    df_inner = pd.read_sql(query_inner, conn)
    total_inner = df_inner['positiveStock'].sum() if len(df_inner) > 0 else 0
    produtos_inner = len(df_inner)
    
    print(f"Total de produtos: {produtos_inner:,}")
    print(f"Estoque total (apenas positivos): {total_inner:,.0f}")
    print()
    
    # TESTE 3: Verificar produtos sem coleção que estão sendo incluídos com LEFT JOIN
    print("TESTE 3: Produtos sem COLECAO que estao sendo incluidos (LEFT JOIN)")
    print("-"*80)
    query_sem_colecao = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND (
            p.COLECAO IS NULL 
            OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = ''
            OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) != '{COLECAO}'
          )
    """
    
    df_sem_colecao = pd.read_sql(query_sem_colecao, conn)
    total_sem_colecao = df_sem_colecao.iloc[0]['estoque_positivo'] if len(df_sem_colecao) > 0 and df_sem_colecao.iloc[0]['estoque_positivo'] is not None else 0
    produtos_sem_colecao = df_sem_colecao.iloc[0]['total_produtos'] if len(df_sem_colecao) > 0 else 0
    
    print(f"Produtos sem colecao ou com colecao diferente: {produtos_sem_colecao:,}")
    print(f"Estoque desses produtos: {total_sem_colecao:,.0f}")
    print()
    
    # TESTE 4: Verificar produtos que não fazem JOIN com PRODUTOS
    print("TESTE 4: Produtos sem JOIN com PRODUTOS")
    print("-"*80)
    query_sem_join = f"""
        SELECT 
            COUNT(*) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND p.PRODUTO IS NULL
    """
    
    df_sem_join = pd.read_sql(query_sem_join, conn)
    total_sem_join = df_sem_join.iloc[0]['estoque_positivo'] if len(df_sem_join) > 0 and df_sem_join.iloc[0]['estoque_positivo'] is not None else 0
    produtos_sem_join = df_sem_join.iloc[0]['total_produtos'] if len(df_sem_join) > 0 else 0
    
    print(f"Produtos sem JOIN (nao existem em PRODUTOS): {produtos_sem_join:,}")
    print(f"Estoque desses produtos: {total_sem_join:,.0f}")
    print()
    
    # TESTE 5: Verificar distribuição de coleções
    print("TESTE 5: Distribuicao de COLECOES na filial")
    print("-"*80)
    query_distribuicao = f"""
        SELECT 
            UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, 'SEM COLECAO')))) AS colecao,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
        GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, 'SEM COLECAO'))))
        ORDER BY estoque_positivo DESC
    """
    
    df_distribuicao = pd.read_sql(query_distribuicao, conn)
    print("Estoque por COLECAO:")
    print(df_distribuicao.to_string(index=False))
    print()
    
    # TESTE 6: Comparação detalhada
    print("TESTE 6: Comparacao detalhada")
    print("-"*80)
    print(f"LEFT JOIN: {total_left:,.0f} (produtos: {produtos_left:,})")
    print(f"INNER JOIN: {total_inner:,.0f} (produtos: {produtos_inner:,})")
    print(f"Diferença: {total_left - total_inner:,.0f}")
    print()
    print("Produtos que estao no LEFT JOIN mas nao no INNER JOIN:")
    produtos_left_set = set(df_left['productId'].astype(str).str.strip()) if len(df_left) > 0 else set()
    produtos_inner_set = set(df_inner['productId'].astype(str).str.strip()) if len(df_inner) > 0 else set()
    produtos_extra = produtos_left_set - produtos_inner_set
    
    if produtos_extra:
        print(f"Total: {len(produtos_extra)} produtos")
        print("Primeiros 10 produtos:")
        for i, produto in enumerate(list(produtos_extra)[:10]):
            print(f"  {i+1}. {produto}")
    else:
        print("Nenhum produto extra encontrado")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"LEFT JOIN (ANTES): {total_left:,.0f}")
    print(f"INNER JOIN (DEPOIS): {total_inner:,.0f}")
    print(f"Produtos sem colecao incluidos: {total_sem_colecao:,.0f}")
    print(f"Produtos sem JOIN incluidos: {total_sem_join:,.0f}")
    print()
    print("CORRECAO NECESSARIA:")
    print("  - Usar INNER JOIN quando ha filtro de colecao")
    print("  - Isso garante que apenas produtos com colecao sejam incluidos")
    
    conn.close()

if __name__ == '__main__':
    main()


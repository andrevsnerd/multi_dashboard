#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste específico para identificar o problema quando filial é VAREJO e coleção é U7
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
    
    # Filiais normais (sem e-commerce) - conforme configurado no sistema
    FILIAIS_VAREJO = [
        'SCARFME MATRIZ',
        'SCARFME MORUMBI',
        'SCARFME VILLA LOBOS',
        'SCARFME IGUATEMI',
        'SCARFME HIGIENOPOLIS',
        'SCARFME VILLA LOBOS FRS',
        'SCARFME MATRIZ JRR',
        'SCARFME BH SHOPPING',
        'SCARFME MORUMBI RDRRRJ'
    ]
    
    COLECAO = 'U7'
    VALOR_ERRADO = 31413
    
    print("="*80)
    print("TESTE: Estoque VAREJO com coleção U7 - Identificando o problema")
    print("="*80)
    print()
    print(f"Valor errado reportado: {VALOR_ERRADO:,}")
    print()
    
    # TESTE 1: Query EXATA do sistema (INNER JOIN + filtro VAREJO + filtro coleção)
    print("TESTE 1: Query EXATA do sistema (INNER JOIN + VAREJO + U7)")
    print("-"*80)
    placeholders = ','.join([f"'{f}'" for f in FILIAIS_VAREJO])
    query_sistema = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS positiveValue
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO
    """
    
    df_sistema = pd.read_sql(query_sistema, conn)
    
    # Aplicar lógica do sistema: apenas produtos com estoque positivo
    total_sistema = 0
    produtos_com_positivo = 0
    for _, row in df_sistema.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_sistema += positive_stock
            produtos_com_positivo += 1
    
    print(f"Total de produtos: {len(df_sistema):,}")
    print(f"Produtos com estoque positivo: {produtos_com_positivo:,}")
    print(f"Estoque total (apenas positivos): {total_sistema:,.0f}")
    print(f"Valor errado reportado: {VALOR_ERRADO:,}")
    print(f"Diferença: {abs(VALOR_ERRADO - total_sistema):,.0f}")
    print()
    
    # TESTE 2: Query com LEFT JOIN (como estava antes)
    print("TESTE 2: Query com LEFT JOIN (ANTES da correção)")
    print("-"*80)
    query_left = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO
    """
    
    df_left = pd.read_sql(query_left, conn)
    total_left = 0
    for _, row in df_left.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_left += positive_stock
    
    print(f"Total de produtos: {len(df_left):,}")
    print(f"Estoque total: {total_left:,.0f}")
    print()
    
    # TESTE 3: Verificar se há produtos sem coleção sendo incluídos
    print("TESTE 3: Produtos sem coleção ou com coleção diferente")
    print("-"*80)
    query_sem_colecao = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND e.ESTOQUE > 0
          AND (
            p.COLECAO IS NULL 
            OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = ''
            OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) != '{COLECAO}'
          )
    """
    
    df_sem_colecao = pd.read_sql(query_sem_colecao, conn)
    total_sem_colecao = df_sem_colecao.iloc[0]['estoque_positivo'] if len(df_sem_colecao) > 0 and df_sem_colecao.iloc[0]['estoque_positivo'] is not None else 0
    
    print(f"Estoque de produtos sem coleção ou com coleção diferente: {total_sem_colecao:,.0f}")
    print()
    
    # TESTE 4: Verificar se o problema está na agregação (sem GROUP BY)
    print("TESTE 4: Estoque total sem GROUP BY (soma direta)")
    print("-"*80)
    query_sem_group = f"""
        SELECT 
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
    """
    
    df_sem_group = pd.read_sql(query_sem_group, conn)
    total_sem_group = df_sem_group.iloc[0]['estoque_positivo'] if len(df_sem_group) > 0 and df_sem_group.iloc[0]['estoque_positivo'] is not None else 0
    
    print(f"Estoque total (sem GROUP BY): {total_sem_group:,.0f}")
    print()
    
    # TESTE 5: Verificar se há produtos duplicados (mesmo produto em múltiplas filiais)
    print("TESTE 5: Verificando produtos em múltiplas filiais")
    print("-"*80)
    query_duplicados = f"""
        SELECT 
            e.PRODUTO,
            COUNT(DISTINCT e.FILIAL) AS filiais_distintas,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_total
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
        GROUP BY e.PRODUTO
        HAVING COUNT(DISTINCT e.FILIAL) > 1
        ORDER BY filiais_distintas DESC, estoque_total DESC
    """
    
    df_duplicados = pd.read_sql(query_duplicados, conn)
    if len(df_duplicados) > 0:
        print(f"Produtos em múltiplas filiais: {len(df_duplicados):,}")
        estoque_duplicados = df_duplicados['estoque_total'].sum()
        print(f"Estoque total desses produtos: {estoque_duplicados:,.0f}")
    else:
        print("Nenhum produto em múltiplas filiais")
    print()
    
    # TESTE 6: Verificar se o problema está no filtro de filial (talvez esteja incluindo e-commerce)
    print("TESTE 6: Verificando se há estoque de e-commerce sendo incluído")
    print("-"*80)
    query_ecommerce = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = 'SCARFME MATRIZ CMS'
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
    """
    
    df_ecommerce = pd.read_sql(query_ecommerce, conn)
    total_ecommerce = df_ecommerce.iloc[0]['estoque_positivo'] if len(df_ecommerce) > 0 and df_ecommerce.iloc[0]['estoque_positivo'] is not None else 0
    
    print(f"Estoque e-commerce (não deveria estar incluído): {total_ecommerce:,.0f}")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Valor errado reportado: {VALOR_ERRADO:,}")
    print(f"Sistema (INNER JOIN + GROUP BY): {total_sistema:,.0f}")
    print(f"LEFT JOIN: {total_left:,.0f}")
    print(f"Sem GROUP BY: {total_sem_group:,.0f}")
    print(f"E-commerce (não deveria estar): {total_ecommerce:,.0f}")
    print()
    print("ANÁLISE:")
    if abs(VALOR_ERRADO - total_sistema) < 100:
        print("  - O valor do sistema está próximo do valor errado")
        print("  - Pode haver problema na lógica de agregação")
    elif abs(VALOR_ERRADO - total_sem_group) < 100:
        print("  - O valor sem GROUP BY está próximo do valor errado")
        print("  - Pode haver problema no GROUP BY")
    elif abs(VALOR_ERRADO - (total_sistema + total_ecommerce)) < 100:
        print("  - O valor errado pode ser a soma de VAREJO + E-COMMERCE")
        print("  - O filtro de filial pode estar incluindo e-commerce incorretamente")
    else:
        print("  - O valor errado não corresponde a nenhum dos testes")
        print("  - Pode haver problema em outro lugar")
    
    conn.close()

if __name__ == '__main__':
    main()


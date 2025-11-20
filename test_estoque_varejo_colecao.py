#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testa estoque com filtro de coleção quando filial é VAREJO (todas as filiais normais)
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
    
    FILIAL_ECOMMERCE = 'SCARFME MATRIZ CMS'
    COLECAO = 'U7'
    
    print("="*80)
    print("TESTE: Estoque COLECAO U7 - VAREJO (todas as filiais normais)")
    print("="*80)
    print()
    
    # TESTE 1: Estoque apenas nas filiais VAREJO (sem e-commerce)
    print("TESTE 1: Estoque nas FILIAIS VAREJO (sem e-commerce)")
    print("-"*80)
    placeholders = ','.join([f"'{f}'" for f in FILIAIS_VAREJO])
    query_varejo = f"""
        SELECT 
            e.PRODUTO AS productId,
            e.FILIAL,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO, e.FILIAL
    """
    
    df_varejo = pd.read_sql(query_varejo, conn)
    
    # Agregar por produto (somar estoque de todas as filiais varejo)
    df_agregado = df_varejo.groupby('productId').agg({
        'positiveStock': 'sum',
        'positiveCount': 'sum'
    }).reset_index()
    
    total_varejo = 0
    produtos_com_positivo = 0
    for _, row in df_agregado.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_varejo += positive_stock
            produtos_com_positivo += 1
    
    print(f"Total de produtos: {len(df_agregado):,}")
    print(f"Produtos com estoque positivo: {produtos_com_positivo:,}")
    print(f"Estoque total (apenas positivos): {total_varejo:,.0f}")
    print()
    
    # TESTE 2: Estoque por filial VAREJO
    print("TESTE 2: Estoque por FILIAL VAREJO")
    print("-"*80)
    query_por_filial = f"""
        SELECT 
            e.FILIAL,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
        GROUP BY e.FILIAL
        ORDER BY estoque_positivo DESC
    """
    
    df_por_filial = pd.read_sql(query_por_filial, conn)
    print("Estoque por FILIAL VAREJO:")
    print(df_por_filial.to_string(index=False))
    print()
    
    # TESTE 3: Comparar com e-commerce
    print("TESTE 3: Comparacao E-COMMERCE vs VAREJO")
    print("-"*80)
    query_ecommerce = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
    """
    
    df_ecommerce = pd.read_sql(query_ecommerce, conn)
    total_ecommerce = df_ecommerce.iloc[0]['estoque_positivo'] if len(df_ecommerce) > 0 and df_ecommerce.iloc[0]['estoque_positivo'] is not None else 0
    produtos_ecommerce = df_ecommerce.iloc[0]['total_produtos'] if len(df_ecommerce) > 0 else 0
    
    print(f"E-COMMERCE: {total_ecommerce:,.0f} (produtos: {produtos_ecommerce:,})")
    print(f"VAREJO: {total_varejo:,.0f} (produtos: {produtos_com_positivo:,})")
    print()
    
    # TESTE 4: Verificar se há produtos sem coleção sendo incluídos incorretamente
    print("TESTE 4: Verificando produtos sem colecao ou com colecao diferente")
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
    produtos_sem_colecao = df_sem_colecao.iloc[0]['total_produtos'] if len(df_sem_colecao) > 0 else 0
    
    print(f"Produtos sem colecao ou com colecao diferente: {produtos_sem_colecao:,}")
    print(f"Estoque desses produtos: {total_sem_colecao:,.0f}")
    print()
    
    # TESTE 5: Verificar se LEFT JOIN vs INNER JOIN faz diferença
    print("TESTE 5: Comparacao LEFT JOIN vs INNER JOIN")
    print("-"*80)
    query_left = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
    """
    
    df_left = pd.read_sql(query_left, conn)
    total_left = df_left.iloc[0]['estoque_positivo'] if len(df_left) > 0 and df_left.iloc[0]['estoque_positivo'] is not None else 0
    
    print(f"LEFT JOIN: {total_left:,.0f}")
    print(f"INNER JOIN: {total_varejo:,.0f}")
    print(f"Diferença: {total_left - total_varejo:,.0f}")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"VAREJO (INNER JOIN): {total_varejo:,.0f}")
    print(f"VAREJO (LEFT JOIN): {total_left:,.0f}")
    print(f"E-COMMERCE: {total_ecommerce:,.0f}")
    print(f"TOTAL (VAREJO + E-COMMERCE): {total_varejo + total_ecommerce:,.0f}")
    print()
    print("OBSERVACAO:")
    print("  - INNER JOIN garante que apenas produtos com colecao sejam incluidos")
    print("  - LEFT JOIN pode incluir produtos sem colecao se o filtro nao for aplicado corretamente")
    print("  - O sistema deve usar INNER JOIN quando ha filtro de colecao")
    
    conn.close()

if __name__ == '__main__':
    main()


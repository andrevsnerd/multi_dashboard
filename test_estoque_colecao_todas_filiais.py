#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testa estoque com filtro de coleção U7 em TODAS as filiais vs apenas e-commerce
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
    print("TESTE: Estoque COLECAO U7 - E-COMMERCE vs TODAS AS FILIAIS")
    print("="*80)
    print()
    
    # TESTE 1: Apenas filial e-commerce
    print("TESTE 1: Apenas FILIAL E-COMMERCE")
    print("-"*80)
    query_ecommerce = f"""
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
    
    df_ecommerce = pd.read_sql(query_ecommerce, conn)
    total_ecommerce = 0
    for _, row in df_ecommerce.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_ecommerce += positive_stock
    
    print(f"Total de produtos: {len(df_ecommerce):,}")
    print(f"Estoque total: {total_ecommerce:,.0f}")
    print()
    
    # TESTE 2: Todas as filiais SCARFME
    print("TESTE 2: TODAS AS FILIAIS SCARFME")
    print("-"*80)
    query_todas = f"""
        SELECT 
            e.PRODUTO AS productId,
            e.FILIAL,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN (
            'SCARFME MATRIZ',
            'SCARFME MATRIZ CMS',
            'SCARFME MORUMBI',
            'SCARFME VILLA LOBOS',
            'SCARFME IGUATEMI',
            'SCARFME HIGIENOPOLIS',
            'SCARFME VILLA LOBOS FRS',
            'SCARFME MATRIZ JRR',
            'SCARFME BH SHOPPING',
            'SCARFME MORUMBI RDRRRJ'
        )
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO, e.FILIAL
    """
    
    df_todas = pd.read_sql(query_todas, conn)
    
    # Agregar por produto (somar estoque de todas as filiais)
    df_agregado = df_todas.groupby('productId').agg({
        'positiveStock': 'sum',
        'positiveCount': 'sum'
    }).reset_index()
    
    total_todas = 0
    for _, row in df_agregado.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_todas += positive_stock
    
    print(f"Total de produtos: {len(df_agregado):,}")
    print(f"Estoque total: {total_todas:,.0f}")
    print()
    
    # TESTE 3: Estoque por filial
    print("TESTE 3: Estoque por FILIAL")
    print("-"*80)
    query_por_filial = f"""
        SELECT 
            e.FILIAL,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN (
            'SCARFME MATRIZ',
            'SCARFME MATRIZ CMS',
            'SCARFME MORUMBI',
            'SCARFME VILLA LOBOS',
            'SCARFME IGUATEMI',
            'SCARFME HIGIENOPOLIS',
            'SCARFME VILLA LOBOS FRS',
            'SCARFME MATRIZ JRR',
            'SCARFME BH SHOPPING',
            'SCARFME MORUMBI RDRRRJ'
        )
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
        GROUP BY e.FILIAL
        ORDER BY estoque_positivo DESC
    """
    
    df_por_filial = pd.read_sql(query_por_filial, conn)
    print("Estoque por FILIAL:")
    print(df_por_filial.to_string(index=False))
    print()
    
    # TESTE 4: Verificar se há produtos duplicados
    print("TESTE 4: Verificando duplicatas")
    print("-"*80)
    query_duplicatas = f"""
        SELECT 
            e.PRODUTO,
            COUNT(*) AS total_linhas,
            COUNT(DISTINCT e.FILIAL) AS filiais_distintas
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
          AND e.ESTOQUE > 0
        GROUP BY e.PRODUTO
        HAVING COUNT(*) > 1
    """
    
    df_duplicatas = pd.read_sql(query_duplicatas, conn)
    if len(df_duplicatas) > 0:
        print(f"Produtos com multiplas linhas: {len(df_duplicatas):,}")
        print("Primeiros 10:")
        print(df_duplicatas.head(10).to_string(index=False))
    else:
        print("Nenhuma duplicata encontrada")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"E-COMMERCE apenas: {total_ecommerce:,.0f}")
    print(f"TODAS AS FILIAIS: {total_todas:,.0f}")
    print(f"Diferença: {total_todas - total_ecommerce:,.0f}")
    print()
    print("OBSERVACAO:")
    print("  - Se a planilha mostra um valor diferente, pode ser que esteja")
    print("    somando estoque de todas as filiais, não apenas e-commerce")
    
    conn.close()

if __name__ == '__main__':
    main()


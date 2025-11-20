#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Testa o estoque com filtro de grade U7 para e-commerce
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
    GRADE = 'U7'
    
    print("="*80)
    print("TESTE: Estoque com filtro GRADE U7 para E-COMMERCE")
    print("="*80)
    print()
    print(f"FILIAL: {FILIAL_ECOMMERCE}")
    print(f"GRADE: {GRADE}")
    print()
    
    # TESTE 0: Verificar todos os produtos com estoque na filial
    print("TESTE 0: Todos os produtos com estoque na filial (sem filtro de GRADE)")
    print("-"*80)
    query_todos = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
    """
    
    df_todos = pd.read_sql(query_todos, conn)
    print(f"Total de produtos com estoque positivo: {df_todos.iloc[0]['total_produtos']:,}")
    print(f"Estoque total: {df_todos.iloc[0]['estoque_positivo']:,.0f}")
    print()
    
    # TESTE 1: Query do sistema (como está implementado)
    print("TESTE 1: Query do SISTEMA (com LEFT JOIN PRODUTOS e filtro GRADE U7)")
    print("-"*80)
    query_sistema = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE}'
        GROUP BY e.PRODUTO
    """
    
    df_sistema = pd.read_sql(query_sistema, conn)
    total_sistema = df_sistema['positiveStock'].sum()
    produtos_sistema = len(df_sistema)
    
    print(f"Total de produtos: {produtos_sistema:,}")
    print(f"Estoque total (apenas positivos): {total_sistema:,.0f}")
    print()
    
    # TESTE 2: Verificar se há produtos sem GRADE (NULL) que estão sendo incluídos
    print("TESTE 2: Verificando produtos com GRADE NULL")
    print("-"*80)
    query_null = f"""
        SELECT 
            COUNT(*) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND (p.GRADE IS NULL OR CONVERT(VARCHAR, p.GRADE) = '')
    """
    
    df_null = pd.read_sql(query_null, conn)
    total_null = df_null.iloc[0]['total_produtos'] if len(df_null) > 0 else 0
    estoque_null = df_null.iloc[0]['estoque_positivo'] if len(df_null) > 0 and df_null.iloc[0]['estoque_positivo'] is not None else 0
    print(f"Produtos com GRADE NULL ou vazio: {total_null:,}")
    print(f"Estoque desses produtos: {estoque_null:,.0f}")
    print()
    
    # TESTE 3: Verificar se o filtro está funcionando corretamente
    print("TESTE 3: Verificando filtro de GRADE")
    print("-"*80)
    query_verificar = f"""
        SELECT 
            p.GRADE,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
        GROUP BY p.GRADE
        ORDER BY estoque_positivo DESC
    """
    
    df_verificar = pd.read_sql(query_verificar, conn)
    print("Estoque por GRADE:")
    print(df_verificar.to_string(index=False))
    print()
    
    # TESTE 4: Verificar se há produtos que não fazem JOIN com PRODUTOS
    print("TESTE 4: Produtos sem JOIN com PRODUTOS")
    print("-"*80)
    query_sem_join = f"""
        SELECT 
            COUNT(*) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND p.PRODUTO IS NULL
    """
    
    df_sem_join = pd.read_sql(query_sem_join, conn)
    total_sem_join = df_sem_join.iloc[0]['total_produtos'] if len(df_sem_join) > 0 else 0
    estoque_sem_join = df_sem_join.iloc[0]['estoque_positivo'] if len(df_sem_join) > 0 and df_sem_join.iloc[0]['estoque_positivo'] is not None else 0
    print(f"Produtos sem JOIN (não existem em PRODUTOS): {total_sem_join:,}")
    print(f"Estoque desses produtos: {estoque_sem_join:,.0f}")
    print()
    
    # TESTE 5: Query usando INNER JOIN (como pode estar na planilha)
    print("TESTE 5: Query com INNER JOIN (pode ser como na planilha)")
    print("-"*80)
    query_inner = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE}'
        GROUP BY e.PRODUTO
    """
    
    df_inner = pd.read_sql(query_inner, conn)
    total_inner = df_inner['positiveStock'].sum()
    produtos_inner = len(df_inner)
    
    print(f"Total de produtos: {produtos_inner:,}")
    print(f"Estoque total (apenas positivos): {total_inner:,.0f}")
    print()
    
    # TESTE 6: Verificar se há diferença entre LEFT JOIN e INNER JOIN
    print("TESTE 6: Comparação LEFT JOIN vs INNER JOIN")
    print("-"*80)
    print(f"LEFT JOIN: {total_sistema:,.0f} (produtos: {produtos_sistema:,})")
    print(f"INNER JOIN: {total_inner:,.0f} (produtos: {produtos_inner:,})")
    print(f"Diferença: {total_sistema - total_inner:,.0f}")
    print()
    
    # TESTE 7: Verificar se há produtos com estoque positivo mas GRADE diferente de U7
    print("TESTE 7: Produtos que passam pelo filtro mas não deveriam")
    print("-"*80)
    query_errado = f"""
        SELECT 
            e.PRODUTO,
            p.GRADE,
            e.ESTOQUE,
            p.DESC_PRODUTO
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND (
            UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE}'
            OR p.GRADE IS NULL
            OR CONVERT(VARCHAR, p.GRADE) = ''
          )
        ORDER BY e.ESTOQUE DESC
    """
    
    df_errado = pd.read_sql(query_errado, conn)
    
    # Separar por GRADE
    df_u7 = df_errado[df_errado['GRADE'].astype(str).str.strip().str.upper() == GRADE]
    df_outros = df_errado[df_errado['GRADE'].astype(str).str.strip().str.upper() != GRADE]
    
    print(f"Produtos com GRADE = U7: {len(df_u7):,} (estoque: {df_u7['ESTOQUE'].sum():,.0f})")
    print(f"Produtos com GRADE diferente ou NULL: {len(df_outros):,} (estoque: {df_outros['ESTOQUE'].sum():,.0f})")
    
    if len(df_outros) > 0:
        print("\nPrimeiros 10 produtos com GRADE diferente ou NULL que estão sendo incluídos:")
        print(df_outros[['PRODUTO', 'GRADE', 'ESTOQUE', 'DESC_PRODUTO']].head(10).to_string(index=False))
    
    # TESTE 8: Estoque geral (todas as filiais)
    print()
    print("="*80)
    print("TESTE 8: Estoque GERAL (todas as filiais) com GRADE U7")
    print("="*80)
    query_geral = f"""
        SELECT 
            e.FILIAL,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{GRADE}'
        GROUP BY e.FILIAL
        ORDER BY estoque_positivo DESC
    """
    
    df_geral = pd.read_sql(query_geral, conn)
    total_geral = df_geral['estoque_positivo'].sum()
    
    print("Estoque por FILIAL:")
    print(df_geral.to_string(index=False))
    print()
    print(f"TOTAL GERAL (todas as filiais): {total_geral:,.0f}")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Esperado na planilha (e-commerce, GRADE U7): 109")
    print(f"Sistema mostra (LEFT JOIN): {total_sistema:,.0f}")
    print(f"Sistema mostra (INNER JOIN): {total_inner:,.0f}")
    print(f"Estoque geral (todas as filiais): {total_geral:,.0f}")
    print()
    print("Diferencas:")
    print(f"  LEFT JOIN vs Planilha: {total_sistema - 109:,.0f}")
    print(f"  INNER JOIN vs Planilha: {total_inner - 109:,.0f}")
    print(f"  LEFT JOIN vs INNER JOIN: {total_sistema - total_inner:,.0f}")
    
    conn.close()

if __name__ == '__main__':
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste completo do estoque com filtro de coleção U7
Compara diferentes abordagens e verifica qual está correta
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
    print("TESTE COMPLETO: Estoque com filtro COLECAO U7")
    print("="*80)
    print()
    
    # TESTE 1: Query exata do sistema (com INNER JOIN após correção)
    print("TESTE 1: Query do SISTEMA (INNER JOIN + filtro COLECAO)")
    print("-"*80)
    query_sistema = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
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
    print()
    
    # TESTE 2: Query sem filtro de coleção (para comparar)
    print("TESTE 2: Estoque TOTAL sem filtro de coleção")
    print("-"*80)
    query_sem_filtro = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
    """
    
    df_sem_filtro = pd.read_sql(query_sem_filtro, conn)
    total_sem_filtro = df_sem_filtro.iloc[0]['estoque_positivo'] if len(df_sem_filtro) > 0 and df_sem_filtro.iloc[0]['estoque_positivo'] is not None else 0
    produtos_sem_filtro = df_sem_filtro.iloc[0]['total_produtos'] if len(df_sem_filtro) > 0 else 0
    
    print(f"Total de produtos: {produtos_sem_filtro:,}")
    print(f"Estoque total: {total_sem_filtro:,.0f}")
    print()
    
    # TESTE 3: Verificar se há produtos com coleção NULL sendo incluídos incorretamente
    print("TESTE 3: Produtos com COLECAO NULL ou vazia")
    print("-"*80)
    query_null = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
          AND (p.COLECAO IS NULL OR UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '')
    """
    
    df_null = pd.read_sql(query_null, conn)
    total_null = df_null.iloc[0]['estoque_positivo'] if len(df_null) > 0 and df_null.iloc[0]['estoque_positivo'] is not None else 0
    produtos_null = df_null.iloc[0]['total_produtos'] if len(df_null) > 0 else 0
    
    print(f"Produtos com colecao NULL ou vazia: {produtos_null:,}")
    print(f"Estoque desses produtos: {total_null:,.0f}")
    print()
    
    # TESTE 4: Verificar se o filtro está excluindo produtos corretamente
    print("TESTE 4: Verificando se filtro exclui produtos corretamente")
    print("-"*80)
    query_verificar = f"""
        SELECT 
            UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, 'SEM COLECAO')))) AS colecao,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND e.ESTOQUE > 0
        GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, 'SEM COLECAO'))))
        ORDER BY estoque_positivo DESC
    """
    
    df_verificar = pd.read_sql(query_verificar, conn)
    print("Estoque por COLECAO (apenas produtos que existem em PRODUTOS):")
    print(df_verificar.head(20).to_string(index=False))
    print()
    
    # Verificar especificamente a coleção U7
    df_u7 = df_verificar[df_verificar['colecao'] == COLECAO]
    if len(df_u7) > 0:
        estoque_u7_verificar = df_u7.iloc[0]['estoque_positivo']
        print(f"Estoque U7 (da distribuicao): {estoque_u7_verificar:,.0f}")
    else:
        print(f"Colecao U7 nao encontrada na distribuicao")
    print()
    
    # TESTE 5: Comparar com query que usa LEFT JOIN mas filtra corretamente
    print("TESTE 5: Query com LEFT JOIN mas filtrando apenas produtos com colecao")
    print("-"*80)
    query_left_filtrado = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL = '{FILIAL_ECOMMERCE}'
          AND p.COLECAO IS NOT NULL
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO
    """
    
    df_left_filtrado = pd.read_sql(query_left_filtrado, conn)
    total_left_filtrado = 0
    for _, row in df_left_filtrado.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_left_filtrado += positive_stock
    
    print(f"Total de produtos: {len(df_left_filtrado):,}")
    print(f"Estoque total: {total_left_filtrado:,.0f}")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Esperado na planilha (colecao U7): ?")
    print(f"Sistema (INNER JOIN): {total_sistema:,.0f}")
    print(f"LEFT JOIN filtrado (IS NOT NULL): {total_left_filtrado:,.0f}")
    print(f"Estoque total sem filtro: {total_sem_filtro:,.0f}")
    print(f"Estoque produtos sem colecao: {total_null:,.0f}")
    print()
    print("Diferencas:")
    print(f"  INNER JOIN vs LEFT JOIN filtrado: {total_sistema - total_left_filtrado:,.0f}")
    print()
    print("OBSERVACAO:")
    print("  - INNER JOIN garante que apenas produtos que existem em PRODUTOS sejam incluidos")
    print("  - LEFT JOIN com IS NOT NULL tambem garante que produtos sem colecao sejam excluidos")
    print("  - Ambos devem retornar o mesmo resultado quando ha filtro de colecao")
    
    conn.close()

if __name__ == '__main__':
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste detalhado do estoque quando filial é VAREJO (todas as filiais normais)
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
    
    print("="*80)
    print("TESTE: Estoque VAREJO (todas as filiais normais) - SEM FILTRO")
    print("="*80)
    print()
    
    # TESTE 1: Estoque total nas filiais VAREJO (sem filtro de produto)
    print("TESTE 1: Estoque TOTAL nas FILIAIS VAREJO (sem filtro)")
    print("-"*80)
    placeholders = ','.join([f"'{f}'" for f in FILIAIS_VAREJO])
    query_total = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
        GROUP BY e.PRODUTO
    """
    
    df_total = pd.read_sql(query_total, conn)
    
    total_positive = 0
    produtos_com_positivo = 0
    for _, row in df_total.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_positive += positive_stock
            produtos_com_positivo += 1
    
    print(f"Total de produtos: {len(df_total):,}")
    print(f"Produtos com estoque positivo: {produtos_com_positivo:,}")
    print(f"Estoque total (apenas positivos): {total_positive:,.0f}")
    print()
    
    # TESTE 2: Estoque por filial (para verificar se há duplicação)
    print("TESTE 2: Estoque por FILIAL (verificar duplicacao)")
    print("-"*80)
    query_por_filial = f"""
        SELECT 
            e.FILIAL,
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.FILIAL IN ({placeholders})
          AND e.ESTOQUE > 0
        GROUP BY e.FILIAL
        ORDER BY estoque_positivo DESC
    """
    
    df_por_filial = pd.read_sql(query_por_filial, conn)
    print("Estoque por FILIAL:")
    print(df_por_filial.to_string(index=False))
    soma_por_filial = df_por_filial['estoque_positivo'].sum()
    print(f"\nSoma por filial: {soma_por_filial:,.0f}")
    print(f"Total agregado (TESTE 1): {total_positive:,.0f}")
    print(f"Diferença: {abs(soma_por_filial - total_positive):,.0f}")
    print()
    
    # TESTE 3: Verificar se há produtos duplicados (mesmo produto em múltiplas filiais)
    print("TESTE 3: Verificando produtos em multiplas filiais")
    print("-"*80)
    query_duplicados = f"""
        SELECT 
            e.PRODUTO,
            COUNT(DISTINCT e.FILIAL) AS filiais_distintas,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_total
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.FILIAL IN ({placeholders})
          AND e.ESTOQUE > 0
        GROUP BY e.PRODUTO
        HAVING COUNT(DISTINCT e.FILIAL) > 1
        ORDER BY filiais_distintas DESC, estoque_total DESC
    """
    
    df_duplicados = pd.read_sql(query_duplicados, conn)
    if len(df_duplicados) > 0:
        print(f"Produtos em múltiplas filiais: {len(df_duplicados):,}")
        print("Primeiros 10:")
        print(df_duplicados.head(10).to_string(index=False))
        estoque_duplicados = df_duplicados['estoque_total'].sum()
        print(f"\nEstoque total desses produtos: {estoque_duplicados:,.0f}")
    else:
        print("Nenhum produto em múltiplas filiais")
    print()
    
    # TESTE 4: Comparar com query que agrega corretamente (sem GROUP BY por produto)
    print("TESTE 4: Estoque TOTAL (sem GROUP BY por produto)")
    print("-"*80)
    query_sem_group = f"""
        SELECT 
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.FILIAL IN ({placeholders})
          AND e.ESTOQUE > 0
    """
    
    df_sem_group = pd.read_sql(query_sem_group, conn)
    total_sem_group = df_sem_group.iloc[0]['estoque_positivo'] if len(df_sem_group) > 0 and df_sem_group.iloc[0]['estoque_positivo'] is not None else 0
    
    print(f"Estoque total (sem GROUP BY): {total_sem_group:,.0f}")
    print(f"Estoque total (com GROUP BY): {total_positive:,.0f}")
    print(f"Diferença: {abs(total_sem_group - total_positive):,.0f}")
    print()
    
    # TESTE 5: Verificar se há produtos sem JOIN com PRODUTOS
    print("TESTE 5: Produtos sem JOIN com PRODUTOS")
    print("-"*80)
    query_sem_join = f"""
        SELECT 
            COUNT(DISTINCT e.PRODUTO) AS total_produtos,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_positivo
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND e.ESTOQUE > 0
          AND p.PRODUTO IS NULL
    """
    
    df_sem_join = pd.read_sql(query_sem_join, conn)
    total_sem_join = df_sem_join.iloc[0]['estoque_positivo'] if len(df_sem_join) > 0 and df_sem_join.iloc[0]['estoque_positivo'] is not None else 0
    produtos_sem_join = df_sem_join.iloc[0]['total_produtos'] if len(df_sem_join) > 0 else 0
    
    print(f"Produtos sem JOIN: {produtos_sem_join:,}")
    print(f"Estoque desses produtos: {total_sem_join:,.0f}")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Estoque TOTAL (com GROUP BY por produto): {total_positive:,.0f}")
    print(f"Estoque TOTAL (sem GROUP BY): {total_sem_group:,.0f}")
    print(f"Soma por filial: {soma_por_filial:,.0f}")
    print(f"Produtos sem JOIN: {total_sem_join:,.0f}")
    print()
    print("OBSERVACAO:")
    print("  - Se houver diferença entre GROUP BY e sem GROUP BY, pode haver duplicacao")
    print("  - Se houver diferença entre soma por filial e total, pode haver problema na agregacao")
    
    conn.close()

if __name__ == '__main__':
    main()


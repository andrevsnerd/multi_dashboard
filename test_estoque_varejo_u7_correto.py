#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste com as filiais CORRETAS do config
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
    
    # Filiais CORRETAS do config (inventory)
    FILIAIS_INVENTORY = [
        'GUARULHOS - RSR',
        'IGUATEMI SP - JJJ',
        'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ',
        'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL',
        'SCARFME ME - PAULISTA FFF',
        'SCARF ME - MATRIZ',
        'SCARFME MATRIZ CMS',  # E-commerce
        'VILLA LOBOS - LLL',
    ]
    
    # Filiais VAREJO (todas exceto e-commerce)
    FILIAIS_VAREJO = [f for f in FILIAIS_INVENTORY if f != 'SCARFME MATRIZ CMS']
    
    COLECAO = 'U7'
    VALOR_ERRADO = 31413
    
    print("="*80)
    print("TESTE: Estoque VAREJO com coleção U7 - Filiais CORRETAS")
    print("="*80)
    print()
    print(f"Filiais VAREJO ({len(FILIAIS_VAREJO)}):")
    for f in FILIAIS_VAREJO:
        print(f"  - {f}")
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
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
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
    
    # TESTE 2: Verificar se está incluindo TODAS as filiais (incluindo e-commerce)
    print("TESTE 2: Verificando se está incluindo TODAS as filiais (incluindo e-commerce)")
    print("-"*80)
    placeholders_todas = ','.join([f"'{f}'" for f in FILIAIS_INVENTORY])
    query_todas = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders_todas})
          AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) = '{COLECAO}'
        GROUP BY e.PRODUTO
    """
    
    df_todas = pd.read_sql(query_todas, conn)
    total_todas = 0
    for _, row in df_todas.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_todas += positive_stock
    
    print(f"Estoque TOTAL (todas as filiais incluindo e-commerce): {total_todas:,.0f}")
    print()
    
    # TESTE 3: Verificar se está somando SEM filtro de coleção
    print("TESTE 3: Verificando se está somando SEM filtro de coleção")
    print("-"*80)
    query_sem_filtro = f"""
        SELECT 
            e.PRODUTO AS productId,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            COUNT(CASE WHEN e.ESTOQUE > 0 THEN 1 END) AS positiveCount
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        WHERE e.FILIAL IN ({placeholders})
          AND e.ESTOQUE > 0
        GROUP BY e.PRODUTO
    """
    
    df_sem_filtro = pd.read_sql(query_sem_filtro, conn)
    total_sem_filtro = 0
    for _, row in df_sem_filtro.iterrows():
        positive_count = row['positiveCount'] if pd.notna(row['positiveCount']) else 0
        if positive_count > 0:
            positive_stock = row['positiveStock'] if pd.notna(row['positiveStock']) else 0
            total_sem_filtro += positive_stock
    
    print(f"Estoque VAREJO SEM filtro de coleção: {total_sem_filtro:,.0f}")
    print()
    
    # TESTE 4: Verificar estoque por filial
    print("TESTE 4: Estoque por filial (coleção U7)")
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
    if len(df_por_filial) > 0:
        print("Estoque por FILIAL:")
        print(df_por_filial.to_string(index=False))
        soma_por_filial = df_por_filial['estoque_positivo'].sum()
        print(f"\nSoma por filial: {soma_por_filial:,.0f}")
    else:
        print("Nenhum estoque encontrado")
    print()
    
    # RESUMO
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Valor errado reportado: {VALOR_ERRADO:,}")
    print(f"VAREJO com U7 (correto): {total_sistema:,.0f}")
    print(f"TODAS as filiais com U7: {total_todas:,.0f}")
    print(f"VAREJO SEM filtro: {total_sem_filtro:,.0f}")
    print()
    print("ANÁLISE:")
    if abs(VALOR_ERRADO - total_todas) < 100:
        print("  ❌ PROBLEMA IDENTIFICADO: Está somando TODAS as filiais (incluindo e-commerce)")
        print("     quando deveria somar apenas VAREJO!")
    elif abs(VALOR_ERRADO - total_sem_filtro) < 100:
        print("  ❌ PROBLEMA IDENTIFICADO: Está somando SEM filtro de coleção!")
    else:
        print(f"  ⚠️  O valor {VALOR_ERRADO:,} não corresponde a nenhum dos testes")
        print("     Pode haver problema em outro lugar")
    
    conn.close()

if __name__ == '__main__':
    main()


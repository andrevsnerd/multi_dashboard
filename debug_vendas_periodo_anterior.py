#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para debugar vendas do período anterior e identificar a diferença
"""

import sys
import pyodbc
from datetime import datetime

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

DB_SERVER = '177.92.78.250'
DB_DATABASE = 'LINX_PRODUCAO'
DB_USERNAME = 'andre.nerd'
DB_PASSWORD = 'nerd123@'
DB_PORT = '1433'

def get_db_connection():
    connection_string = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={DB_SERVER},{DB_PORT};"
        f"DATABASE={DB_DATABASE};"
        f"UID={DB_USERNAME};"
        f"PWD={DB_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )
    return pyodbc.connect(connection_string, timeout=60)

def main():
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Período: 2025-12-01 a 2025-12-20
    periodo_start = datetime(2025, 12, 1, 0, 0, 0)
    periodo_end = datetime(2025, 12, 20, 23, 59, 59)
    
    # Filiais de varejo (sem e-commerce)
    filiais_varejo = [
        'GUARULHOS - RSR',
        'IGUATEMI SP - JJJ',
        'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ',
        'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL',
        'SCARFME ME - PAULISTA FFF',
        'SCARF ME - PAULISTA RSR',
        'SCARF ME - MATRIZ',
        'VILLA LOBOS - LLL',
    ]
    
    # Testar sem algumas filiais para encontrar a diferença
    print("🔍 TESTANDO DIFERENTES COMBINAÇÕES DE FILIAIS:")
    print("-" * 80)
    
    # Testar sem SCARF ME - PAULISTA RSR
    filiais_sem_paulista_rsr = [f for f in filiais_varejo if f != 'SCARF ME - PAULISTA RSR']
    placeholders_test = ', '.join(['?' for _ in filiais_sem_paulista_rsr])
    query_test = f"""
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders_test})
    """
    params_test = [periodo_start, periodo_end] + filiais_sem_paulista_rsr
    cursor.execute(query_test, params_test)
    result_test = cursor.fetchone()
    total_sem_paulista_rsr = int(result_test[0] or 0) if result_test else 0
    print(f"Sem 'SCARF ME - PAULISTA RSR': {total_sem_paulista_rsr:,} un")
    
    # Verificar vendas de SCARF ME - PAULISTA RSR
    query_paulista_rsr = """
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL = 'SCARF ME - PAULISTA RSR'
    """
    cursor.execute(query_paulista_rsr, [periodo_start, periodo_end])
    result_paulista_rsr = cursor.fetchone()
    vendas_paulista_rsr = int(result_paulista_rsr[0] or 0) if result_paulista_rsr else 0
    print(f"Vendas 'SCARF ME - PAULISTA RSR': {vendas_paulista_rsr:,} un")
    print()
    
    # Filiais de e-commerce
    filiais_ecommerce = [
        'SCARFME MATRIZ CMS',
        'SCARF ME - MATRIZ LLL',
    ]
    
    print("=" * 80)
    print("DEBUG VENDAS PERÍODO ANTERIOR (2025-12-01 a 2025-12-20)")
    print("=" * 80)
    print()
    
    # 1. Total de vendas por filial
    print("📊 VENDAS POR FILIAL:")
    print("-" * 80)
    
    placeholders = ', '.join(['?' for _ in filiais_varejo])
    query = f"""
        SELECT 
            vp.FILIAL,
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders})
        GROUP BY vp.FILIAL
        ORDER BY vendas DESC
    """
    
    params = [periodo_start, periodo_end] + filiais_varejo
    cursor.execute(query, params)
    
    total_por_filial = 0
    for row in cursor.fetchall():
        filial = row[0]
        vendas = int(row[1] or 0)
        total_por_filial += vendas
        print(f"  {filial}: {vendas:,} un")
    
    print(f"\n  TOTAL: {total_por_filial:,} un")
    print()
    
    # 2. Verificar se há vendas das filiais de e-commerce na tabela de varejo
    print("📊 VENDAS DAS FILIAIS DE E-COMMERCE NA TABELA DE VAREJO:")
    print("-" * 80)
    
    placeholders_ecommerce = ', '.join(['?' for _ in filiais_ecommerce])
    query_ecommerce = f"""
        SELECT 
            vp.FILIAL,
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders_ecommerce})
        GROUP BY vp.FILIAL
    """
    
    params_ecommerce = [periodo_start, periodo_end] + filiais_ecommerce
    cursor.execute(query_ecommerce, params_ecommerce)
    
    total_ecommerce_varejo = 0
    for row in cursor.fetchall():
        filial = row[0]
        vendas = int(row[1] or 0)
        total_ecommerce_varejo += vendas
        print(f"  {filial}: {vendas:,} un")
    
    if total_ecommerce_varejo > 0:
        print(f"\n  ⚠️  TOTAL E-COMMERCE NA TABELA VAREJO: {total_ecommerce_varejo:,} un")
        print(f"  ⚠️  Isso pode estar causando a diferença!")
    else:
        print("  ✅ Nenhuma venda encontrada")
    
    print()
    
    # 3. Total geral (todas as filiais de vendas, incluindo e-commerce)
    print("📊 TOTAL COM TODAS AS FILIAIS (incluindo e-commerce):")
    print("-" * 80)
    
    todas_filiais = filiais_varejo + filiais_ecommerce
    placeholders_todas = ', '.join(['?' for _ in todas_filiais])
    query_todas = f"""
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders_todas})
    """
    
    params_todas = [periodo_start, periodo_end] + todas_filiais
    cursor.execute(query_todas, params_todas)
    result = cursor.fetchone()
    total_todas = int(result[0] or 0) if result else 0
    
    print(f"  Total: {total_todas:,} un")
    print()
    
    # 4. Verificar vendas da filial SCARF ME - MATRIZ
    print("📊 VENDAS DA FILIAL 'SCARF ME - MATRIZ':")
    print("-" * 80)
    query_matriz = """
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL = 'SCARF ME - MATRIZ'
    """
    cursor.execute(query_matriz, [periodo_start, periodo_end])
    result_matriz = cursor.fetchone()
    vendas_matriz = int(result_matriz[0] or 0) if result_matriz else 0
    print(f"  SCARF ME - MATRIZ: {vendas_matriz:,} un")
    print()
    
    # 5. Verificar todas as filiais que têm vendas no período
    print("📊 TODAS AS FILIAIS COM VENDAS NO PERÍODO:")
    print("-" * 80)
    query_todas_filiais = """
        SELECT 
            vp.FILIAL,
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
        GROUP BY vp.FILIAL
        ORDER BY vendas DESC
    """
    cursor.execute(query_todas_filiais, [periodo_start, periodo_end])
    total_geral = 0
    for row in cursor.fetchall():
        filial = row[0]
        vendas = int(row[1] or 0)
        total_geral += vendas
        if filial in filiais_varejo or filial in filiais_ecommerce:
            print(f"  {filial}: {vendas:,} un (✅ na lista)")
        else:
            print(f"  {filial}: {vendas:,} un (⚠️  NÃO está na lista)")
    print(f"\n  TOTAL GERAL: {total_geral:,} un")
    print()
    
    # 6. Comparação
    print("=" * 80)
    print("COMPARAÇÃO")
    print("=" * 80)
    print(f"Vendas apenas filiais varejo: {total_por_filial:,} un")
    print(f"Vendas incluindo e-commerce: {total_todas:,} un")
    print(f"Vendas SCARF ME - MATRIZ: {vendas_matriz:,} un")
    print(f"Total geral (todas as filiais): {total_geral:,} un")
    print(f"Esperado pelo usuário: 4,025 un")
    print(f"Diferença do esperado: {total_por_filial - 4025:,} un")
    
    # 7. Tentar encontrar a diferença
    if total_por_filial - 4025 == 318:
        print()
        print("🔍 ANÁLISE:")
        print(f"  Diferença exata: 318 un")
        print(f"  Isso pode ser uma filial específica ou um conjunto de vendas")
        print(f"  Verifique se há alguma filial que não deveria estar sendo contada")
    
    conn.close()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para encontrar a diferença de 3 unidades
"""

import sys
import pyodbc
from datetime import datetime

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
    
    periodo_start = datetime(2025, 12, 1, 0, 0, 0)
    periodo_end = datetime(2025, 12, 21, 0, 0, 0)
    
    placeholders = ', '.join(['?' for _ in filiais_varejo])
    
    print("=" * 80)
    print("DEBUG DIFERENÇA DE 3 UNIDADES")
    print("=" * 80)
    print()
    
    # Teste 1: Query atual (com QTDE_CANCELADA = 0)
    query1 = f"""
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    params1 = [periodo_start, periodo_end] + filiais_varejo
    cursor.execute(query1, params1)
    result1 = cursor.fetchone()
    total1 = int(result1[0] or 0) if result1 else 0
    
    print(f"📊 Query atual (QTDE_CANCELADA = 0): {total1:,} un")
    print()
    
    # Teste 2: Sem filtro de QTDE_CANCELADA
    query2 = f"""
        SELECT 
            SUM(vp.QTDE) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    cursor.execute(query2, params1)
    result2 = cursor.fetchone()
    total2 = int(result2[0] or 0) if result2 else 0
    
    print(f"📊 Sem filtro QTDE_CANCELADA: {total2:,} un")
    print(f"   Diferença: {total2 - total1:,} un (vendas canceladas)")
    print()
    
    # Teste 3: Verificar se há vendas com QTDE_CANCELADA > 0 mas QTDE > 0
    query3 = f"""
        SELECT 
            COUNT(*) AS registros,
            SUM(vp.QTDE) AS total_qtde,
            SUM(vp.QTDE_CANCELADA) AS total_cancelada
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.QTDE_CANCELADA > 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    cursor.execute(query3, params1)
    result3 = cursor.fetchone()
    if result3 and result3[0] > 0:
        print(f"📊 Vendas com QTDE > 0 E QTDE_CANCELADA > 0:")
        print(f"   Registros: {result3[0]:,}")
        print(f"   Total QTDE: {int(result3[1] or 0):,} un")
        print(f"   Total Cancelada: {int(result3[2] or 0):,} un")
        print()
    
    # Teste 4: Verificar se há alguma venda que está sendo contada incorretamente
    # Verificar vendas por filial para identificar onde está a diferença
    query4 = f"""
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
    
    cursor.execute(query4, params1)
    
    print("📊 VENDAS POR FILIAL:")
    print("-" * 80)
    total_por_filial = 0
    for row in cursor.fetchall():
        filial = row[0]
        vendas = int(row[1] or 0)
        total_por_filial += vendas
        print(f"  {filial}: {vendas:,} un")
    print(f"\n  TOTAL: {total_por_filial:,} un")
    print()
    
    # Teste 5: Verificar se há alguma venda que não está sendo filtrada corretamente
    # Verificar se há vendas com QTDE = 0 ou negativa que estão sendo contadas
    query5 = f"""
        SELECT 
            COUNT(*) AS registros,
            SUM(vp.QTDE) AS total_qtde
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE <= 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    cursor.execute(query5, params1)
    result5 = cursor.fetchone()
    if result5 and result5[0] > 0:
        print(f"⚠️  Vendas com QTDE <= 0: {result5[0]:,} registros")
        print(f"   Total QTDE: {int(result5[1] or 0):,} un")
        print()
    
    print("=" * 80)
    print("RESUMO")
    print("=" * 80)
    print(f"Total esperado pelo usuário: 4,346 un")
    print(f"Total retornado pela query: {total1:,} un")
    print(f"Diferença: {4346 - total1:,} un")
    print()
    print("🔍 POSSÍVEIS CAUSAS:")
    print("  1. Alguma venda está sendo contada duas vezes")
    print("  2. Alguma condição adicional está faltando")
    print("  3. Alguma diferença na forma como as datas estão sendo tratadas")
    print("  4. Alguma filial adicional está sendo incluída")
    
    conn.close()

if __name__ == '__main__':
    main()

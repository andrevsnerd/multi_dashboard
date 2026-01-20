#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para debugar vendas do dia 20 especificamente
"""

import sys
import pyodbc
from datetime import datetime, timedelta

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
    
    placeholders = ', '.join(['?' for _ in filiais_varejo])
    
    print("=" * 80)
    print("DEBUG VENDAS DIA 20")
    print("=" * 80)
    print()
    
    # Teste 1: Período 01 a 20 (inclusivo) - usando < 21
    periodo_start1 = datetime(2025, 12, 1, 0, 0, 0)
    periodo_end1 = datetime(2025, 12, 21, 0, 0, 0)  # Exclusivo (inclui todo dia 20)
    
    query1 = f"""
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    params1 = [periodo_start1, periodo_end1] + filiais_varejo
    cursor.execute(query1, params1)
    result1 = cursor.fetchone()
    total1 = int(result1[0] or 0) if result1 else 0
    
    print(f"📊 Período 01 a 20 (usando < 21): {total1:,} un")
    print()
    
    # Teste 2: Período 01 a 20 (inclusivo) - usando <= 20 23:59:59
    periodo_start2 = datetime(2025, 12, 1, 0, 0, 0)
    periodo_end2 = datetime(2025, 12, 20, 23, 59, 59)
    
    query2 = f"""
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA <= ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    params2 = [periodo_start2, periodo_end2] + filiais_varejo
    cursor.execute(query2, params2)
    result2 = cursor.fetchone()
    total2 = int(result2[0] or 0) if result2 else 0
    
    print(f"📊 Período 01 a 20 (usando <= 20 23:59:59): {total2:,} un")
    print()
    
    # Teste 3: Vendas apenas do dia 20
    dia20_start = datetime(2025, 12, 20, 0, 0, 0)
    dia20_end = datetime(2025, 12, 21, 0, 0, 0)
    
    query3 = f"""
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
    
    params3 = [dia20_start, dia20_end] + filiais_varejo
    cursor.execute(query3, params3)
    
    total_dia20 = 0
    print("📊 VENDAS DO DIA 20:")
    print("-" * 80)
    for row in cursor.fetchall():
        filial = row[0]
        vendas = int(row[1] or 0)
        total_dia20 += vendas
        print(f"  {filial}: {vendas:,} un")
    print(f"\n  TOTAL DIA 20: {total_dia20:,} un")
    print()
    
    # Teste 4: Período 01 a 19 (para comparar)
    periodo_start4 = datetime(2025, 12, 1, 0, 0, 0)
    periodo_end4 = datetime(2025, 12, 20, 0, 0, 0)
    
    query4 = f"""
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            AND vp.FILIAL IN ({placeholders})
    """
    
    params4 = [periodo_start4, periodo_end4] + filiais_varejo
    cursor.execute(query4, params4)
    result4 = cursor.fetchone()
    total4 = int(result4[0] or 0) if result4 else 0
    
    print(f"📊 Período 01 a 19 (usando < 20): {total4:,} un")
    print()
    
    print("=" * 80)
    print("COMPARAÇÃO")
    print("=" * 80)
    print(f"01 a 20 (< 21): {total1:,} un")
    print(f"01 a 20 (<= 20 23:59:59): {total2:,} un")
    print(f"01 a 19 (< 20): {total4:,} un")
    print(f"Vendas dia 20: {total_dia20:,} un")
    print(f"Esperado pelo usuário: 4,346 un")
    print()
    print(f"Diferença (< 21 vs esperado): {total1 - 4346:,} un")
    print(f"Diferença (<= 20 23:59:59 vs esperado): {total2 - 4346:,} un")
    
    conn.close()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para buscar tipos de romaneio disponíveis no banco
"""

import sys
import codecs
import pyodbc
import pandas as pd

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server"""
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
    for nome, servidor in servidores:
        try:
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};"
                       f"DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};"
                       f"PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            return conn
        except:
            continue
    return None

def main():
    """Busca tipos de romaneio para saídas e entradas"""
    conn = conectar_banco()
    if not conn:
        print("Erro ao conectar")
        return
    
    try:
        # Tipos de romaneio para SAÍDAS (transferências)
        query_saidas = """
            SELECT DISTINCT TIPO_ROMANEIO, COUNT(*) AS QTD
            FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
            WHERE FILIAL_DESTINO IS NOT NULL
                AND TIPO_ROMANEIO IS NOT NULL
                AND TIPO_ROMANEIO != ''
            GROUP BY TIPO_ROMANEIO
            ORDER BY QTD DESC
        """
        
        df_saidas = pd.read_sql(query_saidas, conn)
        print("\n📋 TIPOS DE ROMANEIO PARA SAÍDAS (Transferências):")
        print("="*80)
        if not df_saidas.empty:
            for idx, row in df_saidas.iterrows():
                print(f"{idx+1:2d}. {row['TIPO_ROMANEIO']:<40} ({row['QTD']:>5} registros)")
        else:
            print("Nenhum tipo encontrado")
        
        # Tipos de romaneio para ENTRADAS (transferências)
        query_entradas = """
            SELECT DISTINCT TIPO_ROMANEIO, COUNT(*) AS QTD
            FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
            WHERE FILIAL_ORIGEM IS NOT NULL
                AND TIPO_ROMANEIO IS NOT NULL
                AND TIPO_ROMANEIO != ''
            GROUP BY TIPO_ROMANEIO
            ORDER BY QTD DESC
        """
        
        df_entradas = pd.read_sql(query_entradas, conn)
        print("\n📋 TIPOS DE ROMANEIO PARA ENTRADAS (Transferências):")
        print("="*80)
        if not df_entradas.empty:
            for idx, row in df_entradas.iterrows():
                print(f"{idx+1:2d}. {row['TIPO_ROMANEIO']:<40} ({row['QTD']:>5} registros)")
        else:
            print("Nenhum tipo encontrado")
        
        # Tipos mais comuns para transferências (combinando ambos)
        print("\n📋 TIPOS MAIS COMUNS PARA TRANSFERÊNCIAS:")
        print("="*80)
        tipos_comuns = []
        if not df_saidas.empty:
            tipos_comuns.extend(df_saidas['TIPO_ROMANEIO'].tolist())
        if not df_entradas.empty:
            tipos_comuns.extend(df_entradas['TIPO_ROMANEIO'].tolist())
        
        tipos_unicos = list(set(tipos_comuns))
        tipos_unicos.sort()
        
        for idx, tipo in enumerate(tipos_unicos, 1):
            print(f"{idx:2d}. {tipo}")
        
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar campos TIPO_ENTRADA e TIPO_SAIDA nas tabelas
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
    """Conecta ao SQL Server com timeout e fallback"""
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
    ultimo_erro = None
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome}: {servidor})...")
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};"
                       f"DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};"
                       f"PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            if nome == 'fallback':
                print(f"✓ Conectado via servidor fallback ({servidor})")
            else:
                print(f"✓ Conectado ao servidor principal ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
    return None

def investigar_estrutura_entrada(conn):
    """Investiga estrutura de ESTOQUE_PROD_ENT procurando campos de tipo"""
    print("\n" + "="*100)
    print("ESTRUTURA ESTOQUE_PROD_ENT - PROCURANDO CAMPOS DE TIPO")
    print("="*100)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_ENT'
            AND (
                COLUMN_NAME LIKE '%TIPO%'
                OR COLUMN_NAME LIKE '%ENTRADA%'
                OR COLUMN_NAME LIKE '%CATEGORIA%'
            )
        ORDER BY ORDINAL_POSITION
    """
    
    df = pd.read_sql(query, conn)
    if not df.empty:
        print(f"\n✓ Encontrados {len(df)} campos relacionados:")
        print(df.to_string(index=False))
    else:
        print("\n⚠ Nenhum campo com 'TIPO' ou 'ENTRADA' encontrado")
    
    # Buscar TODAS as colunas para ver o que tem
    query_all = """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_ENT'
        ORDER BY ORDINAL_POSITION
    """
    df_all = pd.read_sql(query_all, conn)
    print(f"\n📋 TODAS as colunas de ESTOQUE_PROD_ENT ({len(df_all)} colunas):")
    print(df_all['COLUMN_NAME'].tolist())
    
    return df

def investigar_estrutura_saida(conn):
    """Investiga estrutura de ESTOQUE_PROD_SAI procurando campos de tipo"""
    print("\n" + "="*100)
    print("ESTRUTURA ESTOQUE_PROD_SAI - PROCURANDO CAMPOS DE TIPO")
    print("="*100)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_SAI'
            AND (
                COLUMN_NAME LIKE '%TIPO%'
                OR COLUMN_NAME LIKE '%SAIDA%'
                OR COLUMN_NAME LIKE '%CATEGORIA%'
            )
        ORDER BY ORDINAL_POSITION
    """
    
    df = pd.read_sql(query, conn)
    if not df.empty:
        print(f"\n✓ Encontrados {len(df)} campos relacionados:")
        print(df.to_string(index=False))
    else:
        print("\n⚠ Nenhum campo com 'TIPO' ou 'SAIDA' encontrado")
    
    # Buscar TODAS as colunas para ver o que tem
    query_all = """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_SAI'
        ORDER BY ORDINAL_POSITION
    """
    df_all = pd.read_sql(query_all, conn)
    print(f"\n📋 TODAS as colunas de ESTOQUE_PROD_SAI ({len(df_all)} colunas):")
    print(df_all['COLUMN_NAME'].tolist())
    
    return df

def investigar_valores_tipo(conn):
    """Investiga valores únicos de campos de tipo nas tabelas"""
    print("\n" + "="*100)
    print("VALORES ÚNICOS DE CAMPOS DE TIPO")
    print("="*100)
    
    # Primeiro, descobrir quais campos existem
    query_cols_ent = """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_ENT'
            AND (
                COLUMN_NAME LIKE '%TIPO%'
                OR COLUMN_NAME LIKE '%ENTRADA%'
            )
    """
    cols_ent = pd.read_sql(query_cols_ent, conn)
    
    if not cols_ent.empty:
        for col in cols_ent['COLUMN_NAME']:
            query_vals = f"""
                SELECT DISTINCT {col}, COUNT(*) AS QTD
                FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
                WHERE {col} IS NOT NULL
                GROUP BY {col}
                ORDER BY QTD DESC
            """
            try:
                df_vals = pd.read_sql(query_vals, conn)
                print(f"\n📊 Valores únicos de {col} em ESTOQUE_PROD_ENT:")
                print(df_vals.to_string(index=False))
            except Exception as e:
                print(f"\n⚠ Erro ao buscar valores de {col}: {e}")
    
    query_cols_sai = """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_SAI'
            AND (
                COLUMN_NAME LIKE '%TIPO%'
                OR COLUMN_NAME LIKE '%SAIDA%'
            )
    """
    cols_sai = pd.read_sql(query_cols_sai, conn)
    
    if not cols_sai.empty:
        for col in cols_sai['COLUMN_NAME']:
            query_vals = f"""
                SELECT DISTINCT {col}, COUNT(*) AS QTD
                FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
                WHERE {col} IS NOT NULL
                GROUP BY {col}
                ORDER BY QTD DESC
            """
            try:
                df_vals = pd.read_sql(query_vals, conn)
                print(f"\n📊 Valores únicos de {col} em ESTOQUE_PROD_SAI:")
                print(df_vals.to_string(index=False))
            except Exception as e:
                print(f"\n⚠ Erro ao buscar valores de {col}: {e}")

def main():
    """Função principal"""
    print("="*100)
    print("INVESTIGAÇÃO DE TIPOS DE ENTRADA E SAÍDA")
    print("="*100)
    
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        investigar_estrutura_entrada(conn)
        investigar_estrutura_saida(conn)
        investigar_valores_tipo(conn)
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Investigar triggers em ESTOQUE_PROD1_ENT e ESTOQUE_PROD1_SAI"""

import pyodbc
import pandas as pd

DB_CONFIG = {
    'server': '177.92.78.250',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar():
    conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
               f"SERVER={DB_CONFIG['server']};DATABASE={DB_CONFIG['database']};"
               f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};"
               f"Connection Timeout=30;")
    return pyodbc.connect(conn_str)

def q(conn, sql):
    try:
        return pd.read_sql(sql, conn)
    except Exception as e:
        print(f"  [ERRO] {str(e)[:300]}")
        return pd.DataFrame()

def sep(t): print(f"\n{'='*70}\n  {t}\n{'='*70}")

conn = conectar()
print("[OK] Conectado")

# 1. Listar todos os triggers nas tabelas de interesse
sep("1. TRIGGERS em ESTOQUE_PROD1_ENT e ESTOQUE_PROD1_SAI")
df = q(conn, """
    SELECT
        t.name AS trigger_name,
        OBJECT_NAME(t.parent_id) AS tabela,
        t.type_desc,
        t.is_disabled,
        t.is_instead_of_trigger
    FROM sys.triggers t
    WHERE OBJECT_NAME(t.parent_id) IN (
        'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD1_SAI',
        'ESTOQUE_PROD_ENT', 'ESTOQUE_PROD_SAI'
    )
    ORDER BY tabela, trigger_name
""")
print(df.to_string(index=False) if len(df) > 0 else "NENHUM trigger encontrado nessas tabelas")

# 2. Código-fonte de cada trigger
sep("2. DEFINIÇÃO DOS TRIGGERS")
df_nomes = q(conn, """
    SELECT t.name AS trigger_name, OBJECT_NAME(t.parent_id) AS tabela
    FROM sys.triggers t
    WHERE OBJECT_NAME(t.parent_id) IN (
        'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD1_SAI',
        'ESTOQUE_PROD_ENT', 'ESTOQUE_PROD_SAI'
    )
""")

if len(df_nomes) == 0:
    print("Nenhum trigger para mostrar.")
else:
    for _, row in df_nomes.iterrows():
        print(f"\n--- TRIGGER: {row['trigger_name']} (tabela: {row['tabela']}) ---")
        df_def = q(conn, f"""
            SELECT definition
            FROM sys.sql_modules m
            JOIN sys.triggers t ON m.object_id = t.object_id
            WHERE t.name = '{row['trigger_name']}'
        """)
        if len(df_def) > 0:
            print(df_def['definition'].iloc[0])
        else:
            print("  [sem definição disponível]")

# 3. Também checar triggers em ESTOQUE_PRODUTOS (caso haja trigger lá também)
sep("3. TRIGGERS em ESTOQUE_PRODUTOS")
df2 = q(conn, """
    SELECT t.name AS trigger_name, OBJECT_NAME(t.parent_id) AS tabela,
           t.is_disabled
    FROM sys.triggers t
    WHERE OBJECT_NAME(t.parent_id) = 'ESTOQUE_PRODUTOS'
""")
print(df2.to_string(index=False) if len(df2) > 0 else "NENHUM trigger em ESTOQUE_PRODUTOS")

conn.close()
print("\n[OK] Concluído.")

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Dump completo de ESTOQUE_PRODUTOS para o produto N4.A5.0012 (todas as colunas),
para identificar campos de estoque alternativo (como a coluna 'U' da tela).
APENAS LEITURA.
"""

import sys
import codecs
import pyodbc
import pandas as pd

if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}


def conectar_banco():
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    ultimo_erro = None
    for nome, servidor in ((DB_CONFIG['server'], DB_CONFIG['server']), (DB_CONFIG['server_fallback'], DB_CONFIG['server_fallback'])):
        try:
            print(f"Conectando ao banco ({nome})...")
            conn_str = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={servidor};"
                f"DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};"
                f"PWD={DB_CONFIG['password']};"
                f"Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"✓ Conectado ao servidor {nome}")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro ao conectar em {nome}: {e}")
            continue
    print(f"✗ Falha ao conectar a todos os servidores. Último erro: {ultimo_erro}")
    return None


def dump_estoque_produtos(conn):
    print(\"\\n\" + \"=\" * 100)
    print(\"DUMP COMPLETO - Tabela ESTOQUE_PRODUTOS para N4.A5.0012 (todas as colunas)\")
    print(\"=\" * 100)

    # Mostrar colunas
    cols_query = \"\"\"\n        SELECT COLUMN_NAME, DATA_TYPE\n        FROM INFORMATION_SCHEMA.COLUMNS\n        WHERE TABLE_NAME = 'ESTOQUE_PRODUTOS'\n        ORDER BY ORDINAL_POSITION\n    \"\"\"\n    cols = pd.read_sql(cols_query, conn)
    print(\"\\nColunas de ESTOQUE_PRODUTOS:\")
    print(cols.to_string(index=False))

    # Buscar linhas do produto
    data_query = \"\"\"\n        SELECT *\n        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)\n        WHERE PRODUTO = 'N4.A5.0012'\n        ORDER BY FILIAL, COR_PRODUTO\n    \"\"\"\n    df = pd.read_sql(data_query, conn)
    if df.empty:\n        print(\"\\n⚠ Nenhum registro encontrado em ESTOQUE_PRODUTOS para N4.A5.0012\")\n    else:\n        print(\"\\nRegistros encontrados (todas as colunas):\")\n        with pd.option_context('display.max_rows', None, 'display.max_columns', None):\n            print(df)\n    return df\n\n\ndef main():\n    print(\"=\" * 100)\n    print(\"INVESTIGAÇÃO COMPLETA - ESTOQUE_PRODUTOS (N4.A5.0012)\")\n    print(\"=\" * 100)\n    conn = conectar_banco()\n    if not conn:\n        return\n    try:\n        dump_estoque_produtos(conn)\n    finally:\n        conn.close()\n        print(\"\\n✓ Conexão fechada.\")\n\n\nif __name__ == \"__main__\":\n    main()\n+\n*** End Patch```} ***!

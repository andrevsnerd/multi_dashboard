#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investiga o produto N4.A5.0012 em:
- ESTOQUE_PRODUTOS  (estoque atual, coluna principal)
- ESTOQUE_PRODUTOS_HISTORICO (estoque/saldos históricos)

APENAS CONSULTA (SELECT). NÃO ALTERA NADA.
"""

import sys
import codecs
import pyodbc
import pandas as pd

# Forçar UTF-8 no Windows
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
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome}: {servidor})...")
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
            print(f"✓ Conectado ao servidor {nome} ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("  Tentando servidor fallback...")
            continue
    print(f"✗ Falha em todos os servidores. Último erro: {ultimo_erro}")
    return None


def investigar_estoque_atual(conn):
    """Mostra ESTOQUE_PRODUTOS para N4.A5.0012"""
    print("\n" + "=" * 100)
    print("ESTOQUE_PRODUTOS - ESTOQUE ATUAL (N4.A5.0012 / K9)")
    print("=" * 100)

    query = """
        SELECT 
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL,
            e.ESTOQUE
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.PRODUTO = 'N4.A5.0012'
          AND (e.COR_PRODUTO IS NULL OR e.COR_PRODUTO = 'K9')
        ORDER BY e.FILIAL
    """
    df = pd.read_sql(query, conn)
    if df.empty:
        print("\n⚠ Nenhum registro encontrado em ESTOQUE_PRODUTOS.")
    else:
        print("\n📊 Estoque atual por filial:")
        print(df.to_string(index=False))
    return df


def investigar_estoque_historico(conn):
    """Mostra ESTOQUE_PRODUTOS_HISTORICO para N4.A5.0012"""
    print("\n" + "=" * 100)
    print("ESTOQUE_PRODUTOS_HISTORICO - SALDOS / HISTÓRICO (N4.A5.0012 / K9)")
    print("=" * 100)

    # Primeiro ver rapidamente a estrutura (quais colunas existem)
    cols_query = """
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PRODUTOS_HISTORICO'
        ORDER BY ORDINAL_POSITION
    """
    cols_df = pd.read_sql(cols_query, conn)
    print("\n[INFO] Principais colunas em ESTOQUE_PRODUTOS_HISTORICO (primeiras 25):")
    print(cols_df.head(25).to_string(index=False))

    # Agora buscar os dados relevantes para o produto/cor
    query = """
        SELECT 
            PRODUTO,
            COR_PRODUTO,
            FILIAL,
            ESTOQUE,
            QTDE_LJ_ENT,
            QTDE_PROD_ENT,
            ULTIMA_ENTRADA,
            ULTIMA_SAIDA,
            DATA_SALDO
        FROM ESTOQUE_PRODUTOS_HISTORICO WITH (NOLOCK)
        WHERE PRODUTO = 'N4.A5.0012'
          AND (COR_PRODUTO IS NULL OR COR_PRODUTO = 'K9')
        ORDER BY DATA_SALDO DESC
    """
    df = pd.read_sql(query, conn)
    if df.empty:
        print("\n⚠ Nenhum registro encontrado em ESTOQUE_PRODUTOS_HISTORICO.")
    else:
        print("\n📊 Histórico (últimos saldos registrados) por filial:")
        print(df.to_string(index=False))
    return df


def main():
    print("=" * 100)
    print("INVESTIGAÇÃO DE ESTOQUE - PRODUTO N4.A5.0012 (K9)")
    print("=" * 100)

    conn = conectar_banco()
    if not conn:
        return

    try:
        df_atual = investigar_estoque_atual(conn)
        df_hist = investigar_estoque_historico(conn)

        print("\n" + "=" * 100)
        print("RESUMO COMPARATIVO (IDEIA PARA MAPEAR COLUNA 'U' DA TELA)")
        print("=" * 100)
        if not df_atual.empty and not df_hist.empty:
            # Fazer um join simples por filial para comparar estoque atual x historico
            merged = pd.merge(
                df_atual,
                df_hist,
                how="left",
                on=["PRODUTO", "COR_PRODUTO", "FILIAL"],
                suffixes=("_ATUAL", "_HIST")
            )
            print("\nPRODUTO | COR | FILIAL | ESTOQUE_ATUAL | ESTOQUE_HIST | QTDE_LJ_ENT | QTDE_PROD_ENT | DATA_SALDO")
            for _, row in merged.iterrows():
                print(
                    f"{row['PRODUTO']:<10} | {row['COR_PRODUTO'] or '':<3} | {row['FILIAL']:<25} | "
                    f"{int(row['ESTOQUE_ATUAL']):>5} | "
                    f"{(int(row['ESTOQUE_HIST']) if pd.notna(row['ESTOQUE_HIST']) else 0):>5} | "
                    f"{(int(row['QTDE_LJ_ENT']) if pd.notna(row['QTDE_LJ_ENT']) else 0):>5} | "
                    f"{(int(row['QTDE_PROD_ENT']) if pd.notna(row['QTDE_PROD_ENT']) else 0):>5} | "
                    f"{row['DATA_SALDO']}"
                )
        else:
            print("Não foi possível montar comparativo (faltam dados em uma das tabelas).")

    finally:
        conn.close()
        print("\n✓ Conexão fechada.")


if __name__ == "__main__":
    main()


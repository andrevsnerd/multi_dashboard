#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investiga dados reais usados pelo LINX para:
- RESPONSAVEL em ESTOQUE_PROD_ENT (entradas de estoque)
- Empresas e filiais (tabela FILIAIS) para Nerd / Scarfme
- Combinações de TIPO_ROMANEIO, TIPO_ENTRADA, CM_OPERACAO usadas em entradas

APENAS LEITURA (SELECT). NÃO ALTERA NENHUM DADO.
"""

import sys
import codecs
import pyodbc
import pandas as pd

if sys.platform == "win32":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")

DB_CONFIG = {
    "server": "177.92.78.250",
    "server_fallback": "189.126.197.82",
    "database": "LINX_PRODUCAO",
    "username": "andre.nerd",
    "password": "nerd123@",
}


def conectar_banco():
    servidores = [
        ("principal", DB_CONFIG["server"]),
        ("fallback", DB_CONFIG["server_fallback"]),
    ]
    ultimo_erro = None
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome}: {servidor})...")
            conn_str = (
                "DRIVER={ODBC Driver 17 for SQL Server};"
                f"SERVER={servidor};"
                f"DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};"
                f"PWD={DB_CONFIG['password']};"
                "Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"✓ Conectado ao servidor {nome}")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == "principal":
                print("  Tentando servidor fallback...")
            continue
    print(f"✗ Falha ao conectar a todos os servidores. Último erro: {ultimo_erro}")
    return None


def listar_responsaveis_entradas(conn):
    """
    Lista responsáveis mais usados em ESTOQUE_PROD_ENT
    filtrando apenas filiais Nerd / Scarfme.
    """
    print("\n" + "=" * 100)
    print("RESPONSÁVEIS EM ESTOQUE_PROD_ENT (Nerd / Scarfme)")
    print("=" * 100)

    query = """
        SELECT TOP 100
            LTRIM(RTRIM(ISNULL(RESPONSAVEL, ''))) AS RESPONSAVEL,
            COUNT(*) AS QTD
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE RESPONSAVEL IS NOT NULL
          AND LTRIM(RTRIM(RESPONSAVEL)) <> ''
          AND (
                FILIAL LIKE 'NERD%%'
             OR FILIAL LIKE 'SCARF%%'
             OR FILIAL LIKE 'SCARFME%%'
          )
        GROUP BY LTRIM(RTRIM(ISNULL(RESPONSAVEL, '')))
        ORDER BY QTD DESC, RESPONSAVEL
    """
    df = pd.read_sql(query, conn)
    if df.empty:
        print("\n⚠ Nenhum responsável encontrado.")
    else:
        print("\nTop responsáveis (Nerd / Scarfme):")
        print(df.to_string(index=False))
    return df


def listar_empresas_filiais(conn):
    """
    Lista empresas e filiais relacionadas a Nerd / Scarfme
    para mapear agrupamentos (8-Nerd, 11-Nerd RDRRRJ, etc.).
    """
    print("\n" + "=" * 100)
    print("EMPRESAS x FILIAIS (Nerd / Scarfme)")
    print("=" * 100)

    query = """
        SELECT
            EMPRESA,
            COD_FILIAL,
            FILIAL
        FROM FILIAIS WITH (NOLOCK)
        WHERE FILIAL LIKE 'NERD%%'
           OR FILIAL LIKE 'SCARF%%'
           OR FILIAL LIKE 'SCARFME%%'
        ORDER BY EMPRESA, COD_FILIAL
    """
    df = pd.read_sql(query, conn)
    if df.empty:
        print("\n⚠ Nenhuma filial Nerd/Scarfme encontrada em FILIAIS.")
    else:
        print("\nMapa empresa → filiais:")
        print(df.to_string(index=False))
    return df


def listar_combinacoes_tipo_operacao(conn):
    """
    Lista combinações distintas de:
    - TIPO_ROMANEIO
    - TIPO_ENTRADA
    - CM_OPERACAO
    usadas em ESTOQUE_PROD_ENT para Nerd / Scarfme.
    """
    print("\n" + "=" * 100)
    print("COMBINAÇÕES (TIPO_ROMANEIO, TIPO_ENTRADA, CM_OPERACAO) em ESTOQUE_PROD_ENT")
    print("Filtrado para filiais Nerd / Scarfme")
    print("=" * 100)

    query = """
        SELECT
            ISNULL(LTRIM(RTRIM(TIPO_ROMANEIO)), '') AS TIPO_ROMANEIO,
            ISNULL(TIPO_ENTRADA, 0) AS TIPO_ENTRADA,
            ISNULL(CM_OPERACAO, '') AS CM_OPERACAO,
            COUNT(*) AS QTD
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE (FILIAL LIKE 'NERD%%'
            OR FILIAL LIKE 'SCARF%%'
            OR FILIAL LIKE 'SCARFME%%')
        GROUP BY
            ISNULL(LTRIM(RTRIM(TIPO_ROMANEIO)), ''),
            ISNULL(TIPO_ENTRADA, 0),
            ISNULL(CM_OPERACAO, '')
        ORDER BY QTD DESC
    """
    df = pd.read_sql(query, conn)
    if df.empty:
        print("\n⚠ Nenhuma combinação encontrada.")
    else:
        print("\nCombinações mais comuns:")
        print(df.head(50).to_string(index=False))
    return df


def main():
    print("=" * 100)
    print("INVESTIGAÇÃO: RESPONSÁVEIS, EMPRESAS/FILIAIS E TIPOS DE ENTRADA (Nerd / Scarfme)")
    print("=" * 100)

    conn = conectar_banco()
    if not conn:
        return

    try:
        df_resp = listar_responsaveis_entradas(conn)
        df_emp = listar_empresas_filiais(conn)
        df_tipo = listar_combinacoes_tipo_operacao(conn)

        print("\n" + "=" * 100)
        print("✅ INVESTIGAÇÃO CONCLUÍDA")
        print("=" * 100)
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")


if __name__ == "__main__":
    main()


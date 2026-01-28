#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para mapear de onde a stored procedure LX_GERA_TRANSFERENCIA_AUTOMATICA
está tirando o padrão de romaneio de entrada (ex: A0119739).

APENAS CONSULTA (SELECT / OBJECT_DEFINITION). NÃO FAZ NENHUMA ALTERAÇÃO.
"""

import sys
import codecs
import pyodbc

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
            print(f"✗ Erro ao conectar no servidor {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("  Tentando servidor fallback...")
            continue
    print(f"✗ Falha ao conectar em todos os servidores. Último erro: {ultimo_erro}")
    return None


def checar_romaneio_especifico(conn, romaneio_entrada: str):
    cursor = conn.cursor()

    print("\n" + "=" * 100)
    print(f"CHECK 1 - Procurando romaneio de entrada {romaneio_entrada}")
    print("=" * 100)

    # ESTOQUE_PROD_ENT
    print("\nESTOQUE_PROD_ENT:")
    cursor.execute(
        """
        SELECT TOP 5 ROMANEIO_PRODUTO, FILIAL, EMISSAO, FILIAL_ORIGEM, ROMANEIO_ORIGEM
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
        """,
        romaneio_entrada,
    )
    rows = cursor.fetchall()
    if rows:
        for r in rows:
            print("  ", r)
    else:
        print("  (nenhum registro)")

    # LOJA_ENTRADAS
    print("\nLOJA_ENTRADAS:")
    cursor.execute(
        """
        SELECT TOP 5 ROMANEIO_PRODUTO, FILIAL, EMISSAO
        FROM LOJA_ENTRADAS WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
        """,
        romaneio_entrada,
    )
    rows = cursor.fetchall()
    if rows:
        for r in rows:
            print("  ", r)
    else:
        print("  (nenhum registro)")

    cursor.close()


def checar_tabelas_mcx(conn):
    cursor = conn.cursor()
    print("\n" + "=" * 100)
    print("CHECK 2 - Amostra de romaneios nas tabelas MCX_*")
    print("=" * 100)

    for tabela in ["MCX_Estoque_Prod_Ent", "MCX_LJ_Entradas"]:
        print(f"\n{tabela}:")
        try:
            cursor.execute(
                f"SELECT TOP 5 Romaneio FROM {tabela} WITH (NOLOCK) ORDER BY Romaneio DESC"
            )
            rows = cursor.fetchall()
            if rows:
                for r in rows:
                    print("  ", r[0])
            else:
                print("  (nenhum registro)")
        except Exception as e:
            print(f"  (erro ao ler {tabela}: {e})")

    cursor.close()


def checar_sequenciais_romaneio(conn):
    cursor = conn.cursor()
    print("\n" + "=" * 100)
    print("CHECK 3 - Entradas relevantes na tabela SEQUENCIAIS (ROMANEIO)")
    print("=" * 100)

    query = """
        SELECT 
            TABELA_COLUNA,
            DESCRICAO,
            SEQUENCIA,
            QTDEDIGITOS,
            ULTALTERACAO,
            SISTEMA
        FROM SEQUENCIAIS WITH (NOLOCK)
        WHERE TABELA_COLUNA IN (
            'ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO',
            'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO',
            'LOJA_ENTRADAS.ROMANEIO_PRODUTO',
            'LOJA_SAIDAS.ROMANEIO_PRODUTO',
            'MCX_Estoque_Prod_Ent.Romaneio',
            'MCX_Estoque_Prod_Sai.Romaneio',
            'MCX_LJ_Entradas.Romaneio',
            'MCX_LJ_Saidas.Romaneio'
        )
        ORDER BY TABELA_COLUNA
    """
    try:
        cursor.execute(query)
        rows = cursor.fetchall()
        if rows:
            for r in rows:
                print(
                    f"  {r[0]:35s}  SEQ={r[2]:>10s}  DIGITOS={r[3]}  SISTEMA={r[5] or ''}  DESC={r[1]}"
                )
        else:
            print("  (nenhum registro)")
    except Exception as e:
        print("  Erro ao consultar SEQUENCIAIS:", e)

    cursor.close()


def checar_definicao_sp(conn):
    cursor = conn.cursor()
    print("\n" + "=" * 100)
    print("CHECK 4 - Trechos da LX_GERA_TRANSFERENCIA_AUTOMATICA relacionados a ROMANEIO")
    print("=" * 100)

    cursor.execute(
        "SELECT OBJECT_DEFINITION(OBJECT_ID('LX_GERA_TRANSFERENCIA_AUTOMATICA'))"
    )
    row = cursor.fetchone()
    cursor.close()

    if not row or not row[0]:
        print("  Não foi possível obter a definição da stored procedure.")
        return

    definicao = str(row[0])
    linhas = definicao.split("\n")
    palavras = [
        "ROMANEIO_PRODUTO",
        "SEQUENCIAIS",
        "MCX_Estoque_Prod_Ent",
        "MCX_LJ_Entradas",
        "LOJA_ENTRADAS",
    ]

    encontrados = []
    for i, linha in enumerate(linhas):
        upper = linha.upper()
        if any(p.upper() in upper for p in palavras):
            ini = max(0, i - 2)
            fim = min(len(linhas), i + 3)
            contexto = "\n".join(
                [f"{j+1:4d}: {linhas[j]}" for j in range(ini, fim)]
            )
            encontrados.append((i + 1, contexto))

    if not encontrados:
        print("  Nenhum trecho relevante encontrado.")
        return

    # Mostrar só alguns trechos para não explodir o console
    for num, ctx in encontrados[:15]:
        print(f"\n--- contexto linha {num} ---")
        print(ctx)


def main():
    print("=" * 100)
    print("MAPEAMENTO: ORIGEM DO PADRÃO DE ROMANEIO DE ENTRADA (A0119xxx)")
    print("=" * 100)

    conn = conectar_banco()
    if not conn:
        return

    try:
        # Romaneio que já vimos ser gerado pela SP
        checar_romaneio_especifico(conn, "A0119739")
        checar_tabelas_mcx(conn)
        checar_sequenciais_romaneio(conn)
        checar_definicao_sp(conn)
    finally:
        conn.close()
        print("\n✓ Conexão fechada.")


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Procura por "estoque alternativo" do produto N4.A5.0012 em outras tabelas.

Ideia: varrer tabelas que:
- tenham coluna PRODUTO
- e alguma coluna relacionada a estoque/saldo (nome contendo ESTOQUE, SALDO, QTDE)

APENAS CONSULTA (SELECT). NÃO ALTERA NADA.
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
            print(f"✗ Erro ao conectar no servidor {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("  Tentando servidor fallback...")
            continue
    print(f"✗ Falha ao conectar em todos os servidores. Último erro: {ultimo_erro}")
    return None


def listar_tabelas_com_estoque(conn):
    """
    Lista tabelas que têm PRODUTO + alguma coluna com 'ESTOQUE' ou 'SALDO' ou 'QTDE' no nome.
    """
    # Primeiro, pegar todas as colunas que têm PRODUTO
    cols_query = """
        SELECT TABLE_NAME, COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME = 'PRODUTO'
    """
    df_prod = pd.read_sql(cols_query, conn)

    tabelas = []
    for _, row in df_prod.iterrows():
        tabela = row['TABLE_NAME']
        # pegar colunas da tabela
        cols_tbl = pd.read_sql(
            """
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = ?
            """,
            conn,
            params=[tabela]
        )['COLUMN_NAME'].tolist()

        # verificar se tem alguma coluna de estoque/saldo/qtde
        estoque_cols = [c for c in cols_tbl if ('ESTOQUE' in c.upper() or 'SALDO' in c.upper() or c.upper().startswith('QTDE'))]
        if estoque_cols:
            tabelas.append({'TABLE_NAME': tabela, 'COLUNAS': ','.join(estoque_cols)})

    return pd.DataFrame(tabelas)


def procurar_produto_nas_tabelas(conn, tabelas_df):
    produto = 'N4.A5.0012'
    resultados = []

    for _, row in tabelas_df.iterrows():
        tabela = row['TABLE_NAME']
        colunas = row['COLUNAS'].split(',')

        # pular tabelas que já conhecemos bem
        if tabela in ('ESTOQUE_PRODUTOS', 'ESTOQUE_PRODUTOS_HISTORICO',
                      'ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT',
                      'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI'):
            continue

        # tentar pegar algumas colunas chave
        col_estoque = next((c for c in colunas if 'ESTOQUE' in c.upper()), None)
        col_saldo = next((c for c in colunas if 'SALDO' in c.upper()), None)
        col_qtde = next((c for c in colunas if c.upper().startswith('QTDE')), None)

        cols_select = ['PRODUTO']
        for c in (col_estoque, col_saldo, col_qtde):
            if c and c not in cols_select:
                cols_select.append(c)

        # adicionar FILIAL se existir
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = ?
            """, tabela)
            col_tbl = [r[0] for r in cur.fetchall()]
            if 'FILIAL' in col_tbl:
                cols_select.append('FILIAL')
        except Exception:
            pass

        cols_select = list(dict.fromkeys(cols_select))  # remover duplicatas

        try:
            cols_sql = ', '.join(cols_select)
            query = f"""
                SELECT TOP 20 {cols_sql}
                FROM {tabela} WITH (NOLOCK)
                WHERE PRODUTO = ?
            """
            df = pd.read_sql(query, conn, params=[produto])
            if not df.empty:
                print("\n" + "=" * 100)
                print(f"TABELA {tabela} - REGISTROS PARA PRODUTO {produto}")
                print("=" * 100)
                print(df.to_string(index=False))
                resultados.append((tabela, df))
        except Exception as e:
            # Tabela pode ter restrições, ignorar erros não críticos
            print(f"\n⚠ Não foi possível consultar {tabela}: {str(e)[:120]}")
            continue

    return resultados


def main():
    print("=" * 100)
    print("BUSCA DE ESTOQUE ALTERNATIVO - PRODUTO N4.A5.0012")
    print("=" * 100)

    conn = conectar_banco()
    if not conn:
        return

    try:
        print("\n🔍 Listando tabelas com PRODUTO + colunas de estoque/saldo/qtde...")
        tabelas_df = listar_tabelas_com_estoque(conn)
        if tabelas_df.empty:
            print("\n⚠ Nenhuma tabela candidata encontrada.")
            return

        print(f"\n📋 Tabelas candidatas encontradas ({len(tabelas_df)}):")
        for _, row in tabelas_df.iterrows():
            print(f"  - {row['TABLE_NAME']} ({row['COLUNAS']})")

        print("\n🔍 Procurando N4.A5.0012 nessas tabelas...")
        resultados = procurar_produto_nas_tabelas(conn, tabelas_df)

        if not resultados:
            print("\n⚠ Nenhum 'estoque alternativo' encontrado em tabelas adicionais para N4.A5.0012.")
        else:
            print(f"\n✅ Encontrados {len(resultados)} conjuntos de registros em tabelas alternativas.")

    finally:
        conn.close()
        print("\n✓ Conexão fechada.")


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investigação Extrato de Produto - LINX
Produto: 13.71.0365 (GUARDIAO DA NATUREZA 04/24), Cor: 03 (AZUL), Filial: GUARULHOS RSR
Objetivo:
  1. Entender o que são as colunas "90x90 Total"
  2. Por que alguns ENTRADA NORMAL / SAIDA NORMAL não aparecem no extrato
  3. Mapear todas as tabelas que formam o extrato
"""

import pyodbc
import pandas as pd
from datetime import datetime

DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

PRODUTO = '13.71.0365'
COR = '03'
# Filial RSR Guarulhos - vamos descobrir o código
FILIAL_NOME = 'GUARULHOS'

def conectar():
    for servidor in [DB_CONFIG['server'], DB_CONFIG['server_fallback']]:
        try:
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"[OK] Conectado: {servidor}")
            return conn
        except Exception as e:
            print(f"[ERRO] {servidor}: {e}")
    raise Exception("Falha em todos os servidores")

def sep(titulo):
    print(f"\n{'='*70}")
    print(f"  {titulo}")
    print(f"{'='*70}")

def run(conn, query, titulo=None):
    try:
        df = pd.read_sql(query, conn)
        if titulo:
            print(f"\n--- {titulo} ({len(df)} registros) ---")
        return df
    except Exception as e:
        print(f"[ERRO] {e}")
        return pd.DataFrame()

# ============================================================
# 1. Descobrir código da filial Guarulhos RSR
# ============================================================
def investigar_filial(conn):
    sep("1. IDENTIFICANDO FILIAL GUARULHOS RSR")
    df = run(conn, f"""
        SELECT FILIAL, NOME_FILIAL, CNPJ, CIDADE, UF
        FROM EMPRESAS WITH (NOLOCK)
        WHERE NOME_FILIAL LIKE '%GUARULHOS%' OR CIDADE LIKE '%GUARULHOS%'
        ORDER BY FILIAL
    """, "Filiais Guarulhos")
    print(df.to_string(index=False))
    return df

# ============================================================
# 2. Estoque atual do produto
# ============================================================
def investigar_estoque_atual(conn):
    sep("2. ESTOQUE ATUAL DO PRODUTO")
    df = run(conn, f"""
        SELECT ep.PRODUTO, ep.COR_PRODUTO, ep.FILIAL, ep.ESTOQUE,
               ep.ESTOQUE_EMBALADO, ep.ESTOQUE_TRANSITO,
               c.DESC_COR, e.NOME_FILIAL
        FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON ep.COR_PRODUTO = c.COR
        LEFT JOIN EMPRESAS e WITH (NOLOCK) ON ep.FILIAL = e.FILIAL
        WHERE ep.PRODUTO = '{PRODUTO}' AND ep.COR_PRODUTO = '{COR}'
        ORDER BY ep.FILIAL
    """, "Estoque por filial")
    print(df.to_string(index=False))
    return df

# ============================================================
# 3. Investigar ESTOQUE_PROD_ENT (Romaneios de entrada)
#    Essas são as "LOJA ENTRADAS" que aparecem no extrato
# ============================================================
def investigar_entradas_romaneio(conn):
    sep("3. ROMANEIOS DE ENTRADA (ESTOQUE_PROD_ENT + ESTOQUE_PROD1_ENT)")

    # Colunas disponíveis
    df_cols = run(conn, """
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME IN ('ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT')
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    """, "Colunas das tabelas de entrada")
    print(df_cols.to_string(index=False))

    # Dados do produto
    df = run(conn, f"""
        SELECT
            e.ROMANEIO_PRODUTO,
            e.EMISSAO,
            e.FILIAL,
            e.TIPO_ENTRADA,
            p.PRODUTO,
            p.COR_PRODUTO,
            p.QTDE,
            p.PRECO_CUSTO,
            p.ROMANEIO_CLIENTE   -- possível coluna "romaneio/pedido"
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        WHERE p.PRODUTO = '{PRODUTO}' AND p.COR_PRODUTO = '{COR}'
        ORDER BY e.EMISSAO DESC
    """, "Entradas do produto")
    print(df.to_string(index=False))
    return df

# ============================================================
# 4. Investigar LOJA_VENDA (vendas que aparecem no extrato)
# ============================================================
def investigar_vendas(conn):
    sep("4. VENDAS DO PRODUTO (LOJA_VENDA)")

    # Colunas
    df_cols = run(conn, """
        SELECT COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME IN ('LOJA_VENDA', 'LOJA_VENDA_PRODUTO')
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    """, "Colunas LOJA_VENDA")
    print(df_cols.to_string(index=False))

    df = run(conn, f"""
        SELECT TOP 30
            v.DATA_VENDA, v.FILIAL, v.TICKET,
            vp.PRODUTO, vp.COR_PRODUTO, vp.QTDE, vp.PRECO_VENDA
        FROM LOJA_VENDA v WITH (NOLOCK)
        JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            ON v.FILIAL = vp.FILIAL AND v.TICKET = vp.TICKET
        WHERE vp.PRODUTO = '{PRODUTO}' AND vp.COR_PRODUTO = '{COR}'
        ORDER BY v.DATA_VENDA DESC
    """, "Vendas do produto")
    print(df.to_string(index=False))
    return df

# ============================================================
# 5. Investigar "ENTRADA NORMAL" e "SAIDA NORMAL"
#    No Linx, essas são movimentações de estoque diretas (ajustes/transferências)
#    Tabelas candidatas: LOJA_SAIDA, LOJA_SAIDA_PRODUTO, LOJA_ENTRADA_NORMAL
# ============================================================
def investigar_entrada_saida_normal(conn):
    sep("5. ENTRADA NORMAL / SAIDA NORMAL")

    # Buscar todas as tabelas candidatas
    df_tabelas = run(conn, """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          AND (TABLE_NAME LIKE '%SAIDA%' OR TABLE_NAME LIKE '%ENTRADA%')
        ORDER BY TABLE_NAME
    """, "Tabelas de saída/entrada")
    print(df_tabelas.to_string(index=False))

    # Investigar cada candidata
    for tabela in df_tabelas['TABLE_NAME'].tolist():
        try:
            df_c = run(conn, f"""
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{tabela}'
                ORDER BY ORDINAL_POSITION
            """)
            cols = df_c['COLUMN_NAME'].tolist() if len(df_c) > 0 else []
            if 'PRODUTO' in cols:
                df_chk = run(conn, f"""
                    SELECT TOP 1 * FROM {tabela} WITH (NOLOCK)
                    WHERE PRODUTO = '{PRODUTO}'
                """)
                if len(df_chk) > 0:
                    print(f"\n[ENCONTRADO] {tabela} tem dados do produto!")
                    print(f"  Colunas: {cols}")
                    # Buscar todos os registros do produto+cor
                    df_full = run(conn, f"""
                        SELECT TOP 50 * FROM {tabela} WITH (NOLOCK)
                        WHERE PRODUTO = '{PRODUTO}'
                        {'AND COR_PRODUTO = ' + chr(39) + COR + chr(39) if 'COR_PRODUTO' in cols else ''}
                        ORDER BY {'EMISSAO DESC' if 'EMISSAO' in cols else
                                  'DATA DESC' if 'DATA' in cols else
                                  'DATA_MOVIMENTO DESC' if 'DATA_MOVIMENTO' in cols else '1'}
                    """)
                    print(df_full.to_string(index=False))
        except:
            continue

# ============================================================
# 6. Investigar ROMANEIO direto - o que é romaneio 831452 e 029374
#    (aparecem na imagem como ENTRADA NORMAL e SAIDA NORMAL)
# ============================================================
def investigar_romaneios_especificos(conn):
    sep("6. ROMANEIOS ESPECÍFICOS DA IMAGEM")
    romaneios = ['831452', '029374', '831457', '029461']

    for rom in romaneios:
        print(f"\n--- Romaneio: {rom} ---")

        # Tentar em várias tabelas
        tabelas_tentar = [
            ('ESTOQUE_PROD_ENT', 'ROMANEIO_PRODUTO'),
            ('LOJA_SAIDA', 'ROMANEIO'),
            ('LOJA_SAIDA', 'NUMERO'),
            ('LOJA_ENTRADA', 'ROMANEIO'),
            ('ESTOQUE_ROMANEIO', 'ROMANEIO'),
            ('LOJA_ROMANEIO', 'ROMANEIO'),
        ]

        for tabela, col_rom in tabelas_tentar:
            try:
                df = run(conn, f"""
                    SELECT TOP 5 * FROM {tabela} WITH (NOLOCK)
                    WHERE {col_rom} = '{rom}'
                """)
                if len(df) > 0:
                    print(f"  [ENCONTRADO em {tabela}.{col_rom}]")
                    print(df.to_string(index=False))
            except:
                pass

        # Busca genérica por número em todas as tabelas com coluna ROMANEIO
        try:
            df_tabs = run(conn, f"""
                SELECT DISTINCT t.TABLE_NAME, c.COLUMN_NAME
                FROM INFORMATION_SCHEMA.TABLES t
                JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
                WHERE t.TABLE_TYPE = 'BASE TABLE'
                  AND c.COLUMN_NAME LIKE '%ROMANEIO%'
                ORDER BY t.TABLE_NAME
            """)
            for _, row in df_tabs.iterrows():
                try:
                    df_chk = run(conn, f"""
                        SELECT TOP 1 * FROM {row['TABLE_NAME']} WITH (NOLOCK)
                        WHERE {row['COLUMN_NAME']} = '{rom}'
                    """)
                    if len(df_chk) > 0:
                        print(f"  [ACHADO em {row['TABLE_NAME']}.{row['COLUMN_NAME']}]")
                        print(df_chk.to_string(index=False))
                except:
                    pass
        except:
            pass

# ============================================================
# 7. O que é "90x90"? Investigar se é um campo, tamanho ou agrupamento
#    O título da tela diz "6-Scarf Me - Rsr" - pode ser relacionado ao tamanho do produto
# ============================================================
def investigar_coluna_90x90(conn):
    sep("7. INVESTIGANDO '90X90' - CAMPO OU TAMANHO")

    # Buscar se existe coluna com esse nome
    df_col = run(conn, """
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME LIKE '%90%' OR COLUMN_NAME LIKE '%TAMANHO%' OR COLUMN_NAME LIKE '%SIZE%'
        ORDER BY TABLE_NAME, COLUMN_NAME
    """, "Colunas com '90' ou 'tamanho'")
    print(df_col.to_string(index=False))

    # Buscar tabela de tamanhos/grades
    df_tam = run(conn, """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME LIKE '%TAMANHO%' OR TABLE_NAME LIKE '%GRADE%' OR TABLE_NAME LIKE '%SIZE%'
        ORDER BY TABLE_NAME
    """, "Tabelas de tamanho/grade")
    print(df_tam.to_string(index=False))

    # Ver estrutura do produto para entender o campo
    df_prod = run(conn, f"""
        SELECT TOP 1 * FROM PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = '{PRODUTO}'
    """, "Dados do produto na tabela PRODUTOS")
    if len(df_prod) > 0:
        print(df_prod.to_string(index=False))
        print("\nColunas:")
        for col in df_prod.columns:
            print(f"  {col}: {df_prod.iloc[0][col]}")

    # Ver se existe campo TAMANHO no estoque
    df_est = run(conn, f"""
        SELECT * FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = '{PRODUTO}' AND COR_PRODUTO = '{COR}'
    """, "Estoque com todos os campos")
    if len(df_est) > 0:
        print("\nColunas do estoque:")
        for col in df_est.columns:
            print(f"  {col}: {df_est.iloc[0][col]}")

# ============================================================
# 8. Investigar stored procedures que geram o extrato
#    Procurar SP que pode ser chamada para montar o extrato
# ============================================================
def investigar_stored_procedures(conn):
    sep("8. STORED PROCEDURES DO EXTRATO")

    df_sp = run(conn, """
        SELECT ROUTINE_NAME, ROUTINE_TYPE
        FROM INFORMATION_SCHEMA.ROUTINES
        WHERE ROUTINE_NAME LIKE '%EXTRATO%'
           OR ROUTINE_NAME LIKE '%ESTOQUE%'
           OR ROUTINE_NAME LIKE '%CONSULTA%'
           OR ROUTINE_NAME LIKE '%HISTORICO%'
           OR ROUTINE_NAME LIKE '%MOVIMENTO%'
        ORDER BY ROUTINE_NAME
    """, "SPs relacionadas")
    print(df_sp.to_string(index=False))

# ============================================================
# 9. Investigar tabela de movimentos de estoque
#    Verificar se existe uma tabela centralizada de movimentos
# ============================================================
def investigar_movimentos_estoque(conn):
    sep("9. MOVIMENTOS DE ESTOQUE - TABELA CENTRAL")

    # Candidatas
    candidatas = [
        'ESTOQUE_MOVIMENTO',
        'ESTOQUE_MOVIMENTOS',
        'MOVIMENTO_ESTOQUE',
        'LOJA_MOVIMENTO',
        'PRODUTO_MOVIMENTO',
        'LOG_ESTOQUE',
        'HISTORICO_ESTOQUE',
        'ESTOQUE_LOG',
        'ESTOQUE_HISTORICO',
    ]

    for tabela in candidatas:
        try:
            df_cols = run(conn, f"""
                SELECT COLUMN_NAME, DATA_TYPE
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{tabela}'
                ORDER BY ORDINAL_POSITION
            """)
            if len(df_cols) > 0:
                print(f"\n[EXISTE] {tabela}")
                print(f"  Colunas: {', '.join(df_cols['COLUMN_NAME'].tolist())}")

                # Ver dados do produto
                cols = df_cols['COLUMN_NAME'].tolist()
                if 'PRODUTO' in cols:
                    df_d = run(conn, f"""
                        SELECT TOP 20 * FROM {tabela} WITH (NOLOCK)
                        WHERE PRODUTO = '{PRODUTO}'
                          {'AND COR_PRODUTO = ' + chr(39) + COR + chr(39) if 'COR_PRODUTO' in cols else ''}
                        ORDER BY {'EMISSAO DESC' if 'EMISSAO' in cols else
                                  'DATA DESC' if 'DATA' in cols else
                                  'DATA_MOVIMENTO DESC' if 'DATA_MOVIMENTO' in cols else '1'}
                    """)
                    if len(df_d) > 0:
                        print(f"  [DADOS ENCONTRADOS!] {len(df_d)} registros")
                        print(df_d.to_string(index=False))
        except Exception as e:
            pass

# ============================================================
# 10. Ver o que a SP 1200075PK faz (nome da tela no Linx)
# ============================================================
def investigar_sp_1200075pk(conn):
    sep("10. SP 1200075PK - Tela de Consulta de Estoque Por Cor e Filial")

    # Buscar SP com esse nome/padrão
    try:
        df = run(conn, """
            SELECT ROUTINE_NAME, ROUTINE_DEFINITION
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_NAME LIKE '%1200075%'
               OR ROUTINE_NAME LIKE '%CONSULTA_ESTOQUE%'
               OR ROUTINE_NAME LIKE '%COR_FILIAL%'
               OR ROUTINE_NAME LIKE '%SCARF%'
        """, "SPs 1200075")
        if len(df) > 0:
            print(df.to_string(index=False))
            for _, row in df.iterrows():
                print(f"\n--- Definição de {row['ROUTINE_NAME']} ---")
                print(row['ROUTINE_DEFINITION'])
        else:
            print("[INFO] SP não encontrada pelo nome")
    except Exception as e:
        print(f"[ERRO] {e}")

    # Buscar SPs que referenciam as tabelas chave
    try:
        df = run(conn, """
            SELECT DISTINCT ROUTINE_NAME
            FROM INFORMATION_SCHEMA.ROUTINES
            WHERE ROUTINE_DEFINITION LIKE '%ESTOQUE_PROD_ENT%'
               OR ROUTINE_DEFINITION LIKE '%LOJA_VENDA%'
            ORDER BY ROUTINE_NAME
        """, "SPs que usam tabelas do extrato")
        print(df.to_string(index=False))
    except:
        pass

# ============================================================
# 11. Verificar tabela LOJA_SAIDA (romaneios de saída internos)
# ============================================================
def investigar_loja_saida(conn):
    sep("11. LOJA_SAIDA - ROMANEIOS INTERNOS DE SAÍDA")
    try:
        # Verificar estrutura
        df_cols = run(conn, """
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'LOJA_SAIDA'
            ORDER BY ORDINAL_POSITION
        """, "Colunas LOJA_SAIDA")
        print(df_cols.to_string(index=False))

        df_cols2 = run(conn, """
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'LOJA_SAIDA_PRODUTO'
            ORDER BY ORDINAL_POSITION
        """, "Colunas LOJA_SAIDA_PRODUTO")
        print(df_cols2.to_string(index=False))

        # Dados do produto
        df = run(conn, f"""
            SELECT TOP 30
                s.EMISSAO, s.FILIAL, s.ROMANEIO, s.TIPO_SAIDA,
                sp.PRODUTO, sp.COR_PRODUTO, sp.QTDE
            FROM LOJA_SAIDA s WITH (NOLOCK)
            JOIN LOJA_SAIDA_PRODUTO sp WITH (NOLOCK)
                ON s.FILIAL = sp.FILIAL AND s.ROMANEIO = sp.ROMANEIO
            WHERE sp.PRODUTO = '{PRODUTO}' AND sp.COR_PRODUTO = '{COR}'
            ORDER BY s.EMISSAO DESC
        """, "Saídas do produto")
        print(df.to_string(index=False))

        # Tipos de saída existentes
        df_tipos = run(conn, """
            SELECT TIPO_SAIDA, COUNT(*) as QTD
            FROM LOJA_SAIDA WITH (NOLOCK)
            GROUP BY TIPO_SAIDA
            ORDER BY QTD DESC
        """, "Tipos de saída")
        print(df_tipos.to_string(index=False))

    except Exception as e:
        print(f"[ERRO] {e}")

# ============================================================
# 12. Ver todos os tipos de entrada disponíveis no ESTOQUE_PROD_ENT
# ============================================================
def investigar_tipos_entrada(conn):
    sep("12. TIPOS DE ENTRADA NO SISTEMA")
    try:
        df = run(conn, """
            SELECT TIPO_ENTRADA, COUNT(*) as QTD
            FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
            GROUP BY TIPO_ENTRADA
            ORDER BY QTD DESC
        """, "Tipos de entrada em ESTOQUE_PROD_ENT")
        print(df.to_string(index=False))
    except Exception as e:
        print(f"[ERRO] {e}")

    # Verificar também LOJA_ENTRADAS
    try:
        df = run(conn, """
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME LIKE '%LOJA%ENTR%'
            ORDER BY TABLE_NAME
        """)
        print(df.to_string(index=False))
    except:
        pass

# ============================================================
# MAIN
# ============================================================
def main():
    print("="*70)
    print("  INVESTIGAÇÃO EXTRATO PRODUTO LINX")
    print(f"  Produto: {PRODUTO} | Cor: {COR} | Filial: {FILIAL_NOME}")
    print(f"  Data: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    print("="*70)

    conn = conectar()

    try:
        investigar_filial(conn)
        investigar_estoque_atual(conn)
        investigar_entradas_romaneio(conn)
        investigar_vendas(conn)
        investigar_entrada_saida_normal(conn)
        investigar_romaneios_especificos(conn)
        investigar_coluna_90x90(conn)
        investigar_stored_procedures(conn)
        investigar_movimentos_estoque(conn)
        investigar_sp_1200075pk(conn)
        investigar_loja_saida(conn)
        investigar_tipos_entrada(conn)
    finally:
        conn.close()
        print("\n[OK] Conexão encerrada.")

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investigação Focada - Extrato Produto Linx
Foco:
  1. Romaneios 831452, 029374, 831457, 029461 (ENTRADA/SAIDA NORMAL da imagem)
  2. O que são as colunas EN1..EN48 / "90x90 Total"
  3. LOJA_SAIDAS estrutura e dados
  4. Por que ENTRADA NORMAL não aparece no extrato principal
"""

import pyodbc
import pandas as pd

DB_CONFIG = {
    'server': '177.92.78.250',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

PRODUTO = '13.71.0365'
COR = '03'

def conectar():
    conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
               f"SERVER={DB_CONFIG['server']};DATABASE={DB_CONFIG['database']};"
               f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};"
               f"Connection Timeout=30;")
    conn = pyodbc.connect(conn_str)
    conn.timeout = 300
    print("[OK] Conectado")
    return conn

def q(conn, sql):
    try:
        return pd.read_sql(sql, conn)
    except Exception as e:
        print(f"  [ERRO SQL] {str(e)[:200]}")
        return pd.DataFrame()

def sep(t): print(f"\n{'='*65}\n  {t}\n{'='*65}")

conn = conectar()

# ============================================================
# PARTE A: Entender as colunas EN1..EN48
# "90x90 Total" na tela do Linx é provavelmente o tamanho 90x90cm
# mapeado como EN1 na grade de tamanhos
# ============================================================
sep("A. GRADE DE TAMANHOS - O QUE É EN1..EN48?")

# Buscar tabela de tamanhos do produto
df = q(conn, f"""
    SELECT TOP 1 * FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = '{PRODUTO}'
""")
if len(df) > 0:
    print("Campos do produto:")
    for col in df.columns:
        val = df.iloc[0][col]
        if val is not None and str(val).strip():
            print(f"  {col}: {val}")

# Grade de tamanhos associada
df2 = q(conn, f"""
    SELECT p.PRODUTO, p.GRADE, g.DESC_GRADE,
           g.TAMANHO1, g.TAMANHO2, g.TAMANHO3, g.TAMANHO4, g.TAMANHO5
    FROM PRODUTOS p WITH (NOLOCK)
    LEFT JOIN GRADES g WITH (NOLOCK) ON p.GRADE = g.GRADE
    WHERE p.PRODUTO = '{PRODUTO}'
""")
print("\nGrade do produto:")
print(df2.to_string(index=False))

# Ver toda a tabela GRADES para essa grade
if len(df2) > 0 and df2.iloc[0]['GRADE']:
    grade = df2.iloc[0]['GRADE']
    df3 = q(conn, f"""
        SELECT * FROM GRADES WHERE GRADE = '{grade}'
    """)
    print(f"\nDetalhes da GRADE {grade}:")
    if len(df3) > 0:
        for col in df3.columns:
            val = df3.iloc[0][col]
            if val is not None and str(val).strip() != '' and str(val).strip() != '0':
                print(f"  {col}: {val}")

# Verificar se existe tabela TAMANHOS
df4 = q(conn, """
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%TAMANHO%' OR TABLE_NAME LIKE '%GRADE%'
    ORDER BY TABLE_NAME
""")
print(f"\nTabelas de tamanho/grade: {df4['TABLE_NAME'].tolist() if len(df4)>0 else 'nenhuma'}")

for tab in (df4['TABLE_NAME'].tolist() if len(df4)>0 else []):
    df_t = q(conn, f"SELECT TOP 3 * FROM {tab} WITH (NOLOCK)")
    if len(df_t) > 0:
        print(f"\n{tab}:")
        print(df_t.to_string(index=False))

# ============================================================
# PARTE B: Romaneios 831452, 029374, 831457, 029461
# Estes aparecem como ENTRADA NORMAL e SAIDA NORMAL na imagem
# São romaneios internos de loja (não são NF de fornecedor)
# ============================================================
sep("B. INVESTIGAR ROMANEIOS DA IMAGEM (ENTRADA/SAIDA NORMAL)")

romaneios_imagem = ['831452', '029374', '831457', '029461', '0029374', '0831452']

# A: Verificar em LOJA_SAIDAS
df_cols_saida = q(conn, """
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_SAIDAS' ORDER BY ORDINAL_POSITION
""")
print("LOJA_SAIDAS colunas:", df_cols_saida['COLUMN_NAME'].tolist() if len(df_cols_saida) > 0 else 'N/A')

for rom in ['831452', '029374', '831457', '029461']:
    df = q(conn, f"""
        SELECT * FROM LOJA_SAIDAS WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = '{rom}' OR ROMANEIO_PRODUTO = '{rom.zfill(8)}'
           OR ROMANEIO_SAIDA = '{rom}' OR ROMANEIO_SAIDA = '{rom.zfill(8)}'
    """)
    if len(df) > 0:
        print(f"\n[ACHADO em LOJA_SAIDAS] Romaneio {rom}:")
        print(df.to_string(index=False))

# B: Verificar em LOJA_ENTRADAS
df_cols_ent = q(conn, """
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_ENTRADAS' ORDER BY ORDINAL_POSITION
""")
print("\nLOJA_ENTRADAS colunas:", df_cols_ent['COLUMN_NAME'].tolist() if len(df_cols_ent) > 0 else 'N/A')

for rom in ['831452', '029374', '831457', '029461']:
    for col_rom in ['ROMANEIO_PRODUTO', 'ROMANEIO_SAIDA', 'ROMANEIO', 'NUMERO']:
        df = q(conn, f"""
            SELECT TOP 3 * FROM LOJA_ENTRADAS WITH (NOLOCK)
            WHERE {col_rom} = '{rom}'
        """)
        if len(df) > 0:
            print(f"\n[ACHADO em LOJA_ENTRADAS.{col_rom}] Romaneio {rom}:")
            print(df.to_string(index=False))
            break

# C: Verificar em ESTOQUE_PROD_ENT
for rom in ['831452', '029374', '831457', '029461']:
    df = q(conn, f"""
        SELECT e.ROMANEIO_PRODUTO, e.EMISSAO, e.FILIAL, e.TIPO_ENTRADA, e.TIPO_ROMANEIO
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        WHERE e.ROMANEIO_PRODUTO = '{rom}' OR e.ROMANEIO_PRODUTO LIKE '%{rom}%'
    """)
    if len(df) > 0:
        print(f"\n[ACHADO em ESTOQUE_PROD_ENT] Romaneio {rom}:")
        print(df.to_string(index=False))

# ============================================================
# PARTE C: LOJA_SAIDAS completo - estrutura e dados do produto
# ============================================================
sep("C. LOJA_SAIDAS - ESTRUTURA E DADOS DO PRODUTO")

df_ls_cols = q(conn, """
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_SAIDAS' ORDER BY ORDINAL_POSITION
""")
print("Colunas LOJA_SAIDAS:")
print(df_ls_cols.to_string(index=False))

# Verificar LOJA_SAIDAS_PRODUTO
df_lsp_cols = q(conn, """
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_SAIDAS_PRODUTO' ORDER BY ORDINAL_POSITION
""")
print("\nColunas LOJA_SAIDAS_PRODUTO:")
print(df_lsp_cols.to_string(index=False))

# Dados do produto em LOJA_SAIDAS_PRODUTO
ls_cols = df_ls_cols['COLUMN_NAME'].tolist() if len(df_ls_cols) > 0 else []
lsp_cols = df_lsp_cols['COLUMN_NAME'].tolist() if len(df_lsp_cols) > 0 else []

if 'PRODUTO' in lsp_cols:
    # identificar chave de join
    chave_ls = [c for c in ls_cols if 'ROMANEIO' in c or 'NUMERO' in c or 'ID' == c]
    chave_lsp = [c for c in lsp_cols if 'ROMANEIO' in c or 'NUMERO' in c or 'ID' == c]
    print(f"\nChave LOJA_SAIDAS: {chave_ls}")
    print(f"Chave LOJA_SAIDAS_PRODUTO: {chave_lsp}")

    # Buscar saídas do produto
    df_saidas = q(conn, f"""
        SELECT TOP 30 *
        FROM LOJA_SAIDAS_PRODUTO WITH (NOLOCK)
        WHERE PRODUTO = '{PRODUTO}'
          AND COR_PRODUTO = '{COR}'
        ORDER BY TIMESTAMP DESC
    """)
    print(f"\nSaídas do produto em LOJA_SAIDAS_PRODUTO ({len(df_saidas)} registros):")
    if len(df_saidas) > 0:
        for col in df_saidas.columns:
            vals = df_saidas[col].tolist()
            nao_zero = [v for v in vals if v is not None and str(v).strip() not in ('0', '', 'b\'\\x00\\x00\\x00\\x00\\x00\\x00\\x00\\x00\'')]
            if nao_zero:
                print(f"  {col}: {vals[:5]}")

# ============================================================
# PARTE D: LOJA_TIPOS_ENTRADA_SAIDA - o que significa cada tipo
# ============================================================
sep("D. TIPOS DE ENTRADA/SAIDA (LOJA_TIPOS_ENTRADA_SAIDA)")

df_tipos = q(conn, """
    SELECT * FROM LOJA_TIPOS_ENTRADA_SAIDA WITH (NOLOCK)
    ORDER BY TIPO_ENTRADA_SAIDA
""")
print(df_tipos.to_string(index=False))

# ============================================================
# PARTE E: Como o extrato é formado - buscar todas as tabelas
# que compõem o extrato do Linx (LOJA ENTRADAS, LOJA VENDAS,
# ENTRADA NORMAL, SAIDA NORMAL)
# ============================================================
sep("E. INVESTIGAR LOJA_SAIDAS_ROMANEIO (tabela de romaneios de saída)")

df_lsr_cols = q(conn, """
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_SAIDAS_ROMANEIO' ORDER BY ORDINAL_POSITION
""")
print("LOJA_SAIDAS_ROMANEIO colunas:")
print(df_lsr_cols.to_string(index=False))

df_lsr = q(conn, f"""
    SELECT TOP 5 * FROM LOJA_SAIDAS_ROMANEIO WITH (NOLOCK)
""")
print("Amostra:")
print(df_lsr.to_string(index=False))

# LOJA_SAIDAS_ROMANEIO_PRODUTO
df_lsrp_cols = q(conn, """
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_SAIDAS_ROMANEIO_PRODUTO' ORDER BY ORDINAL_POSITION
""")
print("\nLOJA_SAIDAS_ROMANEIO_PRODUTO colunas:")
print(df_lsrp_cols.to_string(index=False))

df_lsrp = q(conn, f"""
    SELECT TOP 20 * FROM LOJA_SAIDAS_ROMANEIO_PRODUTO WITH (NOLOCK)
    WHERE PRODUTO = '{PRODUTO}'
""")
print(f"Dados do produto ({len(df_lsrp)} registros):")
print(df_lsrp.to_string(index=False))

# ============================================================
# PARTE F: O extrato do Linx (tela 1200075PK) - ver quais
# tabelas realmente são usadas no extrato
# Comparar os romaneios da imagem com o que existe
# ============================================================
sep("F. RECONSTRUINDO O EXTRATO - GUARULHOS RSR")

# LOJA ENTRADAS (romaneios de entrada)
df_ent = q(conn, f"""
    SELECT
        le.EMISSAO,
        le.FILIAL,
        lep.ROMANEIO_PRODUTO AS ROMANEIO,
        lep.PRODUTO,
        lep.COR_PRODUTO,
        lep.QTDE_ENTRADA AS QTDE,
        'LOJA ENTRADAS' AS TIPO
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
        ON le.FILIAL = lep.FILIAL
        AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
    WHERE lep.PRODUTO = '{PRODUTO}'
      AND lep.COR_PRODUTO = '{COR}'
      AND le.FILIAL LIKE '%GUARULHOS%'
    ORDER BY le.EMISSAO DESC
""")
print(f"\nLOJA ENTRADAS - Guarulhos ({len(df_ent)} registros):")
print(df_ent.to_string(index=False))

# LOJA SAIDAS (romaneios de saída = podem ser transferências)
df_sai = q(conn, f"""
    SELECT TOP 30
        ls.EMISSAO,
        ls.FILIAL,
        ls.ROMANEIO_SAIDA,
        ls.TIPO_SAIDA,
        lsp.PRODUTO,
        lsp.COR_PRODUTO,
        lsp.QTDE
    FROM LOJA_SAIDAS ls WITH (NOLOCK)
    JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
        ON ls.FILIAL = lsp.FILIAL
        AND ls.ROMANEIO_SAIDA = lsp.ROMANEIO_SAIDA
    WHERE lsp.PRODUTO = '{PRODUTO}'
      AND lsp.COR_PRODUTO = '{COR}'
      AND ls.FILIAL LIKE '%GUARULHOS%'
    ORDER BY ls.EMISSAO DESC
""")
print(f"\nLOJA SAIDAS - Guarulhos ({len(df_sai)} registros):")
print(df_sai.to_string(index=False))

# ============================================================
# PARTE G: Verificar LOJA_SAIDAS com romaneios específicos
# ============================================================
sep("G. BUSCAR ROMANEIOS ESPECÍFICOS EM TODAS AS TABELAS")

# Busca ampla em todas as tabelas com coluna ROMANEIO_SAIDA ou ROMANEIO_PRODUTO
tabelas_romaneio = q(conn, """
    SELECT DISTINCT t.TABLE_NAME, c.COLUMN_NAME
    FROM INFORMATION_SCHEMA.TABLES t
    JOIN INFORMATION_SCHEMA.COLUMNS c ON t.TABLE_NAME = c.TABLE_NAME
    WHERE t.TABLE_TYPE = 'BASE TABLE'
      AND (c.COLUMN_NAME LIKE '%ROMANEIO%' OR c.COLUMN_NAME = 'NUMERO')
      AND t.TABLE_NAME NOT LIKE '%MCX%'
      AND t.TABLE_NAME NOT LIKE '%LCF%'
      AND t.TABLE_NAME NOT LIKE '%LF_%'
    ORDER BY t.TABLE_NAME
""")

for rom in ['831452', '029374']:
    print(f"\nBuscando romaneio {rom}...")
    for _, row in tabelas_romaneio.iterrows():
        try:
            df = q(conn, f"""
                SELECT TOP 1 * FROM {row['TABLE_NAME']} WITH (NOLOCK)
                WHERE {row['COLUMN_NAME']} = '{rom}'
                   OR {row['COLUMN_NAME']} = '{rom.lstrip('0')}'
                   OR {row['COLUMN_NAME']} = '0{rom}'
            """)
            if len(df) > 0:
                print(f"  [ENCONTRADO] {row['TABLE_NAME']}.{row['COLUMN_NAME']}")
                for col in df.columns[:10]:
                    print(f"    {col}: {df.iloc[0][col]}")
        except:
            pass

# ============================================================
# PARTE H: Tipos de saída na tabela LOJA_SAIDAS
# ============================================================
sep("H. TIPOS DE SAÍDA - LOJA_SAIDAS")

ls_cols = q(conn, """
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'LOJA_SAIDAS' ORDER BY ORDINAL_POSITION
""")
cols_list = ls_cols['COLUMN_NAME'].tolist() if len(ls_cols) > 0 else []

if 'TIPO_SAIDA' in cols_list:
    df_ts = q(conn, """
        SELECT TIPO_SAIDA, COUNT(*) AS QTD
        FROM LOJA_SAIDAS WITH (NOLOCK)
        GROUP BY TIPO_SAIDA
        ORDER BY QTD DESC
    """)
    print("Tipos de saída mais comuns:")
    print(df_ts.to_string(index=False))

# ============================================================
# PARTE I: Verificar se ENTRADA NORMAL/SAIDA NORMAL são
# ajustes de estoque (LOJA_AJUSTE, ESTOQUE_AJUSTE, etc.)
# ============================================================
sep("I. AJUSTES DE ESTOQUE")

df = q(conn, """
    SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_NAME LIKE '%AJUSTE%'
    ORDER BY TABLE_NAME
""")
print(f"Tabelas de ajuste: {df['TABLE_NAME'].tolist() if len(df)>0 else 'nenhuma'}")

# Verificar ESTOQUE_PROD_ENT com TIPO_ROMANEIO = 'N' (Normal?)
df_tipos_rom = q(conn, """
    SELECT TIPO_ROMANEIO, COUNT(*) AS QTD
    FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
    GROUP BY TIPO_ROMANEIO
    ORDER BY QTD DESC
""")
print("\nTipos de romaneio em ESTOQUE_PROD_ENT:")
print(df_tipos_rom.to_string(index=False))

df_tipos_ent = q(conn, """
    SELECT TIPO_ENTRADA, COUNT(*) AS QTD
    FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
    GROUP BY TIPO_ENTRADA
    ORDER BY QTD DESC
""")
print("\nTipos de entrada em ESTOQUE_PROD_ENT:")
print(df_tipos_ent.to_string(index=False))

conn.close()
print("\n[OK] Concluído.")

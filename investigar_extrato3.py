#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Investigação final - detalhes dos romaneios e tabela ESTOQUE_PROD_SAI"""

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
    return conn

def q(conn, sql):
    try:
        return pd.read_sql(sql, conn)
    except Exception as e:
        print(f"  [ERRO] {str(e)[:200]}")
        return pd.DataFrame()

def sep(t): print(f"\n{'='*65}\n  {t}\n{'='*65}")

conn = conectar()
print("[OK] Conectado")

# ==============================================================
# 1. ESTOQUE_PROD_SAI - Tabela de saídas de estoque
#    Os romaneios 029374 e 029461 são SAIDAS
# ==============================================================
sep("1. ESTOQUE_PROD_SAI - ESTRUTURA")
df_cols = q(conn, """
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ESTOQUE_PROD_SAI' ORDER BY ORDINAL_POSITION
""")
print(df_cols.to_string(index=False))

sep("2. ESTOQUE_PROD1_SAI - ESTRUTURA")
df_cols2 = q(conn, """
    SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME = 'ESTOQUE_PROD1_SAI' ORDER BY ORDINAL_POSITION
""")
print(df_cols2.to_string(index=False))

# ==============================================================
# 2. Verificar se os romaneios 029374 e 029461 têm o produto 13.71.0365
# ==============================================================
sep("3. ROMANEIO 029374 - ITENS (ESTOQUE_PROD1_SAI)")
df = q(conn, f"""
    SELECT * FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
    WHERE ROMANEIO_PRODUTO = '029374'
      AND PRODUTO = '{PRODUTO}'
""")
print(f"Produto {PRODUTO} no romaneio 029374: {len(df)} registros")
if len(df) > 0:
    print(df.to_string(index=False))

df_all = q(conn, f"""
    SELECT PRODUTO, COR_PRODUTO, QTDE
    FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
    WHERE ROMANEIO_PRODUTO = '029374'
      AND PRODUTO = '{PRODUTO}'
""")
print(f"\nTodos os itens do romaneio 029374 com produto {PRODUTO}:")
print(df_all.to_string(index=False) if len(df_all) > 0 else "NENHUM")

sep("4. ROMANEIO 029461 - ITENS")
df2 = q(conn, f"""
    SELECT PRODUTO, COR_PRODUTO, QTDE
    FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
    WHERE ROMANEIO_PRODUTO = '029461'
      AND PRODUTO = '{PRODUTO}'
""")
print(f"Produto {PRODUTO} no romaneio 029461: {len(df2)} registros")
print(df2.to_string(index=False) if len(df2) > 0 else "NENHUM")

sep("5. ROMANEIO 831452 - ITENS EM ESTOQUE_PROD1_ENT")
df3 = q(conn, f"""
    SELECT PRODUTO, COR_PRODUTO, QTDE, EN_1
    FROM ESTOQUE_PROD1_ENT WITH (NOLOCK)
    WHERE ROMANEIO_PRODUTO = '831452'
      AND PRODUTO = '{PRODUTO}'
""")
print(f"Produto {PRODUTO} no romaneio 831452 (ENTRADA): {len(df3)} registros")
print(df3.to_string(index=False) if len(df3) > 0 else "NENHUM")

sep("6. ROMANEIO 831457 - ITENS EM ESTOQUE_PROD1_ENT")
df4 = q(conn, f"""
    SELECT PRODUTO, COR_PRODUTO, QTDE, EN_1
    FROM ESTOQUE_PROD1_ENT WITH (NOLOCK)
    WHERE ROMANEIO_PRODUTO = '831457'
      AND PRODUTO = '{PRODUTO}'
""")
print(f"Produto {PRODUTO} no romaneio 831457 (ENTRADA): {len(df4)} registros")
print(df4.to_string(index=False) if len(df4) > 0 else "NENHUM")

# ==============================================================
# 3. Entender o STATUS_TRANSITO = 4 nas entradas 831452 e 831457
#    Isso significa que estão em trânsito, não confirmadas
# ==============================================================
sep("7. STATUS_TRANSITO - SIGNIFICADO")
df_status = q(conn, """
    SELECT STATUS_TRANSITO, COUNT(*) AS QTD
    FROM LOJA_ENTRADAS WITH (NOLOCK)
    GROUP BY STATUS_TRANSITO
    ORDER BY STATUS_TRANSITO
""")
print("Distribuição de STATUS_TRANSITO em LOJA_ENTRADAS:")
print(df_status.to_string(index=False))

df_status2 = q(conn, """
    SELECT STATUS_TRANSITO, COUNT(*) AS QTD
    FROM LOJA_SAIDAS WITH (NOLOCK)
    GROUP BY STATUS_TRANSITO
    ORDER BY STATUS_TRANSITO
""")
print("\nDistribuição de STATUS_TRANSITO em LOJA_SAIDAS:")
print(df_status2.to_string(index=False))

# ==============================================================
# 4. Verificar o campo ATUALIZOU_ESTOQUE nas entradas
#    LOJA_ENTRADAS_PRODUTO tem esse campo - ver se é True ou False
#    para esses romaneios
# ==============================================================
sep("8. ATUALIZOU_ESTOQUE - ROMANEIOS 831452 e 831457")
df_atualiz = q(conn, f"""
    SELECT lep.ROMANEIO_PRODUTO, lep.PRODUTO, lep.COR_PRODUTO,
           lep.QTDE_ENTRADA, lep.ATUALIZOU_ESTOQUE,
           le.STATUS_TRANSITO, le.EMISSAO, le.OBS
    FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
    JOIN LOJA_ENTRADAS le WITH (NOLOCK)
        ON le.FILIAL = lep.FILIAL
        AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
    WHERE lep.ROMANEIO_PRODUTO IN ('831452', '831457')
      AND lep.PRODUTO = '{PRODUTO}'
""")
print("Produto nas entradas 831452/831457:")
print(df_atualiz.to_string(index=False) if len(df_atualiz) > 0 else "NENHUM")

# Buscar qualquer produto nessas entradas para ver a estrutura
df_atualiz_all = q(conn, f"""
    SELECT TOP 5 lep.ROMANEIO_PRODUTO, lep.PRODUTO, lep.COR_PRODUTO,
           lep.QTDE_ENTRADA, lep.ATUALIZOU_ESTOQUE,
           le.STATUS_TRANSITO
    FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
    JOIN LOJA_ENTRADAS le WITH (NOLOCK)
        ON le.FILIAL = lep.FILIAL
        AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
    WHERE lep.ROMANEIO_PRODUTO IN ('831452', '831457')
""")
print("\nAmostras das entradas 831452/831457 (qualquer produto):")
print(df_atualiz_all.to_string(index=False))

# ==============================================================
# 5. Mesma análise para as SAIDAS 029374 e 029461
# ==============================================================
sep("9. LOJA_SAIDAS - ROMANEIOS 029374 e 029461")
df_ls = q(conn, f"""
    SELECT ls.ROMANEIO_PRODUTO, ls.FILIAL, ls.EMISSAO,
           ls.TIPO_ENTRADA_SAIDA, ls.STATUS_TRANSITO,
           ls.QTDE_TOTAL, ls.OBS
    FROM LOJA_SAIDAS ls WITH (NOLOCK)
    WHERE ls.ROMANEIO_PRODUTO IN ('029374', '029461')
""")
print(df_ls.to_string(index=False))

df_lsp = q(conn, f"""
    SELECT lsp.ROMANEIO_PRODUTO, lsp.PRODUTO, lsp.COR_PRODUTO,
           lsp.QTDE_SAIDA
    FROM LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
    WHERE lsp.ROMANEIO_PRODUTO IN ('029374', '029461')
      AND lsp.PRODUTO = '{PRODUTO}'
""")
print(f"\nProduto {PRODUTO} nas saídas 029374/029461:")
print(df_lsp.to_string(index=False) if len(df_lsp) > 0 else "NENHUM")

# Qualquer item
df_lsp_all = q(conn, f"""
    SELECT TOP 5 lsp.ROMANEIO_PRODUTO, lsp.PRODUTO, lsp.COR_PRODUTO, lsp.QTDE_SAIDA
    FROM LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
    WHERE lsp.ROMANEIO_PRODUTO IN ('029374', '029461')
""")
print(f"\nAmostras de qualquer item nas saídas 029374/029461:")
print(df_lsp_all.to_string(index=False))

# ==============================================================
# 6. EXTRATO DO PRODUTO 13.71.0365 - GUARULHOS
#    Reconstruir como o Linx monta o extrato
# ==============================================================
sep("10. EXTRATO COMPLETO RECONSTRUÍDO - GUARULHOS RSR")
print("Combinando LOJA ENTRADAS + LOJA SAIDAS + LOJA VENDAS\n")

# Entradas (LOJA_ENTRADAS_PRODUTO)
df_ent = q(conn, f"""
    SELECT
        le.EMISSAO,
        lep.ROMANEIO_PRODUTO AS DOC,
        'LOJA ENTRADAS' AS TIPO,
        lep.QTDE_ENTRADA AS QTDE,
        lep.ATUALIZOU_ESTOQUE
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
        ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
    WHERE lep.PRODUTO = '{PRODUTO}' AND lep.COR_PRODUTO = '{COR}'
      AND le.FILIAL LIKE '%GUARULHOS%'
    ORDER BY le.EMISSAO
""")

# Saídas (LOJA_SAIDAS_PRODUTO)
df_sai = q(conn, f"""
    SELECT
        ls.EMISSAO,
        lsp.ROMANEIO_PRODUTO AS DOC,
        'SAIDA' AS TIPO,
        -lsp.QTDE_SAIDA AS QTDE,
        CAST(1 AS bit) AS ATUALIZOU_ESTOQUE
    FROM LOJA_SAIDAS ls WITH (NOLOCK)
    JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
        ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
    WHERE lsp.PRODUTO = '{PRODUTO}' AND lsp.COR_PRODUTO = '{COR}'
      AND ls.FILIAL LIKE '%GUARULHOS%'
    ORDER BY ls.EMISSAO
""")

# Vendas (LOJA_VENDA_PRODUTO)
df_venda = q(conn, f"""
    SELECT
        v.DATA_VENDA AS EMISSAO,
        v.TICKET AS DOC,
        'LOJA VENDAS' AS TIPO,
        -vp.QTDE AS QTDE,
        CAST(1 AS bit) AS ATUALIZOU_ESTOQUE
    FROM LOJA_VENDA v WITH (NOLOCK)
    JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
    WHERE vp.PRODUTO = '{PRODUTO}' AND vp.COR_PRODUTO = '{COR}'
      AND vp.QTDE_CANCELADA = 0 AND vp.NAO_MOVIMENTA_ESTOQUE = 0
    ORDER BY v.DATA_VENDA
""")
# Precisamos filtrar por filial - mas LOJA_VENDA usa CODIGO_FILIAL
# Vamos incluir tudo por ora e depois filtrar
# Primeiro descobrir o CODIGO_FILIAL da Guarulhos
df_fil = q(conn, """
    SELECT DISTINCT vp.CODIGO_FILIAL
    FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
    WHERE vp.PRODUTO = '13.71.0365'
      AND vp.COR_PRODUTO = '03'
      AND vp.QTDE_CANCELADA = 0
""")
print("CODIGO_FILIAL das vendas deste produto+cor:")
print(df_fil.to_string(index=False))

sep("11. TABELA PRODUTOS_TAMANHOS - GRADE 90X90")
df_grade = q(conn, """
    SELECT GRADE, NUMERO_TAMANHOS,
           TAMANHO_1, TAMANHO_2, TAMANHO_3, TAMANHO_4, TAMANHO_5
    FROM PRODUTOS_TAMANHOS WITH (NOLOCK)
    WHERE GRADE = '90X90'
""")
print(df_grade.to_string(index=False))

sep("12. LOJA_SAIDAS - PRODUTO 13.71.0365 GUARULHOS (todos)")
# Ver se aparece em LOJA_SAIDAS com produto diferente de 'PRODUTO'
df_lsp2 = q(conn, f"""
    SELECT TOP 30
        ls.EMISSAO, ls.FILIAL, ls.ROMANEIO_PRODUTO,
        ls.STATUS_TRANSITO, ls.TIPO_ENTRADA_SAIDA,
        lsp.PRODUTO, lsp.COR_PRODUTO, lsp.QTDE_SAIDA
    FROM LOJA_SAIDAS ls WITH (NOLOCK)
    JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
        ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
    WHERE lsp.PRODUTO = '{PRODUTO}' AND lsp.COR_PRODUTO = '{COR}'
    ORDER BY ls.EMISSAO DESC
""")
print(df_lsp2.to_string(index=False) if len(df_lsp2) > 0 else "NENHUM registro")

sep("13. ESTOQUE_PROD_SAI - PRODUTO 13.71.0365 GUARULHOS")
# Verificar saídas que movimentam estoque (fora de LOJA_SAIDAS)
df_eps = q(conn, f"""
    SELECT TOP 30
        s.ROMANEIO_PRODUTO, s.EMISSAO, s.FILIAL,
        s.TIPO_ROMANEIO, p.PRODUTO, p.COR_PRODUTO, p.QTDE
    FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
    JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
    WHERE p.PRODUTO = '{PRODUTO}' AND p.COR_PRODUTO = '{COR}'
      AND s.FILIAL LIKE '%GUARULHOS%'
    ORDER BY s.EMISSAO DESC
""")
print(df_eps.to_string(index=False) if len(df_eps) > 0 else "NENHUM registro")

sep("14. RESUMO - O QUE SÃO OS TIPOS DE ENTRADA_SAIDA")
df_tipos = q(conn, """
    SELECT TIPO_ENTRADA_SAIDA, DESC_TIPO_ENTRADA_SAIDA, INDICADOR_ENTRADA_SAIDA
    FROM LOJA_TIPOS_ENTRADA_SAIDA WITH (NOLOCK)
    ORDER BY TIPO_ENTRADA_SAIDA
""")
print(df_tipos.to_string(index=False))

sep("15. LOJA_ENTRADAS - TIPO_ENTRADA_SAIDA dos romaneios 831452 e 831457")
df_le_tipo = q(conn, """
    SELECT ROMANEIO_PRODUTO, FILIAL, EMISSAO, TIPO_ENTRADA_SAIDA,
           DESC_TIPO_ENTRADA_SAIDA, STATUS_TRANSITO, OBS
    FROM LOJA_ENTRADAS WITH (NOLOCK)
    WHERE ROMANEIO_PRODUTO IN ('831452', '831457')
""")
print(df_le_tipo.to_string(index=False))

conn.close()
print("\n[OK] Concluído.")

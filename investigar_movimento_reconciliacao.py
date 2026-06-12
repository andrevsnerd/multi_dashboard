#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
INVESTIGACAO READ-ONLY (apenas SELECT) — Reconciliacao do grafico
"Movimento de estoque no periodo" (produto detalhado) vs as fontes
que o extrato admin tambem le (LOJA_ENTRADAS, LOJA_SAIDAS, contagem).

Objetivo: medir o quanto o Movimento perde por NAO ler LOJA_ENTRADAS /
LOJA_SAIDAS / ESTOQUE_PROD_CONTAGEM, e validar se a regex de ajuste
pega os tipos reais de romaneio.

NAO escreve nada. Sem INSERT/UPDATE/DELETE/commit.
"""

import sys
import codecs
import pyodbc

if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

DB = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@',
}

WINDOW_DAYS = 90


def conectar():
    for nome, srv in [('principal', DB['server']), ('fallback', DB['server_fallback'])]:
        try:
            cs = (f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={srv};"
                  f"DATABASE={DB['database']};UID={DB['username']};PWD={DB['password']};"
                  f"Connection Timeout=30;")
            # readonly=True e' apenas uma dica ao driver; a garantia real e' que
            # este script so executa SELECT (nenhum INSERT/UPDATE/DELETE/commit).
            conn = pyodbc.connect(cs, readonly=True)
            conn.timeout = 300
            print(f"[OK] Conectado ({nome}: {srv})")
            return conn
        except Exception as e:
            print(f"[..] Falha {nome} ({srv}): {str(e)[:120]}")
    print("[ERRO] Sem conexao.")
    sys.exit(1)


def scalar(cur, sql):
    cur.execute(sql)
    row = cur.fetchone()
    return row[0] if row else None


def secao(t):
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)


def main():
    conn = conectar()
    cur = conn.cursor()
    W = WINDOW_DAYS

    # ---------------------------------------------------------------
    secao(f"1) LOJA_ENTRADAS x ESTOQUE_PROD_ENT (ultimos {W} dias)")
    # Quantas entradas de loja NAO tem correspondencia em ESTOQUE_PROD_ENT?
    total_le = scalar(cur, f"""
        SELECT COUNT(*) FROM (
          SELECT DISTINCT le.ROMANEIO_PRODUTO, le.FILIAL
          FROM LOJA_ENTRADAS le WITH (NOLOCK)
          WHERE le.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
        ) x
    """)
    orfas_le = scalar(cur, f"""
        SELECT COUNT(*) FROM (
          SELECT DISTINCT le.ROMANEIO_PRODUTO, le.FILIAL
          FROM LOJA_ENTRADAS le WITH (NOLOCK)
          WHERE le.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
            AND NOT EXISTS (
              SELECT 1 FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
              WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND e.FILIAL = le.FILIAL)
        ) x
    """)
    # Qtd de itens orfaos (impacto em unidades)
    qtd_orfas_le = scalar(cur, f"""
        SELECT ISNULL(SUM(lep.QTDE_ENTRADA),0)
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
          ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
        WHERE le.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
          AND NOT EXISTS (
            SELECT 1 FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
            WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND e.FILIAL = le.FILIAL)
    """)
    print(f"Romaneios LOJA_ENTRADAS no periodo : {total_le}")
    print(f"  -> SEM match em ESTOQUE_PROD_ENT : {orfas_le}  (orfaos)")
    if total_le:
        print(f"  -> % orfaos                      : {100.0*orfas_le/total_le:.2f}%")
    print(f"  -> unidades nos orfaos           : {qtd_orfas_le}")

    # ---------------------------------------------------------------
    secao(f"2) LOJA_SAIDAS x ESTOQUE_PROD_SAI (ultimos {W} dias)")
    try:
        total_ls = scalar(cur, f"""
            SELECT COUNT(*) FROM (
              SELECT DISTINCT ls.ROMANEIO_PRODUTO, ls.FILIAL
              FROM LOJA_SAIDAS ls WITH (NOLOCK)
              WHERE ls.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
            ) x
        """)
        orfas_ls = scalar(cur, f"""
            SELECT COUNT(*) FROM (
              SELECT DISTINCT ls.ROMANEIO_PRODUTO, ls.FILIAL
              FROM LOJA_SAIDAS ls WITH (NOLOCK)
              WHERE ls.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
                AND NOT EXISTS (
                  SELECT 1 FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
                  WHERE s.ROMANEIO_PRODUTO = ls.ROMANEIO_PRODUTO AND s.FILIAL = ls.FILIAL)
            ) x
        """)
        qtd_orfas_ls = scalar(cur, f"""
            SELECT ISNULL(SUM(lsp.QTDE_SAIDA),0)
            FROM LOJA_SAIDAS ls WITH (NOLOCK)
            JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
              ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
            WHERE ls.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
              AND NOT EXISTS (
                SELECT 1 FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
                WHERE s.ROMANEIO_PRODUTO = ls.ROMANEIO_PRODUTO AND s.FILIAL = ls.FILIAL)
        """)
        print(f"Romaneios LOJA_SAIDAS no periodo  : {total_ls}")
        print(f"  -> SEM match em ESTOQUE_PROD_SAI : {orfas_ls}  (orfaos)")
        if total_ls:
            print(f"  -> % orfaos                      : {100.0*orfas_ls/total_ls:.2f}%")
        print(f"  -> unidades nos orfaos           : {qtd_orfas_ls}")
    except Exception as e:
        print(f"[INFO] LOJA_SAIDAS: {str(e)[:160]}")

    # ---------------------------------------------------------------
    secao(f"3) CONTAGEM/AJUSTE (ESTOQUE_PROD_CONTAGEM) ajustada no periodo")
    try:
        cont = scalar(cur, f"""
            SELECT COUNT(*)
            FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
            JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
            WHERE c.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
              AND c.ESTOQUE_AJUSTADO = 1
        """)
        cont_qtd = scalar(cur, f"""
            SELECT ISNULL(SUM(ABS(a.QTDE_AJUSTE)),0)
            FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
            JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
            WHERE c.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
              AND c.ESTOQUE_AJUSTADO = 1
        """)
        print(f"Linhas de ajuste de contagem      : {cont}")
        print(f"  -> unidades (|ajuste|) movidas   : {cont_qtd}")
        print("  (se >0, e essas contagens NAO gerarem ENT/SAI, e gap puro)")
    except Exception as e:
        print(f"[INFO] CONTAGEM: {str(e)[:160]}")

    # ---------------------------------------------------------------
    secao("4) TIPOS DE ROMANEIO presentes em ESTOQUE_PROD_ENT/SAI")
    print("   (valida se a regex de ajuste pega os tipos reais)\n")
    for tabela, alias in [('ESTOQUE_PROD_ENT', 'ENT'), ('ESTOQUE_PROD_SAI', 'SAI')]:
        try:
            cur.execute(f"""
                SELECT TOP 40 RTRIM(LTRIM(CAST(TIPO_ROMANEIO AS VARCHAR(60)))) AS T, COUNT(*) AS N
                FROM {tabela} WITH (NOLOCK)
                WHERE EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
                GROUP BY RTRIM(LTRIM(CAST(TIPO_ROMANEIO AS VARCHAR(60))))
                ORDER BY COUNT(*) DESC
            """)
            print(f"  [{alias}] TIPO_ROMANEIO (top por volume):")
            for r in cur.fetchall():
                print(f"      {str(r[0])[:50]:<50} {r[1]}")
        except Exception as e:
            print(f"  [{alias}] erro: {str(e)[:140]}")
        print()

    conn.close()
    print("[OK] Conexao fechada. (nada foi escrito)")


if __name__ == '__main__':
    main()

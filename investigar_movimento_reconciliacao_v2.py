#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
INVESTIGACAO READ-ONLY v2 (apenas SELECT) — refina os 2 pontos abertos:
 A) Das LOJA_ENTRADAS orfas, quantas REALMENTE mexeram no estoque
    (ATUALIZOU_ESTOQUE=1) vs trânsito não confirmado (=0).
 B) A contagem (ESTOQUE_PROD_CONTAGEM) gera romaneio AJUSTE em ENT/SAI
    (-> Movimento ja captura via reclassificacao) ou aplica direto no
    estoque sem ENT/SAI (-> gap puro)?

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
W = 90

# Padrao de ajuste igual ao da regex aplicada no codigo (isAjusteMovimento)
AJUSTE_LIKE = ("(TIPO LIKE '%AJUST%' OR TIPO LIKE '%INVENT%' OR TIPO LIKE '%ACERT%' "
               "OR TIPO LIKE '%BALAN%' OR TIPO LIKE '%CONTAG%' OR TIPO LIKE '%AVULS%' "
               "OR TIPO LIKE '%DEFEIT%' OR TIPO LIKE '%MOV%INTERNA%')")


def conectar():
    for nome, srv in [('principal', DB['server']), ('fallback', DB['server_fallback'])]:
        try:
            cs = (f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={srv};"
                  f"DATABASE={DB['database']};UID={DB['username']};PWD={DB['password']};"
                  f"Connection Timeout=30;")
            conn = pyodbc.connect(cs, readonly=True)
            conn.timeout = 300
            print(f"[OK] Conectado ({nome}: {srv})")
            return conn
        except Exception as e:
            print(f"[..] Falha {nome}: {str(e)[:120]}")
    sys.exit(1)


def scalar(cur, sql):
    cur.execute(sql)
    r = cur.fetchone()
    return r[0] if r else None


def secao(t):
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)


def main():
    conn = conectar()
    cur = conn.cursor()

    # ---------------------------------------------------------------
    secao(f"A) LOJA_ENTRADAS orfas — quebradas por ATUALIZOU_ESTOQUE ({W}d)")
    print("   atualizou=1 -> mexeu no estoque (GAP REAL do Movimento)")
    print("   atualizou=0 -> transito/nao confirmado (Movimento ignora CERTO)\n")
    try:
        cur.execute(f"""
            SELECT ISNULL(lep.ATUALIZOU_ESTOQUE,0) AS atualizou,
                   COUNT(*) AS linhas,
                   ISNULL(SUM(lep.QTDE_ENTRADA),0) AS un
            FROM LOJA_ENTRADAS le WITH (NOLOCK)
            JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
              ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
            WHERE le.EMISSAO >= DATEADD(DAY, -{W}, GETDATE())
              AND NOT EXISTS (
                SELECT 1 FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
                WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND e.FILIAL = le.FILIAL)
            GROUP BY ISNULL(lep.ATUALIZOU_ESTOQUE,0)
            ORDER BY atualizou
        """)
        for r in cur.fetchall():
            print(f"   ATUALIZOU_ESTOQUE={r[0]}  | linhas={r[1]:<7} | unidades={r[2]}")
    except Exception as e:
        print(f"   [INFO] {str(e)[:200]}")

    # ---------------------------------------------------------------
    secao(f"B) Unidades de AJUSTE: ENT/SAI (capturado) vs CONTAGEM ({W}d)")

    # B1 — unidades reclassificadas como ajuste a partir de ENT/SAI (o que o Movimento JA pega)
    try:
        ent_aj = scalar(cur, f"""
            SELECT ISNULL(SUM(p.QTDE),0)
            FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
            JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
            CROSS APPLY (SELECT UPPER(LTRIM(RTRIM(CAST(e.TIPO_ROMANEIO AS VARCHAR(80))))) AS TIPO) t
            WHERE e.EMISSAO >= DATEADD(DAY, -{W}, GETDATE()) AND {AJUSTE_LIKE}
        """)
        sai_aj = scalar(cur, f"""
            SELECT ISNULL(SUM(p.QTDE),0)
            FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
            JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
            CROSS APPLY (SELECT UPPER(LTRIM(RTRIM(CAST(s.TIPO_ROMANEIO AS VARCHAR(80))))) AS TIPO) t
            WHERE s.EMISSAO >= DATEADD(DAY, -{W}, GETDATE()) AND {AJUSTE_LIKE}
        """)
        print(f"   B1) ENT ajuste (un. capturadas): {ent_aj}")
        print(f"       SAI ajuste (un. capturadas): {sai_aj}")
        print(f"       TOTAL capturado pelo Movimento: {ent_aj + sai_aj}")
    except Exception as e:
        print(f"   [INFO] B1: {str(e)[:200]}")

    # B2 — unidades de contagem (deduplicado, sem fan-out do JOIN)
    try:
        cont_un = scalar(cur, f"""
            SELECT ISNULL(SUM(ABS(a.QTDE_AJUSTE)),0)
            FROM ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK)
            WHERE EXISTS (
              SELECT 1 FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
              WHERE c.NOME_CONTAGEM = a.NOME_CONTAGEM
                AND c.ESTOQUE_AJUSTADO = 1
                AND c.EMISSAO >= DATEADD(DAY, -{W}, GETDATE()))
        """)
        cont_naozero = scalar(cur, f"""
            SELECT COUNT(*)
            FROM ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK)
            WHERE a.QTDE_AJUSTE <> 0 AND EXISTS (
              SELECT 1 FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
              WHERE c.NOME_CONTAGEM = a.NOME_CONTAGEM
                AND c.ESTOQUE_AJUSTADO = 1
                AND c.EMISSAO >= DATEADD(DAY, -{W}, GETDATE()))
        """)
        print(f"\n   B2) CONTAGEM ajuste deduplicado:")
        print(f"       linhas com QTDE_AJUSTE<>0     : {cont_naozero}")
        print(f"       unidades |ajuste| da contagem : {cont_un}")
    except Exception as e:
        print(f"   [INFO] B2: {str(e)[:200]}")

    # B3 — interpretacao automatica
    try:
        cap = (ent_aj or 0) + (sai_aj or 0)
        print(f"\n   LEITURA: se contagem ({cont_un}) >> capturado ({cap}),")
        print(f"            a contagem NAO passa por ENT/SAI -> gap real no saldo.")
        print(f"            se forem proximos, a contagem JA esta no Movimento.")
    except Exception:
        pass

    conn.close()
    print("\n[OK] Conexao fechada. (nada foi escrito)")


if __name__ == '__main__':
    main()

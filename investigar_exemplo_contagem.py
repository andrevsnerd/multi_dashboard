#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
READ-ONLY (apenas SELECT) — exemplos visuais do efeito da contagem no
grafico "Movimento de estoque no periodo".

Acha:
  EX-A) um produto+cor+filial que TEVE contagem no periodo -> mostra o
        desvio (a reconstrucao do Movimento fica off por QTDE_AJUSTE nos
        dias ANTES da contagem).
  EX-B) um produto+cor+filial SEM contagem no periodo -> reconstrucao exata.

NAO escreve nada.
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
W = 90  # janela do "periodo" do exemplo


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


def secao(t):
    print("\n" + "=" * 78)
    print(t)
    print("=" * 78)


def estoque_atual(cur, prod, cor, filial):
    cur.execute("""
        SELECT ISNULL(SUM(ISNULL(ep.ESTOQUE,0)),0)
        FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
        WHERE RTRIM(LTRIM(CAST(ep.PRODUTO AS VARCHAR(50)))) = ?
          AND RTRIM(LTRIM(ISNULL(CAST(ep.COR_PRODUTO AS VARCHAR(20)),''))) = ?
          AND RTRIM(LTRIM(CAST(ep.FILIAL AS VARCHAR(100)))) = ?
    """, [prod, cor, filial])
    r = cur.fetchone()
    return r[0] if r else 0


def movimentos_capturados(cur, prod, cor, filial):
    """Entradas (ENT nao-ajuste) e saidas mov.estoque (SAI nao-ajuste) no periodo — o que o Movimento ve."""
    ent = cur.execute(f"""
        SELECT ISNULL(SUM(p.QTDE),0)
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO=p.ROMANEIO_PRODUTO
        WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50))))=?
          AND RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),'')))=?
          AND RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(100))))=?
          AND e.EMISSAO >= DATEADD(DAY,-{W},GETDATE())
    """, [prod, cor, filial]).fetchone()[0]
    sai = cur.execute(f"""
        SELECT ISNULL(SUM(p.QTDE),0)
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO=p.ROMANEIO_PRODUTO
        WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50))))=?
          AND RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),'')))=?
          AND RTRIM(LTRIM(CAST(s.FILIAL AS VARCHAR(100))))=?
          AND s.EMISSAO >= DATEADD(DAY,-{W},GETDATE())
    """, [prod, cor, filial]).fetchone()[0]
    return ent, sai


def contagens(cur, prod, cor, filial):
    cur.execute(f"""
        SELECT c.EMISSAO, a.QTDE_AJUSTE, c.NOME_CONTAGEM
        FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
        JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM=a.NOME_CONTAGEM
        WHERE RTRIM(LTRIM(CAST(a.PRODUTO AS VARCHAR(50))))=?
          AND RTRIM(LTRIM(ISNULL(CAST(a.COR_PRODUTO AS VARCHAR(20)),'')))=?
          AND RTRIM(LTRIM(CAST(c.FILIAL AS VARCHAR(100))))=?
          AND c.ESTOQUE_AJUSTADO=1
          AND c.EMISSAO >= DATEADD(DAY,-{W},GETDATE())
        ORDER BY c.EMISSAO
    """, [prod, cor, filial])
    return cur.fetchall()


def detalhar(cur, titulo, prod, cor, filial):
    secao(titulo)
    print(f"   Produto {prod} | cor {cor or '(sem)'} | filial {filial}")
    est = estoque_atual(cur, prod, cor, filial)
    ent, sai = movimentos_capturados(cur, prod, cor, filial)
    conts = contagens(cur, prod, cor, filial)
    soma_cont = sum(int(c[1]) for c in conts)
    print(f"   Estoque atual (real, Linx)        : {est} un.")
    print(f"   Entradas capturadas (ENT) {W}d     : +{ent}")
    print(f"   Saidas mov.estoque (SAI) {W}d      : -{sai}")
    print(f"   Contagens no periodo               : {len(conts)}")
    for emi, q, nome in conts:
        d = emi.strftime('%d/%m/%Y') if emi else '??'
        print(f"       {d} | QTDE_AJUSTE={int(q):+d} | {str(nome).strip()[:30]}")
    print(f"   Soma das contagens (nao capturada) : {soma_cont:+d} un.")
    print()
    if soma_cont != 0:
        print(f"   >> No grafico Movimento: do dia da contagem ate hoje o saldo")
        print(f"      esta CORRETO; ANTES da contagem o grafico mostra {abs(soma_cont)} un.")
        print(f"      {'A MAIS' if soma_cont>0 else 'A MENOS'} do que realmente tinha (desvio = {soma_cont:+d}).")
    else:
        print(f"   >> Sem contagem -> reconstrucao EXATA (saldo bate todo o periodo).")
    return est, ent, sai, soma_cont


def main():
    conn = conectar()
    cur = conn.cursor()

    # --- Candidato COM contagem: magnitude legivel, com estoque atual > 0 ---
    secao("Buscando candidatos COM contagem no periodo...")
    cur.execute(f"""
        SELECT TOP 15
            RTRIM(LTRIM(CAST(a.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
            RTRIM(LTRIM(ISNULL(CAST(a.COR_PRODUTO AS VARCHAR(20)),''))) AS COR,
            RTRIM(LTRIM(CAST(c.FILIAL AS VARCHAR(100)))) AS FILIAL,
            SUM(a.QTDE_AJUSTE) AS SOMA_AJ,
            COUNT(*) AS N
        FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
        JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM=a.NOME_CONTAGEM
        WHERE c.ESTOQUE_AJUSTADO=1
          AND c.EMISSAO >= DATEADD(DAY,-{W},GETDATE())
        GROUP BY RTRIM(LTRIM(CAST(a.PRODUTO AS VARCHAR(50)))),
                 RTRIM(LTRIM(ISNULL(CAST(a.COR_PRODUTO AS VARCHAR(20)),''))),
                 RTRIM(LTRIM(CAST(c.FILIAL AS VARCHAR(100))))
        HAVING ABS(SUM(a.QTDE_AJUSTE)) BETWEEN 5 AND 60 AND COUNT(*) <= 3
        ORDER BY ABS(SUM(a.QTDE_AJUSTE)) DESC
    """)
    cands = cur.fetchall()
    escolhido = None
    for prod, cor, filial, soma, n in cands:
        if estoque_atual(cur, prod, cor, filial) > 0:
            escolhido = (prod, cor, filial)
            break
    if escolhido:
        detalhar(cur, "EXEMPLO A — produto COM contagem no periodo", *escolhido)
    else:
        print("   (nenhum candidato com estoque atual>0 encontrado)")

    # --- Candidato SEM contagem: tem estoque e movimento, sem contagem ---
    secao("Buscando candidato SEM contagem (mas com movimento)...")
    cur.execute(f"""
        SELECT TOP 30
            RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
            RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),''))) AS COR,
            RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(100)))) AS FILIAL,
            SUM(p.QTDE) AS ENT
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO=p.ROMANEIO_PRODUTO
        WHERE e.EMISSAO >= DATEADD(DAY,-{W},GETDATE())
        GROUP BY RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))),
                 RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),''))),
                 RTRIM(LTRIM(CAST(e.FILIAL AS VARCHAR(100))))
        HAVING SUM(p.QTDE) BETWEEN 5 AND 80
        ORDER BY SUM(p.QTDE) DESC
    """)
    semc = None
    for prod, cor, filial, ent in cur.fetchall():
        if estoque_atual(cur, prod, cor, filial) > 0 and len(contagens(cur, prod, cor, filial)) == 0:
            semc = (prod, cor, filial)
            break
    if semc:
        detalhar(cur, "EXEMPLO B — produto SEM contagem no periodo", *semc)
    else:
        print("   (nenhum candidato sem contagem encontrado)")

    conn.close()
    print("\n[OK] Conexao fechada. (nada foi escrito)")


if __name__ == '__main__':
    main()

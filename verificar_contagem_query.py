#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""READ-ONLY: valida o nucleo da query de contagem usada na implementacao."""
import sys, codecs, pyodbc
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
DB = {'server': '177.92.78.250', 'fb': '189.126.197.82', 'database': 'LINX_PRODUCAO',
      'username': 'andre.nerd', 'password': 'nerd123@'}
for srv in [DB['server'], DB['fb']]:
    try:
        conn = pyodbc.connect(
            f"DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={srv};DATABASE={DB['database']};"
            f"UID={DB['username']};PWD={DB['password']};Connection Timeout=30;", readonly=True)
        print(f"[OK] Conectado ({srv})")
        break
    except Exception as e:
        print(f"[..] {str(e)[:80]}")
cur = conn.cursor()
# Mesma estrutura da query implementada (produto com RTRIM, sinal preservado, ESTOQUE_AJUSTADO=1)
cur.execute("""
    SELECT CAST(c.EMISSAO AS DATE) AS d, c.FILIAL AS filial, SUM(ISNULL(a.QTDE_AJUSTE,0)) AS qty
    FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
    INNER JOIN ESTOQUE_PROD_CTG_AJUSTE a WITH (NOLOCK) ON c.NOME_CONTAGEM = a.NOME_CONTAGEM
    WHERE RTRIM(LTRIM(CAST(a.PRODUTO AS VARCHAR(50)))) = 'A3.44.0045'
      AND RTRIM(LTRIM(ISNULL(CAST(a.COR_PRODUTO AS VARCHAR(20)),''))) = '01'
      AND c.ESTOQUE_AJUSTADO = 1
      AND c.EMISSAO >= DATEADD(DAY,-90,GETDATE())
    GROUP BY CAST(c.EMISSAO AS DATE), c.FILIAL
    ORDER BY d
""")
rows = cur.fetchall()
print(f"\nLinhas retornadas para A3.44.0045/01 (90d):")
for r in rows:
    print(f"   {r[0]} | {str(r[1]).strip():<25} | qty (sinal) = {int(r[2]):+d}")
print(f"\nEsperado: 09/05/2026 | SCARF ME - MATRIZ | +60")
conn.close()
print("[OK] (nada escrito)")

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Busca vendas e-commerce: linha PASHMINA, grade 70x180, fevereiro/2025.
Usa a mesma base do exportar_todos_relatorios.py (FATURAMENTO + W_FATURAMENTO_PROD_02)
para comparar com o que o sistema de projecao retorna (que esta vindo 0).

Uso: python buscar_ecommerce_pashmina_fev2025.py
"""

import sys
import os

import pandas as pd

# Permitir importar do mesmo diretorio (exportar_todos_relatorios.py)
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

try:
    from exportar_todos_relatorios import conectar_banco
except ImportError:
    print("Erro: exportar_todos_relatorios.py deve estar no mesmo diretorio.")
    sys.exit(1)

# Filiais e-commerce (mesmo do lib/config/company.ts - ScarfMe)
ECOM_FILIAIS = [
    "SCARFME MATRIZ CMS",
    "SCARF ME - MATRIZ LLL",
    "SCARF ME MATRIZ - FFF",
    "MSC COMERCIO DE LENCOS LT",
]

LINHA_BUSCA = "PASHMINA"
GRADE_BUSCA = "70X180"
ANO = 2025
MES = 2  # Fevereiro


def run_debug(conn):
    """Lista filiais, linhas e grades em e-commerce fev/2025 para conferir valores no banco."""
    print("\n[DEBUG] E-commerce fev/2025 - valores no banco:")
    base = """
    FROM FATURAMENTO f WITH (NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
      ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
    WHERE f.NOTA_CANCELADA = 0 AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
      AND CAST(fp.QTDE AS FLOAT) > 0
      AND ((fp.ENTREGA >= '2025-02-01' AND fp.ENTREGA < '2025-03-01')
           OR (fp.ENTREGA IS NULL AND f.EMISSAO >= '2025-02-01' AND f.EMISSAO < '2025-03-01'))
    """
    # Filiais distintas
    df_f = pd.read_sql("SELECT DISTINCT LTRIM(RTRIM(f.FILIAL)) AS FILIAL" + base, conn)
    print("  Filiais com movimento fev/2025:", list(df_f["FILIAL"].dropna()))
    # Linhas distintas (que contenham PASHMINA ou top 15)
    df_l = pd.read_sql(
        "SELECT DISTINCT TOP 20 UPPER(LTRIM(RTRIM(ISNULL(p.LINHA,'')))) AS LINHA" + base + " AND LTRIM(RTRIM(ISNULL(p.LINHA,''))) <> ''",
        conn,
    )
    print("  Linhas (top 20):", list(df_l["LINHA"].dropna()))
    # Grades distintas (que contenham 70 ou 180 ou top 15)
    df_g = pd.read_sql(
        "SELECT DISTINCT TOP 20 UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,p.GRADE),'')))) AS GRADE" + base + " AND LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,p.GRADE),''))) <> ''",
        conn,
    )
    print("  Grades (top 20):", list(df_g["GRADE"].dropna()))


def main():
    print("=" * 60)
    print("E-COMMERCE: Linha PASHMINA, Grade 70x180, Fevereiro 2025")
    print("=" * 60)

    conn = conectar_banco()

    # Data para filtro: usar ENTREGA quando existir (como no sistema), senao EMISSAO
    # Assim batemos com a logica da projecao (data de entrega = mes da venda)
    sql = """
    SELECT
        LTRIM(RTRIM(f.FILIAL)) AS FILIAL,
        f.NF_SAIDA,
        f.SERIE_NF,
        fp.PRODUTO,
        fp.COR_PRODUTO,
        UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,
        UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) AS GRADE,
        fp.ENTREGA,
        f.EMISSAO,
        COALESCE(CAST(fp.ENTREGA AS DATE), CAST(f.EMISSAO AS DATE)) AS DATA_VENDA,
        CAST(fp.QTDE AS FLOAT) AS QTDE
    FROM FATURAMENTO f WITH (NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
    WHERE f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
      AND CAST(fp.QTDE AS FLOAT) > 0
      AND REPLACE(REPLACE(LTRIM(RTRIM(f.FILIAL)), NCHAR(0x00A0), ' '), CHAR(9), ' ') IN (?, ?, ?, ?)
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = ?
      AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = ?
      AND YEAR(COALESCE(CAST(fp.ENTREGA AS DATE), CAST(f.EMISSAO AS DATE))) = ?
      AND MONTH(COALESCE(CAST(fp.ENTREGA AS DATE), CAST(f.EMISSAO AS DATE))) = ?
    ORDER BY DATA_VENDA, f.FILIAL, f.NF_SAIDA, fp.ITEM
    """

    params = ECOM_FILIAIS + [LINHA_BUSCA, GRADE_BUSCA, ANO, MES]

    try:
        df = pd.read_sql(sql, conn, params=params)
    except Exception as e:
        print(f"Erro na query: {e}")
        conn.close()
        sys.exit(1)

    conn.close()

    total_registros = len(df)
    total_qtde = df["QTDE"].sum() if total_registros else 0

    print(f"\nTotal de linhas (itens): {total_registros}")
    print(f"Total QTDE (unidades):   {total_qtde:.0f}")
    print()

    if total_registros == 0:
        print("Nenhum registro com DATA_VENDA = ENTREGA ou EMISSAO em fev/2025.")
        print("Tentando apenas por EMISSAO (f.EMISSAO em fev/2025)...")
        sql_emissao = """
        SELECT LTRIM(RTRIM(f.FILIAL)) AS FILIAL, f.NF_SAIDA, fp.PRODUTO,
               UPPER(LTRIM(RTRIM(ISNULL(p.LINHA,'')))) AS LINHA,
               UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,p.GRADE),'')))) AS GRADE,
               f.EMISSAO, CAST(fp.QTDE AS FLOAT) AS QTDE
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE f.NOTA_CANCELADA = 0 AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND CAST(fp.QTDE AS FLOAT) > 0
          AND REPLACE(REPLACE(LTRIM(RTRIM(f.FILIAL)), NCHAR(0x00A0), ' '), CHAR(9), ' ') IN (?, ?, ?, ?)
          AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA,'')))) = ?
          AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,p.GRADE),'')))) = ?
          AND f.EMISSAO >= '2025-02-01' AND f.EMISSAO < '2025-03-01'
        """
        conn2 = conectar_banco()
        df2 = pd.read_sql(sql_emissao, conn2, params=ECOM_FILIAIS + [LINHA_BUSCA, GRADE_BUSCA])
        conn2.close()
        n2 = len(df2)
        q2 = df2["QTDE"].sum() if n2 else 0
        print(f"  Por EMISSAO: {n2} linhas, QTDE total = {q2:.0f}")
        if n2 > 0:
            print(df2.head(10).to_string(index=False))
        print("\nVerifique: nomes das filiais, LINHA=PASHMINA, GRADE=70x180 no PRODUTOS.")
        return

    print("Amostra (primeiros 20 registros):")
    print("-" * 60)
    pd.set_option("display.max_columns", None)
    pd.set_option("display.width", None)
    pd.set_option("display.max_colwidth", 20)
    print(df.head(20).to_string(index=False))
    print("-" * 60)
    print(f"\nResumo por filial (QTDE):")
    print(df.groupby("FILIAL")["QTDE"].sum().to_string())
    print("\n[OK] Se ha registros aqui e no sistema aparece 0, a causa pode ser:")
    print("     - Filtro de linha/grade na projecao (frontend/API)")
    print("     - Agrupamento por categoria que nao inclui essa chave")
    print("     - Ou uso de EMISSAO em vez de ENTREGA no backend (ja ajustado)")


if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser(description="Busca e-commerce PASHMINA 70x180 fev/2025")
    p.add_argument("--debug", action="store_true", help="Listar filiais, linhas e grades no banco (fev/2025)")
    args = p.parse_args()
    if args.debug:
        conn = conectar_banco()
        run_debug(conn)
        conn.close()
    else:
        main()

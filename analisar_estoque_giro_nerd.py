#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Análise de estoque NERD: total vs estoque filtrado por giro (30 dias).

Replica a lógica do Controle de Estoque (dashboard):
- Estoque total por categoria (GRUPO_PRODUTO), filiais inventário, LINHA=ELETRONICOS.
- Estoque filtrado por giro: apenas produtos que venderam na faixa dos últimos 30 dias
  (mesmo período e filiais de venda usados no dashboard).

Uso:
  python analisar_estoque_giro_nerd.py

Requer: pyodbc, pandas. Opcional: python-dotenv para .env.local
"""

import os
import sys
from datetime import datetime, timedelta

try:
    import pyodbc
except ImportError:
    print("Instale: pip install pyodbc")
    sys.exit(1)
try:
    import pandas as pd
except ImportError:
    print("Instale: pip install pandas")
    sys.exit(1)

# Carregar .env.local se existir (DB_SERVER, DB_DATABASE, DB_USERNAME, DB_PASSWORD)
try:
    from dotenv import load_dotenv
    load_dotenv(".env.local")
except ImportError:
    pass

# Config NERD (espelha lib/config/company.ts e lib/db/connection.ts)
FILIAIS_INVENTARIO_NERD = [
    "NERD CENTER NORTE",
    "NERD HIGIENOPOLIS",
    "NERD LEBLON",
    "NERD MORUMBI RDRRRJ",
    "NERD VILLA LOBOS",
    "NERD",
]
FILIAIS_VENDA_NERD = [
    "NERD CENTER NORTE",
    "NERD HIGIENOPOLIS",
    "NERD LEBLON",
    "NERD MORUMBI RDRRRJ",
    "NERD VILLA LOBOS",
]


def get_db_config():
    return {
        "server": os.getenv("DB_SERVER", "177.92.78.250"),
        "database": os.getenv("DB_DATABASE", "LINX_PRODUCAO"),
        "username": os.getenv("DB_USERNAME", "andre.nerd"),
        "password": os.getenv("DB_PASSWORD", "nerd123@"),
    }


def conectar():
    cfg = get_db_config()
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={cfg['server']};"
        f"DATABASE={cfg['database']};"
        f"UID={cfg['username']};"
        f"PWD={cfg['password']};"
        "Connection Timeout=30;"
    )
    conn = pyodbc.connect(conn_str)
    conn.timeout = 300
    return conn


def periodo_30_dias():
    """Últimos 30 dias tendo a data de HOJE como referência (horário local).
    Início = (hoje - 30 dias) 00:00; Fim = amanhã 00:00 (exclusivo), igual ao dashboard.
    """
    hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    fim = hoje + timedelta(days=1)   # fim do período = início do dia seguinte (exclusivo)
    inicio = hoje - timedelta(days=30)
    return inicio, fim


def run_estoque_total(conn):
    """Estoque total por categoria (GRUPO_PRODUTO), sem filtro de giro."""
    placeholders = ",".join(["?"] * len(FILIAIS_INVENTARIO_NERD))
    sql = f"""
    SELECT
        ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO') AS categoria,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custo
    FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
    WHERE e.FILIAL IN ({placeholders})
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'ELETRONICOS'
      AND e.ESTOQUE > 0
      AND ISNULL(p.GRUPO_PRODUTO, '') <> ''
      AND LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO'))) NOT IN ('BAG', 'ASSISTENCIA')
    GROUP BY ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO')
    HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    ORDER BY estoque DESC
    """
    return pd.read_sql(sql, conn, params=FILIAIS_INVENTARIO_NERD)


def run_estoque_com_giro_30d(conn, inicio, fim):
    """Estoque por categoria apenas de produtos que venderam no período (30 dias)."""
    placeholders_est = ",".join(["?"] * len(FILIAIS_INVENTARIO_NERD))
    placeholders_venda = ",".join(["?"] * len(FILIAIS_VENDA_NERD))
    # Parâmetros: filiais estoque, depois inicio, fim, depois filiais venda
    params = list(FILIAIS_INVENTARIO_NERD) + [inicio, fim] + list(FILIAIS_VENDA_NERD)
    sql = f"""
    SELECT
        ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO') AS categoria,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0) ELSE 0 END) AS custo
    FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
    WHERE e.FILIAL IN ({placeholders_est})
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'ELETRONICOS'
      AND e.ESTOQUE > 0
      AND ISNULL(p.GRUPO_PRODUTO, '') <> ''
      AND LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO'))) NOT IN ('BAG', 'ASSISTENCIA')
      AND EXISTS (
        SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = e.PRODUTO
          AND vp.DATA_VENDA >= ?
          AND vp.DATA_VENDA < ?
          AND vp.QTDE > 0
          AND vp.FILIAL IN ({placeholders_venda})
      )
    GROUP BY ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO')
    HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    ORDER BY estoque DESC
    """
    return pd.read_sql(sql, conn, params=params)


def main():
    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    inicio, fim = periodo_30_dias()
    hoje_ref = fim - timedelta(days=1)  # último dia do período = data de hoje
    print("=" * 70)
    print("ANÁLISE ESTOQUE NERD — Total vs Filtrado por Giro (30 dias)")
    print("=" * 70)
    print(f"Data de hoje (referência): {hoje_ref.strftime('%d/%m/%Y')}")
    print(f"Período do giro: {inicio.strftime('%d/%m/%Y')} 00:00 até {fim.strftime('%d/%m/%Y')} 00:00 (exclusivo)")
    print()

    conn = conectar()
    try:
        df_total = run_estoque_total(conn)
        df_giro = run_estoque_com_giro_30d(conn, inicio, fim)

        total_un_total = int(df_total["estoque"].sum())
        total_custo_total = float(df_total["custo"].sum())
        total_un_giro = int(df_giro["estoque"].sum())
        total_custo_giro = float(df_giro["custo"].sum())

        print("--- TOTAIS GERAIS ---")
        print(f"Estoque TOTAL (todas categorias, sem filtro giro): {total_un_total:,} un  |  Custo: R$ {total_custo_total:,.2f}")
        print(f"Estoque COM GIRO 30d (só produtos que venderam):     {total_un_giro:,} un  |  Custo: R$ {total_custo_giro:,.2f}")
        print(f"Diferença (sem giro - com giro):                   {total_un_total - total_un_giro:,} un  |  R$ {total_custo_total - total_custo_giro:,.2f}")
        print()
        print("Compare os totais acima com o dashboard (Controle de Estoque, giro 30 dias):")
        print("  - Com giro ativo, o card 'ESTOQUE TOTAL' e 'VALOR EM ESTOQUE' devem bater com 'Estoque COM GIRO 30d'.")
        print()

        print("--- POR CATEGORIA (estoque total, sem giro) ---")
        print(df_total.to_string(index=False))
        print()
        print("--- POR CATEGORIA (estoque filtrado por giro 30d) ---")
        print(df_giro.to_string(index=False))
        print()

        # Merge para comparar categoria a categoria
        merge = df_total.merge(
            df_giro,
            on="categoria",
            how="outer",
            suffixes=("_total", "_giro"),
        ).fillna(0)
        merge["diff_un"] = merge["estoque_total"] - merge["estoque_giro"]
        merge["diff_custo"] = merge["custo_total"] - merge["custo_giro"]
        print("--- DIFERENÇA POR CATEGORIA (total - giro) ---")
        print(merge[["categoria", "estoque_total", "estoque_giro", "diff_un", "custo_total", "custo_giro", "diff_custo"]].to_string(index=False))
    finally:
        conn.close()

    print()
    print("Concluído. Use os totais e por-categoria para conferir com o dashboard.")


if __name__ == "__main__":
    main()

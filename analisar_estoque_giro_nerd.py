#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Análise de estoque NERD: total vs estoque filtrado por giro (faixas disjuntas).

Replica a lógica do Controle de Estoque (dashboard):
- Estoque total por categoria (GRUPO_PRODUTO), filiais inventário, LINHA=ELETRONICOS.
- Faixas DISJUNTAS (cada produto entra em no máximo uma faixa):
  - 30 dias:  vendeu entre 0 e 30 dias atrás
  - 60 dias:  vendeu entre 30 e 60 dias atrás e NÃO vendeu em 0-30
  - 90 dias:  vendeu entre 60 e 90 dias atrás e NÃO vendeu em 0-60
  - 120 dias: vendeu entre 90 e 120 dias atrás e NÃO vendeu em 0-90
  - 150 dias: vendeu entre 120 e 150 dias atrás e NÃO vendeu em 0-120
  - 300 dias: vendeu entre 150 e 300 dias atrás e NÃO vendeu em 0-150

Uso:
  python analisar_estoque_giro_nerd.py
  python analisar_estoque_giro_nerd.py --categoria PELICULAS
  python analisar_estoque_giro_nerd.py --categoria CAPAS

Requer: pyodbc, pandas. Opcional: python-dotenv para .env.local
"""

import argparse
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

# Faixas em dias (espelha GIRO_BUCKETS do backend). Obsoleto = sem venda em 300d (não é um "bucket" numérico).
GIRO_BUCKETS = [30, 60, 90, 120, 150, 300]
GIRO_OBSOLETO_DIAS = 300

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


def run_estoque_total(conn, categoria=None):
    """Estoque total por categoria (GRUPO_PRODUTO), sem filtro de giro.
    Se categoria for informada, filtra por ela.
    """
    placeholders = ",".join(["?"] * len(FILIAIS_INVENTARIO_NERD))
    params = list(FILIAIS_INVENTARIO_NERD)
    filtro_cat = ""
    if categoria:
        filtro_cat = " AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = ?"
        params.append(categoria.upper().strip())
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
      {filtro_cat}
    GROUP BY ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO')
    HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    ORDER BY estoque DESC
    """
    return pd.read_sql(sql, conn, params=params)


def run_estoque_obsoleto(conn, categoria):
    """Estoque da categoria: produtos que NÃO venderam nos últimos GIRO_OBSOLETO_DIAS dias."""
    hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_excl = hoje - timedelta(days=GIRO_OBSOLETO_DIAS)
    fim_excl = hoje + timedelta(days=1)
    placeholders_est = ",".join(["?"] * len(FILIAIS_INVENTARIO_NERD))
    placeholders_venda = ",".join(["?"] * len(FILIAIS_VENDA_NERD))
    params = list(FILIAIS_INVENTARIO_NERD) + [categoria.upper().strip(), inicio_excl, fim_excl] + list(FILIAIS_VENDA_NERD)
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
      AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = ?
      AND NOT EXISTS (
        SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = e.PRODUTO
          AND vp.QTDE > 0
          AND vp.DATA_VENDA >= ?
          AND vp.DATA_VENDA < ?
          AND vp.FILIAL IN ({placeholders_venda})
      )
    GROUP BY ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO')
    HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    """
    return pd.read_sql(sql, conn, params=params)


def run_estoque_giro_faixa_disjunta(conn, categoria, dias_fim, dias_inicio, excluir_ate_dias):
    """
    Estoque (para a categoria) de produtos que:
    - venderam no período [dias_fim, dias_inicio) dias atrás (ex.: 30-60 = entre 30 e 60 dias atrás)
    - e NÃO venderam em [0, excluir_ate_dias] (ex. para 60d, excluir_ate_dias=30).

    dias_fim = 60, dias_inicio = 30 → janela 30-60 dias atrás.
    excluir_ate_dias = 30 → excluir vendas nos últimos 30 dias (faixa disjunta).

    Para 30d: dias_fim=30, dias_inicio=0, excluir_ate_dias=0 (sem NOT EXISTS).
    Janela 30d = [hoje-30, amanhã) = últimos 30 dias (igual backend).
    """
    hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    inicio_periodo = hoje - timedelta(days=dias_fim)  # início do dia "dias_fim atrás"
    if dias_inicio == 0:
        fim_periodo = hoje + timedelta(days=1)  # amanhã 00:00 (exclusivo) = últimos 30d
    else:
        # Backend: 60d usa < hoje-(diasInicio-1) = < hoje-29 → janela [hoje-60, hoje-29)
        fim_periodo = hoje - timedelta(days=dias_inicio - 1)
    # Exclusão: [hoje - excluir_ate_dias, amanhã) = vendas nos "excluir_ate_dias" mais recentes
    inicio_excl = hoje - timedelta(days=excluir_ate_dias)
    fim_excl = hoje + timedelta(days=1)

    placeholders_est = ",".join(["?"] * len(FILIAIS_INVENTARIO_NERD))
    placeholders_venda = ",".join(["?"] * len(FILIAIS_VENDA_NERD))
    params = list(FILIAIS_INVENTARIO_NERD) + [inicio_periodo, fim_periodo] + list(FILIAIS_VENDA_NERD)
    if excluir_ate_dias > 0:
        params += [inicio_excl, fim_excl] + list(FILIAIS_VENDA_NERD)

    not_exists_sql = ""
    if excluir_ate_dias > 0:
        not_exists_sql = f"""
      AND NOT EXISTS (
        SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp2 WITH (NOLOCK)
        WHERE vp2.PRODUTO = e.PRODUTO
          AND vp2.QTDE > 0
          AND vp2.DATA_VENDA >= ?
          AND vp2.DATA_VENDA < ?
          AND vp2.FILIAL IN ({placeholders_venda})
      )
        """
        # placeholders_venda já está no params; precisamos de outro set para o NOT EXISTS
        # Na verdade já colocamos inicio_excl, fim_excl e filiais no params acima.

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
      AND UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO, '')))) = ?
      AND EXISTS (
        SELECT 1 FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = e.PRODUTO
          AND vp.DATA_VENDA >= ?
          AND vp.DATA_VENDA < ?
          AND vp.QTDE > 0
          AND vp.FILIAL IN ({placeholders_venda})
      )
      {not_exists_sql}
    GROUP BY ISNULL(p.GRUPO_PRODUTO, 'SEM GRUPO')
    HAVING SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) > 0
    """
    # Params: filiais_est, categoria, inicio_periodo, fim_periodo, filiais_venda [, inicio_excl, fim_excl, filiais_venda]
    params = list(FILIAIS_INVENTARIO_NERD) + [categoria.upper().strip(), inicio_periodo, fim_periodo] + list(FILIAIS_VENDA_NERD)
    if excluir_ate_dias > 0:
        params += [inicio_excl, fim_excl] + list(FILIAIS_VENDA_NERD)
    return pd.read_sql(sql, conn, params=params)


def main():
    parser = argparse.ArgumentParser(description="Analisa estoque NERD por faixas de giro (disjuntas)")
    parser.add_argument("--categoria", type=str, default=None, help="Ex: PELICULAS, CAPAS. Se omitido, usa a primeira categoria com estoque.")
    args = parser.parse_args()

    if sys.platform == "win32":
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    hoje = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    print("=" * 72)
    print("ANÁLISE ESTOQUE NERD — Faixas de giro DISJUNTAS (30, 60, 90, 120, 150, 300 dias)")
    print("=" * 72)
    print(f"Data de hoje (referência): {hoje.strftime('%d/%m/%Y')}")
    print()

    conn = conectar()
    try:
        # 1) Estoque total (todas categorias ou só a escolhida)
        df_total = run_estoque_total(conn, categoria=args.categoria)
        if df_total.empty:
            print("Nenhuma categoria com estoque encontrada.")
            return

        if args.categoria:
            cat_teste = args.categoria.upper().strip()
            df_cat = df_total[df_total["categoria"].str.upper().str.strip() == cat_teste]
            if df_cat.empty:
                print(f"Categoria '{args.categoria}' não encontrada ou sem estoque. Categorias disponíveis:")
                print(df_total[["categoria", "estoque", "custo"]].to_string(index=False))
                return
        else:
            cat_teste = df_total.iloc[0]["categoria"].strip().upper()
            df_cat = df_total[df_total["categoria"].str.upper().str.strip() == cat_teste]
            print(f"Categoria usada para teste (primeira com estoque): {df_cat.iloc[0]['categoria']}")

        estoque_total_cat = int(df_cat["estoque"].sum())
        custo_total_cat = float(df_cat["custo"].sum())

        print(f"\n--- CATEGORIA: {cat_teste} ---")
        print(f"Estoque total (sem filtro de giro): {estoque_total_cat:,} un  |  Custo: R$ {custo_total_cat:,.2f}")
        print()

        # 2) Estoque por faixa disjunta + Obsoleto
        resultados = []
        for i, dias in enumerate(GIRO_BUCKETS):
            dias_inicio = GIRO_BUCKETS[i - 1] if i > 0 else 0
            dias_fim = dias
            excluir_ate = dias_inicio  # 30→0, 60→30, 90→60, ...
            df_faixa = run_estoque_giro_faixa_disjunta(conn, cat_teste, dias_fim, dias_inicio, excluir_ate)
            if df_faixa.empty:
                un = 0
                custo = 0.0
            else:
                un = int(df_faixa["estoque"].sum())
                custo = float(df_faixa["custo"].sum())
            janela = f"0-{dias}d" if i == 0 else f"{dias_inicio}-{dias_fim}d"
            resultados.append({"faixa_dias": dias, "janela": janela, "estoque": un, "custo": custo})

        # Faixa Obsoleto: sem venda nos últimos 300 dias
        df_obsoleto = run_estoque_obsoleto(conn, cat_teste)
        if df_obsoleto.empty:
            un_ob = 0
            custo_ob = 0.0
        else:
            un_ob = int(df_obsoleto["estoque"].sum())
            custo_ob = float(df_obsoleto["custo"].sum())
        resultados.append({"faixa_dias": "Obsoleto", "janela": f"sem venda em {GIRO_OBSOLETO_DIAS}d", "estoque": un_ob, "custo": custo_ob})

        df_faixas = pd.DataFrame(resultados)

        # 3) Tabela e verificação
        print("--- ESTOQUE POR FAIXA (disjunta) ---")
        print(df_faixas.to_string(index=False))
        print()

        soma_estoque_faixas = df_faixas["estoque"].sum()
        soma_custo_faixas = df_faixas["custo"].sum()
        print("--- VERIFICAÇÃO ---")
        print(f"Soma das faixas (30d + 60d + ... + 300d + Obsoleto): {int(soma_estoque_faixas):,} un")
        print(f"Soma das faixas (custo):   R$ {soma_custo_faixas:,.2f}")
        print(f"Estoque total da categoria: {estoque_total_cat:,} un")
        print()

        ok = abs(soma_estoque_faixas - estoque_total_cat) <= 1  # tolerância de arredondamento
        if ok:
            print("OK: Soma das faixas (incl. Obsoleto) = estoque total da categoria.")
        else:
            print("ATENÇÃO: Soma das faixas != estoque total. Verifique consistência.")
        diff = estoque_total_cat - int(soma_estoque_faixas)
        if diff != 0:
            print(f"Diferença (total - soma faixas): {diff:,} un")
        print()
        print("Compare os números da faixa 30d com o dashboard (Controle de Estoque, giro 30 dias) para esta categoria.")
        print("Compare 60d, 90d, 120d etc. com os cards respectivos no dashboard.")
    finally:
        conn.close()

    print("\nConcluído.")


if __name__ == "__main__":
    main()

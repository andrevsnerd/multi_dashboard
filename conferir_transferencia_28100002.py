#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para conferir o item 28.10.0002 no Controle de Transferências.

Objetivo: descobrir por que o sistema recomenda transferir 1 unidade para
E-COMMERCE enquanto o modal mostra que E-COMMERCE já tem 36 unidades.

Hipótese: E-COMMERCE é exibido como uma única filial no modal (soma de 3 filiais),
mas o cálculo de transferência trata cada sub-filial separadamente. Se uma
sub-filial (ex: SCARFME MATRIZ CMS) tem estoque 0 e vendeu 1, o sistema
sugere transferir para ela; no modal aparece "E-COMMERCE" com a soma (36).
"""

import os
import sys
from datetime import datetime, timedelta

try:
    import pyodbc
    import pandas as pd
except ImportError as e:
    print("Instale dependências: pip install pyodbc pandas")
    sys.exit(1)

# Config conexão (mesmo do dashboard/exportador - ScarfMe usa LINX)
DB_CONFIG = {
    'server': os.environ.get('DB_SERVER', '177.92.78.250'),
    'server_fallback': os.environ.get('DB_SERVER_FALLBACK', '189.126.197.82'),
    'database': os.environ.get('DB_DATABASE', 'LINX_PRODUCAO'),
    'username': os.environ.get('DB_USERNAME', 'andre.nerd'),
    'password': os.environ.get('DB_PASSWORD', 'nerd123@'),
}

# Filiais e-commerce ScarfMe (igual lib/config/company.ts)
ECOMMERCE_FILIAIS = [
    'SCARFME MATRIZ CMS',
    'SCARF ME - MATRIZ LLL',
    'MSC COMERCIO DE LENCOS LT',
]

PRODUTO_ALVO = '28.10.0002'


def conectar():
    """Conecta ao SQL Server."""
    for nome, server in [('principal', DB_CONFIG['server']), ('fallback', DB_CONFIG['server_fallback'])]:
        try:
            conn_str = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={server};"
                f"DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};"
                f"PWD={DB_CONFIG['password']};"
                "Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            return conn
        except Exception as e:
            print(f"  Erro {nome} ({server}): {e}")
    return None


def main():
    print("=" * 70)
    print("CONFERÊNCIA: Produto 28.10.0002 - Transferência para E-COMMERCE")
    print("=" * 70)

    conn = conectar()
    if not conn:
        print("[ERRO] Não foi possível conectar ao banco.")
        sys.exit(1)
    print("[OK] Conectado ao banco.\n")

    end_date = datetime.now()
    start_30d = end_date - timedelta(days=30)

    # 1) Estoque por filial (produto 28.10.0002) - mesma lógica do dashboard
    print("1. ESTOQUE POR FILIAL (ESTOQUE_PRODUTOS)")
    print("-" * 50)
    q_estoque = """
        SELECT 
            e.PRODUTO AS produto,
            e.COR_PRODUTO AS corProduto,
            e.FILIAL AS filial,
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS positiveStock,
            SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS negativeStock,
            SUM(e.ESTOQUE) AS estoque_total
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        WHERE e.PRODUTO = ?
        GROUP BY e.PRODUTO, e.COR_PRODUTO, e.FILIAL
        ORDER BY e.FILIAL
    """
    df_estoque = pd.read_sql(q_estoque, conn, params=[PRODUTO_ALVO])
    if df_estoque.empty:
        print("   Nenhum registro de estoque encontrado para este produto.\n")
    else:
        for _, row in df_estoque.iterrows():
            total = (row['positiveStock'] or 0) + (row['negativeStock'] or 0)
            is_ec = " [E-COMMERCE]" if row['filial'].strip().upper() in [f.strip().upper() for f in ECOMMERCE_FILIAIS] else ""
            print(f"   {row['filial']}{is_ec}: positivo={row['positiveStock']}, negativo={row['negativeStock']}, total={total}")

        # Total agregado E-COMMERCE (como no modal)
        ec_filiais_upper = [f.strip().upper() for f in ECOMMERCE_FILIAIS]
        df_ec = df_estoque[df_estoque['filial'].str.strip().str.upper().isin(ec_filiais_upper)]
        total_ec = (df_ec['positiveStock'].fillna(0) + df_ec['negativeStock'].fillna(0)).sum()
        print(f"\n   >>> TOTAL E-COMMERCE (agregado, como no modal): {int(total_ec)} unidades")
    print()

    # 2) Vendas últimos 30 dias - loja (W_CTB_LOJA_VENDA_PEDIDO_PRODUTO)
    print("2. VENDAS ÚLTIMOS 30 DIAS - LOJA (W_CTB_LOJA_VENDA_PEDIDO_PRODUTO)")
    print("-" * 50)
    q_vendas_loja = """
        SELECT 
            vp.FILIAL AS filial,
            SUM(CASE WHEN vp.QTDE_CANCELADA > 0 THEN 0 ELSE vp.QTDE END) AS vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        WHERE vp.PRODUTO = ?
          AND vp.DATA_VENDA >= ?
          AND vp.DATA_VENDA < ?
          AND vp.QTDE > 0
        GROUP BY vp.FILIAL
        ORDER BY vp.FILIAL
    """
    df_vendas_loja = pd.read_sql(q_vendas_loja, conn, params=[PRODUTO_ALVO, start_30d, end_date])
    if df_vendas_loja.empty:
        print("   Nenhuma venda de loja no período.")
    else:
        for _, row in df_vendas_loja.iterrows():
            print(f"   {row['filial']}: {int(row['vendas'])} un")
    print()

    # 3) Vendas últimos 30 dias - e-commerce (FATURAMENTO + W_FATURAMENTO_PROD_02)
    print("3. VENDAS ÚLTIMOS 30 DIAS - E-COMMERCE (FATURAMENTO)")
    print("-" * 50)
    placeholders = ", ".join(["?"] * len(ECOMMERCE_FILIAIS))
    q_vendas_ec = f"""
        SELECT 
            f.FILIAL AS filial,
            SUM(CAST(fp.QTDE AS FLOAT)) AS vendas
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
          ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE fp.PRODUTO = ?
          AND CAST(f.EMISSAO AS DATE) >= ?
          AND CAST(f.EMISSAO AS DATE) < ?
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND CAST(fp.QTDE AS FLOAT) > 0
          AND f.FILIAL IN ({placeholders})
        GROUP BY f.FILIAL
        ORDER BY f.FILIAL
    """
    params_ec = [PRODUTO_ALVO, start_30d.date(), end_date.date()] + ECOMMERCE_FILIAIS
    df_vendas_ec = pd.read_sql(q_vendas_ec, conn, params=params_ec)
    if df_vendas_ec.empty:
        print("   Nenhuma venda e-commerce no período.")
    else:
        for _, row in df_vendas_ec.iterrows():
            print(f"   {row['filial']}: {int(row['vendas'])} un")
    print()

    # 4) O que o cálculo de transferência "vê" por filial (por nome canônico)
    print("4. O QUE O CÁLCULO DE TRANSFERÊNCIA ENXERGA (por filial)")
    print("-" * 50)
    # Estoque por filial (já temos)
    estoque_por_filial = {}
    for _, row in df_estoque.iterrows():
        f = row['filial'].strip()
        total = (row['positiveStock'] or 0) + (row['negativeStock'] or 0)
        estoque_por_filial[f] = total

    # Vendas 30d: loja + e-commerce por filial
    vendas_por_filial = {}
    for _, row in df_vendas_loja.iterrows():
        f = row['filial'].strip()
        vendas_por_filial[f] = vendas_por_filial.get(f, 0) + int(row['vendas'])
    for _, row in df_vendas_ec.iterrows():
        f = row['filial'].strip()
        vendas_por_filial[f] = vendas_por_filial.get(f, 0) + int(row['vendas'])

    todas_filiais = sorted(set(estoque_por_filial.keys()) | set(vendas_por_filial.keys()))
    for f in todas_filiais:
        est = estoque_por_filial.get(f, 0)
        vnd = vendas_por_filial.get(f, 0)
        ec = " [E-COMMERCE]" if f.upper() in [x.strip().upper() for x in ECOMMERCE_FILIAIS] else ""
        precisa = " PRECISA (est < 1 e vnd > 0)" if (est < 1 and vnd > 0) else ""
        print(f"   {f}{ec}: Est={est}, Vnd={vnd}{precisa}")

    # 5) Diagnóstico
    print()
    print("5. DIAGNÓSTICO")
    print("-" * 50)
    total_ec_stock = 0
    for f in ECOMMERCE_FILIAIS:
        for k, v in estoque_por_filial.items():
            if k.strip().upper() == f.strip().upper():
                total_ec_stock += v
                break
    print(f"   Estoque total E-COMMERCE (soma das 3 filiais): {int(total_ec_stock)}")
    print()
    filiais_ec_com_zero = [
        f for f in ECOMMERCE_FILIAIS
        if estoque_por_filial.get(f, 0) < 1 and vendas_por_filial.get(f, 0) > 0
    ]
    if filiais_ec_com_zero:
        print("   CAUSA DO BUG:")
        print("   O cálculo trata cada filial de e-commerce SEPARADAMENTE.")
        print(f"   A(s) filial(is) {filiais_ec_com_zero} tem(êm) vendas e estoque < 1,")
        print("   então o sistema sugere transferir para ela(s).")
        print("   No modal, porém, 'E-COMMERCE' é a SOMA das 3 filiais (estoque total).")
        print("   Por isso aparece 'transferir para E-COMMERCE' e ao mesmo tempo 'E-COMMERCE: 36'.")
        print()
        print("   CORREÇÃO RECOMENDADA:")
        print("   Ao decidir se E-COMMERCE precisa de transferência, usar o ESTOQUE AGREGADO")
        print("   das 3 filiais. Se estoque agregado >= 1, NÃO sugerir transferência para")
        print("   nenhuma filial de e-commerce.")
    else:
        print("   Nenhuma sub-filial e-commerce com estoque < 1 e vendas > 0.")
        print("   Se o problema ainda ocorre, pode ser cache ou outro produto/cor.")

    conn.close()
    print()
    print("=" * 70)


if __name__ == "__main__":
    main()

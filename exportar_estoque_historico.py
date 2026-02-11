#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Exportador de Estoque Histórico - ScarfMe
Gera um XLSX com o estoque calculado para uma data passada, com base em:
- Estoque atual
- Entradas e saídas (regras do log de transferência: ESTOQUE_PROD_ENT/SAI + LOJA_ENTRADAS/SAIDAS)
- Vendas varejo (LOJA_VENDA_PRODUTO com trocas)
- Vendas e-commerce (FATURAMENTO com NATUREZA_SAIDA 100.02/100.022)

Filiais unidas: MSC COMERCIO DE LENCOS LT, SCARFME MATRIZ CMS, SCARF ME - MATRIZ LLL
contam como uma única "conta" (E-COMMERCE) para movimentações e estoque na data.

Uso:
  python exportar_estoque_historico.py
  python exportar_estoque_historico.py --data 2025-01-15
"""

import os
import sys
import argparse
import time
import warnings
from datetime import datetime, timedelta

import pandas as pd
import numpy as np
import pyodbc

# pd.read_sql com conexão pyodbc emite aviso sugerindo SQLAlchemy
warnings.filterwarnings('ignore', message='.*DBAPI2.*')

# Config conexão (igual exportar_todos_relatorios.py)
DB_CONFIG = {
    'server': os.environ.get('DB_SERVER', '177.92.78.250'),
    'server_fallback': os.environ.get('DB_SERVER_FALLBACK', '189.126.197.82'),
    'database': os.environ.get('DB_DATABASE', 'LINX_PRODUCAO'),
    'username': os.environ.get('DB_USERNAME', 'andre.nerd'),
    'password': os.environ.get('DB_PASSWORD', 'nerd123@'),
}

# Filiais e-commerce ScarfMe = contabilizadas como uma só (E-COMMERCE) - igual lib/config/company.ts
FILIAIS_ECOMMERCE_UNIDAS = [
    'SCARFME MATRIZ CMS',
    'SCARF ME - MATRIZ LLL',
    'MSC COMERCIO DE LENCOS LT',
]
FILIAL_NORM_ECOMMERCE = 'E-COMMERCE'


def normalizar_filial(filial: str) -> str:
    """Se for uma das filiais e-commerce unidas, retorna E-COMMERCE; senão retorna a própria filial."""
    if not filial or not isinstance(filial, str):
        return filial or ''
    f = filial.strip().upper()
    for nome in FILIAIS_ECOMMERCE_UNIDAS:
        if nome.strip().upper() == f:
            return FILIAL_NORM_ECOMMERCE
    return filial.strip()


def normalizar_colunas(df: pd.DataFrame) -> pd.DataFrame:
    """Remove espaços dos nomes das colunas (SQL Server costuma retornar com padding)."""
    df = df.copy()
    df.columns = [str(c).strip() if isinstance(c, str) else c for c in df.columns]
    return df


def normalizar_chaves_merge(df: pd.DataFrame, chaves: list) -> pd.DataFrame:
    """Garante que chaves de merge sejam string e sem espaços para match correto."""
    df = df.copy()
    for col in chaves:
        if col in df.columns:
            df[col] = df[col].astype(str).str.strip()
    return df


def conectar_banco():
    """Conecta ao SQL Server com fallback."""
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback']),
    ]
    for nome, servidor in servidores:
        try:
            conn_str = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={servidor};DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"Conectado: {servidor}\n")
            return conn
        except Exception as e:
            print(f"Falha {nome} ({servidor}): {e}")
    sys.exit(1)


def carregar_estoque_atual(conn, data_limite: datetime) -> pd.DataFrame:
    """Estoque atual (ESTOQUE_PRODUTOS). Será ajustado pelos movimentos após data_limite."""
    q = """
        SELECT
            LTRIM(RTRIM(ep.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(ep.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(ep.FILIAL)) AS FILIAL,
            SUM(ISNULL(ep.ESTOQUE, 0)) AS ESTOQUE
        FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
        GROUP BY ep.PRODUTO, ep.COR_PRODUTO, ep.FILIAL
    """
    df = pd.read_sql(q, conn)
    df = normalizar_colunas(df)
    df = normalizar_chaves_merge(df, ['PRODUTO', 'COR_PRODUTO'])
    df['FILIAL'] = df['FILIAL'].astype(str).str.strip()
    df['FILIAL_NORM'] = df['FILIAL'].apply(normalizar_filial)
    return df


def carregar_entradas_apos_data(conn, data_limite: datetime) -> pd.DataFrame:
    """
    Entradas (itens) com EMISSAO > data_limite.
    Regras do log: ESTOQUE_PROD_ENT + LOJA_ENTRADAS (onde não existe em ESTOQUE_PROD_ENT).
    Itens: ESTOQUE_PROD1_ENT e LOJA_ENTRADAS_PRODUTO (QTDE_ENTRADA).
    """
    # 1) Itens de ESTOQUE_PROD_ENT com EMISSAO > data_limite
    q_ep = """
        SELECT
            LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(p.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(e.FILIAL)) AS FILIAL,
            ISNULL(SUM(p.QTDE), 0) AS QTDE
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
            ON p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO AND p.FILIAL = e.FILIAL
        WHERE e.EMISSAO > ?
        GROUP BY p.PRODUTO, p.COR_PRODUTO, e.FILIAL
    """
    df_ep = pd.read_sql(q_ep, conn, params=[data_limite])
    df_ep = normalizar_colunas(df_ep)

    # 2) Itens de LOJA_ENTRADAS (sem correspondência em ESTOQUE_PROD_ENT) com EMISSAO > data_limite
    q_le = """
        SELECT
            LTRIM(RTRIM(lep.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(lep.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(le.FILIAL)) AS FILIAL,
            ISNULL(SUM(lep.QTDE_ENTRADA), 0) AS QTDE
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        INNER JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            ON lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL
        WHERE NOT EXISTS (
            SELECT 1 FROM ESTOQUE_PROD_ENT ee WITH (NOLOCK)
            WHERE ee.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND LTRIM(RTRIM(ISNULL(ee.FILIAL,''))) = LTRIM(RTRIM(ISNULL(le.FILIAL,'')))
        )
        AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
        AND le.EMISSAO > ?
        GROUP BY lep.PRODUTO, lep.COR_PRODUTO, le.FILIAL
    """
    df_le = pd.read_sql(q_le, conn, params=[data_limite])
    df_le = normalizar_colunas(df_le)

    # Unir e somar por (PRODUTO, COR_PRODUTO, FILIAL)
    df_ep = df_ep.rename(columns={'QTDE': 'QTDE_ENT'})
    df_le = df_le.rename(columns={'QTDE': 'QTDE_ENT'})
    df = pd.concat([
        df_ep[['PRODUTO', 'COR_PRODUTO', 'FILIAL', 'QTDE_ENT']],
        df_le[['PRODUTO', 'COR_PRODUTO', 'FILIAL', 'QTDE_ENT']],
    ], ignore_index=True)
    df = df.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL'], as_index=False)['QTDE_ENT'].sum()
    df = normalizar_chaves_merge(df, ['PRODUTO', 'COR_PRODUTO'])
    df['FILIAL'] = df['FILIAL'].astype(str).str.strip()
    df['FILIAL_NORM'] = df['FILIAL'].apply(normalizar_filial)
    return df


def carregar_saidas_apos_data(conn, data_limite: datetime) -> pd.DataFrame:
    """
    Saídas (itens) com EMISSAO > data_limite.
    Regras do log: ESTOQUE_PROD_SAI + LOJA_SAIDAS (onde não existe em ESTOQUE_PROD_SAI).
    Itens: ESTOQUE_PROD1_SAI (QTDE) e LOJA_SAIDAS_PRODUTO (QTDE_SAIDA).
    """
    q_es = """
        SELECT
            LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(p.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(es.FILIAL)) AS FILIAL,
            ISNULL(SUM(p.QTDE), 0) AS QTDE
        FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
            ON p.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND p.FILIAL = es.FILIAL
        WHERE es.EMISSAO > ?
        GROUP BY p.PRODUTO, p.COR_PRODUTO, es.FILIAL
    """
    df_es = pd.read_sql(q_es, conn, params=[data_limite])
    df_es = normalizar_colunas(df_es)

    q_ls = """
        SELECT
            LTRIM(RTRIM(sp.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(sp.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(s.FILIAL)) AS FILIAL,
            ISNULL(SUM(sp.QTDE_SAIDA), 0) AS QTDE
        FROM LOJA_SAIDAS s WITH (NOLOCK)
        INNER JOIN LOJA_SAIDAS_PRODUTO sp WITH (NOLOCK)
            ON sp.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO AND sp.FILIAL = s.FILIAL
        WHERE NOT EXISTS (
            SELECT 1 FROM ESTOQUE_PROD_SAI es2 WITH (NOLOCK)
            WHERE es2.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO
              AND LTRIM(RTRIM(ISNULL(es2.FILIAL,''))) = LTRIM(RTRIM(ISNULL(s.FILIAL,'')))
        )
        AND (s.SAIDA_CANCELADA = 0 OR s.SAIDA_CANCELADA IS NULL)
        AND s.EMISSAO > ?
        GROUP BY sp.PRODUTO, sp.COR_PRODUTO, s.FILIAL
    """
    df_ls = pd.read_sql(q_ls, conn, params=[data_limite])
    df_ls = normalizar_colunas(df_ls)

    df_es = df_es.rename(columns={'QTDE': 'QTDE_SAI'})
    df_ls = df_ls.rename(columns={'QTDE': 'QTDE_SAI'})
    df = pd.concat([
        df_es[['PRODUTO', 'COR_PRODUTO', 'FILIAL', 'QTDE_SAI']],
        df_ls[['PRODUTO', 'COR_PRODUTO', 'FILIAL', 'QTDE_SAI']],
    ], ignore_index=True)
    df = df.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL'], as_index=False)['QTDE_SAI'].sum()
    df = normalizar_chaves_merge(df, ['PRODUTO', 'COR_PRODUTO'])
    df['FILIAL'] = df['FILIAL'].astype(str).str.strip()
    df['FILIAL_NORM'] = df['FILIAL'].apply(normalizar_filial)
    return df


def carregar_vendas_varejo_apos_data(conn, data_limite: datetime) -> pd.DataFrame:
    """
    Vendas varejo (LOJA_VENDA_PRODUTO) com DATA_VENDA > data_limite.
    Quantidade líquida = QTDE - QTDE_TROCA (trocas por item).
    """
    q = """
        WITH TrocasItem AS (
            SELECT
                vt.CODIGO_FILIAL,
                vt.PRODUTO,
                vt.COR_PRODUTO,
                vt.TAMANHO,
                SUM(vt.QTDE) AS QTDE_TROCA
            FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
            WHERE vt.QTDE_CANCELADA = 0
            GROUP BY vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
        )
        SELECT
            LTRIM(RTRIM(vp.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(vp.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(f.FILIAL)) AS FILIAL,
            SUM(vp.QTDE - ISNULL(t.QTDE_TROCA, 0)) AS QTDE
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN TrocasItem t ON t.CODIGO_FILIAL = vp.CODIGO_FILIAL
            AND t.PRODUTO = vp.PRODUTO
            AND ISNULL(t.COR_PRODUTO, '') = ISNULL(vp.COR_PRODUTO, '')
            AND ISNULL(t.TAMANHO, 0) = ISNULL(vp.TAMANHO, 0)
        WHERE vp.DATA_VENDA > ?
        GROUP BY vp.PRODUTO, vp.COR_PRODUTO, f.FILIAL
    """
    df = pd.read_sql(q, conn, params=[data_limite])
    df = normalizar_colunas(df)
    df = df[df['FILIAL'].notna()]
    df = normalizar_chaves_merge(df, ['PRODUTO', 'COR_PRODUTO'])
    df['FILIAL'] = df['FILIAL'].astype(str).str.strip()
    df['FILIAL_NORM'] = df['FILIAL'].apply(normalizar_filial)
    return df


def carregar_vendas_ecommerce_apos_data(conn, data_limite: datetime) -> pd.DataFrame:
    """
    Vendas e-commerce: FATURAMENTO + W_FATURAMENTO_PROD_02 com EMISSAO > data_limite
    e NATUREZA_SAIDA IN ('100.02', '100.022'), NOTA_CANCELADA = 0.
    """
    q = """
        SELECT
            LTRIM(RTRIM(fp.PRODUTO)) AS PRODUTO,
            LTRIM(RTRIM(ISNULL(fp.COR_PRODUTO, ''))) AS COR_PRODUTO,
            LTRIM(RTRIM(f.FILIAL)) AS FILIAL,
            ISNULL(SUM(fp.QTDE), 0) AS QTDE
        FROM FATURAMENTO f WITH (NOLOCK)
        INNER JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO > ?
        AND f.NOTA_CANCELADA = 0
        AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        GROUP BY fp.PRODUTO, fp.COR_PRODUTO, f.FILIAL
    """
    df = pd.read_sql(q, conn, params=[data_limite])
    df = normalizar_colunas(df)
    df['FILIAL_NORM'] = df['FILIAL'].astype(str).str.strip().apply(normalizar_filial)
    return df


def enriquecer_com_codigo_barra(df_base: pd.DataFrame, df_codigos_barra: pd.DataFrame) -> pd.DataFrame:
    """Adiciona CODIGO_BARRA ao DataFrame base (match PRODUTO+COR_PRODUTO)."""
    if df_base.empty or 'PRODUTO' not in df_base.columns:
        return df_base
    codigos = df_codigos_barra[['PRODUTO', 'COR_PRODUTO', 'CODIGO_BARRA']].drop_duplicates(
        subset=['PRODUTO', 'COR_PRODUTO']
    )
    return df_base.merge(codigos, on=['PRODUTO', 'COR_PRODUTO'], how='left')


def main():
    parser = argparse.ArgumentParser(description='Exportar estoque histórico para uma data')
    parser.add_argument(
        '--data',
        type=str,
        default=None,
        help='Data do dia (YYYY-MM-DD). Se omitido, pede interativamente.',
    )
    args = parser.parse_args()

    if args.data:
        try:
            data_selecionada = datetime.strptime(args.data.strip(), '%Y-%m-%d').date()
        except ValueError:
            print(f"Data inválida: {args.data}. Use YYYY-MM-DD.")
            sys.exit(1)
    else:
        hoje = datetime.now().date()
        default = (hoje - timedelta(days=1)).strftime('%Y-%m-%d')
        inp = input(f"Data do dia (YYYY-MM-DD) [default: {default}]: ").strip() or default
        try:
            data_selecionada = datetime.strptime(inp, '%Y-%m-%d').date()
        except ValueError:
            print(f"Data inválida: {inp}")
            sys.exit(1)

    # Fim do dia selecionado para filtrar "após data"
    data_limite = datetime.combine(data_selecionada, datetime.max.time())

    print("=" * 60)
    print("EXPORTADOR DE ESTOQUE HISTÓRICO")
    print("=" * 60)
    print(f"Data do dia: {data_selecionada}")
    print(f"Calculando estoque ao fim do dia (movimentos após essa data serão revertidos).\n")

    conn = conectar_banco()
    t_total = time.time()

    # 1) Estoque atual
    print("[1/7] Carregando estoque atual...")
    df_estoque = carregar_estoque_atual(conn, data_limite)
    print(f"      {len(df_estoque):,} linhas (PRODUTO x COR x FILIAL)")

    # 2) Entradas após a data
    print("[2/7] Carregando entradas após a data (ESTOQUE_PROD_ENT + LOJA_ENTRADAS)...")
    df_entradas = carregar_entradas_apos_data(conn, data_limite)
    print(f"      {len(df_entradas):,} linhas; total itens: {df_entradas['QTDE_ENT'].sum():,.0f}")

    # 3) Saídas após a data
    print("[3/7] Carregando saídas após a data (ESTOQUE_PROD_SAI + LOJA_SAIDAS)...")
    df_saidas = carregar_saidas_apos_data(conn, data_limite)
    print(f"      {len(df_saidas):,} linhas; total itens: {df_saidas['QTDE_SAI'].sum():,.0f}")

    # 4) Vendas varejo após a data
    print("[4/7] Carregando vendas varejo após a data (LOJA_VENDA_PRODUTO - trocas)...")
    df_vendas_var = carregar_vendas_varejo_apos_data(conn, data_limite)
    print(f"      {len(df_vendas_var):,} linhas; total itens: {df_vendas_var['QTDE'].sum():,.0f}")

    # 5) Vendas e-commerce após a data
    print("[5/7] Carregando vendas e-commerce após a data (FATURAMENTO 100.02/100.022)...")
    df_vendas_ec = carregar_vendas_ecommerce_apos_data(conn, data_limite)
    print(f"      {len(df_vendas_ec):,} linhas; total itens: {df_vendas_ec['QTDE'].sum():,.0f}")

    # 6) Produtos e códigos de barra (para saída igual estoque_tratados)
    print("[6/7] Carregando produtos e códigos de barra...")
    df_produtos = pd.read_sql(
        "SELECT PRODUTO, DESC_PRODUTO, CUSTO_REPOSICAO1, PRECO_REPOSICAO_1, LINHA, GRUPO_PRODUTO, SUBGRUPO_PRODUTO, GRADE, GRIFFE FROM PRODUTOS",
        conn,
    )
    df_produtos = normalizar_colunas(df_produtos)
    df_produtos = normalizar_chaves_merge(df_produtos, ['PRODUTO'])
    # Evitar linhas duplicadas no merge (PRODUTOS pode ter duplicatas por PRODUTO em alguns casos)
    df_produtos = df_produtos.drop_duplicates(subset=['PRODUTO'], keep='first')
    df_barra = pd.read_sql(
        "SELECT PRODUTO, COR_PRODUTO, TAMANHO, CODIGO_BARRA FROM PRODUTOS_BARRA",
        conn,
    )
    df_barra = normalizar_colunas(df_barra)
    df_barra = normalizar_chaves_merge(df_barra, ['PRODUTO', 'COR_PRODUTO'])
    # Código de barra: prioridade PRODUTO+COR (para estoque não temos tamanho por linha)
    df_barra = df_barra.drop_duplicates(subset=['PRODUTO', 'COR_PRODUTO'], keep='first')

    # Agregar estoque atual por (PRODUTO, COR_PRODUTO, FILIAL_NORM) para ter uma chave única com filiais unidas
    estoque_por_norm = df_estoque.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], as_index=False)['ESTOQUE'].sum()

    # Agregar entradas por FILIAL_NORM
    ent_por_norm = df_entradas.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], as_index=False)['QTDE_ENT'].sum()
    sai_por_norm = df_saidas.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], as_index=False)['QTDE_SAI'].sum()
    var_por_norm = df_vendas_var.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], as_index=False)['QTDE'].sum()
    var_por_norm = var_por_norm.rename(columns={'QTDE': 'QTDE_VAR'})
    ec_por_norm = df_vendas_ec.groupby(['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], as_index=False)['QTDE'].sum()
    ec_por_norm = ec_por_norm.rename(columns={'QTDE': 'QTDE_EC'})

    # Estoque na data = estoque_hoje - entradas_apos + saidas_apos + vendas_apos
    df_calc = estoque_por_norm.copy()
    df_calc = df_calc.merge(ent_por_norm, on=['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], how='left')
    df_calc = df_calc.merge(sai_por_norm, on=['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], how='left')
    df_calc = df_calc.merge(var_por_norm, on=['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], how='left')
    df_calc = df_calc.merge(ec_por_norm, on=['PRODUTO', 'COR_PRODUTO', 'FILIAL_NORM'], how='left')
    for col in ('QTDE_ENT', 'QTDE_SAI', 'QTDE_VAR', 'QTDE_EC'):
        df_calc[col] = pd.to_numeric(df_calc[col], errors='coerce').fillna(0).astype(np.int64)
    df_calc['ESTOQUE_ATUAL'] = df_calc['ESTOQUE'].copy()
    df_calc['ESTOQUE_NA_DATA'] = (
        df_calc['ESTOQUE']
        - df_calc['QTDE_ENT']
        + df_calc['QTDE_SAI']
        + df_calc['QTDE_VAR']
        + df_calc['QTDE_EC']
    )
    df_calc['ESTOQUE_NA_DATA'] = df_calc['ESTOQUE_NA_DATA'].clip(lower=0).astype(int)
    # Remover coluna ESTOQUE (estoque atual) para não ter duplicata ao renomear ESTOQUE_NA_DATA -> ESTOQUE
    df_calc = df_calc.drop(columns=['ESTOQUE'])
    df_calc = df_calc.rename(columns={'FILIAL_NORM': 'FILIAL', 'ESTOQUE_NA_DATA': 'ESTOQUE'})
    df_calc = df_calc[['PRODUTO', 'COR_PRODUTO', 'FILIAL', 'ESTOQUE', 'ESTOQUE_ATUAL', 'QTDE_ENT', 'QTDE_SAI', 'QTDE_VAR', 'QTDE_EC']]

    # Merge com produtos (igual estoque_tratados) — arquivo final só com colunas de estoque
    cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'CUSTO_REPOSICAO1', 'PRECO_REPOSICAO_1', 'LINHA', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'GRADE', 'GRIFFE']
    df_out = df_calc[['PRODUTO', 'COR_PRODUTO', 'FILIAL', 'ESTOQUE']].merge(df_produtos[cols_prod], on='PRODUTO', how='left')
    df_out = enriquecer_com_codigo_barra(df_out, df_barra)
    # Índice único para evitar "cannot reindex on an axis with duplicate labels" no pandas
    df_out = df_out.reset_index(drop=True)
    # Garantir colunas únicas (evita DataFrame ao acessar df_out['ESTOQUE'] se houver duplicatas)
    if df_out.columns.duplicated().any():
        df_out = df_out.loc[:, ~df_out.columns.duplicated(keep='first')]
    # Colunas finais no mesmo espírito do estoque_tratados (sem ULTIMA_SAIDA/ENTRADA que são do momento atual)
    estoque_col = df_out['ESTOQUE'].squeeze() if isinstance(df_out['ESTOQUE'], pd.DataFrame) else df_out['ESTOQUE']
    custo_col = df_out['CUSTO_REPOSICAO1'].squeeze() if isinstance(df_out['CUSTO_REPOSICAO1'], pd.DataFrame) else df_out['CUSTO_REPOSICAO1']
    estoque_num = pd.to_numeric(estoque_col, errors='coerce').fillna(0)
    custo_num = pd.to_numeric(custo_col, errors='coerce').fillna(0)
    df_out['VALOR_TOTAL_ESTOQUE'] = (estoque_num.to_numpy() * custo_num.to_numpy()).round(2)
    # Mesma estrutura do estoque_tratados: colunas de data vazias no histórico
    df_out['ULTIMA_SAIDA'] = pd.NaT
    df_out['ULTIMA_ENTRADA'] = pd.NaT
    df_out['DATA_PARA_TRANSFERENCIA'] = pd.NaT
    df_out['DATA_AJUSTE'] = pd.NaT
    if 'ID' not in df_out.columns:
        df_out['ID'] = range(1, len(df_out) + 1)
    cols_final = [
        'PRODUTO', 'COR_PRODUTO', 'FILIAL', 'ULTIMA_SAIDA', 'ULTIMA_ENTRADA', 'ESTOQUE',
        'DATA_PARA_TRANSFERENCIA', 'DATA_AJUSTE', 'ID', 'DESC_PRODUTO', 'CUSTO_REPOSICAO1', 'PRECO_REPOSICAO_1',
        'LINHA', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'GRADE', 'GRIFFE', 'VALOR_TOTAL_ESTOQUE', 'CODIGO_BARRA',
    ]
    df_out = df_out[[c for c in cols_final if c in df_out.columns]]

    # Garantir tipos para Excel (evitar colunas vazias por object/dtype)
    if 'ESTOQUE' in df_out.columns:
        df_out['ESTOQUE'] = pd.to_numeric(df_out['ESTOQUE'], errors='coerce').fillna(0).astype(int)
    if 'VALOR_TOTAL_ESTOQUE' in df_out.columns:
        df_out['VALOR_TOTAL_ESTOQUE'] = pd.to_numeric(df_out['VALOR_TOTAL_ESTOQUE'], errors='coerce').fillna(0)
    if 'CUSTO_REPOSICAO1' in df_out.columns:
        df_out['CUSTO_REPOSICAO1'] = pd.to_numeric(df_out['CUSTO_REPOSICAO1'], errors='coerce')
    if 'PRECO_REPOSICAO_1' in df_out.columns:
        df_out['PRECO_REPOSICAO_1'] = pd.to_numeric(df_out['PRECO_REPOSICAO_1'], errors='coerce')

    # Salvar XLSX
    print("[7/7] Gerando arquivos...")
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)
    data_str = data_selecionada.strftime('%Y-%m-%d')
    nome_base = f"estoque_historico_{data_str.replace('-', '')}"
    xlsx_path = os.path.join(data_dir, f"{nome_base}.xlsx")
    try:
        with pd.ExcelWriter(xlsx_path, engine='xlsxwriter', datetime_format='dd/mm/yyyy', date_format='dd/mm/yyyy') as writer:
            df_out.to_excel(writer, sheet_name='EstoqueHistorico', index=False)
            writer.sheets['EstoqueHistorico'].autofit()
        print(f"      ✓ {nome_base}.xlsx: {len(df_out):,} registros")
    except PermissionError:
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        xlsx_path = os.path.join(data_dir, f"{nome_base}_{ts}.xlsx")
        with pd.ExcelWriter(xlsx_path, engine='xlsxwriter', datetime_format='dd/mm/yyyy', date_format='dd/mm/yyyy') as writer:
            df_out.to_excel(writer, sheet_name='EstoqueHistorico', index=False)
            writer.sheets['EstoqueHistorico'].autofit()
        print(f"      ✓ {nome_base}_{ts}.xlsx: {len(df_out):,} registros (arquivo em uso)")

    csv_path = os.path.join(data_dir, f"{nome_base}.csv")
    df_out.to_csv(csv_path, index=False, encoding='utf-8-sig', sep=';', decimal=',')
    print(f"      ✓ {nome_base}.csv: {len(df_out):,} registros")

    # Log resumo: diferenças por filial (estoque atual vs na data; vendas/entradas/saídas que diferenciaram)
    # Garantir colunas únicas (evita agg sobre DataFrame quando há colunas duplicadas)
    df_resumo = df_calc.loc[:, ~df_calc.columns.duplicated(keep='first')]
    resumo = df_resumo.groupby('FILIAL').agg({
        'ESTOQUE_ATUAL': 'sum',
        'ESTOQUE': 'sum',
        'QTDE_ENT': 'sum',
        'QTDE_SAI': 'sum',
        'QTDE_VAR': 'sum',
        'QTDE_EC': 'sum',
    }).reset_index()
    resumo['DIFERENCA_ESTOQUE'] = resumo['ESTOQUE_ATUAL'] - resumo['ESTOQUE']
    resumo = resumo.rename(columns={
        'ESTOQUE_ATUAL': 'ESTOQUE_ATUAL_TOTAL',
        'ESTOQUE': 'ESTOQUE_NA_DATA_TOTAL',
        'QTDE_ENT': 'ENTRADAS_APOS_DATA',
        'QTDE_SAI': 'SAIDAS_APOS_DATA',
        'QTDE_VAR': 'VENDAS_VAREJO_APOS_DATA',
        'QTDE_EC': 'VENDAS_ECOMERCE_APOS_DATA',
    })
    # Ordem das colunas do resumo
    cols_resumo = [
        'FILIAL', 'ESTOQUE_ATUAL_TOTAL', 'ESTOQUE_NA_DATA_TOTAL', 'DIFERENCA_ESTOQUE',
        'ENTRADAS_APOS_DATA', 'SAIDAS_APOS_DATA', 'VENDAS_VAREJO_APOS_DATA', 'VENDAS_ECOMERCE_APOS_DATA',
    ]
    resumo = resumo[[c for c in cols_resumo if c in resumo.columns]]
    log_path = os.path.join(data_dir, f"log_estoque_historico_{data_str.replace('-', '')}.xlsx")
    with pd.ExcelWriter(log_path, engine='xlsxwriter', datetime_format='dd/mm/yyyy', date_format='dd/mm/yyyy') as writer:
        resumo.to_excel(writer, sheet_name='ResumoPorFilial', index=False)
        writer.sheets['ResumoPorFilial'].autofit()
    print(f"      ✓ log_estoque_historico_{data_str.replace('-', '')}.xlsx: resumo por filial (diferenças, vendas, entradas)")

    conn.close()
    print("\n" + "=" * 60)
    print(f"Concluído em {time.time() - t_total:.2f}s")
    print("=" * 60)


if __name__ == '__main__':
    main()

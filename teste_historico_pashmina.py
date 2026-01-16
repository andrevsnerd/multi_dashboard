#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Teste - Histórico de Estoque PASHMINA
Testa o novo cálculo de histórico considerando apenas entradas reais na matriz (sem devoluções)
"""

import pyodbc
import pandas as pd
from datetime import datetime, timedelta
import sys

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server com timeout e fallback"""
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome}: {servidor})...")
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};"
                       f"DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};"
                       f"PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print("OK Conectado!")
            return conn
        except Exception as e:
            print(f"ERRO conexao com {nome}: {e}")
            if nome == 'principal':
                print("[AVISO] Tentando servidor fallback...")
            continue
    
    print("ERRO conexao: Falha em todos os servidores.")
    sys.exit(1)

def teste_historico_pashmina():
    """Testa cálculo de histórico para linha PASHMINA"""
    conn = conectar_banco()
    
    print("\n" + "="*80)
    print("TESTE: HISTÓRICO DE ESTOQUE - LINHA PASHMINA")
    print("Período: Últimos 6 meses")
    print("="*80)
    
    data_hoje = datetime.now()
    data_6_meses_atras = data_hoje - timedelta(days=180)
    
    print(f"\nPeriodo de analise:")
    print(f"   De: {data_6_meses_atras.strftime('%d/%m/%Y')}")
    print(f"   Ate: {data_hoje.strftime('%d/%m/%Y')}")
    
    # ==========================================
    # 1. ESTOQUE ATUAL (TODAS AS FILIAIS)
    # ==========================================
    print("\n[1] ESTOQUE ATUAL (Todas as filiais)")
    print("-" * 80)
    
    query_estoque = """
        SELECT 
            SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque_atual
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
        WHERE UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'PASHMINA'
            AND e.ESTOQUE > 0
    """
    
    df_estoque = pd.read_sql(query_estoque, conn)
    estoque_atual = df_estoque['estoque_atual'].iloc[0] if not df_estoque.empty else 0
    print(f"   [OK] Estoque Atual Total: {estoque_atual:,.0f} unidades")
    
    # ==========================================
    # 2. ENTRADAS NA MATRIZ (Últimos 6 meses)
    # ==========================================
    print("\n[2] ENTRADAS NA MATRIZ (SCARF ME - MATRIZ)")
    print("-" * 80)
    
    query_entradas_matriz = """
        SELECT 
            E.ROMANEIO_PRODUTO,
            E.EMISSAO,
            P.PRODUTO,
            prd.DESC_PRODUTO,
            P.COR_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            CAST(P.QTDE AS FLOAT) AS QTDE_ENTRADA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = P.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = P.COR_PRODUTO
        WHERE prd.PRODUTO IS NOT NULL
            AND UPPER(LTRIM(RTRIM(ISNULL(prd.LINHA, '')))) = 'PASHMINA'
            AND E.EMISSAO >= ?
            AND E.EMISSAO <= ?
            AND E.FILIAL = 'SCARF ME - MATRIZ'
        ORDER BY E.EMISSAO DESC
    """
    
    df_entradas = pd.read_sql(query_entradas_matriz, conn, params=[data_6_meses_atras, data_hoje])
    entradas_total_matriz = df_entradas['QTDE_ENTRADA'].sum() if not df_entradas.empty else 0
    print(f"   [OK] Total de entradas na matriz (6 meses): {entradas_total_matriz:,.0f} unidades")
    print(f"   [OK] Numero de romaneios: {len(df_entradas)}")
    
    # ==========================================
    # 3. SAÍDAS DE LOJAS (Para detectar devoluções)
    # ==========================================
    print("\n[3] SAÍDAS DE LOJAS (Para detectar devoluções)")
    print("-" * 80)
    
    # Lista de lojas normais (não matriz, não ecommerce)
    lojas_normais = [
        'GUARULHOS - RSR', 'IGUATEMI SP - JJJ', 'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ', 'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL', 'SCARFME ME - PAULISTA FFF',
        'SCARF ME - PAULISTA RSR', 'VILLA LOBOS - LLL'
    ]
    placeholders_lojas = "', '".join(lojas_normais)
    
    query_saidas_lojas = f"""
        SELECT 
            S.ROMANEIO_PRODUTO,
            S.EMISSAO,
            S.FILIAL,
            PS.PRODUTO,
            prd.DESC_PRODUTO,
            PS.COR_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            CAST(PS.QTDE AS FLOAT) AS QTDE_SAIDA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_SAI AS PS WITH (NOLOCK) ON S.ROMANEIO_PRODUTO = PS.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = PS.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = PS.COR_PRODUTO
        WHERE prd.PRODUTO IS NOT NULL
            AND UPPER(LTRIM(RTRIM(ISNULL(prd.LINHA, '')))) = 'PASHMINA'
            AND S.EMISSAO >= ?
            AND S.EMISSAO <= ?
            AND S.FILIAL IN ('{placeholders_lojas}')
        ORDER BY S.EMISSAO DESC
    """
    
    df_saidas = pd.read_sql(query_saidas_lojas, conn, params=[data_6_meses_atras, data_hoje])
    saidas_total_lojas = df_saidas['QTDE_SAIDA'].sum() if not df_saidas.empty else 0
    print(f"   [OK] Total de saidas de lojas (6 meses): {saidas_total_lojas:,.0f} unidades")
    print(f"   [OK] Numero de romaneios de saida: {len(df_saidas)}")
    
    # ==========================================
    # 4. IDENTIFICAR DEVOLUÇÕES (Entrada na matriz + Saída de loja no mesmo dia)
    # ==========================================
    print("\n[4] DETECTANDO DEVOLUÇÕES (Entrada matriz + Saída loja mesmo dia)")
    print("-" * 80)
    
    if not df_entradas.empty and not df_saidas.empty:
        # Criar chave para matching: PRODUTO|COR|DATA
        df_entradas['CHAVE'] = (
            df_entradas['PRODUTO'].astype(str) + '|' +
            df_entradas['COR_PRODUTO'].fillna('').astype(str) + '|' +
            pd.to_datetime(df_entradas['EMISSAO']).dt.date.astype(str)
        )
        
        df_saidas['CHAVE'] = (
            df_saidas['PRODUTO'].astype(str) + '|' +
            df_saidas['COR_PRODUTO'].fillna('').astype(str) + '|' +
            pd.to_datetime(df_saidas['EMISSAO']).dt.date.astype(str)
        )
        
        # Identificar entradas que têm saída correspondente (devoluções)
        entradas_com_devolucao = df_entradas[df_entradas['CHAVE'].isin(df_saidas['CHAVE'])]
        devolucoes_total = entradas_com_devolucao['QTDE_ENTRADA'].sum() if not entradas_com_devolucao.empty else 0
        
        print(f"   [OK] Entradas na matriz: {len(df_entradas)} romaneios ({entradas_total_matriz:,.0f} unidades)")
        print(f"   [OK] Saidas de lojas: {len(df_saidas)} romaneios ({saidas_total_lojas:,.0f} unidades)")
        print(f"   [AVISO] DEVOLUCOES detectadas: {len(entradas_com_devolucao)} romaneios ({devolucoes_total:,.0f} unidades)")
        
        # Entradas reais (sem devoluções)
        entradas_reais = entradas_total_matriz - devolucoes_total
        print(f"   [OK] ENTRADAS REAIS (sem devolucoes): {entradas_reais:,.0f} unidades")
        
        # Mostrar alguns exemplos de devoluções
        if not entradas_com_devolucao.empty:
            print(f"\n   Exemplos de devolucoes detectadas (primeiras 5):")
            for idx, row in entradas_com_devolucao.head(5).iterrows():
                print(f"      - {row['EMISSAO'].strftime('%d/%m/%Y')} | {row['DESC_PRODUTO'][:50]} | {row['DESC_COR']} | {row['QTDE_ENTRADA']:,.0f} un")
    else:
        entradas_reais = entradas_total_matriz
        devolucoes_total = 0
        print(f"   [INFO] Nenhuma devolucao detectada")
        print(f"   [OK] ENTRADAS REAIS: {entradas_reais:,.0f} unidades")
    
    # ==========================================
    # 5. VENDAS (Últimos 6 meses)
    # ==========================================
    print("\n[5] VENDAS (Últimos 6 meses)")
    print("-" * 80)
    
    query_vendas = """
        SELECT 
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS total_vendas
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'PASHMINA'
            AND vp.DATA_VENDA >= ?
            AND vp.DATA_VENDA <= ?
            AND vp.QTDE > 0
    """
    
    df_vendas = pd.read_sql(query_vendas, conn, params=[data_6_meses_atras, data_hoje])
    vendas_total = df_vendas['total_vendas'].iloc[0] if not df_vendas.empty else 0
    print(f"   [OK] Total de vendas (6 meses): {vendas_total:,.0f} unidades")
    
    # ==========================================
    # 6. E-COMMERCE (Últimos 6 meses) - apenas SCARFME
    # ==========================================
    print("\n[6] E-COMMERCE (Últimos 6 meses)")
    print("-" * 80)
    
    query_ecommerce = """
        SELECT 
            SUM(CAST(fp.QTDE AS FLOAT)) AS total_ecommerce
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = 'PASHMINA'
            AND f.EMISSAO >= ?
            AND f.EMISSAO <= ?
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
    """
    
    df_ecommerce = pd.read_sql(query_ecommerce, conn, params=[data_6_meses_atras, data_hoje])
    ecommerce_total = df_ecommerce['total_ecommerce'].iloc[0] if not df_ecommerce.empty else 0
    print(f"   [OK] Total de e-commerce (6 meses): {ecommerce_total:,.0f} unidades")
    
    # ==========================================
    # 7. CÁLCULO DO HISTÓRICO (Estoque 6 meses atrás)
    # ==========================================
    print("\n" + "="*80)
    print("[7] CÁLCULO DO HISTÓRICO")
    print("="*80)
    
    # Fórmula: Estoque 6 meses atrás = Estoque Atual - Entradas Reais + Vendas + E-commerce
    estoque_6_meses_atras = estoque_atual - entradas_reais + vendas_total + ecommerce_total
    estoque_6_meses_atras = max(0, estoque_6_meses_atras)  # Não pode ser negativo
    
    print(f"\nRESUMO:")
    print(f"   • Estoque Atual: {estoque_atual:,.0f} unidades")
    print(f"   • Entradas na Matriz (todas): {entradas_total_matriz:,.0f} unidades")
    print(f"   • Devoluções (descartadas): {devolucoes_total:,.0f} unidades")
    print(f"   • Entradas Reais (sem devoluções): {entradas_reais:,.0f} unidades")
    print(f"   • Vendas: {vendas_total:,.0f} unidades")
    print(f"   • E-commerce: {ecommerce_total:,.0f} unidades")
    print(f"\nCALCULO:")
    print(f"   Estoque 6 meses atrás = Estoque Atual - Entradas Reais + Vendas + E-commerce")
    print(f"   Estoque 6 meses atrás = {estoque_atual:,.0f} - {entradas_reais:,.0f} + {vendas_total:,.0f} + {ecommerce_total:,.0f}")
    print(f"   Estoque 6 meses atrás = {estoque_6_meses_atras:,.0f} unidades")
    
    diferenca = estoque_atual - estoque_6_meses_atras
    print(f"\nVARIACAO:")
    print(f"   Diferença: {diferenca:+,.0f} unidades")
    if estoque_6_meses_atras > 0:
        percentual = (diferenca / estoque_6_meses_atras) * 100
        print(f"   Percentual: {percentual:+.1f}%")
    
    print("\n" + "="*80)
    print("[OK] TESTE CONCLUIDO")
    print("="*80)
    
    conn.close()

if __name__ == '__main__':
    try:
        teste_historico_pashmina()
    except Exception as e:
        print(f"\n[ERRO]: {e}")
        import traceback
        traceback.print_exc()

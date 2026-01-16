#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Log Detalhado de Entradas de Estoque
Mostra como as entradas são calculadas com exemplos reais
"""

import os
import sys
import pyodbc
import pandas as pd
from datetime import datetime, timedelta
from collections import defaultdict
from io import StringIO

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
    
    ultimo_erro = None
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
            if nome == 'fallback':
                print(f"✓ Conectado via servidor fallback ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
    sys.exit(1)

class LogWriter:
    """Classe para escrever logs tanto no console quanto em arquivo"""
    def __init__(self, arquivo_txt):
        self.arquivo = open(arquivo_txt, 'w', encoding='utf-8')
        self.buffer = StringIO()
    
    def write(self, texto='', end='\n'):
        """Escreve no console e no arquivo"""
        texto_completo = str(texto) + end
        print(texto, end=end)
        self.arquivo.write(texto_completo)
        self.buffer.write(texto_completo)
    
    def flush(self):
        """Força escrita no arquivo"""
        self.arquivo.flush()
    
    def close(self):
        """Fecha o arquivo"""
        self.arquivo.close()
    
    def get_content(self):
        """Retorna o conteúdo completo"""
        return self.buffer.getvalue()

def analisar_entradas_produto(conn, produto_nome=None, linha=None, log=None):
    """
    Analisa as entradas de estoque para um produto específico ou linha
    Mostra detalhes completos de como as entradas são calculadas
    """
    if log is None:
        log = LogWriter('log_entradas_temp.txt')
    
    log.write("\n" + "="*100)
    log.write("ANÁLISE DETALHADA DE ENTRADAS DE ESTOQUE")
    log.write("="*100)
    
    data_hoje = datetime.now()
    data_7_dias_atras = data_hoje - timedelta(days=7)
    data_14_dias_atras = data_hoje - timedelta(days=14)
    data_inicio_mes = datetime(data_hoje.year, data_hoje.month, 1)
    
    log.write(f"\n[PERÍODOS DE ANÁLISE]")
    log.write(f"  Data Hoje: {data_hoje.strftime('%d/%m/%Y %H:%M:%S')}")
    log.write(f"  Últimos 7 dias (Semana Atual): {data_7_dias_atras.strftime('%d/%m/%Y')} até {data_hoje.strftime('%d/%m/%Y')}")
    log.write(f"  Semana Passada (7-14 dias atrás): {data_14_dias_atras.strftime('%d/%m/%Y')} até {data_7_dias_atras.strftime('%d/%m/%Y')}")
    log.write(f"  Mês Atual: {data_inicio_mes.strftime('%d/%m/%Y')} até {data_hoje.strftime('%d/%m/%Y')}")
    
    # Construir filtro de produto/linha
    # Usar prd para queries de estoque/vendas/ecommerce, prd para queries de entradas
    filtro_produto = ""
    filtro_produto_entradas = ""
    if produto_nome:
        filtro_produto = f"AND prd.DESC_PRODUTO LIKE '%{produto_nome}%'"
        filtro_produto_entradas = f"AND prd.DESC_PRODUTO LIKE '%{produto_nome}%'"
    elif linha:
        filtro_produto = f"AND prd.LINHA = '{linha}'"
        filtro_produto_entradas = f"AND prd.LINHA = '{linha}'"
    
    # ==========================================
    # 1. BUSCAR ESTOQUE ATUAL
    # ==========================================
    log.write(f"\n[1] ESTOQUE ATUAL")
    log.write("-" * 100)
    
    query_estoque = f"""
        SELECT 
            e.PRODUTO,
            prd.DESC_PRODUTO,
            e.COR_PRODUTO,
            c.DESC_COR,
            e.FILIAL,
            f.FILIAL AS NOME_FILIAL,
            e.ESTOQUE AS ESTOQUE_ATUAL,
            prd.LINHA,
            prd.GRUPO_PRODUTO
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = e.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = e.FILIAL
        WHERE e.ESTOQUE > 0
            {filtro_produto}
        ORDER BY prd.DESC_PRODUTO, e.COR_PRODUTO, e.FILIAL
    """
    
    df_estoque = pd.read_sql(query_estoque, conn)
    
    if df_estoque.empty:
        log.write(f"  ✗ Nenhum produto encontrado com estoque")
        return
    
    # Agrupar por PRODUTO + COR (soma todas as filiais)
    estoque_agrupado = df_estoque.groupby(['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR']).agg({
        'ESTOQUE_ATUAL': 'sum'
    }).reset_index()
    
    log.write(f"  ✓ {len(df_estoque):,} registros de estoque encontrados")
    log.write(f"  ✓ {len(estoque_agrupado):,} produtos únicos (PRODUTO+COR)")
    log.write(f"\n  [ESTOQUE ATUAL POR PRODUTO+COR]")
    for idx, row in estoque_agrupado.head(10).iterrows():
        log.write(f"    • {row['DESC_PRODUTO']} | {row['DESC_COR'] or 'SEM COR'}: {row['ESTOQUE_ATUAL']:,.0f} unidades")
    
    # ==========================================
    # 2. BUSCAR ENTRADAS DA SEMANA (ÚLTIMOS 7 DIAS)
    # ==========================================
    log.write(f"\n[2] ENTRADAS DA SEMANA (Últimos 7 dias)")
    log.write("-" * 100)
    log.write(f"  Período: {data_7_dias_atras.strftime('%d/%m/%Y')} até {data_hoje.strftime('%d/%m/%Y')}")
    log.write(f"\n  ⚠ IMPORTANTE: Estas são as entradas que estão sendo consideradas no cálculo!")
    
    query_entradas_semana = f"""
        SELECT 
            E.ROMANEIO_PRODUTO,
            E.EMISSAO,
            E.FILIAL,
            f.FILIAL AS NOME_FILIAL,
            PE.PRODUTO,
            prd.DESC_PRODUTO,
            PE.COR_PRODUTO,
            c.DESC_COR,
            CAST(PE.QTDE AS FLOAT) AS QTDE_ENTRADA,
            prd.LINHA,
            prd.GRUPO_PRODUTO
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS PE WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = PE.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = PE.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = PE.COR_PRODUTO
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = E.FILIAL
        WHERE E.EMISSAO >= '{data_7_dias_atras.strftime('%Y-%m-%d')}'
            AND E.EMISSAO < '{data_hoje.strftime('%Y-%m-%d')}'
            AND prd.PRODUTO IS NOT NULL
            {filtro_produto_entradas}
        ORDER BY E.EMISSAO DESC, prd.DESC_PRODUTO, PE.COR_PRODUTO
    """
    
    df_entradas_semana = pd.read_sql(query_entradas_semana, conn)
    
    if df_entradas_semana.empty:
        log.write(f"  ✗ Nenhuma entrada encontrada nos últimos 7 dias")
        entradas_semana_total = 0
        entradas_semana_agrupado = pd.DataFrame(columns=['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'TOTAL_ENTRADA', 'QTD_ROMANEIOS'])
    else:
        log.write(f"  ✓ {len(df_entradas_semana):,} registros de entrada encontrados")
        log.write(f"\n  📋 LISTA COMPLETA DE TODAS AS ENTRADAS CONSIDERADAS NO CÁLCULO:")
        log.write(f"  {'='*100}")
        
        # Mostrar TODAS as entradas individualmente
        for idx, ent in df_entradas_semana.iterrows():
            log.write(f"    [{idx+1}] Romaneio: {ent['ROMANEIO_PRODUTO']} | Data: {ent['EMISSAO'].strftime('%d/%m/%Y')} | Produto: {ent['DESC_PRODUTO']} | Cor: {ent['DESC_COR'] or 'SEM COR'} | Filial: {ent['NOME_FILIAL'] or ent['FILIAL']} | Quantidade: {ent['QTDE_ENTRADA']:,.0f} unidades")
        
        log.write(f"  {'='*100}\n")
        
        # Agrupar por PRODUTO + COR
        entradas_semana_agrupado = df_entradas_semana.groupby(['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR']).agg({
            'QTDE_ENTRADA': 'sum',
            'ROMANEIO_PRODUTO': 'count'
        }).reset_index()
        entradas_semana_agrupado.columns = ['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'TOTAL_ENTRADA', 'QTD_ROMANEIOS']
        
        entradas_semana_total = df_entradas_semana['QTDE_ENTRADA'].sum()
        
        log.write(f"  ✓ Total de entradas na semana: {entradas_semana_total:,.0f} unidades")
        log.write(f"  ✓ {len(entradas_semana_agrupado):,} produtos únicos com entradas")
        
        log.write(f"\n  [RESUMO AGRUPADO POR PRODUTO+COR]")
        for idx, row in entradas_semana_agrupado.head(50).iterrows():
            log.write(f"    • {row['DESC_PRODUTO']} | {row['DESC_COR'] or 'SEM COR'}:")
            log.write(f"        Total: {row['TOTAL_ENTRADA']:,.0f} unidades em {row['QTD_ROMANEIOS']:.0f} romaneio(s)")
            
            # Mostrar detalhes dos romaneios
            detalhes = df_entradas_semana[
                (df_entradas_semana['PRODUTO'] == row['PRODUTO']) & 
                (df_entradas_semana['COR_PRODUTO'] == row['COR_PRODUTO'])
            ].sort_values('EMISSAO', ascending=False)
            
            for _, det in detalhes.iterrows():
                log.write(f"          - Romaneio {det['ROMANEIO_PRODUTO']} | {det['EMISSAO'].strftime('%d/%m/%Y')} | Filial: {det['NOME_FILIAL'] or det['FILIAL']} | Qtd: {det['QTDE_ENTRADA']:,.0f}")
    
    # ==========================================
    # 3. BUSCAR ENTRADAS DO MÊS ATUAL
    # ==========================================
    log.write(f"\n[3] ENTRADAS DO MÊS ATUAL")
    log.write("-" * 100)
    log.write(f"  Período: {data_inicio_mes.strftime('%d/%m/%Y')} até {data_hoje.strftime('%d/%m/%Y')}")
    log.write(f"\n  ⚠ IMPORTANTE: Estas são as entradas do mês atual que estão sendo consideradas!")
    
    query_entradas_mes = f"""
        SELECT 
            E.ROMANEIO_PRODUTO,
            E.EMISSAO,
            E.FILIAL,
            f.FILIAL AS NOME_FILIAL,
            PE.PRODUTO,
            prd.DESC_PRODUTO,
            PE.COR_PRODUTO,
            c.DESC_COR,
            CAST(PE.QTDE AS FLOAT) AS QTDE_ENTRADA,
            prd.LINHA,
            prd.GRUPO_PRODUTO
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS PE WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = PE.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = PE.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = PE.COR_PRODUTO
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = E.FILIAL
        WHERE E.EMISSAO >= '{data_inicio_mes.strftime('%Y-%m-%d')}'
            AND E.EMISSAO < '{data_hoje.strftime('%Y-%m-%d')}'
            AND prd.PRODUTO IS NOT NULL
            {filtro_produto_entradas}
        ORDER BY E.EMISSAO DESC, prd.DESC_PRODUTO, PE.COR_PRODUTO
    """
    
    df_entradas_mes = pd.read_sql(query_entradas_mes, conn)
    
    if df_entradas_mes.empty:
        log.write(f"  ✗ Nenhuma entrada encontrada no mês atual")
        entradas_mes_total = 0
        entradas_mes_agrupado = pd.DataFrame(columns=['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'TOTAL_ENTRADA', 'QTD_ROMANEIOS'])
    else:
        log.write(f"  ✓ {len(df_entradas_mes):,} registros de entrada encontrados")
        log.write(f"\n  📋 LISTA COMPLETA DE TODAS AS ENTRADAS DO MÊS ATUAL:")
        log.write(f"  {'='*100}")
        
        # Mostrar TODAS as entradas individualmente
        for idx, ent in df_entradas_mes.iterrows():
            log.write(f"    [{idx+1}] Romaneio: {ent['ROMANEIO_PRODUTO']} | Data: {ent['EMISSAO'].strftime('%d/%m/%Y')} | Produto: {ent['DESC_PRODUTO']} | Cor: {ent['DESC_COR'] or 'SEM COR'} | Filial: {ent['NOME_FILIAL'] or ent['FILIAL']} | Quantidade: {ent['QTDE_ENTRADA']:,.0f} unidades")
        
        log.write(f"  {'='*100}\n")
        
        # Agrupar por PRODUTO + COR
        entradas_mes_agrupado = df_entradas_mes.groupby(['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR']).agg({
            'QTDE_ENTRADA': 'sum',
            'ROMANEIO_PRODUTO': 'count'
        }).reset_index()
        entradas_mes_agrupado.columns = ['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'TOTAL_ENTRADA', 'QTD_ROMANEIOS']
        
        entradas_mes_total = df_entradas_mes['QTDE_ENTRADA'].sum()
        
        log.write(f"  ✓ Total de entradas no mês atual: {entradas_mes_total:,.0f} unidades")
        log.write(f"  ✓ {len(entradas_mes_agrupado):,} produtos únicos com entradas")
    
    # ==========================================
    # 4. BUSCAR ENTRADAS DA SEMANA PASSADA (7-14 DIAS ATRÁS)
    # ==========================================
    log.write(f"\n[4] ENTRADAS DA SEMANA PASSADA (7-14 dias atrás)")
    log.write("-" * 100)
    log.write(f"  Período: {data_14_dias_atras.strftime('%d/%m/%Y')} até {data_7_dias_atras.strftime('%d/%m/%Y')}")
    
    query_entradas_semana_passada = f"""
        SELECT 
            E.ROMANEIO_PRODUTO,
            E.EMISSAO,
            E.FILIAL,
            f.FILIAL AS NOME_FILIAL,
            PE.PRODUTO,
            prd.DESC_PRODUTO,
            PE.COR_PRODUTO,
            c.DESC_COR,
            CAST(PE.QTDE AS FLOAT) AS QTDE_ENTRADA,
            prd.LINHA,
            prd.GRUPO_PRODUTO
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS PE WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = PE.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = PE.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = PE.COR_PRODUTO
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = E.FILIAL
        WHERE E.EMISSAO >= '{data_14_dias_atras.strftime('%Y-%m-%d')}'
            AND E.EMISSAO < '{data_7_dias_atras.strftime('%Y-%m-%d')}'
            AND prd.PRODUTO IS NOT NULL
            {filtro_produto_entradas}
        ORDER BY E.EMISSAO DESC, prd.DESC_PRODUTO, PE.COR_PRODUTO
    """
    
    df_entradas_semana_passada = pd.read_sql(query_entradas_semana_passada, conn)
    
    if df_entradas_semana_passada.empty:
        log.write(f"  ✗ Nenhuma entrada encontrada na semana passada")
        entradas_semana_passada_total = 0
        entradas_semana_passada_agrupado = pd.DataFrame(columns=['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'TOTAL_ENTRADA', 'QTD_ROMANEIOS'])
    else:
        log.write(f"  ✓ {len(df_entradas_semana_passada):,} registros de entrada encontrados")
        
        # Agrupar por PRODUTO + COR
        entradas_semana_passada_agrupado = df_entradas_semana_passada.groupby(['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR']).agg({
            'QTDE_ENTRADA': 'sum',
            'ROMANEIO_PRODUTO': 'count'
        }).reset_index()
        entradas_semana_passada_agrupado.columns = ['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'TOTAL_ENTRADA', 'QTD_ROMANEIOS']
        
        entradas_semana_passada_total = df_entradas_semana_passada['QTDE_ENTRADA'].sum()
        
        log.write(f"  ✓ Total de entradas na semana passada: {entradas_semana_passada_total:,.0f} unidades")
        log.write(f"  ✓ {len(entradas_semana_passada_agrupado):,} produtos únicos com entradas")
    
    # ==========================================
    # 5. BUSCAR VENDAS DA SEMANA (ÚLTIMOS 7 DIAS)
    # ==========================================
    log.write(f"\n[5] VENDAS DA SEMANA (Últimos 7 dias)")
    log.write("-" * 100)
    
    query_vendas_semana = f"""
        SELECT 
            vp.PRODUTO,
            prd.DESC_PRODUTO,
            vp.COR_PRODUTO,
            c.DESC_COR,
            f.FILIAL AS NOME_FILIAL,
            CAST(vp.QTDE AS FLOAT) AS QTDE_VENDA,
            vp.DATA_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = vp.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = vp.COR_PRODUTO
        WHERE vp.DATA_VENDA >= '{data_7_dias_atras.strftime('%Y-%m-%d')}'
            AND vp.DATA_VENDA < '{data_hoje.strftime('%Y-%m-%d')}'
            AND vp.QTDE > 0
            AND vp.QTDE_CANCELADA = 0
            {filtro_produto}
    """
    
    df_vendas_semana = pd.read_sql(query_vendas_semana, conn)
    
    if df_vendas_semana.empty:
        log.write(f"  ✗ Nenhuma venda encontrada nos últimos 7 dias")
        vendas_semana_total = 0
        vendas_semana_agrupado = pd.DataFrame(columns=['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'QTDE_VENDA'])
    else:
        vendas_semana_agrupado = df_vendas_semana.groupby(['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR']).agg({
            'QTDE_VENDA': 'sum'
        }).reset_index()
        
        vendas_semana_total = df_vendas_semana['QTDE_VENDA'].sum()
        log.write(f"  ✓ {len(df_vendas_semana):,} registros de venda encontrados")
        log.write(f"  ✓ Total de vendas na semana: {vendas_semana_total:,.0f} unidades")
    
    # ==========================================
    # 6. BUSCAR E-COMMERCE DA SEMANA (ÚLTIMOS 7 DIAS)
    # ==========================================
    log.write(f"\n[6] E-COMMERCE DA SEMANA (Últimos 7 dias)")
    log.write("-" * 100)
    
    query_ecom_semana = f"""
        SELECT 
            fp.PRODUTO,
            prd.DESC_PRODUTO,
            fp.COR_PRODUTO,
            c.DESC_COR,
            f.FILIAL AS NOME_FILIAL,
            CAST(fp.QTDE AS FLOAT) AS QTDE_ECOMMERCE,
            f.EMISSAO
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS prd WITH (NOLOCK) ON prd.PRODUTO = fp.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = fp.COR_PRODUTO
        WHERE f.EMISSAO >= '{data_7_dias_atras.strftime('%Y-%m-%d')}'
            AND f.EMISSAO < '{data_hoje.strftime('%Y-%m-%d')}'
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
            {filtro_produto}
    """
    
    df_ecom_semana = pd.read_sql(query_ecom_semana, conn)
    
    if df_ecom_semana.empty:
        log.write(f"  ✗ Nenhuma venda e-commerce encontrada nos últimos 7 dias")
        ecom_semana_total = 0
        ecom_semana_agrupado = pd.DataFrame(columns=['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR', 'QTDE_ECOMMERCE'])
    else:
        ecom_semana_agrupado = df_ecom_semana.groupby(['PRODUTO', 'DESC_PRODUTO', 'COR_PRODUTO', 'DESC_COR']).agg({
            'QTDE_ECOMMERCE': 'sum'
        }).reset_index()
        
        ecom_semana_total = df_ecom_semana['QTDE_ECOMMERCE'].sum()
        log.write(f"  ✓ {len(df_ecom_semana):,} registros de e-commerce encontrados")
        log.write(f"  ✓ Total de e-commerce na semana: {ecom_semana_total:,.0f} unidades")
    
    # ==========================================
    # 7. CÁLCULO DO ESTOQUE DA SEMANA PASSADA
    # ==========================================
    log.write(f"\n[7] CÁLCULO DO ESTOQUE DA SEMANA PASSADA")
    log.write("-" * 100)
    log.write(f"  Fórmula: Estoque Semana Passada = Estoque Atual - Entradas (7 dias) + Vendas (7 dias) + E-commerce (7 dias)")
    log.write("")
    
    # Fazer merge de todos os dados por PRODUTO + COR
    resultado = estoque_agrupado.copy()
    
    # Merge com entradas da semana
    if not df_entradas_semana.empty:
        entradas_merge = entradas_semana_agrupado[['PRODUTO', 'COR_PRODUTO', 'TOTAL_ENTRADA']].copy()
        entradas_merge.columns = ['PRODUTO', 'COR_PRODUTO', 'ENTRADAS_SEMANA']
        resultado = resultado.merge(entradas_merge, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['ENTRADAS_SEMANA'] = resultado['ENTRADAS_SEMANA'].fillna(0)
    else:
        resultado['ENTRADAS_SEMANA'] = 0
    
    # Merge com vendas da semana
    if not df_vendas_semana.empty:
        vendas_merge = vendas_semana_agrupado[['PRODUTO', 'COR_PRODUTO', 'QTDE_VENDA']].copy()
        vendas_merge.columns = ['PRODUTO', 'COR_PRODUTO', 'VENDAS_SEMANA']
        resultado = resultado.merge(vendas_merge, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['VENDAS_SEMANA'] = resultado['VENDAS_SEMANA'].fillna(0)
    else:
        resultado['VENDAS_SEMANA'] = 0
    
    # Merge com e-commerce da semana
    if not df_ecom_semana.empty:
        ecom_merge = ecom_semana_agrupado[['PRODUTO', 'COR_PRODUTO', 'QTDE_ECOMMERCE']].copy()
        ecom_merge.columns = ['PRODUTO', 'COR_PRODUTO', 'ECOMMERCE_SEMANA']
        resultado = resultado.merge(ecom_merge, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['ECOMMERCE_SEMANA'] = resultado['ECOMMERCE_SEMANA'].fillna(0)
    else:
        resultado['ECOMMERCE_SEMANA'] = 0
    
    # Calcular estoque semana passada
    resultado['ESTOQUE_SEMANA_PASSADA'] = (
        resultado['ESTOQUE_ATUAL'] - 
        resultado['ENTRADAS_SEMANA'] + 
        resultado['VENDAS_SEMANA'] + 
        resultado['ECOMMERCE_SEMANA']
    )
    resultado['ESTOQUE_SEMANA_PASSADA'] = resultado['ESTOQUE_SEMANA_PASSADA'].clip(lower=0)
    
    # Calcular diferença semanal (tendência)
    resultado['DIFERENCA_SEMANAL'] = resultado['ESTOQUE_ATUAL'] - resultado['ESTOQUE_SEMANA_PASSADA']
    
    # Merge com entradas semana passada
    if not df_entradas_semana_passada.empty:
        entradas_passada_merge = entradas_semana_passada_agrupado[['PRODUTO', 'COR_PRODUTO', 'TOTAL_ENTRADA']].copy()
        entradas_passada_merge.columns = ['PRODUTO', 'COR_PRODUTO', 'ENTRADAS_SEMANA_PASSADA']
        resultado = resultado.merge(entradas_passada_merge, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['ENTRADAS_SEMANA_PASSADA'] = resultado['ENTRADAS_SEMANA_PASSADA'].fillna(0)
    else:
        resultado['ENTRADAS_SEMANA_PASSADA'] = 0
    
    # Ordenar por estoque atual (maior primeiro)
    resultado = resultado.sort_values('ESTOQUE_ATUAL', ascending=False)
    
    log.write(f"  [RESUMO POR PRODUTO+COR]")
    log.write(f"  {'Produto':<50} {'Cor':<20} {'Estoque Atual':>15} {'Entradas Semana':>18} {'Entradas Sem Pass':>20} {'Estoque Sem Pass':>18} {'Diferença':>12}")
    log.write(f"  {'-'*50} {'-'*20} {'-'*15} {'-'*18} {'-'*20} {'-'*18} {'-'*12}")
    
    for idx, row in resultado.head(50).iterrows():
        produto = row['DESC_PRODUTO'][:48] if len(str(row['DESC_PRODUTO'])) > 48 else row['DESC_PRODUTO']
        cor = (row['DESC_COR'] or 'SEM COR')[:18] if row['DESC_COR'] else 'SEM COR'[:18]
        log.write(f"  {produto:<50} {cor:<20} {row['ESTOQUE_ATUAL']:>15,.0f} {row['ENTRADAS_SEMANA']:>18,.0f} {row['ENTRADAS_SEMANA_PASSADA']:>20,.0f} {row['ESTOQUE_SEMANA_PASSADA']:>18,.0f} {row['DIFERENCA_SEMANAL']:>+12,.0f}")
    
    # ==========================================
    # 8. EXEMPLO DETALHADO PARA UM PRODUTO ESPECÍFICO
    # ==========================================
    if not resultado.empty:
        log.write(f"\n[8] EXEMPLO DETALHADO - PRIMEIRO PRODUTO COM MAIOR ESTOQUE")
        log.write("-" * 100)
        
        exemplo = resultado.iloc[0]
        produto_exemplo = exemplo['PRODUTO']
        cor_exemplo = exemplo['COR_PRODUTO']
        
        log.write(f"  Produto: {exemplo['DESC_PRODUTO']}")
        log.write(f"  Cor: {exemplo['DESC_COR'] or 'SEM COR'}")
        log.write(f"  Código Produto: {produto_exemplo}")
        log.write(f"  Código Cor: {cor_exemplo}")
        log.write("")
        log.write(f"  [CÁLCULOS]")
        log.write(f"    Estoque Atual: {exemplo['ESTOQUE_ATUAL']:,.0f} unidades")
        log.write(f"    Entradas na Semana (últimos 7 dias): {exemplo['ENTRADAS_SEMANA']:,.0f} unidades")
        log.write(f"    Vendas na Semana (últimos 7 dias): {exemplo['VENDAS_SEMANA']:,.0f} unidades")
        log.write(f"    E-commerce na Semana (últimos 7 dias): {exemplo['ECOMMERCE_SEMANA']:,.0f} unidades")
        log.write("")
        log.write(f"    Estoque Semana Passada = Estoque Atual - Entradas + Vendas + E-commerce")
        log.write(f"    Estoque Semana Passada = {exemplo['ESTOQUE_ATUAL']:,.0f} - {exemplo['ENTRADAS_SEMANA']:,.0f} + {exemplo['VENDAS_SEMANA']:,.0f} + {exemplo['ECOMMERCE_SEMANA']:,.0f}")
        log.write(f"    Estoque Semana Passada = {exemplo['ESTOQUE_SEMANA_PASSADA']:,.0f} unidades")
        log.write("")
        log.write(f"    Diferença Semanal = Estoque Atual - Estoque Semana Passada")
        log.write(f"    Diferença Semanal = {exemplo['ESTOQUE_ATUAL']:,.0f} - {exemplo['ESTOQUE_SEMANA_PASSADA']:,.0f}")
        log.write(f"    Diferença Semanal = {exemplo['DIFERENCA_SEMANAL']:+,.0f} unidades")
        log.write("")
        log.write(f"    Entradas Semana Passada (7-14 dias atrás): {exemplo['ENTRADAS_SEMANA_PASSADA']:,.0f} unidades")
        log.write("")
        
        # Mostrar detalhes das entradas da semana para este produto
        if not df_entradas_semana.empty:
            entradas_produto = df_entradas_semana[
                (df_entradas_semana['PRODUTO'] == produto_exemplo) & 
                (df_entradas_semana['COR_PRODUTO'] == cor_exemplo)
            ].sort_values('EMISSAO', ascending=False)
            
            if not entradas_produto.empty:
                log.write(f"  [DETALHES DAS ENTRADAS DA SEMANA PARA ESTE PRODUTO]")
                for _, ent in entradas_produto.iterrows():
                    log.write(f"    • Romaneio: {ent['ROMANEIO_PRODUTO']}")
                    log.write(f"      Data: {ent['EMISSAO'].strftime('%d/%m/%Y')}")
                    log.write(f"      Filial: {ent['NOME_FILIAL'] or ent['FILIAL']}")
                    log.write(f"      Quantidade: {ent['QTDE_ENTRADA']:,.0f} unidades")
                    log.write("")

def main():
    """Função principal"""
    print("="*100)
    print("LOG DETALHADO DE ENTRADAS DE ESTOQUE")
    print("="*100)
    
    # Perguntar ao usuário o que analisar
    print("\nO que você deseja analisar?")
    print("1 - Produto específico (por nome)")
    print("2 - Linha específica (ex: PASHMINA)")
    print("3 - Todos os produtos")
    
    escolha = input("\nDigite o número da opção (1, 2 ou 3): ").strip()
    
    produto_nome = None
    linha = None
    
    if escolha == '1':
        produto_nome = input("Digite o nome do produto (ou parte do nome): ").strip()
        if not produto_nome:
            print("⚠ Nome vazio, analisando todos os produtos")
    elif escolha == '2':
        linha = input("Digite o nome da linha (ex: PASHMINA): ").strip().upper()
        if not linha:
            print("⚠ Linha vazia, analisando todos os produtos")
    elif escolha == '3':
        print("✓ Analisando todos os produtos")
    else:
        print("⚠ Opção inválida, analisando todos os produtos")
    
    # Criar nome do arquivo de log
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filtro_nome = ""
    if produto_nome:
        filtro_nome = f"_{produto_nome.replace(' ', '_')[:30]}"
    elif linha:
        filtro_nome = f"_{linha}"
    
    nome_arquivo = f"log_entradas_estoque{filtro_nome}_{timestamp}.txt"
    
    print(f"\n✓ Log será salvo em: {nome_arquivo}")
    
    conn = None
    log = None
    try:
        log = LogWriter(nome_arquivo)
        conn = conectar_banco()
        analisar_entradas_produto(conn, produto_nome=produto_nome, linha=linha, log=log)
        print(f"\n✓ Log salvo com sucesso em: {nome_arquivo}")
    except Exception as e:
        if log:
            log.write(f"\n✗ Erro durante a análise: {e}")
            import traceback
            log.write(traceback.format_exc())
        print(f"\n✗ Erro durante a análise: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if log:
            log.close()
        if conn:
            conn.close()
            print("\n✓ Conexão fechada")

if __name__ == '__main__':
    main()

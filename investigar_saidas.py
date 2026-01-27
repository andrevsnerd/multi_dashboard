#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Investigação de Saídas de Produtos
Investiga onde estão todas as saídas de produtos (vendas, e-commerce, transferências)
para garantir que temos todas as saídas verdadeiras
"""

import os
import sys
import pyodbc
import pandas as pd
from datetime import datetime
from collections import defaultdict

# Configurar encoding para Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

# Produtos para investigar
PRODUTOS_INVESTIGAR = ['13.46.0400', '28.05.0114', '14.09.0226']

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
                print(f"[OK] Conectado via servidor fallback ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"[ERRO] Erro conexao com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"[ERRO] Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    sys.exit(1)

def buscar_estoque_atual(conn, produtos):
    """Busca estoque atual dos produtos"""
    print("\n" + "="*80)
    print("1. ESTOQUE ATUAL DOS PRODUTOS")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL,
            e.ESTOQUE,
            c.DESC_COR
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
        WHERE e.PRODUTO IN ({placeholders})
        ORDER BY e.PRODUTO, e.FILIAL, e.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontrados {len(df)} registros de estoque")
    print("\nEstoque por Produto/Filial/Cor:")
    for _, row in df.iterrows():
        print(f"  {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} ({row['DESC_COR'] or ''}) | {row['FILIAL']} | Estoque: {row['ESTOQUE']}")
    
    return df

def buscar_saidas_estoque_prod_sai(conn, produtos):
    """Busca saídas na tabela ESTOQUE_PROD_SAI (tabela principal de saídas)"""
    print("\n" + "="*80)
    print("2. SAÍDAS EM ESTOQUE_PROD_SAI (Tabela Principal)")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            S.ROMANEIO_PRODUTO,
            S.EMISSAO,
            S.FILIAL,
            P.PRODUTO,
            P.COR_PRODUTO,
            P.QTDE AS QTDE_TOTAL,
            c.DESC_COR
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON P.COR_PRODUTO = c.COR
        WHERE P.PRODUTO IN ({placeholders})
            AND P.PRODUTO IS NOT NULL
        ORDER BY S.EMISSAO DESC, S.FILIAL, P.PRODUTO, P.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} saídas em ESTOQUE_PROD_SAI")
    if len(df) > 0:
        print("\nÚltimas 20 saídas:")
        for _, row in df.head(20).iterrows():
            data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
            print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE_TOTAL']}")
    
    return df

def buscar_vendas_loja(conn, produtos):
    """Busca vendas na tabela LOJA_VENDA_PRODUTO"""
    print("\n" + "="*80)
    print("3. VENDAS EM LOJA_VENDA_PRODUTO")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            vp.TICKET,
            vp.CODIGO_FILIAL,
            v.DATA_VENDA,
            f.FILIAL,
            vp.PRODUTO,
            vp.COR_PRODUTO,
            vp.QTDE,
            vp.QTDE_CANCELADA,
            vp.PRECO_LIQUIDO,
            c.DESC_COR
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
            AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vp.CODIGO_FILIAL
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vp.COR_PRODUTO = c.COR
        WHERE vp.PRODUTO IN ({placeholders})
            AND vp.QTDE > 0
        ORDER BY v.DATA_VENDA DESC, vp.CODIGO_FILIAL, vp.PRODUTO, vp.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} vendas em LOJA_VENDA_PRODUTO")
    if len(df) > 0:
        print("\nÚltimas 20 vendas:")
        for _, row in df.head(20).iterrows():
            data_str = row['DATA_VENDA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_VENDA']) else 'N/A'
            cancelada = " [CANCELADA]" if row['QTDE_CANCELADA'] > 0 else ""
            print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE']}{cancelada}")
    
    return df

def buscar_vendas_ecommerce(conn, produtos):
    """Busca vendas via e-commerce (FATURAMENTO)"""
    print("\n" + "="*80)
    print("4. VENDAS E-COMMERCE EM FATURAMENTO")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            f.EMISSAO,
            f.DATA_SAIDA,
            f.FILIAL,
            fp.PRODUTO,
            fp.COR_PRODUTO,
            fp.QTDE,
            f.NF_SAIDA,
            f.SERIE_NF,
            f.NATUREZA_SAIDA,
            c.DESC_COR
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON fp.COR_PRODUTO = c.COR
        WHERE fp.PRODUTO IN ({placeholders})
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        ORDER BY f.EMISSAO DESC, f.FILIAL, fp.PRODUTO, fp.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} vendas e-commerce")
    if len(df) > 0:
        print("\nÚltimas 20 vendas e-commerce:")
        for _, row in df.head(20).iterrows():
            data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
            print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE']} | NF: {row['NF_SAIDA']}")
    
    return df

def buscar_trocas_devolucoes(conn, produtos):
    """Busca trocas e devoluções (LOJA_VENDA_TROCA)"""
    print("\n" + "="*80)
    print("5. TROCAS E DEVOLUÇÕES EM LOJA_VENDA_TROCA")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            vt.TICKET,
            vt.CODIGO_FILIAL,
            v.DATA_VENDA,
            f.FILIAL,
            vt.PRODUTO,
            vt.COR_PRODUTO,
            vt.QTDE,
            vt.QTDE_CANCELADA,
            vt.PRECO_LIQUIDO,
            c.DESC_COR
        FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
            AND v.TICKET = vt.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vt.CODIGO_FILIAL
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON vt.COR_PRODUTO = c.COR
        WHERE vt.PRODUTO IN ({placeholders})
            AND vt.QTDE_CANCELADA = 0
        ORDER BY v.DATA_VENDA DESC, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} trocas/devoluções")
    if len(df) > 0:
        print("\nÚltimas 20 trocas/devoluções:")
        for _, row in df.head(20).iterrows():
            data_str = row['DATA_VENDA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_VENDA']) else 'N/A'
            print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE']}")
    
    return df

def buscar_transferencias(conn, produtos):
    """Busca transferências entre filiais"""
    print("\n" + "="*80)
    print("6. TRANSFERÊNCIAS ENTRE FILIAIS")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Tentar buscar em tabelas de transferência
    tabelas_transferencia = [
        ('ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI', 'FILIAL', 'EMISSAO'),
        ('LOJA_SAIDAS_ROMANEIO', 'LOJA_SAIDAS_ROMANEIO_PRODUTO', 'FILIAL', 'DATA_SAIDA'),
    ]
    
    resultados = {}
    
    for tabela_cab, tabela_item, col_filial, col_data in tabelas_transferencia:
        try:
            query = f"""
                SELECT TOP 100
                    t.{col_data} AS DATA_TRANSFERENCIA,
                    t.{col_filial} AS FILIAL,
                    tp.PRODUTO,
                    tp.COR_PRODUTO,
                    tp.QTDE,
                    t.ROMANEIO_PRODUTO
                FROM {tabela_cab} t WITH (NOLOCK)
                INNER JOIN {tabela_item} tp WITH (NOLOCK)
                    ON t.ROMANEIO_PRODUTO = tp.ROMANEIO_PRODUTO
                WHERE tp.PRODUTO IN ({placeholders})
                ORDER BY t.{col_data} DESC
            """
            df = pd.read_sql(query, conn)
            
            if len(df) > 0:
                print(f"\n[OK] {tabela_item}: {len(df)} transferências encontradas")
                print("\nÚltimas 10 transferências:")
                for _, row in df.head(10).iterrows():
                    data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                    print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE']}")
                resultados[tabela_item] = df
        except Exception as e:
            print(f"[INFO] {tabela_item}: {str(e)[:100]}")
            continue
    
    return resultados

def buscar_tabelas_saidas(conn):
    """Lista todas as tabelas relacionadas a saídas"""
    print("\n" + "="*80)
    print("7. INVESTIGANDO TABELAS RELACIONADAS A SAÍDAS")
    print("="*80)
    
    query = """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
            AND (
                TABLE_NAME LIKE '%SAIDA%'
                OR TABLE_NAME LIKE '%SAI%'
                OR TABLE_NAME LIKE '%VENDA%'
                OR TABLE_NAME LIKE '%TROCA%'
                OR TABLE_NAME LIKE '%DEVOLUCAO%'
                OR TABLE_NAME LIKE '%FATURAMENTO%'
            )
        ORDER BY TABLE_NAME
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} tabelas relacionadas:")
    for _, row in df.iterrows():
        print(f"  - {row['TABLE_NAME']}")
    
    return df['TABLE_NAME'].tolist()

def buscar_ultima_saida_por_filial(conn, produtos):
    """Busca última saída conhecida por produto+cor+filial"""
    print("\n" + "="*80)
    print("8. ÚLTIMA SAÍDA CONHECIDA POR FILIAL")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Última saída em ESTOQUE_PROD_SAI
    query_sai = f"""
        SELECT 
            P.PRODUTO,
            P.COR_PRODUTO,
            S.FILIAL,
            MAX(S.EMISSAO) AS ULTIMA_SAIDA,
            SUM(P.QTDE) AS TOTAL_QTDE_SAIDA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IN ({placeholders})
            AND P.PRODUTO IS NOT NULL
        GROUP BY P.PRODUTO, P.COR_PRODUTO, S.FILIAL
        ORDER BY P.PRODUTO, S.FILIAL, P.COR_PRODUTO
    """
    
    df_sai = pd.read_sql(query_sai, conn)
    
    # Última venda em LOJA_VENDA_PRODUTO
    query_venda = f"""
        SELECT 
            vp.PRODUTO,
            vp.COR_PRODUTO,
            f.FILIAL,
            MAX(v.DATA_VENDA) AS ULTIMA_VENDA,
            SUM(CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END) AS TOTAL_QTDE_VENDA
        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
        INNER JOIN LOJA_VENDA v WITH (NOLOCK)
            ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
            AND v.TICKET = vp.TICKET
        LEFT JOIN FILIAIS f WITH (NOLOCK)
            ON f.COD_FILIAL = vp.CODIGO_FILIAL
        WHERE vp.PRODUTO IN ({placeholders})
            AND vp.QTDE > 0
        GROUP BY vp.PRODUTO, vp.COR_PRODUTO, f.FILIAL
        ORDER BY vp.PRODUTO, f.FILIAL, vp.COR_PRODUTO
    """
    
    df_venda = pd.read_sql(query_venda, conn)
    
    print(f"\n[OK] Últimas saídas em ESTOQUE_PROD_SAI:")
    for _, row in df_sai.iterrows():
        data_str = row['ULTIMA_SAIDA'].strftime('%d/%m/%Y') if pd.notna(row['ULTIMA_SAIDA']) else 'SEM SAÍDA'
        print(f"  {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | {row['FILIAL']} | Última: {data_str} | Total: {row['TOTAL_QTDE_SAIDA']}")
    
    print(f"\n[OK] Últimas vendas em LOJA_VENDA_PRODUTO:")
    for _, row in df_venda.iterrows():
        data_str = row['ULTIMA_VENDA'].strftime('%d/%m/%Y') if pd.notna(row['ULTIMA_VENDA']) else 'SEM VENDA'
        print(f"  {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | {row['FILIAL']} | Última: {data_str} | Total: {row['TOTAL_QTDE_VENDA']}")
    
    return df_sai, df_venda

def comparar_saidas_vs_estoque(conn, produtos, df_estoque, df_saidas, df_vendas):
    """Compara saídas conhecidas com estoque atual"""
    print("\n" + "="*80)
    print("9. COMPARAÇÃO: SAÍDAS vs ESTOQUE")
    print("="*80)
    
    # Criar chave composta para comparação
    estoque_keys = set()
    for _, row in df_estoque.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        estoque_keys.add(key)
    
    saida_keys = set()
    for _, row in df_saidas.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        saida_keys.add(key)
    
    venda_keys = set()
    for _, row in df_vendas.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        venda_keys.add(key)
    
    todas_saidas = saida_keys | venda_keys
    
    # Filiais com estoque mas sem saída conhecida
    sem_saida = estoque_keys - todas_saidas
    
    print(f"\n[OK] Filiais com estoque: {len(estoque_keys)}")
    print(f"[OK] Filiais com saída conhecida (ESTOQUE_PROD_SAI): {len(saida_keys)}")
    print(f"[OK] Filiais com venda conhecida (LOJA_VENDA): {len(venda_keys)}")
    print(f"[OK] Total de filiais com saída/venda: {len(todas_saidas)}")
    print(f"[INFO] Filiais com estoque mas SEM saída/venda conhecida: {len(sem_saida)}")
    
    if len(sem_saida) > 0:
        print("\n🔍 FILIAIS QUE PRECISAM INVESTIGAÇÃO:")
        for key in sorted(sem_saida):
            produto, cor, filial = key.split('|')
            estoque_row = df_estoque[
                (df_estoque['PRODUTO'] == produto) & 
                (df_estoque['COR_PRODUTO'].fillna('') == cor) & 
                (df_estoque['FILIAL'] == filial)
            ]
            if len(estoque_row) > 0:
                estoque_val = estoque_row.iloc[0]['ESTOQUE']
                print(f"  [SEM SAÍDA] {produto} | {cor or 'SEM COR'} | {filial} | Estoque: {estoque_val} | SEM SAÍDA CONHECIDA")
    
    return sem_saida

def identificar_transferencias_saida_entrada(conn, produtos):
    """Identifica transferências relacionando saídas e entradas no mesmo dia"""
    print("\n" + "="*80)
    print("10. IDENTIFICANDO TRANSFERÊNCIAS (SAÍDA + ENTRADA NO MESMO DIA)")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Buscar saídas
    query_saidas = f"""
        SELECT 
            CAST(S.EMISSAO AS DATE) AS DATA_SAIDA,
            S.FILIAL AS FILIAL_SAIDA,
            P.PRODUTO,
            P.COR_PRODUTO,
            P.QTDE AS QTDE_SAIDA,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IN ({placeholders})
            AND P.PRODUTO IS NOT NULL
    """
    
    # Buscar entradas
    query_entradas = f"""
        SELECT 
            CAST(E.EMISSAO AS DATE) AS DATA_ENTRADA,
            E.FILIAL AS FILIAL_ENTRADA,
            P.PRODUTO,
            P.COR_PRODUTO,
            P.QTDE AS QTDE_ENTRADA,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IN ({placeholders})
            AND P.PRODUTO IS NOT NULL
    """
    
    df_saidas = pd.read_sql(query_saidas, conn)
    df_entradas = pd.read_sql(query_entradas, conn)
    
    print(f"\n[OK] Encontradas {len(df_saidas)} saídas e {len(df_entradas)} entradas")
    
    # Encontrar correspondências por produto+cor+data
    transferencias = []
    
    for _, saida in df_saidas.iterrows():
        # Normalizar cor para comparação
        cor_saida = str(saida['COR_PRODUTO']) if pd.notna(saida['COR_PRODUTO']) else ''
        
        # Buscar entradas do mesmo produto+cor na mesma data ou próximo dia
        entradas_match = df_entradas[
            (df_entradas['PRODUTO'] == saida['PRODUTO']) &
            (df_entradas['COR_PRODUTO'].fillna('').astype(str) == cor_saida) &
            (df_entradas['DATA_ENTRADA'] == saida['DATA_SAIDA'])
        ]
        
        if len(entradas_match) > 0:
            for _, entrada in entradas_match.iterrows():
                # Só considerar se for filiais diferentes (transferência)
                if saida['FILIAL_SAIDA'] != entrada['FILIAL_ENTRADA']:
                    transferencias.append({
                        'DATA': saida['DATA_SAIDA'],
                        'PRODUTO': saida['PRODUTO'],
                        'COR_PRODUTO': saida['COR_PRODUTO'] or 'SEM COR',
                        'FILIAL_ORIGEM': saida['FILIAL_SAIDA'],
                        'FILIAL_DESTINO': entrada['FILIAL_ENTRADA'],
                        'QTDE_SAIDA': saida['QTDE_SAIDA'],
                        'QTDE_ENTRADA': entrada['QTDE_ENTRADA'],
                        'ROMANEIO_SAIDA': saida['ROMANEIO_SAIDA'],
                        'ROMANEIO_ENTRADA': entrada['ROMANEIO_ENTRADA']
                    })
    
    if len(transferencias) > 0:
        print(f"\n[OK] Encontradas {len(transferencias)} possíveis transferências:")
        print("\n" + "-"*80)
        for i, transf in enumerate(transferencias[:20], 1):  # Mostrar até 20 exemplos
            data_str = transf['DATA'].strftime('%d/%m/%Y') if pd.notna(transf['DATA']) else 'N/A'
            print(f"\n{i}. TRANSFERÊNCIA IDENTIFICADA:")
            print(f"   Data: {data_str}")
            print(f"   Produto: {transf['PRODUTO']} | Cor: {transf['COR_PRODUTO']}")
            print(f"   Origem: {transf['FILIAL_ORIGEM']} → Qtde Saída: {transf['QTDE_SAIDA']} | Romaneio: {transf['ROMANEIO_SAIDA']}")
            print(f"   Destino: {transf['FILIAL_DESTINO']} → Qtde Entrada: {transf['QTDE_ENTRADA']} | Romaneio: {transf['ROMANEIO_ENTRADA']}")
            if transf['QTDE_SAIDA'] == transf['QTDE_ENTRADA']:
                print(f"   ✓ Quantidades coincidem (transferência completa)")
            else:
                print(f"   ⚠ Quantidades diferentes (saída: {transf['QTDE_SAIDA']}, entrada: {transf['QTDE_ENTRADA']})")
        
        if len(transferencias) > 20:
            print(f"\n... e mais {len(transferencias) - 20} transferências")
    else:
        print("\n[INFO] Nenhuma transferência identificada (saída e entrada no mesmo dia em filiais diferentes)")
    
    # Também buscar transferências com diferença de até 3 dias
    print("\n" + "-"*80)
    print("\nBuscando transferências com diferença de até 3 dias...")
    
    transferencias_proximas = []
    for _, saida in df_saidas.iterrows():
        # Buscar entradas do mesmo produto+cor em até 3 dias depois
        if pd.notna(saida['DATA_SAIDA']):
            data_saida = pd.to_datetime(saida['DATA_SAIDA'])
            data_min = data_saida
            data_max = data_saida + pd.Timedelta(days=3)
            
            # Normalizar cor para comparação
            cor_saida = str(saida['COR_PRODUTO']) if pd.notna(saida['COR_PRODUTO']) else ''
            
            entradas_match = df_entradas[
                (df_entradas['PRODUTO'] == saida['PRODUTO']) &
                (df_entradas['COR_PRODUTO'].fillna('').astype(str) == cor_saida) &
                (pd.to_datetime(df_entradas['DATA_ENTRADA']) >= data_min) &
                (pd.to_datetime(df_entradas['DATA_ENTRADA']) <= data_max) &
                (df_entradas['FILIAL_ENTRADA'] != saida['FILIAL_SAIDA'])
            ]
            
            if len(entradas_match) > 0:
                for _, entrada in entradas_match.iterrows():
                    dias_diferenca = (pd.to_datetime(entrada['DATA_ENTRADA']) - data_saida).days
                    if dias_diferenca > 0:  # Só mostrar se entrada for depois da saída
                        transferencias_proximas.append({
                            'DATA_SAIDA': saida['DATA_SAIDA'],
                            'DATA_ENTRADA': entrada['DATA_ENTRADA'],
                            'DIAS_DIFERENCA': dias_diferenca,
                            'PRODUTO': saida['PRODUTO'],
                            'COR_PRODUTO': saida['COR_PRODUTO'] or 'SEM COR',
                            'FILIAL_ORIGEM': saida['FILIAL_SAIDA'],
                            'FILIAL_DESTINO': entrada['FILIAL_ENTRADA'],
                            'QTDE_SAIDA': saida['QTDE_SAIDA'],
                            'QTDE_ENTRADA': entrada['QTDE_ENTRADA'],
                            'ROMANEIO_SAIDA': saida['ROMANEIO_SAIDA'],
                            'ROMANEIO_ENTRADA': entrada['ROMANEIO_ENTRADA']
                        })
    
    if len(transferencias_proximas) > 0:
        print(f"\n[OK] Encontradas {len(transferencias_proximas)} transferências com até 3 dias de diferença:")
        for i, transf in enumerate(transferencias_proximas[:10], 1):  # Mostrar até 10 exemplos
            data_saida_str = transf['DATA_SAIDA'].strftime('%d/%m/%Y') if pd.notna(transf['DATA_SAIDA']) else 'N/A'
            data_entrada_str = transf['DATA_ENTRADA'].strftime('%d/%m/%Y') if pd.notna(transf['DATA_ENTRADA']) else 'N/A'
            print(f"\n{i}. TRANSFERÊNCIA (diferença de {transf['DIAS_DIFERENCA']} dia(s)):")
            print(f"   Produto: {transf['PRODUTO']} | Cor: {transf['COR_PRODUTO']}")
            print(f"   Saída: {data_saida_str} | {transf['FILIAL_ORIGEM']} → Qtde: {transf['QTDE_SAIDA']}")
            print(f"   Entrada: {data_entrada_str} | {transf['FILIAL_DESTINO']} → Qtde: {transf['QTDE_ENTRADA']}")
        
        if len(transferencias_proximas) > 10:
            print(f"\n... e mais {len(transferencias_proximas) - 10} transferências")
    
    return transferencias, transferencias_proximas

def investigar_todas_tabelas_produto_saidas(conn, produtos):
    """Investiga todas as tabelas que podem ter saídas do produto"""
    print("\n" + "="*80)
    print("11. INVESTIGAÇÃO GERAL: TODAS AS TABELAS COM SAÍDAS")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Buscar todas as tabelas que têm coluna PRODUTO e podem ter saídas
    query = """
        SELECT DISTINCT c.TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS c
        INNER JOIN INFORMATION_SCHEMA.TABLES t
            ON c.TABLE_NAME = t.TABLE_NAME
        WHERE c.COLUMN_NAME = 'PRODUTO'
            AND t.TABLE_TYPE = 'BASE TABLE'
            AND (
                c.TABLE_NAME LIKE '%SAIDA%'
                OR c.TABLE_NAME LIKE '%SAI%'
                OR c.TABLE_NAME LIKE '%VENDA%'
                OR c.TABLE_NAME LIKE '%TROCA%'
                OR c.TABLE_NAME LIKE '%FATURAMENTO%'
            )
        ORDER BY c.TABLE_NAME
    """
    
    df_tabelas = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df_tabelas)} tabelas com coluna PRODUTO relacionadas a saídas")
    
    resultados = {}
    tabelas_relevantes = []
    
    for _, row in df_tabelas.iterrows():
        tabela = row['TABLE_NAME']
        try:
            # Verificar se tem algum dos produtos
            query_check = f"""
                SELECT TOP 1 *
                FROM {tabela} WITH (NOLOCK)
                WHERE PRODUTO IN ({placeholders})
            """
            df_check = pd.read_sql(query_check, conn)
            
            if len(df_check) > 0:
                # Verificar colunas de data
                colunas = df_check.columns.tolist()
                colunas_data = [c for c in colunas if 'DATA' in c.upper() or 'EMISSAO' in c.upper() or 'SAIDA' in c.upper()]
                
                print(f"\n[OK] {tabela}: {len(df_check)} registros encontrados")
                print(f"  Colunas de data: {', '.join(colunas_data) if colunas_data else 'Nenhuma'}")
                print(f"  Todas as colunas: {', '.join(colunas[:15])}...")
                
                tabelas_relevantes.append(tabela)
                resultados[tabela] = df_check
        except Exception as e:
            # Ignorar erros (tabela pode não ter acesso, etc)
            continue
    
    print(f"\n[OK] Total de tabelas relevantes encontradas: {len(tabelas_relevantes)}")
    return resultados

def gerar_relatorio_completo(conn, produtos):
    """Gera relatório completo de investigação"""
    print("\n" + "="*80)
    print("INVESTIGAÇÃO COMPLETA DE SAÍDAS")
    print("="*80)
    print(f"Produtos investigados: {', '.join(produtos)}")
    print(f"Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    
    # 1. Estoque atual
    df_estoque = buscar_estoque_atual(conn, produtos)
    
    # 2. Saídas conhecidas
    df_saidas = buscar_saidas_estoque_prod_sai(conn, produtos)
    
    # 3. Vendas
    df_vendas = buscar_vendas_loja(conn, produtos)
    
    # 4. Vendas e-commerce
    df_ecommerce = buscar_vendas_ecommerce(conn, produtos)
    
    # 5. Trocas e devoluções
    df_trocas = buscar_trocas_devolucoes(conn, produtos)
    
    # 6. Transferências
    resultados_transferencias = buscar_transferencias(conn, produtos)
    
    # 7. Listar tabelas relacionadas
    tabelas_saidas = buscar_tabelas_saidas(conn)
    
    # 8. Última saída por filial
    df_ultima_saida, df_ultima_venda = buscar_ultima_saida_por_filial(conn, produtos)
    
    # 9. Comparação
    sem_saida = comparar_saidas_vs_estoque(conn, produtos, df_estoque, df_saidas, df_vendas)
    
    # 10. Identificar transferências
    transferencias, transferencias_proximas = identificar_transferencias_saida_entrada(conn, produtos)
    
    # 11. Investigação geral
    todas_tabelas = investigar_todas_tabelas_produto_saidas(conn, produtos)
    
    # Resumo final
    print("\n" + "="*80)
    print("RESUMO DA INVESTIGAÇÃO")
    print("="*80)
    print(f"[OK] Estoque encontrado em {len(df_estoque)} combinacoes produto+cor+filial")
    print(f"[OK] Saídas conhecidas encontradas (ESTOQUE_PROD_SAI): {len(df_saidas)} registros")
    print(f"[OK] Vendas encontradas (LOJA_VENDA): {len(df_vendas)} registros")
    print(f"[OK] Vendas e-commerce encontradas: {len(df_ecommerce)} registros")
    print(f"[OK] Trocas/devoluções encontradas: {len(df_trocas)} registros")
    print(f"[OK] Transferências identificadas (mesmo dia): {len(transferencias)}")
    print(f"[OK] Transferências identificadas (até 3 dias): {len(transferencias_proximas)}")
    print(f"[OK] Filiais com estoque mas SEM saída/venda conhecida: {len(sem_saida)}")
    print(f"[OK] Tabelas relacionadas a saídas encontradas: {len(tabelas_saidas)}")
    print(f"[OK] Tabelas com produtos investigados: {len(todas_tabelas)}")
    
    if len(sem_saida) > 0:
        print("\n[ATENCAO] Ha filiais com estoque mas sem saída/venda registrada!")
        print("   Isso indica que as saídas podem estar em outras tabelas.")
        print("   Verifique as tabelas listadas acima para encontrar a origem.")
    
    return {
        'estoque': df_estoque,
        'saidas': df_saidas,
        'vendas': df_vendas,
        'ecommerce': df_ecommerce,
        'trocas': df_trocas,
        'sem_saida': sem_saida,
        'tabelas_encontradas': todas_tabelas
    }

def main():
    """Função principal"""
    produtos = PRODUTOS_INVESTIGAR
    
    print("="*80)
    print("SCRIPT DE INVESTIGAÇÃO DE SAÍDAS DE PRODUTOS")
    print("="*80)
    print(f"\nProdutos a investigar: {', '.join(produtos)}")
    print("\nEste script irá:")
    print("  1. Verificar estoque atual dos produtos")
    print("  2. Buscar saídas conhecidas (ESTOQUE_PROD_SAI)")
    print("  3. Buscar vendas (LOJA_VENDA_PRODUTO)")
    print("  4. Buscar vendas e-commerce (FATURAMENTO)")
    print("  5. Buscar trocas e devoluções")
    print("  6. Investigar outras tabelas possíveis")
    print("  7. Comparar e identificar onde estão as saídas faltantes")
    print("\n" + "="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        resultados = gerar_relatorio_completo(conn, produtos)
        
        print("\n" + "="*80)
        print("INVESTIGAÇÃO CONCLUÍDA!")
        print("="*80)
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

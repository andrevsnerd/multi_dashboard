#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Teste de histórico semanal para linhas PASHMINA e LENÇOS
"""

import pandas as pd
import pyodbc
from datetime import datetime, timedelta
import sys

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
    for nome, servidor in servidores:
        try:
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};"
                       f"DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};"
                       f"PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            return conn
        except Exception as e:
            if nome == 'principal':
                continue
            raise

def comparar_estoque_semanal_linha(conn, linha):
    """Compara estoque atual com estoque de uma semana atrás para uma linha específica"""
    print("\n" + "="*80)
    print(f"COMPARACAO DE ESTOQUE: HOJE vs SEMANA PASSADA - LINHA {linha}")
    print("="*80)
    
    data_hoje = datetime.now()
    data_semana_passada = data_hoje - timedelta(days=7)
    data_30_dias = data_hoje - timedelta(days=30)
    
    print(f"\n[PERIODO]")
    print(f"  Hoje: {data_hoje.strftime('%d/%m/%Y')}")
    print(f"  Semana passada: {data_semana_passada.strftime('%d/%m/%Y')}")
    print(f"  (Buscando movimentacoes dos ultimos 30 dias)")
    
    # Buscar estoque ATUAL
    print(f"\n[1] Buscando estoque ATUAL - Linha {linha}...")
    try:
        query_estoque_hoje = f"""
            SELECT 
                e.PRODUTO,
                e.COR_PRODUTO,
                e.FILIAL,
                e.ESTOQUE AS ESTOQUE_ATUAL,
                p.DESC_PRODUTO
            FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
            WHERE p.LINHA = '{linha}'
                AND e.ESTOQUE > 0
        """
        df_estoque_hoje = pd.read_sql(query_estoque_hoje, conn)
        df_estoque_hoje['FILIAL'] = df_estoque_hoje['FILIAL'].astype(str).str.strip()
        print(f"  [OK] {len(df_estoque_hoje):,} registros de estoque atual encontrados")
    except Exception as e:
        print(f"  [ERRO] Erro: {e}")
        return None
    
    if df_estoque_hoje.empty:
        print(f"  [AVISO] Nenhum produto com estoque encontrado para linha {linha}")
        return None
    
    # Agrupar por PRODUTO + COR (soma todas as filiais)
    estoque_hoje_agg = df_estoque_hoje.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'ESTOQUE_ATUAL': 'sum'
    }).reset_index()
    
    print(f"  [OK] {len(estoque_hoje_agg):,} produtos unicos (PRODUTO+COR)")
    print(f"  [OK] Total estoque hoje: {estoque_hoje_agg['ESTOQUE_ATUAL'].sum():,.0f}")
    
    # Analisar filiais
    filiais_estoque = df_estoque_hoje['FILIAL'].unique()
    print(f"  [INFO] Filiais com estoque: {len(filiais_estoque)}")
    print(f"  [INFO] Filiais: {', '.join(sorted(filiais_estoque))}")
    
    # Buscar movimentações dos últimos 30 dias
    print(f"\n[2] Buscando movimentacoes dos ultimos 30 dias - Linha {linha}...")
    
    # Entradas
    try:
        query_entradas = f"""
            SELECT 
                P.PRODUTO,
                P.COR_PRODUTO,
                E.FILIAL,
                CAST(P.QTDE AS FLOAT) AS QTDE_ENTRADA
            FROM ESTOQUE_PROD_ENT AS E
            LEFT JOIN ESTOQUE_PROD1_ENT AS P ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
            LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
            WHERE pr.LINHA = '{linha}'
                AND E.EMISSAO >= DATEADD(day, -30, GETDATE())
        """
        df_entradas = pd.read_sql(query_entradas, conn)
        df_entradas['FILIAL'] = df_entradas['FILIAL'].astype(str).str.strip()
        print(f"  [OK] {len(df_entradas):,} entradas encontradas")
        if not df_entradas.empty:
            filiais_entradas = df_entradas['FILIAL'].unique()
            print(f"  [INFO] Filiais com entradas: {len(filiais_entradas)} - {', '.join(sorted(filiais_entradas))}")
    except Exception as e:
        print(f"  [ERRO] Erro ao buscar entradas: {e}")
        df_entradas = pd.DataFrame()
    
    # Vendas
    try:
        query_vendas = f"""
            SELECT 
                vp.PRODUTO,
                vp.COR_PRODUTO,
                f.FILIAL,
                CAST(vp.QTDE AS FLOAT) AS QTDE_VENDA
            FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
            WHERE p.LINHA = '{linha}'
                AND vp.DATA_VENDA >= DATEADD(day, -30, GETDATE())
                AND vp.QTDE > 0
        """
        df_vendas = pd.read_sql(query_vendas, conn)
        df_vendas['FILIAL'] = df_vendas['FILIAL'].astype(str).str.strip()
        print(f"  [OK] {len(df_vendas):,} vendas encontradas")
        if not df_vendas.empty:
            filiais_vendas = df_vendas['FILIAL'].unique()
            print(f"  [INFO] Filiais com vendas: {len(filiais_vendas)} - {', '.join(sorted(filiais_vendas))}")
    except Exception as e:
        print(f"  [ERRO] Erro ao buscar vendas: {e}")
        df_vendas = pd.DataFrame()
    
    # E-commerce
    try:
        query_ecom = f"""
            SELECT 
                fp.PRODUTO,
                fp.COR_PRODUTO,
                f.FILIAL,
                CAST(fp.QTDE AS FLOAT) AS QTDE_ECOMMERCE
            FROM FATURAMENTO f WITH(NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
                ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
            WHERE p.LINHA = '{linha}'
                AND f.EMISSAO >= DATEADD(day, -30, GETDATE())
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
                AND CAST(fp.QTDE AS FLOAT) > 0
        """
        df_ecom = pd.read_sql(query_ecom, conn)
        df_ecom['FILIAL'] = df_ecom['FILIAL'].astype(str).str.strip()
        print(f"  [OK] {len(df_ecom):,} e-commerce encontrados")
        if not df_ecom.empty:
            filiais_ecom = df_ecom['FILIAL'].unique()
            print(f"  [INFO] Filiais com e-commerce: {len(filiais_ecom)} - {', '.join(sorted(filiais_ecom))}")
    except Exception as e:
        print(f"  [ERRO] Erro ao buscar e-commerce: {e}")
        df_ecom = pd.DataFrame()
    
    # Calcular estoque de uma semana atrás
    print(f"\n[3] Calculando estoque de uma semana atras - Linha {linha}...")
    
    # Agrupar movimentações por PRODUTO + COR
    entradas_agg = df_entradas.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE_ENTRADA': 'sum'
    }).reset_index() if not df_entradas.empty else pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'QTDE_ENTRADA'])
    
    vendas_agg = df_vendas.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE_VENDA': 'sum'
    }).reset_index() if not df_vendas.empty else pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'QTDE_VENDA'])
    
    ecom_agg = df_ecom.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE_ECOMMERCE': 'sum'
    }).reset_index() if not df_ecom.empty else pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'QTDE_ECOMMERCE'])
    
    # Filtrar apenas movimentações da última semana (7 dias)
    data_7_dias = data_hoje - timedelta(days=7)
    
    # Filtrar entradas da semana - buscar novamente com filtro de 7 dias
    try:
        query_entradas_semana = f"""
            SELECT 
                P.PRODUTO,
                P.COR_PRODUTO,
                E.FILIAL,
                CAST(P.QTDE AS FLOAT) AS QTDE_ENTRADA
            FROM ESTOQUE_PROD_ENT AS E
            LEFT JOIN ESTOQUE_PROD1_ENT AS P ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
            LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
            WHERE pr.LINHA = '{linha}'
                AND E.EMISSAO >= DATEADD(day, -7, GETDATE())
        """
        entradas_semana = pd.read_sql(query_entradas_semana, conn)
        entradas_semana['FILIAL'] = entradas_semana['FILIAL'].astype(str).str.strip()
    except:
        entradas_semana = pd.DataFrame()
    
    # Filtrar vendas da semana - buscar novamente com filtro de 7 dias
    try:
        query_vendas_semana = f"""
            SELECT 
                vp.PRODUTO,
                vp.COR_PRODUTO,
                f.FILIAL,
                CAST(vp.QTDE AS FLOAT) AS QTDE_VENDA
            FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
            LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
            WHERE p.LINHA = '{linha}'
                AND vp.DATA_VENDA >= DATEADD(day, -7, GETDATE())
                AND vp.QTDE > 0
        """
        vendas_semana = pd.read_sql(query_vendas_semana, conn)
        vendas_semana['FILIAL'] = vendas_semana['FILIAL'].astype(str).str.strip()
    except:
        vendas_semana = pd.DataFrame()
    
    # Filtrar e-commerce da semana - buscar novamente com filtro de 7 dias
    try:
        query_ecom_semana = f"""
            SELECT 
                fp.PRODUTO,
                fp.COR_PRODUTO,
                f.FILIAL,
                CAST(fp.QTDE AS FLOAT) AS QTDE_ECOMMERCE
            FROM FATURAMENTO f WITH(NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
                ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
            WHERE p.LINHA = '{linha}'
                AND f.EMISSAO >= DATEADD(day, -7, GETDATE())
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
                AND CAST(fp.QTDE AS FLOAT) > 0
        """
        ecom_semana = pd.read_sql(query_ecom_semana, conn)
        ecom_semana['FILIAL'] = ecom_semana['FILIAL'].astype(str).str.strip()
    except:
        ecom_semana = pd.DataFrame()
    
    entradas_semana_agg = entradas_semana.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE_ENTRADA': 'sum'
    }).reset_index() if not entradas_semana.empty else pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'QTDE_ENTRADA'])
    
    vendas_semana_agg = vendas_semana.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE_VENDA': 'sum'
    }).reset_index() if not vendas_semana.empty else pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'QTDE_VENDA'])
    
    ecom_semana_agg = ecom_semana.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE_ECOMMERCE': 'sum'
    }).reset_index() if not ecom_semana.empty else pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'QTDE_ECOMMERCE'])
    
    # Calcular estoque semana passada: Estoque Hoje - Entradas + Vendas + E-commerce
    resultado = estoque_hoje_agg.copy()
    
    # Merge com entradas
    if not entradas_semana_agg.empty:
        resultado = resultado.merge(entradas_semana_agg, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['QTDE_ENTRADA'] = resultado['QTDE_ENTRADA'].fillna(0)
    else:
        resultado['QTDE_ENTRADA'] = 0
    
    # Merge com vendas
    if not vendas_semana_agg.empty:
        resultado = resultado.merge(vendas_semana_agg, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['QTDE_VENDA'] = resultado['QTDE_VENDA'].fillna(0)
    else:
        resultado['QTDE_VENDA'] = 0
    
    # Merge com e-commerce
    if not ecom_semana_agg.empty:
        resultado = resultado.merge(ecom_semana_agg, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        resultado['QTDE_ECOMMERCE'] = resultado['QTDE_ECOMMERCE'].fillna(0)
    else:
        resultado['QTDE_ECOMMERCE'] = 0
    
    # Calcular estoque semana passada
    resultado['ESTOQUE_SEMANA_PASSADA'] = (
        resultado['ESTOQUE_ATUAL'] - 
        resultado['QTDE_ENTRADA'] + 
        resultado['QTDE_VENDA'] + 
        resultado['QTDE_ECOMMERCE']
    )
    resultado['ESTOQUE_SEMANA_PASSADA'] = resultado['ESTOQUE_SEMANA_PASSADA'].clip(lower=0)
    
    resultado['DIFERENCA'] = resultado['ESTOQUE_ATUAL'] - resultado['ESTOQUE_SEMANA_PASSADA']
    resultado['VAR_PCT'] = (resultado['DIFERENCA'] / resultado['ESTOQUE_SEMANA_PASSADA'] * 100).replace([float('inf'), -float('inf')], 0).fillna(0)
    
    # Adicionar descrição do produto
    try:
        query_produtos = f"""
            SELECT PRODUTO, DESC_PRODUTO
            FROM PRODUTOS
            WHERE LINHA = '{linha}'
        """
        df_produtos = pd.read_sql(query_produtos, conn)
        resultado = resultado.merge(df_produtos, on='PRODUTO', how='left')
    except:
        resultado['DESC_PRODUTO'] = ''
    
    # Ordenar por diferença absoluta
    resultado = resultado.sort_values('DIFERENCA', key=abs, ascending=False)
    
    print(f"  [OK] {len(resultado):,} produtos com estoque encontrados")
    
    # Resumo
    print(f"\n[RESUMO GERAL - Linha {linha}:]")
    print(f"  Total de produtos analisados: {len(resultado):,}")
    print(f"  Total de estoque hoje: {resultado['ESTOQUE_ATUAL'].sum():,.0f} unidades")
    print(f"  Total de estoque semana passada: {resultado['ESTOQUE_SEMANA_PASSADA'].sum():,.0f} unidades")
    print(f"  Diferenca total: {resultado['DIFERENCA'].sum():,.0f} unidades")
    print(f"  Total de entradas na semana: {resultado['QTDE_ENTRADA'].sum():,.0f} unidades")
    print(f"  Total de vendas na semana: {resultado['QTDE_VENDA'].sum():,.0f} unidades")
    print(f"  Total de e-commerce na semana: {resultado['QTDE_ECOMMERCE'].sum():,.0f} unidades")
    
    # Top 20 produtos com maior movimentação
    produtos_com_mov = resultado[
        (resultado['QTDE_ENTRADA'] > 0) | 
        (resultado['QTDE_VENDA'] > 0) | 
        (resultado['QTDE_ECOMMERCE'] > 0)
    ]
    
    if len(produtos_com_mov) > 0:
        print(f"\n[EXEMPLOS - Top 20 produtos com movimentacao (ultimos 30 dias) - Linha {linha}:]")
        print("-" * 120)
        top_20 = produtos_com_mov.head(20)[
            ['PRODUTO', 'COR_PRODUTO', 'DESC_PRODUTO', 'ESTOQUE_ATUAL', 'ESTOQUE_SEMANA_PASSADA', 
             'DIFERENCA', 'VAR_PCT', 'QTDE_ENTRADA', 'QTDE_VENDA', 'QTDE_ECOMMERCE']
        ]
        for idx, row in top_20.iterrows():
            print(f"{str(row['PRODUTO']):<15} {str(row['COR_PRODUTO']):<8} "
                  f"Estoque Hoje: {row['ESTOQUE_ATUAL']:>6.0f} | "
                  f"Estoque Sem.Pass.: {row['ESTOQUE_SEMANA_PASSADA']:>6.0f} | "
                  f"Dif: {row['DIFERENCA']:>6.0f} ({row['VAR_PCT']:>5.1f}%) | "
                  f"Ent: {row['QTDE_ENTRADA']:>4.0f} | "
                  f"Vend: {row['QTDE_VENDA']:>4.0f} | "
                  f"E-com: {row['QTDE_ECOMMERCE']:>4.0f}")
    
    # Salvar
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    arquivo = f'data/estoque/comparacao_estoque_semanal_{linha}_{timestamp}.xlsx'
    
    try:
        import os
        os.makedirs('data/estoque', exist_ok=True)
        
        with pd.ExcelWriter(arquivo, engine='openpyxl') as writer:
            resultado.to_excel(writer, sheet_name='Comparacao', index=False)
            if len(produtos_com_mov) > 0:
                produtos_com_mov.to_excel(writer, sheet_name='Com_Movimentacao', index=False)
        
        print(f"\n  [OK] Comparacao salva: {arquivo}")
    except Exception as e:
        print(f"  [ERRO] Erro ao salvar: {e}")
    
    return resultado

def main():
    print("="*80)
    print("TESTE DE HISTORICO SEMANAL - LINHAS PASHMINA E LENCOS")
    print("="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        
        # Testar linha PASHMINA
        resultado_pashmina = comparar_estoque_semanal_linha(conn, 'PASHMINA')
        
        # Testar linha LENÇOS
        resultado_lencos = comparar_estoque_semanal_linha(conn, 'LENÇOS')
        
        print("\n" + "="*80)
        print("TESTE CONCLUIDO")
        print("="*80)
        
    except Exception as e:
        print(f"\n[ERRO] {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para comparar os dados do banco com a planilha CSV exportada
"""

import pyodbc
import pandas as pd
from datetime import datetime
import os

# Config conexão
DB_CONFIG = {
    'server': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server"""
    try:
        conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                   f"SERVER={DB_CONFIG['server']};"
                   f"DATABASE={DB_CONFIG['database']};"
                   f"UID={DB_CONFIG['username']};"
                   f"PWD={DB_CONFIG['password']};")
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"✗ Erro conexão: {e}")
        raise

def buscar_dados_banco(filial='SCARFME MATRIZ CMS', start_date='2025-11-01', end_date='2025-11-20'):
    """Busca dados do banco com os mesmos filtros da planilha"""
    conn = conectar_banco()
    
    query = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            f.FILIAL,
            f.EMISSAO,
            fp.PRODUTO,
            fp.QTDE,
            fp.VALOR_LIQUIDO,
            fp.VALOR,
            fp.PRECO,
            fp.VALOR_PRODUCAO,
            f.NOTA_CANCELADA,
            f.NATUREZA_SAIDA
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{start_date}'
          AND CAST(f.EMISSAO AS DATE) <= '{end_date}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{filial}'
        ORDER BY f.EMISSAO, f.NF_SAIDA, fp.ITEM
    """
    
    df = pd.read_sql(query, conn)
    conn.close()
    
    return df

def carregar_csv(csv_path):
    """Carrega a planilha CSV"""
    try:
        # Tentar diferentes encodings
        for encoding in ['utf-8-sig', 'utf-8', 'latin-1', 'cp1252']:
            try:
                df = pd.read_csv(csv_path, sep=';', encoding=encoding, decimal=',')
                print(f"✓ CSV carregado com encoding: {encoding}")
                return df
            except:
                continue
        raise Exception("Não foi possível carregar o CSV com nenhum encoding")
    except Exception as e:
        print(f"✗ Erro ao carregar CSV: {e}")
        return None

def filtrar_csv(df_csv, filial='SCARFME MATRIZ CMS', start_date='2025-11-01', end_date='2025-11-20'):
    """Filtra o CSV com os mesmos critérios"""
    if df_csv is None:
        return None
    
    # Converter EMISSAO para datetime se necessário
    if 'EMISSAO' in df_csv.columns:
        df_csv['EMISSAO'] = pd.to_datetime(df_csv['EMISSAO'], errors='coerce')
    
    # Filtrar por filial
    if 'FILIAL' in df_csv.columns:
        df_csv = df_csv[df_csv['FILIAL'].str.strip() == filial.strip()]
    
    # Filtrar por data
    if 'EMISSAO' in df_csv.columns:
        df_csv = df_csv[
            (df_csv['EMISSAO'].dt.date >= pd.to_datetime(start_date).date()) &
            (df_csv['EMISSAO'].dt.date <= pd.to_datetime(end_date).date())
        ]
    
    # Filtrar por natureza de saída
    if 'NATUREZA_SAIDA' in df_csv.columns:
        df_csv = df_csv[df_csv['NATUREZA_SAIDA'].isin(['100.02', '100.022'])]
    
    # Filtrar notas canceladas
    if 'NOTA_CANCELADA' in df_csv.columns:
        df_csv = df_csv[df_csv['NOTA_CANCELADA'] == 0]
    
    return df_csv

def comparar_dados(df_banco, df_csv):
    """Compara os dados do banco com o CSV"""
    print("\n" + "="*80)
    print("COMPARAÇÃO: Banco vs CSV")
    print("="*80)
    
    # Totais do banco
    total_valor_banco = df_banco['VALOR_LIQUIDO'].fillna(0).sum()
    total_qtde_banco = df_banco['QTDE'].fillna(0).sum()
    total_rows_banco = len(df_banco)
    
    print(f"\nBANCO:")
    print(f"  Registros: {total_rows_banco:,}")
    print(f"  VALOR_LIQUIDO: {total_valor_banco:,.2f}")
    print(f"  QTDE: {total_qtde_banco:,.0f}")
    
    if df_csv is not None and 'VALOR_LIQUIDO' in df_csv.columns:
        # Totais do CSV
        total_valor_csv = df_csv['VALOR_LIQUIDO'].fillna(0).sum()
        total_qtde_csv = df_csv['QTDE'].fillna(0).sum() if 'QTDE' in df_csv.columns else 0
        total_rows_csv = len(df_csv)
        
        print(f"\nCSV:")
        print(f"  Registros: {total_rows_csv:,}")
        print(f"  VALOR_LIQUIDO: {total_valor_csv:,.2f}")
        print(f"  QTDE: {total_qtde_csv:,.0f}")
        
        print(f"\nDIFERENÇA:")
        print(f"  Registros: {total_rows_csv - total_rows_banco:,}")
        print(f"  VALOR_LIQUIDO: {total_valor_csv - total_valor_banco:,.2f}")
        print(f"  QTDE: {total_qtde_csv - total_qtde_banco:,.0f}")
        
        # Encontrar registros que estão no CSV mas não no banco
        if 'NF_SAIDA' in df_csv.columns and 'SERIE_NF' in df_csv.columns:
            chaves_banco = set(zip(df_banco['NF_SAIDA'].astype(str), df_banco['SERIE_NF'].astype(str)))
            chaves_csv = set(zip(df_csv['NF_SAIDA'].astype(str), df_csv['SERIE_NF'].astype(str)))
            
            apenas_csv = chaves_csv - chaves_banco
            apenas_banco = chaves_banco - chaves_csv
            
            print(f"\nNOTAS:")
            print(f"  Apenas no CSV: {len(apenas_csv):,}")
            print(f"  Apenas no Banco: {len(apenas_banco):,}")
            print(f"  Em ambos: {len(chaves_banco & chaves_csv):,}")
            
            if len(apenas_csv) > 0:
                print(f"\nPrimeiras 10 notas apenas no CSV:")
                for i, (nf, serie) in enumerate(list(apenas_csv)[:10]):
                    print(f"  {nf} - {serie}")
    else:
        print("\nCSV não disponível ou não contém as colunas necessárias")

def analisar_diferencas_detalhadas(df_banco, df_csv):
    """Análise detalhada das diferenças"""
    if df_csv is None:
        return
    
    print("\n" + "="*80)
    print("ANÁLISE DETALHADA DAS DIFERENÇAS")
    print("="*80)
    
    # Comparar por data
    if 'EMISSAO' in df_banco.columns and 'EMISSAO' in df_csv.columns:
        df_banco['DATA'] = pd.to_datetime(df_banco['EMISSAO']).dt.date
        df_csv['DATA'] = pd.to_datetime(df_csv['EMISSAO']).dt.date
        
        banco_por_data = df_banco.groupby('DATA').agg({
            'VALOR_LIQUIDO': 'sum',
            'QTDE': 'sum',
            'NF_SAIDA': 'count'
        }).rename(columns={'NF_SAIDA': 'count'})
        
        csv_por_data = df_csv.groupby('DATA').agg({
            'VALOR_LIQUIDO': 'sum',
            'QTDE': 'sum',
            'NF_SAIDA': 'count'
        }).rename(columns={'NF_SAIDA': 'count'})
        
        comparacao = banco_por_data.join(csv_por_data, rsuffix='_csv', how='outer').fillna(0)
        comparacao['diff_valor'] = comparacao['VALOR_LIQUIDO_csv'] - comparacao['VALOR_LIQUIDO']
        comparacao['diff_qtde'] = comparacao['QTDE_csv'] - comparacao['QTDE']
        comparacao['diff_count'] = comparacao['count_csv'] - comparacao['count']
        
        print("\nComparação por DATA:")
        print(comparacao.to_string())

def main():
    """Função principal"""
    print("="*80)
    print("COMPARAÇÃO: Banco vs Planilha CSV")
    print("="*80)
    
    # Parâmetros
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'
    
    # Buscar dados do banco
    print("\n[1] Buscando dados do banco...")
    df_banco = buscar_dados_banco(FILIAL, START_DATE, END_DATE)
    print(f"✓ {len(df_banco):,} registros encontrados no banco")
    
    # Tentar carregar CSV
    print("\n[2] Tentando carregar CSV...")
    csv_paths = [
        'data/ecommerce.csv',
        '../data/ecommerce.csv',
        './ecommerce.csv',
        'ecommerce.csv'
    ]
    
    df_csv = None
    for path in csv_paths:
        if os.path.exists(path):
            print(f"  Tentando: {path}")
            df_csv = carregar_csv(path)
            if df_csv is not None:
                print(f"✓ CSV carregado: {len(df_csv):,} registros")
                break
    
    if df_csv is None:
        print("⚠ CSV não encontrado. Continuando apenas com dados do banco.")
        print("\nColunas disponíveis no banco:")
        print(df_banco.columns.tolist())
    else:
        print("\n[3] Filtrando CSV...")
        df_csv_filtrado = filtrar_csv(df_csv.copy(), FILIAL, START_DATE, END_DATE)
        print(f"✓ {len(df_csv_filtrado):,} registros após filtros")
        
        print("\n[4] Comparando dados...")
        comparar_dados(df_banco, df_csv_filtrado)
        
        print("\n[5] Análise detalhada...")
        analisar_diferencas_detalhadas(df_banco, df_csv_filtrado)
    
    # Resumo final
    print("\n" + "="*80)
    print("RESUMO FINAL")
    print("="*80)
    total_valor = df_banco['VALOR_LIQUIDO'].fillna(0).sum()
    total_qtde = df_banco['QTDE'].fillna(0).sum()
    
    print(f"\nTotais do BANCO (filtrado):")
    print(f"  VALOR_LIQUIDO: {total_valor:,.2f}")
    print(f"  QTDE: {total_qtde:,.0f}")
    print(f"  Esperado na planilha: 400,056.09 e 1,845")
    print(f"  Diferença: {total_valor - 400056.09:,.2f} e {total_qtde - 1845:,.0f}")

if __name__ == '__main__':
    main()


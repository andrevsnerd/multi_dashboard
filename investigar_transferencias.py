#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Investigação de Transferências entre Lojas
Investiga como funcionam as transferências no LINX:
- Estrutura das tabelas ESTOQUE_PROD_ENT e ESTOQUE_PROD_SAI
- Como são gerados os romaneios
- Relacionamento entre entrada e saída
- Campos obrigatórios e sequências
"""

import os
import sys
import pyodbc
import pandas as pd
from datetime import datetime

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

def investigar_estrutura_tabela_entrada(conn):
    """Investiga estrutura completa da tabela ESTOQUE_PROD_ENT"""
    print("\n" + "="*80)
    print("1. ESTRUTURA DA TABELA ESTOQUE_PROD_ENT (Cabeçalho)")
    print("="*80)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_ENT'
        ORDER BY ORDINAL_POSITION
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} colunas:")
    print("\n" + "-"*80)
    print(f"{'COLUNA':<30} {'TIPO':<20} {'TAMANHO':<10} {'NULL':<8} {'DEFAULT':<20}")
    print("-"*80)
    
    for _, row in df.iterrows():
        coluna = str(row['COLUMN_NAME'])
        tipo = str(row['DATA_TYPE'])
        tamanho = str(row['CHARACTER_MAXIMUM_LENGTH']) if pd.notna(row['CHARACTER_MAXIMUM_LENGTH']) else ''
        nullable = str(row['IS_NULLABLE'])
        default = str(row['COLUMN_DEFAULT']) if pd.notna(row['COLUMN_DEFAULT']) else ''
        print(f"{coluna:<30} {tipo:<20} {tamanho:<10} {nullable:<8} {default:<20}")
    
    return df

def investigar_estrutura_tabela_entrada_item(conn):
    """Investiga estrutura completa da tabela ESTOQUE_PROD1_ENT (Itens)"""
    print("\n" + "="*80)
    print("2. ESTRUTURA DA TABELA ESTOQUE_PROD1_ENT (Itens)")
    print("="*80)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD1_ENT'
        ORDER BY ORDINAL_POSITION
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} colunas:")
    print("\n" + "-"*80)
    print(f"{'COLUNA':<30} {'TIPO':<20} {'TAMANHO':<10} {'NULL':<8} {'DEFAULT':<20}")
    print("-"*80)
    
    for _, row in df.iterrows():
        coluna = str(row['COLUMN_NAME'])
        tipo = str(row['DATA_TYPE'])
        tamanho = str(row['CHARACTER_MAXIMUM_LENGTH']) if pd.notna(row['CHARACTER_MAXIMUM_LENGTH']) else ''
        nullable = str(row['IS_NULLABLE'])
        default = str(row['COLUMN_DEFAULT']) if pd.notna(row['COLUMN_DEFAULT']) else ''
        print(f"{coluna:<30} {tipo:<20} {tamanho:<10} {nullable:<8} {default:<20}")
    
    return df

def investigar_estrutura_tabela_saida(conn):
    """Investiga estrutura completa da tabela ESTOQUE_PROD_SAI"""
    print("\n" + "="*80)
    print("3. ESTRUTURA DA TABELA ESTOQUE_PROD_SAI (Cabeçalho)")
    print("="*80)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD_SAI'
        ORDER BY ORDINAL_POSITION
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} colunas:")
    print("\n" + "-"*80)
    print(f"{'COLUNA':<30} {'TIPO':<20} {'TAMANHO':<10} {'NULL':<8} {'DEFAULT':<20}")
    print("-"*80)
    
    for _, row in df.iterrows():
        coluna = str(row['COLUMN_NAME'])
        tipo = str(row['DATA_TYPE'])
        tamanho = str(row['CHARACTER_MAXIMUM_LENGTH']) if pd.notna(row['CHARACTER_MAXIMUM_LENGTH']) else ''
        nullable = str(row['IS_NULLABLE'])
        default = str(row['COLUMN_DEFAULT']) if pd.notna(row['COLUMN_DEFAULT']) else ''
        print(f"{coluna:<30} {tipo:<20} {tamanho:<10} {nullable:<8} {default:<20}")
    
    return df

def investigar_estrutura_tabela_saida_item(conn):
    """Investiga estrutura completa da tabela ESTOQUE_PROD1_SAI (Itens)"""
    print("\n" + "="*80)
    print("4. ESTRUTURA DA TABELA ESTOQUE_PROD1_SAI (Itens)")
    print("="*80)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'ESTOQUE_PROD1_SAI'
        ORDER BY ORDINAL_POSITION
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} colunas:")
    print("\n" + "-"*80)
    print(f"{'COLUNA':<30} {'TIPO':<20} {'TAMANHO':<10} {'NULL':<8} {'DEFAULT':<20}")
    print("-"*80)
    
    for _, row in df.iterrows():
        coluna = str(row['COLUMN_NAME'])
        tipo = str(row['DATA_TYPE'])
        tamanho = str(row['CHARACTER_MAXIMUM_LENGTH']) if pd.notna(row['CHARACTER_MAXIMUM_LENGTH']) else ''
        nullable = str(row['IS_NULLABLE'])
        default = str(row['COLUMN_DEFAULT']) if pd.notna(row['COLUMN_DEFAULT']) else ''
        print(f"{coluna:<30} {tipo:<20} {tamanho:<10} {nullable:<8} {default:<20}")
    
    return df

def investigar_exemplos_transferencias(conn):
    """Investiga exemplos reais de transferências (saída e entrada relacionadas)"""
    print("\n" + "="*80)
    print("5. EXEMPLOS DE TRANSFERÊNCIAS REAIS")
    print("="*80)
    
    # Buscar transferências onde há saída e entrada no mesmo dia
    query = """
        SELECT TOP 10
            CAST(S.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            E.FILIAL AS FILIAL_DESTINO,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            P_SAI.PRODUTO,
            P_SAI.COR_PRODUTO,
            P_SAI.QTDE AS QTDE_SAIDA,
            P_ENT.QTDE AS QTDE_ENTRADA,
            c.DESC_COR
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_SAI AS P_SAI WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P_SAI.ROMANEIO_PRODUTO
        LEFT JOIN ESTOQUE_PROD1_ENT AS P_ENT WITH (NOLOCK)
            ON P_SAI.PRODUTO = P_ENT.PRODUTO
            AND ISNULL(P_SAI.COR_PRODUTO, '') = ISNULL(P_ENT.COR_PRODUTO, '')
        LEFT JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON E.ROMANEIO_PRODUTO = P_ENT.ROMANEIO_PRODUTO
            AND CAST(E.EMISSAO AS DATE) = CAST(S.EMISSAO AS DATE)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON P_SAI.COR_PRODUTO = c.COR
        WHERE S.FILIAL != E.FILIAL
            AND P_SAI.PRODUTO IS NOT NULL
            AND P_ENT.PRODUTO IS NOT NULL
        ORDER BY S.EMISSAO DESC
    """
    
    df = pd.read_sql(query, conn)
    
    if len(df) > 0:
        print(f"\n[OK] Encontradas {len(df)} transferências relacionadas:")
        print("\n" + "-"*80)
        for idx, row in df.iterrows():
            data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
            print(f"\nTransferência {idx+1}:")
            print(f"  Data: {data_str}")
            print(f"  Produto: {row['PRODUTO']} | Cor: {row['COR_PRODUTO'] or 'SEM COR'} ({row['DESC_COR'] or ''})")
            print(f"  Origem: {row['FILIAL_ORIGEM']} → Romaneio Saída: {row['ROMANEIO_SAIDA']} | Qtde: {row['QTDE_SAIDA']}")
            print(f"  Destino: {row['FILIAL_DESTINO']} → Romaneio Entrada: {row['ROMANEIO_ENTRADA']} | Qtde: {row['QTDE_ENTRADA']}")
    else:
        print("\n[INFO] Nenhuma transferência relacionada encontrada com essa query")
    
    return df

def investigar_romaneios_recentes(conn):
    """Investiga romaneios recentes para entender padrão de numeração"""
    print("\n" + "="*80)
    print("6. ROMANEIOS RECENTES - PADRÃO DE NUMERAÇÃO")
    print("="*80)
    
    # Buscar últimos romaneios de entrada
    query_entrada = """
        SELECT TOP 20
            ROMANEIO_PRODUTO,
            EMISSAO,
            FILIAL,
            COUNT(*) AS TOTAL_ITENS
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE EMISSAO >= DATEADD(DAY, -30, GETDATE())
        GROUP BY ROMANEIO_PRODUTO, EMISSAO, FILIAL
        ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    """
    
    df_entrada = pd.read_sql(query_entrada, conn)
    
    # Buscar últimos romaneios de saída
    query_saida = """
        SELECT TOP 20
            ROMANEIO_PRODUTO,
            EMISSAO,
            FILIAL,
            COUNT(*) AS TOTAL_ITENS
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE EMISSAO >= DATEADD(DAY, -30, GETDATE())
        GROUP BY ROMANEIO_PRODUTO, EMISSAO, FILIAL
        ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    """
    
    df_saida = pd.read_sql(query_saida, conn)
    
    print(f"\n[OK] Últimos 20 romaneios de ENTRADA (últimos 30 dias):")
    print("\n" + "-"*80)
    print(f"{'ROMANEIO':<20} {'DATA':<12} {'FILIAL':<30} {'ITENS':<10}")
    print("-"*80)
    for _, row in df_entrada.iterrows():
        data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
        print(f"{str(row['ROMANEIO_PRODUTO']):<20} {data_str:<12} {str(row['FILIAL']):<30} {int(row['TOTAL_ITENS']):<10}")
    
    print(f"\n[OK] Últimos 20 romaneios de SAÍDA (últimos 30 dias):")
    print("\n" + "-"*80)
    print(f"{'ROMANEIO':<20} {'DATA':<12} {'FILIAL':<30} {'ITENS':<10}")
    print("-"*80)
    for _, row in df_saida.iterrows():
        data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
        print(f"{str(row['ROMANEIO_PRODUTO']):<20} {data_str:<12} {str(row['FILIAL']):<30} {int(row['TOTAL_ITENS']):<10}")
    
    return df_entrada, df_saida

def investigar_registro_completo_entrada(conn):
    """Busca um registro completo de entrada para ver todos os campos"""
    print("\n" + "="*80)
    print("7. REGISTRO COMPLETO DE ENTRADA (Exemplo)")
    print("="*80)
    
    query = """
        SELECT TOP 1
            E.*,
            P.*
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IS NOT NULL
        ORDER BY E.EMISSAO DESC
    """
    
    df = pd.read_sql(query, conn)
    
    if len(df) > 0:
        print("\n[OK] Exemplo de registro completo:")
        print("\nCABEÇALHO (ESTOQUE_PROD_ENT):")
        print("-"*80)
        for col in df.columns:
            if not col.startswith('PRODUTO') and not col.startswith('COR') and not col.startswith('QTDE'):
                valor = df.iloc[0][col]
                try:
                    if pd.notna(valor) and str(valor).strip() != '':
                        print(f"  {col}: {valor}")
                except:
                    pass
        
        print("\nITEM (ESTOQUE_PROD1_ENT):")
        print("-"*80)
        for col in df.columns:
            if col.startswith('PRODUTO') or col.startswith('COR') or col.startswith('QTDE'):
                valor = df.iloc[0][col]
                try:
                    if pd.notna(valor) and str(valor).strip() != '':
                        print(f"  {col}: {valor}")
                except:
                    pass
    else:
        print("\n[INFO] Nenhum registro encontrado")
    
    return df

def investigar_registro_completo_saida(conn):
    """Busca um registro completo de saída para ver todos os campos"""
    print("\n" + "="*80)
    print("8. REGISTRO COMPLETO DE SAÍDA (Exemplo)")
    print("="*80)
    
    query = """
        SELECT TOP 1
            S.*,
            P.*
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IS NOT NULL
        ORDER BY S.EMISSAO DESC
    """
    
    df = pd.read_sql(query, conn)
    
    if len(df) > 0:
        print("\n[OK] Exemplo de registro completo:")
        print("\nCABEÇALHO (ESTOQUE_PROD_SAI):")
        print("-"*80)
        for col in df.columns:
            if not col.startswith('PRODUTO') and not col.startswith('COR') and not col.startswith('QTDE'):
                valor = df.iloc[0][col]
                try:
                    if pd.notna(valor) and str(valor).strip() != '':
                        print(f"  {col}: {valor}")
                except:
                    pass
        
        print("\nITEM (ESTOQUE_PROD1_SAI):")
        print("-"*80)
        for col in df.columns:
            if col.startswith('PRODUTO') or col.startswith('COR') or col.startswith('QTDE'):
                valor = df.iloc[0][col]
                try:
                    if pd.notna(valor) and str(valor).strip() != '':
                        print(f"  {col}: {valor}")
                except:
                    pass
    else:
        print("\n[INFO] Nenhum registro encontrado")
    
    return df

def investigar_sequencias_romaneio(conn):
    """Investiga se há sequências ou tabelas de controle para romaneios"""
    print("\n" + "="*80)
    print("9. INVESTIGANDO SEQUÊNCIAS E CONTROLE DE ROMANEIOS")
    print("="*80)
    
    # Buscar tabelas relacionadas a romaneio
    query_tabelas = """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
            AND (
                TABLE_NAME LIKE '%ROMANEIO%'
                OR TABLE_NAME LIKE '%SEQUENCIA%'
                OR TABLE_NAME LIKE '%CONTROLE%'
                OR TABLE_NAME LIKE '%NUMERO%'
            )
        ORDER BY TABLE_NAME
    """
    
    df_tabelas = pd.read_sql(query_tabelas, conn)
    print(f"\n[OK] Encontradas {len(df_tabelas)} tabelas relacionadas:")
    for _, row in df_tabelas.iterrows():
        print(f"  - {row['TABLE_NAME']}")
    
    # Verificar se há sequences no SQL Server
    query_sequences = """
        SELECT 
            name AS SEQUENCE_NAME,
            start_value,
            increment,
            current_value
        FROM sys.sequences
        WHERE name LIKE '%ROMANEIO%' OR name LIKE '%ENT%' OR name LIKE '%SAI%'
    """
    
    try:
        df_sequences = pd.read_sql(query_sequences, conn)
        if len(df_sequences) > 0:
            print(f"\n[OK] Encontradas {len(df_sequences)} sequências relacionadas:")
            print(df_sequences.to_string())
        else:
            print("\n[INFO] Nenhuma sequência encontrada")
    except Exception as e:
        print(f"\n[INFO] Erro ao buscar sequências: {e}")
    
    return df_tabelas

def investigar_filiais_nerd_scarfme(conn):
    """Lista todas as filiais disponíveis para NERD e SCARFME"""
    print("\n" + "="*80)
    print("10. FILIAIS DISPONÍVEIS (NERD e SCARFME)")
    print("="*80)
    
    query = """
        SELECT DISTINCT
            FILIAL,
            COUNT(*) AS TOTAL_REGISTROS
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE FILIAL LIKE '%NERD%' 
           OR FILIAL LIKE '%SCARF%'
           OR FILIAL LIKE '%SCARFME%'
        GROUP BY FILIAL
        ORDER BY FILIAL
    """
    
    df = pd.read_sql(query, conn)
    
    if len(df) > 0:
        print(f"\n[OK] Encontradas {len(df)} filiais:")
        print("\n" + "-"*80)
        print(f"{'FILIAL':<50} {'TOTAL REGISTROS':<15}")
        print("-"*80)
        for _, row in df.iterrows():
            print(f"{str(row['FILIAL']):<50} {int(row['TOTAL_REGISTROS']):<15,}")
    else:
        print("\n[INFO] Nenhuma filial encontrada")
    
    return df

def investigar_campos_obrigatorios(conn):
    """Investiga quais campos são obrigatórios (NOT NULL)"""
    print("\n" + "="*80)
    print("11. CAMPOS OBRIGATÓRIOS (NOT NULL)")
    print("="*80)
    
    tabelas = ['ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI']
    
    for tabela in tabelas:
        query = f"""
            SELECT 
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = '{tabela}'
                AND IS_NULLABLE = 'NO'
            ORDER BY ORDINAL_POSITION
        """
        
        df = pd.read_sql(query, conn)
        print(f"\n{tabela}:")
        if len(df) > 0:
            print("  Campos obrigatórios:")
            for _, row in df.iterrows():
                print(f"    - {row['COLUMN_NAME']} ({row['DATA_TYPE']})")
        else:
            print("  Nenhum campo NOT NULL encontrado (todos são opcionais)")

def investigar_geracao_romaneio(conn):
    """Investiga como gerar o próximo romaneio"""
    print("\n" + "="*80)
    print("12. INVESTIGANDO GERAÇÃO DE ROMANEIOS")
    print("="*80)
    
    # Buscar maior romaneio de entrada
    query_entrada = """
        SELECT TOP 1
            ROMANEIO_PRODUTO,
            EMISSAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
        ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
    """
    
    # Buscar maior romaneio de saída
    query_saida = """
        SELECT TOP 1
            ROMANEIO_PRODUTO,
            EMISSAO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
        ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
    """
    
    try:
        df_ent = pd.read_sql(query_entrada, conn)
        df_sai = pd.read_sql(query_saida, conn)
        
        print("\n[OK] Maior romaneio de ENTRADA (numérico):")
        if len(df_ent) > 0:
            romaneio_ent = str(df_ent.iloc[0]['ROMANEIO_PRODUTO']).strip()
            data_ent = df_ent.iloc[0]['EMISSAO']
            print(f"  Romaneio: {romaneio_ent}")
            print(f"  Data: {data_ent.strftime('%d/%m/%Y') if pd.notna(data_ent) else 'N/A'}")
            try:
                num_ent = int(romaneio_ent)
                prox_ent = num_ent + 1
                print(f"  Próximo romaneio sugerido: {prox_ent:06d}")
            except:
                print(f"  [INFO] Não é numérico puro")
        else:
            print("  Nenhum romaneio numérico encontrado")
        
        print("\n[OK] Maior romaneio de SAÍDA (numérico):")
        if len(df_sai) > 0:
            romaneio_sai = str(df_sai.iloc[0]['ROMANEIO_PRODUTO']).strip()
            data_sai = df_sai.iloc[0]['EMISSAO']
            print(f"  Romaneio: {romaneio_sai}")
            print(f"  Data: {data_sai.strftime('%d/%m/%Y') if pd.notna(data_sai) else 'N/A'}")
            try:
                num_sai = int(romaneio_sai)
                prox_sai = num_sai + 1
                print(f"  Próximo romaneio sugerido: {prox_sai:06d}")
            except:
                print(f"  [INFO] Não é numérico puro")
        else:
            print("  Nenhum romaneio numérico encontrado")
        
        # Investigar padrão de romaneios com prefixo
        query_entrada_t = """
            SELECT TOP 10
                ROMANEIO_PRODUTO,
                EMISSAO,
                FILIAL
            FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO LIKE 'T%'
            ORDER BY EMISSAO DESC
        """
        
        df_ent_t = pd.read_sql(query_entrada_t, conn)
        if len(df_ent_t) > 0:
            print("\n[OK] Romaneios de ENTRADA com prefixo 'T':")
            for _, row in df_ent_t.iterrows():
                data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
                print(f"  {row['ROMANEIO_PRODUTO']} | {data_str} | {row['FILIAL']}")
        
    except Exception as e:
        print(f"\n[ERRO] Erro ao investigar romaneios: {e}")

def investigar_campos_transferencia(conn):
    """Investiga campos específicos relacionados a transferências"""
    print("\n" + "="*80)
    print("13. CAMPOS ESPECÍFICOS DE TRANSFERÊNCIA")
    print("="*80)
    
    # Buscar exemplos onde há campos de transferência preenchidos
    query = """
        SELECT TOP 5
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.DATA_PARA_TRANSFERENCIA,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            E.FILIAL AS FILIAL_DESTINO_ENT,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM,
            E.DATA_PARA_TRANSFERENCIA AS DATA_TRANSF_ENTRADA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON S.ROMANEIO_DESTINO = E.ROMANEIO_PRODUTO
        WHERE S.FILIAL_DESTINO IS NOT NULL
            OR S.ROMANEIO_DESTINO IS NOT NULL
        ORDER BY S.EMISSAO DESC
    """
    
    df = pd.read_sql(query, conn)
    
    if len(df) > 0:
        print("\n[OK] Exemplos de transferências com campos relacionados:")
        print("\n" + "-"*80)
        for idx, row in df.iterrows():
            print(f"\nTransferência {idx+1}:")
            print(f"  Saída - Romaneio: {row['ROMANEIO_SAIDA']} | Filial Origem: {row['FILIAL_ORIGEM']}")
            print(f"  Saída - Filial Destino: {row['FILIAL_DESTINO']} | Romaneio Destino: {row['ROMANEIO_DESTINO']}")
            print(f"  Saída - Data Transferência: {row['DATA_PARA_TRANSFERENCIA']}")
            if pd.notna(row['ROMANEIO_ENTRADA']):
                print(f"  Entrada - Romaneio: {row['ROMANEIO_ENTRADA']} | Filial Destino: {row['FILIAL_DESTINO_ENT']}")
                print(f"  Entrada - Filial Origem: {row['FILIAL_ORIGEM']} | Romaneio Origem: {row['ROMANEIO_ORIGEM']}")
                print(f"  Entrada - Data Transferência: {row['DATA_TRANSF_ENTRADA']}")
    else:
        print("\n[INFO] Nenhum registro com campos de transferência preenchidos encontrado")
    
    return df

def main():
    """Função principal"""
    print("="*80)
    print("INVESTIGAÇÃO DE TRANSFERÊNCIAS ENTRE LOJAS")
    print("="*80)
    print("\nEste script investiga:")
    print("  1. Estrutura das tabelas de entrada e saída")
    print("  2. Como são gerados os romaneios")
    print("  3. Relacionamento entre transferências")
    print("  4. Campos obrigatórios")
    print("  5. Padrões de numeração")
    print("\n" + "="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        
        # 1. Estrutura das tabelas
        df_ent_cab = investigar_estrutura_tabela_entrada(conn)
        df_ent_item = investigar_estrutura_tabela_entrada_item(conn)
        df_sai_cab = investigar_estrutura_tabela_saida(conn)
        df_sai_item = investigar_estrutura_tabela_saida_item(conn)
        
        # 2. Exemplos reais
        df_transferencias = investigar_exemplos_transferencias(conn)
        
        # 3. Romaneios recentes
        df_rom_ent, df_rom_sai = investigar_romaneios_recentes(conn)
        
        # 4. Registros completos
        df_reg_ent = investigar_registro_completo_entrada(conn)
        df_reg_sai = investigar_registro_completo_saida(conn)
        
        # 5. Sequências
        df_sequencias = investigar_sequencias_romaneio(conn)
        
        # 6. Filiais
        df_filiais = investigar_filiais_nerd_scarfme(conn)
        
        # 7. Campos obrigatórios
        investigar_campos_obrigatorios(conn)
        
        # 8. Geração de romaneios
        investigar_geracao_romaneio(conn)
        
        # 9. Campos de transferência
        df_campos_transf = investigar_campos_transferencia(conn)
        
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

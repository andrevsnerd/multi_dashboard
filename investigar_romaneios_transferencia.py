#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar padrões de romaneios em transferências
Analisa quando o romaneio é o mesmo na entrada e saída vs quando é diferente
"""

import pyodbc
import pandas as pd
from datetime import datetime, timedelta

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server"""
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
            return None
    return None

def investigar_transferencias_romaneios_iguais(conn):
    """Investiga transferências onde romaneio de entrada = romaneio de saída"""
    print("="*100)
    print("INVESTIGACAO: TRANSFERENCIAS COM ROMANEIOS IGUAIS")
    print("="*100)
    
    query = """
        SELECT TOP 50
            CAST(S.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            E.FILIAL AS FILIAL_DESTINO,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            P_SAI.PRODUTO,
            P_SAI.COR_PRODUTO,
            P_SAI.QTDE AS QTDE_SAIDA,
            P_ENT.QTDE AS QTDE_ENTRADA,
            S.FILIAL_DESTINO AS FILIAL_DESTINO_SAIDA,
            S.ROMANEIO_DESTINO AS ROMANEIO_DESTINO_SAIDA,
            E.FILIAL_ORIGEM AS FILIAL_ORIGEM_ENTRADA,
            E.ROMANEIO_ORIGEM AS ROMANEIO_ORIGEM_ENTRADA,
            S.MOV_INTERNA,
            E.ACERTO_ENTRADA,
            E.NF_ENTRADA_PROPRIA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_SAI AS P_SAI WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P_SAI.ROMANEIO_PRODUTO
            AND S.FILIAL = P_SAI.FILIAL
        INNER JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON S.FILIAL_DESTINO = E.FILIAL
            AND S.ROMANEIO_DESTINO = E.ROMANEIO_PRODUTO
        INNER JOIN ESTOQUE_PROD1_ENT AS P_ENT WITH (NOLOCK)
            ON E.ROMANEIO_PRODUTO = P_ENT.ROMANEIO_PRODUTO
            AND P_SAI.PRODUTO = P_ENT.PRODUTO
            AND ISNULL(P_SAI.COR_PRODUTO, '') = ISNULL(P_ENT.COR_PRODUTO, '')
        WHERE S.FILIAL != E.FILIAL
            AND S.ROMANEIO_PRODUTO = E.ROMANEIO_PRODUTO  -- ROMANEIOS IGUAIS
            AND S.EMISSAO >= DATEADD(DAY, -365, GETDATE())  -- Ultimos 365 dias
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} transferencias com ROMANEIOS IGUAIS:")
            print("\n" + "-"*100)
            print(f"{'DATA':<12} {'ORIGEM':<25} {'DESTINO':<25} {'ROMANEIO':<10} {'PRODUTO':<15} {'QTDE':<8}")
            print("-"*100)
            
            for idx, row in df.iterrows():
                data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                origem = str(row['FILIAL_ORIGEM'])[:23]
                destino = str(row['FILIAL_DESTINO'])[:23]
                romaneio = str(row['ROMANEIO_SAIDA'])
                produto = str(row['PRODUTO'])[:13]
                qtde = int(row['QTDE_SAIDA'])
                
                print(f"{data_str:<12} {origem:<25} {destino:<25} {romaneio:<10} {produto:<15} {qtde:<8}")
            
            print("-"*100)
            
            # Analisar características
            print("\n" + "="*100)
            print("ANALISE DE CARACTERISTICAS")
            print("="*100)
            
            # MOV_INTERNA
            if 'MOV_INTERNA' in df.columns:
                mov_interna_count = df['MOV_INTERNA'].value_counts()
                print(f"\nMOV_INTERNA:")
                for valor, count in mov_interna_count.items():
                    print(f"  {valor}: {count} transferencias")
            
            # ACERTO_ENTRADA
            if 'ACERTO_ENTRADA' in df.columns:
                acerto_count = df['ACERTO_ENTRADA'].value_counts()
                print(f"\nACERTO_ENTRADA:")
                for valor, count in acerto_count.items():
                    print(f"  {valor}: {count} transferencias")
            
            # NF_ENTRADA_PROPRIA
            if 'NF_ENTRADA_PROPRIA' in df.columns:
                nf_propria_count = df['NF_ENTRADA_PROPRIA'].value_counts()
                print(f"\nNF_ENTRADA_PROPRIA:")
                for valor, count in nf_propria_count.items():
                    print(f"  {valor}: {count} transferencias")
            
            return df
        else:
            print("\n[INFO] Nenhuma transferencia com romaneios iguais encontrada nos ultimos 90 dias")
            return pd.DataFrame()
            
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar transferencias: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_transferencias_romaneios_diferentes(conn):
    """Investiga transferências onde romaneio de entrada != romaneio de saída"""
    print("\n" + "="*100)
    print("INVESTIGACAO: TRANSFERENCIAS COM ROMANEIOS DIFERENTES")
    print("="*100)
    
    query = """
        SELECT TOP 50
            CAST(S.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            E.FILIAL AS FILIAL_DESTINO,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            P_SAI.PRODUTO,
            P_SAI.COR_PRODUTO,
            P_SAI.QTDE AS QTDE_SAIDA,
            P_ENT.QTDE AS QTDE_ENTRADA,
            S.FILIAL_DESTINO AS FILIAL_DESTINO_SAIDA,
            S.ROMANEIO_DESTINO AS ROMANEIO_DESTINO_SAIDA,
            E.FILIAL_ORIGEM AS FILIAL_ORIGEM_ENTRADA,
            E.ROMANEIO_ORIGEM AS ROMANEIO_ORIGEM_ENTRADA,
            S.MOV_INTERNA,
            E.ACERTO_ENTRADA,
            E.NF_ENTRADA_PROPRIA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_SAI AS P_SAI WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P_SAI.ROMANEIO_PRODUTO
            AND S.FILIAL = P_SAI.FILIAL
        INNER JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON S.FILIAL_DESTINO = E.FILIAL
            AND S.ROMANEIO_DESTINO = E.ROMANEIO_PRODUTO
        INNER JOIN ESTOQUE_PROD1_ENT AS P_ENT WITH (NOLOCK)
            ON E.ROMANEIO_PRODUTO = P_ENT.ROMANEIO_PRODUTO
            AND P_SAI.PRODUTO = P_ENT.PRODUTO
            AND ISNULL(P_SAI.COR_PRODUTO, '') = ISNULL(P_ENT.COR_PRODUTO, '')
        WHERE S.FILIAL != E.FILIAL
            AND S.ROMANEIO_PRODUTO != E.ROMANEIO_PRODUTO  -- ROMANEIOS DIFERENTES
            AND S.EMISSAO >= DATEADD(DAY, -365, GETDATE())  -- Ultimos 365 dias
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} transferencias com ROMANEIOS DIFERENTES:")
            print("\n" + "-"*100)
            print(f"{'DATA':<12} {'ORIGEM':<20} {'DESTINO':<20} {'ROM_SAIDA':<10} {'ROM_ENTRADA':<12} {'PRODUTO':<15} {'QTDE':<8}")
            print("-"*100)
            
            for idx, row in df.iterrows():
                data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                origem = str(row['FILIAL_ORIGEM'])[:18]
                destino = str(row['FILIAL_DESTINO'])[:18]
                rom_saida = str(row['ROMANEIO_SAIDA'])
                rom_entrada = str(row['ROMANEIO_ENTRADA'])
                produto = str(row['PRODUTO'])[:13]
                qtde = int(row['QTDE_SAIDA'])
                
                print(f"{data_str:<12} {origem:<20} {destino:<20} {rom_saida:<10} {rom_entrada:<12} {produto:<15} {qtde:<8}")
            
            print("-"*100)
            
            # Analisar padrões
            print("\n" + "="*100)
            print("ANALISE DE PADROES")
            print("="*100)
            
            # Verificar se romaneio de entrada começa com 'T'
            if len(df) > 0:
                romaneios_entrada = df['ROMANEIO_ENTRADA'].astype(str)
                com_prefixo_t = romaneios_entrada.str.startswith('T').sum()
                sem_prefixo_t = len(df) - com_prefixo_t
                
                print(f"\nRomaneios de entrada com prefixo 'T': {com_prefixo_t} ({com_prefixo_t/len(df)*100:.1f}%)")
                print(f"Romaneios de entrada sem prefixo 'T': {sem_prefixo_t} ({sem_prefixo_t/len(df)*100:.1f}%)")
            
            # MOV_INTERNA
            if 'MOV_INTERNA' in df.columns:
                mov_interna_count = df['MOV_INTERNA'].value_counts()
                print(f"\nMOV_INTERNA:")
                for valor, count in mov_interna_count.items():
                    print(f"  {valor}: {count} transferencias")
            
            # ACERTO_ENTRADA
            if 'ACERTO_ENTRADA' in df.columns:
                acerto_count = df['ACERTO_ENTRADA'].value_counts()
                print(f"\nACERTO_ENTRADA:")
                for valor, count in acerto_count.items():
                    print(f"  {valor}: {count} transferencias")
            
            # NF_ENTRADA_PROPRIA
            if 'NF_ENTRADA_PROPRIA' in df.columns:
                nf_propria_count = df['NF_ENTRADA_PROPRIA'].value_counts()
                print(f"\nNF_ENTRADA_PROPRIA:")
                for valor, count in nf_propria_count.items():
                    print(f"  {valor}: {count} transferencias")
            
            return df
        else:
            print("\n[INFO] Nenhuma transferencia com romaneios diferentes encontrada nos ultimos 90 dias")
            return pd.DataFrame()
            
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar transferencias: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_campos_relacionados(conn):
    """Investiga campos que podem influenciar na decisão do romaneio"""
    print("\n" + "="*100)
    print("INVESTIGACAO: CAMPOS RELACIONADOS A ROMANEIOS")
    print("="*100)
    
    # Verificar campos FILIAL_DESTINO e ROMANEIO_DESTINO em ESTOQUE_PROD_SAI
    print("\n1. CAMPOS EM ESTOQUE_PROD_SAI:")
    query1 = """
        SELECT TOP 10
            ROMANEIO_PRODUTO,
            FILIAL,
            FILIAL_DESTINO,
            ROMANEIO_DESTINO,
            MOV_INTERNA,
            EMISSAO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE FILIAL_DESTINO IS NOT NULL
            OR ROMANEIO_DESTINO IS NOT NULL
        ORDER BY EMISSAO DESC
    """
    
    try:
        df1 = pd.read_sql(query1, conn)
        if len(df1) > 0:
            print(f"\n[OK] Exemplos de ESTOQUE_PROD_SAI com destino:")
            print("\n" + "-"*100)
            print(f"{'ROMANEIO':<10} {'FILIAL':<25} {'FILIAL_DESTINO':<25} {'ROM_DESTINO':<12} {'MOV_INTERNA':<12}")
            print("-"*100)
            for idx, row in df1.iterrows():
                romaneio = str(row['ROMANEIO_PRODUTO'])
                filial = str(row['FILIAL'])[:23]
                filial_dest = str(row['FILIAL_DESTINO'])[:23] if pd.notna(row['FILIAL_DESTINO']) else 'NULL'
                rom_dest = str(row['ROMANEIO_DESTINO'])[:10] if pd.notna(row['ROMANEIO_DESTINO']) else 'NULL'
                mov_interna = int(row['MOV_INTERNA']) if pd.notna(row['MOV_INTERNA']) else 'NULL'
                print(f"{romaneio:<10} {filial:<25} {filial_dest:<25} {rom_dest:<12} {mov_interna:<12}")
            print("-"*100)
    except Exception as e:
        print(f"[ERRO] Erro ao buscar ESTOQUE_PROD_SAI: {e}")
    
    # Verificar campos FILIAL_ORIGEM e ROMANEIO_ORIGEM em ESTOQUE_PROD_ENT
    print("\n2. CAMPOS EM ESTOQUE_PROD_ENT:")
    query2 = """
        SELECT TOP 10
            ROMANEIO_PRODUTO,
            FILIAL,
            FILIAL_ORIGEM,
            ROMANEIO_ORIGEM,
            ACERTO_ENTRADA,
            NF_ENTRADA_PROPRIA,
            EMISSAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE FILIAL_ORIGEM IS NOT NULL
            OR ROMANEIO_ORIGEM IS NOT NULL
        ORDER BY EMISSAO DESC
    """
    
    try:
        df2 = pd.read_sql(query2, conn)
        if len(df2) > 0:
            print(f"\n[OK] Exemplos de ESTOQUE_PROD_ENT com origem:")
            print("\n" + "-"*100)
            print(f"{'ROMANEIO':<10} {'FILIAL':<25} {'FILIAL_ORIGEM':<25} {'ROM_ORIGEM':<12} {'ACERTO':<8} {'NF_PROPRIA':<10}")
            print("-"*100)
            for idx, row in df2.iterrows():
                romaneio = str(row['ROMANEIO_PRODUTO'])
                filial = str(row['FILIAL'])[:23]
                filial_orig = str(row['FILIAL_ORIGEM'])[:23] if pd.notna(row['FILIAL_ORIGEM']) else 'NULL'
                rom_orig = str(row['ROMANEIO_ORIGEM'])[:10] if pd.notna(row['ROMANEIO_ORIGEM']) else 'NULL'
                acerto = int(row['ACERTO_ENTRADA']) if pd.notna(row['ACERTO_ENTRADA']) else 'NULL'
                nf_propria = int(row['NF_ENTRADA_PROPRIA']) if pd.notna(row['NF_ENTRADA_PROPRIA']) else 'NULL'
                print(f"{romaneio:<10} {filial:<25} {filial_orig:<25} {rom_orig:<12} {acerto:<8} {nf_propria:<10}")
            print("-"*100)
    except Exception as e:
        print(f"[ERRO] Erro ao buscar ESTOQUE_PROD_ENT: {e}")

def investigar_registros_completos(conn):
    """Busca registros completos de exemplo para análise detalhada"""
    print("\n" + "="*100)
    print("INVESTIGACAO: REGISTROS COMPLETOS DE EXEMPLO")
    print("="*100)
    
    # Exemplo 1: Romaneio igual
    print("\n1. EXEMPLO: TRANSFERENCIA COM ROMANEIO IGUAL")
    query1 = """
        SELECT TOP 1
            S.ROMANEIO_PRODUTO AS ROMANEIO,
            S.FILIAL AS FILIAL_ORIGEM,
            S.EMISSAO AS DATA_SAIDA,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.MOV_INTERNA,
            E.FILIAL AS FILIAL_DESTINO_ENT,
            E.EMISSAO AS DATA_ENTRADA,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM,
            E.ACERTO_ENTRADA,
            E.NF_ENTRADA_PROPRIA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON S.FILIAL_DESTINO = E.FILIAL
            AND S.ROMANEIO_DESTINO = E.ROMANEIO_PRODUTO
        WHERE S.FILIAL != E.FILIAL
            AND S.ROMANEIO_PRODUTO = E.ROMANEIO_PRODUTO
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df1 = pd.read_sql(query1, conn)
        if len(df1) > 0:
            row = df1.iloc[0]
            print(f"\nRomaneio: {row['ROMANEIO']}")
            print(f"Filial Origem: {row['FILIAL_ORIGEM']}")
            print(f"Filial Destino: {row['FILIAL_DESTINO_ENT']}")
            print(f"MOV_INTERNA: {row['MOV_INTERNA']}")
            print(f"ACERTO_ENTRADA: {row['ACERTO_ENTRADA']}")
            print(f"NF_ENTRADA_PROPRIA: {row['NF_ENTRADA_PROPRIA']}")
            print(f"ROMANEIO_DESTINO (em SAIDA): {row['ROMANEIO_DESTINO']}")
            print(f"ROMANEIO_ORIGEM (em ENTRADA): {row['ROMANEIO_ORIGEM']}")
    except Exception as e:
        print(f"[ERRO] Erro ao buscar exemplo: {e}")
    
    # Exemplo 2: Romaneio diferente
    print("\n2. EXEMPLO: TRANSFERENCIA COM ROMANEIO DIFERENTE")
    query2 = """
        SELECT TOP 1
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.EMISSAO AS DATA_SAIDA,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.MOV_INTERNA,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            E.FILIAL AS FILIAL_DESTINO_ENT,
            E.EMISSAO AS DATA_ENTRADA,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM,
            E.ACERTO_ENTRADA,
            E.NF_ENTRADA_PROPRIA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON S.FILIAL_DESTINO = E.FILIAL
            AND S.ROMANEIO_DESTINO = E.ROMANEIO_PRODUTO
        WHERE S.FILIAL != E.FILIAL
            AND S.ROMANEIO_PRODUTO != E.ROMANEIO_PRODUTO
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df2 = pd.read_sql(query2, conn)
        if len(df2) > 0:
            row = df2.iloc[0]
            print(f"\nRomaneio Saida: {row['ROMANEIO_SAIDA']}")
            print(f"Romaneio Entrada: {row['ROMANEIO_ENTRADA']}")
            print(f"Filial Origem: {row['FILIAL_ORIGEM']}")
            print(f"Filial Destino: {row['FILIAL_DESTINO_ENT']}")
            print(f"MOV_INTERNA: {row['MOV_INTERNA']}")
            print(f"ACERTO_ENTRADA: {row['ACERTO_ENTRADA']}")
            print(f"NF_ENTRADA_PROPRIA: {row['NF_ENTRADA_PROPRIA']}")
            print(f"ROMANEIO_DESTINO (em SAIDA): {row['ROMANEIO_DESTINO']}")
            print(f"ROMANEIO_ORIGEM (em ENTRADA): {row['ROMANEIO_ORIGEM']}")
    except Exception as e:
        print(f"[ERRO] Erro ao buscar exemplo: {e}")

def main():
    """Função principal"""
    print("="*100)
    print("INVESTIGACAO DE ROMANEIOS EM TRANSFERENCIAS")
    print("="*100)
    print("\nEste script investiga quando o romaneio e o mesmo ou diferente")
    print("na entrada e saida de transferencias.\n")
    
    conn = conectar_banco()
    if not conn:
        print("\n[ERRO] Nao foi possivel conectar ao banco")
        return
    
    try:
        # Investigar romaneios iguais
        df_iguais = investigar_transferencias_romaneios_iguais(conn)
        
        # Investigar romaneios diferentes
        df_diferentes = investigar_transferencias_romaneios_diferentes(conn)
        
        # Investigar campos relacionados
        investigar_campos_relacionados(conn)
        
        # Investigar registros completos
        investigar_registros_completos(conn)
        
        # Resumo final
        print("\n" + "="*100)
        print("RESUMO")
        print("="*100)
        print(f"\nTransferencias com ROMANEIOS IGUAIS: {len(df_iguais)}")
        print(f"Transferencias com ROMANEIOS DIFERENTES: {len(df_diferentes)}")
        
        if len(df_iguais) > 0 or len(df_diferentes) > 0:
            total = len(df_iguais) + len(df_diferentes)
            pct_iguais = (len(df_iguais) / total * 100) if total > 0 else 0
            pct_diferentes = (len(df_diferentes) / total * 100) if total > 0 else 0
            
            print(f"\nPercentual:")
            print(f"  Iguais: {pct_iguais:.1f}%")
            print(f"  Diferentes: {pct_diferentes:.1f}%")
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

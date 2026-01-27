#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar casos especiais de romaneios em transferências
Busca situações onde o romaneio pode ser o mesmo (MOV_INTERNA, ACERTO_ENTRADA, etc.)
"""

import pyodbc
import pandas as pd

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

def investigar_mov_interna(conn):
    """Investiga transferências com MOV_INTERNA = 1"""
    print("="*100)
    print("INVESTIGACAO: TRANSFERENCIAS COM MOV_INTERNA = 1")
    print("="*100)
    
    query = """
        SELECT TOP 20
            CAST(S.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            E.FILIAL AS FILIAL_DESTINO,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            S.MOV_INTERNA,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_SAI AS P_SAI WITH (NOLOCK) 
            ON S.ROMANEIO_PRODUTO = P_SAI.ROMANEIO_PRODUTO
            AND S.FILIAL = P_SAI.FILIAL
        LEFT JOIN ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            ON S.FILIAL_DESTINO = E.FILIAL
            AND S.ROMANEIO_DESTINO = E.ROMANEIO_PRODUTO
        WHERE S.MOV_INTERNA = 1
            AND S.EMISSAO >= DATEADD(DAY, -365, GETDATE())
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} transferencias com MOV_INTERNA = 1:")
            print("\n" + "-"*100)
            print(f"{'DATA':<12} {'ORIGEM':<25} {'DESTINO':<25} {'ROM_SAIDA':<10} {'ROM_ENTRADA':<12} {'IGUAIS':<8}")
            print("-"*100)
            
            iguais = 0
            diferentes = 0
            
            for idx, row in df.iterrows():
                data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                origem = str(row['FILIAL_ORIGEM'])[:23]
                destino = str(row['FILIAL_DESTINO'])[:23] if pd.notna(row['FILIAL_DESTINO']) else 'NULL'
                rom_saida = str(row['ROMANEIO_SAIDA'])
                rom_entrada = str(row['ROMANEIO_ENTRADA'])[:10] if pd.notna(row['ROMANEIO_ENTRADA']) else 'NULL'
                
                sao_iguais = rom_saida == rom_entrada
                if sao_iguais:
                    iguais += 1
                else:
                    diferentes += 1
                
                status = "SIM" if sao_iguais else "NAO"
                print(f"{data_str:<12} {origem:<25} {destino:<25} {rom_saida:<10} {rom_entrada:<12} {status:<8}")
            
            print("-"*100)
            print(f"\nResumo:")
            print(f"  Romaneios Iguais: {iguais}")
            print(f"  Romaneios Diferentes: {diferentes}")
            
            return df
        else:
            print("\n[INFO] Nenhuma transferencia com MOV_INTERNA = 1 encontrada")
            return pd.DataFrame()
    except Exception as e:
        print(f"\n[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_acerto_entrada(conn):
    """Investiga transferências com ACERTO_ENTRADA = 1"""
    print("\n" + "="*100)
    print("INVESTIGACAO: TRANSFERENCIAS COM ACERTO_ENTRADA = 1")
    print("="*100)
    
    query = """
        SELECT TOP 20
            CAST(E.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            E.FILIAL AS FILIAL_DESTINO,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM,
            E.ACERTO_ENTRADA,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
            ON E.FILIAL_ORIGEM = S.FILIAL
            AND E.ROMANEIO_ORIGEM = S.ROMANEIO_PRODUTO
        WHERE E.ACERTO_ENTRADA = 1
            AND E.EMISSAO >= DATEADD(DAY, -365, GETDATE())
        ORDER BY E.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} entradas com ACERTO_ENTRADA = 1:")
            print("\n" + "-"*100)
            print(f"{'DATA':<12} {'DESTINO':<25} {'ROM_ENTRADA':<12} {'ROM_ORIGEM':<12} {'ROM_SAIDA':<12} {'IGUAIS':<8}")
            print("-"*100)
            
            iguais = 0
            diferentes = 0
            
            for idx, row in df.iterrows():
                data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                destino = str(row['FILIAL_DESTINO'])[:23]
                rom_entrada = str(row['ROMANEIO_ENTRADA'])
                rom_origem = str(row['ROMANEIO_ORIGEM'])[:10] if pd.notna(row['ROMANEIO_ORIGEM']) else 'NULL'
                rom_saida = str(row['ROMANEIO_SAIDA'])[:10] if pd.notna(row['ROMANEIO_SAIDA']) else 'NULL'
                
                # Comparar entrada com origem
                sao_iguais = rom_entrada == rom_origem
                if sao_iguais:
                    iguais += 1
                else:
                    diferentes += 1
                
                status = "SIM" if sao_iguais else "NAO"
                print(f"{data_str:<12} {destino:<25} {rom_entrada:<12} {rom_origem:<12} {rom_saida:<12} {status:<8}")
            
            print("-"*100)
            print(f"\nResumo:")
            print(f"  Romaneios Iguais: {iguais}")
            print(f"  Romaneios Diferentes: {diferentes}")
            
            return df
        else:
            print("\n[INFO] Nenhuma entrada com ACERTO_ENTRADA = 1 encontrada")
            return pd.DataFrame()
    except Exception as e:
        print(f"\n[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_nf_entrada_propria(conn):
    """Investiga transferências com NF_ENTRADA_PROPRIA = 1"""
    print("\n" + "="*100)
    print("INVESTIGACAO: TRANSFERENCIAS COM NF_ENTRADA_PROPRIA = 1")
    print("="*100)
    
    query = """
        SELECT TOP 20
            CAST(E.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            E.FILIAL AS FILIAL_DESTINO,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM,
            E.NF_ENTRADA_PROPRIA,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
            ON E.FILIAL_ORIGEM = S.FILIAL
            AND E.ROMANEIO_ORIGEM = S.ROMANEIO_PRODUTO
        WHERE E.NF_ENTRADA_PROPRIA = 1
            AND E.EMISSAO >= DATEADD(DAY, -365, GETDATE())
        ORDER BY E.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} entradas com NF_ENTRADA_PROPRIA = 1:")
            print("\n" + "-"*100)
            print(f"{'DATA':<12} {'DESTINO':<25} {'ROM_ENTRADA':<12} {'ROM_ORIGEM':<12} {'ROM_SAIDA':<12} {'IGUAIS':<8}")
            print("-"*100)
            
            iguais = 0
            diferentes = 0
            
            for idx, row in df.iterrows():
                data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                destino = str(row['FILIAL_DESTINO'])[:23]
                rom_entrada = str(row['ROMANEIO_ENTRADA'])
                rom_origem = str(row['ROMANEIO_ORIGEM'])[:10] if pd.notna(row['ROMANEIO_ORIGEM']) else 'NULL'
                rom_saida = str(row['ROMANEIO_SAIDA'])[:10] if pd.notna(row['ROMANEIO_SAIDA']) else 'NULL'
                
                # Comparar entrada com origem
                sao_iguais = rom_entrada == rom_origem
                if sao_iguais:
                    iguais += 1
                else:
                    diferentes += 1
                
                status = "SIM" if sao_iguais else "NAO"
                print(f"{data_str:<12} {destino:<25} {rom_entrada:<12} {rom_origem:<12} {rom_saida:<12} {status:<8}")
            
            print("-"*100)
            print(f"\nResumo:")
            print(f"  Romaneios Iguais: {iguais}")
            print(f"  Romaneios Diferentes: {diferentes}")
            
            return df
        else:
            print("\n[INFO] Nenhuma entrada com NF_ENTRADA_PROPRIA = 1 encontrada")
            return pd.DataFrame()
    except Exception as e:
        print(f"\n[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_todos_casos_iguais(conn):
    """Investiga TODOS os casos onde romaneio entrada = romaneio saída (sem filtro de data)"""
    print("\n" + "="*100)
    print("INVESTIGACAO: TODOS OS CASOS COM ROMANEIOS IGUAIS (HISTORICO COMPLETO)")
    print("="*100)
    
    query = """
        SELECT TOP 50
            CAST(S.EMISSAO AS DATE) AS DATA_TRANSFERENCIA,
            S.FILIAL AS FILIAL_ORIGEM,
            S.ROMANEIO_PRODUTO AS ROMANEIO,
            E.FILIAL AS FILIAL_DESTINO,
            S.MOV_INTERNA,
            E.ACERTO_ENTRADA,
            E.NF_ENTRADA_PROPRIA,
            S.FILIAL_DESTINO AS FILIAL_DESTINO_SAIDA,
            S.ROMANEIO_DESTINO,
            E.FILIAL_ORIGEM,
            E.ROMANEIO_ORIGEM
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
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} transferencias com ROMANEIOS IGUAIS (historico completo):")
            print("\n" + "-"*100)
            print(f"{'DATA':<12} {'ORIGEM':<25} {'DESTINO':<25} {'ROMANEIO':<10} {'MOV_INTERNA':<12} {'ACERTO':<8} {'NF_PROPRIA':<10}")
            print("-"*100)
            
            for idx, row in df.iterrows():
                data_str = row['DATA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_TRANSFERENCIA']) else 'N/A'
                origem = str(row['FILIAL_ORIGEM'])[:23]
                destino = str(row['FILIAL_DESTINO'])[:23]
                romaneio = str(row['ROMANEIO'])
                mov_interna = int(row['MOV_INTERNA']) if pd.notna(row['MOV_INTERNA']) else 'NULL'
                acerto = int(row['ACERTO_ENTRADA']) if pd.notna(row['ACERTO_ENTRADA']) else 'NULL'
                nf_propria = int(row['NF_ENTRADA_PROPRIA']) if pd.notna(row['NF_ENTRADA_PROPRIA']) else 'NULL'
                
                print(f"{data_str:<12} {origem:<25} {destino:<25} {romaneio:<10} {mov_interna:<12} {acerto:<8} {nf_propria:<10}")
            
            print("-"*100)
            
            # Análise
            if 'MOV_INTERNA' in df.columns:
                mov_count = df['MOV_INTERNA'].value_counts()
                print(f"\nMOV_INTERNA:")
                for valor, count in mov_count.items():
                    print(f"  {valor}: {count} casos")
            
            if 'ACERTO_ENTRADA' in df.columns:
                acerto_count = df['ACERTO_ENTRADA'].value_counts()
                print(f"\nACERTO_ENTRADA:")
                for valor, count in acerto_count.items():
                    print(f"  {valor}: {count} casos")
            
            if 'NF_ENTRADA_PROPRIA' in df.columns:
                nf_count = df['NF_ENTRADA_PROPRIA'].value_counts()
                print(f"\nNF_ENTRADA_PROPRIA:")
                for valor, count in nf_count.items():
                    print(f"  {valor}: {count} casos")
            
            return df
        else:
            print("\n[INFO] Nenhuma transferencia com romaneios iguais encontrada no historico completo")
            return pd.DataFrame()
    except Exception as e:
        print(f"\n[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def main():
    """Função principal"""
    print("="*100)
    print("INVESTIGACAO DE CASOS ESPECIAIS DE ROMANEIOS")
    print("="*100)
    print("\nEste script investiga casos especiais onde o romaneio pode ser o mesmo.\n")
    
    conn = conectar_banco()
    if not conn:
        print("\n[ERRO] Nao foi possivel conectar ao banco")
        return
    
    try:
        # Investigar casos especiais
        df_mov_interna = investigar_mov_interna(conn)
        df_acerto = investigar_acerto_entrada(conn)
        df_nf_propria = investigar_nf_entrada_propria(conn)
        df_todos_iguais = investigar_todos_casos_iguais(conn)
        
        # Resumo final
        print("\n" + "="*100)
        print("RESUMO FINAL")
        print("="*100)
        print(f"\nMOV_INTERNA = 1: {len(df_mov_interna)} casos")
        print(f"ACERTO_ENTRADA = 1: {len(df_acerto)} casos")
        print(f"NF_ENTRADA_PROPRIA = 1: {len(df_nf_propria)} casos")
        print(f"ROMANEIOS IGUAIS (historico): {len(df_todos_iguais)} casos")
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

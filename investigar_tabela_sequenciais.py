#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar a tabela SEQUENCIAIS
Esta tabela parece controlar a numeração de romaneios
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
            print(f"Conectando ao banco ({nome}: {servidor})...")
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};"
                       f"DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};"
                       f"PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"[OK] Conectado ao servidor {nome}")
            return conn
        except Exception as e:
            print(f"[ERRO] Erro conexao com {nome}: {e}")
            if nome == 'principal':
                print("Tentando servidor fallback...")
            continue
    
    return None

def investigar_estrutura_sequenciais(conn):
    """Investiga estrutura da tabela SEQUENCIAIS"""
    print("\n" + "="*80)
    print("1. ESTRUTURA DA TABELA SEQUENCIAIS")
    print("="*80)
    
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'SEQUENCIAIS'
        ORDER BY ORDINAL_POSITION
    """
    
    try:
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
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar estrutura: {e}")
        return pd.DataFrame()

def investigar_dados_sequenciais(conn):
    """Investiga dados da tabela SEQUENCIAIS"""
    print("\n" + "="*80)
    print("2. DADOS DA TABELA SEQUENCIAIS")
    print("="*80)
    
    query = """
        SELECT TOP 100
            *
        FROM SEQUENCIAIS WITH (NOLOCK)
        ORDER BY TABELA_COLUNA
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n[OK] Encontrados {len(df)} registros:")
            print("\n" + df.to_string())
            
            # Procurar por romaneios
            print("\n" + "="*80)
            print("3. REGISTROS RELACIONADOS A ROMANEIOS")
            print("="*80)
            
            query_romaneio = """
                SELECT *
                FROM SEQUENCIAIS WITH (NOLOCK)
                WHERE TABELA_COLUNA LIKE '%ROMANEIO%'
                   OR DESCRICAO LIKE '%ROMANEIO%'
                   OR DESCRICAO LIKE '%ENTRADA%'
                   OR DESCRICAO LIKE '%SAIDA%'
                ORDER BY TABELA_COLUNA
            """
            
            df_romaneio = pd.read_sql(query_romaneio, conn)
            if len(df_romaneio) > 0:
                print(f"\n[OK] Encontrados {len(df_romaneio)} registros relacionados a romaneios:")
                print("\n" + df_romaneio.to_string())
            else:
                print("\n[INFO] Nenhum registro encontrado com 'ROMANEIO' no nome")
        else:
            print("\n[INFO] Tabela SEQUENCIAIS vazia ou sem acesso")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar dados: {e}")

def verificar_se_romaneio_e_identity(conn):
    """Verifica se ROMANEIO_PRODUTO é identity nas tabelas"""
    print("\n" + "="*80)
    print("4. VERIFICANDO SE ROMANEIO_PRODUTO E IDENTITY")
    print("="*80)
    
    tabelas = ['ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI']
    
    for tabela in tabelas:
        query = f"""
            SELECT 
                c.name AS COLUMN_NAME,
                c.is_identity,
                TYPE_NAME(c.system_type_id) AS DATA_TYPE
            FROM sys.columns c
            INNER JOIN sys.tables t ON c.object_id = t.object_id
            WHERE t.name = '{tabela}'
                AND c.name = 'ROMANEIO_PRODUTO'
        """
        
        try:
            df = pd.read_sql(query, conn)
            if len(df) > 0:
                is_identity = df.iloc[0]['is_identity']
                print(f"\n{tabela}.ROMANEIO_PRODUTO:")
                if is_identity:
                    print(f"  [SIM] E IDENTITY (gerado automaticamente pelo banco)")
                else:
                    print(f"  [NAO] NAO e IDENTITY (precisa ser informado manualmente)")
            else:
                print(f"\n{tabela}: Coluna ROMANEIO_PRODUTO nao encontrada")
        except Exception as e:
            print(f"\n[ERRO] {tabela}: Erro ao verificar: {e}")

def main():
    """Função principal"""
    print("="*80)
    print("INVESTIGACAO: TABELA SEQUENCIAIS E GERACAO DE ROMANEIOS")
    print("="*80)
    
    conn = conectar_banco()
    if not conn:
        print("\n[ERRO] Nao foi possivel conectar ao banco")
        return
    
    try:
        investigar_estrutura_sequenciais(conn)
        investigar_dados_sequenciais(conn)
        verificar_se_romaneio_e_identity(conn)
        
        print("\n" + "="*80)
        print("INVESTIGACAO CONCLUIDA!")
        print("="*80)
        print("\nCONCLUSAO:")
        print("  Se ROMANEIO_PRODUTO NAO for IDENTITY, entao precisa ser gerado")
        print("  manualmente. A tabela SEQUENCIAIS pode ser usada para controlar")
        print("  a numeracao sequencial.")
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

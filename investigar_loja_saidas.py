#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar a tabela LOJA_SAIDAS e entender o que a stored procedure espera
"""

import sys
import codecs
import pyodbc
import pandas as pd

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

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
            else:
                print(f"[OK] Conectado ao servidor principal ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"[ERRO] Erro conexao com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("Tentando servidor fallback...")
            continue
    
    print(f"[ERRO] Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    return None

def investigar_loja_saidas(conn):
    """Investiga a tabela LOJA_SAIDAS"""
    print("\n" + "="*80)
    print("INVESTIGANDO TABELA LOJA_SAIDAS")
    print("="*80)
    
    # Verificar se a tabela existe
    query_existe = """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_NAME = 'LOJA_SAIDAS'
    """
    
    try:
        df = pd.read_sql(query_existe, conn)
        if df.empty:
            print("\n[INFO] Tabela LOJA_SAIDAS nao encontrada")
            return
        print("\n[OK] Tabela LOJA_SAIDAS encontrada")
    except Exception as e:
        print(f"\n[ERRO] Erro ao verificar tabela: {e}")
        return
    
    # Verificar estrutura
    query_estrutura = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'LOJA_SAIDAS'
        ORDER BY ORDINAL_POSITION
    """
    
    try:
        df = pd.read_sql(query_estrutura, conn)
        if not df.empty:
            print("\n[OK] Estrutura da tabela LOJA_SAIDAS:")
            print(df.to_string())
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar estrutura: {e}")
    
    # Buscar exemplos de registros
    query_exemplos = """
        SELECT TOP 5 *
        FROM LOJA_SAIDAS WITH (NOLOCK)
        ORDER BY DATA_SAIDA DESC
    """
    
    try:
        df = pd.read_sql(query_exemplos, conn)
        if not df.empty:
            print("\n[OK] Exemplos de registros em LOJA_SAIDAS:")
            print(df.to_string())
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar exemplos: {e}")

def investigar_relacao_romaneio_loja_saidas(conn):
    """Investiga relação entre romaneio e LOJA_SAIDAS"""
    print("\n" + "="*80)
    print("INVESTIGANDO RELACAO ROMANEIO E LOJA_SAIDAS")
    print("="*80)
    
    # Buscar exemplos onde há romaneio em ESTOQUE_PROD_SAI e verificar LOJA_SAIDAS
    query = """
        SELECT TOP 5
            s.ROMANEIO_PRODUTO,
            s.FILIAL,
            s.EMISSAO,
            ls.*
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        LEFT JOIN LOJA_SAIDAS ls WITH (NOLOCK) 
            ON ls.ROMANEIO = s.ROMANEIO_PRODUTO 
            AND ls.FILIAL = s.FILIAL
        WHERE s.EMISSAO >= DATEADD(DAY, -30, GETDATE())
        ORDER BY s.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print("\n[OK] Exemplos de relacao ROMANEIO e LOJA_SAIDAS:")
            print(df.to_string())
        else:
            print("\n[INFO] Nenhum registro encontrado")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar relacao: {e}")

def investigar_campos_exclusao(conn):
    """Investiga campos relacionados a exclusão"""
    print("\n" + "="*80)
    print("INVESTIGANDO CAMPOS DE EXCLUSAO")
    print("="*80)
    
    # Buscar campos que contenham "EXCLU" no nome
    query = """
        SELECT 
            TABLE_NAME,
            COLUMN_NAME,
            DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE COLUMN_NAME LIKE '%EXCLU%'
            AND TABLE_NAME IN ('LOJA_SAIDAS', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI')
        ORDER BY TABLE_NAME, COLUMN_NAME
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print("\n[OK] Campos relacionados a exclusao:")
            print(df.to_string())
        else:
            print("\n[INFO] Nenhum campo de exclusao encontrado")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar campos: {e}")

def main():
    """Função principal"""
    print("="*80)
    print("INVESTIGACAO: LOJA_SAIDAS E EXCLUSAO")
    print("="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        if not conn:
            return
        
        investigar_loja_saidas(conn)
        investigar_relacao_romaneio_loja_saidas(conn)
        investigar_campos_exclusao(conn)
        
        print("\n" + "="*80)
        print("INVESTIGACAO CONCLUIDA!")
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

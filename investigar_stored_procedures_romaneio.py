#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar stored procedures do LINX que podem gerar romaneios
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
                print(f"✓ Conectado via servidor fallback ({servidor})")
            else:
                print(f"✓ Conectado ao servidor principal ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexao com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    return None

def investigar_stored_procedures_transferencia(conn):
    """Investiga stored procedures específicas de transferência"""
    print("\n" + "="*80)
    print("INVESTIGANDO STORED PROCEDURES DE TRANSFERÊNCIA")
    print("="*80)
    
    procedures = [
        'LX_GERA_ROMANEIO_ENTRADA_INTEGRACAO',
        'LX_GERA_ROMANEIOS_RESERVAS',
        'LX_GERA_TRANSFERENCIA_AUTOMATICA',
        'LX_GERA_TRANSFERENCIA_FILIAL_QUALIDADE_B2C',
        'LX_GERA_ROMANEIO',
        'LX_GERA_ROMANEIO_ENTRADA',
        'LX_GERA_ROMANEIO_SAIDA',
        'LX_TRANSFERENCIA',
        'LX_CRIA_TRANSFERENCIA'
    ]
    
    for proc_name in procedures:
        query = """
            SELECT 
                name AS PROCEDURE_NAME,
                OBJECT_DEFINITION(object_id) AS PROCEDURE_DEFINITION
            FROM sys.procedures
            WHERE name = ?
        """
        
        try:
            cursor = conn.cursor()
            cursor.execute(query, [proc_name])
            row = cursor.fetchone()
            cursor.close()
            
            if row:
                print(f"\n[ENCONTRADA] {proc_name}")
                definicao = str(row[1])
                if len(definicao) > 2000:
                    print(f"  Definição (primeiros 2000 chars):")
                    print(f"  {definicao[:2000]}...")
                else:
                    print(f"  Definição completa:")
                    print(f"  {definicao}")
                
                # Tentar extrair parâmetros
                query_params = """
                    SELECT 
                        p.name AS PARAMETER_NAME,
                        t.name AS PARAMETER_TYPE,
                        p.max_length,
                        p.is_output
                    FROM sys.parameters p
                    INNER JOIN sys.types t ON p.user_type_id = t.user_type_id
                    WHERE p.object_id = OBJECT_ID(?)
                    ORDER BY p.parameter_id
                """
                try:
                    cursor = conn.cursor()
                    cursor.execute(query_params, [proc_name])
                    params = cursor.fetchall()
                    cursor.close()
                    
                    if params:
                        print(f"  Parâmetros:")
                        for param in params:
                            output = "OUTPUT" if param[3] else "INPUT"
                            print(f"    - {param[0]} ({param[1]}) [{output}]")
                except:
                    pass
            else:
                print(f"\n✗ NÃO ENCONTRADA: {proc_name}")
        except Exception as e:
            print(f"\n[ERRO] ao buscar {proc_name}: {e}")

def investigar_todas_procedures_romaneio(conn):
    """Busca todas as procedures relacionadas a romaneio"""
    print("\n" + "="*80)
    print("BUSCANDO TODAS AS PROCEDURES RELACIONADAS A ROMANEIO")
    print("="*80)
    
    query = """
        SELECT 
            name AS PROCEDURE_NAME
        FROM sys.procedures
        WHERE name LIKE '%ROMANEIO%'
           OR name LIKE '%TRANSFERENCIA%'
           OR name LIKE '%ESTOQUE%ENT%'
           OR name LIKE '%ESTOQUE%SAI%'
        ORDER BY name
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n✓ Encontradas {len(df)} procedures relacionadas:")
            for idx, row in df.iterrows():
                print(f"  - {row['PROCEDURE_NAME']}")
        else:
            print("\n✗ Nenhuma procedure encontrada")
    except Exception as e:
        print(f"\n[ERRO] ao buscar procedures: {e}")

def main():
    """Função principal"""
    print("="*80)
    print("INVESTIGAÇÃO: STORED PROCEDURES PARA GERAR ROMANEIOS")
    print("="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        if not conn:
            return
        
        investigar_stored_procedures_transferencia(conn)
        investigar_todas_procedures_romaneio(conn)
        
        print("\n" + "="*80)
        print("INVESTIGAÇÃO CONCLUÍDA!")
        print("="*80)
        
    except Exception as e:
        print(f"\n[ERRO] durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

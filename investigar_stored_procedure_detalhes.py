#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar detalhes da stored procedure LX_GERA_TRANSFERENCIA_AUTOMATICA
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

def investigar_stored_procedure_completa(conn):
    """Investiga a stored procedure completa"""
    print("\n" + "="*80)
    print("INVESTIGANDO STORED PROCEDURE COMPLETA")
    print("="*80)
    
    query = """
        SELECT OBJECT_DEFINITION(OBJECT_ID('LX_GERA_TRANSFERENCIA_AUTOMATICA')) AS DEFINICAO
    """
    
    try:
        cursor = conn.cursor()
        cursor.execute(query)
        row = cursor.fetchone()
        cursor.close()
        
        if row and row[0]:
            definicao = str(row[0])
            # Procurar por "EXCLUIDA" ou "EXCLUSAO" na definição
            if 'EXCLUIDA' in definicao.upper() or 'EXCLUSAO' in definicao.upper():
                print("\n[OK] Encontrada referencia a EXCLUSAO/EXCLUIDA na stored procedure")
                # Buscar linhas relevantes
                linhas = definicao.split('\n')
                for i, linha in enumerate(linhas):
                    if 'EXCLUIDA' in linha.upper() or 'EXCLUSAO' in linha.upper() or 'LOJA_SAIDAS' in linha.upper():
                        # Mostrar contexto (5 linhas antes e depois)
                        inicio = max(0, i - 5)
                        fim = min(len(linhas), i + 6)
                        print(f"\n  Linha {i+1} (contexto):")
                        for j in range(inicio, fim):
                            marcador = ">>> " if j == i else "    "
                            print(f"{marcador}{j+1:4d}: {linhas[j]}")
        else:
            print("\n[INFO] Nao foi possivel obter definicao completa")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar definicao: {e}")

def investigar_exemplos_loja_saidas(conn):
    """Investiga exemplos de LOJA_SAIDAS"""
    print("\n" + "="*80)
    print("INVESTIGANDO EXEMPLOS DE LOJA_SAIDAS")
    print("="*80)
    
    # Buscar exemplos recentes
    query = """
        SELECT TOP 5
            ROMANEIO_PRODUTO,
            FILIAL,
            EMISSAO,
            FILIAL_DESTINO,
            SAIDA_CANCELADA,
            SAIDA_ENCERRADA,
            STATUS_TRANSITO,
            SERIE_NF
        FROM LOJA_SAIDAS WITH (NOLOCK)
        WHERE EMISSAO >= DATEADD(DAY, -30, GETDATE())
        ORDER BY EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print("\n[OK] Exemplos recentes de LOJA_SAIDAS:")
            print(df.to_string())
        else:
            print("\n[INFO] Nenhum registro encontrado")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar exemplos: {e}")

def investigar_relacao_estoque_loja_saidas(conn):
    """Investiga relação entre ESTOQUE_PROD_SAI e LOJA_SAIDAS"""
    print("\n" + "="*80)
    print("INVESTIGANDO RELACAO ESTOQUE_PROD_SAI E LOJA_SAIDAS")
    print("="*80)
    
    # Buscar exemplos onde há romaneio em ESTOQUE_PROD_SAI e verificar LOJA_SAIDAS
    query = """
        SELECT TOP 5
            s.ROMANEIO_PRODUTO,
            s.FILIAL,
            s.EMISSAO,
            s.FILIAL_DESTINO,
            ls.ROMANEIO_PRODUTO AS LS_ROMANEIO,
            ls.SAIDA_CANCELADA,
            ls.SAIDA_ENCERRADA,
            ls.STATUS_TRANSITO
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        LEFT JOIN LOJA_SAIDAS ls WITH (NOLOCK) 
            ON ls.ROMANEIO_PRODUTO = s.ROMANEIO_PRODUTO 
            AND ls.FILIAL = s.FILIAL
        WHERE s.EMISSAO >= DATEADD(DAY, -30, GETDATE())
            AND s.FILIAL_DESTINO IS NOT NULL
        ORDER BY s.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print("\n[OK] Exemplos de relacao ESTOQUE_PROD_SAI e LOJA_SAIDAS:")
            print(df.to_string())
            
            # Verificar quantos têm LOJA_SAIDAS
            com_loja_saidas = df[df['LS_ROMANEIO'].notna()]
            print(f"\n[INFO] Total: {len(df)} | Com LOJA_SAIDAS: {len(com_loja_saidas)} | Sem LOJA_SAIDAS: {len(df) - len(com_loja_saidas)}")
        else:
            print("\n[INFO] Nenhum registro encontrado")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar relacao: {e}")

def main():
    """Função principal"""
    print("="*80)
    print("INVESTIGACAO: STORED PROCEDURE E LOJA_SAIDAS")
    print("="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        if not conn:
            return
        
        investigar_stored_procedure_completa(conn)
        investigar_exemplos_loja_saidas(conn)
        investigar_relacao_estoque_loja_saidas(conn)
        
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

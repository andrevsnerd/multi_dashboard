#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para testar a stored procedure diretamente e ver o que acontece
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
            ultimo_erro = e
            if nome == 'principal':
                continue
    
    print(f"[ERRO] Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    return None

def verificar_antes(conn, romaneio_saida, filial_origem, filial_destino):
    """Verifica estado antes da stored procedure"""
    print("\n" + "="*80)
    print("ESTADO ANTES DA STORED PROCEDURE")
    print("="*80)
    
    # Verificar LOJA_SAIDAS
    query = """
        SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_DESTINO, SAIDA_CANCELADA, SAIDA_ENCERRADA
        FROM LOJA_SAIDAS
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida, filial_origem])
    if not df.empty:
        print(f"\n✓ LOJA_SAIDAS encontrada:")
        print(df.to_string())
    else:
        print(f"\n✗ LOJA_SAIDAS não encontrada")
    
    # Verificar LOJA_SAIDAS_PRODUTO
    query = """
        SELECT ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, QTDE_SAIDA
        FROM LOJA_SAIDAS_PRODUTO
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida, filial_origem])
    if not df.empty:
        print(f"\n✓ LOJA_SAIDAS_PRODUTO encontrada:")
        print(df.to_string())
    else:
        print(f"\n✗ LOJA_SAIDAS_PRODUTO não encontrada")

def testar_stored_procedure(conn, filial, romaneio, filial_destino, serie_nf='001', origem='S', exclusao='N'):
    """Testa a stored procedure"""
    print("\n" + "="*80)
    print("EXECUTANDO STORED PROCEDURE")
    print("="*80)
    print(f"Parâmetros:")
    print(f"  @FILIAL = '{filial}'")
    print(f"  @ROMANEIO_PRODUTO = '{romaneio}'")
    print(f"  @FILIAL_DESTINO = '{filial_destino}'")
    print(f"  @SERIE_NF = '{serie_nf}'")
    print(f"  @ORIGEM = '{origem}'")
    print(f"  @EXCLUSAO = '{exclusao}'")
    
    cursor = conn.cursor()
    
    try:
        query = """
            EXEC LX_GERA_TRANSFERENCIA_AUTOMATICA 
                @FILIAL = ?,
                @ROMANEIO_PRODUTO = ?,
                @FILIAL_DESTINO = ?,
                @SERIE_NF = ?,
                @ORIGEM = ?,
                @EXCLUSAO = ?
        """
        
        cursor.execute(query, [filial, romaneio, filial_destino, serie_nf, origem, exclusao])
        
        # Tentar capturar mensagens
        try:
            while cursor.nextset():
                pass
        except:
            pass
        
        print("\n✓ Stored procedure executada sem exceção")
        
        # Verificar se há mensagens de erro
        query_mensagens = """
            SELECT TOP 10 *
            FROM sys.messages
            WHERE message_id IN (30002, 50000)
            ORDER BY message_id
        """
        # Não vamos buscar isso, mas podemos verificar resultados
        
    except Exception as e:
        print(f"\n✗ Erro ao executar stored procedure: {e}")
        raise
    finally:
        cursor.close()

def verificar_depois(conn, romaneio_saida, filial_origem, filial_destino):
    """Verifica estado depois da stored procedure"""
    print("\n" + "="*80)
    print("ESTADO DEPOIS DA STORED PROCEDURE")
    print("="*80)
    
    # Verificar LOJA_ENTRADAS
    query = """
        SELECT TOP 5 ROMANEIO_PRODUTO, FILIAL, FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, EMISSAO
        FROM LOJA_ENTRADAS
        WHERE FILIAL = ? 
            AND FILIAL_ORIGEM = ?
            AND EMISSAO >= DATEADD(MINUTE, -5, GETDATE())
        ORDER BY EMISSAO DESC
    """
    df = pd.read_sql(query, conn, params=[filial_destino, filial_origem])
    if not df.empty:
        print(f"\n✓ LOJA_ENTRADAS encontrada(s):")
        print(df.to_string())
    else:
        print(f"\n✗ LOJA_ENTRADAS não encontrada")
    
    # Verificar ESTOQUE_PROD_ENT
    query = """
        SELECT TOP 5 ROMANEIO_PRODUTO, FILIAL, FILIAL_ORIGEM, ROMANEIO_ORIGEM, EMISSAO
        FROM ESTOQUE_PROD_ENT
        WHERE FILIAL = ? 
            AND (FILIAL_ORIGEM = ? OR ROMANEIO_ORIGEM = ?)
            AND EMISSAO >= DATEADD(MINUTE, -5, GETDATE())
        ORDER BY EMISSAO DESC
    """
    df = pd.read_sql(query, conn, params=[filial_destino, filial_origem, romaneio_saida])
    if not df.empty:
        print(f"\n✓ ESTOQUE_PROD_ENT encontrada(s):")
        print(df.to_string())
    else:
        print(f"\n✗ ESTOQUE_PROD_ENT não encontrada")
    
    # Verificar se ROMANEIO_DESTINO foi atualizado na saída
    query = """
        SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_DESTINO, ROMANEIO_DESTINO
        FROM ESTOQUE_PROD_SAI
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida, filial_origem])
    if not df.empty:
        print(f"\n✓ ESTOQUE_PROD_SAI (verificando ROMANEIO_DESTINO):")
        print(df.to_string())
        if df.iloc[0]['ROMANEIO_DESTINO']:
            print(f"   ✓ ROMANEIO_DESTINO foi atualizado: {df.iloc[0]['ROMANEIO_DESTINO']}")
        else:
            print(f"   ✗ ROMANEIO_DESTINO não foi atualizado")

def main():
    """Função principal"""
    print("="*80)
    print("TESTE DIRETO DA STORED PROCEDURE")
    print("="*80)
    
    # Usar os mesmos valores do teste anterior
    filial_origem = 'NERD VILLA LOBOS'
    filial_destino = 'NERD LEBLON'
    romaneio_saida = '028964'
    
    conn = None
    try:
        conn = conectar_banco()
        if not conn:
            return
        
        verificar_antes(conn, romaneio_saida, filial_origem, filial_destino)
        
        # Executar stored procedure dentro de transação para poder fazer rollback
        cursor = conn.cursor()
        try:
            cursor.execute("BEGIN TRANSACTION")
            testar_stored_procedure(conn, filial_origem, romaneio_saida, filial_destino)
            verificar_depois(conn, romaneio_saida, filial_origem, filial_destino)
            
            # Fazer rollback para não alterar nada
            cursor.execute("ROLLBACK TRANSACTION")
            print("\n" + "="*80)
            print("ROLLBACK EXECUTADO - Nenhuma alteração foi feita")
            print("="*80)
        finally:
            cursor.close()
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante teste: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            try:
                conn.rollback()
            except:
                pass
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

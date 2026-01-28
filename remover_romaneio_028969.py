#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para remover o romaneio 028969 duplicado
"""

import sys
import codecs
import pyodbc

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

def remover_romaneio(conn, romaneio: str):
    """Remove o romaneio de todas as tabelas"""
    cursor = conn.cursor()
    conn.autocommit = False
    
    try:
        print(f"\n🔍 Removendo romaneio {romaneio}...")
        
        # 1. Remover itens de saída (ESTOQUE_PROD1_SAI)
        print(f"   1. Removendo itens de ESTOQUE_PROD1_SAI...")
        query1 = "DELETE FROM ESTOQUE_PROD1_SAI WHERE ROMANEIO_PRODUTO = ?"
        cursor.execute(query1, [romaneio])
        count1 = cursor.rowcount
        print(f"      ✓ {count1} registro(s) removido(s)")
        
        # 2. Remover cabeçalho de saída (ESTOQUE_PROD_SAI)
        print(f"   2. Removendo cabeçalho de ESTOQUE_PROD_SAI...")
        query2 = "DELETE FROM ESTOQUE_PROD_SAI WHERE ROMANEIO_PRODUTO = ?"
        cursor.execute(query2, [romaneio])
        count2 = cursor.rowcount
        print(f"      ✓ {count2} registro(s) removido(s)")
        
        # 3. Remover itens de LOJA_SAIDAS_PRODUTO
        print(f"   3. Removendo itens de LOJA_SAIDAS_PRODUTO...")
        query3 = "DELETE FROM LOJA_SAIDAS_PRODUTO WHERE ROMANEIO_PRODUTO = ?"
        cursor.execute(query3, [romaneio])
        count3 = cursor.rowcount
        print(f"      ✓ {count3} registro(s) removido(s)")
        
        # 4. Remover cabeçalho de LOJA_SAIDAS
        print(f"   4. Removendo cabeçalho de LOJA_SAIDAS...")
        query4 = "DELETE FROM LOJA_SAIDAS WHERE ROMANEIO_PRODUTO = ?"
        cursor.execute(query4, [romaneio])
        count4 = cursor.rowcount
        print(f"      ✓ {count4} registro(s) removido(s)")
        
        # Commit todas as alterações
        conn.commit()
        print(f"\n✅ Romaneio {romaneio} removido com sucesso!")
        print(f"   Total removido: {count1 + count2 + count3 + count4} registro(s)")
        
    except Exception as e:
        conn.rollback()
        print(f"\n❌ Erro ao remover romaneio: {e}")
        raise
    finally:
        cursor.close()

def main():
    romaneio = '028969'
    
    print("=" * 100)
    print("REMOVER ROMANEIO DUPLICADO")
    print("=" * 100)
    print(f"\n⚠️  ATENÇÃO: Removendo o romaneio {romaneio} de todas as tabelas!")
    print(f"   - ESTOQUE_PROD1_SAI")
    print(f"   - ESTOQUE_PROD_SAI")
    print(f"   - LOJA_SAIDAS_PRODUTO")
    print(f"   - LOJA_SAIDAS")
    
    conn = conectar_banco()
    if not conn:
        print("❌ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        remover_romaneio(conn, romaneio)
    except Exception as e:
        print(f"\n❌ Erro: {e}")
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")

if __name__ == "__main__":
    main()

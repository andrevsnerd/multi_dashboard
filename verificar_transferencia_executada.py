#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para verificar o que aconteceu na transferência executada
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

def verificar_transferencia(conn, romaneio_saida='028964'):
    """Verifica o que aconteceu na transferência"""
    print("="*80)
    print(f"VERIFICANDO TRANSFERENCIA - ROMANEIO SAIDA: {romaneio_saida}")
    print("="*80)
    
    # 1. Verificar ESTOQUE_PROD_SAI
    print("\n1. VERIFICANDO ESTOQUE_PROD_SAI:")
    query = """
        SELECT *
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida])
    if not df.empty:
        print(f"   ✓ Encontrado {len(df)} registro(s)")
        print(f"   Filial: {df.iloc[0]['FILIAL']}")
        print(f"   Filial Destino: {df.iloc[0]['FILIAL_DESTINO']}")
        print(f"   Romaneio Destino: {df.iloc[0]['ROMANEIO_DESTINO']}")
        print(f"   Emissão: {df.iloc[0]['EMISSAO']}")
    else:
        print("   ✗ Nenhum registro encontrado")
    
    # 2. Verificar ESTOQUE_PROD1_SAI
    print("\n2. VERIFICANDO ESTOQUE_PROD1_SAI:")
    query = """
        SELECT *
        FROM ESTOQUE_PROD1_SAI WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida])
    if not df.empty:
        print(f"   ✓ Encontrado {len(df)} registro(s)")
        for idx, row in df.iterrows():
            print(f"   Produto: {row['PRODUTO']} | Cor: {row['COR_PRODUTO']} | Qtde: {row['QTDE']}")
    else:
        print("   ✗ Nenhum registro encontrado")
    
    # 3. Verificar LOJA_SAIDAS
    print("\n3. VERIFICANDO LOJA_SAIDAS:")
    query = """
        SELECT *
        FROM LOJA_SAIDAS WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida])
    if not df.empty:
        print(f"   ✓ Encontrado {len(df)} registro(s)")
        print(f"   Filial: {df.iloc[0]['FILIAL']}")
        print(f"   Filial Destino: {df.iloc[0]['FILIAL_DESTINO']}")
        print(f"   SAIDA_CANCELADA: {df.iloc[0]['SAIDA_CANCELADA']}")
        print(f"   SAIDA_ENCERRADA: {df.iloc[0]['SAIDA_ENCERRADA']}")
        print(f"   QTDE_TOTAL: {df.iloc[0]['QTDE_TOTAL']}")
    else:
        print("   ✗ Nenhum registro encontrado")
    
    # 4. Verificar LOJA_SAIDAS_PRODUTO
    print("\n4. VERIFICANDO LOJA_SAIDAS_PRODUTO:")
    query = """
        SELECT *
        FROM LOJA_SAIDAS_PRODUTO WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida])
    if not df.empty:
        print(f"   ✓ Encontrado {len(df)} registro(s)")
        for idx, row in df.iterrows():
            print(f"   Produto: {row['PRODUTO']} | Cor: {row['COR_PRODUTO']} | Qtde: {row['QTDE_SAIDA']}")
    else:
        print("   ✗ Nenhum registro encontrado")
    
    # 5. Verificar ESTOQUE_PROD_ENT (entrada gerada)
    romaneio_entrada_previsto = f"T{romaneio_saida}"
    print(f"\n5. VERIFICANDO ESTOQUE_PROD_ENT (romaneio: {romaneio_entrada_previsto} ou relacionado):")
    query = """
        SELECT *
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ROMANEIO_ORIGEM = ?
           OR ROMANEIO_PRODUTO LIKE ?
        ORDER BY EMISSAO DESC
    """
    df = pd.read_sql(query, conn, params=[romaneio_saida, f"%{romaneio_saida}%"])
    if not df.empty:
        print(f"   ✓ Encontrado {len(df)} registro(s)")
        for idx, row in df.iterrows():
            print(f"   Romaneio: {row['ROMANEIO_PRODUTO']} | Filial: {row['FILIAL']} | Origem: {row['ROMANEIO_ORIGEM']} | Emissão: {row['EMISSAO']}")
    else:
        print("   ✗ Nenhum registro encontrado")
    
    # 6. Verificar ESTOQUE_PROD1_ENT
    print(f"\n6. VERIFICANDO ESTOQUE_PROD1_ENT:")
    if not df.empty:
        for idx, row_ent in df.iterrows():
            romaneio_ent = row_ent['ROMANEIO_PRODUTO']
            query = """
                SELECT *
                FROM ESTOQUE_PROD1_ENT WITH (NOLOCK)
                WHERE ROMANEIO_PRODUTO = ?
            """
            df_item = pd.read_sql(query, conn, params=[romaneio_ent])
            if not df_item.empty:
                print(f"   ✓ Romaneio {romaneio_ent}: {len(df_item)} item(s)")
                for idx_item, row_item in df_item.iterrows():
                    print(f"      Produto: {row_item['PRODUTO']} | Cor: {row_item['COR_PRODUTO']} | Qtde: {row_item['QTDE']}")
    
    # 7. Verificar estoque atual do produto
    print("\n7. VERIFICANDO ESTOQUE_PRODUTOS ATUAL:")
    query = """
        SELECT *
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = 'N4.A5.0012'
            AND FILIAL IN ('NERD VILLA LOBOS', 'NERD LEBLON')
            AND ISNULL(COR_PRODUTO, '') = 'K9'
    """
    df_estoque = pd.read_sql(query, conn)
    if not df_estoque.empty:
        print(f"   ✓ Encontrado {len(df_estoque)} registro(s)")
        for idx, row in df_estoque.iterrows():
            print(f"   Filial: {row['FILIAL']} | Cor: {row['COR_PRODUTO']} | Estoque: {row['ESTOQUE']}")
    else:
        print("   ✗ Nenhum registro encontrado")
    
    # 8. Verificar LOJA_ENTRADAS (se foi criado)
    print(f"\n8. VERIFICANDO LOJA_ENTRADAS:")
    if not df.empty:
        for idx, row_ent in df.iterrows():
            romaneio_ent = row_ent['ROMANEIO_PRODUTO']
            query = """
                SELECT *
                FROM LOJA_ENTRADAS WITH (NOLOCK)
                WHERE ROMANEIO_PRODUTO = ?
            """
            df_ent = pd.read_sql(query, conn, params=[romaneio_ent])
            if not df_ent.empty:
                print(f"   ✓ Romaneio {romaneio_ent}: Encontrado")
                print(f"      Filial: {df_ent.iloc[0]['FILIAL']} | Origem: {df_ent.iloc[0]['FILIAL_ORIGEM']}")
                print(f"      ENTRADA_CONFERIDA: {df_ent.iloc[0].get('ENTRADA_CONFERIDA', 'N/A')}")
            else:
                print(f"   ✗ Romaneio {romaneio_ent}: Não encontrado em LOJA_ENTRADAS")

def main():
    """Função principal"""
    conn = None
    try:
        conn = conectar_banco()
        if not conn:
            return
        
        verificar_transferencia(conn, '028964')
        
        print("\n" + "="*80)
        print("VERIFICACAO CONCLUIDA!")
        print("="*80)
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante verificacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

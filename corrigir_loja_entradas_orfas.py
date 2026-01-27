#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para corrigir registros em LOJA_ENTRADAS que não têm correspondência em ESTOQUE_PROD_ENT
Cria os registros faltantes baseado nos dados de LOJA_ENTRADAS e LOJA_ENTRADAS_PRODUTO
"""

import sys
import codecs
import pyodbc
import pandas as pd
from datetime import datetime

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
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
    return None

def buscar_entradas_orfas(conn):
    """Busca registros em LOJA_ENTRADAS sem correspondência em ESTOQUE_PROD_ENT"""
    query = """
        SELECT DISTINCT
            le.ROMANEIO_PRODUTO,
            le.FILIAL,
            le.FILIAL_ORIGEM,
            le.EMISSAO,
            le.RESPONSAVEL
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        WHERE le.EMISSAO >= DATEADD(DAY, -7, GETDATE())
            AND NOT EXISTS (
                SELECT 1
                FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
                WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
                    AND e.FILIAL = le.FILIAL
            )
        ORDER BY le.EMISSAO DESC
    """
    
    df = pd.read_sql(query, conn)
    return df

def buscar_produtos_entrada(conn, romaneio, filial):
    """Busca produtos de uma entrada em LOJA_ENTRADAS_PRODUTO"""
    query = """
        SELECT 
            PRODUTO,
            COR_PRODUTO,
            QTDE_ENTRADA
        FROM LOJA_ENTRADAS_PRODUTO WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
            AND FILIAL = ?
    """
    
    cursor = conn.cursor()
    cursor.execute(query, [romaneio, filial])
    rows = cursor.fetchall()
    cursor.close()
    
    produtos = []
    for row in rows:
        produtos.append({
            'PRODUTO': row[0],
            'COR_PRODUTO': row[1] if row[1] else '',
            'QTDE_ENTRADA': row[2]
        })
    
    return produtos

def criar_registros_estoque_prod_ent(conn, entrada_info, produtos):
    """Cria registros em ESTOQUE_PROD_ENT e ESTOQUE_PROD1_ENT baseado em LOJA_ENTRADAS"""
    cursor = conn.cursor()
    
    try:
        # Criar cabeçalho em ESTOQUE_PROD_ENT
        query_cab = """
            INSERT INTO ESTOQUE_PROD_ENT (
                ROMANEIO_PRODUTO,
                FILIAL,
                EMISSAO,
                RESPONSAVEL,
                FILIAL_ORIGEM,
                ROMANEIO_ORIGEM,
                DATA_PARA_TRANSFERENCIA,
                DATA_DIGITACAO,
                SEGUNDA_QUALIDADE,
                ACERTO_ENTRADA,
                NAO_VALIDAR_ENTRADA,
                NF_ENTRADA_PROPRIA
            ) VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE(), 0, 0, 0, 0)
        """
        
        romaneio = str(entrada_info['ROMANEIO_PRODUTO']).strip()
        filial = str(entrada_info['FILIAL']).strip()
        filial_origem = str(entrada_info['FILIAL_ORIGEM']).strip() if entrada_info['FILIAL_ORIGEM'] else None
        emissao = entrada_info['EMISSAO']
        responsavel = str(entrada_info['RESPONSAVEL']).strip() if entrada_info['RESPONSAVEL'] else ' '
        
        # Buscar romaneio de origem se houver
        romaneio_origem = None
        if filial_origem:
            query_origem = """
                SELECT TOP 1 ROMANEIO_PRODUTO
                FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
                WHERE FILIAL = ? AND FILIAL_DESTINO = ? AND EMISSAO >= DATEADD(HOUR, -2, ?)
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_origem, [filial_origem, filial, emissao])
            row = cursor.fetchone()
            if row:
                romaneio_origem = str(row[0]).strip()
        
        cursor.execute(query_cab, [
            romaneio,
            filial,
            emissao,
            responsavel,
            filial_origem,
            romaneio_origem,
            emissao
        ])
        
        # Criar itens em ESTOQUE_PROD1_ENT
        for produto in produtos:
            query_item = """
                INSERT INTO ESTOQUE_PROD1_ENT (
                    ROMANEIO_PRODUTO,
                    PRODUTO,
                    FILIAL,
                    COR_PRODUTO,
                    QTDE
                ) VALUES (?, ?, ?, ?, ?)
            """
            
            cor_produto = produto['COR_PRODUTO'] if produto['COR_PRODUTO'] else ''
            
            cursor.execute(query_item, [
                romaneio,
                str(produto['PRODUTO']).strip(),
                filial,
                cor_produto,
                int(produto['QTDE_ENTRADA'])
            ])
        
        conn.commit()
        cursor.close()
        return True, f"Registros criados para romaneio {romaneio}"
        
    except Exception as e:
        conn.rollback()
        cursor.close()
        return False, f"Erro ao criar registros: {str(e)}"

def main():
    """Função principal"""
    print("="*100)
    print("CORREÇÃO DE REGISTROS ÓRFÃOS EM LOJA_ENTRADAS")
    print("="*100)
    print("\n⚠️  ATENÇÃO: Este script criará registros em ESTOQUE_PROD_ENT e ESTOQUE_PROD1_ENT")
    print("   para entradas que existem em LOJA_ENTRADAS mas não em ESTOQUE_PROD_ENT.")
    print("   Use apenas se tiver certeza de que esses registros devem existir.\n")
    
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Buscar entradas órfãs
        print("\n🔍 Buscando registros órfãos...")
        df_orfas = buscar_entradas_orfas(conn)
        
        if df_orfas.empty:
            print("✓ Nenhum registro órfão encontrado.")
            return
        
        print(f"\n📋 Encontrados {len(df_orfas)} registros órfãos:")
        print(df_orfas.to_string(index=False))
        
        # Confirmar correção
        print("\n" + "="*100)
        print("CONFIRMAÇÃO")
        print("="*100)
        print(f"\n⚠️  Você está prestes a criar {len(df_orfas)} registro(s) em ESTOQUE_PROD_ENT")
        print("   e seus respectivos itens em ESTOQUE_PROD1_ENT.")
        print("\n💡 Digite 'SIM' (em maiúsculas) para confirmar e executar")
        print("   Ou qualquer outra coisa para cancelar")
        
        confirmacao = input("\n❓ Confirmar correção: ").strip()
        
        if confirmacao != 'SIM':
            print("\n❌ OPERAÇÃO CANCELADA")
            return
        
        # Corrigir cada entrada
        print("\n" + "="*100)
        print("CORRIGINDO REGISTROS...")
        print("="*100)
        
        sucessos = 0
        erros = 0
        
        for idx, entrada in df_orfas.iterrows():
            romaneio = str(entrada['ROMANEIO_PRODUTO']).strip()
            filial = str(entrada['FILIAL']).strip()
            
            print(f"\n[{idx+1}/{len(df_orfas)}] Processando: {romaneio} - {filial}...")
            
            # Buscar produtos
            produtos = buscar_produtos_entrada(conn, romaneio, filial)
            
            if not produtos:
                print(f"   ⚠ Nenhum produto encontrado em LOJA_ENTRADAS_PRODUTO")
                erros += 1
                continue
            
            # Criar registros
            sucesso, mensagem = criar_registros_estoque_prod_ent(conn, entrada, produtos)
            
            if sucesso:
                print(f"   ✓ {mensagem}")
                sucessos += 1
            else:
                print(f"   ✗ {mensagem}")
                erros += 1
        
        # Resumo
        print("\n" + "="*100)
        print("RESUMO DA CORREÇÃO")
        print("="*100)
        print(f"\n✓ Registros corrigidos com sucesso: {sucessos}")
        if erros > 0:
            print(f"✗ Registros com erro: {erros}")
        
    except Exception as e:
        print(f"\n✗ Erro durante correção: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

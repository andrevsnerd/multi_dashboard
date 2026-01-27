#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar em detalhes os registros em LOJA_ENTRADAS sem correspondência em ESTOQUE_PROD_ENT
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
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
    return None

def investigar_registros_orfos(conn, produto_especifico=None):
    """Investiga registros órfãos em detalhes"""
    print("\n" + "="*100)
    print("INVESTIGAÇÃO DETALHADA DOS REGISTROS ÓRFÃOS")
    print("="*100)
    
    # Query base
    query_base = """
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
    """
    
    if produto_especifico:
        query_base += """
            AND EXISTS (
                SELECT 1
                FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
                    AND lep.FILIAL = le.FILIAL
                    AND lep.PRODUTO = ?
            )
        """
    
    query_base += " ORDER BY le.EMISSAO DESC"
    
    if produto_especifico:
        df_entradas = pd.read_sql(query_base, conn, params=[produto_especifico])
    else:
        df_entradas = pd.read_sql(query_base, conn)
    
    if df_entradas.empty:
        if produto_especifico:
            print(f"\n✓ Nenhum registro órfão encontrado para o produto {produto_especifico}")
        else:
            print("\n✓ Nenhum registro órfão encontrado")
        return
    
    print(f"\n📋 Encontrados {len(df_entradas)} registros órfãos:")
    print("-"*100)
    
    # Para cada entrada, buscar os produtos
    for idx, entrada in df_entradas.iterrows():
        romaneio = str(entrada['ROMANEIO_PRODUTO']).strip()
        filial = str(entrada['FILIAL']).strip()
        
        print(f"\n{'='*100}")
        print(f"REGISTRO {idx+1}/{len(df_entradas)}")
        print(f"{'='*100}")
        print(f"Romaneio: {romaneio}")
        print(f"Filial: {filial}")
        print(f"Filial Origem: {entrada['FILIAL_ORIGEM']}")
        print(f"Emissão: {entrada['EMISSAO']}")
        print(f"Responsável: {entrada['RESPONSAVEL']}")
        
        # Buscar produtos
        query_produtos = """
            SELECT 
                lep.PRODUTO,
                lep.COR_PRODUTO,
                lep.QTDE_ENTRADA,
                p.DESC_PRODUTO
            FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = lep.PRODUTO
            WHERE lep.ROMANEIO_PRODUTO = ?
                AND lep.FILIAL = ?
        """
        
        df_produtos = pd.read_sql(query_produtos, conn, params=[romaneio, filial])
        
        if not df_produtos.empty:
            print(f"\n📦 Produtos nesta entrada ({len(df_produtos)} item(s)):")
            print("-"*100)
            print(f"{'PRODUTO':<15} {'COR':<10} {'QTDE':<10} {'DESCRIÇÃO'}")
            print("-"*100)
            for _, prod in df_produtos.iterrows():
                produto = str(prod['PRODUTO']).strip()
                cor = str(prod['COR_PRODUTO']).strip() if prod['COR_PRODUTO'] else '(sem cor)'
                qtde = int(prod['QTDE_ENTRADA'])
                desc = str(prod['DESC_PRODUTO']).strip()[:50] if prod['DESC_PRODUTO'] else ''
                print(f"{produto:<15} {cor:<10} {qtde:<10} {desc}")
                
                # Verificar se é o produto específico
                if produto_especifico and produto == produto_especifico:
                    print(f"   ⚠ ESTE É O PRODUTO {produto_especifico}!")
        else:
            print("\n⚠ Nenhum produto encontrado em LOJA_ENTRADAS_PRODUTO")
        
        # Verificar se existe em ESTOQUE_PROD_SAI (para ver se é transferência)
        query_saida = """
            SELECT TOP 1
                ROMANEIO_PRODUTO,
                FILIAL,
                FILIAL_DESTINO,
                EMISSAO
            FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
            WHERE FILIAL_DESTINO = ?
                AND EMISSAO >= DATEADD(HOUR, -2, ?)
            ORDER BY EMISSAO DESC
        """
        
        df_saida = pd.read_sql(query_saida, conn, params=[entrada['FILIAL_ORIGEM'] if entrada['FILIAL_ORIGEM'] else filial, entrada['EMISSAO']])
        
        if not df_saida.empty:
            print(f"\n🔗 Possível saída relacionada encontrada:")
            print(f"   Romaneio Saída: {df_saida.iloc[0]['ROMANEIO_PRODUTO']}")
            print(f"   Filial Origem: {df_saida.iloc[0]['FILIAL']}")
            print(f"   Filial Destino: {df_saida.iloc[0]['FILIAL_DESTINO']}")
            print(f"   Emissão: {df_saida.iloc[0]['EMISSAO']}")

def main():
    """Função principal"""
    print("="*100)
    print("INVESTIGAÇÃO DETALHADA DE REGISTROS ÓRFÃOS")
    print("="*100)
    
    # Perguntar se quer filtrar por produto específico
    produto = input("\n💡 Digite o código do produto para filtrar (ou Enter para ver todos): ").strip()
    
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        if produto:
            print(f"\n🔍 Buscando registros órfãos para o produto: {produto}")
            investigar_registros_orfos(conn, produto_especifico=produto)
        else:
            print("\n🔍 Buscando todos os registros órfãos...")
            investigar_registros_orfos(conn)
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

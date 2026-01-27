#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para listar todos os registros órfãos e seus produtos
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
    
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
    return None

def main():
    """Função principal"""
    print("="*100)
    print("LISTAGEM DE REGISTROS ÓRFÃOS E SEUS PRODUTOS")
    print("="*100)
    
    conn = conectar_banco()
    if not conn:
        return
    
    try:
        # Buscar todos os registros órfãos com seus produtos
        query = """
            SELECT 
                le.ROMANEIO_PRODUTO,
                le.FILIAL,
                le.FILIAL_ORIGEM,
                le.EMISSAO,
                lep.PRODUTO,
                lep.COR_PRODUTO,
                lep.QTDE_ENTRADA,
                p.DESC_PRODUTO
            FROM LOJA_ENTRADAS le WITH (NOLOCK)
            INNER JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                ON lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
                AND lep.FILIAL = le.FILIAL
            LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = lep.PRODUTO
            WHERE le.EMISSAO >= DATEADD(DAY, -7, GETDATE())
                AND NOT EXISTS (
                    SELECT 1
                    FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
                    WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
                        AND e.FILIAL = le.FILIAL
                )
            ORDER BY le.EMISSAO DESC, le.ROMANEIO_PRODUTO, lep.PRODUTO
        """
        
        df = pd.read_sql(query, conn)
        
        if df.empty:
            print("\n✓ Nenhum registro órfão encontrado")
            return
        
        print(f"\n📋 Encontrados {len(df)} itens em {df['ROMANEIO_PRODUTO'].nunique()} romaneio(s) órfão(s):")
        print("="*100)
        
        # Agrupar por romaneio
        for romaneio in df['ROMANEIO_PRODUTO'].unique():
            df_romaneio = df[df['ROMANEIO_PRODUTO'] == romaneio]
            primeira_linha = df_romaneio.iloc[0]
            
            print(f"\n{'='*100}")
            print(f"ROMANEIO: {romaneio}")
            print(f"Filial: {primeira_linha['FILIAL']}")
            print(f"Filial Origem: {primeira_linha['FILIAL_ORIGEM']}")
            print(f"Emissão: {primeira_linha['EMISSAO']}")
            print(f"{'='*100}")
            print(f"{'PRODUTO':<20} {'COR':<15} {'QTDE':<10} {'DESCRIÇÃO'}")
            print("-"*100)
            
            for _, row in df_romaneio.iterrows():
                produto = str(row['PRODUTO']).strip()
                cor = str(row['COR_PRODUTO']).strip() if row['COR_PRODUTO'] else '(sem cor)'
                qtde = int(row['QTDE_ENTRADA'])
                desc = str(row['DESC_PRODUTO']).strip()[:60] if row['DESC_PRODUTO'] else ''
                print(f"{produto:<20} {cor:<15} {qtde:<10} {desc}")
        
        # Verificar se algum é do produto N4.A5.0012
        produto_buscado = 'N4.A5.0012'
        df_produto = df[df['PRODUTO'] == produto_buscado]
        
        if not df_produto.empty:
            print(f"\n{'='*100}")
            print(f"⚠️  ATENÇÃO: Encontrado produto {produto_buscado} em {len(df_produto)} registro(s) órfão(s)!")
            print(f"{'='*100}")
            for _, row in df_produto.iterrows():
                print(f"   Romaneio: {row['ROMANEIO_PRODUTO']}, Filial: {row['FILIAL']}, Qtde: {row['QTDE_ENTRADA']}")
        else:
            print(f"\n✓ O produto {produto_buscado} NÃO está nos registros órfãos")
        
    except Exception as e:
        print(f"\n✗ Erro: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

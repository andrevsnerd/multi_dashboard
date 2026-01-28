#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar o padrão de geração de romaneios no LINX
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
    """Conecta ao SQL Server"""
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
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
        except:
            continue
    return None

def investigar_padrao_romaneios_saida(conn):
    """Investiga padrão de romaneios de saída"""
    print("\n" + "="*100)
    print("PADRÃO DE ROMANEIOS DE SAÍDA (ESTOQUE_PROD_SAI)")
    print("="*100)
    
    query = """
        SELECT TOP 20
            ROMANEIO_PRODUTO,
            FILIAL,
            EMISSAO,
            FILIAL_DESTINO,
            LEN(ROMANEIO_PRODUTO) AS TAMANHO,
            CASE 
                WHEN ROMANEIO_PRODUTO LIKE '[0-9]%' THEN 'NUMERICO'
                WHEN ROMANEIO_PRODUTO LIKE '[A-Z]%' THEN 'ALFANUMERICO'
                ELSE 'OUTRO'
            END AS TIPO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE EMISSAO >= DATEADD(DAY, -7, GETDATE())
            AND FILIAL_DESTINO IS NOT NULL
        ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print(f"\n📊 Total de registros: {len(df)}")
            print("\n" + "-"*100)
            print(f"{'ROMANEIO':<20} {'FILIAL':<30} {'DESTINO':<30} {'TIPO':<15} {'TAMANHO':<10} {'EMISSÃO'}")
            print("-"*100)
            for _, row in df.iterrows():
                print(f"{str(row['ROMANEIO_PRODUTO']):<20} {str(row['FILIAL']):<30} {str(row['FILIAL_DESTINO']):<30} {str(row['TIPO']):<15} {str(row['TAMANHO']):<10} {str(row['EMISSAO'])}")
            
            # Estatísticas
            print("\n" + "-"*100)
            print("📈 ESTATÍSTICAS:")
            tipos = df['TIPO'].value_counts()
            for tipo, count in tipos.items():
                print(f"   {tipo}: {count} registros")
            
            tamanhos = df['TAMANHO'].value_counts().sort_index()
            print(f"\n   Tamanhos de romaneio:")
            for tamanho, count in tamanhos.items():
                print(f"      {tamanho} caracteres: {count} registros")
        else:
            print("\n⚠️  Nenhum registro encontrado")
    except Exception as e:
        print(f"\n✗ Erro: {e}")

def investigar_padrao_romaneios_entrada(conn):
    """Investiga padrão de romaneios de entrada"""
    print("\n" + "="*100)
    print("PADRÃO DE ROMANEIOS DE ENTRADA (ESTOQUE_PROD_ENT)")
    print("="*100)
    
    query = """
        SELECT TOP 20
            ROMANEIO_PRODUTO,
            FILIAL,
            EMISSAO,
            FILIAL_ORIGEM,
            ROMANEIO_ORIGEM,
            LEN(ROMANEIO_PRODUTO) AS TAMANHO,
            CASE 
                WHEN ROMANEIO_PRODUTO LIKE '[0-9]%' THEN 'NUMERICO'
                WHEN ROMANEIO_PRODUTO LIKE '[A-Z]%' THEN 'ALFANUMERICO'
                WHEN ROMANEIO_PRODUTO LIKE 'T[0-9]%' THEN 'T+NUMERICO'
                ELSE 'OUTRO'
            END AS TIPO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE EMISSAO >= DATEADD(DAY, -7, GETDATE())
            AND FILIAL_ORIGEM IS NOT NULL
        ORDER BY EMISSAO DESC, ROMANEIO_PRODUTO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print(f"\n📊 Total de registros: {len(df)}")
            print("\n" + "-"*100)
            print(f"{'ROMANEIO':<20} {'FILIAL':<30} {'ORIGEM':<30} {'ORIGEM_ROM':<15} {'TIPO':<15} {'TAMANHO':<10} {'EMISSÃO'}")
            print("-"*100)
            for _, row in df.iterrows():
                rom_origem = str(row['ROMANEIO_ORIGEM']) if pd.notna(row['ROMANEIO_ORIGEM']) else ''
                print(f"{str(row['ROMANEIO_PRODUTO']):<20} {str(row['FILIAL']):<30} {str(row['FILIAL_ORIGEM']):<30} {rom_origem:<15} {str(row['TIPO']):<15} {str(row['TAMANHO']):<10} {str(row['EMISSAO'])}")
            
            # Estatísticas
            print("\n" + "-"*100)
            print("📈 ESTATÍSTICAS:")
            tipos = df['TIPO'].value_counts()
            for tipo, count in tipos.items():
                print(f"   {tipo}: {count} registros")
            
            tamanhos = df['TAMANHO'].value_counts().sort_index()
            print(f"\n   Tamanhos de romaneio:")
            for tamanho, count in tamanhos.items():
                print(f"      {tamanho} caracteres: {count} registros")
        else:
            print("\n⚠️  Nenhum registro encontrado")
    except Exception as e:
        print(f"\n✗ Erro: {e}")

def investigar_sequenciais(conn):
    """Investiga tabela SEQUENCIAIS"""
    print("\n" + "="*100)
    print("TABELA SEQUENCIAIS (CONTROLE DE NUMERAÇÃO)")
    print("="*100)
    
    query = """
        SELECT 
            TABELA,
            CAMPO,
            SEQUENCIA,
            ULTIMO_USADO
        FROM SEQUENCIAIS WITH (NOLOCK)
        WHERE TABELA IN ('ESTOQUE_PROD_SAI', 'ESTOQUE_PROD_ENT', 'LOJA_ENTRADAS', 'LOJA_SAIDAS')
            OR CAMPO LIKE '%ROMANEIO%'
        ORDER BY TABELA, CAMPO
    """
    
    try:
        df = pd.read_sql(query, conn)
        if not df.empty:
            print(f"\n📊 Total de registros: {len(df)}")
            print("\n" + "-"*100)
            print(f"{'TABELA':<30} {'CAMPO':<30} {'SEQUENCIA':<15} {'ULTIMO_USADO'}")
            print("-"*100)
            for _, row in df.iterrows():
                ultimo = str(row['ULTIMO_USADO']) if pd.notna(row['ULTIMO_USADO']) else ''
                print(f"{str(row['TABELA']):<30} {str(row['CAMPO']):<30} {str(row['SEQUENCIA']):<15} {ultimo}")
        else:
            print("\n⚠️  Nenhum registro encontrado")
    except Exception as e:
        print(f"\n✗ Erro: {e}")

def investigar_romaneio_especifico(conn, romaneio_saida):
    """Investiga um romaneio específico e sua entrada correspondente"""
    print("\n" + "="*100)
    print(f"INVESTIGAÇÃO DO ROMANEIO {romaneio_saida}")
    print("="*100)
    
    # Buscar saída
    query_saida = """
        SELECT 
            ROMANEIO_PRODUTO,
            FILIAL,
            EMISSAO,
            FILIAL_DESTINO,
            ROMANEIO_DESTINO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ?
    """
    
    try:
        df_saida = pd.read_sql(query_saida, conn, params=[romaneio_saida])
        if not df_saida.empty:
            print("\n📤 SAÍDA:")
            for _, row in df_saida.iterrows():
                print(f"   Romaneio: {row['ROMANEIO_PRODUTO']}")
                print(f"   Filial: {row['FILIAL']}")
                print(f"   Destino: {row['FILIAL_DESTINO']}")
                print(f"   Romaneio Destino: {row['ROMANEIO_DESTINO']}")
                print(f"   Emissão: {row['EMISSAO']}")
                
                # Buscar entrada correspondente
                if pd.notna(row['ROMANEIO_DESTINO']):
                    romaneio_entrada = str(row['ROMANEIO_DESTINO']).strip()
                    query_entrada = """
                        SELECT 
                            ROMANEIO_PRODUTO,
                            FILIAL,
                            EMISSAO,
                            FILIAL_ORIGEM,
                            ROMANEIO_ORIGEM
                        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
                        WHERE ROMANEIO_PRODUTO = ?
                    """
                    df_entrada = pd.read_sql(query_entrada, conn, params=[romaneio_entrada])
                    if not df_entrada.empty:
                        print(f"\n📥 ENTRADA CORRESPONDENTE:")
                        for _, row_ent in df_entrada.iterrows():
                            print(f"   Romaneio: {row_ent['ROMANEIO_PRODUTO']}")
                            print(f"   Filial: {row_ent['FILIAL']}")
                            print(f"   Origem: {row_ent['FILIAL_ORIGEM']}")
                            print(f"   Romaneio Origem: {row_ent['ROMANEIO_ORIGEM']}")
                            print(f"   Emissão: {row_ent['EMISSAO']}")
                    else:
                        print(f"\n⚠️  Entrada {romaneio_entrada} não encontrada em ESTOQUE_PROD_ENT")
        else:
            print(f"\n⚠️  Romaneio {romaneio_saida} não encontrado")
    except Exception as e:
        print(f"\n✗ Erro: {e}")

def investigar_stored_procedure_romaneio(conn):
    """Investiga como a stored procedure gera romaneios"""
    print("\n" + "="*100)
    print("DEFINIÇÃO DA STORED PROCEDURE (BUSCANDO LÓGICA DE ROMANEIO)")
    print("="*100)
    
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
            
            # Procurar por padrões de geração de romaneio
            palavras_chave = ['ROMANEIO', 'SEQUENCIA', 'IDENTITY', 'AUTO', 'GENERATE', 'NEXT']
            linhas = definicao.split('\n')
            
            print("\n🔍 Buscando lógica de geração de romaneio...")
            encontrados = []
            for i, linha in enumerate(linhas):
                linha_upper = linha.upper()
                for palavra in palavras_chave:
                    if palavra in linha_upper:
                        # Mostrar contexto (3 linhas antes e depois)
                        inicio = max(0, i - 3)
                        fim = min(len(linhas), i + 4)
                        contexto = '\n'.join([f"{j+1:4d}: {linhas[j]}" for j in range(inicio, fim)])
                        encontrados.append((i+1, contexto))
                        break
            
            if encontrados:
                print(f"\n✓ Encontrados {len(encontrados)} trechos relevantes:")
                for num, contexto in encontrados[:10]:  # Limitar a 10
                    print(f"\n--- Linha {num} ---")
                    print(contexto)
            else:
                print("\n⚠️  Nenhum padrão óbvio encontrado na definição")
        else:
            print("\n⚠️  Não foi possível obter definição")
    except Exception as e:
        print(f"\n✗ Erro: {e}")

def main():
    """Função principal"""
    print("="*100)
    print("INVESTIGAÇÃO: PADRÃO DE GERAÇÃO DE ROMANEIOS")
    print("="*100)
    
    conn = None
    try:
        conn = conectar_banco()
        if not conn:
            print("\n✗ Não foi possível conectar ao banco de dados.")
            return
        
        investigar_padrao_romaneios_saida(conn)
        investigar_padrao_romaneios_entrada(conn)
        investigar_sequenciais(conn)
        investigar_stored_procedure_romaneio(conn)
        
        # Investigar romaneio específico que geramos
        print("\n" + "="*100)
        print("INVESTIGAÇÃO DO ROMANEIO GERADO PELO SCRIPT (028964)")
        print("="*100)
        investigar_romaneio_especifico(conn, '028964')
        
        print("\n" + "="*100)
        print("✅ INVESTIGAÇÃO CONCLUÍDA!")
        print("="*100)
        
    except Exception as e:
        print(f"\n✗ Erro: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

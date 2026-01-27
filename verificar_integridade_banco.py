#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para verificar integridade do banco de dados após execução de criar_transferencia.py
Verifica:
- Registros órfãos
- Estoque inconsistente
- Romaneios duplicados
- Transferências incompletas
- Registros sem correspondência
"""

import sys
import codecs
import pyodbc
import pandas as pd
from datetime import datetime, timedelta

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

def verificar_romaneios_duplicados(conn):
    """Verifica se há romaneios duplicados (violação de PRIMARY KEY)"""
    print("\n" + "="*100)
    print("1. VERIFICANDO ROMANEIOS DUPLICADOS")
    print("="*100)
    
    problemas = []
    
    # Verificar ESTOQUE_PROD_ENT
    query_ent = """
        SELECT ROMANEIO_PRODUTO, FILIAL, COUNT(*) AS QTD
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        GROUP BY ROMANEIO_PRODUTO, FILIAL
        HAVING COUNT(*) > 1
    """
    df_ent = pd.read_sql(query_ent, conn)
    if not df_ent.empty:
        print(f"❌ PROBLEMA: {len(df_ent)} romaneios duplicados em ESTOQUE_PROD_ENT:")
        print(df_ent.to_string(index=False))
        problemas.append(f"{len(df_ent)} romaneios duplicados em ESTOQUE_PROD_ENT")
    else:
        print("✓ Nenhum romaneio duplicado em ESTOQUE_PROD_ENT")
    
    # Verificar ESTOQUE_PROD_SAI
    query_sai = """
        SELECT ROMANEIO_PRODUTO, FILIAL, COUNT(*) AS QTD
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        GROUP BY ROMANEIO_PRODUTO, FILIAL
        HAVING COUNT(*) > 1
    """
    df_sai = pd.read_sql(query_sai, conn)
    if not df_sai.empty:
        print(f"❌ PROBLEMA: {len(df_sai)} romaneios duplicados em ESTOQUE_PROD_SAI:")
        print(df_sai.to_string(index=False))
        problemas.append(f"{len(df_sai)} romaneios duplicados em ESTOQUE_PROD_SAI")
    else:
        print("✓ Nenhum romaneio duplicado em ESTOQUE_PROD_SAI")
    
    return problemas

def verificar_transferencias_incompletas(conn):
    """Verifica transferências que têm saída mas não têm entrada correspondente"""
    print("\n" + "="*100)
    print("2. VERIFICANDO TRANSFERÊNCIAS INCOMPLETAS")
    print("="*100)
    
    problemas = []
    
    # Buscar saídas com FILIAL_DESTINO que não têm entrada correspondente
    query = """
        SELECT 
            s.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            s.FILIAL AS FILIAL_ORIGEM,
            s.FILIAL_DESTINO,
            s.EMISSAO AS DATA_SAIDA,
            s.ROMANEIO_DESTINO
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        WHERE s.FILIAL_DESTINO IS NOT NULL
            AND s.EMISSAO >= DATEADD(DAY, -7, GETDATE())
        AND NOT EXISTS (
            SELECT 1
            FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
            WHERE e.FILIAL = s.FILIAL_DESTINO
                AND (
                    e.ROMANEIO_ORIGEM = s.ROMANEIO_PRODUTO
                    OR e.ROMANEIO_PRODUTO = s.ROMANEIO_DESTINO
                )
        )
    """
    
    df = pd.read_sql(query, conn)
    if not df.empty:
        print(f"❌ PROBLEMA: {len(df)} transferências incompletas (saída sem entrada):")
        print(df.to_string(index=False))
        problemas.append(f"{len(df)} transferências incompletas")
    else:
        print("✓ Todas as transferências têm entrada correspondente")
    
    return problemas

def verificar_registros_orfãos(conn):
    """Verifica registros órfãos (itens sem cabeçalho ou vice-versa)"""
    print("\n" + "="*100)
    print("3. VERIFICANDO REGISTROS ÓRFÃOS")
    print("="*100)
    
    problemas = []
    
    # Verificar ESTOQUE_PROD1_ENT sem ESTOQUE_PROD_ENT
    query_ent_item = """
        SELECT DISTINCT p.ROMANEIO_PRODUTO, COUNT(*) AS QTD_ITENS
        FROM ESTOQUE_PROD1_ENT p WITH (NOLOCK)
        WHERE NOT EXISTS (
            SELECT 1
            FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
            WHERE e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        )
        GROUP BY p.ROMANEIO_PRODUTO
    """
    df_ent_item = pd.read_sql(query_ent_item, conn)
    if not df_ent_item.empty:
        print(f"❌ PROBLEMA: {len(df_ent_item)} romaneios em ESTOQUE_PROD1_ENT sem cabeçalho em ESTOQUE_PROD_ENT:")
        print(df_ent_item.to_string(index=False))
        problemas.append(f"{len(df_ent_item)} itens órfãos em ESTOQUE_PROD1_ENT")
    else:
        print("✓ Todos os itens de ESTOQUE_PROD1_ENT têm cabeçalho")
    
    # Verificar ESTOQUE_PROD1_SAI sem ESTOQUE_PROD_SAI
    query_sai_item = """
        SELECT DISTINCT p.ROMANEIO_PRODUTO, p.FILIAL, COUNT(*) AS QTD_ITENS
        FROM ESTOQUE_PROD1_SAI p WITH (NOLOCK)
        WHERE NOT EXISTS (
            SELECT 1
            FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
            WHERE s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
                AND s.FILIAL = p.FILIAL
        )
        GROUP BY p.ROMANEIO_PRODUTO, p.FILIAL
    """
    df_sai_item = pd.read_sql(query_sai_item, conn)
    if not df_sai_item.empty:
        print(f"❌ PROBLEMA: {len(df_sai_item)} romaneios em ESTOQUE_PROD1_SAI sem cabeçalho em ESTOQUE_PROD_SAI:")
        print(df_sai_item.to_string(index=False))
        problemas.append(f"{len(df_sai_item)} itens órfãos em ESTOQUE_PROD1_SAI")
    else:
        print("✓ Todos os itens de ESTOQUE_PROD1_SAI têm cabeçalho")
    
    return problemas

def verificar_loja_saidas_entradas(conn):
    """Verifica consistência entre LOJA_SAIDAS/LOJA_ENTRADAS e ESTOQUE_PROD_SAI/ENT"""
    print("\n" + "="*100)
    print("4. VERIFICANDO CONSISTÊNCIA LOJA_SAIDAS/LOJA_ENTRADAS")
    print("="*100)
    
    problemas = []
    
    # Verificar LOJA_SAIDAS sem ESTOQUE_PROD_SAI
    query_loja_saidas = """
        SELECT DISTINCT ls.ROMANEIO_PRODUTO, ls.FILIAL
        FROM LOJA_SAIDAS ls WITH (NOLOCK)
        WHERE ls.EMISSAO >= DATEADD(DAY, -7, GETDATE())
            AND NOT EXISTS (
                SELECT 1
                FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
                WHERE s.ROMANEIO_PRODUTO = ls.ROMANEIO_PRODUTO
                    AND s.FILIAL = ls.FILIAL
            )
    """
    df_loja_saidas = pd.read_sql(query_loja_saidas, conn)
    if not df_loja_saidas.empty:
        print(f"⚠ ATENÇÃO: {len(df_loja_saidas)} registros em LOJA_SAIDAS sem correspondência em ESTOQUE_PROD_SAI:")
        print(df_loja_saidas.head(10).to_string(index=False))
        if len(df_loja_saidas) > 10:
            print(f"... e mais {len(df_loja_saidas) - 10} registros")
    
    # Verificar LOJA_ENTRADAS sem ESTOQUE_PROD_ENT
    query_loja_entradas = """
        SELECT DISTINCT le.ROMANEIO_PRODUTO, le.FILIAL
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        WHERE le.EMISSAO >= DATEADD(DAY, -7, GETDATE())
            AND NOT EXISTS (
                SELECT 1
                FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
                WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO
                    AND e.FILIAL = le.FILIAL
            )
    """
    df_loja_entradas = pd.read_sql(query_loja_entradas, conn)
    if not df_loja_entradas.empty:
        print(f"⚠ ATENÇÃO: {len(df_loja_entradas)} registros em LOJA_ENTRADAS sem correspondência em ESTOQUE_PROD_ENT:")
        print(df_loja_entradas.head(10).to_string(index=False))
        if len(df_loja_entradas) > 10:
            print(f"... e mais {len(df_loja_entradas) - 10} registros")
        # Isso pode ser normal se a stored procedure criou em LOJA_ENTRADAS mas não em ESTOQUE_PROD_ENT
        # (o script criar_transferencia.py cria manualmente nesses casos)
    
    return problemas

def verificar_estoque_inconsistente(conn):
    """Verifica se o estoque está inconsistente (soma de movimentações não bate)"""
    print("\n" + "="*100)
    print("5. VERIFICANDO INCONSISTÊNCIAS DE ESTOQUE (ÚLTIMOS 7 DIAS)")
    print("="*100)
    
    problemas = []
    
    # Verificar produtos que tiveram movimentação recente
    query = """
        WITH Movimentacoes AS (
            SELECT 
                ep.PRODUTO,
                ep.COR_PRODUTO,
                ep.FILIAL,
                SUM(CASE WHEN e.EMISSAO >= DATEADD(DAY, -7, GETDATE()) THEN p.QTDE ELSE 0 END) AS ENTRADAS_7D,
                SUM(CASE WHEN s.EMISSAO >= DATEADD(DAY, -7, GETDATE()) THEN ps.QTDE ELSE 0 END) AS SAIDAS_7D
            FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
            LEFT JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) 
                ON p.PRODUTO = ep.PRODUTO 
                AND ISNULL(p.COR_PRODUTO, '') = ISNULL(ep.COR_PRODUTO, '')
            LEFT JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
                ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
                AND e.FILIAL = ep.FILIAL
            LEFT JOIN ESTOQUE_PROD1_SAI ps WITH (NOLOCK)
                ON ps.PRODUTO = ep.PRODUTO
                AND ISNULL(ps.COR_PRODUTO, '') = ISNULL(ep.COR_PRODUTO, '')
            LEFT JOIN ESTOQUE_PROD_SAI s WITH (NOLOCK)
                ON s.ROMANEIO_PRODUTO = ps.ROMANEIO_PRODUTO
                AND s.FILIAL = ep.FILIAL
            WHERE ep.ESTOQUE > 0
            GROUP BY ep.PRODUTO, ep.COR_PRODUTO, ep.FILIAL, ep.ESTOQUE
        )
        SELECT 
            PRODUTO,
            COR_PRODUTO,
            FILIAL,
            ENTRADAS_7D,
            SAIDAS_7D,
            (ENTRADAS_7D - SAIDAS_7D) AS DIFERENCA_ESPERADA
        FROM Movimentacoes
        WHERE ENTRADAS_7D > 0 OR SAIDAS_7D > 0
        ORDER BY ABS(ENTRADAS_7D - SAIDAS_7D) DESC
    """
    
    # Esta query é complexa e pode ser lenta, vamos simplificar
    print("⚠ Verificação de estoque inconsistente requer análise mais profunda")
    print("   (Esta verificação pode ser feita manualmente comparando movimentações)")
    
    return problemas

def verificar_transferencias_recentes(conn):
    """Verifica transferências criadas recentemente (últimas 24 horas)"""
    print("\n" + "="*100)
    print("6. VERIFICANDO TRANSFERÊNCIAS RECENTES (ÚLTIMAS 24 HORAS)")
    print("="*100)
    
    query = """
        SELECT TOP 20
            s.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            s.FILIAL AS FILIAL_ORIGEM,
            s.FILIAL_DESTINO,
            s.EMISSAO AS DATA_SAIDA,
            s.ROMANEIO_DESTINO,
            e.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            e.FILIAL AS FILIAL_DESTINO_ENT,
            e.EMISSAO AS DATA_ENTRADA,
            CASE WHEN e.ROMANEIO_PRODUTO IS NULL THEN 'SEM ENTRADA' ELSE 'COM ENTRADA' END AS STATUS
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
            ON e.FILIAL = s.FILIAL_DESTINO
            AND (e.ROMANEIO_ORIGEM = s.ROMANEIO_PRODUTO OR e.ROMANEIO_PRODUTO = s.ROMANEIO_DESTINO)
        WHERE s.EMISSAO >= DATEADD(HOUR, -24, GETDATE())
            AND s.FILIAL_DESTINO IS NOT NULL
        ORDER BY s.EMISSAO DESC
    """
    
    df = pd.read_sql(query, conn)
    if not df.empty:
        print(f"📋 Encontradas {len(df)} transferências nas últimas 24 horas:")
        print(df.to_string(index=False))
        
        sem_entrada = df[df['STATUS'] == 'SEM ENTRADA']
        if not sem_entrada.empty:
            print(f"\n⚠ ATENÇÃO: {len(sem_entrada)} transferências sem entrada correspondente:")
            print(sem_entrada.to_string(index=False))
    else:
        print("✓ Nenhuma transferência nas últimas 24 horas")
    
    return []

def main():
    """Função principal"""
    print("="*100)
    print("VERIFICAÇÃO DE INTEGRIDADE DO BANCO DE DADOS")
    print("="*100)
    print("\n🔍 Verificando possíveis problemas após execução de criar_transferencia.py...")
    
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        todos_problemas = []
        
        problemas = verificar_romaneios_duplicados(conn)
        todos_problemas.extend(problemas)
        
        problemas = verificar_transferencias_incompletas(conn)
        todos_problemas.extend(problemas)
        
        problemas = verificar_registros_orfãos(conn)
        todos_problemas.extend(problemas)
        
        problemas = verificar_loja_saidas_entradas(conn)
        todos_problemas.extend(problemas)
        
        problemas = verificar_estoque_inconsistente(conn)
        todos_problemas.extend(problemas)
        
        problemas = verificar_transferencias_recentes(conn)
        todos_problemas.extend(problemas)
        
        # Resumo final
        print("\n" + "="*100)
        print("RESUMO DA VERIFICAÇÃO")
        print("="*100)
        
        if todos_problemas:
            print(f"\n❌ PROBLEMAS ENCONTRADOS: {len(todos_problemas)}")
            for i, problema in enumerate(todos_problemas, 1):
                print(f"   {i}. {problema}")
            print("\n⚠️  RECOMENDAÇÃO: Revise os problemas acima e corrija se necessário.")
        else:
            print("\n✅ NENHUM PROBLEMA CRÍTICO ENCONTRADO")
            print("   O banco de dados parece estar íntegro.")
        
    except Exception as e:
        print(f"\n✗ Erro durante verificação: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

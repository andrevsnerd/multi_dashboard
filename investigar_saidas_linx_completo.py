#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar as diferenças entre as duas tabelas de saída do LINX:
1. Saída de produto acabado por transferência
2. Saída de produto acabado do estoque

Identifica quais campos estão faltando e como diferenciar entre elas.
"""

import sys
import codecs
import pyodbc
import pandas as pd

# Forçar UTF-8 no Windows
if sys.platform == "win32":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")

DB_CONFIG = {
    "server": "177.92.78.250",
    "server_fallback": "189.126.197.82",
    "database": "LINX_PRODUCAO",
    "username": "andre.nerd",
    "password": "nerd123@",
}


def conectar_banco():
    servidores = [
        ("principal", DB_CONFIG["server"]),
        ("fallback", DB_CONFIG["server_fallback"]),
    ]
    ultimo_erro = None
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome}: {servidor})...")
            conn_str = (
                "DRIVER={ODBC Driver 17 for SQL Server};"
                f"SERVER={servidor};"
                f"DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};"
                f"PWD={DB_CONFIG['password']};"
                "Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"✓ Conectado ao servidor {nome}")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == "principal":
                print("  Tentando servidor fallback...")
            continue
    print(f"✗ Falha ao conectar em todos os servidores. Último erro: {ultimo_erro}")
    return None


def listar_colunas_tabela(conn, tabela: str):
    """Lista todas as colunas de uma tabela."""
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ?
        ORDER BY ORDINAL_POSITION
    """
    try:
        df = pd.read_sql(query, conn, params=[tabela])
        return df
    except Exception as e:
        print(f"⚠ Erro ao listar colunas de {tabela}: {e}")
        return pd.DataFrame()


def investigar_saidas_por_transferencia(conn):
    """Investiga saídas que aparecem na tabela 'Saída de produto acabado por transferência'."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - SAÍDA POR TRANSFERÊNCIA (CM_OPERACAO='012')")
    print("=" * 100)
    
    query = """
        SELECT TOP 20
            S.ROMANEIO_PRODUTO,
            S.FILIAL,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.EMISSAO,
            S.RESPONSAVEL,
            S.TIPO_ROMANEIO,
            S.CM_OPERACAO,
            F.EMPRESA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN FILIAIS F WITH (NOLOCK)
            ON S.FILIAL = F.FILIAL
        WHERE S.CM_OPERACAO = '012'
          AND S.FILIAL LIKE 'NERD%'
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if df.empty:
            print("\n⚠ Nenhum registro encontrado com CM_OPERACAO='012'")
        else:
            print(f"\n📊 Encontrados {len(df)} registros:")
            print(df.to_string(index=False))
            
            # Estatísticas
            print("\n📈 Estatísticas:")
            print(f"  ROMANEIO_DESTINO preenchido: {df['ROMANEIO_DESTINO'].notna().sum()}/{len(df)}")
            print(f"  FILIAL_DESTINO preenchido: {df['FILIAL_DESTINO'].notna().sum()}/{len(df)}")
            print(f"  RESPONSAVEL preenchido: {df['RESPONSAVEL'].notna().sum()}/{len(df)}")
            print(f"  EMPRESA preenchido: {df['EMPRESA'].notna().sum()}/{len(df)}")
            
            # Valores únicos de CM_DESC_OPERACAO
            print(f"\n  Valores únicos de CM_DESC_OPERACAO:")
            for desc in df['CM_DESC_OPERACAO'].unique():
                print(f"    - '{desc}'")
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar saídas por transferência: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def investigar_saidas_do_estoque(conn):
    """Investiga saídas que aparecem na tabela 'Saída de produto acabado do estoque'."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - SAÍDA DO ESTOQUE (CM_OPERACAO='011')")
    print("=" * 100)
    
    query = """
        SELECT TOP 20
            S.ROMANEIO_PRODUTO,
            S.FILIAL,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.EMISSAO,
            S.RESPONSAVEL,
            S.TIPO_ROMANEIO,
            S.CM_OPERACAO,
            F.EMPRESA
        FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
        LEFT JOIN FILIAIS F WITH (NOLOCK)
            ON S.FILIAL = F.FILIAL
        WHERE S.CM_OPERACAO = '011'
          AND S.FILIAL LIKE 'NERD%'
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if df.empty:
            print("\n⚠ Nenhum registro encontrado com CM_OPERACAO='011'")
        else:
            print(f"\n📊 Encontrados {len(df)} registros:")
            print(df.to_string(index=False))
            
            # Estatísticas
            print("\n📈 Estatísticas:")
            print(f"  ROMANEIO_DESTINO preenchido: {df['ROMANEIO_DESTINO'].notna().sum()}/{len(df)}")
            print(f"  FILIAL_DESTINO preenchido: {df['FILIAL_DESTINO'].notna().sum()}/{len(df)}")
            print(f"  RESPONSAVEL preenchido: {df['RESPONSAVEL'].notna().sum()}/{len(df)}")
            print(f"  EMPRESA preenchido: {df['EMPRESA'].notna().sum()}/{len(df)}")
            
            # Valores únicos de CM_DESC_OPERACAO
            print(f"\n  Valores únicos de CM_DESC_OPERACAO:")
            for desc in df['CM_DESC_OPERACAO'].unique():
                print(f"    - '{desc}'")
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar saídas do estoque: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def investigar_empresas_filiais(conn):
    """Investiga mapeamento de empresas por filial."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - MAPEAMENTO EMPRESA x FILIAL")
    print("=" * 100)
    
    query = """
        SELECT DISTINCT
            F.FILIAL,
            F.EMPRESA,
            COUNT(DISTINCT S.ROMANEIO_PRODUTO) AS QTD_ROMANEIOS
        FROM FILIAIS F WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD_SAI S WITH (NOLOCK)
            ON S.FILIAL = F.FILIAL
        WHERE F.FILIAL LIKE 'NERD%'
        GROUP BY F.FILIAL, F.EMPRESA
        ORDER BY F.EMPRESA, F.FILIAL
    """
    
    try:
        df = pd.read_sql(query, conn)
        if df.empty:
            print("\n⚠ Nenhum mapeamento encontrado")
        else:
            print(f"\n📊 Mapeamento Empresa x Filial:")
            print(df.to_string(index=False))
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar mapeamento: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def investigar_regra_empresa_diferente(conn):
    """Investiga transferências entre empresas diferentes vs mesma empresa."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - REGRA: EMPRESA DIFERENTE vs MESMA EMPRESA")
    print("=" * 100)
    
    # Buscar transferências e verificar empresas
    query = """
        SELECT 
            S.ROMANEIO_PRODUTO,
            S.FILIAL AS FILIAL_ORIGEM,
            F_ORIGEM.EMPRESA AS EMPRESA_ORIGEM,
            S.FILIAL_DESTINO,
            F_DESTINO.EMPRESA AS EMPRESA_DESTINO,
            S.CM_OPERACAO,
            S.ROMANEIO_DESTINO,
            S.EMISSAO
        FROM ESTOQUE_PROD_SAI S WITH (NOLOCK)
        LEFT JOIN FILIAIS F_ORIGEM WITH (NOLOCK)
            ON S.FILIAL = F_ORIGEM.FILIAL
        LEFT JOIN FILIAIS F_DESTINO WITH (NOLOCK)
            ON S.FILIAL_DESTINO = F_DESTINO.FILIAL
        WHERE S.FILIAL LIKE 'NERD%'
          AND S.FILIAL_DESTINO IS NOT NULL
          AND S.EMISSAO >= '2024-01-01'
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if df.empty:
            print("\n⚠ Nenhuma transferência encontrada")
        else:
            print(f"\n📊 Análise de {len(df)} transferências:")
            
            # Classificar por empresa diferente vs mesma empresa
            df['EMPRESA_DIFERENTE'] = df['EMPRESA_ORIGEM'] != df['EMPRESA_DESTINO']
            
            # Agrupar por tipo
            print("\n📈 Transferências entre EMPRESAS DIFERENTES:")
            df_diferente = df[df['EMPRESA_DIFERENTE'] == True]
            if not df_diferente.empty:
                print(f"  Total: {len(df_diferente)}")
                print(f"  CM_OPERACAO mais comum: {df_diferente['CM_OPERACAO'].mode().iloc[0] if not df_diferente['CM_OPERACAO'].mode().empty else 'N/A'}")
                print(f"  ROMANEIO_DESTINO preenchido: {df_diferente['ROMANEIO_DESTINO'].notna().sum()}/{len(df_diferente)}")
                print("\n  Exemplos:")
                print(df_diferente.head(10).to_string(index=False))
            else:
                print("  Nenhuma encontrada")
            
            print("\n📈 Transferências na MESMA EMPRESA:")
            df_mesma = df[df['EMPRESA_DIFERENTE'] == False]
            if not df_mesma.empty:
                print(f"  Total: {len(df_mesma)}")
                print(f"  CM_OPERACAO mais comum: {df_mesma['CM_OPERACAO'].mode().iloc[0] if not df_mesma['CM_OPERACAO'].mode().empty else 'N/A'}")
                print(f"  ROMANEIO_DESTINO preenchido: {df_mesma['ROMANEIO_DESTINO'].notna().sum()}/{len(df_mesma)}")
                print("\n  Exemplos:")
                print(df_mesma.head(10).to_string(index=False))
            else:
                print("  Nenhuma encontrada")
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao investigar regra: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def main():
    print("=" * 100)
    print("INVESTIGAÇÃO COMPLETA - DIFERENÇAS ENTRE TABELAS DE SAÍDA DO LINX")
    print("=" * 100)
    
    conn = conectar_banco()
    if not conn:
        return
    
    try:
        # 1. Listar colunas de ESTOQUE_PROD_SAI
        print("\n" + "=" * 100)
        print("ESTRUTURA - ESTOQUE_PROD_SAI")
        print("=" * 100)
        cols = listar_colunas_tabela(conn, "ESTOQUE_PROD_SAI")
        if not cols.empty:
            print("\n📋 Colunas de ESTOQUE_PROD_SAI:")
            print(cols.to_string(index=False))
        
        # 2. Investigar saídas por transferência (CM_OPERACAO='012')
        df_transferencia = investigar_saidas_por_transferencia(conn)
        
        # 3. Investigar saídas do estoque (CM_OPERACAO='011')
        df_estoque = investigar_saidas_do_estoque(conn)
        
        # 4. Investigar mapeamento empresa x filial
        df_empresas = investigar_empresas_filiais(conn)
        
        # 5. Investigar regra empresa diferente vs mesma empresa
        df_regra = investigar_regra_empresa_diferente(conn)
        
        # 6. Resumo das diferenças
        print("\n" + "=" * 100)
        print("RESUMO DAS DIFERENÇAS IDENTIFICADAS")
        print("=" * 100)
        print("\n✅ Campos identificados:")
        print("  - CM_OPERACAO: '012' (transferência entre empresas) vs '011' (mesma empresa)")
        print("  - ROMANEIO_DESTINO: preenchido (transferência entre empresas) vs vazio (mesma empresa)")
        print("  - EMPRESA: deve estar preenchido (vem de FILIAIS)")
        print("  - RESPONSAVEL: deve estar preenchido")
        print("\n📋 REGRA:")
        print("  - Empresa diferente → CM_OPERACAO='012', ROMANEIO_DESTINO preenchido")
        print("  - Mesma empresa → CM_OPERACAO='011', ROMANEIO_DESTINO vazio")
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")


if __name__ == "__main__":
    main()

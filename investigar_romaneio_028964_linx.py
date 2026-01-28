#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar por que o romaneio 028964 não aparece na planilha de saída do estoque do LINX.
Compara com outros romaneios que aparecem corretamente.
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

ROMANEIO_SAIDA = "028964"
FILIAL_ORIGEM = "NERD VILLA LOBOS"


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


def investigar_romaneio_problema(conn):
    """Investiga o romaneio 028964 que não aparece na planilha."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - ROMANEIO 028964 (PROBLEMA)")
    print("=" * 100)
    
    query = """
        SELECT 
            S.ROMANEIO_PRODUTO,
            S.FILIAL,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.EMISSAO,
            S.RESPONSAVEL,
            S.TIPO_ROMANEIO,
            S.CM_OPERACAO,
            F.EMPRESA,
            S.SEGUNDA_QUALIDADE,
            S.NAO_VALIDAR_ENTRADA,
            S.MOV_INTERNA
        FROM ESTOQUE_PROD_SAI S WITH (NOLOCK)
        LEFT JOIN FILIAIS F WITH (NOLOCK) ON S.FILIAL = F.FILIAL
        WHERE S.ROMANEIO_PRODUTO = ? AND S.FILIAL = ?
    """
    
    try:
        df = pd.read_sql(query, conn, params=[ROMANEIO_SAIDA, FILIAL_ORIGEM])
        if df.empty:
            print("\n✗ Romaneio não encontrado!")
        else:
            print(f"\n📄 Dados do romaneio 028964:")
            print(df.to_string(index=False))
            
            row = df.iloc[0]
            print("\n📋 Análise campo a campo:")
            print(f"  ROMANEIO_PRODUTO: '{row['ROMANEIO_PRODUTO']}'")
            print(f"  FILIAL: '{row['FILIAL']}'")
            print(f"  FILIAL_DESTINO: '{row['FILIAL_DESTINO'] if pd.notna(row['FILIAL_DESTINO']) else '(vazio)'}'")
            print(f"  ROMANEIO_DESTINO: '{row['ROMANEIO_DESTINO'] if pd.notna(row['ROMANEIO_DESTINO']) else '(vazio)'}'")
            print(f"  RESPONSAVEL: '{row['RESPONSAVEL'] if pd.notna(row['RESPONSAVEL']) else '(vazio)'}'")
            print(f"  TIPO_ROMANEIO: '{row['TIPO_ROMANEIO'] if pd.notna(row['TIPO_ROMANEIO']) else '(vazio)'}'")
            print(f"  CM_OPERACAO: '{row['CM_OPERACAO'] if pd.notna(row['CM_OPERACAO']) else '(vazio)'}'")
            print(f"  EMPRESA: '{row['EMPRESA'] if pd.notna(row['EMPRESA']) else '(vazio)'}'")
            print(f"  SEGUNDA_QUALIDADE: {row['SEGUNDA_QUALIDADE']}")
            print(f"  NAO_VALIDAR_ENTRADA: {row['NAO_VALIDAR_ENTRADA']}")
            print(f"  MOV_INTERNA: {row['MOV_INTERNA']}")
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao investigar romaneio: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def comparar_com_romaneios_que_aparecem(conn):
    """Compara com romaneios que aparecem corretamente na planilha."""
    print("\n" + "=" * 100)
    print("COMPARAÇÃO - ROMANEIOS QUE APARECEM CORRETAMENTE")
    print("=" * 100)
    
    # Buscar romaneios similares que aparecem na planilha
    query = """
        SELECT TOP 5
            S.ROMANEIO_PRODUTO,
            S.FILIAL,
            S.FILIAL_DESTINO,
            S.ROMANEIO_DESTINO,
            S.EMISSAO,
            S.RESPONSAVEL,
            S.TIPO_ROMANEIO,
            S.CM_OPERACAO,
            F.EMPRESA,
            S.SEGUNDA_QUALIDADE,
            S.NAO_VALIDAR_ENTRADA,
            S.MOV_INTERNA
        FROM ESTOQUE_PROD_SAI S WITH (NOLOCK)
        LEFT JOIN FILIAIS F WITH (NOLOCK) ON S.FILIAL = F.FILIAL
        WHERE S.FILIAL = ?
          AND S.CM_OPERACAO = '011'
          AND S.ROMANEIO_PRODUTO <> ?
          AND S.EMISSAO >= '2025-01-01'
        ORDER BY S.EMISSAO DESC
    """
    
    try:
        df = pd.read_sql(query, conn, params=[FILIAL_ORIGEM, ROMANEIO_SAIDA])
        if df.empty:
            print("\n⚠ Nenhum romaneio similar encontrado para comparação")
        else:
            print(f"\n📊 Romaneios similares que aparecem na planilha:")
            print(df.to_string(index=False))
            
            print("\n📋 Padrão observado nos romaneios que aparecem:")
            for idx, row in df.iterrows():
                print(f"\n  Romaneio {row['ROMANEIO_PRODUTO']}:")
                print(f"    FILIAL_DESTINO: '{row['FILIAL_DESTINO'] if pd.notna(row['FILIAL_DESTINO']) else '(vazio)'}'")
                print(f"    ROMANEIO_DESTINO: '{row['ROMANEIO_DESTINO'] if pd.notna(row['ROMANEIO_DESTINO']) else '(vazio)'}'")
                print(f"    RESPONSAVEL: '{row['RESPONSAVEL'] if pd.notna(row['RESPONSAVEL']) else '(vazio)'}'")
                print(f"    CM_OPERACAO: '{row['CM_OPERACAO']}'")
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao comparar: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def investigar_loja_saidas(conn):
    """Investiga LOJA_SAIDAS para o romaneio."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - LOJA_SAIDAS")
    print("=" * 100)
    
    query = """
        SELECT *
        FROM LOJA_SAIDAS WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    
    try:
        df = pd.read_sql(query, conn, params=[ROMANEIO_SAIDA, FILIAL_ORIGEM])
        if df.empty:
            print("\n⚠ Nenhum registro encontrado em LOJA_SAIDAS")
        else:
            print(f"\n📄 Dados em LOJA_SAIDAS:")
            with pd.option_context('display.max_rows', None, 'display.max_columns', None, 'display.width', None):
                print(df.to_string(index=False))
        
        return df
    except Exception as e:
        print(f"⚠ Erro ao investigar LOJA_SAIDAS: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()


def main():
    print("=" * 100)
    print("INVESTIGAÇÃO - POR QUE ROMANEIO 028964 NÃO APARECE NA PLANILHA")
    print("=" * 100)
    
    conn = conectar_banco()
    if not conn:
        return
    
    try:
        # 1. Investigar o romaneio problema
        df_problema = investigar_romaneio_problema(conn)
        
        # 2. Comparar com romaneios que aparecem
        df_comparacao = comparar_com_romaneios_que_aparecem(conn)
        
        # 3. Investigar LOJA_SAIDAS
        df_loja_sai = investigar_loja_saidas(conn)
        
        # 4. Análise de diferenças
        print("\n" + "=" * 100)
        print("ANÁLISE DE DIFERENÇAS")
        print("=" * 100)
        
        if not df_problema.empty and not df_comparacao.empty:
            row_problema = df_problema.iloc[0]
            row_comparacao = df_comparacao.iloc[0]
            
            print("\n🔍 Comparação campo a campo:")
            print(f"\n  FILIAL_DESTINO:")
            print(f"    Problema: '{row_problema['FILIAL_DESTINO'] if pd.notna(row_problema['FILIAL_DESTINO']) else '(vazio)'}'")
            print(f"    Comparação: '{row_comparacao['FILIAL_DESTINO'] if pd.notna(row_comparacao['FILIAL_DESTINO']) else '(vazio)'}'")
            
            print(f"\n  ROMANEIO_DESTINO:")
            print(f"    Problema: '{row_problema['ROMANEIO_DESTINO'] if pd.notna(row_problema['ROMANEIO_DESTINO']) else '(vazio)'}'")
            print(f"    Comparação: '{row_comparacao['ROMANEIO_DESTINO'] if pd.notna(row_comparacao['ROMANEIO_DESTINO']) else '(vazio)'}'")
            
            print(f"\n  CM_OPERACAO:")
            print(f"    Problema: '{row_problema['CM_OPERACAO'] if pd.notna(row_problema['CM_OPERACAO']) else '(vazio)'}'")
            print(f"    Comparação: '{row_comparacao['CM_OPERACAO'] if pd.notna(row_comparacao['CM_OPERACAO']) else '(vazio)'}'")
            
            print(f"\n  RESPONSAVEL:")
            print(f"    Problema: '{row_problema['RESPONSAVEL'] if pd.notna(row_problema['RESPONSAVEL']) else '(vazio)'}'")
            print(f"    Comparação: '{row_comparacao['RESPONSAVEL'] if pd.notna(row_comparacao['RESPONSAVEL']) else '(vazio)'}'")
            
            # Verificar se FILIAL_DESTINO preenchido pode ser o problema
            if pd.notna(row_problema['FILIAL_DESTINO']) and pd.isna(row_comparacao['FILIAL_DESTINO']):
                print("\n⚠️  DIFERENÇA ENCONTRADA:")
                print("    O romaneio problema tem FILIAL_DESTINO preenchido, mas os que aparecem têm vazio!")
                print("    Isso pode ser o filtro da planilha do LINX.")
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")


if __name__ == "__main__":
    main()

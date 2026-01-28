#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar se a SAÍDA de transferência está completa.
Verifica todas as colunas de ESTOQUE_PROD_SAI e LOJA_SAIDAS e compara com padrões históricos.
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


def listar_colunas_tabela(conn, tabela: str):
    """Lista todas as colunas de uma tabela."""
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            COLUMN_DEFAULT
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


def dump_registro_completo(conn, tabela: str, romaneio: str, filial: str):
    """Faz dump completo de um registro específico."""
    query = f"""
        SELECT *
        FROM {tabela} WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    try:
        df = pd.read_sql(query, conn, params=[romaneio, filial])
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar registro em {tabela}: {e}")
        return pd.DataFrame()


def comparar_com_padroes_historicos(conn, romaneio: str, filial: str):
    """Compara o romaneio com padrões históricos de transferências."""
    print("\n" + "=" * 100)
    print("COMPARAÇÃO COM PADRÕES HISTÓRICOS")
    print("=" * 100)
    
    # Buscar outros romaneios de saída de transferências (mesma filial, mesmo tipo)
    query_padrao = """
        SELECT TOP 10
            ROMANEIO_PRODUTO,
            FILIAL,
            FILIAL_DESTINO,
            EMISSAO,
            RESPONSAVEL,
            TIPO_ROMANEIO,
            EMPRESA
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE FILIAL = ?
          AND TIPO_ROMANEIO = 'TRANSFERENCIA ENTRE LOJAS'
          AND ROMANEIO_PRODUTO <> ?
        ORDER BY EMISSAO DESC
    """
    try:
        df_padrao = pd.read_sql(query_padrao, conn, params=[filial, romaneio])
        if not df_padrao.empty:
            print("\n📊 Outros romaneios de saída de transferências (mesma filial, mesmo tipo):")
            print(df_padrao.to_string(index=False))
            
            # Estatísticas de campos preenchidos
            print("\n📈 Estatísticas de campos preenchidos nos padrões:")
            print(f"  RESPONSAVEL preenchido: {df_padrao['RESPONSAVEL'].notna().sum()}/{len(df_padrao)}")
            print(f"  EMPRESA preenchido: {df_padrao['EMPRESA'].notna().sum()}/{len(df_padrao)}")
        else:
            print("\n⚠ Nenhum padrão histórico encontrado para comparação.")
    except Exception as e:
        print(f"⚠ Erro ao buscar padrões: {e}")


def investigar_loja_saidas(conn, romaneio: str, filial: str):
    """Investiga LOJA_SAIDAS para o romaneio."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO - LOJA_SAIDAS")
    print("=" * 100)
    
    # Listar colunas
    cols = listar_colunas_tabela(conn, "LOJA_SAIDAS")
    if not cols.empty:
        print("\n📋 Colunas de LOJA_SAIDAS:")
        print(cols.to_string(index=False))
    
    # Buscar registro específico
    df_reg = dump_registro_completo(conn, "LOJA_SAIDAS", romaneio, filial)
    if df_reg.empty:
        print(f"\n⚠ Nenhum registro encontrado em LOJA_SAIDAS para {romaneio} / {filial}")
    else:
        print(f"\n📄 Registro completo em LOJA_SAIDAS:")
        with pd.option_context('display.max_rows', None, 'display.max_columns', None, 'display.width', None):
            print(df_reg.to_string(index=False))
    
    return df_reg


def main():
    print("=" * 100)
    print("INVESTIGAÇÃO COMPLETA - SAÍDA DE TRANSFERÊNCIA")
    print("=" * 100)
    print(f"Romaneio de SAÍDA: {ROMANEIO_SAIDA}")
    print(f"Filial de origem: {FILIAL_ORIGEM}")
    
    conn = conectar_banco()
    if not conn:
        return
    
    try:
        # 1. Listar colunas de ESTOQUE_PROD_SAI
        print("\n" + "=" * 100)
        print("ESTRUTURA - ESTOQUE_PROD_SAI")
        print("=" * 100)
        cols_ep_sai = listar_colunas_tabela(conn, "ESTOQUE_PROD_SAI")
        if not cols_ep_sai.empty:
            print("\n📋 Colunas de ESTOQUE_PROD_SAI:")
            print(cols_ep_sai.to_string(index=False))
        
        # 2. Dump completo do registro específico
        print("\n" + "=" * 100)
        print("REGISTRO ESPECÍFICO - ESTOQUE_PROD_SAI")
        print("=" * 100)
        df_reg_ep_sai = dump_registro_completo(conn, "ESTOQUE_PROD_SAI", ROMANEIO_SAIDA, FILIAL_ORIGEM)
        if df_reg_ep_sai.empty:
            print(f"\n✗ Nenhum registro encontrado em ESTOQUE_PROD_SAI para {ROMANEIO_SAIDA} / {FILIAL_ORIGEM}")
        else:
            print(f"\n📄 Registro completo em ESTOQUE_PROD_SAI:")
            with pd.option_context('display.max_rows', None, 'display.max_columns', None, 'display.width', None):
                print(df_reg_ep_sai.to_string(index=False))
        
        # 3. Investigar LOJA_SAIDAS
        df_loja_sai = investigar_loja_saidas(conn, ROMANEIO_SAIDA, FILIAL_ORIGEM)
        
        # 4. Comparar com padrões históricos
        comparar_com_padroes_historicos(conn, ROMANEIO_SAIDA, FILIAL_ORIGEM)
        
        # 5. Análise de campos faltantes
        print("\n" + "=" * 100)
        print("ANÁLISE DE CAMPOS FALTANTES")
        print("=" * 100)
        
        if not df_reg_ep_sai.empty:
            row = df_reg_ep_sai.iloc[0]
            campos_faltantes = []
            
            # Verificar campos importantes
            if pd.isna(row.get('RESPONSAVEL')) or str(row.get('RESPONSAVEL', '')).strip() == '':
                campos_faltantes.append('RESPONSAVEL')
            
            if pd.isna(row.get('EMPRESA')) or str(row.get('EMPRESA', '')).strip() == '':
                campos_faltantes.append('EMPRESA')
            
            if campos_faltantes:
                print(f"\n⚠ Campos faltantes ou vazios em ESTOQUE_PROD_SAI:")
                for campo in campos_faltantes:
                    print(f"  - {campo}")
            else:
                print("\n✅ Todos os campos principais estão preenchidos em ESTOQUE_PROD_SAI.")
        
        if not df_loja_sai.empty:
            row_ls = df_loja_sai.iloc[0]
            campos_faltantes_ls = []
            
            if pd.isna(row_ls.get('RESPONSAVEL')) or str(row_ls.get('RESPONSAVEL', '')).strip() == '':
                campos_faltantes_ls.append('RESPONSAVEL')
            
            if campos_faltantes_ls:
                print(f"\n⚠ Campos faltantes ou vazios em LOJA_SAIDAS:")
                for campo in campos_faltantes_ls:
                    print(f"  - {campo}")
            else:
                print("\n✅ Todos os campos principais estão preenchidos em LOJA_SAIDAS.")
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")


if __name__ == "__main__":
    main()

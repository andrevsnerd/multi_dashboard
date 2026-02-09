#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar onde ficam armazenadas as observações/comentários
de transferências no banco de dados LINX.
Especialmente investiga a saída 011213 mencionada pelo usuário.
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

ROMANEIO_SAIDA_REFERENCIA = "011213"  # Saída mencionada pelo usuário


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


def listar_colunas_com_observacao(conn, tabela: str):
    """Lista colunas que podem conter observações (memo, observacao, obs, etc)."""
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            CHARACTER_MAXIMUM_LENGTH
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = ?
          AND (
            COLUMN_NAME LIKE '%OBS%' 
            OR COLUMN_NAME LIKE '%MEMO%'
            OR COLUMN_NAME LIKE '%OBSERVACAO%'
            OR COLUMN_NAME LIKE '%OBSERV%'
            OR COLUMN_NAME LIKE '%COMENT%'
            OR COLUMN_NAME LIKE '%NOTA%'
            OR COLUMN_NAME LIKE '%OBSERV%'
            OR DATA_TYPE IN ('text', 'ntext', 'varchar', 'nvarchar')
          )
        ORDER BY ORDINAL_POSITION
    """
    try:
        df = pd.read_sql(query, conn, params=[tabela])
        return df
    except Exception as e:
        print(f"⚠ Erro ao listar colunas de {tabela}: {e}")
        return pd.DataFrame()


def listar_todas_colunas(conn, tabela: str):
    """Lista todas as colunas de uma tabela."""
    query = """
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            IS_NULLABLE,
            CHARACTER_MAXIMUM_LENGTH
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


def buscar_registro_completo(conn, tabela: str, romaneio: str, filial: str = None):
    """Busca registro completo de uma tabela."""
    if filial:
        query = f"""
            SELECT *
            FROM {tabela} WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        params = [romaneio, filial]
    else:
        query = f"""
            SELECT *
            FROM {tabela} WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO = ?
        """
        params = [romaneio]
    
    try:
        df = pd.read_sql(query, conn, params=params)
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar registro em {tabela}: {e}")
        return pd.DataFrame()


def investigar_romaneio_especifico(conn, romaneio: str):
    """Investiga o romaneio específico mencionado pelo usuário."""
    print("\n" + "=" * 100)
    print(f"INVESTIGAÇÃO DO ROMANEIO {romaneio}")
    print("=" * 100)
    
    # Buscar em ESTOQUE_PROD_SAI
    print("\n📋 ESTOQUE_PROD_SAI:")
    df_sai = buscar_registro_completo(conn, "ESTOQUE_PROD_SAI", romaneio)
    if not df_sai.empty:
        print(f"  ✓ Registro encontrado")
        # Mostrar todas as colunas que podem conter texto longo
        for col in df_sai.columns:
            val = df_sai.iloc[0][col]
            if pd.notna(val) and isinstance(val, str) and len(str(val).strip()) > 0:
                if len(str(val)) > 50:
                    print(f"    {col}: {str(val)[:100]}...")
                else:
                    print(f"    {col}: {val}")
    else:
        print(f"  ✗ Nenhum registro encontrado")
    
    # Buscar em LOJA_SAIDAS
    print("\n📋 LOJA_SAIDAS:")
    df_loja_sai = buscar_registro_completo(conn, "LOJA_SAIDAS", romaneio)
    if not df_loja_sai.empty:
        print(f"  ✓ Registro encontrado")
        for col in df_loja_sai.columns:
            val = df_loja_sai.iloc[0][col]
            if pd.notna(val) and isinstance(val, str) and len(str(val).strip()) > 0:
                if len(str(val)) > 50:
                    print(f"    {col}: {str(val)[:100]}...")
                else:
                    print(f"    {col}: {val}")
    else:
        print(f"  ✗ Nenhum registro encontrado")
    
    # Buscar em outras tabelas relacionadas
    tabelas_relacionadas = [
        "ESTOQUE_PROD_ENT",
        "LOJA_ENTRADAS",
    ]
    
    for tabela in tabelas_relacionadas:
        print(f"\n📋 {tabela}:")
        df = buscar_registro_completo(conn, tabela, romaneio)
        if not df.empty:
            print(f"  ✓ Registro encontrado")
            for col in df.columns:
                val = df.iloc[0][col]
                if pd.notna(val) and isinstance(val, str) and len(str(val).strip()) > 0:
                    if len(str(val)) > 50:
                        print(f"    {col}: {str(val)[:100]}...")
                    else:
                        print(f"    {col}: {val}")
        else:
            print(f"  ✗ Nenhum registro encontrado")


def investigar_estrutura_tabelas(conn):
    """Investiga a estrutura das tabelas principais para encontrar campos de observação."""
    print("\n" + "=" * 100)
    print("INVESTIGAÇÃO DA ESTRUTURA DAS TABELAS")
    print("=" * 100)
    
    tabelas_principais = [
        "ESTOQUE_PROD_SAI",
        "ESTOQUE_PROD_ENT",
        "LOJA_SAIDAS",
        "LOJA_ENTRADAS",
        "ESTOQUE_PROD1_SAI",
        "ESTOQUE_PROD1_ENT",
        "LOJA_SAIDAS_PRODUTO",
        "LOJA_ENTRADAS_PRODUTO",
    ]
    
    for tabela in tabelas_principais:
        print(f"\n{'='*100}")
        print(f"TABELA: {tabela}")
        print(f"{'='*100}")
        
        # Listar colunas relacionadas a observação
        cols_obs = listar_colunas_com_observacao(conn, tabela)
        if not cols_obs.empty:
            print(f"\n📝 Colunas que podem conter observações:")
            print(cols_obs.to_string(index=False))
        else:
            print(f"\n⚠ Nenhuma coluna óbvia de observação encontrada")
        
        # Listar todas as colunas para verificar manualmente
        print(f"\n📋 Todas as colunas da tabela:")
        todas_cols = listar_todas_colunas(conn, tabela)
        if not todas_cols.empty:
            # Mostrar apenas colunas de texto que podem ser observações
            texto_cols = todas_cols[
                todas_cols['DATA_TYPE'].isin(['text', 'ntext', 'varchar', 'nvarchar', 'char', 'nchar'])
            ]
            if not texto_cols.empty:
                print(texto_cols.to_string(index=False))
            else:
                print("  (Nenhuma coluna de texto encontrada)")


def buscar_exemplos_com_observacao(conn):
    """Busca exemplos de registros que têm observações preenchidas."""
    print("\n" + "=" * 100)
    print("BUSCANDO EXEMPLOS DE REGISTROS COM OBSERVAÇÕES")
    print("=" * 100)
    
    # Primeiro, vamos verificar quais colunas existem que podem conter observações
    query_cols = """
        SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME IN ('ESTOQUE_PROD_SAI', 'LOJA_SAIDAS', 'ESTOQUE_PROD_ENT', 'LOJA_ENTRADAS')
          AND (
            COLUMN_NAME LIKE '%OBS%' 
            OR COLUMN_NAME LIKE '%MEMO%'
            OR COLUMN_NAME LIKE '%OBSERVACAO%'
            OR COLUMN_NAME LIKE '%OBSERV%'
            OR COLUMN_NAME LIKE '%COMENT%'
            OR COLUMN_NAME LIKE '%NOTA%'
          )
    """
    
    try:
        df_cols = pd.read_sql(query_cols, conn)
        if not df_cols.empty:
            print("\n📋 Colunas de observação encontradas:")
            print(df_cols.to_string(index=False))
            
            # Para cada coluna encontrada, buscar exemplos
            for _, row in df_cols.iterrows():
                tabela = row['TABLE_NAME']
                coluna = row['COLUMN_NAME']
                print(f"\n🔍 Exemplos de {tabela}.{coluna}:")
                
                query_exemplos = f"""
                    SELECT TOP 5 ROMANEIO_PRODUTO, FILIAL, {coluna}
                    FROM {tabela} WITH (NOLOCK)
                    WHERE {coluna} IS NOT NULL 
                      AND LTRIM(RTRIM(CAST({coluna} AS VARCHAR(MAX)))) <> ''
                    ORDER BY EMISSAO DESC
                """
                try:
                    df_exemplos = pd.read_sql(query_exemplos, conn)
                    if not df_exemplos.empty:
                        print(df_exemplos.to_string(index=False))
                    else:
                        print("  (Nenhum exemplo encontrado)")
                except Exception as e:
                    print(f"  ⚠ Erro ao buscar exemplos: {e}")
        else:
            print("\n⚠ Nenhuma coluna de observação encontrada nas tabelas principais")
    except Exception as e:
        print(f"⚠ Erro ao buscar colunas: {e}")


def main():
    print("=" * 100)
    print("INVESTIGAÇÃO DE OBSERVAÇÕES EM TRANSFERÊNCIAS")
    print("=" * 100)
    print(f"Romaneio de referência: {ROMANEIO_SAIDA_REFERENCIA}")
    
    conn = conectar_banco()
    if not conn:
        return
    
    try:
        # 1. Investigar estrutura das tabelas
        investigar_estrutura_tabelas(conn)
        
        # 2. Buscar exemplos com observações
        buscar_exemplos_com_observacao(conn)
        
        # 3. Investigar romaneio específico
        investigar_romaneio_especifico(conn, ROMANEIO_SAIDA_REFERENCIA)
        
        # 4. Buscar outros romaneios próximos que possam ter observações
        print("\n" + "=" * 100)
        print("BUSCANDO ROMANEIOS PRÓXIMOS COM OBSERVAÇÕES")
        print("=" * 100)
        
        query_proximos = """
            SELECT TOP 10 ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL
            FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO >= '011200' AND ROMANEIO_PRODUTO <= '011220'
            ORDER BY ROMANEIO_PRODUTO DESC
        """
        try:
            df_proximos = pd.read_sql(query_proximos, conn)
            if not df_proximos.empty:
                print("\n📋 Romaneios próximos encontrados:")
                print(df_proximos.to_string(index=False))
        except Exception as e:
            print(f"⚠ Erro ao buscar romaneios próximos: {e}")
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")


if __name__ == "__main__":
    main()

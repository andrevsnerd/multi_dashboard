#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Teste - Validar Tabelas de Saída
Testa as tabelas encontradas para verificar se têm estrutura similar às de entrada
"""

import os
import sys
import pyodbc
import pandas as pd
from datetime import datetime

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

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
    sys.exit(1)

def analisar_estrutura_completa(conn, schema, tabela):
    """Analisa a estrutura completa de uma tabela"""
    query = f"""
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
            NUMERIC_PRECISION,
            NUMERIC_SCALE,
            IS_NULLABLE,
            COLUMN_DEFAULT
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = '{schema}' AND TABLE_NAME = '{tabela}'
        ORDER BY ORDINAL_POSITION
    """
    
    try:
        df = pd.read_sql(query, conn)
        return df
    except Exception as e:
        print(f"  ✗ Erro ao analisar estrutura: {e}")
        return None

def testar_tabela(conn, schema, tabela, nome_amigavel):
    """Testa uma tabela específica"""
    print("\n" + "="*80)
    print(f"TESTANDO: {nome_amigavel} ({schema}.{tabela})")
    print("="*80)
    
    # 1. Contar registros
    try:
        query_count = f"SELECT COUNT(*) AS TOTAL FROM [{schema}].[{tabela}]"
        df_count = pd.read_sql(query_count, conn)
        total = df_count.iloc[0]['TOTAL']
        print(f"\n📊 Total de registros: {total:,}")
    except Exception as e:
        print(f"✗ Erro ao contar registros: {e}")
        return None
    
    # 2. Analisar estrutura
    print(f"\n📋 Estrutura da tabela:")
    df_cols = analisar_estrutura_completa(conn, schema, tabela)
    if df_cols is None:
        return None
    
    print(f"  Total de colunas: {len(df_cols)}")
    print(f"\n  Colunas principais:")
    for _, col in df_cols.iterrows():
        tipo = col['DATA_TYPE']
        if col['CHARACTER_MAXIMUM_LENGTH']:
            tipo += f"({col['CHARACTER_MAXIMUM_LENGTH']})"
        elif col['NUMERIC_PRECISION']:
            if col['NUMERIC_SCALE']:
                tipo += f"({col['NUMERIC_PRECISION']},{col['NUMERIC_SCALE']})"
            else:
                tipo += f"({col['NUMERIC_PRECISION']})"
        nullable = "NULL" if col['IS_NULLABLE'] == 'YES' else "NOT NULL"
        print(f"    - {col['COLUMN_NAME']}: {tipo} ({nullable})")
    
    # 3. Amostra de dados
    print(f"\n📄 Amostra de dados (10 primeiros registros):")
    try:
        query_sample = f"SELECT TOP 10 * FROM [{schema}].[{tabela}]"
        df_sample = pd.read_sql(query_sample, conn)
        print(f"  Colunas: {', '.join(df_sample.columns.tolist())}")
        print(f"\n  Dados:")
        for idx, row in df_sample.iterrows():
            print(f"    Registro {idx + 1}:")
            for col in df_sample.columns[:5]:  # Mostrar apenas 5 primeiras colunas
                valor = row[col]
                if pd.isna(valor):
                    valor = "NULL"
                elif isinstance(valor, datetime):
                    valor = valor.strftime('%Y-%m-%d %H:%M:%S')
                print(f"      {col}: {valor}")
            if len(df_sample.columns) > 5:
                print(f"      ... e mais {len(df_sample.columns) - 5} colunas")
            print()
    except Exception as e:
        print(f"  ⚠ Erro ao obter amostra: {e}")
    
    # 4. Verificar colunas chave (comparar com entradas)
    print(f"\n🔑 Verificação de colunas chave (comparando com ESTOQUE_PROD_ENT/ESTOQUE_PROD1_ENT):")
    colunas_chave_entrada = {
        'ROMANEIO_PRODUTO': 'Chave principal (romaneio)',
        'EMISSAO': 'Data de emissão',
        'FILIAL': 'Filial',
        'PRODUTO': 'Código do produto',
        'COR_PRODUTO': 'Cor do produto',
        'QTDE': 'Quantidade'
    }
    
    colunas_encontradas = df_cols['COLUMN_NAME'].str.upper().tolist()
    matches = {}
    
    for col_chave, descricao in colunas_chave_entrada.items():
        for col_encontrada in colunas_encontradas:
            if col_chave == col_encontrada:
                matches[col_chave] = (col_encontrada, descricao, 'EXATO')
                break
            elif col_chave in col_encontrada or col_encontrada in col_chave:
                if col_chave not in matches:
                    matches[col_chave] = (col_encontrada, descricao, 'PARCIAL')
    
    for col_chave, (col_encontrada, descricao, tipo_match) in matches.items():
        status = "✓" if tipo_match == 'EXATO' else "~"
        print(f"  {status} {col_chave} → {col_encontrada} ({descricao}) [{tipo_match}]")
    
    # 5. Verificar relacionamento entre tabelas (se houver padrão similar)
    if 'ESTOQUE_PROD_SAI' in tabela or 'ESTOQUE_PROD1_SAI' in tabela:
        print(f"\n🔗 Verificando relacionamento (padrão similar a ESTOQUE_PROD_ENT/ESTOQUE_PROD1_ENT):")
        if 'ESTOQUE_PROD_SAI' in tabela:
            # Esta seria a tabela "cabeçalho" (similar a ESTOQUE_PROD_ENT)
            print(f"  Esta parece ser a tabela CABEÇALHO (similar a ESTOQUE_PROD_ENT)")
        elif 'ESTOQUE_PROD1_SAI' in tabela:
            # Esta seria a tabela "detalhe" (similar a ESTOQUE_PROD1_ENT)
            print(f"  Esta parece ser a tabela DETALHE (similar a ESTOQUE_PROD1_ENT)")
            # Verificar se tem ROMANEIO_PRODUTO para fazer join
            if 'ROMANEIO_PRODUTO' in colunas_encontradas:
                print(f"  ✓ Tem ROMANEIO_PRODUTO - pode fazer JOIN com ESTOQUE_PROD_SAI")
    
    return {
        'tabela': tabela,
        'schema': schema,
        'total_registros': total,
        'colunas': df_cols,
        'amostra': df_sample if 'df_sample' in locals() else None,
        'matches': matches
    }

def comparar_com_entradas(conn):
    """Mostra estrutura de entrada para comparação"""
    print("\n" + "="*80)
    print("ESTRUTURA DE REFERÊNCIA - TABELAS DE ENTRADA")
    print("="*80)
    
    tabelas_entrada = [
        ('dbo', 'ESTOQUE_PROD_ENT', 'Cabeçalho'),
        ('dbo', 'ESTOQUE_PROD1_ENT', 'Detalhe')
    ]
    
    for schema, tabela, tipo in tabelas_entrada:
        print(f"\n📋 {tipo}: {schema}.{tabela}")
        df_cols = analisar_estrutura_completa(conn, schema, tabela)
        if df_cols is not None:
            print(f"  Colunas principais:")
            for _, col in df_cols.head(10).iterrows():
                tipo_col = col['DATA_TYPE']
                if col['CHARACTER_MAXIMUM_LENGTH']:
                    tipo_col += f"({col['CHARACTER_MAXIMUM_LENGTH']})"
                print(f"    - {col['COLUMN_NAME']}: {tipo_col}")
            if len(df_cols) > 10:
                print(f"    ... e mais {len(df_cols) - 10} colunas")

def main():
    """Função principal"""
    print("="*80)
    print("TESTE DE TABELAS DE SAÍDA - VALIDAÇÃO DE ESTRUTURA")
    print("="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        
        # Mostrar estrutura de referência
        comparar_com_entradas(conn)
        
        # Tabelas mais promissoras encontradas na investigação
        tabelas_teste = [
            ('dbo', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD_SAI (Cabeçalho - Padrão)'),
            ('dbo', 'ESTOQUE_PROD1_SAI', 'ESTOQUE_PROD1_SAI (Detalhe - Padrão)'),
            ('dbo', 'LOJA_SAIDAS_PRODUTO', 'LOJA_SAIDAS_PRODUTO (Alternativa)'),
            ('dbo', 'LOJA_SAIDAS_ORIGEM', 'LOJA_SAIDAS_ORIGEM (Alternativa)'),
        ]
        
        resultados = []
        for schema, tabela, nome_amigavel in tabelas_teste:
            resultado = testar_tabela(conn, schema, tabela, nome_amigavel)
            if resultado:
                resultados.append(resultado)
        
        # Resumo final
        print("\n" + "="*80)
        print("RESUMO FINAL - RECOMENDAÇÕES")
        print("="*80)
        
        print("\n✅ TABELAS RECOMENDADAS (por similaridade com entradas):")
        for res in resultados:
            print(f"\n  {res['schema']}.{res['tabela']}")
            print(f"    - Registros: {res['total_registros']:,}")
            print(f"    - Colunas chave encontradas: {len(res['matches'])}")
            if res['matches']:
                print(f"    - Matches:")
                for col_chave, (col_encontrada, desc, tipo) in res['matches'].items():
                    status = "✓" if tipo == 'EXATO' else "~"
                    print(f"      {status} {col_chave}")
        
        # Recomendação final
        print("\n💡 RECOMENDAÇÃO:")
        estoque_sai = next((r for r in resultados if 'ESTOQUE_PROD_SAI' in r['tabela']), None)
        estoque_prod1_sai = next((r for r in resultados if 'ESTOQUE_PROD1_SAI' in r['tabela']), None)
        
        if estoque_sai and estoque_prod1_sai:
            print("  ✓ Use ESTOQUE_PROD_SAI e ESTOQUE_PROD1_SAI (seguem o mesmo padrão das entradas)")
            print("  ✓ Query sugerida:")
            print("    SELECT E.ROMANEIO_PRODUTO, E.EMISSAO, E.FILIAL, P.PRODUTO,")
            print("           P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL")
            print("    FROM ESTOQUE_PROD_SAI AS E")
            print("    LEFT JOIN ESTOQUE_PROD1_SAI AS P ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO")
        elif estoque_prod1_sai:
            print("  ~ Use ESTOQUE_PROD1_SAI (pode precisar de ajustes)")
        else:
            print("  ⚠ Nenhuma tabela com padrão exato encontrada. Considere usar LOJA_SAIDAS_PRODUTO")
        
    except Exception as e:
        print(f"\n✗ Erro durante teste: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão fechada")

if __name__ == '__main__':
    main()

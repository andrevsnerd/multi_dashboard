#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Investigação - Buscar Tabelas de Saídas
Investiga o banco de dados para encontrar tabelas similares às de entradas
mas que contenham dados de saídas de estoque.
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

# Config conexão (mesma do exportar_todos_relatorios.py)
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
            conn.timeout = 300  # 5 minutos
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

def listar_todas_tabelas(conn):
    """Lista todas as tabelas do banco de dados"""
    print("\n" + "="*80)
    print("ETAPA 1: Listando todas as tabelas do banco...")
    print("="*80)
    
    query = """
        SELECT TABLE_SCHEMA, TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_SCHEMA, TABLE_NAME
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n✓ Total de tabelas encontradas: {len(df)}")
    return df

def buscar_tabelas_saida(df_tabelas):
    """Busca tabelas que podem conter dados de saída"""
    print("\n" + "="*80)
    print("ETAPA 2: Buscando tabelas relacionadas a SAÍDAS...")
    print("="*80)
    
    # Palavras-chave para buscar
    palavras_chave = [
        'SAIDA', 'SAÍDA', 'SAID', 'OUT', 'EXIT', 'REMOV', 'RETIR',
        'ESTOQUE_SAIDA', 'ESTOQUE_PROD_SAIDA', 'ESTOQUE_PROD1_SAIDA',
        'PROD_SAIDA', 'PROD1_SAIDA', 'MOV_SAIDA', 'MOVIMENTO_SAIDA',
        'TRANSFER', 'TRANSFERENCIA', 'VENDA_ESTOQUE', 'DEVOLUCAO'
    ]
    
    tabelas_candidatas = []
    
    for _, row in df_tabelas.iterrows():
        nome_tabela = row['TABLE_NAME'].upper()
        schema = row['TABLE_SCHEMA']
        
        for palavra in palavras_chave:
            if palavra in nome_tabela:
                tabelas_candidatas.append({
                    'SCHEMA': schema,
                    'TABLE_NAME': row['TABLE_NAME'],
                    'MATCH': palavra
                })
                break
    
    print(f"\n✓ Tabelas candidatas encontradas: {len(tabelas_candidatas)}")
    for t in tabelas_candidatas:
        print(f"  - {t['SCHEMA']}.{t['TABLE_NAME']} (match: {t['MATCH']})")
    
    return tabelas_candidatas

def analisar_estrutura_tabela(conn, schema, tabela):
    """Analisa a estrutura de uma tabela"""
    query = f"""
        SELECT 
            COLUMN_NAME,
            DATA_TYPE,
            CHARACTER_MAXIMUM_LENGTH,
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

def comparar_com_entradas(conn):
    """Analisa a estrutura das tabelas de entrada para usar como referência"""
    print("\n" + "="*80)
    print("ETAPA 3: Analisando estrutura das tabelas de ENTRADA (referência)...")
    print("="*80)
    
    tabelas_entrada = [
        ('dbo', 'ESTOQUE_PROD_ENT'),
        ('dbo', 'ESTOQUE_PROD1_ENT')
    ]
    
    estruturas_entrada = {}
    
    for schema, tabela in tabelas_entrada:
        print(f"\n📋 Analisando {schema}.{tabela}...")
        df_cols = analisar_estrutura_tabela(conn, schema, tabela)
        if df_cols is not None:
            estruturas_entrada[tabela] = df_cols
            print(f"  ✓ Colunas encontradas: {len(df_cols)}")
            print(f"  Colunas principais:")
            for _, col in df_cols.head(10).iterrows():
                tipo = col['DATA_TYPE']
                if col['CHARACTER_MAXIMUM_LENGTH']:
                    tipo += f"({col['CHARACTER_MAXIMUM_LENGTH']})"
                print(f"    - {col['COLUMN_NAME']}: {tipo}")
            if len(df_cols) > 10:
                print(f"    ... e mais {len(df_cols) - 10} colunas")
        else:
            print(f"  ✗ Tabela não encontrada ou erro ao acessar")
    
    return estruturas_entrada

def analisar_tabelas_candidatas(conn, tabelas_candidatas, estruturas_entrada):
    """Analisa as tabelas candidatas e compara com entradas"""
    print("\n" + "="*80)
    print("ETAPA 4: Analisando tabelas candidatas de SAÍDA...")
    print("="*80)
    
    resultados = []
    
    for candidata in tabelas_candidatas:
        schema = candidata['SCHEMA']
        tabela = candidata['TABLE_NAME']
        
        print(f"\n🔍 Analisando {schema}.{tabela}...")
        
        # Analisar estrutura
        df_cols = analisar_estrutura_tabela(conn, schema, tabela)
        if df_cols is None:
            continue
        
        print(f"  ✓ Colunas: {len(df_cols)}")
        
        # Verificar colunas chave similares às de entrada
        colunas_chave_entrada = ['ROMANEIO_PRODUTO', 'EMISSAO', 'FILIAL', 'PRODUTO', 'COR_PRODUTO', 'QTDE']
        colunas_encontradas = df_cols['COLUMN_NAME'].str.upper().tolist()
        
        colunas_match = []
        for col_chave in colunas_chave_entrada:
            for col_encontrada in colunas_encontradas:
                if col_chave in col_encontrada or col_encontrada in col_chave:
                    colunas_match.append((col_chave, col_encontrada))
        
        print(f"  📊 Colunas similares às de entrada: {len(colunas_match)}")
        for col_entrada, col_encontrada in colunas_match:
            print(f"    - {col_entrada} ≈ {col_encontrada}")
        
        # Contar registros
        try:
            query_count = f"SELECT COUNT(*) AS TOTAL FROM [{schema}].[{tabela}]"
            df_count = pd.read_sql(query_count, conn)
            total_registros = df_count.iloc[0]['TOTAL']
            print(f"  📈 Total de registros: {total_registros:,}")
        except Exception as e:
            print(f"  ⚠ Não foi possível contar registros: {e}")
            total_registros = None
        
        # Amostra de dados
        try:
            query_sample = f"SELECT TOP 5 * FROM [{schema}].[{tabela}]"
            df_sample = pd.read_sql(query_sample, conn)
            print(f"  📋 Amostra de dados (5 primeiros registros):")
            print(f"    Colunas: {', '.join(df_sample.columns.tolist()[:10])}")
            if len(df_sample.columns) > 10:
                print(f"    ... e mais {len(df_sample.columns) - 10} colunas")
        except Exception as e:
            print(f"  ⚠ Não foi possível obter amostra: {e}")
            df_sample = None
        
        resultados.append({
            'schema': schema,
            'tabela': tabela,
            'colunas': len(df_cols),
            'colunas_match': len(colunas_match),
            'total_registros': total_registros,
            'estrutura': df_cols,
            'amostra': df_sample,
            'match_details': colunas_match
        })
    
    return resultados

def buscar_tabelas_por_padrao(conn, padrao_entrada):
    """Busca tabelas que seguem o mesmo padrão de nomenclatura das entradas"""
    print("\n" + "="*80)
    print("ETAPA 5: Buscando tabelas por padrão de nomenclatura...")
    print("="*80)
    
    # Padrões conhecidos de entrada: ESTOQUE_PROD_ENT, ESTOQUE_PROD1_ENT
    # Tentar variações: ESTOQUE_PROD_SAIDA, ESTOQUE_PROD1_SAIDA, etc.
    
    variacoes = [
        'ESTOQUE_PROD_SAIDA',
        'ESTOQUE_PROD1_SAIDA',
        'ESTOQUE_PROD_SAI',
        'ESTOQUE_PROD1_SAI',
        'ESTOQUE_SAIDA_PROD',
        'ESTOQUE_SAIDA_PROD1',
        'PROD_SAIDA',
        'PROD1_SAIDA',
        'ESTOQUE_MOV_SAIDA',
        'ESTOQUE_MOVIMENTO_SAIDA'
    ]
    
    tabelas_encontradas = []
    
    for variacao in variacoes:
        query = f"""
            SELECT TABLE_SCHEMA, TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = '{variacao}'
        """
        try:
            df = pd.read_sql(query, conn)
            if not df.empty:
                for _, row in df.iterrows():
                    tabelas_encontradas.append({
                        'SCHEMA': row['TABLE_SCHEMA'],
                        'TABLE_NAME': row['TABLE_NAME'],
                        'TIPO': 'Padrão de nomenclatura'
                    })
                    print(f"  ✓ Encontrada: {row['TABLE_SCHEMA']}.{row['TABLE_NAME']}")
        except Exception as e:
            pass
    
    if not tabelas_encontradas:
        print("  ⚠ Nenhuma tabela encontrada com padrão de nomenclatura similar")
    
    return tabelas_encontradas

def investigar_relacionamentos(conn):
    """Investiga relacionamentos entre tabelas de estoque"""
    print("\n" + "="*80)
    print("ETAPA 6: Investigando relacionamentos e foreign keys...")
    print("="*80)
    
    # Buscar foreign keys que referenciam ESTOQUE_PROD_ENT
    query = """
        SELECT 
            fk.name AS FK_NAME,
            OBJECT_SCHEMA_NAME(fk.parent_object_id) AS PARENT_SCHEMA,
            OBJECT_NAME(fk.parent_object_id) AS PARENT_TABLE,
            OBJECT_SCHEMA_NAME(fk.referenced_object_id) AS REFERENCED_SCHEMA,
            OBJECT_NAME(fk.referenced_object_id) AS REFERENCED_TABLE
        FROM sys.foreign_keys AS fk
        WHERE OBJECT_NAME(fk.referenced_object_id) IN ('ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT')
           OR OBJECT_NAME(fk.parent_object_id) IN ('ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT')
    """
    
    try:
        df_fk = pd.read_sql(query, conn)
        if not df_fk.empty:
            print(f"  ✓ Relacionamentos encontrados: {len(df_fk)}")
            for _, row in df_fk.iterrows():
                print(f"    {row['PARENT_SCHEMA']}.{row['PARENT_TABLE']} -> {row['REFERENCED_SCHEMA']}.{row['REFERENCED_TABLE']}")
        else:
            print("  ⚠ Nenhum relacionamento explícito encontrado")
    except Exception as e:
        print(f"  ⚠ Erro ao buscar relacionamentos: {e}")

def gerar_relatorio_final(resultados, tabelas_padrao):
    """Gera relatório final com recomendações"""
    print("\n" + "="*80)
    print("RELATÓRIO FINAL - TABELAS DE SAÍDA")
    print("="*80)
    
    print("\n📊 RESUMO:")
    print(f"  - Tabelas candidatas analisadas: {len(resultados)}")
    print(f"  - Tabelas por padrão encontradas: {len(tabelas_padrao)}")
    
    if resultados:
        print("\n🎯 MELHORES CANDIDATAS (ordenadas por similaridade):")
        # Ordenar por número de matches
        resultados_ordenados = sorted(resultados, key=lambda x: x['colunas_match'], reverse=True)
        
        for i, res in enumerate(resultados_ordenados[:5], 1):
            print(f"\n  {i}. {res['schema']}.{res['tabela']}")
            print(f"     - Colunas similares: {res['colunas_match']}")
            print(f"     - Total de colunas: {res['colunas']}")
            print(f"     - Registros: {res['total_registros']:,}" if res['total_registros'] else "     - Registros: N/A")
            if res['match_details']:
                print(f"     - Matches:")
                for col_entrada, col_encontrada in res['match_details'][:5]:
                    print(f"       • {col_entrada} ≈ {col_encontrada}")
    
    if tabelas_padrao:
        print("\n✅ TABELAS ENCONTRADAS POR PADRÃO DE NOMENCLATURA:")
        for t in tabelas_padrao:
            print(f"  - {t['SCHEMA']}.{t['TABLE_NAME']}")
    
    # Salvar relatório em arquivo
    script_dir = os.path.dirname(os.path.abspath(__file__))
    relatorio_path = os.path.join(script_dir, "relatorio_investigacao_saidas.txt")
    
    with open(relatorio_path, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write("RELATÓRIO DE INVESTIGAÇÃO - TABELAS DE SAÍDA\n")
        f.write(f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        f.write("="*80 + "\n\n")
        
        f.write("RESUMO:\n")
        f.write(f"  - Tabelas candidatas analisadas: {len(resultados)}\n")
        f.write(f"  - Tabelas por padrão encontradas: {len(tabelas_padrao)}\n\n")
        
        if resultados:
            f.write("DETALHES DAS TABELAS CANDIDATAS:\n\n")
            for res in resultados:
                f.write(f"{res['schema']}.{res['tabela']}\n")
                f.write(f"  Colunas: {res['colunas']}\n")
                f.write(f"  Colunas similares: {res['colunas_match']}\n")
                f.write(f"  Registros: {res['total_registros']:,}\n" if res['total_registros'] else "  Registros: N/A\n")
                f.write(f"  Estrutura completa:\n")
                for _, col in res['estrutura'].iterrows():
                    tipo = col['DATA_TYPE']
                    if col['CHARACTER_MAXIMUM_LENGTH']:
                        tipo += f"({col['CHARACTER_MAXIMUM_LENGTH']})"
                    f.write(f"    - {col['COLUMN_NAME']}: {tipo}\n")
                f.write("\n")
        
        if tabelas_padrao:
            f.write("TABELAS POR PADRÃO:\n")
            for t in tabelas_padrao:
                f.write(f"  - {t['SCHEMA']}.{t['TABLE_NAME']}\n")
    
    print(f"\n✓ Relatório salvo em: {relatorio_path}")

def main():
    """Função principal de investigação"""
    print("="*80)
    print("INVESTIGAÇÃO DE TABELAS DE SAÍDA - LINX PRODUÇÃO")
    print("="*80)
    
    conn = None
    try:
        # Conectar
        conn = conectar_banco()
        
        # Etapa 1: Listar todas as tabelas
        df_tabelas = listar_todas_tabelas(conn)
        
        # Etapa 2: Buscar tabelas relacionadas a saídas
        tabelas_candidatas = buscar_tabelas_saida(df_tabelas)
        
        # Etapa 3: Analisar estrutura de entradas (referência)
        estruturas_entrada = comparar_com_entradas(conn)
        
        # Etapa 4: Analisar tabelas candidatas
        resultados = []
        if tabelas_candidatas:
            resultados = analisar_tabelas_candidatas(conn, tabelas_candidatas, estruturas_entrada)
        
        # Etapa 5: Buscar por padrão de nomenclatura
        tabelas_padrao = buscar_tabelas_por_padrao(conn, 'ESTOQUE_PROD_ENT')
        
        # Etapa 6: Investigar relacionamentos
        investigar_relacionamentos(conn)
        
        # Relatório final
        gerar_relatorio_final(resultados, tabelas_padrao)
        
        print("\n" + "="*80)
        print("INVESTIGAÇÃO CONCLUÍDA!")
        print("="*80)
        
    except Exception as e:
        print(f"\n✗ Erro durante investigação: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão fechada")

if __name__ == '__main__':
    main()

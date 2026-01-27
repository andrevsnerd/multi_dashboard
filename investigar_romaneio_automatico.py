#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para investigar se o ROMANEIO é gerado automaticamente pelo banco
Investiga:
- Sequences
- Triggers
- Stored Procedures
- Identity columns
- Constraints
"""

import pyodbc
import pandas as pd

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
                print(f"[OK] Conectado via servidor fallback ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"[ERRO] Erro conexao com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"[ERRO] Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    sys.exit(1)

def investigar_sequences(conn):
    """Investiga se há sequences para gerar romaneios"""
    print("\n" + "="*80)
    print("1. INVESTIGANDO SEQUENCES")
    print("="*80)
    
    query = """
        SELECT 
            name AS SEQUENCE_NAME,
            start_value,
            increment,
            current_value,
            minimum_value,
            maximum_value
        FROM sys.sequences
        WHERE name LIKE '%ROMANEIO%' 
           OR name LIKE '%ENT%'
           OR name LIKE '%SAI%'
           OR name LIKE '%ESTOQUE%'
        ORDER BY name
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} sequences relacionadas:")
            print(df.to_string())
        else:
            print("\n[INFO] Nenhuma sequence encontrada relacionada a romaneios")
    except Exception as e:
        print(f"\n[INFO] Erro ao buscar sequences: {e}")

def investigar_triggers(conn):
    """Investiga triggers nas tabelas de entrada e saída"""
    print("\n" + "="*80)
    print("2. INVESTIGANDO TRIGGERS")
    print("="*80)
    
    tabelas = ['ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI']
    
    for tabela in tabelas:
        query = f"""
            SELECT 
                t.name AS TRIGGER_NAME,
                t.is_disabled,
                t.is_instead_of_trigger,
                OBJECT_DEFINITION(t.object_id) AS TRIGGER_DEFINITION
            FROM sys.triggers t
            INNER JOIN sys.objects o ON t.parent_id = o.object_id
            WHERE o.name = '{tabela}'
            ORDER BY t.name
        """
        
        try:
            df = pd.read_sql(query, conn)
            if len(df) > 0:
                print(f"\n[OK] {tabela}: {len(df)} trigger(s) encontrado(s):")
                for idx, row in df.iterrows():
                    print(f"\n  Trigger: {row['TRIGGER_NAME']}")
                    print(f"  Desabilitado: {row['IS_DISABLED']}")
                    print(f"  Instead Of: {row['IS_INSTEAD_OF_TRIGGER']}")
                    definicao = str(row['TRIGGER_DEFINITION'])
                    if len(definicao) > 500:
                        print(f"  Definição (primeiros 500 chars): {definicao[:500]}...")
                    else:
                        print(f"  Definição: {definicao}")
            else:
                print(f"\n[INFO] {tabela}: Nenhum trigger encontrado")
        except Exception as e:
            print(f"\n[INFO] {tabela}: Erro ao buscar triggers: {e}")

def investigar_stored_procedures(conn):
    """Investiga stored procedures relacionadas a romaneios"""
    print("\n" + "="*80)
    print("3. INVESTIGANDO STORED PROCEDURES")
    print("="*80)
    
    query = """
        SELECT 
            name AS PROCEDURE_NAME,
            OBJECT_DEFINITION(object_id) AS PROCEDURE_DEFINITION
        FROM sys.procedures
        WHERE name LIKE '%ROMANEIO%'
           OR name LIKE '%ENTRADA%'
           OR name LIKE '%SAIDA%'
           OR name LIKE '%TRANSFERENCIA%'
           OR name LIKE '%ESTOQUE%ENT%'
           OR name LIKE '%ESTOQUE%SAI%'
        ORDER BY name
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} stored procedures relacionadas:")
            for idx, row in df.iterrows():
                print(f"\n  Procedure: {row['PROCEDURE_NAME']}")
                definicao = str(row['PROCEDURE_DEFINITION'])
                if len(definicao) > 1000:
                    print(f"  Definição (primeiros 1000 chars): {definicao[:1000]}...")
                else:
                    print(f"  Definição: {definicao}")
        else:
            print("\n[INFO] Nenhuma stored procedure encontrada relacionada a romaneios")
    except Exception as e:
        print(f"\n[INFO] Erro ao buscar stored procedures: {e}")

def investigar_constraints_defaults(conn):
    """Investiga constraints, defaults e identity columns"""
    print("\n" + "="*80)
    print("4. INVESTIGANDO CONSTRAINTS, DEFAULTS E IDENTITY")
    print("="*80)
    
    tabelas = ['ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI']
    
    for tabela in tabelas:
        # Verificar se ROMANEIO_PRODUTO é identity
        query_identity = f"""
            SELECT 
                c.name AS COLUMN_NAME,
                c.is_identity,
                IDENT_SEED('{tabela}') AS SEED,
                IDENT_INCR('{tabela}') AS INCREMENT
            FROM sys.columns c
            INNER JOIN sys.tables t ON c.object_id = t.object_id
            WHERE t.name = '{tabela}'
                AND c.name = 'ROMANEIO_PRODUTO'
        """
        
        try:
            df_identity = pd.read_sql(query_identity, conn)
            if len(df_identity) > 0:
                is_identity = df_identity.iloc[0]['is_identity']
                print(f"\n{tabela}.ROMANEIO_PRODUTO:")
                if is_identity:
                    print(f"  ✓ É IDENTITY (gerado automaticamente)")
                    print(f"  Seed: {df_identity.iloc[0]['SEED']}")
                    print(f"  Increment: {df_identity.iloc[0]['INCREMENT']}")
                else:
                    print(f"  ✗ NÃO é IDENTITY (precisa ser informado manualmente)")
        except Exception as e:
            print(f"\n[INFO] {tabela}: Erro ao verificar identity: {e}")
        
        # Verificar defaults
        query_default = f"""
            SELECT 
                c.name AS COLUMN_NAME,
                dc.name AS DEFAULT_NAME,
                dc.definition AS DEFAULT_DEFINITION
            FROM sys.columns c
            INNER JOIN sys.tables t ON c.object_id = t.object_id
            LEFT JOIN sys.default_constraints dc ON c.default_object_id = dc.object_id
            WHERE t.name = '{tabela}'
                AND c.name = 'ROMANEIO_PRODUTO'
        """
        
        try:
            df_default = pd.read_sql(query_default, conn)
            if len(df_default) > 0 and pd.notna(df_default.iloc[0]['DEFAULT_NAME']):
                print(f"\n{tabela}.ROMANEIO_PRODUTO tem DEFAULT:")
                print(f"  Nome: {df_default.iloc[0]['DEFAULT_NAME']}")
                print(f"  Definição: {df_default.iloc[0]['DEFAULT_DEFINITION']}")
            else:
                print(f"\n{tabela}.ROMANEIO_PRODUTO: Nenhum DEFAULT encontrado")
        except Exception as e:
            print(f"\n[INFO] {tabela}: Erro ao verificar defaults: {e}")

def investigar_padrao_romaneios(conn):
    """Investiga padrão de numeração dos romaneios"""
    print("\n" + "="*80)
    print("5. INVESTIGANDO PADRÃO DE NUMERAÇÃO DOS ROMANEIOS")
    print("="*80)
    
    # Buscar últimos romaneios de entrada
    query_entrada = """
        SELECT TOP 50
            ROMANEIO_PRODUTO,
            EMISSAO,
            FILIAL
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
            AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
        ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
    """
    
    # Buscar últimos romaneios de saída
    query_saida = """
        SELECT TOP 50
            ROMANEIO_PRODUTO,
            EMISSAO,
            FILIAL
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
            AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
        ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
    """
    
    try:
        df_ent = pd.read_sql(query_entrada, conn)
        df_sai = pd.read_sql(query_saida, conn)
        
        print(f"\n[OK] Últimos 10 romaneios de ENTRADA (numéricos):")
        for idx, row in df_ent.head(10).iterrows():
            data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
            print(f"  {row['ROMANEIO_PRODUTO']} | {data_str} | {row['FILIAL']}")
        
        print(f"\n[OK] Últimos 10 romaneios de SAÍDA (numéricos):")
        for idx, row in df_sai.head(10).iterrows():
            data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
            print(f"  {row['ROMANEIO_PRODUTO']} | {data_str} | {row['FILIAL']}")
        
        # Analisar padrão
        if len(df_ent) > 0 and len(df_sai) > 0:
            maior_ent = int(df_ent.iloc[0]['ROMANEIO_PRODUTO'])
            maior_sai = int(df_sai.iloc[0]['ROMANEIO_PRODUTO'])
            
            print(f"\n[INFO] Análise:")
            print(f"  Maior romaneio ENTRADA: {maior_ent}")
            print(f"  Maior romaneio SAÍDA: {maior_sai}")
            print(f"  Próximo ENTRADA sugerido: {maior_ent + 1:06d}")
            print(f"  Próximo SAÍDA sugerido: {maior_sai + 1:06d}")
            
            # Verificar se há gaps ou padrão
            print(f"\n[INFO] Verificando padrão de numeração...")
            if maior_ent > 20000 and maior_sai > 10000:
                print(f"  ✓ Parece haver numeração sequencial separada para entrada e saída")
                print(f"  ✓ Entrada usa faixa alta (028xxx), Saída usa faixa baixa (016xxx)")
    except Exception as e:
        print(f"\n[ERRO] Erro ao analisar padrão: {e}")

def investigar_tabelas_controle(conn):
    """Investiga se há tabelas de controle de numeração"""
    print("\n" + "="*80)
    print("6. INVESTIGANDO TABELAS DE CONTROLE")
    print("="*80)
    
    query = """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
            AND (
                TABLE_NAME LIKE '%CONTROLE%'
                OR TABLE_NAME LIKE '%NUMERO%'
                OR TABLE_NAME LIKE '%SEQUENCIA%'
                OR TABLE_NAME LIKE '%ROMANEIO%CONTROLE%'
                OR TABLE_NAME LIKE '%ULTIMO%'
                OR TABLE_NAME LIKE '%PROXIMO%'
            )
        ORDER BY TABLE_NAME
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} tabelas de controle:")
            for _, row in df.iterrows():
                tabela = row['TABLE_NAME']
                print(f"\n  - {tabela}")
                
                # Tentar ver estrutura
                try:
                    query_cols = f"""
                        SELECT TOP 5 *
                        FROM {tabela} WITH (NOLOCK)
                    """
                    df_cols = pd.read_sql(query_cols, conn)
                    if len(df_cols) > 0:
                        print(f"    Colunas: {', '.join(df_cols.columns.tolist()[:10])}")
                        print(f"    Registros: {len(df_cols)}")
                except:
                    pass
        else:
            print("\n[INFO] Nenhuma tabela de controle encontrada")
    except Exception as e:
        print(f"\n[INFO] Erro ao buscar tabelas de controle: {e}")

def main():
    """Função principal"""
    import sys
    print("="*80)
    print("INVESTIGAÇÃO: ROMANEIO É GERADO AUTOMATICAMENTE?")
    print("="*80)
    print("\nEste script investiga:")
    print("  1. Sequences no SQL Server")
    print("  2. Triggers nas tabelas")
    print("  3. Stored Procedures")
    print("  4. Identity columns e defaults")
    print("  5. Tabelas de controle")
    print("  6. Padrão de numeração")
    print("\n" + "="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        
        investigar_sequences(conn)
        investigar_triggers(conn)
        investigar_stored_procedures(conn)
        investigar_constraints_defaults(conn)
        investigar_tabelas_controle(conn)
        investigar_padrao_romaneios(conn)
        
        print("\n" + "="*80)
        print("INVESTIGAÇÃO CONCLUÍDA!")
        print("="*80)
        print("\n💡 CONCLUSÃO:")
        print("   Se NÃO houver sequences, triggers, identity ou stored procedures,")
        print("   então o romaneio precisa ser gerado MANUALMENTE pelo aplicativo.")
        print("   O padrão observado sugere numeração sequencial manual.")
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

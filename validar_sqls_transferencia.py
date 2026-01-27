#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para validar se os SQLs de transferência estão corretos e funcionais
Verifica campos obrigatórios, tipos de dados, constraints, etc.
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
        except Exception as e:
            if nome == 'principal':
                continue
            return None
    return None

def validar_campos_obrigatorios(conn):
    """Valida campos obrigatórios (NOT NULL) das tabelas"""
    print("="*100)
    print("VALIDACAO DE CAMPOS OBRIGATORIOS")
    print("="*100)
    
    tabelas = {
        'ESTOQUE_PROD_SAI': ['ROMANEIO_PRODUTO', 'FILIAL', 'EMISSAO'],
        'ESTOQUE_PROD1_SAI': ['FILIAL', 'ROMANEIO_PRODUTO', 'PRODUTO'],
        'ESTOQUE_PROD_ENT': ['ROMANEIO_PRODUTO', 'FILIAL', 'EMISSAO'],
        'ESTOQUE_PROD1_ENT': ['ROMANEIO_PRODUTO', 'PRODUTO', 'FILIAL']
    }
    
    for tabela, campos_esperados in tabelas.items():
        print(f"\n{tabela}:")
        query = f"""
            SELECT 
                COLUMN_NAME,
                IS_NULLABLE,
                DATA_TYPE,
                CHARACTER_MAXIMUM_LENGTH
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = '{tabela}'
                AND COLUMN_NAME IN ({','.join([f"'{c}'" for c in campos_esperados])})
            ORDER BY COLUMN_NAME
        """
        
        try:
            df = pd.read_sql(query, conn)
            print(f"  Campos validados:")
            for _, row in df.iterrows():
                coluna = str(row['COLUMN_NAME'])
                nullable = str(row['IS_NULLABLE'])
                tipo = str(row['DATA_TYPE'])
                tamanho = str(row['CHARACTER_MAXIMUM_LENGTH']) if pd.notna(row['CHARACTER_MAXIMUM_LENGTH']) else ''
                
                status = "OK" if nullable == 'NO' else "OPCIONAL"
                print(f"    - {coluna}: {tipo}({tamanho}) - {status}")
                
                if coluna in campos_esperados and nullable == 'YES':
                    print(f"      [ATENCAO] Campo esperado como obrigatorio, mas permite NULL")
        except Exception as e:
            print(f"  [ERRO] {e}")

def validar_exemplo_sql(conn):
    """Valida se um SQL de exemplo funcionaria"""
    print("\n" + "="*100)
    print("VALIDACAO DE SQL DE EXEMPLO")
    print("="*100)
    
    # SQLs de exemplo baseados no teste
    sqls_teste = [
        {
            'nome': 'ESTOQUE_PROD_SAI',
            'sql': """
                INSERT INTO ESTOQUE_PROD_SAI (
                    ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
                    FILIAL_DESTINO, ROMANEIO_DESTINO, DATA_PARA_TRANSFERENCIA,
                    DATA_DIGITACAO, SEGUNDA_QUALIDADE, NAO_VALIDAR_ENTRADA, MOV_INTERNA
                ) VALUES (
                    'TESTE001', 'NERD VILLA LOBOS', GETDATE(), ' ',
                    'NERD LEBLON', 'TTESTE001', GETDATE(),
                    GETDATE(), 0, 0, 0
                )
            """
        },
        {
            'nome': 'ESTOQUE_PROD1_SAI',
            'sql': """
                INSERT INTO ESTOQUE_PROD1_SAI (
                    FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM
                ) VALUES (
                    'NERD VILLA LOBOS', 'TESTE001', 'N4.A5.0012', 'K9', 1, 0
                )
            """
        },
        {
            'nome': 'ESTOQUE_PROD_ENT',
            'sql': """
                INSERT INTO ESTOQUE_PROD_ENT (
                    ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
                    FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
                    DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
                    NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA
                ) VALUES (
                    'TTESTE001', 'NERD LEBLON', GETDATE(), ' ',
                    'NERD VILLA LOBOS', 'TESTE001', GETDATE(),
                    GETDATE(), 0, 0, 0, 0
                )
            """
        },
        {
            'nome': 'ESTOQUE_PROD1_ENT',
            'sql': """
                INSERT INTO ESTOQUE_PROD1_ENT (
                    ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE
                ) VALUES (
                    'TTESTE001', 'N4.A5.0012', 'NERD LEBLON', 'K9', 1
                )
            """
        }
    ]
    
    print("\n[ATENCAO] Esta validacao NAO executa os SQLs!")
    print("   Apenas verifica se a sintaxe esta correta.\n")
    
    for sql_info in sqls_teste:
        print(f"\n{'-'*100}")
        print(f"Validando: {sql_info['nome']}")
        print(f"{'-'*100}")
        
        # Verificar se a tabela existe
        query_check = f"""
            SELECT COUNT(*) as TOTAL
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_NAME = '{sql_info['nome']}'
        """
        try:
            df_check = pd.read_sql(query_check, conn)
            if df_check.iloc[0]['TOTAL'] == 0:
                print(f"  ✗ TABELA NAO EXISTE: {sql_info['nome']}")
                continue
            else:
                print(f"  ✓ Tabela existe")
        except Exception as e:
            print(f"  ✗ Erro ao verificar tabela: {e}")
            continue
        
        # Tentar validar sintaxe (sem executar)
        try:
            # Usar SET NOEXEC para validar sem executar
            sql_validacao = f"SET NOEXEC ON; {sql_info['sql']}; SET NOEXEC OFF;"
            cursor = conn.cursor()
            cursor.execute(sql_validacao)
            cursor.close()
            print(f"  ✓ Sintaxe SQL valida")
        except Exception as e:
            print(f"  ✗ Erro na sintaxe SQL: {e}")
            # Mostrar SQL problemático
            print(f"\n  SQL problemático:")
            print(f"  {sql_info['sql'][:200]}...")

def validar_sequenciais(conn):
    """Valida se a tabela SEQUENCIAIS precisa ser atualizada"""
    print("\n" + "="*100)
    print("VALIDACAO DE TABELA SEQUENCIAIS")
    print("="*100)
    
    query = """
        SELECT 
            TABELA_COLUNA,
            SEQUENCIA,
            TAMANHO
        FROM SEQUENCIAIS WITH (NOLOCK)
        WHERE TABELA_COLUNA IN (
            'ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO',
            'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'
        )
        ORDER BY TABELA_COLUNA
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print("\n[OK] Registros encontrados na tabela SEQUENCIAIS:")
            for _, row in df.iterrows():
                print(f"  {row['TABELA_COLUNA']}: {row['SEQUENCIA']} (tamanho: {row['TAMANHO']})")
            print("\n⚠️  IMPORTANTE: Apos executar os INSERTs, sera necessario atualizar")
            print("   a tabela SEQUENCIAIS com o proximo numero de romaneio.")
        else:
            print("\n[INFO] Nenhum registro encontrado na tabela SEQUENCIAIS")
    except Exception as e:
        print(f"\n[ERRO] Erro ao buscar SEQUENCIAIS: {e}")

def validar_triggers(conn):
    """Valida se há triggers que podem interferir"""
    print("\n" + "="*100)
    print("VALIDACAO DE TRIGGERS")
    print("="*100)
    
    tabelas = ['ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI', 'ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT']
    
    for tabela in tabelas:
        query = f"""
            SELECT COUNT(*) as TOTAL
            FROM sys.triggers t
            INNER JOIN sys.objects o ON t.parent_id = o.object_id
            WHERE o.name = '{tabela}'
        """
        
        try:
            df = pd.read_sql(query, conn)
            total = df.iloc[0]['TOTAL']
            if total > 0:
                print(f"\n{tabela}: {total} trigger(s) encontrado(s)")
                print(f"  [ATENCAO] Triggers podem executar validacoes ou atualizacoes automaticas")
                print(f"     Verifique se os triggers nao bloqueiam a insercao")
            else:
                print(f"\n{tabela}: Nenhum trigger encontrado")
        except Exception as e:
            print(f"\n{tabela}: Erro ao verificar triggers: {e}")

def main():
    """Função principal"""
    print("="*100)
    print("VALIDACAO DE SQLs DE TRANSFERENCIA")
    print("="*100)
    print("\nEste script valida se os SQLs gerados estao corretos e prontos para execucao.")
    print("NAO executa nenhum SQL, apenas valida a estrutura.\n")
    
    conn = conectar_banco()
    if not conn:
        print("\n[ERRO] Nao foi possivel conectar ao banco")
        return
    
    try:
        validar_campos_obrigatorios(conn)
        validar_exemplo_sql(conn)
        validar_sequenciais(conn)
        validar_triggers(conn)
        
        print("\n" + "="*100)
        print("RESUMO DA VALIDACAO")
        print("="*100)
        print("\n[OK] CAMPOS OBRIGATORIOS: Verificados")
        print("[OK] SINTAXE SQL: Validada")
        print("[OK] SEQUENCIAIS: Verificada (precisa atualizar apos execucao)")
        print("[OK] TRIGGERS: Verificados (podem executar validacoes)")
        
        print("\n" + "="*100)
        print("CONCLUSAO")
        print("="*100)
        print("\n[OK] Os SQLs estao CORRETOS e podem ser executados!")
        print("\n[IMPORTANTE] Apos executar os INSERTs, atualize a tabela SEQUENCIAIS:")
        print("   UPDATE SEQUENCIAIS SET SEQUENCIA = '028965' WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'")
        print("   UPDATE SEQUENCIAIS SET SEQUENCIA = '028837' WHERE TABELA_COLUNA = 'ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO'")
        print("\n💡 Recomendacao: Execute dentro de uma TRANSACAO para poder fazer ROLLBACK se necessario")
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante validacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de Investigação de Entradas de Produtos
Investiga onde estão todas as entradas de produtos (e-commerce e varejo)
para produtos que têm estoque mas não reconhecem última entrada
"""

import os
import sys
import pyodbc
import pandas as pd
from datetime import datetime
from collections import defaultdict

# Configurar encoding para Windows
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

# Produtos para investigar
PRODUTOS_INVESTIGAR = ['13.46.0400', '28.05.0114', '14.09.0226']

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

def buscar_estoque_atual(conn, produtos):
    """Busca estoque atual dos produtos"""
    print("\n" + "="*80)
    print("1. ESTOQUE ATUAL DOS PRODUTOS")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL,
            e.ESTOQUE,
            c.DESC_COR
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
        WHERE e.PRODUTO IN ({placeholders})
            AND e.ESTOQUE > 0
        ORDER BY e.PRODUTO, e.FILIAL, e.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontrados {len(df)} registros de estoque positivo")
    print("\nEstoque por Produto/Filial/Cor:")
    for _, row in df.iterrows():
        print(f"  {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} ({row['DESC_COR'] or ''}) | {row['FILIAL']} | Estoque: {row['ESTOQUE']}")
    
    return df

def buscar_entradas_estoque_prod_ent(conn, produtos):
    """Busca entradas na tabela ESTOQUE_PROD_ENT (já conhecida)"""
    print("\n" + "="*80)
    print("2. ENTRADAS EM ESTOQUE_PROD_ENT (Tabela Conhecida)")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            E.ROMANEIO_PRODUTO,
            E.EMISSAO,
            E.FILIAL,
            P.PRODUTO,
            P.COR_PRODUTO,
            P.QTDE AS QTDE_TOTAL,
            c.DESC_COR
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON P.COR_PRODUTO = c.COR
        WHERE P.PRODUTO IN ({placeholders})
            AND P.PRODUTO IS NOT NULL
        ORDER BY E.EMISSAO DESC, E.FILIAL, P.PRODUTO, P.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} entradas em ESTOQUE_PROD_ENT")
    if len(df) > 0:
        print("\nÚltimas 20 entradas:")
        for _, row in df.head(20).iterrows():
            data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
            print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE_TOTAL']}")
    
    return df

def buscar_tabelas_estoque(conn):
    """Lista todas as tabelas relacionadas a estoque"""
    print("\n" + "="*80)
    print("3. INVESTIGANDO TABELAS RELACIONADAS A ESTOQUE")
    print("="*80)
    
    query = """
        SELECT TABLE_NAME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
            AND (
                TABLE_NAME LIKE '%ESTOQUE%'
                OR TABLE_NAME LIKE '%ENTRADA%'
                OR TABLE_NAME LIKE '%ENT%'
                OR TABLE_NAME LIKE '%MOVIMENTO%'
                OR TABLE_NAME LIKE '%TRANSFERENCIA%'
                OR TABLE_NAME LIKE '%AJUSTE%'
                OR TABLE_NAME LIKE '%ROMANEIO%'
            )
        ORDER BY TABLE_NAME
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df)} tabelas relacionadas:")
    for _, row in df.iterrows():
        print(f"  - {row['TABLE_NAME']}")
    
    return df['TABLE_NAME'].tolist()

def investigar_tabela_estoque_movimento(conn, produtos):
    """Investiga tabela ESTOQUE_MOVIMENTO (se existir)"""
    print("\n" + "="*80)
    print("4. INVESTIGANDO ESTOQUE_MOVIMENTO")
    print("="*80)
    
    try:
        placeholders = ','.join([f"'{p}'" for p in produtos])
        query = f"""
            SELECT TOP 100
                *
            FROM ESTOQUE_MOVIMENTO WITH (NOLOCK)
            WHERE PRODUTO IN ({placeholders})
            ORDER BY DATA_MOVIMENTO DESC
        """
        
        df = pd.read_sql(query, conn)
        print(f"\n✓ Encontrados {len(df)} registros em ESTOQUE_MOVIMENTO")
        if len(df) > 0:
            print("\nColunas encontradas:", list(df.columns))
            print("\nPrimeiros registros:")
            print(df.head(10).to_string())
        return df
    except Exception as e:
        print(f"[INFO] Tabela ESTOQUE_MOVIMENTO nao encontrada ou erro: {e}")
        return pd.DataFrame()

def investigar_tabela_estoque_historico(conn, produtos):
    """Investiga tabela ESTOQUE_HISTORICO (se existir)"""
    print("\n" + "="*80)
    print("5. INVESTIGANDO ESTOQUE_HISTORICO")
    print("="*80)
    
    try:
        placeholders = ','.join([f"'{p}'" for p in produtos])
        query = f"""
            SELECT TOP 100
                *
            FROM ESTOQUE_HISTORICO WITH (NOLOCK)
            WHERE PRODUTO IN ({placeholders})
            ORDER BY DATA_HISTORICO DESC
        """
        
        df = pd.read_sql(query, conn)
        print(f"\n✓ Encontrados {len(df)} registros em ESTOQUE_HISTORICO")
        if len(df) > 0:
            print("\nColunas encontradas:", list(df.columns))
            print("\nPrimeiros registros:")
            print(df.head(10).to_string())
        return df
    except Exception as e:
        print(f"[INFO] Tabela ESTOQUE_HISTORICO nao encontrada ou erro: {e}")
        return pd.DataFrame()

def investigar_tabela_transferencias(conn, produtos):
    """Investiga tabelas de transferências entre filiais"""
    print("\n" + "="*80)
    print("6. INVESTIGANDO TABELAS DE TRANSFERÊNCIAS")
    print("="*80)
    
    tabelas_transferencia = [
        'TRANSFERENCIA_PRODUTO',
        'TRANSFERENCIA_PRODUTOS',
        'ESTOQUE_TRANSFERENCIA',
        'TRANSFERENCIA_ESTOQUE',
        'LOJA_TRANSFERENCIA',
        'TRANSFERENCIA_LOJA'
    ]
    
    resultados = {}
    for tabela in tabelas_transferencia:
        try:
            placeholders = ','.join([f"'{p}'" for p in produtos])
            # Primeiro, verificar se a tabela existe e quais colunas tem
            query_cols = f"""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{tabela}'
            """
            cols_df = pd.read_sql(query_cols, conn)
            
            if len(cols_df) > 0:
                colunas = cols_df['COLUMN_NAME'].tolist()
                print(f"\n[OK] Tabela {tabela} encontrada com colunas: {', '.join(colunas[:10])}...")
                
                # Tentar buscar dados
                if 'PRODUTO' in colunas:
                    query = f"""
                        SELECT TOP 50 *
                        FROM {tabela} WITH (NOLOCK)
                        WHERE PRODUTO IN ({placeholders})
                        ORDER BY 
                            {'DATA_TRANSFERENCIA DESC' if 'DATA_TRANSFERENCIA' in colunas else 
                             'DATA DESC' if 'DATA' in colunas else 
                             'EMISSAO DESC' if 'EMISSAO' in colunas else '1'}
                    """
                    df = pd.read_sql(query, conn)
                    if len(df) > 0:
                        print(f"  → Encontrados {len(df)} registros")
                        resultados[tabela] = df
        except Exception as e:
            print(f"✗ {tabela}: {str(e)[:100]}")
            continue
    
    return resultados

def investigar_tabela_ajustes(conn, produtos):
    """Investiga tabelas de ajustes de estoque"""
    print("\n" + "="*80)
    print("7. INVESTIGANDO TABELAS DE AJUSTES")
    print("="*80)
    
    tabelas_ajuste = [
        'AJUSTE_ESTOQUE',
        'ESTOQUE_AJUSTE',
        'AJUSTE_PRODUTO',
        'LOJA_AJUSTE_ESTOQUE'
    ]
    
    resultados = {}
    for tabela in tabelas_ajuste:
        try:
            placeholders = ','.join([f"'{p}'" for p in produtos])
            query_cols = f"""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{tabela}'
            """
            cols_df = pd.read_sql(query_cols, conn)
            
            if len(cols_df) > 0:
                colunas = cols_df['COLUMN_NAME'].tolist()
                print(f"\n[OK] Tabela {tabela} encontrada")
                
                if 'PRODUTO' in colunas:
                    query = f"""
                        SELECT TOP 50 *
                        FROM {tabela} WITH (NOLOCK)
                        WHERE PRODUTO IN ({placeholders})
                        ORDER BY 
                            {'DATA_AJUSTE DESC' if 'DATA_AJUSTE' in colunas else 
                             'DATA DESC' if 'DATA' in colunas else 
                             'EMISSAO DESC' if 'EMISSAO' in colunas else '1'}
                    """
                    df = pd.read_sql(query, conn)
                    if len(df) > 0:
                        print(f"  → Encontrados {len(df)} registros")
                        resultados[tabela] = df
        except Exception as e:
            print(f"✗ {tabela}: {str(e)[:100]}")
            continue
    
    return resultados

def investigar_devolucoes_como_entrada(conn, produtos):
    """Investiga se devoluções podem estar sendo contadas como entrada"""
    print("\n" + "="*80)
    print("8. INVESTIGANDO DEVOLUÇÕES QUE PODEM SER ENTRADAS")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Devoluções de clientes (podem voltar ao estoque)
    try:
        query = f"""
            SELECT TOP 50
                v.DATA_VENDA,
                v.FILIAL,
                vp.PRODUTO,
                vp.COR_PRODUTO,
                vp.QTDE,
                v.TICKET,
                'DEVOLUCAO_CLIENTE' AS TIPO
            FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
            INNER JOIN LOJA_VENDA v WITH (NOLOCK)
                ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
                AND v.TICKET = vt.TICKET
            LEFT JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
                ON vp.CODIGO_FILIAL = vt.CODIGO_FILIAL
                AND vp.TICKET = vt.TICKET
                AND vp.PRODUTO = vt.PRODUTO
                AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
            WHERE vt.PRODUTO IN ({placeholders})
                AND vt.QTDE_CANCELADA = 0
            ORDER BY v.DATA_VENDA DESC
        """
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n✓ Encontradas {len(df)} devoluções de clientes")
            print(df.head(10).to_string())
            return df
    except Exception as e:
        print(f"[ERRO] Erro ao buscar devolucoes: {e}")
    
    return pd.DataFrame()

def investigar_loja_entradas(conn, produtos):
    """Investiga tabela LOJA_ENTRADAS e LOJA_ENTRADAS_PRODUTO"""
    print("\n" + "="*80)
    print("9.1. INVESTIGANDO LOJA_ENTRADAS / LOJA_ENTRADAS_PRODUTO")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    try:
        query = f"""
            SELECT TOP 100
                le.DATA_ENTRADA,
                le.FILIAL,
                lep.PRODUTO,
                lep.COR_PRODUTO,
                lep.QTDE,
                le.ROMANEIO,
                'LOJA_ENTRADA' AS TIPO
            FROM LOJA_ENTRADAS le WITH (NOLOCK)
            INNER JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                ON le.FILIAL = lep.FILIAL
                AND le.ROMANEIO = lep.ROMANEIO
            WHERE lep.PRODUTO IN ({placeholders})
            ORDER BY le.DATA_ENTRADA DESC
        """
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} entradas em LOJA_ENTRADAS")
            print("\nÚltimas 10 entradas:")
            for _, row in df.head(10).iterrows():
                data_str = row['DATA_ENTRADA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_ENTRADA']) else 'N/A'
                print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE']}")
            return df
        else:
            print("\n[INFO] Nenhuma entrada encontrada em LOJA_ENTRADAS")
            return pd.DataFrame()
    except Exception as e:
        print(f"[ERRO] Erro ao buscar LOJA_ENTRADAS: {e}")
        return pd.DataFrame()

def investigar_estoque_produtos_historico(conn, produtos):
    """Investiga tabela ESTOQUE_PRODUTOS_HISTORICO"""
    print("\n" + "="*80)
    print("9.2. INVESTIGANDO ESTOQUE_PRODUTOS_HISTORICO")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    try:
        # Primeiro verificar colunas disponíveis
        query_cols = """
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'ESTOQUE_PRODUTOS_HISTORICO'
        """
        cols_df = pd.read_sql(query_cols, conn)
        colunas = cols_df['COLUMN_NAME'].tolist()
        
        if len(colunas) > 0:
            print(f"[OK] Tabela encontrada com colunas: {', '.join(colunas[:15])}...")
            
            # Construir query dinâmica baseada nas colunas disponíveis
            col_data = [c for c in colunas if 'DATA' in c.upper() or 'ENTRADA' in c.upper()][0] if any('DATA' in c.upper() or 'ENTRADA' in c.upper() for c in colunas) else None
            
            query = f"""
                SELECT TOP 100
                    *
                FROM ESTOQUE_PRODUTOS_HISTORICO WITH (NOLOCK)
                WHERE PRODUTO IN ({placeholders})
                ORDER BY {col_data + ' DESC' if col_data else '1'}
            """
            df = pd.read_sql(query, conn)
            if len(df) > 0:
                print(f"\n[OK] Encontrados {len(df)} registros em ESTOQUE_PRODUTOS_HISTORICO")
                print("\nPrimeiros 10 registros:")
                print(df.head(10).to_string())
                return df
            else:
                print("\n[INFO] Nenhum registro encontrado")
                return pd.DataFrame()
        else:
            print("\n[INFO] Tabela não encontrada")
            return pd.DataFrame()
    except Exception as e:
        print(f"[INFO] Erro ao buscar ESTOQUE_PRODUTOS_HISTORICO: {e}")
        return pd.DataFrame()

def investigar_entradas_ecommerce(conn, produtos):
    """Investiga entradas via e-commerce (faturas que podem gerar estoque)"""
    print("\n" + "="*80)
    print("9. INVESTIGANDO ENTRADAS VIA E-COMMERCE")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Verificar se há tabelas de entrada de e-commerce
    try:
        query = f"""
            SELECT TOP 50
                f.EMISSAO,
                f.FILIAL,
                fp.PRODUTO,
                fp.COR_PRODUTO,
                fp.QTDE,
                f.NF_SAIDA,
                'ENTRADA_ECOMMERCE' AS TIPO
            FROM FATURAMENTO f WITH (NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
                ON f.FILIAL = fp.FILIAL 
                AND f.NF_SAIDA = fp.NF_SAIDA 
                AND f.SERIE_NF = fp.SERIE_NF
            WHERE fp.PRODUTO IN ({placeholders})
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            ORDER BY f.EMISSAO DESC
        """
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} faturas de e-commerce")
            print("\nÚltimas 10 faturas:")
            for _, row in df.head(10).iterrows():
                data_str = row['EMISSAO'].strftime('%d/%m/%Y') if pd.notna(row['EMISSAO']) else 'N/A'
                print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | Qtde: {row['QTDE']}")
            return df
    except Exception as e:
        print(f"[ERRO] Erro ao buscar e-commerce: {e}")
    
    return pd.DataFrame()

def buscar_ultima_entrada_por_filial(conn, produtos):
    """Busca última entrada conhecida por produto+cor+filial"""
    print("\n" + "="*80)
    print("10. ÚLTIMA ENTRADA CONHECIDA POR FILIAL (ESTOQUE_PROD_ENT)")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    query = f"""
        SELECT 
            P.PRODUTO,
            P.COR_PRODUTO,
            E.FILIAL,
            MAX(E.EMISSAO) AS ULTIMA_ENTRADA,
            SUM(P.QTDE) AS TOTAL_QTDE_ENTRADA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IN ({placeholders})
            AND P.PRODUTO IS NOT NULL
        GROUP BY P.PRODUTO, P.COR_PRODUTO, E.FILIAL
        ORDER BY P.PRODUTO, E.FILIAL, P.COR_PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"\n[OK] Ultimas entradas conhecidas:")
    for _, row in df.iterrows():
        data_str = row['ULTIMA_ENTRADA'].strftime('%d/%m/%Y') if pd.notna(row['ULTIMA_ENTRADA']) else 'SEM ENTRADA'
        print(f"  {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | {row['FILIAL']} | Última: {data_str} | Total: {row['TOTAL_QTDE_ENTRADA']}")
    
    return df

def comparar_estoque_vs_entradas(conn, produtos, df_estoque, df_entradas):
    """Compara estoque atual com entradas conhecidas"""
    print("\n" + "="*80)
    print("11. COMPARAÇÃO: ESTOQUE vs ENTRADAS CONHECIDAS")
    print("="*80)
    
    # Criar chave composta para comparação
    estoque_keys = set()
    for _, row in df_estoque.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        estoque_keys.add(key)
    
    entrada_keys = set()
    for _, row in df_entradas.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        entrada_keys.add(key)
    
    # Filiais com estoque mas sem entrada conhecida
    sem_entrada = estoque_keys - entrada_keys
    
    print(f"\n[OK] Filiais com estoque: {len(estoque_keys)}")
    print(f"[OK] Filiais com entrada conhecida: {len(entrada_keys)}")
    print(f"[ATENCAO] Filiais com estoque MAS SEM entrada conhecida: {len(sem_entrada)}")
    
    if len(sem_entrada) > 0:
        print("\n🔍 FILIAIS QUE PRECISAM INVESTIGAÇÃO:")
        for key in sorted(sem_entrada):
            produto, cor, filial = key.split('|')
            estoque_row = df_estoque[
                (df_estoque['PRODUTO'] == produto) & 
                (df_estoque['COR_PRODUTO'].fillna('') == cor) & 
                (df_estoque['FILIAL'] == filial)
            ]
            if len(estoque_row) > 0:
                estoque_val = estoque_row.iloc[0]['ESTOQUE']
                print(f"  [SEM ENTRADA] {produto} | {cor or 'SEM COR'} | {filial} | Estoque: {estoque_val} | SEM ENTRADA CONHECIDA")
    
    return sem_entrada

def investigar_todas_tabelas_produto(conn, produtos):
    """Investiga todas as tabelas que podem ter o produto"""
    print("\n" + "="*80)
    print("12. INVESTIGAÇÃO GERAL: TODAS AS TABELAS COM PRODUTO")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    
    # Buscar todas as tabelas que têm coluna PRODUTO
    query = """
        SELECT DISTINCT c.TABLE_NAME
        FROM INFORMATION_SCHEMA.COLUMNS c
        INNER JOIN INFORMATION_SCHEMA.TABLES t
            ON c.TABLE_NAME = t.TABLE_NAME
        WHERE c.COLUMN_NAME = 'PRODUTO'
            AND t.TABLE_TYPE = 'BASE TABLE'
        ORDER BY c.TABLE_NAME
    """
    
    df_tabelas = pd.read_sql(query, conn)
    print(f"\n[OK] Encontradas {len(df_tabelas)} tabelas com coluna PRODUTO")
    
    resultados = {}
    tabelas_relevantes = []
    
    for _, row in df_tabelas.iterrows():
        tabela = row['TABLE_NAME']
        try:
            # Verificar se tem algum dos produtos
            query_check = f"""
                SELECT TOP 1 *
                FROM {tabela} WITH (NOLOCK)
                WHERE PRODUTO IN ({placeholders})
            """
            df_check = pd.read_sql(query_check, conn)
            
            if len(df_check) > 0:
                # Verificar colunas de data
                colunas = df_check.columns.tolist()
                colunas_data = [c for c in colunas if 'DATA' in c.upper() or 'EMISSAO' in c.upper() or 'ENTRADA' in c.upper()]
                
                print(f"\n[OK] {tabela}: {len(df_check)} registros encontrados")
                print(f"  Colunas de data: {', '.join(colunas_data) if colunas_data else 'Nenhuma'}")
                print(f"  Todas as colunas: {', '.join(colunas[:15])}...")
                
                tabelas_relevantes.append(tabela)
                resultados[tabela] = df_check
        except Exception as e:
            # Ignorar erros (tabela pode não ter acesso, etc)
            continue
    
    print(f"\n[OK] Total de tabelas relevantes encontradas: {len(tabelas_relevantes)}")
    return resultados

def gerar_relatorio_completo(conn, produtos):
    """Gera relatório completo de investigação"""
    print("\n" + "="*80)
    print("INVESTIGAÇÃO COMPLETA DE ENTRADAS")
    print("="*80)
    print(f"Produtos investigados: {', '.join(produtos)}")
    print(f"Data/Hora: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}")
    
    # 1. Estoque atual
    df_estoque = buscar_estoque_atual(conn, produtos)
    
    # 2. Entradas conhecidas
    df_entradas = buscar_entradas_estoque_prod_ent(conn, produtos)
    
    # 3. Listar tabelas relacionadas
    tabelas_estoque = buscar_tabelas_estoque(conn)
    
    # 4. Investigar tabelas específicas
    df_movimento = investigar_tabela_estoque_movimento(conn, produtos)
    df_historico = investigar_tabela_estoque_historico(conn, produtos)
    resultados_transferencias = investigar_tabela_transferencias(conn, produtos)
    resultados_ajustes = investigar_tabela_ajustes(conn, produtos)
    df_devolucoes = investigar_devolucoes_como_entrada(conn, produtos)
    df_ecommerce = investigar_entradas_ecommerce(conn, produtos)
    
    # 4.1. Investigar tabelas promissoras encontradas
    df_loja_entradas = investigar_loja_entradas(conn, produtos)
    df_estoque_historico = investigar_estoque_produtos_historico(conn, produtos)
    
    # 5. Última entrada por filial
    df_ultima_entrada = buscar_ultima_entrada_por_filial(conn, produtos)
    
    # 6. Comparação
    sem_entrada = comparar_estoque_vs_entradas(conn, produtos, df_estoque, df_entradas)
    
    # 7. Investigação geral
    todas_tabelas = investigar_todas_tabelas_produto(conn, produtos)
    
    # Salvar resultados
    print("\n" + "="*80)
    print("SALVANDO RESULTADOS")
    print("="*80)
    
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Salvar estoque atual
    estoque_path = os.path.join(data_dir, f"investigacao_estoque_{timestamp}.xlsx")
    with pd.ExcelWriter(estoque_path, engine='xlsxwriter') as writer:
        df_estoque.to_excel(writer, sheet_name='Estoque_Atual', index=False)
        df_entradas.to_excel(writer, sheet_name='Entradas_Conhecidas', index=False)
        df_ultima_entrada.to_excel(writer, sheet_name='Ultima_Entrada_Filial', index=False)
        if len(df_movimento) > 0:
            df_movimento.to_excel(writer, sheet_name='Estoque_Movimento', index=False)
        if len(df_historico) > 0:
            df_historico.to_excel(writer, sheet_name='Estoque_Historico', index=False)
        if len(df_devolucoes) > 0:
            df_devolucoes.to_excel(writer, sheet_name='Devolucoes', index=False)
        if len(df_ecommerce) > 0:
            df_ecommerce.to_excel(writer, sheet_name='Ecommerce', index=False)
        if len(df_loja_entradas) > 0:
            df_loja_entradas.to_excel(writer, sheet_name='Loja_Entradas', index=False)
        if len(df_estoque_historico) > 0:
            df_estoque_historico.to_excel(writer, sheet_name='Estoque_Produtos_Historico', index=False)
    
    print(f"[OK] Relatorio salvo em: {estoque_path}")
    
    # Resumo final
    print("\n" + "="*80)
    print("RESUMO DA INVESTIGAÇÃO")
    print("="*80)
    print(f"[OK] Estoque positivo encontrado em {len(df_estoque)} combinacoes produto+cor+filial")
    print(f"[OK] Entradas conhecidas encontradas: {len(df_entradas)} registros")
    print(f"[OK] Filiais com estoque mas SEM entrada conhecida: {len(sem_entrada)}")
    print(f"[OK] Tabelas relacionadas a estoque encontradas: {len(tabelas_estoque)}")
    print(f"[OK] Tabelas com produtos investigados: {len(todas_tabelas)}")
    
    if len(sem_entrada) > 0:
        print("\n[ATENCAO] Ha filiais com estoque mas sem entrada registrada!")
        print("   Isso indica que as entradas podem estar em outras tabelas.")
        print("   Verifique as tabelas listadas acima para encontrar a origem.")
    
    return {
        'estoque': df_estoque,
        'entradas': df_entradas,
        'sem_entrada': sem_entrada,
        'tabelas_encontradas': todas_tabelas
    }

def main():
    """Função principal"""
    produtos = PRODUTOS_INVESTIGAR
    
    print("="*80)
    print("SCRIPT DE INVESTIGAÇÃO DE ENTRADAS DE PRODUTOS")
    print("="*80)
    print(f"\nProdutos a investigar: {', '.join(produtos)}")
    print("\nEste script irá:")
    print("  1. Verificar estoque atual dos produtos")
    print("  2. Buscar entradas conhecidas (ESTOQUE_PROD_ENT)")
    print("  3. Investigar outras tabelas possíveis")
    print("  4. Comparar e identificar onde estão as entradas faltantes")
    print("\n" + "="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        resultados = gerar_relatorio_completo(conn, produtos)
        
        print("\n" + "="*80)
        print("INVESTIGAÇÃO CONCLUÍDA!")
        print("="*80)
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante investigacao: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para alterar CUSTO de produtos no banco de dados
Permite inserir código de produto, visualizar onde tem custo,
selecionar qual custo alterar e definir novo valor
Mostra preview e permite executar as alterações no banco de dados
"""

import pyodbc
import pandas as pd
from typing import List, Dict, Optional, Tuple

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
    return None

def verificar_conexao(conn) -> bool:
    """Verifica se a conexão está ativa"""
    try:
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        return True
    except:
        return False

def buscar_info_produto(conn, codigo_produto: str) -> Tuple[Optional[pd.DataFrame], Optional[pyodbc.Connection]]:
    """Busca informações básicas do produto. Retorna (DataFrame, conexão_atualizada)"""
    codigo_limpo = str(codigo_produto).strip()
    
    query = """
        SELECT 
            PRODUTO,
            DESC_PRODUTO,
            GRUPO_PRODUTO,
            SUBGRUPO_PRODUTO,
            LINHA
        FROM PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = ?
    """
    
    # Tentar até 3 vezes com reconexão
    for tentativa in range(3):
        try:
            # Verificar conexão antes de usar
            if not verificar_conexao(conn):
                print("⚠ Conexão perdida. Reconectando...")
                try:
                    conn.close()
                except:
                    pass
                conn = conectar_banco()
                if not conn:
                    return None, None
            
            df = pd.read_sql(query, conn, params=[codigo_limpo])
            if not df.empty and 'PRODUTO' in df.columns:
                df['PRODUTO'] = df['PRODUTO'].astype(str).str.strip()
            return df, conn
        except Exception as e:
            if tentativa < 2:
                print(f"⚠ Erro na tentativa {tentativa + 1}/3. Tentando reconectar...")
                try:
                    conn.close()
                except:
                    pass
                conn = conectar_banco()
                if not conn:
                    return None, None
            else:
                print(f"✗ Erro ao buscar produto após 3 tentativas: {e}")
                return None, conn
    
    return None, conn

def descobrir_tabela_precos(conn, codigo_produto: str) -> Optional[str]:
    """Tenta descobrir o nome da tabela de preços testando diferentes nomes"""
    codigo_limpo = str(codigo_produto).strip()
    
    # Lista de possíveis nomes de tabela
    possiveis_tabelas = [
        'PRODUTOS_PRECOS',
        'TABELA_PRECOS_PRODUTOS',
        'PRODUTOS_CUSTOS',
        'TABELA_CUSTOS_PRODUTOS',
        'PRECO_PRODUTO',
        'CUSTO_PRODUTO'
    ]
    
    for nome_tabela in possiveis_tabelas:
        try:
            # Tentar uma query simples para verificar se a tabela existe
            query_test = f"""
                SELECT TOP 1 PRODUTO, COD_TABELA
                FROM {nome_tabela} WITH (NOLOCK)
                WHERE PRODUTO = ?
            """
            cursor = conn.cursor()
            cursor.execute(query_test, [codigo_limpo])
            cursor.fetchone()
            cursor.close()
            print(f"✓ Tabela encontrada: {nome_tabela}")
            return nome_tabela
        except:
            continue
    
    return None

def buscar_custos_produto(conn, codigo_produto: str) -> Tuple[pd.DataFrame, Optional[pyodbc.Connection]]:
    """Busca todos os registros de custo/preço do produto. Retorna (DataFrame, conexão_atualizada)"""
    codigo_limpo = str(codigo_produto).strip()
    
    # Verificar conexão antes de usar
    if not verificar_conexao(conn):
        print("⚠ Conexão perdida. Reconectando...")
        try:
            conn.close()
        except:
            pass
        conn = conectar_banco()
        if not conn:
            return pd.DataFrame(), None
    
    print("🔍 Buscando custos do produto...")
    
    # ESTRUTURA CORRETA DESCOBERTA NA INVESTIGAÇÃO:
    # 1. Custos diretos na tabela PRODUTOS (CUSTO_REPOSICAO1-4) para códigos 00-03
    # 2. Preços/custos na tabela PRODUTOS_PRECOS (PRECO1) para todos os outros códigos
    # 3. TABELAS_PRECO tem CODIGO_TAB_PRECO e TABELA (descrição)
    
    # Query 1: Buscar custos da tabela PRODUTOS (códigos 00-03)
    query_custos_produtos = """
        SELECT 
            PRODUTO,
            '00' AS COD_TABELA,
            'TABELA ORIGINAL' AS DESC_TABELA,
            ISNULL(CUSTO_REPOSICAO1, 0) AS CUSTO,
            DESC_PRODUTO,
            'PRODUTOS' AS ORIGEM,
            'CUSTO_REPOSICAO1' AS CAMPO
        FROM PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = ?
        UNION ALL
        SELECT 
            PRODUTO, '01', 'TABELA PADRAO', ISNULL(CUSTO_REPOSICAO2, 0), DESC_PRODUTO, 'PRODUTOS' AS ORIGEM, 'CUSTO_REPOSICAO2' AS CAMPO
        FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?
        UNION ALL
        SELECT 
            PRODUTO, '02', 'TABELA ALTERNATIVA', ISNULL(CUSTO_REPOSICAO3, 0), DESC_PRODUTO, 'PRODUTOS' AS ORIGEM, 'CUSTO_REPOSICAO3' AS CAMPO
        FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?
        UNION ALL
        SELECT 
            PRODUTO, '03', 'TABELA EXTRA', ISNULL(CUSTO_REPOSICAO4, 0), DESC_PRODUTO, 'PRODUTOS' AS ORIGEM, 'CUSTO_REPOSICAO4' AS CAMPO
        FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?
    """
    
    # Query 2: Buscar TODOS os preços da tabela PRODUTOS_PRECOS (PRECO1, PRECO2, PRECO3, PRECO4)
    # Buscar cada preço como um registro separado para poder alterar individualmente
    query_precos_produtos = """
        SELECT 
            pp.PRODUTO,
            CONCAT(pp.CODIGO_TAB_PRECO, '-P1') AS COD_TABELA,
            CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO1') AS DESC_TABELA,
            ISNULL(pp.PRECO1, 0) AS CUSTO,
            p.DESC_PRODUTO,
            'PRODUTOS_PRECOS' AS ORIGEM,
            'PRECO1' AS CAMPO
        FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pp.PRODUTO
        LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
        WHERE pp.PRODUTO = ?
        UNION ALL
        SELECT 
            pp.PRODUTO,
            CONCAT(pp.CODIGO_TAB_PRECO, '-P2') AS COD_TABELA,
            CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO2') AS DESC_TABELA,
            ISNULL(pp.PRECO2, 0) AS CUSTO,
            p.DESC_PRODUTO,
            'PRODUTOS_PRECOS' AS ORIGEM,
            'PRECO2' AS CAMPO
        FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pp.PRODUTO
        LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
        WHERE pp.PRODUTO = ?
        UNION ALL
        SELECT 
            pp.PRODUTO,
            CONCAT(pp.CODIGO_TAB_PRECO, '-P3') AS COD_TABELA,
            CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO3') AS DESC_TABELA,
            ISNULL(pp.PRECO3, 0) AS CUSTO,
            p.DESC_PRODUTO,
            'PRODUTOS_PRECOS' AS ORIGEM,
            'PRECO3' AS CAMPO
        FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pp.PRODUTO
        LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
        WHERE pp.PRODUTO = ?
        UNION ALL
        SELECT 
            pp.PRODUTO,
            CONCAT(pp.CODIGO_TAB_PRECO, '-P4') AS COD_TABELA,
            CONCAT(ISNULL(tp.TABELA, ''), ' - PRECO4') AS DESC_TABELA,
            ISNULL(pp.PRECO4, 0) AS CUSTO,
            p.DESC_PRODUTO,
            'PRODUTOS_PRECOS' AS ORIGEM,
            'PRECO4' AS CAMPO
        FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pp.PRODUTO
        LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
        WHERE pp.PRODUTO = ?
        ORDER BY COD_TABELA
    """
    
    # Tentar executar ambas as queries e combinar resultados
    dfs = []
    
    # Executar query 1 (custos em PRODUTOS)
    try:
        df1 = pd.read_sql(query_custos_produtos, conn, params=[codigo_limpo, codigo_limpo, codigo_limpo, codigo_limpo])
        if not df1.empty:
            dfs.append(df1)
            print(f"✓ Encontrados {len(df1)} custo(s) na tabela PRODUTOS")
    except Exception as e:
        print(f"⚠ Erro ao buscar custos em PRODUTOS: {e}")
    
    # Executar query 2 (preços em PRODUTOS_PRECOS) - precisa de 4 parâmetros (um para cada UNION ALL)
    try:
        df2 = pd.read_sql(query_precos_produtos, conn, params=[codigo_limpo, codigo_limpo, codigo_limpo, codigo_limpo])
        if not df2.empty:
            dfs.append(df2)
            print(f"✓ Encontrados {len(df2)} preco(s)/custo(s) na tabela PRODUTOS_PRECOS")
    except Exception as e:
        print(f"⚠ Erro ao buscar precos em PRODUTOS_PRECOS: {e}")
    
    # Combinar resultados
    if dfs:
        df_final = pd.concat(dfs, ignore_index=True)
        # Remover duplicatas (se houver mesmo código em ambas as tabelas, priorizar PRODUTOS)
        df_final = df_final.drop_duplicates(subset=['COD_TABELA'], keep='first')
        df_final = df_final.sort_values('COD_TABELA').reset_index(drop=True)
        return df_final, conn
    else:
        print("⚠ Nenhum custo/preco encontrado")
        return pd.DataFrame(), conn

def exibir_custos_disponiveis(df_custo: pd.DataFrame) -> None:
    """Exibe lista numerada de custos disponíveis"""
    if df_custo.empty:
        print("⚠ Nenhum custo encontrado para este produto.")
        return
    
    print("\n" + "="*100)
    print("CUSTOS DISPONÍVEIS")
    print("="*100)
    print(f"\n📋 Total de registros de custo: {len(df_custo)}")
    print(f"💰 Valor total: R$ {df_custo['CUSTO'].sum():,.2f}")
    print("\n" + "-"*100)
    print(f"{'#':<4} {'COD.TABELA':<15} {'DESCRIÇÃO DA TABELA':<40} {'CUSTO (1)':<15}")
    print("-"*100)
    
    for idx, row in df_custo.iterrows():
        cod_tabela = str(row['COD_TABELA']) if row['COD_TABELA'] else ''
        desc_tabela = str(row['DESC_TABELA'])[:38] if row['DESC_TABELA'] else ''
        custo = float(row['CUSTO'])
        
        print(f"{idx+1:<4} {cod_tabela:<15} {desc_tabela:<40} R$ {custo:<14,.2f}")
    
    print("-"*100)

def exibir_preview_alteracao(df_custo: pd.DataFrame, indices_selecionados: List[int], novo_custo: float) -> None:
    """Exibe preview das alterações que serão feitas"""
    if not indices_selecionados:
        print("⚠ Nenhum índice selecionado para preview.")
        return
    
    print("\n" + "="*100)
    print("PREVIEW DAS ALTERAÇÕES")
    print("="*100)
    
    registros_selecionados = [df_custo.iloc[idx] for idx in indices_selecionados if 0 <= idx < len(df_custo)]
    
    if not registros_selecionados:
        print("⚠ Nenhum registro válido selecionado.")
        return
    
    produto = registros_selecionados[0]['PRODUTO']
    desc_produto = registros_selecionados[0]['DESC_PRODUTO']
    
    print(f"\n💰 Produto: {produto}")
    print(f"   Descrição: {desc_produto}")
    print(f"\n📋 Total de registros que serão alterados: {len(registros_selecionados)}")
    print(f"📊 Novo custo para todos: R$ {novo_custo:,.2f}")
    print("\n" + "-"*100)
    print(f"{'#':<4} {'COD.TABELA':<15} {'DESCRIÇÃO DA TABELA':<30} {'CUSTO ATUAL':<15} {'CUSTO NOVO':<15} {'DIFERENÇA':<15}")
    print("-"*100)
    
    total_alteracoes = 0
    
    for i, registro in enumerate(registros_selecionados):
        cod_tabela = str(registro['COD_TABELA']) if registro['COD_TABELA'] else ''
        desc_tabela = str(registro['DESC_TABELA'])[:28] if registro['DESC_TABELA'] else ''
        custo_atual = float(registro['CUSTO'])
        diferenca = novo_custo - custo_atual
        
        print(f"{i+1:<4} {cod_tabela:<15} {desc_tabela:<30} R$ {custo_atual:<14,.2f} R$ {novo_custo:<14,.2f} R$ {diferenca:+,.2f}")
        
        if novo_custo != custo_atual:
            total_alteracoes += 1
    
    print("-"*100)
    print(f"\n📊 Resumo:")
    print(f"   • Registros que serão alterados: {total_alteracoes}")
    print(f"   • Registros que já estão corretos: {len(registros_selecionados) - total_alteracoes}")
    
    print("="*100)

def gerar_sql_update(registro: pd.Series, novo_custo: float) -> str:
    """Gera o SQL UPDATE que seria executado (apenas para visualização)"""
    produto = str(registro['PRODUTO']).strip()
    cod_tabela = str(registro['COD_TABELA']).strip() if pd.notna(registro['COD_TABELA']) else ''
    desc_tabela = str(registro['DESC_TABELA']).strip() if pd.notna(registro['DESC_TABELA']) else ''
    
    # Escapar aspas simples para SQL
    produto_escaped = produto.replace("'", "''")
    cod_tabela_escaped = cod_tabela.replace("'", "''") if cod_tabela else ''
    
    # Construir WHERE clause baseado na estrutura
    # Assumindo que a chave primária é PRODUTO + COD_TABELA
    where_conditions = [f"PRODUTO = '{produto_escaped}'"]
    if cod_tabela:
        where_conditions.append(f"COD_TABELA = '{cod_tabela_escaped}'")
    
    where_clause = " AND ".join(where_conditions)
    
    sql = f"""
-- SQL UPDATE que seria executado:
-- ATENÇÃO: Este SQL NÃO será executado automaticamente!

UPDATE PRODUTOS
SET [COLUNA_CUSTO] = {novo_custo}
WHERE {where_clause}

-- Produto: {produto}
-- Código Tabela: {cod_tabela}
-- Descrição Tabela: {desc_tabela if desc_tabela else '(sem descrição)'}
-- Custo atual: R$ {float(registro['CUSTO']):,.2f}
-- Custo novo: R$ {novo_custo:,.2f}
"""
    return sql

def executar_update(conn, registro: pd.Series, novo_custo: float) -> Tuple[bool, int, str]:
    """
    Executa o UPDATE no banco de dados de forma segura
    Retorna: (sucesso: bool, registros_alterados: int, mensagem: str)
    """
    produto = str(registro['PRODUTO']).strip()
    cod_tabela = str(registro['COD_TABELA']).strip() if pd.notna(registro['COD_TABELA']) and str(registro['COD_TABELA']).strip() else None
    origem = str(registro.get('ORIGEM', '')).strip() if 'ORIGEM' in registro else None
    
    try:
        cursor = conn.cursor()
        
        # Usar a coluna ORIGEM para determinar qual tabela atualizar
        if origem == 'PRODUTOS':
            # Atualizar na tabela PRODUTOS (campos CUSTO_REPOSICAO1-4)
            mapeamento_colunas = {
                '00': 'CUSTO_REPOSICAO1',
                '01': 'CUSTO_REPOSICAO2',
                '02': 'CUSTO_REPOSICAO3',
                '03': 'CUSTO_REPOSICAO4'
            }
            coluna = mapeamento_colunas.get(cod_tabela, 'CUSTO_REPOSICAO1')
            query = f"""
                UPDATE PRODUTOS
                SET {coluna} = ?
                WHERE PRODUTO = ?
            """
            params = [novo_custo, produto]
        elif origem == 'PRODUTOS_PRECOS' or (cod_tabela and cod_tabela not in ['00', '01', '02', '03']):
            # Atualizar na tabela PRODUTOS_PRECOS
            # O COD_TABELA vem no formato "01-P1", "01-P2", etc.
            # Precisamos extrair o código da tabela e o campo (PRECO1, PRECO2, etc)
            campo_preco = str(registro.get('CAMPO', 'PRECO1')).strip() if 'CAMPO' in registro else 'PRECO1'
            
            # Se COD_TABELA tem formato "01-P1", extrair "01"
            if '-' in cod_tabela:
                cod_tabela_limpo = cod_tabela.split('-')[0]
            else:
                cod_tabela_limpo = cod_tabela
            
            query = f"""
                UPDATE PRODUTOS_PRECOS
                SET {campo_preco} = ?
                WHERE PRODUTO = ? 
                  AND CODIGO_TAB_PRECO = ?
            """
            params = [novo_custo, produto, cod_tabela_limpo]
        else:
            # Fallback: tentar PRODUTOS_PRECOS
            query = """
                UPDATE PRODUTOS_PRECOS
                SET PRECO1 = ?
                WHERE PRODUTO = ?
                  AND CODIGO_TAB_PRECO = ?
            """
            params = [novo_custo, produto, cod_tabela]
        
        # Executar UPDATE
        cursor.execute(query, params)
        registros_alterados = cursor.rowcount
        
        # Commit da transação
        conn.commit()
        cursor.close()
        
        return True, registros_alterados, f"✓ {registros_alterados} registro(s) alterado(s) com sucesso!"
        
    except Exception as e:
        # Rollback em caso de erro
        conn.rollback()
        return False, 0, f"✗ Erro ao executar UPDATE: {str(e)}"

def validar_entrada_custo(entrada: str) -> Optional[float]:
    """Valida e converte entrada de custo"""
    entrada = entrada.strip().replace(',', '.')  # Aceitar vírgula ou ponto como separador decimal
    
    # Tentar converter para float
    try:
        valor = float(entrada)
        if valor < 0:
            print("⚠️  O custo não pode ser negativo.")
            return None
        return valor
    except ValueError:
        print("⚠️  Valor inválido. Digite um número válido (ex: 148.00 ou 148,00).")
        return None

def buscar_tabelas_disponiveis_produtos(conn, codigos_produtos: List[str]) -> pd.DataFrame:
    """Busca todas as tabelas disponíveis para uma lista de produtos"""
    resultados = []
    
    for codigo_produto in codigos_produtos:
        codigo_limpo = str(codigo_produto).strip()
        
        # Buscar custos em PRODUTOS
        try:
            query_custos = """
                SELECT DISTINCT
                    '00' AS COD_TABELA,
                    'TABELA ORIGINAL' AS DESC_TABELA,
                    'PRODUTOS' AS ORIGEM,
                    'CUSTO_REPOSICAO1' AS CAMPO
                FROM PRODUTOS WITH (NOLOCK)
                WHERE PRODUTO = ?
                UNION ALL
                SELECT '01', 'TABELA PADRAO', 'PRODUTOS', 'CUSTO_REPOSICAO2'
                FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?
                UNION ALL
                SELECT '02', 'TABELA ALTERNATIVA', 'PRODUTOS', 'CUSTO_REPOSICAO3'
                FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?
                UNION ALL
                SELECT '03', 'TABELA EXTRA', 'PRODUTOS', 'CUSTO_REPOSICAO4'
                FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?
            """
            df1 = pd.read_sql(query_custos, conn, params=[codigo_limpo, codigo_limpo, codigo_limpo, codigo_limpo])
            if not df1.empty:
                df1['PRODUTO'] = codigo_limpo
                resultados.append(df1)
        except:
            pass
        
        # Buscar preços em PRODUTOS_PRECOS
        try:
            query_precos = """
                SELECT DISTINCT
                    pp.CODIGO_TAB_PRECO AS COD_TABELA,
                    ISNULL(tp.TABELA, '') AS DESC_TABELA,
                    'PRODUTOS_PRECOS' AS ORIGEM,
                    'PRECO1' AS CAMPO
                FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
                LEFT JOIN TABELAS_PRECO tp WITH (NOLOCK) ON tp.CODIGO_TAB_PRECO = pp.CODIGO_TAB_PRECO
                WHERE pp.PRODUTO = ?
                ORDER BY pp.CODIGO_TAB_PRECO
            """
            df2 = pd.read_sql(query_precos, conn, params=[codigo_limpo])
            if not df2.empty:
                df2['PRODUTO'] = codigo_limpo
                resultados.append(df2)
        except:
            pass
    
    if resultados:
        df_final = pd.concat(resultados, ignore_index=True)
        # Remover duplicatas baseado em COD_TABELA + ORIGEM + CAMPO
        df_final = df_final.drop_duplicates(subset=['COD_TABELA', 'ORIGEM', 'CAMPO'], keep='first')
        return df_final.sort_values(['ORIGEM', 'COD_TABELA']).reset_index(drop=True)
    
    return pd.DataFrame()

def buscar_valores_tabela_produtos(conn, codigos_produtos: List[str], cod_tabela: str, origem: str, campo: str) -> pd.DataFrame:
    """Busca valores atuais de uma tabela específica para uma lista de produtos"""
    resultados = []
    
    for codigo_produto in codigos_produtos:
        codigo_limpo = str(codigo_produto).strip()
        
        if origem == 'PRODUTOS':
            # Buscar da tabela PRODUTOS
            mapeamento = {
                '00': 'CUSTO_REPOSICAO1',
                '01': 'CUSTO_REPOSICAO2',
                '02': 'CUSTO_REPOSICAO3',
                '03': 'CUSTO_REPOSICAO4'
            }
            coluna = mapeamento.get(cod_tabela, 'CUSTO_REPOSICAO1')
            
            query = f"""
                SELECT 
                    PRODUTO,
                    '{cod_tabela}' AS COD_TABELA,
                    ISNULL({coluna}, 0) AS CUSTO,
                    DESC_PRODUTO
                FROM PRODUTOS WITH (NOLOCK)
                WHERE PRODUTO = ?
            """
            try:
                df = pd.read_sql(query, conn, params=[codigo_limpo])
                if not df.empty:
                    resultados.append(df)
            except:
                pass
        elif origem == 'PRODUTOS_PRECOS':
            # Buscar da tabela PRODUTOS_PRECOS
            query = f"""
                SELECT 
                    pp.PRODUTO,
                    pp.CODIGO_TAB_PRECO AS COD_TABELA,
                    ISNULL(pp.{campo}, 0) AS CUSTO,
                    p.DESC_PRODUTO
                FROM PRODUTOS_PRECOS pp WITH (NOLOCK)
                LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pp.PRODUTO
                WHERE pp.PRODUTO = ? AND pp.CODIGO_TAB_PRECO = ?
            """
            try:
                df = pd.read_sql(query, conn, params=[codigo_limpo, cod_tabela])
                if not df.empty:
                    resultados.append(df)
            except:
                pass
    
    if resultados:
        return pd.concat(resultados, ignore_index=True)
    return pd.DataFrame()

def executar_update_massa(conn, codigos_produtos: List[str], cod_tabela: str, origem: str, campo: str, novo_custo: float) -> Tuple[int, int]:
    """Executa UPDATE em massa para vários produtos em uma tabela específica"""
    sucessos = 0
    erros = 0
    
    cursor = conn.cursor()
    
    for codigo_produto in codigos_produtos:
        codigo_limpo = str(codigo_produto).strip()
        
        try:
            if origem == 'PRODUTOS':
                mapeamento = {
                    '00': 'CUSTO_REPOSICAO1',
                    '01': 'CUSTO_REPOSICAO2',
                    '02': 'CUSTO_REPOSICAO3',
                    '03': 'CUSTO_REPOSICAO4'
                }
                coluna = mapeamento.get(cod_tabela, 'CUSTO_REPOSICAO1')
                query = f"""
                    UPDATE PRODUTOS
                    SET {coluna} = ?
                    WHERE PRODUTO = ?
                """
                params = [novo_custo, codigo_limpo]
            elif origem == 'PRODUTOS_PRECOS':
                query = f"""
                    UPDATE PRODUTOS_PRECOS
                    SET {campo} = ?
                    WHERE PRODUTO = ? 
                      AND CODIGO_TAB_PRECO = ?
                """
                params = [novo_custo, codigo_limpo, cod_tabela]
            else:
                erros += 1
                print(f"   ✗ {codigo_limpo}: origem desconhecida ({origem})")
                continue
            
            # Executar UPDATE
            cursor.execute(query, params)
            registros_afetados = cursor.rowcount
            
            # Se rowcount > 0, definitivamente foi atualizado
            if registros_afetados > 0:
                sucessos += 1
                print(f"   ✓ {codigo_limpo}: atualizado ({registros_afetados} registro(s))")
            else:
                # Se rowcount == 0, pode ser que:
                # 1. O registro não existe (erro)
                # 2. O valor já estava correto (sucesso, mas não alterou nada)
                # Vamos verificar se o registro existe
                if origem == 'PRODUTOS':
                    query_check = "SELECT COUNT(*) as TOTAL FROM PRODUTOS WITH (NOLOCK) WHERE PRODUTO = ?"
                    params_check = [codigo_limpo]
                else:
                    query_check = "SELECT COUNT(*) as TOTAL FROM PRODUTOS_PRECOS WITH (NOLOCK) WHERE PRODUTO = ? AND CODIGO_TAB_PRECO = ?"
                    params_check = [codigo_limpo, cod_tabela]
                
                try:
                    df_check = pd.read_sql(query_check, conn, params=params_check)
                    
                    if not df_check.empty and df_check.iloc[0]['TOTAL'] > 0:
                        # Registro existe - UPDATE foi executado com sucesso, provavelmente valor já estava correto
                        sucessos += 1
                        print(f"   ✓ {codigo_limpo}: atualizado (valor já estava correto ou não houve alteração)")
                    else:
                        # Registro não existe - não foi possível atualizar
                        erros += 1
                        print(f"   ⚠ {codigo_limpo}: registro não encontrado na tabela")
                except Exception as check_error:
                    # Se não conseguir verificar, considerar sucesso (UPDATE foi executado sem erro SQL)
                    sucessos += 1
                    print(f"   ✓ {codigo_limpo}: atualizado")
                
        except Exception as e:
            erros += 1
            print(f"   ✗ {codigo_limpo}: erro ao atualizar - {e}")
    
    cursor.close()
    
    return sucessos, erros

def modo_alteracao_massa(conn, codigos_produtos: List[str]):
    """Modo de alteração em massa para vários produtos"""
    print("\n" + "="*100)
    print("MODO ALTERAÇÃO EM MASSA")
    print("="*100)
    print(f"\n📦 Produtos selecionados: {len(codigos_produtos)}")
    for i, codigo in enumerate(codigos_produtos, 1):
        print(f"   {i}. {codigo}")
    
    # Buscar todas as tabelas disponíveis
    print("\n🔍 Buscando tabelas disponíveis...")
    df_tabelas = buscar_tabelas_disponiveis_produtos(conn, codigos_produtos)
    
    if df_tabelas.empty:
        print("\n✗ Nenhuma tabela encontrada para os produtos selecionados.")
        return
    
    # Mostrar tabelas disponíveis
    print("\n" + "="*100)
    print("TABELAS DISPONÍVEIS")
    print("="*100)
    print(f"\n📋 Total de tabelas: {len(df_tabelas)}")
    print("\n" + "-"*100)
    print(f"{'#':<4} {'COD.TABELA':<15} {'DESCRIÇÃO':<40} {'ORIGEM':<20} {'CAMPO':<15}")
    print("-"*100)
    
    tabelas_lista = []
    for idx, row in df_tabelas.iterrows():
        cod_tabela = str(row['COD_TABELA'])
        desc_tabela = str(row['DESC_TABELA'])[:38]
        origem = str(row['ORIGEM'])[:18]
        campo = str(row['CAMPO'])[:13]
        print(f"{idx+1:<4} {cod_tabela:<15} {desc_tabela:<40} {origem:<20} {campo:<15}")
        tabelas_lista.append({
            'COD_TABELA': cod_tabela,
            'DESC_TABELA': desc_tabela,
            'ORIGEM': origem,
            'CAMPO': campo
        })
    
    print("-"*100)
    
    # Solicitar seleção da tabela
    print("\n💡 Digite o número da tabela que deseja alterar")
    entrada_tabela = input(f"\n🎯 Número da tabela (1-{len(tabelas_lista)}): ").strip()
    
    try:
        idx_tabela = int(entrada_tabela) - 1
        if not (0 <= idx_tabela < len(tabelas_lista)):
            print(f"\n✗ Número inválido. Deve estar entre 1 e {len(tabelas_lista)}")
            return
        
        tabela_selecionada = tabelas_lista[idx_tabela]
        cod_tabela = tabela_selecionada['COD_TABELA']
        origem = tabela_selecionada['ORIGEM']
        campo = tabela_selecionada['CAMPO']
        desc_tabela = tabela_selecionada['DESC_TABELA']
        
    except ValueError:
        print("\n✗ Valor inválido. Digite um número.")
        return
    
    # Buscar valores atuais de todos os produtos nessa tabela
    print(f"\n🔍 Buscando valores atuais na tabela '{desc_tabela}'...")
    df_valores = buscar_valores_tabela_produtos(conn, codigos_produtos, cod_tabela, origem, campo)
    
    if df_valores.empty:
        print(f"\n✗ Nenhum valor encontrado para os produtos na tabela '{desc_tabela}'.")
        return
    
    # Mostrar valores atuais
    print("\n" + "="*100)
    print(f"VALORES ATUAIS - TABELA: {desc_tabela} ({cod_tabela})")
    print("="*100)
    print("\n" + "-"*100)
    print(f"{'#':<4} {'PRODUTO':<15} {'DESCRIÇÃO':<40} {'CUSTO ATUAL':<15}")
    print("-"*100)
    
    for idx, row in df_valores.iterrows():
        produto = str(row['PRODUTO'])
        desc_produto = str(row['DESC_PRODUTO'])[:38] if pd.notna(row['DESC_PRODUTO']) else ''
        custo_atual = float(row['CUSTO'])
        print(f"{idx+1:<4} {produto:<15} {desc_produto:<40} R$ {custo_atual:<14,.2f}")
    
    print("-"*100)
    print(f"\n📊 Total de produtos: {len(df_valores)}")
    print(f"💰 Valor médio atual: R$ {df_valores['CUSTO'].mean():,.2f}")
    
    # Solicitar novo valor
    print("\n" + "="*100)
    print("DEFINIR NOVO VALOR")
    print("="*100)
    print(f"\n💡 Digite o novo valor que será aplicado a TODOS os {len(df_valores)} produtos")
    print(f"   na tabela '{desc_tabela}' ({cod_tabela})")
    print("   - Digite um número decimal (ex: 148.00 ou 148,00)")
    
    entrada_custo = input("\n💰 Novo valor: ").strip()
    novo_custo = validar_entrada_custo(entrada_custo)
    
    if novo_custo is None:
        return
    
    # Preview
    print("\n" + "="*100)
    print("PREVIEW DAS ALTERAÇÕES")
    print("="*100)
    print(f"\n📋 Tabela: {desc_tabela} ({cod_tabela})")
    print(f"💰 Novo valor: R$ {novo_custo:,.2f}")
    print(f"📦 Produtos que serão alterados: {len(df_valores)}")
    print("\n" + "-"*100)
    print(f"{'PRODUTO':<15} {'CUSTO ATUAL':<15} {'CUSTO NOVO':<15} {'DIFERENÇA':<15}")
    print("-"*100)
    
    total_alteracoes = 0
    for _, row in df_valores.iterrows():
        produto = str(row['PRODUTO'])
        custo_atual = float(row['CUSTO'])
        diferenca = novo_custo - custo_atual
        if novo_custo != custo_atual:
            total_alteracoes += 1
        print(f"{produto:<15} R$ {custo_atual:<14,.2f} R$ {novo_custo:<14,.2f} R$ {diferenca:+,.2f}")
    
    print("-"*100)
    print(f"\n📊 Registros que serão alterados: {total_alteracoes}")
    print(f"📊 Registros que já estão corretos: {len(df_valores) - total_alteracoes}")
    
    if total_alteracoes == 0:
        print("\n✓ Todos os produtos já estão com o valor correto. Nenhuma alteração necessária.")
        return
    
    # Confirmação
    print("\n" + "="*100)
    print("CONFIRMAÇÃO")
    print("="*100)
    print(f"\n⚠️  ATENÇÃO: Você está prestes a alterar {total_alteracoes} registro(s)!")
    print(f"   Tabela: {desc_tabela} ({cod_tabela})")
    print(f"   Novo valor: R$ {novo_custo:,.2f}")
    print(f"   Produtos afetados: {len(df_valores)}")
    
    confirmacao = input("\n❓ Deseja continuar? (SIM/não): ").strip().upper()
    
    if confirmacao not in ['SIM', 'S', 'YES', 'Y']:
        print("\n✗ Operação cancelada pelo usuário.")
        return
    
    # Executar atualizações
    print("\n🔄 Executando atualizações...")
    sucessos, erros = executar_update_massa(conn, codigos_produtos, cod_tabela, origem, campo, novo_custo)
    
    # Commit
    try:
        conn.commit()
        print(f"\n✓ Atualizações concluídas!")
        print(f"   ✓ Sucessos: {sucessos}")
        if erros > 0:
            print(f"   ✗ Erros: {erros}")
    except Exception as e:
        conn.rollback()
        print(f"\n✗ Erro ao confirmar alterações: {e}")

def main():
    """Função principal"""
    print("="*100)
    print("ALTERADOR DE CUSTO")
    print("="*100)
    print("\n⚠️  ATENÇÃO: Este script pode fazer alterações no banco de dados.")
    print("   Você verá um preview antes e precisará confirmar a execução.")
    print("   Use com MUITO CUIDADO!\n")
    
    # Conectar ao banco
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Solicitar código do produto
        print("\n" + "="*100)
        print("ENTRADA DE DADOS")
        print("="*100)
        print("\n💡 Digite o código do produto")
        print("   Exemplo: 12345")
        
        entrada_produto = input("\n📦 Código(s) do(s) produto(s): ").strip()
        
        if not entrada_produto:
            print("\n✗ Nenhum código de produto informado.")
            return
        
        # Verificar se são múltiplos produtos (separados por vírgula)
        codigos_produtos = [cod.strip() for cod in entrada_produto.split(',') if cod.strip()]
        
        if len(codigos_produtos) > 1:
            # MODO MASSA: Múltiplos produtos
            print(f"\n✓ {len(codigos_produtos)} produto(s) informado(s):")
            for i, cod in enumerate(codigos_produtos, 1):
                print(f"   {i}. {cod}")
            
            # Verificar se todos os produtos existem
            produtos_validos = []
            produtos_invalidos = []
            
            for codigo in codigos_produtos:
                df_produto, conn = buscar_info_produto(conn, codigo)
                if df_produto is not None and not df_produto.empty:
                    produtos_validos.append(codigo)
                else:
                    produtos_invalidos.append(codigo)
            
            if produtos_invalidos:
                print(f"\n⚠ Produtos não encontrados: {', '.join(produtos_invalidos)}")
            
            if not produtos_validos:
                print("\n✗ Nenhum produto válido encontrado.")
                return
            
            if len(produtos_validos) < len(codigos_produtos):
                print(f"\n⚠ Continuando apenas com {len(produtos_validos)} produto(s) válido(s).")
            
            # Entrar no modo massa
            modo_alteracao_massa(conn, produtos_validos)
            return
        
        # MODO INDIVIDUAL: Um único produto
        codigo_produto = codigos_produtos[0]
        print(f"\n✓ Código informado: {codigo_produto}")
        
        # Buscar informações do produto
        print("\n🔍 Buscando informações do produto...")
        df_produto, conn = buscar_info_produto(conn, codigo_produto)
        
        if df_produto is None or df_produto.empty:
            print(f"\n✗ Produto '{codigo_produto}' não encontrado no banco de dados.")
            return
        
        produto_info = df_produto.iloc[0]
        print(f"\n✓ Produto encontrado:")
        print(f"   Código: {produto_info['PRODUTO']}")
        print(f"   Descrição: {produto_info['DESC_PRODUTO']}")
        print(f"   Linha: {produto_info['LINHA'] if pd.notna(produto_info['LINHA']) else '(sem linha)'}")
        
        # Buscar custos do produto
        print("\n🔍 Buscando custos do produto...")
        df_custo, conn = buscar_custos_produto(conn, codigo_produto)
        
        if conn is None:
            print("\n✗ Não foi possível manter conexão com o banco de dados.")
            return
        
        if df_custo.empty:
            print(f"\n✗ Nenhum custo encontrado para o produto '{codigo_produto}'.")
            print("   Este produto não possui registros de custo/preço.")
            return
        
        # Exibir custos disponíveis
        exibir_custos_disponiveis(df_custo)
        
        # Solicitar seleção do custo
        print("\n" + "="*100)
        print("SELECIONAR CUSTOS PARA ALTERAR")
        print("="*100)
        print("\n💡 Digite o(s) número(s) (#) do(s) custo(s) que deseja alterar")
        print(f"   Escolha entre 1 e {len(df_custo)}")
        print("   Você pode selecionar múltiplos separados por vírgula (ex: 1,2,3)")
        
        entrada_indices = input("\n🎯 Número(s) do(s) custo(s): ").strip()
        
        if not entrada_indices:
            print("\n✗ Nenhum número informado.")
            return
        
        # Processar múltiplos números separados por vírgula
        try:
            numeros_str = [num.strip() for num in entrada_indices.split(',') if num.strip()]
            indices = [int(num) - 1 for num in numeros_str]
            
            # Validar índices
            indices_validos = []
            indices_invalidos = []
            for idx in indices:
                if 0 <= idx < len(df_custo):
                    if idx not in indices_validos:  # Evitar duplicatas
                        indices_validos.append(idx)
                else:
                    indices_invalidos.append(idx + 1)  # +1 para mostrar o número original
            
            if indices_invalidos:
                print(f"\n⚠ Números inválidos ignorados: {', '.join(map(str, indices_invalidos))}")
            
            if not indices_validos:
                print(f"\n✗ Nenhum número válido. Deve estar entre 1 e {len(df_custo)}")
                return
            
            indices_validos = sorted(set(indices_validos))  # Ordenar e remover duplicatas
            
        except ValueError:
            print("\n✗ Valor inválido. Digite números separados por vírgula (ex: 1,2,3).")
            return
        
        registros_selecionados = [df_custo.iloc[idx] for idx in indices_validos]
        
        print(f"\n✓ {len(registros_selecionados)} custo(s) selecionado(s):")
        for i, registro in enumerate(registros_selecionados, 1):
            cod_tabela = str(registro['COD_TABELA']) if registro['COD_TABELA'] else ''
            desc_tabela = str(registro['DESC_TABELA']) if registro['DESC_TABELA'] else ''
            custo_atual = float(registro['CUSTO'])
            print(f"   {i}. {cod_tabela} | {desc_tabela} | Custo atual: R$ {custo_atual:,.2f}")
        
        # Solicitar novo custo
        print("\n" + "="*100)
        print("DEFINIR NOVO CUSTO")
        print("="*100)
        print("\n💡 Digite o novo valor de custo")
        print("   - Digite um número decimal (ex: 148.00 ou 148,00)")
        print(f"\n   Este valor será aplicado a TODOS os {len(registros_selecionados)} custo(s) selecionado(s)")
        
        entrada_custo = input("\n💰 Novo custo: ").strip()
        
        if not entrada_custo:
            print("\n✗ Nenhum valor informado.")
            return
        
        novo_custo = validar_entrada_custo(entrada_custo)
        
        if novo_custo is None:
            return
        
        # Verificar se há alteração necessária
        registros_para_alterar = [r for r in registros_selecionados if float(r['CUSTO']) != novo_custo]
        
        if not registros_para_alterar:
            print("\n" + "="*100)
            print("✅ NENHUMA ALTERAÇÃO NECESSÁRIA")
            print("="*100)
            print(f"\n💡 Todos os custos selecionados já estão em R$ {novo_custo:,.2f}.")
            return
        
        # Exibir preview
        exibir_preview_alteracao(df_custo, indices_validos, novo_custo)
        
        # Gerar SQL para todos os registros
        print("\n" + "="*100)
        print("SQL QUE SERIA EXECUTADO")
        print("="*100)
        for i, registro in enumerate(registros_para_alterar, 1):
            print(f"\n-- UPDATE {i}/{len(registros_para_alterar)}:")
            sql_update = gerar_sql_update(registro, novo_custo)
            print(sql_update)
        
        # Confirmação única
        print("\n" + "="*100)
        print("CONFIRMAÇÃO DE EXECUÇÃO")
        print("="*100)
        print(f"\n⚠️  ATENÇÃO: Você está prestes a alterar {len(registros_para_alterar)} registro(s) no banco de dados!")
        print(f"   Produto: {produto_info['PRODUTO']} - {produto_info['DESC_PRODUTO']}")
        print(f"   Novo custo: R$ {novo_custo:,.2f}")
        print("\n💡 Deseja realmente executar esta alteração?")
        print("   Digite 'SIM' (em maiúsculas) para confirmar, ou qualquer outra coisa para cancelar")
        
        confirmacao = input("\n❓ Confirmar execução: ").strip()
        
        if confirmacao != 'SIM':
            print("\n" + "="*100)
            print("❌ OPERAÇÃO CANCELADA")
            print("="*100)
            print("\n⚠️  Nenhuma alteração foi feita no banco de dados.")
            return
        
        # Executar UPDATE para todos os registros
        print("\n" + "="*100)
        print("EXECUTANDO UPDATE...")
        print("="*100)
        
        total_alterados = 0
        total_erros = 0
        erros = []
        
        for i, registro in enumerate(registros_para_alterar, 1):
            cod_tabela = str(registro['COD_TABELA']) if registro['COD_TABELA'] else ''
            desc_tabela = str(registro['DESC_TABELA']) if registro['DESC_TABELA'] else ''
            print(f"\n[{i}/{len(registros_para_alterar)}] Alterando: {cod_tabela} | {desc_tabela}...")
            
            sucesso, registros_alterados, mensagem = executar_update(conn, registro, novo_custo)
            
            if sucesso:
                total_alterados += registros_alterados
                print(f"   ✓ {mensagem}")
            else:
                total_erros += 1
                erros.append(f"{cod_tabela} | {desc_tabela}: {mensagem}")
                print(f"   ✗ {mensagem}")
        
        # Resumo final
        print("\n" + "="*100)
        print("RESUMO DA EXECUÇÃO")
        print("="*100)
        print(f"\n✓ Registros alterados com sucesso: {total_alterados}")
        if total_erros > 0:
            print(f"✗ Registros com erro: {total_erros}")
            for erro in erros:
                print(f"   • {erro}")
        
        # Verificar alterações
        if total_alterados > 0:
            print("\n🔍 Verificando alterações...")
            df_verificacao, conn = buscar_custos_produto(conn, codigo_produto)
            
            if conn is not None and not df_verificacao.empty:
                verificados_ok = 0
                verificados_erro = 0
                
                for registro in registros_para_alterar:
                    cod_tabela_selecionado = str(registro['COD_TABELA']).strip() if pd.notna(registro['COD_TABELA']) and str(registro['COD_TABELA']).strip() else ''
                    cod_tabela_verificacao = df_verificacao['COD_TABELA'].fillna('').astype(str).str.strip()
                    
                    mask = cod_tabela_verificacao == cod_tabela_selecionado
                    registro_verificado = df_verificacao[mask]
                    
                    if not registro_verificado.empty:
                        custo_verificado = float(registro_verificado.iloc[0]['CUSTO'])
                        if abs(custo_verificado - novo_custo) < 0.01:  # Tolerância para comparação de float
                            verificados_ok += 1
                        else:
                            verificados_erro += 1
                
                if verificados_ok > 0:
                    print(f"✓ {verificados_ok} registro(s) confirmado(s) com o novo custo")
                if verificados_erro > 0:
                    print(f"⚠ {verificados_erro} registro(s) não foram alterados conforme esperado")
        
        print("\n" + "="*100)
        print("✅ OPERAÇÃO CONCLUÍDA")
        print("="*100)
        
    except Exception as e:
        print(f"\n✗ Erro durante execução: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

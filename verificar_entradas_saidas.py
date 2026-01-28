#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script simples para verificar últimas 10 entradas e 10 saídas
Mostra todas as colunas em log para conferência rápida
"""

import sys
import pandas as pd
import pyodbc
from datetime import datetime

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

def formatar_valor(valor):
    """Formata valores para exibição"""
    if pd.isna(valor):
        return ""
    if isinstance(valor, (int, float)):
        if isinstance(valor, float) and valor.is_integer():
            return str(int(valor))
        return str(valor)
    return str(valor).strip()

def exibir_dataframe(df, titulo, num_registros=10):
    """Exibe DataFrame formatado de forma visualmente agradável"""
    print("\n" + "╔" + "═"*100 + "╗")
    print("║" + f"  {titulo} - Últimas {num_registros} registros".center(98) + "║")
    print("╚" + "═"*100 + "╝")
    
    if df.empty:
        print("\n  ✗ Nenhum registro encontrado\n")
        return
    
    # Limitar ao número solicitado
    df_display = df.head(num_registros).copy()
    
    # Formatar datas
    for col in df_display.columns:
        if 'DATA' in col or 'EMISSAO' in col:
            try:
                df_display[col] = pd.to_datetime(df_display[col], errors='coerce').dt.strftime('%d/%m/%Y')
            except:
                pass
    
    # Truncar textos longos
    for col in df_display.select_dtypes(include=['object']).columns:
        df_display[col] = df_display[col].astype(str).apply(lambda x: x[:30] + '...' if len(str(x)) > 30 else x)
    
    # Aplicar formatação
    df_display = df_display.applymap(formatar_valor)
    
    print(f"\n  📊 Total encontrado: {len(df)} | Mostrando: {len(df_display)}\n")
    
    # Configurar pandas para exibição melhorada
    pd.set_option('display.max_columns', None)
    pd.set_option('display.max_rows', None)
    pd.set_option('display.width', 200)
    pd.set_option('display.max_colwidth', 25)
    pd.set_option('display.unicode.east_asian_width', True)
    
    # Exibir com formatação melhorada
    print(df_display.to_string(index=False))
    
    print(f"\n  📋 Colunas ({len(df.columns)}): {', '.join(df.columns.tolist()[:10])}{'...' if len(df.columns) > 10 else ''}\n")

def exibir_estoque_por_filial(df_estoque, titulo):
    """Exibe estoque agrupado por produto e filial de forma organizada"""
    print("\n" + "╔" + "═"*100 + "╗")
    print("║" + f"  {titulo} - ESTOQUE POR FILIAL".center(98) + "║")
    print("╚" + "═"*100 + "╝")
    
    if df_estoque.empty:
        print("\n  ✗ Nenhum registro de estoque encontrado\n")
        return
    
    # Ordenar por PRODUTO, FILIAL
    df_estoque_sorted = df_estoque.sort_values(['PRODUTO', 'FILIAL']).copy()
    
    # Formatar estoque como número inteiro
    if 'ESTOQUE' in df_estoque_sorted.columns:
        df_estoque_sorted['ESTOQUE'] = df_estoque_sorted['ESTOQUE'].fillna(0).astype(int)
    
    # Truncar textos longos
    for col in df_estoque_sorted.select_dtypes(include=['object']).columns:
        df_estoque_sorted[col] = df_estoque_sorted[col].astype(str).apply(lambda x: x[:25] + '...' if len(str(x)) > 25 else x)
    
    # Aplicar formatação
    df_estoque_sorted = df_estoque_sorted.applymap(formatar_valor)
    
    # Agrupar por produto para melhor visualização
    produtos_unicos = df_estoque_sorted['PRODUTO'].unique()
    
    print(f"\n  📦 Total de registros: {len(df_estoque_sorted)} | Produtos únicos: {len(produtos_unicos)}\n")
    
    # Selecionar colunas principais para exibição
    cols_principais = ['PRODUTO', 'DESC_PRODUTO', 'FILIAL', 'NOME_FILIAL', 'COR_PRODUTO', 'DESC_COR_PRODUTO', 'ESTOQUE']
    cols_disponiveis = [c for c in cols_principais if c in df_estoque_sorted.columns]
    
    # Configurar pandas para exibição melhorada
    pd.set_option('display.max_columns', None)
    pd.set_option('display.max_rows', None)
    pd.set_option('display.width', 200)
    pd.set_option('display.max_colwidth', 20)
    pd.set_option('display.unicode.east_asian_width', True)
    
    # Exibir tabela completa
    print(df_estoque_sorted[cols_disponiveis].to_string(index=False))
    
    # Resumo por produto
    if 'ESTOQUE' in df_estoque_sorted.columns and 'PRODUTO' in df_estoque_sorted.columns:
        print(f"\n  {'─'*100}")
        print("  📊 RESUMO POR PRODUTO:")
        print(f"  {'─'*100}")
        
        resumo = df_estoque_sorted.groupby('PRODUTO').agg({
            'ESTOQUE': 'sum',
            'FILIAL': 'count'
        }).reset_index()
        resumo.columns = ['PRODUTO', 'TOTAL_ESTOQUE', 'FILIAIS']
        resumo = resumo.sort_values('TOTAL_ESTOQUE', ascending=False)
        
        for _, row in resumo.head(20).iterrows():
            produto = row['PRODUTO']
            total = int(row['TOTAL_ESTOQUE'])
            filiais = int(row['FILIAIS'])
            desc = df_estoque_sorted[df_estoque_sorted['PRODUTO'] == produto]['DESC_PRODUTO'].iloc[0] if 'DESC_PRODUTO' in df_estoque_sorted.columns else ""
            print(f"    • {produto:15} | {desc[:40]:40} | Total: {total:6} unidades | {filiais} filiais")
        
        if len(resumo) > 20:
            print(f"\n  ⚠ Mostrando apenas os 20 produtos com maior estoque de {len(resumo)} totais")
    
    print(f"\n  📋 Colunas disponíveis ({len(df_estoque.columns)}): {', '.join(df_estoque.columns.tolist())}\n")

def main():
    """Função principal"""
    print("\n" + "╔" + "═"*100 + "╗")
    print("║" + "  VERIFICADOR RÁPIDO - ÚLTIMAS ENTRADAS E SAÍDAS".center(98) + "║")
    print("╚" + "═"*100 + "╝")
    
    conn = None
    try:
        conn = conectar_banco()
        
        # Query para últimas entradas (seguindo estrutura do script original)
        query_entradas = """
            SELECT TOP 10
                E.ROMANEIO_PRODUTO, 
                E.EMISSAO, 
                E.FILIAL, 
                P.PRODUTO,
                P.COR_PRODUTO, 
                P.QTDE AS QTDE_TOTAL,
                E.TIPO_ENTRADA, 
                E.TIPO_ROMANEIO, 
                E.RESPONSAVEL,
                E.CM_OPERACAO
            FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
                ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
            WHERE E.EMISSAO >= '2025-01-01'
                AND P.PRODUTO IS NOT NULL
            ORDER BY E.EMISSAO DESC, E.ROMANEIO_PRODUTO DESC
        """
        
        # Query para últimas saídas (seguindo estrutura do script original)
        query_saidas = """
            SELECT TOP 10
                S.ROMANEIO_PRODUTO, 
                S.EMISSAO, 
                S.FILIAL, 
                S.FILIAL_DESTINO,
                P.PRODUTO,
                P.COR_PRODUTO,
                P.QTDE AS QTDE_TOTAL,
                S.TIPO_ROMANEIO, 
                S.RESPONSAVEL
            FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
            LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
                ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
                AND S.FILIAL = P.FILIAL
            WHERE S.EMISSAO >= '2025-01-01'
                AND P.PRODUTO IS NOT NULL
            ORDER BY S.EMISSAO DESC, S.ROMANEIO_PRODUTO DESC
        """
        
        # Query para produtos (para fazer merge depois)
        query_produtos = """
            SELECT PRODUTO, DESC_PRODUTO, GRUPO_PRODUTO, SUBGRUPO_PRODUTO, LINHA, COLECAO
            FROM PRODUTOS
        """
        
        # Query para cores (para fazer merge depois)
        query_cores = """
            SELECT COR, DESC_COR FROM CORES_BASICAS
        """
        
        print("\n[EXTRAINDO DADOS]")
        
        # Buscar dados básicos
        print("⏳ Buscando últimas 10 entradas...", end=' ', flush=True)
        df_entradas = pd.read_sql(query_entradas, conn)
        print(f"✓ {len(df_entradas)} registros encontrados")
        
        print("⏳ Buscando últimas 10 saídas...", end=' ', flush=True)
        df_saidas = pd.read_sql(query_saidas, conn)
        print(f"✓ {len(df_saidas)} registros encontrados")
        
        # Buscar produtos e cores para enriquecer os dados
        print("⏳ Buscando produtos...", end=' ', flush=True)
        df_produtos = pd.read_sql(query_produtos, conn)
        print(f"✓ {len(df_produtos)} produtos encontrados")
        
        print("⏳ Buscando cores...", end=' ', flush=True)
        df_cores = pd.read_sql(query_cores, conn)
        print(f"✓ {len(df_cores)} cores encontradas")
        
        # Enriquecer entradas com produtos e cores
        if not df_entradas.empty:
            cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
            df_entradas = df_entradas.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
            df_cores_copy = df_cores.rename(columns={'COR': 'COR_PRODUTO', 'DESC_COR': 'DESC_COR_PRODUTO'})
            df_entradas = df_entradas.merge(df_cores_copy, on='COR_PRODUTO', how='left')
        
        # Enriquecer saídas com produtos e cores
        if not df_saidas.empty:
            cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
            df_saidas = df_saidas.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
            df_cores_copy = df_cores.rename(columns={'COR': 'COR_PRODUTO', 'DESC_COR': 'DESC_COR_PRODUTO'})
            df_saidas = df_saidas.merge(df_cores_copy, on='COR_PRODUTO', how='left')
        
        # Extrair produtos únicos das entradas e saídas para buscar estoque
        produtos_entradas = df_entradas['PRODUTO'].dropna().unique().tolist() if not df_entradas.empty else []
        produtos_saidas = df_saidas['PRODUTO'].dropna().unique().tolist() if not df_saidas.empty else []
        produtos_unicos = list(set(produtos_entradas + produtos_saidas))
        
        # Buscar estoque por filial dos produtos encontrados
        df_estoque = pd.DataFrame()
        if produtos_unicos:
            print(f"⏳ Buscando estoque de {len(produtos_unicos)} produtos por filial...", end=' ', flush=True)
            
            # Criar placeholders para a query
            placeholders = ','.join([f"'{p}'" for p in produtos_unicos])
            
            query_estoque = f"""
                SELECT 
                    E.PRODUTO,
                    P.DESC_PRODUTO,
                    E.COR_PRODUTO,
                    C.DESC_COR AS DESC_COR_PRODUTO,
                    E.FILIAL,
                    F.FILIAL AS NOME_FILIAL,
                    E.ESTOQUE,
                    P.GRUPO_PRODUTO,
                    P.SUBGRUPO_PRODUTO,
                    P.LINHA,
                    P.COLECAO
                FROM ESTOQUE_PRODUTOS E WITH (NOLOCK)
                LEFT JOIN PRODUTOS P WITH (NOLOCK)
                    ON E.PRODUTO = P.PRODUTO
                LEFT JOIN CORES_BASICAS C WITH (NOLOCK)
                    ON E.COR_PRODUTO = C.COR
                LEFT JOIN FILIAIS F WITH (NOLOCK)
                    ON E.FILIAL = F.COD_FILIAL
                WHERE E.PRODUTO IN ({placeholders})
                    AND E.ESTOQUE != 0
                ORDER BY E.PRODUTO, E.FILIAL, E.COR_PRODUTO
            """
            
            df_estoque = pd.read_sql(query_estoque, conn)
            print(f"✓ {len(df_estoque)} registros de estoque encontrados")
        
        # Exibir resultados
        exibir_dataframe(df_entradas, "ENTRADAS", num_registros=10)
        exibir_dataframe(df_saidas, "SAÍDAS", num_registros=10)
        
        if not df_estoque.empty:
            exibir_estoque_por_filial(df_estoque, "ESTOQUE")
        
        print("\n" + "╔" + "═"*100 + "╗")
        print("║" + "  ✅ CONCLUÍDO COM SUCESSO!".center(98) + "║")
        print("╚" + "═"*100 + "╝")
        
    except Exception as e:
        print(f"\n✗ ERRO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão fechada")

if __name__ == '__main__':
    main()

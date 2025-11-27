#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de teste para validar dados da filial NERD MORUMBI RDRRRJ
Período: novembro 2025 até a data mais recente disponível
"""

import pandas as pd
import pyodbc
from datetime import datetime

# Config conexão
DB_CONFIG = {
    'server': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server"""
    try:
        print("Conectando ao banco de dados...")
        conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                   f"SERVER={DB_CONFIG['server']};"
                   f"DATABASE={DB_CONFIG['database']};"
                   f"UID={DB_CONFIG['username']};"
                   f"PWD={DB_CONFIG['password']};")
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"✗ Erro na conexão: {e}")
        raise

def testar_filial_morumbi():
    """Testa a filial NERD MORUMBI RDRRRJ para novembro 2025 até data mais recente"""
    print("="*80)
    print("TESTE: FILIAL NERD MORUMBI RDRRRJ")
    print("Período: Novembro 2025 até a data mais recente disponível")
    print("="*80)
    
    conn = None
    try:
        conn = conectar_banco()
        
        # Primeiro, fazer uma query exploratória para identificar a coluna de data
        query_exploratoria = """
        SELECT TOP 5 *
        FROM CLIENTES_VAREJO WITH (NOLOCK)
        WHERE FILIAL LIKE '%MORUMBI%'
        """
        
        df_sample = pd.read_sql(query_exploratoria, conn)
        print("\n[AMOSTRA] Amostra de dados da filial MORUMBI:")
        print(df_sample.head())
        print(f"\nColunas disponíveis: {list(df_sample.columns)}")
        
        # Identificar coluna de data
        col_data = None
        if 'CADASTRAMENTO' in df_sample.columns:
            col_data = 'CADASTRAMENTO'
        else:
            for col in df_sample.columns:
                if 'CADASTRO' in col.upper() or 'INCLUSAO' in col.upper():
                    col_data = col
                    break
        
        if not col_data:
            for col in df_sample.columns:
                if 'DATA' in col.upper() and 'TRANSFERENCIA' not in col.upper():
                    if df_sample[col].dtype == 'datetime64[ns]' or 'datetime' in str(df_sample[col].dtype):
                        col_data = col
                        break
        
        if not col_data:
            print("[ERRO] Não foi possível identificar a coluna de data")
            return
        
        print(f"\n[INFO] Coluna de data identificada: {col_data}")
        
        # Identificar colunas de vendedor e filial
        col_vendedor = None
        col_filial = None
        
        for col in df_sample.columns:
            if 'VENDEDOR' in col.upper():
                col_vendedor = col
            if 'FILIAL' in col.upper():
                col_filial = col
        
        print(f"[INFO] Coluna de vendedor: {col_vendedor}")
        print(f"[INFO] Coluna de filial: {col_filial}")
        
        # Verificar qual é o nome exato da filial no banco
        query_filiais = f"""
        SELECT DISTINCT {col_filial} AS FILIAL
        FROM CLIENTES_VAREJO WITH (NOLOCK)
        WHERE {col_filial} LIKE '%MORUMBI%'
        ORDER BY {col_filial}
        """
        df_filiais = pd.read_sql(query_filiais, conn)
        print(f"\n[INFO] Filiais encontradas com 'MORUMBI':")
        for idx, row in df_filiais.iterrows():
            print(f"   - '{row['FILIAL']}'")
        
        # Buscar a data mais recente disponível
        query_data_max = f"""
        SELECT MAX({col_data}) AS DATA_MAXIMA
        FROM CLIENTES_VAREJO WITH (NOLOCK)
        WHERE YEAR({col_data}) >= 2025
        """
        df_data_max = pd.read_sql(query_data_max, conn)
        data_maxima = df_data_max['DATA_MAXIMA'].iloc[0] if not df_data_max.empty else None
        
        print(f"\n[INFO] Data mais recente disponível: {data_maxima}")
        
        # Construir query para buscar clientes de novembro 2025 até a data mais recente
        # Filtrar pela filial específica
        filial_alvo = "NERD MORUMBI RDRRRJ"
        
        select_cols = [
            f"{col_data} AS DATA_CADASTRO",
            "CLIENTE_VAREJO AS NOME_CLIENTE",
            "CASE WHEN DDD IS NOT NULL AND TELEFONE IS NOT NULL THEN DDD + ' ' + TELEFONE ELSE ISNULL(TELEFONE, '') END AS TELEFONE",
            "CASE WHEN DDD_CELULAR IS NOT NULL AND CELULAR IS NOT NULL THEN DDD_CELULAR + ' ' + CELULAR ELSE ISNULL(CELULAR, '') END AS CELULAR",
            "ISNULL(EMAIL, '') AS EMAIL",
            "ISNULL(CPF_CGC, '') AS CPF_CNPJ"
        ]
        
        if col_vendedor:
            select_cols.append(f"{col_vendedor} AS VENDEDOR")
        else:
            select_cols.append("NULL AS VENDEDOR")
        
        if col_filial:
            select_cols.append(f"{col_filial} AS FILIAL")
        else:
            select_cols.append("NULL AS FILIAL")
        
        # Query: novembro 2025 até a data mais recente
        # WHERE: ano >= 2025 AND (ano > 2025 OR (ano = 2025 AND mes >= 11))
        query_final = f"""
        SELECT 
            {', '.join(select_cols)}
        FROM CLIENTES_VAREJO WITH (NOLOCK)
        WHERE 
            YEAR({col_data}) >= 2025
            AND (YEAR({col_data}) > 2025 OR (YEAR({col_data}) = 2025 AND MONTH({col_data}) >= 11))
            AND LTRIM(RTRIM(CAST({col_filial} AS VARCHAR))) = '{filial_alvo}'
        ORDER BY {col_data}, CLIENTE_VAREJO
        """
        
        print(f"\n[QUERY] Executando query final...")
        print(f"Query (primeiros 800 chars):\n{query_final[:800]}...")
        
        df = pd.read_sql(query_final, conn)
        
        if df.empty:
            print("\n[AVISO] Nenhum cliente encontrado com os filtros especificados")
            print(f"   Filial procurada: '{filial_alvo}'")
            print(f"   Período: Novembro 2025 até {data_maxima}")
            
            # Tentar buscar com variações do nome da filial
            print("\n[TESTE] Tentando buscar com variações do nome da filial...")
            query_teste = f"""
            SELECT DISTINCT {col_filial} AS FILIAL
            FROM CLIENTES_VAREJO WITH (NOLOCK)
            WHERE {col_filial} LIKE '%MORUMBI%' OR {col_filial} LIKE '%RDRRRJ%'
            """
            df_teste = pd.read_sql(query_teste, conn)
            if not df_teste.empty:
                print("   Filiais encontradas:")
                for idx, row in df_teste.iterrows():
                    print(f"      - '{row['FILIAL']}'")
            return
        
        print(f"\n[OK] Encontrados {len(df):,} clientes cadastrados")
        print(f"   Filial: {filial_alvo}")
        print(f"   Período: Novembro 2025 até {data_maxima}")
        
        # Estatísticas por data
        if 'DATA_CADASTRO' in df.columns:
            df['DATA_CADASTRO'] = pd.to_datetime(df['DATA_CADASTRO'])
            print(f"\n[ESTATÍSTICAS] Por data:")
            print(f"   Data mais antiga: {df['DATA_CADASTRO'].min()}")
            print(f"   Data mais recente: {df['DATA_CADASTRO'].max()}")
            
            # Agrupar por mês/ano
            df['ANO_MES'] = df['DATA_CADASTRO'].dt.to_period('M')
            resumo_mes = df.groupby('ANO_MES').size().reset_index(name='QUANTIDADE')
            resumo_mes.columns = ['PERIODO', 'QUANTIDADE']
            print(f"\n[RESUMO] Por período:")
            for idx, row in resumo_mes.iterrows():
                print(f"   {row['PERIODO']}: {row['QUANTIDADE']:,} clientes")
        
        # Estatísticas por vendedor
        if 'VENDEDOR' in df.columns:
            print(f"\n[VENDEDORES] Vendedores que cadastraram clientes:")
            resumo_vendedor = df.groupby('VENDEDOR').size().reset_index(name='QUANTIDADE')
            resumo_vendedor = resumo_vendedor.sort_values('QUANTIDADE', ascending=False)
            resumo_vendedor.columns = ['VENDEDOR', 'QUANTIDADE']
            for idx, row in resumo_vendedor.iterrows():
                vendedor = row['VENDEDOR'] if pd.notna(row['VENDEDOR']) and str(row['VENDEDOR']).strip() != '' else 'Sem vendedor'
                print(f"   {vendedor}: {row['QUANTIDADE']:,} clientes")
        
        # Listar todos os clientes
        print(f"\n[CLIENTES] Lista completa de clientes cadastrados:")
        print("-" * 80)
        for idx, row in df.iterrows():
            data = row['DATA_CADASTRO'] if pd.notna(row['DATA_CADASTRO']) else 'N/A'
            nome = row['NOME_CLIENTE'] if pd.notna(row['NOME_CLIENTE']) else 'N/A'
            vendedor = row['VENDEDOR'] if pd.notna(row['VENDEDOR']) and str(row['VENDEDOR']).strip() != '' else 'Sem vendedor'
            print(f"{idx+1:4d}. [{data}] {nome} - Vendedor: {vendedor}")
        
        # Resumo final
        print("\n" + "="*80)
        print("[RESUMO FINAL]")
        print("="*80)
        print(f"Total de clientes cadastrados: {len(df):,}")
        if 'VENDEDOR' in df.columns:
            vendedores_unicos = df['VENDEDOR'].dropna()
            vendedores_unicos = vendedores_unicos[vendedores_unicos.astype(str).str.strip() != '']
            print(f"Total de vendedores distintos: {vendedores_unicos.nunique()}")
        print(f"Período: Novembro 2025 até {data_maxima}")
        print("="*80)
        
        return df
        
    except Exception as e:
        print(f"\n[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()
            print("\n[INFO] Conexão fechada")

if __name__ == '__main__':
    testar_filial_morumbi()


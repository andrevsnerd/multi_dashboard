#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investigação Profunda de Entradas - Fase 2
Foca nas filiais problemáticas e tabelas promissoras identificadas
"""

import os
import sys
import pyodbc
import pandas as pd
from datetime import datetime

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

# Produtos e filiais problemáticas identificadas
PRODUTOS_INVESTIGAR = ['13.46.0400', '28.05.0114', '14.09.0226']

FILIAIS_PROBLEMATICAS = [
    'OSCAR FREIRE - FSZ',
    'SCARF ME - HIGIENOPOLIS 2',
    'SCARF ME - MATRIZ LLL',
    'SCARFME - IBIRAPUERA LLL',
    'VILLA LOBOS - LLL',
    'GUARULHOS - RSR',
    'SCARFME ME - PAULISTA FFF'
]

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
            if nome == 'principal':
                print("Tentando servidor fallback...")
            continue
    
    print(f"[ERRO] Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    sys.exit(1)

def investigar_loja_entradas_detalhado(conn, produtos, filiais):
    """Investigação detalhada de LOJA_ENTRADAS_PRODUTO"""
    print("\n" + "="*80)
    print("INVESTIGACAO 1: LOJA_ENTRADAS_PRODUTO (Detalhado)")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    filiais_placeholders = ','.join([f"'{f}'" for f in filiais])
    
    try:
        # Verificar estrutura da tabela
        query_cols = """
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'LOJA_ENTRADAS_PRODUTO'
            ORDER BY ORDINAL_POSITION
        """
        cols_df = pd.read_sql(query_cols, conn)
        print(f"\n[INFO] Estrutura de LOJA_ENTRADAS_PRODUTO:")
        print(cols_df.to_string())
        
        # Verificar estrutura de LOJA_ENTRADAS também
        query_cols_le = """
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'LOJA_ENTRADAS'
            ORDER BY ORDINAL_POSITION
        """
        cols_le_df = pd.read_sql(query_cols_le, conn)
        cols_le = cols_le_df['COLUMN_NAME'].tolist()
        print(f"\n[INFO] Estrutura de LOJA_ENTRADAS: {', '.join(cols_le[:15])}...")
        
        # Buscar entradas para os produtos (usando estrutura correta)
        col_romaneio = 'ROMANEIO_PRODUTO' if 'ROMANEIO_PRODUTO' in cols_le else 'ROMANEIO'
        col_data = [c for c in cols_le if 'DATA' in c.upper()][0] if any('DATA' in c.upper() for c in cols_le) else None
        
        query = f"""
            SELECT 
                lep.FILIAL,
                lep.ROMANEIO_PRODUTO,
                lep.PRODUTO,
                lep.COR_PRODUTO,
                lep.QTDE_ENTRADA,
                lep.DATA_PARA_TRANSFERENCIA
            FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
            WHERE lep.PRODUTO IN ({placeholders})
            ORDER BY lep.DATA_PARA_TRANSFERENCIA DESC
        """
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontradas {len(df)} entradas em LOJA_ENTRADAS_PRODUTO")
            
            # Filtrar por filiais problemáticas
            df_filiais = df[df['FILIAL'].isin(filiais)]
            if len(df_filiais) > 0:
                print(f"\n[ATENCAO] {len(df_filiais)} entradas nas filiais problematicas:")
                for _, row in df_filiais.iterrows():
                    data_str = row['DATA_PARA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_PARA_TRANSFERENCIA']) else 'N/A'
                    print(f"  {data_str} | {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Qtde: {row['QTDE_ENTRADA']} | Romaneio: {row['ROMANEIO_PRODUTO']}")
            else:
                print(f"\n[INFO] Nenhuma entrada encontrada nas filiais problematicas")
        
            # Agrupar por filial e produto
            if len(df) > 0:
                print(f"\n[INFO] Resumo por filial (todas as entradas):")
                resumo = df.groupby(['FILIAL', 'PRODUTO', 'COR_PRODUTO']).agg({
                    'QTDE_ENTRADA': 'sum',
                    'DATA_PARA_TRANSFERENCIA': 'max'
                }).reset_index()
                for _, row in resumo.head(20).iterrows():
                    data_str = row['DATA_PARA_TRANSFERENCIA'].strftime('%d/%m/%Y') if pd.notna(row['DATA_PARA_TRANSFERENCIA']) else 'N/A'
                    print(f"  {row['FILIAL']} | {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | Total: {row['QTDE_ENTRADA']} | Ultima: {data_str}")
            
            return df
        else:
            print("\n[INFO] Nenhuma entrada encontrada")
            return pd.DataFrame()
    except Exception as e:
        print(f"[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_estoque_historico_detalhado(conn, produtos, filiais):
    """Investigação detalhada de ESTOQUE_PRODUTOS_HISTORICO"""
    print("\n" + "="*80)
    print("INVESTIGACAO 2: ESTOQUE_PRODUTOS_HISTORICO (Detalhado)")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    filiais_placeholders = ','.join([f"'{f}'" for f in filiais])
    
    try:
        # Verificar estrutura
        query_cols = """
            SELECT COLUMN_NAME, DATA_TYPE
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = 'ESTOQUE_PRODUTOS_HISTORICO'
            ORDER BY ORDINAL_POSITION
        """
        cols_df = pd.read_sql(query_cols, conn)
        print(f"\n[INFO] Estrutura de ESTOQUE_PRODUTOS_HISTORICO:")
        print(cols_df.to_string())
        
        # Buscar histórico
        colunas_data = cols_df[cols_df['COLUMN_NAME'].str.contains('DATA|ENTRADA|EMISSAO', case=False, na=False)]['COLUMN_NAME'].tolist()
        coluna_filial = cols_df[cols_df['COLUMN_NAME'].str.contains('FILIAL', case=False, na=False)]['COLUMN_NAME'].tolist()
        
        if coluna_filial:
            col_filial = coluna_filial[0]
        else:
            col_filial = None
        
        if colunas_data:
            col_data = colunas_data[0]
            order_by = f"{col_data} DESC"
        else:
            order_by = "1"
        
        # Buscar histórico focando em ULTIMA_ENTRADA
        query = f"""
            SELECT 
                PRODUTO,
                COR_PRODUTO,
                FILIAL,
                ULTIMA_ENTRADA,
                ULTIMA_SAIDA,
                ESTOQUE,
                QTDE_LJ_ENT,
                QTDE_PROD_ENT,
                DATA_SALDO
            FROM ESTOQUE_PRODUTOS_HISTORICO WITH (NOLOCK)
            WHERE PRODUTO IN ({placeholders})
                AND FILIAL IN ({filiais_placeholders})
                AND ULTIMA_ENTRADA IS NOT NULL
            ORDER BY ULTIMA_ENTRADA DESC
        """
        df = pd.read_sql(query, conn)
        
        if len(df) > 0:
            print(f"\n[OK] Encontrados {len(df)} registros historicos com ULTIMA_ENTRADA nas filiais problematicas")
            print(f"\n[ATENCAO] ESTAS SAO AS ENTRADAS ENCONTRADAS NO HISTORICO:")
            for _, row in df.iterrows():
                data_entrada = row['ULTIMA_ENTRADA'].strftime('%d/%m/%Y') if pd.notna(row['ULTIMA_ENTRADA']) else 'N/A'
                data_saldo = row['DATA_SALDO'].strftime('%d/%m/%Y') if pd.notna(row['DATA_SALDO']) else 'N/A'
                print(f"  {row['PRODUTO']} | {row['COR_PRODUTO'] or 'SEM COR'} | {row['FILIAL']} | Ult.Entrada: {data_entrada} | Estoque: {row['ESTOQUE']} | Data Saldo: {data_saldo} | QTDE_LJ_ENT: {row['QTDE_LJ_ENT']} | QTDE_PROD_ENT: {row['QTDE_PROD_ENT']}")
        else:
            print(f"\n[INFO] Nenhum registro encontrado com ULTIMA_ENTRADA nas filiais problematicas")
            
            # Buscar todas as filiais para ver o padrão
            query_todas = f"""
                SELECT TOP 50
                    PRODUTO,
                    COR_PRODUTO,
                    FILIAL,
                    ULTIMA_ENTRADA,
                    ESTOQUE,
                    DATA_SALDO
                FROM ESTOQUE_PRODUTOS_HISTORICO WITH (NOLOCK)
                WHERE PRODUTO IN ({placeholders})
                    AND ULTIMA_ENTRADA IS NOT NULL
                ORDER BY ULTIMA_ENTRADA DESC
            """
            df_todas = pd.read_sql(query_todas, conn)
            if len(df_todas) > 0:
                print(f"\n[INFO] Encontrados {len(df_todas)} registros com ULTIMA_ENTRADA em outras filiais:")
                print(df_todas.head(10).to_string())
            
            return df
    except Exception as e:
        print(f"[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()
        return pd.DataFrame()

def investigar_transferencias_entre_filiais(conn, produtos, filiais):
    """Investiga transferências entre filiais que podem ter gerado estoque"""
    print("\n" + "="*80)
    print("INVESTIGACAO 3: TRANSFERENCIAS ENTRE FILIAIS")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    filiais_placeholders = ','.join([f"'{f}'" for f in filiais])
    
    # Tabelas possíveis de transferência
    tabelas_transferencia = [
        ('ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI', 'FILIAL_ORIGEM', 'FILIAL_DESTINO', 'EMISSAO'),
        ('LOJA_SAIDAS_ROMANEIO', 'LOJA_SAIDAS_ROMANEIO_PRODUTO', 'FILIAL', 'FILIAL_DESTINO', 'DATA_SAIDA'),
        ('ROMANEIOS', 'ROMANEIOS_PRODUTO', 'FILIAL_ORIGEM', 'FILIAL_DESTINO', 'DATA_ROMANEIO'),
    ]
    
    resultados = {}
    
    for tabela_cab, tabela_item, col_origem, col_destino, col_data in tabelas_transferencia:
        try:
            # Verificar se as tabelas existem
            query_check = f"""
                SELECT TOP 1 * FROM {tabela_item} WITH (NOLOCK)
            """
            pd.read_sql(query_check, conn)
            
            # Buscar transferências
            query = f"""
                SELECT TOP 50
                    t.{col_data} AS DATA_TRANSFERENCIA,
                    t.{col_origem} AS FILIAL_ORIGEM,
                    t.{col_destino} AS FILIAL_DESTINO,
                    tp.PRODUTO,
                    tp.COR_PRODUTO,
                    tp.QTDE,
                    t.ROMANEIO
                FROM {tabela_cab} t WITH (NOLOCK)
                INNER JOIN {tabela_item} tp WITH (NOLOCK)
                    ON t.ROMANEIO = tp.ROMANEIO
                WHERE tp.PRODUTO IN ({placeholders})
                    AND (t.{col_destino} IN ({filiais_placeholders}) OR t.{col_origem} IN ({filiais_placeholders}))
                ORDER BY t.{col_data} DESC
            """
            df = pd.read_sql(query, conn)
            
            if len(df) > 0:
                print(f"\n[OK] {tabela_item}: {len(df)} transferencias encontradas")
                print(df.head(10).to_string())
                resultados[tabela_item] = df
        except Exception as e:
            print(f"[INFO] {tabela_item}: {str(e)[:100]}")
            continue
    
    return resultados

def investigar_ajustes_estoque(conn, produtos, filiais):
    """Investiga ajustes de estoque que podem ter gerado estoque sem entrada"""
    print("\n" + "="*80)
    print("INVESTIGACAO 4: AJUSTES DE ESTOQUE")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    filiais_placeholders = ','.join([f"'{f}'" for f in filiais])
    
    # Verificar tabelas de ajuste
    tabelas_ajuste = [
        'INVENTARIO_AJUSTE',
        'ESTOQUE_PROD_CTG_AJUSTE',
        'LOJA_AJUSTE_TICKET_LOG'
    ]
    
    resultados = {}
    
    for tabela in tabelas_ajuste:
        try:
            # Verificar estrutura
            query_cols = f"""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{tabela}'
            """
            cols_df = pd.read_sql(query_cols, conn)
            colunas = cols_df['COLUMN_NAME'].tolist()
            
            if 'PRODUTO' in colunas:
                col_filial = [c for c in colunas if 'FILIAL' in c.upper()]
                col_data = [c for c in colunas if 'DATA' in c.upper() or 'EMISSAO' in c.upper()]
                
                if col_filial:
                    col_filial = col_filial[0]
                else:
                    continue
                
                if col_data:
                    col_data = col_data[0]
                    order_by = f"{col_data} DESC"
                else:
                    order_by = "1"
                
                query = f"""
                    SELECT TOP 50 *
                    FROM {tabela} WITH (NOLOCK)
                    WHERE PRODUTO IN ({placeholders})
                        AND {col_filial} IN ({filiais_placeholders})
                    ORDER BY {order_by}
                """
                df = pd.read_sql(query, conn)
                
                if len(df) > 0:
                    print(f"\n[OK] {tabela}: {len(df)} ajustes encontrados")
                    print(df.head(10).to_string())
                    resultados[tabela] = df
        except Exception as e:
            print(f"[INFO] {tabela}: {str(e)[:100]}")
            continue
    
    return resultados

def investigar_entradas_alternativas(conn, produtos, filiais):
    """Investiga outras tabelas de entrada que podem não estar sendo consultadas"""
    print("\n" + "="*80)
    print("INVESTIGACAO 5: OUTRAS TABELAS DE ENTRADA")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    filiais_placeholders = ','.join([f"'{f}'" for f in filiais])
    
    # Tabelas alternativas de entrada
    tabelas_entrada = [
        'ENTRADAS',
        'ENTRADAS_ITEM',
        'ENTRADAS_PRODUTO_bkp',
        'ESTOQUE_PRE_ENT_PROD',
        'MCX_INTEGRACAO_ESTOQUE_PROD_ENT',
        'MCX_INTEGRACAO_LOJA_ENTRADAS_PRODUTO'
    ]
    
    resultados = {}
    
    for tabela in tabelas_entrada:
        try:
            # Verificar se existe
            query_check = f"SELECT TOP 1 * FROM {tabela} WITH (NOLOCK)"
            pd.read_sql(query_check, conn)
            
            # Verificar colunas
            query_cols = f"""
                SELECT COLUMN_NAME
                FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_NAME = '{tabela}'
            """
            cols_df = pd.read_sql(query_cols, conn)
            colunas = cols_df['COLUMN_NAME'].tolist()
            
            if 'PRODUTO' in colunas:
                col_filial = [c for c in colunas if 'FILIAL' in c.upper()]
                col_data = [c for c in colunas if 'DATA' in c.upper() or 'EMISSAO' in c.upper() or 'ENTRADA' in c.upper()]
                
                if col_filial:
                    col_filial = col_filial[0]
                else:
                    continue
                
                if col_data:
                    col_data = col_data[0]
                    order_by = f"{col_data} DESC"
                else:
                    order_by = "1"
                
                query = f"""
                    SELECT TOP 50 *
                    FROM {tabela} WITH (NOLOCK)
                    WHERE PRODUTO IN ({placeholders})
                        AND {col_filial} IN ({filiais_placeholders})
                    ORDER BY {order_by}
                """
                df = pd.read_sql(query, conn)
                
                if len(df) > 0:
                    print(f"\n[OK] {tabela}: {len(df)} registros encontrados")
                    print(f"Colunas: {', '.join(colunas[:15])}...")
                    print(df.head(10).to_string())
                    resultados[tabela] = df
        except Exception as e:
            print(f"[INFO] {tabela}: {str(e)[:100]}")
            continue
    
    return resultados

def comparar_entradas_vs_estoque(conn, produtos, filiais):
    """Compara entradas encontradas com estoque atual"""
    print("\n" + "="*80)
    print("INVESTIGACAO 6: COMPARACAO ENTRADAS vs ESTOQUE")
    print("="*80)
    
    placeholders = ','.join([f"'{p}'" for p in produtos])
    filiais_placeholders = ','.join([f"'{f}'" for f in filiais])
    
    # Buscar estoque atual
    query_estoque = f"""
        SELECT 
            PRODUTO,
            COR_PRODUTO,
            FILIAL,
            ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO IN ({placeholders})
            AND FILIAL IN ({filiais_placeholders})
            AND ESTOQUE > 0
    """
    df_estoque = pd.read_sql(query_estoque, conn)
    
    # Buscar entradas conhecidas (ESTOQUE_PROD_ENT)
    query_entradas = f"""
        SELECT 
            P.PRODUTO,
            P.COR_PRODUTO,
            E.FILIAL,
            MAX(E.EMISSAO) AS ULTIMA_ENTRADA,
            SUM(P.QTDE) AS TOTAL_ENTRADA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
            ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        WHERE P.PRODUTO IN ({placeholders})
            AND E.FILIAL IN ({filiais_placeholders})
            AND P.PRODUTO IS NOT NULL
        GROUP BY P.PRODUTO, P.COR_PRODUTO, E.FILIAL
    """
    df_entradas = pd.read_sql(query_entradas, conn)
    
    # Comparar
    print(f"\n[INFO] Estoque atual: {len(df_estoque)} registros")
    print(f"[INFO] Entradas conhecidas: {len(df_entradas)} registros")
    
    # Criar chaves para comparação
    estoque_keys = set()
    for _, row in df_estoque.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        estoque_keys.add(key)
    
    entrada_keys = set()
    for _, row in df_entradas.iterrows():
        key = f"{row['PRODUTO']}|{row['COR_PRODUTO'] or ''}|{row['FILIAL']}"
        entrada_keys.add(key)
    
    sem_entrada = estoque_keys - entrada_keys
    
    print(f"\n[ATENCAO] {len(sem_entrada)} combinacoes produto+cor+filial com estoque mas SEM entrada conhecida:")
    for key in sorted(sem_entrada):
        produto, cor, filial = key.split('|')
        estoque_row = df_estoque[
            (df_estoque['PRODUTO'] == produto) & 
            (df_estoque['COR_PRODUTO'].fillna('') == cor) & 
            (df_estoque['FILIAL'] == filial)
        ]
        if len(estoque_row) > 0:
            estoque_val = estoque_row.iloc[0]['ESTOQUE']
            print(f"  {produto} | {cor or 'SEM COR'} | {filial} | Estoque: {estoque_val}")
    
    return df_estoque, df_entradas, sem_entrada

def main():
    """Função principal"""
    print("="*80)
    print("INVESTIGACAO PROFUNDA DE ENTRADAS - FASE 2")
    print("="*80)
    print(f"\nProdutos: {', '.join(PRODUTOS_INVESTIGAR)}")
    print(f"Filiais problematicas: {len(FILIAIS_PROBLEMATICAS)}")
    
    conn = None
    try:
        conn = conectar_banco()
        
        # 1. LOJA_ENTRADAS detalhado
        df_loja_entradas = investigar_loja_entradas_detalhado(conn, PRODUTOS_INVESTIGAR, FILIAIS_PROBLEMATICAS)
        
        # 2. ESTOQUE_PRODUTOS_HISTORICO detalhado
        df_historico = investigar_estoque_historico_detalhado(conn, PRODUTOS_INVESTIGAR, FILIAIS_PROBLEMATICAS)
        
        # 3. Transferências
        resultados_transferencias = investigar_transferencias_entre_filiais(conn, PRODUTOS_INVESTIGAR, FILIAIS_PROBLEMATICAS)
        
        # 4. Ajustes
        resultados_ajustes = investigar_ajustes_estoque(conn, PRODUTOS_INVESTIGAR, FILIAIS_PROBLEMATICAS)
        
        # 5. Outras tabelas de entrada
        resultados_entradas_alt = investigar_entradas_alternativas(conn, PRODUTOS_INVESTIGAR, FILIAIS_PROBLEMATICAS)
        
        # 6. Comparação final
        df_estoque, df_entradas, sem_entrada = comparar_entradas_vs_estoque(conn, PRODUTOS_INVESTIGAR, FILIAIS_PROBLEMATICAS)
        
        # Salvar resultados
        print("\n" + "="*80)
        print("SALVANDO RESULTADOS DETALHADOS")
        print("="*80)
        
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(script_dir, "data")
        os.makedirs(data_dir, exist_ok=True)
        
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        excel_path = os.path.join(data_dir, f"investigacao_profunda_{timestamp}.xlsx")
        
        with pd.ExcelWriter(excel_path, engine='xlsxwriter') as writer:
            if len(df_loja_entradas) > 0:
                df_loja_entradas.to_excel(writer, sheet_name='Loja_Entradas_Detalhado', index=False)
            if len(df_historico) > 0:
                df_historico.to_excel(writer, sheet_name='Estoque_Historico_Detalhado', index=False)
            df_estoque.to_excel(writer, sheet_name='Estoque_Atual', index=False)
            df_entradas.to_excel(writer, sheet_name='Entradas_Conhecidas', index=False)
            
            for nome, df in resultados_transferencias.items():
                df.to_excel(writer, sheet_name=f'Transferencia_{nome[:30]}', index=False)
            
            for nome, df in resultados_ajustes.items():
                df.to_excel(writer, sheet_name=f'Ajuste_{nome[:30]}', index=False)
            
            for nome, df in resultados_entradas_alt.items():
                df.to_excel(writer, sheet_name=f'Entrada_Alt_{nome[:30]}', index=False)
        
        print(f"[OK] Relatorio salvo em: {excel_path}")
        
        print("\n" + "="*80)
        print("INVESTIGACAO PROFUNDA CONCLUIDA!")
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

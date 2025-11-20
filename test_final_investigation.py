#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investigação final para encontrar os 625.60 faltantes
"""

import pyodbc
import pandas as pd

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
        conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                   f"SERVER={DB_CONFIG['server']};"
                   f"DATABASE={DB_CONFIG['database']};"
                   f"UID={DB_CONFIG['username']};"
                   f"PWD={DB_CONFIG['password']};")
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"[ERRO] Erro conexao: {e}")
        raise

def main():
    """Investigação final"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'
    
    print("="*80)
    print("INVESTIGACAO FINAL: Encontrando os 625.60 faltantes")
    print("="*80)
    print("Query exata retorna: 399,430.49")
    print("Esperado: 400,056.09")
    print("Faltando: 625.60")
    print()
    
    # Verificar se há registros com EMISSAO fora do range mas que podem estar na planilha
    print("="*80)
    print("TESTE 1: Verificando registros com EMISSAO fora do range")
    print("="*80)
    
    query_fora_range = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            MIN(CAST(f.EMISSAO AS DATE)) AS primeira_data,
            MAX(CAST(f.EMISSAO AS DATE)) AS ultima_data
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND (
              CAST(f.EMISSAO AS DATE) < '{START_DATE}' 
              OR CAST(f.EMISSAO AS DATE) > '{END_DATE}'
          )
          AND CAST(f.EMISSAO AS DATE) >= '2025-10-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-12-31'
    """
    
    df_fora = pd.read_sql(query_fora_range, conn)
    print(df_fora.to_string(index=False))
    
    # Verificar se a planilha pode estar usando DATA_SAIDA em vez de EMISSAO
    print("\n" + "="*80)
    print("TESTE 2: Verificando se usa DATA_SAIDA em vez de EMISSAO")
    print("="*80)
    
    query_data_saida = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(ISNULL(f.DATA_SAIDA, f.EMISSAO) AS DATE) >= '{START_DATE}' 
          AND CAST(ISNULL(f.DATA_SAIDA, f.EMISSAO) AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df_data_saida = pd.read_sql(query_data_saida, conn)
    row = df_data_saida.iloc[0]
    print(f"Total registros: {row['total']:,}")
    print(f"VALOR_LIQUIDO: {row['total_valor_liquido']:,.2f}")
    print(f"QTDE: {row['total_qtde']:,.0f}")
    print(f"Diferença: {row['total_valor_liquido'] - 400056.09:,.2f}")
    
    # Verificar se há registros com VALOR_LIQUIDO = 0 mas VALOR > 0 que podem estar sendo contados
    print("\n" + "="*80)
    print("TESTE 3: Registros com VALOR_LIQUIDO = 0 mas VALOR > 0")
    print("="*80)
    
    query_valor_zero = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR, 0)) AS total_valor
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND ISNULL(fp.VALOR_LIQUIDO, 0) = 0
          AND ISNULL(fp.VALOR, 0) > 0
    """
    
    df_valor_zero = pd.read_sql(query_valor_zero, conn)
    print(df_valor_zero.to_string(index=False))
    
    # Verificar se a planilha está somando VALOR + DIF_PRODUCAO_LIQUIDO
    print("\n" + "="*80)
    print("TESTE 4: Verificando se soma VALOR_LIQUIDO + DIF_PRODUCAO_LIQUIDO")
    print("="*80)
    
    query_com_dif = f"""
        SELECT 
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.DIF_PRODUCAO_LIQUIDO, 0)) AS total_dif_producao,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0) + ISNULL(fp.DIF_PRODUCAO_LIQUIDO, 0)) AS total_com_dif
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df_dif = pd.read_sql(query_com_dif, conn)
    row_dif = df_dif.iloc[0]
    print(f"VALOR_LIQUIDO: {row_dif['total_valor_liquido']:,.2f}")
    print(f"DIF_PRODUCAO_LIQUIDO: {row_dif['total_dif_producao']:,.2f}")
    print(f"Soma (VALOR_LIQUIDO + DIF_PRODUCAO_LIQUIDO): {row_dif['total_com_dif']:,.2f}")
    print(f"Esperado: 400,056.09")
    print(f"Diferença: {row_dif['total_com_dif'] - 400056.09:,.2f}")
    
    conn.close()
    
    print("\n" + "="*80)
    print("CONCLUSÃO")
    print("="*80)
    print("A diferença de 625.60 pode ser:")
    print("1. Algum cálculo adicional na planilha")
    print("2. Algum registro específico que a planilha inclui")
    print("3. Diferença de arredondamento")
    print("4. Algum filtro adicional que não estamos aplicando")

if __name__ == '__main__':
    main()


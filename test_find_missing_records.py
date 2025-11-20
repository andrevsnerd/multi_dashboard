#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para encontrar os registros faltantes que explicam a diferença de 625.60
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
    """Encontra registros faltantes"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'
    
    print("="*80)
    print("BUSCANDO REGISTROS FALTANTES")
    print("="*80)
    print(f"Esperado: 400,056.09")
    print(f"Encontrado (query exata): 399,430.49")
    print(f"Faltando: 625.60")
    print()
    
    # Query exata do export (com LEFT JOINs)
    query_exata = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            f.FILIAL,
            f.EMISSAO,
            fp.PRODUTO,
            fp.ITEM,
            fp.QTDE,
            fp.VALOR_LIQUIDO,
            fp.VALOR,
            fp.PRECO,
            f.NOTA_CANCELADA,
            f.NATUREZA_SAIDA,
            p.PRODUTO AS produto_existe
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
        ORDER BY f.EMISSAO, f.NF_SAIDA, fp.ITEM
    """
    
    df = pd.read_sql(query_exata, conn)
    
    print(f"Total de registros encontrados: {len(df):,}")
    print(f"Soma VALOR_LIQUIDO: {df['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
    print()
    
    # Verificar se há registros com produto NULL (LEFT JOIN não encontrou)
    produtos_null = df[df['produto_existe'].isna()]
    if len(produtos_null) > 0:
        print(f"[INFO] {len(produtos_null):,} registros com produto NULL (LEFT JOIN)")
        print(f"  VALOR_LIQUIDO desses: {produtos_null['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
        print("\nPrimeiros 10:")
        print(produtos_null[['NF_SAIDA', 'SERIE_NF', 'PRODUTO', 'VALOR_LIQUIDO']].head(10).to_string(index=False))
    
    # Verificar se há registros com VALOR_LIQUIDO NULL mas VALOR > 0
    valor_liquido_null = df[(df['VALOR_LIQUIDO'].isna()) & (df['VALOR'].fillna(0) > 0)]
    if len(valor_liquido_null) > 0:
        print(f"\n[INFO] {len(valor_liquido_null):,} registros com VALOR_LIQUIDO NULL mas VALOR > 0")
        print(f"  VALOR desses: {valor_liquido_null['VALOR'].fillna(0).sum():,.2f}")
        print("\nPrimeiros 10:")
        print(valor_liquido_null[['NF_SAIDA', 'SERIE_NF', 'PRODUTO', 'VALOR', 'VALOR_LIQUIDO']].head(10).to_string(index=False))
    
    # Verificar se a planilha pode estar usando VALOR em vez de VALOR_LIQUIDO quando VALOR_LIQUIDO é NULL
    print("\n" + "="*80)
    print("TESTE: Usando VALOR quando VALOR_LIQUIDO e NULL")
    print("="*80)
    
    df['VALOR_USADO'] = df['VALOR_LIQUIDO'].fillna(df['VALOR']).fillna(0)
    total_com_valor_fallback = df['VALOR_USADO'].sum()
    
    print(f"Total usando VALOR_LIQUIDO (ou VALOR se NULL): {total_com_valor_fallback:,.2f}")
    print(f"Esperado: 400,056.09")
    print(f"Diferença: {total_com_valor_fallback - 400056.09:,.2f}")
    
    # Verificar se há registros que não estão na query mas deveriam estar
    # (por exemplo, registros com natureza diferente ou notas canceladas)
    print("\n" + "="*80)
    print("VERIFICANDO: Registros excluídos pelos filtros")
    print("="*80)
    
    # Registros com NOTA_CANCELADA = 1
    query_canceladas = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 1
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df_canceladas = pd.read_sql(query_canceladas, conn)
    print("Notas CANCELADAS (excluídas pelo filtro):")
    print(df_canceladas.to_string(index=False))
    
    # Verificar outras naturezas de saída
    query_outras_naturezas = f"""
        SELECT 
            f.NATUREZA_SAIDA,
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.FILIAL = '{FILIAL}'
          AND f.NATUREZA_SAIDA NOT IN ('100.02', '100.022')
        GROUP BY f.NATUREZA_SAIDA
        ORDER BY total_valor_liquido DESC
    """
    
    df_outras = pd.read_sql(query_outras_naturezas, conn)
    if len(df_outras) > 0:
        print("\nOutras NATUREZAS_SAIDA (excluídas pelo filtro):")
        print(df_outras.to_string(index=False))
    
    conn.close()
    
    print("\n" + "="*80)
    print("RESUMO")
    print("="*80)
    print(f"Registros encontrados: {len(df):,}")
    print(f"VALOR_LIQUIDO: {df['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
    print(f"VALOR (com fallback): {total_com_valor_fallback:,.2f}")
    print(f"Esperado: 400,056.09")
    print(f"Diferença restante: {total_com_valor_fallback - 400056.09:,.2f}")

if __name__ == '__main__':
    main()


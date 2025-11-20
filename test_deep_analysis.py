#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Análise profunda para encontrar a causa exata da diferença
"""

import pyodbc
import pandas as pd
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
        conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                   f"SERVER={DB_CONFIG['server']};"
                   f"DATABASE={DB_CONFIG['database']};"
                   f"UID={DB_CONFIG['username']};"
                   f"PWD={DB_CONFIG['password']};")
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"[ERRO] Erro conexão: {e}")
        raise

def test_verificar_duplicatas():
    """Verifica se há registros duplicados que podem estar sendo contados duas vezes"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE: Verificação de DUPLICATAS")
    print("="*80)
    
    query = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            f.FILIAL,
            fp.ITEM,
            fp.PRODUTO,
            fp.QTDE,
            fp.VALOR_LIQUIDO,
            COUNT(*) AS vezes_aparece
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
        GROUP BY f.NF_SAIDA, f.SERIE_NF, f.FILIAL, fp.ITEM, fp.PRODUTO, fp.QTDE, fp.VALOR_LIQUIDO
        HAVING COUNT(*) > 1
    """
    
    df = pd.read_sql(query, conn)
    
    if len(df) > 0:
        print(f"[AVISO] Encontrados {len(df):,} grupos de registros duplicados!")
        print("\nPrimeiros 10:")
        print(df.head(10).to_string(index=False))
    else:
        print("[OK] Nenhuma duplicata encontrada")
    
    conn.close()
    return df

def test_verificar_join_problemas():
    """Verifica se há problemas com o JOIN"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE: Verificação de PROBLEMAS no JOIN")
    print("="*80)
    
    # FATURAMENTO sem produtos
    query_faturas_sem_produtos = f"""
        SELECT 
            COUNT(*) AS total_faturas,
            SUM(f.VALOR_TOTAL) AS valor_total_faturas
        FROM FATURAMENTO f WITH (NOLOCK)
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND NOT EXISTS (
              SELECT 1 
              FROM W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
              WHERE f.FILIAL = fp.FILIAL 
                AND f.NF_SAIDA = fp.NF_SAIDA 
                AND f.SERIE_NF = fp.SERIE_NF
          )
    """
    
    df1 = pd.read_sql(query_faturas_sem_produtos, conn)
    print("Faturas SEM produtos (não fazem JOIN):")
    print(df1.to_string(index=False))
    
    # Produtos sem faturamento
    query_produtos_sem_faturamento = f"""
        SELECT 
            COUNT(*) AS total_produtos
        FROM W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
        WHERE EXISTS (
            SELECT 1 
            FROM FATURAMENTO f WITH (NOLOCK)
            WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
              AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
              AND f.NOTA_CANCELADA = 0
              AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              AND f.FILIAL = '{FILIAL}'
              AND f.FILIAL = fp.FILIAL 
              AND f.NF_SAIDA = fp.NF_SAIDA 
              AND f.SERIE_NF = fp.SERIE_NF
        )
          AND NOT EXISTS (
              SELECT 1 
              FROM FATURAMENTO f WITH (NOLOCK)
              WHERE f.FILIAL = fp.FILIAL 
                AND f.NF_SAIDA = fp.NF_SAIDA 
                AND f.SERIE_NF = fp.SERIE_NF
                AND CAST(f.EMISSAO AS DATE) >= '2025-11-01'
                AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
                AND f.NOTA_CANCELADA = 0
                AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          )
    """
    
    df2 = pd.read_sql(query_produtos_sem_faturamento, conn)
    print("\nProdutos SEM faturamento correspondente:")
    print(df2.to_string(index=False))
    
    conn.close()
    return df1, df2

def test_verificar_filial_variacoes():
    """Verifica todas as variações possíveis do nome da filial"""
    conn = conectar_banco()
    
    print("\n" + "="*80)
    print("TESTE: Variações do nome da FILIAL")
    print("="*80)
    
    query = """
        SELECT DISTINCT 
            f.FILIAL,
            LEN(f.FILIAL) AS tamanho,
            LEN(LTRIM(RTRIM(f.FILIAL))) AS tamanho_trim,
            ASCII(SUBSTRING(f.FILIAL, LEN(f.FILIAL), 1)) AS ultimo_char_ascii,
            COUNT(*) AS totalRegistros,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
            SUM(ISNULL(fp.QTDE, 0)) AS totalQtde
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL LIKE 'SCARFME MATRIZ CMS%'
        GROUP BY f.FILIAL, LEN(f.FILIAL), LEN(LTRIM(RTRIM(f.FILIAL))), ASCII(SUBSTRING(f.FILIAL, LEN(f.FILIAL), 1))
        ORDER BY totalRegistros DESC
    """
    
    df = pd.read_sql(query, conn)
    
    print("Todas as variações encontradas:")
    print(df.to_string(index=False))
    
    # Testar com TRIM
    print("\n" + "-"*80)
    print("Testando com TRIM no JOIN e no filtro:")
    print("-"*80)
    
    query_trim = """
        SELECT 
            COUNT(*) AS totalRegistros,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
            SUM(ISNULL(fp.QTDE, 0)) AS totalQtde
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(fp.FILIAL))
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND LTRIM(RTRIM(f.FILIAL)) = 'SCARFME MATRIZ CMS'
    """
    
    df_trim = pd.read_sql(query_trim, conn)
    print(df_trim.to_string(index=False))
    
    conn.close()
    return df

def test_verificar_diferencas_por_nota():
    """Verifica diferenças agrupadas por nota fiscal"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE: Análise por NOTA FISCAL")
    print("="*80)
    
    query = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            CAST(f.EMISSAO AS DATE) AS data_emissao,
            COUNT(*) AS total_itens,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido,
            SUM(ISNULL(fp.VALOR, 0)) AS total_valor,
            SUM(ISNULL(fp.PRECO * fp.QTDE, 0)) AS total_preco_qtde
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
        GROUP BY f.NF_SAIDA, f.SERIE_NF, CAST(f.EMISSAO AS DATE)
        ORDER BY data_emissao DESC, f.NF_SAIDA
    """
    
    df = pd.read_sql(query, conn)
    
    print(f"Total de notas: {len(df):,}")
    print(f"Soma VALOR_LIQUIDO: {df['total_valor_liquido'].sum():,.2f}")
    print(f"Soma QTDE: {df['total_qtde'].sum():,.0f}")
    
    # Notas com maior valor
    print("\nTop 10 notas com maior VALOR_LIQUIDO:")
    print(df.nlargest(10, 'total_valor_liquido')[['NF_SAIDA', 'SERIE_NF', 'data_emissao', 'total_valor_liquido', 'total_qtde']].to_string(index=False))
    
    # Verificar se há notas com diferença entre VALOR_LIQUIDO e VALOR
    df['diff_valor'] = df['total_valor'] - df['total_valor_liquido']
    notas_com_diff = df[df['diff_valor'].abs() > 0.01]
    
    if len(notas_com_diff) > 0:
        print(f"\n[AVISO] {len(notas_com_diff):,} notas com diferenca entre VALOR e VALOR_LIQUIDO > 0.01")
        print("Primeiras 10:")
        print(notas_com_diff.head(10)[['NF_SAIDA', 'SERIE_NF', 'total_valor', 'total_valor_liquido', 'diff_valor']].to_string(index=False))
    
    conn.close()
    return df

def test_verificar_registros_especiais():
    """Verifica registros com características especiais que podem estar sendo excluídos"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE: Registros ESPECIAIS")
    print("="*80)
    
    # Registros com QTDE = 0 mas VALOR_LIQUIDO > 0
    query1 = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND ISNULL(fp.QTDE, 0) = 0
          AND ISNULL(fp.VALOR_LIQUIDO, 0) > 0
    """
    
    df1 = pd.read_sql(query1, conn)
    print("Registros com QTDE = 0 mas VALOR_LIQUIDO > 0:")
    print(df1.to_string(index=False))
    
    # Registros com QTDE < 0
    query2 = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS total_valor_liquido
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND ISNULL(fp.QTDE, 0) < 0
    """
    
    df2 = pd.read_sql(query2, conn)
    print("\nRegistros com QTDE < 0:")
    print(df2.to_string(index=False))
    
    # Registros com VALOR_LIQUIDO NULL
    query3 = f"""
        SELECT 
            COUNT(*) AS total,
            SUM(ISNULL(fp.VALOR, 0)) AS total_valor,
            SUM(ISNULL(fp.QTDE, 0)) AS total_qtde
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL 
            AND f.NF_SAIDA = fp.NF_SAIDA 
            AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND fp.VALOR_LIQUIDO IS NULL
    """
    
    df3 = pd.read_sql(query3, conn)
    print("\nRegistros com VALOR_LIQUIDO NULL:")
    print(df3.to_string(index=False))
    
    conn.close()
    return df1, df2, df3

def main():
    """Executa todas as análises"""
    print("="*80)
    print("ANÁLISE PROFUNDA: Investigação da Diferença")
    print("="*80)
    
    try:
        test_verificar_duplicatas()
        test_verificar_join_problemas()
        test_verificar_filial_variacoes()
        test_verificar_diferencas_por_nota()
        test_verificar_registros_especiais()
        
        print("\n" + "="*80)
        print("ANÁLISE CONCLUÍDA")
        print("="*80)
        print("\nVerifique os resultados acima para identificar a causa.")
        
    except Exception as e:
        print(f"\n[ERRO] Erro: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()


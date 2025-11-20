#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Mostra exemplos concretos de como as duplicatas são geradas
"""

import pyodbc
import pandas as pd

DB_CONFIG = {
    'server': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
               f"SERVER={DB_CONFIG['server']};"
               f"DATABASE={DB_CONFIG['database']};"
               f"UID={DB_CONFIG['username']};"
               f"PWD={DB_CONFIG['password']};")
    return pyodbc.connect(conn_str)

def main():
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'
    
    print("="*80)
    print("EXEMPLOS CONCRETOS DE DUPLICATAS")
    print("="*80)
    print()
    print("Vou mostrar como um MESMO item de nota aparece VÁRIAS VEZES")
    print("por causa do LEFT JOIN com CLIENTES_VAREJO")
    print()
    
    # Pegar um exemplo específico de duplicata
    query_exemplo = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            fp.ITEM,
            f.NOME_CLIFOR,
            fp.PRODUTO,
            fp.QTDE,
            fp.VALOR_LIQUIDO,
            cv.CLIENTE_VAREJO,
            cv.UF,
            COUNT(*) OVER (PARTITION BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM) AS vezes_que_aparece
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN CLIENTES_VAREJO cv WITH(NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND f.NF_SAIDA = '000001181'  -- Exemplo específico que sabemos que tem duplicatas
          AND f.SERIE_NF = '13'
          AND fp.ITEM = '000001'
        ORDER BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM
    """
    
    df_exemplo = pd.read_sql(query_exemplo, conn)
    
    print("EXEMPLO 1: Nota 000001181, Série 13, Item 000001")
    print("-"*80)
    print(f"Este item aparece {len(df_exemplo)} vezes na query!")
    print()
    print("Detalhes de cada linha:")
    for idx, row in df_exemplo.iterrows():
        print(f"\nLinha {idx + 1}:")
        print(f"  NF_SAIDA: {row['NF_SAIDA']}")
        print(f"  SERIE_NF: {row['SERIE_NF']}")
        print(f"  ITEM: {row['ITEM']}")
        print(f"  PRODUTO: {row['PRODUTO']}")
        print(f"  QTDE: {row['QTDE']}")
        print(f"  VALOR_LIQUIDO: {row['VALOR_LIQUIDO']:,.2f}")
        print(f"  CLIENTE: {row['NOME_CLIFOR']}")
        print(f"  UF (do CLIENTES_VAREJO): {row['UF']}")
    
    print()
    print("="*80)
    print("O QUE ACONTECEU?")
    print("="*80)
    print(f"1. A nota {df_exemplo.iloc[0]['NF_SAIDA']} tem 1 item (ITEM {df_exemplo.iloc[0]['ITEM']})")
    print(f"2. Esse item tem VALOR_LIQUIDO = {df_exemplo.iloc[0]['VALOR_LIQUIDO']:,.2f}")
    print(f"3. O cliente '{df_exemplo.iloc[0]['NOME_CLIFOR']}' tem {len(df_exemplo)} registros na tabela CLIENTES_VAREJO")
    print(f"4. O LEFT JOIN criou {len(df_exemplo)} linhas para o MESMO item!")
    print(f"5. Se somarmos VALOR_LIQUIDO, vamos contar {df_exemplo.iloc[0]['VALOR_LIQUIDO']:,.2f} x {len(df_exemplo)} = {df_exemplo.iloc[0]['VALOR_LIQUIDO'] * len(df_exemplo):,.2f}")
    print()
    print("MAS O CORRETO É:")
    print(f"  Contar apenas 1 vez: {df_exemplo.iloc[0]['VALOR_LIQUIDO']:,.2f}")
    
    # Verificar quantos registros há em CLIENTES_VAREJO para esse cliente
    print()
    print("="*80)
    print("VERIFICANDO: Por que há múltiplos registros em CLIENTES_VAREJO?")
    print("="*80)
    
    query_cv = f"""
        SELECT 
            CLIENTE_VAREJO,
            UF,
            COUNT(*) AS total_registros
        FROM CLIENTES_VAREJO WITH(NOLOCK)
        WHERE CLIENTE_VAREJO = '{df_exemplo.iloc[0]['NOME_CLIFOR']}'
        GROUP BY CLIENTE_VAREJO, UF
        ORDER BY total_registros DESC
    """
    
    df_cv = pd.read_sql(query_cv, conn)
    print(f"Cliente: {df_exemplo.iloc[0]['NOME_CLIFOR']}")
    print(f"Total de registros diferentes em CLIENTES_VAREJO: {len(df_cv)}")
    print()
    print("Registros encontrados:")
    print(df_cv.to_string(index=False))
    print()
    print("Cada registro tem uma UF diferente ou outros dados diferentes")
    print("Por isso o LEFT JOIN cria múltiplas linhas!")
    
    # Mostrar mais exemplos
    print()
    print("="*80)
    print("MAIS EXEMPLOS DE DUPLICATAS")
    print("="*80)
    
    query_todas_duplicatas = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            fp.ITEM,
            f.NOME_CLIFOR,
            fp.PRODUTO,
            fp.VALOR_LIQUIDO,
            COUNT(*) AS vezes_que_aparece,
            SUM(fp.VALOR_LIQUIDO) AS valor_somado_errado,
            MAX(fp.VALOR_LIQUIDO) AS valor_correto
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN CLIENTES_VAREJO cv WITH(NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
        GROUP BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM, f.NOME_CLIFOR, fp.PRODUTO, fp.VALOR_LIQUIDO
        HAVING COUNT(*) > 1
        ORDER BY vezes_que_aparece DESC, valor_somado_errado DESC
    """
    
    df_todas = pd.read_sql(query_todas_duplicatas, conn)
    
    print(f"Total de itens com duplicatas: {len(df_todas)}")
    print()
    print("Top 10 itens com mais duplicatas:")
    print(df_todas.head(10)[['NF_SAIDA', 'SERIE_NF', 'ITEM', 'NOME_CLIFOR', 'valor_correto', 'vezes_que_aparece', 'valor_somado_errado']].to_string(index=False))
    print()
    print("COLUNAS:")
    print("  valor_correto: O valor que DEVERIA ser contado (1 vez)")
    print("  vezes_que_aparece: Quantas vezes esse item aparece na query")
    print("  valor_somado_errado: O valor que está sendo somado errado (valor_correto x vezes_que_aparece)")
    
    # Calcular o impacto total
    print()
    print("="*80)
    print("IMPACTO TOTAL DAS DUPLICATAS")
    print("="*80)
    
    total_valor_correto = df_todas['valor_correto'].sum()
    total_valor_errado = df_todas['valor_somado_errado'].sum()
    diferenca = total_valor_errado - total_valor_correto
    
    print(f"Valor CORRETO (sem duplicatas): {total_valor_correto:,.2f}")
    print(f"Valor ERRADO (com duplicatas): {total_valor_errado:,.2f}")
    print(f"Diferença (erro causado pelas duplicatas): {diferenca:,.2f}")
    
    conn.close()

if __name__ == '__main__':
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verifica se são realmente duplicatas ou compras diferentes
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
    print("VERIFICANDO: Sao realmente duplicatas ou compras diferentes?")
    print("="*80)
    print()
    
    # Pegar um exemplo específico
    print("EXEMPLO: Nota 000001181, Serie 13, Item 000001")
    print("-"*80)
    
    query_exemplo = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            fp.ITEM,
            f.EMISSAO,
            f.NOME_CLIFOR,
            fp.PRODUTO,
            fp.QTDE,
            fp.VALOR_LIQUIDO,
            fp.VALOR,
            cv.CLIENTE_VAREJO,
            cv.UF,
            -- Verificar se há diferenças entre as linhas
            ROW_NUMBER() OVER (PARTITION BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM ORDER BY cv.UF) AS linha_numero
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN CLIENTES_VAREJO cv WITH(NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
          AND f.NF_SAIDA = '000001181'
          AND f.SERIE_NF = '13'
          AND fp.ITEM = '000001'
        ORDER BY cv.UF
    """
    
    df_exemplo = pd.read_sql(query_exemplo, conn)
    
    print(f"Total de linhas retornadas: {len(df_exemplo)}")
    print()
    print("Detalhes de cada linha:")
    print()
    
    for idx, row in df_exemplo.iterrows():
        print(f"Linha {idx + 1}:")
        print(f"  NF_SAIDA: {row['NF_SAIDA']}")
        print(f"  SERIE_NF: {row['SERIE_NF']}")
        print(f"  ITEM: {row['ITEM']}")
        print(f"  EMISSAO: {row['EMISSAO']}")
        print(f"  PRODUTO: {row['PRODUTO']}")
        print(f"  QTDE: {row['QTDE']}")
        print(f"  VALOR_LIQUIDO: {row['VALOR_LIQUIDO']:,.2f}")
        print(f"  CLIENTE: {row['NOME_CLIFOR']}")
        print(f"  UF (do CLIENTES_VAREJO): {row['UF']}")
        print()
    
    # Verificar se são realmente a mesma nota ou notas diferentes
    print("="*80)
    print("ANALISE: Sao a mesma nota ou notas diferentes?")
    print("="*80)
    
    # Verificar quantas notas únicas existem
    notas_unicas = df_exemplo[['NF_SAIDA', 'SERIE_NF', 'ITEM']].drop_duplicates()
    print(f"Notas unicas (NF_SAIDA + SERIE_NF + ITEM): {len(notas_unicas)}")
    
    if len(notas_unicas) == 1:
        print("[OK] CONFIRMADO: E a MESMA nota!")
        print("   Todas as linhas tem o mesmo NF_SAIDA + SERIE_NF + ITEM")
        print("   Portanto, sao DUPLICATAS causadas pelo LEFT JOIN")
    else:
        print("[ERRO] Sao NOTAS DIFERENTES!")
        print("   Cada linha e uma compra diferente do mesmo cliente")
    
    # Verificar se os valores são iguais
    valores_unicos = df_exemplo['VALOR_LIQUIDO'].unique()
    print()
    print(f"Valores VALOR_LIQUIDO unicos: {len(valores_unicos)}")
    if len(valores_unicos) == 1:
        print(f"[OK] Todos os valores sao IGUAIS: {valores_unicos[0]:,.2f}")
        print("   Isso confirma que sao duplicatas da mesma venda")
    else:
        print(f"[ERRO] Valores diferentes: {valores_unicos}")
        print("   Pode ser que sejam compras diferentes")
    
    # Verificar o que está diferente entre as linhas
    print()
    print("="*80)
    print("O QUE ESTA DIFERENTE ENTRE AS LINHAS?")
    print("="*80)
    
    colunas_para_comparar = ['NF_SAIDA', 'SERIE_NF', 'ITEM', 'EMISSAO', 'PRODUTO', 'QTDE', 'VALOR_LIQUIDO', 'NOME_CLIFOR']
    colunas_diferentes = []
    
    for col in colunas_para_comparar:
        valores_unicos_col = df_exemplo[col].unique()
        if len(valores_unicos_col) > 1:
            colunas_diferentes.append(col)
            print(f"  {col}: {len(valores_unicos_col)} valores diferentes")
        else:
            print(f"  {col}: Todos iguais [OK]")
    
    if 'UF' in df_exemplo.columns:
        uf_unicos = df_exemplo['UF'].unique()
        print(f"  UF (do CLIENTES_VAREJO): {len(uf_unicos)} valores diferentes")
        if len(uf_unicos) > 1:
            print(f"     Valores: {uf_unicos}")
    
    print()
    if len(colunas_diferentes) == 0:
        print("[OK] CONFIRMADO: Todas as colunas importantes sao IGUAIS")
        print("   A unica diferenca e a UF do CLIENTES_VAREJO")
        print("   Portanto, sao DUPLICATAS causadas pelo LEFT JOIN com CLIENTES_VAREJO")
    else:
        print("[AVISO] Ha diferencas nas colunas importantes")
        print("   Pode ser que sejam compras diferentes")
    
    # Verificar quantos registros há em CLIENTES_VAREJO para esse cliente
    print()
    print("="*80)
    print("VERIFICANDO: CLIENTES_VAREJO")
    print("="*80)
    
    cliente_nome = df_exemplo.iloc[0]['NOME_CLIFOR']
    query_cv = f"""
        SELECT 
            CLIENTE_VAREJO,
            UF,
            COUNT(*) AS total
        FROM CLIENTES_VAREJO WITH(NOLOCK)
        WHERE CLIENTE_VAREJO = '{cliente_nome.strip()}'
        GROUP BY CLIENTE_VAREJO, UF
        ORDER BY UF
    """
    
    df_cv = pd.read_sql(query_cv, conn)
    print(f"Cliente: {cliente_nome}")
    print(f"Total de registros em CLIENTES_VAREJO: {len(df_cv)}")
    print()
    print("Registros encontrados:")
    print(df_cv.to_string(index=False))
    print()
    print("EXPLICACAO:")
    print("  O cliente tem {len(df_cv)} registros na tabela CLIENTES_VAREJO")
    print("  Quando fazemos LEFT JOIN, cada registro cria uma linha nova")
    print("  Por isso a mesma nota aparece {len(df_exemplo)} vezes")
    
    conn.close()

if __name__ == '__main__':
    main()


#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Verifica se a planilha gerada pelo script Python tem duplicatas
e como o pandas está tratando os dados
"""

import pyodbc
import pandas as pd
import os

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
    print("VERIFICANDO: O que o script Python realmente faz")
    print("="*80)
    print()
    
    # Query EXATA do exportar_todos_relatorios.py
    print("1. QUERY EXATA do script Python (com LEFT JOINs)")
    print("-"*80)
    query_exata = f"""
        SELECT f.NF_SAIDA, f.SERIE_NF, f.FILIAL, f.NOME_CLIFOR, fp.PRODUTO,
               fp.COR_PRODUTO, f.MOEDA, f.CAMBIO_NA_DATA, fp.ITEM, fp.ENTREGA,
               fp.PEDIDO_COR, fp.PEDIDO, fp.CAIXA, fp.ROMANEIO, fp.PACKS,
               fp.CUSTO_NA_DATA, fp.QTDE, fp.PRECO, fp.MPADRAO_PRECO,
               fp.DESCONTO_ITEM, fp.MPADRAO_DESCONTO_ITEM, fp.VALOR,
               fp.MPADRAO_VALOR, fp.VALOR_PRODUCAO, fp.MPADRAO_VALOR_PRODUCAO,
               fp.DIF_PRODUCAO, fp.MPADRAO_DIF_PRODUCAO, fp.VALOR_LIQUIDO,
               fp.MPADRAO_VALOR_LIQUIDO, fp.DIF_PRODUCAO_LIQUIDO,
               fp.MPADRAO_DIF_PRODUCAO_LIQUIDO,
               f.EMISSAO, f.CONDICAO_PGTO, f.NATUREZA_SAIDA, f.GERENTE,
               f.REPRESENTANTE, f.DATA_SAIDA, f.TRANSPORTADORA,
               f.TRANSP_REDESPACHO, f.EMPRESA, f.TIPO_FATURAMENTO,
               p.DESC_PRODUTO, p.COLECAO, p.TABELA_OPERACOES, p.TABELA_MEDIDAS,
               p.TIPO_PRODUTO, p.GRUPO_PRODUTO, p.SUBGRUPO_PRODUTO, p.LINHA,
               p.GRADE, p.GRIFFE, p.CARTELA, p.REVENDA, p.MODELAGEM, p.FABRICANTE,
               p.ESTILISTA, p.MODELISTA, fp.DESC_COLECAO, fl.REGIAO, cv.UF
        FROM FATURAMENTO f WITH(NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
        LEFT JOIN FILIAIS fl WITH(NOLOCK) ON f.FILIAL = fl.FILIAL
        LEFT JOIN CLIENTES_VAREJO cv WITH(NOLOCK) ON f.NOME_CLIFOR = cv.CLIENTE_VAREJO
        WHERE CAST(f.EMISSAO AS DATE) >= '{START_DATE}' 
          AND CAST(f.EMISSAO AS DATE) <= '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    # Carregar dados como o pandas faria
    df = pd.read_sql(query_exata, conn)
    
    print(f"Registros retornados pela query SQL: {len(df):,}")
    print(f"Soma VALOR_LIQUIDO (com possiveis duplicatas): {df['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
    print(f"Soma QTDE (com possiveis duplicatas): {df['QTDE'].fillna(0).sum():,.0f}")
    print()
    
    # Verificar duplicatas
    print("2. VERIFICANDO DUPLICATAS")
    print("-"*80)
    
    # Chave única: NF_SAIDA + SERIE_NF + ITEM
    chave_unica = df[['NF_SAIDA', 'SERIE_NF', 'ITEM']].duplicated()
    duplicatas = df[chave_unica]
    
    if len(duplicatas) > 0:
        print(f"[AVISO] Encontradas {len(duplicatas):,} linhas duplicadas!")
        print(f"  (mesma NF_SAIDA + SERIE_NF + ITEM aparece mais de uma vez)")
        print()
        print("Exemplo de duplicatas (primeiras 5):")
        print(duplicatas[['NF_SAIDA', 'SERIE_NF', 'ITEM', 'NOME_CLIFOR', 'VALOR_LIQUIDO']].head().to_string(index=False))
        print()
        
        # Remover duplicatas (como o pandas faria com drop_duplicates)
        print("3. REMOVENDO DUPLICATAS (drop_duplicates)")
        print("-"*80)
        df_sem_duplicatas = df.drop_duplicates(subset=['NF_SAIDA', 'SERIE_NF', 'ITEM'])
        print(f"Registros apos remover duplicatas: {len(df_sem_duplicatas):,}")
        print(f"Soma VALOR_LIQUIDO (sem duplicatas): {df_sem_duplicatas['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
        print(f"Soma QTDE (sem duplicatas): {df_sem_duplicatas['QTDE'].fillna(0).sum():,.0f}")
        print()
        print(f"Diferença causada pelas duplicatas:")
        print(f"  VALOR_LIQUIDO: {df['VALOR_LIQUIDO'].fillna(0).sum() - df_sem_duplicatas['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
        print(f"  QTDE: {df['QTDE'].fillna(0).sum() - df_sem_duplicatas['QTDE'].fillna(0).sum():,.0f}")
    else:
        print("[OK] Nenhuma duplicata encontrada")
        df_sem_duplicatas = df
    
    print()
    print("="*80)
    print("RESUMO")
    print("="*80)
    print(f"Query SQL retorna: {len(df):,} registros")
    print(f"  VALOR_LIQUIDO: {df['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
    print()
    
    if len(duplicatas) > 0:
        print(f"Sem duplicatas: {len(df_sem_duplicatas):,} registros")
        print(f"  VALOR_LIQUIDO: {df_sem_duplicatas['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
        print()
        print("PERGUNTA IMPORTANTE:")
        print("  O script Python faz drop_duplicates() antes de salvar?")
        print("  Se SIM, a planilha tera os valores SEM duplicatas")
        print("  Se NAO, a planilha tera os valores COM duplicatas")
    
    print()
    print("Esperado na planilha: 400,056.09")
    print(f"Com duplicatas: {df['VALOR_LIQUIDO'].fillna(0).sum():,.2f} (diferença: {df['VALOR_LIQUIDO'].fillna(0).sum() - 400056.09:,.2f})")
    if len(duplicatas) > 0:
        print(f"Sem duplicatas: {df_sem_duplicatas['VALOR_LIQUIDO'].fillna(0).sum():,.2f} (diferença: {df_sem_duplicatas['VALOR_LIQUIDO'].fillna(0).sum() - 400056.09:,.2f})")
    
    conn.close()
    
    # Verificar se há arquivo CSV para comparar
    print()
    print("="*80)
    print("VERIFICANDO: Arquivo CSV gerado")
    print("="*80)
    csv_paths = [
        'data/ecommerce.csv',
        '../data/ecommerce.csv',
        './ecommerce.csv',
    ]
    
    for path in csv_paths:
        if os.path.exists(path):
            print(f"Arquivo encontrado: {path}")
            try:
                df_csv = pd.read_csv(path, sep=';', encoding='utf-8-sig', decimal=',')
                print(f"  Registros no CSV: {len(df_csv):,}")
                if 'VALOR_LIQUIDO' in df_csv.columns:
                    print(f"  VALOR_LIQUIDO no CSV: {df_csv['VALOR_LIQUIDO'].fillna(0).sum():,.2f}")
                break
            except Exception as e:
                print(f"  Erro ao ler CSV: {e}")
    else:
        print("CSV nao encontrado nos caminhos testados")

if __name__ == '__main__':
    main()


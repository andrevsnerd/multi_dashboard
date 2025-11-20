#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script de investigação para descobrir a diferença entre os valores do sistema e da planilha
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
        print("Conectando ao banco...")
        conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                   f"SERVER={DB_CONFIG['server']};"
                   f"DATABASE={DB_CONFIG['database']};"
                   f"UID={DB_CONFIG['username']};"
                   f"PWD={DB_CONFIG['password']};")
        return pyodbc.connect(conn_str)
    except Exception as e:
        print(f"✗ Erro conexão: {e}")
        raise

def test_query_exata_export():
    """Testa a query EXATA do script de exportação com os filtros da planilha"""
    conn = conectar_banco()
    
    # Filtros da planilha
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01'
    END_DATE = '2025-11-20'  # Incluindo o dia 20
    
    print("\n" + "="*80)
    print("TESTE 1: Query EXATA do script de exportação")
    print("="*80)
    print(f"FILIAL: {FILIAL}")
    print(f"EMISSAO: {START_DATE} até {END_DATE} (inclusive)")
    print()
    
    # Query EXATA do exportar_todos_relatorios.py (linhas 285-315)
    query = f"""
        SELECT f.NF_SAIDA, f.SERIE_NF, f.FILIAL, f.NOME_CLIFOR, fp.PRODUTO,
               fp.COR_PRODUTO, f.MOEDA, f.CAMBIO_NA_DATA, fp.ITEM, fp.ENTREGA,
               fp.PEDIDO_COR, fp.PEDIDO, fp.CAIXA, fp.ROMANEIO, fp.PACKS,
               fp.CUSTO_NA_DATA, fp.QTDE, fp.PRECO, fp.MPADRAO_PRECO,
               fp.DESCONTO_ITEM, fp.MPADRAO_DESCONTO_ITEM, fp.VALOR,
               fp.MPADRAO_VALOR, fp.VALOR_PRODUCAO, fp.MPADRAO_VALOR_PRODUCAO,
               fp.DIF_PRODUCAO, fp.MPADRAO_DIF_PRODUCAO, fp.VALOR_LIQUIDO,
               fp.MPADRAO_VALOR_LIQUIDO, fp.DIF_PRODUCAO_LIQUIDO,
               fp.MPADRAO_DIF_PRODUCAO_LIQUIDO,
               fp.F1, fp.F2, fp.F3, fp.F4, fp.F5, fp.F6, fp.F7, fp.F8, fp.F9, fp.F10,
               fp.F11, fp.F12, fp.F13, fp.F14, fp.F15, fp.F16, fp.F17, fp.F18, fp.F19, fp.F20,
               fp.F21, fp.F22, fp.F23, fp.F24, fp.F25, fp.F26, fp.F27, fp.F28, fp.F29, fp.F30,
               fp.F31, fp.F32, fp.F33, fp.F34, fp.F35, fp.F36, fp.F37, fp.F38, fp.F39, fp.F40,
               fp.F41, fp.F42, fp.F43, fp.F44, fp.F45, fp.F46, fp.F47, fp.F48,
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
    
    df = pd.read_sql(query, conn)
    
    # Calcular totais
    total_valor_liquido = df['VALOR_LIQUIDO'].fillna(0).sum()
    total_qtde = df['QTDE'].fillna(0).sum()
    total_rows = len(df)
    
    print(f"Total de registros: {total_rows:,}")
    print(f"Soma VALOR_LIQUIDO: {total_valor_liquido:,.2f}")
    print(f"Soma QTDE: {total_qtde:,.0f}")
    print()
    print(f"Esperado na planilha:")
    print(f"  VALOR_LIQUIDO: 400,056.09")
    print(f"  QTDE: 1,845")
    print()
    print(f"Diferença:")
    print(f"  VALOR_LIQUIDO: {total_valor_liquido - 400056.09:,.2f}")
    print(f"  QTDE: {total_qtde - 1845:,.0f}")
    
    # Análise detalhada
    print("\n" + "-"*80)
    print("ANÁLISE DETALHADA:")
    print("-"*80)
    print(f"Registros com VALOR_LIQUIDO NULL: {(df['VALOR_LIQUIDO'].isna()).sum()}")
    print(f"Registros com VALOR_LIQUIDO = 0: {(df['VALOR_LIQUIDO'].fillna(0) == 0).sum()}")
    print(f"Registros com QTDE NULL: {(df['QTDE'].isna()).sum()}")
    print(f"Registros com QTDE = 0: {(df['QTDE'].fillna(0) == 0).sum()}")
    print(f"Registros com QTDE < 0: {(df['QTDE'].fillna(0) < 0).sum()}")
    print(f"Primeira data: {df['EMISSAO'].min()}")
    print(f"Última data: {df['EMISSAO'].max()}")
    print(f"Notas distintas: {df.groupby(['NF_SAIDA', 'SERIE_NF']).ngroups:,}")
    
    conn.close()
    return df

def test_query_sistema():
    """Testa a query que o sistema está usando (com < em vez de <=)"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    START_DATE = '2025-11-01T00:00:00'
    END_DATE = '2025-11-20T00:00:00'  # Excluindo o dia 20
    
    print("\n" + "="*80)
    print("TESTE 2: Query do SISTEMA (com < em vez de <=)")
    print("="*80)
    print(f"FILIAL: {FILIAL}")
    print(f"EMISSAO: {START_DATE} até {END_DATE} (EXCLUINDO dia 20)")
    print()
    
    query = f"""
        SELECT 
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalRevenue,
            SUM(ISNULL(fp.QTDE, 0)) AS totalQuantity,
            COUNT(*) AS totalRows,
            COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas,
            MIN(f.EMISSAO) AS primeiraData,
            MAX(f.EMISSAO) AS ultimaData
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE f.EMISSAO >= '{START_DATE}'
          AND f.EMISSAO < '{END_DATE}'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df = pd.read_sql(query, conn)
    row = df.iloc[0]
    
    print(f"Total de registros: {row['totalRows']:,}")
    print(f"Soma VALOR_LIQUIDO: {row['totalRevenue']:,.2f}")
    print(f"Soma QTDE: {row['totalQuantity']:,.0f}")
    print(f"Primeira data: {row['primeiraData']}")
    print(f"Última data: {row['ultimaData']}")
    print(f"Notas distintas: {row['totalNotas']:,}")
    
    conn.close()
    return row

def test_comparacao_datas():
    """Compara registros do dia 20 que podem estar sendo excluídos"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE 3: Análise do DIA 20")
    print("="*80)
    
    # Registros do dia 20
    query_dia20 = f"""
        SELECT 
            COUNT(*) AS totalRows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
            SUM(ISNULL(fp.QTDE, 0)) AS totalQtde,
            MIN(f.EMISSAO) AS primeiraHora,
            MAX(f.EMISSAO) AS ultimaHora
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) = '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df_dia20 = pd.read_sql(query_dia20, conn)
    row_dia20 = df_dia20.iloc[0]
    
    print(f"Registros no dia 20:")
    print(f"  Total: {row_dia20['totalRows']:,}")
    print(f"  VALOR_LIQUIDO: {row_dia20['totalValorLiquido']:,.2f}")
    print(f"  QTDE: {row_dia20['totalQtde']:,.0f}")
    print(f"  Primeira hora: {row_dia20['primeiraHora']}")
    print(f"  Última hora: {row_dia20['ultimaHora']}")
    
    # Comparar com a diferença esperada
    print("\nComparação com a diferença:")
    print(f"  Diferença esperada em VALOR_LIQUIDO: 48,180.76")
    print(f"  Diferença esperada em QTDE: 196")
    print(f"  Valor do dia 20: {row_dia20['totalValorLiquido']:,.2f}")
    print(f"  QTDE do dia 20: {row_dia20['totalQtde']:,.0f}")
    
    conn.close()
    return row_dia20

def test_analise_detalhada():
    """Análise detalhada por data para encontrar o problema"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE 4: Análise por DATA (agrupado por dia)")
    print("="*80)
    
    query = f"""
        SELECT 
            CAST(f.EMISSAO AS DATE) AS data_emissao,
            COUNT(*) AS totalRows,
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
            SUM(ISNULL(fp.QTDE, 0)) AS totalQtde,
            COUNT(DISTINCT f.NF_SAIDA + '-' + f.SERIE_NF) AS totalNotas
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
        GROUP BY CAST(f.EMISSAO AS DATE)
        ORDER BY data_emissao
    """
    
    df = pd.read_sql(query, conn)
    
    print(df.to_string(index=False))
    print()
    print(f"TOTAL:")
    print(f"  Registros: {df['totalRows'].sum():,}")
    print(f"  VALOR_LIQUIDO: {df['totalValorLiquido'].sum():,.2f}")
    print(f"  QTDE: {df['totalQtde'].sum():,.0f}")
    
    conn.close()
    return df

def test_comparacao_colunas():
    """Compara diferentes colunas de valor para ver qual a planilha está usando"""
    conn = conectar_banco()
    
    FILIAL = 'SCARFME MATRIZ CMS'
    
    print("\n" + "="*80)
    print("TESTE 5: Comparação de COLUNAS de VALOR")
    print("="*80)
    
    query = f"""
        SELECT 
            SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
            SUM(ISNULL(fp.VALOR, 0)) AS totalValor,
            SUM(ISNULL(fp.VALOR_PRODUCAO, 0)) AS totalValorProducao,
            SUM(ISNULL(fp.PRECO * fp.QTDE, 0)) AS totalPrecoQtde,
            COUNT(*) AS totalRows
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
          AND f.FILIAL = '{FILIAL}'
    """
    
    df = pd.read_sql(query, conn)
    row = df.iloc[0]
    
    print(f"Total de registros: {row['totalRows']:,}")
    print(f"VALOR_LIQUIDO: {row['totalValorLiquido']:,.2f}")
    print(f"VALOR: {row['totalValor']:,.2f}")
    print(f"VALOR_PRODUCAO: {row['totalValorProducao']:,.2f}")
    print(f"PRECO * QTDE: {row['totalPrecoQtde']:,.2f}")
    print()
    print(f"Esperado na planilha: 400,056.09")
    print()
    print(f"Diferenças:")
    print(f"  VALOR_LIQUIDO: {row['totalValorLiquido'] - 400056.09:,.2f}")
    print(f"  VALOR: {row['totalValor'] - 400056.09:,.2f}")
    print(f"  VALOR_PRODUCAO: {row['totalValorProducao'] - 400056.09:,.2f}")
    print(f"  PRECO * QTDE: {row['totalPrecoQtde'] - 400056.09:,.2f}")
    
    conn.close()
    return row

def test_verificar_filial():
    """Verifica se há problema com espaços em branco no nome da filial"""
    conn = conectar_banco()
    
    print("\n" + "="*80)
    print("TESTE 6: Verificação de FILIAL (espaços em branco)")
    print("="*80)
    
    # Buscar todas as variações possíveis do nome da filial
    query = """
        SELECT DISTINCT 
            f.FILIAL,
            LEN(f.FILIAL) AS tamanho,
            LEN(LTRIM(RTRIM(f.FILIAL))) AS tamanho_trim,
            COUNT(*) AS totalRegistros
        FROM FATURAMENTO f WITH (NOLOCK)
        WHERE f.FILIAL LIKE 'SCARFME MATRIZ CMS%'
          AND CAST(f.EMISSAO AS DATE) >= '2025-11-01'
          AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
          AND f.NOTA_CANCELADA = 0
          AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        GROUP BY f.FILIAL, LEN(f.FILIAL), LEN(LTRIM(RTRIM(f.FILIAL)))
        ORDER BY totalRegistros DESC
    """
    
    df = pd.read_sql(query, conn)
    
    print("Variações do nome da filial encontradas:")
    print(df.to_string(index=False))
    
    # Testar com cada variação
    print("\n" + "-"*80)
    print("Testando com cada variação:")
    print("-"*80)
    
    for idx, row in df.iterrows():
        filial = row['FILIAL']
        query_test = f"""
            SELECT 
                SUM(ISNULL(fp.VALOR_LIQUIDO, 0)) AS totalValorLiquido,
                SUM(ISNULL(fp.QTDE, 0)) AS totalQtde,
                COUNT(*) AS totalRows
            FROM FATURAMENTO f WITH (NOLOCK)
            JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
                ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            WHERE CAST(f.EMISSAO AS DATE) >= '2025-11-01'
              AND CAST(f.EMISSAO AS DATE) <= '2025-11-20'
              AND f.NOTA_CANCELADA = 0
              AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
              AND f.FILIAL = '{filial}'
        """
        df_test = pd.read_sql(query_test, conn)
        test_row = df_test.iloc[0]
        print(f"\nFilial: '{filial}' (tamanho: {row['tamanho']}, trim: {row['tamanho_trim']})")
        print(f"  Registros: {test_row['totalRows']:,}")
        print(f"  VALOR_LIQUIDO: {test_row['totalValorLiquido']:,.2f}")
        print(f"  QTDE: {test_row['totalQtde']:,.0f}")
    
    conn.close()
    return df

def main():
    """Executa todos os testes"""
    print("="*80)
    print("INVESTIGAÇÃO: Diferença entre Sistema e Planilha")
    print("="*80)
    print("Esperado na planilha:")
    print("  FILIAL: SCARFME MATRIZ CMS")
    print("  EMISSAO: Novembro 2025 até dia 20 (inclusive)")
    print("  VALOR_LIQUIDO: 400,056.09")
    print("  QTDE: 1,845")
    print("="*80)
    
    try:
        # Teste 1: Query exata do export
        df1 = test_query_exata_export()
        
        # Teste 2: Query do sistema
        row2 = test_query_sistema()
        
        # Teste 3: Análise do dia 20
        row3 = test_comparacao_datas()
        
        # Teste 4: Análise por data
        df4 = test_analise_detalhada()
        
        # Teste 5: Comparação de colunas
        row5 = test_comparacao_colunas()
        
        # Teste 6: Verificação de filial
        df6 = test_verificar_filial()
        
        print("\n" + "="*80)
        print("RESUMO FINAL")
        print("="*80)
        print("\nVerifique os resultados acima para identificar a causa da diferença.")
        print("\nPossíveis causas:")
        print("1. Filtro de data (<= vs <)")
        print("2. Espaços em branco no nome da filial")
        print("3. Coluna diferente sendo usada (VALOR vs VALOR_LIQUIDO)")
        print("4. Registros duplicados ou faltantes")
        
    except Exception as e:
        print(f"\n✗ Erro: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()


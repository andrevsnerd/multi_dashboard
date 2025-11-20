#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gera uma planilha Excel mostrando exatamente quais registros estão duplicados
"""

import pyodbc
import pandas as pd
from datetime import datetime
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
    print("GERANDO PLANILHA COM DUPLICATAS")
    print("="*80)
    print()
    
    # Query EXATA do script Python (com LEFT JOINs que causam duplicatas)
    query = f"""
        SELECT 
            f.NF_SAIDA,
            f.SERIE_NF,
            fp.ITEM,
            f.EMISSAO,
            f.NOME_CLIFOR,
            fp.PRODUTO,
            p.DESC_PRODUTO,
            fp.QTDE,
            fp.VALOR_LIQUIDO,
            fp.VALOR,
            cv.UF,
            cv.CLIENTE_VAREJO,
            -- Contar quantas vezes este item aparece
            COUNT(*) OVER (PARTITION BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM) AS VEZES_QUE_APARECE,
            -- Identificar se é duplicata
            CASE 
                WHEN COUNT(*) OVER (PARTITION BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM) > 1 
                THEN 'SIM - DUPLICATA' 
                ELSE 'NAO' 
            END AS EH_DUPLICATA,
            -- Calcular valor errado (valor x vezes)
            fp.VALOR_LIQUIDO * COUNT(*) OVER (PARTITION BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM) AS VALOR_SOMADO_ERRADO
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
        ORDER BY f.NF_SAIDA, f.SERIE_NF, fp.ITEM, cv.UF
    """
    
    print("Buscando dados do banco...")
    df = pd.read_sql(query, conn)
    print(f"Total de registros retornados: {len(df):,}")
    print()
    
    # Identificar duplicatas
    df['CHAVE_UNICA'] = df['NF_SAIDA'].astype(str).str.strip() + '-' + df['SERIE_NF'].astype(str).str.strip() + '-' + df['ITEM'].astype(str).str.strip()
    
    # Separar duplicatas e não-duplicatas
    df_duplicatas = df[df['EH_DUPLICATA'] == 'SIM - DUPLICATA'].copy()
    df_nao_duplicatas = df[df['EH_DUPLICATA'] == 'NAO'].copy()
    
    print(f"Registros SEM duplicatas: {len(df_nao_duplicatas):,}")
    print(f"Registros COM duplicatas: {len(df_duplicatas):,}")
    print()
    
    # Criar resumo por item duplicado
    print("Criando resumo de duplicatas...")
    resumo_duplicatas = df_duplicatas.groupby(['NF_SAIDA', 'SERIE_NF', 'ITEM', 'PRODUTO', 'NOME_CLIFOR']).agg({
        'VALOR_LIQUIDO': 'first',  # Valor correto (todos são iguais)
        'QTDE': 'first',
        'VEZES_QUE_APARECE': 'first',
        'VALOR_SOMADO_ERRADO': 'first',
        'EMISSAO': 'first',
        'DESC_PRODUTO': 'first'
    }).reset_index()
    
    resumo_duplicatas['ERRO'] = resumo_duplicatas['VALOR_SOMADO_ERRADO'] - resumo_duplicatas['VALOR_LIQUIDO']
    resumo_duplicatas = resumo_duplicatas.sort_values('ERRO', ascending=False)
    
    # Preparar dados para exportação
    print("Preparando planilhas...")
    
    # Planilha 1: Resumo de duplicatas (uma linha por item duplicado)
    planilha_resumo = resumo_duplicatas[[
        'NF_SAIDA', 'SERIE_NF', 'ITEM', 'EMISSAO', 'NOME_CLIFOR', 
        'PRODUTO', 'DESC_PRODUTO', 'QTDE', 
        'VALOR_LIQUIDO', 'VEZES_QUE_APARECE', 'VALOR_SOMADO_ERRADO', 'ERRO'
    ]].copy()
    
    planilha_resumo.columns = [
        'NF_SAIDA', 'SERIE_NF', 'ITEM', 'EMISSAO', 'CLIENTE', 
        'PRODUTO', 'DESC_PRODUTO', 'QTDE', 
        'VALOR_CORRETO', 'VEZES_DUPLICADO', 'VALOR_SOMADO_ERRADO', 'ERRO_CAUSADO'
    ]
    
    # Planilha 2: Todas as linhas duplicadas (mostra cada duplicata)
    planilha_detalhes = df_duplicatas[[
        'NF_SAIDA', 'SERIE_NF', 'ITEM', 'EMISSAO', 'NOME_CLIFOR',
        'PRODUTO', 'DESC_PRODUTO', 'QTDE', 'VALOR_LIQUIDO', 
        'UF', 'VEZES_QUE_APARECE', 'EH_DUPLICATA', 'VALOR_SOMADO_ERRADO'
    ]].copy()
    
    planilha_detalhes.columns = [
        'NF_SAIDA', 'SERIE_NF', 'ITEM', 'EMISSAO', 'CLIENTE',
        'PRODUTO', 'DESC_PRODUTO', 'QTDE', 'VALOR_LIQUIDO',
        'UF_CLIENTES_VAREJO', 'VEZES_DUPLICADO', 'EH_DUPLICATA', 'VALOR_SOMADO_ERRADO'
    ]
    
    # Planilha 3: Estatísticas gerais
    total_itens_unicos = len(df.drop_duplicates(subset=['NF_SAIDA', 'SERIE_NF', 'ITEM']))
    total_registros_com_duplicatas = len(df)
    total_valor_correto = df.drop_duplicates(subset=['NF_SAIDA', 'SERIE_NF', 'ITEM'])['VALOR_LIQUIDO'].sum()
    total_valor_errado = df['VALOR_LIQUIDO'].sum()
    erro_total = total_valor_errado - total_valor_correto
    
    estatisticas = pd.DataFrame({
        'METRICA': [
            'Total de itens únicos (sem duplicatas)',
            'Total de registros na query (com duplicatas)',
            'Total de itens com duplicatas',
            'Total de linhas duplicadas',
            'Valor CORRETO (sem duplicatas)',
            'Valor ERRADO (com duplicatas)',
            'ERRO TOTAL causado pelas duplicatas'
        ],
        'VALOR': [
            total_itens_unicos,
            total_registros_com_duplicatas,
            len(resumo_duplicatas),
            len(df_duplicatas),
            f'R$ {total_valor_correto:,.2f}',
            f'R$ {total_valor_errado:,.2f}',
            f'R$ {erro_total:,.2f}'
        ]
    })
    
    # Salvar em Excel
    script_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(script_dir, 'ANALISE_DUPLICATAS.xlsx')
    
    print(f"Salvando planilha: {output_path}")
    
    with pd.ExcelWriter(output_path, engine='openpyxl') as writer:
        estatisticas.to_excel(writer, sheet_name='1_Estatisticas', index=False)
        planilha_resumo.to_excel(writer, sheet_name='2_Resumo_Duplicatas', index=False)
        planilha_detalhes.to_excel(writer, sheet_name='3_Detalhes_Duplicatas', index=False)
        
        # Ajustar largura das colunas
        for sheet_name in writer.sheets:
            worksheet = writer.sheets[sheet_name]
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width
    
    print()
    print("="*80)
    print("PLANILHA GERADA COM SUCESSO!")
    print("="*80)
    print(f"Arquivo: {output_path}")
    print()
    print("A planilha contem 3 abas:")
    print("1. Estatisticas - Resumo geral do problema")
    print("2. Resumo_Duplicatas - Uma linha por item duplicado (97 itens)")
    print("3. Detalhes_Duplicatas - Todas as linhas duplicadas (182 linhas)")
    print()
    print("ESTATISTICAS:")
    print(f"  Itens unicos: {total_itens_unicos:,}")
    print(f"  Registros na query: {total_registros_com_duplicatas:,}")
    print(f"  Itens com duplicatas: {len(resumo_duplicatas):,}")
    print(f"  Linhas duplicadas: {len(df_duplicatas):,}")
    print(f"  Valor CORRETO: R$ {total_valor_correto:,.2f}")
    print(f"  Valor ERRADO: R$ {total_valor_errado:,.2f}")
    print(f"  ERRO TOTAL: R$ {erro_total:,.2f}")
    
    conn.close()

if __name__ == '__main__':
    main()


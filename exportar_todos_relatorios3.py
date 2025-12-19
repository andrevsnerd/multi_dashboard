#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Exportador de Relatórios Scarfme v5.0 - Otimizado
Gera relatórios: Produtos, Estoque, Vendas, E-commerce, Entradas
"""

import os
import sys
import time
import pandas as pd
import numpy as np
import pyodbc
import shutil
from datetime import datetime

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

# Colunas a remover por relatório
COLS_REMOVER = {
    'produtos': ['CODIGO_PRECO', 'MATERIAL', 'TABELA_OPERACOES', 'FATOR_OPERACOES', 'TABELA_MEDIDAS', 'CARTELA', 'UNIDADE', 'REVENDA', 'MODELAGEM', 'SORTIMENTO_COR', 'SORTIMENTO_TAMANHO', 'VARIA_PRECO_COR', 'VARIA_PRECO_TAM', 'PONTEIRO_PRECO_TAM', 'VARIA_CUSTO_COR', 'PERTENCE_A_CONJUNTO', 'TRIBUT_ICMS', 'TRIBUT_ORIGEM', 'VARIA_CUSTO_TAM', 'CUSTO_REPOSICAO2', 'CUSTO_REPOSICAO3', 'CUSTO_REPOSICAO4', 'ESTILISTA', 'MODELISTA', 'TAMANHO_BASE', 'GIRO_ENTREGA', 'TIMESTAMP', 'INATIVO', 'ENVIA_LOJA_VAREJO', 'ENVIA_LOJA_ATACADO', 'ENVIA_REPRESENTANTE', 'ENVIA_VAREJO_INTERNET', 'ENVIA_ATACADO_INTERNET', 'MODELO', 'REDE_LOJAS', 'FABRICANTE_ICMS_ABATER', 'FABRICANTE_PRAZO_PGTO', 'TAXA_JUROS_DEFLACIONAR', 'TAXAS_IMPOSTOS_APLICAR', 'PRECO_REPOSICAO_2', 'PRECO_REPOSICAO_3', 'PRECO_REPOSICAO_4', 'PRECO_A_VISTA_REPOSICAO_2', 'PRECO_A_VISTA_REPOSICAO_3', 'PRECO_A_VISTA_REPOSICAO_4', 'FABRICANTE_FRETE', 'DROP_DE_TAMANHOS', 'STATUS_PRODUTO', 'TIPO_STATUS_PRODUTO', 'OBS', 'COMPOSICAO', 'RESTRICAO_LAVAGEM', 'ORCAMENTO', 'CLIENTE_DO_PRODUTO', 'CONTA_CONTABIL', 'ESPESSURA', 'ALTURA', 'LARGURA', 'COMPRIMENTO', 'EMPILHAMENTO_MAXIMO', 'PARTE_TIPO', 'VERSAO_FICHA', 'COD_FLUXO_PRODUTO', 'DATA_INICIO_DESENVOLVIMENTO', 'INDICADOR_CFOP', 'MONTAGEM_KIT', 'MRP_AGRUPAR_NECESSIDADE_DIAS', 'MRP_AGRUPAR_NECESSIDADE_TIPO', 'MRP_DIAS_SEGURANCA', 'MRP_EMISSAO_LIBERACAO_DIAS', 'MRP_ENTREGA_GIRO_DIAS', 'MRP_PARTICIPANTE', 'MRP_MAIOR_GIRO_MP_DIAS', 'MRP_FP', 'MRP_RR', 'OP_POR_COR', 'OP_QTDE_MAXIMA', 'OP_QTDE_MINIMA', 'QUALIDADE', 'SEMI_ACABADO', 'CONTA_CONTABIL_COMPRA', 'CONTA_CONTABIL_VENDA', 'CONTA_CONTABIL_DEV_COMPRA', 'CONTA_CONTABIL_DEV_VENDA', 'ID_EXCECAO_GRUPO', 'ID_EXCECAO_IMPOSTO', 'DIAS_COMPRA', 'FATOR_P', 'FATOR_Q', 'FATOR_F', 'CONTINUIDADE', 'COD_PRODUTO_SOLUCAO', 'COD_PRODUTO_SEGMENTO', 'ID_PRECO', 'TIPO_ITEM_SPED', 'PERC_COMISSAO', 'ACEITA_ENCOMENDA', 'DIAS_GARANTIA_LOJA', 'DIAS_GARANTIA_FABRICANTE', 'POSSUI_MONTAGEM', 'PERMITE_ENTREGA_FUTURA', 'NATUREZA_RECEITA', 'COD_ALIQUOTA_PIS_COFINS_DIF', 'DATA_LIMITE_PEDIDO', 'LX_STATUS_REGISTRO', 'ARREDONDA', 'ID_ARTIGO', 'LX_HASH', 'SPED_DATA_FIM', 'SPED_DATA_INI', 'TIPO_PP', 'FATOR_A', 'FATOR_B', 'FATOR_BUFFER', 'FATOR_LT', 'TIPO_CANAL', 'NAO_ENVIA_ETL', 'TITULO_B2C', 'DESCRICAO_B2C', 'PRE_VENDA', 'TAGS', 'VIDEO_EMBED', 'CARACTERISTICAS_TECNICAS_B2C', 'FRETE_GRATIS', 'ESTOQUE_MINIMO', 'DATA_PUBLICACAO_B2C', 'GRUPO_PRODUTO_B2C', 'SUBGRUPO_PRODUTO_B2C', 'TIPO_PRODUTO_B2C', 'GRIFFE_B2C', 'LINHA_B2C', 'FABRICANTE_B2C', 'CATEGORIA_B2C', 'SUBCATEGORIA_B2C', 'REPOSICAO_B2C', 'IMG_ESTILO', 'DESCRICAO_B2C_2', 'DESCRICAO_B2C_3', 'SUJEITO_SUBSTITUTICAO_TRIBUTARIA', 'OPTION_TITULO', 'OPTION_DESC', 'OPTION_CARACTERISTICA','EMPRESA','SEXO_TIPO','PESO','DIAS_ACERTO_CONSIGNACAO','POSSUI_GTIN'],
    'estoque': ['CUSTO_MEDIO1', 'CUSTO_MEDIO2', 'CUSTO_MEDIO3', 'CUSTO_MEDIO4', 'ULTIMO_CUSTO1', 'ULTIMO_CUSTO2', 'ULTIMO_CUSTO3', 'ULTIMO_CUSTO4', 'DATA_CUSTO_MEDIO', 'DATA_ULT_CUSTO'] + [f'ES{i}' for i in range(1, 49)] + ['TIMESTAMP', 'PRIMEIRA_ENTRADA', 'LX_STATUS_REGISTRO', 'LX_HASH'],
    'vendas': ['TAMANHO', 'PEDIDO', 'DESCONTO_ITEM', 'CODIGO_DESCONTO', 'CODIGO_TAB_PRECO', 'OPERACAO_VENDA', 'FATOR_VENDA_LIQ', 'VALOR_TIKET', 'DESCONTO', 'DATA_HORA_CANCELAMENTO', 'QTDE_CANCELADA']
}

def enriquecer_com_codigo_barra(df_base, df_codigos_barra, prioridade_tamanho=True):
    """
    Adiciona a coluna CODIGO_BARRA ao DataFrame base usando as colunas disponíveis.
    A tentativa de match respeita a sequência: PRODUTO+COR+TAMANHO (se existir),
    PRODUTO+COR e por fim apenas PRODUTO.
    """
    if 'PRODUTO' not in df_base.columns:
        return df_base
    
    df_resultado = df_base.copy()
    codigos = df_codigos_barra[['PRODUTO', 'COR_PRODUTO', 'TAMANHO', 'CODIGO_BARRA']].copy()
    codigos.drop_duplicates(subset=['PRODUTO', 'COR_PRODUTO', 'TAMANHO'], inplace=True)
    
    chaves_opcoes = []
    if prioridade_tamanho and all(col in df_resultado.columns for col in ['PRODUTO', 'COR_PRODUTO', 'TAMANHO']):
        chaves_opcoes.append(['PRODUTO', 'COR_PRODUTO', 'TAMANHO'])
    if all(col in df_resultado.columns for col in ['PRODUTO', 'COR_PRODUTO']):
        chaves_opcoes.append(['PRODUTO', 'COR_PRODUTO'])
    chaves_opcoes.append(['PRODUTO'])
    
    for chaves in chaves_opcoes:
        codigos_merge = codigos[chaves + ['CODIGO_BARRA']].drop_duplicates(subset=chaves)
        df_resultado = df_resultado.merge(codigos_merge, how='left', on=chaves, suffixes=('', '_MERGE'))
        if df_resultado['CODIGO_BARRA'].notna().any():
            break
        else:
            df_resultado.drop(columns=['CODIGO_BARRA'], inplace=True)
    
    return df_resultado

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
        sys.exit(1)

def converter_datas(df, colunas):
    """Converte colunas para datetime (vetorizado)"""
    for col in colunas:
        if col in df.columns:
            df[col] = pd.to_datetime(df[col], errors='coerce')
    return df

def salvar_relatorio(df, nome, sheet_name):
    """Salva em XLSX e CSV com tratamento de arquivos em uso"""
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, "data")
    os.makedirs(data_dir, exist_ok=True)
    
    # XLSX com timestamp se arquivo estiver em uso
    xlsx_path = os.path.join(data_dir, f"{nome}.xlsx")
    try:
        with pd.ExcelWriter(xlsx_path, engine='xlsxwriter', 
                           datetime_format='dd/mm/yyyy', date_format='dd/mm/yyyy') as writer:
            df.to_excel(writer, sheet_name=sheet_name, index=False)
            writer.sheets[sheet_name].autofit()
        print(f"✓ {nome}.xlsx: {len(df):,} registros")
    except PermissionError:
        # Arquivo em uso, salva com timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        xlsx_path_backup = os.path.join(data_dir, f"{nome}_{timestamp}.xlsx")
        with pd.ExcelWriter(xlsx_path_backup, engine='xlsxwriter', 
                           datetime_format='dd/mm/yyyy', date_format='dd/mm/yyyy') as writer:
            df.to_excel(writer, sheet_name=sheet_name, index=False)
            writer.sheets[sheet_name].autofit()
        print(f"⚠ {nome}.xlsx em uso - salvo como {nome}_{timestamp}.xlsx: {len(df):,} registros")
    
    # CSV (sempre funciona)
    csv_path = os.path.join(data_dir, f"{nome}.csv")
    df.to_csv(csv_path, index=False, encoding='utf-8-sig', sep=';', decimal=',')
    print(f"✓ {nome}.csv: {len(df):,} registros")

def processar_produtos(df, df_codigos_barra, salvar=True):
    """Processa relatório de produtos"""
    t = time.time()
    print("\n[PRODUTOS]")
    
    df = converter_datas(df, ['DATA_REPOSICAO', 'DATA_PARA_TRANSFERENCIA', 'DATA_CADASTRAMENTO'])
    df.drop(columns=COLS_REMOVER['produtos'], inplace=True, errors='ignore')
    df = enriquecer_com_codigo_barra(df, df_codigos_barra, prioridade_tamanho=False)
    
    if salvar:
        salvar_relatorio(df, 'produtos_tratados', 'ProdutosTratados')
    print(f"Tempo: {time.time()-t:.2f}s")
    return df

def processar_estoque(df_estoque, df_produtos, df_codigos_barra):
    """Processa relatório de estoque"""
    t = time.time()
    print("\n[ESTOQUE]")
    
    # Merge com produtos
    cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'CUSTO_REPOSICAO1', 'PRECO_REPOSICAO_1', 
                 'LINHA', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'GRADE', 'GRIFFE']
    df = df_estoque.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
    
    df = converter_datas(df, ['ULTIMA_SAIDA', 'ULTIMA_ENTRADA', 'DATA_PARA_TRANSFERENCIA', 'DATA_AJUSTE'])
    df['VALOR_TOTAL_ESTOQUE'] = df['ESTOQUE'].fillna(0) * df['CUSTO_REPOSICAO1'].fillna(0)
    df.drop(columns=COLS_REMOVER['estoque'], inplace=True, errors='ignore')
    df = enriquecer_com_codigo_barra(df, df_codigos_barra)
    
    salvar_relatorio(df, 'estoque_tratados', 'EstoqueTratado')
    print(f"Tempo: {time.time()-t:.2f}s")

def processar_vendas(df, df_codigos_barra):
    """Processa relatório de vendas"""
    t = time.time()
    print("\n[VENDAS]")
    
    # 1) Manter apenas linhas com quantidade positiva (mesma lógica do site)
    df = df[df['QTDE'] > 0].copy()
    
    # 2) Converter datas (DATA_VENDA) para datetime
    df = converter_datas(df, ['DATA_VENDA'])
    
    # 3) Enriquecimento com códigos de barra usando a mesma lógica do site:
    #    prioridade PRODUTO+COR+TAMANHO, depois PRODUTO+COR, depois PRODUTO
    #    (equivalente ao enrichWithBarcode com prioritizeSize=True)
    df = enriquecer_com_codigo_barra(df, df_codigos_barra, prioridade_tamanho=True)
    
    # 4) Calcular valor total da venda (antes de considerar trocas)
    #    Este será o valor que vai para TOTAL_VENDA
    df['TOTAL_VENDA'] = np.where(
        df['QTDE_CANCELADA'].fillna(0) > 0,
        0,
        (df['PRECO_LIQUIDO'].fillna(0) * df['QTDE'].fillna(0)) - df['DESCONTO_VENDA'].fillna(0)
    )
    
    # 5) Calcular quantidade total da venda (antes de considerar trocas)
    #    Este será o valor que vai para TOTAL_QTDE_VENDA
    df['TOTAL_QTDE_VENDA'] = np.where(
        df['QTDE_CANCELADA'].fillna(0) > 0,
        0,
        df['QTDE'].fillna(0)
    )
    
    # 6) Garantir que as colunas de troca existam e estejam preenchidas
    # Usar troca por item se existir, senão usar troca por ticket
    if 'QTDE_TROCA_ITEM' not in df.columns:
        df['QTDE_TROCA_ITEM'] = 0
    if 'VALOR_TROCA_ITEM' not in df.columns:
        df['VALOR_TROCA_ITEM'] = 0
    if 'QTDE_TROCA_TICKET' not in df.columns:
        df['QTDE_TROCA_TICKET'] = 0
    if 'VALOR_TROCA_TICKET' not in df.columns:
        df['VALOR_TROCA_TICKET'] = 0
    
    df['QTDE_TROCA_ITEM'] = df['QTDE_TROCA_ITEM'].fillna(0)
    df['VALOR_TROCA_ITEM'] = df['VALOR_TROCA_ITEM'].fillna(0)
    df['QTDE_TROCA_TICKET'] = df['QTDE_TROCA_TICKET'].fillna(0)
    df['VALOR_TROCA_TICKET'] = df['VALOR_TROCA_TICKET'].fillna(0)
    
    # Usar troca por item se existir, senão usar troca por ticket
    # IMPORTANTE: Para evitar duplicação quando há múltiplas linhas no mesmo ticket,
    # distribuir a troca do ticket proporcionalmente pelo TOTAL_VENDA de cada linha
    df['TOTAL_VENDA_TICKET'] = df.groupby(['TICKET', 'CODIGO_FILIAL'])['TOTAL_VENDA'].transform('sum')
    df['PROPORCAO'] = np.where(
        df['TOTAL_VENDA_TICKET'] > 0,
        df['TOTAL_VENDA'] / df['TOTAL_VENDA_TICKET'],
        0
    )
    
    # Distribuir troca do ticket proporcionalmente
    df['VALOR_TROCA_TICKET_PROP'] = df['VALOR_TROCA_TICKET'] * df['PROPORCAO']
    df['QTDE_TROCA_TICKET_PROP'] = df['QTDE_TROCA_TICKET'] * df['PROPORCAO']
    
    # Usar troca por item se existir, senão usar troca por ticket (proporcional)
    df['QTDE_TROCA'] = np.where(df['QTDE_TROCA_ITEM'] > 0, df['QTDE_TROCA_ITEM'], df['QTDE_TROCA_TICKET_PROP'])
    df['VALOR_TROCA'] = np.where(df['VALOR_TROCA_ITEM'] > 0, df['VALOR_TROCA_ITEM'], df['VALOR_TROCA_TICKET_PROP'])
    
    # 7) Calcular valores líquidos usando a lógica descoberta:
    #    valor_liquido = total_venda - valor_troca
    #    qtde_liquida = total_qtde_venda - qtde_troca
    df['VALOR_LIQUIDO'] = df['TOTAL_VENDA'] - df['VALOR_TROCA']
    
    # Substituir QTDE pela quantidade líquida calculada
    df['QTDE'] = df['TOTAL_QTDE_VENDA'] - df['QTDE_TROCA']
    
    # 7.5) Não filtrar linhas - incluir todas (mesma lógica do arquivo de referência dezembro.csv)
    #      O arquivo dezembro.csv inclui todas as linhas, incluindo as com qtde_liquida <= 0
    
    # 8) Remover colunas técnicas, igual ao SALES_COLUMNS_TO_DROP do site
    df.drop(columns=COLS_REMOVER['vendas'], inplace=True, errors='ignore')
    
    # 9) Reordenar colunas: manter ordem original, mas colocar TOTAL_VENDA, TOTAL_QTDE_VENDA,
    #    QTDE_TROCA e VALOR_TROCA no final (nomes do Linx)
    cols = list(df.columns)
    
    # Remover colunas que serão reposicionadas
    colunas_para_final = ['TOTAL_VENDA', 'TOTAL_QTDE_VENDA', 'QTDE_TROCA', 'VALOR_TROCA']
    for col in colunas_para_final:
        if col in cols:
            cols.remove(col)
    
    # Manter ordem: VALOR_LIQUIDO logo após QTDE
    if 'VALOR_LIQUIDO' in cols and 'QTDE' in cols:
        cols.remove('VALOR_LIQUIDO')
        qtde_idx = cols.index('QTDE') + 1
        cols.insert(qtde_idx, 'VALOR_LIQUIDO')
    
    # PRECO_LIQUIDO e DESCONTO_VENDA no final (antes das colunas do Linx)
    if 'PRECO_LIQUIDO' in cols:
        cols.remove('PRECO_LIQUIDO')
        cols.append('PRECO_LIQUIDO')
    if 'DESCONTO_VENDA' in cols:
        cols.remove('DESCONTO_VENDA')
        cols.append('DESCONTO_VENDA')
    
    # Adicionar colunas do Linx no final
    for col in colunas_para_final:
        if col in df.columns:
            cols.append(col)
    
    df = df[cols]
    
    salvar_relatorio(df, 'vendas_tratadas', 'VendasTratadas')
    print(f"Tempo: {time.time()-t:.2f}s")

def processar_ecommerce(df):
    """Processa relatório de e-commerce"""
    t = time.time()
    print("\n[E-COMMERCE]")
    
    # Converter datas
    df = converter_datas(df, ['EMISSAO', 'DATA_SAIDA', 'ENTREGA'])
    
    # Remover duplicatas mantendo apenas uma linha por NF_SAIDA + SERIE_NF + ITEM
    # Isso garante que não haja registros duplicados no relatório
    if not df.empty:
        # Criar chave única para identificar duplicatas
        df['_CHAVE_DUPLICATA'] = df['NF_SAIDA'].astype(str) + '|' + df['SERIE_NF'].astype(str) + '|' + df['ITEM'].astype(str)
        
        # Remover duplicatas mantendo a primeira ocorrência
        df = df.drop_duplicates(subset=['_CHAVE_DUPLICATA'], keep='first')
        
        # Remover coluna auxiliar
        df.drop(columns=['_CHAVE_DUPLICATA'], inplace=True)
    
    salvar_relatorio(df, 'ecommerce', 'Ecommerce')
    print(f"Tempo: {time.time()-t:.2f}s")

def processar_entradas(df_mov, df_produtos, df_cores):
    """Processa relatório de entradas"""
    t = time.time()
    print("\n[ENTRADAS]")
    
    if df_mov.empty:
        print("✗ Sem dados de entradas")
        return
    
    df_mov.dropna(subset=['PRODUTO'], inplace=True)
    
    # Merge produtos
    cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
    df = df_mov.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
    
    # Merge cores
    df_cores = df_cores.rename(columns={'COR': 'COR_PRODUTO', 'DESC_COR': 'DESC_COR_PRODUTO'})
    df = df.merge(df_cores, on='COR_PRODUTO', how='left')
    
    df = converter_datas(df, ['EMISSAO'])
    
    # Ordena colunas
    ordem = ['EMISSAO', 'FILIAL', 'ROMANEIO_PRODUTO', 'PRODUTO', 'DESC_PRODUTO',
             'COR_PRODUTO', 'DESC_COR_PRODUTO', 'QTDE_TOTAL', 'GRUPO_PRODUTO',
             'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
    df = df[[c for c in ordem if c in df.columns]]
    
    salvar_relatorio(df, 'entradas', 'EntradasEnriquecidas')
    print(f"Tempo: {time.time()-t:.2f}s")

def copiar_arquivos(relatorios_gerados=None):
    """Copia arquivos para pastas destino"""
    print("\n[CÓPIA DE ARQUIVOS]")
    try:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        data_dir = os.path.join(script_dir, "data")
        
        destinos = [
            r"C:\Users\NERD TIJUCA\Documents\NERD - ANDRE\SCARF ME\data",
            r"C:\Users\NERD TIJUCA\Documents\NERD - ANDRE\NERD\DATABASE",
            r"C:\Users\NERD TIJUCA\Documents\NERD - ANDRE\dashboard-html\public\data"
        ]
        
        # Mapeamento de relatórios para nomes de arquivos
        mapeamento_arquivos = {
            'produtos': 'produtos_tratados',
            'estoque': 'estoque_tratados',
            'vendas': 'vendas_tratadas',
            'ecommerce': 'ecommerce',
            'entradas': 'entradas'
        }
        
        # Se não especificado, copia todos
        if relatorios_gerados is None:
            bases = ['produtos_tratados', 'estoque_tratados', 'vendas_tratadas', 'ecommerce', 'entradas']
        else:
            bases = [mapeamento_arquivos[r] for r in relatorios_gerados if r in mapeamento_arquivos]
        
        arquivos = [f"{base}.{ext}" for base in bases for ext in ['xlsx', 'csv']]
        
        arquivos_copiados = 0
        for destino in destinos:
            os.makedirs(destino, exist_ok=True)
            for arquivo in arquivos:
                origem = os.path.join(data_dir, arquivo)
                if os.path.exists(origem):
                    shutil.copy2(origem, os.path.join(destino, arquivo))
                    arquivos_copiados += 1
        
        print(f"✓ {arquivos_copiados} arquivos copiados")
    except Exception as e:
        print(f"✗ Erro cópia: {e}")

def exibir_menu():
    """Exibe menu de seleção de relatórios e retorna a escolha"""
    print("\n" + "="*60)
    print("SELECIONE O RELATÓRIO PARA EXPORTAR")
    print("="*60)
    print("\n0 - Exportar TODOS os relatórios (padrão)")
    print("1 - Produtos")
    print("2 - Estoque")
    print("3 - Vendas")
    print("4 - E-commerce")
    print("5 - Entradas")
    print("\n" + "-"*60)
    
    escolha = input("Digite o número da opção (ou Enter para todos): ").strip()
    
    if not escolha or escolha == '0':
        return 'todos'
    
    opcoes = {
        '1': 'produtos',
        '2': 'estoque',
        '3': 'vendas',
        '4': 'ecommerce',
        '5': 'entradas'
    }
    
    if escolha in opcoes:
        return opcoes[escolha]
    else:
        print(f"⚠ Opção inválida '{escolha}'. Exportando todos os relatórios.")
        return 'todos'

def main():
    """Orquestrador principal"""
    t_total = time.time()
    print("="*60)
    print("EXPORTADOR DE RELATÓRIOS SCARFME v5.0")
    print("="*60)
    
    # Menu de seleção
    relatorio_escolhido = exibir_menu()
    
    if relatorio_escolhido == 'todos':
        print("\n✓ Exportando TODOS os relatórios")
    else:
        nomes_relatorios = {
            'produtos': 'Produtos',
            'estoque': 'Estoque',
            'vendas': 'Vendas',
            'ecommerce': 'E-commerce',
            'entradas': 'Entradas'
        }
        print(f"\n✓ Exportando apenas: {nomes_relatorios.get(relatorio_escolhido, relatorio_escolhido)}")
    
    # Definir dependências de cada relatório
    dependencias = {
        'produtos': ['produtos_barra'],
        'estoque': ['produtos', 'produtos_barra'],
        'vendas': ['produtos_barra'],
        'ecommerce': [],
        'entradas': ['produtos', 'cores']
    }
    
    # Determinar quais relatórios processar
    if relatorio_escolhido == 'todos':
        relatorios_processar = ['produtos', 'estoque', 'vendas', 'ecommerce', 'entradas']
    else:
        relatorios_processar = [relatorio_escolhido]
    
    # Determinar quais queries são necessárias
    queries_necessarias = set()
    for relatorio in relatorios_processar:
        queries_necessarias.add(relatorio)
        if relatorio in dependencias:
            queries_necessarias.update(dependencias[relatorio])
    
    # Queries otimizadas
    queries = {
        'produtos': "SELECT * FROM PRODUTOS",
        'estoque': "SELECT * FROM ESTOQUE_PRODUTOS",
        'produtos_barra': "SELECT PRODUTO, COR_PRODUTO, TAMANHO, CODIGO_BARRA FROM PRODUTOS_BARRA",
        'vendas': """
            SELECT vp.FILIAL, vp.DATA_VENDA, vp.PRODUTO, vp.DESC_PRODUTO,
                   vp.COR_PRODUTO, vp.DESC_COR_PRODUTO, vp.TAMANHO, p.GRADE, 
                   vp.PEDIDO, vp.TICKET, vp.CODIGO_FILIAL, vp.QTDE, vp.QTDE_CANCELADA, 
                   vp.PRECO_LIQUIDO, vp.DESCONTO_ITEM, vp.DESCONTO_VENDA, 
                   vp.FATOR_VENDA_LIQ, vp.CUSTO, vp.GRUPO_PRODUTO, 
                   vp.SUBGRUPO_PRODUTO, vp.LINHA, vp.COLECAO, vp.GRIFFE, 
                   vp.VENDEDOR, v.VALOR_TIKET, v.DESCONTO, v.VALOR_VENDA_BRUTA, 
                   v.CODIGO_TAB_PRECO, v.CODIGO_DESCONTO, v.OPERACAO_VENDA, 
                   v.DATA_HORA_CANCELAMENTO, v.VENDEDOR_APELIDO,
                   ISNULL(troca_item.QTDE_TROCA, 0) AS QTDE_TROCA_ITEM,
                   ISNULL(troca_item.VALOR_TROCA, 0) AS VALOR_TROCA_ITEM,
                   ISNULL(troca_ticket.QTDE_TROCA_TICKET, 0) AS QTDE_TROCA_TICKET,
                   ISNULL(troca_ticket.VALOR_TROCA_TICKET, 0) AS VALOR_TROCA_TICKET
    FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
    LEFT JOIN W_CTB_LOJA_VENDA_PEDIDO v WITH (NOLOCK)
        ON v.FILIAL = vp.FILIAL AND v.PEDIDO = vp.PEDIDO AND v.TICKET = vp.TICKET
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
    LEFT JOIN (
        SELECT 
            TICKET,
            CODIGO_FILIAL,
            PRODUTO,
            COR_PRODUTO,
            TAMANHO,
            SUM(QTDE) AS QTDE_TROCA,
            SUM((PRECO_LIQUIDO * QTDE) - ISNULL(DESCONTO_ITEM, 0)) AS VALOR_TROCA
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL, PRODUTO, COR_PRODUTO, TAMANHO
    ) troca_item ON troca_item.TICKET = vp.TICKET 
        AND troca_item.CODIGO_FILIAL = vp.CODIGO_FILIAL
        AND troca_item.PRODUTO = vp.PRODUTO
        AND ISNULL(troca_item.COR_PRODUTO, '') = ISNULL(vp.COR_PRODUTO, '')
        AND ISNULL(troca_item.TAMANHO, 0) = ISNULL(vp.TAMANHO, 0)
    LEFT JOIN (
        SELECT 
            TICKET,
            CODIGO_FILIAL,
            SUM(QTDE) AS QTDE_TROCA_TICKET,
            SUM((PRECO_LIQUIDO * QTDE) - ISNULL(DESCONTO_ITEM, 0)) AS VALOR_TROCA_TICKET
        FROM LOJA_VENDA_TROCA WITH (NOLOCK)
        WHERE QTDE_CANCELADA = 0
        GROUP BY TICKET, CODIGO_FILIAL
    ) troca_ticket ON troca_ticket.TICKET = vp.TICKET 
        AND troca_ticket.CODIGO_FILIAL = vp.CODIGO_FILIAL
    WHERE vp.DATA_VENDA >= '2024-01-01'
        """,
        'ecommerce': """
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
            WHERE f.EMISSAO >= '2024-01-01' AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        """,
        'entradas': """
            SELECT E.ROMANEIO_PRODUTO, E.EMISSAO, E.FILIAL, P.PRODUTO,
                   P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL
            FROM ESTOQUE_PROD_ENT AS E
            LEFT JOIN ESTOQUE_PROD1_ENT AS P ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        """,
        'cores': "SELECT COR, DESC_COR FROM CORES_BASICAS"
    }
    
    conn = None
    try:
        conn = conectar_banco()
        print("\n[EXTRAÇÃO]")
        t_ext = time.time()
        
        # Extrai apenas os dados necessários
        dfs = {}
        for nome in queries_necessarias:
            if nome in queries:
                dfs[nome] = pd.read_sql(queries[nome], conn)
                print(f"✓ {nome}: {len(dfs[nome]):,}")
        
        print(f"Extração: {time.time()-t_ext:.2f}s")

    finally:
        if conn:
            conn.close()
    
    # Processamento
    print("\n[PROCESSAMENTO]")
    t_proc = time.time()
    
    # Variáveis para armazenar dados processados que podem ser reutilizados
    df_produtos = None
    
    # Processar relatórios na ordem correta (respeitando dependências)
    # Produtos: salvar apenas se estiver na lista de processar
    if 'produtos' in relatorios_processar:
        df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=True)
    elif 'produtos' in queries_necessarias:
        # Processar em memória sem salvar (é dependência de outro relatório)
        df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
    
    if 'estoque' in relatorios_processar:
        if df_produtos is None:
            # Se produtos não foi processado mas é necessário, processar agora (sem salvar)
            df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
        processar_estoque(dfs['estoque'], df_produtos, dfs['produtos_barra'])
    
    if 'vendas' in relatorios_processar:
        processar_vendas(dfs['vendas'], dfs['produtos_barra'])
    
    if 'ecommerce' in relatorios_processar:
        processar_ecommerce(dfs['ecommerce'])
    
    if 'entradas' in relatorios_processar:
        if df_produtos is None:
            # Se produtos não foi processado mas é necessário, processar agora (sem salvar)
            df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
        processar_entradas(dfs['entradas'], df_produtos, dfs['cores'])
    
    print(f"\nProcessamento: {time.time()-t_proc:.2f}s")
    
    # Cópia
    copiar_arquivos(relatorios_processar if relatorio_escolhido != 'todos' else None)
    
    print("\n" + "="*60)
    print(f"CONCLUÍDO! Tempo total: {time.time()-t_total:.2f}s")
    print("="*60)

if __name__ == '__main__':
    main()
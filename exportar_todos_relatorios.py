#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Exportador de Relatórios Scarfme v5.0 - Otimizado
Gera relatórios: Produtos, Estoque, Vendas, E-commerce, Entradas
"""

import os
import sys
import time
import unicodedata
import pandas as pd
import numpy as np
import pyodbc
import shutil
from datetime import datetime

from mapeamento_cores import get_df_cores

DESC_COR_POR_PRODUTO = {}
_CACHE_CODIGOS_BARRA = None  # cache de preparar_codigos_barra para evitar reprocessamento

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

# Filiais são consideradas automaticamente a partir da tabela FILIAIS.

POSICOES_GRADE = range(1, 49)
COLUNAS_GRADE_ESTOQUE = [f'ES{i}' for i in POSICOES_GRADE]
COLUNAS_GRADE_ENTRADAS = [f'EN_{i}' for i in POSICOES_GRADE]
COLUNAS_GRADE_SAIDAS = [f'SA_{i}' for i in POSICOES_GRADE]
COLUNAS_GRADE_ECOMMERCE = [f'F{i}' for i in POSICOES_GRADE]

SELECT_GRADE_ENTRADAS = ",\n                   ".join([f"P.EN_{i}" for i in POSICOES_GRADE])
SELECT_GRADE_SAIDAS = ",\n                   ".join([f"P.SA_{i}" for i in POSICOES_GRADE])

# Colunas a remover por relatório
COLS_REMOVER = {
    'produtos': ['CODIGO_PRECO', 'MATERIAL', 'TABELA_OPERACOES', 'FATOR_OPERACOES', 'TABELA_MEDIDAS', 'CARTELA', 'UNIDADE', 'REVENDA', 'MODELAGEM', 'SORTIMENTO_COR', 'SORTIMENTO_TAMANHO', 'VARIA_PRECO_COR', 'VARIA_PRECO_TAM', 'PONTEIRO_PRECO_TAM', 'VARIA_CUSTO_COR', 'PERTENCE_A_CONJUNTO', 'TRIBUT_ICMS', 'TRIBUT_ORIGEM', 'VARIA_CUSTO_TAM', 'CUSTO_REPOSICAO2', 'CUSTO_REPOSICAO3', 'CUSTO_REPOSICAO4', 'ESTILISTA', 'MODELISTA', 'TAMANHO_BASE', 'GIRO_ENTREGA', 'TIMESTAMP', 'INATIVO', 'ENVIA_LOJA_VAREJO', 'ENVIA_LOJA_ATACADO', 'ENVIA_REPRESENTANTE', 'ENVIA_VAREJO_INTERNET', 'ENVIA_ATACADO_INTERNET', 'MODELO', 'REDE_LOJAS', 'FABRICANTE_ICMS_ABATER', 'FABRICANTE_PRAZO_PGTO', 'TAXA_JUROS_DEFLACIONAR', 'TAXAS_IMPOSTOS_APLICAR', 'PRECO_REPOSICAO_2', 'PRECO_REPOSICAO_3', 'PRECO_REPOSICAO_4', 'PRECO_A_VISTA_REPOSICAO_2', 'PRECO_A_VISTA_REPOSICAO_3', 'PRECO_A_VISTA_REPOSICAO_4', 'FABRICANTE_FRETE', 'DROP_DE_TAMANHOS', 'STATUS_PRODUTO', 'TIPO_STATUS_PRODUTO', 'OBS', 'COMPOSICAO', 'RESTRICAO_LAVAGEM', 'ORCAMENTO', 'CLIENTE_DO_PRODUTO', 'CONTA_CONTABIL', 'ESPESSURA', 'ALTURA', 'LARGURA', 'COMPRIMENTO', 'EMPILHAMENTO_MAXIMO', 'PARTE_TIPO', 'VERSAO_FICHA', 'COD_FLUXO_PRODUTO', 'DATA_INICIO_DESENVOLVIMENTO', 'INDICADOR_CFOP', 'MONTAGEM_KIT', 'MRP_AGRUPAR_NECESSIDADE_DIAS', 'MRP_AGRUPAR_NECESSIDADE_TIPO', 'MRP_DIAS_SEGURANCA', 'MRP_EMISSAO_LIBERACAO_DIAS', 'MRP_ENTREGA_GIRO_DIAS', 'MRP_PARTICIPANTE', 'MRP_MAIOR_GIRO_MP_DIAS', 'MRP_FP', 'MRP_RR', 'OP_POR_COR', 'OP_QTDE_MAXIMA', 'OP_QTDE_MINIMA', 'QUALIDADE', 'SEMI_ACABADO', 'CONTA_CONTABIL_COMPRA', 'CONTA_CONTABIL_VENDA', 'CONTA_CONTABIL_DEV_COMPRA', 'CONTA_CONTABIL_DEV_VENDA', 'ID_EXCECAO_GRUPO', 'ID_EXCECAO_IMPOSTO', 'DIAS_COMPRA', 'FATOR_P', 'FATOR_Q', 'FATOR_F', 'CONTINUIDADE', 'COD_PRODUTO_SOLUCAO', 'COD_PRODUTO_SEGMENTO', 'ID_PRECO', 'TIPO_ITEM_SPED', 'PERC_COMISSAO', 'ACEITA_ENCOMENDA', 'DIAS_GARANTIA_LOJA', 'DIAS_GARANTIA_FABRICANTE', 'POSSUI_MONTAGEM', 'PERMITE_ENTREGA_FUTURA', 'NATUREZA_RECEITA', 'COD_ALIQUOTA_PIS_COFINS_DIF', 'DATA_LIMITE_PEDIDO', 'LX_STATUS_REGISTRO', 'ARREDONDA', 'ID_ARTIGO', 'LX_HASH', 'SPED_DATA_FIM', 'SPED_DATA_INI', 'TIPO_PP', 'FATOR_A', 'FATOR_B', 'FATOR_BUFFER', 'FATOR_LT', 'TIPO_CANAL', 'NAO_ENVIA_ETL', 'TITULO_B2C', 'DESCRICAO_B2C', 'PRE_VENDA', 'TAGS', 'VIDEO_EMBED', 'CARACTERISTICAS_TECNICAS_B2C', 'FRETE_GRATIS', 'ESTOQUE_MINIMO', 'DATA_PUBLICACAO_B2C', 'GRUPO_PRODUTO_B2C', 'SUBGRUPO_PRODUTO_B2C', 'TIPO_PRODUTO_B2C', 'GRIFFE_B2C', 'LINHA_B2C', 'FABRICANTE_B2C', 'CATEGORIA_B2C', 'SUBCATEGORIA_B2C', 'REPOSICAO_B2C', 'IMG_ESTILO', 'DESCRICAO_B2C_2', 'DESCRICAO_B2C_3', 'SUJEITO_SUBSTITUTICAO_TRIBUTARIA', 'OPTION_TITULO', 'OPTION_DESC', 'OPTION_CARACTERISTICA','EMPRESA','SEXO_TIPO','PESO','DIAS_ACERTO_CONSIGNACAO','POSSUI_GTIN'],
    'estoque': ['CUSTO_MEDIO1', 'CUSTO_MEDIO2', 'CUSTO_MEDIO3', 'CUSTO_MEDIO4', 'ULTIMO_CUSTO1', 'ULTIMO_CUSTO2', 'ULTIMO_CUSTO3', 'ULTIMO_CUSTO4', 'DATA_CUSTO_MEDIO', 'DATA_ULT_CUSTO'] + [f'ES{i}' for i in range(1, 49)] + ['TIMESTAMP', 'PRIMEIRA_ENTRADA', 'LX_STATUS_REGISTRO', 'LX_HASH'],
    'vendas': ['DESCONTO_ITEM', 'CODIGO_DESCONTO', 'CODIGO_TAB_PRECO', 'OPERACAO_VENDA', 'FATOR_VENDA_LIQ', 'VALOR_TIKET', 'DESCONTO_VENDA', 'DATA_HORA_CANCELAMENTO', 'QTDE_CANCELADA']
}

def normalizar_colunas_chave(df, colunas=None):
    """Remove espacos do SQL Server em chaves usadas nos merges."""
    if df is None or df.empty:
        return df

    df = df.copy()
    colunas = colunas or ['PRODUTO', 'COR_PRODUTO', 'CODIGO_BARRA', 'TAMANHO_GRADE']
    for col in colunas:
        if col in df.columns:
            df[col] = df[col].astype('string').str.replace('\xa0', ' ', regex=False).str.strip()
            df[col] = df[col].replace('', pd.NA)

    if 'TAMANHO' in df.columns:
        df['TAMANHO'] = pd.to_numeric(df['TAMANHO'], errors='coerce').astype('Int64')

    return df

def normalizar_texto_cor(serie):
    """Normaliza texto de cor (caixa, acento, espaços) para chave de match."""
    serie = serie.astype('string').str.replace('\xa0', ' ', regex=False).str.strip().str.upper()
    # Calcula a remoção de acentos apenas nos valores únicos, depois mapeia de volta —
    # evita o loop Python linha-a-linha que era O(N) onde N pode ser milhões de linhas.
    unicos = {v for v in serie.dropna().unique()}
    mapa = {
        v: ''.join(ch for ch in unicodedata.normalize('NFKD', str(v)) if not unicodedata.combining(ch))
        for v in unicos
    }
    serie = serie.map(mapa)
    serie = serie.str.replace(r'\s+', ' ', regex=True)
    return serie.replace('', pd.NA)

def adicionar_desc_cor(df, col_cor='COR_PRODUTO', col_desc='DESC_COR_PRODUTO'):
    """Preenche descrição de cor por código e por produto (quando há cor única)."""
    if df is None or df.empty:
        return df
    if col_desc in df.columns and df[col_desc].notna().any():
        return df
    if col_cor not in df.columns:
        return df

    df = df.copy()
    df_cores = get_df_cores()
    if df_cores.empty:
        return df
    mapa_cores = (
        df_cores.assign(
            COR=df_cores['COR'].astype('string').str.replace('\xa0', ' ', regex=False).str.strip(),
            DESC_COR=df_cores['DESC_COR'].astype('string').str.replace('\xa0', ' ', regex=False).str.strip()
        )
        .dropna(subset=['COR', 'DESC_COR'])
        .drop_duplicates(subset=['COR'], keep='first')
    )
    if mapa_cores.empty:
        return df

    mapa = dict(zip(mapa_cores['COR'], mapa_cores['DESC_COR']))
    if col_desc not in df.columns:
        df[col_desc] = pd.NA
    mask_desc_vazia = df[col_desc].isna()
    df.loc[mask_desc_vazia, col_desc] = (
        df.loc[mask_desc_vazia, col_cor]
        .astype('string')
        .str.replace('\xa0', ' ', regex=False)
        .str.strip()
        .map(mapa)
    )
    if 'PRODUTO' in df.columns and DESC_COR_POR_PRODUTO:
        mask_desc_vazia = df[col_desc].isna()
        df.loc[mask_desc_vazia, col_desc] = (
            df.loc[mask_desc_vazia, 'PRODUTO']
            .astype('string')
            .str.replace('\xa0', ' ', regex=False)
            .str.strip()
            .map(DESC_COR_POR_PRODUTO)
        )
    return df

def atualizar_desc_cor_por_produto(df_produto_cores):
    """
    Atualiza cache PRODUTO -> DESC_COR_PRODUTO apenas para produtos com cor única.
    Evita ambiguidade de cor para o mesmo produto.
    """
    global DESC_COR_POR_PRODUTO
    DESC_COR_POR_PRODUTO = {}
    if df_produto_cores is None or df_produto_cores.empty:
        return
    if not all(col in df_produto_cores.columns for col in ['PRODUTO', 'DESC_COR_PRODUTO']):
        return

    df = df_produto_cores.copy()
    df = normalizar_colunas_chave(df, ['PRODUTO', 'DESC_COR_PRODUTO'])
    df = df.dropna(subset=['PRODUTO', 'DESC_COR_PRODUTO'])
    if df.empty:
        return

    descs_por_prod = (
        df.groupby('PRODUTO', dropna=False)['DESC_COR_PRODUTO']
        .nunique(dropna=True)
        .reset_index(name='QTDE_DESC')
    )
    produtos_unicos = set(descs_por_prod.loc[descs_por_prod['QTDE_DESC'] == 1, 'PRODUTO'])
    if not produtos_unicos:
        return

    unicos = df[df['PRODUTO'].isin(produtos_unicos)].copy()
    unicos = unicos.sort_values(['PRODUTO', 'DESC_COR_PRODUTO']).drop_duplicates(subset=['PRODUTO'], keep='first')
    DESC_COR_POR_PRODUTO = dict(zip(unicos['PRODUTO'], unicos['DESC_COR_PRODUTO']))

def preparar_codigos_barra(df_codigos_barra):
    """Padroniza o mapa PRODUTO+COR+TAMANHO -> tamanho legivel/codigo.
    Resultado é cacheado globalmente: o DataFrame de barcodes não muda dentro de uma execução."""
    global _CACHE_CODIGOS_BARRA
    if _CACHE_CODIGOS_BARRA is not None:
        return _CACHE_CODIGOS_BARRA

    if df_codigos_barra is None or df_codigos_barra.empty:
        return pd.DataFrame(columns=['PRODUTO', 'COR_PRODUTO', 'TAMANHO', 'TAMANHO_GRADE', 'CODIGO_BARRA'])

    codigos = df_codigos_barra.copy()
    if 'TAMANHO_GRADE' not in codigos.columns and 'GRADE' in codigos.columns:
        codigos = codigos.rename(columns={'GRADE': 'TAMANHO_GRADE'})

    colunas = ['PRODUTO', 'COR_PRODUTO', 'DESC_COR_PRODUTO', 'TAMANHO', 'TAMANHO_GRADE', 'CODIGO_BARRA']
    for col in colunas:
        if col not in codigos.columns:
            codigos[col] = pd.NA

    codigos = adicionar_desc_cor(codigos, col_cor='COR_PRODUTO', col_desc='DESC_COR_PRODUTO')
    codigos = normalizar_colunas_chave(codigos[colunas], ['PRODUTO', 'COR_PRODUTO', 'CODIGO_BARRA', 'TAMANHO_GRADE', 'DESC_COR_PRODUTO'])
    codigos = codigos.dropna(subset=['PRODUTO', 'CODIGO_BARRA'])
    codigos['COR_CHAVE'] = codigos['COR_PRODUTO'].where(codigos['COR_PRODUTO'].notna(), codigos['DESC_COR_PRODUTO'])
    codigos['COR_CHAVE'] = normalizar_texto_cor(codigos['COR_CHAVE'])
    codigos = codigos.dropna(subset=['COR_CHAVE'])
    codigos = codigos.sort_values(['PRODUTO', 'COR_CHAVE', 'TAMANHO', 'CODIGO_BARRA'])
    codigos = codigos.drop_duplicates(subset=['PRODUTO', 'COR_CHAVE', 'TAMANHO'], keep='first')

    _CACHE_CODIGOS_BARRA = codigos
    return _CACHE_CODIGOS_BARRA

def enriquecer_com_codigo_barra(df_base, df_codigos_barra, prioridade_tamanho=True, permitir_fallback=True):
    """
    Adiciona CODIGO_BARRA e TAMANHO_GRADE.
    Quando TAMANHO existe, o match exato PRODUTO+COR+TAMANHO evita usar o primeiro
    codigo da grade inteira para outros tamanhos.
    """
    if 'PRODUTO' not in df_base.columns:
        return df_base

    df_resultado = adicionar_desc_cor(df_base, col_cor='COR_PRODUTO', col_desc='DESC_COR_PRODUTO')
    df_resultado = normalizar_colunas_chave(df_resultado, ['PRODUTO', 'COR_PRODUTO', 'DESC_COR_PRODUTO'])
    if 'COR_CHAVE' not in df_resultado.columns:
        df_resultado['COR_CHAVE'] = pd.NA
    df_resultado['COR_CHAVE'] = df_resultado['COR_PRODUTO'].where(
        df_resultado['COR_PRODUTO'].notna(),
        df_resultado['DESC_COR_PRODUTO'] if 'DESC_COR_PRODUTO' in df_resultado.columns else pd.NA
    )
    df_resultado['COR_CHAVE'] = normalizar_texto_cor(df_resultado['COR_CHAVE'])
    codigos = preparar_codigos_barra(df_codigos_barra)
    if codigos.empty:
        if 'COR_CHAVE' in df_resultado.columns:
            df_resultado.drop(columns=['COR_CHAVE'], inplace=True, errors='ignore')
        return df_resultado

    if 'CODIGO_BARRA' not in df_resultado.columns:
        df_resultado['CODIGO_BARRA'] = pd.NA
    if 'TAMANHO_GRADE' not in df_resultado.columns:
        df_resultado['TAMANHO_GRADE'] = pd.NA

    def preencher_por_chaves(chaves, apenas_sem_tamanho=False):
        nonlocal df_resultado
        if not all(col in df_resultado.columns for col in chaves):
            return

        codigos_merge = codigos[chaves + ['CODIGO_BARRA', 'TAMANHO_GRADE']].drop_duplicates(subset=chaves)
        df_resultado = df_resultado.merge(codigos_merge, how='left', on=chaves, suffixes=('', '_MERGE'))

        mask = df_resultado['CODIGO_BARRA'].isna() & df_resultado['CODIGO_BARRA_MERGE'].notna()
        mask_tamanho = df_resultado['TAMANHO_GRADE'].isna() & df_resultado['TAMANHO_GRADE_MERGE'].notna()
        if apenas_sem_tamanho and 'TAMANHO' in df_resultado.columns:
            mask = mask & df_resultado['TAMANHO'].isna()
            mask_tamanho = mask_tamanho & df_resultado['TAMANHO'].isna()

        df_resultado.loc[mask, 'CODIGO_BARRA'] = df_resultado.loc[mask, 'CODIGO_BARRA_MERGE']
        df_resultado.loc[mask_tamanho, 'TAMANHO_GRADE'] = df_resultado.loc[mask_tamanho, 'TAMANHO_GRADE_MERGE']
        df_resultado.drop(columns=['CODIGO_BARRA_MERGE', 'TAMANHO_GRADE_MERGE'], inplace=True)

    if prioridade_tamanho and all(col in df_resultado.columns for col in ['PRODUTO', 'COR_CHAVE', 'TAMANHO']):
        preencher_por_chaves(['PRODUTO', 'COR_CHAVE', 'TAMANHO'])

    if permitir_fallback:
        preencher_por_chaves(['PRODUTO', 'COR_CHAVE'], apenas_sem_tamanho=True)

    if 'COR_CHAVE' in df_resultado.columns:
        df_resultado.drop(columns=['COR_CHAVE'], inplace=True, errors='ignore')

    return df_resultado

def reordenar_colunas_sku(df):
    """Coloca CODIGO_BARRA logo apos PRODUTO e TAMANHO/TAMANHO_GRADE perto de GRADE."""
    ordem = list(df.columns)
    especiais = [c for c in ['CODIGO_BARRA', 'TAMANHO', 'TAMANHO_GRADE'] if c in ordem]
    for col in especiais:
        ordem.remove(col)

    if 'PRODUTO' in ordem:
        pos_produto = ordem.index('PRODUTO') + 1
        ordem.insert(pos_produto, 'CODIGO_BARRA')
        if 'TAMANHO' in df.columns:
            ordem.insert(ordem.index('GRADE') + 1 if 'GRADE' in ordem else len(ordem), 'TAMANHO')
        if 'TAMANHO_GRADE' in df.columns:
            ordem.insert(ordem.index('GRADE') + 1 if 'GRADE' in ordem else len(ordem), 'TAMANHO_GRADE')
    else:
        ordem = ['CODIGO_BARRA'] + ordem
        if 'TAMANHO' in df.columns:
            ordem.append('TAMANHO')
        if 'TAMANHO_GRADE' in df.columns:
            ordem.append('TAMANHO_GRADE')

    # Se houver GRADE, empurra tamanho/tamanho_grade imediatamente depois dela
    if 'GRADE' in ordem:
        for col in ['TAMANHO_GRADE', 'TAMANHO']:
            if col in ordem:
                ordem.remove(col)
        idx_grade = ordem.index('GRADE') + 1
        inserir = [c for c in ['TAMANHO', 'TAMANHO_GRADE'] if c in df.columns]
        for offset, col in enumerate(inserir):
            ordem.insert(idx_grade + offset, col)

    return df[ordem]

def montar_produtos_com_tamanhos(df_produtos, df_codigos_barra):
    """Gera uma linha por produto/cor/tamanho/codigo de barra no relatorio de produtos."""
    produtos = normalizar_colunas_chave(df_produtos, ['PRODUTO'])
    codigos = preparar_codigos_barra(df_codigos_barra)
    if codigos.empty:
        return produtos

    df_skus = produtos.merge(codigos, on='PRODUTO', how='left')
    df_skus = df_skus.sort_values(['PRODUTO', 'COR_PRODUTO', 'TAMANHO'], na_position='last')
    return reordenar_colunas_sku(df_skus)

def desdobrar_colunas_grade(df, colunas_grade, df_codigos_barra, coluna_total, coluna_qtde,
                            coluna_total_grade=None, manter_zeros=False):
    """Transforma colunas ES1/EN_1/SA_1/F1 em linhas por tamanho."""
    colunas_presentes = [col for col in colunas_grade if col in df.columns]
    if not colunas_presentes:
        return enriquecer_com_codigo_barra(df, df_codigos_barra, prioridade_tamanho=True, permitir_fallback=False)

    df_base = normalizar_colunas_chave(df, ['PRODUTO', 'COR_PRODUTO'])
    coluna_total_grade = coluna_total_grade or f'{coluna_total}_TOTAL_GRADE'
    if coluna_total in df_base.columns:
        df_base = df_base.rename(columns={coluna_total: coluna_total_grade})

    id_vars = [col for col in df_base.columns if col not in colunas_presentes]
    if not manter_zeros:
        df_grade = df_base.melt(
            id_vars=id_vars,
            value_vars=colunas_presentes,
            var_name='_COLUNA_GRADE',
            value_name='_QTDE_TAMANHO'
        )
        df_grade['TAMANHO'] = df_grade['_COLUNA_GRADE'].str.extract(r'(\d+)$').astype('Int64')
        df_grade[coluna_qtde] = pd.to_numeric(df_grade['_QTDE_TAMANHO'], errors='coerce').fillna(0)
        df_grade.drop(columns=['_COLUNA_GRADE', '_QTDE_TAMANHO'], inplace=True)
        df_grade = df_grade[df_grade[coluna_qtde] != 0].copy()
        df_grade = enriquecer_com_codigo_barra(df_grade, df_codigos_barra, prioridade_tamanho=True, permitir_fallback=False)
        return reordenar_colunas_sku(df_grade)

    tamanho_por_coluna = pd.Series(colunas_presentes, dtype='string').str.extract(r'(\d+)$')[0]
    mapa_tamanho_coluna = {
        int(tamanho): coluna
        for coluna, tamanho in zip(colunas_presentes, tamanho_por_coluna)
        if pd.notna(tamanho)
    }

    partes_nz = []
    for tamanho, coluna in mapa_tamanho_coluna.items():
        qtde = pd.to_numeric(df_base[coluna], errors='coerce').fillna(0)
        mask = qtde != 0
        if mask.any():
            parte = df_base.loc[mask, id_vars].copy()
            parte['TAMANHO'] = tamanho
            parte[coluna_qtde] = qtde.loc[mask].to_numpy()
            partes_nz.append(parte)

    if partes_nz:
        df_nz = pd.concat(partes_nz, ignore_index=True)
        df_nz = enriquecer_com_codigo_barra(
            df_nz, df_codigos_barra, prioridade_tamanho=True, permitir_fallback=False
        )
    else:
        df_nz = pd.DataFrame(columns=id_vars + ['TAMANHO', coluna_qtde, 'CODIGO_BARRA', 'TAMANHO_GRADE'])

    # manter_zeros=True: cria linhas zeradas apenas para tamanhos com barcode cadastrado.
    # Isso evita o melt completo de 48 posicoes e o merge de milhoes de zeros.
    df_codificados = pd.DataFrame()
    codigos = preparar_codigos_barra(df_codigos_barra)
    if not codigos.empty and 'COR_PRODUTO' in df_base.columns:
        df_base_key = adicionar_desc_cor(df_base, col_cor='COR_PRODUTO', col_desc='DESC_COR_PRODUTO')
        df_base_key = normalizar_colunas_chave(df_base_key, ['PRODUTO', 'COR_PRODUTO', 'DESC_COR_PRODUTO'])
        df_base_key['COR_CHAVE'] = df_base_key['COR_PRODUTO'].where(
            df_base_key['COR_PRODUTO'].notna(),
            df_base_key['DESC_COR_PRODUTO'] if 'DESC_COR_PRODUTO' in df_base_key.columns else pd.NA
        )
        df_base_key['COR_CHAVE'] = normalizar_texto_cor(df_base_key['COR_CHAVE'])
        df_base_key = df_base_key.drop(columns=['CODIGO_BARRA', 'TAMANHO', 'TAMANHO_GRADE'], errors='ignore')

        codigos_key = codigos[['PRODUTO', 'COR_CHAVE', 'TAMANHO', 'CODIGO_BARRA', 'TAMANHO_GRADE']]
        codigos_key = codigos_key[codigos_key['TAMANHO'].isin(list(mapa_tamanho_coluna))].copy()
        codigos_key = codigos_key.drop_duplicates(subset=['PRODUTO', 'COR_CHAVE', 'TAMANHO'])

        if not codigos_key.empty:
            df_codificados = df_base_key.merge(codigos_key, how='inner', on=['PRODUTO', 'COR_CHAVE'])
            df_codificados[coluna_qtde] = 0
            for tamanho, coluna in mapa_tamanho_coluna.items():
                mask = df_codificados['TAMANHO'].eq(tamanho)
                if mask.any():
                    df_codificados.loc[mask, coluna_qtde] = (
                        pd.to_numeric(df_codificados.loc[mask, coluna], errors='coerce')
                        .fillna(0)
                        .to_numpy()
                    )
            df_codificados.drop(columns=colunas_presentes + ['COR_CHAVE'], inplace=True, errors='ignore')

    if not df_codificados.empty and 'CODIGO_BARRA' in df_nz.columns:
        df_nz = df_nz[df_nz['CODIGO_BARRA'].isna()].copy()

    frames = [frame for frame in [df_codificados, df_nz] if not frame.empty]
    if frames:
        colunas_finais = []
        for frame in frames:
            colunas_finais.extend(col for col in frame.columns if col not in colunas_finais)
        frames_concat = [frame.dropna(axis=1, how='all') for frame in frames]
        df_grade = pd.concat(frames_concat, ignore_index=True).reindex(columns=colunas_finais)
    else:
        df_grade = pd.DataFrame(columns=df_nz.columns)
    return reordenar_colunas_sku(df_grade)

def formatar_tempo_execucao(segundos):
    """
    Formata o tempo de execução de forma legível.
    - Se < 60s: mostra em segundos
    - Se >= 60s: mostra em minutos e segundos
    """
    if segundos < 60:
        return f"{segundos:.2f} segundos"
    else:
        minutos = int(segundos // 60)
        segundos_restantes = segundos % 60
        return f"{minutos} min {segundos_restantes:.0f} seg"

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
            # Configurar timeout de comando (em segundos)
            conn.timeout = 300  # 5 minutos
            if nome == 'fallback':
                print(f"✓ Conectado via servidor fallback ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    # Se chegou aqui, ambos os servidores falharam
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
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
    df = normalizar_colunas_chave(df, ['PRODUTO'])
    df_export = montar_produtos_com_tamanhos(df, df_codigos_barra)
    
    if salvar:
        salvar_relatorio(df_export, 'produtos_tratados', 'ProdutosTratados')
    print(f"Tempo: {time.time()-t:.2f}s")
    return df

def processar_estoque(df_estoque, df_produtos, df_codigos_barra):
    """Processa relatório de estoque"""
    t = time.time()
    print("\n[ESTOQUE]")
    
    # Merge com produtos
    cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'CUSTO_REPOSICAO1', 'PRECO_REPOSICAO_1', 
                 'LINHA', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'GRADE', 'GRIFFE']
    df_estoque = normalizar_colunas_chave(df_estoque, ['PRODUTO', 'COR_PRODUTO'])
    df_produtos = normalizar_colunas_chave(df_produtos, ['PRODUTO'])
    df = df_estoque.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
    
    df = converter_datas(df, ['ULTIMA_SAIDA', 'ULTIMA_ENTRADA', 'DATA_PARA_TRANSFERENCIA', 'DATA_AJUSTE'])
    df = desdobrar_colunas_grade(
        df,
        COLUNAS_GRADE_ESTOQUE,
        df_codigos_barra,
        coluna_total='ESTOQUE',
        coluna_qtde='ESTOQUE',
        coluna_total_grade='ESTOQUE_TOTAL_GRADE',
        manter_zeros=True
    )
    # Manter zeros apenas para tamanhos com código de barras cadastrado;
    # descarta as 45+ posições vazias de grade que não têm barcode real.
    df = df[(df['ESTOQUE'] != 0) | df['CODIGO_BARRA'].notna()].copy()
    df['VALOR_TOTAL_ESTOQUE'] = df['ESTOQUE'].fillna(0) * df['CUSTO_REPOSICAO1'].fillna(0)
    df.drop(columns=COLS_REMOVER['estoque'], inplace=True, errors='ignore')
    
    salvar_relatorio(df, 'estoque_tratados', 'EstoqueTratado')
    print(f"Tempo: {time.time()-t:.2f}s")

def processar_vendas(df, df_codigos_barra):
    """Processa relatório de vendas"""
    t = time.time()
    print("\n[VENDAS]")
    
    # 1) Converter datas (DATA_VENDA) para datetime
    df = converter_datas(df, ['DATA_VENDA'])
    
    # 2) Enriquecimento com códigos de barra usando a mesma lógica do site:
    #    prioridade PRODUTO+COR+TAMANHO, depois PRODUTO+COR, depois PRODUTO
    #    (equivalente ao enrichWithBarcode com prioritizeSize=True)
    df = enriquecer_com_codigo_barra(df, df_codigos_barra, prioridade_tamanho=True, permitir_fallback=False)
    
    # 3) Calcular valor total da venda (antes de considerar trocas)
    #    TOTAL_VENDA = (PRECO_LIQUIDO * QTDE) - DESCONTO
    #    O DESCONTO é o desconto do ticket (renomeado de DESCONTO_VENDA no SQL)
    df['TOTAL_VENDA'] = (df['PRECO_LIQUIDO'].fillna(0) * df['QTDE'].fillna(0)) - df['DESCONTO'].fillna(0)
    
    # 4) Calcular quantidade total da venda (antes de considerar trocas)
    #    Este será o valor que vai para TOTAL_QTDE_VENDA
    df['TOTAL_QTDE_VENDA'] = df['QTDE'].fillna(0)
    
    # 5) Garantir que as colunas de troca por item existam e estejam preenchidas
    if 'QTDE_TROCA_ITEM' not in df.columns:
        df['QTDE_TROCA_ITEM'] = 0
    if 'VALOR_TROCA_ITEM' not in df.columns:
        df['VALOR_TROCA_ITEM'] = 0
    
    df['QTDE_TROCA_ITEM'] = df['QTDE_TROCA_ITEM'].fillna(0)
    df['VALOR_TROCA_ITEM'] = df['VALOR_TROCA_ITEM'].fillna(0)
    
    # 6) Cálculo direto por item (sem distribuição proporcional)
    #    VALOR_TROCA = VALOR_TROCA_ITEM
    #    QTDE_TROCA = QTDE_TROCA_ITEM
    df['QTDE_TROCA'] = df['QTDE_TROCA_ITEM']
    df['VALOR_TROCA'] = df['VALOR_TROCA_ITEM']
    
    # 7) Calcular valores líquidos:
    #    VALOR_LIQUIDO = TOTAL_VENDA - VALOR_TROCA
    #    QTDE (Coluna Final) = TOTAL_QTDE_VENDA - QTDE_TROCA
    df['VALOR_LIQUIDO'] = df['TOTAL_VENDA'] - df['VALOR_TROCA']
    
    # Substituir QTDE pela quantidade líquida calculada (garantindo valores inteiros)
    df['QTDE'] = (df['TOTAL_QTDE_VENDA'] - df['QTDE_TROCA']).astype(int)
    
    # Garantir que TOTAL_QTDE_VENDA e QTDE_TROCA também sejam inteiros
    df['TOTAL_QTDE_VENDA'] = df['TOTAL_QTDE_VENDA'].astype(int)
    df['QTDE_TROCA'] = df['QTDE_TROCA'].astype(int)
    
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

def processar_ecommerce(df, df_codigos_barra):
    """Processa relatório de e-commerce"""
    t = time.time()
    print("\n[E-COMMERCE]")

    # Converter datas
    df = converter_datas(df, ['EMISSAO', 'DATA_SAIDA', 'ENTREGA'])

    # Derivar REGIAO a partir do UF do cliente (não da filial)
    UF_TO_REGIAO = {
        'AC': 'NORTE', 'AM': 'NORTE', 'AP': 'NORTE', 'PA': 'NORTE',
        'RO': 'NORTE', 'RR': 'NORTE', 'TO': 'NORTE',
        'AL': 'NORDESTE', 'BA': 'NORDESTE', 'CE': 'NORDESTE', 'MA': 'NORDESTE',
        'PB': 'NORDESTE', 'PE': 'NORDESTE', 'PI': 'NORDESTE', 'RN': 'NORDESTE', 'SE': 'NORDESTE',
        'DF': 'CENTRO-OESTE', 'GO': 'CENTRO-OESTE', 'MS': 'CENTRO-OESTE', 'MT': 'CENTRO-OESTE',
        'ES': 'SUDESTE', 'MG': 'SUDESTE', 'RJ': 'SUDESTE', 'SP': 'SUDESTE',
        'PR': 'SUL', 'RS': 'SUL', 'SC': 'SUL',
    }
    if 'UF' in df.columns:
        df['REGIAO'] = df['UF'].map(UF_TO_REGIAO)

    # Remover duplicatas mantendo apenas uma linha por NF_SAIDA + SERIE_NF + ITEM
    # Isso garante que não haja registros duplicados no relatório
    if not df.empty:
        # Criar chave única para identificar duplicatas
        df['_CHAVE_DUPLICATA'] = df['NF_SAIDA'].astype(str) + '|' + df['SERIE_NF'].astype(str) + '|' + df['ITEM'].astype(str)
        
        # Remover duplicatas mantendo a primeira ocorrência
        df = df.drop_duplicates(subset=['_CHAVE_DUPLICATA'], keep='first')
        
        # Remover coluna auxiliar
        df.drop(columns=['_CHAVE_DUPLICATA'], inplace=True)

    df = desdobrar_colunas_grade(
        df,
        COLUNAS_GRADE_ECOMMERCE,
        df_codigos_barra,
        coluna_total='QTDE',
        coluna_qtde='QTDE',
        coluna_total_grade='QTDE_TOTAL_GRADE'
    )
    
    salvar_relatorio(df, 'ecommerce', 'Ecommerce')
    print(f"Tempo: {time.time()-t:.2f}s")

def processar_entradas(df_mov, df_produtos, df_cores, df_codigos_barra):
    """Processa relatório de entradas"""
    t = time.time()
    print("\n[ENTRADAS]")
    
    if df_mov.empty:
        print("✗ Sem dados de entradas")
        return
    
    df_mov.dropna(subset=['PRODUTO'], inplace=True)
    df_mov = normalizar_colunas_chave(df_mov, ['PRODUTO', 'COR_PRODUTO'])
    df_produtos = normalizar_colunas_chave(df_produtos, ['PRODUTO'])
    
    # Merge produtos
    cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
    df = df_mov.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
    
    # Merge cores
    df_cores_copy = df_cores.rename(columns={'COR': 'COR_PRODUTO', 'DESC_COR': 'DESC_COR_PRODUTO'})
    df_cores_copy = normalizar_colunas_chave(df_cores_copy, ['COR_PRODUTO'])
    df = df.merge(df_cores_copy, on='COR_PRODUTO', how='left')
    
    df = converter_datas(df, ['EMISSAO'])
    df = desdobrar_colunas_grade(
        df,
        COLUNAS_GRADE_ENTRADAS,
        df_codigos_barra,
        coluna_total='QTDE_TOTAL',
        coluna_qtde='QTDE_TOTAL',
        coluna_total_grade='QTDE_TOTAL_GRADE'
    )
    
    # Ordena colunas
    ordem = ['EMISSAO', 'FILIAL', 'ROMANEIO_PRODUTO', 'PRODUTO', 'DESC_PRODUTO',
             'COR_PRODUTO', 'DESC_COR_PRODUTO', 'TAMANHO', 'TAMANHO_GRADE', 'CODIGO_BARRA',
             'QTDE_TOTAL', 'QTDE_TOTAL_GRADE', 'TIPO_ENTRADA', 'TIPO_ROMANEIO',
             'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
    df = df[[c for c in ordem if c in df.columns]]
    
    salvar_relatorio(df, 'entradas', 'EntradasEnriquecidas')
    print(f"Tempo: {time.time()-t:.2f}s")

def processar_saidas(df_saidas, df_produtos, df_cores, df_codigos_barra):
    """Processa relatório de saídas"""
    t = time.time()
    print("\n[SAÍDAS]")
    
    if df_saidas.empty:
        print("✗ Sem dados de saídas")
        return
    
    df_saidas.dropna(subset=['PRODUTO'], inplace=True)
    df_saidas = normalizar_colunas_chave(df_saidas, ['PRODUTO', 'COR_PRODUTO'])
    df_produtos = normalizar_colunas_chave(df_produtos, ['PRODUTO'])
    
    # Merge produtos
    cols_prod = ['PRODUTO', 'DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
    df = df_saidas.merge(df_produtos[cols_prod], on='PRODUTO', how='left')
    
    # Merge cores
    df_cores_copy = df_cores.rename(columns={'COR': 'COR_PRODUTO', 'DESC_COR': 'DESC_COR_PRODUTO'})
    df_cores_copy = normalizar_colunas_chave(df_cores_copy, ['COR_PRODUTO'])
    df = df.merge(df_cores_copy, on='COR_PRODUTO', how='left')
    
    df = converter_datas(df, ['EMISSAO'])
    df = desdobrar_colunas_grade(
        df,
        COLUNAS_GRADE_SAIDAS,
        df_codigos_barra,
        coluna_total='QTDE_TOTAL',
        coluna_qtde='QTDE_TOTAL',
        coluna_total_grade='QTDE_TOTAL_GRADE'
    )
    
    # Ordena colunas
    ordem = ['EMISSAO', 'FILIAL', 'FILIAL_DESTINO', 'ROMANEIO_PRODUTO', 'PRODUTO', 'DESC_PRODUTO',
             'COR_PRODUTO', 'DESC_COR_PRODUTO', 'TAMANHO', 'TAMANHO_GRADE', 'CODIGO_BARRA',
             'QTDE_TOTAL', 'QTDE_TOTAL_GRADE', 'TIPO_ROMANEIO',
             'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO']
    df = df[[c for c in ordem if c in df.columns]]
    
    salvar_relatorio(df, 'saidas', 'SaidasEnriquecidas')
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
            'entradas': 'entradas',
            'saidas': 'saidas'
        }
        
        # Se não especificado, copia todos
        if relatorios_gerados is None:
            bases = ['produtos_tratados', 'estoque_tratados', 'vendas_tratadas', 'ecommerce', 'entradas', 'saidas']
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
    """Exibe menu de seleção de relatórios e retorna a escolha (pode ser lista ou 'todos')"""
    print("\n" + "="*60)
    print("SELECIONE O RELATÓRIO PARA EXPORTAR")
    print("="*60)
    print("\n0 - Exportar TODOS os relatórios (padrão)")
    print("1 - Produtos")
    print("2 - Estoque")
    print("3 - Vendas")
    print("4 - E-commerce")
    print("5 - Entradas")
    print("6 - Saídas")
    print("\n💡 Dica: Você pode selecionar múltiplos separando por vírgula (ex: 1,2,3)")
    print("\n" + "-"*60)
    
    escolha = input("Digite o número da opção (ou Enter para todos): ").strip()
    
    if not escolha or escolha == '0':
        return 'todos'
    
    opcoes = {
        '1': 'produtos',
        '2': 'estoque',
        '3': 'vendas',
        '4': 'ecommerce',
        '5': 'entradas',
        '6': 'saidas'
    }
    
    # Separar por vírgula e processar múltiplas seleções
    escolhas = [e.strip() for e in escolha.split(',')]
    relatorios_selecionados = []
    opcoes_invalidas = []
    
    for e in escolhas:
        if e in opcoes:
            relatorio = opcoes[e]
            # Evitar duplicatas
            if relatorio not in relatorios_selecionados:
                relatorios_selecionados.append(relatorio)
        else:
            opcoes_invalidas.append(e)
    
    if opcoes_invalidas:
        print(f"⚠ Opções inválidas ignoradas: {', '.join(opcoes_invalidas)}")
    
    if not relatorios_selecionados:
        print(f"⚠ Nenhuma opção válida selecionada. Exportando todos os relatórios.")
        return 'todos'
    
    # Se selecionou todos os 6, retornar 'todos' para otimização
    if len(relatorios_selecionados) == 6:
        return 'todos'
    
    return relatorios_selecionados

def main():
    """Orquestrador principal"""
    t_total = time.time()
    print("="*60)
    print("EXPORTADOR DE RELATÓRIOS SCARFME v5.0")
    print("="*60)
    
    # Menu de seleção
    relatorio_escolhido = exibir_menu()
    
    nomes_relatorios = {
        'produtos': 'Produtos',
        'estoque': 'Estoque',
        'vendas': 'Vendas',
        'ecommerce': 'E-commerce',
        'entradas': 'Entradas',
        'saidas': 'Saídas'
    }
    
    # Determinar quais relatórios processar
    if relatorio_escolhido == 'todos':
        relatorios_processar = ['produtos', 'estoque', 'vendas', 'ecommerce', 'entradas', 'saidas']
        print("\n✓ Exportando TODOS os relatórios")
    else:
        # relatorio_escolhido já é uma lista
        relatorios_processar = relatorio_escolhido
        nomes = [nomes_relatorios.get(r, r) for r in relatorios_processar]
        print(f"\n✓ Exportando: {', '.join(nomes)}")
    
    # Definir dependências de cada relatório
    dependencias = {
        'produtos': ['produtos_barra', 'produto_cores'],
        'estoque': ['produtos', 'produtos_barra', 'produto_cores'],
        'vendas': ['produtos_barra', 'produto_cores'],
        'ecommerce': ['produtos_barra', 'produto_cores'],
        'entradas': ['produtos', 'cores', 'produto_cores'],
        'saidas': ['produtos', 'cores', 'produto_cores']
    }
    
    # Determinar quais queries são necessárias (incluindo dependências recursivas)
    queries_necessarias = set(relatorios_processar)
    
    # Adicionar dependências diretas
    for relatorio in relatorios_processar:
        if relatorio in dependencias:
            queries_necessarias.update(dependencias[relatorio])
    
    # Adicionar dependências indiretas (recursivamente)
    # Ex: se 'estoque' precisa de 'produtos', e 'produtos' precisa de 'produtos_barra',
    # então 'estoque' também precisa de 'produtos_barra'
    mudou = True
    while mudou:
        mudou = False
        novas_deps = set()
        for item in queries_necessarias:
            if item in dependencias:
                for dep in dependencias[item]:
                    if dep not in queries_necessarias:
                        novas_deps.add(dep)
                        mudou = True
        queries_necessarias.update(novas_deps)
    
    # Debug: mostrar queries necessárias (apenas em caso de erro)
    # print(f"\n[DEBUG] Relatórios a processar: {relatorios_processar}")
    # print(f"[DEBUG] Queries necessárias: {sorted(queries_necessarias)}")
    
    # Queries otimizadas
    queries = {
        'produtos': "SELECT * FROM PRODUTOS",
        'estoque': "SELECT * FROM ESTOQUE_PRODUTOS",
        'produtos_barra': """
            WITH Codigos AS (
                SELECT
                    LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
                    LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO,
                    TAMANHO,
                    LTRIM(RTRIM(GRADE)) AS TAMANHO_GRADE,
                    LTRIM(RTRIM(CODIGO_BARRA)) AS CODIGO_BARRA,
                    ROW_NUMBER() OVER (
                        PARTITION BY PRODUTO, COR_PRODUTO, TAMANHO
                        ORDER BY
                            CASE
                                WHEN LTRIM(RTRIM(CAST(TIPO_COD_BAR AS VARCHAR(10)))) = '3' THEN 0
                                WHEN LEN(LTRIM(RTRIM(CODIGO_BARRA))) <= 8 THEN 1
                                WHEN LTRIM(RTRIM(CAST(TIPO_COD_BAR AS VARCHAR(10)))) = '1' THEN 2
                                ELSE 3
                            END,
                            DATA_PARA_TRANSFERENCIA DESC,
                            CODIGO_BARRA
                    ) AS RN
                FROM PRODUTOS_BARRA WITH (NOLOCK)
                WHERE ISNULL(INATIVO, 0) = 0
                    AND CODIGO_BARRA IS NOT NULL
            )
            SELECT PRODUTO, COR_PRODUTO, TAMANHO, TAMANHO_GRADE, CODIGO_BARRA
            FROM Codigos
            WHERE RN = 1
        """,
        'produto_cores': """
            SELECT
                LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
                LTRIM(RTRIM(COR_PRODUTO)) AS COR_PRODUTO,
                LTRIM(RTRIM(DESC_COR_PRODUTO)) AS DESC_COR_PRODUTO
            FROM PRODUTO_CORES WITH (NOLOCK)
            WHERE DESC_COR_PRODUTO IS NOT NULL
        """,
        'vendas': """
            WITH VendasBase AS (
                SELECT 
                    vp.TICKET,
                    vp.CODIGO_FILIAL,
                    vp.DATA_VENDA,
                    vp.PRODUTO,
                    vp.COR_PRODUTO,
                    vp.TAMANHO,
                    vp.QTDE,
                    vp.QTDE_CANCELADA,
                    vp.PRECO_LIQUIDO,
                    vp.DESCONTO_ITEM,
                    vp.CUSTO,
                    vp.FATOR_VENDA_LIQ,
                    f.FILIAL,
                    v.VENDEDOR,
                    (vp.QTDE * vp.PRECO_LIQUIDO * vp.FATOR_DESCONTO_VENDA) AS DESCONTO_VENDA,
                    v.VALOR_TIKET,
                    v.VALOR_VENDA_BRUTA,
                    v.CODIGO_TAB_PRECO,
                    v.CODIGO_DESCONTO,
                    v.OPERACAO_VENDA,
                    v.DATA_HORA_CANCELAMENTO,
                    p.DESC_PRODUTO,
                    p.GRUPO_PRODUTO,
                    p.SUBGRUPO_PRODUTO,
                    p.LINHA,
                    p.COLECAO,
                    p.GRIFFE,
                    p.GRADE,
                    c.DESC_COR AS DESC_COR_PRODUTO,
                    lv.VENDEDOR_APELIDO
                FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
                INNER JOIN LOJA_VENDA v WITH (NOLOCK)
                    ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL 
                    AND v.TICKET = vp.TICKET
                LEFT JOIN FILIAIS f WITH (NOLOCK)
                    ON f.COD_FILIAL = vp.CODIGO_FILIAL
                LEFT JOIN PRODUTOS p WITH (NOLOCK) 
                    ON p.PRODUTO = vp.PRODUTO
                LEFT JOIN CORES_BASICAS c WITH (NOLOCK) 
                    ON c.COR = vp.COR_PRODUTO
                LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
                    ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
                WHERE vp.DATA_VENDA >= '2024-01-01'
            ),
            TrocasItem AS (
                SELECT 
                    vt.TICKET,
                    vt.CODIGO_FILIAL,
                    vt.PRODUTO,
                    vt.COR_PRODUTO,
                    vt.TAMANHO,
                    SUM(vt.QTDE) AS QTDE_TROCA,
                    SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
                FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
                WHERE vt.QTDE_CANCELADA = 0
                GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO, vt.TAMANHO
            ),
            TrocasPuras AS (
                -- Trocas que não têm venda correspondente (trocas avulsas/devoluções puras)
                SELECT 
                    vt.TICKET,
                    vt.CODIGO_FILIAL,
                    v.DATA_VENDA,
                    vt.PRODUTO,
                    vt.COR_PRODUTO,
                    vt.TAMANHO,
                    0 AS QTDE,
                    0 AS QTDE_CANCELADA,
                    vt.PRECO_LIQUIDO,
                    vt.DESCONTO_ITEM,
                    vt.CUSTO,
                    NULL AS FATOR_VENDA_LIQ,
                    f.FILIAL,
                    v.VENDEDOR,
                    0 AS DESCONTO_VENDA,
                    v.VALOR_TIKET,
                    v.VALOR_VENDA_BRUTA,
                    v.CODIGO_TAB_PRECO,
                    v.CODIGO_DESCONTO,
                    v.OPERACAO_VENDA,
                    v.DATA_HORA_CANCELAMENTO,
                    p.DESC_PRODUTO,
                    p.GRUPO_PRODUTO,
                    p.SUBGRUPO_PRODUTO,
                    p.LINHA,
                    p.COLECAO,
                    p.GRIFFE,
                    p.GRADE,
                    c.DESC_COR AS DESC_COR_PRODUTO,
                    lv.VENDEDOR_APELIDO,
                    vt.QTDE AS QTDE_TROCA_ITEM,
                    (vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA_ITEM
                FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
                INNER JOIN LOJA_VENDA v WITH (NOLOCK)
                    ON v.CODIGO_FILIAL = vt.CODIGO_FILIAL 
                    AND v.TICKET = vt.TICKET
                LEFT JOIN FILIAIS f WITH (NOLOCK)
                    ON f.COD_FILIAL = vt.CODIGO_FILIAL
                LEFT JOIN PRODUTOS p WITH (NOLOCK) 
                    ON p.PRODUTO = vt.PRODUTO
                LEFT JOIN CORES_BASICAS c WITH (NOLOCK) 
                    ON c.COR = vt.COR_PRODUTO
                LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
                    ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
                WHERE vt.QTDE_CANCELADA = 0
                    AND v.DATA_VENDA >= '2024-01-01'
                    AND NOT EXISTS (
                        SELECT 1 
                        FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
                        WHERE vp.TICKET = vt.TICKET
                            AND vp.CODIGO_FILIAL = vt.CODIGO_FILIAL
                            AND vp.PRODUTO = vt.PRODUTO
                            AND ISNULL(vp.COR_PRODUTO, '') = ISNULL(vt.COR_PRODUTO, '')
                            AND ISNULL(vp.TAMANHO, 0) = ISNULL(vt.TAMANHO, 0)
                    )
            ),
            VendasComNumero AS (
                SELECT 
                    vb.*,
                    ROW_NUMBER() OVER (
                        PARTITION BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
                        ORDER BY vb.TICKET, vb.CODIGO_FILIAL, vb.PRODUTO, vb.COR_PRODUTO, vb.TAMANHO
                    ) AS RN
                FROM VendasBase vb
            )
            SELECT 
                vb.FILIAL,
                vb.DATA_VENDA,
                vb.PRODUTO,
                vb.DESC_PRODUTO,
                vb.COR_PRODUTO,
                vb.DESC_COR_PRODUTO,
                vb.TAMANHO,
                vb.GRADE,
                vb.TICKET,
                vb.CODIGO_FILIAL,
                vb.QTDE,
                vb.QTDE_CANCELADA,
                vb.PRECO_LIQUIDO,
                vb.DESCONTO_ITEM,
                vb.DESCONTO_VENDA,
                vb.FATOR_VENDA_LIQ,
                vb.CUSTO,
                vb.GRUPO_PRODUTO,
                vb.SUBGRUPO_PRODUTO,
                vb.LINHA,
                vb.COLECAO,
                vb.GRIFFE,
                vb.VENDEDOR,
                vb.VALOR_TIKET,
                vb.DESCONTO_VENDA AS DESCONTO,
                vb.VALOR_VENDA_BRUTA,
                vb.CODIGO_TAB_PRECO,
                vb.CODIGO_DESCONTO,
                vb.OPERACAO_VENDA,
                vb.DATA_HORA_CANCELAMENTO,
                ISNULL(vb.VENDEDOR_APELIDO, vb.VENDEDOR) AS VENDEDOR_APELIDO,
                CASE WHEN vb.RN = 1 THEN ISNULL(ti.QTDE_TROCA, 0) ELSE 0 END AS QTDE_TROCA_ITEM,
                CASE WHEN vb.RN = 1 THEN ISNULL(ti.VALOR_TROCA, 0) ELSE 0 END AS VALOR_TROCA_ITEM,
                0 AS QTDE_TROCA_TICKET,
                0 AS VALOR_TROCA_TICKET
            FROM VendasComNumero vb
            LEFT JOIN TrocasItem ti ON ti.TICKET = vb.TICKET 
                AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
                AND ti.PRODUTO = vb.PRODUTO
                AND ISNULL(ti.COR_PRODUTO, '') = ISNULL(vb.COR_PRODUTO, '')
                AND ISNULL(ti.TAMANHO, 0) = ISNULL(vb.TAMANHO, 0)
            
            UNION ALL
            
            SELECT 
                tp.FILIAL,
                tp.DATA_VENDA,
                tp.PRODUTO,
                tp.DESC_PRODUTO,
                tp.COR_PRODUTO,
                tp.DESC_COR_PRODUTO,
                tp.TAMANHO,
                tp.GRADE,
                tp.TICKET,
                tp.CODIGO_FILIAL,
                tp.QTDE,
                tp.QTDE_CANCELADA,
                tp.PRECO_LIQUIDO,
                tp.DESCONTO_ITEM,
                tp.DESCONTO_VENDA,
                tp.FATOR_VENDA_LIQ,
                tp.CUSTO,
                tp.GRUPO_PRODUTO,
                tp.SUBGRUPO_PRODUTO,
                tp.LINHA,
                tp.COLECAO,
                tp.GRIFFE,
                tp.VENDEDOR,
                tp.VALOR_TIKET,
                tp.DESCONTO_VENDA AS DESCONTO,
                tp.VALOR_VENDA_BRUTA,
                tp.CODIGO_TAB_PRECO,
                tp.CODIGO_DESCONTO,
                tp.OPERACAO_VENDA,
                tp.DATA_HORA_CANCELAMENTO,
                ISNULL(tp.VENDEDOR_APELIDO, tp.VENDEDOR) AS VENDEDOR_APELIDO,
                tp.QTDE_TROCA_ITEM,
                tp.VALOR_TROCA_ITEM,
                0 AS QTDE_TROCA_TICKET,
                0 AS VALOR_TROCA_TICKET
            FROM TrocasPuras tp
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
                   p.ESTILISTA, p.MODELISTA, fp.DESC_COLECAO, fp.UF
    FROM FATURAMENTO f WITH(NOLOCK)
    JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK)
        ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
            LEFT JOIN PRODUTOS p WITH(NOLOCK) ON fp.PRODUTO = p.PRODUTO
            WHERE f.EMISSAO >= '2025-01-01' AND f.NOTA_CANCELADA = 0
      AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
        """,
        'entradas': f"""
            SELECT E.ROMANEIO_PRODUTO, E.EMISSAO, E.FILIAL, P.PRODUTO,
                   P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL,
                   {SELECT_GRADE_ENTRADAS},
                   E.TIPO_ENTRADA, E.TIPO_ROMANEIO
            FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
            LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) 
                ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
            WHERE E.EMISSAO >= '2025-01-01'
                AND P.PRODUTO IS NOT NULL
        """,
        'saidas': f"""
            SELECT S.ROMANEIO_PRODUTO, S.EMISSAO, S.FILIAL, S.FILIAL_DESTINO,
                   P.PRODUTO, P.COR_PRODUTO, P.QTDE AS QTDE_TOTAL,
                   {SELECT_GRADE_SAIDAS},
                   S.TIPO_ROMANEIO
            FROM ESTOQUE_PROD_SAI AS S WITH (NOLOCK)
            LEFT JOIN ESTOQUE_PROD1_SAI AS P WITH (NOLOCK) 
                ON S.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
                AND S.FILIAL = P.FILIAL
            WHERE S.EMISSAO >= '2025-01-01'
                AND P.PRODUTO IS NOT NULL
        """,
        'cores': "SELECT COR, DESC_COR FROM CORES_BASICAS",
        'filiais': "SELECT COD_FILIAL, FILIAL FROM FILIAIS WITH (NOLOCK)"
    }
    
    # Incluir filiais na extração quando for filtrar vendas/estoque/ecommerce/entradas/saidas
    if any(r in relatorios_processar for r in ['vendas', 'estoque', 'ecommerce', 'entradas', 'saidas']):
        queries_necessarias.add('filiais')
    
    conn = None
    try:
        conn = conectar_banco()
        print("\n[EXTRAÇÃO]")
        t_ext = time.time()
        
        # Extrai apenas os dados necessários
        dfs = {}
        nomes_amigaveis = {
            'produtos': 'Produtos',
            'estoque': 'Estoque',
            'vendas': 'Vendas',
            'ecommerce': 'E-commerce',
            'entradas': 'Entradas',
            'saidas': 'Saídas',
            'produtos_barra': 'Códigos de Barra',
            'produto_cores': 'Produto Cores',
            'cores': 'Cores',
            'filiais': 'Filiais'
        }
        
        for nome in queries_necessarias:
            if nome in queries:
                nome_display = nomes_amigaveis.get(nome, nome)
                print(f"⏳ Extraindo {nome_display}...", end=' ', flush=True)
                t_query = time.time()
                try:
                    dfs[nome] = pd.read_sql(queries[nome], conn)
                    tempo_query = time.time() - t_query
                    print(f"✓ {len(dfs[nome]):,} registros ({tempo_query:.1f}s)")
                except Exception as e:
                    print(f"✗ Erro: {e}")
                    # Não adicionar ao dfs se falhou, para que a verificação posterior detecte
                    raise
            else:
                print(f"⚠ Aviso: Query '{nome}' não encontrada no dicionário de queries")
                # Criar DataFrame vazio para evitar KeyError, mas a verificação posterior detectará
                dfs[nome] = pd.DataFrame()
        
        print(f"\n✓ Extração concluída: {time.time()-t_ext:.2f}s")
        
        # Conjunto de nomes/códigos de filiais consideradas (normalizado), sempre com base na tabela FILIAIS.
        consideradas_norm = set()
        cod_filiais_considerados = set()
        if 'filiais' in dfs and not dfs['filiais'].empty:
            df_f = dfs['filiais']
            filial_norm = df_f['FILIAL'].astype(str).str.replace('\xa0', ' ', regex=False).str.strip()
            consideradas_norm = set(filial_norm.dropna())
            cod_filiais_considerados = set(pd.to_numeric(df_f['COD_FILIAL'], errors='coerce').dropna().astype(int))
        
        # Filtrar por filiais consideradas (vendas, ecommerce, entradas, saidas). Estoque: trazer TUDO.
        for nome in ['vendas', 'ecommerce', 'entradas', 'saidas']:
            if nome not in dfs or dfs[nome].empty:
                continue
            df = dfs[nome]
            antes = len(df)
            if nome == 'vendas' and 'CODIGO_FILIAL' in df.columns and cod_filiais_considerados:
                cod_v = pd.to_numeric(df['CODIGO_FILIAL'], errors='coerce').fillna(-999).astype(int)
                dfs[nome] = df[cod_v.isin(cod_filiais_considerados)].copy()
            elif 'FILIAL' in df.columns:
                filial_norm = df['FILIAL'].astype(str).str.replace('\xa0', ' ', regex=False).str.strip()
                dfs[nome] = df[filial_norm.isin(consideradas_norm)].copy()
            if len(dfs[nome]) != antes:
                print(f"  Filiais consideradas: {len(dfs[nome]):,} registros de {nome} (antes: {antes:,})")
        
        # Verificar se todas as dependências necessárias foram extraídas
        chaves_faltando = []
        
        # Verificar se os próprios relatórios foram extraídos
        for relatorio in relatorios_processar:
            if relatorio not in dfs:
                chaves_faltando.append(f"Relatório principal '{relatorio}' não foi extraído")
        
        # Verificar dependências de cada relatório
        for relatorio in relatorios_processar:
            if relatorio in dependencias:
                for dep in dependencias[relatorio]:
                    if dep not in dfs:
                        chaves_faltando.append(f"Dependência '{dep}' de '{relatorio}' não foi extraída")
        
        # Verificar também se há relatórios que são dependências de outros
        # (ex: 'produtos' pode ser necessário para 'estoque', 'entradas', 'saidas')
        for relatorio in relatorios_processar:
            if relatorio in dependencias:
                for dep in dependencias[relatorio]:
                    if dep not in dfs:
                        chaves_faltando.append(f"Dependência '{dep}' necessária para '{relatorio}' não foi extraída")
        
        if chaves_faltando:
            print(f"\n✗ ERRO: Dados faltando após extração:")
            for chave in chaves_faltando:
                print(f"   • {chave}")
            print(f"\n📋 Chaves disponíveis em dfs: {list(dfs.keys())}")
            print(f"📋 Queries necessárias: {sorted(queries_necessarias)}")
            print("\n✗ Não é possível continuar o processamento.")
            return

        atualizar_desc_cor_por_produto(dfs.get('produto_cores'))

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
        # Verificar se todas as dependências estão disponíveis
        if 'produtos' not in dfs:
            print(f"\n✗ ERRO: DataFrame 'produtos' não encontrado em dfs")
            print(f"   Chaves disponíveis: {list(dfs.keys())}")
            return
        if 'produtos_barra' not in dfs:
            print(f"\n✗ ERRO: DataFrame 'produtos_barra' não encontrado em dfs (dependência necessária)")
            print(f"   Chaves disponíveis: {list(dfs.keys())}")
            print(f"   Queries necessárias calculadas: {sorted(queries_necessarias)}")
            return
        df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=True)
    elif 'produtos' in queries_necessarias:
        # Processar em memória sem salvar (é dependência de outro relatório)
        if 'produtos' not in dfs:
            print(f"\n✗ ERRO: DataFrame 'produtos' não encontrado em dfs (dependência necessária)")
            print(f"   Chaves disponíveis: {list(dfs.keys())}")
            return
        if 'produtos_barra' not in dfs:
            print(f"\n✗ ERRO: DataFrame 'produtos_barra' não encontrado em dfs (dependência necessária)")
            print(f"   Chaves disponíveis: {list(dfs.keys())}")
            print(f"   Queries necessárias calculadas: {sorted(queries_necessarias)}")
            return
        df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
    
    if 'estoque' in relatorios_processar:
        if df_produtos is None:
            # Se produtos não foi processado mas é necessário, processar agora (sem salvar)
            df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
        processar_estoque(dfs['estoque'], df_produtos, dfs['produtos_barra'])
    
    if 'vendas' in relatorios_processar:
        processar_vendas(dfs['vendas'], dfs['produtos_barra'])
    
    if 'ecommerce' in relatorios_processar:
        processar_ecommerce(dfs['ecommerce'], dfs['produtos_barra'])
    
    if 'entradas' in relatorios_processar:
        if df_produtos is None:
            # Se produtos não foi processado mas é necessário, processar agora (sem salvar)
            df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
        # Preferir mapeamento de cores atualizado (cores_limpo/vendas) sobre CORES_BASICAS
        df_cores_entradas = get_df_cores()
        processar_entradas(dfs['entradas'], df_produtos, df_cores_entradas if not df_cores_entradas.empty else dfs['cores'], dfs['produtos_barra'])
    
    if 'saidas' in relatorios_processar:
        if df_produtos is None:
            # Se produtos não foi processado mas é necessário, processar agora (sem salvar)
            df_produtos = processar_produtos(dfs['produtos'], dfs['produtos_barra'], salvar=False)
        df_cores_saidas = get_df_cores()
        processar_saidas(dfs['saidas'], df_produtos, df_cores_saidas if not df_cores_saidas.empty else dfs['cores'], dfs['produtos_barra'])
    
    print(f"\nProcessamento: {time.time()-t_proc:.2f}s")
    
    # Cópia
    copiar_arquivos(relatorios_processar)
    
    print("\n" + "="*60)
    t_total_final = time.time() - t_total
    print(f"CONCLUÍDO! Tempo total: {formatar_tempo_execucao(t_total_final)}")
    print("="*60)
    
    # Notificação visual (popup)
    try:
        import ctypes
        relatorios_str = ", ".join(nomes) if 'nomes' in locals() else "Todos"
        ctypes.windll.user32.MessageBoxW(
            0, 
            f"Exportação concluída com sucesso!\n\nRelatórios: {relatorios_str}\nTempo total: {formatar_tempo_execucao(t_total_final)}", 
            "✅ Exportador de Relatórios", 
            0x40 | 0x1000  # MB_ICONINFORMATION | MB_SYSTEMMODAL
        )
    except:
        pass

if __name__ == '__main__':
    main()

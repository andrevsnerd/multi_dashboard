#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para analisar visualmente como ficaria uma transferência nas tabelas
Mostra estado ANTES e DEPOIS da transferência
"""

import pyodbc
import pandas as pd
from datetime import datetime

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao SQL Server"""
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
    for nome, servidor in servidores:
        try:
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};"
                       f"DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};"
                       f"PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            return conn
        except Exception as e:
            if nome == 'principal':
                continue
            return None
    return None

def analisar_transferencia():
    """Analisa a transferência do teste"""
    
    # Dados do teste
    produto = 'N4.A5.0012'
    cor = 'K9'
    filial_origem = 'NERD CENTER NORTE'
    filial_destino = 'NERD HIGIENOPOLIS'
    qtde_saida = 1
    qtde_entrada = 1
    romaneio_saida = '028964'
    romaneio_entrada = 'T028964'
    data_transferencia = '2026-01-27 14:56:37'
    
    print("="*100)
    print("ANALISE VISUAL DA TRANSFERENCIA DE TESTE")
    print("="*100)
    print(f"\nProduto: {produto}")
    print(f"Cor: {cor}")
    print(f"Origem: {filial_origem} -> Destino: {filial_destino}")
    print(f"Quantidade: {qtde_saida} unidade(s)")
    print(f"Romaneio Saida: {romaneio_saida}")
    print(f"Romaneio Entrada: {romaneio_entrada}")
    
    conn = conectar_banco()
    if not conn:
        print("\n[ERRO] Nao foi possivel conectar ao banco")
        return
    
    try:
        # 1. ESTOQUE ANTES
        print("\n" + "="*100)
        print("1. ESTOQUE ATUAL (ANTES DA TRANSFERENCIA)")
        print("="*100)
        
        query_estoque = """
            SELECT 
                e.FILIAL,
                e.COR_PRODUTO,
                e.ESTOQUE,
                f.FILIAL AS NOME_FILIAL
            FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
            LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = e.FILIAL
            WHERE e.PRODUTO = ?
                AND e.COR_PRODUTO = ?
                AND (f.FILIAL = ? OR f.FILIAL = ?)
            ORDER BY f.FILIAL
        """
        
        df_estoque_antes = pd.read_sql(query_estoque, conn, params=[produto, cor, filial_origem, filial_destino])
        
        print("\n" + "-"*100)
        print(f"{'FILIAL':<40} {'COR':<10} {'ESTOQUE ATUAL':<15}")
        print("-"*100)
        
        estoque_origem_antes = 0
        estoque_destino_antes = 0
        
        for _, row in df_estoque_antes.iterrows():
            filial_nome = str(row['NOME_FILIAL']) if pd.notna(row['NOME_FILIAL']) else str(row['FILIAL'])
            estoque = int(row['ESTOQUE'])
            print(f"{filial_nome:<40} {cor:<10} {estoque:<15}")
            
            if filial_nome == filial_origem:
                estoque_origem_antes = estoque
            elif filial_nome == filial_destino:
                estoque_destino_antes = estoque
        
        # 2. ROMANEIOS EXISTENTES (verificar se já existem)
        print("\n" + "="*100)
        print("2. VERIFICACAO DE ROMANEIOS (se ja existem)")
        print("="*100)
        
        query_romaneio_sai = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO = ?
        """
        
        query_romaneio_ent = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO = ?
        """
        
        df_sai = pd.read_sql(query_romaneio_sai, conn, params=[romaneio_saida])
        df_ent = pd.read_sql(query_romaneio_ent, conn, params=[romaneio_entrada])
        
        existe_sai = df_sai.iloc[0]['TOTAL'] > 0
        existe_ent = df_ent.iloc[0]['TOTAL'] > 0
        
        print(f"\nRomaneio Saida '{romaneio_saida}': {'[JA EXISTE!]' if existe_sai else '[NAO EXISTE - OK]'}")
        print(f"Romaneio Entrada '{romaneio_entrada}': {'[JA EXISTE!]' if existe_ent else '[NAO EXISTE - OK]'}")
        
        if existe_sai or existe_ent:
            print("\n[ATENCAO] Os romaneios ja existem! Isso pode causar duplicacao.")
        
        # 3. ESTOQUE DEPOIS (simulado)
        print("\n" + "="*100)
        print("3. ESTOQUE APOS TRANSFERENCIA (SIMULADO)")
        print("="*100)
        
        estoque_origem_depois = estoque_origem_antes - qtde_saida
        estoque_destino_depois = estoque_destino_antes + qtde_entrada
        
        print("\n" + "-"*100)
        print(f"{'FILIAL':<40} {'ESTOQUE ANTES':<20} {'MOVIMENTO':<20} {'ESTOQUE DEPOIS':<20}")
        print("-"*100)
        print(f"{filial_origem:<40} {estoque_origem_antes:<20} -{qtde_saida:<19} {estoque_origem_depois:<20}")
        print(f"{filial_destino:<40} {estoque_destino_antes:<20} +{qtde_entrada:<19} {estoque_destino_depois:<20}")
        print("-"*100)
        
        # 4. TABELAS QUE SERIAM CRIADAS
        print("\n" + "="*100)
        print("4. REGISTROS QUE SERIAM INSERIDOS NAS TABELAS")
        print("="*100)
        
        print("\n" + "-"*100)
        print("TABELA: ESTOQUE_PROD_SAI (Cabeçalho Saída)")
        print("-"*100)
        print(f"ROMANEIO_PRODUTO: {romaneio_saida}")
        print(f"FILIAL: {filial_origem}")
        print(f"EMISSAO: {data_transferencia}")
        print(f"FILIAL_DESTINO: {filial_destino}")
        print(f"ROMANEIO_DESTINO: {romaneio_entrada}")
        print(f"DATA_PARA_TRANSFERENCIA: {data_transferencia}")
        
        print("\n" + "-"*100)
        print("TABELA: ESTOQUE_PROD1_SAI (Item Saída)")
        print("-"*100)
        print(f"FILIAL: {filial_origem}")
        print(f"ROMANEIO_PRODUTO: {romaneio_saida}")
        print(f"PRODUTO: {produto}")
        print(f"COR_PRODUTO: {cor}")
        print(f"QTDE: {qtde_saida}")
        
        print("\n" + "-"*100)
        print("TABELA: ESTOQUE_PROD_ENT (Cabeçalho Entrada)")
        print("-"*100)
        print(f"ROMANEIO_PRODUTO: {romaneio_entrada}")
        print(f"FILIAL: {filial_destino}")
        print(f"EMISSAO: {data_transferencia}")
        print(f"FILIAL_ORIGEM: {filial_origem}")
        print(f"ROMANEIO_ORIGEM: {romaneio_saida}")
        print(f"DATA_PARA_TRANSFERENCIA: {data_transferencia}")
        
        print("\n" + "-"*100)
        print("TABELA: ESTOQUE_PROD1_ENT (Item Entrada)")
        print("-"*100)
        print(f"ROMANEIO_PRODUTO: {romaneio_entrada}")
        print(f"PRODUTO: {produto}")
        print(f"FILIAL: {filial_destino}")
        print(f"COR_PRODUTO: {cor}")
        print(f"QTDE: {qtde_entrada}")
        
        # 5. VALIDAÇÕES
        print("\n" + "="*100)
        print("5. VALIDACOES E POSSIVEIS PROBLEMAS")
        print("="*100)
        
        problemas = []
        avisos = []
        
        # Verificar se estoque origem tem quantidade suficiente
        if estoque_origem_antes < qtde_saida:
            problemas.append(f"ESTOQUE INSUFICIENTE: {filial_origem} tem apenas {estoque_origem_antes} unidades, mas precisa retirar {qtde_saida}")
        else:
            print(f"[OK] Estoque origem suficiente: {estoque_origem_antes} >= {qtde_saida}")
        
        # Verificar se quantidades são iguais
        if qtde_saida != qtde_entrada:
            avisos.append(f"QUANTIDADES DIFERENTES: Saida={qtde_saida}, Entrada={qtde_entrada}")
        else:
            print(f"[OK] Quantidades iguais: {qtde_saida} = {qtde_entrada}")
        
        # Verificar relacionamento entre romaneios
        if romaneio_entrada != f'T{romaneio_saida}':
            problemas.append(f"ROMANEIO ENTRADA INCORRETO: Esperado 'T{romaneio_saida}', mas foi '{romaneio_entrada}'")
        else:
            print(f"[OK] Relacionamento de romaneios correto: {romaneio_entrada} = T{romaneio_saida}")
        
        # Verificar se romaneios já existem
        if existe_sai:
            problemas.append(f"ROMANEIO SAIDA JA EXISTE: {romaneio_saida}")
        if existe_ent:
            problemas.append(f"ROMANEIO ENTRADA JA EXISTE: {romaneio_entrada}")
        
        # Verificar se filiais são diferentes
        if filial_origem == filial_destino:
            problemas.append("FILIAIS IGUAIS: Origem e destino nao podem ser iguais")
        else:
            print(f"[OK] Filiais diferentes: {filial_origem} != {filial_destino}")
        
        # Mostrar problemas e avisos
        if problemas:
            print("\n[PROBLEMAS ENCONTRADOS]:")
            for i, problema in enumerate(problemas, 1):
                print(f"  {i}. {problema}")
        
        if avisos:
            print("\n[AVISOS]:")
            for i, aviso in enumerate(avisos, 1):
                print(f"  {i}. {aviso}")
        
        if not problemas and not avisos:
            print("\n[OK] Nenhum problema encontrado! A transferencia esta correta.")
        
        # 6. RESUMO FINAL
        print("\n" + "="*100)
        print("6. RESUMO FINAL")
        print("="*100)
        
        print(f"\nTransferencia: {filial_origem} -> {filial_destino}")
        print(f"Produto: {produto} (Cor: {cor})")
        print(f"Quantidade: {qtde_saida} unidade(s)")
        print(f"\nEstoque Origem: {estoque_origem_antes} -> {estoque_origem_depois} ({'-' if estoque_origem_depois < estoque_origem_antes else '+'}{abs(estoque_origem_depois - estoque_origem_antes)})")
        print(f"Estoque Destino: {estoque_destino_antes} -> {estoque_destino_depois} ({'-' if estoque_destino_depois < estoque_destino_antes else '+'}{abs(estoque_destino_depois - estoque_destino_antes)})")
        print(f"\nRomaneios:")
        print(f"  Saida: {romaneio_saida}")
        print(f"  Entrada: {romaneio_entrada}")
        
        print("\n" + "="*100)
        print("CONCLUSAO")
        print("="*100)
        
        if problemas:
            print("\n[ERRO] A transferencia tem problemas e NAO deve ser executada!")
            print("       Corrija os problemas antes de executar.")
        elif avisos:
            print("\n[ATENCAO] A transferencia pode ser executada, mas ha avisos.")
            print("          Revise os avisos antes de executar.")
        else:
            print("\n[OK] A transferencia esta CORRETA e pode ser executada!")
            print("     Todos os dados estao validados e prontos para insercao.")
        
    except Exception as e:
        print(f"\n[ERRO] Erro durante analise: {e}")
        import traceback
        traceback.print_exc()
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    analisar_transferencia()

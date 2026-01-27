#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para verificar se há registros incompletos de transferências
Especificamente verifica a transferência com romaneio 028964
"""

import sys
import codecs
import pyodbc
import pandas as pd
from datetime import datetime, timedelta

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')

# Config conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

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
            conn.timeout = 300
            if nome == 'fallback':
                print(f"✓ Conectado via servidor fallback ({servidor})")
            else:
                print(f"✓ Conectado ao servidor principal ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexão: Falha em todos os servidores. Último erro: {ultimo_erro}")
    return None

def verificar_romaneio(conn, romaneio_saida: str, produto: str, filial_origem: str, filial_destino: str):
    """Verifica se todos os registros de uma transferência foram criados corretamente"""
    print("\n" + "="*100)
    print(f"VERIFICANDO TRANSFERÊNCIA - ROMANEIO SAÍDA: {romaneio_saida}")
    print("="*100)
    
    resultados = {
        'saida_estoque_prod_sai': False,
        'saida_estoque_prod1_sai': False,
        'loja_saidas': False,
        'loja_saidas_produto': False,
        'entrada_estoque_prod_ent': False,
        'entrada_estoque_prod1_ent': False,
        'loja_entradas': False,
        'estoque_atualizado_origem': None,
        'estoque_atualizado_destino': None
    }
    
    cursor = conn.cursor()
    
    # 1. Verificar ESTOQUE_PROD_SAI
    query_saida_cab = """
        SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_DESTINO, EMISSAO, ROMANEIO_DESTINO
        FROM ESTOQUE_PROD_SAI
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    cursor.execute(query_saida_cab, [romaneio_saida, filial_origem])
    row_saida_cab = cursor.fetchone()
    if row_saida_cab:
        resultados['saida_estoque_prod_sai'] = True
        print(f"✓ ESTOQUE_PROD_SAI encontrado:")
        print(f"   Romaneio: {row_saida_cab[0]}")
        print(f"   Filial: {row_saida_cab[1]}")
        print(f"   Filial Destino: {row_saida_cab[2]}")
        print(f"   Emissão: {row_saida_cab[3]}")
        print(f"   Romaneio Destino: {row_saida_cab[4]}")
    else:
        print(f"✗ ESTOQUE_PROD_SAI NÃO encontrado")
    
    # 2. Verificar ESTOQUE_PROD1_SAI
    query_saida_item = """
        SELECT ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE
        FROM ESTOQUE_PROD1_SAI
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ? AND PRODUTO = ?
    """
    cursor.execute(query_saida_item, [romaneio_saida, filial_origem, produto])
    row_saida_item = cursor.fetchone()
    if row_saida_item:
        resultados['saida_estoque_prod1_sai'] = True
        print(f"✓ ESTOQUE_PROD1_SAI encontrado:")
        print(f"   Romaneio: {row_saida_item[0]}")
        print(f"   Produto: {row_saida_item[1]}")
        print(f"   Cor: {row_saida_item[2]}")
        print(f"   Quantidade: {row_saida_item[3]}")
    else:
        print(f"✗ ESTOQUE_PROD1_SAI NÃO encontrado")
    
    # 3. Verificar LOJA_SAIDAS
    query_loja_saidas = """
        SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_DESTINO, SAIDA_ENCERRADA, SAIDA_CANCELADA
        FROM LOJA_SAIDAS
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    cursor.execute(query_loja_saidas, [romaneio_saida, filial_origem])
    row_loja_saidas = cursor.fetchone()
    if row_loja_saidas:
        resultados['loja_saidas'] = True
        print(f"✓ LOJA_SAIDAS encontrado:")
        print(f"   Romaneio: {row_loja_saidas[0]}")
        print(f"   Filial: {row_loja_saidas[1]}")
        print(f"   Filial Destino: {row_loja_saidas[2]}")
        print(f"   Saída Encerrada: {row_loja_saidas[3]}")
        print(f"   Saída Cancelada: {row_loja_saidas[4]}")
    else:
        print(f"✗ LOJA_SAIDAS NÃO encontrado")
    
    # 4. Verificar LOJA_SAIDAS_PRODUTO
    query_loja_saidas_produto = """
        SELECT ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE_SAIDA
        FROM LOJA_SAIDAS_PRODUTO
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ? AND PRODUTO = ?
    """
    cursor.execute(query_loja_saidas_produto, [romaneio_saida, filial_origem, produto])
    row_loja_saidas_produto = cursor.fetchone()
    if row_loja_saidas_produto:
        resultados['loja_saidas_produto'] = True
        print(f"✓ LOJA_SAIDAS_PRODUTO encontrado:")
        print(f"   Romaneio: {row_loja_saidas_produto[0]}")
        print(f"   Produto: {row_loja_saidas_produto[1]}")
        print(f"   Cor: {row_loja_saidas_produto[2]}")
        print(f"   Quantidade: {row_loja_saidas_produto[3]}")
    else:
        print(f"✗ LOJA_SAIDAS_PRODUTO NÃO encontrado")
    
    # 5. Buscar romaneio de entrada (pode estar em ROMANEIO_DESTINO ou ROMANEIO_ORIGEM)
    romaneio_entrada = None
    if row_saida_cab and row_saida_cab[4]:  # ROMANEIO_DESTINO
        romaneio_entrada = str(row_saida_cab[4]).strip()
        print(f"\n🔍 Romaneio de entrada encontrado em ROMANEIO_DESTINO: {romaneio_entrada}")
    else:
        # Tentar buscar por ROMANEIO_ORIGEM
        query_entrada_por_origem = """
            SELECT TOP 1 ROMANEIO_PRODUTO
            FROM ESTOQUE_PROD_ENT
            WHERE FILIAL = ? AND ROMANEIO_ORIGEM = ?
            ORDER BY EMISSAO DESC
        """
        cursor.execute(query_entrada_por_origem, [filial_destino, romaneio_saida])
        row_entrada = cursor.fetchone()
        if row_entrada:
            romaneio_entrada = str(row_entrada[0]).strip()
            print(f"\n🔍 Romaneio de entrada encontrado por ROMANEIO_ORIGEM: {romaneio_entrada}")
        else:
            # Tentar buscar em LOJA_ENTRADAS
            query_entrada_loja = """
                SELECT TOP 1 ROMANEIO_PRODUTO
                FROM LOJA_ENTRADAS
                WHERE FILIAL = ? AND FILIAL_ORIGEM = ? AND EMISSAO >= DATEADD(HOUR, -2, GETDATE())
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_entrada_loja, [filial_destino, filial_origem])
            row_entrada_loja = cursor.fetchone()
            if row_entrada_loja:
                romaneio_entrada = str(row_entrada_loja[0]).strip()
                print(f"\n🔍 Romaneio de entrada encontrado em LOJA_ENTRADAS: {romaneio_entrada}")
    
    if romaneio_entrada:
        # 6. Verificar ESTOQUE_PROD_ENT
        query_entrada_cab = """
            SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_ORIGEM, ROMANEIO_ORIGEM, EMISSAO
            FROM ESTOQUE_PROD_ENT
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(query_entrada_cab, [romaneio_entrada, filial_destino])
        row_entrada_cab = cursor.fetchone()
        if row_entrada_cab:
            resultados['entrada_estoque_prod_ent'] = True
            print(f"\n✓ ESTOQUE_PROD_ENT encontrado:")
            print(f"   Romaneio: {row_entrada_cab[0]}")
            print(f"   Filial: {row_entrada_cab[1]}")
            print(f"   Filial Origem: {row_entrada_cab[2]}")
            print(f"   Romaneio Origem: {row_entrada_cab[3]}")
            print(f"   Emissão: {row_entrada_cab[4]}")
        else:
            print(f"\n✗ ESTOQUE_PROD_ENT NÃO encontrado para romaneio {romaneio_entrada}")
        
        # 7. Verificar ESTOQUE_PROD1_ENT
        query_entrada_item = """
            SELECT ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE
            FROM ESTOQUE_PROD1_ENT
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ? AND PRODUTO = ?
        """
        cursor.execute(query_entrada_item, [romaneio_entrada, filial_destino, produto])
        row_entrada_item = cursor.fetchone()
        if row_entrada_item:
            resultados['entrada_estoque_prod1_ent'] = True
            print(f"✓ ESTOQUE_PROD1_ENT encontrado:")
            print(f"   Romaneio: {row_entrada_item[0]}")
            print(f"   Produto: {row_entrada_item[1]}")
            print(f"   Cor: {row_entrada_item[2]}")
            print(f"   Quantidade: {row_entrada_item[3]}")
        else:
            print(f"✗ ESTOQUE_PROD1_ENT NÃO encontrado")
        
        # 8. Verificar LOJA_ENTRADAS
        query_loja_entradas = """
            SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_ORIGEM, EMISSAO
            FROM LOJA_ENTRADAS
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(query_loja_entradas, [romaneio_entrada, filial_destino])
        row_loja_entradas = cursor.fetchone()
        if row_loja_entradas:
            resultados['loja_entradas'] = True
            print(f"✓ LOJA_ENTRADAS encontrado:")
            print(f"   Romaneio: {row_loja_entradas[0]}")
            print(f"   Filial: {row_loja_entradas[1]}")
            print(f"   Filial Origem: {row_loja_entradas[2]}")
            print(f"   Emissão: {row_loja_entradas[3]}")
        else:
            print(f"✗ LOJA_ENTRADAS NÃO encontrado")
    else:
        print(f"\n⚠️  Romaneio de entrada não encontrado!")
    
    # 9. Verificar estoques atuais
    print(f"\n" + "="*100)
    print("VERIFICANDO ESTOQUES ATUAIS")
    print("="*100)
    
    # Buscar cor do produto
    query_cor = """
        SELECT DISTINCT COR_PRODUTO
        FROM ESTOQUE_PROD1_SAI
        WHERE ROMANEIO_PRODUTO = ? AND PRODUTO = ?
    """
    cursor.execute(query_cor, [romaneio_saida, produto])
    row_cor = cursor.fetchone()
    cor_produto = str(row_cor[0]).strip() if row_cor and row_cor[0] else None
    
    if cor_produto:
        query_estoque_origem = """
            SELECT ESTOQUE
            FROM ESTOQUE_PRODUTOS
            WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
        """
        cursor.execute(query_estoque_origem, [produto, filial_origem, cor_produto])
        row_estoque_origem = cursor.fetchone()
        if row_estoque_origem:
            estoque_origem_atual = int(row_estoque_origem[0]) if row_estoque_origem[0] is not None else 0
            resultados['estoque_atualizado_origem'] = estoque_origem_atual
            print(f"📊 Estoque atual ORIGEM ({filial_origem}): {estoque_origem_atual} unidades")
        
        query_estoque_destino = """
            SELECT ESTOQUE
            FROM ESTOQUE_PRODUTOS
            WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
        """
        cursor.execute(query_estoque_destino, [produto, filial_destino, cor_produto])
        row_estoque_destino = cursor.fetchone()
        if row_estoque_destino:
            estoque_destino_atual = int(row_estoque_destino[0]) if row_estoque_destino[0] is not None else 0
            resultados['estoque_atualizado_destino'] = estoque_destino_atual
            print(f"📊 Estoque atual DESTINO ({filial_destino}): {estoque_destino_atual} unidades")
        else:
            print(f"📊 Estoque atual DESTINO ({filial_destino}): NÃO EXISTE (0 unidades)")
    
    # Resumo
    print(f"\n" + "="*100)
    print("RESUMO DA VERIFICAÇÃO")
    print("="*100)
    
    registros_saida = sum([
        resultados['saida_estoque_prod_sai'],
        resultados['saida_estoque_prod1_sai'],
        resultados['loja_saidas'],
        resultados['loja_saidas_produto']
    ])
    
    registros_entrada = sum([
        resultados['entrada_estoque_prod_ent'],
        resultados['entrada_estoque_prod1_ent'],
        resultados['loja_entradas']
    ])
    
    print(f"\n📋 Registros de SAÍDA: {registros_saida}/4")
    print(f"   ✓ ESTOQUE_PROD_SAI: {'SIM' if resultados['saida_estoque_prod_sai'] else 'NÃO'}")
    print(f"   ✓ ESTOQUE_PROD1_SAI: {'SIM' if resultados['saida_estoque_prod1_sai'] else 'NÃO'}")
    print(f"   ✓ LOJA_SAIDAS: {'SIM' if resultados['loja_saidas'] else 'NÃO'}")
    print(f"   ✓ LOJA_SAIDAS_PRODUTO: {'SIM' if resultados['loja_saidas_produto'] else 'NÃO'}")
    
    print(f"\n📋 Registros de ENTRADA: {registros_entrada}/3")
    print(f"   ✓ ESTOQUE_PROD_ENT: {'SIM' if resultados['entrada_estoque_prod_ent'] else 'NÃO'}")
    print(f"   ✓ ESTOQUE_PROD1_ENT: {'SIM' if resultados['entrada_estoque_prod1_ent'] else 'NÃO'}")
    print(f"   ✓ LOJA_ENTRADAS: {'SIM' if resultados['loja_entradas'] else 'NÃO'}")
    
    print(f"\n📊 Estoque atualizado:")
    print(f"   ✓ Origem: {resultados['estoque_atualizado_origem'] if resultados['estoque_atualizado_origem'] is not None else 'NÃO VERIFICADO'}")
    print(f"   ✓ Destino: {resultados['estoque_atualizado_destino'] if resultados['estoque_atualizado_destino'] is not None else 'NÃO VERIFICADO'}")
    
    # Conclusão
    print(f"\n" + "="*100)
    print("CONCLUSÃO")
    print("="*100)
    
    if registros_saida == 4 and registros_entrada == 3:
        print("✅ Todos os registros de transferência foram criados corretamente!")
        if resultados['estoque_atualizado_origem'] is not None and resultados['estoque_atualizado_destino'] is not None:
            print("⚠️  MAS: Os estoques podem não ter sido atualizados corretamente.")
            print("   Isso significa que a transferência está registrada, mas os estoques não refletem a movimentação.")
    elif registros_saida == 4 and registros_entrada < 3:
        print("⚠️  TRANSFERÊNCIA INCOMPLETA!")
        print("   Registros de saída foram criados, mas registros de entrada estão faltando.")
        print("   Isso pode causar inconsistências no sistema.")
    elif registros_saida < 4:
        print("⚠️  TRANSFERÊNCIA PARCIALMENTE CRIADA!")
        print("   Alguns registros de saída estão faltando.")
    else:
        print("❓ Estado desconhecido da transferência.")
    
    return resultados

def main():
    """Função principal"""
    print("="*100)
    print("VERIFICADOR DE TRANSFERÊNCIAS INCOMPLETAS")
    print("="*100)
    
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Dados da transferência anterior (do log)
        romaneio_saida = "028964"
        produto = "N4.A5.0012"
        filial_origem = "NERD VILLA LOBOS"
        filial_destino = "NERD LEBLON"
        
        print(f"\n🔍 Verificando transferência:")
        print(f"   Romaneio Saída: {romaneio_saida}")
        print(f"   Produto: {produto}")
        print(f"   Origem: {filial_origem}")
        print(f"   Destino: {filial_destino}")
        
        resultados = verificar_romaneio(conn, romaneio_saida, produto, filial_origem, filial_destino)
        
        # Verificar se há outras transferências recentes incompletas
        print(f"\n" + "="*100)
        print("VERIFICANDO OUTRAS TRANSFERÊNCIAS RECENTES (ÚLTIMAS 2 HORAS)")
        print("="*100)
        
        query_recentes = """
            SELECT TOP 10 
                s.ROMANEIO_PRODUTO,
                s.FILIAL,
                s.FILIAL_DESTINO,
                s.EMISSAO,
                s.ROMANEIO_DESTINO,
                CASE WHEN e.ROMANEIO_PRODUTO IS NULL THEN 'SEM ENTRADA' ELSE 'COM ENTRADA' END AS STATUS_ENTRADA
            FROM ESTOQUE_PROD_SAI s
            LEFT JOIN ESTOQUE_PROD_ENT e ON e.ROMANEIO_ORIGEM = s.ROMANEIO_PRODUTO AND e.FILIAL = s.FILIAL_DESTINO
            WHERE s.EMISSAO >= DATEADD(HOUR, -2, GETDATE())
                AND s.FILIAL_DESTINO IS NOT NULL
            ORDER BY s.EMISSAO DESC
        """
        
        df_recentes = pd.read_sql(query_recentes, conn)
        if not df_recentes.empty:
            print(f"\n📋 Transferências recentes encontradas: {len(df_recentes)}")
            print("-"*100)
            print(f"{'ROMANEIO':<12} {'ORIGEM':<25} {'DESTINO':<25} {'ENTRADA':<15} {'EMISSÃO'}")
            print("-"*100)
            for idx, row in df_recentes.iterrows():
                print(f"{str(row['ROMANEIO_PRODUTO']):<12} {str(row['FILIAL']):<25} {str(row['FILIAL_DESTINO']):<25} {str(row['STATUS_ENTRADA']):<15} {str(row['EMISSAO'])}")
        else:
            print("\n📋 Nenhuma transferência recente encontrada.")
        
    except Exception as e:
        print(f"\n✗ Erro durante verificação: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

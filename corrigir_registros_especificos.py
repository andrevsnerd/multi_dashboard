#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para corrigir registros específicos de transferência
Preenche campos faltantes: EMPRESA, TIPO_ENTRADA, CM_OPERACAO, CM_DESC_OPERACAO
"""

import pyodbc
from typing import Optional, Tuple

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
                print(f"Conectado via servidor fallback ({servidor})")
            else:
                print(f"Conectado ao servidor principal ({servidor})")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexao com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    return None

def buscar_empresa_filial(conn, filial: str) -> Optional[int]:
    """Busca a empresa de uma filial"""
    try:
        query = """
            SELECT EMPRESA
            FROM FILIAIS WITH (NOLOCK)
            WHERE FILIAL = ?
        """
        cursor = conn.cursor()
        cursor.execute(query, [filial])
        row = cursor.fetchone()
        cursor.close()
        
        if row and row[0] is not None:
            return int(row[0])
        return None
    except Exception as e:
        print(f"⚠️  Erro ao buscar empresa da filial {filial}: {e}")
        return None

def obter_cm_desc_operacao(cm_operacao: str) -> str:
    """Retorna a descrição do CM_OPERACAO"""
    descricoes = {
        '003': 'ENTRADA DE ESTOQUE',
        '011': 'SAIDA DO ESTOQUE',
        '012': 'SAIDA DO ESTOQUE PARA TRANSFERENCIA'
    }
    return descricoes.get(cm_operacao, '')

def determinar_tipo_entrada(tipo_romaneio: str) -> str:
    """Determina TIPO_ENTRADA baseado no TIPO_ROMANEIO"""
    tipo_entrada_map = {
        'TRANSFERENCIA ENTRE LOJAS': '1',
        'TRANSFERENCIA': '1',
        'ENTRADA AVULSA': '1',
        'ENTRADA POR MOV. INTERNA': '1',
        'DEFEITO': '1'
    }
    if tipo_romaneio:
        return tipo_entrada_map.get(tipo_romaneio.upper(), '1')
    return '1'

def determinar_cm_operacao(empresa_origem: Optional[int], empresa_destino: Optional[int]) -> str:
    """Determina CM_OPERACAO baseado nas empresas"""
    if empresa_origem is None or empresa_destino is None:
        return '011'  # Padrão: empresa diferente
    
    if empresa_origem == empresa_destino:
        return '012'  # Mesma empresa
    else:
        return '011'  # Empresa diferente

def verificar_coluna_existe(conn, tabela: str, coluna: str) -> bool:
    """Verifica se uma coluna existe na tabela"""
    try:
        query = """
            SELECT COUNT(*) 
            FROM INFORMATION_SCHEMA.COLUMNS 
            WHERE TABLE_NAME = ? AND COLUMN_NAME = ?
        """
        cursor = conn.cursor()
        cursor.execute(query, [tabela, coluna])
        row = cursor.fetchone()
        cursor.close()
        return row[0] > 0 if row else False
    except:
        return False

def corrigir_saida(conn, romaneio_saida: str):
    """Corrige registro de saída"""
    cursor = conn.cursor()
    
    try:
        # Verificar quais colunas existem
        tem_empresa = verificar_coluna_existe(conn, 'ESTOQUE_PROD_SAI', 'EMPRESA')
        tem_cm_desc = verificar_coluna_existe(conn, 'ESTOQUE_PROD_SAI', 'CM_DESC_OPERACAO')
        
        # Buscar informações da saída
        colunas_select = ['FILIAL', 'FILIAL_DESTINO', 'TIPO_ROMANEIO', 'CM_OPERACAO']
        if tem_empresa:
            colunas_select.append('EMPRESA')
        
        query_buscar = f"""
            SELECT {', '.join(colunas_select)}
            FROM ESTOQUE_PROD_SAI
            WHERE ROMANEIO_PRODUTO = ?
        """
        cursor.execute(query_buscar, [romaneio_saida])
        row = cursor.fetchone()
        
        if not row:
            print(f"Saida {romaneio_saida} nao encontrada")
            return False
        
        filial = str(row[0]).strip() if row[0] else None
        filial_destino = str(row[1]).strip() if row[1] else None
        tipo_romaneio = str(row[2]).strip() if row[2] else None
        cm_operacao_atual = str(row[3]).strip() if row[3] else None
        empresa_atual = row[4] if tem_empresa and len(row) > 4 else None
        
        print(f"\nInformacoes da saida {romaneio_saida}:")
        print(f"   Filial: {filial}")
        print(f"   Filial Destino: {filial_destino}")
        print(f"   TIPO_ROMANEIO: {tipo_romaneio}")
        print(f"   CM_OPERACAO atual: {cm_operacao_atual}")
        print(f"   EMPRESA atual: {empresa_atual}")
        
        if not filial:
            print(f"Filial nao encontrada para saida {romaneio_saida}")
            return False
        
        # Buscar empresa da filial origem
        empresa_origem = None
        if tem_empresa:
            empresa_origem = buscar_empresa_filial(conn, filial)
            if empresa_origem is None:
                print(f"Nao foi possivel determinar empresa da filial origem. Usando padrao 8")
                empresa_origem = 8
        
        # Determinar CM_OPERACAO se não estiver preenchido
        empresa_destino = None
        if filial_destino:
            empresa_destino = buscar_empresa_filial(conn, filial_destino)
        
        cm_operacao = cm_operacao_atual if cm_operacao_atual else determinar_cm_operacao(empresa_origem, empresa_destino)
        cm_desc_operacao = obter_cm_desc_operacao(cm_operacao)
        
        print(f"\nValores a serem aplicados:")
        if tem_empresa:
            print(f"   EMPRESA: {empresa_origem}")
        print(f"   CM_OPERACAO: {cm_operacao}")
        if tem_cm_desc:
            print(f"   CM_DESC_OPERACAO: {cm_desc_operacao}")
        
        # Construir UPDATE dinamicamente baseado nas colunas que existem
        campos_update = []
        valores_update = []
        
        if tem_empresa and empresa_origem is not None:
            campos_update.append("EMPRESA = ?")
            valores_update.append(empresa_origem)
        
        campos_update.append("CM_OPERACAO = ?")
        valores_update.append(cm_operacao)
        
        if tem_cm_desc:
            campos_update.append("CM_DESC_OPERACAO = ?")
            valores_update.append(cm_desc_operacao)
        
        valores_update.append(romaneio_saida)
        
        query_update = f"""
            UPDATE ESTOQUE_PROD_SAI
            SET {', '.join(campos_update)}
            WHERE ROMANEIO_PRODUTO = ?
        """
        cursor.execute(query_update, valores_update)
        rows_afetadas = cursor.rowcount
        
        if rows_afetadas > 0:
            conn.commit()
            print(f"Saida {romaneio_saida} atualizada com sucesso!")
            return True
        else:
            print(f"Nenhuma linha foi atualizada para saida {romaneio_saida}")
            return False
            
    except Exception as e:
        conn.rollback()
        print(f"Erro ao corrigir saida {romaneio_saida}: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        cursor.close()

def corrigir_entrada(conn, romaneio_entrada: str):
    """Corrige registro de entrada"""
    cursor = conn.cursor()
    
    try:
        # Verificar quais colunas existem
        tem_empresa = verificar_coluna_existe(conn, 'ESTOQUE_PROD_ENT', 'EMPRESA')
        tem_cm_desc = verificar_coluna_existe(conn, 'ESTOQUE_PROD_ENT', 'CM_DESC_OPERACAO')
        tem_tipo_entrada = verificar_coluna_existe(conn, 'ESTOQUE_PROD_ENT', 'TIPO_ENTRADA')
        
        # Buscar informações da entrada
        colunas_select = ['FILIAL', 'FILIAL_ORIGEM', 'TIPO_ROMANEIO']
        if tem_tipo_entrada:
            colunas_select.append('TIPO_ENTRADA')
        if tem_empresa:
            colunas_select.append('EMPRESA')
        colunas_select.append('CM_OPERACAO')
        
        query_buscar = f"""
            SELECT {', '.join(colunas_select)}
            FROM ESTOQUE_PROD_ENT
            WHERE ROMANEIO_PRODUTO = ?
        """
        cursor.execute(query_buscar, [romaneio_entrada])
        row = cursor.fetchone()
        
        if not row:
            print(f"Entrada {romaneio_entrada} nao encontrada")
            return False
        
        filial = str(row[0]).strip() if row[0] else None
        filial_origem = str(row[1]).strip() if row[1] else None
        tipo_romaneio = str(row[2]).strip() if row[2] else None
        idx = 3
        tipo_entrada_atual = str(row[idx]).strip() if tem_tipo_entrada and len(row) > idx and row[idx] else None
        if tem_tipo_entrada:
            idx += 1
        empresa_atual = row[idx] if tem_empresa and len(row) > idx and row[idx] is not None else None
        if tem_empresa:
            idx += 1
        cm_operacao_atual = str(row[idx]).strip() if len(row) > idx and row[idx] else None
        
        print(f"\nInformacoes da entrada {romaneio_entrada}:")
        print(f"   Filial: {filial}")
        print(f"   Filial Origem: {filial_origem}")
        print(f"   TIPO_ROMANEIO: {tipo_romaneio}")
        print(f"   TIPO_ENTRADA atual: {tipo_entrada_atual}")
        print(f"   EMPRESA atual: {empresa_atual}")
        print(f"   CM_OPERACAO atual: {cm_operacao_atual}")
        
        if not filial:
            print(f"✗ Filial não encontrada para entrada {romaneio_entrada}")
            return False
        
        # Buscar empresa da filial destino
        empresa_destino = buscar_empresa_filial(conn, filial)
        if empresa_destino is None:
            print(f"⚠️  Não foi possível determinar empresa da filial destino. Usando padrão 8")
            empresa_destino = 8
        
        # CM_OPERACAO para entrada é sempre '003'
        cm_operacao_entrada = '003'
        cm_desc_operacao_entrada = obter_cm_desc_operacao(cm_operacao_entrada)
        
        # Determinar TIPO_ENTRADA
        tipo_entrada = tipo_entrada_atual if tipo_entrada_atual else determinar_tipo_entrada(tipo_romaneio)
        
        print(f"\nValores a serem aplicados:")
        if tem_empresa:
            print(f"   EMPRESA: {empresa_destino}")
        if tem_tipo_entrada:
            print(f"   TIPO_ENTRADA: {tipo_entrada}")
        print(f"   CM_OPERACAO: {cm_operacao_entrada}")
        if tem_cm_desc:
            print(f"   CM_DESC_OPERACAO: {cm_desc_operacao_entrada}")
        
        # Construir UPDATE dinamicamente baseado nas colunas que existem
        campos_update = []
        valores_update = []
        
        if tem_empresa and empresa_destino is not None:
            campos_update.append("EMPRESA = ?")
            valores_update.append(empresa_destino)
        
        if tem_tipo_entrada:
            campos_update.append("TIPO_ENTRADA = ?")
            valores_update.append(tipo_entrada)
        
        campos_update.append("CM_OPERACAO = ?")
        valores_update.append(cm_operacao_entrada)
        
        if tem_cm_desc:
            campos_update.append("CM_DESC_OPERACAO = ?")
            valores_update.append(cm_desc_operacao_entrada)
        
        valores_update.append(romaneio_entrada)
        
        query_update = f"""
            UPDATE ESTOQUE_PROD_ENT
            SET {', '.join(campos_update)}
            WHERE ROMANEIO_PRODUTO = ?
        """
        cursor.execute(query_update, valores_update)
        rows_afetadas = cursor.rowcount
        
        if rows_afetadas > 0:
            conn.commit()
            print(f"Entrada {romaneio_entrada} atualizada com sucesso!")
            return True
        else:
            print(f"Nenhuma linha foi atualizada para entrada {romaneio_entrada}")
            return False
            
    except Exception as e:
        conn.rollback()
        print(f"Erro ao corrigir entrada {romaneio_entrada}: {e}")
        import traceback
        traceback.print_exc()
        return False
    finally:
        cursor.close()

def main():
    """Função principal"""
    print("="*100)
    print("CORREÇÃO DE REGISTROS ESPECÍFICOS")
    print("="*100)
    
    # Romaneios a corrigir
    ROMANEIO_SAIDA = '028968'
    ROMANEIO_ENTRADA = 'A0127361'
    
    print(f"\nRomaneios a corrigir:")
    print(f"   Saida: {ROMANEIO_SAIDA}")
    print(f"   Entrada: {ROMANEIO_ENTRADA}")
    
    # Conectar ao banco
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Corrigir saída
        print(f"\n{'='*100}")
        print(f"CORRIGINDO SAÍDA: {ROMANEIO_SAIDA}")
        print(f"{'='*100}")
        sucesso_saida = corrigir_saida(conn, ROMANEIO_SAIDA)
        
        # Corrigir entrada
        print(f"\n{'='*100}")
        print(f"CORRIGINDO ENTRADA: {ROMANEIO_ENTRADA}")
        print(f"{'='*100}")
        sucesso_entrada = corrigir_entrada(conn, ROMANEIO_ENTRADA)
        
        # Resumo
        print(f"\n{'='*100}")
        print("RESUMO")
        print(f"{'='*100}")
        print(f"Saida {ROMANEIO_SAIDA}: {'Corrigida' if sucesso_saida else 'Falhou'}")
        print(f"Entrada {ROMANEIO_ENTRADA}: {'Corrigida' if sucesso_entrada else 'Falhou'}")
        
        if sucesso_saida and sucesso_entrada:
            print(f"\nTodos os registros foram corrigidos com sucesso!")
        else:
            print(f"\nAlguns registros nao puderam ser corrigidos.")
        
    except Exception as e:
        print(f"\nErro durante execucao: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\nConexao com banco de dados fechada.")

if __name__ == '__main__':
    main()

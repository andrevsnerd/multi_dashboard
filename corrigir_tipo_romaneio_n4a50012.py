#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para corrigir TIPO_ROMANEIO nos registros de entrada e saída do produto N4.A5.0012
"""

import sys
import codecs
import pyodbc
import pandas as pd
from datetime import datetime

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
        except:
            continue
    return None

def buscar_tipos_romaneio_disponiveis(conn) -> list:
    """Busca TODOS os tipos de romaneio disponíveis (saídas e entradas)"""
    # Buscar de saídas
    query_saidas = """
        SELECT DISTINCT TIPO_ROMANEIO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE TIPO_ROMANEIO IS NOT NULL
            AND TIPO_ROMANEIO != ''
    """
    
    # Buscar de entradas
    query_entradas = """
        SELECT DISTINCT TIPO_ROMANEIO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE TIPO_ROMANEIO IS NOT NULL
            AND TIPO_ROMANEIO != ''
    """
    
    tipos = set()
    
    try:
        df_saidas = pd.read_sql(query_saidas, conn)
        if not df_saidas.empty:
            tipos.update(df_saidas['TIPO_ROMANEIO'].astype(str).str.strip().tolist())
    except:
        pass
    
    try:
        df_entradas = pd.read_sql(query_entradas, conn)
        if not df_entradas.empty:
            tipos.update(df_entradas['TIPO_ROMANEIO'].astype(str).str.strip().tolist())
    except:
        pass
    
    # Converter para lista ordenada
    tipos_lista = sorted(list(tipos))
    
    # Se não encontrou nenhum, retornar tipos padrão
    if not tipos_lista:
        tipos_lista = ['TRANSFERENCIA', 'TRANSFERENCIA ENTRE LOJAS', 'DEFEITO']
    
    return tipos_lista

def buscar_registros_produto(conn, produto: str, data_filtro: str = None):
    """Busca registros de entrada e saída do produto, opcionalmente filtrado por data"""
    # Se data_filtro não foi informada, usar data de hoje
    if data_filtro is None:
        from datetime import datetime
        data_filtro = datetime.now().strftime('%Y-%m-%d')
    
    # Buscar saídas
    query_saidas = """
        SELECT DISTINCT
            s.ROMANEIO_PRODUTO,
            s.FILIAL,
            s.FILIAL_DESTINO,
            s.EMISSAO,
            s.TIPO_ROMANEIO,
            p.PRODUTO,
            p.COR_PRODUTO
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK)
            ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
            AND s.FILIAL = p.FILIAL
        WHERE p.PRODUTO = ?
            AND s.FILIAL_DESTINO IS NOT NULL
            AND CAST(s.EMISSAO AS DATE) = CAST(? AS DATE)
        ORDER BY s.EMISSAO DESC
    """
    
    df_saidas = pd.read_sql(query_saidas, conn, params=[produto, data_filtro])
    
    # Buscar entradas
    query_entradas = """
        SELECT DISTINCT
            e.ROMANEIO_PRODUTO,
            e.FILIAL,
            e.FILIAL_ORIGEM,
            e.EMISSAO,
            e.TIPO_ROMANEIO,
            p.PRODUTO,
            p.COR_PRODUTO
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        INNER JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
            ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
            AND e.FILIAL = p.FILIAL
        WHERE p.PRODUTO = ?
            AND e.FILIAL_ORIGEM IS NOT NULL
            AND CAST(e.EMISSAO AS DATE) = CAST(? AS DATE)
        ORDER BY e.EMISSAO DESC
    """
    
    df_entradas = pd.read_sql(query_entradas, conn, params=[produto, data_filtro])
    
    return df_saidas, df_entradas

def main():
    """Função principal"""
    print("="*100)
    print("CORREÇÃO DE TIPO_ROMANEIO - PRODUTO N4.A5.0012")
    print("="*100)
    
    produto = 'N4.A5.0012'
    
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Buscar tipos disponíveis
        tipos_disponiveis = buscar_tipos_romaneio_disponiveis(conn)
        
        print(f"\n📋 TIPOS DE ROMANEIO DISPONÍVEIS:")
        for idx, tipo in enumerate(tipos_disponiveis, 1):
            print(f"   {idx}. {tipo}")
        
        tipo_selecionado = input(f"\n🎯 Selecione o tipo de romaneio (1-{len(tipos_disponiveis)}): ").strip()
        
        try:
            num = int(tipo_selecionado)
            if 1 <= num <= len(tipos_disponiveis):
                tipo_romaneio = tipos_disponiveis[num - 1]
            else:
                print("⚠️  Número inválido. Usando 'TRANSFERENCIA' como padrão.")
                tipo_romaneio = 'TRANSFERENCIA'
        except:
            print("⚠️  Valor inválido. Usando 'TRANSFERENCIA' como padrão.")
            tipo_romaneio = 'TRANSFERENCIA'
        
        print(f"\n✓ Tipo selecionado: {tipo_romaneio}")
        
        # Buscar registros de hoje
        data_hoje = datetime.now().strftime('%Y-%m-%d')
        print(f"\n🔍 Buscando registros do produto {produto} de hoje ({data_hoje})...")
        df_saidas, df_entradas = buscar_registros_produto(conn, produto, data_hoje)
        
        print(f"\n📊 REGISTROS ENCONTRADOS (data: {data_hoje}):")
        print(f"   Saídas: {len(df_saidas)} registro(s)")
        print(f"   Entradas: {len(df_entradas)} registro(s)")
        
        if df_saidas.empty and df_entradas.empty:
            print(f"\n⚠️  Nenhum registro encontrado para o produto {produto} na data {data_hoje}")
            return
        
        # Permitir seleção individual de registros
        registros_selecionados_saidas = []
        registros_selecionados_entradas = []
        
        # Mostrar saídas e permitir seleção
        if not df_saidas.empty:
            print(f"\n{'='*100}")
            print("SAÍDAS DISPONÍVEIS:")
            print(f"{'='*100}")
            print(f"{'#':<4} {'ROMANEIO':<15} {'FILIAL':<30} {'DESTINO':<30} {'TIPO_ATUAL':<20} {'EMISSÃO'}")
            print("-"*100)
            indices_saidas = []
            for num, (idx, row) in enumerate(df_saidas.iterrows(), 1):
                indices_saidas.append(idx)
                tipo_atual = str(row['TIPO_ROMANEIO']).strip() if pd.notna(row['TIPO_ROMANEIO']) and str(row['TIPO_ROMANEIO']).strip() else '(vazio)'
                print(f"{num:<4} {row['ROMANEIO_PRODUTO']:<15} {row['FILIAL']:<30} {row['FILIAL_DESTINO']:<30} {tipo_atual:<20} {row['EMISSAO']}")
            print("-"*100)
            
            entrada_saidas = input(f"\n💡 Selecione as saídas para atualizar (números separados por vírgula, ex: 1,2,3 ou 'TODOS'): ").strip()
            
            if entrada_saidas.upper() == 'TODOS':
                registros_selecionados_saidas = indices_saidas
            else:
                try:
                    numeros = [int(n.strip()) for n in entrada_saidas.split(',') if n.strip()]
                    for num in numeros:
                        if 1 <= num <= len(indices_saidas):
                            registros_selecionados_saidas.append(indices_saidas[num - 1])
                except:
                    print("⚠️  Entrada inválida. Nenhuma saída selecionada.")
        
        # Mostrar entradas e permitir seleção
        if not df_entradas.empty:
            print(f"\n{'='*100}")
            print("ENTRADAS DISPONÍVEIS:")
            print(f"{'='*100}")
            print(f"{'#':<4} {'ROMANEIO':<15} {'FILIAL':<30} {'ORIGEM':<30} {'TIPO_ATUAL':<20} {'EMISSÃO'}")
            print("-"*100)
            indices_entradas = []
            for num, (idx, row) in enumerate(df_entradas.iterrows(), 1):
                indices_entradas.append(idx)
                tipo_atual = str(row['TIPO_ROMANEIO']).strip() if pd.notna(row['TIPO_ROMANEIO']) and str(row['TIPO_ROMANEIO']).strip() else '(vazio)'
                print(f"{num:<4} {row['ROMANEIO_PRODUTO']:<15} {row['FILIAL']:<30} {row['FILIAL_ORIGEM']:<30} {tipo_atual:<20} {row['EMISSAO']}")
            print("-"*100)
            
            entrada_entradas = input(f"\n💡 Selecione as entradas para atualizar (números separados por vírgula, ex: 1,2,3 ou 'TODOS'): ").strip()
            
            if entrada_entradas.upper() == 'TODOS':
                registros_selecionados_entradas = indices_entradas
            else:
                try:
                    numeros = [int(n.strip()) for n in entrada_entradas.split(',') if n.strip()]
                    for num in numeros:
                        if 1 <= num <= len(indices_entradas):
                            registros_selecionados_entradas.append(indices_entradas[num - 1])
                except:
                    print("⚠️  Entrada inválida. Nenhuma entrada selecionada.")
        
        if not registros_selecionados_saidas and not registros_selecionados_entradas:
            print("\n⚠️  Nenhum registro selecionado. Operação cancelada.")
            return
        
        # Mostrar resumo do que será atualizado
        print(f"\n{'='*100}")
        print("RESUMO DA ATUALIZAÇÃO")
        print(f"{'='*100}")
        print(f"   Tipo de romaneio: {tipo_romaneio}")
        print(f"   Saídas selecionadas: {len(registros_selecionados_saidas)}")
        print(f"   Entradas selecionadas: {len(registros_selecionados_entradas)}")
        
        if registros_selecionados_saidas:
            print(f"\n   Saídas que serão atualizadas:")
            for idx in registros_selecionados_saidas:
                row = df_saidas.loc[idx]
                print(f"      - {row['ROMANEIO_PRODUTO']} ({row['FILIAL']} → {row['FILIAL_DESTINO']})")
        
        if registros_selecionados_entradas:
            print(f"\n   Entradas que serão atualizadas:")
            for idx in registros_selecionados_entradas:
                row = df_entradas.loc[idx]
                print(f"      - {row['ROMANEIO_PRODUTO']} ({row['FILIAL']} ← {row['FILIAL_ORIGEM']})")
        
        # Confirmação
        print(f"\n{'='*100}")
        print("CONFIRMAÇÃO")
        print(f"{'='*100}")
        print(f"\n⚠️  Você está prestes a atualizar {len(registros_selecionados_saidas)} saída(s) e {len(registros_selecionados_entradas)} entrada(s)")
        print(f"   Tipo de romaneio: {tipo_romaneio}")
        print(f"\n💡 Digite 'SIM' (em maiúsculas) para confirmar")
        
        confirmacao = input("\n❓ Confirmar: ").strip()
        
        if confirmacao != 'SIM':
            print("\n❌ Operação cancelada")
            return
        
        # Atualizar saídas selecionadas
        cursor = conn.cursor()
        atualizados_saidas = 0
        atualizados_entradas = 0
        
        if registros_selecionados_saidas:
            print(f"\n📝 Atualizando saídas...")
            for idx in registros_selecionados_saidas:
                row = df_saidas.loc[idx]
                romaneio = str(row['ROMANEIO_PRODUTO']).strip()
                filial = str(row['FILIAL']).strip()
                
                query = """
                    UPDATE ESTOQUE_PROD_SAI
                    SET TIPO_ROMANEIO = ?
                    WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
                """
                cursor.execute(query, [tipo_romaneio, romaneio, filial])
                if cursor.rowcount > 0:
                    atualizados_saidas += 1
                    print(f"   ✓ Saída atualizada: {romaneio} ({filial})")
        
        # Atualizar entradas selecionadas
        if registros_selecionados_entradas:
            print(f"\n📝 Atualizando entradas...")
            for idx in registros_selecionados_entradas:
                row = df_entradas.loc[idx]
                romaneio = str(row['ROMANEIO_PRODUTO']).strip()
                filial = str(row['FILIAL']).strip()
                
                query = """
                    UPDATE ESTOQUE_PROD_ENT
                    SET TIPO_ROMANEIO = ?
                    WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
                """
                cursor.execute(query, [tipo_romaneio, romaneio, filial])
                if cursor.rowcount > 0:
                    atualizados_entradas += 1
                    print(f"   ✓ Entrada atualizada: {romaneio} ({filial})")
        
        # Commit
        conn.commit()
        cursor.close()
        
        print(f"\n{'='*100}")
        print("✅ CORREÇÃO CONCLUÍDA")
        print(f"{'='*100}")
        print(f"\n✓ Saídas atualizadas: {atualizados_saidas}/{len(registros_selecionados_saidas)}")
        print(f"✓ Entradas atualizadas: {atualizados_entradas}/{len(registros_selecionados_entradas)}")
        print(f"✓ Tipo de romaneio aplicado: {tipo_romaneio}")
        
    except Exception as e:
        print(f"\n✗ Erro: {e}")
        import traceback
        traceback.print_exc()
        if conn:
            conn.rollback()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão fechada.")

if __name__ == '__main__':
    main()

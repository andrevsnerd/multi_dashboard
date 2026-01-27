#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para alterar ESTOQUE de produtos no banco de dados
Permite inserir código de produto, visualizar onde tem estoque,
selecionar qual estoque alterar e definir novo valor ou zerar
Mostra preview e permite executar as alterações no banco de dados
"""

import pyodbc
import pandas as pd
from typing import List, Dict, Optional, Tuple

# Config conexão (mesma do exportar_todos_relatorios.py)
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
            conn.timeout = 300  # 5 minutos
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

def buscar_info_produto(conn, codigo_produto: str) -> Optional[pd.DataFrame]:
    """Busca informações básicas do produto"""
    codigo_limpo = str(codigo_produto).strip()
    
    query = """
        SELECT 
            PRODUTO,
            DESC_PRODUTO,
            GRUPO_PRODUTO,
            SUBGRUPO_PRODUTO,
            LINHA
        FROM PRODUTOS
        WHERE PRODUTO = ?
    """
    
    try:
        df = pd.read_sql(query, conn, params=[codigo_limpo])
        if not df.empty and 'PRODUTO' in df.columns:
            df['PRODUTO'] = df['PRODUTO'].astype(str).str.strip()
        return df
    except Exception as e:
        print(f"✗ Erro ao buscar produto: {e}")
        return None

def buscar_estoque_produto(conn, codigo_produto: str) -> pd.DataFrame:
    """Busca todos os registros de estoque do produto"""
    codigo_limpo = str(codigo_produto).strip()
    
    query = """
        SELECT 
            e.PRODUTO,
            e.COR_PRODUTO,
            e.FILIAL,
            e.ESTOQUE,
            p.DESC_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            f.FILIAL AS NOME_FILIAL
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = e.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON c.COR = e.COR_PRODUTO
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = e.FILIAL
        WHERE e.PRODUTO = ?
        ORDER BY e.FILIAL, e.COR_PRODUTO
    """
    
    try:
        df = pd.read_sql(query, conn, params=[codigo_limpo])
        
        # Limpar e formatar dados
        if not df.empty:
            df['PRODUTO'] = df['PRODUTO'].astype(str).str.strip()
            df['FILIAL'] = df['FILIAL'].astype(str).str.strip()
            df['COR_PRODUTO'] = df['COR_PRODUTO'].fillna('').astype(str).str.strip()
            df['ESTOQUE'] = df['ESTOQUE'].fillna(0).astype(int)
            df['DESC_COR'] = df['DESC_COR'].fillna('').astype(str).str.strip()
            df['NOME_FILIAL'] = df['NOME_FILIAL'].fillna('').astype(str).str.strip()
        
        return df
    except Exception as e:
        print(f"✗ Erro ao buscar estoque: {e}")
        return pd.DataFrame()

def exibir_estoques_disponiveis(df_estoque: pd.DataFrame) -> None:
    """Exibe lista numerada de estoques disponíveis"""
    if df_estoque.empty:
        print("⚠ Nenhum estoque encontrado para este produto.")
        return
    
    print("\n" + "="*100)
    print("ESTOQUES DISPONÍVEIS")
    print("="*100)
    print(f"\n📋 Total de registros de estoque: {len(df_estoque)}")
    print(f"📦 Estoque total: {df_estoque['ESTOQUE'].sum():,} unidades")
    print("\n" + "-"*100)
    print(f"{'#':<4} {'FILIAL':<25} {'COR':<20} {'ESTOQUE':<12} {'DESC_COR':<35}")
    print("-"*100)
    
    for idx, row in df_estoque.iterrows():
        filial = str(row['NOME_FILIAL']) if row['NOME_FILIAL'] else str(row['FILIAL'])
        cor = str(row['COR_PRODUTO']) if row['COR_PRODUTO'] else '(sem cor)'
        estoque = int(row['ESTOQUE'])
        desc_cor = str(row['DESC_COR'])[:33] if row['DESC_COR'] else ''
        
        print(f"{idx+1:<4} {filial:<25} {cor:<20} {estoque:<12} {desc_cor:<35}")
    
    print("-"*100)

def exibir_preview_alteracao(df_estoque: pd.DataFrame, indices_selecionados: List[int], novo_estoque: int) -> None:
    """Exibe preview das alterações que serão feitas"""
    if not indices_selecionados:
        print("⚠ Nenhum índice selecionado para preview.")
        return
    
    print("\n" + "="*100)
    print("PREVIEW DAS ALTERAÇÕES")
    print("="*100)
    
    registros_selecionados = [df_estoque.iloc[idx] for idx in indices_selecionados if 0 <= idx < len(df_estoque)]
    
    if not registros_selecionados:
        print("⚠ Nenhum registro válido selecionado.")
        return
    
    produto = registros_selecionados[0]['PRODUTO']
    desc_produto = registros_selecionados[0]['DESC_PRODUTO']
    
    print(f"\n📦 Produto: {produto}")
    print(f"   Descrição: {desc_produto}")
    print(f"\n📋 Total de registros que serão alterados: {len(registros_selecionados)}")
    print(f"📊 Novo estoque para todos: {novo_estoque:,} unidades")
    print("\n" + "-"*100)
    print(f"{'#':<4} {'FILIAL':<30} {'COR':<20} {'ESTOQUE ATUAL':<15} {'ESTOQUE NOVO':<15} {'DIFERENÇA':<15}")
    print("-"*100)
    
    total_alteracoes = 0
    total_zerados = 0
    
    for i, registro in enumerate(registros_selecionados):
        filial = str(registro['NOME_FILIAL']) if registro['NOME_FILIAL'] else str(registro['FILIAL'])
        cor = str(registro['COR_PRODUTO']) if registro['COR_PRODUTO'] else '(sem cor)'
        estoque_atual = int(registro['ESTOQUE'])
        diferenca = novo_estoque - estoque_atual
        
        print(f"{i+1:<4} {filial:<30} {cor:<20} {estoque_atual:<15,} {novo_estoque:<15,} {diferenca:+,}")
        
        if novo_estoque != estoque_atual:
            total_alteracoes += 1
        if novo_estoque == 0:
            total_zerados += 1
    
    print("-"*100)
    print(f"\n📊 Resumo:")
    print(f"   • Registros que serão alterados: {total_alteracoes}")
    print(f"   • Registros que já estão corretos: {len(registros_selecionados) - total_alteracoes}")
    if total_zerados > 0:
        print(f"   • ⚠️  {total_zerados} registro(s) será(ão) ZERADO(S)!")
    
    print("="*100)

def gerar_sql_update(registro: pd.Series, novo_estoque: int) -> str:
    """Gera o SQL UPDATE que seria executado (apenas para visualização)"""
    produto = str(registro['PRODUTO']).strip()
    filial = str(registro['FILIAL']).strip()
    cor_produto = str(registro['COR_PRODUTO']).strip() if pd.notna(registro['COR_PRODUTO']) else ''
    
    # Escapar aspas simples para SQL (substituir ' por '')
    produto_escaped = produto.replace("'", "''")
    filial_escaped = filial.replace("'", "''")
    cor_produto_escaped = cor_produto.replace("'", "''") if cor_produto else ''
    
    # Construir WHERE clause
    where_conditions = [f"PRODUTO = '{produto_escaped}'"]
    where_conditions.append(f"FILIAL = '{filial_escaped}'")
    
    if cor_produto:
        where_conditions.append(f"COR_PRODUTO = '{cor_produto_escaped}'")
    else:
        where_conditions.append("(COR_PRODUTO IS NULL OR COR_PRODUTO = '')")
    
    where_clause = " AND ".join(where_conditions)
    
    sql = f"""
-- SQL UPDATE que seria executado:
-- ATENÇÃO: Este SQL NÃO será executado automaticamente!

UPDATE ESTOQUE_PRODUTOS
SET ESTOQUE = {novo_estoque}
WHERE {where_clause}

-- Produto: {produto}
-- Filial: {filial}
-- Cor: {cor_produto if cor_produto else '(sem cor)'}
-- Estoque atual: {int(registro['ESTOQUE'])}
-- Estoque novo: {novo_estoque}
"""
    return sql

def executar_update(conn, registro: pd.Series, novo_estoque: int) -> Tuple[bool, int, str]:
    """
    Executa o UPDATE no banco de dados de forma segura
    Retorna: (sucesso: bool, registros_alterados: int, mensagem: str)
    """
    produto = str(registro['PRODUTO']).strip()
    filial = str(registro['FILIAL']).strip()
    cor_produto = str(registro['COR_PRODUTO']).strip() if pd.notna(registro['COR_PRODUTO']) and str(registro['COR_PRODUTO']).strip() else None
    
    try:
        cursor = conn.cursor()
        
        # Construir query com parâmetros para evitar SQL injection
        if cor_produto:
            query = """
                UPDATE ESTOQUE_PRODUTOS
                SET ESTOQUE = ?
                WHERE PRODUTO = ? 
                  AND FILIAL = ?
                  AND COR_PRODUTO = ?
            """
            params = [novo_estoque, produto, filial, cor_produto]
        else:
            query = """
                UPDATE ESTOQUE_PRODUTOS
                SET ESTOQUE = ?
                WHERE PRODUTO = ? 
                  AND FILIAL = ?
                  AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
            """
            params = [novo_estoque, produto, filial]
        
        # Executar UPDATE
        cursor.execute(query, params)
        registros_alterados = cursor.rowcount
        
        # Commit da transação
        conn.commit()
        cursor.close()
        
        return True, registros_alterados, f"✓ {registros_alterados} registro(s) alterado(s) com sucesso!"
        
    except Exception as e:
        # Rollback em caso de erro
        conn.rollback()
        return False, 0, f"✗ Erro ao executar UPDATE: {str(e)}"

def validar_entrada_estoque(entrada: str) -> Optional[int]:
    """Valida e converte entrada de estoque"""
    entrada = entrada.strip().upper()
    
    # Verificar se é "ZERAR" ou "ZERO"
    if entrada in ['ZERAR', 'ZERO', '0', 'Z']:
        return 0
    
    # Tentar converter para inteiro
    try:
        valor = int(entrada)
        if valor < 0:
            print("⚠️  O estoque não pode ser negativo. Use 0 para zerar.")
            return None
        return valor
    except ValueError:
        print("⚠️  Valor inválido. Digite um número inteiro ou 'ZERAR' para zerar o estoque.")
        return None

def main():
    """Função principal"""
    print("="*100)
    print("ALTERADOR DE ESTOQUE")
    print("="*100)
    print("\n⚠️  ATENÇÃO: Este script pode fazer alterações no banco de dados.")
    print("   Você verá um preview antes e precisará confirmar a execução.")
    print("   Use com MUITO CUIDADO!\n")
    
    # Conectar ao banco
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Solicitar código do produto
        print("\n" + "="*100)
        print("ENTRADA DE DADOS")
        print("="*100)
        print("\n💡 Digite o código do produto")
        print("   Exemplo: 12345")
        
        entrada_produto = input("\n📦 Código do produto: ").strip()
        
        if not entrada_produto:
            print("\n✗ Nenhum código de produto informado.")
            return
        
        codigo_produto = entrada_produto.strip()
        print(f"\n✓ Código informado: {codigo_produto}")
        
        # Buscar informações do produto
        print("\n🔍 Buscando informações do produto...")
        df_produto = buscar_info_produto(conn, codigo_produto)
        
        if df_produto is None or df_produto.empty:
            print(f"\n✗ Produto '{codigo_produto}' não encontrado no banco de dados.")
            return
        
        produto_info = df_produto.iloc[0]
        print(f"\n✓ Produto encontrado:")
        print(f"   Código: {produto_info['PRODUTO']}")
        print(f"   Descrição: {produto_info['DESC_PRODUTO']}")
        print(f"   Linha: {produto_info['LINHA'] if pd.notna(produto_info['LINHA']) else '(sem linha)'}")
        
        # Buscar estoques do produto
        print("\n🔍 Buscando estoques do produto...")
        df_estoque = buscar_estoque_produto(conn, codigo_produto)
        
        if df_estoque.empty:
            print(f"\n✗ Nenhum estoque encontrado para o produto '{codigo_produto}'.")
            print("   Este produto não possui registros na tabela ESTOQUE_PRODUTOS.")
            return
        
        # Exibir estoques disponíveis
        exibir_estoques_disponiveis(df_estoque)
        
        # Solicitar seleção do estoque
        print("\n" + "="*100)
        print("SELECIONAR ESTOQUES PARA ALTERAR")
        print("="*100)
        print("\n💡 Digite o(s) número(s) (#) do(s) estoque(s) que deseja alterar")
        print(f"   Escolha entre 1 e {len(df_estoque)}")
        print("   Você pode selecionar múltiplos separados por vírgula (ex: 1,2,3)")
        
        entrada_indices = input("\n🎯 Número(s) do(s) estoque(s): ").strip()
        
        if not entrada_indices:
            print("\n✗ Nenhum número informado.")
            return
        
        # Processar múltiplos números separados por vírgula
        try:
            numeros_str = [num.strip() for num in entrada_indices.split(',') if num.strip()]
            indices = [int(num) - 1 for num in numeros_str]
            
            # Validar índices
            indices_validos = []
            indices_invalidos = []
            for idx in indices:
                if 0 <= idx < len(df_estoque):
                    if idx not in indices_validos:  # Evitar duplicatas
                        indices_validos.append(idx)
                else:
                    indices_invalidos.append(idx + 1)  # +1 para mostrar o número original
            
            if indices_invalidos:
                print(f"\n⚠ Números inválidos ignorados: {', '.join(map(str, indices_invalidos))}")
            
            if not indices_validos:
                print(f"\n✗ Nenhum número válido. Deve estar entre 1 e {len(df_estoque)}")
                return
            
            indices_validos = sorted(set(indices_validos))  # Ordenar e remover duplicatas
            
        except ValueError:
            print("\n✗ Valor inválido. Digite números separados por vírgula (ex: 1,2,3).")
            return
        
        registros_selecionados = [df_estoque.iloc[idx] for idx in indices_validos]
        
        print(f"\n✓ {len(registros_selecionados)} estoque(s) selecionado(s):")
        for i, registro in enumerate(registros_selecionados, 1):
            filial = str(registro['NOME_FILIAL']) if registro['NOME_FILIAL'] else str(registro['FILIAL'])
            cor = str(registro['COR_PRODUTO']) if registro['COR_PRODUTO'] else '(sem cor)'
            estoque_atual = int(registro['ESTOQUE'])
            print(f"   {i}. {filial} | {cor} | Estoque atual: {estoque_atual:,} unidades")
        
        # Solicitar novo estoque
        print("\n" + "="*100)
        print("DEFINIR NOVO ESTOQUE")
        print("="*100)
        print("\n💡 Digite o novo valor de estoque")
        print("   - Digite um número inteiro (ex: 10, 50, 100)")
        print("   - Digite 'ZERAR' ou '0' para zerar o estoque")
        print(f"\n   Este valor será aplicado a TODOS os {len(registros_selecionados)} estoque(s) selecionado(s)")
        
        entrada_estoque = input("\n📊 Novo estoque: ").strip()
        
        if not entrada_estoque:
            print("\n✗ Nenhum valor informado.")
            return
        
        novo_estoque = validar_entrada_estoque(entrada_estoque)
        
        if novo_estoque is None:
            return
        
        # Verificar se há alteração necessária
        registros_para_alterar = [r for r in registros_selecionados if int(r['ESTOQUE']) != novo_estoque]
        
        if not registros_para_alterar:
            print("\n" + "="*100)
            print("✅ NENHUMA ALTERAÇÃO NECESSÁRIA")
            print("="*100)
            print(f"\n💡 Todos os estoques selecionados já estão em {novo_estoque:,} unidades.")
            return
        
        # Exibir preview
        exibir_preview_alteracao(df_estoque, indices_validos, novo_estoque)
        
        # Gerar SQL para todos os registros
        print("\n" + "="*100)
        print("SQL QUE SERIA EXECUTADO")
        print("="*100)
        for i, registro in enumerate(registros_para_alterar, 1):
            print(f"\n-- UPDATE {i}/{len(registros_para_alterar)}:")
            sql_update = gerar_sql_update(registro, novo_estoque)
            print(sql_update)
        
        # Confirmação única
        print("\n" + "="*100)
        print("CONFIRMAÇÃO DE EXECUÇÃO")
        print("="*100)
        print(f"\n⚠️  ATENÇÃO: Você está prestes a alterar {len(registros_para_alterar)} registro(s) no banco de dados!")
        print(f"   Produto: {produto_info['PRODUTO']} - {produto_info['DESC_PRODUTO']}")
        print(f"   Novo estoque: {novo_estoque:,} unidades")
        if novo_estoque == 0:
            print(f"\n   ⚠️  O ESTOQUE SERÁ ZERADO em {len([r for r in registros_para_alterar if int(r['ESTOQUE']) > 0])} registro(s)!")
        print("\n💡 Deseja realmente executar esta alteração?")
        print("   Digite 'SIM' (em maiúsculas) para confirmar, ou qualquer outra coisa para cancelar")
        
        confirmacao = input("\n❓ Confirmar execução: ").strip()
        
        if confirmacao != 'SIM':
            print("\n" + "="*100)
            print("❌ OPERAÇÃO CANCELADA")
            print("="*100)
            print("\n⚠️  Nenhuma alteração foi feita no banco de dados.")
            return
        
        # Executar UPDATE para todos os registros
        print("\n" + "="*100)
        print("EXECUTANDO UPDATE...")
        print("="*100)
        
        total_alterados = 0
        total_erros = 0
        erros = []
        
        for i, registro in enumerate(registros_para_alterar, 1):
            filial_nome = str(registro['NOME_FILIAL']) if registro['NOME_FILIAL'] else str(registro['FILIAL'])
            cor = str(registro['COR_PRODUTO']) if registro['COR_PRODUTO'] else '(sem cor)'
            print(f"\n[{i}/{len(registros_para_alterar)}] Alterando: {filial_nome} | {cor}...")
            
            sucesso, registros_alterados, mensagem = executar_update(conn, registro, novo_estoque)
            
            if sucesso:
                total_alterados += registros_alterados
                print(f"   ✓ {mensagem}")
            else:
                total_erros += 1
                erros.append(f"{filial_nome} | {cor}: {mensagem}")
                print(f"   ✗ {mensagem}")
        
        # Resumo final
        print("\n" + "="*100)
        print("RESUMO DA EXECUÇÃO")
        print("="*100)
        print(f"\n✓ Registros alterados com sucesso: {total_alterados}")
        if total_erros > 0:
            print(f"✗ Registros com erro: {total_erros}")
            for erro in erros:
                print(f"   • {erro}")
        
        # Verificar alterações
        if total_alterados > 0:
            print("\n🔍 Verificando alterações...")
            df_verificacao = buscar_estoque_produto(conn, codigo_produto)
            
            if not df_verificacao.empty:
                verificados_ok = 0
                verificados_erro = 0
                
                for registro in registros_para_alterar:
                    # Normalizar COR_PRODUTO para comparação
                    cor_selecionado = str(registro['COR_PRODUTO']).strip() if pd.notna(registro['COR_PRODUTO']) and str(registro['COR_PRODUTO']).strip() else ''
                    cor_verificacao = df_verificacao['COR_PRODUTO'].fillna('').astype(str).str.strip()
                    
                    mask = (
                        (df_verificacao['FILIAL'].astype(str).str.strip() == str(registro['FILIAL']).strip()) &
                        (cor_verificacao == cor_selecionado)
                    )
                    registro_verificado = df_verificacao[mask]
                    
                    if not registro_verificado.empty:
                        estoque_verificado = int(registro_verificado.iloc[0]['ESTOQUE'])
                        if estoque_verificado == novo_estoque:
                            verificados_ok += 1
                        else:
                            verificados_erro += 1
                
                if verificados_ok > 0:
                    print(f"✓ {verificados_ok} registro(s) confirmado(s) com o novo estoque")
                if verificados_erro > 0:
                    print(f"⚠ {verificados_erro} registro(s) não foram alterados conforme esperado")
        
        print("\n" + "="*100)
        print("✅ OPERAÇÃO CONCLUÍDA")
        print("="*100)
        
    except Exception as e:
        print(f"\n✗ Erro durante execução: {e}")
        import traceback
        traceback.print_exc()
    
    finally:
        if conn:
            conn.close()
            print("\n✓ Conexão com banco de dados fechada.")

if __name__ == '__main__':
    main()

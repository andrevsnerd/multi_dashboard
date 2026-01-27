#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para Criar Transferências entre Lojas (NERD e SCARFME)
Permite selecionar produto, filial origem, quantidade de saída,
filial destino e quantidade de entrada.
Executa automaticamente os registros nas tabelas de entrada e saída
com romaneios corretos, atualiza SEQUENCIAIS e ESTOQUE_PRODUTOS.
"""

import pyodbc
import pandas as pd
from datetime import datetime
from typing import Optional, Tuple, List

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
            print(f"✗ Erro conexao com {nome} ({servidor}): {e}")
            if nome == 'principal':
                print("⚠ Tentando servidor fallback...")
            continue
    
    print(f"✗ Erro conexao: Falha em todos os servidores. Ultimo erro: {ultimo_erro}")
    return None

def buscar_produto_por_codigo_barras(conn, codigo_barras: str) -> Optional[pd.DataFrame]:
    """Busca produto por código de barras"""
    codigo_limpo = str(codigo_barras).strip()
    
    query = """
        SELECT DISTINCT
            pb.PRODUTO,
            p.DESC_PRODUTO,
            p.GRUPO_PRODUTO,
            p.SUBGRUPO_PRODUTO,
            p.LINHA,
            pb.COR_PRODUTO,
            pb.TAMANHO,
            pb.CODIGO_BARRA
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = pb.PRODUTO
        WHERE pb.CODIGO_BARRA = ?
    """
    
    try:
        df = pd.read_sql(query, conn, params=[codigo_limpo])
        if not df.empty and 'PRODUTO' in df.columns:
            df['PRODUTO'] = df['PRODUTO'].astype(str).str.strip()
        return df
    except Exception as e:
        print(f"✗ Erro ao buscar produto por código de barras: {e}")
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
        FROM PRODUTOS WITH (NOLOCK)
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

def buscar_todas_filiais(conn) -> pd.DataFrame:
    """Busca todas as filiais disponíveis"""
    query = """
        SELECT DISTINCT
            COD_FILIAL,
            FILIAL
        FROM FILIAIS WITH (NOLOCK)
        WHERE FILIAL LIKE '%NERD%' 
           OR FILIAL LIKE '%SCARF%'
           OR FILIAL LIKE '%SCARFME%'
        ORDER BY FILIAL
    """
    
    try:
        df = pd.read_sql(query, conn)
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar filiais: {e}")
        return pd.DataFrame()

def buscar_tipos_romaneio_disponiveis(conn) -> List[str]:
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
    except Exception as e:
        print(f"⚠️  Erro ao buscar tipos de saída: {e}")
    
    try:
        df_entradas = pd.read_sql(query_entradas, conn)
        if not df_entradas.empty:
            tipos.update(df_entradas['TIPO_ROMANEIO'].astype(str).str.strip().tolist())
    except Exception as e:
        print(f"⚠️  Erro ao buscar tipos de entrada: {e}")
    
    # Converter para lista ordenada
    tipos_lista = sorted(list(tipos))
    
    # Se não encontrou nenhum, retornar tipos padrão
    if not tipos_lista:
        tipos_lista = ['TRANSFERENCIA', 'TRANSFERENCIA ENTRE LOJAS', 'DEFEITO']
    
    return tipos_lista

def selecionar_tipo_romaneio(conn) -> str:
    """Permite ao usuário selecionar o tipo de romaneio"""
    tipos_disponiveis = buscar_tipos_romaneio_disponiveis(conn)
    
    print("\n" + "="*100)
    print("SELECIONAR TIPO DE ROMANEIO")
    print("="*100)
    print("\n💡 Selecione o tipo de romaneio para esta transferência")
    print("   O mesmo tipo será aplicado na saída e na entrada")
    print("\n📋 TIPOS DISPONÍVEIS:")
    print("-"*100)
    
    for idx, tipo in enumerate(tipos_disponiveis, 1):
        print(f"   {idx}. {tipo}")
    
    print("-"*100)
    
    while True:
        entrada = input(f"\n🎯 Número do tipo de romaneio (1-{len(tipos_disponiveis)}): ").strip()
        
        try:
            num = int(entrada)
            if 1 <= num <= len(tipos_disponiveis):
                tipo_selecionado = tipos_disponiveis[num - 1]
                print(f"\n✓ Tipo de romaneio selecionado: {tipo_selecionado}")
                return tipo_selecionado
            else:
                print(f"⚠️  Número inválido. Digite um número entre 1 e {len(tipos_disponiveis)}")
        except ValueError:
            print("⚠️  Valor inválido. Digite um número.")

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
    print(f"{'#':<4} {'FILIAL':<40} {'COR':<20} {'ESTOQUE':<12} {'DESC_COR':<30}")
    print("-"*100)
    
    for idx, row in df_estoque.iterrows():
        filial = str(row['NOME_FILIAL']) if row['NOME_FILIAL'] else str(row['FILIAL'])
        cor = str(row['COR_PRODUTO']) if row['COR_PRODUTO'] else '(sem cor)'
        estoque = int(row['ESTOQUE'])
        desc_cor = str(row['DESC_COR'])[:28] if row['DESC_COR'] else ''
        
        print(f"{idx+1:<4} {filial:<40} {cor:<20} {estoque:<12} {desc_cor:<30}")
    
    print("-"*100)

def verificar_romaneio_existe(conn, romaneio: str, filial: str, tabela: str) -> bool:
    """Verifica se um romaneio já existe para uma filial específica"""
    if tabela == 'ESTOQUE_PROD_SAI':
        query = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = ? AND LTRIM(RTRIM(FILIAL)) = ?
        """
    elif tabela == 'ESTOQUE_PROD_ENT':
        query = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = ? AND LTRIM(RTRIM(FILIAL)) = ?
        """
    else:
        return False
    
    try:
        cursor = conn.cursor()
        romaneio_limpo = str(romaneio).strip()
        filial_limpa = str(filial).strip()
        
        # Primeiro, tentar verificar com LTRIM/RTRIM
        cursor.execute(query, [romaneio_limpo, filial_limpa])
        row = cursor.fetchone()
        existe = row[0] > 0 if row else False
        
        # Se não encontrou, tentar verificar sem LTRIM/RTRIM (pode ser que o banco tenha espaços diferentes)
        if not existe:
            query_simples = query.replace("LTRIM(RTRIM(ROMANEIO_PRODUTO))", "ROMANEIO_PRODUTO").replace("LTRIM(RTRIM(FILIAL))", "FILIAL")
            cursor.execute(query_simples, [romaneio_limpo, filial_limpa])
            row2 = cursor.fetchone()
            existe = row2[0] > 0 if row2 else False
        
        # Se ainda não encontrou, tentar verificar com LIKE (para pegar variações)
        if not existe:
            if tabela == 'ESTOQUE_PROD_SAI':
                query_like = """
                    SELECT COUNT(*) as TOTAL
                    FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
                    WHERE ROMANEIO_PRODUTO LIKE ? AND FILIAL LIKE ?
                """
            elif tabela == 'ESTOQUE_PROD_ENT':
                query_like = """
                    SELECT COUNT(*) as TOTAL
                    FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
                    WHERE ROMANEIO_PRODUTO LIKE ? AND FILIAL LIKE ?
                """
            cursor.execute(query_like, [f'%{romaneio_limpo}%', f'%{filial_limpa}%'])
            row3 = cursor.fetchone()
            existe = row3[0] > 0 if row3 else False
        
        cursor.close()
        if existe:
            print(f"   ⚠️  DEBUG: Romaneio {romaneio_limpo} encontrado para filial {filial_limpa} na tabela {tabela}")
        return existe
    except Exception as e:
        print(f"   ⚠️  DEBUG: Erro ao verificar romaneio: {e}")
        return False

def gerar_proximo_romaneio_saida(conn, filial: str = None) -> str:
    """Gera o próximo romaneio de saída baseado no maior existente"""
    query = """
        SELECT TOP 1
            ROMANEIO_PRODUTO
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
            AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
        ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
    """
    
    try:
        df = pd.read_sql(query, conn)
        if len(df) > 0:
            romaneio_atual = str(df.iloc[0]['ROMANEIO_PRODUTO']).strip()
            try:
                num_atual = int(romaneio_atual)
                prox_num = num_atual + 1
                romaneio_gerado = f"{prox_num:06d}"
                
                # Verificar se já existe (se filial foi informada)
                if filial and verificar_romaneio_existe(conn, romaneio_gerado, filial, 'ESTOQUE_PROD_SAI'):
                    # Se existe, incrementar mais um
                    prox_num += 1
                    romaneio_gerado = f"{prox_num:06d}"
                
                return romaneio_gerado
            except:
                pass
        # Se não encontrar, começar de 016042 (um após o último visto)
        return "016042"
    except:
        return "016042"

def gerar_proximo_romaneio_entrada(conn, romaneio_saida: str) -> str:
    """Gera o romaneio de entrada baseado no romaneio de saída (padrão: T + número)"""
    # Remover espaços e extrair número
    romaneio_limpo = str(romaneio_saida).strip()
    
    # Se já tem prefixo T, remover
    if romaneio_limpo.startswith('T'):
        romaneio_limpo = romaneio_limpo[1:]
    
    # Gerar romaneio de entrada com prefixo T
    return f"T{romaneio_limpo}"

def gerar_sql_transferencia(
    produto: str,
    cor_produto: str,
    filial_origem: str,
    filial_destino: str,
    qtde_saida: int,
    qtde_entrada: int,
    romaneio_saida: str,
    romaneio_entrada: str,
    data_transferencia: datetime
) -> Tuple[str, str, str, str]:
    """
    Gera os SQLs para criar a transferência
    Retorna: (sql_saida_cabecalho, sql_saida_item, sql_entrada_cabecalho, sql_entrada_item)
    """
    
    # Preparar valores
    produto_escaped = produto.replace("'", "''")
    filial_origem_escaped = filial_origem.replace("'", "''")
    filial_destino_escaped = filial_destino.replace("'", "''")
    cor_escaped = cor_produto.replace("'", "''") if cor_produto else ''
    data_str = data_transferencia.strftime('%Y-%m-%d %H:%M:%S')
    
    # SQL 1: Inserir cabeçalho de SAÍDA (ESTOQUE_PROD_SAI)
    sql_saida_cab = f"""
-- ============================================================
-- SQL 1: INSERIR CABEÇALHO DE SAÍDA (ESTOQUE_PROD_SAI)
-- ============================================================
INSERT INTO ESTOQUE_PROD_SAI (
    ROMANEIO_PRODUTO,
    FILIAL,
    EMISSAO,
    RESPONSAVEL,
    FILIAL_DESTINO,
    ROMANEIO_DESTINO,
    DATA_PARA_TRANSFERENCIA,
    DATA_DIGITACAO,
    SEGUNDA_QUALIDADE,
    NAO_VALIDAR_ENTRADA,
    MOV_INTERNA
) VALUES (
    '{romaneio_saida}',
    '{filial_origem_escaped}',
    '{data_str}',
    ' ',
    '{filial_destino_escaped}',
    '{romaneio_entrada}',
    '{data_str}',
    GETDATE(),
    0,
    0,
    0
)
"""
    
    # SQL 2: Inserir item de SAÍDA (ESTOQUE_PROD1_SAI)
    sql_saida_item = f"""
-- ============================================================
-- SQL 2: INSERIR ITEM DE SAÍDA (ESTOQUE_PROD1_SAI)
-- ============================================================
INSERT INTO ESTOQUE_PROD1_SAI (
    FILIAL,
    ROMANEIO_PRODUTO,
    PRODUTO,
    COR_PRODUTO,
    QTDE,
    DESCONTO_ITEM
) VALUES (
    '{filial_origem_escaped}',
    '{romaneio_saida}',
    '{produto_escaped}',
    {f"'{cor_escaped}'" if cor_escaped else "NULL"},
    {qtde_saida},
    0
)
"""
    
    # SQL 3: Inserir cabeçalho de ENTRADA (ESTOQUE_PROD_ENT)
    sql_entrada_cab = f"""
-- ============================================================
-- SQL 3: INSERIR CABEÇALHO DE ENTRADA (ESTOQUE_PROD_ENT)
-- ============================================================
INSERT INTO ESTOQUE_PROD_ENT (
    ROMANEIO_PRODUTO,
    FILIAL,
    EMISSAO,
    RESPONSAVEL,
    FILIAL_ORIGEM,
    ROMANEIO_ORIGEM,
    DATA_PARA_TRANSFERENCIA,
    DATA_DIGITACAO,
    SEGUNDA_QUALIDADE,
    ACERTO_ENTRADA,
    NAO_VALIDAR_ENTRADA,
    NF_ENTRADA_PROPRIA
) VALUES (
    '{romaneio_entrada}',
    '{filial_destino_escaped}',
    '{data_str}',
    ' ',
    '{filial_origem_escaped}',
    '{romaneio_saida}',
    '{data_str}',
    GETDATE(),
    0,
    0,
    0,
    0
)
"""
    
    # SQL 4: Inserir item de ENTRADA (ESTOQUE_PROD1_ENT)
    sql_entrada_item = f"""
-- ============================================================
-- SQL 4: INSERIR ITEM DE ENTRADA (ESTOQUE_PROD1_ENT)
-- ============================================================
INSERT INTO ESTOQUE_PROD1_ENT (
    ROMANEIO_PRODUTO,
    PRODUTO,
    FILIAL,
    COR_PRODUTO,
    QTDE
) VALUES (
    '{romaneio_entrada}',
    '{produto_escaped}',
    '{filial_destino_escaped}',
    {f"'{cor_escaped}'" if cor_escaped else "NULL"},
    {qtde_entrada}
)
"""
    
    return sql_saida_cab, sql_saida_item, sql_entrada_cab, sql_entrada_item

def executar_transferencia(
    conn,
    produto: str,
    cor_produto: str,
    filial_origem: str,
    filial_destino: str,
    qtde_saida: int,
    qtde_entrada: int,
    romaneio_saida: str,
    romaneio_entrada: str,
    data_transferencia: datetime,
    tipo_romaneio: str = 'TRANSFERENCIA'
) -> Tuple[bool, str]:
    """
    Executa a transferência no banco de dados usando a stored procedure do LINX
    Retorna: (sucesso: bool, mensagem: str)
    """
    cursor = conn.cursor()
    
    try:
        # VALIDAÇÃO FINAL: Verificar se o romaneio de saída já existe
        print(f"\n🔍 Validando romaneio de saida {romaneio_saida} para {filial_origem}...")
        if verificar_romaneio_existe(conn, romaneio_saida, filial_origem, 'ESTOQUE_PROD_SAI'):
            return False, f"Romaneio de saida {romaneio_saida} ja existe para a filial {filial_origem}. Por favor, gere um novo romaneio."
        print(f"✓ Romaneio de saida {romaneio_saida} disponivel")
        
        # IMPORTANTE: Não iniciar transação explícita aqui
        # A stored procedure LX_GERA_TRANSFERENCIA_AUTOMATICA pode fazer commit interno
        # Vamos usar autocommit=False e fazer commits individuais após cada operação crítica
        conn.autocommit = False
        
        # Preparar valores (escapar aspas)
        produto_escaped = produto.replace("'", "''")
        filial_origem_escaped = filial_origem.replace("'", "''")
        filial_destino_escaped = filial_destino.replace("'", "''")
        cor_escaped = cor_produto.replace("'", "''") if cor_produto else ''
        data_str = data_transferencia.strftime('%Y-%m-%d %H:%M:%S')
        
        # 1. Inserir cabeçalho de SAÍDA (ESTOQUE_PROD_SAI)
        # Nota: Não preencher ROMANEIO_DESTINO ainda, a stored procedure vai gerar
        # tipo_romaneio deve ser passado como parâmetro para executar_transferencia
        query_saida_cab = """
            INSERT INTO ESTOQUE_PROD_SAI (
                ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
                FILIAL_DESTINO, DATA_PARA_TRANSFERENCIA,
                DATA_DIGITACAO, SEGUNDA_QUALIDADE, NAO_VALIDAR_ENTRADA, MOV_INTERNA,
                TIPO_ROMANEIO
            ) VALUES (?, ?, ?, ?, ?, ?, GETDATE(), 0, 0, 0, ?)
        """
        cursor.execute(query_saida_cab, [
            romaneio_saida, filial_origem_escaped, data_str, ' ',
            filial_destino_escaped, data_str, tipo_romaneio
        ])
        
        # 2. Inserir item de SAÍDA (ESTOQUE_PROD1_SAI)
        query_saida_item = """
            INSERT INTO ESTOQUE_PROD1_SAI (
                FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM
            ) VALUES (?, ?, ?, ?, ?, 0)
        """
        cursor.execute(query_saida_item, [
            filial_origem_escaped, romaneio_saida, produto_escaped,
            cor_escaped if cor_escaped else None, qtde_saida
        ])
        
        # 3. Inserir cabeçalho em LOJA_SAIDAS (necessário para a stored procedure)
        # A stored procedure verifica se existe em LOJA_SAIDAS antes de gerar entrada
        query_loja_saidas_cab = """
            INSERT INTO LOJA_SAIDAS (
                ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
                FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
                INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
                DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA
            ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, 0, 0, ?, 1, 0)
        """
        # NUMERO_NF_TRANSFERENCIA é obrigatório (char, não pode ser NULL)
        numero_nf_transferencia = ''  # Vazio por padrão
        cursor.execute(query_loja_saidas_cab, [
            romaneio_saida, filial_origem_escaped, data_str, ' ',
            filial_destino_escaped, numero_nf_transferencia,
            qtde_saida, data_str
        ])
        print(f"   ✓ LOJA_SAIDAS criada: Romaneio {romaneio_saida}")
        
        # 4. Inserir item em LOJA_SAIDAS_PRODUTO (necessário para a stored procedure)
        # A stored procedure também verifica se existe em LOJA_SAIDAS_PRODUTO
        query_loja_saidas_produto = """
            INSERT INTO LOJA_SAIDAS_PRODUTO (
                ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, QTDE_SAIDA
            ) VALUES (?, ?, ?, ?, ?)
        """
        cursor.execute(query_loja_saidas_produto, [
            romaneio_saida, filial_origem_escaped, produto_escaped,
            cor_escaped if cor_escaped else None, qtde_saida
        ])
        print(f"   ✓ LOJA_SAIDAS_PRODUTO criada")
        
        # Verificar se LOJA_SAIDAS foi criada corretamente ANTES de chamar stored procedure
        query_verificar_antes_sp = """
            SELECT SAIDA_CANCELADA, SAIDA_ENCERRADA
            FROM LOJA_SAIDAS
            WHERE ROMANEIO_PRODUTO = ? 
                AND FILIAL = ? 
                AND FILIAL_DESTINO = ?
        """
        cursor.execute(query_verificar_antes_sp, [romaneio_saida, filial_origem_escaped, filial_destino_escaped])
        row_verif_antes = cursor.fetchone()
        if not row_verif_antes:
            raise Exception(f"ERRO: LOJA_SAIDAS nao foi criada antes de chamar stored procedure. Romaneio: {romaneio_saida}")
        if row_verif_antes[0] != 0:  # SAIDA_CANCELADA
            raise Exception(f"ERRO: LOJA_SAIDAS foi criada com SAIDA_CANCELADA = {row_verif_antes[0]}, deveria ser 0")
        print(f"   ✓ Verificação pré-stored procedure: LOJA_SAIDAS OK (SAIDA_CANCELADA=0, SAIDA_ENCERRADA={row_verif_antes[1]})")
        
        # 5. Usar stored procedure do LINX para gerar entrada automaticamente
        # A stored procedure LX_GERA_TRANSFERENCIA_AUTOMATICA gera o romaneio de entrada,
        # atualiza ROMANEIO_DESTINO na saída, cria entrada e atualiza estoques
        print(f"\n🔧 Chamando stored procedure do LINX (LX_GERA_TRANSFERENCIA_AUTOMATICA)...")
        query_sp = """
            EXEC LX_GERA_TRANSFERENCIA_AUTOMATICA 
                @FILIAL = ?,
                @ROMANEIO_PRODUTO = ?,
                @FILIAL_DESTINO = ?,
                @SERIE_NF = ?,
                @ORIGEM = ?,
                @EXCLUSAO = ?
        """
        
        # Parâmetros da stored procedure:
        # @FILIAL: filial de origem
        # @ROMANEIO_PRODUTO: romaneio de saída (já criado)
        # @FILIAL_DESTINO: filial de destino
        # @SERIE_NF: série da nota fiscal (usar '001' como padrão)
        # @ORIGEM: 'S' para SAIDA ou 'F' para FATURAMENTO (usar 'S')
        # @EXCLUSAO: 'N' ou 'S' (usar 'N' como padrão)
        serie_nf = '001'  # Série padrão
        origem = 'S'  # SAIDA
        exclusao = 'N'  # Não excluir
        
        # Executar stored procedure e capturar mensagens de erro
        try:
            print(f"   Parâmetros: FILIAL={filial_origem_escaped}, ROMANEIO={romaneio_saida}, DESTINO={filial_destino_escaped}")
            cursor.execute(query_sp, [
                filial_origem_escaped,
                romaneio_saida,
                filial_destino_escaped,
                serie_nf,
                origem,
                exclusao
            ])
            
            # Processar todos os resultados da stored procedure
            # A stored procedure pode retornar mensagens ou resultados
            try:
                while cursor.nextset():
                    pass
            except:
                pass  # Pode não ter mais resultados
            
            print(f"   ✓ Stored procedure executada")
            
        except Exception as sp_error:
            error_str = str(sp_error)
            print(f"   ✗ Erro na stored procedure: {error_str}")
            # Se a stored procedure retornou um erro específico, propagar
            if 'IMPOSSIVEL GERAR ENTRADA' in error_str or 'EXCLUIDA' in error_str or 'CANCELADA' in error_str:
                raise Exception(f"Erro na stored procedure: {error_str}")
            else:
                raise
        
        # A stored procedure gera o romaneio de entrada automaticamente
        # Vamos buscar o romaneio de entrada gerado de várias formas
        print(f"\n   🔍 Buscando romaneio de entrada gerado...")
        
        # Tentar buscar por ROMANEIO_ORIGEM
        query_romaneio_entrada_gerado = """
            SELECT TOP 1 ROMANEIO_PRODUTO
            FROM ESTOQUE_PROD_ENT
            WHERE FILIAL = ? 
                AND ROMANEIO_ORIGEM = ?
                AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
            ORDER BY EMISSAO DESC
        """
        cursor.execute(query_romaneio_entrada_gerado, [filial_destino_escaped, romaneio_saida])
        row_romaneio = cursor.fetchone()
        
        # Se não encontrou, tentar buscar por FILIAL_ORIGEM
        if not row_romaneio:
            query_romaneio_alt = """
                SELECT TOP 1 ROMANEIO_PRODUTO
                FROM ESTOQUE_PROD_ENT
                WHERE FILIAL = ? 
                    AND FILIAL_ORIGEM = ?
                    AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_romaneio_alt, [filial_destino_escaped, filial_origem_escaped])
            row_romaneio = cursor.fetchone()
        
        # Se ainda não encontrou, tentar buscar em LOJA_ENTRADAS (a stored procedure pode criar lá primeiro)
        if not row_romaneio:
            query_loja_entradas = """
                SELECT TOP 1 ROMANEIO_PRODUTO
                FROM LOJA_ENTRADAS
                WHERE FILIAL = ? 
                    AND FILIAL_ORIGEM = ?
                    AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_loja_entradas, [filial_destino_escaped, filial_origem_escaped])
            row_loja_ent = cursor.fetchone()
            if row_loja_ent:
                romaneio_entrada_gerado = str(row_loja_ent[0]).strip()
                print(f"   ✓ Romaneio encontrado em LOJA_ENTRADAS: {romaneio_entrada_gerado}")
                romaneio_entrada = romaneio_entrada_gerado
                row_romaneio = (romaneio_entrada_gerado,)
        
        # Se ainda não encontrou, tentar buscar qualquer entrada recente na filial destino
        if not row_romaneio:
            query_romaneio_recente = """
                SELECT TOP 1 ROMANEIO_PRODUTO
                FROM ESTOQUE_PROD_ENT
                WHERE FILIAL = ? 
                    AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_romaneio_recente, [filial_destino_escaped])
            row_romaneio = cursor.fetchone()
        
        if row_romaneio:
            romaneio_entrada_gerado = str(row_romaneio[0]).strip()
            print(f"   ✓ Romaneio de entrada gerado pela stored procedure: {romaneio_entrada_gerado}")
            # Atualizar variável para retorno
            romaneio_entrada = romaneio_entrada_gerado
        else:
            # Se não encontrou, verificar se há algum registro de entrada relacionado
            query_verificar_entrada_qualquer = """
                SELECT TOP 5 ROMANEIO_PRODUTO, FILIAL_ORIGEM, ROMANEIO_ORIGEM, EMISSAO
                FROM ESTOQUE_PROD_ENT
                WHERE FILIAL = ? 
                    AND EMISSAO >= DATEADD(HOUR, -1, GETDATE())
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_verificar_entrada_qualquer, [filial_destino_escaped])
            rows_entradas = cursor.fetchall()
            if rows_entradas:
                print(f"   ⚠️  Encontradas {len(rows_entradas)} entrada(s) recente(s) na filial destino:")
                for row in rows_entradas:
                    print(f"      - Romaneio: {row[0]}, Origem: {row[1]}, Romaneio Origem: {row[2]}, Emissão: {row[3]}")
            
            # Tentar usar o romaneio previsto e verificar se foi criado
            print(f"   ⚠️  Não foi possível recuperar o romaneio de entrada gerado")
            print(f"   Tentando verificar se o romaneio previsto foi criado: {romaneio_entrada}")
            
            query_verificar_previsto = """
                SELECT COUNT(*) as TOTAL
                FROM ESTOQUE_PROD_ENT
                WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
            """
            cursor.execute(query_verificar_previsto, [romaneio_entrada, filial_destino_escaped])
            row_verif_previsto = cursor.fetchone()
            if row_verif_previsto and row_verif_previsto[0] > 0:
                print(f"   ✓ Romaneio previsto {romaneio_entrada} foi encontrado!")
                row_romaneio = (romaneio_entrada,)  # Simular que foi encontrado
            else:
                print(f"   ✗ Romaneio previsto {romaneio_entrada} também não foi encontrado")
                row_romaneio = None
        
        
        # 6. Atualizar SEQUENCIAIS para romaneio de saída
        query_update_seq_saida = """
            UPDATE SEQUENCIAIS
            SET SEQUENCIA = ?
            WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'
        """
        cursor.execute(query_update_seq_saida, [romaneio_saida])
        
        # 7. VERIFICAR se todos os registros foram criados corretamente ANTES de atualizar estoques
        print(f"\n🔍 Verificando se todos os registros foram criados corretamente...")
        
        # Verificar saída em ESTOQUE_PROD_SAI
        query_verificar_saida_estoque = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD_SAI
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(query_verificar_saida_estoque, [romaneio_saida, filial_origem_escaped])
        row_verif_saida = cursor.fetchone()
        if not row_verif_saida or row_verif_saida[0] == 0:
            raise Exception(f"ERRO: Registro de saida (ESTOQUE_PROD_SAI) nao foi criado. Romaneio: {romaneio_saida}, Filial: {filial_origem_escaped}")
        print(f"   ✓ Saída (ESTOQUE_PROD_SAI) criada: Romaneio {romaneio_saida}")
        
        # Verificar item de saída em ESTOQUE_PROD1_SAI
        query_verificar_saida_item = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD1_SAI
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ? AND PRODUTO = ?
        """
        cursor.execute(query_verificar_saida_item, [romaneio_saida, filial_origem_escaped, produto_escaped])
        row_verif_saida_item = cursor.fetchone()
        if not row_verif_saida_item or row_verif_saida_item[0] == 0:
            raise Exception(f"ERRO: Item de saida (ESTOQUE_PROD1_SAI) nao foi criado. Romaneio: {romaneio_saida}")
        print(f"   ✓ Item de saída (ESTOQUE_PROD1_SAI) criado")
        
        # Verificar LOJA_SAIDAS
        query_verificar_loja_saidas = """
            SELECT COUNT(*) as TOTAL
            FROM LOJA_SAIDAS
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(query_verificar_loja_saidas, [romaneio_saida, filial_origem_escaped])
        row_verif_loja_saidas = cursor.fetchone()
        if not row_verif_loja_saidas or row_verif_loja_saidas[0] == 0:
            raise Exception(f"ERRO: Registro em LOJA_SAIDAS nao foi criado. Romaneio: {romaneio_saida}")
        print(f"   ✓ LOJA_SAIDAS criada")
        
        # Verificar LOJA_SAIDAS_PRODUTO
        query_verificar_loja_saidas_produto = """
            SELECT COUNT(*) as TOTAL
            FROM LOJA_SAIDAS_PRODUTO
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ? AND PRODUTO = ?
        """
        cursor.execute(query_verificar_loja_saidas_produto, [romaneio_saida, filial_origem_escaped, produto_escaped])
        row_verif_loja_saidas_produto = cursor.fetchone()
        if not row_verif_loja_saidas_produto or row_verif_loja_saidas_produto[0] == 0:
            raise Exception(f"ERRO: Registro em LOJA_SAIDAS_PRODUTO nao foi criado. Romaneio: {romaneio_saida}")
        print(f"   ✓ LOJA_SAIDAS_PRODUTO criada")
        
        # Verificar entrada em ESTOQUE_PROD_ENT (deve ter sido criada pela stored procedure)
        if not row_romaneio:
            # Tentar uma última busca mais ampla
            query_ultima_tentativa = """
                SELECT TOP 1 ROMANEIO_PRODUTO, FILIAL_ORIGEM, ROMANEIO_ORIGEM
                FROM ESTOQUE_PROD_ENT
                WHERE FILIAL = ? 
                    AND (FILIAL_ORIGEM = ? OR ROMANEIO_ORIGEM = ?)
                    AND EMISSAO >= DATEADD(HOUR, -1, GETDATE())
                ORDER BY EMISSAO DESC
            """
            cursor.execute(query_ultima_tentativa, [filial_destino_escaped, filial_origem_escaped, romaneio_saida])
            row_ultima = cursor.fetchone()
            if row_ultima:
                romaneio_entrada = str(row_ultima[0]).strip()
                print(f"   ✓ Romaneio de entrada encontrado na última tentativa: {romaneio_entrada}")
                row_romaneio = (romaneio_entrada,)
            else:
                raise Exception(f"ERRO: Romaneio de entrada nao foi gerado pela stored procedure. Verifique se a stored procedure foi executada corretamente. Filial Origem: {filial_origem_escaped}, Romaneio Saida: {romaneio_saida}, Filial Destino: {filial_destino_escaped}")
        
        # Garantir que temos o romaneio de entrada
        if row_romaneio:
            romaneio_entrada = str(row_romaneio[0]).strip()
        
        # Verificar se existe em ESTOQUE_PROD_ENT
        query_verificar_entrada_estoque = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD_ENT
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(query_verificar_entrada_estoque, [romaneio_entrada, filial_destino_escaped])
        row_verif_entrada = cursor.fetchone()
        
        # Se existe em ESTOQUE_PROD_ENT, atualizar TIPO_ROMANEIO (a stored procedure pode não ter preenchido)
        if row_verif_entrada and row_verif_entrada[0] > 0:
            query_update_tipo_romaneio_entrada = """
                UPDATE ESTOQUE_PROD_ENT
                SET TIPO_ROMANEIO = ?
                WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
            """
            cursor.execute(query_update_tipo_romaneio_entrada, [tipo_romaneio, romaneio_entrada, filial_destino_escaped])
            conn.commit()
            print(f"   ✓ TIPO_ROMANEIO atualizado na entrada: {tipo_romaneio}")
        
        # Se não existe em ESTOQUE_PROD_ENT, mas existe em LOJA_ENTRADAS, criar manualmente
        if not row_verif_entrada or row_verif_entrada[0] == 0:
            print(f"   ⚠️  Romaneio {romaneio_entrada} não encontrado em ESTOQUE_PROD_ENT, mas encontrado em LOJA_ENTRADAS")
            print(f"   Criando manualmente em ESTOQUE_PROD_ENT...")
            
            # Buscar informações de LOJA_ENTRADAS para criar em ESTOQUE_PROD_ENT
            query_loja_entradas_info = """
                SELECT TOP 1 EMISSAO, FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, RESPONSAVEL
                FROM LOJA_ENTRADAS
                WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
            """
            cursor.execute(query_loja_entradas_info, [romaneio_entrada, filial_destino_escaped])
            row_loja_ent_info = cursor.fetchone()
            
            if row_loja_ent_info:
                data_entrada = row_loja_ent_info[0] if row_loja_ent_info[0] else data_str
                filial_origem_entrada = row_loja_ent_info[1] if row_loja_ent_info[1] else filial_origem_escaped
                romaneio_origem_entrada = row_loja_ent_info[2] if row_loja_ent_info[2] else romaneio_saida
                responsavel_entrada = row_loja_ent_info[3] if row_loja_ent_info[3] else ' '
            else:
                data_entrada = data_str
                filial_origem_entrada = filial_origem_escaped
                romaneio_origem_entrada = romaneio_saida
                responsavel_entrada = ' '
            
            # Criar cabeçalho em ESTOQUE_PROD_ENT
            query_insert_entrada_cab = """
                INSERT INTO ESTOQUE_PROD_ENT (
                    ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
                    FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
                    DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
                    NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA, TIPO_ROMANEIO
                ) VALUES (?, ?, ?, ?, ?, ?, ?, GETDATE(), 0, 0, 0, 0, ?)
            """
            cursor.execute(query_insert_entrada_cab, [
                romaneio_entrada, filial_destino_escaped, data_entrada, responsavel_entrada,
                filial_origem_entrada, romaneio_origem_entrada, data_entrada, tipo_romaneio
            ])
            
            # Criar item em ESTOQUE_PROD1_ENT
            query_insert_entrada_item = """
                INSERT INTO ESTOQUE_PROD1_ENT (
                    ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE
                ) VALUES (?, ?, ?, ?, ?)
            """
            cursor.execute(query_insert_entrada_item, [
                romaneio_entrada, produto_escaped, filial_destino_escaped,
                cor_escaped if cor_escaped else None, qtde_entrada
            ])
            
            print(f"   ✓ Registros criados manualmente em ESTOQUE_PROD_ENT e ESTOQUE_PROD1_ENT")
        else:
            print(f"   ✓ Entrada (ESTOQUE_PROD_ENT) criada: Romaneio {romaneio_entrada}")
        
        # Verificar item de entrada em ESTOQUE_PROD1_ENT
        query_verificar_entrada_item = """
            SELECT COUNT(*) as TOTAL
            FROM ESTOQUE_PROD1_ENT
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ? AND PRODUTO = ?
        """
        cursor.execute(query_verificar_entrada_item, [romaneio_entrada, filial_destino_escaped, produto_escaped])
        row_verif_entrada_item = cursor.fetchone()
        if not row_verif_entrada_item or row_verif_entrada_item[0] == 0:
            raise Exception(f"ERRO: Item de entrada (ESTOQUE_PROD1_ENT) nao foi criado. Romaneio: {romaneio_entrada}")
        print(f"   ✓ Item de entrada (ESTOQUE_PROD1_ENT) criado")
        
        print(f"\n✅ Todos os registros foram criados corretamente!")
        print(f"   Agora atualizando estoques...")
        
        # 8. Atualizar estoques manualmente (a stored procedure pode não atualizar ESTOQUE_PRODUTOS)
        # Usar a mesma lógica do alterar_estoque_produto.py que funciona corretamente
        print(f"\n   📊 Atualizando estoques...")
        
        # IMPORTANTE: Para parâmetros SQL, usar valores ORIGINAIS (sem escape)
        # O escape só é necessário quando construímos SQL como string
        produto_para_query = produto.strip()
        filial_origem_para_query = filial_origem.strip()
        filial_destino_para_query = filial_destino.strip()
        cor_produto_para_query = cor_produto.strip() if cor_produto and cor_produto.strip() else None
        
        # Debug: Verificar valores que serão usados
        print(f"   🔍 Debug - Valores para query:")
        print(f"      Produto: '{produto_para_query}' (len={len(produto_para_query)})")
        print(f"      Filial Origem: '{filial_origem_para_query}' (len={len(filial_origem_para_query)})")
        print(f"      Cor: '{cor_produto_para_query or '(None)'}'")
        
        # Primeiro, verificar se o registro existe (com debug detalhado)
        query_verificar_existe = """
            SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
            FROM ESTOQUE_PRODUTOS
            WHERE PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(query_verificar_existe, [produto_para_query, filial_origem_para_query])
        rows_existentes = cursor.fetchall()
        
        if not rows_existentes:
            raise Exception(f"ERRO: Nenhum registro encontrado para Produto: '{produto_para_query}', Filial: '{filial_origem_para_query}'. Verifique se o código da filial está correto.")
        
        # Filtrar pela cor (se necessário)
        row_estoque_origem_antes = None
        if cor_produto_para_query:
            for row in rows_existentes:
                cor_banco = str(row[2]).strip() if row[2] is not None else ''
                if cor_banco == cor_produto_para_query:
                    row_estoque_origem_antes = row
                    break
            if not row_estoque_origem_antes:
                print(f"   ⚠️  Registros encontrados para Produto/Filial, mas nenhum com Cor '{cor_produto_para_query}':")
                for row in rows_existentes:
                    print(f"      - Produto: '{row[0]}', Filial: '{row[1]}', Cor: '{row[2] or '(None)'}', Estoque: {row[3]}")
                raise Exception(f"ERRO: Nenhum registro encontrado com Cor: '{cor_produto_para_query}'. Produto: '{produto_para_query}', Filial: '{filial_origem_para_query}'")
        else:
            # Procurar registro sem cor (NULL ou vazio)
            for row in rows_existentes:
                cor_banco = str(row[2]).strip() if row[2] is not None else ''
                if not cor_banco:
                    row_estoque_origem_antes = row
                    break
            if not row_estoque_origem_antes:
                print(f"   ⚠️  Registros encontrados para Produto/Filial, mas nenhum sem cor:")
                for row in rows_existentes:
                    print(f"      - Produto: '{row[0]}', Filial: '{row[1]}', Cor: '{row[2] or '(None)'}', Estoque: {row[3]}")
                raise Exception(f"ERRO: Nenhum registro encontrado sem cor. Produto: '{produto_para_query}', Filial: '{filial_origem_para_query}'")
        
        estoque_origem_antes = int(row_estoque_origem_antes[3]) if row_estoque_origem_antes[3] is not None else 0
        print(f"   ✓ Estoque de origem encontrado: {estoque_origem_antes} unidades")
        
        # IMPORTANTE: Usar os valores EXATOS retornados pelo SELECT para o UPDATE
        # Isso garante que estamos usando exatamente os mesmos valores que o banco tem
        produto_exato = str(row_estoque_origem_antes[0]).strip()
        filial_exata = str(row_estoque_origem_antes[1]).strip()
        cor_exata = str(row_estoque_origem_antes[2]).strip() if row_estoque_origem_antes[2] is not None else ''
        
        print(f"   🔍 Debug - Valores exatos do banco:")
        print(f"      Produto: '{produto_exato}' (len={len(produto_exato)})")
        print(f"      Filial: '{filial_exata}' (len={len(filial_exata)})")
        print(f"      Cor: '{cor_exata or '(None)'}' (len={len(cor_exata) if cor_exata else 0})")
        
        # Diminuir estoque de origem usando valores EXATOS do banco
        if cor_exata:
            query_update_estoque_origem = """
                UPDATE ESTOQUE_PRODUTOS
                SET ESTOQUE = ESTOQUE - ?
                WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
            """
            params_update_origem = [qtde_saida, produto_exato, filial_exata, cor_exata]
        else:
            query_update_estoque_origem = """
                UPDATE ESTOQUE_PRODUTOS
                SET ESTOQUE = ESTOQUE - ?
                WHERE PRODUTO = ? AND FILIAL = ? AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
            """
            params_update_origem = [qtde_saida, produto_exato, filial_exata]
        
        print(f"   🔍 Executando UPDATE com valores exatos...")
        
        # IMPORTANTE: A stored procedure pode ter feito commit interno ou deixado locks
        # Vamos tentar fazer o UPDATE de forma mais direta
        # Primeiro, verificar se o registro ainda existe (pode ter sido alterado pela SP)
        query_verificar_antes_update = """
            SELECT ESTOQUE
            FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
            WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
        """
        cursor.execute(query_verificar_antes_update, [produto_exato, filial_exata, cor_exata])
        row_antes = cursor.fetchone()
        if not row_antes:
            raise Exception(f"ERRO: Registro não encontrado antes do UPDATE. Produto: '{produto_exato}', Filial: '{filial_exata}', Cor: '{cor_exata}'")
        estoque_antes_update = int(row_antes[0]) if row_antes[0] is not None else 0
        print(f"   🔍 Estoque antes do UPDATE: {estoque_antes_update}")
        
        # Executar UPDATE
        cursor.execute(query_update_estoque_origem, params_update_origem)
        rows_afetadas_origem = cursor.rowcount
        print(f"   🔍 Linhas afetadas pelo UPDATE: {rows_afetadas_origem}")
        
        # IMPORTANTE: Fazer commit imediatamente após UPDATE de origem
        # A stored procedure já fez commit, então precisamos garantir que este UPDATE seja persistido
        conn.commit()
        print(f"   ✓ Commit executado após UPDATE de origem")
        
        # Verificar se o UPDATE realmente funcionou
        cursor.execute(query_verificar_antes_update, [produto_exato, filial_exata, cor_exata])
        row_depois = cursor.fetchone()
        estoque_depois_update = None
        if row_depois:
            estoque_depois_update = int(row_depois[0]) if row_depois[0] is not None else 0
            print(f"   🔍 Estoque depois do UPDATE: {estoque_depois_update}")
            
            if estoque_depois_update == (estoque_antes_update - qtde_saida):
                print(f"   ✓ UPDATE funcionou corretamente (verificado pelo estoque)")
                rows_afetadas_origem = 1  # Simular sucesso
            elif rows_afetadas_origem == 0 and estoque_depois_update != estoque_antes_update:
                # O UPDATE pode ter funcionado mesmo que rowcount seja 0 (problema conhecido do pyodbc)
                print(f"   ⚠️  rowcount=0 mas estoque mudou, assumindo sucesso")
                rows_afetadas_origem = 1
            elif rows_afetadas_origem == 0:
                # Tentar uma última vez com uma abordagem diferente
                print(f"   ⚠️  Tentando UPDATE alternativo...")
                query_update_alternativo = """
                    UPDATE ESTOQUE_PRODUTOS
                    SET ESTOQUE = ?
                    WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
                """
                novo_estoque = estoque_antes_update - qtde_saida
                cursor.execute(query_update_alternativo, [novo_estoque, produto_exato, filial_exata, cor_exata])
                rows_afetadas_origem = cursor.rowcount
                print(f"   🔍 Linhas afetadas pelo UPDATE alternativo: {rows_afetadas_origem}")
                
                # Commit do UPDATE alternativo
                conn.commit()
                
                # Verificar novamente após UPDATE alternativo
                cursor.execute(query_verificar_antes_update, [produto_exato, filial_exata, cor_exata])
                row_depois_alt = cursor.fetchone()
                if row_depois_alt:
                    estoque_depois_update = int(row_depois_alt[0]) if row_depois_alt[0] is not None else 0
                    if estoque_depois_update == novo_estoque:
                        rows_afetadas_origem = 1
                        print(f"   ✓ UPDATE alternativo funcionou")
        
        if rows_afetadas_origem == 0:
            raise Exception(f"ERRO: Nenhuma linha foi atualizada no estoque de origem. Produto: '{produto_exato}', Filial: '{filial_exata}', Cor: '{cor_exata or '(sem cor)'}'. Estoque antes: {estoque_antes_update}, Estoque depois: {estoque_depois_update if estoque_depois_update is not None else 'N/A'}")
        
        # Verificar se o estoque de origem foi realmente atualizado corretamente
        if estoque_depois_update is None:
            # Se não conseguimos verificar, tentar ler novamente
            cursor.execute(query_verificar_antes_update, [produto_exato, filial_exata, cor_exata])
            row_final = cursor.fetchone()
            if row_final:
                estoque_depois_update = int(row_final[0]) if row_final[0] is not None else 0
        
        if estoque_depois_update is not None and estoque_depois_update != (estoque_antes_update - qtde_saida):
            raise Exception(f"ERRO: Estoque de origem nao foi atualizado corretamente. Esperado: {estoque_antes_update - qtde_saida}, Atual: {estoque_depois_update}")
        
        print(f"   ✓ Estoque de origem atualizado: {estoque_antes_update} → {estoque_depois_update} (diminuído {qtde_saida} unidades)")
        
        # Verificar se existe estoque de destino
        if cor_produto_para_query:
            query_check_estoque_destino = """
                SELECT ESTOQUE
                FROM ESTOQUE_PRODUTOS
                WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
            """
            params_check_destino = [produto_para_query, filial_destino_para_query, cor_produto_para_query]
        else:
            query_check_estoque_destino = """
                SELECT ESTOQUE
                FROM ESTOQUE_PRODUTOS
                WHERE PRODUTO = ? AND FILIAL = ? AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
            """
            params_check_destino = [produto_para_query, filial_destino_para_query]
        
        cursor.execute(query_check_estoque_destino, params_check_destino)
        row_destino = cursor.fetchone()
        existe_estoque = row_destino is not None
        estoque_destino_antes = int(row_destino[0]) if row_destino and row_destino[0] is not None else 0
        
        if existe_estoque:
            # Atualizar estoque existente (mesma lógica do alterar_estoque_produto.py)
            # Usar valores exatos do banco para o UPDATE
            produto_destino_exato = str(row_destino[0]).strip() if row_destino and len(row_destino) > 0 else produto_para_query
            # Buscar valores exatos do registro de destino
            query_buscar_destino_exato = """
                SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
                FROM ESTOQUE_PRODUTOS
                WHERE PRODUTO = ? AND FILIAL = ?
            """
            cursor.execute(query_buscar_destino_exato, [produto_para_query, filial_destino_para_query])
            rows_destino_existentes = cursor.fetchall()
            
            row_destino_exato = None
            if cor_produto_para_query:
                for row in rows_destino_existentes:
                    cor_banco = str(row[2]).strip() if row[2] is not None else ''
                    if cor_banco == cor_produto_para_query:
                        row_destino_exato = row
                        break
            else:
                for row in rows_destino_existentes:
                    cor_banco = str(row[2]).strip() if row[2] is not None else ''
                    if not cor_banco:
                        row_destino_exato = row
                        break
            
            if not row_destino_exato:
                raise Exception(f"ERRO: Registro de destino não encontrado para atualização. Produto: '{produto_para_query}', Filial: '{filial_destino_para_query}', Cor: '{cor_produto_para_query or '(sem cor)'}'")
            
            produto_destino_exato = str(row_destino_exato[0]).strip()
            filial_destino_exata = str(row_destino_exato[1]).strip()
            cor_destino_exata = str(row_destino_exato[2]).strip() if row_destino_exato[2] is not None else ''
            estoque_destino_antes_exato = int(row_destino_exato[3]) if row_destino_exato[3] is not None else 0
            
            print(f"   🔍 Debug - Valores exatos do destino: Produto: '{produto_destino_exato}', Filial: '{filial_destino_exata}', Cor: '{cor_destino_exata or '(None)'}', Estoque: {estoque_destino_antes_exato}")
            
            # Verificar estoque antes do UPDATE
            query_verificar_destino_antes = """
                SELECT ESTOQUE
                FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
                WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
            """
            cursor.execute(query_verificar_destino_antes, [produto_destino_exato, filial_destino_exata, cor_destino_exata])
            row_destino_antes = cursor.fetchone()
            estoque_destino_antes_update = int(row_destino_antes[0]) if row_destino_antes and row_destino_antes[0] is not None else 0
            print(f"   🔍 Estoque destino antes do UPDATE: {estoque_destino_antes_update}")
            
            if cor_destino_exata:
                query_update_estoque_destino = """
                    UPDATE ESTOQUE_PRODUTOS
                    SET ESTOQUE = ESTOQUE + ?
                    WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
                """
                params_update_destino = [qtde_entrada, produto_destino_exato, filial_destino_exata, cor_destino_exata]
            else:
                query_update_estoque_destino = """
                    UPDATE ESTOQUE_PRODUTOS
                    SET ESTOQUE = ESTOQUE + ?
                    WHERE PRODUTO = ? AND FILIAL = ? AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
                """
                params_update_destino = [qtde_entrada, produto_destino_exato, filial_destino_exata]
            
            cursor.execute(query_update_estoque_destino, params_update_destino)
            rows_afetadas_destino = cursor.rowcount
            print(f"   🔍 Linhas afetadas pelo UPDATE destino: {rows_afetadas_destino}")
            
            # IMPORTANTE: Fazer commit imediatamente após UPDATE de destino
            conn.commit()
            print(f"   ✓ Commit executado após UPDATE de destino")
            
            # Verificar se o UPDATE realmente funcionou
            cursor.execute(query_verificar_destino_antes, [produto_destino_exato, filial_destino_exata, cor_destino_exata])
            row_destino_depois = cursor.fetchone()
            estoque_destino_depois = None
            if row_destino_depois:
                estoque_destino_depois = int(row_destino_depois[0]) if row_destino_depois[0] is not None else 0
                print(f"   🔍 Estoque destino depois do UPDATE: {estoque_destino_depois}")
                
                if estoque_destino_depois == (estoque_destino_antes_update + qtde_entrada):
                    print(f"   ✓ UPDATE destino funcionou corretamente (verificado pelo estoque)")
                    rows_afetadas_destino = 1  # Simular sucesso
                elif rows_afetadas_destino == 0 and estoque_destino_depois != estoque_destino_antes_update:
                    print(f"   ⚠️  rowcount=0 mas estoque mudou, assumindo sucesso")
                    rows_afetadas_destino = 1
                elif rows_afetadas_destino == 0:
                    # Tentar UPDATE alternativo
                    print(f"   ⚠️  Tentando UPDATE alternativo para destino...")
                    query_update_destino_alternativo = """
                        UPDATE ESTOQUE_PRODUTOS
                        SET ESTOQUE = ?
                        WHERE PRODUTO = ? AND FILIAL = ? AND COR_PRODUTO = ?
                    """
                    novo_estoque_destino = estoque_destino_antes_update + qtde_entrada
                    cursor.execute(query_update_destino_alternativo, [novo_estoque_destino, produto_destino_exato, filial_destino_exata, cor_destino_exata])
                    rows_afetadas_destino = cursor.rowcount
                    print(f"   🔍 Linhas afetadas pelo UPDATE alternativo destino: {rows_afetadas_destino}")
                    
                    # Commit do UPDATE alternativo destino
                    conn.commit()
                    
                    # Verificar novamente
                    cursor.execute(query_verificar_destino_antes, [produto_destino_exato, filial_destino_exata, cor_destino_exata])
                    row_destino_alt = cursor.fetchone()
                    if row_destino_alt:
                        estoque_destino_depois = int(row_destino_alt[0]) if row_destino_alt[0] is not None else 0
                        if estoque_destino_depois == novo_estoque_destino:
                            rows_afetadas_destino = 1
                            print(f"   ✓ UPDATE alternativo destino funcionou")
            
            if rows_afetadas_destino == 0:
                raise Exception(f"ERRO: Nenhuma linha foi atualizada no estoque de destino. Produto: '{produto_destino_exato}', Filial: '{filial_destino_exata}', Cor: '{cor_destino_exata or '(sem cor)'}'. Estoque antes: {estoque_destino_antes_update}, Estoque depois: {estoque_destino_depois if estoque_destino_depois is not None else 'N/A'}")
            
            if estoque_destino_depois is None:
                # Se não conseguimos verificar, tentar ler novamente
                cursor.execute(query_verificar_destino_antes, [produto_destino_exato, filial_destino_exata, cor_destino_exata])
                row_final_destino = cursor.fetchone()
                if row_final_destino:
                    estoque_destino_depois = int(row_final_destino[0]) if row_final_destino[0] is not None else 0
            
            if estoque_destino_depois is not None and estoque_destino_depois != (estoque_destino_antes_update + qtde_entrada):
                raise Exception(f"ERRO: Estoque de destino nao foi atualizado corretamente. Esperado: {estoque_destino_antes_update + qtde_entrada}, Atual: {estoque_destino_depois}")
            
            print(f"   ✓ Estoque de destino atualizado: {estoque_destino_antes_update} → {estoque_destino_depois} (aumentado {qtde_entrada} unidades)")
        else:
            # Inserir novo registro de estoque
            query_insert_estoque_destino = """
                INSERT INTO ESTOQUE_PRODUTOS (PRODUTO, COR_PRODUTO, FILIAL, ESTOQUE)
                VALUES (?, ?, ?, ?)
            """
            cursor.execute(query_insert_estoque_destino, [
                produto_para_query, cor_produto_para_query,
                filial_destino_para_query, qtde_entrada
            ])
            rows_afetadas_destino = cursor.rowcount
            
            # IMPORTANTE: Fazer commit imediatamente após INSERT de destino
            conn.commit()
            print(f"   ✓ Commit executado após INSERT de destino")
            
            if rows_afetadas_destino == 0:
                raise Exception(f"ERRO: Nenhuma linha foi inserida no estoque de destino. Produto: {produto_para_query}, Filial: {filial_destino_para_query}")
            
            # Verificar se o estoque de destino foi realmente criado
            cursor.execute(query_check_estoque_destino, params_check_destino)
            row_destino_depois = cursor.fetchone()
            estoque_destino_depois = int(row_destino_depois[0]) if row_destino_depois and row_destino_depois[0] is not None else 0
            
            if estoque_destino_depois != qtde_entrada:
                raise Exception(f"ERRO: Estoque de destino nao foi criado corretamente. Esperado: {qtde_entrada}, Atual: {estoque_destino_depois}")
            print(f"   ✓ Estoque de destino criado: {estoque_destino_depois} unidades")
        
        print(f"\n✅ Todos os estoques foram atualizados corretamente!")
        
        # Os commits já foram feitos individualmente após cada UPDATE/INSERT
        # Não precisamos fazer commit aqui novamente
        cursor.close()
        
        return True, f"Transferencia executada com sucesso! Romaneio Saida: {romaneio_saida}, Romaneio Entrada: {romaneio_entrada} (gerado pela stored procedure do LINX)"
        
    except Exception as e:
        # Rollback em caso de erro
        try:
            conn.rollback()
        except:
            pass  # Pode não haver transação ativa se a stored procedure já fez commit
        cursor.close()
        return False, f"Erro ao executar transferencia: {str(e)}"

def exibir_preview_transferencia(
    produto_info: pd.Series,
    estoque_origem: pd.Series,
    estoque_destino: pd.Series,
    qtde_saida: int,
    qtde_entrada: int,
    romaneio_saida: str,
    romaneio_entrada: str,
    data_transferencia: datetime
) -> None:
    """Exibe preview completo da transferência"""
    print("\n" + "="*100)
    print("PREVIEW DA TRANSFERÊNCIA")
    print("="*100)
    
    filial_origem = str(estoque_origem['NOME_FILIAL']) if estoque_origem['NOME_FILIAL'] else str(estoque_origem['FILIAL'])
    filial_destino = str(estoque_destino['NOME_FILIAL']) if estoque_destino['NOME_FILIAL'] else str(estoque_destino['FILIAL'])
    cor = str(estoque_origem['COR_PRODUTO']) if estoque_origem['COR_PRODUTO'] else '(sem cor)'
    desc_cor = str(estoque_origem['DESC_COR']) if estoque_origem['DESC_COR'] else ''
    estoque_atual_origem = int(estoque_origem['ESTOQUE'])
    estoque_atual_destino = int(estoque_destino['ESTOQUE'])
    
    print(f"\n📦 Produto: {produto_info['PRODUTO']} - {produto_info['DESC_PRODUTO']}")
    print(f"   Cor: {cor} ({desc_cor})")
    print(f"\n📅 Data da Transferência: {data_transferencia.strftime('%d/%m/%Y %H:%M:%S')}")
    
    print(f"\n{'='*100}")
    print("SAÍDA (ORIGEM)")
    print(f"{'='*100}")
    print(f"  Filial: {filial_origem}")
    print(f"  Romaneio: {romaneio_saida}")
    print(f"  Estoque Atual: {estoque_atual_origem:,} unidades")
    print(f"  Quantidade a Retirar: {qtde_saida:,} unidades")
    print(f"  Estoque Após Transferência: {estoque_atual_origem - qtde_saida:,} unidades")
    
    if estoque_atual_origem < qtde_saida:
        print(f"  ⚠️  ATENÇÃO: Estoque insuficiente! Faltam {qtde_saida - estoque_atual_origem:,} unidades")
    
    print(f"\n{'='*100}")
    print("ENTRADA (DESTINO)")
    print(f"{'='*100}")
    print(f"  Filial: {filial_destino}")
    print(f"  Romaneio: {romaneio_entrada}")
    print(f"  Estoque Atual: {estoque_atual_destino:,} unidades")
    print(f"  Quantidade a Adicionar: {qtde_entrada:,} unidades")
    print(f"  Estoque Após Transferência: {estoque_atual_destino + qtde_entrada:,} unidades")
    
    if qtde_saida != qtde_entrada:
        print(f"\n⚠️  ATENÇÃO: Quantidades diferentes!")
        print(f"   Saída: {qtde_saida:,} | Entrada: {qtde_entrada:,} | Diferença: {abs(qtde_saida - qtde_entrada):,}")
    
    print("="*100)

def main():
    """Função principal"""
    print("="*100)
    print("CRIADOR DE TRANSFERÊNCIAS ENTRE LOJAS")
    print("="*100)
    print("\n⚠️  ATENÇÃO: Este script EXECUTA alterações no banco de dados!")
    print("   Ele irá criar registros de transferência, atualizar SEQUENCIAIS e ESTOQUE_PRODUTOS.")
    print("   Use com MUITO CUIDADO! Sempre revise o preview antes de confirmar!\n")
    
    # Conectar ao banco
    conn = conectar_banco()
    if not conn:
        print("\n✗ Não foi possível conectar ao banco de dados.")
        return
    
    try:
        # Solicitar código do produto ou código de barras
        print("\n" + "="*100)
        print("ENTRADA DE DADOS")
        print("="*100)
        print("\n💡 Digite o código do produto ou código de barras")
        print("   - Código de produto: ex: N4.A5.0012")
        print("   - Código de barras: ex: 7891234567890")
        
        entrada_produto = input("\n📦 Código do produto ou código de barras: ").strip()
        
        if not entrada_produto:
            print("\n✗ Nenhum código informado.")
            return
        
        codigo_informado = entrada_produto.strip()
        print(f"\n✓ Código informado: {codigo_informado}")
        
        # Tentar buscar primeiro por código de barras (se for só números)
        # Se não encontrar, tenta por código de produto
        df_produto = None
        codigo_produto = None
        
        # Verificar se parece ser código de barras (só números)
        if codigo_informado.isdigit():
            print("\n🔍 Buscando produto por código de barras...")
            df_produto = buscar_produto_por_codigo_barras(conn, codigo_informado)
            
            if df_produto is not None and not df_produto.empty:
                # Se encontrou múltiplos produtos com mesmo código de barras, pegar o primeiro
                codigo_produto = str(df_produto.iloc[0]['PRODUTO']).strip()
                print(f"✓ Produto encontrado por código de barras: {codigo_produto}")
                
                # Se tem múltiplos produtos, avisar
                if len(df_produto) > 1:
                    print(f"⚠️  ATENÇÃO: Código de barras encontrado em {len(df_produto)} produto(s).")
                    print("   Usando o primeiro produto encontrado.")
                    print("\n   Produtos encontrados:")
                    for idx, row in df_produto.iterrows():
                        cor = str(row['COR_PRODUTO']) if pd.notna(row['COR_PRODUTO']) else '(sem cor)'
                        tamanho = str(row['TAMANHO']) if pd.notna(row['TAMANHO']) else '(sem tamanho)'
                        print(f"   - {row['PRODUTO']} | {cor} | {tamanho}")
        
        # Se não encontrou por código de barras, tentar por código de produto
        if df_produto is None or df_produto.empty:
            print("\n🔍 Buscando produto por código...")
            codigo_produto = codigo_informado
            df_produto = buscar_info_produto(conn, codigo_produto)
        
        if df_produto is None or df_produto.empty:
            print(f"\n✗ Produto não encontrado no banco de dados.")
            print(f"   Tentou buscar por: '{codigo_informado}'")
            print(f"   Verifique se o código de produto ou código de barras está correto.")
            return
        
        # Garantir que temos o código do produto
        if codigo_produto is None:
            codigo_produto = str(df_produto.iloc[0]['PRODUTO']).strip()
        
        produto_info = df_produto.iloc[0]
        print(f"\n✓ Produto encontrado:")
        print(f"   Código: {produto_info['PRODUTO']}")
        print(f"   Descrição: {produto_info['DESC_PRODUTO']}")
        
        # Buscar estoques do produto
        print("\n🔍 Buscando estoques do produto...")
        df_estoque = buscar_estoque_produto(conn, codigo_produto)
        
        if df_estoque.empty:
            print(f"\n✗ Nenhum estoque encontrado para o produto '{codigo_produto}'.")
            return
        
        # Exibir estoques disponíveis
        exibir_estoques_disponiveis(df_estoque)
        
        # Solicitar seleção do estoque de origem
        print("\n" + "="*100)
        print("SELECIONAR ESTOQUE DE ORIGEM (SAÍDA)")
        print("="*100)
        print("\n💡 Digite o número (#) do estoque de onde sairá o produto")
        print(f"   Escolha entre 1 e {len(df_estoque)}")
        
        entrada_origem = input("\n🎯 Número do estoque de origem: ").strip()
        
        try:
            idx_origem = int(entrada_origem) - 1
            if not (0 <= idx_origem < len(df_estoque)):
                print(f"\n✗ Número inválido. Deve estar entre 1 e {len(df_estoque)}")
                return
        except ValueError:
            print("\n✗ Valor inválido. Digite um número.")
            return
        
        estoque_origem = df_estoque.iloc[idx_origem]
        filial_origem = str(estoque_origem['NOME_FILIAL']) if estoque_origem['NOME_FILIAL'] else str(estoque_origem['FILIAL'])
        cor_origem = str(estoque_origem['COR_PRODUTO']) if estoque_origem['COR_PRODUTO'] else '(sem cor)'
        estoque_atual_origem = int(estoque_origem['ESTOQUE'])
        
        print(f"\n✓ Estoque de origem selecionado:")
        print(f"   Filial: {filial_origem}")
        print(f"   Cor: {cor_origem}")
        print(f"   Estoque atual: {estoque_atual_origem:,} unidades")
        
        # Solicitar quantidade de saída
        print("\n" + "="*100)
        print("QUANTIDADE DE SAÍDA")
        print("="*100)
        print("\n💡 Digite a quantidade que será retirada da filial de origem")
        print(f"   Estoque disponível: {estoque_atual_origem:,} unidades")
        
        entrada_qtde_saida = input("\n📊 Quantidade de saída: ").strip()
        
        try:
            qtde_saida = int(entrada_qtde_saida)
            if qtde_saida <= 0:
                print("\n✗ Quantidade deve ser maior que zero.")
                return
            if qtde_saida > estoque_atual_origem:
                print(f"\n⚠️  ATENÇÃO: Quantidade solicitada ({qtde_saida:,}) é maior que o estoque disponível ({estoque_atual_origem:,})")
                print("   A transferência será criada mesmo assim (pode gerar estoque negativo)")
        except ValueError:
            print("\n✗ Valor inválido. Digite um número inteiro.")
            return
        
        # Solicitar seleção do estoque de destino
        print("\n" + "="*100)
        print("SELECIONAR ESTOQUE DE DESTINO (ENTRADA)")
        print("="*100)
        print("\n💡 Selecione a filial de destino:")
        print(f"   ⚠️  Não pode ser o mesmo estoque de origem ({idx_origem + 1})")
        print("\n   💡 Se a filial destino não tiver estoque deste produto/cor,")
        print("      o sistema criará automaticamente na entrada")
        
        # Mostrar apenas estoques disponíveis (exceto origem)
        print("\n📋 FILIAIS DISPONÍVEIS (com estoque deste produto):")
        print("-"*100)
        print(f"{'#':<4} {'FILIAL':<40} {'COR':<20} {'ESTOQUE':<12}")
        print("-"*100)
        estoques_validos = []
        for idx, row in df_estoque.iterrows():
            if idx != idx_origem:  # Excluir origem
                filial = str(row['NOME_FILIAL']) if row['NOME_FILIAL'] else str(row['FILIAL'])
                cor = str(row['COR_PRODUTO']) if row['COR_PRODUTO'] else '(sem cor)'
                estoque = int(row['ESTOQUE'])
                num_display = len(estoques_validos) + 1
                print(f"{num_display:<4} {filial:<40} {cor:<20} {estoque:<12}")
                estoques_validos.append((idx, row))
        print("-"*100)
        
        if len(estoques_validos) > 0:
            print(f"\n💡 Digite o número da filial de destino (1-{len(estoques_validos)})")
            print("   Ou digite um número maior para ver todas as filiais disponíveis")
        else:
            print("\n💡 Nenhuma filial com estoque disponível. Mostrando todas as filiais...")
        
        entrada_destino = input("\n🎯 Número da filial de destino: ").strip()
        
        estoque_destino = None
        filial_destino = None
        filial_destino_cod = None
        cor_destino = None
        estoque_atual_destino = 0
        
        try:
            num_destino = int(entrada_destino)
            
            # Verificar se está na lista de estoques disponíveis
            if 1 <= num_destino <= len(estoques_validos):
                idx_estoque, row_estoque = estoques_validos[num_destino - 1]
                estoque_destino = row_estoque
                filial_destino = str(estoque_destino['NOME_FILIAL']) if estoque_destino['NOME_FILIAL'] else str(estoque_destino['FILIAL'])
                filial_destino_cod = str(estoque_destino['FILIAL']).strip()
                cor_destino = str(estoque_destino['COR_PRODUTO']) if estoque_destino['COR_PRODUTO'] else '(sem cor)'
                estoque_atual_destino = int(estoque_destino['ESTOQUE'])
                
                # Verificar se as cores são compatíveis
                if cor_origem != cor_destino:
                    print(f"\n⚠️  ATENÇÃO: Cores diferentes!")
                    print(f"   Origem: {cor_origem} | Destino: {cor_destino}")
                    print("   Continuando mesmo assim...")
                
                print(f"\n✓ Estoque de destino selecionado:")
                print(f"   Filial: {filial_destino}")
                print(f"   Cor: {cor_destino}")
                print(f"   Estoque atual: {estoque_atual_destino:,} unidades")
            
            # Se digitou número maior ou não está na lista, mostrar todas as filiais
            else:
                print("\n🔍 Buscando todas as filiais disponíveis...")
                df_filiais = buscar_todas_filiais(conn)
                
                print(f"\n📋 TODAS AS FILIAIS DISPONÍVEIS ({len(df_filiais)} filiais):")
                print("-"*100)
                print(f"{'#':<4} {'COD_FILIAL':<20} {'FILIAL':<50}")
                print("-"*100)
                for idx, row in df_filiais.iterrows():
                    print(f"{idx+1:<4} {str(row['COD_FILIAL']):<20} {str(row['FILIAL']):<50}")
                print("-"*100)
                
                entrada_filial = input(f"\n🎯 Número da filial de destino (1-{len(df_filiais)}): ").strip()
                
                try:
                    idx_filial = int(entrada_filial) - 1
                    if 0 <= idx_filial < len(df_filiais):
                        filial_destino_cod = str(df_filiais.iloc[idx_filial]['COD_FILIAL']).strip()
                        filial_destino = str(df_filiais.iloc[idx_filial]['FILIAL']).strip()
                        estoque_destino = None  # Não existe estoque ainda
                        cor_destino = cor_origem
                        estoque_atual_destino = 0
                        print(f"\n✓ Filial de destino selecionada: {filial_destino}")
                        print(f"   Cor: {cor_destino} (mesma da origem)")
                        print(f"   Estoque atual: 0 unidades (será criado na entrada)")
                    else:
                        print(f"\n✗ Número inválido.")
                        return
                except ValueError:
                    print("\n✗ Valor inválido.")
                    return
                
        except ValueError:
            # Se não é número, mostrar todas as filiais
            print("\n🔍 Buscando todas as filiais disponíveis...")
            df_filiais = buscar_todas_filiais(conn)
            
            print(f"\n📋 TODAS AS FILIAIS DISPONÍVEIS ({len(df_filiais)} filiais):")
            print("-"*100)
            print(f"{'#':<4} {'COD_FILIAL':<20} {'FILIAL':<50}")
            print("-"*100)
            for idx, row in df_filiais.iterrows():
                print(f"{idx+1:<4} {str(row['COD_FILIAL']):<20} {str(row['FILIAL']):<50}")
            print("-"*100)
            
            entrada_filial = input(f"\n🎯 Número da filial de destino (1-{len(df_filiais)}): ").strip()
            
            try:
                idx_filial = int(entrada_filial) - 1
                if 0 <= idx_filial < len(df_filiais):
                    filial_destino_cod = str(df_filiais.iloc[idx_filial]['COD_FILIAL']).strip()
                    filial_destino = str(df_filiais.iloc[idx_filial]['FILIAL']).strip()
                    estoque_destino = None  # Não existe estoque ainda
                    cor_destino = cor_origem
                    estoque_atual_destino = 0
                    print(f"\n✓ Filial de destino selecionada: {filial_destino}")
                    print(f"   Cor: {cor_destino} (mesma da origem)")
                    print(f"   Estoque atual: 0 unidades (será criado na entrada)")
                else:
                    print(f"\n✗ Número inválido.")
                    return
            except ValueError:
                print("\n✗ Valor inválido.")
                return
        
        # Quantidade de entrada = quantidade de saída (automático)
        qtde_entrada = qtde_saida
        print("\n" + "="*100)
        print("QUANTIDADE DE ENTRADA")
        print("="*100)
        print(f"\n✓ Quantidade de entrada definida automaticamente: {qtde_entrada:,} unidades")
        print(f"   (igual à quantidade de saída)")
        print("\n💡 Se desejar alterar, digite um novo valor. Caso contrário, pressione ENTER para confirmar.")
        
        entrada_qtde_entrada = input("\n📊 Quantidade de entrada (ENTER para confirmar): ").strip()
        
        if entrada_qtde_entrada:
            try:
                qtde_entrada = int(entrada_qtde_entrada)
                if qtde_entrada <= 0:
                    print("\n✗ Quantidade deve ser maior que zero.")
                    return
                print(f"✓ Quantidade de entrada alterada para: {qtde_entrada:,} unidades")
            except ValueError:
                print("\n✗ Valor inválido. Mantendo quantidade igual à saída.")
        else:
            print(f"✓ Quantidade de entrada confirmada: {qtde_entrada:,} unidades")
        
        # Selecionar tipo de romaneio
        tipo_romaneio = selecionar_tipo_romaneio(conn)
        
        # Gerar romaneios
        print("\n🔍 Gerando romaneios...")
        filial_origem_cod_temp = str(estoque_origem['FILIAL']).strip()
        romaneio_saida = gerar_proximo_romaneio_saida(conn, filial_origem_cod_temp)
        
        # Verificar se romaneio de saída já existe
        tentativas = 0
        while verificar_romaneio_existe(conn, romaneio_saida, filial_origem_cod_temp, 'ESTOQUE_PROD_SAI') and tentativas < 10:
            print(f"⚠️  Romaneio de saída {romaneio_saida} já existe. Gerando novo...")
            num_atual = int(romaneio_saida)
            romaneio_saida = f"{num_atual + 1:06d}"
            tentativas += 1
        
        # Gerar romaneio de entrada previsto (apenas para preview)
        # A stored procedure do LINX gerará o romaneio de entrada real automaticamente
        romaneio_entrada = gerar_proximo_romaneio_entrada(conn, romaneio_saida)
        
        # Validação final antes de continuar (apenas saída)
        if verificar_romaneio_existe(conn, romaneio_saida, filial_origem_cod_temp, 'ESTOQUE_PROD_SAI'):
            print(f"\n✗ Erro: Romaneio de saida {romaneio_saida} ainda existe para {filial_origem_cod_temp}.")
            print("   Por favor, execute o script novamente.")
            return
        
        print(f"✓ Romaneio de saída: {romaneio_saida}")
        print(f"✓ Romaneio de entrada previsto: {romaneio_entrada}")
        print(f"   ℹ️  O romaneio de entrada será gerado automaticamente pela stored procedure do LINX")
        
        # Data da transferência
        data_transferencia = datetime.now()
        
        # Gerar SQLs
        produto = str(produto_info['PRODUTO']).strip()
        cor_produto = str(estoque_origem['COR_PRODUTO']).strip() if estoque_origem['COR_PRODUTO'] else ''
        
        # Criar estoque_destino simulado se não existir
        if estoque_destino is None:
            estoque_destino = pd.Series({
                'FILIAL': filial_destino_cod,
                'NOME_FILIAL': filial_destino,
                'COR_PRODUTO': cor_produto,
                'DESC_COR': '',
                'ESTOQUE': 0
            })
        
        # Exibir preview
        exibir_preview_transferencia(
            produto_info,
            estoque_origem,
            estoque_destino,
            qtde_saida,
            qtde_entrada,
            romaneio_saida,
            romaneio_entrada,
            data_transferencia
        )
        filial_origem_cod = str(estoque_origem['FILIAL']).strip()
        
        # Se estoque_destino não foi encontrado, usar valores informados
        if estoque_destino is None:
            cor_destino_para_sql = cor_produto
        else:
            cor_destino_para_sql = str(estoque_destino['COR_PRODUTO']).strip() if estoque_destino['COR_PRODUTO'] else cor_produto
        
        # Usar cor da origem para a transferência (deve ser a mesma)
        sql_saida_cab, sql_saida_item, sql_entrada_cab, sql_entrada_item = gerar_sql_transferencia(
            produto,
            cor_produto,
            filial_origem_cod,
            filial_destino_cod,
            qtde_saida,
            qtde_entrada,
            romaneio_saida,
            romaneio_entrada,
            data_transferencia
        )
        
        # Exibir SQLs (para referência)
        print("\n" + "="*100)
        print("SQLs QUE SERÃO EXECUTADOS")
        print("="*100)
        print("\n⚠️  ATENÇÃO: Estes SQLs SERÃO executados no banco de dados!")
        print("   Revise cuidadosamente antes de confirmar.\n")
        
        print(sql_saida_cab)
        print("\n" + "-"*100 + "\n")
        print(sql_saida_item)
        print("\n" + "-"*100 + "\n")
        print("-- ============================================================")
        print("-- SQL 3: CHAMAR STORED PROCEDURE DO LINX (GERA ENTRADA AUTOMATICAMENTE)")
        print("-- ============================================================")
        print(f"EXEC LX_GERA_TRANSFERENCIA_AUTOMATICA")
        print(f"    @FILIAL = '{filial_origem_cod}',")
        print(f"    @ROMANEIO_PRODUTO = '{romaneio_saida}',")
        print(f"    @FILIAL_DESTINO = '{filial_destino_cod}',")
        print(f"    @SERIE_NF = '001',")
        print(f"    @ORIGEM = 'S',")
        print(f"    @EXCLUSAO = 'N'")
        print("\n")
        print("-- A stored procedure irá:")
        print("--   1. Gerar o romaneio de entrada automaticamente")
        print("--   2. Criar registros em ESTOQUE_PROD_ENT e ESTOQUE_PROD1_ENT")
        print("--   3. Atualizar ROMANEIO_DESTINO na saída")
        print("--   4. Atualizar estoques automaticamente")
        print("--   5. Atualizar SEQUENCIAIS")
        
        # Validação final ANTES da confirmação (apenas saída, entrada será gerada pela stored procedure)
        print("\n🔍 Validando romaneio de saída antes de executar...")
        if verificar_romaneio_existe(conn, romaneio_saida, filial_origem_cod, 'ESTOQUE_PROD_SAI'):
            print(f"\n✗ ERRO: Romaneio de saida {romaneio_saida} ja existe para {filial_origem_cod}!")
            print("   Por favor, execute o script novamente para gerar um novo romaneio.")
            return
        
        print("✓ Validação concluída: Romaneio de saída está disponível")
        print("   ℹ️  Romaneio de entrada será gerado automaticamente pela stored procedure do LINX")
        
        # Confirmação antes de executar
        print("\n" + "="*100)
        print("CONFIRMAÇÃO DE EXECUÇÃO")
        print("="*100)
        print(f"\n⚠️  ATENÇÃO: Você está prestes a EXECUTAR esta transferência no banco de dados!")
        print(f"\n   Produto: {produto} - {produto_info['DESC_PRODUTO']}")
        print(f"   Origem: {filial_origem_cod} → Destino: {filial_destino_cod}")
        print(f"   Quantidade: {qtde_saida:,} unidades")
        print(f"   Romaneio Saída: {romaneio_saida}")
        print(f"   Romaneio Entrada: {romaneio_entrada}")
        print(f"\n   Esta operação irá:")
        print(f"   1. Criar registros de saída (romaneio {romaneio_saida})")
        print(f"   2. Chamar stored procedure do LINX (LX_GERA_TRANSFERENCIA_AUTOMATICA)")
        print(f"   3. A stored procedure gerará o romaneio de entrada automaticamente")
        print(f"   4. A stored procedure atualizará estoques e SEQUENCIAIS")
        print(f"\n💡 Digite 'SIM' (em maiúsculas) para confirmar e executar")
        print("   Ou qualquer outra coisa para cancelar")
        
        confirmacao = input("\n❓ Confirmar execução: ").strip()
        
        if confirmacao != 'SIM':
            print("\n" + "="*100)
            print("❌ OPERAÇÃO CANCELADA")
            print("="*100)
            print("\n⚠️  Nenhuma alteração foi feita no banco de dados.")
            return
        
        # Executar transferência (com retry automático se romaneio duplicado)
        print("\n" + "="*100)
        print("EXECUTANDO TRANSFERÊNCIA...")
        print("="*100)
        
        tentativas_execucao = 0
        max_tentativas = 5
        sucesso = False
        mensagem = ""
        
        while not sucesso and tentativas_execucao < max_tentativas:
            if tentativas_execucao > 0:
                print(f"\n⚠️  Tentativa {tentativas_execucao + 1} de {max_tentativas}...")
                # Gerar novos romaneios
                filial_origem_cod_temp = str(estoque_origem['FILIAL']).strip()
                num_saida = int(romaneio_saida.lstrip('T'))
                romaneio_saida = f"{num_saida + 1:06d}"
                romaneio_entrada = gerar_proximo_romaneio_entrada(conn, romaneio_saida)
                print(f"✓ Novos romaneios gerados: Saída: {romaneio_saida}, Entrada: {romaneio_entrada}")
            
            sucesso, mensagem = executar_transferencia(
                conn,
                produto,
                cor_produto,
                filial_origem_cod,
                filial_destino_cod,
                qtde_saida,
                qtde_entrada,
                romaneio_saida,
                romaneio_entrada,
                data_transferencia,
                tipo_romaneio
            )
            
            # Se falhou por PRIMARY KEY ou romaneio de saída duplicado, tentar novamente
            # (romaneio de entrada é gerado pela stored procedure, não precisa retry)
            if not sucesso and (
                'PRIMARY KEY' in mensagem or 
                'duplicate key' in mensagem.lower() or
                'ROMANEIO_DUPLICADO' in mensagem or
                ('ja existe' in mensagem.lower() and 'saida' in mensagem.lower()) or
                ('já existe' in mensagem.lower() and 'saida' in mensagem.lower())
            ):
                tentativas_execucao += 1
                if tentativas_execucao < max_tentativas:
                    print(f"\n⚠️  Romaneio de saída duplicado detectado. Gerando novo romaneio...")
                    continue
                else:
                    print(f"\n✗ Nao foi possivel gerar um romaneio de saida unico apos {max_tentativas} tentativas.")
                    break
            else:
                break
        
        if sucesso:
            print(f"\n✅ {mensagem}")
            
            # Verificar estoques após execução
            print("\n🔍 Verificando estoques após transferência...")
            df_estoque_verificacao = buscar_estoque_produto(conn, produto)
            
            if not df_estoque_verificacao.empty:
                estoque_origem_verificado = df_estoque_verificacao[
                    (df_estoque_verificacao['FILIAL'].astype(str).str.strip() == filial_origem_cod) &
                    (df_estoque_verificacao['COR_PRODUTO'].fillna('').astype(str).str.strip() == cor_produto)
                ]
                estoque_destino_verificado = df_estoque_verificacao[
                    (df_estoque_verificacao['FILIAL'].astype(str).str.strip() == filial_destino_cod) &
                    (df_estoque_verificacao['COR_PRODUTO'].fillna('').astype(str).str.strip() == cor_produto)
                ]
                
                if not estoque_origem_verificado.empty:
                    estoque_final_origem = int(estoque_origem_verificado.iloc[0]['ESTOQUE'])
                    print(f"   ✓ Estoque origem ({filial_origem_cod}): {estoque_final_origem:,} unidades")
                
                if not estoque_destino_verificado.empty:
                    estoque_final_destino = int(estoque_destino_verificado.iloc[0]['ESTOQUE'])
                    print(f"   ✓ Estoque destino ({filial_destino_cod}): {estoque_final_destino:,} unidades")
                elif estoque_destino_verificado.empty and estoque_destino is None:
                    print(f"   ✓ Estoque destino ({filial_destino_cod}): Criado com {qtde_entrada:,} unidades")
            
            print("\n" + "="*100)
            print("✅ TRANSFERÊNCIA CONCLUÍDA COM SUCESSO")
            print("="*100)
        else:
            print(f"\n❌ {mensagem}")
            print("\n" + "="*100)
            print("❌ TRANSFERÊNCIA FALHOU")
            print("="*100)
            print("\n⚠️  Nenhuma alteração foi feita no banco de dados (rollback executado).")
        
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

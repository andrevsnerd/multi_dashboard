#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para análise detalhada dos KPIs de Controle de Movimento
Mostra produtos que entraram, foram removidos (devoluções), e venderam
"""

import pandas as pd
import pyodbc
from datetime import datetime, timedelta
import sys
from typing import Optional, Tuple

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

def conectar_banco():
    """Conecta ao banco de dados"""
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
            raise

def get_matriz_filial(company: str) -> str:
    """Retorna a filial matriz baseado na empresa"""
    if company == 'scarfme':
        return 'SCARF ME - MATRIZ'
    elif company == 'nerd':
        return 'NERD'
    return None

def get_lojas_normais(conn, company: str) -> list:
    """Retorna lista de lojas normais (não matriz, não ecommerce)"""
    if company == 'scarfme':
        ecommerce = ['SCARFME MATRIZ CMS', 'SCARF ME - MATRIZ LLL']
        todas = [
            'GUARULHOS - RSR', 'IGUATEMI SP - JJJ', 'MORUMBI - JJJ',
            'OSCAR FREIRE - FSZ', 'SCARF ME - HIGIENOPOLIS 2',
            'SCARFME - IBIRAPUERA LLL', 'SCARFME ME - PAULISTA FFF',
            'SCARF ME - PAULISTA RSR', 'SCARF ME - MATRIZ',
            'SCARFME MATRIZ CMS', 'SCARF ME - MATRIZ LLL', 'VILLA LOBOS - LLL'
        ]
        return [f for f in todas if f != 'SCARF ME - MATRIZ' and f not in ecommerce]
    elif company == 'nerd':
        todas = [
            'NERD CENTER NORTE', 'NERD HIGIENOPOLIS', 'NERD LEBLON',
            'NERD MORUMBI RDRRRJ', 'NERD VILLA LOBOS', 'NERD'
        ]
        return [f for f in todas if f != 'NERD']
    return []

def analisar_controle_movimento(
    conn,
    company: str = 'scarfme',
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    filial: Optional[str] = None,
    linhas: Optional[list] = None,
    grupos: Optional[list] = None
):
    """
    Analisa detalhadamente os KPIs de controle de movimento
    """
    # Definir período padrão (mês atual)
    if start_date is None:
        now = datetime.now()
        start_date = datetime(now.year, now.month, 1)
    if end_date is None:
        now = datetime.now()
        end_date = datetime(now.year, now.month + 1, 1)
    
    print("="*100)
    print(f"ANÁLISE DETALHADA - CONTROLE DE MOVIMENTO")
    print("="*100)
    print(f"Empresa: {company.upper()}")
    print(f"Período: {start_date.strftime('%d/%m/%Y')} até {end_date.strftime('%d/%m/%Y')}")
    if filial:
        print(f"Filial: {filial}")
    print()
    
    matriz_filial = get_matriz_filial(company)
    lojas_normais = get_lojas_normais(conn, company)
    categoria_field = 'pr.GRUPO_PRODUTO' if company == 'nerd' else 'pr.LINHA'
    
    # Construir filtros
    linha_filter = ""
    if linhas and company == 'scarfme':
        placeholders = ','.join([f"'{l.upper()}'" for l in linhas])
        linha_filter = f"AND UPPER(LTRIM(RTRIM(ISNULL(pr.LINHA, '')))) IN ({placeholders})"
    
    grupo_filter = ""
    if grupos and company == 'nerd':
        placeholders = ','.join([f"'{g.upper()}'" for g in grupos])
        grupo_filter = f"AND UPPER(LTRIM(RTRIM(ISNULL(pr.GRUPO_PRODUTO, '')))) IN ({placeholders})"
    
    # Aplicar filtro de exclusão de linhas (scarfme)
    exclusion_filter = ""
    if company == 'scarfme':
        excluded_lines = [
            'PRIVATE LABEL', 'GASTRONOMICA', 'PERFUMARIA', 'CASHMERE',
            'ELETRONICOS', 'EMBALAGENS', 'CAPAS E ACESSORIOS P/ CEL'
        ]
        excluded_placeholders = ','.join([f"'{l}'" for l in excluded_lines])
        exclusion_filter = f"AND UPPER(LTRIM(RTRIM(ISNULL(pr.LINHA, '')))) NOT IN ({excluded_placeholders})"
    
    # 1. BUSCAR TODAS AS ENTRADAS NA MATRIZ NO PERÍODO
    print("\n" + "="*100)
    print("1. ENTRADAS NA MATRIZ (ANTES DE REMOVER DEVOLUÇÕES)")
    print("="*100)
    
    query_entradas_brutas = f"""
        SELECT 
            E.EMISSAO,
            E.FILIAL,
            E.ROMANEIO_PRODUTO,
            P.PRODUTO,
            P.COR_PRODUTO,
            pr.DESC_PRODUTO,
            pr.LINHA,
            pr.GRUPO_PRODUTO,
            CAST(P.QTDE AS FLOAT) AS QTDE,
            CAST(P.QTDE AS FLOAT) * ISNULL(pr.CUSTO_REPOSICAO1, 0) AS CUSTO
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
        WHERE pr.PRODUTO IS NOT NULL
            AND E.EMISSAO >= '{start_date.strftime('%Y-%m-%d')}'
            AND E.EMISSAO < '{end_date.strftime('%Y-%m-%d')}'
            AND E.FILIAL = '{matriz_filial}'
            {linha_filter}
            {grupo_filter}
            {exclusion_filter}
            AND {categoria_field} <> ''
            AND {categoria_field} <> 'SEM GRUPO'
            AND {categoria_field} <> 'SEM LINHA'
        ORDER BY E.EMISSAO, P.PRODUTO, P.COR_PRODUTO
    """
    
    df_entradas_brutas = pd.read_sql(query_entradas_brutas, conn)
    print(f"Total de entradas brutas encontradas: {len(df_entradas_brutas):,}")
    print(f"Quantidade total: {df_entradas_brutas['QTDE'].sum():,.0f}")
    print(f"Custo total: R$ {df_entradas_brutas['CUSTO'].sum():,.2f}")
    
    # 2. IDENTIFICAR DEVOLUÇÕES (produtos que retornaram de lojas)
    print("\n" + "="*100)
    print("2. IDENTIFICANDO DEVOLUÇÕES (produtos que retornaram de lojas)")
    print("="*100)
    
    lojas_placeholders = ','.join([f"'{l}'" for l in lojas_normais])
    
    query_devolucoes = f"""
        SELECT DISTINCT
            E.EMISSAO AS DATA_ENTRADA,
            E.ROMANEIO_PRODUTO AS ROMANEIO_ENTRADA,
            P.PRODUTO,
            P.COR_PRODUTO,
            pr.DESC_PRODUTO,
            CAST(P.QTDE AS FLOAT) AS QTDE_ENTRADA,
            S.EMISSAO AS DATA_SAIDA,
            S.ROMANEIO_PRODUTO AS ROMANEIO_SAIDA,
            S.FILIAL AS FILIAL_SAIDA
        FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
        LEFT JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK) ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
        LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
        INNER JOIN ESTOQUE_PROD_SAI AS S WITH (NOLOCK) ON CAST(S.EMISSAO AS DATE) = CAST(E.EMISSAO AS DATE)
        INNER JOIN ESTOQUE_PROD1_SAI AS PS WITH (NOLOCK) ON S.ROMANEIO_PRODUTO = PS.ROMANEIO_PRODUTO
        WHERE pr.PRODUTO IS NOT NULL
            AND E.EMISSAO >= '{start_date.strftime('%Y-%m-%d')}'
            AND E.EMISSAO < '{end_date.strftime('%Y-%m-%d')}'
            AND E.FILIAL = '{matriz_filial}'
            AND PS.PRODUTO = P.PRODUTO
            AND ISNULL(PS.COR_PRODUTO, '') = ISNULL(P.COR_PRODUTO, '')
            AND S.FILIAL IN ({lojas_placeholders})
            {linha_filter}
            {grupo_filter}
            AND {categoria_field} <> ''
            AND {categoria_field} <> 'SEM GRUPO'
            AND {categoria_field} <> 'SEM LINHA'
        ORDER BY E.EMISSAO, P.PRODUTO, P.COR_PRODUTO
    """
    
    df_devolucoes = pd.read_sql(query_devolucoes, conn)
    print(f"Total de devoluções identificadas: {len(df_devolucoes):,}")
    if len(df_devolucoes) > 0:
        print(f"Quantidade devolvida: {df_devolucoes['QTDE_ENTRADA'].sum():,.0f}")
        print("\nPrimeiras 10 devoluções:")
        print(df_devolucoes.head(10).to_string(index=False))
    else:
        print("Nenhuma devolução encontrada.")
    
    # 3. ENTRADAS LÍQUIDAS (após remover devoluções)
    print("\n" + "="*100)
    print("3. ENTRADAS LÍQUIDAS (após remover devoluções)")
    print("="*100)
    
    # Criar chave para identificar devoluções
    if len(df_devolucoes) > 0:
        df_devolucoes['CHAVE'] = (
            df_devolucoes['PRODUTO'].astype(str) + '|' + 
            df_devolucoes['COR_PRODUTO'].fillna('').astype(str) + '|' +
            df_devolucoes['DATA_ENTRADA'].astype(str)
        )
        devolucoes_keys = set(df_devolucoes['CHAVE'])
        
        df_entradas_brutas['CHAVE'] = (
            df_entradas_brutas['PRODUTO'].astype(str) + '|' + 
            df_entradas_brutas['COR_PRODUTO'].fillna('').astype(str) + '|' +
            df_entradas_brutas['EMISSAO'].astype(str)
        )
        
        df_entradas_liquidas = df_entradas_brutas[~df_entradas_brutas['CHAVE'].isin(devolucoes_keys)].copy()
    else:
        df_entradas_liquidas = df_entradas_brutas.copy()
    
    print(f"Total de entradas líquidas: {len(df_entradas_liquidas):,}")
    print(f"Quantidade total: {df_entradas_liquidas['QTDE'].sum():,.0f}")
    print(f"Custo total: R$ {df_entradas_liquidas['CUSTO'].sum():,.2f}")
    
    # 4. PRODUTOS QUE ENTRARAM (para relacionar com vendas)
    print("\n" + "="*100)
    print("4. PRODUTOS ÚNICOS QUE ENTRARAM (PRODUTO + COR)")
    print("="*100)
    
    produtos_entrados = df_entradas_liquidas.groupby(['PRODUTO', 'COR_PRODUTO']).agg({
        'QTDE': 'sum',
        'CUSTO': 'sum',
        'DESC_PRODUTO': 'first',
        'LINHA': 'first',
        'GRUPO_PRODUTO': 'first'
    }).reset_index()
    
    print(f"Total de produtos únicos que entraram: {len(produtos_entrados):,}")
    print(f"Quantidade total: {produtos_entrados['QTDE'].sum():,.0f}")
    print("\nPrimeiros 20 produtos que entraram:")
    print(produtos_entrados.head(20).to_string(index=False))
    
    # 5. VENDAS DOS PRODUTOS QUE ENTRARAM
    print("\n" + "="*100)
    print("5. VENDAS DOS PRODUTOS QUE ENTRARAM NO PERÍODO")
    print("="*100)
    
    produtos_list = produtos_entrados[['PRODUTO', 'COR_PRODUTO']].values.tolist()
    
    if len(produtos_list) > 0:
        # Construir filtro de produtos
        produtos_conditions = []
        for prod, cor in produtos_list:
            cor_str = f"'{cor}'" if pd.notna(cor) and cor != '' else "''"
            produtos_conditions.append(f"(vp.PRODUTO = '{prod}' AND ISNULL(vp.COR_PRODUTO, '') = {cor_str})")
        
        produtos_filter = " OR ".join(produtos_conditions)
        
        # Filtrar por filial se especificado
        filial_filter = ""
        if filial:
            filial_filter = f"AND f.FILIAL = '{filial}'"
        
        query_vendas = f"""
            WITH VendasBase AS (
                SELECT 
                    vp.TICKET,
                    vp.CODIGO_FILIAL,
                    vp.PRODUTO,
                    ISNULL(vp.COR_PRODUTO, '') AS COR_PRODUTO,
                    vp.QTDE,
                    vp.QTDE_CANCELADA,
                    vp.PRECO_LIQUIDO,
                    vp.DESCONTO_VENDA,
                    vp.DATA_VENDA,
                    f.FILIAL
                FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
                LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
                WHERE vp.DATA_VENDA >= '{start_date.strftime('%Y-%m-%d')}'
                    AND vp.DATA_VENDA < '{end_date.strftime('%Y-%m-%d')}'
                    AND vp.QTDE > 0
                    AND ({produtos_filter})
                    {filial_filter}
            ),
            TrocasItem AS (
                SELECT 
                    vt.TICKET,
                    vt.CODIGO_FILIAL,
                    vt.PRODUTO,
                    ISNULL(vt.COR_PRODUTO, '') AS COR_PRODUTO,
                    SUM(vt.QTDE) AS QTDE_TROCA,
                    SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS VALOR_TROCA
                FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
                WHERE vt.QTDE_CANCELADA = 0
                GROUP BY vt.TICKET, vt.CODIGO_FILIAL, vt.PRODUTO, vt.COR_PRODUTO
            ),
            VendasComTrocas AS (
                SELECT 
                    vb.*,
                    ISNULL(ti.QTDE_TROCA, 0) AS QTDE_TROCA,
                    ISNULL(ti.VALOR_TROCA, 0) AS VALOR_TROCA
                FROM VendasBase vb
                LEFT JOIN TrocasItem ti ON ti.TICKET = vb.TICKET 
                    AND ti.CODIGO_FILIAL = vb.CODIGO_FILIAL
                    AND ti.PRODUTO = vb.PRODUTO
                    AND ti.COR_PRODUTO = vb.COR_PRODUTO
            )
            SELECT 
                vct.PRODUTO,
                vct.COR_PRODUTO,
                vct.FILIAL,
                SUM(CASE WHEN vct.QTDE_CANCELADA > 0 THEN 0 ELSE vct.QTDE - ISNULL(vct.QTDE_TROCA, 0) END) AS QTDE_VENDIDA,
                SUM(CASE 
                    WHEN vct.QTDE_CANCELADA > 0 THEN 0 
                    ELSE (vct.PRECO_LIQUIDO * vct.QTDE) - ISNULL(vct.DESCONTO_VENDA, 0) - ISNULL(vct.VALOR_TROCA, 0)
                END) AS VALOR_VENDIDO
            FROM VendasComTrocas vct
            GROUP BY vct.PRODUTO, vct.COR_PRODUTO, vct.FILIAL
            ORDER BY QTDE_VENDIDA DESC
        """
        
        df_vendas = pd.read_sql(query_vendas, conn)
        
        print(f"Total de produtos únicos vendidos: {len(df_vendas):,}")
        print(f"Quantidade total vendida: {df_vendas['QTDE_VENDIDA'].sum():,.0f}")
        print(f"Valor total vendido: R$ {df_vendas['VALOR_VENDIDO'].sum():,.2f}")
        print("\nTop 20 produtos mais vendidos:")
        print(df_vendas.head(20).to_string(index=False))
    else:
        print("Nenhum produto entrou no período, portanto não há vendas para analisar.")
        df_vendas = pd.DataFrame()
    
    # 6. RESUMO FINAL E CÁLCULOS
    print("\n" + "="*100)
    print("6. RESUMO FINAL DOS KPIs")
    print("="*100)
    
    entradas_quantidade = df_entradas_liquidas['QTDE'].sum()
    entradas_custo = df_entradas_liquidas['CUSTO'].sum()
    
    if len(df_vendas) > 0:
        vendidos_quantidade = df_vendas['QTDE_VENDIDA'].sum()
        vendidos_valor = df_vendas['VALOR_VENDIDO'].sum()
    else:
        vendidos_quantidade = 0
        vendidos_valor = 0
    
    itens_parados_quantidade = max(0, entradas_quantidade - vendidos_quantidade)
    custo_medio = entradas_custo / entradas_quantidade if entradas_quantidade > 0 else 0
    itens_parados_custo = itens_parados_quantidade * custo_medio
    
    print(f"\n📊 ENTRADAS DO PERÍODO:")
    print(f"   Quantidade: {entradas_quantidade:,.0f}")
    print(f"   Custo: R$ {entradas_custo:,.2f}")
    
    print(f"\n💰 VENDIDOS:")
    print(f"   Quantidade: {vendidos_quantidade:,.0f}")
    print(f"   Valor: R$ {vendidos_valor:,.2f}")
    
    print(f"\n⏸️  ITENS PARADOS:")
    print(f"   Quantidade: {itens_parados_quantidade:,.0f}")
    print(f"   Custo: R$ {itens_parados_custo:,.2f}")
    
    if entradas_quantidade > 0:
        taxa_venda = (vendidos_quantidade / entradas_quantidade) * 100
        print(f"\n📈 TAXA DE VENDA: {taxa_venda:.2f}%")
    
    # 7. PRODUTOS QUE ENTRARAM MAS NÃO VENDERAM
    print("\n" + "="*100)
    print("7. PRODUTOS QUE ENTRARAM MAS NÃO VENDERAM")
    print("="*100)
    
    if len(df_vendas) > 0:
        vendidos_keys = set(
            df_vendas['PRODUTO'].astype(str) + '|' + 
            df_vendas['COR_PRODUTO'].fillna('').astype(str)
        )
        
        produtos_entrados['CHAVE'] = (
            produtos_entrados['PRODUTO'].astype(str) + '|' + 
            produtos_entrados['COR_PRODUTO'].fillna('').astype(str)
        )
        
        produtos_sem_venda = produtos_entrados[~produtos_entrados['CHAVE'].isin(vendidos_keys)].copy()
        
        print(f"Total de produtos que entraram mas não venderam: {len(produtos_sem_venda):,}")
        print(f"Quantidade total parada: {produtos_sem_venda['QTDE'].sum():,.0f}")
        print(f"Custo total parado: R$ {produtos_sem_venda['CUSTO'].sum():,.2f}")
        
        if len(produtos_sem_venda) > 0:
            print("\nPrimeiros 30 produtos sem venda:")
            print(produtos_sem_venda.head(30)[['PRODUTO', 'COR_PRODUTO', 'DESC_PRODUTO', 'QTDE', 'CUSTO']].to_string(index=False))
    else:
        print("Todos os produtos que entraram não venderam (ou não houve vendas no período).")
        produtos_sem_venda = produtos_entrados.copy()
        print(f"Total: {len(produtos_sem_venda):,} produtos")
        print(f"Quantidade: {produtos_sem_venda['QTDE'].sum():,.0f}")
        print(f"Custo: R$ {produtos_sem_venda['CUSTO'].sum():,.2f}")
    
    print("\n" + "="*100)
    print("ANÁLISE CONCLUÍDA")
    print("="*100)
    
    return {
        'entradas_brutas': df_entradas_brutas,
        'devolucoes': df_devolucoes,
        'entradas_liquidas': df_entradas_liquidas,
        'produtos_entrados': produtos_entrados,
        'vendas': df_vendas,
        'produtos_sem_venda': produtos_sem_venda,
        'kpis': {
            'entradas_quantidade': entradas_quantidade,
            'entradas_custo': entradas_custo,
            'vendidos_quantidade': vendidos_quantidade,
            'vendidos_valor': vendidos_valor,
            'itens_parados_quantidade': itens_parados_quantidade,
            'itens_parados_custo': itens_parados_custo
        }
    }

def main():
    """Função principal"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Analisa KPIs de Controle de Movimento')
    parser.add_argument('--company', choices=['scarfme', 'nerd'], default='scarfme',
                       help='Empresa (scarfme ou nerd)')
    parser.add_argument('--start', type=str, help='Data inicial (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, help='Data final (YYYY-MM-DD)')
    parser.add_argument('--filial', type=str, help='Filial específica')
    parser.add_argument('--linhas', type=str, nargs='+', help='Linhas (scarfme)')
    parser.add_argument('--grupos', type=str, nargs='+', help='Grupos (nerd)')
    
    args = parser.parse_args()
    
    start_date = None
    end_date = None
    
    if args.start:
        start_date = datetime.strptime(args.start, '%Y-%m-%d')
    if args.end:
        end_date = datetime.strptime(args.end, '%Y-%m-%d')
    
    try:
        conn = conectar_banco()
        print("✅ Conectado ao banco de dados\n")
        
        analisar_controle_movimento(
            conn,
            company=args.company,
            start_date=start_date,
            end_date=end_date,
            filial=args.filial,
            linhas=args.linhas,
            grupos=args.grupos
        )
        
        conn.close()
    except Exception as e:
        print(f"❌ Erro: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()

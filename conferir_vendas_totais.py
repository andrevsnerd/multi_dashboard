#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para conferir os dados de VENDAS TOTAIS e período anterior
Compara com a lógica implementada no backend
"""

import sys
import argparse
import pyodbc
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

# Forçar UTF-8 no Windows
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# ============================================
# CONFIGURAÇÕES DO BANCO DE DADOS
# ============================================
DB_SERVER = '177.92.78.250'
DB_DATABASE = 'LINX_PRODUCAO'
DB_USERNAME = 'andre.nerd'
DB_PASSWORD = 'nerd123@'
DB_PORT = '1433'

# Configuração de empresas (mesma do backend)
COMPANIES = {
    'scarfme': {
        'filiais_vendas': [
            'GUARULHOS - RSR',
            'IGUATEMI SP - JJJ',
            'MORUMBI - JJJ',
            'OSCAR FREIRE - FSZ',
            'SCARF ME - HIGIENOPOLIS 2',
            'SCARFME - IBIRAPUERA LLL',
            'SCARFME ME - PAULISTA FFF',
            'SCARF ME - PAULISTA RSR',
            'SCARF ME - MATRIZ',
            'SCARFME MATRIZ CMS',
            'SCARF ME - MATRIZ LLL',
            'VILLA LOBOS - LLL',
        ],
        'filiais_ecommerce': [
            'SCARFME MATRIZ CMS',
            'SCARF ME - MATRIZ LLL',
        ]
    },
    'nerd': {
        'filiais_vendas': [
            'NERD CENTER NORTE',
            'NERD HIGIENOPOLIS',
            'NERD LEBLON',
            'NERD MORUMBI RDRRRJ',
            'NERD VILLA LOBOS',
        ],
        'filiais_ecommerce': []
    }
}

def get_db_connection():
    """Cria conexão com o banco de dados SQL Server"""
    connection_string = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={DB_SERVER},{DB_PORT};"
        f"DATABASE={DB_DATABASE};"
        f"UID={DB_USERNAME};"
        f"PWD={DB_PASSWORD};"
        f"TrustServerCertificate=yes;"
    )
    
    try:
        conn = pyodbc.connect(connection_string, timeout=60)
        return conn
    except Exception as e:
        print(f"❌ Erro ao conectar ao banco de dados: {e}")
        raise

def build_filial_filter(filiais: List[str], prefix: str = 'vp') -> tuple[str, List[str]]:
    """Constrói filtro de filiais para a query (retorna SQL e lista de valores)"""
    if not filiais:
        return '', []
    
    placeholders = ', '.join(['?' for _ in filiais])
    filter_sql = f"AND {prefix}.FILIAL IN ({placeholders})"
    return filter_sql, filiais

def buscar_vendas_varejo(conn, periodo_start: datetime, periodo_end: datetime, 
                        filiais: List[str], grupos: Optional[List[str]] = None,
                        linhas: Optional[List[str]] = None) -> int:
    """Busca vendas de varejo do período"""
    filial_filter, filial_values = build_filial_filter(filiais, 'vp')
    
    # Construir filtros adicionais
    grupo_filter = ''
    grupo_values = []
    if grupos:
        grupo_placeholders = ', '.join(['?' for _ in grupos])
        grupo_filter = f"AND p.GRUPO_PRODUTO IN ({grupo_placeholders})"
        grupo_values = grupos
    
    linha_filter = ''
    linha_values = []
    if linhas:
        linha_placeholders = ', '.join(['?' for _ in linhas])
        linha_filter = f"AND p.LINHA IN ({linha_placeholders})"
        linha_values = linhas
    
    query = f"""
        SELECT 
            SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendasMes
        FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON vp.PRODUTO = p.PRODUTO
        WHERE vp.DATA_VENDA >= ? 
            AND vp.DATA_VENDA < ?
            AND vp.QTDE > 0
            {filial_filter}
            {grupo_filter}
            {linha_filter}
    """
    
    cursor = conn.cursor()
    
    # Preparar parâmetros na ordem correta
    params_list = [periodo_start, periodo_end] + filial_values + grupo_values + linha_values
    
    cursor.execute(query, params_list)
    result = cursor.fetchone()
    return int(result[0] or 0) if result else 0

def buscar_vendas_ecommerce(conn, periodo_start: datetime, periodo_end: datetime,
                           filiais_ecommerce: List[str], grupos: Optional[List[str]] = None,
                           linhas: Optional[List[str]] = None) -> int:
    """Busca vendas de e-commerce do período"""
    if not filiais_ecommerce:
        return 0
    
    filial_filter, filial_values = build_filial_filter(filiais_ecommerce, 'f')
    
    # Construir filtros adicionais
    grupo_filter = ''
    grupo_values = []
    if grupos:
        grupo_placeholders = ', '.join(['?' for _ in grupos])
        grupo_filter = f"AND p.GRUPO_PRODUTO IN ({grupo_placeholders})"
        grupo_values = grupos
    
    linha_filter = ''
    linha_values = []
    if linhas:
        linha_placeholders = ', '.join(['?' for _ in linhas])
        linha_filter = f"AND p.LINHA IN ({linha_placeholders})"
        linha_values = linhas
    
    query = f"""
        SELECT 
            SUM(CAST(fp.QTDE AS FLOAT)) AS vendasMes
        FROM FATURAMENTO f WITH (NOLOCK)
        JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK) 
            ON f.FILIAL = fp.FILIAL AND f.NF_SAIDA = fp.NF_SAIDA AND f.SERIE_NF = fp.SERIE_NF
        LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
        WHERE f.EMISSAO >= ?
            AND f.EMISSAO < ?
            AND f.NOTA_CANCELADA = 0
            AND f.NATUREZA_SAIDA IN ('100.02', '100.022')
            AND CAST(fp.QTDE AS FLOAT) > 0
            {filial_filter}
            {grupo_filter}
            {linha_filter}
    """
    
    cursor = conn.cursor()
    
    # Preparar parâmetros na ordem correta
    params_list = [periodo_start, periodo_end] + filial_values + grupo_values + linha_values
    
    cursor.execute(query, params_list)
    result = cursor.fetchone()
    return int(result[0] or 0) if result else 0

def main():
    """Função principal"""
    parser = argparse.ArgumentParser(description='Conferir dados de VENDAS TOTAIS')
    parser.add_argument('--company', type=str, default='scarfme', choices=['scarfme', 'nerd'],
                       help='Empresa (scarfme ou nerd)')
    parser.add_argument('--start', type=str, default='2026-01-01',
                       help='Data início (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, default='2026-01-20',
                       help='Data fim (YYYY-MM-DD)')
    parser.add_argument('--filial', type=str, default='',
                       help='Filial específica (ou vazio para todas)')
    parser.add_argument('--grupos', type=str, default='',
                       help='Grupos separados por vírgula')
    parser.add_argument('--linhas', type=str, default='',
                       help='Linhas separadas por vírgula')
    
    args = parser.parse_args()
    
    print("=" * 80)
    print("CONFERÊNCIA DE VENDAS TOTAIS")
    print("=" * 80)
    print()
    
    # Parâmetros de entrada
    company = args.company
    if company not in COMPANIES:
        print(f"❌ Empresa '{company}' não encontrada!")
        return
    
    # Período atual
    periodo_start_str = args.start
    periodo_end_str = args.end
    
    try:
        periodo_start = datetime.strptime(periodo_start_str, '%Y-%m-%d')
        periodo_start = periodo_start.replace(hour=0, minute=0, second=0, microsecond=0)
        
        # Para incluir o dia final, usar o início do dia seguinte (exclusivo)
        # Se o período é 01 a 20, usar 21 00:00:00 (exclusivo) para incluir todo o dia 20
        periodo_end = datetime.strptime(periodo_end_str, '%Y-%m-%d')
        periodo_end = periodo_end.replace(hour=0, minute=0, second=0, microsecond=0)
        # Adicionar 1 dia para tornar exclusivo (inclui todo o dia final)
        from datetime import timedelta
        periodo_end = periodo_end + timedelta(days=1)
    except ValueError as e:
        print(f"❌ Erro ao parsear datas: {e}")
        return
    
    # Calcular período anterior: mesmos dias do mês anterior
    # Se período atual é 01/01 a 20/01, período anterior é 01/12 a 20/12
    if periodo_start.month == 1:
        periodo_anterior_start = periodo_start.replace(month=12, year=periodo_start.year - 1)
    else:
        periodo_anterior_start = periodo_start.replace(month=periodo_start.month - 1)
    
    if periodo_end.month == 1:
        periodo_anterior_end = periodo_end.replace(month=12, year=periodo_end.year - 1)
    else:
        periodo_anterior_end = periodo_end.replace(month=periodo_end.month - 1)
    
    # Calcular duração para exibição
    duracao = periodo_end - periodo_start
    
    print()
    print("=" * 80)
    print("PERÍODOS")
    print("=" * 80)
    print(f"Período Atual:")
    print(f"  Início: {periodo_start.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Fim:    {periodo_end.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Duração: {duracao.days + 1} dias")
    print()
    print(f"Período Anterior:")
    print(f"  Início: {periodo_anterior_start.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Fim:    {periodo_anterior_end.strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Duração: {duracao.days + 1} dias")
    print()
    
    # Filtros opcionais
    filial_selecionada = args.filial.strip()
    grupos_input = args.grupos.strip()
    linhas_input = args.linhas.strip()
    
    grupos = [g.strip() for g in grupos_input.split(',')] if grupos_input else None
    linhas = [l.strip() for l in linhas_input.split(',')] if linhas_input else None
    
    # Determinar filiais a usar
    company_config = COMPANIES[company]
    if filial_selecionada:
        filiais_vendas = [filial_selecionada]
        filiais_ecommerce = [f for f in company_config['filiais_ecommerce'] if f == filial_selecionada]
    else:
        # Excluir filiais de e-commerce da query de varejo
        filiais_ecommerce = company_config['filiais_ecommerce']
        filiais_vendas = [f for f in company_config['filiais_vendas'] if f not in filiais_ecommerce]
    
    print()
    print("=" * 80)
    print("CONFIGURAÇÃO")
    print("=" * 80)
    print(f"Empresa: {company}")
    print(f"Filiais Varejo: {', '.join(filiais_vendas)}")
    if filiais_ecommerce:
        print(f"Filiais E-commerce: {', '.join(filiais_ecommerce)}")
    if grupos:
        print(f"Grupos: {', '.join(grupos)}")
    if linhas:
        print(f"Linhas: {', '.join(linhas)}")
    print()
    
    # Conectar ao banco
    print("Conectando ao banco de dados...")
    try:
        conn = get_db_connection()
        print("✅ Conectado!")
    except Exception as e:
        print(f"❌ Erro: {e}")
        return
    
    print()
    print("=" * 80)
    print("RESULTADOS")
    print("=" * 80)
    
    # Buscar vendas do período atual
    print("\n📊 PERÍODO ATUAL:")
    print("-" * 80)
    
    vendas_varejo_atual = buscar_vendas_varejo(conn, periodo_start, periodo_end, 
                                               filiais_vendas, grupos, linhas)
    print(f"Vendas Varejo: {vendas_varejo_atual:,} un")
    
    vendas_ecommerce_atual = 0
    if filiais_ecommerce and company == 'scarfme':
        vendas_ecommerce_atual = buscar_vendas_ecommerce(conn, periodo_start, periodo_end,
                                                         filiais_ecommerce, grupos, linhas)
        print(f"Vendas E-commerce: {vendas_ecommerce_atual:,} un")
    
    vendas_total_atual = vendas_varejo_atual + vendas_ecommerce_atual
    print(f"\n✅ TOTAL PERÍODO ATUAL: {vendas_total_atual:,} un")
    
    # Buscar vendas do período anterior
    print("\n📊 PERÍODO ANTERIOR:")
    print("-" * 80)
    
    vendas_varejo_anterior = buscar_vendas_varejo(conn, periodo_anterior_start, periodo_anterior_end,
                                                  filiais_vendas, grupos, linhas)
    print(f"Vendas Varejo: {vendas_varejo_anterior:,} un")
    
    vendas_ecommerce_anterior = 0
    if filiais_ecommerce and company == 'scarfme':
        vendas_ecommerce_anterior = buscar_vendas_ecommerce(conn, periodo_anterior_start, periodo_anterior_end,
                                                           filiais_ecommerce, grupos, linhas)
        print(f"Vendas E-commerce: {vendas_ecommerce_anterior:,} un")
    
    vendas_total_anterior = vendas_varejo_anterior + vendas_ecommerce_anterior
    print(f"\n✅ TOTAL PERÍODO ANTERIOR: {vendas_total_anterior:,} un")
    
    # Calcular variação
    print("\n📈 VARIAÇÃO:")
    print("-" * 80)
    if vendas_total_anterior > 0:
        variacao = ((vendas_total_atual - vendas_total_anterior) / vendas_total_anterior) * 100
        print(f"Variação: {variacao:+.2f}%")
        print(f"Diferença: {vendas_total_atual - vendas_total_anterior:+,} un")
    else:
        print("Variação: N/A (período anterior sem vendas)")
    
    print()
    print("=" * 80)
    print("RESUMO")
    print("=" * 80)
    print(f"Período Atual ({periodo_start.strftime('%Y-%m-%d')} a {periodo_end.strftime('%Y-%m-%d')}):")
    print(f"  Varejo:      {vendas_varejo_atual:>12,} un")
    if vendas_ecommerce_atual > 0:
        print(f"  E-commerce:  {vendas_ecommerce_atual:>12,} un")
    print(f"  TOTAL:       {vendas_total_atual:>12,} un")
    print()
    print(f"Período Anterior ({periodo_anterior_start.strftime('%Y-%m-%d')} a {periodo_anterior_end.strftime('%Y-%m-%d')}):")
    print(f"  Varejo:      {vendas_varejo_anterior:>12,} un")
    if vendas_ecommerce_anterior > 0:
        print(f"  E-commerce:  {vendas_ecommerce_anterior:>12,} un")
    print(f"  TOTAL:       {vendas_total_anterior:>12,} un")
    print()
    
    conn.close()
    print("✅ Conferência concluída!")

if __name__ == '__main__':
    main()

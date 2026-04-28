#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Relatório: produtos com entrada no período (por empresa e filiais)
e classificação: venderam / venderam e estoque zero / não venderam.

- Empresa: NERD ou Scarfme (filiais vêm do nerd_geral ou scarfme_geral).
- Período: mês/ano início e mês/ano fim (vazio = até hoje).
- Saída: XLSX com abas Entradas_periodo, Venderam, Venderam_estoque_zero, Nao_venderam.

Fontes de entradas (alinhado ao log de transferencia-produtos e investigações):
  1) ESTOQUE_PROD_ENT + ESTOQUE_PROD1_ENT (romaneios oficiais)
  2) LOJA_ENTRADAS + LOJA_ENTRADAS_PRODUTO (ex.: transferências) apenas onde NÃO existe
     em ESTOQUE_PROD_ENT, com ENTRADA_CANCELADA = 0 ou NULL.
Dados obtidos por queries no banco quando há conexão; caso contrário fallback para CSV
(data/entradas.csv contém só fonte 1 — pode faltar itens de transferência).
"""

import os
import re
import sys
import argparse
import logging
import warnings
import pandas as pd
from datetime import datetime

# Reduz ruído: pyodbc é suportado por read_sql; concat com colunas vazias é intencional
warnings.filterwarnings('ignore', message='.*SQLAlchemy connectable.*', category=UserWarning, module='pandas')
warnings.filterwarnings('ignore', message='.*DataFrame concatenation with empty or all-NA.*', category=FutureWarning, module='pandas')

# Logging: arquivo em relatorios/logs/ e console em nível INFO
LOG_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'relatorios', 'logs')

# Símbolos ASCII para console Windows (evita UnicodeEncodeError)
_OK, _ERRO, _AVISO = "[OK]", "[X]", "[!]"
try:
    if sys.stdout.encoding and 'utf' in sys.stdout.encoding.lower():
        _OK, _ERRO, _AVISO = "\u2713", "\u2717", "\u26a0"
except Exception:
    pass


def _configurar_log(empresa=None, periodo=None):
    """Configura logging para arquivo e console. Retorna o logger."""
    os.makedirs(LOG_DIR, exist_ok=True)
    log_file = os.path.join(LOG_DIR, 'relatorio_entradas_vendas_estoque.log')
    fmt = '%(asctime)s | %(levelname)s | %(message)s'
    date_fmt = '%Y-%m-%d %H:%M:%S'

    logger = logging.getLogger('relatorio_entradas')
    logger.setLevel(logging.DEBUG)
    if logger.handlers:
        logger.handlers.clear()

    fh = logging.FileHandler(log_file, encoding='utf-8')
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(fmt, datefmt=date_fmt))
    logger.addHandler(fh)

    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(fmt, datefmt=date_fmt))
    logger.addHandler(ch)

    logger.info("Início do relatório entradas/vendas/estoque")
    if empresa:
        logger.info("Empresa: %s", empresa)
    if periodo:
        logger.info("Período: %s", periodo)
    logger.debug("Log gravado em: %s", log_file)
    return logger


# Config banco (mesma do exportador / entradas_nerd_mes / investigar_log_entradas_saidas)
DB_CONFIG = {
    'server': os.environ.get('DB_SERVER', '177.92.78.250'),
    'server_fallback': os.environ.get('DB_SERVER_FALLBACK', '189.126.197.82'),
    'database': os.environ.get('DB_DATABASE', 'LINX_PRODUCAO'),
    'username': os.environ.get('DB_USERNAME', 'andre.nerd'),
    'password': os.environ.get('DB_PASSWORD', 'nerd123@'),
}

# Filiais e filial de entrada (matriz) — alinhado a lib/config/company.ts
# Entrada: contabilizar apenas na matriz (evita duplicar quando vai para as lojas).
# Filiais consideradas: mesmas do sistema (vendas, estoque, classificação).

# NERD: entrada só em "NERD"; lojas = 5 filiais ativas (sem NERD TIJUCA, sem matriz nas lojas)
FILIAL_ENTRADA_NERD = 'NERD'
FILIAIS_NERD_LOJAS = [
    'NERD CENTER NORTE',
    'NERD HIGIENOPOLIS',
    'NERD LEBLON',
    'NERD MORUMBI RDRRRJ',
    'NERD MORUMBI RDRX',
    'NERD VILLA LOBOS',
]

# Scarfme: entrada só em "SCARF ME - MATRIZ"; filiais = inventory do company.ts
FILIAL_ENTRADA_SCARFME = 'SCARF ME - MATRIZ'
FILIAIS_SCARFME = [
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
    'MSC COMERCIO DE LENCOS LT',
]


def _normalizar_filial(s):
    if pd.isna(s):
        return ''
    return str(s).replace('\xa0', ' ').strip()


def _filiais_por_empresa(empresa):
    """
    Retorna (filiais_entrada_set, filiais_lojas_set) alinhado a lib/config/company.ts.
    - filiais_entrada: apenas a matriz onde a entrada é contabilizada (NERD ou SCARF ME - MATRIZ).
    - filiais_lojas: filiais consideradas no sistema (vendas, estoque, resumo).
    """
    if empresa == 'nerd':
        entrada = {_normalizar_filial(FILIAL_ENTRADA_NERD)}
        lojas = {_normalizar_filial(x) for x in FILIAIS_NERD_LOJAS}
        return entrada, lojas
    # scarfme
    entrada = {_normalizar_filial(FILIAL_ENTRADA_SCARFME)}
    lojas = {_normalizar_filial(x) for x in FILIAIS_SCARFME}
    return entrada, lojas


def _log():
    """Retorna o logger do relatório (pode não estar configurado)."""
    return logging.getLogger('relatorio_entradas')


def conectar_banco():
    """Conecta ao SQL Server. Retorna conexão ou None se falhar."""
    log = _log()
    try:
        import pyodbc
    except ImportError:
        log.warning("pyodbc não instalado; entradas apenas via CSV")
        return None
    for nome, servidor in [('principal', DB_CONFIG['server']), ('fallback', DB_CONFIG['server_fallback'])]:
        try:
            conn_str = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={servidor};DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            log.info("Conexão com banco OK (servidor: %s)", nome)
            return conn
        except Exception as e:
            log.debug("Falha %s (%s): %s", nome, servidor, e)
            continue
    log.warning("Não foi possível conectar a nenhum servidor de banco")
    return None


def fetch_entradas_banco(conn, data_ini, data_fim, filiais_set):
    """
    Busca entradas no período e nas filiais indicadas de DUAS fontes (sem duplicar):
    1) ESTOQUE_PROD_ENT + ESTOQUE_PROD1_ENT
    2) LOJA_ENTRADAS + LOJA_ENTRADAS_PRODUTO (apenas romaneios que NÃO existem em ESTOQUE_PROD_ENT,
       com ENTRADA_CANCELADA = 0 ou NULL).
    Retorna DataFrame com: EMISSAO, FILIAL, PRODUTO, COR_PRODUTO, QTDE_TOTAL, DESC_PRODUTO,
    GRUPO_PRODUTO, SUBGRUPO_PRODUTO, LINHA.
    """
    if not filiais_set:
        return pd.DataFrame()
    filiais_list = list(filiais_set)
    placeholders = ','.join(['?'] * len(filiais_list))
    ts_ini = pd.Timestamp(data_ini).strftime('%Y-%m-%d')
    ts_fim = pd.Timestamp(data_fim).strftime('%Y-%m-%d 23:59:59.999')

    # Fonte 1: ESTOQUE_PROD_ENT + ESTOQUE_PROD1_ENT + PRODUTOS
    q1 = f"""
    SELECT E.EMISSAO, LTRIM(RTRIM(E.FILIAL)) AS FILIAL, P.PRODUTO, ISNULL(P.COR_PRODUTO, '') AS COR_PRODUTO,
           CAST(ISNULL(P.QTDE, 0) AS FLOAT) AS QTDE_TOTAL,
           pr.DESC_PRODUTO, pr.GRUPO_PRODUTO, pr.SUBGRUPO_PRODUTO, pr.LINHA
    FROM ESTOQUE_PROD_ENT AS E WITH (NOLOCK)
    INNER JOIN ESTOQUE_PROD1_ENT AS P WITH (NOLOCK)
        ON E.ROMANEIO_PRODUTO = P.ROMANEIO_PRODUTO
    LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = P.PRODUTO
    WHERE E.EMISSAO >= ? AND E.EMISSAO <= ?
      AND LTRIM(RTRIM(E.FILIAL)) IN ({placeholders})
      AND P.PRODUTO IS NOT NULL
    """
    params1 = [ts_ini, ts_fim] + filiais_list
    df1 = pd.read_sql(q1, conn, params=params1)
    _log().debug("Fonte ESTOQUE_PROD_ENT: %d linhas", len(df1))

    # Fonte 2: LOJA_ENTRADAS + LOJA_ENTRADAS_PRODUTO (sem correspondência em ESTOQUE_PROD_ENT)
    q2 = f"""
    SELECT LE.EMISSAO, LTRIM(RTRIM(LE.FILIAL)) AS FILIAL, LEP.PRODUTO,
           ISNULL(LEP.COR_PRODUTO, '') AS COR_PRODUTO,
           CAST(ISNULL(LEP.QTDE_ENTRADA, 0) AS FLOAT) AS QTDE_TOTAL,
           pr.DESC_PRODUTO, pr.GRUPO_PRODUTO, pr.SUBGRUPO_PRODUTO, pr.LINHA
    FROM LOJA_ENTRADAS AS LE WITH (NOLOCK)
    INNER JOIN LOJA_ENTRADAS_PRODUTO AS LEP WITH (NOLOCK)
        ON LEP.FILIAL = LE.FILIAL AND LEP.ROMANEIO_PRODUTO = LE.ROMANEIO_PRODUTO
    LEFT JOIN PRODUTOS pr WITH (NOLOCK) ON pr.PRODUTO = LEP.PRODUTO
    WHERE LE.EMISSAO >= ? AND LE.EMISSAO <= ?
      AND LTRIM(RTRIM(LE.FILIAL)) IN ({placeholders})
      AND LEP.PRODUTO IS NOT NULL
      AND (LE.ENTRADA_CANCELADA = 0 OR LE.ENTRADA_CANCELADA IS NULL)
      AND NOT EXISTS (
        SELECT 1 FROM ESTOQUE_PROD_ENT E WITH (NOLOCK)
        WHERE E.ROMANEIO_PRODUTO = LE.ROMANEIO_PRODUTO
          AND LTRIM(RTRIM(E.FILIAL)) = LTRIM(RTRIM(LE.FILIAL))
      )
    """
    params2 = [ts_ini, ts_fim] + filiais_list
    df2 = pd.read_sql(q2, conn, params=params2)
    _log().debug("Fonte LOJA_ENTRADAS: %d linhas", len(df2))

    df1['PRODUTO'] = df1['PRODUTO'].astype(str).str.strip()
    df1['COR_PRODUTO'] = df1['COR_PRODUTO'].astype(str).str.strip()
    df2['PRODUTO'] = df2['PRODUTO'].astype(str).str.strip()
    df2['COR_PRODUTO'] = df2['COR_PRODUTO'].astype(str).str.strip()
    out = pd.concat([df1, df2], ignore_index=True)
    out['EMISSAO'] = pd.to_datetime(out['EMISSAO'], errors='coerce')
    out['FILIAL'] = out['FILIAL'].astype(str).apply(_normalizar_filial)
    _log().info("Entradas totais (banco): %d linhas (ESTOQUE_PROD_ENT=%d + LOJA_ENTRADAS=%d)", len(out), len(df1), len(df2))
    return out


def obter_empresa():
    print("\n" + "="*60)
    print("EMPRESA")
    print("="*60)
    print("1) NERD")
    print("2) Scarfme")
    print("-"*60)
    escolha = input("Escolha [1/2]: ").strip().upper()
    if escolha in ('2', 'SCARFME', 'S'):
        return 'scarfme'
    return 'nerd'


def obter_periodo():
    print("\n" + "="*60)
    print("PERÍODO (mês/ano)")
    print("="*60)
    hoje = datetime.now()
    print("Entradas contabilizadas: a partir da data INÍCIO até a data FIM (inclusive).")
    print("Ex.: início 01-2026, fim 02-2026 → entradas de jan e fev/2026.")
    print("Fim em branco = até hoje.")
    print("-"*60)
    ini = input("Mês/Ano início = a partir de (MM-AAAA) [01-2026]: ").strip() or "01-2026"
    fim = input("Mês/Ano fim = até (MM-AAAA ou vazio = até hoje): ").strip()

    def parse_mm_aaaa(s):
        if not s or not s.strip():
            return None
        s = s.strip()
        m = re.match(r'(\d{1,2})\s*[-/]\s*(\d{4})', s)
        if not m:
            return None
        mes, ano = int(m.group(1)), int(m.group(2))
        if 1 <= mes <= 12 and 2000 <= ano <= 2100:
            return datetime(ano, mes, 1)
        return None

    data_ini = parse_mm_aaaa(ini)
    if not data_ini:
        print(f"{_ERRO} Data início inválida. Usando 01-2026.")
        data_ini = datetime(2026, 1, 1)
    data_fim = parse_mm_aaaa(fim) if fim else None
    if data_fim is None and fim:
        print(f"{_ERRO} Data fim inválida. Usando até hoje.")
    if data_fim is None:
        data_fim = hoje  # até hoje
    else:
        from calendar import monthrange
        data_fim = data_fim.replace(day=monthrange(data_fim.year, data_fim.month)[1])
    return data_ini, data_fim


def carregar_dados_csv(data_dir):
    """Carrega vendas, ecommerce e estoque a partir de data/ (CSV). Não carrega entradas."""
    vendas = pd.DataFrame()
    ecommerce = pd.DataFrame()
    estoque = pd.DataFrame()

    path_vendas = os.path.join(data_dir, 'vendas_tratadas.csv')
    path_ecommerce = os.path.join(data_dir, 'ecommerce.csv')
    path_estoque = os.path.join(data_dir, 'estoque_tratados.csv')

    if os.path.exists(path_vendas):
        vendas = pd.read_csv(path_vendas, sep=';', encoding='utf-8-sig',
                             dtype={'PRODUTO': str, 'COR_PRODUTO': str}, low_memory=False)
        vendas['DATA_VENDA'] = pd.to_datetime(vendas['DATA_VENDA'], errors='coerce')
        vendas['FILIAL'] = vendas['FILIAL'].astype(str).apply(_normalizar_filial)
        vendas['QTDE'] = pd.to_numeric(vendas['QTDE'].astype(str).str.replace(',', '.', regex=False), errors='coerce').fillna(0)
        print(f"{_OK} Vendas: {len(vendas):,}")
    if os.path.exists(path_ecommerce):
        ecommerce = pd.read_csv(path_ecommerce, sep=';', encoding='utf-8-sig',
                                dtype={'PRODUTO': str, 'COR_PRODUTO': str}, low_memory=False)
        if 'DATA_SAIDA' in ecommerce.columns:
            ecommerce['DATA_VENDA'] = pd.to_datetime(ecommerce['DATA_SAIDA'], errors='coerce')
        else:
            ecommerce['DATA_VENDA'] = pd.to_datetime(ecommerce.get('EMISSAO', pd.NaT), errors='coerce')
        ecommerce['FILIAL'] = ecommerce['FILIAL'].astype(str).apply(_normalizar_filial)
        ecommerce['QTDE'] = pd.to_numeric(ecommerce['QTDE'].astype(str).str.replace(',', '.', regex=False), errors='coerce').fillna(0)
        print(f"{_OK} E-commerce: {len(ecommerce):,}")
    if not os.path.exists(path_estoque):
        print(f"{_ERRO} Arquivo não encontrado: {path_estoque}")
        return vendas, ecommerce, estoque
    estoque = pd.read_csv(path_estoque, sep=';', encoding='utf-8-sig',
                          dtype={'PRODUTO': str, 'COR_PRODUTO': str}, low_memory=False)
    estoque['FILIAL'] = estoque['FILIAL'].astype(str).apply(_normalizar_filial)
    estoque['ESTOQUE'] = pd.to_numeric(estoque['ESTOQUE'].astype(str).str.replace(',', '.', regex=False), errors='coerce').fillna(0)
    print(f"{_OK} Estoque: {len(estoque):,}")
    return vendas, ecommerce, estoque


def carregar_entradas_csv(data_dir):
    """Carrega apenas entradas a partir de data/entradas.csv (fallback; só fonte ESTOQUE_PROD_ENT)."""
    path_entradas = os.path.join(data_dir, 'entradas.csv')
    if not os.path.exists(path_entradas):
        return pd.DataFrame()
    entradas = pd.read_csv(path_entradas, sep=';', encoding='utf-8-sig',
                           dtype={'PRODUTO': str, 'COR_PRODUTO': str}, low_memory=False)
    entradas['EMISSAO'] = pd.to_datetime(entradas['EMISSAO'], errors='coerce')
    entradas['FILIAL'] = entradas['FILIAL'].astype(str).apply(_normalizar_filial)
    # Garantir colunas usadas pelo relatório (enriquecimento pode vir do exportador)
    for col in ('DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'LINHA'):
        if col not in entradas.columns:
            entradas[col] = ''
    if 'QTDE_TOTAL' not in entradas.columns and 'QTDE' in entradas.columns:
        entradas['QTDE_TOTAL'] = pd.to_numeric(entradas['QTDE'].astype(str).str.replace(',', '.', regex=False), errors='coerce').fillna(0)
    return entradas


def produtos_com_entrada_no_periodo(entradas, filiais_set, data_ini, data_fim):
    """
    Retorna DataFrame com um registro por (PRODUTO, COR_PRODUTO) que teve entrada
    no período e nas filiais indicadas.
    Período: a partir de data_ini até data_fim (inclusive).
    """
    if entradas.empty:
        return pd.DataFrame()
    mask_filial = entradas['FILIAL'].isin(filiais_set)
    # Contabiliza entradas no intervalo [data_ini, data_fim] (inclusive)
    mask_data = (entradas['EMISSAO'] >= pd.Timestamp(data_ini)) & (entradas['EMISSAO'] <= pd.Timestamp(data_fim))
    entradas_periodo = entradas.loc[mask_filial & mask_data].copy()
    if entradas_periodo.empty:
        return pd.DataFrame()
    entradas_periodo['PRODUTO'] = entradas_periodo['PRODUTO'].astype(str).str.strip()
    entradas_periodo['COR_PRODUTO'] = entradas_periodo['COR_PRODUTO'].astype(str).str.strip()
    # Uma linha por produto+cor com dados agregados da entrada (primeira descrição, soma qtde)
    agg = entradas_periodo.groupby(['PRODUTO', 'COR_PRODUTO'], observed=True).agg({
        'DESC_PRODUTO': 'first',
        'QTDE_TOTAL': 'sum',
        'EMISSAO': 'min',  # primeira entrada no período
        'GRUPO_PRODUTO': 'first',
        'SUBGRUPO_PRODUTO': 'first',
        'LINHA': 'first',
    }).reset_index()
    agg = agg.rename(columns={'EMISSAO': 'PRIMEIRA_ENTRADA_PERIODO', 'QTDE_TOTAL': 'QTDE_ENTRADA_PERIODO'})
    return agg


def produtos_que_venderam(vendas, ecommerce, filiais_set, empresa):
    """
    Set de (PRODUTO, COR_PRODUTO) que tiveram pelo menos uma venda (QTDE > 0) nas filiais.
    Para Scarfme considera vendas + ecommerce.
    """
    chaves = set()
    for df in (vendas, ecommerce):
        if df is None or df.empty or 'QTDE' not in df.columns:
            continue
        if empresa == 'nerd' and df is ecommerce:
            continue
        df_f = df[df['FILIAL'].isin(filiais_set) & (df['QTDE'] > 0)]
        if df_f.empty:
            continue
        df_f = df_f.copy()
        df_f['PRODUTO'] = df_f['PRODUTO'].astype(str).str.strip()
        df_f['COR_PRODUTO'] = df_f['COR_PRODUTO'].astype(str).str.strip()
        for _, row in df_f.iterrows():
            chaves.add((row['PRODUTO'], row['COR_PRODUTO']))
    return chaves


def estoque_atual_por_produto_cor(estoque, filiais_set):
    """
    DataFrame com colunas PRODUTO, COR_PRODUTO, ESTOQUE_TOTAL (soma nas filiais).
    """
    if estoque.empty or not filiais_set:
        return pd.DataFrame()
    est = estoque[estoque['FILIAL'].isin(filiais_set)].copy()
    est['PRODUTO'] = est['PRODUTO'].astype(str).str.strip()
    est['COR_PRODUTO'] = est['COR_PRODUTO'].astype(str).str.strip()
    est = est.groupby(['PRODUTO', 'COR_PRODUTO'], observed=True)['ESTOQUE'].sum().reset_index()
    est = est.rename(columns={'ESTOQUE': 'ESTOQUE_TOTAL'})
    return est


def _parse_periodo_arg(ini_str, fim_str):
    """Converte strings MM-AAAA em (data_ini, data_fim). Retorna None se inválido."""
    def parse(s):
        if not s or not s.strip():
            return None
        m = re.match(r'(\d{1,2})\s*[-/]\s*(\d{4})', s.strip())
        if not m:
            return None
        mes, ano = int(m.group(1)), int(m.group(2))
        if 1 <= mes <= 12 and 2000 <= ano <= 2100:
            return datetime(ano, mes, 1)
        return None
    data_ini = parse(ini_str)
    if not data_ini:
        return None, None
    if not fim_str or not str(fim_str).strip():
        from calendar import monthrange
        data_fim = data_ini.replace(day=monthrange(data_ini.year, data_ini.month)[1])
        return data_ini, data_fim
    data_fim = parse(fim_str)
    if not data_fim:
        return data_ini, None
    from calendar import monthrange
    data_fim = data_fim.replace(day=monthrange(data_fim.year, data_fim.month)[1])
    return data_ini, data_fim


def run(empresa=None, data_ini=None, data_fim=None):
    """
    Executa o relatório. Se empresa/data_ini/data_fim forem None, pede interativamente.
    """
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(script_dir, 'data')
    os.makedirs(data_dir, exist_ok=True)

    if empresa is None:
        empresa = obter_empresa()
    if data_ini is None or data_fim is None:
        data_ini, data_fim = obter_periodo()
    periodo_str = f"{data_ini.strftime('%d/%m/%Y')} a {data_fim.strftime('%d/%m/%Y')}"
    _configurar_log(empresa=empresa, periodo=periodo_str)

    print(f"\nPeríodo: {periodo_str}")

    log = _log()
    print("\nCarregando dados...")
    log.debug("Carregando CSV: vendas, ecommerce, estoque")
    vendas, ecommerce, estoque = carregar_dados_csv(data_dir)
    if estoque.empty:
        log.error("Estoque não carregado")
        print(f"{_ERRO} Estoque não carregado. Verifique data/estoque_tratados.csv.")
        return

    # Filiais: entrada só na matriz (evita duplicar); lojas = listas do sistema (lib/config/company.ts)
    filiais_entrada_set, filiais_lojas_set = _filiais_por_empresa(empresa)
    sorted_filiais = sorted(filiais_lojas_set)
    print(f"{_OK} Filial de entrada (matriz): {list(filiais_entrada_set)[0] if filiais_entrada_set else '-'}")
    print(f"{_OK} Filiais consideradas (lojas): {len(sorted_filiais)}")

    # Entradas: apenas na matriz (NERD ou SCARF ME - MATRIZ)
    conn = conectar_banco()
    if conn is not None:
        try:
            entradas = fetch_entradas_banco(conn, data_ini, data_fim, filiais_entrada_set)
            if not entradas.empty:
                print(f"{_OK} Entradas (banco: ESTOQUE_PROD_ENT + LOJA_ENTRADAS): {len(entradas):,}")
        except Exception as e:
            log.warning("Erro ao buscar entradas no banco: %s. Usando CSV.", e)
            print(f"{_AVISO} Erro ao buscar entradas no banco: {e}. Usando CSV.")
            entradas = carregar_entradas_csv(data_dir)
            if not entradas.empty:
                entradas = entradas[entradas['FILIAL'].isin(filiais_entrada_set)].copy()
                log.info("Entradas (CSV, só matriz): %d linhas", len(entradas))
                print(f"{_OK} Entradas (CSV - apenas ESTOQUE_PROD_ENT, filial matriz): {len(entradas):,}")
            else:
                entradas = pd.DataFrame()
        finally:
            conn.close()
    else:
        entradas = carregar_entradas_csv(data_dir)
        if not entradas.empty:
            entradas = entradas[entradas['FILIAL'].isin(filiais_entrada_set)].copy()
            log.info("Entradas (CSV, só matriz): %d linhas", len(entradas))
            print(f"{_OK} Entradas (CSV - apenas ESTOQUE_PROD_ENT, filial matriz): {len(entradas):,}")
        else:
            log.error("Nenhuma entrada carregada")
            print(f"{_ERRO} Nenhuma entrada carregada. Conecte ao banco ou gere data/entradas.csv.")

    if entradas.empty:
        log.error("Nenhuma entrada disponível para o período/filiais")
        print(f"{_ERRO} Nenhuma entrada disponivel para o periodo/filiais.")
        return

    log.debug("Agregando produtos com entrada no período (entradas já só da matriz)")
    df_entradas = produtos_com_entrada_no_periodo(entradas, filiais_entrada_set, data_ini, data_fim)
    if df_entradas.empty:
        log.warning("Nenhum produto com entrada no período nas filiais selecionadas")
        print(f"{_ERRO} Nenhum produto com entrada no periodo nas filiais selecionadas.")
        return
    log.info("Produtos (PRODUTO+COR) com entrada no período: %d", len(df_entradas))
    print(f"{_OK} Produtos (PRODUTO+COR) com entrada no periodo: {len(df_entradas):,}")

    chaves_entrada = set(zip(df_entradas['PRODUTO'], df_entradas['COR_PRODUTO']))
    chaves_venderam = produtos_que_venderam(vendas, ecommerce, filiais_lojas_set, empresa)
    # Estoque atual: lojas + matriz (NERD e SCARF ME - MATRIZ entram no estoque)
    filiais_estoque_set = filiais_lojas_set | filiais_entrada_set
    df_estoque = estoque_atual_por_produto_cor(estoque, filiais_estoque_set)
    estoque_zero = set()
    if not df_estoque.empty:
        estoque_zero = set(
            zip(
                df_estoque.loc[df_estoque['ESTOQUE_TOTAL'] <= 0, 'PRODUTO'],
                df_estoque.loc[df_estoque['ESTOQUE_TOTAL'] <= 0, 'COR_PRODUTO']
            )
        )

    # Classificar
    venderam = chaves_entrada & chaves_venderam
    venderam_estoque_zero = venderam & estoque_zero
    nao_venderam = chaves_entrada - chaves_venderam

    # DataFrames para exportar (enriquecer com descrição e estoque)
    def df_from_chaves(chaves, df_base, label):
        if not chaves:
            return pd.DataFrame()
        df = df_base[df_base.apply(lambda r: (r['PRODUTO'], r['COR_PRODUTO']) in chaves, axis=1)].copy()
        if not df_estoque.empty:
            df = df.merge(df_estoque, on=['PRODUTO', 'COR_PRODUTO'], how='left')
            df['ESTOQUE_TOTAL'] = df['ESTOQUE_TOTAL'].fillna(0)
        return df

    df_todos = df_entradas.copy()
    if not df_estoque.empty:
        df_todos = df_todos.merge(df_estoque, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        df_todos['ESTOQUE_TOTAL'] = df_todos['ESTOQUE_TOTAL'].fillna(0)
    df_todos['VENDEU'] = df_todos.apply(lambda r: (r['PRODUTO'], r['COR_PRODUTO']) in chaves_venderam, axis=1)
    df_todos['ESTOQUE_ZERO'] = df_todos.apply(lambda r: (r['PRODUTO'], r['COR_PRODUTO']) in estoque_zero, axis=1)

    df_venderam = df_entradas[df_entradas.apply(lambda r: (r['PRODUTO'], r['COR_PRODUTO']) in venderam, axis=1)].copy()
    if not df_estoque.empty:
        df_venderam = df_venderam.merge(df_estoque, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        df_venderam['ESTOQUE_TOTAL'] = df_venderam['ESTOQUE_TOTAL'].fillna(0)

    df_venderam_zero = df_entradas[df_entradas.apply(lambda r: (r['PRODUTO'], r['COR_PRODUTO']) in venderam_estoque_zero, axis=1)].copy()
    if not df_estoque.empty:
        df_venderam_zero = df_venderam_zero.merge(df_estoque, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        df_venderam_zero['ESTOQUE_TOTAL'] = df_venderam_zero['ESTOQUE_TOTAL'].fillna(0)

    df_nao_venderam = df_entradas[df_entradas.apply(lambda r: (r['PRODUTO'], r['COR_PRODUTO']) in nao_venderam, axis=1)].copy()
    if not df_estoque.empty:
        df_nao_venderam = df_nao_venderam.merge(df_estoque, on=['PRODUTO', 'COR_PRODUTO'], how='left')
        df_nao_venderam['ESTOQUE_TOTAL'] = df_nao_venderam['ESTOQUE_TOTAL'].fillna(0)

    # Aba Resumo (mesmo conteúdo do log + filiais consideradas)
    periodo_str = f"{data_ini.strftime('%d/%m/%Y')} a {data_fim.strftime('%d/%m/%Y')}"
    df_resumo = pd.DataFrame([
        ['Empresa', empresa.upper()],
        ['Período', periodo_str],
        ['Filial de entrada (matriz)', list(filiais_entrada_set)[0] if filiais_entrada_set else '-'],
        ['', ''],
        ['Entradas no período (produto+cor)', len(df_todos)],
        ['Venderam', len(df_venderam)],
        ['Venderam e estoque zero', len(df_venderam_zero)],
        ['Não venderam', len(df_nao_venderam)],
        ['', ''],
    ], columns=['Campo', 'Valor'])

    # Salvar XLSX
    relatorios_dir = os.path.join(script_dir, 'relatorios')
    os.makedirs(relatorios_dir, exist_ok=True)
    nome_base = f"entradas_vendas_estoque_{empresa}_{data_ini:%Y%m}_{data_fim:%Y%m}"
    arquivo = os.path.join(relatorios_dir, f"{nome_base}.xlsx")

    def escrever_xlsx(writer):
        df_resumo.to_excel(writer, sheet_name='Resumo', index=False)
        # Lista de filiais logo abaixo do resumo (resumo = linhas 1-9, filiais a partir da 10)
        sheet = writer.sheets['Resumo']
        next_row = 10  # linha após as 8 linhas de dados + header
        if sorted_filiais:
            sheet.cell(row=next_row, column=1, value=f'Filiais consideradas ({len(sorted_filiais)})')
            for i, filial in enumerate(sorted_filiais, start=1):
                sheet.cell(row=next_row + i, column=1, value=filial)
        df_todos.to_excel(writer, sheet_name='Entradas_periodo', index=False)
        df_venderam.to_excel(writer, sheet_name='Venderam', index=False)
        df_venderam_zero.to_excel(writer, sheet_name='Venderam_estoque_zero', index=False)
        df_nao_venderam.to_excel(writer, sheet_name='Nao_venderam', index=False)

    try:
        with pd.ExcelWriter(arquivo, engine='openpyxl') as writer:
            escrever_xlsx(writer)
        log.info("Arquivo salvo: %s", arquivo)
        print(f"\n{_OK} Salvo: {arquivo}")
    except PermissionError:
        arquivo = os.path.join(relatorios_dir, f"{nome_base}_{datetime.now():%Y%m%d_%H%M%S}.xlsx")
        with pd.ExcelWriter(arquivo, engine='openpyxl') as writer:
            escrever_xlsx(writer)
        print(f"\n{_OK} Arquivo em uso; salvo como: {arquivo}")

    log.info("Resumo: entradas_periodo=%d | venderam=%d | venderam_estoque_zero=%d | nao_venderam=%d",
             len(df_todos), len(df_venderam), len(df_venderam_zero), len(df_nao_venderam))
    print("\nResumo:")
    print(f"  Entradas no período (produto+cor): {len(df_todos):,}")
    print(f"  Venderam: {len(df_venderam):,}")
    print(f"  Venderam e estoque zero: {len(df_venderam_zero):,}")
    print(f"  Não venderam: {len(df_nao_venderam):,}")
    print("="*60)


def main():
    parser = argparse.ArgumentParser(
        description='Relatório entradas/vendas/estoque (por empresa e período). '
                    'Sem argumentos: modo interativo.'
    )
    parser.add_argument('--test', action='store_true', help='Modo teste: usa empresa e período dos argumentos')
    parser.add_argument('--empresa', choices=['nerd', 'scarfme', '1', '2'], help='Empresa: nerd/1 ou scarfme/2')
    parser.add_argument('--ini', default='01-2026', help='Mês/ano início (MM-AAAA), ex: 01-2026')
    parser.add_argument('--fim', default='', help='Mês/ano fim (MM-AAAA ou vazio = até hoje)')
    args = parser.parse_args()

    if args.test or args.empresa is not None:
        empresa = 'scarfme' if args.empresa in ('2', 'scarfme') else 'nerd'
        data_ini, data_fim = _parse_periodo_arg(args.ini, args.fim or None)
        if data_ini is None:
            print(f"{_ERRO} Periodo invalido. Use --ini MM-AAAA e opcionalmente --fim MM-AAAA")
            sys.exit(1)
        run(empresa=empresa, data_ini=data_ini, data_fim=data_fim)
    else:
        run()


if __name__ == '__main__':
    main()

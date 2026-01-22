#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script simples para exportar estoque de subgrupos específicos (ScarfMe)
Busca os subgrupos+grades mais similares no banco e retorna apenas o estoque deles
"""

import sys
import pyodbc
import pandas as pd
from datetime import datetime
from difflib import SequenceMatcher

# Configuração de conexão
DB_CONFIG = {
    'server': '177.92.78.250',
    'server_fallback': '189.126.197.82',
    'database': 'LINX_PRODUCAO',
    'username': 'andre.nerd',
    'password': 'nerd123@'
}

# Filiais habilitadas ScarfMe
FILIAIS_SCARFME = [
    'GUARULHOS - RSR', 'IGUATEMI SP - JJJ', 'MORUMBI - JJJ', 'OSCAR FREIRE - FSZ',
    'SCARF ME - HIGIENOPOLIS 2', 'SCARFME - IBIRAPUERA LLL', 'SCARFME ME - PAULISTA FFF',
    'SCARF ME - PAULISTA RSR', 'SCARF ME - MATRIZ', 'SCARFME MATRIZ CMS',
    'SCARF ME - MATRIZ LLL', 'VILLA LOBOS - LLL',
]

# Lista de subgrupo + grade (ignorar "TECIDO" - é só rótulo)
ITENS_BUSCAR = [
    ('PASHMINA DE LÃ', '70X180'),
    ('CASHMERE 100%', '70X200'),
    ('BANDA ALGODÃO', '65X65'),
    ('ARGOLA', 'ÚNICO'),
    ('CASH DIAMANTE', '70X200'),
    ('CASH ZARI', '70X200'),
    ('CETIM POLIESTER', '50X50'),
    ('CETIM POLIESTER', '70X70'),
    ('CETIM POLIESTER', '8X130'),
    ('CETIM POLIESTER', '90X90'),
    ('CREPE DE SEDA', 'P M G'),
    ('GEORGETE', '130X200'),
    ('PASH ARABESCO', '70X200'),
    ('MOUSS POLI', '45X210'),
    ('MOUSS POLI', '130X130'),
    ('TWILL DE SEDA', '90X90'),
    ('TWILL DE SEDA', '65X65'),
    ('VISCOSE PANNEAU', '130X200'),
    ('PASH VISCOSE', '70X180'),
    ('PASH VISCOSE', '35X180'),
    ('ACESSÓRIOS', 'ÚNICO'),
    ('VISCOSE', 'P M G'),
    ('CETIM SEDA', '8X130'),
    ('CETIM SEDA', '40X40'),
]


def similaridade(a, b):
    return SequenceMatcher(None, str(a).upper().strip(), str(b).upper().strip()).ratio()


def normalizar_grade(grade):
    """Normaliza grade para comparação (remove espaços, normaliza formatos)"""
    grade = str(grade).upper().strip()
    # Remover todos os espaços para comparação
    grade_sem_espacos = grade.replace(' ', '').replace('/', '').replace('-', '').replace('X', 'X')
    # Normalizar "ÚNICO" / "UNICO"
    if grade_sem_espacos in ['ÚNICO', 'UNICO']:
        return 'UNICO'
    # Normalizar "P M G" / "P/M/G" / "P-M-G" / "PMG"
    if 'P' in grade_sem_espacos and 'M' in grade_sem_espacos and 'G' in grade_sem_espacos:
        return 'P M G'
    # Para grades numéricas, normalizar removendo espaços (ex: "70 X 200" -> "70X200")
    return grade_sem_espacos


def conectar_banco():
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome})...")
            conn_str = (f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                       f"SERVER={servidor};DATABASE={DB_CONFIG['database']};"
                       f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};"
                       f"Connection Timeout=30;")
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"✓ Conectado ({servidor})")
            return conn
        except Exception as e:
            print(f"✗ Erro: {e}")
            if nome == 'principal':
                print("⚠ Tentando fallback...")
    
    print("✗ Falha em todos os servidores")
    sys.exit(1)


def buscar_subgrupos_grades_banco(conn):
    """Busca todos os subgrupos e grades únicos do banco"""
    print("\n[BUSCA] Carregando subgrupos e grades do banco...")
    
    query = """
        SELECT DISTINCT
            UPPER(LTRIM(RTRIM(ISNULL(SUBGRUPO_PRODUTO, '')))) AS SUBGRUPO,
            UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, GRADE), '')))) AS GRADE
        FROM PRODUTOS WITH (NOLOCK)
        WHERE UPPER(LTRIM(RTRIM(ISNULL(SUBGRUPO_PRODUTO, '')))) <> ''
          AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, GRADE), '')))) <> ''
    """
    
    df = pd.read_sql(query, conn)
    print(f"✓ Encontrados {len(df)} combinações subgrupo+grade no banco")
    
    # Debug: mostrar quantos subgrupos têm grade 70X200 (normalizada)
    df['GRADE_NORM'] = df['GRADE'].apply(normalizar_grade)
    grade_70x200_norm = normalizar_grade('70X200')
    subgrupos_70x200 = df[df['GRADE_NORM'] == grade_70x200_norm]['SUBGRUPO'].unique()
    if len(subgrupos_70x200) > 0:
        print(f"  [DEBUG] Grade 70X200 (normalizada: '{grade_70x200_norm}') encontrada em {len(subgrupos_70x200)} subgrupo(s): {', '.join(subgrupos_70x200)}")
    
    return df


def encontrar_matches(itens_buscar, df_banco):
    """Para cada item da lista, encontra o match mais similar no banco
    PRIMEIRO filtra por grade, DEPOIS escolhe o subgrupo mais similar"""
    print("\n[MATCH] Encontrando correspondências...")
    
    # Normalizar grades do banco
    df_banco['GRADE_NORM'] = df_banco['GRADE'].apply(normalizar_grade)
    df_banco_list = df_banco[['SUBGRUPO', 'GRADE', 'GRADE_NORM']].values.tolist()
    
    matches = []
    
    for subgrupo_fornecido, grade_fornecido in itens_buscar:
        grade_fornecido_norm = normalizar_grade(grade_fornecido)
        
        # PASSO 1: Filtrar por GRADE primeiro - buscar EXATAMENTE a mesma grade (após normalização)
        subgrupos_com_grade_correta = []
        for subgrupo_banco, grade_banco, grade_banco_norm in df_banco_list:
            # Comparação EXATA após normalização
            if grade_fornecido_norm == grade_banco_norm:
                subgrupos_com_grade_correta.append({
                    'subgrupo': subgrupo_banco,
                    'grade': grade_banco,
                    'grade_norm': grade_banco_norm
                })
        
        # Se não encontrou exato, tentar muito similar (>= 98%)
        if not subgrupos_com_grade_correta:
            for subgrupo_banco, grade_banco, grade_banco_norm in df_banco_list:
                sim_grade = similaridade(grade_fornecido_norm, grade_banco_norm)
                if sim_grade >= 0.98:  # Muito rigoroso
                    subgrupos_com_grade_correta.append({
                        'subgrupo': subgrupo_banco,
                        'grade': grade_banco,
                        'grade_norm': grade_banco_norm
                    })
        
        if not subgrupos_com_grade_correta:
            print(f"  ✗ '{subgrupo_fornecido}' ({grade_fornecido}) - Grade não encontrada no banco")
            continue
        
        # Mostrar quantos subgrupos têm essa grade e quais são
        subgrupos_unicos = list(set([s['subgrupo'] for s in subgrupos_com_grade_correta]))
        subgrupos_str = ', '.join(subgrupos_unicos[:5])
        if len(subgrupos_unicos) > 5:
            subgrupos_str += f'... (+{len(subgrupos_unicos)-5})'
        print(f"\n    Grade '{grade_fornecido_norm}' encontrada em {len(subgrupos_unicos)} subgrupo(s): {subgrupos_str}", end='')
        
        # PASSO 2: Dentre os subgrupos com a grade correta, escolher o mais similar
        melhor_match = None
        melhor_sim_subgrupo = 0.0
        
        for candidato in subgrupos_com_grade_correta:
            sim_subgrupo = similaridade(subgrupo_fornecido, candidato['subgrupo'])
            if sim_subgrupo > melhor_sim_subgrupo:
                melhor_sim_subgrupo = sim_subgrupo
                melhor_match = (candidato['subgrupo'], candidato['grade'])
        
        if melhor_match:
            # Se só há um subgrupo com essa grade, é eliminação
            metodo = 'eliminacao' if len(subgrupos_unicos) == 1 else 'similaridade'
            
            matches.append({
                'fornecido': (subgrupo_fornecido, grade_fornecido),
                'banco': melhor_match,
                'similaridade': melhor_sim_subgrupo,
                'metodo': metodo
            })
            
            if melhor_sim_subgrupo >= 0.95:
                print(f"✓ '{subgrupo_fornecido}' ({grade_fornecido}) → '{melhor_match[0]}' ({melhor_match[1]})")
            elif len(subgrupos_unicos) == 1:
                print(f"✓ '{subgrupo_fornecido}' ({grade_fornecido}) → '{melhor_match[0]}' ({melhor_match[1]}) [eliminação - único subgrupo com essa grade]")
            else:
                print(f"⚠ '{subgrupo_fornecido}' ({grade_fornecido}) → '{melhor_match[0]}' ({melhor_match[1]}) - {melhor_sim_subgrupo:.2f} [entre {len(subgrupos_unicos)} opções]")
        else:
            print(f"  ✗ '{subgrupo_fornecido}' ({grade_fornecido}) - Nenhum match encontrado")
    
    return matches


def buscar_estoque(conn, matches):
    """Busca estoque apenas dos matches encontrados"""
    print("\n[ESTOQUE] Buscando estoque positivo...")
    
    if not matches:
        print("⚠ Nenhum match encontrado!")
        return pd.DataFrame()
    
    # Construir condições
    condicoes = []
    for match in matches:
        subgrupo = match['banco'][0].replace("'", "''")
        grade = match['banco'][1].replace("'", "''")
        condicoes.append(f"(UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = '{subgrupo}' AND UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR, p.GRADE), '')))) = '{grade}')")
    
    filiais_escaped = [f.replace("'", "''") for f in FILIAIS_SCARFME]
    filiais_str = ', '.join([f"'{f}'" for f in filiais_escaped])
    
    query = f"""
        SELECT 
            e.FILIAL,
            e.PRODUTO,
            e.COR_PRODUTO,
            ISNULL(c.DESC_COR, '') AS DESC_COR,
            ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO_PRODUTO,
            ISNULL(CONVERT(VARCHAR, p.GRADE), '') AS GRADE,
            e.ESTOQUE,
            ISNULL(p.CUSTO_REPOSICAO1, 0) AS CUSTO_REPOSICAO1,
            (e.ESTOQUE * ISNULL(p.CUSTO_REPOSICAO1, 0)) AS VALOR_TOTAL
        FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
        INNER JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
        LEFT JOIN CORES_BASICAS c WITH (NOLOCK) ON e.COR_PRODUTO = c.COR
        WHERE e.ESTOQUE > 0
          AND e.FILIAL IN ({filiais_str})
          AND ({' OR '.join(condicoes)})
        ORDER BY p.SUBGRUPO_PRODUTO, p.GRADE, e.FILIAL, e.PRODUTO
    """
    
    df = pd.read_sql(query, conn)
    print(f"✓ Encontrados {len(df)} registros")
    
    return df


def gerar_excel(df, matches):
    """Gera Excel simples"""
    print("\n[EXCEL] Gerando arquivo...")
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    nome_arquivo = f"estoque_tecido_scarfme_{timestamp}.xlsx"
    
    with pd.ExcelWriter(nome_arquivo, engine='openpyxl') as writer:
        df.to_excel(writer, sheet_name='Estoque', index=False)
        
        # Planilha com mapeamento
        mapeamento_data = []
        for match in matches:
            mapeamento_data.append({
                'SUBGRUPO_FORNECIDO': match['fornecido'][0],
                'GRADE_FORNECIDO': match['fornecido'][1],
                'SUBGRUPO_BANCO': match['banco'][0],
                'GRADE_BANCO': match['banco'][1],
                'SIMILARIDADE': f"{match['similaridade']:.2f}"
            })
        if mapeamento_data:
            pd.DataFrame(mapeamento_data).to_excel(writer, sheet_name='Mapeamento', index=False)
    
    print(f"✓ Arquivo: {nome_arquivo}")
    return nome_arquivo


def main():
    print("=" * 60)
    print("ESTOQUE - SUBGRUPOS ESPECÍFICOS (SCARFME)")
    print("=" * 60)
    
    conn = None
    try:
        conn = conectar_banco()
        
        # Buscar todos subgrupos+grades do banco
        df_banco = buscar_subgrupos_grades_banco(conn)
        
        # Encontrar matches
        matches = encontrar_matches(ITENS_BUSCAR, df_banco)
        
        if not matches:
            print("\n⚠ Nenhum match encontrado! Verifique os nomes.")
            return
        
        # Buscar estoque
        df = buscar_estoque(conn, matches)
        
        if len(df) == 0:
            print("\n⚠ Nenhum estoque positivo encontrado!")
            return
        
        # Gerar Excel
        arquivo = gerar_excel(df, matches)
        
        print("\n" + "=" * 60)
        print("✓ CONCLUÍDO!")
        print(f"✓ Arquivo: {arquivo}")
        print(f"✓ Registros: {len(df):,}")
        print(f"✓ Quantidade: {df['ESTOQUE'].sum():,.0f}")
        print(f"✓ Valor: R$ {df['VALOR_TOTAL'].sum():,.2f}")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n✗ ERRO: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        if conn:
            conn.close()


if __name__ == '__main__':
    main()

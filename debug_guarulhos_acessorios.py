# -*- coding: utf-8 -*-
"""
debug_guarulhos_acessorios.py
------------------------------
Compara vendas de MARÇO 2026 na filial GUARULHOS – linha ACESSORIOS:
  1. O que o CSV (vendas_tratadas.csv) contém
  2. O que o banco retorna com a query ANTIGA  (CASE WHEN QTDE_CANCELADA = 0)
  3. O que o banco retorna com a query NOVA    (QTDE - ISNULL(QTDE_CANCELADA, 0))
  4. Registro a registro: mostra QTDE_CANCELADA de cada venda do banco

Depende apenas de: pyodbc  (pip install pyodbc)
Driver ODBC: "ODBC Driver 17 for SQL Server" ou "SQL Server Native Client 11.0"
"""

import csv
import sys
from datetime import date

# ── Configurações de conexão (do .env.local) ──────────────────────────────────
DB_SERVER   = "177.92.78.250"
DB_DATABASE = "LINX_PRODUCAO"
DB_USER     = "andre.sabetta"
DB_PASSWORD = "asabetta"
DB_PORT     = 1433

FILIAL      = "GUARULHOS - RSR"
LINHA_ALVO  = "ACESSORIOS"          # sem acento – comparacao case-insensitive com UPPER()
PERIODO_INI = "2026-03-01"
PERIODO_FIM = "2026-04-01"          # exclusivo (mesmo critério < @periodoFim)

CSV_PATH = r"data\vendas_tratadas.csv"

SEPARATOR = "=" * 70


# ─────────────────────────────────────────────────────────────────────────────
# 1. LEITURA DO CSV
# ─────────────────────────────────────────────────────────────────────────────
def analisar_csv():
    print(SEPARATOR)
    print("1. ANÁLISE DO CSV  (data/vendas_tratadas.csv)")
    print(SEPARATOR)

    todos       = []
    acessorios  = []

    try:
        with open(CSV_PATH, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, delimiter=";")
            for row in reader:
                filial = row.get("FILIAL", "").strip()
                data   = row.get("DATA_VENDA", "").strip()
                linha  = row.get("LINHA", "").strip().upper()

                if "GUARULHOS" not in filial.upper():
                    continue
                if not data.startswith("2026-03"):
                    continue

                todos.append(row)

                if "ACESS" in linha and "CEL" not in linha:
                    acessorios.append(row)

    except FileNotFoundError:
        print(f"  [ERRO] Arquivo não encontrado: {CSV_PATH}")
        return

    print(f"  Total de registros Guarulhos/Mar-2026 no CSV : {len(todos)}")
    print(f"  Filtrados por LINHA ~ ACESSORIOS            : {len(acessorios)}\n")

    campos_ausentes = ["QTDE_CANCELADA"]          # coluna que NÃO existe no CSV

    for r in acessorios:
        qtde      = r.get("QTDE", "").strip()
        linha_val = r.get("LINHA", "").strip()
        print(f"  DATA : {r['DATA_VENDA'].strip()}")
        print(f"  PROD : {r['PRODUTO'].strip()} – {r['DESC_PRODUTO'].strip()}")
        print(f"  LINHA: {linha_val}")
        print(f"  QTDE : {qtde}  |  QTDE_CANCELADA: (não existe no CSV)")
        print(f"  QTDE_TROCA_ITEM: {r.get('QTDE_TROCA_ITEM','').strip()}")
        print()

    # Contagem pela regra do banco (somente QTDE > 0)
    qtde_gt0 = [r for r in acessorios if int(r.get("QTDE","0").strip() or "0") > 0]
    print(f"  → Registros com QTDE > 0  (critério WHERE do banco): {len(qtde_gt0)}")
    print(f"  → Colunas QTDE_CANCELADA ausentes no CSV – é preciso consultar o banco!\n")


# ─────────────────────────────────────────────────────────────────────────────
# 2. CONSULTAS AO BANCO SQL SERVER
# ─────────────────────────────────────────────────────────────────────────────
def consultar_banco():
    try:
        import pyodbc
    except ImportError:
        print("[ERRO] pyodbc não instalado.  Execute:  pip install pyodbc")
        sys.exit(1)

    # Tenta drivers disponíveis em ordem de preferência
    drivers = [
        "ODBC Driver 17 for SQL Server",
        "ODBC Driver 18 for SQL Server",
        "SQL Server Native Client 11.0",
        "SQL Server",
    ]

    conn = None
    for drv in drivers:
        try:
            conn_str = (
                f"DRIVER={{{drv}}};"
                f"SERVER={DB_SERVER},{DB_PORT};"
                f"DATABASE={DB_DATABASE};"
                f"UID={DB_USER};"
                f"PWD={DB_PASSWORD};"
                "TrustServerCertificate=yes;"
                "Encrypt=no;"
            )
            conn = pyodbc.connect(conn_str, timeout=30)
            print(f"  Conectado via driver: {drv}\n")
            break
        except pyodbc.Error:
            pass

    if conn is None:
        print("[ERRO] Não foi possível conectar ao banco.")
        print("Drivers tentados:", drivers)
        sys.exit(1)

    cur = conn.cursor()

    # ── 2a. Registros brutos com QTDE_CANCELADA ──────────────────────────────
    print(SEPARATOR)
    print("2. REGISTROS BRUTOS NO BANCO  (W_CTB_LOJA_VENDA_PEDIDO_PRODUTO)")
    print(SEPARATOR)

    sql_bruto = f"""
    SELECT
        vp.DATA_VENDA,
        vp.PRODUTO,
        p.DESC_PRODUTO,
        vp.FILIAL,
        UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,
        vp.QTDE,
        vp.QTDE_CANCELADA,
        -- Simulação query ANTIGA
        CASE WHEN vp.QTDE_CANCELADA = 0 THEN vp.QTDE ELSE 0 END AS qtde_antiga,
        -- Simulação query NOVA
        vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)               AS qtde_nova,
        -- Diagnóstico
        CASE
            WHEN vp.QTDE_CANCELADA IS NULL THEN 'NULL → antiga=0, nova=QTDE'
            WHEN vp.QTDE_CANCELADA  = 0    THEN 'ok (=0)'
            ELSE                                 'cancelado parcial/total'
        END AS diagnostico
    FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
    WHERE vp.DATA_VENDA >= '{PERIODO_INI}'
      AND vp.DATA_VENDA  < '{PERIODO_FIM}'
      AND vp.QTDE > 0
      AND LTRIM(RTRIM(vp.FILIAL)) = '{FILIAL}'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) LIKE '%ACESS%'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) NOT LIKE '%CEL%'
    ORDER BY vp.DATA_VENDA
    """

    cur.execute(sql_bruto)
    rows_brutos = cur.fetchall()
    cols = [d[0] for d in cur.description]

    if not rows_brutos:
        print("  Nenhum registro encontrado no banco para esse filtro.\n")
    else:
        print(f"  Total de linhas (QTDE > 0): {len(rows_brutos)}\n")
        for row in rows_brutos:
            r = dict(zip(cols, row))
            print(f"  ─── {r['DATA_VENDA'].strftime('%d/%m/%Y') if hasattr(r['DATA_VENDA'],'strftime') else r['DATA_VENDA']} ───")
            print(f"    PRODUTO        : {r['PRODUTO']}")
            print(f"    DESC_PRODUTO   : {r.get('DESC_PRODUTO','')}")
            print(f"    LINHA          : {r['LINHA']}")
            print(f"    QTDE           : {r['QTDE']}")
            print(f"    QTDE_CANCELADA : {r['QTDE_CANCELADA']}")
            print(f"    qtde_antiga    : {r['qtde_antiga']}   ← CASE WHEN QTDE_CANCELADA = 0")
            print(f"    qtde_nova      : {r['qtde_nova']}   ← QTDE - ISNULL(QTDE_CANCELADA, 0)")
            print(f"    DIAGNÓSTICO    : {r['diagnostico']}")
            print()

    # ── 2b. Comparação agregada (igual à query da projeção) ──────────────────
    print(SEPARATOR)
    print("3. COMPARAÇÃO AGREGADA  (reproduz a query fetchProjecaoMensal)")
    print(SEPARATOR)

    sql_comparacao = f"""
    SELECT
        UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) AS LINHA,

        -- Query ANTIGA (bugada: exclui QTDE_CANCELADA IS NULL)
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0
                 THEN vp.QTDE ELSE 0 END)         AS vendas_ANTIGA,

        -- Query NOVA (correta: trata NULL como 0)
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA, 0)) AS vendas_NOVA,

        COUNT(*)                                   AS total_linhas,
        SUM(CASE WHEN vp.QTDE_CANCELADA IS NULL THEN 1 ELSE 0 END) AS linhas_com_null,
        SUM(CASE WHEN vp.QTDE_CANCELADA = 0     THEN 1 ELSE 0 END) AS linhas_cancelada_zero,
        SUM(CASE WHEN vp.QTDE_CANCELADA > 0     THEN 1 ELSE 0 END) AS linhas_com_cancelamento

    FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
    WHERE vp.DATA_VENDA >= '{PERIODO_INI}'
      AND vp.DATA_VENDA  < '{PERIODO_FIM}'
      AND vp.QTDE > 0
      AND LTRIM(RTRIM(vp.FILIAL)) = '{FILIAL}'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) LIKE '%ACESS%'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) NOT LIKE '%CEL%'
    GROUP BY UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, ''))))
    """

    cur.execute(sql_comparacao)
    rows_agg = cur.fetchall()
    cols_agg = [d[0] for d in cur.description]

    if not rows_agg:
        print("  Nenhum resultado agregado.\n")
    else:
        for row in rows_agg:
            r = dict(zip(cols_agg, row))
            diff = (r["vendas_NOVA"] or 0) - (r["vendas_ANTIGA"] or 0)
            print(f"  LINHA                  : {r['LINHA']}")
            print(f"  vendas_ANTIGA          : {r['vendas_ANTIGA']}  ← query com bug")
            print(f"  vendas_NOVA            : {r['vendas_NOVA']}  ← query corrigida")
            print(f"  diferença              : +{diff} unidade(s)")
            print(f"  total linhas (QTDE>0)  : {r['total_linhas']}")
            print(f"  linhas QTDE_CANCELADA IS NULL : {r['linhas_com_null']}  ← causa do bug")
            print(f"  linhas QTDE_CANCELADA = 0     : {r['linhas_cancelada_zero']}")
            print(f"  linhas QTDE_CANCELADA > 0     : {r['linhas_com_cancelamento']}")
            print()

    # ── 2c. Diagnóstico final ─────────────────────────────────────────────────
    print(SEPARATOR)
    print("4. DIAGNÓSTICO FINAL")
    print(SEPARATOR)
    total_linhas = sum(r[cols_agg.index("total_linhas")] for r in rows_agg) if rows_agg else 0
    total_antiga = sum(r[cols_agg.index("vendas_ANTIGA")] or 0 for r in rows_agg) if rows_agg else 0
    total_nova   = sum(r[cols_agg.index("vendas_NOVA")] or 0 for r in rows_agg) if rows_agg else 0
    null_count   = sum(r[cols_agg.index("linhas_com_null")] for r in rows_agg) if rows_agg else 0

    print(f"""
  Filial   : {FILIAL}
  Linha    : ACESSORIOS
  Período  : {PERIODO_INI} a {PERIODO_FIM} (exclusivo)

  Registros com QTDE > 0 no banco : {total_linhas}
  +- Resultado query ANTIGA        : {total_antiga}  (CASE WHEN QTDE_CANCELADA = 0)
  +- Resultado query NOVA          : {total_nova}  (QTDE - ISNULL(QTDE_CANCELADA, 0))

  Causa: {null_count} registro(s) com QTDE_CANCELADA = NULL
         Em SQL Server: NULL = 0 → NULL (não TRUE)
         → CASE WHEN retorna ELSE 0  → venda excluída silenciosamente
         → ISNULL(NULL, 0) = 0 corretamente → venda contabilizada
""")

    # ── 2d. Verificar estoque atual dos produtos vendidos ─────────────────────
    print(SEPARATOR)
    print("5. ESTOQUE ATUAL DOS PRODUTOS VENDIDOS EM MAR/2026 (GUARULHOS ACESSORIOS)")
    print(SEPARATOR)
    print("   Hipotese: produto sem estoque nao entra no estoqueMap → vendasReais perdida\n")

    sql_estoque = f"""
    SELECT
        vp.PRODUTO,
        MIN(p.DESC_PRODUTO) AS DESC_PRODUTO,
        UPPER(LTRIM(RTRIM(ISNULL(MIN(p.LINHA),'')))) AS LINHA,
        ISNULL(MIN(p.SUBGRUPO_PRODUTO),'') AS SUBGRUPO,
        ISNULL(MIN(p.COLECAO),'')          AS COLECAO,
        ISNULL(MIN(CONVERT(VARCHAR,p.GRADE)),'')  AS GRADE,
        ISNULL(vp.COR_PRODUTO,'')          AS COR,
        SUM(vp.QTDE - ISNULL(vp.QTDE_CANCELADA,0)) AS qtde_vendida_marco,
        -- Estoque atual na filial Guarulhos para esse produto/cor
        (SELECT ISNULL(SUM(CASE WHEN e2.ESTOQUE > 0 THEN e2.ESTOQUE ELSE 0 END),0)
         FROM ESTOQUE_PRODUTOS e2 WITH (NOLOCK)
         WHERE e2.PRODUTO = vp.PRODUTO
           AND LTRIM(RTRIM(e2.FILIAL)) = '{FILIAL}'
           AND ISNULL(e2.COR_PRODUTO,'') = ISNULL(vp.COR_PRODUTO,'')
        ) AS estoque_atual_guarulhos
    FROM W_CTB_LOJA_VENDA_PEDIDO_PRODUTO vp WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
    WHERE vp.DATA_VENDA >= '{PERIODO_INI}'
      AND vp.DATA_VENDA  < '{PERIODO_FIM}'
      AND vp.QTDE > 0
      AND LTRIM(RTRIM(vp.FILIAL)) = '{FILIAL}'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA,'')))) LIKE '%ACESS%'
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA,'')))) NOT LIKE '%CEL%'
    GROUP BY vp.PRODUTO, vp.COR_PRODUTO
    ORDER BY estoque_atual_guarulhos, vp.PRODUTO
    """

    cur.execute(sql_estoque)
    rows_est = cur.fetchall()
    cols_est = [d[0] for d in cur.description]

    vendas_com_estoque    = 0
    vendas_sem_estoque    = 0
    total_vendas_visiveis = 0  # vendasReais que aparecem no frontend

    for row in rows_est:
        r = dict(zip(cols_est, row))
        tem_estoque = (r["estoque_atual_guarulhos"] or 0) > 0
        qtde_v = r["qtde_vendida_marco"] or 0
        status = "TEM ESTOQUE - entra no estoqueMap" if tem_estoque else "SEM ESTOQUE - EXCLUIDO do estoqueMap → vendasReais perdida!"
        print(f"  PRODUTO  : {r['PRODUTO']} – {(r.get('DESC_PRODUTO') or '').strip()}")
        print(f"  LINHA    : {r['LINHA']} | SUBGRUPO: {r['SUBGRUPO']} | COLECAO: {r['COLECAO']} | GRADE: {r['GRADE']} | COR: {r['COR']}")
        print(f"  Vendida  : {qtde_v}  |  Estoque Guarulhos: {r['estoque_atual_guarulhos']}")
        print(f"  STATUS   : {status}")
        chave = f"ACESSORIOS|{r['SUBGRUPO'].strip()}|{r['GRADE'].strip()}|{r['COLECAO'].strip()}|{r['PRODUTO'].strip()}|{r['COR'].strip()}"
        print(f"  CHAVE_TS : {chave}")
        print()
        if tem_estoque:
            vendas_com_estoque    += qtde_v
            total_vendas_visiveis += qtde_v
        else:
            vendas_sem_estoque += qtde_v

    print(SEPARATOR)
    print("6. CONCLUSAO FINAL")
    print(SEPARATOR)
    print(f"""
  Total vendido (Mar/2026 ACESSORIOS Guarulhos) : {vendas_com_estoque + vendas_sem_estoque}
  Produtos COM estoque restante (aparecem na UI): {vendas_com_estoque}
  Produtos SEM estoque (excluidos silenciosamente): {vendas_sem_estoque}

  Conclusao: a projecao itera apenas sobre estoqueMap (produtos com saldo > 0).
  Produtos que zeraram o estoque apos vender nao aparecem como entrada
  no categoriasMap, entao suas vendasReais nao sao somadas ao total da linha.

  CORRECAO NECESSARIA: alem do estoqueMap, iterar tambem sobre
  vendasMesAtualMap/vendasReaisPorMesMap para capturar vendas de
  produtos sem estoque e soma-las ao item de linha correspondente.
""")

    conn.close()


# ─────────────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    analisar_csv()
    consultar_banco()

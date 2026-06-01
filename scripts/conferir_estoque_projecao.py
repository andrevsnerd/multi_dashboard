#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Conferência de estoque da projeção (ScarfMe) vs banco e vs CSV do exportador.

- Linha: LENÇOS
- Subgrupo: CETIM DE POLIÉSTER
- Usa as MESMAS filiais consideradas no dashboard (inventory + e-commerce).
- Compara: consulta direta ao banco, total por filial, e soma do CSV estoque_tratados.
"""

import os
import sys
import argparse
import unicodedata

try:
    import pandas as pd
    import pyodbc
except ImportError as e:
    print(f"Erro: dependências não instaladas. Execute: pip install pandas pyodbc\n{e}")
    sys.exit(1)

# --- Configuração igual ao exportar_todos_relatorios.py ---
DB_CONFIG = {
    "server": "189.126.197.82",
    "database": "LINX_PRODUCAO",
    "username": "andre.nerd",
    "password": "nerd123@",
}

# Filiais consideradas no dashboard para estoque "Todas as filiais" (igual lib/config/company.ts)
# inventory + ecommerceFilials (união, sem duplicata)
SCARFME_FILIAIS_ESTOQUE = [
    "GUARULHOS - RSR",
    "IGUATEMI SP - JJJ",
    "MORUMBI - JJJ",
    "OSCAR FREIRE - FSZ",
    "SCARF ME - HIGIENOPOLIS 2",
    "SCARFME - IBIRAPUERA LLL",
    "SCARFME ME - PAULISTA FFF",
    "SCARF ME - PAULISTA RSR",
    "SCARF ME - PAULISTA FFFR",
    "SCARF ME - MATRIZ",
    "SCARFME MATRIZ CMS",
    "SCARF ME - MATRIZ LLL",
    "SCARF ME MATRIZ - FFF",
    "VILLA LOBOS - LLL",
    "MSC COMERCIO DE LENCOS LT",
    "SCARFME LLL -  GALEAO RJ",
]

# Linhas excluídas no dashboard (excludedLines) - produtos com LINHA nessa lista não entram
SCARFME_EXCLUDED_LINES = [
    "PRIVATE LABEL",
    "GASTRONOMICA",
    "PERFUMARIA",
    "CASHMERE",
    "ELETRONICOS",
    "EMBALAGENS",
    "CAPAS E ACESSORIOS P/ CEL",
]

LINHA_FILTRO = "LENÇOS"  # Linha para conferência (LENÇOS)
SUBGRUPO_FILTRO = "CETIM DE POLIÉSTER"  # Subgrupo para conferência


def normalizar(s: str) -> str:
    """UPPER + trim, e opcionalmente normalizar acentos para comparação."""
    if pd.isna(s) or s is None:
        return ""
    t = str(s).strip().upper()
    return t


def normalizar_para_comparacao(s: str) -> str:
    """Remove acentos para comparação flexível (CETIM DE POLIESTER vs CETIM DE POLIÉSTER)."""
    if not s:
        return ""
    nfd = unicodedata.normalize("NFD", s)
    return "".join(c for c in nfd if unicodedata.category(c) != "Mn").upper().strip()


def conectar_banco():
    """Conecta ao SQL Server."""
    conn_str = (
        f"DRIVER={{ODBC Driver 17 for SQL Server}};"
        f"SERVER={DB_CONFIG['server']};"
        f"DATABASE={DB_CONFIG['database']};"
        f"UID={DB_CONFIG['username']};"
        f"PWD={DB_CONFIG['password']};"
    )
    return pyodbc.connect(conn_str)


def estoque_banco_por_filial(conn, linha: str, subgrupo=None):
    """
    Consulta estoque no banco: por filial, só filiais consideradas no dashboard,
    só ESTOQUE > 0, excluindo excluded lines. Retorna (df por filial, total geral).
    Para subgrupo: aceita com ou sem acento (ex.: CETIM DE POLIÉSTER e CETIM DE POLIESTER).
    """
    placeholders = ", ".join(["?"] * len(SCARFME_FILIAIS_ESTOQUE))
    excl_placeholders = ", ".join(["?"] * len(SCARFME_EXCLUDED_LINES))

    sql = f"""
    SELECT
        e.FILIAL,
        SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS estoque
    FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON e.PRODUTO = p.PRODUTO
    WHERE e.FILIAL IN ({placeholders})
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) = ?
      AND e.ESTOQUE > 0
      AND UPPER(LTRIM(RTRIM(ISNULL(p.LINHA, '')))) NOT IN ({excl_placeholders})
    """
    params = list(SCARFME_FILIAIS_ESTOQUE) + [linha] + list(SCARFME_EXCLUDED_LINES)

    if subgrupo:
        # Aceitar com e sem acento: no banco pode estar "CETIM DE POLIESTER"
        sub_sem_acento = normalizar_para_comparacao(subgrupo)
        if sub_sem_acento != normalizar(subgrupo):
            sql += "  AND ( UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = ? OR UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = ? )"
            params.append(normalizar(subgrupo))
            params.append(sub_sem_acento)
        else:
            sql += "  AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO, '')))) = ?"
            params.append(subgrupo)

    sql += " GROUP BY e.FILIAL ORDER BY e.FILIAL"

    df = pd.read_sql(sql, conn, params=params)
    total = df["estoque"].sum()
    return df, int(total)


def estoque_csv(csv_path: str, linha: str, subgrupo=None):
    """
    Soma estoque do CSV estoque_tratados considerando apenas as mesmas filiais,
    linha e (opcional) subgrupo. Só conta ESTOQUE > 0 para bater com o dashboard.
    Retorno: (dados_linha, dados_subgrupo ou None, erro ou None).
    dados_linha = (df_por_filial, total); dados_subgrupo = (df_por_filial, total) quando subgrupo informado.
    """
    if not os.path.isfile(csv_path):
        return (None, None), None, f"Arquivo não encontrado: {csv_path}"

    df = pd.read_csv(csv_path, sep=";", encoding="utf-8-sig", decimal=",", low_memory=False)
    for c in ["FILIAL", "LINHA", "SUBGRUPO_PRODUTO", "ESTOQUE"]:
        if c not in df.columns:
            return (None, None), None, f"Coluna ausente no CSV: {c}"

    # Normalizar FILIAL (strip) para evitar duplicata por causa de espaços no CSV
    df["FILIAL"] = df["FILIAL"].astype(str).str.strip()
    # Normalizar para comparação
    df["_linha_norm"] = df["LINHA"].apply(normalizar)
    df["_sub_norm"] = df["SUBGRUPO_PRODUTO"].apply(normalizar)
    df["_sub_comp"] = df["SUBGRUPO_PRODUTO"].apply(normalizar_para_comparacao)

    filiais_set = set(f.strip() for f in SCARFME_FILIAIS_ESTOQUE)
    mask_filial = df["FILIAL"].apply(lambda x: str(x).strip() in filiais_set if pd.notna(x) else False)
    mask_linha = df["_linha_norm"] == normalizar(linha)
    mask_excl = ~df["_linha_norm"].isin([normalizar(l) for l in SCARFME_EXCLUDED_LINES])
    mask_estoque_pos = (df["ESTOQUE"].fillna(0).astype(float) > 0)

    # Linha inteira (LENÇOS)
    base = df.loc[mask_filial & mask_linha & mask_excl & mask_estoque_pos]
    por_filial_linha = base.groupby("FILIAL", as_index=False).agg(estoque=("ESTOQUE", "sum"))
    total_linha = int(por_filial_linha["estoque"].sum())

    if subgrupo is None:
        return (por_filial_linha, total_linha), None, None

    # Subgrupo (CETIM DE POLIÉSTER): match exato ou sem acento
    sub_norm = normalizar(subgrupo)
    sub_comp = normalizar_para_comparacao(subgrupo)
    mask_sub = (df["_sub_norm"] == sub_norm) | (df["_sub_comp"] == sub_comp)
    base_sub = df.loc[mask_filial & mask_linha & mask_sub & mask_excl & mask_estoque_pos]
    por_filial_sub = base_sub.groupby("FILIAL", as_index=False).agg(estoque=("ESTOQUE", "sum"))
    total_sub = int(por_filial_sub["estoque"].sum())
    return (por_filial_linha, total_linha), (por_filial_sub, total_sub), None


def main():
    parser = argparse.ArgumentParser(description="Conferência estoque projeção ScarfMe (LENÇOS / Cetim Poliéster)")
    parser.add_argument(
        "--csv",
        default=None,
        help="Caminho do CSV estoque_tratados (ex: ../data/estoque_tratados.csv)",
    )
    parser.add_argument("--linha", default=LINHA_FILTRO, help="Linha para conferência (default: LENÇOS)")
    parser.add_argument("--subgrupo", default=SUBGRUPO_FILTRO, help="Subgrupo para conferência (default: CETIM DE POLIÉSTER)")
    args = parser.parse_args()

    # Resolver path do CSV (gerado pelo exportar_todos_relatorios.py na pasta data/)
    csv_path = args.csv
    if not csv_path:
        script_dir = os.path.dirname(os.path.abspath(__file__))
        # Tenta: multi-dashboard/../data e multi-dashboard/../../data (pasta do exportador)
        default_paths = [
            os.path.normpath(os.path.join(script_dir, "..", "..", "data", "estoque_tratados.csv")),
            os.path.normpath(os.path.join(script_dir, "..", "data", "estoque_tratados.csv")),
        ]
        for p in default_paths:
            if os.path.isfile(p):
                csv_path = p
                break
        csv_path = csv_path or default_paths[0]

    linha = normalizar(args.linha)
    subgrupo = normalizar(args.subgrupo) or None
    if not linha:
        print("Linha inválida.")
        sys.exit(1)

    print("=" * 70)
    print("CONFERÊNCIA DE ESTOQUE - PROJEÇÃO SCARFME")
    print("=" * 70)
    print(f"Linha considerada: {linha}")
    print(f"Subgrupo considerada: {subgrupo or '(nenhum)'}")
    print()
    print("Filiais consideradas (mesmas do dashboard - Todas as filiais):")
    for i, f in enumerate(SCARFME_FILIAIS_ESTOQUE, 1):
        print(f"  {i:2}. {f}")
    print()

    conn = None
    try:
        print("Conectando ao banco...")
        conn = conectar_banco()

        # --- Estoque geral da linha (LENÇOS) ---
        df_filial_linha, total_linha_banco = estoque_banco_por_filial(conn, linha, subgrupo=None)
        print("-" * 70)
        print("1. ESTOQUE GERAL DA LINHA (LENÇOS) - CONSULTA BANCO")
        print("-" * 70)
        print(df_filial_linha.to_string(index=False))
        print(f"\nTotal geral (banco): {total_linha_banco:,} unidades")
        print()

        # --- Estoque do subgrupo Cetim de Poliéster ---
        df_filial_sub, total_sub_banco = estoque_banco_por_filial(conn, linha, subgrupo=subgrupo)
        print("-" * 70)
        print(f"2. ESTOQUE SUBGRUPO ({subgrupo}) - CONSULTA BANCO")
        print("-" * 70)
        if df_filial_sub.empty:
            print("  (Nenhum registro encontrado para este subgrupo. Confira o nome no banco, ex.: CETIM DE POLIESTER)")
        else:
            print(df_filial_sub.to_string(index=False))
        print(f"\nTotal subgrupo (banco): {total_sub_banco:,} unidades")
        print()

    finally:
        if conn:
            conn.close()

    # --- CSV ---
    print("-" * 70)
    print("3. COMPARAÇÃO COM O CSV (estoque_tratados)")
    print("-" * 70)
    print(f"Caminho do CSV: {csv_path}")
    result_csv = estoque_csv(csv_path, args.linha, args.subgrupo if subgrupo else None)

    if result_csv[2] is not None:
        print(f"Erro CSV: {result_csv[2]}")
    else:
        (por_filial_linha_csv, total_linha_csv) = result_csv[0]
        dados_sub = result_csv[1]  # (df_por_filial_sub, total_sub) ou None
        por_filial_sub_csv, total_sub_csv = (dados_sub if dados_sub else (None, None))

        print("\nLinha (LENÇOS) a partir do CSV (mesmas filiais, ESTOQUE > 0):")
        print(por_filial_linha_csv.to_string(index=False))
        print(f"\nTotal geral (CSV): {total_linha_csv:,} unidades")

        diff_linha = total_linha_banco - total_linha_csv
        print(f"\nDiferença (banco - CSV) linha: {diff_linha:+,} unidades")
        if diff_linha != 0:
            print("  -> Possíveis causas: momento da extração diferente, filtros (ex.: excluded lines), ou colunas no CSV.")

        if subgrupo and dados_sub is not None:
            print(f"\nSubgrupo ({subgrupo}) a partir do CSV:")
            print(por_filial_sub_csv.to_string(index=False))
            print(f"\nTotal subgrupo (CSV): {total_sub_csv:,} unidades")
            diff_sub = total_sub_banco - total_sub_csv
            print(f"Diferença (banco - CSV) subgrupo: {diff_sub:+,} unidades")

    print()
    print("=" * 70)
    print("ENTENDENDO O RELATÓRIO")
    print("=" * 70)
    print("""
• Banco: consulta direta ao SQL Server (momento atual). Mesmas filiais e regras
  do dashboard (ex.: excluded lines). Subgrupo: aceita nome com ou sem acento.

• CSV: arquivo gerado pelo exportar_todos_relatorios.py. Se a extração foi em
  outro momento, totais podem diferir em poucas unidades (+/-).

• Filiais duplicadas no CSV: o script agora normaliza FILIAL (trim) para agregar
  corretamente; antes, espaços diferentes geravam duas linhas por filial.

• Subgrupo 0 no banco e >0 no CSV: geralmente o banco grava sem acento (ex. CETIM
  DE POLIESTER). O script foi ajustado para buscar as duas formas no banco.
""")
    print("=" * 70)
    print("Fim da conferência.")
    print("=" * 70)


if __name__ == "__main__":
    main()

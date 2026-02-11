#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Investiga de onde vêm as entradas e saídas para o log do dashboard.
Compara ESTOQUE_PROD_ENT, LOJA_ENTRADAS, ESTOQUE_PROD_SAI e LOJA_SAIDAS
para garantir que o log mostre todas as movimentações.

Uso:
  python investigar_log_entradas_saidas.py              # últimos 30 dias, resumo
  python investigar_log_entradas_saidas.py --dias 60    # últimos 60 dias
  python investigar_log_entradas_saidas.py --romaneios 029068,T029068  # verifica romaneios específicos
"""

import os
import sys
import argparse
import pyodbc
from datetime import datetime, timedelta

# Config conexão: use variáveis de ambiente se existirem (ex: .env), senão fallback
DB_CONFIG = {
    'server': os.environ.get('DB_SERVER', '177.92.78.250'),
    'server_fallback': os.environ.get('DB_SERVER_FALLBACK', '189.126.197.82'),
    'database': os.environ.get('DB_DATABASE', 'LINX_PRODUCAO'),
    'username': os.environ.get('DB_USERNAME', 'andre.nerd'),
    'password': os.environ.get('DB_PASSWORD', 'nerd123@'),
}

def conectar():
    servidores = [
        ('principal', DB_CONFIG['server']),
        ('fallback', DB_CONFIG['server_fallback'])
    ]
    for nome, servidor in servidores:
        try:
            conn_str = (
                f"DRIVER={{ODBC Driver 17 for SQL Server}};"
                f"SERVER={servidor};DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};PWD={DB_CONFIG['password']};Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"Conectado: {servidor}\n")
            return conn
        except Exception as e:
            print(f"Falha {nome} ({servidor}): {e}")
    sys.exit(1)

def run(conn, sql, params=None):
    cur = conn.cursor()
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)
    cols = [c[0] for c in cur.description]
    rows = cur.fetchall()
    return [dict(zip(cols, row)) for row in rows]

def main():
    parser = argparse.ArgumentParser(description='Investiga fontes do log de entradas/saídas')
    parser.add_argument('--dias', type=int, default=30, help='Janela em dias (default 30)')
    parser.add_argument('--romaneios', type=str, default=None, help='Romaneios a verificar (ex: 029068,T029068)')
    parser.add_argument('--limit', type=int, default=200, help='Máximo de linhas por tabela (default 200)')
    args = parser.parse_args()

    conn = conectar()
    dias = args.dias
    limit = args.limit

    # --- ENTRADAS ---
    print("=" * 80)
    print("ENTRADAS (últimos {} dias)".format(dias))
    print("=" * 80)

    # 1) ESTOQUE_PROD_ENT (fonte principal do ERP)
    q_ent = """
        SELECT TOP (?)
            e.ROMANEIO_PRODUTO,
            LTRIM(RTRIM(e.FILIAL)) AS FILIAL_DESTINO,
            LTRIM(RTRIM(ISNULL(e.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
            e.EMISSAO,
            e.RESPONSAVEL,
            e.TIPO_ROMANEIO
        FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
        WHERE e.EMISSAO >= DATEADD(DAY, -?, GETDATE())
        ORDER BY e.EMISSAO DESC
    """
    rows_ep_ent = run(conn, q_ent, (limit, dias))
    print("\n1. ESTOQUE_PROD_ENT: {} registros".format(len(rows_ep_ent)))
    if rows_ep_ent:
        for r in rows_ep_ent[:15]:
            print("   - {} | {} | {} | {}".format(
                (r.get('ROMANEIO_PRODUTO') or '').strip(),
                (r.get('FILIAL_DESTINO') or '').strip()[:25],
                (r.get('EMISSAO') or '') if not hasattr(r.get('EMISSAO'), 'strftime') else r['EMISSAO'].strftime('%d/%m/%Y'),
                (r.get('RESPONSAVEL') or '').strip()[:15]
            ))
        if len(rows_ep_ent) > 15:
            print("   ... e mais {} registros".format(len(rows_ep_ent) - 15))

    # 2) LOJA_ENTRADAS (só os que NÃO estão em ESTOQUE_PROD_ENT)
    q_le = """
        SELECT TOP (?)
            le.ROMANEIO_PRODUTO,
            LTRIM(RTRIM(le.FILIAL)) AS FILIAL_DESTINO,
            LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM, ''))) AS FILIAL_ORIGEM,
            le.EMISSAO,
            le.RESPONSAVEL
        FROM LOJA_ENTRADAS le WITH (NOLOCK)
        WHERE NOT EXISTS (
            SELECT 1 FROM ESTOQUE_PROD_ENT ee WITH (NOLOCK)
            WHERE ee.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND ee.FILIAL = le.FILIAL
        )
        AND (le.ENTRADA_CANCELADA = 0 OR le.ENTRADA_CANCELADA IS NULL)
        AND le.EMISSAO >= DATEADD(DAY, -?, GETDATE())
        ORDER BY le.EMISSAO DESC
    """
    rows_loja_ent = run(conn, q_le, (limit, dias))
    print("\n2. LOJA_ENTRADAS (sem correspondência em ESTOQUE_PROD_ENT): {} registros".format(len(rows_loja_ent)))
    if rows_loja_ent:
        for r in rows_loja_ent[:10]:
            print("   - {} | {} | {}".format(
                (r.get('ROMANEIO_PRODUTO') or '').strip(),
                (r.get('FILIAL_DESTINO') or '').strip()[:25],
                r.get('EMISSAO').strftime('%d/%m/%Y') if r.get('EMISSAO') else ''
            ))

    # Conjunto completo de romaneios de ENTRADA que o log deveria mostrar
    romaneios_entrada = set()
    for r in rows_ep_ent:
        rom = (r.get('ROMANEIO_PRODUTO') or '').strip()
        fil = (r.get('FILIAL_DESTINO') or '').strip()
        if rom:
            romaneios_entrada.add((rom, fil))
    for r in rows_loja_ent:
        rom = (r.get('ROMANEIO_PRODUTO') or '').strip()
        fil = (r.get('FILIAL_DESTINO') or '').strip()
        if rom:
            romaneios_entrada.add((rom, fil))
    print("\n>>> Total único (romaneio+filial) que o log de ENTRADAS deve mostrar: {}".format(len(romaneios_entrada)))

    # --- SAÍDAS ---
    print("\n" + "=" * 80)
    print("SAÍDAS (últimos {} dias)".format(dias))
    print("=" * 80)

    # 3) LOJA_SAIDAS
    q_ls = """
        SELECT TOP (?)
            s.ROMANEIO_PRODUTO,
            LTRIM(RTRIM(s.FILIAL)) AS FILIAL_ORIGEM,
            LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
            s.EMISSAO,
            s.RESPONSAVEL
        FROM LOJA_SAIDAS s WITH (NOLOCK)
        WHERE (s.SAIDA_CANCELADA = 0 OR s.SAIDA_CANCELADA IS NULL)
        AND s.EMISSAO >= DATEADD(DAY, -?, GETDATE())
        ORDER BY s.EMISSAO DESC
    """
    rows_loja_sai = run(conn, q_ls, (limit, dias))
    print("\n3. LOJA_SAIDAS: {} registros".format(len(rows_loja_sai)))
    if rows_loja_sai:
        for r in rows_loja_sai[:15]:
            print("   - {} | {} | {}".format(
                (r.get('ROMANEIO_PRODUTO') or '').strip(),
                (r.get('FILIAL_ORIGEM') or '').strip()[:25],
                r.get('EMISSAO').strftime('%d/%m/%Y') if r.get('EMISSAO') else ''
            ))
        if len(rows_loja_sai) > 15:
            print("   ... e mais {} registros".format(len(rows_loja_sai) - 15))

    # 4) ESTOQUE_PROD_SAI (fonte principal do ERP)
    q_sai = """
        SELECT TOP (?)
            es.ROMANEIO_PRODUTO,
            LTRIM(RTRIM(es.FILIAL)) AS FILIAL_ORIGEM,
            LTRIM(RTRIM(ISNULL(es.FILIAL_DESTINO, ''))) AS FILIAL_DESTINO,
            es.EMISSAO,
            es.RESPONSAVEL,
            es.TIPO_ROMANEIO
        FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
        WHERE es.EMISSAO >= DATEADD(DAY, -?, GETDATE())
        ORDER BY es.EMISSAO DESC
    """
    rows_ep_sai = run(conn, q_sai, (limit, dias))
    print("\n4. ESTOQUE_PROD_SAI: {} registros".format(len(rows_ep_sai)))
    if rows_ep_sai:
        for r in rows_ep_sai[:15]:
            print("   - {} | {} | {}".format(
                (r.get('ROMANEIO_PRODUTO') or '').strip(),
                (r.get('FILIAL_ORIGEM') or '').strip()[:25],
                r.get('EMISSAO').strftime('%d/%m/%Y') if r.get('EMISSAO') else ''
            ))
        if len(rows_ep_sai) > 15:
            print("   ... e mais {} registros".format(len(rows_ep_sai) - 15))

    # Saídas que estão só em ESTOQUE_PROD_SAI (não em LOJA_SAIDAS)
    q_sai_only = """
        SELECT TOP (?)
            es.ROMANEIO_PRODUTO,
            LTRIM(RTRIM(es.FILIAL)) AS FILIAL_ORIGEM,
            es.EMISSAO
        FROM ESTOQUE_PROD_SAI es WITH (NOLOCK)
        WHERE NOT EXISTS (
            SELECT 1 FROM LOJA_SAIDAS ls WITH (NOLOCK)
            WHERE ls.ROMANEIO_PRODUTO = es.ROMANEIO_PRODUTO AND ls.FILIAL = es.FILIAL
        )
        AND es.EMISSAO >= DATEADD(DAY, -?, GETDATE())
        ORDER BY es.EMISSAO DESC
    """
    rows_sai_only = run(conn, q_sai_only, (limit, dias))
    print("\n5. ESTOQUE_PROD_SAI sem correspondência em LOJA_SAIDAS: {} registros".format(len(rows_sai_only)))
    if rows_sai_only:
        for r in rows_sai_only[:10]:
            print("   - {} | {} | {}".format(
                (r.get('ROMANEIO_PRODUTO') or '').strip(),
                (r.get('FILIAL_ORIGEM') or '').strip()[:25],
                r.get('EMISSAO').strftime('%d/%m/%Y') if r.get('EMISSAO') else ''
            ))

    # Conjunto completo de romaneios de SAÍDA
    romaneios_saida = set()
    for r in rows_loja_sai:
        rom = (r.get('ROMANEIO_PRODUTO') or '').strip()
        fil = (r.get('FILIAL_ORIGEM') or '').strip()
        if rom:
            romaneios_saida.add((rom, fil))
    for r in rows_ep_sai:
        rom = (r.get('ROMANEIO_PRODUTO') or '').strip()
        fil = (r.get('FILIAL_ORIGEM') or '').strip()
        if rom:
            romaneios_saida.add((rom, fil))
    print("\n>>> Total único (romaneio+filial) que o log de SAÍDAS deve mostrar: {}".format(len(romaneios_saida)))

    # --- Verificação por romaneios específicos ---
    if args.romaneios:
        roms = [x.strip() for x in args.romaneios.split(',') if x.strip()]
        print("\n" + "=" * 80)
        print("VERIFICAÇÃO POR ROMANEIOS: {}".format(roms))
        print("=" * 80)
        for rom in roms:
            print("\nRomaneio: {}".format(rom))
            # Entradas
            in_ep_ent = [r for r in rows_ep_ent if (r.get('ROMANEIO_PRODUTO') or '').strip() == rom]
            in_le = [r for r in rows_loja_ent if (r.get('ROMANEIO_PRODUTO') or '').strip() == rom]
            print("  Entradas: ESTOQUE_PROD_ENT={}  LOJA_ENTRADAS={}".format(len(in_ep_ent), len(in_le)))
            # Saídas
            in_ls = [r for r in rows_loja_sai if (r.get('ROMANEIO_PRODUTO') or '').strip() == rom]
            in_ep_sai = [r for r in rows_ep_sai if (r.get('ROMANEIO_PRODUTO') or '').strip() == rom]
            print("  Saídas:  LOJA_SAIDAS={}  ESTOQUE_PROD_SAI={}".format(len(in_ls), len(in_ep_sai)))

    print("\n" + "=" * 80)
    print("RECOMENDAÇÃO: O log do dashboard deve usar ESTOQUE_PROD_ENT e ESTOQUE_PROD_SAI como")
    print("fontes principais (tabelas do ERP). Incluir LOJA_ENTRADAS/LOJA_SAIDAS apenas para")
    print("registros que não existam nas tabelas ESTOQUE_PROD_*.")
    print("=" * 80)

    conn.close()

if __name__ == '__main__':
    main()

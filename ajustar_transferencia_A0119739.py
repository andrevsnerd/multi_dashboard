#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Script para AJUSTAR CAMPOS DE UMA TRANSFERÊNCIA EXISTENTE (caso pontual).

Objetivo: corrigir a entrada do romaneio A0119739 (e, opcionalmente, a saída 028964),
preenchendo:
  - RESPONSAVEL (login real do usuário)
  - TIPO_ENTRADA (quando estiver 0 ou NULL)
  - CM_OPERACAO (quando estiver vazio)

⚠ IMPORTANTE:
- Este script faz UPDATE direto em ESTOQUE_PROD_ENT (e LOJA_ENTRADAS apenas no RESPONSAVEL).
- Revise o preview e CONFIRME digitando 'SIM' antes da execução.
"""

import sys
import codecs
import pyodbc
import pandas as pd

# Forçar UTF-8 no Windows
if sys.platform == "win32":
    sys.stdout = codecs.getwriter("utf-8")(sys.stdout.buffer, "strict")

DB_CONFIG = {
    "server": "177.92.78.250",
    "server_fallback": "189.126.197.82",
    "database": "LINX_PRODUCAO",
    "username": "andre.nerd",
    "password": "nerd123@",
}

# Romaneios/filiais a ajustar (caso específico)
ROMANEIO_ENTRADA = "A0119739"
FILIAL_ENTRADA = "NERD LEBLON"
ROMANEIO_SAIDA = "028964"
FILIAL_ORIGEM = "NERD VILLA LOBOS"


def conectar_banco():
    servidores = [
        ("principal", DB_CONFIG["server"]),
        ("fallback", DB_CONFIG["server_fallback"]),
    ]
    ultimo_erro = None
    for nome, servidor in servidores:
        try:
            print(f"Conectando ao banco ({nome}: {servidor})...")
            conn_str = (
                "DRIVER={ODBC Driver 17 for SQL Server};"
                f"SERVER={servidor};"
                f"DATABASE={DB_CONFIG['database']};"
                f"UID={DB_CONFIG['username']};"
                f"PWD={DB_CONFIG['password']};"
                "Connection Timeout=30;"
            )
            conn = pyodbc.connect(conn_str)
            conn.timeout = 300
            print(f"✓ Conectado ao servidor {nome}")
            return conn
        except Exception as e:
            ultimo_erro = e
            print(f"✗ Erro conexão com {nome} ({servidor}): {e}")
            if nome == "principal":
                print("  Tentando servidor fallback...")
            continue
    print(f"✗ Falha ao conectar em todos os servidores. Último erro: {ultimo_erro}")
    return None


def buscar_responsaveis_disponiveis(conn) -> pd.DataFrame:
    """Busca responsáveis já utilizados em ESTOQUE_PROD_ENT (Nerd / Scarfme)."""
    query = """
        SELECT TOP 50
            LTRIM(RTRIM(ISNULL(RESPONSAVEL, ''))) AS RESPONSAVEL,
            COUNT(*) AS QTD
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE RESPONSAVEL IS NOT NULL
          AND LTRIM(RTRIM(RESPONSAVEL)) <> ''
          AND (
                FILIAL LIKE 'NERD%' OR
                FILIAL LIKE 'SCARF%' OR
                FILIAL LIKE 'SCARFME%'
          )
        GROUP BY LTRIM(RTRIM(ISNULL(RESPONSAVEL, '')))
        ORDER BY QTD DESC, RESPONSAVEL
    """
    try:
        df = pd.read_sql(query, conn)
        return df
    except Exception as e:
        print(f"⚠ Erro ao buscar responsáveis: {e}")
        return pd.DataFrame()


def selecionar_responsavel(conn, atual: str) -> str:
    """Permite escolher um responsável real, mostrando o valor atual."""
    df = buscar_responsaveis_disponiveis(conn)

    print("\n" + "=" * 100)
    print("SELECIONAR RESPONSÁVEL PARA O ROMANEIO DE ENTRADA")
    print("=" * 100)
    print(f"Responsável atual em ESTOQUE_PROD_ENT: '{(atual or '').strip() or '(vazio)'}'")

    if df.empty:
        print("\n⚠ Não foi possível listar responsáveis existentes.")
        resp = input("Digite manualmente o responsável (login LINX): ").strip().upper()
        return resp or atual or "LOGISTICA"

    print("\n💡 Responsáveis mais utilizados (Nerd / Scarfme):")
    print("-" * 100)
    for idx, row in df.iterrows():
        print(f"{idx + 1:2d}. {row['RESPONSAVEL']:<20}  ({int(row['QTD'])} entradas)")
    print("-" * 100)
    print("  0. Manter o responsável atual")
    print("  99. Digitar outro responsável manualmente")

    while True:
        esc = input(f"\n🎯 Escolha (0, 1-{len(df)}, 99): ").strip()
        try:
            n = int(esc)
            if n == 0:
                return atual
            if n == 99:
                outro = input("Digite o login do responsável: ").strip().upper()
                if outro:
                    return outro
                else:
                    print("⚠ Valor vazio, tente novamente.")
            elif 1 <= n <= len(df):
                resp = str(df.iloc[n - 1]["RESPONSAVEL"]).strip()
                print(f"\n✓ Responsável selecionado: {resp}")
                return resp
            else:
                print(f"⚠ Número inválido. Use 0, 1-{len(df)} ou 99.")
        except ValueError:
            print("⚠ Valor inválido. Digite um número.")


def buscar_regras_entrada_por_tipo(conn, tipo_romaneio: str) -> pd.DataFrame:
    """Busca combinações (TIPO_ENTRADA, CM_OPERACAO) usadas para um TIPO_ROMANEIO."""
    tipo_limpo = (tipo_romaneio or "").strip()
    query = """
        SELECT
            ISNULL(LTRIM(RTRIM(TIPO_ROMANEIO)), '') AS TIPO_ROMANEIO,
            ISNULL(TIPO_ENTRADA, 0) AS TIPO_ENTRADA,
            ISNULL(CM_OPERACAO, '') AS CM_OPERACAO,
            COUNT(*) AS QTD
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE (FILIAL LIKE 'NERD%' OR FILIAL LIKE 'SCARF%' OR FILIAL LIKE 'SCARFME%')
          AND ISNULL(LTRIM(RTRIM(TIPO_ROMANEIO)), '') = ?
        GROUP BY
            ISNULL(LTRIM(RTRIM(TIPO_ROMANEIO)), ''),
            ISNULL(TIPO_ENTRADA, 0),
            ISNULL(CM_OPERACAO, '')
        ORDER BY QTD DESC
    """
    try:
        return pd.read_sql(query, conn, params=[tipo_limpo])
    except Exception as e:
        print(f"⚠ Erro ao buscar regras de entrada para '{tipo_limpo}': {e}")
        return pd.DataFrame()


def selecionar_regra_tipo_entrada(conn, tipo_romaneio: str, tipo_atual: int, cm_atual: str):
    """Permite escolher a combinação correta de TIPO_ENTRADA/CM_OPERACAO."""
    print("\n" + "=" * 100)
    print("SELECIONAR TIPO_ENTRADA / CM_OPERACAO")
    print("=" * 100)
    print(f"TIPO_ROMANEIO atual: '{(tipo_romaneio or '').strip() or '(vazio)'}'")
    print(f"TIPO_ENTRADA atual: {tipo_atual if tipo_atual is not None else 'NULL'}")
    print(f"CM_OPERACAO atual: '{(cm_atual or '').strip() or '(vazio)'}'")

    df = buscar_regras_entrada_por_tipo(conn, tipo_romaneio)
    if df.empty:
        print("\n⚠ Nenhuma combinação histórica encontrada para este TIPO_ROMANEIO.")
        # Sugerir defaults seguros
        sugestao_te = 1 if not tipo_atual or tipo_atual == 0 else tipo_atual
        sugestao_cm = cm_atual or "003"
        print(f"Sugestão: TIPO_ENTRADA = {sugestao_te}, CM_OPERACAO = {sugestao_cm}")
        te_str = input(f"Informe TIPO_ENTRADA (ENTER para {sugestao_te}): ").strip()
        if te_str:
            try:
                tipo_novo = int(te_str)
            except ValueError:
                print("⚠ Valor inválido, usando sugestão.")
                tipo_novo = sugestao_te
        else:
            tipo_novo = sugestao_te
        cm_novo = input(f"Informe CM_OPERACAO (ENTER para '{sugestao_cm}'): ").strip() or sugestao_cm
        return tipo_novo, cm_novo

    # Se só há uma combinação, usar direto
    if len(df) == 1:
        r = df.iloc[0]
        tipo_novo = int(r["TIPO_ENTRADA"])
        cm_novo = str(r["CM_OPERACAO"]).strip()
        print(
            f"\n✓ Usando combinação histórica: "
            f"TIPO_ENTRADA={tipo_novo}, CM_OPERACAO='{cm_novo or '(vazio)'}' (QTD={int(r['QTD'])})"
        )
        return tipo_novo, cm_novo

    # Várias combinações – mostrar e deixar escolher
    print("\nCombinações históricas para este tipo:")
    print("-" * 100)
    for idx, r in df.iterrows():
        print(
            f"{idx + 1:2d}. TIPO_ENTRADA={int(r['TIPO_ENTRADA'])}  "
            f"CM_OPERACAO='{str(r['CM_OPERACAO']).strip() or '(vazio)'}'  "
            f"QTD={int(r['QTD'])}"
        )
    print("-" * 100)
    print("0. Manter valores atuais")

    while True:
        esc = int(input(f"\nEscolha a combinação (0-{len(df)}): ").strip() or "0")
        if esc == 0:
            return tipo_atual or 1, cm_atual or "003"
        if 1 <= esc <= len(df):
            r = df.iloc[esc - 1]
            tipo_novo = int(r["TIPO_ENTRADA"])
            cm_novo = str(r["CM_OPERACAO"]).strip()
            print(
                f"\n✓ Selecionado: TIPO_ENTRADA={tipo_novo}, "
                f"CM_OPERACAO='{cm_novo or '(vazio)'}'"
            )
            return tipo_novo, cm_novo
        print("⚠ Número inválido.")


def carregar_dados_atual(conn):
    """Carrega a situação atual da entrada e da saída para preview."""
    print("\n" + "=" * 100)
    print("DADOS ATUAIS DA TRANSFERÊNCIA")
    print("=" * 100)

    # Entrada - ESTOQUE_PROD_ENT
    query_ent = """
        SELECT TOP 1
            ROMANEIO_PRODUTO,
            FILIAL,
            EMISSAO,
            RESPONSAVEL,
            FILIAL_ORIGEM,
            ROMANEIO_ORIGEM,
            TIPO_ROMANEIO,
            TIPO_ENTRADA,
            CM_OPERACAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        ORDER BY EMISSAO DESC
    """
    df_ent = pd.read_sql(query_ent, conn, params=[ROMANEIO_ENTRADA, FILIAL_ENTRADA])

    if df_ent.empty:
        print(f"\n✗ Nenhum registro encontrado em ESTOQUE_PROD_ENT para {ROMANEIO_ENTRADA} / {FILIAL_ENTRADA}")
    else:
        print("\nESTOQUE_PROD_ENT (entrada):")
        print(df_ent.to_string(index=False))

    # Saída - ESTOQUE_PROD_SAI (somente para consulta)
    query_sai = """
        SELECT TOP 1
            S.ROMANEIO_PRODUTO,
            S.FILIAL,
            S.FILIAL_DESTINO,
            S.EMISSAO,
            S.RESPONSAVEL,
            S.TIPO_ROMANEIO,
            S.CM_OPERACAO,
            F_ORIGEM.EMPRESA AS EMPRESA_ORIGEM,
            F_DESTINO.EMPRESA AS EMPRESA_DESTINO
        FROM ESTOQUE_PROD_SAI S WITH (NOLOCK)
        LEFT JOIN FILIAIS F_ORIGEM WITH (NOLOCK) ON S.FILIAL = F_ORIGEM.FILIAL
        LEFT JOIN FILIAIS F_DESTINO WITH (NOLOCK) ON S.FILIAL_DESTINO = F_DESTINO.FILIAL
        WHERE S.ROMANEIO_PRODUTO = ? AND S.FILIAL = ?
        ORDER BY S.EMISSAO DESC
    """
    df_sai = pd.read_sql(query_sai, conn, params=[ROMANEIO_SAIDA, FILIAL_ORIGEM])
    if df_sai.empty:
        print(f"\n✗ Nenhum registro encontrado em ESTOQUE_PROD_SAI para {ROMANEIO_SAIDA} / {FILIAL_ORIGEM}")
    else:
        print("\nESTOQUE_PROD_SAI (saída):")
        print(df_sai.to_string(index=False))

    return df_ent, df_sai


def determinar_cm_operacao_saida(conn, filial_origem: str, filial_destino: str) -> str:
    """
    Determina CM_OPERACAO da saída baseado na regra de empresas:
    - Mesma empresa → CM_OPERACAO='012' (SAIDA DO ESTOQUE PARA TRANSFERENCIA)
    - Empresa diferente → CM_OPERACAO='011' (SAIDA DO ESTOQUE)
    
    IMPORTANTE: CM_OPERACAO é independente de TIPO_ROMANEIO.
    TIPO_ROMANEIO pode ser "TRANSFERENCIA ENTRE LOJAS" mas CM_OPERACAO será '011' se empresas diferentes.
    """
    try:
        query = """
            SELECT FILIAL, EMPRESA
            FROM FILIAIS WITH (NOLOCK)
            WHERE FILIAL IN (?, ?)
        """
        cursor = conn.cursor()
        cursor.execute(query, [filial_origem, filial_destino])
        rows = cursor.fetchall()
        
        empresa_origem = None
        empresa_destino = None
        
        for row in rows:
            filial = str(row[0]).strip()
            empresa = row[1] if row[1] is not None else None
            
            if filial == filial_origem.strip():
                empresa_origem = empresa
            elif filial == filial_destino.strip():
                empresa_destino = empresa
        
        if empresa_origem is None or empresa_destino is None:
            print(f"⚠️  Não foi possível determinar empresas. Usando padrão CM_OPERACAO='011'")
            return '011'
        
        # Aplicar regra
        if empresa_origem == empresa_destino:
            # Mesma empresa → CM_OPERACAO='012'
            print(f"✓ Mesma empresa ({empresa_origem}) → CM_OPERACAO='012' (SAIDA DO ESTOQUE PARA TRANSFERENCIA)")
            return '012'
        else:
            # Empresa diferente → CM_OPERACAO='011'
            print(f"✓ Empresas diferentes ({empresa_origem} → {empresa_destino}) → CM_OPERACAO='011' (SAIDA DO ESTOQUE)")
            return '011'
            
    except Exception as e:
        print(f"⚠️  Erro ao determinar CM_OPERACAO da saída: {e}. Usando padrão CM_OPERACAO='011'")
        return '011'


def ajustar_transferencia(conn):
    """Fluxo principal de ajuste da transferência específica."""
    df_ent, df_sai = carregar_dados_atual(conn)
    if df_ent.empty:
        print("\nNada a ajustar (entrada não encontrada).")
        return

    row = df_ent.iloc[0]
    tipo_rom = str(row["TIPO_ROMANEIO"]).strip() if row["TIPO_ROMANEIO"] is not None else ""
    tipo_ent_atual = int(row["TIPO_ENTRADA"]) if row["TIPO_ENTRADA"] is not None else 0
    cm_atual = str(row["CM_OPERACAO"]).strip() if row["CM_OPERACAO"] is not None else ""
    resp_atual = str(row["RESPONSAVEL"]).strip() if row["RESPONSAVEL"] is not None else ""

    # Selecionar responsável
    responsavel_novo = selecionar_responsavel(conn, resp_atual)

    # Selecionar regra de tipo_entrada / cm_operacao (para entrada)
    tipo_ent_novo, cm_novo = selecionar_regra_tipo_entrada(
        conn, tipo_rom, tipo_ent_atual, cm_atual
    )

    # Verificar situação da saída
    resp_sai_atual = ""
    cm_sai_atual = ""
    filial_destino_saida = ""
    if not df_sai.empty:
        resp_sai_atual = str(df_sai.iloc[0]["RESPONSAVEL"]).strip() if df_sai.iloc[0]["RESPONSAVEL"] is not None else ""
        cm_sai_atual = str(df_sai.iloc[0]["CM_OPERACAO"]).strip() if df_sai.iloc[0]["CM_OPERACAO"] is not None else ""
        filial_destino_saida = str(df_sai.iloc[0]["FILIAL_DESTINO"]).strip() if df_sai.iloc[0]["FILIAL_DESTINO"] is not None else ""
    
    # Determinar CM_OPERACAO da saída baseado nas empresas
    cm_sai_novo = ""
    if not df_sai.empty and filial_destino_saida:
        cm_sai_novo = determinar_cm_operacao_saida(conn, FILIAL_ORIGEM, filial_destino_saida)
    else:
        cm_sai_novo = cm_sai_atual or '011'  # Padrão se não conseguir determinar
    
    # Preview das alterações
    print("\n" + "=" * 100)
    print("PREVIEW DAS ALTERAÇÕES PROPOSTAS")
    print("=" * 100)
    print(f"Romaneio de ENTRADA: {ROMANEIO_ENTRADA}")
    print(f"Filial: {FILIAL_ENTRADA}")
    print(f"TIPO_ROMANEIO: '{tipo_rom or '(vazio)'}'")
    print(f"\nResponsável (ENTRADA):")
    print(f"  Atual : '{resp_atual or '(vazio)'}'")
    print(f"  Novo  : '{responsavel_novo or '(vazio)'}'")
    print("\nTIPO_ENTRADA / CM_OPERACAO (ENTRADA):")
    print(f"  Atual : TIPO_ENTRADA={tipo_ent_atual}, CM_OPERACAO='{cm_atual or '(vazio)'}'")
    print(f"  Novo  : TIPO_ENTRADA={tipo_ent_novo}, CM_OPERACAO='{cm_novo or '(vazio)'}'")
    
    if not df_sai.empty:
        print(f"\nRomaneio de SAÍDA: {ROMANEIO_SAIDA}")
        print(f"Filial: {FILIAL_ORIGEM}")
        print(f"TIPO_ROMANEIO: '{tipo_rom or '(vazio)'}' (mantido igual à entrada)")
        print(f"\nResponsável (SAÍDA):")
        print(f"  Atual : '{resp_sai_atual or '(vazio)'}'")
        print(f"  Novo  : '{responsavel_novo or '(vazio)'}'")
        print(f"\nCM_OPERACAO (SAÍDA):")
        print(f"  Atual : '{cm_sai_atual or '(vazio)'}'")
        print(f"  Novo  : '{cm_sai_novo or '(vazio)'}'")
        if filial_destino_saida:
            print(f"  💡 Determinado automaticamente baseado nas empresas (origem → destino)")
            if cm_sai_novo == '011':
                print(f"\nFILIAL_DESTINO (SAÍDA):")
                print(f"  Atual : '{filial_destino_saida}'")
                print(f"  Novo  : '(vazio/NULL)'")
                print(f"  💡 Será limpo para aparecer na planilha 'Saída do estoque'")

    confirmar = input("\n💡 Digite 'SIM' para confirmar a atualização: ").strip().upper()
    if confirmar != "SIM":
        print("\n❌ Operação cancelada. Nenhuma alteração foi feita.")
        return

    # Executar updates
    cursor = conn.cursor()
    try:
        # Atualizar ESTOQUE_PROD_ENT
        sql_update_ent = """
            UPDATE ESTOQUE_PROD_ENT
            SET RESPONSAVEL = ?, TIPO_ENTRADA = ?, CM_OPERACAO = ?
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        cursor.execute(
            sql_update_ent,
            (responsavel_novo or None, tipo_ent_novo, cm_novo or None, ROMANEIO_ENTRADA, FILIAL_ENTRADA),
        )
        af_ent = cursor.rowcount

        # Atualizar LOJA_ENTRADAS (apenas RESPONSAVEL, se existir)
        sql_update_le = """
            UPDATE LOJA_ENTRADAS
            SET RESPONSAVEL = ?
            WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
        """
        try:
            cursor.execute(sql_update_le, (responsavel_novo or None, ROMANEIO_ENTRADA, FILIAL_ENTRADA))
            af_le = cursor.rowcount
        except Exception as e:
            print(f"⚠ Erro ao atualizar LOJA_ENTRADAS (ignorado): {e}")
            af_le = 0
        
        # Atualizar SAÍDA - ESTOQUE_PROD_SAI (RESPONSAVEL, CM_OPERACAO e FILIAL_DESTINO)
        # IMPORTANTE: Para CM_OPERACAO='011' (empresa diferente), FILIAL_DESTINO deve ser NULL
        # para aparecer na planilha "Saída de produto acabado do estoque"
        af_ep_sai = 0
        if not df_sai.empty:
            # Se CM_OPERACAO='011', limpar FILIAL_DESTINO para aparecer na planilha correta
            filial_destino_novo = None if cm_sai_novo == '011' else filial_destino_saida
            
            sql_update_ep_sai = """
                UPDATE ESTOQUE_PROD_SAI
                SET RESPONSAVEL = ?, CM_OPERACAO = ?, FILIAL_DESTINO = ?
                WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
            """
            try:
                cursor.execute(sql_update_ep_sai, (responsavel_novo or None, cm_sai_novo or None, filial_destino_novo, ROMANEIO_SAIDA, FILIAL_ORIGEM))
                af_ep_sai = cursor.rowcount
                if cm_sai_novo == '011' and filial_destino_saida:
                    print(f"  ℹ️  FILIAL_DESTINO foi limpo (NULL) para aparecer na planilha 'Saída do estoque'")
            except Exception as e:
                print(f"⚠ Erro ao atualizar ESTOQUE_PROD_SAI (ignorado): {e}")
                af_ep_sai = 0
        
        # Atualizar SAÍDA - LOJA_SAIDAS (apenas RESPONSAVEL)
        af_ls = 0
        if not df_sai.empty:
            sql_update_ls = """
                UPDATE LOJA_SAIDAS
                SET RESPONSAVEL = ?
                WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
            """
            try:
                cursor.execute(sql_update_ls, (responsavel_novo or None, ROMANEIO_SAIDA, FILIAL_ORIGEM))
                af_ls = cursor.rowcount
            except Exception as e:
                print(f"⚠ Erro ao atualizar LOJA_SAIDAS (ignorado): {e}")
                af_ls = 0

        conn.commit()
        print("\n✅ Atualização concluída com sucesso.")
        print(f"  Linhas atualizadas em ESTOQUE_PROD_ENT : {af_ent}")
        print(f"  Linhas atualizadas em LOJA_ENTRADAS   : {af_le}")
        if not df_sai.empty:
            print(f"  Linhas atualizadas em ESTOQUE_PROD_SAI : {af_ep_sai}")
            print(f"  Linhas atualizadas em LOJA_SAIDAS     : {af_ls}")

        # Mostrar novamente dados após ajuste
        print("\n🔍 Dados atualizados:")
        df_ent2, df_sai2 = carregar_dados_atual(conn)
    except Exception as e:
        conn.rollback()
        print(f"\n✗ Erro ao atualizar registros: {e}")
        import traceback
        traceback.print_exc()
    finally:
        cursor.close()


def main():
    print("=" * 100)
    print("AJUSTE DE TRANSFERÊNCIA EXISTENTE - ROMANEIO ENTRADA A0119739")
    print("=" * 100)

    conn = conectar_banco()
    if not conn:
        return
    try:
        ajustar_transferencia(conn)
    finally:
        conn.close()
        print("\n✓ Conexão com banco de dados fechada.")


if __name__ == "__main__":
    main()


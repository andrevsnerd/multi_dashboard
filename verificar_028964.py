#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import pyodbc
import pandas as pd

conn = pyodbc.connect(
    'DRIVER={ODBC Driver 17 for SQL Server};'
    'SERVER=177.92.78.250;'
    'DATABASE=LINX_PRODUCAO;'
    'UID=andre.nerd;'
    'PWD=nerd123@'
)

ROMANEIO = '028964'
ROMANEIO_OK = '015948'  # Um que funciona

print("="*100)
print(f"VERIFICANDO ROMANEIO {ROMANEIO}")
print("="*100)

# Verificar cabeçalho
print("\n1. ESTOQUE_PROD_SAI:")
query = "SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_DESTINO, ROMANEIO_DESTINO, TIPO_ROMANEIO, CM_OPERACAO FROM ESTOQUE_PROD_SAI WHERE ROMANEIO_PRODUTO = ?"
df = pd.read_sql(query, conn, params=[ROMANEIO])
print(df.to_string(index=False))

# Verificar itens
print("\n2. ESTOQUE_PROD1_SAI:")
query = "SELECT ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE FROM ESTOQUE_PROD1_SAI WHERE ROMANEIO_PRODUTO = ?"
df = pd.read_sql(query, conn, params=[ROMANEIO])
print(df.to_string(index=False) if not df.empty else "   VAZIO!")

# Verificar LOJA_SAIDAS
print("\n3. LOJA_SAIDAS:")
query = "SELECT ROMANEIO_PRODUTO, FILIAL, SAIDA_ENCERRADA, SAIDA_CANCELADA, TIPO_ENTRADA_SAIDA FROM LOJA_SAIDAS WHERE ROMANEIO_PRODUTO = ?"
df = pd.read_sql(query, conn, params=[ROMANEIO])
print(df.to_string(index=False) if not df.empty else "   VAZIO!")

# Comparar com um que funciona
print("\n" + "="*100)
print(f"COMPARANDO COM {ROMANEIO_OK} (que funciona)")
print("="*100)

print("\nESTOQUE_PROD_SAI (que funciona):")
query = "SELECT ROMANEIO_PRODUTO, FILIAL, FILIAL_DESTINO, ROMANEIO_DESTINO, TIPO_ROMANEIO, CM_OPERACAO FROM ESTOQUE_PROD_SAI WHERE ROMANEIO_PRODUTO = ?"
df_ok = pd.read_sql(query, conn, params=[ROMANEIO_OK])
print(df_ok.to_string(index=False))

print("\nLOJA_SAIDAS (que funciona):")
query = "SELECT ROMANEIO_PRODUTO, FILIAL, SAIDA_ENCERRADA, SAIDA_CANCELADA, TIPO_ENTRADA_SAIDA FROM LOJA_SAIDAS WHERE ROMANEIO_PRODUTO = ?"
df_ok_loja = pd.read_sql(query, conn, params=[ROMANEIO_OK])
print(df_ok_loja.to_string(index=False))

conn.close()

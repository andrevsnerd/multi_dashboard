import pyodbc
import pandas as pd

def conectar_banco():
    """Conecta ao banco de dados"""
    try:
        # Tentar servidor principal primeiro
        server = '177.92.78.250'
        database = 'LINX'
        username = 'sa'
        password = 'Linx@2024'
        
        print(f"Conectando ao banco (principal: {server})...")
        conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={server};DATABASE={database};UID={username};PWD={password}'
        conn = pyodbc.connect(conn_str)
        print(f"✓ Conectado ao servidor principal ({server})")
        return conn
    except Exception as e:
        print(f"✗ Erro ao conectar ao servidor principal: {e}")
        # Tentar servidor secundário
        try:
            server = '177.92.78.250\\SQLEXPRESS'
            print(f"Tentando servidor secundário: {server}...")
            conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={server};DATABASE={database};UID={username};PWD={password}'
            conn = pyodbc.connect(conn_str)
            print(f"✓ Conectado ao servidor secundário ({server})")
            return conn
        except Exception as e2:
            print(f"✗ Erro ao conectar ao servidor secundário: {e2}")
            return None

def verificar_romaneio(conn, romaneio, filial):
    """Verifica se o romaneio existe de várias formas"""
    print(f"\n{'='*80}")
    print(f"VERIFICANDO ROMANEIO: {romaneio} para FILIAL: {filial}")
    print(f"{'='*80}")
    
    # Query 1: Com LTRIM/RTRIM
    query1 = """
        SELECT ROMANEIO_PRODUTO, FILIAL, EMISSAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = ? AND LTRIM(RTRIM(FILIAL)) = ?
    """
    print("\n1. Query com LTRIM/RTRIM:")
    try:
        cursor = conn.cursor()
        cursor.execute(query1, [romaneio.strip(), filial.strip()])
        rows = cursor.fetchall()
        if rows:
            print(f"   ✓ ENCONTRADO {len(rows)} registro(s):")
            for row in rows:
                print(f"      Romaneio: '{row[0]}' | Filial: '{row[1]}' | Emissao: {row[2]}")
        else:
            print("   ✗ Não encontrado")
        cursor.close()
    except Exception as e:
        print(f"   ✗ Erro: {e}")
    
    # Query 2: Sem LTRIM/RTRIM
    query2 = """
        SELECT ROMANEIO_PRODUTO, FILIAL, EMISSAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO = ? AND FILIAL = ?
    """
    print("\n2. Query sem LTRIM/RTRIM:")
    try:
        cursor = conn.cursor()
        cursor.execute(query2, [romaneio, filial])
        rows = cursor.fetchall()
        if rows:
            print(f"   ✓ ENCONTRADO {len(rows)} registro(s):")
            for row in rows:
                print(f"      Romaneio: '{row[0]}' | Filial: '{row[1]}' | Emissao: {row[2]}")
        else:
            print("   ✗ Não encontrado")
        cursor.close()
    except Exception as e:
        print(f"   ✗ Erro: {e}")
    
    # Query 3: Buscar todos os romaneios T028964
    query3 = """
        SELECT ROMANEIO_PRODUTO, FILIAL, EMISSAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE ROMANEIO_PRODUTO LIKE ?
        ORDER BY EMISSAO DESC
    """
    print(f"\n3. Todos os romaneios que contêm '{romaneio}':")
    try:
        cursor = conn.cursor()
        cursor.execute(query3, [f'%{romaneio}%'])
        rows = cursor.fetchall()
        if rows:
            print(f"   ✓ ENCONTRADO {len(rows)} registro(s):")
            for row in rows[:10]:  # Mostrar apenas os 10 primeiros
                print(f"      Romaneio: '{row[0]}' | Filial: '{row[1]}' | Emissao: {row[2]}")
        else:
            print("   ✗ Não encontrado")
        cursor.close()
    except Exception as e:
        print(f"   ✗ Erro: {e}")
    
    # Query 4: Buscar todos os romaneios para NERD LEBLON
    query4 = """
        SELECT TOP 10 ROMANEIO_PRODUTO, FILIAL, EMISSAO
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
        WHERE FILIAL LIKE ?
        ORDER BY EMISSAO DESC
    """
    print(f"\n4. Últimos 10 romaneios para filiais que contêm 'LEBLON':")
    try:
        cursor = conn.cursor()
        cursor.execute(query4, [f'%LEBLON%'])
        rows = cursor.fetchall()
        if rows:
            print(f"   ✓ ENCONTRADO {len(rows)} registro(s):")
            for row in rows:
                print(f"      Romaneio: '{row[0]}' | Filial: '{row[1]}' | Emissao: {row[2]}")
        else:
            print("   ✗ Não encontrado")
        cursor.close()
    except Exception as e:
        print(f"   ✗ Erro: {e}")

if __name__ == '__main__':
    conn = conectar_banco()
    if conn:
        verificar_romaneio(conn, 'T028964', 'NERD LEBLON')
        conn.close()
        print(f"\n{'='*80}")
        print("Verificação concluída")
        print(f"{'='*80}")

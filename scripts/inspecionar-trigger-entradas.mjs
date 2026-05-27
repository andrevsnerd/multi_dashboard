/**
 * (read-only) Inspeciona os triggers de LOJA_ENTRADAS e como STATUS_TRANSITO /
 * ENTRADA_CONFERIDA são tratados — para entender o fluxo natural do Linx antes
 * de alterar o executor.
 */

import sql from 'mssql';

const config = {
  server: '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user: 'andre.sabetta',
  password: 'asabetta',
  port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
  connectionTimeout: 30000,
};

async function q(pool, text) { return (await pool.request().query(text)).recordset; }

async function main() {
  const pool = await sql.connect(config);

  // Definição dos triggers de INSERT/UPDATE de LOJA_ENTRADAS
  for (const trg of ['LXI_LOJA_ENTRADAS', 'LXU_LOJA_ENTRADAS']) {
    const rows = await q(pool, `
      SELECT m.definition
      FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
      WHERE o.name = '${trg}'`);
    console.log(`\n${'═'.repeat(78)}\nTRIGGER: ${trg}\n${'═'.repeat(78)}`);
    if (!rows.length) { console.log('(não encontrado)'); continue; }
    const def = rows[0].definition || '';
    // Mostra só as partes que tocam STATUS_TRANSITO / ENTRADA_CONFERIDA / ENTRADA_ENCERRADA
    const linhas = def.split(/\r?\n/);
    linhas.forEach((l, i) => {
      if (/STATUS_TRANSITO|ENTRADA_CONFERIDA|ENTRADA_ENCERRADA|FILIAL_ORIGEM|ROMANEIO_NF_SAIDA/i.test(l)) {
        console.log(`  ${String(i + 1).padStart(4)}: ${l.trim()}`);
      }
    });
    console.log(`  (total ${linhas.length} linhas no trigger)`);
  }

  // Distribuição de STATUS_TRANSITO em entradas DIRETAS do Linx (sem origem) já existentes
  console.log(`\n${'═'.repeat(78)}\nDISTRIBUIÇÃO STATUS_TRANSITO — entradas SEM origem (entrada direta natural Linx)\n${'═'.repeat(78)}`);
  const dist = await q(pool, `
    SELECT
      ISNULL(CAST(STATUS_TRANSITO AS VARCHAR(10)),'NULL') AS STATUS_TRANSITO,
      CAST(ISNULL(ENTRADA_CONFERIDA,0) AS INT) AS ENTRADA_CONFERIDA,
      CAST(ISNULL(ENTRADA_ENCERRADA,0) AS INT) AS ENTRADA_ENCERRADA,
      COUNT(*) AS QTD
    FROM LOJA_ENTRADAS WITH (NOLOCK)
    WHERE ISNULL(LTRIM(RTRIM(FILIAL_ORIGEM)),'') = ''
      AND ISNULL(LTRIM(RTRIM(ROMANEIO_NF_SAIDA)),'') = ''
      AND ISNULL(ENTRADA_CANCELADA,0) = 0
    GROUP BY ISNULL(CAST(STATUS_TRANSITO AS VARCHAR(10)),'NULL'),
             CAST(ISNULL(ENTRADA_CONFERIDA,0) AS INT),
             CAST(ISNULL(ENTRADA_ENCERRADA,0) AS INT)
    ORDER BY QTD DESC`);
  dist.forEach((r) => console.log(`  STATUS_TRANSITO=${r.STATUS_TRANSITO} | CONFERIDA=${r.ENTRADA_CONFERIDA} | ENCERRADA=${r.ENTRADA_ENCERRADA} | QTD=${r.QTD}`));

  await pool.close();
}

main().catch((err) => { console.error('\nERRO FATAL:', err.message); process.exit(1); });

/**
 * (read-only) Procura entradas criadas pelo dashboard (executeEntradaLote)
 * que ficaram PRESAS no trânsito do Linx: STATUS_TRANSITO NULL/<4 e
 * ENTRADA_CONFERIDA=0, sem LOJA_ENTRADAS_PRODUTO mas com ESTOQUE_PROD1_ENT.
 *
 * Assinatura do dashboard: CM_OPERACAO='003', FILIAL_ORIGEM vazio,
 * ROMANEIO_NF_SAIDA vazio, ENTRADA_ENCERRADA=1, sem LOJA_ENTRADAS_PRODUTO.
 *
 * Divide por período: ANTES de 2026-05-14 (sem o fix) vs DEPOIS (com o fix).
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

function printRows(label, rows) {
  console.log(`\n${'─'.repeat(78)}`);
  console.log(`▶ ${label}  →  ${rows.length} linha(s)`);
  if (!rows.length) { console.log('   (nenhuma)'); return; }
  rows.forEach((row, i) => {
    const parts = Object.entries(row).map(([k, v]) => `${k}=${v == null ? 'NULL' : String(v).trim()}`).join(' | ');
    console.log(`   [${i + 1}] ${parts}`);
  });
}

const PRESAS_FILTER = `
  EXISTS (SELECT 1 FROM ESTOQUE_PROD_ENT h WITH (NOLOCK)
          WHERE h.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND h.FILIAL = le.FILIAL
            AND h.CM_OPERACAO = '003')
  AND ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)), '') = ''
  AND ISNULL(LTRIM(RTRIM(le.ROMANEIO_NF_SAIDA)), '') = ''
  AND ISNULL(le.ENTRADA_ENCERRADA, 0) = 1
  AND ISNULL(le.ENTRADA_CANCELADA, 0) = 0
  AND (le.STATUS_TRANSITO IS NULL OR le.STATUS_TRANSITO < 4)
  AND ISNULL(le.ENTRADA_CONFERIDA, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                  WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
  AND EXISTS (SELECT 1 FROM ESTOQUE_PROD1_ENT e WITH (NOLOCK)
              WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND e.FILIAL = le.FILIAL)`;

async function q(pool, text) { return (await pool.request().query(text)).recordset; }

async function main() {
  console.log('═'.repeat(78));
  console.log('ENTRADAS DO DASHBOARD PRESAS NO TRÂNSITO — antes vs depois do fix (14/05/2026)');
  console.log('═'.repeat(78));

  const pool = await sql.connect(config);

  printRows('A. Presas ANTES de 2026-05-14 (sem o fix — esperado)', await q(pool, `
    SELECT TOP 50 LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS FILIAL,
      le.STATUS_TRANSITO, le.ENTRADA_CONFERIDA, le.QTDE_TOTAL,
      CONVERT(VARCHAR(19), le.EMISSAO, 120) AS EMISSAO, le.RESPONSAVEL
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    WHERE ${PRESAS_FILTER} AND le.EMISSAO < '2026-05-14'
    ORDER BY le.EMISSAO DESC`));

  printRows('B. Presas EM/DEPOIS de 2026-05-14 (com o fix — se houver, o fix AINDA falha)', await q(pool, `
    SELECT TOP 50 LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS FILIAL,
      le.STATUS_TRANSITO, le.ENTRADA_CONFERIDA, le.QTDE_TOTAL,
      CONVERT(VARCHAR(19), le.EMISSAO, 120) AS EMISSAO, le.RESPONSAVEL
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    WHERE ${PRESAS_FILTER} AND le.EMISSAO >= '2026-05-14'
    ORDER BY le.EMISSAO DESC`));

  // Para contraste: entradas do dashboard que FORAM liberadas (STATUS_TRANSITO=4) após o fix
  printRows('C. Entradas do dashboard JÁ LIBERADAS (STATUS_TRANSITO=4) desde 2026-05-14', await q(pool, `
    SELECT TOP 30 LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS FILIAL,
      le.STATUS_TRANSITO, le.ENTRADA_CONFERIDA,
      CONVERT(VARCHAR(19), le.EMISSAO, 120) AS EMISSAO,
      CAST(le.OBS AS VARCHAR(120)) AS OBS
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    WHERE EXISTS (SELECT 1 FROM ESTOQUE_PROD_ENT h WITH (NOLOCK)
                  WHERE h.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND h.FILIAL = le.FILIAL
                    AND h.CM_OPERACAO = '003')
      AND ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)), '') = ''
      AND le.STATUS_TRANSITO = 4
      AND ISNULL(le.ENTRADA_CONFERIDA, 0) = 1
      AND le.EMISSAO >= '2026-05-14'
      AND NOT EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                      WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
    ORDER BY le.EMISSAO DESC`));

  await pool.close();
  console.log(`\n${'═'.repeat(78)}\nCONCLUÍDO\n${'═'.repeat(78)}`);
}

main().catch((err) => { console.error('\nERRO FATAL:', err.message); process.exit(1); });

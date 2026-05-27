import sql from 'mssql';
const config = { server: '177.92.78.250', database: 'LINX_PRODUCAO', user: 'andre.sabetta', password: 'asabetta', port: 1433, options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 120000, connectionTimeout: 30000 };
const FILTER = `
  EXISTS (SELECT 1 FROM ESTOQUE_PROD_ENT h WITH (NOLOCK)
          WHERE h.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND h.FILIAL = le.FILIAL AND h.CM_OPERACAO = '003')
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
const pool = await sql.connect(config);
const r = await pool.request().query(`SELECT COUNT(*) AS TOTAL FROM LOJA_ENTRADAS le WITH (NOLOCK) WHERE ${FILTER}`);
console.log('TOTAL DE ENTRADAS PRESAS (assinatura dashboard):', r.recordset[0].TOTAL);
const r2 = await pool.request().query(`SELECT CONVERT(VARCHAR(7), le.EMISSAO, 120) AS MES, COUNT(*) AS QTD FROM LOJA_ENTRADAS le WITH (NOLOCK) WHERE ${FILTER} GROUP BY CONVERT(VARCHAR(7), le.EMISSAO, 120) ORDER BY MES`);
console.log('Por mês:'); r2.recordset.forEach(x => console.log(`  ${x.MES}: ${x.QTD}`));
await pool.close();

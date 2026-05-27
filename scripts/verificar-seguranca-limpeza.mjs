/**
 * (read-only) Prova que a limpeza NÃO toca trânsitos reais da matriz.
 * Confirma:
 *   1. Todos os alvos têm FILIAL_ORIGEM vazio, ROMANEIO_NF_SAIDA vazio e sem LOJA_ENTRADAS_PRODUTO.
 *   2. Interseção entre ALVOS e TRÂNSITOS REAIS (com origem, na tela de trânsito) = 0.
 *   3. Mostra exemplos de trânsitos reais (com origem) que ficam de fora.
 */

import sql from 'mssql';

const config = {
  server: '177.92.78.250', database: 'LINX_PRODUCAO', user: 'andre.sabetta', password: 'asabetta',
  port: 1433, options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 120000, connectionTimeout: 30000,
};

// Assinatura do ALVO (entrada direta fake sem origem)
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

// Condição EXATA da tela de trânsito real (logTransito.ts) = trânsito legítimo (com origem)
const TRANSITO_REAL = `
  ISNULL(le.ENTRADA_CANCELADA, 0) = 0
  AND ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)), '') <> ''
  AND (
    ISNULL(LTRIM(RTRIM(le.ROMANEIO_NF_SAIDA)), '') <> ''
    OR EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
               WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
  )
  AND (le.STATUS_TRANSITO IS NULL OR le.STATUS_TRANSITO < 4 OR ISNULL(le.ENTRADA_ENCERRADA,0) = 0)
  AND EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
              WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)`;

async function q(pool, text) { return (await pool.request().query(text)).recordset; }
const pool = await sql.connect(config);

console.log('═'.repeat(78));
const a = await q(pool, `SELECT COUNT(*) AS N FROM LOJA_ENTRADAS le WITH (NOLOCK) WHERE ${FILTER}`);
console.log(`1) Total de ALVOS (entrada direta fake, sem origem): ${a[0].N}`);

// Verificação redundante: algum alvo com QUALQUER sinal de origem/transferência?
const suspeitos = await q(pool, `
  SELECT COUNT(*) AS N FROM LOJA_ENTRADAS le WITH (NOLOCK)
  WHERE ${FILTER}
    AND ( ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)),'') <> ''
       OR ISNULL(LTRIM(RTRIM(le.ROMANEIO_NF_SAIDA)),'') <> ''
       OR EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                  WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL) )`);
console.log(`2) Alvos com QUALQUER sinal de origem/NF/transferência: ${suspeitos[0].N}  (precisa ser 0)`);

// Interseção alvos ∩ trânsito real
const inter = await q(pool, `
  SELECT COUNT(*) AS N FROM LOJA_ENTRADAS le WITH (NOLOCK)
  WHERE (${FILTER}) AND (${TRANSITO_REAL})`);
console.log(`3) Interseção ALVOS ∩ TRÂNSITOS REAIS (com origem): ${inter[0].N}  (precisa ser 0)`);

// Quantos trânsitos reais existem (que NÃO serão tocados)
const reais = await q(pool, `SELECT COUNT(*) AS N FROM LOJA_ENTRADAS le WITH (NOLOCK) WHERE ${TRANSITO_REAL}`);
console.log(`4) Trânsitos REAIS no banco (preservados, NÃO tocados): ${reais[0].N}`);

const exReais = await q(pool, `
  SELECT TOP 8 LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
    LTRIM(RTRIM(ISNULL(le.FILIAL_ORIGEM,''))) AS ORIGEM,
    LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS DESTINO,
    LTRIM(RTRIM(ISNULL(le.ROMANEIO_NF_SAIDA,''))) AS NF_SAIDA,
    le.STATUS_TRANSITO
  FROM LOJA_ENTRADAS le WITH (NOLOCK) WHERE ${TRANSITO_REAL}
  ORDER BY le.EMISSAO DESC`);
console.log('\n   Exemplos de trânsitos REAIS que ficam intactos (têm origem):');
exReais.forEach((r) => console.log(`     ${r.ROMANEIO} | origem=${r.ORIGEM} → destino=${r.DESTINO} | NF_saida=${r.NF_SAIDA} | ST=${r.STATUS_TRANSITO}`));

await pool.close();
console.log(`\n${'═'.repeat(78)}`);
console.log(suspeitos[0].N === 0 && inter[0].N === 0 ? '✅ SEGURO: alvos são 100% entradas fake sem origem; nenhum trânsito real será tocado.' : '⛔ ATENÇÃO: revisar antes de aplicar.');
console.log('═'.repeat(78));

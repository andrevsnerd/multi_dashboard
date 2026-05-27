/**
 * INVESTIGAÇÃO (read-only) — Romaneios de entrada que apareceram na tela de
 * trânsito do Linx mesmo após "Confirmar Tudo".
 *
 * Uso: node scripts/investigar-romaneios-transito.mjs [rom1 rom2 ...]
 * Default: 832168 832169 832176
 *
 * NÃO altera nada. Apenas lê o estado atual em todas as tabelas relevantes
 * e roda as MESMAS condições WHERE usadas pela tela de trânsito e pela
 * liberação automática, para mostrar por que cada romaneio bate (ou não) em cada uma.
 */

import sql from 'mssql';

const ROMANEIOS = process.argv.slice(2).length ? process.argv.slice(2) : ['832168', '832169', '832176'];

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
  if (!rows.length) { console.log('   (sem resultados)'); return; }
  rows.forEach((row, i) => {
    const parts = Object.entries(row)
      .map(([k, v]) => `${k}=${v == null ? 'NULL' : String(v).trim()}`)
      .join(' | ');
    console.log(`   [${i + 1}] ${parts}`);
  });
}

async function q(pool, text) {
  const r = await pool.request().query(text);
  return r.recordset;
}

async function main() {
  console.log('═'.repeat(78));
  console.log(`INVESTIGAÇÃO ROMANEIOS EM TRÂNSITO (read-only)`);
  console.log(`Romaneios: ${ROMANEIOS.join(', ')}`);
  console.log('═'.repeat(78));

  const pool = await sql.connect(config);
  const inList = ROMANEIOS.map((r) => `'${r.replace(/'/g, "''")}'`).join(',');

  // 1. LOJA_ENTRADAS — o cabeçalho que define se aparece em trânsito
  printRows('1. LOJA_ENTRADAS (flags de trânsito / conferência)', await q(pool, `
    SELECT
      LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(FILIAL,''))) AS FILIAL,
      LTRIM(RTRIM(ISNULL(FILIAL_ORIGEM,''))) AS FILIAL_ORIGEM,
      LTRIM(RTRIM(ISNULL(ROMANEIO_NF_SAIDA,''))) AS ROMANEIO_NF_SAIDA,
      STATUS_TRANSITO,
      ENTRADA_CONFERIDA,
      ENTRADA_ENCERRADA,
      ENTRADA_CANCELADA,
      QTDE_TOTAL,
      EMISSAO,
      RESPONSAVEL,
      CAST(OBS AS VARCHAR(300)) AS OBS
    FROM LOJA_ENTRADAS WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) IN (${inList})
    ORDER BY ROMANEIO_PRODUTO, FILIAL`));

  // 2. ESTOQUE_PROD_ENT — cabeçalho da entrada
  printRows('2. ESTOQUE_PROD_ENT (cabeçalho da entrada)', await q(pool, `
    SELECT
      LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(FILIAL,''))) AS FILIAL,
      LTRIM(RTRIM(ISNULL(FILIAL_ORIGEM,''))) AS FILIAL_ORIGEM,
      LTRIM(RTRIM(ISNULL(ROMANEIO_ORIGEM,''))) AS ROMANEIO_ORIGEM,
      TIPO_ENTRADA, TIPO_ROMANEIO, CM_OPERACAO, EMISSAO,
      CAST(ISNULL(OBS,'') AS VARCHAR(200)) AS OBS
    FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) IN (${inList})
    ORDER BY ROMANEIO_PRODUTO`));

  // 3. ESTOQUE_PROD1_ENT — itens (é o que efetivamente entra no estoque via trigger EN_N)
  printRows('3. ESTOQUE_PROD1_ENT (itens — entrada de estoque real)', await q(pool, `
    SELECT
      LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(FILIAL,''))) AS FILIAL,
      LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
      LTRIM(RTRIM(ISNULL(COR_PRODUTO,''))) AS COR,
      QTDE
    FROM ESTOQUE_PROD1_ENT WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) IN (${inList})
    ORDER BY ROMANEIO_PRODUTO, PRODUTO`));

  // 4. LOJA_ENTRADAS_PRODUTO — se EXISTIR, é o que faz aparecer em trânsito
  printRows('4. LOJA_ENTRADAS_PRODUTO (presença = aparece em trânsito!)', await q(pool, `
    SELECT
      LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(FILIAL,''))) AS FILIAL,
      LTRIM(RTRIM(PRODUTO)) AS PRODUTO,
      LTRIM(RTRIM(ISNULL(COR_PRODUTO,''))) AS COR,
      QTDE_ENTRADA
    FROM LOJA_ENTRADAS_PRODUTO WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) IN (${inList})
    ORDER BY ROMANEIO_PRODUTO, PRODUTO`));

  // 5. Réplica EXATA da condição da TELA DE TRÂNSITO (logTransito.ts) — diz se aparece lá
  printRows('5. CONDIÇÃO DA TELA DE TRÂNSITO — aparece? (replica logTransito.ts)', await q(pool, `
    SELECT
      LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS FILIAL,
      CASE WHEN
        ISNULL(le.ENTRADA_CANCELADA, 0) = 0
        AND ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)), '') <> ''
        AND (
          ISNULL(LTRIM(RTRIM(le.ROMANEIO_NF_SAIDA)), '') <> ''
          OR EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                     WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
        )
        AND (le.STATUS_TRANSITO IS NULL OR le.STATUS_TRANSITO < 4 OR ISNULL(le.ENTRADA_ENCERRADA,0) = 0)
        AND EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                    WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
      THEN 'SIM — APARECE EM TRÂNSITO' ELSE 'nao' END AS APARECE_TRANSITO
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    WHERE LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) IN (${inList})
    ORDER BY le.ROMANEIO_PRODUTO`));

  // 6. Réplica da condição de LIBERAÇÃO AUTOMÁTICA (executar/route.ts) — bateria?
  printRows('6. CONDIÇÃO DA LIBERAÇÃO AUTOMÁTICA — teria liberado? (replica executar/route.ts)', await q(pool, `
    SELECT
      LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS FILIAL,
      CASE WHEN
        (le.STATUS_TRANSITO IS NULL OR le.STATUS_TRANSITO < 4)
        AND ISNULL(le.ENTRADA_CONFERIDA, 0) = 0
        AND ISNULL(le.ENTRADA_ENCERRADA, 0) = 1
        AND NOT EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                        WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
        AND EXISTS (SELECT 1 FROM ESTOQUE_PROD1_ENT e WITH (NOLOCK)
                    WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND e.FILIAL = le.FILIAL)
      THEN 'SIM — auto-release bateria' ELSE 'NAO — auto-release nao pega' END AS AUTO_RELEASE_BATE
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    WHERE LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) IN (${inList})
    ORDER BY le.ROMANEIO_PRODUTO`));

  // 7. Triggers ativos nas tabelas envolvidas (podem popular LOJA_ENTRADAS_PRODUTO / setar STATUS_TRANSITO)
  printRows('7. TRIGGERS nas tabelas de entrada', await q(pool, `
    SELECT
      t.name AS TRIGGER_NAME,
      OBJECT_NAME(t.parent_id) AS TABELA,
      CASE WHEN t.is_disabled = 1 THEN 'DESABILITADO' ELSE 'ATIVO' END AS STATUS
    FROM sys.triggers t
    WHERE OBJECT_NAME(t.parent_id) IN
      ('LOJA_ENTRADAS','LOJA_ENTRADAS_PRODUTO','ESTOQUE_PROD_ENT','ESTOQUE_PROD1_ENT')
    ORDER BY TABELA, TRIGGER_NAME`));

  await pool.close();
  console.log(`\n${'═'.repeat(78)}`);
  console.log('CONCLUÍDO');
  console.log('═'.repeat(78));
}

main().catch((err) => {
  console.error('\nERRO FATAL:', err.message);
  process.exit(1);
});

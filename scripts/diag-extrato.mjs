/**
 * Diagnóstico do extrato de produto.
 * Uso: node scripts/diag-extrato.mjs [produto] [cor] [filial]
 * Exemplo: node scripts/diag-extrato.mjs G2.11.0017 67 "NERD MORUMBI RDRRRJ"
 */

import sql from 'mssql';

const PRODUTO = process.argv[2] ?? 'G2.11.0017';
const COR     = process.argv[3] ?? '67';
const FILIAL  = process.argv[4] ?? 'NERD MORUMBI RDRRRJ';

const config = {
  server:   '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user:     'andre.sabetta',
  password: 'asabetta',
  port:     1433,
  options:  { encrypt: false, trustServerCertificate: true },
  requestTimeout: 60000,
  connectionTimeout: 30000,
};

async function run(pool, label, sql_text) {
  try {
    const r = await pool.request().query(sql_text);
    const rows = r.recordset;
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`▶ ${label}  →  ${rows.length} linha(s)`);
    if (rows.length === 0) {
      console.log('   (sem resultados)');
    } else {
      rows.slice(0, 20).forEach((row, i) => {
        const parts = Object.entries(row)
          .map(([k, v]) => `${k}=${v == null ? 'NULL' : String(v).trim()}`)
          .join(' | ');
        console.log(`   [${i + 1}] ${parts}`);
      });
      if (rows.length > 20) console.log(`   ... +${rows.length - 20} linhas omitidas`);
    }
    return rows;
  } catch (err) {
    console.log(`\n${'─'.repeat(70)}`);
    console.log(`▶ ${label}  →  ERRO: ${err.message}`);
    return [];
  }
}

async function main() {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`DIAGNÓSTICO EXTRATO-PRODUTO`);
  console.log(`Produto: ${PRODUTO}  |  Cor: ${COR}  |  Filial: ${FILIAL}`);
  console.log(`${'═'.repeat(70)}`);

  const pool = await sql.connect(config);

  // ── 1. Verifica se o produto existe ──────────────────────────────────────
  await run(pool, '1. PRODUTOS (existe?)',
    `SELECT TOP 5 PRODUTO, DESC_PRODUTO, GRADE
     FROM PRODUTOS WITH (NOLOCK)
     WHERE RTRIM(LTRIM(CAST(PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'`);

  // ── 2. ESTOQUE_PRODUTOS - estoques por filial ────────────────────────────
  await run(pool, '2. ESTOQUE_PRODUTOS (estoque por filial)',
    `SELECT FILIAL, COR_PRODUTO, ESTOQUE
     FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
     WHERE RTRIM(LTRIM(CAST(PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
     ORDER BY FILIAL`);

  // ── 3. ESTOQUE_PROD_ENT: sem nenhum filtro ───────────────────────────────
  await run(pool, '3. ESTOQUE_PROD1_ENT (sem filtro de filial/join)',
    `SELECT TOP 50
       e.ROMANEIO_PRODUTO, e.EMISSAO, e.FILIAL AS FILIAL_HEADER,
       p.FILIAL AS FILIAL_ITEM, p.PRODUTO, p.COR_PRODUTO, p.QTDE, p.EN_1,
       e.TIPO_ROMANEIO, e.ROMANEIO_ORIGEM
     FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
     JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
       ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
     WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
     ORDER BY e.EMISSAO DESC`);

  // ── 4. ESTOQUE_PROD_ENT: com filtro de filial no header ──────────────────
  await run(pool, `4. ESTOQUE_PROD_ENT + filtro filial (header) LIKE '%${FILIAL}%'`,
    `SELECT TOP 50
       e.ROMANEIO_PRODUTO, e.EMISSAO, e.FILIAL AS FILIAL_HEADER,
       p.FILIAL AS FILIAL_ITEM, p.QTDE, p.EN_1, e.TIPO_ROMANEIO, e.ROMANEIO_ORIGEM
     FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
     JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
       ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
     WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
       AND e.FILIAL LIKE '%${FILIAL}%'
     ORDER BY e.EMISSAO DESC`);

  // ── 5. ESTOQUE_PROD_ENT: join com filial dos dois lados (comportamento antigo) ──
  await run(pool, '5. ESTOQUE_PROD_ENT + JOIN com FILIAL dos dois lados (era o bug)',
    `SELECT TOP 50
       e.ROMANEIO_PRODUTO, e.EMISSAO, e.FILIAL AS FILIAL_HEADER,
       p.FILIAL AS FILIAL_ITEM, p.QTDE, p.EN_1, e.TIPO_ROMANEIO, e.ROMANEIO_ORIGEM
     FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
     JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
       ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
       AND e.FILIAL = p.FILIAL
     WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
       AND e.FILIAL LIKE '%${FILIAL}%'
     ORDER BY e.EMISSAO DESC`);

  // ── 6. ESTOQUE_PROD1_ENT isolado: o que tem FILIAL vs NULL ──────────────
  await run(pool, '6. ESTOQUE_PROD1_ENT isolado — ver FILIAL preenchida ou NULL',
    `SELECT TOP 30
       p.ROMANEIO_PRODUTO, p.FILIAL, p.PRODUTO, p.COR_PRODUTO, p.QTDE, p.EN_1
     FROM ESTOQUE_PROD1_ENT p WITH (NOLOCK)
     WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
     ORDER BY p.ROMANEIO_PRODUTO DESC`);

  // ── 7. Busca específica por TRANSFE2205 e INVENTMORUMBI2605 ──────────────
  await run(pool, '7. Busca direta por TRANSFE2205',
    `SELECT * FROM ESTOQUE_PROD_ENT WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%TRANSFE2205%'`);
  await run(pool, '7b. Busca direta por INVENTMORUMBI2605',
    `SELECT * FROM ESTOQUE_PROD_ENT WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%INVENTMORUMBI2605%'`);
  await run(pool, '7c. TRANSFE2205 em ESTOQUE_PROD_SAI',
    `SELECT * FROM ESTOQUE_PROD_SAI WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%TRANSFE2205%'`);
  await run(pool, '7d. INVENTMORUMBI2605 em ESTOQUE_PROD_SAI',
    `SELECT * FROM ESTOQUE_PROD_SAI WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%INVENTMORUMBI2605%'`);
  await run(pool, '7e. TRANSFE2205 em LOJA_ENTRADAS',
    `SELECT * FROM LOJA_ENTRADAS WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%TRANSFE2205%'`);
  await run(pool, '7f. INVENTMORUMBI2605 em LOJA_ENTRADAS',
    `SELECT * FROM LOJA_ENTRADAS WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%INVENTMORUMBI2605%'`);

  // ── 8. Procura o documento em QUALQUER tabela conhecida ─────────────────
  for (const doc of ['TRANSFE2205', 'INVENTMORUMBI2605']) {
    await run(pool, `8. ${doc} em LOJA_SAIDAS`,
      `SELECT * FROM LOJA_SAIDAS WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%${doc}%'`);
  }

  // ── 9. LOJA_ENTRADAS para o produto+cor (sem filtro filial) ─────────────
  await run(pool, '9. LOJA_ENTRADAS (sem filtro filial)',
    `SELECT TOP 20
       le.EMISSAO, le.FILIAL, le.ROMANEIO_PRODUTO, le.TIPO_ENTRADA_SAIDA,
       lep.PRODUTO, lep.COR_PRODUTO, lep.QTDE_ENTRADA, lep.EN1,
       CAST(le.OBS AS varchar(200)) AS OBS
     FROM LOJA_ENTRADAS le WITH (NOLOCK)
     JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
       ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
     WHERE RTRIM(LTRIM(CAST(lep.PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(lep.COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
     ORDER BY le.EMISSAO DESC`);

  // ── 10. LOJA_VENDA: tickets sem filtro QTDE_CANCELADA ────────────────────
  await run(pool, '10. LOJA_VENDA (todos, sem filtro cancelada)',
    `SELECT TOP 20
       v.DATA_VENDA, v.CODIGO_FILIAL, f.FILIAL AS NOME_FILIAL, v.TICKET,
       vp.QTDE, vp.QTDE_CANCELADA, vp.PRECO_LIQUIDO, vp.NAO_MOVIMENTA_ESTOQUE
     FROM LOJA_VENDA v WITH (NOLOCK)
     JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
       ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
     LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
     WHERE RTRIM(LTRIM(CAST(vp.PRODUTO AS VARCHAR(50)))) = '${PRODUTO}'
       AND RTRIM(LTRIM(ISNULL(CAST(vp.COR_PRODUTO AS VARCHAR(20)),''))) = '${COR}'
       AND f.FILIAL LIKE '%${FILIAL}%'
     ORDER BY v.DATA_VENDA DESC`);

  // ── 11. Procura em TODAS as tabelas do banco por esses documentos ────────
  console.log('\n\nBUSCA GLOBAL — procurando TRANSFE2205 e INVENTMORUMBI2605 em todo o banco...');
  const allTables = await run(pool, '11. Tabelas que têm coluna ROMANEIO_PRODUTO',
    `SELECT TABLE_NAME
     FROM INFORMATION_SCHEMA.COLUMNS WITH (NOLOCK)
     WHERE COLUMN_NAME = 'ROMANEIO_PRODUTO'
     ORDER BY TABLE_NAME`);

  for (const row of allTables) {
    const tbl = row.TABLE_NAME;
    if (['ESTOQUE_PROD_ENT','ESTOQUE_PROD1_ENT','ESTOQUE_PROD_SAI','ESTOQUE_PROD1_SAI',
         'LOJA_ENTRADAS','LOJA_ENTRADAS_PRODUTO','LOJA_SAIDAS','LOJA_SAIDAS_PRODUTO'].includes(tbl)) continue;
    await run(pool, `  11b. ${tbl} → TRANSFE2205`,
      `SELECT TOP 5 * FROM [${tbl}] WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%TRANSFE2205%'`);
    await run(pool, `  11b. ${tbl} → INVENTMORUMBI2605`,
      `SELECT TOP 5 * FROM [${tbl}] WITH (NOLOCK) WHERE ROMANEIO_PRODUTO LIKE '%INVENTMORUMBI2605%'`);
  }

  // ── 12. Tabelas com coluna DOCUMENTO (alternativa ao romaneio) ───────────
  await run(pool, '12. Tabelas que têm coluna chamada DOCUMENTO',
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.COLUMNS WITH (NOLOCK)
     WHERE COLUMN_NAME = 'DOCUMENTO' ORDER BY TABLE_NAME`);

  // ── 13. Tabelas com "AJUSTE" no nome ─────────────────────────────────────
  await run(pool, '13. Tabelas com AJUSTE no nome',
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WITH (NOLOCK)
     WHERE TABLE_NAME LIKE '%AJUSTE%' OR TABLE_NAME LIKE '%INVENTAR%'
        OR TABLE_NAME LIKE '%BALAN%' OR TABLE_NAME LIKE '%TRANSFE%'
     ORDER BY TABLE_NAME`);

  // ── 14. Busca por "MS.MDINIZ" (romaneio/pedido do Linx) ──────────────────
  console.log('\n\nBUSCA POR "MDINIZ" (valor visto no Romaneio/Pedido do Linx)...');
  const romaNeioTables = await run(pool, '14. Tabelas com coluna ROMANEIO_ORIGEM ou PEDIDO',
    `SELECT DISTINCT TABLE_NAME
     FROM INFORMATION_SCHEMA.COLUMNS WITH (NOLOCK)
     WHERE COLUMN_NAME IN ('ROMANEIO_ORIGEM','PEDIDO','ROMANEIO_DESTINO')
     ORDER BY TABLE_NAME`);

  for (const row of romaNeioTables) {
    const tbl = row.TABLE_NAME;
    // Descobre qual coluna essa tabela tem
    const cols = await pool.request().query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_NAME = '${tbl}' AND COLUMN_NAME IN ('ROMANEIO_ORIGEM','PEDIDO','ROMANEIO_DESTINO')`
    );
    for (const c of cols.recordset) {
      const col = c.COLUMN_NAME;
      await run(pool, `  14b. ${tbl}.${col} LIKE '%MDINIZ%'`,
        `SELECT TOP 5 * FROM [${tbl}] WITH (NOLOCK) WHERE [${col}] LIKE '%MDINIZ%'`);
    }
  }

  // ── 15. Linx view / tabela que combina todos os movimentos ────────────────
  await run(pool, '15. Views com EXTRATO ou MOVIMENTO no nome',
    `SELECT TABLE_NAME, TABLE_TYPE
     FROM INFORMATION_SCHEMA.TABLES WITH (NOLOCK)
     WHERE TABLE_NAME LIKE '%EXTRAT%' OR TABLE_NAME LIKE '%MOVIM%' OR TABLE_NAME LIKE '%HISTORICO%'
     ORDER BY TABLE_NAME`);

  await pool.close();
  console.log(`\n${'═'.repeat(70)}`);
  console.log('DIAGNÓSTICO CONCLUÍDO');
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(err => {
  console.error('\nERRO FATAL:', err.message);
  process.exit(1);
});

/**
 * (read-only) Parte 4: procura QUALQUER rastro sobrevivente do romaneio 834279
 * (tabelas ETL/auditoria/histórico) para provar se a entrada realmente somou
 * estoque quando foi criada — e se existe snapshot de estoque antes de 23/07.
 */
import sql from 'mssql';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('c:/NERD/multi_dashboard/.env.local', 'utf8')
    .split(/\r?\n/).filter((l) => /^DB_/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const base = {
  database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD,
  port: Number(env.DB_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 300000, connectionTimeout: 30000,
};
const q = async (pool, text) => (await pool.request().query(text)).recordset;
const head = (t) => console.log(`\n${'═'.repeat(96)}\n${t}\n${'═'.repeat(96)}`);
async function connect() {
  let last;
  for (const server of [env.DB_SERVER, '189.126.197.82']) {
    try { const p = await sql.connect({ ...base, server }); console.log(`✅ ${server}`); return p; }
    catch (e) { console.log(`❌ ${server}: ${e.message}`); last = e; }
  }
  throw last;
}

async function main() {
  const pool = await connect();

  head('A) Tabelas com coluna de romaneio — varredura por 834279');
  const tabelas = await q(pool, `
    SELECT t.name AS TABELA, c.name AS COLUNA
    FROM sys.tables t
    JOIN sys.columns c ON c.object_id = t.object_id
    WHERE c.name IN ('ROMANEIO_PRODUTO','ROMANEIO','ROMANEIO_ORIGEM','ROMANEIO_DESTINO','ROMANEIO_NF_SAIDA','ROMANEIO_ENTRADA','ROMANEIO_SAIDA')
    ORDER BY t.name, c.name`);
  console.log(`(${tabelas.length} pares tabela/coluna candidatos)`);
  const achados = [];
  for (const t of tabelas) {
    try {
      const r = await q(pool, `
        SELECT COUNT(*) AS N FROM [${t.TABELA}] WITH (NOLOCK)
        WHERE LTRIM(RTRIM(CAST([${t.COLUNA}] AS VARCHAR(50)))) = '834279'`);
      if (r[0].N > 0) { achados.push({ ...t, N: r[0].N }); console.log(`  ✔ ${t.TABELA}.${t.COLUNA} → ${r[0].N}`); }
    } catch { /* coluna incompatível — ignora */ }
  }
  if (!achados.length) console.log('  (nenhum rastro de 834279 em nenhuma tabela com coluna de romaneio)');

  head('B) Conteúdo dos rastros encontrados (até 60 linhas de cada)');
  for (const a of achados) {
    console.log(`\n--- ${a.TABELA}.${a.COLUNA} ---`);
    const rows = await q(pool, `
      SELECT TOP 60 * FROM [${a.TABELA}] WITH (NOLOCK)
      WHERE LTRIM(RTRIM(CAST([${a.COLUNA}] AS VARCHAR(50)))) = '834279'`);
    // imprime só colunas úteis (não-nulas / não-zero) para não poluir
    const cols = Object.keys(rows[0] ?? {}).filter((k) =>
      rows.some((r) => r[k] !== null && r[k] !== 0 && String(r[k]).trim() !== ''));
    console.log(`colunas com conteúdo: ${cols.join(', ')}`);
    console.table(rows.map((r) => Object.fromEntries(cols.slice(0, 14).map((k) => [k, r[k] instanceof Date ? r[k].toISOString().slice(0, 19) : r[k]]))));
  }

  head('C) Tabelas de snapshot/histórico de estoque disponíveis');
  const snaps = await q(pool, `
    SELECT t.name AS TABELA, SUM(p.rows) AS LINHAS
    FROM sys.tables t JOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0,1)
    WHERE t.name LIKE '%PROJECAO%' OR t.name LIKE '%SNAPSHOT%' OR t.name LIKE '%ESTOQUE%HIST%'
       OR t.name LIKE '%HIST%ESTOQUE%' OR t.name LIKE 'NERD%'
    GROUP BY t.name ORDER BY t.name`);
  console.table(snaps);

  head('D) ESTOQUE_PRODUTOS dos itens de 834279: DATA_AJUSTE / ULTIMA_ENTRADA / ULTIMA_SAIDA');
  const est = await q(pool, `
    SELECT LTRIM(RTRIM(ep.PRODUTO)) AS PRODUTO, LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) AS COR,
           ep.ESTOQUE, ep.DATA_AJUSTE, ep.ULTIMA_ENTRADA, ep.ULTIMA_SAIDA
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ep.FILIAL)) = 'NERD'
      AND EXISTS (SELECT 1 FROM NERD_AJUSTE_HISTORICO a WITH (NOLOCK)
                   WHERE LTRIM(RTRIM(a.ROMANEIO_REF)) = '834279'
                     AND LTRIM(RTRIM(a.PRODUTO)) = LTRIM(RTRIM(ep.PRODUTO))
                     AND LTRIM(RTRIM(a.COR_PRODUTO)) = LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))))
    ORDER BY PRODUTO, COR`);
  console.table(est.slice(0, 60).map((r) => ({
    PRODUTO: r.PRODUTO, COR: r.COR, ESTOQUE: r.ESTOQUE,
    DATA_AJUSTE: r.DATA_AJUSTE?.toISOString?.().slice(0, 19) ?? null,
    ULT_ENTRADA: r.ULTIMA_ENTRADA?.toISOString?.().slice(0, 19) ?? null,
    ULT_SAIDA: r.ULTIMA_SAIDA?.toISOString?.().slice(0, 19) ?? null,
  })));

  head('E) O que existia com EMISSAO 22-23/07 na filial NERD (entradas) — contexto do 834279');
  const ctx = await q(pool, `
    SELECT e.ROMANEIO_PRODUTO, e.EMISSAO, e.TIPO_ROMANEIO, e.DATA_DIGITACAO,
           CAST(e.OBS AS VARCHAR(300)) AS OBS,
           (SELECT COUNT(*) FROM ESTOQUE_PROD1_ENT p WITH (NOLOCK) WHERE p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO) AS ITENS,
           (SELECT SUM(ISNULL(p.QTDE,0)) FROM ESTOQUE_PROD1_ENT p WITH (NOLOCK) WHERE p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO) AS QTDE,
           (SELECT SUM(ISNULL(p.EN_1,0)) FROM ESTOQUE_PROD1_ENT p WITH (NOLOCK) WHERE p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO) AS EN_1
    FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
    WHERE LTRIM(RTRIM(e.FILIAL)) = 'NERD'
      AND e.EMISSAO >= '2026-07-20' AND e.EMISSAO < '2026-07-25'
    ORDER BY e.ROMANEIO_PRODUTO`);
  console.table(ctx.map((r) => ({
    ROM: String(r.ROMANEIO_PRODUTO).trim(), EMISSAO: r.EMISSAO?.toISOString?.().slice(0, 19),
    TIPO: (r.TIPO_ROMANEIO || '').trim(), ITENS: r.ITENS, QTDE: r.QTDE, EN_1: r.EN_1,
    OBS: (r.OBS || '').replace(/\s+/g, ' ').slice(0, 60),
  })));

  await pool.close();
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

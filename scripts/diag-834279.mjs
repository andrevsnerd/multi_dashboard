/**
 * (read-only) Investiga o romaneio 834279 excluído com retorno de estoque:
 * quais itens foram ajustados, se o romaneio deixou rastro e se existe trigger
 * de DELETE em ESTOQUE_PROD1_ENT que possa ter descontado estoque em dobro.
 */
import sql from 'mssql';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('c:/NERD/multi_dashboard/.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^DB_/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

const config = {
  server: env.DB_SERVER,
  database: env.DB_DATABASE,
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  port: Number(env.DB_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 180000,
  connectionTimeout: 30000,
};

const q = async (pool, text) => (await pool.request().query(text)).recordset;
const head = (t) => console.log(`\n${'═'.repeat(90)}\n${t}\n${'═'.repeat(90)}`);

/** Mesma rotação de hosts do lib/db/connection.ts */
async function connect() {
  const hosts = [env.DB_SERVER, '189.126.197.82'].filter(Boolean);
  let last;
  for (const server of hosts) {
    try {
      const p = await sql.connect({ ...config, server });
      console.log(`✅ conectado em ${server}`);
      return p;
    } catch (e) {
      console.log(`❌ ${server}: ${e.message}`);
      last = e;
    }
  }
  throw last;
}

async function main() {
  const pool = await connect();

  head('1) NERD_AJUSTE_HISTORICO — itens ajustados pelo romaneio 834279');
  const ajustes = await q(pool, `
    SELECT ID, DATA_AJUSTE, FILIAL, PRODUTO, COR_PRODUTO, QTDE_AJUSTE,
           ROMANEIO_REF, TIPO_AJUSTE, RESPONSAVEL, OBS
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_REF)) = '834279'
    ORDER BY ID`);
  console.log(`linhas: ${ajustes.length}`);
  console.table(ajustes.map((r) => ({
    ID: r.ID,
    DATA: r.DATA_AJUSTE?.toISOString?.().slice(0, 19),
    FILIAL: r.FILIAL,
    PRODUTO: r.PRODUTO,
    COR: r.COR_PRODUTO,
    QTDE: r.QTDE_AJUSTE,
    TIPO: r.TIPO_AJUSTE,
    RESP: r.RESPONSAVEL,
  })));

  head('2) Rastro do romaneio 834279 nas tabelas de entrada/saída');
  for (const [tabela, col] of [
    ['ESTOQUE_PROD_ENT', 'ROMANEIO_PRODUTO'],
    ['ESTOQUE_PROD1_ENT', 'ROMANEIO_PRODUTO'],
    ['LOJA_ENTRADAS', 'ROMANEIO_PRODUTO'],
    ['LOJA_ENTRADAS_PRODUTO', 'ROMANEIO_PRODUTO'],
    ['ESTOQUE_PROD_SAI', 'ROMANEIO_PRODUTO'],
    ['ESTOQUE_PROD1_SAI', 'ROMANEIO_PRODUTO'],
  ]) {
    try {
      const r = await q(pool, `SELECT COUNT(*) AS N FROM ${tabela} WITH (NOLOCK) WHERE LTRIM(RTRIM(CAST(${col} AS VARCHAR(50)))) = '834279'`);
      console.log(`  ${tabela.padEnd(24)} → ${r[0].N} registro(s)`);
    } catch (e) {
      console.log(`  ${tabela.padEnd(24)} → erro: ${e.message}`);
    }
  }

  head('3) Vizinhança do romaneio (834270..834290) em ESTOQUE_PROD_ENT — contexto do que era 834279');
  const viz = await q(pool, `
    SELECT e.ROMANEIO_PRODUTO, e.FILIAL, e.FILIAL_DESTINO, e.EMISSAO, e.TIPO_ROMANEIO,
           e.TIPO_ENTRADA, e.ROMANEIO_ORIGEM, CAST(e.OBS AS VARCHAR(200)) AS OBS,
           (SELECT SUM(ISNULL(QTDE,0)) FROM ESTOQUE_PROD1_ENT p WITH (NOLOCK)
             WHERE p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO) AS QTDE_TOTAL
    FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
    WHERE TRY_CONVERT(INT, e.ROMANEIO_PRODUTO) BETWEEN 834270 AND 834290
    ORDER BY TRY_CONVERT(INT, e.ROMANEIO_PRODUTO)`);
  console.table(viz.map((r) => ({
    ROM: r.ROMANEIO_PRODUTO, FILIAL: r.FILIAL, DEST: r.FILIAL_DESTINO,
    EMISSAO: r.EMISSAO?.toISOString?.().slice(0, 19), TIPO: r.TIPO_ROMANEIO,
    QTD: r.QTDE_TOTAL, ORIGEM: r.ROMANEIO_ORIGEM, OBS: (r.OBS || '').slice(0, 40),
  })));

  head('4) Triggers em ESTOQUE_PROD1_ENT / ESTOQUE_PROD1_SAI (existe trigger de DELETE?)');
  const trg = await q(pool, `
    SELECT OBJECT_NAME(t.parent_id) AS TABELA, t.name AS TRIGGER_NAME,
           t.is_disabled,
           MAX(CASE WHEN te.type_desc = 'INSERT' THEN 1 ELSE 0 END) AS ON_INSERT,
           MAX(CASE WHEN te.type_desc = 'UPDATE' THEN 1 ELSE 0 END) AS ON_UPDATE,
           MAX(CASE WHEN te.type_desc = 'DELETE' THEN 1 ELSE 0 END) AS ON_DELETE
    FROM sys.triggers t
    JOIN sys.trigger_events te ON te.object_id = t.object_id
    WHERE OBJECT_NAME(t.parent_id) IN ('ESTOQUE_PROD1_ENT','ESTOQUE_PROD1_SAI','ESTOQUE_PROD_ENT','ESTOQUE_PROD_SAI','LOJA_ENTRADAS_PRODUTO','LOJA_SAIDAS_PRODUTO')
    GROUP BY t.parent_id, t.name, t.is_disabled
    ORDER BY TABELA, TRIGGER_NAME`);
  console.table(trg);

  head('5) Definição dos triggers de DELETE encontrados (trechos que tocam ESTOQUE_PRODUTOS)');
  for (const t of trg.filter((x) => x.ON_DELETE === 1)) {
    const def = await q(pool, `
      SELECT m.definition FROM sys.sql_modules m
      JOIN sys.objects o ON o.object_id = m.object_id
      WHERE o.name = '${t.TRIGGER_NAME}'`);
    console.log(`\n--- ${t.TABELA}.${t.TRIGGER_NAME} (disabled=${t.is_disabled}) ---`);
    const linhas = (def[0]?.definition || '').split(/\r?\n/);
    console.log(`  (${linhas.length} linhas)`);
    linhas.forEach((l, i) => {
      if (/ESTOQUE_PRODUTOS|ESTOQUE\s*=|deleted\./i.test(l)) {
        console.log(`  ${String(i + 1).padStart(4)}: ${l.trim().slice(0, 160)}`);
      }
    });
  }

  head('6) Estoque atual em NERD dos itens ajustados por 834279');
  if (ajustes.length) {
    const pares = ajustes.map((a) => `('${String(a.PRODUTO).trim().replace(/'/g, "''")}','${String(a.COR_PRODUTO ?? '').trim().replace(/'/g, "''")}')`).join(',');
    const est = await q(pool, `
      ;WITH itens(PRODUTO, COR) AS (SELECT * FROM (VALUES ${pares}) v(a,b))
      SELECT i.PRODUTO, i.COR,
             (SELECT SUM(ISNULL(ep.ESTOQUE,0)) FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
               WHERE LTRIM(RTRIM(ep.PRODUTO)) = i.PRODUTO
                 AND ISNULL(LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))),'') = i.COR
                 AND LTRIM(RTRIM(ep.FILIAL)) = 'NERD') AS ESTOQUE_NERD,
             (SELECT MAX(p.DESC_PRODUTO) FROM PRODUTOS p WITH (NOLOCK) WHERE LTRIM(RTRIM(p.PRODUTO)) = i.PRODUTO) AS DESC_PRODUTO
      FROM itens i
      ORDER BY i.PRODUTO, i.COR`);
    console.table(est);
  }

  await pool.close();
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

/**
 * (read-only) Parte 5 — prova final da subtração em dobro no romaneio 834279.
 *
 * O UPDATE manual da rotina de exclusão mexe SÓ em ESTOQUE_PRODUTOS.ESTOQUE.
 * O trigger LXD_ESTOQUE_PROD1_ENT mexe em ESTOQUE *e* nas colunas de grade ES1..ES48.
 * Logo, se houve dupla subtração: ES1 (grade) guarda o saldo CERTO e
 * ESTOQUE = ES1 - |qtde do romaneio|.
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

  head('ESTOQUE (tocado 2x) vs ES1..ES3 (tocado só pelo trigger) — itens de 834279 na NERD');
  const rows = await q(pool, `
    SELECT LTRIM(RTRIM(ep.PRODUTO)) AS PRODUTO,
           LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) AS COR,
           a.QTDE_AJUSTE, ep.ESTOQUE, ep.ES1, ep.ES2, ep.ES3,
           LTRIM(RTRIM(ISNULL(p.GRADE,''))) AS GRADE
    FROM NERD_AJUSTE_HISTORICO a WITH (NOLOCK)
    JOIN ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      ON LTRIM(RTRIM(ep.PRODUTO)) = LTRIM(RTRIM(a.PRODUTO))
     AND LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(a.COR_PRODUTO))
     AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(a.FILIAL))
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON LTRIM(RTRIM(p.PRODUTO)) = LTRIM(RTRIM(a.PRODUTO))
    WHERE LTRIM(RTRIM(a.ROMANEIO_REF)) = '834279'
    ORDER BY PRODUTO, COR`);

  const t = rows.map((r) => ({
    PRODUTO: r.PRODUTO, COR: r.COR, GRADE: r.GRADE,
    AJUSTE: r.QTDE_AJUSTE, ESTOQUE: r.ESTOQUE, ES1: r.ES1, ES2: r.ES2, ES3: r.ES3,
    'ES1-ESTOQUE': (r.ES1 ?? 0) - r.ESTOQUE,
    OK: (r.ES1 ?? 0) - r.ESTOQUE === -r.QTDE_AJUSTE ? 'ES1 = ESTOQUE + |ajuste|' : '—',
  }));
  console.table(t);
  const ok = t.filter((r) => r.OK !== '—').length;
  console.log(`\nitens: ${t.length} | ES1 exatamente |ajuste| acima de ESTOQUE: ${ok}`);
  console.log(`soma ESTOQUE: ${t.reduce((s, r) => s + r.ESTOQUE, 0)} | soma ES1: ${t.reduce((s, r) => s + (r.ES1 ?? 0), 0)} | soma |ajuste|: ${t.reduce((s, r) => s + Math.abs(r.AJUSTE), 0)}`);

  await pool.close();
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

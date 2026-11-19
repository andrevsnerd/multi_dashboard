/**
 * (read-only) Confere o PAPEL POR PERÍODO das filiais do registry (lib/config/filial-registry.ts).
 *
 * - `since`: a filial não pode ter LOJA_VENDA antes da data (a venda de loja não tem corte de
 *   data no SQL — o corte é garantido por não existir venda anterior). Se aparecer, o histórico
 *   da loja nova está levando venda de outro papel: avisar antes de seguir.
 * - `ecommerceUntil`: NF 100.02/100.022 da filial a partir da data NÃO conta como e-commerce
 *   (o SQL corta). Se aparecer, a loja está emitindo nota de venda e-commerce — conferir.
 * - Mostra também a 1ª e a última venda de loja de cada filial com `since` (quando virou ativa).
 *
 * Uso: node scripts/conferir-filiais-por-periodo.mjs
 */
import sql from 'mssql';
import fs from 'fs';

const ROOT = 'c:/NERD/multi_dashboard';
const env = Object.fromEntries(
  fs.readFileSync(`${ROOT}/.env.local`, 'utf8')
    .split(/\r?\n/).filter((l) => /^DB_/.test(l))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);

// Lê as entradas com since/ecommerceUntil direto do registry (fonte única).
const registry = fs.readFileSync(`${ROOT}/lib/config/filial-registry.ts`, 'utf8');
const defs = [];
for (const line of registry.split(/\r?\n/)) {
  const id = line.match(/^\s*\{\s*id:\s*'([^']+)'/)?.[1];
  if (!id) continue;
  const since = line.match(/since:\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
  const until = line.match(/ecommerceUntil:\s*'(\d{4}-\d{2}-\d{2})'/)?.[1];
  const display = line.match(/display:\s*'([^']+)'/)?.[1];
  if (since || until) defs.push({ id, display, since, until });
}

const base = {
  database: env.DB_DATABASE, user: env.DB_USERNAME, password: env.DB_PASSWORD,
  port: Number(env.DB_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000, connectionTimeout: 30000,
};
async function connect() {
  let last;
  for (const server of [env.DB_SERVER, '189.126.197.82']) {
    try { return await sql.connect({ ...base, server }); } catch (e) { last = e; }
  }
  throw last;
}

const pool = await connect();
let problemas = 0;
for (const d of defs) {
  const r = pool.request();
  r.input('cod', sql.VarChar, d.id);
  const [{ FILIAL }] = (await r.query(`SELECT RTRIM(FILIAL) AS FILIAL FROM FILIAIS WITH (NOLOCK) WHERE COD_FILIAL = @cod`)).recordset;
  console.log(`\n${d.id} ${FILIAL} → ${d.display}${d.since ? `  since ${d.since}` : ''}${d.until ? `  e-commerce até ${d.until} (exclusive)` : ''}`);

  if (d.since) {
    const q = pool.request();
    q.input('cod', sql.VarChar, d.id);
    const [row] = (await q.query(`
      SELECT SUM(CASE WHEN DATA_VENDA < '${d.since.replace(/-/g, '')}' THEN 1 ELSE 0 END) AS ANTES,
             COUNT(*) AS TOTAL, MIN(DATA_VENDA) AS PRIMEIRA, MAX(DATA_VENDA) AS ULTIMA
      FROM LOJA_VENDA WITH (NOLOCK) WHERE CODIGO_FILIAL = @cod`)).recordset;
    const antes = Number(row.ANTES || 0);
    console.log(`  LOJA_VENDA: ${row.TOTAL} tickets (1ª ${row.PRIMEIRA?.toISOString().slice(0, 10) ?? '—'}, última ${row.ULTIMA?.toISOString().slice(0, 10) ?? '—'}) · antes do since: ${antes}`);
    if (antes > 0) { problemas++; console.log('  ⚠ venda de loja ANTES do início do papel — o histórico da loja vai somar isso.'); }
  }
  if (d.until) {
    const q = pool.request();
    q.input('fil', sql.VarChar, FILIAL);
    const [row] = (await q.query(`
      SELECT SUM(CASE WHEN EMISSAO <  '${d.until.replace(/-/g, '')}' THEN 1 ELSE 0 END) AS ECOM,
             SUM(CASE WHEN EMISSAO >= '${d.until.replace(/-/g, '')}' THEN 1 ELSE 0 END) AS DEPOIS
      FROM FATURAMENTO WITH (NOLOCK)
      WHERE FILIAL = @fil AND NOTA_CANCELADA = 0 AND NATUREZA_SAIDA IN ('100.02', '100.022')`)).recordset;
    console.log(`  NF e-commerce: ${row.ECOM ?? 0} contam como E-COMMERCE · ${row.DEPOIS ?? 0} depois do corte (fora do e-commerce)`);
    if (Number(row.DEPOIS || 0) > 0) { problemas++; console.log('  ⚠ a loja emitiu NF 100.02/100.022 depois do corte — conferir com o dono.'); }
  }
}
await pool.close();
console.log(problemas === 0 ? '\nOK — papéis por período consistentes.' : `\n${problemas} ponto(s) para conferir.`);

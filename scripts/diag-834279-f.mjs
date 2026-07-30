/** (read-only) Mostra o miolo do LXD_ESTOQUE_PROD1_ENT (guardas antes do cursor). */
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
  requestTimeout: 120000, connectionTimeout: 30000,
};
const q = async (pool, text) => (await pool.request().query(text)).recordset;

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
  const trg = process.argv[2] || 'LXD_ESTOQUE_PROD1_ENT';
  const de = Number(process.argv[3] || 1), ate = Number(process.argv[4] || 140);
  const def = (await q(pool, `
    SELECT m.definition FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
    WHERE o.name = '${trg}'`))[0].definition.split(/\r?\n/);
  console.log(`\n=== ${trg} — linhas ${de}..${ate} de ${def.length} ===`);
  def.slice(de - 1, ate).forEach((l, i) => console.log(`${String(i + de).padStart(4)}: ${l.replace(/\t/g, ' ').trimEnd()}`));
  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

/** (read-only) Confere o pós-correção do N7.1.0003/06 na NERD: estoque e linhas de ajuste. */
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
    try { const p = await sql.connect({ ...base, server }); return p; }
    catch (e) { last = e; }
  }
  throw last;
}

async function main() {
  const pool = await connect();

  console.log('\nESTOQUE_PRODUTOS — N7.1.0003 / 06 / NERD');
  console.table(await q(pool, `
    SELECT ESTOQUE, ES1 FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
    WHERE PRODUTO = 'N7.1.0003' AND ISNULL(COR_PRODUTO,'') = '06' AND LTRIM(RTRIM(FILIAL)) = 'NERD'`));

  console.log('\nLinhas de AJUSTE que o Extrato vai somar (N7.1.0003 / 06 / NERD)');
  const aj = await q(pool, `
    SELECT DATA_AJUSTE, QTDE_AJUSTE, TIPO_AJUSTE, ROMANEIO_REF, CAST(OBS AS VARCHAR(120)) AS OBS
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    WHERE PRODUTO = 'N7.1.0003' AND COR_PRODUTO = '06' AND LTRIM(RTRIM(FILIAL)) = 'NERD'
    ORDER BY DATA_AJUSTE`);
  console.table(aj.map((r) => ({
    DATA: r.DATA_AJUSTE?.toISOString?.().slice(0, 19), QTDE: r.QTDE_AJUSTE,
    TIPO: r.TIPO_AJUSTE, ROM: r.ROMANEIO_REF, OBS: (r.OBS || '').slice(0, 70),
  })));
  console.log(`soma dos ajustes: ${aj.reduce((s, r) => s + r.QTDE_AJUSTE, 0)}`);
  console.log('saldo esperado no extrato: +14 (834245) -13 (7 saídas) + ajustes');

  console.log('\nTotal da filial NERD nos 55 itens do romaneio 834279');
  console.table(await q(pool, `
    SELECT COUNT(*) AS ITENS, SUM(ep.ESTOQUE) AS SOMA_ESTOQUE, SUM(ep.ES1) AS SOMA_ES1,
           SUM(CASE WHEN ep.ESTOQUE < 0 THEN 1 ELSE 0 END) AS NEGATIVOS
    FROM NERD_AJUSTE_HISTORICO a WITH (NOLOCK)
    JOIN ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      ON ep.PRODUTO = a.PRODUTO AND ISNULL(ep.COR_PRODUTO,'') = a.COR_PRODUTO
     AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(a.FILIAL))
    WHERE LTRIM(RTRIM(a.ROMANEIO_REF)) = '834279' AND a.TIPO_AJUSTE = 'CORRECAO_EXCLUSAO_DOBRO'`));

  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

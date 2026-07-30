/** (read-only) Como a matriz da NERD se chama em FILIAIS e se ela cai fora do seletor do Extrato. */
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
const head = (t) => console.log(`\n${'═'.repeat(88)}\n${t}\n${'═'.repeat(88)}`);
async function connect() {
  let last;
  for (const server of [env.DB_SERVER, '189.126.197.82']) {
    try { return await sql.connect({ ...base, server }); } catch (e) { last = e; }
  }
  throw last;
}

async function main() {
  const pool = await connect();

  head('FILIAIS com NERD ou MATRIZ no nome');
  console.table(await q(pool, `
    SELECT RTRIM(LTRIM(CAST(COD_FILIAL AS VARCHAR(20)))) AS COD,
           '[' + RTRIM(LTRIM(CAST(FILIAL AS VARCHAR(120)))) + ']' AS NOME
    FROM FILIAIS WITH (NOLOCK)
    WHERE FILIAL LIKE '%NERD%' OR FILIAL LIKE '%MATRIZ%'
    ORDER BY NOME`));

  head('N7.1.0003 / 06 — o que o seletor mostra hoje (HAVING <> 0) vs todas as linhas');
  console.table(await q(pool, `
    SELECT RTRIM(LTRIM(CAST(ep.FILIAL AS VARCHAR(100)))) AS FILIAL,
           SUM(ISNULL(ep.ESTOQUE,0)) AS ESTOQUE,
           CASE WHEN SUM(ISNULL(ep.ESTOQUE,0)) <> 0 THEN 'aparece' ELSE 'ESCONDIDA' END AS NO_SELETOR
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    WHERE RTRIM(LTRIM(CAST(ep.PRODUTO AS VARCHAR(50)))) = 'N7.1.0003'
      AND RTRIM(LTRIM(ISNULL(CAST(ep.COR_PRODUTO AS VARCHAR(20)),''))) = '06'
    GROUP BY RTRIM(LTRIM(CAST(ep.FILIAL AS VARCHAR(100))))
    ORDER BY FILIAL`));

  head('Quantos itens do romaneio 834279 têm a NERD escondida do seletor (estoque 0)');
  console.table(await q(pool, `
    SELECT SUM(CASE WHEN ep.ESTOQUE = 0 THEN 1 ELSE 0 END) AS ESCONDIDOS,
           SUM(CASE WHEN ep.ESTOQUE <> 0 THEN 1 ELSE 0 END) AS VISIVEIS,
           COUNT(*) AS TOTAL
    FROM NERD_AJUSTE_HISTORICO a WITH (NOLOCK)
    JOIN ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      ON ep.PRODUTO = a.PRODUTO AND ISNULL(ep.COR_PRODUTO,'') = a.COR_PRODUTO
     AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(a.FILIAL))
    WHERE LTRIM(RTRIM(a.ROMANEIO_REF)) = '834279' AND a.TIPO_AJUSTE = 'CORRECAO_EXCLUSAO_DOBRO'`));

  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

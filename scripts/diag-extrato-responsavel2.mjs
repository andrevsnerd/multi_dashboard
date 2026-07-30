/** (read-only) Os campos RESPONSAVEL vêm preenchidos? E o vendedor da venda? */
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
  requestTimeout: 180000, connectionTimeout: 30000,
};
const q = async (pool, text) => (await pool.request().query(text)).recordset;
const head = (t) => console.log(`\n${'═'.repeat(92)}\n${t}\n${'═'.repeat(92)}`);
async function connect() {
  let last;
  for (const server of [env.DB_SERVER, '189.126.197.82']) {
    try { return await sql.connect({ ...base, server }); } catch (e) { last = e; }
  }
  throw last;
}

async function main() {
  const pool = await connect();

  for (const [rotulo, texto] of [
    ['ESTOQUE_PROD_ENT — NERD, 20/07+', `
      SELECT TOP 8 LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROM, EMISSAO,
             '[' + ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'(null)') + ']' AS RESPONSAVEL
      FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['ESTOQUE_PROD_SAI — NERD, 20/07+', `
      SELECT TOP 8 LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROM, EMISSAO,
             '[' + ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'(null)') + ']' AS RESPONSAVEL
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['LOJA_SAIDAS — NERD, 20/07+', `
      SELECT TOP 8 LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROM, EMISSAO,
             '[' + ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'(null)') + ']' AS RESPONSAVEL
      FROM LOJA_SAIDAS WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['LOJA_ENTRADAS — NERD, 20/07+', `
      SELECT TOP 8 LTRIM(RTRIM(ROMANEIO_PRODUTO)) AS ROM, EMISSAO,
             '[' + ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'(null)') + ']' AS RESPONSAVEL
      FROM LOJA_ENTRADAS WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['Preenchimento geral de RESPONSAVEL (últimos 90 dias)', `
      SELECT 'ESTOQUE_PROD_ENT' AS FONTE, COUNT(*) AS N,
             SUM(CASE WHEN ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'') <> '' THEN 1 ELSE 0 END) AS COM_RESP
        FROM ESTOQUE_PROD_ENT WITH (NOLOCK) WHERE EMISSAO >= DATEADD(day,-90,GETDATE())
      UNION ALL
      SELECT 'ESTOQUE_PROD_SAI', COUNT(*),
             SUM(CASE WHEN ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'') <> '' THEN 1 ELSE 0 END)
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK) WHERE EMISSAO >= DATEADD(day,-90,GETDATE())
      UNION ALL
      SELECT 'LOJA_ENTRADAS', COUNT(*),
             SUM(CASE WHEN ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'') <> '' THEN 1 ELSE 0 END)
        FROM LOJA_ENTRADAS WITH (NOLOCK) WHERE EMISSAO >= DATEADD(day,-90,GETDATE())
      UNION ALL
      SELECT 'LOJA_SAIDAS', COUNT(*),
             SUM(CASE WHEN ISNULL(LTRIM(RTRIM(RESPONSAVEL)),'') <> '' THEN 1 ELSE 0 END)
        FROM LOJA_SAIDAS WITH (NOLOCK) WHERE EMISSAO >= DATEADD(day,-90,GETDATE())`],
    ['Vendas do N7.1.0003/06 — vendedor e apelido', `
      SELECT TOP 8 v.TICKET, v.DATA_VENDA, f.FILIAL,
             LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) AS VENDEDOR,
             ISNULL(LTRIM(RTRIM(lv.VENDEDOR_APELIDO)), '(sem apelido)') AS APELIDO
      FROM LOJA_VENDA v WITH (NOLOCK)
      JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK) ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
      LEFT JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
      LEFT JOIN LOJA_VENDEDORES lv WITH (NOLOCK)
        ON LTRIM(RTRIM(CAST(v.VENDEDOR AS VARCHAR))) = LTRIM(RTRIM(CAST(lv.VENDEDOR AS VARCHAR)))
      WHERE LTRIM(RTRIM(vp.PRODUTO)) = 'N7.1.0003' ORDER BY v.DATA_VENDA DESC`],
  ]) {
    head(rotulo);
    try {
      const rows = await q(pool, texto);
      console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(
        ([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 19) : (typeof v === 'string' ? v.trim() : v)]))));
    } catch (e) { console.log(`  (erro: ${e.message.slice(0, 160)})`); }
  }

  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

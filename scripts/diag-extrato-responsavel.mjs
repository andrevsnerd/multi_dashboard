/** (read-only) Que coluna de "quem fez" existe em cada fonte do Extrato de Produto. */
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

const TABELAS = [
  'ESTOQUE_PROD_ENT', 'ESTOQUE_PROD1_ENT', 'ESTOQUE_PROD_SAI', 'ESTOQUE_PROD1_SAI',
  'LOJA_ENTRADAS', 'LOJA_ENTRADAS_PRODUTO', 'LOJA_SAIDAS', 'LOJA_SAIDAS_PRODUTO',
  'LOJA_VENDA', 'LOJA_VENDA_PRODUTO', 'ESTOQUE_PROD_CONTAGEM', 'NERD_AJUSTE_HISTORICO',
];

async function main() {
  const pool = await connect();

  head('Colunas candidatas a "quem fez" por tabela');
  const cols = await q(pool, `
    SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH AS LEN
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_NAME IN (${TABELAS.map((t) => `'${t}'`).join(',')})
      AND (COLUMN_NAME LIKE '%RESPONSAV%' OR COLUMN_NAME LIKE '%USUARIO%' OR COLUMN_NAME LIKE '%OPERADOR%'
        OR COLUMN_NAME LIKE '%DIGITA%'   OR COLUMN_NAME LIKE '%LOGIN%'   OR COLUMN_NAME LIKE '%FUNCION%'
        OR COLUMN_NAME LIKE '%VENDEDOR%' OR COLUMN_NAME LIKE '%CM_USER%' OR COLUMN_NAME LIKE '%USER%'
        OR COLUMN_NAME LIKE '%CONFERE%'  OR COLUMN_NAME LIKE '%CONFERI%')
    ORDER BY TABLE_NAME, COLUMN_NAME`);
  console.table(cols);

  head('Amostra: quem consta nos movimentos recentes da NERD');
  const amostras = [
    ['ESTOQUE_PROD_ENT (entradas)', `
      SELECT TOP 6 ROMANEIO_PRODUTO, EMISSAO, CM_USUARIO_INCLUSAO, CM_USUARIO_ALTERACAO, RESPONSAVEL
      FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['ESTOQUE_PROD_SAI (saídas)', `
      SELECT TOP 6 ROMANEIO_PRODUTO, EMISSAO, CM_USUARIO_INCLUSAO, CM_USUARIO_ALTERACAO, RESPONSAVEL
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['LOJA_ENTRADAS', `
      SELECT TOP 6 ROMANEIO_PRODUTO, EMISSAO, CM_USUARIO_INCLUSAO, RESPONSAVEL
      FROM LOJA_ENTRADAS WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
    ['LOJA_SAIDAS', `
      SELECT TOP 6 ROMANEIO_PRODUTO, EMISSAO, CM_USUARIO_INCLUSAO, RESPONSAVEL
      FROM LOJA_SAIDAS WITH (NOLOCK)
      WHERE LTRIM(RTRIM(FILIAL)) = 'NERD' AND EMISSAO >= '2026-07-20' ORDER BY EMISSAO DESC`],
  ];
  for (const [rotulo, texto] of amostras) {
    console.log(`\n--- ${rotulo} ---`);
    try {
      const rows = await q(pool, texto);
      console.table(rows.map((r) => Object.fromEntries(Object.entries(r).map(
        ([k, v]) => [k, v instanceof Date ? v.toISOString().slice(0, 19) : (typeof v === 'string' ? v.trim() : v)]))));
    } catch (e) { console.log(`  (erro: ${e.message.slice(0, 140)})`); }
  }

  await pool.close();
}
main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

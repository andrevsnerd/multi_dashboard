/**
 * Grava em romaneio_conferencia o resultado das saídas confirmadas ANTES de a
 * confirmação passar a gravar sozinha (lib/server/romaneio-conferencia.ts).
 * Roda uma vez; depois disso cada confirmação mantém a tabela.
 *
 * Mesma conta da lib: item a item (produto×cor), linha de ESTOQUE_PROD1_SAI ganha
 * da LOJA_SAIDAS_PRODUTO. A confirmação não guarda a filial de origem, então ela
 * sai do Linx: entre as filiais com esse número de romaneio, a que tem mais itens
 * em comum com o que foi confirmado.
 *
 * Uso:
 *   node scripts/backfill-romaneio-conferencia.mjs            # simula e lista as divergentes
 *   node scripts/backfill-romaneio-conferencia.mjs --gravar   # grava no Neon
 *   node scripts/backfill-romaneio-conferencia.mjs --dias=180 # janela (padrão 120)
 */

import fs from 'fs';
import sql from 'mssql';
import { neon } from '@neondatabase/serverless';

const GRAVAR = process.argv.includes('--gravar');
const DIAS = Number(process.argv.find((a) => a.startsWith('--dias='))?.split('=')[1] ?? 120);

const env = fs.readFileSync('.env.local', 'utf8');
const databaseUrl = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
if (!databaseUrl) throw new Error('DATABASE_URL não encontrada no .env.local');
const neonSql = neon(databaseUrl);

const linxConfig = {
  server: '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user: 'andre.sabetta',
  password: 'asabetta',
  port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 300000,
  connectionTimeout: 30000,
};

// 1) Confirmações do período, por company|romaneio|filial_destino.
const confRows = await neonSql`
  SELECT company_key, romaneio_id, filial_destino, produto, cor_produto, qtde_confirmada
  FROM romaneio_item_confirmado
  WHERE confirmed_at >= NOW() - (${DIAS} || ' days')::interval
`;
const grupos = new Map();
for (const r of confRows) {
  const k = `${r.company_key}|${r.romaneio_id}|${r.filial_destino}`;
  const g = grupos.get(k) ?? { company: r.company_key, romaneio: r.romaneio_id, destino: r.filial_destino, itens: new Map() };
  g.itens.set(`${(r.produto || '').trim()}|${(r.cor_produto || '').trim()}`, Number(r.qtde_confirmada) || 0);
  grupos.set(k, g);
}
const ids = [...new Set([...grupos.values()].map((g) => g.romaneio))];
console.log(`${confRows.length} confirmações, ${grupos.size} romaneio×destino, ${ids.length} números de romaneio (${DIAS} dias)`);

// 2) Itens das saídas no Linx: "romaneio" → "FILIAL" → Map(produto|cor → qtde).
const pool = await sql.connect(linxConfig);
const linx = new Map();
const fonteDe = new Map();
for (let i = 0; i < ids.length; i += 500) {
  const lote = ids.slice(i, i + 500);
  const req = pool.request();
  lote.forEach((id, j) => req.input(`r${j}`, sql.VarChar, id));
  const params = lote.map((_, j) => `@r${j}`).join(', ');
  const { recordset } = await req.query(`
    SELECT 'EST' AS FONTE, ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, SUM(QTDE) AS QTDE
    FROM ESTOQUE_PROD1_SAI WITH (NOLOCK) WHERE ROMANEIO_PRODUTO IN (${params})
    GROUP BY ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO
    UNION ALL
    SELECT 'LOJA', ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, SUM(QTDE_SAIDA)
    FROM LOJA_SAIDAS_PRODUTO WITH (NOLOCK) WHERE ROMANEIO_PRODUTO IN (${params})
    GROUP BY ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO
  `);
  for (const row of recordset) {
    const rom = (row.ROMANEIO_PRODUTO || '').trim();
    const filial = (row.FILIAL || '').trim();
    const chave = `${rom}|${filial.toUpperCase()}`;
    const fonte = fonteDe.get(chave);
    if (fonte === 'EST' && row.FONTE === 'LOJA') continue;
    const porFilial = linx.get(rom) ?? new Map();
    if (fonte === 'LOJA' && row.FONTE === 'EST') porFilial.delete(filial);
    fonteDe.set(chave, row.FONTE);
    const itens = porFilial.get(filial) ?? new Map();
    const item = `${(row.PRODUTO || '').trim()}|${(row.COR_PRODUTO || '').trim()}`;
    itens.set(item, (itens.get(item) ?? 0) + (Number(row.QTDE) || 0));
    porFilial.set(filial, itens);
    linx.set(rom, porFilial);
  }
}
await pool.close();

// 3) Conta de cada romaneio×destino.
const linhas = [];
let semOrigem = 0;
for (const g of grupos.values()) {
  let origem = '';
  let itensRomaneio = null;
  let melhor = 0;
  for (const [filial, itens] of linx.get(g.romaneio) ?? []) {
    const comuns = [...g.itens.keys()].filter((k) => itens.has(k)).length;
    if (comuns > melhor) {
      melhor = comuns;
      origem = filial;
      itensRomaneio = itens;
    }
  }
  if (!itensRomaneio) {
    semOrigem += 1; // trânsito do Linx ou romaneio que não é saída
    continue;
  }
  let itensOk = 0;
  let pecasRomaneio = 0;
  for (const [item, qtde] of itensRomaneio) {
    pecasRomaneio += qtde;
    if ((g.itens.get(item) ?? 0) === qtde) itensOk += 1;
  }
  const pecasConfirmadas = [...g.itens.values()].reduce((s, q) => s + q, 0);
  const extras = [...g.itens.keys()].some((k) => !itensRomaneio.has(k));
  linhas.push({
    ...g,
    origem,
    itensOk,
    itensTotal: itensRomaneio.size,
    pecasConfirmadas,
    pecasRomaneio,
    divergente: itensOk < itensRomaneio.size || extras,
  });
}

const divergentes = linhas.filter((l) => l.divergente);
console.log(`${linhas.length} saídas conferidas, ${divergentes.length} com alteração, ${semOrigem} sem saída no Linx (ignoradas)`);
for (const l of divergentes) {
  console.log(`  ${l.company.padEnd(8)} ${l.romaneio}  ${l.origem} → ${l.destino}  itens ${l.itensOk}/${l.itensTotal}  peças ${l.pecasConfirmadas}/${l.pecasRomaneio}`);
}

if (!GRAVAR) {
  console.log('\nSimulação — nada gravado. Rode com --gravar para gravar.');
  process.exit(0);
}

// 4) Grava (mesma tabela/DDL da lib).
await neonSql`
  CREATE TABLE IF NOT EXISTS romaneio_conferencia (
    company_key       TEXT NOT NULL,
    romaneio_id       TEXT NOT NULL,
    filial_destino    TEXT NOT NULL,
    filial_origem     TEXT NOT NULL,
    itens_ok          INTEGER NOT NULL,
    itens_total       INTEGER NOT NULL,
    pecas_confirmadas INTEGER NOT NULL,
    pecas_romaneio    INTEGER NOT NULL,
    divergente        BOOLEAN NOT NULL,
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (company_key, romaneio_id, filial_destino)
  )
`;
for (let i = 0; i < linhas.length; i += 500) {
  const lote = linhas.slice(i, i + 500);
  await neonSql`
    INSERT INTO romaneio_conferencia
      (company_key, romaneio_id, filial_destino, filial_origem, itens_ok, itens_total,
       pecas_confirmadas, pecas_romaneio, divergente, updated_at)
    SELECT u.c, u.r, u.fd, u.fo, u.ok, u.tot, u.pc, u.pr, u.div, NOW()
    FROM UNNEST(
      ${lote.map((l) => l.company)}::text[], ${lote.map((l) => l.romaneio)}::text[],
      ${lote.map((l) => l.destino)}::text[], ${lote.map((l) => l.origem)}::text[],
      ${lote.map((l) => l.itensOk)}::int[], ${lote.map((l) => l.itensTotal)}::int[],
      ${lote.map((l) => l.pecasConfirmadas)}::int[], ${lote.map((l) => l.pecasRomaneio)}::int[],
      ${lote.map((l) => l.divergente)}::boolean[]
    ) AS u(c, r, fd, fo, ok, tot, pc, pr, div)
    ON CONFLICT (company_key, romaneio_id, filial_destino) DO NOTHING
  `;
}
console.log(`\nGravado: ${linhas.length} linhas (as que a confirmação já tinha gravado ficaram como estavam).`);
process.exit(0);

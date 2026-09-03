/**
 * Backfill do CUSTO1/VALOR dos itens das entradas criadas pelo dashboard
 * (tela Saídas/Entradas de Produtos).
 *
 * PROBLEMA: o executor inseria ESTOQUE_PROD1_ENT sem CUSTO1/VALOR. A tela do
 * Linx (120103SPK - Entrada de Produtos) mostra "Valor Total" somando
 * ESTOQUE_PROD1_ENT.VALOR dos itens — o cabeçalho ESTOQUE_PROD_ENT não tem
 * coluna de valor. Resultado: todo romaneio nosso aparecia com 0,00.
 *
 * O executor já foi corrigido (lib/saida-entrada-executor.js →
 * montarCustoEntradaSql). Este script conserta o histórico.
 *
 * ALVO (conservador, só o que é nosso):
 *   - item ainda SEM valor (é esse o critério; data é só recorte opcional)
 *   - entrada DIRETA: ESTOQUE_PROD_ENT.FILIAL_ORIGEM IS NULL e NF_ENTRADA IS NULL
 *   - com linha em LOJA_ENTRADAS (assinatura do dashboard: entrada digitada no
 *     Linx não cria essa linha)
 *   - item ainda zerado: CUSTO1 = 0 E VALOR = 0
 *   - custo de cadastro > 0
 * Fica de fora: entrada de transferência (no Linx TODA entrada de
 * transferência tem custo 0 — é a norma do ERP) e entrada com NF.
 *
 * SEGURANÇA: o UPDATE toca só CUSTO1/VALOR. Os blocos do LXU_ESTOQUE_PROD1_ENT
 * que mexem em estoque/ajuste/OP são todos guardados por UPDATE(QTDE) ou
 * UPDATE(EN_n)/PRODUTO/COR/FILIAL, então nada de estoque se move. Os dois
 * blocos de custo do trigger dependem de PARAMETROS
 * (ENTRADA_ATUALIZA_CUSTO_PA=0 e CTRL_CUSTO_PARA_TRANSF='.F.') e estão
 * desligados nesta base. É idempotente: só pega linha ainda zerada.
 *
 * LOJA_ENTRADAS.VALOR_TOTAL do histórico fica como está de propósito: um UPDATE
 * lá dispara o LXU_LOJA_ENTRADAS, que reescreve DATA_PARA_TRANSFERENCIA com
 * GETDATE(). Não vale mexer numa data de romaneio antigo por um campo que a
 * tela do Linx não lê (entradas diretas nativas nem têm linha em LOJA_ENTRADAS).
 *
 * USO:
 *   node scripts/backfill-custo-entradas.mjs                            → só simula
 *   node scripts/backfill-custo-entradas.mjs --apply                    → grava
 *   node scripts/backfill-custo-entradas.mjs --apply --desde 2026-08-01 → recorte por data
 *   node scripts/backfill-custo-entradas.mjs --apply --romaneio 835221  → um romaneio
 */
import sql from 'mssql';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const arg = (nome) => {
  const i = process.argv.indexOf(nome);
  return i >= 0 ? (process.argv[i + 1] || '').trim() : '';
};
const ROMANEIO = arg('--romaneio');
/**
 * `--desde YYYY-MM-DD` e `--romaneio` são recortes OPCIONAIS. O critério é
 * estar SEM valor, não a data: quem já tem custo o script nem olha. Entrada
 * antiga era digitada direto no Linx e já nasceu com custo (jan/2026: 4.519 de
 * 4.531 itens), então o alvo naturalmente já é só o que a dash criou.
 */
const DESDE = arg('--desde');
const LOTE = 2000;

if (DESDE && !/^\d{4}-\d{2}-\d{2}$/.test(DESDE)) {
  console.error('--desde precisa ser uma data YYYY-MM-DD.');
  process.exit(1);
}

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^DB_/.test(l))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i), l.slice(i + 1)];
    })
);

const config = {
  server: env.DB_SERVER,
  database: env.DB_DATABASE,
  user: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  port: Number(env.DB_PORT || 1433),
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 300000,
  connectionTimeout: 30000,
};

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

/** Filtro do alvo, compartilhado entre a simulação e o UPDATE. */
const FILTRO_ALVO = `
  ISNULL(i.CUSTO1, 0) = 0
  AND ISNULL(i.VALOR, 0) = 0
  AND e.FILIAL_ORIGEM IS NULL
  AND e.NF_ENTRADA IS NULL
  AND EXISTS (
    SELECT 1 FROM LOJA_ENTRADAS le WITH (NOLOCK)
     WHERE le.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO
       AND le.FILIAL = i.FILIAL
  )
  AND x.CUSTO > 0
`;

/**
 * Custo de reposição do cadastro, na cor, com fallback no produto — o mesmo
 * default que a tela do Linx usa ao digitar o item.
 */
const CUSTO_APPLY = `
  CROSS APPLY (
    SELECT ISNULL(NULLIF(pc.CUSTO_REPOSICAO1, 0), ISNULL(p.CUSTO_REPOSICAO1, 0)) AS CUSTO
      FROM (SELECT 1 AS UM) dummy
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = i.PRODUTO
      LEFT JOIN PRODUTO_CORES pc WITH (NOLOCK)
             ON pc.PRODUTO = i.PRODUTO AND pc.COR_PRODUTO = i.COR_PRODUTO
  ) x
`;

// char compara ignorando espaços à direita, então dá match no índice sem LTRIM/RTRIM.
const filtroRomaneio = ROMANEIO
  ? `AND i.ROMANEIO_PRODUTO = '${ROMANEIO.replace(/'/g, "''")}'`
  : DESDE
    ? `AND e.EMISSAO >= '${DESDE}'`
    : '';

async function main() {
  const pool = await connect();
  const q = async (text) => (await pool.request().query(text)).recordset;

  console.log(`\nModo: ${APPLY ? 'APLICAR (grava)' : 'SIMULAÇÃO (não grava)'}${ROMANEIO ? ` — romaneio ${ROMANEIO}` : ''}`);

  const resumo = await q(`
    SELECT COUNT(DISTINCT LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) + '|' + LTRIM(RTRIM(i.FILIAL))) AS ROMANEIOS,
           COUNT(*) AS ITENS,
           SUM(i.QTDE) AS PECAS,
           CAST(SUM(ROUND(i.QTDE * x.CUSTO, 2)) AS NUMERIC(18, 2)) AS VALOR,
           MIN(e.EMISSAO) AS DE, MAX(e.EMISSAO) AS ATE
      FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
      JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
        ON e.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND e.FILIAL = i.FILIAL
      ${CUSTO_APPLY}
     WHERE ${FILTRO_ALVO} ${filtroRomaneio}
  `);
  const r = resumo[0] || {};
  console.log(
    `\nA corrigir: ${r.ROMANEIOS || 0} romaneios · ${r.ITENS || 0} itens · ${r.PECAS || 0} peças · ` +
      `R$ ${r.VALOR || 0} · ${r.DE ? String(r.DE).slice(0, 10) : '-'} → ${r.ATE ? String(r.ATE).slice(0, 10) : '-'}`
  );

  console.log('\nPor filial:');
  console.table(
    await q(`
      SELECT TOP 40 LTRIM(RTRIM(i.FILIAL)) AS FILIAL,
             COUNT(DISTINCT LTRIM(RTRIM(i.ROMANEIO_PRODUTO))) AS ROMS,
             COUNT(*) AS ITENS,
             CAST(SUM(ROUND(i.QTDE * x.CUSTO, 2)) AS NUMERIC(18, 2)) AS VALOR
        FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
        JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
          ON e.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND e.FILIAL = i.FILIAL
        ${CUSTO_APPLY}
       WHERE ${FILTRO_ALVO} ${filtroRomaneio}
       GROUP BY i.FILIAL
       ORDER BY ITENS DESC
    `)
  );

  const semCusto = await q(`
    SELECT COUNT(*) AS ITENS
      FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
      JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
        ON e.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND e.FILIAL = i.FILIAL
      ${CUSTO_APPLY}
     WHERE ISNULL(i.CUSTO1, 0) = 0 AND ISNULL(i.VALOR, 0) = 0
       AND i.QTDE > 0
       AND e.FILIAL_ORIGEM IS NULL AND e.NF_ENTRADA IS NULL
       AND EXISTS (
         SELECT 1 FROM LOJA_ENTRADAS le WITH (NOLOCK)
          WHERE le.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND le.FILIAL = i.FILIAL
       )
       AND x.CUSTO <= 0 ${filtroRomaneio}
  `);
  if (Number(semCusto[0]?.ITENS)) {
    console.log(`\nℹ️  ${semCusto[0].ITENS} itens ficam de fora: produto sem custo de reposição no cadastro.`);
  }

  if (!APPLY) {
    console.log('\nSimulação apenas. Rode com --apply para gravar.');
    await pool.close();
    return;
  }

  let total = 0;
  for (;;) {
    const res = await pool.request().query(`
      UPDATE TOP (${LOTE}) i
         SET CUSTO1 = x.CUSTO,
             VALOR = CAST(ROUND(i.QTDE * x.CUSTO, 2) AS NUMERIC(14, 2))
        FROM ESTOQUE_PROD1_ENT i
        JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
          ON e.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND e.FILIAL = i.FILIAL
        ${CUSTO_APPLY}
       WHERE ${FILTRO_ALVO} ${filtroRomaneio}
    `);
    const afetados = res.rowsAffected.reduce((s, n) => s + n, 0);
    total += afetados;
    console.log(`  lote: ${afetados} itens (acumulado ${total})`);
    if (afetados === 0) break;
  }

  console.log(`\n✅ ${total} itens corrigidos.`);

  const sobra = await q(`
    SELECT COUNT(*) AS ITENS
      FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
      JOIN ESTOQUE_PROD_ENT e WITH (NOLOCK)
        ON e.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND e.FILIAL = i.FILIAL
      ${CUSTO_APPLY}
     WHERE ${FILTRO_ALVO} ${filtroRomaneio}
  `);
  console.log(`Restantes no alvo: ${sobra[0]?.ITENS ?? '?'}`);

  await pool.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

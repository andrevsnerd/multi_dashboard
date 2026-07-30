/**
 * Corrige a subtração EM DOBRO causada pela exclusão do romaneio de entrada 834279
 * (filial NERD, 23/07/2026) — ver memória `exclusao-romaneio-retorno-estoque-dobro`.
 *
 * O que aconteceu: a rotina de exclusão fez um `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE =
 * ESTOQUE - QTDE` e, ao deletar os itens, o trigger LXD_ESTOQUE_PROD1_ENT do Linx
 * subtraiu de novo. Resultado: 134 unidades a menos em 55 itens (50 negativos).
 *
 * O que este script faz, por item de NERD_AJUSTE_HISTORICO (ROMANEIO_REF = 834279):
 *   1. ESTOQUE_PRODUTOS.ESTOQUE += |QTDE_AJUSTE|   ← devolve só a subtração duplicada
 *   2. grava uma linha de auditoria +|QTDE_AJUSTE| (CORRECAO_EXCLUSAO_DOBRO), para o
 *      saldo do Extrato de Produto voltar a fechar com o estoque real
 *
 * NÃO toca nas colunas de grade ES1..ES48: quem errou foi só a coluna ESTOQUE (o
 * UPDATE manual não mexia na grade), e é justamente essa diferença que prova o bug.
 *
 * Uso:
 *   node scripts/corrigir-estoque-834279.mjs            # dry-run (não escreve nada)
 *   node scripts/corrigir-estoque-834279.mjs --apply    # aplica, em transação única
 */
import sql from 'mssql';
import fs from 'fs';

const ROMANEIO = '834279';
const FILIAL = 'NERD';
const TIPO_CORRECAO = 'CORRECAO_EXCLUSAO_DOBRO';
const TOTAL_ESPERADO = 134; // unidades a devolver, conforme a investigação de 30/07/2026

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const RESPONSAVEL = process.argv.find((a) => a.startsWith('--responsavel='))?.split('=')[1]
  || 'correcao-834279';

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
const head = (t) => console.log(`\n${'═'.repeat(92)}\n${t}\n${'═'.repeat(92)}`);
const q = async (pool, text) => (await pool.request().query(text)).recordset;

async function connect() {
  let last;
  for (const server of [env.DB_SERVER, '189.126.197.82']) {
    try { const p = await sql.connect({ ...base, server }); console.log(`✅ conectado em ${server}`); return p; }
    catch (e) { console.log(`❌ ${server}: ${e.message}`); last = e; }
  }
  throw last;
}

async function main() {
  console.log(APPLY ? '⚠️  MODO APPLY — vai escrever no banco de PRODUÇÃO' : '🔍 DRY-RUN — nada será escrito');
  const pool = await connect();

  // ── Trava de idempotência: se a correção já foi gravada, não roda de novo ──
  const jaCorrigido = await q(pool, `
    SELECT COUNT(*) AS N, MIN(DATA_AJUSTE) AS QUANDO
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_REF)) = '${ROMANEIO}' AND TIPO_AJUSTE = '${TIPO_CORRECAO}'`);
  if (jaCorrigido[0].N > 0) {
    console.log(`\n⛔ Correção JÁ aplicada: ${jaCorrigido[0].N} linha(s) ${TIPO_CORRECAO} em ${jaCorrigido[0].QUANDO?.toISOString?.().slice(0, 19)}.`);
    console.log('   Nada a fazer — rodar de novo dobraria o estoque.');
    await pool.close();
    return;
  }

  // ── Itens a corrigir + estado atual (ESTOQUE errado, ES1 = saldo certo) ──
  const itens = await q(pool, `
    SELECT LTRIM(RTRIM(a.PRODUTO)) AS PRODUTO,
           LTRIM(RTRIM(ISNULL(a.COR_PRODUTO, ''))) AS COR,
           a.QTDE_AJUSTE,
           ep.ESTOQUE, ep.ES1,
           LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS DESCR
    FROM NERD_AJUSTE_HISTORICO a WITH (NOLOCK)
    LEFT JOIN ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      ON ep.PRODUTO = a.PRODUTO
     AND ISNULL(ep.COR_PRODUTO, '') = a.COR_PRODUTO
     AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(a.FILIAL))
    LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = a.PRODUTO
    WHERE LTRIM(RTRIM(a.ROMANEIO_REF)) = '${ROMANEIO}'
      AND a.TIPO_AJUSTE = 'EXCLUSAO_ROMANEIO_ENTRADA'
      AND LTRIM(RTRIM(a.FILIAL)) = '${FILIAL}'
    ORDER BY PRODUTO, COR`);

  const semLinha = itens.filter((i) => i.ESTOQUE === null);
  const devolver = itens.map((i) => ({
    PRODUTO: i.PRODUTO, COR: i.COR, DESCR: i.DESCR.slice(0, 26),
    DEVOLVER: Math.abs(i.QTDE_AJUSTE),
    ESTOQUE: i.ESTOQUE, DEPOIS: (i.ESTOQUE ?? 0) + Math.abs(i.QTDE_AJUSTE),
    ES1: i.ES1,
    CONFERE: (i.ES1 ?? 0) - (i.ESTOQUE ?? 0) === Math.abs(i.QTDE_AJUSTE) ? 'ok' : '⚠️',
  }));

  head(`Itens do romaneio ${ROMANEIO} na filial ${FILIAL}`);
  console.table(devolver);

  const total = devolver.reduce((s, r) => s + r.DEVOLVER, 0);
  const divergentes = devolver.filter((r) => r.CONFERE !== 'ok');
  console.log(`\nitens: ${devolver.length} | unidades a devolver: ${total} (esperado ${TOTAL_ESPERADO})`);
  console.log(`negativos hoje: ${devolver.filter((r) => (r.ESTOQUE ?? 0) < 0).length} | negativos depois: ${devolver.filter((r) => r.DEPOIS < 0).length}`);
  if (semLinha.length) console.log(`⚠️  ${semLinha.length} item(ns) sem linha em ESTOQUE_PRODUTOS — serão ignorados pelo UPDATE.`);
  if (divergentes.length) {
    console.log(`\n⚠️  ${divergentes.length} item(ns) onde ES1-ESTOQUE ≠ |ajuste| (têm divergência EXTRA, de outra origem):`);
    console.table(divergentes);
    console.log('   A correção da subtração dupla vale para eles também; a sobra precisa de análise separada.');
  }

  if (total !== TOTAL_ESPERADO && !FORCE) {
    console.log(`\n⛔ Total ${total} ≠ ${TOTAL_ESPERADO} esperado. Algo mudou desde a investigação.`);
    console.log('   Revise antes de aplicar (ou use --force se a diferença for entendida).');
    await pool.close();
    return;
  }

  if (!APPLY) {
    console.log('\n🔍 DRY-RUN encerrado. Nada foi escrito. Rode com --apply para efetivar.');
    await pool.close();
    return;
  }

  // ── Aplicação: tudo numa transação só ──
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    let atualizados = 0, auditados = 0;
    for (const i of itens) {
      const qtde = Math.abs(i.QTDE_AJUSTE);
      if (qtde === 0) continue;

      const r1 = new sql.Request(tx);
      r1.input('produto', sql.VarChar, i.PRODUTO);
      r1.input('cor', sql.VarChar, i.COR);
      r1.input('filial', sql.VarChar, FILIAL);
      r1.input('qtde', sql.Int, qtde);
      const res = await r1.query(`
        UPDATE ESTOQUE_PRODUTOS
        SET ESTOQUE = ESTOQUE + @qtde
        WHERE PRODUTO = @produto
          AND ISNULL(COR_PRODUTO, '') = @cor
          AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
      `);
      atualizados += res.rowsAffected[0] ?? 0;

      const r2 = new sql.Request(tx);
      r2.input('filial', sql.VarChar, FILIAL);
      r2.input('produto', sql.VarChar, i.PRODUTO);
      r2.input('cor', sql.VarChar, i.COR);
      r2.input('qtde', sql.Int, qtde);
      r2.input('romaneioRef', sql.VarChar, ROMANEIO);
      r2.input('tipoAjuste', sql.VarChar, TIPO_CORRECAO);
      r2.input('responsavel', sql.VarChar, RESPONSAVEL);
      r2.input('obs', sql.VarChar,
        `Estorno da subtração em dobro do romaneio ${ROMANEIO}: a exclusão descontou ${qtde} un no UPDATE do app e outras ${qtde} un no trigger do Linx`);
      await r2.query(`
        INSERT INTO NERD_AJUSTE_HISTORICO
          (FILIAL, PRODUTO, COR_PRODUTO, QTDE_AJUSTE, ROMANEIO_REF, TIPO_AJUSTE, RESPONSAVEL, OBS)
        VALUES (@filial, @produto, @cor, @qtde, @romaneioRef, @tipoAjuste, @responsavel, @obs)
      `);
      auditados++;
    }
    await tx.commit();
    console.log(`\n✅ Aplicado: ${atualizados} linha(s) de ESTOQUE_PRODUTOS, ${auditados} linha(s) de auditoria.`);
  } catch (e) {
    await tx.rollback();
    console.error(`\n⛔ ROLLBACK — nada foi alterado. Erro: ${e.message}`);
    await pool.close();
    process.exit(1);
  }

  // ── Conferência pós-correção ──
  head('Conferência: ESTOQUE deve bater com ES1');
  const depois = await q(pool, `
    SELECT LTRIM(RTRIM(a.PRODUTO)) AS PRODUTO,
           LTRIM(RTRIM(ISNULL(a.COR_PRODUTO,''))) AS COR,
           ep.ESTOQUE, ep.ES1, ep.ESTOQUE - ep.ES1 AS DIFF
    FROM NERD_AJUSTE_HISTORICO a WITH (NOLOCK)
    JOIN ESTOQUE_PRODUTOS ep WITH (NOLOCK)
      ON ep.PRODUTO = a.PRODUTO AND ISNULL(ep.COR_PRODUTO,'') = a.COR_PRODUTO
     AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(a.FILIAL))
    WHERE LTRIM(RTRIM(a.ROMANEIO_REF)) = '${ROMANEIO}' AND a.TIPO_AJUSTE = '${TIPO_CORRECAO}'
    ORDER BY PRODUTO, COR`);
  const fora = depois.filter((r) => r.DIFF !== 0);
  console.log(`itens conferidos: ${depois.length} | ESTOQUE = ES1 em ${depois.length - fora.length}`);
  console.log(`negativos restantes: ${depois.filter((r) => r.ESTOQUE < 0).length}`);
  if (fora.length) { console.log('itens que ainda divergem da grade (analisar à parte):'); console.table(fora); }

  await pool.close();
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

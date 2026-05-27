/**
 * LIMPEZA ONE-TIME — remove do trânsito do Linx as entradas DIRETAS criadas pelo
 * dashboard que tiveram a entrada/estoque corretamente registrados, mas ficaram
 * presas no trânsito (STATUS_TRANSITO nulo/<4, ENTRADA_CONFERIDA=0).
 *
 * O que faz: apenas marca como conferida (ENTRADA_CONFERIDA=1, STATUS_TRANSITO=4).
 *   - NÃO insere nada  -> não há risco de entrada duplicada.
 *   - NÃO mexe em ENTRADA_ENCERRADA (já é 1) nem em ESTOQUE_PROD1_ENT
 *     -> o estoque NÃO é re-somado (já entrou no momento da criação).
 *   - O trigger LXU_LOJA_ENTRADAS preenche DATA_ENTRADA_CONFERIDA naturalmente.
 *
 * Guardas (assinatura de entrada direta do dashboard): cabeçalho CM_OPERACAO='003',
 * sem FILIAL_ORIGEM, sem ROMANEIO_NF_SAIDA, sem LOJA_ENTRADAS_PRODUTO, com
 * ESTOQUE_PROD1_ENT. Transferências faturadas pela matriz (origem/NF preenchidas)
 * NUNCA são tocadas — elas devem seguir o trânsito normal.
 *
 * Uso:
 *   node scripts/limpar-transitos-fake.mjs            # dry-run (só lista)
 *   node scripts/limpar-transitos-fake.mjs --apply    # aplica
 */

import sql from 'mssql';

const APPLY = process.argv.includes('--apply');

const config = {
  server: '177.92.78.250',
  database: 'LINX_PRODUCAO',
  user: 'andre.sabetta',
  password: 'asabetta',
  port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
  connectionTimeout: 30000,
};

const FILTER = `
  EXISTS (SELECT 1 FROM ESTOQUE_PROD_ENT h WITH (NOLOCK)
          WHERE h.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND h.FILIAL = le.FILIAL AND h.CM_OPERACAO = '003')
  AND ISNULL(LTRIM(RTRIM(le.FILIAL_ORIGEM)), '') = ''
  AND ISNULL(LTRIM(RTRIM(le.ROMANEIO_NF_SAIDA)), '') = ''
  AND ISNULL(le.ENTRADA_ENCERRADA, 0) = 1
  AND ISNULL(le.ENTRADA_CANCELADA, 0) = 0
  AND (le.STATUS_TRANSITO IS NULL OR le.STATUS_TRANSITO < 4)
  AND ISNULL(le.ENTRADA_CONFERIDA, 0) = 0
  AND NOT EXISTS (SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
                  WHERE lep.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND lep.FILIAL = le.FILIAL)
  AND EXISTS (SELECT 1 FROM ESTOQUE_PROD1_ENT e WITH (NOLOCK)
              WHERE e.ROMANEIO_PRODUTO = le.ROMANEIO_PRODUTO AND e.FILIAL = le.FILIAL)`;

async function q(pool, text) { return (await pool.request().query(text)).recordset; }

async function main() {
  console.log('═'.repeat(78));
  console.log(`LIMPEZA DE TRÂNSITOS FAKE — modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (sem alterar)'}`);
  console.log('═'.repeat(78));

  const pool = await sql.connect(config);

  const alvos = await q(pool, `
    SELECT LTRIM(RTRIM(le.ROMANEIO_PRODUTO)) AS ROMANEIO,
      LTRIM(RTRIM(ISNULL(le.FILIAL,''))) AS FILIAL,
      le.QTDE_TOTAL, CONVERT(VARCHAR(19), le.EMISSAO, 120) AS EMISSAO, le.RESPONSAVEL
    FROM LOJA_ENTRADAS le WITH (NOLOCK)
    WHERE ${FILTER}
    ORDER BY le.EMISSAO`);

  console.log(`\nAlvos encontrados: ${alvos.length}`);
  alvos.forEach((r, i) => console.log(`  [${i + 1}] ${r.ROMANEIO} | ${r.FILIAL} | qtd=${r.QTDE_TOTAL} | ${r.EMISSAO} | ${String(r.RESPONSAVEL || '').trim()}`));

  if (!alvos.length) { console.log('\nNada a fazer.'); await pool.close(); return; }

  // Snapshot de estoque ANTES (soma do estoque dos itens afetados) para provar que não muda
  const estoqueAntes = await q(pool, `
    SELECT ISNULL(SUM(CAST(ep.ESTOQUE AS BIGINT)), 0) AS TOTAL
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    WHERE EXISTS (
      SELECT 1 FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
      JOIN LOJA_ENTRADAS le WITH (NOLOCK)
        ON le.ROMANEIO_PRODUTO = i.ROMANEIO_PRODUTO AND le.FILIAL = i.FILIAL
      WHERE ${FILTER}
        AND i.PRODUTO = ep.PRODUTO
        AND ISNULL(i.COR_PRODUTO,'') = ISNULL(ep.COR_PRODUTO,'')
        AND i.FILIAL = ep.FILIAL
    )`);
  console.log(`\nEstoque (soma dos itens afetados) ANTES: ${estoqueAntes[0].TOTAL}`);

  if (!APPLY) {
    console.log('\nDRY-RUN: nenhuma alteração feita. Rode com --apply para confirmar.');
    await pool.close();
    return;
  }

  const upd = await q(pool, `
    UPDATE le
       SET le.ENTRADA_CONFERIDA = 1,
           le.STATUS_TRANSITO = 4
      FROM LOJA_ENTRADAS le
     WHERE ${FILTER};
    SELECT @@ROWCOUNT AS AFETADAS;`);
  console.log(`\n✅ Linhas atualizadas: ${upd[0]?.AFETADAS}`);

  const estoqueDepois = await q(pool, `
    SELECT ISNULL(SUM(CAST(ep.ESTOQUE AS BIGINT)), 0) AS TOTAL
    FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
    WHERE EXISTS (
      SELECT 1 FROM ESTOQUE_PROD1_ENT i WITH (NOLOCK)
      WHERE i.PRODUTO = ep.PRODUTO
        AND ISNULL(i.COR_PRODUTO,'') = ISNULL(ep.COR_PRODUTO,'')
        AND i.FILIAL = ep.FILIAL
        AND i.ROMANEIO_PRODUTO IN (${alvos.map((a) => `'${a.ROMANEIO}'`).join(',')})
    )`);
  console.log(`Estoque (soma dos itens afetados) DEPOIS: ${estoqueDepois[0].TOTAL}  (deve ser igual ao ANTES)`);

  const restantes = await q(pool, `SELECT COUNT(*) AS TOTAL FROM LOJA_ENTRADAS le WITH (NOLOCK) WHERE ${FILTER}`);
  console.log(`Presas restantes: ${restantes[0].TOTAL}  (esperado 0)`);

  await pool.close();
  console.log(`\n${'═'.repeat(78)}\nCONCLUÍDO\n${'═'.repeat(78)}`);
}

main().catch((err) => { console.error('\nERRO FATAL:', err.message); process.exit(1); });

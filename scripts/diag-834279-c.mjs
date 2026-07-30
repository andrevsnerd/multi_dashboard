/**
 * (read-only) Parte 3: confirma a aritmética do trigger de DELETE de SAÍDA e mede o
 * impacto nos outros romaneios excluídos "com retorno de estoque" (mesma rotina).
 */
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
  requestTimeout: 300000, connectionTimeout: 30000,
};
const q = async (pool, text) => (await pool.request().query(text)).recordset;
const head = (t) => console.log(`\n${'═'.repeat(96)}\n${t}\n${'═'.repeat(96)}`);
async function connect() {
  let last;
  for (const server of [env.DB_SERVER, '189.126.197.82']) {
    try { const p = await sql.connect({ ...base, server }); console.log(`✅ ${server}`); return p; }
    catch (e) { console.log(`❌ ${server}: ${e.message}`); last = e; }
  }
  throw last;
}

/** Razão reconstruído (mesmas fontes do Extrato) de um item numa filial. */
async function ledgerItem(pool, produto, cor, filial) {
  const P = produto.replace(/'/g, "''"), C = cor.replace(/'/g, "''"), F = filial.replace(/'/g, "''");
  const r = (await q(pool, `
    DECLARE @P VARCHAR(50) = '${P}', @C VARCHAR(20) = '${C}', @F VARCHAR(100) = '${F}';
    SELECT
      (SELECT ISNULL(SUM(ISNULL(p.QTDE,0)),0) FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
         JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        WHERE LTRIM(RTRIM(p.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND LTRIM(RTRIM(e.FILIAL))=@F) AS ENT,
      (SELECT ISNULL(SUM(ISNULL(p.QTDE,0)),0) FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
         JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
        WHERE LTRIM(RTRIM(p.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND LTRIM(RTRIM(s.FILIAL))=@F) AS SAI,
      (SELECT ISNULL(SUM(ISNULL(lep.QTDE_ENTRADA,0)),0) FROM LOJA_ENTRADAS le WITH (NOLOCK)
         JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK) ON le.FILIAL=lep.FILIAL AND le.ROMANEIO_PRODUTO=lep.ROMANEIO_PRODUTO
        WHERE LTRIM(RTRIM(lep.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(lep.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND LTRIM(RTRIM(le.FILIAL))=@F) AS LOJA_ENT,
      (SELECT ISNULL(SUM(ISNULL(lsp.QTDE_SAIDA,0)),0) FROM LOJA_SAIDAS ls WITH (NOLOCK)
         JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK) ON ls.FILIAL=lsp.FILIAL AND ls.ROMANEIO_PRODUTO=lsp.ROMANEIO_PRODUTO
        WHERE LTRIM(RTRIM(lsp.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(lsp.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND LTRIM(RTRIM(ls.FILIAL))=@F) AS LOJA_SAI,
      (SELECT ISNULL(SUM(ISNULL(vp.QTDE,0)-ISNULL(vp.QTDE_CANCELADA,0)),0) FROM LOJA_VENDA v WITH (NOLOCK)
         JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK) ON v.CODIGO_FILIAL=vp.CODIGO_FILIAL AND v.TICKET=vp.TICKET
         JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL=vp.CODIGO_FILIAL
        WHERE LTRIM(RTRIM(vp.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(vp.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE,0)=0 AND LTRIM(RTRIM(f.FILIAL))=@F) AS VENDA,
      (SELECT ISNULL(SUM(ISNULL(ct.QTDE_AJUSTE,0)),0) FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
         JOIN ESTOQUE_PROD_CTG_AJUSTE ct WITH (NOLOCK) ON c.NOME_CONTAGEM=ct.NOME_CONTAGEM
        WHERE LTRIM(RTRIM(ct.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(ct.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND c.ESTOQUE_AJUSTADO=1 AND LTRIM(RTRIM(c.FILIAL))=@F) AS CONTAGEM,
      (SELECT ISNULL(SUM(ISNULL(ep.ESTOQUE,0)),0) FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ep.PRODUTO))=@P AND ISNULL(LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))),'')=@C
          AND LTRIM(RTRIM(ep.FILIAL))=@F) AS ESTOQUE
  `))[0];
  return { ledger: r.ENT - r.SAI + r.LOJA_ENT - r.LOJA_SAI - r.VENDA + r.CONTAGEM, estoque: r.ESTOQUE };
}

async function main() {
  const pool = await connect();

  head('A) LXD_ESTOQUE_PROD1_SAI — sinal do @nEstoque no DELETE de saída');
  const defS = (await q(pool, `
    SELECT m.definition FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
    WHERE o.name = 'LXD_ESTOQUE_PROD1_SAI'`))[0].definition.split(/\r?\n/);
  defS.forEach((l, i) => {
    if (/SUM\(SA_1\)|SET ESTOQUE|ESTOQUE = ESTOQUE/i.test(l)) {
      console.log(`${String(i + 1).padStart(4)}: ${l.replace(/\t/g, ' ').trim()}`);
    }
  });

  head('B) Impacto por romaneio excluído com retorno de estoque');
  const romaneios = await q(pool, `
    SELECT ROMANEIO_REF, TIPO_AJUSTE, FILIAL, COUNT(*) AS ITENS
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    WHERE TIPO_AJUSTE LIKE 'EXCLUSAO_ROMANEIO%'
    GROUP BY ROMANEIO_REF, TIPO_AJUSTE, FILIAL
    ORDER BY MIN(DATA_AJUSTE)`);

  const resumo = [];
  const detalhe834279 = [];
  const detalhe833191 = [];
  for (const rom of romaneios) {
    const itens = await q(pool, `
      SELECT PRODUTO, COR_PRODUTO, QTDE_AJUSTE FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ROMANEIO_REF)) = '${String(rom.ROMANEIO_REF).trim()}'
        AND TIPO_AJUSTE = '${rom.TIPO_AJUSTE}'
        AND FILIAL = '${String(rom.FILIAL).replace(/'/g, "''")}'
      ORDER BY PRODUTO, COR_PRODUTO`);
    let bate = 0, negativos = 0, somaDiff = 0, somaAjuste = 0;
    for (const it of itens) {
      const P = String(it.PRODUTO).trim(), C = String(it.COR_PRODUTO ?? '').trim();
      const { ledger, estoque } = await ledgerItem(pool, P, C, String(rom.FILIAL).trim());
      const diff = estoque - ledger;
      if (diff === it.QTDE_AJUSTE) bate++;
      if (estoque < 0) negativos++;
      somaDiff += diff; somaAjuste += it.QTDE_AJUSTE;
      const linha = {
        PRODUTO: P, COR: C, AJUSTE: it.QTDE_AJUSTE, LEDGER: ledger, ESTOQUE: estoque,
        DIFF: diff, CORRIGIDO: estoque - it.QTDE_AJUSTE,
      };
      if (String(rom.ROMANEIO_REF).trim() === '833191') detalhe833191.push(linha);
      if (String(rom.ROMANEIO_REF).trim() === '834279') detalhe834279.push(linha);
    }
    resumo.push({
      ROMANEIO: String(rom.ROMANEIO_REF).trim(),
      TIPO: rom.TIPO_AJUSTE.replace('EXCLUSAO_ROMANEIO_', ''),
      FILIAL: String(rom.FILIAL).trim(),
      ITENS: itens.length,
      SOMA_AJUSTE: somaAjuste,
      DIFF_TOTAL: somaDiff,
      ITENS_COM_DIFF_IGUAL_AJUSTE: `${bate}/${itens.length}`,
      NEGATIVOS_HOJE: negativos,
    });
  }
  console.table(resumo);

  head('C) 833191 (NERD CENTER NORTE) — detalhe: quanto falta devolver por item');
  console.table(detalhe833191);

  head('D) 834279 (NERD) — estoque corrigido proposto (ESTOQUE - QTDE_AJUSTE)');
  console.table(detalhe834279);

  await pool.close();
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

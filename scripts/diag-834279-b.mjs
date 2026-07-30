/**
 * (read-only) Parte 2 da investigação do romaneio 834279:
 *  - confirma a aritmética do trigger LXD_ESTOQUE_PROD1_ENT (delete devolve/desconta?)
 *  - reconstrói o razão (ledger) de cada item ajustado na filial NERD a partir das
 *    mesmas fontes do Extrato de Produto e compara com ESTOQUE_PRODUTOS
 *  - lista todos os outros romaneios excluídos "com retorno de estoque"
 */
import sql from 'mssql';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('c:/NERD/multi_dashboard/.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => /^DB_/.test(l))
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

async function main() {
  const pool = await connect();

  head('A) LXD_ESTOQUE_PROD1_ENT — como o @nEstoque é montado e aplicado (linhas 140..200)');
  const def = (await q(pool, `
    SELECT m.definition FROM sys.sql_modules m
    JOIN sys.objects o ON o.object_id = m.object_id
    WHERE o.name = 'LXD_ESTOQUE_PROD1_ENT'`))[0].definition.split(/\r?\n/);
  def.slice(138, 200).forEach((l, i) => console.log(`${String(i + 139).padStart(4)}: ${l.replace(/\t/g, ' ').trimEnd()}`));

  head('B) Razão reconstruído por item (filial NERD) vs ESTOQUE_PRODUTOS');
  const ajustes = await q(pool, `
    SELECT PRODUTO, COR_PRODUTO, QTDE_AJUSTE
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_REF)) = '834279'
    ORDER BY PRODUTO, COR_PRODUTO`);

  const rows = [];
  for (const a of ajustes) {
    const P = String(a.PRODUTO).trim().replace(/'/g, "''");
    const C = String(a.COR_PRODUTO ?? '').trim().replace(/'/g, "''");
    const r = (await q(pool, `
      DECLARE @P VARCHAR(50) = '${P}', @C VARCHAR(20) = '${C}', @F VARCHAR(100) = 'NERD';
      SELECT
        (SELECT ISNULL(SUM(ISNULL(p.QTDE,0)),0)
           FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
           JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK) ON e.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
          WHERE LTRIM(RTRIM(p.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND LTRIM(RTRIM(e.FILIAL)) = @F) AS ENT,
        (SELECT ISNULL(SUM(ISNULL(p.QTDE,0)),0)
           FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
           JOIN ESTOQUE_PROD1_SAI p WITH (NOLOCK) ON s.ROMANEIO_PRODUTO = p.ROMANEIO_PRODUTO
          WHERE LTRIM(RTRIM(p.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(p.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND LTRIM(RTRIM(s.FILIAL)) = @F) AS SAI,
        (SELECT ISNULL(SUM(ISNULL(lep.QTDE_ENTRADA,0)),0)
           FROM LOJA_ENTRADAS le WITH (NOLOCK)
           JOIN LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
             ON le.FILIAL = lep.FILIAL AND le.ROMANEIO_PRODUTO = lep.ROMANEIO_PRODUTO
          WHERE LTRIM(RTRIM(lep.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(lep.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND LTRIM(RTRIM(le.FILIAL)) = @F) AS LOJA_ENT,
        (SELECT ISNULL(SUM(ISNULL(lsp.QTDE_SAIDA,0)),0)
           FROM LOJA_SAIDAS ls WITH (NOLOCK)
           JOIN LOJA_SAIDAS_PRODUTO lsp WITH (NOLOCK)
             ON ls.FILIAL = lsp.FILIAL AND ls.ROMANEIO_PRODUTO = lsp.ROMANEIO_PRODUTO
          WHERE LTRIM(RTRIM(lsp.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(lsp.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND LTRIM(RTRIM(ls.FILIAL)) = @F) AS LOJA_SAI,
        (SELECT ISNULL(SUM(ISNULL(vp.QTDE,0) - ISNULL(vp.QTDE_CANCELADA,0)),0)
           FROM LOJA_VENDA v WITH (NOLOCK)
           JOIN LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
             ON v.CODIGO_FILIAL = vp.CODIGO_FILIAL AND v.TICKET = vp.TICKET
           JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL = vp.CODIGO_FILIAL
          WHERE LTRIM(RTRIM(vp.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(vp.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND ISNULL(vp.NAO_MOVIMENTA_ESTOQUE,0) = 0
            AND LTRIM(RTRIM(f.FILIAL)) = @F) AS VENDA,
        (SELECT ISNULL(SUM(ISNULL(ct.QTDE_AJUSTE,0)),0)
           FROM ESTOQUE_PROD_CONTAGEM c WITH (NOLOCK)
           JOIN ESTOQUE_PROD_CTG_AJUSTE ct WITH (NOLOCK) ON c.NOME_CONTAGEM = ct.NOME_CONTAGEM
          WHERE LTRIM(RTRIM(ct.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(ct.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND c.ESTOQUE_AJUSTADO = 1 AND LTRIM(RTRIM(c.FILIAL)) = @F) AS CONTAGEM,
        (SELECT ISNULL(SUM(ISNULL(ep.ESTOQUE,0)),0)
           FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ep.PRODUTO)) = @P AND ISNULL(LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20)))),'') = @C
            AND LTRIM(RTRIM(ep.FILIAL)) = @F) AS ESTOQUE_ATUAL,
        (SELECT MAX(pr.DESC_PRODUTO) FROM PRODUTOS pr WITH (NOLOCK) WHERE LTRIM(RTRIM(pr.PRODUTO)) = @P) AS DESCR
    `))[0];
    const ledger = r.ENT - r.SAI + r.LOJA_ENT - r.LOJA_SAI - r.VENDA + r.CONTAGEM;
    rows.push({
      PRODUTO: String(a.PRODUTO).trim(),
      COR: String(a.COR_PRODUTO ?? '').trim(),
      DESCR: (r.DESCR || '').trim().slice(0, 28),
      AJUSTE: a.QTDE_AJUSTE,
      LEDGER: ledger,
      ESTOQUE: r.ESTOQUE_ATUAL,
      DIFF: r.ESTOQUE_ATUAL - ledger,
      BATE_AJUSTE: r.ESTOQUE_ATUAL - ledger === a.QTDE_AJUSTE ? 'SIM' : '—',
    });
  }
  console.table(rows);
  const iguais = rows.filter((r) => r.BATE_AJUSTE === 'SIM').length;
  const negativos = rows.filter((r) => r.ESTOQUE < 0).length;
  console.log(`\nitens: ${rows.length} | DIFF == QTDE_AJUSTE em ${iguais} | DIFF == 0 em ${rows.filter(r => r.DIFF === 0).length} | estoque negativo hoje: ${negativos}`);
  console.log(`soma |AJUSTE|: ${rows.reduce((s, r) => s + Math.abs(r.AJUSTE), 0)} | soma DIFF: ${rows.reduce((s, r) => s + r.DIFF, 0)}`);

  head('C) Todos os romaneios já excluídos "com retorno de estoque" (mesma rotina)');
  const outros = await q(pool, `
    SELECT ROMANEIO_REF, TIPO_AJUSTE, FILIAL, MIN(DATA_AJUSTE) AS QUANDO,
           COUNT(*) AS ITENS, SUM(QTDE_AJUSTE) AS SOMA_QTDE, MAX(RESPONSAVEL) AS RESP
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    WHERE TIPO_AJUSTE LIKE 'EXCLUSAO_ROMANEIO%'
    GROUP BY ROMANEIO_REF, TIPO_AJUSTE, FILIAL
    ORDER BY MIN(DATA_AJUSTE)`);
  console.table(outros.map((r) => ({
    ROMANEIO: r.ROMANEIO_REF, TIPO: r.TIPO_AJUSTE, FILIAL: r.FILIAL,
    QUANDO: r.QUANDO?.toISOString?.().slice(0, 19), ITENS: r.ITENS, SOMA: r.SOMA_QTDE, RESP: r.RESP,
  })));

  head('D) Outros tipos de ajuste registrados (contexto)');
  const tipos = await q(pool, `
    SELECT TIPO_AJUSTE, COUNT(*) AS N, MIN(DATA_AJUSTE) AS DE, MAX(DATA_AJUSTE) AS ATE
    FROM NERD_AJUSTE_HISTORICO WITH (NOLOCK)
    GROUP BY TIPO_AJUSTE ORDER BY N DESC`);
  console.table(tipos.map((r) => ({
    TIPO: r.TIPO_AJUSTE, N: r.N,
    DE: r.DE?.toISOString?.().slice(0, 10), ATE: r.ATE?.toISOString?.().slice(0, 10),
  })));

  await pool.close();
}

main().catch((e) => { console.error('ERRO:', e.message); process.exit(1); });

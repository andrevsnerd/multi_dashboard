/**
 * Verificação Produto Giro — subgrupo VISCOSE (PASHMINA), scarfme.
 * Prova: (a) QTDE e VENDAS líquidas do PERÍODO 01–22/07/2026, (b) compara com janelas maiores
 * (365d e todo o histórico) pra ver se R$74k é período ou histórico, (c) soma por dia.
 * Usa a MESMA lógica canônica: POS (LOJA_VENDA_PRODUTO com trocas) + e-commerce (FATURAMENTO).
 *
 * Uso: node scripts/verif-produto-giro-viscose.mjs
 */
import sql from "mssql";

const config = {
  server: "177.92.78.250",
  database: "LINX_PRODUCAO",
  user: "andre.sabetta",
  password: "asabetta",
  port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000,
  connectionTimeout: 30000,
};

const SUBGRUPO_LIKE = "%VISCOSE%PASHMINA%";
const PERIODO_START = "2026-07-01";
const PERIODO_END_EXCL = "2026-07-23"; // < 23 → inclui até 22/07

// POS líquido (venda − trocas item − trocas puras), agregado, filtrado por subgrupo + janela.
function posSql(startExcl, endExcl) {
  return `
    WITH vendas AS (
      SELECT SUM(vp.QTDE) AS Q,
             SUM(vp.QTDE * vp.PRECO_LIQUIDO - vp.QTDE * vp.PRECO_LIQUIDO * ISNULL(vp.FATOR_DESCONTO_VENDA,0)) AS V
      FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
      INNER JOIN LOJA_VENDA lv WITH (NOLOCK) ON lv.CODIGO_FILIAL = vp.CODIGO_FILIAL AND lv.TICKET = vp.TICKET
      INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vp.PRODUTO
      WHERE vp.DATA_VENDA >= '${startExcl}' AND vp.DATA_VENDA < '${endExcl}'
        AND ISNULL(vp.QTDE_CANCELADA,0) = 0
        AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUBGRUPO_LIKE}'
    ),
    trocas AS (
      SELECT SUM(vt.QTDE) AS Q, SUM(vt.PRECO_LIQUIDO * vt.QTDE) AS V
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA lv WITH (NOLOCK) ON lv.CODIGO_FILIAL = vt.CODIGO_FILIAL AND lv.TICKET = vt.TICKET
      INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = vt.PRODUTO
      WHERE lv.DATA_VENDA >= '${startExcl}' AND lv.DATA_VENDA < '${endExcl}'
        AND vt.QTDE_CANCELADA = 0
        AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUBGRUPO_LIKE}'
    )
    SELECT
      ISNULL((SELECT Q FROM vendas),0) AS VQ,
      ISNULL((SELECT V FROM vendas),0) AS VV,
      ISNULL((SELECT Q FROM trocas),0) AS TQ,
      ISNULL((SELECT V FROM trocas),0) AS TV,
      ISNULL((SELECT Q FROM vendas),0) - ISNULL((SELECT Q FROM trocas),0) AS NETQ,
      ISNULL((SELECT V FROM vendas),0) - ISNULL((SELECT V FROM trocas),0) AS NETV
  `;
}

// E-commerce (scarfme): FATURAMENTO + W_FATURAMENTO_PROD_02, natureza 100.02/100.022, não cancelada.
function ecomSql(start, endExcl) {
  return `
    SELECT SUM(fp.QTDE) AS Q, SUM(fp.VALOR_LIQUIDO) AS V
    FROM FATURAMENTO fa WITH (NOLOCK)
    INNER JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
      ON fa.FILIAL = fp.FILIAL AND fa.NF_SAIDA = fp.NF_SAIDA AND fa.SERIE_NF = fp.SERIE_NF
    INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = fp.PRODUTO
    WHERE CAST(fa.EMISSAO AS DATE) >= CAST('${start}' AS DATE) AND CAST(fa.EMISSAO AS DATE) < CAST('${endExcl}' AS DATE)
      AND ISNULL(fa.NOTA_CANCELADA,0) = 0
      AND fa.NATUREZA_SAIDA IN ('100.02','100.022')
      AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUBGRUPO_LIKE}'
  `;
}

const brl = (n) => Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const num = (n) => Number(n ?? 0).toLocaleString("pt-BR");

async function one(pool, sqlText) {
  const r = await pool.request().query(sqlText);
  return r.recordset[0] ?? {};
}

async function main() {
  const pool = await sql.connect(config);

  console.log("═".repeat(72));
  console.log(`VERIFICAÇÃO — subgrupo LIKE '${SUBGRUPO_LIKE}'  (scarfme)`);
  console.log("═".repeat(72));

  // 0. Confirma o(s) subgrupo(s) e nº de produtos
  const subs = await pool.request().query(
    `SELECT DISTINCT SUBGRUPO_PRODUTO AS SUBGRUPO, COUNT(*) AS N FROM PRODUTOS WITH (NOLOCK)
     WHERE UPPER(LTRIM(RTRIM(ISNULL(SUBGRUPO_PRODUTO,'')))) LIKE '${SUBGRUPO_LIKE}'
     GROUP BY SUBGRUPO_PRODUTO`
  );
  console.log("\nSubgrupos batidos:");
  subs.recordset.forEach((s) => console.log(`  • "${s.SUBGRUPO}"  (${s.N} produtos)`));

  // 1. PERÍODO 01–22/07
  const posP = await one(pool, posSql(PERIODO_START, PERIODO_END_EXCL));
  const ecomP = await one(pool, ecomSql(PERIODO_START, PERIODO_END_EXCL));
  const periodoQ = Number(posP.NETQ) + Number(ecomP.Q ?? 0);
  const periodoV = Number(posP.NETV) + Number(ecomP.V ?? 0);

  console.log("\n" + "─".repeat(72));
  console.log("① PERÍODO 01/07 → 22/07/2026 (o que a tela DEVE mostrar):");
  console.log(`   POS      : Q=${num(posP.NETQ)}  V=${brl(posP.NETV)}   (bruto Q=${num(posP.VQ)} V=${brl(posP.VV)} − trocas Q=${num(posP.TQ)} V=${brl(posP.TV)})`);
  console.log(`   E-comm   : Q=${num(ecomP.Q)}  V=${brl(ecomP.V)}`);
  console.log(`   >>> REDE : Q=${num(periodoQ)}  V=${brl(periodoV)}`);

  // 2. Janela 365 dias (até 22/07)
  const posY = await one(pool, posSql("2025-07-23", PERIODO_END_EXCL));
  const ecomY = await one(pool, ecomSql("2025-07-23", PERIODO_END_EXCL));
  console.log("\n② ÚLTIMOS 365 DIAS (23/07/2025 → 22/07/2026):");
  console.log(`   >>> REDE : Q=${num(Number(posY.NETQ) + Number(ecomY.Q ?? 0))}  V=${brl(Number(posY.NETV) + Number(ecomY.V ?? 0))}`);

  // 3. Histórico total
  const posAll = await one(pool, posSql("2000-01-01", PERIODO_END_EXCL));
  const ecomAll = await one(pool, ecomSql("2000-01-01", PERIODO_END_EXCL));
  console.log("\n③ HISTÓRICO TOTAL (tudo até 22/07/2026):");
  console.log(`   >>> REDE : Q=${num(Number(posAll.NETQ) + Number(ecomAll.Q ?? 0))}  V=${brl(Number(posAll.NETV) + Number(ecomAll.V ?? 0))}`);

  // 4. Soma dia a dia do período (deve bater com ①)
  let sumDiaQ = 0, sumDiaV = 0;
  const dias = [];
  for (let d = 1; d <= 22; d++) {
    const day = `2026-07-${String(d).padStart(2, "0")}`;
    const nextRaw = new Date(Date.UTC(2026, 6, d + 1));
    const next = nextRaw.toISOString().slice(0, 10);
    const pos = await one(pool, posSql(day, next));
    const ecom = await one(pool, ecomSql(day, next));
    const q = Number(pos.NETQ) + Number(ecom.Q ?? 0);
    const v = Number(pos.NETV) + Number(ecom.V ?? 0);
    sumDiaQ += q; sumDiaV += v;
    dias.push(`${String(d).padStart(2, "0")}/07: Q=${q} V=${Math.round(v)}`);
  }
  console.log("\n④ SOMA DIA-A-DIA do período (deve = ①):");
  console.log("   " + dias.join("  |  "));
  console.log(`   >>> SOMA : Q=${num(sumDiaQ)}  V=${brl(sumDiaV)}`);

  console.log("\n" + "═".repeat(72));
  console.log("CONCLUSÃO:");
  console.log(`  A tela mostra ~R$74.4k / 265 un.`);
  console.log(`  Período ① = ${brl(periodoV)} / ${num(periodoQ)} un`);
  console.log(`  365d   ② = ${brl(Number(posY.NETV) + Number(ecomY.V ?? 0))}`);
  console.log(`  Total  ③ = ${brl(Number(posAll.NETV) + Number(ecomAll.V ?? 0))}`);
  console.log("═".repeat(72));

  await pool.close();
}

main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });

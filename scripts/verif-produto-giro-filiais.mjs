/**
 * Verificação: VENDAS POR FILIAL — subgrupo VISCOSE (PASHMINA), scarfme, 01–22/07/2026.
 * Prova que a soma das filiais + e-commerce = R$74.385,25 (o total do período).
 */
import sql from "mssql";

const config = {
  server: "177.92.78.250", database: "LINX_PRODUCAO",
  user: "andre.sabetta", password: "asabetta", port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 120000, connectionTimeout: 30000,
};
const SUB = "%VISCOSE%PASHMINA%";
const S = "2026-07-01", E = "2026-07-23";
const brl = (n) => Number(n ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function main() {
  const pool = await sql.connect(config);

  // POS líquido por FILIAL (venda − trocas), agregado.
  const pos = await pool.request().query(`
    WITH v AS (
      SELECT f.FILIAL, SUM(vp.QTDE) AS Q,
             SUM(vp.QTDE*vp.PRECO_LIQUIDO - vp.QTDE*vp.PRECO_LIQUIDO*ISNULL(vp.FATOR_DESCONTO_VENDA,0)) AS V
      FROM LOJA_VENDA_PRODUTO vp WITH (NOLOCK)
      INNER JOIN LOJA_VENDA lv WITH (NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
      INNER JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL=vp.CODIGO_FILIAL
      INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=vp.PRODUTO
      WHERE vp.DATA_VENDA>='${S}' AND vp.DATA_VENDA<'${E}' AND ISNULL(vp.QTDE_CANCELADA,0)=0
        AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'
      GROUP BY f.FILIAL
    ),
    t AS (
      SELECT f.FILIAL, SUM(vt.QTDE) AS Q, SUM(vt.PRECO_LIQUIDO*vt.QTDE) AS V
      FROM LOJA_VENDA_TROCA vt WITH (NOLOCK)
      INNER JOIN LOJA_VENDA lv WITH (NOLOCK) ON lv.CODIGO_FILIAL=vt.CODIGO_FILIAL AND lv.TICKET=vt.TICKET
      INNER JOIN FILIAIS f WITH (NOLOCK) ON f.COD_FILIAL=vt.CODIGO_FILIAL
      INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=vt.PRODUTO
      WHERE lv.DATA_VENDA>='${S}' AND lv.DATA_VENDA<'${E}' AND vt.QTDE_CANCELADA=0
        AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'
      GROUP BY f.FILIAL
    )
    SELECT COALESCE(v.FILIAL, t.FILIAL) AS FILIAL,
           ISNULL(v.Q,0) - ISNULL(t.Q,0) AS Q,
           ISNULL(v.V,0) - ISNULL(t.V,0) AS V
    FROM v FULL OUTER JOIN t ON t.FILIAL=v.FILIAL
    ORDER BY V DESC
  `);

  const ecom = await pool.request().query(`
    SELECT SUM(fp.QTDE) AS Q, SUM(fp.VALOR_LIQUIDO) AS V
    FROM FATURAMENTO fa WITH (NOLOCK)
    INNER JOIN W_FATURAMENTO_PROD_02 fp WITH (NOLOCK)
      ON fa.FILIAL=fp.FILIAL AND fa.NF_SAIDA=fp.NF_SAIDA AND fa.SERIE_NF=fp.SERIE_NF
    INNER JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO=fp.PRODUTO
    WHERE CAST(fa.EMISSAO AS DATE)>=CAST('${S}' AS DATE) AND CAST(fa.EMISSAO AS DATE)<CAST('${E}' AS DATE)
      AND ISNULL(fa.NOTA_CANCELADA,0)=0 AND fa.NATUREZA_SAIDA IN ('100.02','100.022')
      AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'
  `);

  const rows = pos.recordset.map((r) => ({ filial: r.FILIAL.trim(), q: Number(r.Q), v: Number(r.V) }));
  const ecomV = Number(ecom.recordset[0]?.V ?? 0), ecomQ = Number(ecom.recordset[0]?.Q ?? 0);
  const total = rows.reduce((s, r) => s + r.v, 0) + ecomV;

  console.log("═".repeat(64));
  console.log("VENDAS POR FILIAL — VISCOSE (PASHMINA), 01–22/07/2026");
  console.log("═".repeat(64));
  rows.forEach((r) => console.log(`  ${r.filial.padEnd(34)} ${brl(r.v).padStart(14)}  ${((r.v/total)*100).toFixed(1).padStart(5)}%  (${r.q} un)`));
  console.log(`  ${"E-COMMERCE".padEnd(34)} ${brl(ecomV).padStart(14)}  ${((ecomV/total)*100).toFixed(1).padStart(5)}%  (${ecomQ} un)`);
  console.log("─".repeat(64));
  console.log(`  ${"TOTAL".padEnd(34)} ${brl(total).padStart(14)}  100.0%`);
  console.log("═".repeat(64));

  await pool.close();
}
main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });

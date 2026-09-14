import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:300000 };
const P = "45.14.0042";
const POS = ["000079","000059","000055","000062","000038","000088","000046","000112","000117","000085","000109"];
const ECOM = ["000108","000083","000082","000111","000118"];
const inList = (a)=>a.map(x=>`'${x}'`).join(",");
const pool = await sql.connect(config);

const q = `
WITH v AS (
  SELECT FORMAT(vp.DATA_VENDA,'yyyy-MM') M, ISNULL(vp.COR_PRODUTO,'') COR, SUM(vp.QTDE) Q
  FROM LOJA_VENDA_PRODUTO vp WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
  WHERE vp.PRODUTO='${P}' AND ISNULL(vp.QTDE_CANCELADA,0)=0
    AND vp.CODIGO_FILIAL IN (${inList(POS)})
    AND vp.DATA_VENDA>='2022-01-01'
  GROUP BY FORMAT(vp.DATA_VENDA,'yyyy-MM'), ISNULL(vp.COR_PRODUTO,'')
), t AS (
  SELECT FORMAT(lv.DATA_VENDA,'yyyy-MM') M, ISNULL(vt.COR_PRODUTO,'') COR, SUM(vt.QTDE) Q
  FROM LOJA_VENDA_TROCA vt WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vt.CODIGO_FILIAL AND lv.TICKET=vt.TICKET
  WHERE vt.PRODUTO='${P}' AND vt.QTDE_CANCELADA=0
    AND vt.CODIGO_FILIAL IN (${inList(POS)})
    AND lv.DATA_VENDA>='2022-01-01'
  GROUP BY FORMAT(lv.DATA_VENDA,'yyyy-MM'), ISNULL(vt.COR_PRODUTO,'')
), e AS (
  SELECT FORMAT(fa.EMISSAO,'yyyy-MM') M, ISNULL(fp.COR_PRODUTO,'') COR, SUM(fp.QTDE) Q
  FROM FATURAMENTO fa WITH(NOLOCK)
  INNER JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) ON fa.FILIAL=fp.FILIAL AND fa.NF_SAIDA=fp.NF_SAIDA AND fa.SERIE_NF=fp.SERIE_NF
  WHERE fp.PRODUTO='${P}' AND ISNULL(fa.NOTA_CANCELADA,0)=0 AND fa.NATUREZA_SAIDA IN ('100.02','100.022')
    AND fa.FILIAL IN (${inList(ECOM)}) AND fa.EMISSAO>='2022-01-01'
  GROUP BY FORMAT(fa.EMISSAO,'yyyy-MM'), ISNULL(fp.COR_PRODUTO,'')
)
SELECT M, COR, SUM(Q) Q FROM (
  SELECT M,COR,Q FROM v UNION ALL SELECT M,COR,-Q FROM t UNION ALL SELECT M,COR,Q FROM e
) x GROUP BY M,COR ORDER BY M,COR`;
const r = await pool.request().query(q);
const byCor = {};
r.recordset.forEach(({M,COR,Q})=>{ const c=(COR||'').trim(); (byCor[c] ||= {})[M]=Number(Q); });
const meses = [...new Set(r.recordset.map(x=>x.M))].sort();
console.log("cores:", Object.keys(byCor).join(" | "));
const anos = [...new Set(meses.map(m=>m.slice(0,4)))].sort();
for (const c of Object.keys(byCor)) {
  console.log("\n=== COR", c, "===");
  for (const a of anos) {
    const row = [];
    let tot=0;
    for (let m=1;m<=12;m++){ const k=`${a}-${String(m).padStart(2,'0')}`; const v=byCor[c][k]??0; tot+=v; row.push(String(v).padStart(4)); }
    console.log(a, row.join(""), " | tot", tot);
  }
}
// total do produto
console.log("\n=== PRODUTO TODO ===");
for (const a of anos) {
  const row=[]; let tot=0;
  for (let m=1;m<=12;m++){ const k=`${a}-${String(m).padStart(2,'0')}`; let v=0; for(const c of Object.keys(byCor)) v+=byCor[c][k]??0; tot+=v; row.push(String(v).padStart(4)); }
  console.log(a, row.join(""), " | tot", tot);
}
await pool.close();

import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:300000 };
const SUB = "MOUSSELINE DE POLIESTER";
const POS = ["000079","000059","000055","000062","000038","000088","000046","000112","000117","000085","000109"];
const ECOM = ["000108","000083","000082","000111","000118"];
const inList = (a)=>a.map(x=>`'${x}'`).join(",");
const pool = await sql.connect(config);
const q = `
WITH v AS (
  SELECT FORMAT(vp.DATA_VENDA,'yyyy-MM') M, SUM(vp.QTDE) Q
  FROM LOJA_VENDA_PRODUTO vp WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vp.PRODUTO
  WHERE ISNULL(vp.QTDE_CANCELADA,0)=0 AND vp.CODIGO_FILIAL IN (${inList(POS)})
    AND vp.DATA_VENDA>='2022-01-01' AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,''))))='${SUB}'
  GROUP BY FORMAT(vp.DATA_VENDA,'yyyy-MM')
), t AS (
  SELECT FORMAT(lv.DATA_VENDA,'yyyy-MM') M, SUM(vt.QTDE) Q
  FROM LOJA_VENDA_TROCA vt WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vt.CODIGO_FILIAL AND lv.TICKET=vt.TICKET
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vt.PRODUTO
  WHERE vt.QTDE_CANCELADA=0 AND vt.CODIGO_FILIAL IN (${inList(POS)})
    AND lv.DATA_VENDA>='2022-01-01' AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,''))))='${SUB}'
  GROUP BY FORMAT(lv.DATA_VENDA,'yyyy-MM')
), e AS (
  SELECT FORMAT(fa.EMISSAO,'yyyy-MM') M, SUM(fp.QTDE) Q
  FROM FATURAMENTO fa WITH(NOLOCK)
  INNER JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) ON fa.FILIAL=fp.FILIAL AND fa.NF_SAIDA=fp.NF_SAIDA AND fa.SERIE_NF=fp.SERIE_NF
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=fp.PRODUTO
  WHERE ISNULL(fa.NOTA_CANCELADA,0)=0 AND fa.NATUREZA_SAIDA IN ('100.02','100.022')
    AND fa.FILIAL IN (${inList(ECOM)}) AND fa.EMISSAO>='2022-01-01'
    AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,''))))='${SUB}'
  GROUP BY FORMAT(fa.EMISSAO,'yyyy-MM')
)
SELECT M, SUM(Q) Q FROM (SELECT M,Q FROM v UNION ALL SELECT M,-Q FROM t UNION ALL SELECT M,Q FROM e) x
GROUP BY M ORDER BY M`;
const r = await pool.request().query(q);
const map = {}; r.recordset.forEach(({M,Q})=>map[M]=Number(Q));
const anos=[2023,2024,2025,2026];
for(const a of anos){ const row=[]; let tot=0; for(let m=1;m<=12;m++){const v=map[`${a}-${String(m).padStart(2,'0')}`]??0; tot+=v; row.push(String(v).padStart(6));} console.log(a,row.join(""),"| tot",tot); }
console.log(JSON.stringify(map));
await pool.close();

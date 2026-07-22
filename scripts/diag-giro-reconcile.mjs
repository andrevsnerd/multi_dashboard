import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:120000 };
const SUB="%VISCOSE%PASHMINA%", S="2026-07-01", E="2026-07-23";
const brl=(n)=>Number(n??0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const pool = await sql.connect(config);

// Total EXATO do período (POS líquido + ecom) e nº de item×cor com venda.
async function periodo(start,end){
  const pos = await pool.request().query(`
    WITH v AS (SELECT vp.PRODUTO, ISNULL(vp.COR_PRODUTO,'') COR, SUM(vp.QTDE) Q,
        SUM(vp.QTDE*vp.PRECO_LIQUIDO - vp.QTDE*vp.PRECO_LIQUIDO*ISNULL(vp.FATOR_DESCONTO_VENDA,0)) V
      FROM LOJA_VENDA_PRODUTO vp WITH(NOLOCK)
      INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
      INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vp.PRODUTO
      WHERE vp.DATA_VENDA>='${start}' AND vp.DATA_VENDA<'${end}' AND ISNULL(vp.QTDE_CANCELADA,0)=0
        AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'
      GROUP BY vp.PRODUTO, ISNULL(vp.COR_PRODUTO,'')),
    t AS (SELECT vt.PRODUTO, ISNULL(vt.COR_PRODUTO,'') COR, SUM(vt.QTDE) Q, SUM(vt.PRECO_LIQUIDO*vt.QTDE) V
      FROM LOJA_VENDA_TROCA vt WITH(NOLOCK)
      INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vt.CODIGO_FILIAL AND lv.TICKET=vt.TICKET
      INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vt.PRODUTO
      WHERE lv.DATA_VENDA>='${start}' AND lv.DATA_VENDA<'${end}' AND vt.QTDE_CANCELADA=0
        AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'
      GROUP BY vt.PRODUTO, ISNULL(vt.COR_PRODUTO,''))
    SELECT SUM(ISNULL(v.V,0)-ISNULL(t.V,0)) V, SUM(ISNULL(v.Q,0)-ISNULL(t.Q,0)) Q,
           COUNT(DISTINCT CONCAT(COALESCE(v.PRODUTO,t.PRODUTO),'|',COALESCE(v.COR,t.COR))) ITENS
    FROM v FULL OUTER JOIN t ON t.PRODUTO=v.PRODUTO AND t.COR=v.COR`);
  const ecom = await pool.request().query(`
    SELECT SUM(fp.VALOR_LIQUIDO) V, SUM(fp.QTDE) Q, COUNT(DISTINCT CONCAT(fp.PRODUTO,'|',ISNULL(fp.COR_PRODUTO,''))) ITENS
    FROM FATURAMENTO fa WITH(NOLOCK)
    INNER JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) ON fa.FILIAL=fp.FILIAL AND fa.NF_SAIDA=fp.NF_SAIDA AND fa.SERIE_NF=fp.SERIE_NF
    INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=fp.PRODUTO
    WHERE CAST(fa.EMISSAO AS DATE)>=CAST('${start}' AS DATE) AND CAST(fa.EMISSAO AS DATE)<CAST('${end}' AS DATE)
      AND ISNULL(fa.NOTA_CANCELADA,0)=0 AND fa.NATUREZA_SAIDA IN ('100.02','100.022')
      AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'`);
  return { V: Number(pos.recordset[0].V)+Number(ecom.recordset[0].V??0), Q: Number(pos.recordset[0].Q)+Number(ecom.recordset[0].Q??0) };
}

const p = await periodo(S,E);
let dV=0,dQ=0;
for(let d=1; d<=22; d++){
  const day=`2026-07-${String(d).padStart(2,"0")}`;
  const next=new Date(Date.UTC(2026,6,d+1)).toISOString().slice(0,10);
  const r=await periodo(day,next); dV+=r.V; dQ+=r.Q;
}
console.log("PERÍODO (1 query)      :", brl(p.V), "/", p.Q, "un");
console.log("SOMA DIA-A-DIA (exato) :", brl(dV), "/", dQ, "un");
console.log("Diferença              :", brl(p.V-dV));
await pool.close();

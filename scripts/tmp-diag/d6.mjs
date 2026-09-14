import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:300000 };
const POS=["000079","000059","000055","000062","000038","000088","000046","000112","000117","000085","000109"];
const ECOM=["000108","000083","000082","000111","000118"];
const L=a=>a.map(x=>`'${x}'`).join(",");
const pool = await sql.connect(config);
async function serie(where){
  const q=`
WITH v AS (SELECT FORMAT(vp.DATA_VENDA,'yyyy-MM') M, SUM(vp.QTDE) Q
  FROM LOJA_VENDA_PRODUTO vp WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vp.PRODUTO
  WHERE ISNULL(vp.QTDE_CANCELADA,0)=0 AND vp.CODIGO_FILIAL IN (${L(POS)}) AND vp.DATA_VENDA>='2023-01-01' AND ${where}
  GROUP BY FORMAT(vp.DATA_VENDA,'yyyy-MM')),
t AS (SELECT FORMAT(lv.DATA_VENDA,'yyyy-MM') M, SUM(vt.QTDE) Q
  FROM LOJA_VENDA_TROCA vt WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vt.CODIGO_FILIAL AND lv.TICKET=vt.TICKET
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vt.PRODUTO
  WHERE vt.QTDE_CANCELADA=0 AND vt.CODIGO_FILIAL IN (${L(POS)}) AND lv.DATA_VENDA>='2023-01-01' AND ${where}
  GROUP BY FORMAT(lv.DATA_VENDA,'yyyy-MM')),
e AS (SELECT FORMAT(fa.EMISSAO,'yyyy-MM') M, SUM(fp.QTDE) Q
  FROM FATURAMENTO fa WITH(NOLOCK)
  INNER JOIN W_FATURAMENTO_PROD_02 fp WITH(NOLOCK) ON fa.FILIAL=fp.FILIAL AND fa.NF_SAIDA=fp.NF_SAIDA AND fa.SERIE_NF=fp.SERIE_NF
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=fp.PRODUTO
  WHERE ISNULL(fa.NOTA_CANCELADA,0)=0 AND fa.NATUREZA_SAIDA IN ('100.02','100.022') AND fa.FILIAL IN (${L(ECOM)}) AND fa.EMISSAO>='2023-01-01' AND ${where}
  GROUP BY FORMAT(fa.EMISSAO,'yyyy-MM'))
SELECT M,SUM(Q) Q FROM (SELECT M,Q FROM v UNION ALL SELECT M,-Q FROM t UNION ALL SELECT M,Q FROM e) x GROUP BY M ORDER BY M`;
  const r=await pool.request().query(q); const map={}; r.recordset.forEach(({M,Q})=>map[M]=Number(Q)); return map;
}
const PESOS=[3,2,1];
function curva(map){ const anos=[2025,2024,2023].map(a=>({ano:a,meses:Array.from({length:13},(_,m)=>m===0?0:(map[`${a}-${String(m).padStart(2,'0')}`]??0))}));
  const soma=new Array(13).fill(0); let pt=0; const det=[];
  anos.forEach((e,o)=>{ let tot=0; for(let m=1;m<=12;m++) tot+=Math.max(0,e.meses[m]); const media=tot/12; const usado=tot>=12&&media>0; const peso=PESOS[o];
    if(usado){ for(let m=1;m<=12;m++){ const f=Math.max(0.2,Math.min(4,Math.max(0,e.meses[m])/media)); soma[m]+=f*peso; } pt+=peso; }
    det.push({ano:e.ano,tot,usado}); });
  if(pt===0) return {fatores:new Array(13).fill(1),det};
  const f=new Array(13).fill(1); let sf=0; for(let m=1;m<=12;m++){ f[m]=soma[m]/pt; sf+=f[m]; }
  const aj=12/sf; for(let m=1;m<=12;m++) f[m]*=aj; return {fatores:f,det};
}
const S="UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,''))))='MOUSSELINE DE POLIESTER'";
const G="UPPER(LTRIM(RTRIM(ISNULL(CONVERT(VARCHAR,p.GRADE),''))))='45X210'";
const cenarios={
  "SUBGRUPO MOUSSELINE": S,
  "SUBGRUPO + GRADE 45X210": `${S} AND ${G}`,
  "GRADE 45X210 (todos subgrupos)": G,
  "LINHA LENCOS": "UPPER(LTRIM(RTRIM(ISNULL(p.LINHA,''))))='LENÇOS'",
  "GRUPO ECHARPE": "UPPER(LTRIM(RTRIM(ISNULL(p.GRUPO_PRODUTO,''))))='ECHARPE'",
};
for(const [nome,w] of Object.entries(cenarios)){
  const m=await serie(w); const c=curva(m);
  const fatores=c.fatores;
  const pat=16.29; // patamar cor 10 se a curva fosse a MOUSSELINE (recalculado abaixo)
  // recalcula patamar da cor 10 com ESTA curva
  const reais=[0,0,0,0,0,0,17,13,9];
  const niveis=reais.map((v,m)=>m===0?0:v/(fatores[m]||1));
  const mesesAno=[6,7,8]; const media=ms=>ms.reduce((s,m)=>s+niveis[m],0)/ms.length;
  const patamar=media(mesesAno);
  const nec=patamar*(fatores[9]*17/30 + fatores[10] + fatores[11] + fatores[12]);
  console.log(`\n${nome}`);
  console.log("  fatores:", fatores.slice(1).map(x=>x.toFixed(2)).join(" "));
  console.log(`  anos usados: ${c.det.map(d=>d.ano+":"+d.tot+(d.usado?"":"(fora)")).join(" ")}`);
  console.log(`  patamar cor10=${patamar.toFixed(2)} necessidade=${nec.toFixed(1)} sugestao(est 4)=${Math.max(0,Math.ceil(nec-4))}`);
}
await pool.close();

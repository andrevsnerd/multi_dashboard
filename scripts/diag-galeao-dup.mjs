import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:120000 };
const SUB="%VISCOSE%PASHMINA%", S="2026-07-01", E="2026-07-23";
const brl=(n)=>Number(n??0).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
const pool = await sql.connect(config);

// A) total SEM join em FILIAIS
const a = await pool.request().query(`
  SELECT SUM(vp.QTDE) Q, SUM(vp.QTDE*vp.PRECO_LIQUIDO - vp.QTDE*vp.PRECO_LIQUIDO*ISNULL(vp.FATOR_DESCONTO_VENDA,0)) V
  FROM LOJA_VENDA_PRODUTO vp WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vp.PRODUTO
  WHERE vp.DATA_VENDA>='${S}' AND vp.DATA_VENDA<'${E}' AND ISNULL(vp.QTDE_CANCELADA,0)=0
    AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'`);
console.log("A) SEM FILIAIS join   :", "Q="+a.recordset[0].Q, "V="+brl(a.recordset[0].V));

// B) total COM inner join em FILIAIS
const b = await pool.request().query(`
  SELECT SUM(vp.QTDE) Q, SUM(vp.QTDE*vp.PRECO_LIQUIDO - vp.QTDE*vp.PRECO_LIQUIDO*ISNULL(vp.FATOR_DESCONTO_VENDA,0)) V
  FROM LOJA_VENDA_PRODUTO vp WITH(NOLOCK)
  INNER JOIN LOJA_VENDA lv WITH(NOLOCK) ON lv.CODIGO_FILIAL=vp.CODIGO_FILIAL AND lv.TICKET=vp.TICKET
  INNER JOIN FILIAIS f WITH(NOLOCK) ON f.COD_FILIAL=vp.CODIGO_FILIAL
  INNER JOIN PRODUTOS p WITH(NOLOCK) ON p.PRODUTO=vp.PRODUTO
  WHERE vp.DATA_VENDA>='${S}' AND vp.DATA_VENDA<'${E}' AND ISNULL(vp.QTDE_CANCELADA,0)=0
    AND UPPER(LTRIM(RTRIM(ISNULL(p.SUBGRUPO_PRODUTO,'')))) LIKE '${SUB}'`);
console.log("B) COM FILIAIS join   :", "Q="+b.recordset[0].Q, "V="+brl(b.recordset[0].V));

// C) FILIAIS com COD_FILIAL duplicado
const c = await pool.request().query(`
  SELECT COD_FILIAL, COUNT(*) N, MAX(FILIAL) F FROM FILIAIS WITH(NOLOCK) GROUP BY COD_FILIAL HAVING COUNT(*)>1`);
console.log("\nC) COD_FILIAL duplicados em FILIAIS:", c.recordset.length);
c.recordset.forEach(r=>console.log(`   COD=${r.COD_FILIAL} x${r.N}  ex="${(r.F||'').trim()}"`));

// D) a venda "Galeão" 000109
const d = await pool.request().query(`
  SELECT COUNT(*) N FROM FILIAIS WITH(NOLOCK) WHERE COD_FILIAL='000109'`);
console.log("\nD) linhas em FILIAIS p/ COD 000109 (Galeão):", d.recordset[0].N);
await pool.close();

import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:180000 };
const P = "45.14.0042";
const pool = await sql.connect(config);
const r1 = await pool.request().query(`
 SELECT TOP 5 PRODUTO, DESC_PRODUTO, GRUPO_PRODUTO, SUBGRUPO_PRODUTO, LINHA, GRADE, COLECAO, EMPRESA
 FROM PRODUTOS WITH(NOLOCK) WHERE PRODUTO='${P}'`);
console.log("CADASTRO", JSON.stringify(r1.recordset,null,1));
const r2 = await pool.request().query(`
 SELECT ISNULL(COR_PRODUTO,'') COR, SUM(ESTOQUE) EST, COUNT(*) N
 FROM ESTOQUE_PRODUTOS WITH(NOLOCK) WHERE PRODUTO='${P}' GROUP BY ISNULL(COR_PRODUTO,'') ORDER BY 1`);
console.log("ESTOQUE por cor", JSON.stringify(r2.recordset));
const r3 = await pool.request().query(`
 SELECT f.CODIGO_FILIAL, f.NOME_FILIAL, ep.ESTOQUE, ISNULL(ep.COR_PRODUTO,'') COR
 FROM ESTOQUE_PRODUTOS ep WITH(NOLOCK)
 LEFT JOIN FILIAIS f WITH(NOLOCK) ON f.CODIGO_FILIAL=ep.CODIGO_FILIAL
 WHERE ep.PRODUTO='${P}' AND ep.ESTOQUE<>0 ORDER BY ep.ESTOQUE DESC`);
console.log("ESTOQUE por filial", JSON.stringify(r3.recordset,null,1));
await pool.close();

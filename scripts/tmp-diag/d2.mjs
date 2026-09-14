import sql from "mssql";
const config = { server:"177.92.78.250", database:"LINX_PRODUCAO", user:"andre.sabetta", password:"asabetta", port:1433, options:{encrypt:false,trustServerCertificate:true}, requestTimeout:180000 };
const P = "45.14.0042";
const pool = await sql.connect(config);
const cols = await pool.request().query(`SELECT TOP 1 * FROM ESTOQUE_PRODUTOS WITH(NOLOCK) WHERE PRODUTO='${P}'`);
console.log("COLS ESTOQUE_PRODUTOS:", Object.keys(cols.recordset[0]||{}).join(", "));
await pool.close();

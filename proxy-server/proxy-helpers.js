/**
 * Helpers para executar queries com parâmetros no proxy
 */

/**
 * Executa uma query com parâmetros dinâmicos
 */
async function executeQueryWithParams(pool, queryText, params = {}) {
  const request = pool.request();
  
  // Adicionar parâmetros
  Object.keys(params).forEach((key) => {
    const value = params[key];
    const sqlType = getSqlType(value);
    request.input(key, sqlType, value);
  });
  
  const result = await request.query(queryText);
  return result.recordset;
}

/**
 * Determina o tipo SQL baseado no valor
 */
function getSqlType(value) {
  if (typeof value === 'string') {
    return sql.VarChar;
  }
  if (typeof value === 'number') {
    return sql.Int;
  }
  if (value instanceof Date) {
    return sql.DateTime;
  }
  if (typeof value === 'boolean') {
    return sql.Bit;
  }
  return sql.VarChar; // default
}

module.exports = {
  executeQueryWithParams,
  getSqlType,
};


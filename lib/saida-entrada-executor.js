/**
 * Executor de saída/entrada isolada de produtos
 * Baseado no transfer-executor.js, mas adaptado para apenas um fluxo (saída OU entrada)
 */

const sql = require('mssql');

function determinarTipoEntrada(tipoRomaneio) {
  const tipoEntradaMap = {
    'TRANSFERENCIA ENTRE LOJAS': '1',
    'TRANSFERENCIA': '1',
    'ENTRADA AVULSA': '1',
    'ENTRADA POR MOV. INTERNA': '1',
    'DEFEITO': '1',
  };
  return tipoEntradaMap[(tipoRomaneio || '').toUpperCase()] || '1';
}

/**
 * Executa uma saída isolada (sem entrada correspondente)
 */
async function executeSaida(pool, params) {
  const {
    produto,
    corProduto,
    filial,
    quantidade,
    tipoRomaneio = 'TRANSFERENCIA',
    responsavel = 'LOGISTICA',
    observacao = null,
  } = params;

  const produtoEscaped = produto.replace(/'/g, "''");
  const corEscaped = corProduto ? corProduto.replace(/'/g, "''") : null;
  const observacaoEscaped = observacao ? observacao.replace(/'/g, "''") : null;
  const dataStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Buscar nome da filial
  const req0 = pool.request();
  req0.input('filial', filial);
  const resultNomesFiliais = await req0.query(`
    SELECT COD_FILIAL, FILIAL
    FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL = @filial
  `);

  let filialNome = filial;
  let filialCod = filial.trim();
  if (resultNomesFiliais.recordset.length > 0) {
    const row = resultNomesFiliais.recordset[0];
    filialNome = row.FILIAL?.toString().trim() || filial;
    filialCod = row.COD_FILIAL?.toString().trim() || filial.trim();
  } else {
    // Tentar por nome
    const req0b = pool.request();
    req0b.input('filial', filial);
    const resultByNome = await req0b.query(`
      SELECT COD_FILIAL, FILIAL
      FROM FILIAIS WITH (NOLOCK)
      WHERE FILIAL = @filial
    `);
    if (resultByNome.recordset.length > 0) {
      const row = resultByNome.recordset[0];
      filialNome = row.FILIAL?.toString().trim() || filial;
      filialCod = row.COD_FILIAL?.toString().trim() || filial.trim();
    }
  }

  const filialEscaped = filialNome.replace(/'/g, "''");

  // Gerar próximo romaneio de saída
  const req1 = pool.request();
  const queryRomaneioSaida = `
    SELECT TOP 1 ROMANEIO_PRODUTO
    FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
    WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
      AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
    ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
  `;
  const resultRomaneio = await req1.query(queryRomaneioSaida);
  let romaneioSaida = '016042';

  if (resultRomaneio.recordset.length > 0) {
    const romaneioAtual = resultRomaneio.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || '';
    if (romaneioAtual) {
      try {
        const numAtual = parseInt(romaneioAtual);
        romaneioSaida = `${numAtual + 1}`.padStart(6, '0');
      } catch {
        // Usar padrão
      }
    }
  }

  // Verificar se romaneio já existe
  let tentativas = 0;
  while (tentativas < 10) {
    const reqVerificar = pool.request();
    reqVerificar.input('romaneioSaida', romaneioSaida);
    reqVerificar.input('filialNome', filialNome);
    const resultVerificar = await reqVerificar.query(`
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioSaida 
        AND LTRIM(RTRIM(FILIAL)) = @filialNome
    `);

    if (resultVerificar.recordset[0]?.TOTAL === 0) break;

    const numAtual = parseInt(romaneioSaida);
    romaneioSaida = `${numAtual + 1}`.padStart(6, '0');
    tentativas++;
  }

  // Determinar CM_OPERACAO (usar '011' para saída sem destino)
  const cmOperacao = '011';
  const filialDestinoValor = null;
  const romaneioDestinoValor = null;
  const tipoEntrada = determinarTipoEntrada(tipoRomaneio);

  // Inserir ESTOQUE_PROD_SAI
  const req3 = pool.request();
  req3.input('romaneioSaida', romaneioSaida);
  req3.input('filial', filialEscaped);
  req3.input('dataStr', dataStr);
  req3.input('responsavel', responsavel || ' ');
  req3.input('filialDestinoValor', filialDestinoValor);
  req3.input('romaneioDestinoValor', romaneioDestinoValor);
  req3.input('tipoRomaneio', tipoRomaneio);
  req3.input('cmOperacao', cmOperacao);
  if (observacaoEscaped) {
    req3.input('observacao', observacaoEscaped);
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_SAI (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, ROMANEIO_DESTINO, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, NAO_VALIDAR_ENTRADA, MOV_INTERNA,
        TIPO_ROMANEIO, CM_OPERACAO, OBS
      ) VALUES (
        @romaneioSaida, @filial, @dataStr, @responsavel,
        @filialDestinoValor, @romaneioDestinoValor, @dataStr,
        GETDATE(), 0, 0, 0, @tipoRomaneio, @cmOperacao, @observacao
      )
    `);
  } else {
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_SAI (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, ROMANEIO_DESTINO, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, NAO_VALIDAR_ENTRADA, MOV_INTERNA,
        TIPO_ROMANEIO, CM_OPERACAO
      ) VALUES (
        @romaneioSaida, @filial, @dataStr, @responsavel,
        @filialDestinoValor, @romaneioDestinoValor, @dataStr,
        GETDATE(), 0, 0, 0, @tipoRomaneio, @cmOperacao
      )
    `);
  }

  // Inserir ESTOQUE_PROD1_SAI
  const req4 = pool.request();
  req4.input('filial', filialEscaped);
  req4.input('romaneioSaida', romaneioSaida);
  req4.input('produto', produtoEscaped);
  req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
  req4.input('quantidade', quantidade);
  await req4.query(`
    INSERT INTO ESTOQUE_PROD1_SAI (
      FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM
    ) VALUES (@filial, @romaneioSaida, @produto, @corProduto, @quantidade, 0)
  `);

  // Inserir LOJA_SAIDAS
  const req5 = pool.request();
  req5.input('romaneioSaida', romaneioSaida);
  req5.input('filial', filialEscaped);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('quantidade', quantidade);
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA, OBS
      ) VALUES (
        @romaneioSaida, @filial, @dataStr, @responsavel,
        NULL, '', 0, @quantidade, 0, 0, @dataStr, 1, 0, @observacao
      )
    `);
  } else {
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA
      ) VALUES (
        @romaneioSaida, @filial, @dataStr, @responsavel,
        NULL, '', 0, @quantidade, 0, 0, @dataStr, 1, 0
      )
    `);
  }

  // Inserir LOJA_SAIDAS_PRODUTO
  const req6 = pool.request();
  req6.input('romaneioSaida', romaneioSaida);
  req6.input('filial', filialEscaped);
  req6.input('produto', produtoEscaped);
  req6.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
  req6.input('quantidade', quantidade);
  await req6.query(`
    INSERT INTO LOJA_SAIDAS_PRODUTO (
      ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, QTDE_SAIDA
    ) VALUES (@romaneioSaida, @filial, @produto, @corProduto, @quantidade)
  `);

  // Atualizar estoque (reduzir)
  const produtoParaQuery = produto.trim();
  const filialParaQuery = filialNome.trim();
  const corProdutoParaQuery = corProduto ? corProduto.trim() : null;

  const req13 = pool.request();
  req13.input('produtoParaQuery', produtoParaQuery);
  req13.input('filialParaQuery', filialParaQuery);
  const resultEstoque = await req13.query(`
    SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
    FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
    WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialParaQuery
  `);

  if (resultEstoque.recordset.length === 0) {
    throw new Error(`ERRO: Nenhum registro encontrado para Produto: '${produtoParaQuery}', Filial: '${filialParaQuery}'.`);
  }

  let rowEstoque = null;
  if (corProdutoParaQuery) {
    for (const row of resultEstoque.recordset) {
      const corBanco = row.COR_PRODUTO?.toString().trim() || '';
      if (corBanco === corProdutoParaQuery) {
        rowEstoque = row;
        break;
      }
    }
    if (!rowEstoque) {
      throw new Error(`ERRO: Nenhum registro encontrado com Cor: '${corProdutoParaQuery}'. Produto: '${produtoParaQuery}', Filial: '${filialParaQuery}'`);
    }
  } else {
    for (const row of resultEstoque.recordset) {
      const corBanco = row.COR_PRODUTO?.toString().trim() || '';
      if (!corBanco) {
        rowEstoque = row;
        break;
      }
    }
    if (!rowEstoque) {
      throw new Error(`ERRO: Nenhum registro encontrado sem cor. Produto: '${produtoParaQuery}', Filial: '${filialParaQuery}'`);
    }
  }

  const produtoExato = rowEstoque.PRODUTO.toString().trim();
  const filialExata = rowEstoque.FILIAL.toString().trim();
  const corExata = rowEstoque.COR_PRODUTO?.toString().trim() || '';

  const req14 = pool.request();
  req14.input('quantidade', quantidade);
  req14.input('produtoExato', produtoExato);
  req14.input('filialExata', filialExata);
  if (corExata) req14.input('corExata', corExata);
  await req14.query(corExata
    ? `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE - @quantidade WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata`
    : `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE - @quantidade WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
  );

  // Atualizar SEQUENCIAIS
  const req9 = pool.request();
  req9.input('romaneioSaida', romaneioSaida);
  await req9.query(`UPDATE SEQUENCIAIS SET SEQUENCIA = @romaneioSaida WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'`);

  return {
    success: true,
    romaneio: romaneioSaida,
    message: `Saída executada com sucesso! Romaneio: ${romaneioSaida}`,
  };
}

/**
 * Executa uma entrada isolada (sem saída correspondente)
 */
async function executeEntrada(pool, params) {
  const {
    produto,
    corProduto,
    filial,
    quantidade,
    tipoRomaneio = 'ENTRADA AVULSA',
    responsavel = 'LOGISTICA',
    observacao = null,
  } = params;

  const produtoEscaped = produto.replace(/'/g, "''");
  const corEscaped = corProduto ? corProduto.replace(/'/g, "''") : null;
  const observacaoEscaped = observacao ? observacao.replace(/'/g, "''") : null;
  const dataStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Buscar nome da filial
  const req0 = pool.request();
  req0.input('filial', filial);
  const resultNomesFiliais = await req0.query(`
    SELECT COD_FILIAL, FILIAL
    FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL = @filial
  `);

  let filialNome = filial;
  let filialCod = filial.trim();
  if (resultNomesFiliais.recordset.length > 0) {
    const row = resultNomesFiliais.recordset[0];
    filialNome = row.FILIAL?.toString().trim() || filial;
    filialCod = row.COD_FILIAL?.toString().trim() || filial.trim();
  } else {
    // Tentar por nome
    const req0b = pool.request();
    req0b.input('filial', filial);
    const resultByNome = await req0b.query(`
      SELECT COD_FILIAL, FILIAL
      FROM FILIAIS WITH (NOLOCK)
      WHERE FILIAL = @filial
    `);
    if (resultByNome.recordset.length > 0) {
      const row = resultByNome.recordset[0];
      filialNome = row.FILIAL?.toString().trim() || filial;
      filialCod = row.COD_FILIAL?.toString().trim() || filial.trim();
    }
  }

  const filialEscaped = filialNome.replace(/'/g, "''");

  // Gerar próximo romaneio de entrada
  const req1 = pool.request();
  const queryRomaneioEntrada = `
    SELECT TOP 1 ROMANEIO_PRODUTO
    FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
    WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
      AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
    ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
  `;
  const resultRomaneio = await req1.query(queryRomaneioEntrada);
  let romaneioEntrada = '016042';

  if (resultRomaneio.recordset.length > 0) {
    const romaneioAtual = resultRomaneio.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || '';
    if (romaneioAtual) {
      try {
        const numAtual = parseInt(romaneioAtual);
        romaneioEntrada = `${numAtual + 1}`.padStart(6, '0');
      } catch {
        // Usar padrão
      }
    }
  }

  // Verificar se romaneio já existe
  let tentativas = 0;
  while (tentativas < 10) {
    const reqVerificar = pool.request();
    reqVerificar.input('romaneioEntrada', romaneioEntrada);
    reqVerificar.input('filialNome', filialNome);
    const resultVerificar = await reqVerificar.query(`
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioEntrada 
        AND LTRIM(RTRIM(FILIAL)) = @filialNome
    `);

    if (resultVerificar.recordset[0]?.TOTAL === 0) break;

    const numAtual = parseInt(romaneioEntrada);
    romaneioEntrada = `${numAtual + 1}`.padStart(6, '0');
    tentativas++;
  }

  const tipoEntrada = determinarTipoEntrada(tipoRomaneio);
  const cmOperacaoEntrada = '003';

  // Inserir ESTOQUE_PROD_ENT
  const req3 = pool.request();
  req3.input('romaneioEntrada', romaneioEntrada);
  req3.input('filial', filialEscaped);
  req3.input('dataStr', dataStr);
  req3.input('responsavel', responsavel || ' ');
  req3.input('tipoRomaneio', tipoRomaneio);
  req3.input('tipoEntrada', tipoEntrada);
  req3.input('cmOperacaoEntrada', cmOperacaoEntrada);
  if (observacaoEscaped) {
    req3.input('observacao', observacaoEscaped);
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA, TIPO_ROMANEIO,
        TIPO_ENTRADA, CM_OPERACAO
      ) VALUES (
        @romaneioEntrada, @filial, @dataStr, @responsavel,
        NULL, NULL, @dataStr,
        GETDATE(), 0, 0, 0, 0, @tipoRomaneio, @tipoEntrada, @cmOperacaoEntrada
      )
    `);
  } else {
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA, TIPO_ROMANEIO,
        TIPO_ENTRADA, CM_OPERACAO
      ) VALUES (
        @romaneioEntrada, @filial, @dataStr, @responsavel,
        NULL, NULL, @dataStr,
        GETDATE(), 0, 0, 0, 0, @tipoRomaneio, @tipoEntrada, @cmOperacaoEntrada
      )
    `);
  }

  // Inserir ESTOQUE_PROD1_ENT
  const req4 = pool.request();
  req4.input('romaneioEntrada', romaneioEntrada);
  req4.input('produto', produtoEscaped);
  req4.input('filial', filialEscaped);
  req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
  req4.input('quantidade', quantidade);
  await req4.query(`
    INSERT INTO ESTOQUE_PROD1_ENT (ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE)
    VALUES (@romaneioEntrada, @produto, @filial, @corProduto, @quantidade)
  `);

  // Inserir LOJA_ENTRADAS
  const req5 = pool.request();
  req5.input('romaneioEntrada', romaneioEntrada);
  req5.input('filial', filialEscaped);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('quantidade', quantidade);
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_ENTRADAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_NF_SAIDA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, ENTRADA_ENCERRADA, ENTRADA_CANCELADA, OBS
      ) VALUES (
        @romaneioEntrada, @filial, @dataStr, @responsavel,
        NULL, NULL, 0, @quantidade, 0, 0, @dataStr, 1, 0, @observacao
      )
    `);
  } else {
    await req5.query(`
      INSERT INTO LOJA_ENTRADAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_NF_SAIDA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, ENTRADA_ENCERRADA, ENTRADA_CANCELADA
      ) VALUES (
        @romaneioEntrada, @filial, @dataStr, @responsavel,
        NULL, NULL, 0, @quantidade, 0, 0, @dataStr, 1, 0
      )
    `);
  }

  // Atualizar estoque (aumentar)
  const produtoParaQuery = produto.trim();
  const filialParaQuery = filialNome.trim();
  const corProdutoParaQuery = corProduto ? corProduto.trim() : null;

  const req13 = pool.request();
  req13.input('produtoParaQuery', produtoParaQuery);
  req13.input('filialParaQuery', filialParaQuery);
  if (corProdutoParaQuery) req13.input('corProdutoParaQuery', corProdutoParaQuery);
  const resultCheck = await req13.query(corProdutoParaQuery
    ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialParaQuery AND COR_PRODUTO = @corProdutoParaQuery`
    : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialParaQuery AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
  );
  const existeEstoque = resultCheck.recordset.length > 0;
  const estoqueAntes = existeEstoque && resultCheck.recordset[0].ESTOQUE ? resultCheck.recordset[0].ESTOQUE : 0;

  if (existeEstoque) {
    const req14 = pool.request();
    req14.input('quantidade', quantidade);
    req14.input('produtoParaQuery', produtoParaQuery);
    req14.input('filialParaQuery', filialParaQuery);
    if (corProdutoParaQuery) req14.input('corProdutoParaQuery', corProdutoParaQuery);
    await req14.query(corProdutoParaQuery
      ? `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE + @quantidade WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialParaQuery AND COR_PRODUTO = @corProdutoParaQuery`
      : `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE + @quantidade WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialParaQuery AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
    );
  } else {
    const req15 = pool.request();
    req15.input('produtoParaQuery', produtoParaQuery);
    req15.input('corProdutoParaQuery', corProdutoParaQuery);
    req15.input('filialParaQuery', filialParaQuery);
    req15.input('quantidade', quantidade);
    await req15.query(`
      INSERT INTO ESTOQUE_PRODUTOS (PRODUTO, COR_PRODUTO, FILIAL, ESTOQUE)
      VALUES (@produtoParaQuery, @corProdutoParaQuery, @filialParaQuery, @quantidade)
    `);
  }

  return {
    success: true,
    romaneio: romaneioEntrada,
    message: `Entrada executada com sucesso! Romaneio: ${romaneioEntrada}`,
  };
}

module.exports = { executeSaida, executeEntrada };

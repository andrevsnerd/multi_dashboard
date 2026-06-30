/**
 * Executor de transferência de produtos - usado pelo proxy-server
 * Lógica extraída da rota executar para rodar via proxy (ngrok) quando Vercel não tem acesso direto ao MSSQL.
 */

const sql = require('mssql');

// Usar input(name, value) - mssql infere o tipo e evita parameter.type.validate no Tedious
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
 * Data/hora "agora" no MESMO relógio do SQL Server (horário de Brasília), igual
 * ao que o Linx/PDV grava. NÃO usar `new Date().toISOString()`: isso devolve UTC
 * (Brasília + 3h), gravando EMISSAO adiantada e, em operações após 21h, rolando
 * a data para o dia seguinte. Fallback (se a query falhar) subtrai 3h do UTC.
 */
async function getDbNowString(pool) {
  try {
    const r = await pool.request().query(`SELECT CONVERT(VARCHAR(19), GETDATE(), 120) AS NOW`);
    const now = r.recordset[0]?.NOW;
    if (now) return String(now).replace('T', ' ');
  } catch {
    // cai no fallback abaixo
  }
  return new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Retorna a posição base do tamanho na grade do produto (1..48).
 * Usado para preencher a coluna correta (EN_N / SA_N) nas tabelas de itens.
 * Padrão: 1 (seguro para produtos de tamanho único como 90X90, 65X190, etc.)
 */
async function getTamanhoBase(pool, produto) {
  try {
    const req = pool.request();
    req.input('produto', produto.trim());
    const result = await req.query(`
      SELECT TOP 1 ISNULL(TAMANHO_BASE, 1) AS TAMANHO_BASE
      FROM PRODUTOS WITH (NOLOCK)
      WHERE PRODUTO = @produto
    `);
    const n = parseInt(result.recordset[0]?.TAMANHO_BASE, 10);
    return (n >= 1 && n <= 48) ? n : 1;
  } catch {
    return 1;
  }
}

/**
 * @param {import('mssql').ConnectionPool} pool
 * @param {object} params
 * @param {string} params.produto
 * @param {string|null} params.corProduto
 * @param {string} params.filialOrigem
 * @param {string} params.filialDestino
 * @param {number} params.qtdeSaida
 * @param {number} params.qtdeEntrada
 * @param {string} [params.tipoRomaneio]
 * @param {string} [params.responsavel]
 * @param {string|null} [params.observacao]
 * @returns {Promise<{ success: boolean, romaneioSaida: string, romaneioEntrada: string, message: string }>}
 */
async function executeTransfer(pool, params) {
  const {
    produto,
    corProduto,
    filialOrigem,
    filialDestino,
    qtdeSaida,
    qtdeEntrada,
    tipoRomaneio = 'TRANSFERENCIA',
    responsavel = 'LOGISTICA',
    observacao = null,
  } = params;

  const fo = filialOrigem.trim();
  const fd = filialDestino.trim();
  const produtoEscaped = produto.replace(/'/g, "''");
  let filialOrigemEscaped = filialOrigem.replace(/'/g, "''");
  let filialDestinoEscaped = filialDestino.replace(/'/g, "''");
  const corEscaped = corProduto ? corProduto.replace(/'/g, "''") : null;
  const observacaoEscaped = observacao ? observacao.replace(/'/g, "''") : null;
  const dataStr = await getDbNowString(pool);

  // 0. Buscar nomes das filiais PRIMEIRO (ESTOQUE_PROD_SAI.FILIAL usa NOME, não código)
  const req0 = pool.request();
  req0.input('filialOrigem', filialOrigem);
  req0.input('filialDestino', filialDestino);
  const resultNomesFiliais = await req0.query(`
    SELECT COD_FILIAL, FILIAL
    FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL IN (@filialOrigem, @filialDestino)
  `);

  let filialOrigemNome = filialOrigem;
  let filialDestinoNome = filialDestino;
  for (const row of resultNomesFiliais.recordset) {
    const codFilial = row.COD_FILIAL?.toString().trim() || '';
    const nomeFilial = row.FILIAL?.toString().trim() || '';
    if (codFilial === filialOrigem.trim()) filialOrigemNome = nomeFilial;
    else if (codFilial === filialDestino.trim()) filialDestinoNome = nomeFilial;
  }

  // Se não encontrou filiais por código, tentar por nome (controle-transferencias pode enviar nomes)
  let filialOrigemCod = filialOrigem.trim();
  let filialDestinoCod = filialDestino.trim();
  if (resultNomesFiliais.recordset.length === 0) {
    const req0b = pool.request();
    req0b.input('filialOrigem', filialOrigem);
    req0b.input('filialDestino', filialDestino);
    const resultByNome = await req0b.query(`
      SELECT COD_FILIAL, FILIAL
      FROM FILIAIS WITH (NOLOCK)
      WHERE FILIAL IN (@filialOrigem, @filialDestino)
    `);
    for (const row of resultByNome.recordset) {
      const codFilial = row.COD_FILIAL?.toString().trim() || '';
      const nomeFilial = row.FILIAL?.toString().trim() || '';
      if (nomeFilial === filialOrigem.trim()) {
        filialOrigemNome = nomeFilial;
        filialOrigemCod = codFilial;
      } else if (nomeFilial === filialDestino.trim()) {
        filialDestinoNome = nomeFilial;
        filialDestinoCod = codFilial;
      }
    }
  } else {
    filialOrigemCod = filialOrigem.trim();
    filialDestinoCod = filialDestino.trim();
  }

  // 1. Gerar próximo romaneio de saída
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

  // Verificar se romaneio já existe e incrementar se necessário
  // ESTOQUE_PROD_SAI.FILIAL armazena NOME da filial (não código)
  let tentativas = 0;
  while (tentativas < 10) {
    const reqVerificar = pool.request();
    reqVerificar.input('romaneioSaida', romaneioSaida);
    reqVerificar.input('filialOrigemNome', filialOrigemNome);
    const resultVerificar = await reqVerificar.query(`
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioSaida 
        AND LTRIM(RTRIM(FILIAL)) = @filialOrigemNome
    `);

    if (resultVerificar.recordset[0]?.TOTAL === 0) break;

    const numAtual = parseInt(romaneioSaida);
    romaneioSaida = `${numAtual + 1}`.padStart(6, '0');
    tentativas++;
  }

  const romaneioEntrada = `T${romaneioSaida}`;

  // VALIDAÇÃO FINAL: Romaneio não deve existir (usar NOME - ESTOQUE_PROD_SAI.FILIAL = nome)
  const reqValida = pool.request();
  reqValida.input('romaneioSaida', romaneioSaida);
  reqValida.input('filialOrigemNome', filialOrigemNome);
  const resultValida = await reqValida.query(`
    SELECT COUNT(*) as TOTAL
    FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioSaida 
      AND LTRIM(RTRIM(FILIAL)) = @filialOrigemNome
  `);

  if (resultValida.recordset[0]?.TOTAL > 0) {
    throw new Error(`Romaneio de saida ${romaneioSaida} ja existe para a filial ${filialOrigemNome}. Por favor, gere um novo romaneio.`);
  }

  // 2. Determinar CM_OPERACAO (empresas)
  const req2 = pool.request();
  req2.input('filialOrigemCod', filialOrigemCod);
  req2.input('filialDestinoCod', filialDestinoCod);
  const resultEmpresas = await req2.query(`
    SELECT COD_FILIAL, EMPRESA
    FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL IN (@filialOrigemCod, @filialDestinoCod)
  `);

  let empresaOrigem = null;
  let empresaDestino = null;
  for (const row of resultEmpresas.recordset) {
    const codFilial = row.COD_FILIAL?.toString().trim() || '';
    if (codFilial === filialOrigemCod) empresaOrigem = row.EMPRESA ? parseInt(String(row.EMPRESA)) : null;
    else if (codFilial === filialDestinoCod) empresaDestino = row.EMPRESA ? parseInt(String(row.EMPRESA)) : null;
  }

  if (empresaOrigem === null) {
    const reqEmp = pool.request();
    reqEmp.input('filialOrigemCod', filialOrigemCod);
    const r = await reqEmp.query(`SELECT EMPRESA FROM FILIAIS WITH (NOLOCK) WHERE COD_FILIAL = @filialOrigemCod`);
    empresaOrigem = r.recordset.length > 0 && r.recordset[0].EMPRESA ? parseInt(String(r.recordset[0].EMPRESA)) : 8;
  }
  if (empresaDestino === null) {
    const reqEmp = pool.request();
    reqEmp.input('filialDestinoCod', filialDestinoCod);
    const r = await reqEmp.query(`SELECT EMPRESA FROM FILIAIS WITH (NOLOCK) WHERE COD_FILIAL = @filialDestinoCod`);
    empresaDestino = r.recordset.length > 0 && r.recordset[0].EMPRESA ? parseInt(String(r.recordset[0].EMPRESA)) : 8;
  }

  const cmOperacao = (empresaOrigem !== null && empresaDestino !== null && empresaOrigem === empresaDestino) ? '012' : '011';
  filialOrigemEscaped = filialOrigemNome.replace(/'/g, "''");
  filialDestinoEscaped = filialDestinoNome.replace(/'/g, "''");

  const filialDestinoValor = cmOperacao === '011' ? null : filialDestinoEscaped;
  const romaneioDestinoValor = cmOperacao === '011' ? null : romaneioEntrada;
  const cmOperacaoEntrada = '003';
  const tipoEntrada = determinarTipoEntrada(tipoRomaneio);

  // 3. Inserir ESTOQUE_PROD_SAI
  const req3 = pool.request();
  req3.input('romaneioSaida', romaneioSaida);
  req3.input('filialOrigem', filialOrigemEscaped);
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
        @romaneioSaida, @filialOrigem, @dataStr, @responsavel,
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
        @romaneioSaida, @filialOrigem, @dataStr, @responsavel,
        @filialDestinoValor, @romaneioDestinoValor, @dataStr,
        GETDATE(), 0, 0, 0, @tipoRomaneio, @cmOperacao
      )
    `);
  }

  // 4. Inserir ESTOQUE_PROD1_SAI
  const req4 = pool.request();
  req4.input('filialOrigem', filialOrigemEscaped);
  req4.input('romaneioSaida', romaneioSaida);
  req4.input('produto', produtoEscaped);
  req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
  req4.input('qtdeSaida', qtdeSaida);
  await req4.query(`
    INSERT INTO ESTOQUE_PROD1_SAI (
      FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM
    ) VALUES (@filialOrigem, @romaneioSaida, @produto, @corProduto, @qtdeSaida, 0)
  `);

  // 5. Inserir LOJA_SAIDAS
  const req5 = pool.request();
  req5.input('romaneioSaida', romaneioSaida);
  req5.input('filialOrigem', filialOrigemEscaped);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('filialDestinoEscaped', filialDestinoEscaped);
  req5.input('qtdeSaida', qtdeSaida);
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA, OBS
      ) VALUES (
        @romaneioSaida, @filialOrigem, @dataStr, @responsavel,
        @filialDestinoEscaped, '', 0, @qtdeSaida, 0, 0, @dataStr, 1, 0, @observacao
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
        @romaneioSaida, @filialOrigem, @dataStr, @responsavel,
        @filialDestinoEscaped, '', 0, @qtdeSaida, 0, 0, @dataStr, 1, 0
      )
    `);
  }

  // 5.1 Atualizar TIPO_ENTRADA_SAIDA em LOJA_SAIDAS (opcional)
  try {
    const tipoEntradaSaidaLoja = cmOperacao === '012' ? '2' : '1';
    const req5_1 = pool.request();
    req5_1.input('tipoEntradaSaidaLoja', tipoEntradaSaidaLoja);
    req5_1.input('romaneioSaida', romaneioSaida);
    req5_1.input('filialOrigem', filialOrigemEscaped);
    await req5_1.query(`UPDATE LOJA_SAIDAS SET TIPO_ENTRADA_SAIDA = @tipoEntradaSaidaLoja WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem`);
  } catch (e) {
    // Não crítico
  }

  // 6. Inserir LOJA_SAIDAS_PRODUTO
  const req6 = pool.request();
  req6.input('romaneioSaida', romaneioSaida);
  req6.input('filialOrigem', filialOrigemEscaped);
  req6.input('produto', produtoEscaped);
  req6.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
  req6.input('qtdeSaida', qtdeSaida);
  await req6.query(`
    INSERT INTO LOJA_SAIDAS_PRODUTO (
      ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, QTDE_SAIDA
    ) VALUES (@romaneioSaida, @filialOrigem, @produto, @corProduto, @qtdeSaida)
  `);

  // Verificar LOJA_SAIDAS antes da SP
  const reqVerifAntesSP = pool.request();
  reqVerifAntesSP.input('romaneioSaida', romaneioSaida);
  reqVerifAntesSP.input('filialOrigem', filialOrigemEscaped);
  const resultVerifAntesSP = await reqVerifAntesSP.query(`
    SELECT SAIDA_CANCELADA, SAIDA_ENCERRADA
    FROM LOJA_SAIDAS
    WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem
  `);

  if (resultVerifAntesSP.recordset.length === 0) {
    throw new Error(`ERRO: LOJA_SAIDAS nao foi criada antes de chamar stored procedure. Romaneio: ${romaneioSaida}`);
  }
  const saidaCanceladaNum = typeof resultVerifAntesSP.recordset[0].SAIDA_CANCELADA === 'boolean'
    ? (resultVerifAntesSP.recordset[0].SAIDA_CANCELADA ? 1 : 0)
    : (resultVerifAntesSP.recordset[0].SAIDA_CANCELADA || 0);
  if (saidaCanceladaNum !== 0) {
    throw new Error(`ERRO: LOJA_SAIDAS foi criada com SAIDA_CANCELADA != 0`);
  }

  // 7. Chamar stored procedure
  const req7 = pool.request();
  req7.input('filialOrigem', filialOrigemEscaped);
  req7.input('romaneioSaida', romaneioSaida);
  req7.input('filialDestinoEscaped', filialDestinoEscaped);
  try {
    await req7.query(`
      EXEC LX_GERA_TRANSFERENCIA_AUTOMATICA 
        @FILIAL = @filialOrigem,
        @ROMANEIO_PRODUTO = @romaneioSaida,
        @FILIAL_DESTINO = @filialDestinoEscaped,
        @SERIE_NF = '001',
        @ORIGEM = 'S',
        @EXCLUSAO = 'N'
    `);
  } catch (spError) {
    const errorStr = String(spError);
    if (errorStr.includes('IMPOSSIVEL GERAR ENTRADA') || errorStr.includes('EXCLUIDA') || errorStr.includes('CANCELADA')) {
      throw new Error(`Erro na stored procedure: ${errorStr}`);
    }
  }

  // 8. Buscar romaneio de entrada gerado
  let romaneioEntradaFinal = romaneioEntrada;
  let rowRomaneioEncontrado = false;

  const req8 = pool.request();
  req8.input('filialDestino', filialDestinoEscaped);
  req8.input('romaneioSaida', romaneioSaida);
  let resultRomaneioEntrada = await req8.query(`
    SELECT TOP 1 ROMANEIO_PRODUTO
    FROM ESTOQUE_PROD_ENT
    WHERE FILIAL = @filialDestino AND ROMANEIO_ORIGEM = @romaneioSaida AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
    ORDER BY EMISSAO DESC
  `);

  if (resultRomaneioEntrada.recordset.length > 0) {
    romaneioEntradaFinal = resultRomaneioEntrada.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
    rowRomaneioEncontrado = true;
  } else {
    const req8_2 = pool.request();
    req8_2.input('filialDestino', filialDestinoEscaped);
    req8_2.input('filialOrigem', filialOrigemEscaped);
    resultRomaneioEntrada = await req8_2.query(`
      SELECT TOP 1 ROMANEIO_PRODUTO
      FROM ESTOQUE_PROD_ENT
      WHERE FILIAL = @filialDestino AND FILIAL_ORIGEM = @filialOrigem AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
      ORDER BY EMISSAO DESC
    `);
    if (resultRomaneioEntrada.recordset.length > 0) {
      romaneioEntradaFinal = resultRomaneioEntrada.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
      rowRomaneioEncontrado = true;
    } else {
      const req8_3 = pool.request();
      req8_3.input('filialDestino', filialDestinoEscaped);
      req8_3.input('filialOrigem', filialOrigemEscaped);
      const resultLojaEntradas = await req8_3.query(`
        SELECT TOP 1 ROMANEIO_PRODUTO
        FROM LOJA_ENTRADAS
        WHERE FILIAL = @filialDestino AND FILIAL_ORIGEM = @filialOrigem AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
        ORDER BY EMISSAO DESC
      `);
      if (resultLojaEntradas.recordset.length > 0) {
        romaneioEntradaFinal = resultLojaEntradas.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
        rowRomaneioEncontrado = true;
      } else {
        const req8_4 = pool.request();
        req8_4.input('filialDestino', filialDestinoEscaped);
        const resultRecente = await req8_4.query(`
          SELECT TOP 1 ROMANEIO_PRODUTO
          FROM ESTOQUE_PROD_ENT
          WHERE FILIAL = @filialDestino AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
          ORDER BY EMISSAO DESC
        `);
        if (resultRecente.recordset.length > 0) {
          romaneioEntradaFinal = resultRecente.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
          rowRomaneioEncontrado = true;
        }
      }
    }
  }

  if (!rowRomaneioEncontrado) {
    const req8_5 = pool.request();
    req8_5.input('romaneioEntrada', romaneioEntrada);
    req8_5.input('filialDestino', filialDestinoEscaped);
    const resultVerifPrevisto = await req8_5.query(`
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_ENT
      WHERE ROMANEIO_PRODUTO = @romaneioEntrada AND FILIAL = @filialDestino
    `);
    if (resultVerifPrevisto.recordset[0]?.TOTAL > 0) {
      romaneioEntradaFinal = romaneioEntrada;
      rowRomaneioEncontrado = true;
    }
  }

  // 9. Atualizar SEQUENCIAIS
  const req9 = pool.request();
  req9.input('romaneioSaida', romaneioSaida);
  await req9.query(`UPDATE SEQUENCIAIS SET SEQUENCIA = @romaneioSaida WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'`);

  // 10. Verificações de registros criados
  const req10_1 = pool.request();
  req10_1.input('romaneioSaida', romaneioSaida);
  req10_1.input('filialOrigem', filialOrigemEscaped);
  const resultVerificarSaida = await req10_1.query(`SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD_SAI WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem`);
  if (resultVerificarSaida.recordset[0]?.TOTAL === 0) {
    throw new Error(`ERRO: Registro de saida (ESTOQUE_PROD_SAI) nao foi criado. Romaneio: ${romaneioSaida}`);
  }

  const req10_2 = pool.request();
  req10_2.input('romaneioSaida', romaneioSaida);
  req10_2.input('filialOrigem', filialOrigemEscaped);
  req10_2.input('produto', produtoEscaped);
  const resultVerificarSaidaItem = await req10_2.query(`SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD1_SAI WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem AND PRODUTO = @produto`);
  if (resultVerificarSaidaItem.recordset[0]?.TOTAL === 0) {
    throw new Error(`ERRO: Item de saida (ESTOQUE_PROD1_SAI) nao foi criado. Romaneio: ${romaneioSaida}`);
  }

  const req10_3 = pool.request();
  req10_3.input('romaneioSaida', romaneioSaida);
  req10_3.input('filialOrigem', filialOrigemEscaped);
  const resultVerificarLojaSaidas = await req10_3.query(`SELECT COUNT(*) as TOTAL FROM LOJA_SAIDAS WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem`);
  if (resultVerificarLojaSaidas.recordset[0]?.TOTAL === 0) {
    throw new Error(`ERRO: Registro em LOJA_SAIDAS nao foi criado. Romaneio: ${romaneioSaida}`);
  }

  const req10_4 = pool.request();
  req10_4.input('romaneioSaida', romaneioSaida);
  req10_4.input('filialOrigem', filialOrigemEscaped);
  req10_4.input('produto', produtoEscaped);
  const resultVerificarLojaSaidasProduto = await req10_4.query(`SELECT COUNT(*) as TOTAL FROM LOJA_SAIDAS_PRODUTO WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem AND PRODUTO = @produto`);
  if (resultVerificarLojaSaidasProduto.recordset[0]?.TOTAL === 0) {
    throw new Error(`ERRO: Registro em LOJA_SAIDAS_PRODUTO nao foi criado. Romaneio: ${romaneioSaida}`);
  }

  const req10_5 = pool.request();
  req10_5.input('romaneioEntradaFinal', romaneioEntradaFinal);
  req10_5.input('filialDestino', filialDestinoEscaped);
  const resultVerificarEntrada = await req10_5.query(`SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD_ENT WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino`);

  if (resultVerificarEntrada.recordset[0]?.TOTAL > 0) {
    const req11 = pool.request();
    req11.input('tipoRomaneio', tipoRomaneio);
    req11.input('tipoEntrada', tipoEntrada);
    req11.input('cmOperacaoEntrada', cmOperacaoEntrada);
    req11.input('romaneioEntradaFinal', romaneioEntradaFinal);
    req11.input('filialDestino', filialDestinoEscaped);
    await req11.query(`
      UPDATE ESTOQUE_PROD_ENT
      SET TIPO_ROMANEIO = @tipoRomaneio, TIPO_ENTRADA = @tipoEntrada, CM_OPERACAO = @cmOperacaoEntrada
      WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino
    `);
    // Cabeçalho já existia: garantir que o item de entrada exista em ESTOQUE_PROD1_ENT
    const req11_item = pool.request();
    req11_item.input('romaneioEntradaFinal', romaneioEntradaFinal);
    req11_item.input('filialDestino', filialDestinoEscaped);
    req11_item.input('produto', produtoEscaped);
    const resultItemEntrada = await req11_item.query(`SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD1_ENT WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino AND PRODUTO = @produto`);
    if (resultItemEntrada.recordset[0]?.TOTAL === 0) {
      const req11_ins = pool.request();
      req11_ins.input('romaneioEntradaFinal', romaneioEntradaFinal);
      req11_ins.input('produto', produtoEscaped);
      req11_ins.input('filialDestino', filialDestinoEscaped);
      req11_ins.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
      req11_ins.input('qtdeEntrada', qtdeEntrada);
      await req11_ins.query(`
        INSERT INTO ESTOQUE_PROD1_ENT (ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE)
        VALUES (@romaneioEntradaFinal, @produto, @filialDestino, @corProduto, @qtdeEntrada)
      `);
    }
  } else {
    const req11_2 = pool.request();
    req11_2.input('romaneioEntradaFinal', romaneioEntradaFinal);
    req11_2.input('filialDestino', filialDestinoEscaped);
    const resultLojaEntradasInfo = await req11_2.query(`
      SELECT TOP 1 CONVERT(VARCHAR(19), EMISSAO, 120) AS EMISSAO_STR, FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, RESPONSAVEL
      FROM LOJA_ENTRADAS
      WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino
    `);

    let dataEntrada = dataStr;
    let filialOrigemEntrada = filialOrigemEscaped;
    let romaneioOrigemEntrada = romaneioSaida;
    let responsavelEntrada = responsavel || ' ';
    if (resultLojaEntradasInfo.recordset.length > 0) {
      const row = resultLojaEntradasInfo.recordset[0];
      // EMISSAO já vem como string 'YYYY-MM-DD HH:MM:SS' (sem round-trip por Date,
      // que reconverteria para UTC e somaria 3h de novo).
      dataEntrada = row.EMISSAO_STR ? String(row.EMISSAO_STR).replace('T', ' ') : dataStr;
      filialOrigemEntrada = row.FILIAL_ORIGEM?.toString().trim() || filialOrigemEscaped;
      romaneioOrigemEntrada = row.ROMANEIO_NF_SAIDA?.toString().trim() || romaneioSaida;
      responsavelEntrada = row.RESPONSAVEL?.toString().trim() || responsavel || ' ';
    }

    const req11_3 = pool.request();
    req11_3.input('romaneioEntradaFinal', romaneioEntradaFinal);
    req11_3.input('filialDestino', filialDestinoEscaped);
    req11_3.input('dataEntrada', dataEntrada);
    req11_3.input('responsavelEntrada', responsavelEntrada);
    req11_3.input('filialOrigemEntrada', filialOrigemEntrada);
    req11_3.input('romaneioOrigemEntrada', romaneioOrigemEntrada);
    req11_3.input('tipoRomaneio', tipoRomaneio);
    req11_3.input('tipoEntrada', tipoEntrada);
    req11_3.input('cmOperacaoEntrada', cmOperacaoEntrada);
    await req11_3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA, TIPO_ROMANEIO,
        TIPO_ENTRADA, CM_OPERACAO
      ) VALUES (
        @romaneioEntradaFinal, @filialDestino, @dataEntrada, @responsavelEntrada,
        @filialOrigemEntrada, @romaneioOrigemEntrada, @dataEntrada,
        GETDATE(), 0, 0, 0, 0, @tipoRomaneio, @tipoEntrada, @cmOperacaoEntrada
      )
    `);

    const req11_4 = pool.request();
    req11_4.input('romaneioEntradaFinal', romaneioEntradaFinal);
    req11_4.input('produto', produtoEscaped);
    req11_4.input('filialDestino', filialDestinoEscaped);
    req11_4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
    req11_4.input('qtdeEntrada', qtdeEntrada);
    await req11_4.query(`
      INSERT INTO ESTOQUE_PROD1_ENT (ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE)
      VALUES (@romaneioEntradaFinal, @produto, @filialDestino, @corProduto, @qtdeEntrada)
    `);
  }

  const req12 = pool.request();
  req12.input('romaneioEntradaFinal', romaneioEntradaFinal);
  req12.input('filialDestino', filialDestinoEscaped);
  req12.input('produto', produtoEscaped);
  const resultVerificarEntradaItem = await req12.query(`SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD1_ENT WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino AND PRODUTO = @produto`);
  if (resultVerificarEntradaItem.recordset[0]?.TOTAL === 0) {
    throw new Error(`ERRO: Item de entrada (ESTOQUE_PROD1_ENT) nao foi criado. Romaneio: ${romaneioEntradaFinal}`);
  }

  // 11. Atualizar estoques
  const produtoParaQuery = produto.trim();
  const filialOrigemParaQuery = filialOrigemNome.trim();
  const filialDestinoParaQuery = filialDestinoNome.trim();
  const corProdutoParaQuery = corProduto ? corProduto.trim() : null;

  const req13 = pool.request();
  req13.input('produtoParaQuery', produtoParaQuery);
  req13.input('filialOrigemParaQuery', filialOrigemParaQuery);
  const resultEstoqueOrigem = await req13.query(`
    SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
    FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
    WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialOrigemParaQuery
  `);

  if (resultEstoqueOrigem.recordset.length === 0) {
    throw new Error(`ERRO: Nenhum registro encontrado para Produto: '${produtoParaQuery}', Filial: '${filialOrigemParaQuery}'.`);
  }

  let rowEstoqueOrigem = null;
  if (corProdutoParaQuery) {
    for (const row of resultEstoqueOrigem.recordset) {
      const corBanco = row.COR_PRODUTO?.toString().trim() || '';
      if (corBanco === corProdutoParaQuery) {
        rowEstoqueOrigem = row;
        break;
      }
    }
    if (!rowEstoqueOrigem) {
      throw new Error(`ERRO: Nenhum registro encontrado com Cor: '${corProdutoParaQuery}'. Produto: '${produtoParaQuery}', Filial: '${filialOrigemParaQuery}'`);
    }
  } else {
    for (const row of resultEstoqueOrigem.recordset) {
      const corBanco = row.COR_PRODUTO?.toString().trim() || '';
      if (!corBanco) {
        rowEstoqueOrigem = row;
        break;
      }
    }
    if (!rowEstoqueOrigem) {
      throw new Error(`ERRO: Nenhum registro encontrado sem cor. Produto: '${produtoParaQuery}', Filial: '${filialOrigemParaQuery}'`);
    }
  }

  const produtoExato = rowEstoqueOrigem.PRODUTO.toString().trim();
  const filialExata = rowEstoqueOrigem.FILIAL.toString().trim();
  const corExata = rowEstoqueOrigem.COR_PRODUTO?.toString().trim() || '';

  const req14_verif = pool.request();
  req14_verif.input('produtoExato', produtoExato);
  req14_verif.input('filialExata', filialExata);
  if (corExata) req14_verif.input('corExata', corExata);
  const resultAntesUpdate = await req14_verif.query(corExata
    ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata`
    : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
  );
  if (resultAntesUpdate.recordset.length === 0) {
    throw new Error(`ERRO: Registro não encontrado antes do UPDATE. Produto: '${produtoExato}', Filial: '${filialExata}'`);
  }
  const estoqueAntesUpdate = resultAntesUpdate.recordset[0].ESTOQUE || 0;

  const req14 = pool.request();
  req14.input('qtdeSaida', qtdeSaida);
  req14.input('produtoExato', produtoExato);
  req14.input('filialExata', filialExata);
  if (corExata) req14.input('corExata', corExata);
  await req14.query(corExata
    ? `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE - @qtdeSaida WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata`
    : `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE - @qtdeSaida WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
  );

  const req14_depois = pool.request();
  req14_depois.input('produtoExato', produtoExato);
  req14_depois.input('filialExata', filialExata);
  if (corExata) req14_depois.input('corExata', corExata);
  const resultDepoisUpdate = await req14_depois.query(corExata
    ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata`
    : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
  );
  let estoqueDepoisUpdate = resultDepoisUpdate.recordset.length > 0 ? (resultDepoisUpdate.recordset[0].ESTOQUE || 0) : null;

  if (estoqueDepoisUpdate === null || estoqueDepoisUpdate !== estoqueAntesUpdate - qtdeSaida) {
    if (estoqueDepoisUpdate === null || estoqueDepoisUpdate === estoqueAntesUpdate) {
      const novoEstoque = estoqueAntesUpdate - qtdeSaida;
      const req14_alt = pool.request();
      req14_alt.input('novoEstoque', novoEstoque);
      req14_alt.input('produtoExato', produtoExato);
      req14_alt.input('filialExata', filialExata);
      if (corExata) req14_alt.input('corExata', corExata);
      await req14_alt.query(corExata
        ? `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = @novoEstoque WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata`
        : `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = @novoEstoque WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
      );
      const req14_verif_alt = pool.request();
      req14_verif_alt.input('produtoExato', produtoExato);
      req14_verif_alt.input('filialExata', filialExata);
      if (corExata) req14_verif_alt.input('corExata', corExata);
      const resultDepoisAlt = await req14_verif_alt.query(corExata
        ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata`
        : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
      );
      const estoqueDepoisAlt = resultDepoisAlt.recordset.length > 0 ? (resultDepoisAlt.recordset[0].ESTOQUE || 0) : null;
      if (estoqueDepoisAlt !== novoEstoque) {
        throw new Error(`ERRO: Estoque de origem não foi atualizado corretamente. Esperado: ${novoEstoque}, Atual: ${estoqueDepoisAlt}`);
      }
    } else {
      throw new Error(`ERRO: Estoque de origem não foi atualizado corretamente. Esperado: ${estoqueAntesUpdate - qtdeSaida}, Atual: ${estoqueDepoisUpdate}`);
    }
  }

  const req15 = pool.request();
  req15.input('produtoParaQuery', produtoParaQuery);
  req15.input('filialDestinoParaQuery', filialDestinoParaQuery);
  if (corProdutoParaQuery) req15.input('corProdutoParaQuery', corProdutoParaQuery);
  const resultCheckDestino = await req15.query(corProdutoParaQuery
    ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialDestinoParaQuery AND COR_PRODUTO = @corProdutoParaQuery`
    : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialDestinoParaQuery AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
  );
  const existeEstoque = resultCheckDestino.recordset.length > 0;
  const estoqueDestinoAntes = existeEstoque && resultCheckDestino.recordset[0].ESTOQUE ? resultCheckDestino.recordset[0].ESTOQUE : 0;

  if (existeEstoque) {
    const req15_1 = pool.request();
    req15_1.input('produtoParaQuery', produtoParaQuery);
    req15_1.input('filialDestinoParaQuery', filialDestinoParaQuery);
    const resultDestinoExato = await req15_1.query(`
      SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
      FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
      WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialDestinoParaQuery
    `);

    let rowDestinoExato = null;
    if (corProdutoParaQuery) {
      for (const row of resultDestinoExato.recordset) {
        if ((row.COR_PRODUTO?.toString().trim() || '') === corProdutoParaQuery) {
          rowDestinoExato = row;
          break;
        }
      }
    } else {
      for (const row of resultDestinoExato.recordset) {
        if (!(row.COR_PRODUTO?.toString().trim() || '')) {
          rowDestinoExato = row;
          break;
        }
      }
    }

    if (!rowDestinoExato) {
      throw new Error(`ERRO: Registro de destino não encontrado. Produto: '${produtoParaQuery}', Filial: '${filialDestinoParaQuery}'`);
    }

    const produtoDestinoExato = rowDestinoExato.PRODUTO.toString().trim();
    const filialDestinoExata = rowDestinoExato.FILIAL.toString().trim();
    const corDestinoExata = rowDestinoExato.COR_PRODUTO?.toString().trim() || '';
    const estoqueDestinoAntesUpdate = rowDestinoExato.ESTOQUE || 0;

    const req16 = pool.request();
    req16.input('qtdeEntrada', qtdeEntrada);
    req16.input('produtoDestinoExato', produtoDestinoExato);
    req16.input('filialDestinoExata', filialDestinoExata);
    if (corDestinoExata) req16.input('corDestinoExata', corDestinoExata);
    await req16.query(corDestinoExata
      ? `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE + @qtdeEntrada WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata`
      : `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = ESTOQUE + @qtdeEntrada WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
    );

    const req16_depois = pool.request();
    req16_depois.input('produtoDestinoExato', produtoDestinoExato);
    req16_depois.input('filialDestinoExata', filialDestinoExata);
    if (corDestinoExata) req16_depois.input('corDestinoExata', corDestinoExata);
    const resultDestinoDepois = await req16_depois.query(corDestinoExata
      ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata`
      : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
    );
    let estoqueDestinoDepois = resultDestinoDepois.recordset.length > 0 ? (resultDestinoDepois.recordset[0].ESTOQUE || 0) : null;

    if (estoqueDestinoDepois === null || estoqueDestinoDepois !== estoqueDestinoAntesUpdate + qtdeEntrada) {
      if (estoqueDestinoDepois === null || estoqueDestinoDepois === estoqueDestinoAntesUpdate) {
        const novoEstoqueDestino = estoqueDestinoAntesUpdate + qtdeEntrada;
        const req16_alt = pool.request();
        req16_alt.input('novoEstoqueDestino', novoEstoqueDestino);
        req16_alt.input('produtoDestinoExato', produtoDestinoExato);
        req16_alt.input('filialDestinoExata', filialDestinoExata);
        if (corDestinoExata) req16_alt.input('corDestinoExata', corDestinoExata);
        await req16_alt.query(corDestinoExata
          ? `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = @novoEstoqueDestino WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata`
          : `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = @novoEstoqueDestino WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
        );
        const req16_verif_alt = pool.request();
        req16_verif_alt.input('produtoDestinoExato', produtoDestinoExato);
        req16_verif_alt.input('filialDestinoExata', filialDestinoExata);
        if (corDestinoExata) req16_verif_alt.input('corDestinoExata', corDestinoExata);
        const resultDestinoAlt = await req16_verif_alt.query(corDestinoExata
          ? `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata`
          : `SELECT ESTOQUE FROM ESTOQUE_PRODUTOS WITH (NOLOCK) WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')`
        );
        estoqueDestinoDepois = resultDestinoAlt.recordset.length > 0 ? (resultDestinoAlt.recordset[0].ESTOQUE || 0) : null;
        if (estoqueDestinoDepois !== novoEstoqueDestino) {
          throw new Error(`ERRO: Estoque de destino não foi atualizado corretamente. Esperado: ${novoEstoqueDestino}, Atual: ${estoqueDestinoDepois}`);
        }
      } else {
        throw new Error(`ERRO: Estoque de destino não foi atualizado corretamente. Esperado: ${estoqueDestinoAntesUpdate + qtdeEntrada}, Atual: ${estoqueDestinoDepois}`);
      }
    }
  } else {
    const req17 = pool.request();
    req17.input('produtoParaQuery', produtoParaQuery);
    req17.input('corProdutoParaQuery', corProdutoParaQuery);
    req17.input('filialDestinoParaQuery', filialDestinoParaQuery);
    req17.input('qtdeEntrada', qtdeEntrada);
    await req17.query(`
      INSERT INTO ESTOQUE_PRODUTOS (PRODUTO, COR_PRODUTO, FILIAL, ESTOQUE)
      VALUES (@produtoParaQuery, @corProdutoParaQuery, @filialDestinoParaQuery, @qtdeEntrada)
    `);
  }

  return {
    success: true,
    romaneioSaida,
    romaneioEntrada: romaneioEntradaFinal,
    message: `Transferência executada com sucesso! Romaneio Saída: ${romaneioSaida}, Romaneio Entrada: ${romaneioEntradaFinal}`,
  };
}

module.exports = { executeTransfer };

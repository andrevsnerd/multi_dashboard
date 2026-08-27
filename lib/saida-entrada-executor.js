/**
 * Executor de saída/entrada isolada de produtos
 * Baseado no transfer-executor.js, mas adaptado para apenas um fluxo (saída OU entrada)
 */

const sql = require('mssql');

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
 * Datas no relógio do SQL Server (horário de Brasília).
 *
 * O Linx grava EMISSAO como data contábil, sempre à meia-noite. Gravar hora
 * nesse campo deixa o romaneio fora das consultas que filtram `EMISSAO = data`.
 * DATA_PARA_TRANSFERENCIA continua recebendo o instante real da operação.
 */
async function getDbDateStrings(pool) {
  try {
    const r = await pool.request().query(`
      SELECT
        CONVERT(VARCHAR(10), GETDATE(), 23) + ' 00:00:00' AS DOCUMENT_DATE,
        CONVERT(VARCHAR(19), GETDATE(), 120) AS NOW
    `);
    const documentDate = r.recordset[0]?.DOCUMENT_DATE;
    const now = r.recordset[0]?.NOW;
    if (documentDate && now) {
      return {
        documentDate: String(documentDate).replace('T', ' '),
        now: String(now).replace('T', ' '),
      };
    }
  } catch {
    // cai no fallback abaixo
  }

  const now = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ');
  return {
    documentDate: `${now.slice(0, 10)} 00:00:00`,
    now,
  };
}

/**
 * Mantém cabeçalho, itens, estoque e sequencial no mesmo commit quando há uma
 * conexão SQL direta, evitando romaneios parciais em caso de falha no lote.
 */
async function executeInTransaction(pool, handler) {
  if (!(pool instanceof sql.ConnectionPool)) {
    return handler(pool);
  }

  const transaction = new sql.Transaction(pool);
  await transaction.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
  try {
    const result = await handler(transaction);
    await transaction.commit();
    return result;
  } catch (error) {
    try {
      await transaction.rollback();
    } catch {
      // Triggers do Linx podem encerrar a transacao antes deste rollback.
    }
    throw error;
  }
}

/**
 * UPDATE que marca uma entrada DIRETA recém-criada como já conferida
 * (STATUS_TRANSITO=4, ENTRADA_CONFERIDA=1), para que ela não apareça no
 * trânsito do Linx. Deve ser anexado ao mesmo batch do INSERT em LOJA_ENTRADAS
 * (usa @romaneioEntrada e @filial já vinculados na request).
 *
 * Não seta DATA_ENTRADA_CONFERIDA de propósito: o trigger LXU_LOJA_ENTRADAS
 * preenche essa data quando ENTRADA_CONFERIDA passa a 1 (fluxo natural do Linx).
 * Não toca ENTRADA_ENCERRADA (já é 1) para não acionar a lógica de estoque do
 * trigger via UPDATE(ENTRADA_ENCERRADA).
 *
 * Guardas: só age em entrada direta (sem FILIAL_ORIGEM e sem LOJA_ENTRADAS_PRODUTO),
 * preservando transferências faturadas pela matriz, que devem seguir trânsito.
 */
function montarUpdateEntradaConferida() {
  return `
    UPDATE LOJA_ENTRADAS
       SET ENTRADA_CONFERIDA = 1,
           STATUS_TRANSITO = 4
     WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioEntrada
       AND LTRIM(RTRIM(FILIAL)) = @filial
       AND ISNULL(LTRIM(RTRIM(FILIAL_ORIGEM)), '') = ''
       AND ISNULL(ENTRADA_ENCERRADA, 0) = 1
       AND NOT EXISTS (
         SELECT 1 FROM LOJA_ENTRADAS_PRODUTO lep
          WHERE lep.ROMANEIO_PRODUTO = LOJA_ENTRADAS.ROMANEIO_PRODUTO
            AND lep.FILIAL = LOJA_ENTRADAS.FILIAL
       );`;
}

/**
 * Executa uma saída isolada (sem entrada correspondente)
 */
async function executeSaidaCore(pool, params) {
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
  const { documentDate: emissaoStr, now: dataStr } = await getDbDateStrings(pool);

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
  req3.input('emissaoStr', emissaoStr);
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
        @romaneioSaida, @filial, @emissaoStr, @responsavel,
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
        @romaneioSaida, @filial, @emissaoStr, @responsavel,
        @filialDestinoValor, @romaneioDestinoValor, @dataStr,
        GETDATE(), 0, 0, 0, @tipoRomaneio, @cmOperacao
      )
    `);
  }

  // Inserir ESTOQUE_PROD1_SAI
  // SA_N populado para que o trigger LXI_ESTOQUE_PROD1_SAI atualize ESTOQUE_PRODUTOS automaticamente
  const tamBaseSaida = await getTamanhoBase(pool, produto);
  const saCol = 'SA_' + tamBaseSaida;
  const req4 = pool.request();
  req4.input('filial', filialEscaped);
  req4.input('romaneioSaida', romaneioSaida);
  req4.input('produto', produtoEscaped);
  req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
  req4.input('quantidade', quantidade);
  await req4.query(`
    INSERT INTO ESTOQUE_PROD1_SAI (
      FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM, ${saCol}
    ) VALUES (@filial, @romaneioSaida, @produto, @corProduto, @quantidade, 0, @quantidade)
  `);

  // Inserir LOJA_SAIDAS
  // IMPORTANTE: Usar NULL para FILIAL_DESTINO (consistente com ESTOQUE_PROD_SAI)
  // Se a coluna não aceitar NULL, isso causará um erro diferente que podemos tratar
  const req5 = pool.request();
  req5.input('romaneioSaida', romaneioSaida);
  req5.input('filial', filialEscaped);
  req5.input('emissaoStr', emissaoStr);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('quantidade', quantidade);
  req5.input('filialDestinoValor', filialDestinoValor); // NULL
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL, TIPO_ENTRADA_SAIDA,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA, OBS
      ) VALUES (
        @romaneioSaida, @filial, @emissaoStr, @responsavel, 'S ',
        @filialDestinoValor, '', 0, @quantidade, 0, 0, @dataStr, 1, 0, @observacao
      )
    `);
  } else {
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL, TIPO_ENTRADA_SAIDA,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA
      ) VALUES (
        @romaneioSaida, @filial, @emissaoStr, @responsavel, 'S ',
        @filialDestinoValor, '', 0, @quantidade, 0, 0, @dataStr, 1, 0
      )
    `);
  }

  // NOTA: Não inserimos em LOJA_SAIDAS_PRODUTO para saídas isoladas
  // porque a trigger LXI_LOJA_SAIDAS_PRODUTO espera um contexto de transferência completa
  // (com stored procedure LX_GERA_TRANSFERENCIA_AUTOMATICA) que não temos aqui.
  // 
  // A saída está registrada em:
  // - ESTOQUE_PROD_SAI (cabeçalho)
  // - ESTOQUE_PROD1_SAI (itens)
  // - LOJA_SAIDAS (cabeçalho)
  //
  // O log de saídas foi ajustado para buscar produtos de ESTOQUE_PROD1_SAI quando
  // LOJA_SAIDAS_PRODUTO não existir, então o log funcionará corretamente.

  // ESTOQUE_PRODUTOS atualizado automaticamente pelo trigger LXI_ESTOQUE_PROD1_SAI via SA_N

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
async function executeEntradaCore(pool, params) {
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
  const { documentDate: emissaoStr, now: dataStr } = await getDbDateStrings(pool);

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
  // NOTA: TIPO_ROMANEIO omitido — o trigger LXI_ESTOQUE_PROD_ENT verifica ESTOQUE_ROMANEIO_TIPO
  // e 'ENTRADA AVULSA' não existe nessa tabela. Omitir faz UPDATE(TIPO_ROMANEIO)=FALSE no trigger.
  const req3 = pool.request();
  req3.input('romaneioEntrada', romaneioEntrada);
  req3.input('filial', filialEscaped);
  req3.input('emissaoStr', emissaoStr);
  req3.input('dataStr', dataStr);
  req3.input('responsavel', responsavel || ' ');
  req3.input('tipoEntrada', tipoEntrada);
  req3.input('cmOperacaoEntrada', cmOperacaoEntrada);
  if (observacaoEscaped) {
    req3.input('observacao', observacaoEscaped);
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA,
        TIPO_ENTRADA, CM_OPERACAO, OBS
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, @dataStr,
        GETDATE(), 0, 0, 0, 0, @tipoEntrada, @cmOperacaoEntrada, @observacao
      )
    `);
  } else {
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA,
        TIPO_ENTRADA, CM_OPERACAO
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, @dataStr,
        GETDATE(), 0, 0, 0, 0, @tipoEntrada, @cmOperacaoEntrada
      )
    `);
  }

  // Inserir ESTOQUE_PROD1_ENT
  // EN_N populado para que o trigger LXI_ESTOQUE_PROD1_ENT atualize ESTOQUE_PRODUTOS automaticamente
  const tamBaseEntrada = await getTamanhoBase(pool, produto);
  const enCol = 'EN_' + tamBaseEntrada;
  const req4 = pool.request();
  req4.input('romaneioEntrada', romaneioEntrada);
  req4.input('produto', produtoEscaped);
  req4.input('filial', filialEscaped);
  req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : '');
  req4.input('quantidade', quantidade);
  await req4.query(`
    INSERT INTO ESTOQUE_PROD1_ENT (ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE, ${enCol})
    VALUES (@romaneioEntrada, @produto, @filial, @corProduto, @quantidade, @quantidade)
  `);

  // Inserir LOJA_ENTRADAS
  // NOTA: LOJA_ENTRADAS não tem a coluna INDICA_DEVOLUCAO (diferente de LOJA_SAIDAS)
  // NUMERO_NF_TRANSFERENCIA não pode ser NULL, usar string vazia ''
  const req5 = pool.request();
  req5.input('romaneioEntrada', romaneioEntrada);
  req5.input('filial', filialEscaped);
  req5.input('emissaoStr', emissaoStr);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('quantidade', quantidade);
  // Marca como conferida no mesmo batch — ver montarUpdateEntradaConferida().
  const marcarConferida = montarUpdateEntradaConferida();
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_ENTRADAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, NUMERO_NF_TRANSFERENCIA,
        QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, ENTRADA_ENCERRADA, ENTRADA_CANCELADA, OBS
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, '', @quantidade, 0, 0, @dataStr, 1, 0, @observacao
      )
      ${marcarConferida}
    `);
  } else {
    await req5.query(`
      INSERT INTO LOJA_ENTRADAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, NUMERO_NF_TRANSFERENCIA,
        QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, ENTRADA_ENCERRADA, ENTRADA_CANCELADA
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, '', @quantidade, 0, 0, @dataStr, 1, 0
      )
      ${marcarConferida}
    `);
  }

  // ESTOQUE_PRODUTOS atualizado automaticamente pelo trigger LXI_ESTOQUE_PROD1_ENT via EN_N

  // Atualizar SEQUENCIAIS para entrada (igual ao que fazemos para saída)
  try {
    const reqSeq = pool.request();
    reqSeq.input('romaneioEntrada', romaneioEntrada);
    await reqSeq.query(`UPDATE SEQUENCIAIS SET SEQUENCIA = @romaneioEntrada WHERE TABELA_COLUNA = 'ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO'`);
  } catch (seqError) {
    // Se não existir a coluna ou tabela, não é crítico
    console.warn('Aviso: Não foi possível atualizar SEQUENCIAIS para entrada:', seqError.message);
  }

  return {
    success: true,
    romaneio: romaneioEntrada,
    message: `Entrada executada com sucesso! Romaneio: ${romaneioEntrada}`,
  };
}

/**
 * Executa uma saída em lote — vários itens em um único romaneio
 * @param {object} pool
 * @param {{ itens: Array<{produto:string,corProduto:string|null,quantidade:number}>, filial:string, tipoRomaneio?:string, responsavel?:string, observacao?:string|null }} params
 */
async function executeSaidaLoteCore(pool, params) {
  const {
    itens,
    filial,
    filialDestino = null,
    tipoRomaneio = 'TRANSFERENCIA',
    responsavel = 'LOGISTICA',
    observacao = null,
  } = params;

  if (!itens || itens.length === 0) throw new Error('Nenhum item para saída em lote');

  const observacaoEscaped = observacao ? observacao.replace(/'/g, "''") : null;
  const { documentDate: emissaoStr, now: dataStr } = await getDbDateStrings(pool);

  // Buscar nome da filial (uma vez)
  const req0 = pool.request();
  req0.input('filial', filial);
  const resultNomesFiliais = await req0.query(`
    SELECT COD_FILIAL, FILIAL
    FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL = @filial
  `);

  let filialNome = filial;
  if (resultNomesFiliais.recordset.length > 0) {
    filialNome = resultNomesFiliais.recordset[0].FILIAL?.toString().trim() || filial;
  } else {
    const req0b = pool.request();
    req0b.input('filial', filial);
    const resultByNome = await req0b.query(`
      SELECT COD_FILIAL, FILIAL FROM FILIAIS WITH (NOLOCK) WHERE FILIAL = @filial
    `);
    if (resultByNome.recordset.length > 0) {
      filialNome = resultByNome.recordset[0].FILIAL?.toString().trim() || filial;
    }
  }

  const filialEscaped = filialNome.replace(/'/g, "''");

  // Resolver nome da filial destino (se fornecida)
  let filialDestinoNome = null;
  if (filialDestino) {
    const reqFD = pool.request();
    reqFD.input('filialDestino', filialDestino);
    const resultFD = await reqFD.query(`
      SELECT FILIAL FROM FILIAIS WITH (NOLOCK)
      WHERE COD_FILIAL = @filialDestino OR FILIAL = @filialDestino
    `);
    if (resultFD.recordset.length > 0) {
      filialDestinoNome = resultFD.recordset[0].FILIAL?.toString().trim() || filialDestino;
    } else {
      filialDestinoNome = filialDestino;
    }
  }
  const filialDestinoValor = filialDestinoNome || null;

  // Gerar próximo romaneio de saída — atômico via SEQUENCIAIS (evita duplicatas em requisições concorrentes)
  // OUTPUT INTO @var contorna a restrição de triggers habilitados na tabela SEQUENCIAIS
  const reqSeqSaida = pool.request();
  const resultSeqSaida = await reqSeqSaida.query(`
    DECLARE @outSaida TABLE (ROMANEIO_NOVO VARCHAR(10))
    IF NOT EXISTS (SELECT 1 FROM SEQUENCIAIS WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO')
    BEGIN
      DECLARE @baseSaida VARCHAR(10) = '016042'
      SELECT TOP 1 @baseSaida = LTRIM(RTRIM(ROMANEIO_PRODUTO))
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1 AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
      ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
      INSERT INTO SEQUENCIAIS (TABELA_COLUNA, SEQUENCIA)
      VALUES ('ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO', ISNULL(@baseSaida, '016042'))
    END
    UPDATE SEQUENCIAIS
    SET SEQUENCIA = RIGHT('000000' + CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(10)), 6)
    OUTPUT INSERTED.SEQUENCIA INTO @outSaida(ROMANEIO_NOVO)
    WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'
    SELECT ROMANEIO_NOVO FROM @outSaida
  `);
  const romaneioSaida = resultSeqSaida.recordset[0]?.ROMANEIO_NOVO?.toString().trim();
  if (!romaneioSaida) throw new Error('Falha ao gerar número de romaneio de saída. Verifique a tabela SEQUENCIAIS.');

  // Calcular totais
  const qtdeTotal = itens.reduce((s, it) => s + it.quantidade, 0);

  // Inserir cabeçalho ESTOQUE_PROD_SAI (uma vez)
  const req3 = pool.request();
  req3.input('romaneioSaida', romaneioSaida);
  req3.input('filial', filialEscaped);
  req3.input('emissaoStr', emissaoStr);
  req3.input('dataStr', dataStr);
  req3.input('responsavel', responsavel || ' ');
  req3.input('tipoRomaneio', tipoRomaneio);
  req3.input('cmOperacao', '011');
  req3.input('filialDestinoValor', filialDestinoValor);
  if (observacaoEscaped) {
    req3.input('observacao', observacaoEscaped);
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_SAI (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, ROMANEIO_DESTINO, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, NAO_VALIDAR_ENTRADA, MOV_INTERNA,
        TIPO_ROMANEIO, CM_OPERACAO, OBS
      ) VALUES (
        @romaneioSaida, @filial, @emissaoStr, @responsavel,
        @filialDestinoValor, NULL, @dataStr,
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
        @romaneioSaida, @filial, @emissaoStr, @responsavel,
        @filialDestinoValor, NULL, @dataStr,
        GETDATE(), 0, 0, 0, @tipoRomaneio, @cmOperacao
      )
    `);
  }

  // Inserir itens em ESTOQUE_PROD1_SAI e atualizar estoque (um por item)
  for (const item of itens) {
    const produtoEscaped = item.produto.replace(/'/g, "''");
    const corEscaped = item.corProduto ? item.corProduto.replace(/'/g, "''") : null;

    // SA_N populado para que o trigger LXI_ESTOQUE_PROD1_SAI atualize ESTOQUE_PRODUTOS automaticamente
    const tamBaseSaidaLote = await getTamanhoBase(pool, item.produto);
    const saColLote = 'SA_' + tamBaseSaidaLote;
    const req4 = pool.request();
    req4.input('filial', filialEscaped);
    req4.input('romaneioSaida', romaneioSaida);
    req4.input('produto', produtoEscaped);
    req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : null);
    req4.input('quantidade', item.quantidade);
    await req4.query(`
      INSERT INTO ESTOQUE_PROD1_SAI (
        FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM, ${saColLote}
      ) VALUES (@filial, @romaneioSaida, @produto, @corProduto, @quantidade, 0, @quantidade)
    `);
    // ESTOQUE_PRODUTOS atualizado automaticamente pelo trigger via SA_N
  }

  // Inserir cabeçalho LOJA_SAIDAS (uma vez, com qtde total)
  const req5 = pool.request();
  req5.input('romaneioSaida', romaneioSaida);
  req5.input('filial', filialEscaped);
  req5.input('emissaoStr', emissaoStr);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('qtdeTotal', qtdeTotal);
  req5.input('filialDestinoValor', filialDestinoValor);
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL, TIPO_ENTRADA_SAIDA,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA, OBS
      ) VALUES (
        @romaneioSaida, @filial, @emissaoStr, @responsavel, 'S ',
        @filialDestinoValor, '', 0, @qtdeTotal, 0, 0, @dataStr, 1, 0, @observacao
      )
    `);
  } else {
    await req5.query(`
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL, TIPO_ENTRADA_SAIDA,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA
      ) VALUES (
        @romaneioSaida, @filial, @emissaoStr, @responsavel, 'S ',
        @filialDestinoValor, '', 0, @qtdeTotal, 0, 0, @dataStr, 1, 0
      )
    `);
  }

  return {
    success: true,
    romaneio: romaneioSaida,
    message: `Saída em lote executada com sucesso! Romaneio: ${romaneioSaida}`,
  };
}

/**
 * Executa uma entrada em lote — vários itens em um único romaneio
 * @param {object} pool
 * @param {{ itens: Array<{produto:string,corProduto:string|null,quantidade:number}>, filial:string, tipoRomaneio?:string, responsavel?:string, observacao?:string|null, gravarTipoRomaneio?:boolean }} params
 */
async function executeEntradaLoteCore(pool, params) {
  const {
    itens,
    filial,
    tipoRomaneio = 'ENTRADA AVULSA',
    responsavel = 'LOGISTICA',
    observacao = null,
    gravarTipoRomaneio = false,
  } = params;

  if (!itens || itens.length === 0) throw new Error('Nenhum item para entrada em lote');

  const observacaoEscaped = observacao ? observacao.replace(/'/g, "''") : null;
  const { documentDate: emissaoStr, now: dataStr } = await getDbDateStrings(pool);

  // Buscar nome da filial (uma vez)
  const req0 = pool.request();
  req0.input('filial', filial);
  const resultNomesFiliais = await req0.query(`
    SELECT COD_FILIAL, FILIAL FROM FILIAIS WITH (NOLOCK) WHERE COD_FILIAL = @filial
  `);

  let filialNome = filial;
  if (resultNomesFiliais.recordset.length > 0) {
    filialNome = resultNomesFiliais.recordset[0].FILIAL?.toString().trim() || filial;
  } else {
    const req0b = pool.request();
    req0b.input('filial', filial);
    const resultByNome = await req0b.query(`
      SELECT COD_FILIAL, FILIAL FROM FILIAIS WITH (NOLOCK) WHERE FILIAL = @filial
    `);
    if (resultByNome.recordset.length > 0) {
      filialNome = resultByNome.recordset[0].FILIAL?.toString().trim() || filial;
    }
  }

  const filialEscaped = filialNome.replace(/'/g, "''");

  // Gerar próximo romaneio de entrada — atômico via SEQUENCIAIS (evita duplicatas em requisições concorrentes)
  // OUTPUT INTO @var contorna a restrição de triggers habilitados na tabela SEQUENCIAIS
  const reqSeqEnt = pool.request();
  const resultSeqEnt = await reqSeqEnt.query(`
    DECLARE @outEnt TABLE (ROMANEIO_NOVO VARCHAR(10))
    IF NOT EXISTS (SELECT 1 FROM SEQUENCIAIS WHERE TABELA_COLUNA = 'ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO')
    BEGIN
      DECLARE @baseEnt VARCHAR(10) = '016042'
      SELECT TOP 1 @baseEnt = LTRIM(RTRIM(ROMANEIO_PRODUTO))
      FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
      WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1 AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
      ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
      INSERT INTO SEQUENCIAIS (TABELA_COLUNA, SEQUENCIA)
      VALUES ('ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO', ISNULL(@baseEnt, '016042'))
    END
    UPDATE SEQUENCIAIS
    SET SEQUENCIA = RIGHT('000000' + CAST(CAST(SEQUENCIA AS INT) + 1 AS VARCHAR(10)), 6)
    OUTPUT INSERTED.SEQUENCIA INTO @outEnt(ROMANEIO_NOVO)
    WHERE TABELA_COLUNA = 'ESTOQUE_PROD_ENT.ROMANEIO_PRODUTO'
    SELECT ROMANEIO_NOVO FROM @outEnt
  `);
  const romaneioEntrada = resultSeqEnt.recordset[0]?.ROMANEIO_NOVO?.toString().trim();
  if (!romaneioEntrada) throw new Error('Falha ao gerar número de romaneio de entrada. Verifique a tabela SEQUENCIAIS.');

  // Calcular totais
  const qtdeTotal = itens.reduce((s, it) => s + it.quantidade, 0);
  const tipoEntrada = determinarTipoEntrada(tipoRomaneio);
  const cmOperacaoEntrada = '003';

  // Inserir cabeçalho ESTOQUE_PROD_ENT (uma vez)
  // NOTA: por padrão TIPO_ROMANEIO é omitido do INSERT propositalmente.
  // O trigger LXI_ESTOQUE_PROD_ENT é um RESTRICT tipo FK: quando TIPO_ROMANEIO é gravado
  // e não-nulo, exige linha correspondente em ESTOQUE_ROMANEIO_TIPO. 'ENTRADA AVULSA' não
  // existe nessa tabela, então omitir a coluna faz UPDATE(TIPO_ROMANEIO)=FALSE e a
  // verificação nem roda. O campo fica NULL (2581+ registros existentes já são NULL).
  //
  // `gravarTipoRomaneio: true` grava o tipo — use SOMENTE com um tipo que EXISTE no
  // cadastro (ex.: 'VM'), senão o trigger aborta a operação. É o que permite a entrada
  // nascer identificada pelo tipo, em vez de anônima.
  const colTipoRomaneio = gravarTipoRomaneio ? 'TIPO_ROMANEIO, ' : '';
  const valTipoRomaneio = gravarTipoRomaneio ? '@tipoRomaneio, ' : '';
  const req3 = pool.request();
  req3.input('romaneioEntrada', romaneioEntrada);
  req3.input('filial', filialEscaped);
  req3.input('emissaoStr', emissaoStr);
  req3.input('dataStr', dataStr);
  req3.input('responsavel', responsavel || ' ');
  req3.input('tipoEntrada', tipoEntrada);
  req3.input('cmOperacaoEntrada', cmOperacaoEntrada);
  if (gravarTipoRomaneio) req3.input('tipoRomaneio', tipoRomaneio);
  if (observacaoEscaped) {
    req3.input('observacao', observacaoEscaped);
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA,
        ${colTipoRomaneio}TIPO_ENTRADA, CM_OPERACAO, OBS
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, @dataStr,
        GETDATE(), 0, 0, 0, 0, ${valTipoRomaneio}@tipoEntrada, @cmOperacaoEntrada, @observacao
      )
    `);
  } else {
    await req3.query(`
      INSERT INTO ESTOQUE_PROD_ENT (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_ORIGEM, DATA_PARA_TRANSFERENCIA,
        DATA_DIGITACAO, SEGUNDA_QUALIDADE, ACERTO_ENTRADA,
        NAO_VALIDAR_ENTRADA, NF_ENTRADA_PROPRIA,
        ${colTipoRomaneio}TIPO_ENTRADA, CM_OPERACAO
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, @dataStr,
        GETDATE(), 0, 0, 0, 0, ${valTipoRomaneio}@tipoEntrada, @cmOperacaoEntrada
      )
    `);
  }

  // Inserir itens em ESTOQUE_PROD1_ENT e atualizar estoque (um por item)
  for (const item of itens) {
    const produtoEscaped = item.produto.replace(/'/g, "''");
    const corEscaped = item.corProduto ? item.corProduto.replace(/'/g, "''") : null;

    // EN_N populado para que o trigger LXI_ESTOQUE_PROD1_ENT atualize ESTOQUE_PRODUTOS automaticamente
    const tamBaseEntradaLote = await getTamanhoBase(pool, item.produto);
    const enColLote = 'EN_' + tamBaseEntradaLote;
    const req4 = pool.request();
    req4.input('romaneioEntrada', romaneioEntrada);
    req4.input('produto', produtoEscaped);
    req4.input('filial', filialEscaped);
    req4.input('corProduto', corEscaped && corEscaped.trim() ? corEscaped : '');
    req4.input('quantidade', item.quantidade);
    await req4.query(`
      INSERT INTO ESTOQUE_PROD1_ENT (ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE, ${enColLote})
      VALUES (@romaneioEntrada, @produto, @filial, @corProduto, @quantidade, @quantidade)
    `);
    // ESTOQUE_PRODUTOS atualizado automaticamente pelo trigger via EN_N
  }

  // Inserir cabeçalho LOJA_ENTRADAS (uma vez, com qtde total)
  // No mesmo batch, já marca a entrada como CONFERIDA (entrada direta da filial,
  // sem origem). Isso evita o "trânsito fake" do Linx: uma entrada direta nasce
  // já conferida (STATUS_TRANSITO=4, ENTRADA_CONFERIDA=1) — exatamente o estado
  // natural das demais entradas diretas do Linx. O UPDATE dispara o trigger
  // LXU_LOJA_ENTRADAS, que preenche DATA_ENTRADA_CONFERIDA sozinho.
  // A guarda (FILIAL_ORIGEM vazio / sem LOJA_ENTRADAS_PRODUTO) garante que
  // transferências faturadas pela matriz (que devem seguir trânsito) nunca são tocadas.
  const req5 = pool.request();
  req5.input('romaneioEntrada', romaneioEntrada);
  req5.input('filial', filialEscaped);
  req5.input('emissaoStr', emissaoStr);
  req5.input('dataStr', dataStr);
  req5.input('responsavel', responsavel || ' ');
  req5.input('qtdeTotal', qtdeTotal);
  const marcarConferida = montarUpdateEntradaConferida();
  if (observacaoEscaped) {
    req5.input('observacao', observacaoEscaped);
    await req5.query(`
      INSERT INTO LOJA_ENTRADAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, NUMERO_NF_TRANSFERENCIA,
        QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, ENTRADA_ENCERRADA, ENTRADA_CANCELADA, OBS
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, '', @qtdeTotal, 0, 0, @dataStr, 1, 0, @observacao
      )
      ${marcarConferida}
    `);
  } else {
    await req5.query(`
      INSERT INTO LOJA_ENTRADAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, NUMERO_NF_TRANSFERENCIA,
        QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, ENTRADA_ENCERRADA, ENTRADA_CANCELADA
      ) VALUES (
        @romaneioEntrada, @filial, @emissaoStr, @responsavel,
        NULL, NULL, '', @qtdeTotal, 0, 0, @dataStr, 1, 0
      )
      ${marcarConferida}
    `);
  }

  return {
    success: true,
    romaneio: romaneioEntrada,
    message: `Entrada em lote executada com sucesso! Romaneio: ${romaneioEntrada}`,
  };
}

async function executeSaida(pool, params) {
  return executeInTransaction(pool, (transaction) => executeSaidaCore(transaction, params));
}

async function executeEntrada(pool, params) {
  return executeInTransaction(pool, (transaction) => executeEntradaCore(transaction, params));
}

async function executeSaidaLote(pool, params) {
  return executeInTransaction(pool, (transaction) => executeSaidaLoteCore(transaction, params));
}

async function executeEntradaLote(pool, params) {
  return executeInTransaction(pool, (transaction) => executeEntradaLoteCore(transaction, params));
}

module.exports = { executeSaida, executeEntrada, executeSaidaLote, executeEntradaLote };

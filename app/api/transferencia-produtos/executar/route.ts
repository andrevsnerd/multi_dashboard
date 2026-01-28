import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy } from '@/lib/db/proxy';
import sql from 'mssql';

interface TransferenciaRequest {
  produto: string;
  corProduto: string | null;
  filialOrigem: string;
  filialDestino: string;
  qtdeSaida: number;
  qtdeEntrada: number;
  tipoRomaneio?: string;
  responsavel?: string;
}

export async function POST(request: Request) {
  // Não suporta proxy para operações de escrita complexas
  if (shouldUseProxy()) {
    return NextResponse.json(
      { error: 'Operações de transferência não suportadas via proxy' },
      { status: 400 }
    );
  }

  try {
    const body = (await request.json()) as TransferenciaRequest;
    const {
      produto,
      corProduto,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio = 'TRANSFERENCIA',
      responsavel = 'LOGISTICA',
    } = body;

    // Validar dados
    if (!produto || !filialOrigem || !filialDestino || qtdeSaida <= 0 || qtdeEntrada <= 0) {
      return NextResponse.json(
        { error: 'Dados inválidos para transferência' },
        { status: 400 }
      );
    }

    const pool = await getConnectionPool();
    
    // Preparar valores (escapar aspas) - usar nomes das filiais, não códigos
    const produtoEscaped = produto.replace(/'/g, "''");
    // filialOrigemNome e filialDestinoNome serão definidos após buscar na tabela FILIAIS
    let filialOrigemEscaped = filialOrigem.replace(/'/g, "''"); // Temporário, será substituído
    let filialDestinoEscaped = filialDestino.replace(/'/g, "''"); // Temporário, será substituído
    const corEscaped = corProduto ? corProduto.replace(/'/g, "''") : null;
    const dataStr = new Date().toISOString().slice(0, 19).replace('T', ' ');

    // 1. Gerar próximo romaneio de saída
    const req1 = pool.request();
    const queryRomaneioSaida = `
      SELECT TOP 1 ROMANEIO_PRODUTO
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE ISNUMERIC(ROMANEIO_PRODUTO) = 1
        AND LEN(LTRIM(RTRIM(ROMANEIO_PRODUTO))) = 6
      ORDER BY CAST(ROMANEIO_PRODUTO AS INT) DESC
    `;
    
    const resultRomaneio = await req1.query<{ ROMANEIO_PRODUTO: string }>(queryRomaneioSaida);
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
    let tentativas = 0;
    while (tentativas < 10) {
      const reqVerificar = pool.request();
      const queryVerificarRomaneio = `
        SELECT COUNT(*) as TOTAL
        FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
        WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioSaida 
          AND LTRIM(RTRIM(FILIAL)) = @filialOrigem
      `;
      
      reqVerificar.input('romaneioSaida', sql.VarChar, romaneioSaida);
      reqVerificar.input('filialOrigem', sql.VarChar, filialOrigem);
      const resultVerificar = await reqVerificar.query<{ TOTAL: number }>(queryVerificarRomaneio);
      
      if (resultVerificar.recordset[0]?.TOTAL === 0) {
        break;
      }
      
      const numAtual = parseInt(romaneioSaida);
      romaneioSaida = `${numAtual + 1}`.padStart(6, '0');
      tentativas++;
    }

    // Gerar romaneio de entrada (padrão: T + número)
    const romaneioEntrada = `T${romaneioSaida}`;

    // VALIDAÇÃO FINAL: Verificar se o romaneio de saída já existe (igual ao script)
    const reqValida = pool.request();
    const queryValidaRomaneio = `
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
      WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneioSaida 
        AND LTRIM(RTRIM(FILIAL)) = @filialOrigem
    `;
    reqValida.input('romaneioSaida', sql.VarChar, romaneioSaida);
    reqValida.input('filialOrigem', sql.VarChar, filialOrigem);
    const resultValida = await reqValida.query<{ TOTAL: number }>(queryValidaRomaneio);
    
    if (resultValida.recordset[0]?.TOTAL > 0) {
      return NextResponse.json(
        { error: `Romaneio de saida ${romaneioSaida} ja existe para a filial ${filialOrigem}. Por favor, gere um novo romaneio.` },
        { status: 400 }
      );
    }

    // 2. Buscar nomes das filiais (FILIAIS usa COD_FILIAL como chave, mas FILIAL como nome)
    const req2_nomes = pool.request();
    const queryNomesFiliais = `
      SELECT COD_FILIAL, FILIAL
      FROM FILIAIS WITH (NOLOCK)
      WHERE COD_FILIAL IN (@filialOrigem, @filialDestino)
    `;
    
    req2_nomes.input('filialOrigem', sql.VarChar, filialOrigem);
    req2_nomes.input('filialDestino', sql.VarChar, filialDestino);
    const resultNomesFiliais = await req2_nomes.query<{ COD_FILIAL: string; FILIAL: string }>(queryNomesFiliais);
    
    let filialOrigemNome = filialOrigem; // Fallback: usar código se não encontrar
    let filialDestinoNome = filialDestino; // Fallback: usar código se não encontrar
    
    for (const row of resultNomesFiliais.recordset) {
      const codFilial = row.COD_FILIAL?.toString().trim() || '';
      const nomeFilial = row.FILIAL?.toString().trim() || '';
      if (codFilial === filialOrigem.trim()) {
        filialOrigemNome = nomeFilial;
      } else if (codFilial === filialDestino.trim()) {
        filialDestinoNome = nomeFilial;
      }
    }
    
    console.log('[TRANSFERENCIA] Filiais:', {
      filialOrigemCod: filialOrigem,
      filialOrigemNome: filialOrigemNome,
      filialDestinoCod: filialDestino,
      filialDestinoNome: filialDestinoNome,
      encontradas: resultNomesFiliais.recordset.length
    });

    // Determinar CM_OPERACAO baseado em empresas
    const req2 = pool.request();
    const queryEmpresas = `
      SELECT COD_FILIAL, FILIAL, EMPRESA
      FROM FILIAIS WITH (NOLOCK)
      WHERE COD_FILIAL IN (@filialOrigem, @filialDestino)
    `;
    
    req2.input('filialOrigem', sql.VarChar, filialOrigem);
    req2.input('filialDestino', sql.VarChar, filialDestino);
    const resultEmpresas = await req2.query<{ COD_FILIAL: string; FILIAL: string; EMPRESA: number | null }>(queryEmpresas);
    
    let empresaOrigem: number | null = null;
    let empresaDestino: number | null = null;
    
    for (const row of resultEmpresas.recordset) {
      const codFilial = row.COD_FILIAL?.toString().trim() || '';
      if (codFilial === filialOrigem.trim()) {
        empresaOrigem = row.EMPRESA ? parseInt(String(row.EMPRESA)) : null;
      } else if (codFilial === filialDestino.trim()) {
        empresaDestino = row.EMPRESA ? parseInt(String(row.EMPRESA)) : null;
      }
    }

    // Garantir que temos empresas (buscar individualmente se necessário)
    if (empresaOrigem === null) {
      const reqEmpOrigem = pool.request();
      const queryEmpOrigem = `
        SELECT EMPRESA
        FROM FILIAIS WITH (NOLOCK)
        WHERE COD_FILIAL = @filialOrigem
      `;
      reqEmpOrigem.input('filialOrigem', sql.VarChar, filialOrigem);
      const resultEmpOrigem = await reqEmpOrigem.query<{ EMPRESA: number | null }>(queryEmpOrigem);
      if (resultEmpOrigem.recordset.length > 0 && resultEmpOrigem.recordset[0].EMPRESA) {
        empresaOrigem = parseInt(String(resultEmpOrigem.recordset[0].EMPRESA));
      } else {
        empresaOrigem = 8; // Empresa padrão (NERD)
      }
    }

    if (empresaDestino === null) {
      const reqEmpDestino = pool.request();
      const queryEmpDestino = `
        SELECT EMPRESA
        FROM FILIAIS WITH (NOLOCK)
        WHERE COD_FILIAL = @filialDestino
      `;
      reqEmpDestino.input('filialDestino', sql.VarChar, filialDestino);
      const resultEmpDestino = await reqEmpDestino.query<{ EMPRESA: number | null }>(queryEmpDestino);
      if (resultEmpDestino.recordset.length > 0 && resultEmpDestino.recordset[0].EMPRESA) {
        empresaDestino = parseInt(String(resultEmpDestino.recordset[0].EMPRESA));
      } else {
        empresaDestino = 8; // Empresa padrão (NERD)
      }
    }

    // Aplicar regra: mesma empresa = '012', empresas diferentes = '011'
    const cmOperacao = (empresaOrigem !== null && empresaDestino !== null && empresaOrigem === empresaDestino) ? '012' : '011';
    
    // Usar nomes das filiais (não códigos) para inserir nas tabelas
    filialOrigemEscaped = filialOrigemNome.replace(/'/g, "''");
    filialDestinoEscaped = filialDestinoNome.replace(/'/g, "''");
    
    // FILIAL_DESTINO e ROMANEIO_DESTINO: NULL para empresas diferentes ('011'), preenchido para mesma empresa ('012')
    const filialDestinoValor = cmOperacao === '011' ? null : filialDestinoEscaped;
    const romaneioDestinoValor = cmOperacao === '011' ? null : romaneioEntrada;

    // CM_OPERACAO para entrada é sempre '003'
    const cmOperacaoEntrada = '003';
    
    // TIPO_ENTRADA para entrada (função determinar_tipo_entrada)
    const determinarTipoEntrada = (tipoRomaneio: string): string => {
      const tipoEntradaMap: Record<string, string> = {
        'TRANSFERENCIA ENTRE LOJAS': '1',
        'TRANSFERENCIA': '1',
        'ENTRADA AVULSA': '1',
        'ENTRADA POR MOV. INTERNA': '1',
        'DEFEITO': '1'
      };
      return tipoEntradaMap[tipoRomaneio.toUpperCase()] || '1';
    };
    const tipoEntrada = determinarTipoEntrada(tipoRomaneio);

    // 3. Inserir cabeçalho de SAÍDA (ESTOQUE_PROD_SAI) - COMMIT após criar
    const req3 = pool.request();
    const querySaidaCab = `
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
    `;
    
    req3.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req3.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req3.input('dataStr', sql.VarChar, dataStr);
    req3.input('responsavel', sql.VarChar, responsavel || ' ');
    req3.input('filialDestinoValor', filialDestinoValor !== null ? sql.VarChar : sql.NVarChar, filialDestinoValor);
    req3.input('romaneioDestinoValor', romaneioDestinoValor !== null ? sql.VarChar : sql.NVarChar, romaneioDestinoValor);
    req3.input('tipoRomaneio', sql.VarChar, tipoRomaneio);
    req3.input('cmOperacao', sql.VarChar, cmOperacao);
    
    console.log('[TRANSFERENCIA] Inserindo ESTOQUE_PROD_SAI:', {
      romaneioSaida,
      filialOrigem: filialOrigemEscaped,
      filialOrigemLen: filialOrigemEscaped.length,
      filialDestinoValor,
      romaneioDestinoValor,
      tipoRomaneio,
      cmOperacao
    });
    
    await req3.query(querySaidaCab);

    // Validar que os JOINs funcionarão corretamente (garantir_informacoes_joins_saida)
    try {
      const reqValidaJoins = pool.request();
      const queryValidaJoins = `
        SELECT e.ROMANEIO_PRODUTO, e.FILIAL, e.CM_OPERACAO, f.EMPRESA
        FROM ESTOQUE_PROD_SAI e WITH (NOLOCK)
        LEFT JOIN FILIAIS f WITH (NOLOCK) ON e.FILIAL = f.FILIAL
        WHERE e.ROMANEIO_PRODUTO = @romaneioSaida
      `;
      reqValidaJoins.input('romaneioSaida', sql.VarChar, romaneioSaida);
      await reqValidaJoins.query(queryValidaJoins);
    } catch (e) {
      // Não crítico - apenas validação
    }

    // 4. Inserir item de SAÍDA (ESTOQUE_PROD1_SAI) - COMMIT após criar
    const req4 = pool.request();
    const querySaidaItem = `
      INSERT INTO ESTOQUE_PROD1_SAI (
        FILIAL, ROMANEIO_PRODUTO, PRODUTO, COR_PRODUTO, QTDE, DESCONTO_ITEM
      ) VALUES (
        @filialOrigem, @romaneioSaida, @produto, @corProduto, @qtdeSaida, 0
      )
    `;
    
    req4.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req4.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req4.input('produto', sql.VarChar, produtoEscaped);
    req4.input('corProduto', corEscaped && corEscaped.trim() ? sql.VarChar : sql.NVarChar, corEscaped && corEscaped.trim() ? corEscaped : null);
    req4.input('qtdeSaida', sql.Int, qtdeSaida);
    
    await req4.query(querySaidaItem);

    // 5. Inserir cabeçalho em LOJA_SAIDAS - COMMIT após criar
    const req5 = pool.request();
    const queryLojaSaidasCab = `
      INSERT INTO LOJA_SAIDAS (
        ROMANEIO_PRODUTO, FILIAL, EMISSAO, RESPONSAVEL,
        FILIAL_DESTINO, NUMERO_NF_TRANSFERENCIA,
        INDICA_DEVOLUCAO, QTDE_TOTAL, VALOR_TOTAL, FATOR_PRECO,
        DATA_PARA_TRANSFERENCIA, SAIDA_ENCERRADA, SAIDA_CANCELADA
      ) VALUES (
        @romaneioSaida, @filialOrigem, @dataStr, @responsavel,
        @filialDestinoEscaped, '', 0, @qtdeSaida, 0, 0, @dataStr, 1, 0
      )
    `;
    
    req5.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req5.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req5.input('dataStr', sql.VarChar, dataStr);
    req5.input('responsavel', sql.VarChar, responsavel || ' ');
    req5.input('filialDestinoEscaped', sql.VarChar, filialDestinoEscaped);
    req5.input('qtdeSaida', sql.Int, qtdeSaida);
    
    await req5.query(queryLojaSaidasCab);

    // 5.1. Tentar atualizar LOJA_SAIDAS com TIPO_ENTRADA_SAIDA (opcional)
    try {
      const req5_1 = pool.request();
      const tipoEntradaSaidaLoja = cmOperacao === '012' ? '2' : '1'; // 2 = Transferência, 1 = Saída normal
      const queryUpdateLojaSaidas = `
        UPDATE LOJA_SAIDAS
        SET TIPO_ENTRADA_SAIDA = @tipoEntradaSaidaLoja
        WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem
      `;
      
      req5_1.input('tipoEntradaSaidaLoja', sql.VarChar, tipoEntradaSaidaLoja);
      req5_1.input('romaneioSaida', sql.VarChar, romaneioSaida);
      req5_1.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
      await req5_1.query(queryUpdateLojaSaidas);
    } catch (e) {
      // Não crítico - apenas avisar
      console.log('Não foi possível atualizar TIPO_ENTRADA_SAIDA em LOJA_SAIDAS');
    }

    // 6. Inserir item em LOJA_SAIDAS_PRODUTO - COMMIT após criar
    const req6 = pool.request();
    const queryLojaSaidasProduto = `
      INSERT INTO LOJA_SAIDAS_PRODUTO (
        ROMANEIO_PRODUTO, FILIAL, PRODUTO, COR_PRODUTO, QTDE_SAIDA
      ) VALUES (
        @romaneioSaida, @filialOrigem, @produto, @corProduto, @qtdeSaida
      )
    `;
    
    req6.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req6.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req6.input('produto', sql.VarChar, produtoEscaped);
    req6.input('corProduto', corEscaped && corEscaped.trim() ? sql.VarChar : sql.NVarChar, corEscaped && corEscaped.trim() ? corEscaped : null);
    req6.input('qtdeSaida', sql.Int, qtdeSaida);
    
    await req6.query(queryLojaSaidasProduto);

    // Verificar se LOJA_SAIDAS foi criada corretamente ANTES de chamar stored procedure
    const reqVerifAntesSP = pool.request();
    const queryVerificarAntesSP = `
      SELECT SAIDA_CANCELADA, SAIDA_ENCERRADA
      FROM LOJA_SAIDAS
      WHERE ROMANEIO_PRODUTO = @romaneioSaida 
        AND FILIAL = @filialOrigem
    `;
    reqVerifAntesSP.input('romaneioSaida', sql.VarChar, romaneioSaida);
    reqVerifAntesSP.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    const resultVerifAntesSP = await reqVerifAntesSP.query<{ SAIDA_CANCELADA: number | boolean; SAIDA_ENCERRADA: number | boolean }>(queryVerificarAntesSP);
    
    if (resultVerifAntesSP.recordset.length === 0) {
      throw new Error(`ERRO: LOJA_SAIDAS nao foi criada antes de chamar stored procedure. Romaneio: ${romaneioSaida}`);
    }
    const saidaCancelada = resultVerifAntesSP.recordset[0].SAIDA_CANCELADA;
    const saidaCanceladaNum = typeof saidaCancelada === 'boolean' ? (saidaCancelada ? 1 : 0) : (saidaCancelada || 0);
    if (saidaCanceladaNum !== 0) {
      throw new Error(`ERRO: LOJA_SAIDAS foi criada com SAIDA_CANCELADA = ${saidaCancelada} (${saidaCanceladaNum}), deveria ser 0`);
    }

    // 7. Chamar stored procedure do LINX
    const req7 = pool.request();
    const querySP = `
      EXEC LX_GERA_TRANSFERENCIA_AUTOMATICA 
        @FILIAL = @filialOrigem,
        @ROMANEIO_PRODUTO = @romaneioSaida,
        @FILIAL_DESTINO = @filialDestinoEscaped,
        @SERIE_NF = '001',
        @ORIGEM = 'S',
        @EXCLUSAO = 'N'
    `;
    
    req7.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req7.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req7.input('filialDestinoEscaped', sql.VarChar, filialDestinoEscaped);
    
    try {
      await req7.query(querySP);
    } catch (spError: any) {
      const errorStr = String(spError);
      if (errorStr.includes('IMPOSSIVEL GERAR ENTRADA') || 
          errorStr.includes('EXCLUIDA') || 
          errorStr.includes('CANCELADA')) {
        throw new Error(`Erro na stored procedure: ${errorStr}`);
      }
      // Continuar mesmo com erro (pode ser que a entrada já tenha sido criada)
    }

    // 8. Buscar romaneio de entrada gerado (múltiplas tentativas como no script Python)
    // Tentar buscar por ROMANEIO_ORIGEM primeiro
    const req8 = pool.request();
    let queryRomaneioEntrada = `
      SELECT TOP 1 ROMANEIO_PRODUTO
      FROM ESTOQUE_PROD_ENT
      WHERE FILIAL = @filialDestino 
        AND ROMANEIO_ORIGEM = @romaneioSaida
        AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
      ORDER BY EMISSAO DESC
    `;
    
    req8.input('filialDestino', sql.VarChar, filialDestinoEscaped);
    req8.input('romaneioSaida', sql.VarChar, romaneioSaida);
    let resultRomaneioEntrada = await req8.query<{ ROMANEIO_PRODUTO: string }>(queryRomaneioEntrada);
    let romaneioEntradaFinal = romaneioEntrada;
    let rowRomaneioEncontrado = resultRomaneioEntrada.recordset.length > 0;
    
    if (rowRomaneioEncontrado) {
      romaneioEntradaFinal = resultRomaneioEntrada.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
    } else {
      // Se não encontrou, tentar buscar por FILIAL_ORIGEM
      const req8_2 = pool.request();
      queryRomaneioEntrada = `
        SELECT TOP 1 ROMANEIO_PRODUTO
        FROM ESTOQUE_PROD_ENT
        WHERE FILIAL = @filialDestino 
          AND FILIAL_ORIGEM = @filialOrigem
          AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
        ORDER BY EMISSAO DESC
      `;
      req8_2.input('filialDestino', sql.VarChar, filialDestinoEscaped);
      req8_2.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
      resultRomaneioEntrada = await req8_2.query<{ ROMANEIO_PRODUTO: string }>(queryRomaneioEntrada);
      
      if (resultRomaneioEntrada.recordset.length > 0) {
        romaneioEntradaFinal = resultRomaneioEntrada.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
        rowRomaneioEncontrado = true;
      } else {
        // Se ainda não encontrou, tentar buscar em LOJA_ENTRADAS (a stored procedure pode criar lá primeiro)
        const req8_3 = pool.request();
        const queryLojaEntradas = `
          SELECT TOP 1 ROMANEIO_PRODUTO
          FROM LOJA_ENTRADAS
          WHERE FILIAL = @filialDestino 
            AND FILIAL_ORIGEM = @filialOrigem
            AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
          ORDER BY EMISSAO DESC
        `;
        req8_3.input('filialDestino', sql.VarChar, filialDestinoEscaped);
        req8_3.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
        const resultLojaEntradas = await req8_3.query<{ ROMANEIO_PRODUTO: string }>(queryLojaEntradas);
        
        if (resultLojaEntradas.recordset.length > 0) {
          romaneioEntradaFinal = resultLojaEntradas.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
          rowRomaneioEncontrado = true;
        } else {
          // Se ainda não encontrou, tentar buscar qualquer entrada recente na filial destino
          const req8_4 = pool.request();
          const queryRomaneioRecente = `
            SELECT TOP 1 ROMANEIO_PRODUTO
            FROM ESTOQUE_PROD_ENT
            WHERE FILIAL = @filialDestino 
              AND EMISSAO >= DATEADD(MINUTE, -2, GETDATE())
            ORDER BY EMISSAO DESC
          `;
          req8_4.input('filialDestino', sql.VarChar, filialDestinoEscaped);
          const resultRomaneioRecente = await req8_4.query<{ ROMANEIO_PRODUTO: string }>(queryRomaneioRecente);
          
          if (resultRomaneioRecente.recordset.length > 0) {
            romaneioEntradaFinal = resultRomaneioRecente.recordset[0].ROMANEIO_PRODUTO?.toString().trim() || romaneioEntrada;
            rowRomaneioEncontrado = true;
          }
        }
      }
    }
    
    // Se ainda não encontrou, verificar se o romaneio previsto foi criado (igual ao script Python)
    if (!rowRomaneioEncontrado) {
      const req8_5 = pool.request();
      const queryVerificarPrevisto = `
        SELECT COUNT(*) as TOTAL
        FROM ESTOQUE_PROD_ENT
        WHERE ROMANEIO_PRODUTO = @romaneioEntrada AND FILIAL = @filialDestino
      `;
      req8_5.input('romaneioEntrada', sql.VarChar, romaneioEntrada);
      req8_5.input('filialDestino', sql.VarChar, filialDestinoEscaped);
      const resultVerifPrevisto = await req8_5.query<{ TOTAL: number }>(queryVerificarPrevisto);
      
      if (resultVerifPrevisto.recordset[0]?.TOTAL > 0) {
        romaneioEntradaFinal = romaneioEntrada;
        rowRomaneioEncontrado = true;
      }
    }

    // 9. Atualizar SEQUENCIAIS para romaneio de saída (ANTES de verificar registros)
    const req9 = pool.request();
    const queryUpdateSeq = `
      UPDATE SEQUENCIAIS
      SET SEQUENCIA = @romaneioSaida
      WHERE TABELA_COLUNA = 'ESTOQUE_PROD_SAI.ROMANEIO_PRODUTO'
    `;
    
    req9.input('romaneioSaida', sql.VarChar, romaneioSaida);
    await req9.query(queryUpdateSeq);

    // 10. VERIFICAR se todos os registros foram criados corretamente ANTES de atualizar estoques
    // Verificar saída em ESTOQUE_PROD_SAI
    const req10_1 = pool.request();
    const queryVerificarSaida = `
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_SAI
      WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem
    `;
    req10_1.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req10_1.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    const resultVerificarSaida = await req10_1.query<{ TOTAL: number }>(queryVerificarSaida);
    
    if (resultVerificarSaida.recordset[0]?.TOTAL === 0) {
      throw new Error(`ERRO: Registro de saida (ESTOQUE_PROD_SAI) nao foi criado. Romaneio: ${romaneioSaida}, Filial: ${filialOrigemEscaped}`);
    }

    // Verificar item de saída em ESTOQUE_PROD1_SAI
    const req10_2 = pool.request();
    const queryVerificarSaidaItem = `
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD1_SAI
      WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem AND PRODUTO = @produto
    `;
    req10_2.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req10_2.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req10_2.input('produto', sql.VarChar, produtoEscaped);
    const resultVerificarSaidaItem = await req10_2.query<{ TOTAL: number }>(queryVerificarSaidaItem);
    
    if (resultVerificarSaidaItem.recordset[0]?.TOTAL === 0) {
      throw new Error(`ERRO: Item de saida (ESTOQUE_PROD1_SAI) nao foi criado. Romaneio: ${romaneioSaida}`);
    }

    // Verificar LOJA_SAIDAS
    const req10_3 = pool.request();
    const queryVerificarLojaSaidas = `
      SELECT COUNT(*) as TOTAL
      FROM LOJA_SAIDAS
      WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem
    `;
    req10_3.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req10_3.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    const resultVerificarLojaSaidas = await req10_3.query<{ TOTAL: number }>(queryVerificarLojaSaidas);
    
    if (resultVerificarLojaSaidas.recordset[0]?.TOTAL === 0) {
      throw new Error(`ERRO: Registro em LOJA_SAIDAS nao foi criado. Romaneio: ${romaneioSaida}`);
    }

    // Verificar LOJA_SAIDAS_PRODUTO
    const req10_4 = pool.request();
    const queryVerificarLojaSaidasProduto = `
      SELECT COUNT(*) as TOTAL
      FROM LOJA_SAIDAS_PRODUTO
      WHERE ROMANEIO_PRODUTO = @romaneioSaida AND FILIAL = @filialOrigem AND PRODUTO = @produto
    `;
    req10_4.input('romaneioSaida', sql.VarChar, romaneioSaida);
    req10_4.input('filialOrigem', sql.VarChar, filialOrigemEscaped);
    req10_4.input('produto', sql.VarChar, produtoEscaped);
    const resultVerificarLojaSaidasProduto = await req10_4.query<{ TOTAL: number }>(queryVerificarLojaSaidasProduto);
    
    if (resultVerificarLojaSaidasProduto.recordset[0]?.TOTAL === 0) {
      throw new Error(`ERRO: Registro em LOJA_SAIDAS_PRODUTO nao foi criado. Romaneio: ${romaneioSaida}`);
    }

    // Verificar entrada em ESTOQUE_PROD_ENT (deve ter sido criada pela stored procedure)
    // A verificação do romaneio já foi feita acima na seção 8

    const req10_5 = pool.request();
    const queryVerificarEntrada = `
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD_ENT
      WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino
    `;
    req10_5.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
    req10_5.input('filialDestino', sql.VarChar, filialDestinoEscaped);
    const resultVerificarEntrada = await req10_5.query<{ TOTAL: number }>(queryVerificarEntrada);
    
    // Se existe em ESTOQUE_PROD_ENT, atualizar campos faltantes
    if (resultVerificarEntrada.recordset[0]?.TOTAL > 0) {
      const req11 = pool.request();
      const queryUpdateEntrada = `
        UPDATE ESTOQUE_PROD_ENT
        SET TIPO_ROMANEIO = @tipoRomaneio,
            TIPO_ENTRADA = @tipoEntrada,
            CM_OPERACAO = @cmOperacaoEntrada
        WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino
      `;
      
      req11.input('tipoRomaneio', sql.VarChar, tipoRomaneio);
      req11.input('tipoEntrada', sql.VarChar, tipoEntrada);
      req11.input('cmOperacaoEntrada', sql.VarChar, cmOperacaoEntrada);
      req11.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
      req11.input('filialDestino', sql.VarChar, filialDestinoEscaped);
      await req11.query(queryUpdateEntrada);

      // Atualizar LOJA_ENTRADAS se existir (opcional)
      try {
        const req11_1 = pool.request();
        const queryUpdateLojaEntradas = `
          UPDATE LOJA_ENTRADAS
          SET TIPO_ENTRADA_SAIDA = @tipoEntrada
          WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino
        `;
        req11_1.input('tipoEntrada', sql.VarChar, tipoEntrada);
        req11_1.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
        req11_1.input('filialDestino', sql.VarChar, filialDestinoEscaped);
        await req11_1.query(queryUpdateLojaEntradas);
      } catch (e) {
        // Não crítico
      }
    } else {
      // Se não existe em ESTOQUE_PROD_ENT, criar manualmente (como no script)
      // Buscar informações de LOJA_ENTRADAS para criar em ESTOQUE_PROD_ENT
      const req11_2 = pool.request();
      const queryLojaEntradasInfo = `
        SELECT TOP 1 EMISSAO, FILIAL_ORIGEM, ROMANEIO_NF_SAIDA, RESPONSAVEL
        FROM LOJA_ENTRADAS
        WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino
      `;
      req11_2.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
      req11_2.input('filialDestino', sql.VarChar, filialDestinoEscaped);
      const resultLojaEntradasInfo = await req11_2.query<{
        EMISSAO: Date | null;
        FILIAL_ORIGEM: string | null;
        ROMANEIO_NF_SAIDA: string | null;
        RESPONSAVEL: string | null;
      }>(queryLojaEntradasInfo);
      
      let dataEntrada = dataStr;
      let filialOrigemEntrada = filialOrigemEscaped;
      let romaneioOrigemEntrada = romaneioSaida;
      let responsavelEntrada = responsavel || ' ';
      
      if (resultLojaEntradasInfo.recordset.length > 0) {
        const row = resultLojaEntradasInfo.recordset[0];
        dataEntrada = row.EMISSAO ? row.EMISSAO.toISOString().slice(0, 19).replace('T', ' ') : dataStr;
        filialOrigemEntrada = row.FILIAL_ORIGEM?.toString().trim() || filialOrigemEscaped;
        romaneioOrigemEntrada = row.ROMANEIO_NF_SAIDA?.toString().trim() || romaneioSaida;
        responsavelEntrada = row.RESPONSAVEL?.toString().trim() || responsavel || ' ';
      }

      // Criar cabeçalho em ESTOQUE_PROD_ENT
      const req11_3 = pool.request();
      const queryInsertEntradaCab = `
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
      `;
      
      req11_3.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
      req11_3.input('filialDestino', sql.VarChar, filialDestinoEscaped);
      req11_3.input('dataEntrada', sql.VarChar, dataEntrada);
      req11_3.input('responsavelEntrada', sql.VarChar, responsavelEntrada);
      req11_3.input('filialOrigemEntrada', sql.VarChar, filialOrigemEntrada);
      req11_3.input('romaneioOrigemEntrada', sql.VarChar, romaneioOrigemEntrada);
      req11_3.input('tipoRomaneio', sql.VarChar, tipoRomaneio);
      req11_3.input('tipoEntrada', sql.VarChar, tipoEntrada);
      req11_3.input('cmOperacaoEntrada', sql.VarChar, cmOperacaoEntrada);
      await req11_3.query(queryInsertEntradaCab);

      // Validar que os JOINs funcionarão corretamente (garantir_informacoes_joins_entrada)
      try {
        const reqValidaJoinsEntrada = pool.request();
        const queryValidaJoinsEntrada = `
          SELECT e.ROMANEIO_PRODUTO, e.FILIAL, e.CM_OPERACAO, f.EMPRESA
          FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
          LEFT JOIN FILIAIS f WITH (NOLOCK) ON e.FILIAL = f.FILIAL
          WHERE e.ROMANEIO_PRODUTO = @romaneioEntradaFinal
        `;
        reqValidaJoinsEntrada.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
        await reqValidaJoinsEntrada.query(queryValidaJoinsEntrada);
      } catch (e) {
        // Não crítico - apenas validação
      }

      // Criar item em ESTOQUE_PROD1_ENT
      const req11_4 = pool.request();
      const queryInsertEntradaItem = `
        INSERT INTO ESTOQUE_PROD1_ENT (
          ROMANEIO_PRODUTO, PRODUTO, FILIAL, COR_PRODUTO, QTDE
        ) VALUES (
          @romaneioEntradaFinal, @produto, @filialDestino, @corProduto, @qtdeEntrada
        )
      `;
      
      req11_4.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
      req11_4.input('produto', sql.VarChar, produtoEscaped);
      req11_4.input('filialDestino', sql.VarChar, filialDestinoEscaped);
      req11_4.input('corProduto', corEscaped && corEscaped.trim() ? sql.VarChar : sql.NVarChar, corEscaped && corEscaped.trim() ? corEscaped : null);
      req11_4.input('qtdeEntrada', sql.Int, qtdeEntrada);
      await req11_4.query(queryInsertEntradaItem);
    }

    // Verificar item de entrada em ESTOQUE_PROD1_ENT
    const req12 = pool.request();
    const queryVerificarEntradaItem = `
      SELECT COUNT(*) as TOTAL
      FROM ESTOQUE_PROD1_ENT
      WHERE ROMANEIO_PRODUTO = @romaneioEntradaFinal AND FILIAL = @filialDestino AND PRODUTO = @produto
    `;
    req12.input('romaneioEntradaFinal', sql.VarChar, romaneioEntradaFinal);
    req12.input('filialDestino', sql.VarChar, filialDestinoEscaped);
    req12.input('produto', sql.VarChar, produtoEscaped);
    const resultVerificarEntradaItem = await req12.query<{ TOTAL: number }>(queryVerificarEntradaItem);
    
    if (resultVerificarEntradaItem.recordset[0]?.TOTAL === 0) {
      throw new Error(`ERRO: Item de entrada (ESTOQUE_PROD1_ENT) nao foi criado. Romaneio: ${romaneioEntradaFinal}`);
    }

    // 11. Atualizar estoques manualmente (usando valores EXATOS do banco)
    // IMPORTANTE: ESTOQUE_PRODUTOS.FILIAL contém o NOME da filial, não o código
    // Para parâmetros SQL, usar valores ORIGINAIS (sem escape)
    // O escape só é necessário quando construímos SQL como string
    const produtoParaQuery = produto.trim();
    const filialOrigemParaQuery = filialOrigemNome.trim(); // Usar NOME da filial
    const filialDestinoParaQuery = filialDestinoNome.trim(); // Usar NOME da filial
    const corProdutoParaQuery = corProduto ? corProduto.trim() : null;
    
    // Buscar valores exatos do banco para origem
    const req13 = pool.request();
    const queryVerificarEstoqueOrigem = `
      SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
      FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
      WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialOrigemParaQuery
    `;
    
    req13.input('produtoParaQuery', sql.VarChar, produtoParaQuery);
    req13.input('filialOrigemParaQuery', sql.VarChar, filialOrigemParaQuery);
    const resultEstoqueOrigem = await req13.query<{
      PRODUTO: string;
      FILIAL: string;
      COR_PRODUTO: string | null;
      ESTOQUE: number;
    }>(queryVerificarEstoqueOrigem);

    if (resultEstoqueOrigem.recordset.length === 0) {
      throw new Error(`ERRO: Nenhum registro encontrado para Produto: '${produtoParaQuery}', Filial: '${filialOrigemParaQuery}'. Verifique se o código da filial está correto.`);
    }

    // Filtrar pela cor (se necessário)
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
      // Procurar registro sem cor (NULL ou vazio)
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

    // Verificar estoque antes do UPDATE (igual ao script Python)
    const req14_verif = pool.request();
    let queryVerificarAntesUpdate: string;
    if (corExata) {
      queryVerificarAntesUpdate = `
        SELECT ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata
      `;
      req14_verif.input('produtoExato', sql.VarChar, produtoExato);
      req14_verif.input('filialExata', sql.VarChar, filialExata);
      req14_verif.input('corExata', sql.VarChar, corExata);
    } else {
      queryVerificarAntesUpdate = `
        SELECT ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
      `;
      req14_verif.input('produtoExato', sql.VarChar, produtoExato);
      req14_verif.input('filialExata', sql.VarChar, filialExata);
    }
    const resultAntesUpdate = await req14_verif.query<{ ESTOQUE: number }>(queryVerificarAntesUpdate);
    
    if (resultAntesUpdate.recordset.length === 0) {
      throw new Error(`ERRO: Registro não encontrado antes do UPDATE. Produto: '${produtoExato}', Filial: '${filialExata}', Cor: '${corExata || '(sem cor)'}'`);
    }
    const estoqueAntesUpdate = resultAntesUpdate.recordset[0].ESTOQUE || 0;

    // Atualizar estoque de origem
    const req14 = pool.request();
    if (corExata) {
      const queryUpdateEstoqueOrigem = `
        UPDATE ESTOQUE_PRODUTOS
        SET ESTOQUE = ESTOQUE - @qtdeSaida
        WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata
      `;
      
      req14.input('qtdeSaida', sql.Int, qtdeSaida);
      req14.input('produtoExato', sql.VarChar, produtoExato);
      req14.input('filialExata', sql.VarChar, filialExata);
      req14.input('corExata', sql.VarChar, corExata);
      await req14.query(queryUpdateEstoqueOrigem);
    } else {
      const queryUpdateEstoqueOrigem = `
        UPDATE ESTOQUE_PRODUTOS
        SET ESTOQUE = ESTOQUE - @qtdeSaida
        WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
      `;
      
      req14.input('qtdeSaida', sql.Int, qtdeSaida);
      req14.input('produtoExato', sql.VarChar, produtoExato);
      req14.input('filialExata', sql.VarChar, filialExata);
      await req14.query(queryUpdateEstoqueOrigem);
    }

    // Verificar se o UPDATE realmente funcionou (igual ao script Python)
    const req14_depois = pool.request();
    let queryVerificarDepoisUpdate: string;
    if (corExata) {
      queryVerificarDepoisUpdate = `
        SELECT ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata
      `;
      req14_depois.input('produtoExato', sql.VarChar, produtoExato);
      req14_depois.input('filialExata', sql.VarChar, filialExata);
      req14_depois.input('corExata', sql.VarChar, corExata);
    } else {
      queryVerificarDepoisUpdate = `
        SELECT ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
      `;
      req14_depois.input('produtoExato', sql.VarChar, produtoExato);
      req14_depois.input('filialExata', sql.VarChar, filialExata);
    }
    const resultDepoisUpdate = await req14_depois.query<{ ESTOQUE: number }>(queryVerificarDepoisUpdate);
    const estoqueDepoisUpdate = resultDepoisUpdate.recordset.length > 0 ? (resultDepoisUpdate.recordset[0].ESTOQUE || 0) : null;
    
    // Se não funcionou, tentar UPDATE alternativo (igual ao script Python)
    if (estoqueDepoisUpdate === null || estoqueDepoisUpdate !== (estoqueAntesUpdate - qtdeSaida)) {
      if (estoqueDepoisUpdate === null || estoqueDepoisUpdate === estoqueAntesUpdate) {
        // Tentar UPDATE alternativo
        const req14_alt = pool.request();
        const novoEstoque = estoqueAntesUpdate - qtdeSaida;
        let queryUpdateAlternativo: string;
        if (corExata) {
          queryUpdateAlternativo = `
            UPDATE ESTOQUE_PRODUTOS
            SET ESTOQUE = @novoEstoque
            WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata
          `;
          req14_alt.input('novoEstoque', sql.Int, novoEstoque);
          req14_alt.input('produtoExato', sql.VarChar, produtoExato);
          req14_alt.input('filialExata', sql.VarChar, filialExata);
          req14_alt.input('corExata', sql.VarChar, corExata);
        } else {
          queryUpdateAlternativo = `
            UPDATE ESTOQUE_PRODUTOS
            SET ESTOQUE = @novoEstoque
            WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
          `;
          req14_alt.input('novoEstoque', sql.Int, novoEstoque);
          req14_alt.input('produtoExato', sql.VarChar, produtoExato);
          req14_alt.input('filialExata', sql.VarChar, filialExata);
        }
        await req14_alt.query(queryUpdateAlternativo);
        
        // Verificar novamente após UPDATE alternativo
        const req14_verif_alt = pool.request();
        let queryVerificarAlt: string;
        if (corExata) {
          queryVerificarAlt = `
            SELECT ESTOQUE
            FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
            WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND COR_PRODUTO = @corExata
          `;
          req14_verif_alt.input('produtoExato', sql.VarChar, produtoExato);
          req14_verif_alt.input('filialExata', sql.VarChar, filialExata);
          req14_verif_alt.input('corExata', sql.VarChar, corExata);
        } else {
          queryVerificarAlt = `
            SELECT ESTOQUE
            FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
            WHERE PRODUTO = @produtoExato AND FILIAL = @filialExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
          `;
          req14_verif_alt.input('produtoExato', sql.VarChar, produtoExato);
          req14_verif_alt.input('filialExata', sql.VarChar, filialExata);
        }
        const resultDepoisAlt = await req14_verif_alt.query<{ ESTOQUE: number }>(queryVerificarAlt);
        const estoqueDepoisAlt = resultDepoisAlt.recordset.length > 0 ? (resultDepoisAlt.recordset[0].ESTOQUE || 0) : null;
        
        if (estoqueDepoisAlt !== novoEstoque) {
          throw new Error(`ERRO: Estoque de origem não foi atualizado corretamente. Esperado: ${novoEstoque}, Atual: ${estoqueDepoisAlt}`);
        }
      } else {
        throw new Error(`ERRO: Estoque de origem não foi atualizado corretamente. Esperado: ${estoqueAntesUpdate - qtdeSaida}, Atual: ${estoqueDepoisUpdate}`);
      }
    }

    // Verificar se existe estoque de destino
    const req15 = pool.request();
    let queryCheckEstoqueDestino: string;
    let paramsCheckDestino: any[];
    
    if (corProdutoParaQuery) {
      queryCheckEstoqueDestino = `
        SELECT ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialDestinoParaQuery AND COR_PRODUTO = @corProdutoParaQuery
      `;
      req15.input('produtoParaQuery', sql.VarChar, produtoParaQuery);
      req15.input('filialDestinoParaQuery', sql.VarChar, filialDestinoParaQuery);
      req15.input('corProdutoParaQuery', sql.VarChar, corProdutoParaQuery);
      paramsCheckDestino = [produtoParaQuery, filialDestinoParaQuery, corProdutoParaQuery];
    } else {
      queryCheckEstoqueDestino = `
        SELECT ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialDestinoParaQuery AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
      `;
      req15.input('produtoParaQuery', sql.VarChar, produtoParaQuery);
      req15.input('filialDestinoParaQuery', sql.VarChar, filialDestinoParaQuery);
      paramsCheckDestino = [produtoParaQuery, filialDestinoParaQuery];
    }
    
    const resultCheckDestino = await req15.query<{ ESTOQUE: number }>(queryCheckEstoqueDestino);
    const existeEstoque = resultCheckDestino.recordset.length > 0;
    const estoqueDestinoAntes = existeEstoque && resultCheckDestino.recordset[0].ESTOQUE ? resultCheckDestino.recordset[0].ESTOQUE : 0;

    if (existeEstoque) {
      // Atualizar estoque existente (mesma lógica do script)
      // Usar valores exatos do banco para o UPDATE
      // Buscar valores exatos do registro de destino
      const req15_1 = pool.request();
      const queryBuscarDestinoExato = `
        SELECT PRODUTO, FILIAL, COR_PRODUTO, ESTOQUE
        FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
        WHERE PRODUTO = @produtoParaQuery AND FILIAL = @filialDestinoParaQuery
      `;
      req15_1.input('produtoParaQuery', sql.VarChar, produtoParaQuery);
      req15_1.input('filialDestinoParaQuery', sql.VarChar, filialDestinoParaQuery);
      const resultDestinoExato = await req15_1.query<{
        PRODUTO: string;
        FILIAL: string;
        COR_PRODUTO: string | null;
        ESTOQUE: number;
      }>(queryBuscarDestinoExato);
      
      let rowDestinoExato = null;
      if (corProdutoParaQuery) {
        for (const row of resultDestinoExato.recordset) {
          const corBanco = row.COR_PRODUTO?.toString().trim() || '';
          if (corBanco === corProdutoParaQuery) {
            rowDestinoExato = row;
            break;
          }
        }
      } else {
        for (const row of resultDestinoExato.recordset) {
          const corBanco = row.COR_PRODUTO?.toString().trim() || '';
          if (!corBanco) {
            rowDestinoExato = row;
            break;
          }
        }
      }
      
      if (!rowDestinoExato) {
        throw new Error(`ERRO: Registro de destino não encontrado para atualização. Produto: '${produtoParaQuery}', Filial: '${filialDestinoParaQuery}', Cor: '${corProdutoParaQuery || '(sem cor)'}'`);
      }
      
      const produtoDestinoExato = rowDestinoExato.PRODUTO.toString().trim();
      const filialDestinoExata = rowDestinoExato.FILIAL.toString().trim();
      const corDestinoExata = rowDestinoExato.COR_PRODUTO?.toString().trim() || '';
      const estoqueDestinoAntesExato = rowDestinoExato.ESTOQUE || 0;

      // Verificar estoque antes do UPDATE (igual ao script Python)
      const req16_verif = pool.request();
      let queryVerificarDestinoAntes: string;
      if (corDestinoExata) {
        queryVerificarDestinoAntes = `
          SELECT ESTOQUE
          FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
          WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata
        `;
        req16_verif.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
        req16_verif.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
        req16_verif.input('corDestinoExata', sql.VarChar, corDestinoExata);
      } else {
        queryVerificarDestinoAntes = `
          SELECT ESTOQUE
          FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
          WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
        `;
        req16_verif.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
        req16_verif.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
      }
      const resultDestinoAntes = await req16_verif.query<{ ESTOQUE: number }>(queryVerificarDestinoAntes);
      const estoqueDestinoAntesUpdate = resultDestinoAntes.recordset.length > 0 && resultDestinoAntes.recordset[0].ESTOQUE ? resultDestinoAntes.recordset[0].ESTOQUE : 0;

      // Atualizar estoque de destino
      const req16 = pool.request();
      if (corDestinoExata) {
        const queryUpdateEstoqueDestino = `
          UPDATE ESTOQUE_PRODUTOS
          SET ESTOQUE = ESTOQUE + @qtdeEntrada
          WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata
        `;
        
        req16.input('qtdeEntrada', sql.Int, qtdeEntrada);
        req16.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
        req16.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
        req16.input('corDestinoExata', sql.VarChar, corDestinoExata);
        await req16.query(queryUpdateEstoqueDestino);
      } else {
        const queryUpdateEstoqueDestino = `
          UPDATE ESTOQUE_PRODUTOS
          SET ESTOQUE = ESTOQUE + @qtdeEntrada
          WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
        `;
        
        req16.input('qtdeEntrada', sql.Int, qtdeEntrada);
        req16.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
        req16.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
        await req16.query(queryUpdateEstoqueDestino);
      }

      // Verificar se o UPDATE realmente funcionou (igual ao script Python)
      const req16_depois = pool.request();
      let queryVerificarDestinoDepois: string;
      if (corDestinoExata) {
        queryVerificarDestinoDepois = `
          SELECT ESTOQUE
          FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
          WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata
        `;
        req16_depois.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
        req16_depois.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
        req16_depois.input('corDestinoExata', sql.VarChar, corDestinoExata);
      } else {
        queryVerificarDestinoDepois = `
          SELECT ESTOQUE
          FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
          WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
        `;
        req16_depois.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
        req16_depois.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
      }
      const resultDestinoDepois = await req16_depois.query<{ ESTOQUE: number }>(queryVerificarDestinoDepois);
      let estoqueDestinoDepois = resultDestinoDepois.recordset.length > 0 ? (resultDestinoDepois.recordset[0].ESTOQUE || 0) : null;
      
      // Se não funcionou, tentar UPDATE alternativo (igual ao script Python)
      if (estoqueDestinoDepois === null || estoqueDestinoDepois !== (estoqueDestinoAntesUpdate + qtdeEntrada)) {
        if (estoqueDestinoDepois === null || estoqueDestinoDepois === estoqueDestinoAntesUpdate) {
          // Tentar UPDATE alternativo
          const req16_alt = pool.request();
          const novoEstoqueDestino = estoqueDestinoAntesUpdate + qtdeEntrada;
          let queryUpdateDestinoAlternativo: string;
          if (corDestinoExata) {
            queryUpdateDestinoAlternativo = `
              UPDATE ESTOQUE_PRODUTOS
              SET ESTOQUE = @novoEstoqueDestino
              WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata
            `;
            req16_alt.input('novoEstoqueDestino', sql.Int, novoEstoqueDestino);
            req16_alt.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
            req16_alt.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
            req16_alt.input('corDestinoExata', sql.VarChar, corDestinoExata);
          } else {
            queryUpdateDestinoAlternativo = `
              UPDATE ESTOQUE_PRODUTOS
              SET ESTOQUE = @novoEstoqueDestino
              WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
            `;
            req16_alt.input('novoEstoqueDestino', sql.Int, novoEstoqueDestino);
            req16_alt.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
            req16_alt.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
          }
          await req16_alt.query(queryUpdateDestinoAlternativo);
          
          // Verificar novamente após UPDATE alternativo
          const req16_verif_alt = pool.request();
          let queryVerificarDestinoAlt: string;
          if (corDestinoExata) {
            queryVerificarDestinoAlt = `
              SELECT ESTOQUE
              FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
              WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND COR_PRODUTO = @corDestinoExata
            `;
            req16_verif_alt.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
            req16_verif_alt.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
            req16_verif_alt.input('corDestinoExata', sql.VarChar, corDestinoExata);
          } else {
            queryVerificarDestinoAlt = `
              SELECT ESTOQUE
              FROM ESTOQUE_PRODUTOS WITH (NOLOCK)
              WHERE PRODUTO = @produtoDestinoExato AND FILIAL = @filialDestinoExata AND (COR_PRODUTO IS NULL OR COR_PRODUTO = '')
            `;
            req16_verif_alt.input('produtoDestinoExato', sql.VarChar, produtoDestinoExato);
            req16_verif_alt.input('filialDestinoExata', sql.VarChar, filialDestinoExata);
          }
          const resultDestinoAlt = await req16_verif_alt.query<{ ESTOQUE: number }>(queryVerificarDestinoAlt);
          estoqueDestinoDepois = resultDestinoAlt.recordset.length > 0 ? (resultDestinoAlt.recordset[0].ESTOQUE || 0) : null;
          
          if (estoqueDestinoDepois !== novoEstoqueDestino) {
            throw new Error(`ERRO: Estoque de destino não foi atualizado corretamente. Esperado: ${novoEstoqueDestino}, Atual: ${estoqueDestinoDepois}`);
          }
        } else {
          throw new Error(`ERRO: Estoque de destino não foi atualizado corretamente. Esperado: ${estoqueDestinoAntesUpdate + qtdeEntrada}, Atual: ${estoqueDestinoDepois}`);
        }
      }
    } else {
      // Inserir novo registro de estoque
      const req17 = pool.request();
      const queryInsertEstoqueDestino = `
        INSERT INTO ESTOQUE_PRODUTOS (PRODUTO, COR_PRODUTO, FILIAL, ESTOQUE)
        VALUES (@produtoParaQuery, @corProdutoParaQuery, @filialDestinoParaQuery, @qtdeEntrada)
      `;
      
      req17.input('produtoParaQuery', sql.VarChar, produtoParaQuery);
      req17.input('corProdutoParaQuery', sql.VarChar, corProdutoParaQuery);
      req17.input('filialDestinoParaQuery', sql.VarChar, filialDestinoParaQuery);
      req17.input('qtdeEntrada', sql.Int, qtdeEntrada);
      await req17.query(queryInsertEstoqueDestino);
    }

    return NextResponse.json({
      success: true,
      romaneioSaida,
      romaneioEntrada: romaneioEntradaFinal,
      message: `Transferência executada com sucesso! Romaneio Saída: ${romaneioSaida}, Romaneio Entrada: ${romaneioEntradaFinal}`,
    });
  } catch (error: any) {
    console.error('Erro ao executar transferência', error);
    console.error('Detalhes do erro:', {
      message: error.message,
      code: error.code,
      number: error.number,
      state: error.state,
      class: error.class,
      originalError: error.originalError?.message,
      precedingErrors: error.precedingErrors
    });
    return NextResponse.json(
      { 
        error: error.message || 'Erro ao executar transferência',
        details: error.originalError?.message || error.message,
        code: error.code,
        number: error.number
      },
      { status: 500 }
    );
  }
}

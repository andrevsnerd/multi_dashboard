/**
 * Funções de processamento de relatórios
 * Replicam exatamente a lógica do script Python exportar_todos_relatorios.py
 */

// Colunas a remover por relatório (exatas do Python)
export const COLS_REMOVER = {
  produtos: [
    'CODIGO_PRECO', 'MATERIAL', 'TABELA_OPERACOES', 'FATOR_OPERACOES',
    'TABELA_MEDIDAS', 'CARTELA', 'UNIDADE', 'REVENDA', 'MODELAGEM',
    'SORTIMENTO_COR', 'SORTIMENTO_TAMANHO', 'VARIA_PRECO_COR', 'VARIA_PRECO_TAM',
    'PONTEIRO_PRECO_TAM', 'VARIA_CUSTO_COR', 'PERTENCE_A_CONJUNTO', 'TRIBUT_ICMS',
    'TRIBUT_ORIGEM', 'VARIA_CUSTO_TAM', 'CUSTO_REPOSICAO2', 'CUSTO_REPOSICAO3',
    'CUSTO_REPOSICAO4', 'ESTILISTA', 'MODELISTA', 'TAMANHO_BASE', 'GIRO_ENTREGA',
    'TIMESTAMP', 'INATIVO', 'ENVIA_LOJA_VAREJO', 'ENVIA_LOJA_ATACADO',
    'ENVIA_REPRESENTANTE', 'ENVIA_VAREJO_INTERNET', 'ENVIA_ATACADO_INTERNET',
    'MODELO', 'REDE_LOJAS', 'FABRICANTE_ICMS_ABATER', 'FABRICANTE_PRAZO_PGTO',
    'TAXA_JUROS_DEFLACIONAR', 'TAXAS_IMPOSTOS_APLICAR', 'PRECO_REPOSICAO_2',
    'PRECO_REPOSICAO_3', 'PRECO_REPOSICAO_4', 'PRECO_A_VISTA_REPOSICAO_2',
    'PRECO_A_VISTA_REPOSICAO_3', 'PRECO_A_VISTA_REPOSICAO_4', 'FABRICANTE_FRETE',
    'DROP_DE_TAMANHOS', 'STATUS_PRODUTO', 'TIPO_STATUS_PRODUTO', 'OBS',
    'COMPOSICAO', 'RESTRICAO_LAVAGEM', 'ORCAMENTO', 'CLIENTE_DO_PRODUTO',
    'CONTA_CONTABIL', 'ESPESSURA', 'ALTURA', 'LARGURA', 'COMPRIMENTO',
    'EMPILHAMENTO_MAXIMO', 'PARTE_TIPO', 'VERSAO_FICHA', 'COD_FLUXO_PRODUTO',
    'DATA_INICIO_DESENVOLVIMENTO', 'INDICADOR_CFOP', 'MONTAGEM_KIT',
    'MRP_AGRUPAR_NECESSIDADE_DIAS', 'MRP_AGRUPAR_NECESSIDADE_TIPO',
    'MRP_DIAS_SEGURANCA', 'MRP_EMISSAO_LIBERACAO_DIAS', 'MRP_ENTREGA_GIRO_DIAS',
    'MRP_PARTICIPANTE', 'MRP_MAIOR_GIRO_MP_DIAS', 'MRP_FP', 'MRP_RR',
    'OP_POR_COR', 'OP_QTDE_MAXIMA', 'OP_QTDE_MINIMA', 'QUALIDADE', 'SEMI_ACABADO',
    'CONTA_CONTABIL_COMPRA', 'CONTA_CONTABIL_VENDA', 'CONTA_CONTABIL_DEV_COMPRA',
    'CONTA_CONTABIL_DEV_VENDA', 'ID_EXCECAO_GRUPO', 'ID_EXCECAO_IMPOSTO',
    'DIAS_COMPRA', 'FATOR_P', 'FATOR_Q', 'FATOR_F', 'CONTINUIDADE',
    'COD_PRODUTO_SOLUCAO', 'COD_PRODUTO_SEGMENTO', 'ID_PRECO', 'TIPO_ITEM_SPED',
    'PERC_COMISSAO', 'ACEITA_ENCOMENDA', 'DIAS_GARANTIA_LOJA',
    'DIAS_GARANTIA_FABRICANTE', 'POSSUI_MONTAGEM', 'PERMITE_ENTREGA_FUTURA',
    'NATUREZA_RECEITA', 'COD_ALIQUOTA_PIS_COFINS_DIF', 'DATA_LIMITE_PEDIDO',
    'LX_STATUS_REGISTRO', 'ARREDONDA', 'ID_ARTIGO', 'LX_HASH', 'SPED_DATA_FIM',
    'SPED_DATA_INI', 'TIPO_PP', 'FATOR_A', 'FATOR_B', 'FATOR_BUFFER', 'FATOR_LT',
    'TIPO_CANAL', 'NAO_ENVIA_ETL', 'TITULO_B2C', 'DESCRICAO_B2C', 'PRE_VENDA',
    'TAGS', 'VIDEO_EMBED', 'CARACTERISTICAS_TECNICAS_B2C', 'FRETE_GRATIS',
    'ESTOQUE_MINIMO', 'DATA_PUBLICACAO_B2C', 'GRUPO_PRODUTO_B2C',
    'SUBGRUPO_PRODUTO_B2C', 'TIPO_PRODUTO_B2C', 'GRIFFE_B2C', 'LINHA_B2C',
    'FABRICANTE_B2C', 'CATEGORIA_B2C', 'SUBCATEGORIA_B2C', 'REPOSICAO_B2C',
    'IMG_ESTILO', 'DESCRICAO_B2C_2', 'DESCRICAO_B2C_3',
    'SUJEITO_SUBSTITUTICAO_TRIBUTARIA', 'OPTION_TITULO', 'OPTION_DESC',
    'OPTION_CARACTERISTICA', 'EMPRESA', 'SEXO_TIPO', 'PESO',
    'DIAS_ACERTO_CONSIGNACAO', 'POSSUI_GTIN'
  ],
  estoque: [
    'CUSTO_MEDIO1', 'CUSTO_MEDIO2', 'CUSTO_MEDIO3', 'CUSTO_MEDIO4',
    'ULTIMO_CUSTO1', 'ULTIMO_CUSTO2', 'ULTIMO_CUSTO3', 'ULTIMO_CUSTO4',
    'DATA_CUSTO_MEDIO', 'DATA_ULT_CUSTO',
    ...Array.from({ length: 48 }, (_, i) => `ES${i + 1}`),
    'TIMESTAMP', 'PRIMEIRA_ENTRADA', 'LX_STATUS_REGISTRO', 'LX_HASH'
  ],
  vendas: [
    'TAMANHO', 'PEDIDO', 'DESCONTO_ITEM', 'CODIGO_DESCONTO',
    'CODIGO_TAB_PRECO', 'OPERACAO_VENDA', 'FATOR_VENDA_LIQ', 'VALOR_TIKET',
    'DESCONTO', 'DATA_HORA_CANCELAMENTO', 'QTDE_CANCELADA'
  ]
};

/**
 * Converte colunas de data para Date
 */
function converterDatas(
  data: Record<string, any>[],
  colunas: string[]
): Record<string, any>[] {
  return data.map(row => {
    const newRow = { ...row };
    colunas.forEach(col => {
      if (col in newRow && newRow[col] != null) {
        const dateValue = new Date(newRow[col]);
        if (!isNaN(dateValue.getTime())) {
          newRow[col] = dateValue;
        }
      }
    });
    return newRow;
  });
}

/**
 * Remove colunas do array de dados
 */
function removerColunas(
  data: Record<string, any>[],
  colunas: string[]
): Record<string, any>[] {
  if (data.length === 0) return data;
  
  return data.map(row => {
    const newRow: Record<string, any> = {};
    Object.keys(row).forEach(key => {
      if (!colunas.includes(key)) {
        newRow[key] = row[key];
      }
    });
    return newRow;
  });
}

/**
 * Enriquece dados com código de barras
 */
function enriquecerComCodigoBarra(
  data: Record<string, any>[],
  codigosBarra: Record<string, any>[]
): Record<string, any>[] {
  if (data.length === 0 || codigosBarra.length === 0) return data;
  
  // Criar mapa de códigos de barras
  const codigoMap = new Map<string, string>();
  
  // Tentativa 1: PRODUTO + COR_PRODUTO + TAMANHO
  codigosBarra.forEach(item => {
    if (item.PRODUTO && item.COR_PRODUTO && item.TAMANHO && item.CODIGO_BARRA) {
      const key = `${item.PRODUTO}|${item.COR_PRODUTO}|${item.TAMANHO}`;
      codigoMap.set(key, item.CODIGO_BARRA);
    }
  });
  
  // Tentativa 2: PRODUTO + COR_PRODUTO
  codigosBarra.forEach(item => {
    if (item.PRODUTO && item.COR_PRODUTO && item.CODIGO_BARRA) {
      const key = `${item.PRODUTO}|${item.COR_PRODUTO}`;
      if (!codigoMap.has(key)) {
        codigoMap.set(key, item.CODIGO_BARRA);
      }
    }
  });
  
  // Tentativa 3: apenas PRODUTO
  codigosBarra.forEach(item => {
    if (item.PRODUTO && item.CODIGO_BARRA) {
      const key = item.PRODUTO;
      if (!codigoMap.has(key)) {
        codigoMap.set(key, item.CODIGO_BARRA);
      }
    }
  });
  
  // Aplicar códigos de barras aos dados
  return data.map(row => {
    const newRow = { ...row };
    
    // Tentar encontrar código de barras pela ordem de prioridade
    if (row.PRODUTO && row.COR_PRODUTO && row.TAMANHO) {
      const key1 = `${row.PRODUTO}|${row.COR_PRODUTO}|${row.TAMANHO}`;
      if (codigoMap.has(key1)) {
        newRow.CODIGO_BARRA = codigoMap.get(key1);
        return newRow;
      }
    }
    
    if (row.PRODUTO && row.COR_PRODUTO) {
      const key2 = `${row.PRODUTO}|${row.COR_PRODUTO}`;
      if (codigoMap.has(key2)) {
        newRow.CODIGO_BARRA = codigoMap.get(key2);
        return newRow;
      }
    }
    
    if (row.PRODUTO) {
      const key3 = row.PRODUTO;
      if (codigoMap.has(key3)) {
        newRow.CODIGO_BARRA = codigoMap.get(key3);
        return newRow;
      }
    }
    
    return newRow;
  });
}

/**
 * Processa relatório de produtos
 */
export function processarProdutos(
  produtos: Record<string, any>[],
  codigosBarra: Record<string, any>[]
): Record<string, any>[] {
  let result = converterDatas(produtos, [
    'DATA_REPOSICAO',
    'DATA_PARA_TRANSFERENCIA',
    'DATA_CADASTRAMENTO'
  ]);
  
  result = removerColunas(result, COLS_REMOVER.produtos);
  result = enriquecerComCodigoBarra(result, codigosBarra);
  
  return result;
}

/**
 * Processa relatório de estoque
 */
export function processarEstoque(
  estoque: Record<string, any>[],
  produtos: Record<string, any>[],
  codigosBarra: Record<string, any>[]
): Record<string, any>[] {
  if (estoque.length === 0) return [];
  
  // Criar mapa de produtos
  const produtoMap = new Map<string, Record<string, any>>();
  const colsProd = [
    'PRODUTO', 'DESC_PRODUTO', 'CUSTO_REPOSICAO1', 'PRECO_REPOSICAO_1',
    'LINHA', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO', 'GRADE', 'GRIFFE', 'COLECAO'
  ];
  
  produtos.forEach(prod => {
    if (prod.PRODUTO) {
      const prodData: Record<string, any> = {};
      colsProd.forEach(col => {
        if (col in prod) {
          prodData[col] = prod[col];
        }
      });
      produtoMap.set(prod.PRODUTO, prodData);
    }
  });
  
  // Merge com produtos
  let result = estoque.map(row => {
    const newRow = { ...row };
    const prodData = produtoMap.get(row.PRODUTO);
    if (prodData) {
      Object.assign(newRow, prodData);
    }
    return newRow;
  });
  
  // Converter datas
  result = converterDatas(result, [
    'ULTIMA_SAIDA',
    'ULTIMA_ENTRADA',
    'DATA_PARA_TRANSFERENCIA',
    'DATA_AJUSTE'
  ]);
  
  // Calcular VALOR_TOTAL_ESTOQUE
  result = result.map(row => {
    const estoque = row.ESTOQUE ?? 0;
    const custo = row.CUSTO_REPOSICAO1 ?? 0;
    return {
      ...row,
      VALOR_TOTAL_ESTOQUE: Number(estoque) * Number(custo)
    };
  });
  
  // Remover colunas
  result = removerColunas(result, COLS_REMOVER.estoque);
  
  // Enriquecer com código de barras
  result = enriquecerComCodigoBarra(result, codigosBarra);
  
  return result;
}

/**
 * Processa relatório de vendas
 */
export function processarVendas(
  vendas: Record<string, any>[],
  codigosBarra: Record<string, any>[]
): Record<string, any>[] {
  // Filtrar apenas QTDE > 0
  let result = vendas.filter(row => (row.QTDE ?? 0) > 0);
  
  // Converter datas
  result = converterDatas(result, ['DATA_VENDA']);
  
  // Enriquecer com código de barras (produto + cor + tamanho)
  result = enriquecerComCodigoBarra(result, codigosBarra);
  
  // Calcular VALOR_LIQUIDO
  result = result.map(row => {
    const qtdeCancelada = row.QTDE_CANCELADA ?? 0;
    const precoLiquido = row.PRECO_LIQUIDO ?? 0;
    const qtde = row.QTDE ?? 0;
    const descontoVenda = row.DESCONTO_VENDA ?? 0;
    
    const valorLiquido = qtdeCancelada > 0
      ? 0
      : (Number(precoLiquido) * Number(qtde)) - Number(descontoVenda);
    
    return {
      ...row,
      VALOR_LIQUIDO: valorLiquido
    };
  });
  
  // Remover colunas
  result = removerColunas(result, COLS_REMOVER.vendas);
  
  // Reordenar colunas (VALOR_LIQUIDO após QTDE)
  if (result.length > 0) {
    const cols = Object.keys(result[0]);
    const qtdeIndex = cols.indexOf('QTDE');
    
    if (qtdeIndex !== -1) {
      const valorLiquidoIndex = cols.indexOf('VALOR_LIQUIDO');
      if (valorLiquidoIndex !== -1) {
        cols.splice(valorLiquidoIndex, 1);
        cols.splice(qtdeIndex + 1, 0, 'VALOR_LIQUIDO');
        
        // Garantir que PRECO_LIQUIDO e DESCONTO_VENDA fiquem no final
        const precoLiquidoIndex = cols.indexOf('PRECO_LIQUIDO');
        const descontoVendaIndex = cols.indexOf('DESCONTO_VENDA');
        
        if (precoLiquidoIndex !== -1) {
          cols.splice(precoLiquidoIndex, 1);
          cols.push('PRECO_LIQUIDO');
        }
        
        if (descontoVendaIndex !== -1) {
          cols.splice(descontoVendaIndex, 1);
          cols.push('DESCONTO_VENDA');
        }
        
        result = result.map(row => {
          const newRow: Record<string, any> = {};
          cols.forEach(col => {
            newRow[col] = row[col];
          });
          return newRow;
        });
      }
    }
  }
  
  return result;
}

/**
 * Processa relatório de e-commerce
 */
export function processarEcommerce(
  ecommerce: Record<string, any>[]
): Record<string, any>[] {
  // Converter datas
  let result = converterDatas(ecommerce, ['EMISSAO', 'DATA_SAIDA', 'ENTREGA']);
  
  // Remover duplicatas mantendo apenas uma linha por NF_SAIDA + SERIE_NF + ITEM
  const seen = new Set<string>();
  result = result.filter(row => {
    const key = `${row.NF_SAIDA}|${row.SERIE_NF}|${row.ITEM}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  
  return result;
}

/**
 * Processa relatório de entradas
 */
export function processarEntradas(
  entradas: Record<string, any>[],
  produtos: Record<string, any>[],
  cores: Record<string, any>[]
): Record<string, any>[] {
  if (entradas.length === 0) return [];
  
  // Filtrar linhas com PRODUTO válido
  let result = entradas.filter(row => row.PRODUTO != null);
  
  // Criar mapa de produtos
  const produtoMap = new Map<string, Record<string, any>>();
  const colsProd = [
    'PRODUTO', 'DESC_PRODUTO', 'GRUPO_PRODUTO', 'SUBGRUPO_PRODUTO',
    'LINHA', 'COLECAO'
  ];
  
  produtos.forEach(prod => {
    if (prod.PRODUTO) {
      const prodData: Record<string, any> = {};
      colsProd.forEach(col => {
        if (col in prod) {
          prodData[col] = prod[col];
        }
      });
      produtoMap.set(prod.PRODUTO, prodData);
    }
  });
  
  // Merge com produtos
  result = result.map(row => {
    const newRow = { ...row };
    const prodData = produtoMap.get(row.PRODUTO);
    if (prodData) {
      Object.assign(newRow, prodData);
    }
    return newRow;
  });
  
  // Criar mapa de cores
  const coresMap = new Map<string, Record<string, any>>();
  cores.forEach(cor => {
    if (cor.COR) {
      coresMap.set(cor.COR, {
        COR_PRODUTO: cor.COR,
        DESC_COR_PRODUTO: cor.DESC_COR
      });
    }
  });
  
  // Merge com cores
  result = result.map(row => {
    const newRow = { ...row };
    const corData = coresMap.get(row.COR_PRODUTO);
    if (corData) {
      Object.assign(newRow, corData);
    }
    return newRow;
  });
  
  // Converter datas
  result = converterDatas(result, ['EMISSAO']);
  
  // Ordenar colunas (exatamente como no Python)
  const ordem = [
    'EMISSAO', 'FILIAL', 'ROMANEIO_PRODUTO', 'PRODUTO', 'DESC_PRODUTO',
    'COR_PRODUTO', 'DESC_COR_PRODUTO', 'QTDE_TOTAL', 'GRUPO_PRODUTO',
    'SUBGRUPO_PRODUTO', 'LINHA', 'COLECAO'
  ];
  
  if (result.length > 0) {
    const cols = Object.keys(result[0]);
    // Apenas colunas que existem no DataFrame
    const ordemFinal = ordem.filter(col => cols.includes(col));
    // Outras colunas que não estão na ordem específica (vão no final)
    const outrasCols = cols.filter(col => !ordem.includes(col));
    
    result = result.map(row => {
      const newRow: Record<string, any> = {};
      // Adicionar na ordem especificada
      ordemFinal.forEach(col => {
        newRow[col] = row[col];
      });
      // Adicionar outras colunas no final
      outrasCols.forEach(col => {
        newRow[col] = row[col];
      });
      return newRow;
    });
  }
  
  return result;
}


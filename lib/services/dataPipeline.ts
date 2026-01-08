import {
  INVENTORY_COLUMNS_TO_DROP,
  PRODUCT_COLUMNS_TO_DROP,
  SALES_COLUMNS_TO_DROP,
} from '@/lib/constants/columns';
import {
  dropColumns,
  enrichWithBarcode,
  convertDates,
  toNumber,
  type BarcodeRow,
} from '@/lib/utils/dataTransform';
import { fetchAllRaw, type RawData } from '@/lib/repositories/rawData';

type AnyRecord = Record<string, unknown>;

interface ProcessedData {
  produtos: AnyRecord[];
  estoque: AnyRecord[];
  vendas: AnyRecord[];
  ecommerce: AnyRecord[];
  entradas: AnyRecord[];
}

function buildProductsMap(produtos: AnyRecord[], field = 'PRODUTO') {
  const map = new Map<string, AnyRecord>();
  produtos.forEach((produto) => {
    const key = String(produto[field] ?? '').toUpperCase();
    if (!key) {
      return;
    }
    map.set(key, produto);
  });
  return map;
}

export async function processProdutos(rawData?: RawData) {
  const data =
    rawData ??
    (await fetchAllRaw());

  const produtos = data.produtos;
  const produtosBarra = data.produtosBarra;

  const converted = convertDates(produtos, [
    'DATA_REPOSICAO',
    'DATA_PARA_TRANSFERENCIA',
    'DATA_CADASTRAMENTO',
  ]);
  const trimmed = dropColumns(converted, PRODUCT_COLUMNS_TO_DROP);
  const enriched = enrichWithBarcode(trimmed, produtosBarra, {
    prioritizeSize: false,
  });

  return enriched;
}

export async function processEstoque(
  rawData?: RawData,
  produtosProcessados?: AnyRecord[]
) {
  const data =
    rawData ??
    (await fetchAllRaw());

  const estoque = data.estoque;
  const produtosBarra = data.produtosBarra;
  const produtosBase =
    produtosProcessados ?? (await processProdutos(data));

  const produtosMap = buildProductsMap(produtosBase);

  const merged = estoque.map((item) => {
    const produto = produtosMap.get(String(item.PRODUTO ?? '').toUpperCase());

    const complemento = produto
      ? {
          DESC_PRODUTO: produto.DESC_PRODUTO,
          CUSTO_REPOSICAO1: produto.CUSTO_REPOSICAO1,
          PRECO_REPOSICAO_1: produto.PRECO_REPOSICAO_1,
          LINHA: produto.LINHA,
          GRUPO_PRODUTO: produto.GRUPO_PRODUTO,
          SUBGRUPO_PRODUTO: produto.SUBGRUPO_PRODUTO,
          GRADE: produto.GRADE,
          GRIFFE: produto.GRIFFE,
        }
      : {};

    return {
      ...item,
      ...complemento,
    };
  });

  const converted = convertDates(merged, [
    'ULTIMA_SAIDA',
    'ULTIMA_ENTRADA',
    'DATA_PARA_TRANSFERENCIA',
    'DATA_AJUSTE',
  ]);

  const withTotals = converted.map((item) => {
    const record = item as AnyRecord;
    return {
      ...record,
      VALOR_TOTAL_ESTOQUE:
        toNumber(record.ESTOQUE) * toNumber(record.CUSTO_REPOSICAO1),
    };
  });

  const trimmed = dropColumns(withTotals, INVENTORY_COLUMNS_TO_DROP);
  const enriched = enrichWithBarcode(trimmed, produtosBarra);

  return enriched;
}

export async function processVendas(
  rawData?: RawData,
  produtosBarra?: BarcodeRow[]
) {
  const data =
    rawData ??
    (await fetchAllRaw());

  const barcodes: BarcodeRow[] =
    produtosBarra ?? (data.produtosBarra as BarcodeRow[]);

  // 1) NÃO filtrar linhas - incluir todas (incluindo valores negativos de trocas puras)
  //    O SQL já calcula VALOR_LIQUIDO_CALC e QTDE_LIQUIDA_CALC corretamente
  const converted = convertDates(data.vendas, ['DATA_VENDA']);

  // 2) Enriquecimento com códigos de barra usando a mesma lógica do site:
  //    prioridade PRODUTO+COR+TAMANHO, depois PRODUTO+COR, depois PRODUTO
  const enriched = enrichWithBarcode(converted, barcodes, { prioritizeSize: true });

  // 3) Usar diretamente os valores calculados no SQL (VALOR_LIQUIDO_CALC e QTDE_LIQUIDA_CALC)
  //    Não recalcular no JavaScript para evitar erros de ponto flutuante
  const withValoresCalculados = enriched.map((item) => {
    const record = item as AnyRecord;
    
    // Usar valores calculados diretamente do SQL
    const valorLiquidoCalc = toNumber(record.VALOR_LIQUIDO_CALC ?? 0);
    const qtdeLiquidaCalc = toNumber(record.QTDE_LIQUIDA_CALC ?? 0);
    
    // Calcular TOTAL_VENDA para manter compatibilidade (se necessário)
    const qtdeCancelada = toNumber(record.QTDE_CANCELADA);
    const precoLiquido = toNumber(record.PRECO_LIQUIDO);
    const qtde = toNumber(record.QTDE);
    const descontoVenda = toNumber(record.DESCONTO_VENDA);
    const totalVenda = qtdeCancelada > 0 ? 0 : precoLiquido * qtde - descontoVenda;
    const totalQtdeVenda = qtdeCancelada > 0 ? 0 : qtde;
    
    // Garantir que as colunas de troca existam
    const qtdeTrocaItem = toNumber(record.QTDE_TROCA_ITEM ?? 0);
    const valorTrocaItem = toNumber(record.VALOR_TROCA_ITEM ?? 0);
    const qtdeTroca = toNumber(record.QTDE_TROCA ?? qtdeTrocaItem);
    const valorTroca = toNumber(record.VALOR_TROCA ?? valorTrocaItem);

    return {
      ...record,
      TOTAL_VENDA: totalVenda,
      TOTAL_QTDE_VENDA: totalQtdeVenda,
      QTDE_TROCA_ITEM: qtdeTrocaItem,
      VALOR_TROCA_ITEM: valorTrocaItem,
      QTDE_TROCA: qtdeTroca,
      VALOR_TROCA: valorTroca,
      // Usar valores calculados diretamente do SQL
      VALOR_LIQUIDO: valorLiquidoCalc,
      QTDE: Math.round(qtdeLiquidaCalc), // Garantir valores inteiros
    };
  });

  // 4) Remover colunas técnicas, igual ao SALES_COLUMNS_TO_DROP do site
  const trimmed = dropColumns(withValoresCalculados, SALES_COLUMNS_TO_DROP);

  // 5) Reordenar colunas: VALOR_LIQUIDO logo após QTDE
  const reordered = trimmed.map((item) => {
    if (!('VALOR_LIQUIDO' in item)) {
      return item;
    }

    const entries = Object.entries(item);
    const result: AnyRecord = {};
    entries.forEach(([key, value]) => {
      result[key] = value;
    });

    if ('VALOR_LIQUIDO' in result && 'QTDE' in result) {
      const { VALOR_LIQUIDO, QTDE, ...rest } = result;
      return {
        ...('QTDE' in item ? { QTDE } : {}),
        VALOR_LIQUIDO,
        ...rest,
      };
    }

    return result;
  });

  return reordered;
}

export async function processEcommerce(rawData?: RawData) {
  const data =
    rawData ??
    (await fetchAllRaw());
  return convertDates(data.ecommerce, ['EMISSAO', 'DATA_SAIDA', 'ENTREGA']);
}

export async function processEntradas(
  rawData?: RawData,
  produtosProcessados?: AnyRecord[]
) {
  const data =
    rawData ??
    (await fetchAllRaw());

  if (!data.entradas.length) {
    return [];
  }

  const produtos =
    produtosProcessados ?? (await processProdutos(data));
  const coresMap = new Map(
    data.cores.map((cor) => [String(cor.COR ?? '').toUpperCase(), cor])
  );
  const produtosMap = buildProductsMap(produtos);

  const merged = data.entradas
    .filter((item) => item.PRODUTO != null)
    .map((item) => {
      const produto = produtosMap.get(
        String(item.PRODUTO ?? '').toUpperCase()
      );
      const cor =
        coresMap.get(String(item.COR_PRODUTO ?? '').toUpperCase()) ?? null;

      return {
        ...item,
        DESC_PRODUTO: produto?.DESC_PRODUTO,
        GRUPO_PRODUTO: produto?.GRUPO_PRODUTO,
        SUBGRUPO_PRODUTO: produto?.SUBGRUPO_PRODUTO,
        LINHA: produto?.LINHA,
        COLECAO: produto?.COLECAO,
        DESC_COR_PRODUTO: cor?.DESC_COR,
      };
    });

  const converted = convertDates(merged, ['EMISSAO']);

  const desiredOrder = [
    'EMISSAO',
    'FILIAL',
    'ROMANEIO_PRODUTO',
    'PRODUTO',
    'DESC_PRODUTO',
    'COR_PRODUTO',
    'DESC_COR_PRODUTO',
    'QTDE_TOTAL',
    'GRUPO_PRODUTO',
    'SUBGRUPO_PRODUTO',
    'LINHA',
    'COLECAO',
  ];

  const ordered = converted.map((item) => {
    const record = item as AnyRecord;
    const orderedItem: AnyRecord = {};
    desiredOrder.forEach((key) => {
      if (key in record) {
        orderedItem[key] = record[key];
      }
    });
    return orderedItem;
  });

  return ordered;
}

export async function processAllData(): Promise<ProcessedData> {
  const rawData = await fetchAllRaw();
  const produtos = await processProdutos(rawData);
  const estoque = await processEstoque(rawData, produtos);
  const vendas = await processVendas(rawData);
  const ecommerce = await processEcommerce(rawData);
  const entradas = await processEntradas(rawData, produtos);

  return {
    produtos,
    estoque,
    vendas,
    ecommerce,
    entradas,
  };
}


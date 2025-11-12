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

  const filtered = data.vendas.filter((item) => toNumber(item.QTDE) > 0);
  const converted = convertDates(filtered, ['DATA_VENDA']);

  const withValue = converted.map((item) => {
    const qtdeCancelada = toNumber(item.QTDE_CANCELADA);
    const precoLiquido = toNumber(item.PRECO_LIQUIDO);
    const qtde = toNumber(item.QTDE);
    const descontoVenda = toNumber(item.DESCONTO_VENDA);

    const valorLiquido =
      qtdeCancelada > 0 ? 0 : precoLiquido * qtde - descontoVenda;

    return {
      ...item,
      VALOR_LIQUIDO: valorLiquido,
    };
  });

  const trimmed = dropColumns(withValue, SALES_COLUMNS_TO_DROP);
  const enriched = enrichWithBarcode(trimmed, barcodes, { prioritizeSize: true });

  const reordered = enriched.map((item) => {
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


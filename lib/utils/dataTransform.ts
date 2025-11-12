type AnyRecord = Record<string, unknown>;

const DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

export function convertDates<T extends AnyRecord>(
  data: T[],
  columns: string[]
): T[] {
  if (!columns.length) {
    return data;
  }

  return data.map((item) => {
    const next: AnyRecord = { ...item };

    columns.forEach((column) => {
      const value = next[column];
      if (!value) {
        return;
      }

      const date = value instanceof Date ? value : new Date(value as string);

      if (Number.isNaN(date.getTime())) {
        next[column] = null;
      } else {
        next[column] = date.toISOString();
        next[`${column}_FORMATADO`] = new Intl.DateTimeFormat(
          'pt-BR',
          DATE_FORMAT_OPTIONS
        ).format(date);
      }
    });

    return next as T;
  });
}

export function dropColumns<T extends AnyRecord>(
  data: T[],
  columns: string[]
): T[] {
  if (!columns.length) {
    return data;
  }

  return data.map((item) => {
    const next = { ...item };
    columns.forEach((column) => {
      if (column in next) {
        delete next[column];
      }
    });
    return next;
  });
}

interface BarcodeRow {
  PRODUTO: string;
  COR_PRODUTO?: string | null;
  TAMANHO?: string | null;
  CODIGO_BARRA?: string | null;
}

interface EnrichBarcodeOptions {
  prioritizeSize?: boolean;
}

function buildBarcodeKey(parts: Array<string | null | undefined>): string {
  return parts
    .map((value) => (value ?? '').toString().trim().toUpperCase())
    .join('::');
}

export function enrichWithBarcode<T extends AnyRecord>(
  data: T[],
  barcodes: BarcodeRow[],
  options: EnrichBarcodeOptions = {}
): T[] {
  if (!data.length || !barcodes.length) {
    return data;
  }

  const prioritizeSize = options.prioritizeSize ?? true;

  const barcodeByProduct = new Map<string, BarcodeRow>();
  const barcodeByProductColor = new Map<string, BarcodeRow>();
  const barcodeByProductColorSize = new Map<string, BarcodeRow>();

  barcodes.forEach((row) => {
    if (!row.PRODUTO) {
      return;
    }

    const productKey = buildBarcodeKey([row.PRODUTO]);
    if (!barcodeByProduct.has(productKey)) {
      barcodeByProduct.set(productKey, row);
    }

    const productColorKey = buildBarcodeKey([row.PRODUTO, row.COR_PRODUTO]);
    if (!barcodeByProductColor.has(productColorKey)) {
      barcodeByProductColor.set(productColorKey, row);
    }

    const productColorSizeKey = buildBarcodeKey([
      row.PRODUTO,
      row.COR_PRODUTO,
      row.TAMANHO,
    ]);
    if (!barcodeByProductColorSize.has(productColorSizeKey)) {
      barcodeByProductColorSize.set(productColorSizeKey, row);
    }
  });

  return data.map((item) => {
    const next = { ...item };
    const product = buildBarcodeKey([item.PRODUTO as string | undefined]);
    const productColor = buildBarcodeKey([
      item.PRODUTO as string | undefined,
      item.COR_PRODUTO as string | undefined,
    ]);
    const productColorSize = buildBarcodeKey([
      item.PRODUTO as string | undefined,
      item.COR_PRODUTO as string | undefined,
      item.TAMANHO as string | undefined,
    ]);

    const candidates: Array<BarcodeRow | undefined> = [];

    if (prioritizeSize) {
      candidates.push(barcodeByProductColorSize.get(productColorSize));
    }
    candidates.push(barcodeByProductColor.get(productColor));
    candidates.push(barcodeByProduct.get(product));

    const match = candidates.find((candidate) => candidate?.CODIGO_BARRA);

    if (match?.CODIGO_BARRA) {
      next.CODIGO_BARRA = match.CODIGO_BARRA;
    }

    return next as T;
  });
}

export function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}



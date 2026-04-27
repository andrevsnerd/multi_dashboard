export interface CompraSalvaItemRow {
  itemKey: string;
  produto: string;
  corProduto?: string;
  corDescricao?: string;
  descricao: string;
  grade?: string;
  colecao?: string;
  qtdManual: number;
  custoUnitario?: number;
  /** codFilial usado para calcular a sugestão ao salvar. null = todas as filiais. undefined = compra antiga sem esta informação. */
  filialOrigem?: string | null;
}

export interface CompraSalva {
  id: string;
  companyKey: string;
  sourceContextKey: string;
  title: string;
  expandirPorCor: boolean;
  items: CompraSalvaItemRow[];
  comprada: boolean;
  savedAt: string;
  updatedAt: string;
}

export interface CompraSalvaListEntry {
  id: string;
  title: string;
  itemCount: number;
  totalQtdManual: number;
  totalValor: number;
  comprada: boolean;
  savedAt: string;
  updatedAt: string;
}

export interface CompraSalvaDailyTotal {
  date: string;
  totalValor: number;
  totalCompras: number;
}

export interface CompraSalvaListSummary {
  totalGeralPeriodo: number;
  totalCompras: number;
  porData: CompraSalvaDailyTotal[];
}

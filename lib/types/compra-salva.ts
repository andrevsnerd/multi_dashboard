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
}

export interface CompraSalva {
  id: string;
  companyKey: string;
  sourceContextKey: string;
  title: string;
  expandirPorCor: boolean;
  items: CompraSalvaItemRow[];
  savedAt: string;
  updatedAt: string;
}

export interface CompraSalvaListEntry {
  id: string;
  title: string;
  itemCount: number;
  totalQtdManual: number;
  totalValor: number;
  savedAt: string;
  updatedAt: string;
}

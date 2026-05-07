export type CompraTransitoStatus = "em_transito" | "recebido";

export interface CompraTransitoItemRow {
  itemKey: string;
  produto: string;
  descricao: string;
  corProduto?: string;
  corDescricao?: string;
  grade?: string;
  dataRecebimento: string;
  quantidade: number;
  custoUnitario?: number;
  estoqueAtual?: number;
  status: CompraTransitoStatus;
}

export interface CompraTransito {
  id: string;
  companyKey: string;
  title: string;
  status: CompraTransitoStatus;
  items: CompraTransitoItemRow[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
}

export interface CompraTransitoListEntry {
  id: string;
  title: string;
  itemCount: number;
  totalQuantidade: number;
  totalValor: number;
  status: CompraTransitoStatus;
  minDataRecebimento: string | null;
  maxDataRecebimento: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
}

export type CompraTransitoStatus = "rascunho" | "em_transito" | "recebido";

export interface CompraTransitoItemRow {
  itemKey: string;
  produto: string;
  descricao: string;
  codigoBarra?: string;
  corProduto?: string;
  corDescricao?: string;
  grade?: string;
  dataRecebimento: string;
  /**
   * true quando o usuário fixou a data manualmente. Quando ausente/false, a data é
   * AUTOMÁTICA: na confirmação o sistema calcula dataRecebimento = data da confirmação +
   * tempo de produção (producaoDias do ciclo do produto). Permite recalcular conforme a
   * data real em que a compra é confirmada, sem sobrescrever o que o usuário fixou.
   */
  dataRecebimentoManual?: boolean;
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
  createdByName?: string;
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
  createdByName?: string;
}

/**
 * Status "real" de um item, derivado da reconciliação contra entradas físicas na
 * matriz — diferente do status por data (que só presume a chegada). "atrasado" e
 * "parcial" não existem no enum persistido; vivem só aqui, na camada de resposta.
 * "parcial" = recebeu parte, mas ainda falta (o restante continua em trânsito).
 */
export type CompraTransitoStatusReal =
  | "rascunho"
  | "em_transito"
  | "atrasado"
  | "parcial"
  | "recebido";

/** Resultado da reconciliação de UM item contra as entradas reais na matriz. */
export interface CompraTransitoItemReconciliacao {
  /** Quantidade que realmente entrou na matriz, atribuída a este item (FIFO). */
  recebidoQtd: number;
  /** max(0, pedido - recebido). */
  faltou: number;
  /** Quantidade que entrou além do pedido (atribuída ao item mais novo elegível). */
  excedeu: number;
  /** Data real de chegada (última entrada alocada). */
  recebidoEm?: string;
  firstEntryDate?: string;
  lastEntryDate?: string;
  statusReal: CompraTransitoStatusReal;
  /** Entradas físicas que alimentaram este item (uma ou mais). */
  allocatedEntries: Array<{
    data: string;
    qtde: number;
    romaneio?: string;
    responsavel?: string;
    custoUnitario?: number;
    excess?: boolean;
  }>;
}

/** Item da compra enriquecido com a reconciliação (campos de resposta, não persistidos). */
export type CompraTransitoItemReconciledRow = CompraTransitoItemRow & Partial<CompraTransitoItemReconciliacao>;

/** Resposta do endpoint de reconciliação para UMA compra. */
export interface CompraTransitoReconciliacaoResposta {
  compraId: string;
  /** itemKey -> reconciliação. */
  itens: Record<string, CompraTransitoItemReconciliacao>;
  resumo: {
    totalItens: number;
    recebidos: number;
    parciais: number;
    atrasados: number;
    emTransito: number;
    statusGeral: CompraTransitoStatusReal;
  };
}

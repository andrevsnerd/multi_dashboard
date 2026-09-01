import type {
  CompraGastoCanal,
  CompraGastoTipo,
} from "@/lib/types/compra-gasto";

export type CompraTransitoStatus = "rascunho" | "em_transito" | "recebido";

/**
 * Uma parcela do PLANO de pagamento da compra, em dias e percentual — nunca em
 * data e valor fixos.
 *
 * A compra em trânsito é configurada antes de ser confirmada, e é a confirmação
 * que define a data da compra (e o valor final dos itens). Guardar "vence em
 * 12/03, R$ 4.000" congelaria um vencimento que já nasce velho quando a
 * confirmação acontece uma semana depois. Guardando "90 dias depois, 50%", o
 * mesmo plano reancora sozinho na data real da confirmação e o valor acompanha
 * o total real dos itens.
 *
 * O plano é o resultado, não o modelo: se o parcelamento saiu do modelo Salete,
 * do China ou foi digitado à mão, o que fica gravado são as parcelas geradas.
 * Modelo salvo viraria mentira no primeiro ajuste manual — mesma decisão já
 * tomada em `CompraGastoModeloParcelamento`.
 */
export interface CompraTransitoParcelaPlano {
  /** Dias corridos depois da data da compra (= dia da confirmação). */
  dias: number;
  /** Fatia do total. É PESO: a lista é normalizada pela própria soma. */
  pct: number;
  /** Canal do pagamento (China = transferência + Alibaba). Nulo = pagamento único. */
  canal?: CompraGastoCanal | null;
  /** Etapa que originou a data ("no despacho"), só para leitura humana. */
  etapa?: string | null;
}

/**
 * Forma de pagamento da compra em trânsito: o que faz a confirmação já nascer
 * lançada em Gastos de Compra, sem redigitar nada lá.
 *
 * Ausente/nulo = compra antiga (ou salva sem configurar): a confirmação não
 * lança nada e o painel continua podendo importá-la à mão.
 */
export interface CompraTransitoPagamento {
  /** false = confirmar NÃO cria a compra em Gastos de Compra. */
  lancar: boolean;
  /** Tipo do gasto no painel (mercadoria, frete, adiantamento…). */
  tipo: CompraGastoTipo;
  fornecedor?: string | null;
  observacao?: string | null;
  /**
   * Parcelamento planejado. Vazio/ausente = à vista na data da compra (o
   * padrão: a compra nasce inteira, no mês em que foi fechada).
   */
  plano?: CompraTransitoParcelaPlano[] | null;
}

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
  /**
   * Compra Salva que originou esta compra em trânsito, quando ela nasceu do
   * "Exportar para trânsito". Registro de procedência: diz de qual lista a
   * compra saiu.
   */
  compraSalvaId?: string | null;
  status: CompraTransitoStatus;
  items: CompraTransitoItemRow[];
  createdAt: string;
  updatedAt: string;
  confirmedAt: string;
  createdByName?: string;
  /** Forma de pagamento configurada aqui e usada ao lançar em Gastos de Compra. */
  pagamento?: CompraTransitoPagamento | null;
}

export interface CompraTransitoListEntry {
  id: string;
  title: string;
  compraSalvaId?: string | null;
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
  pagamento?: CompraTransitoPagamento | null;
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

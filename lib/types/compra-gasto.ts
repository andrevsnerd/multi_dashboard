/**
 * Gastos de Compra — planejamento mensal de desembolso com compra.
 *
 * Modelo em duas peças:
 *  - LOTE (`CompraGastoLote`): uma compra. Pode nascer de uma Compra Salva, de
 *    linhas digitadas à mão (com ou sem vínculo a produto do Linx) ou de um
 *    valor único sem item nenhum (adiantamento, frete de despachante, verba).
 *  - PARCELA (`CompraGastoParcela`): o desembolso. Cada parcela conta UMA vez,
 *    no mês do seu vencimento — 4x de 25% aparecem em quatro meses diferentes,
 *    nunca somadas no mês da compra.
 *
 * O orçamento (`CompraGastoOrcamentoEntry`) é o único dado 100% digitado: quanto
 * pretendemos gastar em cada mês-calendário.
 */

export type CompraGastoTipo =
  | "mercadoria"
  | "frete"
  | "adiantamento"
  | "material"
  | "outros";

export type CompraGastoOrigem = "salva" | "itens" | "valor";

export const COMPRA_GASTO_TIPO_LABEL: Record<CompraGastoTipo, string> = {
  mercadoria: "Mercadoria",
  frete: "Frete e importação",
  adiantamento: "Adiantamento a fornecedor",
  material: "Embalagem e material",
  outros: "Outros",
};

export const COMPRA_GASTO_ORIGEM_LABEL: Record<CompraGastoOrigem, string> = {
  salva: "Compra Salva",
  itens: "Itens digitados",
  valor: "Valor único",
};

/**
 * Uma linha da compra. `produto` preenchido = linha vinculada ao cadastro do
 * Linx (casa com a entrada de estoque). `produto` nulo = linha livre: frete,
 * rateio de importação, amostra, serviço — entra no gasto sem virar estoque.
 */
export interface CompraGastoItem {
  descricao: string;
  produto?: string | null;
  corProduto?: string | null;
  corDescricao?: string | null;
  qtd: number;
  custoUnitario: number;
}

export interface CompraGastoParcela {
  numero: number;
  /** YYYY-MM-DD */
  vencimento: string;
  valor: number;
  pago: boolean;
  /** YYYY-MM-DD */
  dataPagamento?: string | null;
}

export interface CompraGastoLote {
  id: string;
  companyKey: string;
  /** Apelido curto da compra ("compra 10"), como na planilha. */
  codigo: string;
  titulo: string;
  colecao?: string | null;
  fornecedor?: string | null;
  tipo: CompraGastoTipo;
  origem: CompraGastoOrigem;
  /** Compra Salva de origem, quando houver. */
  compraSalvaId?: string | null;
  /** YYYY-MM-DD */
  dataCompra: string;
  chegadaIni?: string | null;
  chegadaFim?: string | null;
  chegadaReal?: string | null;
  /** Data em que a mercadoria entra no PDV. */
  pdv?: string | null;
  /** Valor ainda é chute (grade/mix a definir) — sai hachurado no gráfico. */
  estimado: boolean;
  /** Só para origem "valor": o total informado à mão. */
  valorUnico?: number | null;
  observacao?: string | null;
  itens: CompraGastoItem[];
  parcelas: CompraGastoParcela[];
  criadoPor?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompraGastoOrcamentoEntry {
  /** YYYY-MM */
  ym: string;
  valor: number;
  observacao?: string | null;
  updatedBy?: string | null;
  updatedAt?: string | null;
}

export interface CompraGastoLoteNoMes {
  loteId: string;
  /** Quanto deste lote vence neste mês. */
  valor: number;
  /** Quanto disso já foi pago. */
  pago: number;
  /** Quantas parcelas do lote caem neste mês (e de quantas no total). */
  parcelasNoMes: number;
  totalParcelas: number;
}

export interface CompraGastoMes {
  /** YYYY-MM */
  ym: string;
  orcamento: number;
  /** false = mês sem orçamento definido; nesse caso não existe saldo a julgar. */
  temOrcamento: boolean;
  comprometido: number;
  pago: number;
  aPagar: number;
  /** Parte do "a pagar" que é compra firme. */
  firme: number;
  /** Parte do "a pagar" que ainda é estimativa. */
  estimado: number;
  saldo: number;
  lotes: CompraGastoLoteNoMes[];
}

export interface CompraGastoTotais {
  orcamento: number;
  comprometido: number;
  pago: number;
  aPagar: number;
  firme: number;
  estimado: number;
  saldo: number;
  mesesEstourados: number;
}

export interface CompraGastoPainel {
  lotes: CompraGastoLote[];
  orcamento: CompraGastoOrcamentoEntry[];
}

export type CompraGastoStatusKey =
  | "estimativa"
  | "no-pdv"
  | "recebido"
  | "atrasado"
  | "transito"
  | "lancado";

export interface CompraGastoStatus {
  key: CompraGastoStatusKey;
  label: string;
  /** Semântica visual: good | warn | crit | mute */
  tom: "good" | "warn" | "crit" | "mute";
}

/** Payload de criação/edição de lote (o que a tela manda para a API). */
export interface CompraGastoLoteInput {
  codigo: string;
  titulo: string;
  colecao?: string | null;
  fornecedor?: string | null;
  tipo: CompraGastoTipo;
  origem: CompraGastoOrigem;
  compraSalvaId?: string | null;
  dataCompra: string;
  chegadaIni?: string | null;
  chegadaFim?: string | null;
  chegadaReal?: string | null;
  pdv?: string | null;
  estimado?: boolean;
  valorUnico?: number | null;
  observacao?: string | null;
  itens?: CompraGastoItem[];
  parcelas?: CompraGastoParcela[];
}

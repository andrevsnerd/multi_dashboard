/**
 * Gastos de Compra — planejamento mensal de desembolso com compra.
 *
 * Modelo em duas peças:
 *  - LOTE (`CompraGastoLote`): uma compra. Pode nascer de uma Compra em trânsito
 *    confirmada, de linhas digitadas à mão (com ou sem vínculo a produto do Linx)
 *    ou de um valor único sem item nenhum (adiantamento, frete de despachante,
 *    verba).
 *  - PARCELA (`CompraGastoParcela`): o desembolso. Cada parcela conta UMA vez,
 *    no mês do seu vencimento — 4x de 25% aparecem em quatro meses diferentes,
 *    nunca somadas no mês da compra.
 *
 * O orçamento (`CompraGastoOrcamentoEntry`) é o único dado 100% digitado: quanto
 * pretendemos gastar em cada mês-calendário.
 */

import type { CompraTransitoStatus } from "@/lib/types/compra-transito";

export type CompraGastoTipo =
  | "mercadoria"
  | "frete"
  | "adiantamento"
  | "material"
  | "outros";

/**
 * De onde vem o valor da compra.
 *
 *  - `transito`: de uma Compra em trânsito CONFIRMADA (itens, quantidades,
 *    custo e previsão de chegada vêm dela). É a única origem vinculada ao
 *    estoque — compra confirmada em trânsito é compra que existe de verdade.
 *  - `itens`: linhas digitadas à mão.
 *  - `premier`: compra de embalagem/material da Premier. As linhas já vêm
 *    prontas (sacola, caixa, tag…) e só quantidade e preço são digitados.
 *  - `valor`: LEGADO. Só descrição e valor total. Saiu da tela de lançamento —
 *    o valor continua aqui para os lotes já gravados serem lidos.
 *  - `salva`: LEGADO. Antes de a fonte passar a ser a Compra em trânsito, o
 *    vínculo era com a Compra Salva. Nenhuma compra nova nasce assim; o valor
 *    só existe para os lotes já gravados continuarem legíveis no painel.
 */
export type CompraGastoOrigem = "transito" | "itens" | "premier" | "valor" | "salva";

/**
 * Itens fixos da compra Premier — embalagem e material de loja. A lista é o
 * catálogo do fornecedor: aparece inteira no lançamento e o usuário preenche
 * quantidade e preço só do que está comprando (linha sem quantidade é ignorada).
 */
export const COMPRA_GASTO_PREMIER_ITENS: string[] = [
  "Sacola SP63",
  "Caixa Lenço",
  "Lamina",
  "Faixinha",
  "Tag",
  "Sacola SP28",
  "Caixa CTC-90",
  "Caixa Rígida",
  "Caixa Pashimina",
];

/**
 * Canal de pagamento de uma parcela.
 *
 * Existe porque uma compra pode ter DOIS pagamentos correndo em paralelo que
 * caem nas MESMAS datas — a compra na China é transferência bancária (40% do
 * total) + Alibaba (60%), cada um com o próprio 30/50/20. O mês soma os dois
 * (cada parcela conta uma vez, como sempre), e o canal é o que permite ver cada
 * pagamento separado depois de lançado.
 *
 * Parcela sem canal = pagamento único, o caso normal.
 */
export type CompraGastoCanal = "transferencia" | "alibaba";

export const COMPRA_GASTO_CANAL_LABEL: Record<CompraGastoCanal, string> = {
  transferencia: "Transferência bancária",
  alibaba: "Alibaba",
};

/** Rótulo curto, para caber em célula de tabela e tag. */
export const COMPRA_GASTO_CANAL_CURTO: Record<CompraGastoCanal, string> = {
  transferencia: "Transferência",
  alibaba: "Alibaba",
};

/** Ordem de exibição dos canais — a mesma em toda tela. */
export const COMPRA_GASTO_CANAIS: CompraGastoCanal[] = ["transferencia", "alibaba"];

/**
 * Fornecedor da compra. Não é só um rótulo: cada fornecedor paga do seu jeito,
 * então escolher o nome no lançamento GERA o parcelamento (datas e valores).
 *
 *  - `salete`, `telma`, `roseli`: 2x iguais, 90 e 120 dias depois da compra.
 *  - `china` (Nick), `china_hannah`, `india_kunal`, `nepal`: transferência 40% +
 *    Alibaba 60%, cada canal com 30% no ato do pedido, 50% no despacho (+30
 *    dias) e 20% 60 dias depois do despacho (+90).
 *
 * Fornecedores com a mesma regra são entradas SEPARADAS de propósito: hoje
 * copiam o calendário do vizinho, e o dia em que um deles mudar mexe só na
 * própria linha da tabela. As regras de cada um estão em
 * [compra-gastos-agregacao.ts](../utils/compra-gastos-agregacao.ts), e a
 * documentação para consulta em [docs/GASTOS_COMPRA_FORNECEDORES.md](../../docs/GASTOS_COMPRA_FORNECEDORES.md).
 *
 * O QUE FICA GRAVADO no lote é esta chave, no campo `fornecedor` — é ela que
 * responde "de quem foi esta compra" depois. O parcelamento gerado também fica
 * salvo (datas, valores, canal e etapa), porque pode ser ajustado à mão em
 * seguida: o fornecedor diz de onde as parcelas vieram, não o que elas são.
 * Compras antigas têm texto livre nesse campo — daí a leitura ser tolerante.
 */
export type CompraGastoFornecedor =
  | "salete"
  | "telma"
  | "roseli"
  | "china"
  | "china_hannah"
  | "india_kunal"
  | "nepal";

/**
 * Modelo de parcelamento = o calendário de um fornecedor, mais o `manual`
 * (ninguém escolhido: quem divide é o usuário, em Nx / %).
 */
export type CompraGastoModeloParcelamento = CompraGastoFornecedor | "manual";

export const COMPRA_GASTO_TIPO_LABEL: Record<CompraGastoTipo, string> = {
  mercadoria: "Mercadoria",
  frete: "Frete e importação",
  adiantamento: "Adiantamento a fornecedor",
  material: "Embalagem e material",
  outros: "Outros",
};

export const COMPRA_GASTO_ORIGEM_LABEL: Record<CompraGastoOrigem, string> = {
  transito: "Compra em trânsito",
  itens: "Itens digitados",
  premier: "Premier",
  valor: "Valor único (legado)",
  salva: "Compra Salva (legado)",
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
  /** Canal do pagamento. Nulo/ausente = pagamento único, sem divisão por canal. */
  canal?: CompraGastoCanal | null;
  /** Etapa que originou a data ("no despacho"), só para leitura humana. */
  etapa?: string | null;
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
  /** Compra em trânsito confirmada que originou a compra (origem "transito"). */
  compraTransitoId?: string | null;
  /** LEGADO: Compra Salva de origem dos lotes gravados antes da troca de fonte. */
  compraSalvaId?: string | null;
  /** Data em que a compra foi fechada (YYYY-MM-DD). */
  dataCompra: string;
  /** Previsão de chegada. */
  chegadaIni?: string | null;
  /** Chegada confirmada. */
  chegadaReal?: string | null;
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

/**
 * Compra em trânsito reconhecida como candidata a compra do painel: já vem com
 * data (a da confirmação do trânsito), valor (qtd × custo dos itens) e previsão
 * de chegada (a menor data de recebimento), pronta para lançar.
 */
export interface CompraGastoCandidata {
  compraTransitoId: string;
  titulo: string;
  /** YYYY-MM-DD, fuso de Brasília: o dia em que a compra foi confirmada em trânsito. */
  dataCompra: string;
  itens: CompraGastoItem[];
  total: number;
  itemCount: number;
  /** Soma das quantidades dos itens — quantas peças a compra tem. */
  totalQuantidade: number;
  /** Linhas sem custo cadastrado — o valor está subestimado por elas. */
  semCusto: number;
  /**
   * Status da compra em trânsito. Rascunho NÃO é compra confirmada e nunca
   * entra no painel — quem consome recusa o lançamento.
   */
  status: CompraTransitoStatus;
  /**
   * Previsão de chegada (YYYY-MM-DD): a menor data de recebimento dos itens.
   * Nulo só em rascunho (item sem data), que não entra aqui de qualquer forma.
   */
  previsaoChegada?: string | null;
}

/** Payload de criação/edição de lote (o que a tela manda para a API). */
export interface CompraGastoLoteInput {
  codigo: string;
  titulo: string;
  colecao?: string | null;
  fornecedor?: string | null;
  tipo: CompraGastoTipo;
  origem: CompraGastoOrigem;
  compraTransitoId?: string | null;
  compraSalvaId?: string | null;
  dataCompra: string;
  chegadaIni?: string | null;
  chegadaReal?: string | null;
  estimado?: boolean;
  valorUnico?: number | null;
  observacao?: string | null;
  itens?: CompraGastoItem[];
  parcelas?: CompraGastoParcela[];
}

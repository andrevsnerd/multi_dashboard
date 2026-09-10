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
 *  - `gentile`: compra da Gentile Etiquetas (papel seda e etiqueta adesiva).
 *    Igual à Premier no valor (qtd × preço), mas o preço não é único: cada item
 *    é cotado por FAIXA de quantidade, e escolher a faixa já traz quantidade e
 *    preço prontos.
 *  - `valor`: LEGADO. Só descrição e valor total. Saiu da tela de lançamento —
 *    o valor continua aqui para os lotes já gravados serem lidos.
 *  - `salva`: LEGADO. Antes de a fonte passar a ser a Compra em trânsito, o
 *    vínculo era com a Compra Salva. Nenhuma compra nova nasce assim; o valor
 *    só existe para os lotes já gravados continuarem legíveis no painel.
 */
export type CompraGastoOrigem =
  | "transito"
  | "itens"
  | "premier"
  | "gentile"
  | "valor"
  | "salva";

/**
 * Catálogo Premier — embalagem e material de loja.
 *
 * A lista aparece INTEIRA no lançamento e o usuário preenche quantidade só do
 * que está comprando (linha sem quantidade é ignorada).
 *
 * `custoPadrao` é o preço unitário da última tabela da Premier e já vem
 * preenchido na tela — é o que agiliza o lançamento, porque na prática só a
 * quantidade muda de uma compra para a outra. O valor continua EDITÁVEL: quando
 * a Premier reajustar, quem lança corrige na linha e a compra grava o preço
 * digitado, não o padrão.
 *
 * ⚠️ São centavos, com QUATRO casas: `0.1007` é dez centavos e meio, não R$ 1
 * mil. Faixinha e Tag custam décimos de centavo e a compra vem em milhares de
 * unidades — arredondar para dois dígitos erra o total da compra em reais
 * (5.800 faixinhas: 0,1007 = R$ 584,06; 0,10 = R$ 580,00). Por isso o preço
 * unitário desta tela é lido e gravado com 4 casas.
 *
 * `custoPadrao: null` = item do catálogo que ainda não tem preço na tabela; a
 * linha nasce em branco e quem lança digita.
 */
export interface CompraGastoPremierItem {
  descricao: string;
  custoPadrao: number | null;
}

export const COMPRA_GASTO_PREMIER_CATALOGO: CompraGastoPremierItem[] = [
  { descricao: "Sacola SP63", custoPadrao: 3.12 },
  { descricao: "Caixa Lenço", custoPadrao: 3.65 },
  { descricao: "Lamina", custoPadrao: 0.371 },
  { descricao: "Faixinha", custoPadrao: 0.1007 },
  { descricao: "Tag", custoPadrao: 0.129 },
  { descricao: "Sacola SP28", custoPadrao: null },
  { descricao: "Caixa CTC-90", custoPadrao: null },
  { descricao: "Caixa Rígida", custoPadrao: null },
  { descricao: "Caixa Pashimina", custoPadrao: 5.479 },
  { descricao: "Sacola SP11", custoPadrao: 5.84 },
];

/** Só as descrições, na ordem do catálogo. */
export const COMPRA_GASTO_PREMIER_ITENS: string[] = COMPRA_GASTO_PREMIER_CATALOGO.map(
  (i) => i.descricao
);

/** Preço padrão de um item do catálogo (null quando não há preço de tabela). */
export function custoPadraoPremier(descricao: string): number | null {
  const alvo = (descricao ?? "").trim().toLowerCase();
  return (
    COMPRA_GASTO_PREMIER_CATALOGO.find((i) => i.descricao.toLowerCase() === alvo)?.custoPadrao ??
    null
  );
}

/**
 * Catálogo Gentile Etiquetas — papel seda e etiqueta adesiva da Scarf Me.
 *
 * A diferença para a Premier: aqui **não existe preço unitário único**. A
 * Gentile cota por FAIXA de quantidade e o preço cai conforme o volume — 10 Kg
 * de papel sai a R$ 84,99/Kg e 20 Kg a R$ 60,10/Kg; o milheiro de etiqueta sai
 * de R$ 326,00 (1.000) a R$ 90,00 (15.000). Por isso a tela escolhe a faixa em
 * vez de digitar o preço: a faixa é que traz quantidade e preço juntos.
 *
 * ⚠️ `qtd` está na UNIDADE DE COMPRA do item, que é a unidade em que a Gentile
 * cota — Kg no papel, **milheiro** na etiqueta. Guardar a etiqueta em unidades
 * avulsas quebraria o valor: 3.000 unidades saem a R$ 163,49 o milheiro, o que
 * dá R$ 0,16349 a unidade — cinco casas, que o item grava com quatro (0,1635) e
 * fecha em R$ 490,50 em vez dos R$ 490,47 cotados. Em milheiro a conta é exata
 * (3 × 163,49), e é a mesma linguagem do orçamento.
 *
 * O total da faixa não é campo: é sempre `qtd × custoUnitario`, para não haver
 * duas fontes do mesmo número. `rotulo` é como a Gentile escreve a faixa, e é o
 * que aparece na tela.
 */
export interface CompraGastoGentileFaixa {
  /** Como a Gentile cota a faixa: "10 Kg", "3.000 unid". */
  rotulo: string;
  /** Quantidade na unidade de compra do item (Kg, milheiro). */
  qtd: number;
  /** Preço da unidade de compra (R$/Kg, R$/milheiro). */
  custoUnitario: number;
}

export interface CompraGastoGentileItem {
  /** Descrição que vai para a linha do lote. */
  descricao: string;
  /** Unidade de compra — a mesma de `faixa.qtd`. */
  unidade: string;
  /** Especificação técnica do orçamento (tamanho, cores, acabamento). */
  especificacao: string;
  /** Prazo de entrega prometido pela Gentile, para leitura humana. */
  prazoEntrega?: string | null;
  faixas: CompraGastoGentileFaixa[];
}

export const COMPRA_GASTO_GENTILE_CATALOGO: CompraGastoGentileItem[] = [
  {
    descricao: "Papel seda fundo branco — estampa rosa Scarf Me",
    unidade: "Kg",
    especificacao: "50x70 cm",
    prazoEntrega: "1 semana a 10 dias",
    faixas: [
      // 10 Kg = R$ 849,90 e 20 Kg = R$ 1.202,00 (os totais do orçamento).
      { rotulo: "10 Kg", qtd: 10, custoUnitario: 84.99 },
      { rotulo: "20 Kg", qtd: 20, custoUnitario: 60.1 },
    ],
  },
  {
    descricao: "Etiqueta adesiva fundo branco — Scarf Me, 2 cores",
    unidade: "milheiro",
    especificacao: "45x25 mm, corte reto nas laterais, 2 cores de impressão em tinta",
    faixas: [
      // A Gentile cota o milheiro; o total da faixa é milheiros × preço.
      { rotulo: "1.000 unid", qtd: 1, custoUnitario: 326 },
      { rotulo: "3.000 unid", qtd: 3, custoUnitario: 163.49 },
      { rotulo: "5.000 unid", qtd: 5, custoUnitario: 137 },
      { rotulo: "10.000 unid", qtd: 10, custoUnitario: 103 },
      { rotulo: "15.000 unid", qtd: 15, custoUnitario: 90 },
    ],
  },
];

/** Total cotado de uma faixa — sempre derivado, nunca um campo à parte. */
export function totalFaixaGentile(faixa: CompraGastoGentileFaixa): number {
  return Math.round(faixa.qtd * faixa.custoUnitario * 100) / 100;
}

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
 *  - `salete`: 2x, 90 e 120 dias.
 *  - `telma`: 1x, 30 dias.
 *  - `roseli` (Pashmina): 3x, 90/120/150 dias.
 *  - `fatima` (Fashion): 2x, 30/60 dias.
 *  - `premier` (embalagem e material): 3x, 30/60/90 dias.
 *  - `gentile` (Gentile Etiquetas): 2x, 30/60 dias, no boleto.
 *  - `india_kunal`: 13x iguais — entrada à vista + 12 parcelas de 30 em 30 dias.
 *  - `china` (Nick), `china_hannah`, `nepal`: transferência 40% + Alibaba 60%,
 *    cada canal com 30% no ato do pedido, 50% no despacho (+30 dias) e 20% 60
 *    dias depois do despacho (+90).
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
  | "fatima"
  | "premier"
  | "gentile"
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
  gentile: "Gentile Etiquetas",
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

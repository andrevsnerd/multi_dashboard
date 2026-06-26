import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";
import { getLimiteDiasReposicao } from "@/lib/utils/suggestion-rules";
import {
  hasCicloCompra,
  resolveCicloCompra,
  resolveCompraDiaSemana,
  resolveGapAntigoDias,
  resolveRecenteHorizonteDias,
} from "@/lib/config/compra-ciclo";

/**
 * Compra Ideal — lógica global e simples de reposição por cobertura.
 *
 * Regra: o ritmo de venda é medido sobre o MAIOR período contínuo com estoque positivo
 * nos últimos 12 meses (limitado a 60 dias), e não sobre dias corridos — assim um produto
 * que ficou meses zerado não tem o ritmo diluído, e a base é o trecho mais estável de venda.
 * A partir desse ritmo, o alvo de estoque mira SOBREVIVER O LEAD TIME (tempo até a compra
 * nova chegar) + MANTER A COBERTURA saudável após a chegada. Como lead time = própria
 * cobertura (60/90/30 por linha/subgrupo), o alvo total = 2× cobertura. Desconta o que já
 * existe (estoque + compras em trânsito). O resultado pode ser negativo (excesso). Quando o
 * período de ritmo é curto (<60d) sinaliza a confiabilidade e há quanto tempo terminou.
 */

export type CompraIdealStatus = "REPOR" | "OK" | "EXCESSO";
export type CompraIdealConfiabilidade = "alta" | "baixa" | "muito_baixa";

export interface CompraIdealInput {
  estoqueAtual?: number | null;
  /**
   * Janela de ritmo: dias do maior período contínuo com estoque (até 60), as vendas
   * líquidas nesse período e a data de término dele (ISO). Quando ausentes, cai no
   * fallback de 60 dias corridos via `qtde60d`.
   */
  ritmoDiasComEstoque?: number | null;
  ritmoVendasPeriodo?: number | null;
  ritmoInicioIso?: string | null;
  ritmoFimIso?: string | null;
  ritmoDiasComVenda?: number | null;
  ritmoPrimeiraVendaIso?: string | null;
  ritmoUltimaVendaIso?: string | null;
  /**
   * JANELA ANTIGA — trecho RECENTE (último período contínuo com estoque) e o GAP em dias até
   * o maior trecho. Quando `ritmoGapDias` > `gapAntigoDias` (tolerância da empresa), o maior
   * trecho é tratado como "velho" e o cálculo usa o recente como base do ritmo. Sem
   * `gapAntigoDias` (empresa não configurada) → nunca troca; usa sempre o maior trecho.
   */
  ritmoRecenteDias?: number | null;
  ritmoRecenteVendas?: number | null;
  ritmoRecenteInicioIso?: string | null;
  ritmoRecenteFimIso?: string | null;
  /** Última venda DENTRO do trecho recente (ISO) — sinal de "vendeu recentemente?". */
  ritmoRecenteUltimaVendaIso?: string | null;
  ritmoGapDias?: number | null;
  /** Tolerância de gap (dias) da empresa; acima dela usa o trecho recente. Ver acima. */
  gapAntigoDias?: number | null;
  /**
   * RESGATE DE JANELA ZERADA — horizonte (dias) que define "vendeu recentemente". Quando o
   * MAIOR trecho teve 0 venda mas o trecho recente vendeu dentro deste horizonte, o ritmo usa
   * o recente em vez de zerar o consumo. `null` (empresa não configurada) → resgate desligado.
   */
  recenteHorizonteDias?: number | null;
  /** @deprecated Não é mais usado no cálculo de ritmo (a regra usa só a janela `ritmoDiasComEstoque`). */
  qtde60d?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
  /**
   * Modo CICLO (opcional). Quando `coberturaDias` E `producaoDias` vêm preenchidos, o
   * cálculo separa o lead time (produção) da cobertura e usa a lógica de ciclo de compra:
   * quantidade = 1 ciclo de cobertura e DATA de compra fixa = (acaba c/ trânsito) − produção.
   * Quando ausentes, cai na lógica LEGADA (lead time = cobertura, alvo = 2× cobertura).
   */
  coberturaDias?: number | null;
  /** Lead time real (dias de produção + transporte até chegar no PDV). Ver `coberturaDias`. */
  producaoDias?: number | null;
  /** Rótulo do grupo do ciclo (Seda, Cashmere, Lenços BR…), só para exibição no tooltip. */
  grupoCiclo?: string | null;
  /** Entradas de compra em trânsito já confirmadas para o item. */
  transitEntries?: CompraTransitoIndexEntry[];
  /** Data de referência ("hoje"); injetável para testes. */
  hoje?: Date;
  /** Fator de excesso: posição > alvo × fator ⇒ Excesso (padrão 2). */
  fatorExcesso?: number;
}

export interface CompraIdealResult {
  /** Ritmo de venda mensal estimado (consumo/dia × 30). */
  ritmoMensal: number;
  consumoDiario: number;
  coberturaAlvoDias: number;
  /** Dias com estoque usados na base do ritmo (0 quando caiu no fallback de dias corridos). */
  ritmoDiasBase: number;
  /** Vendas usadas na base do ritmo. */
  ritmoVendasBase: number;
  /**
   * true quando a janela tinha menos de 30 dias com estoque e o consumo/dia foi calculado
   * com a base mínima de 30 dias (piso de histórico de lançamento) em vez dos dias reais.
   */
  ritmoBaseAmortecida: boolean;
  /**
   * true quando o ritmo usou o TRECHO RECENTE no lugar do maior trecho. Dois motivos possíveis,
   * em `motivoTrechoRecente`: "gap" (o maior trecho vendia mas ficou velho) ou "zerado" (o maior
   * trecho teve 0 venda e o recente vendeu dentro do horizonte — resgate do vendedor lento).
   */
  usouTrechoRecente: boolean;
  /** Por que trocou pro trecho recente: "gap" (janela antiga) | "zerado" (resgate) | null. */
  motivoTrechoRecente: "gap" | "zerado" | null;
  /** Gap (dias) entre o fim do maior trecho e o início do recente (0 = mesmo trecho). */
  ritmoGapDias: number;
  /** Tolerância de gap (dias) aplicada, ou null quando a empresa não tem janela antiga configurada. */
  gapAntigoDias: number | null;
  /** Confiabilidade da estimativa de ritmo: alta (≥60d), baixa (≥14d), muito_baixa (<14d). */
  confiabilidade: CompraIdealConfiabilidade;
  /** Data de início do período usado no ritmo (ISO), ou null. */
  ritmoInicioIso: string | null;
  /** Data de término do período usado no ritmo (ISO), ou null. */
  ritmoFimIso: string | null;
  /** Há quantos dias terminou esse período (0 = ainda em estoque hoje), ou null. */
  ritmoDiasAtras: number | null;
  /** Dias COM venda dentro da janela (concentração das vendas). */
  ritmoDiasComVenda: number;
  /** 1ª venda na janela (ISO), ou null. */
  ritmoPrimeiraVendaIso: string | null;
  /** Última venda na janela (ISO), ou null. */
  ritmoUltimaVendaIso: string | null;
  /** Intervalo em dias da 1ª à última venda na janela (inclusive), ou null. */
  ritmoSpanVendaDias: number | null;
  estoqueAtual: number;
  emTransito: number;
  /** Próxima chegada de trânsito (ISO yyyy-mm-dd), ou null. */
  chegaEm: string | null;
  /** Dias até a próxima chegada de trânsito (a partir de hoje), ou null. */
  diasAteChegada: number | null;
  /** Data em que o estoque atual zera no ritmo de consumo (ISO), ou null se sem consumo. */
  acabaEm: string | null;
  diasAteAcabar: number | null;
  /** Cobertura atual em dias = estoque ÷ consumo/dia (= diasAteAcabar). */
  coberturaAtualDias: number | null;
  /** Lead time assumido (dias até a compra nova chegar) — igual à cobertura. */
  leadTimeDias: number;
  /** Lead time/produção em dias (dias até a compra nova chegar no PDV). No legado = cobertura. */
  producaoDias: number;
  /** true quando usou a lógica de CICLO (lead time separado da cobertura). */
  modoCiclo: boolean;
  /** Rótulo do grupo do ciclo (Seda, Cashmere, Lenços BR…), ou null. */
  grupoCiclo: string | null;
  /** Saldo de estoque projetado para a chegada da compra nova (o "− saldo" da quantidade). */
  saldoNaChegadaCompra: number | null;
  /** Data (ISO) em que estoque + trânsito acaba, considerando a chegada do trânsito. */
  acabaComTransitoIso: string | null;
  /** Dias até acabar considerando o trânsito (a partir de hoje). */
  diasAteAcabarComTransito: number | null;
  /**
   * Data SUGERIDA de compra (ISO) = (acaba c/ trânsito) − produção. É a data em que a
   * compra precisa ser feita para a remessa chegar antes do estoque romper. Só no modo ciclo.
   */
  dataCompra: string | null;
  /** Dias até a data de compra (negativo = atrasado, deveria já ter comprado). */
  diasAteComprar: number | null;
  /** true quando a data de compra já passou/é hoje (precisa comprar agora). */
  comprarAgora: boolean;
  /** Alvo total em dias = lead time + cobertura pós-chegada. */
  alvoTotalDias: number;
  /** Estoque atual restante na data da próxima chegada (sem somar o que chega), ou null. */
  saldoChegada: number | null;
  /** Folga até a chegada do trânsito existente: cobertura atual − dias até a chegada (negativo = rompe antes). */
  folgaAteChegadaDias: number | null;
  /**
   * Há trânsito a caminho, mas o estoque atual zera ANTES de ele chegar — haverá ruptura
   * no intervalo. Não dá pra "comprar ponte" em ciclo (a produção chegaria ainda mais tarde),
   * então isto é um SINAL: o item não está "estável" como a posição (estoque+trânsito) sugere.
   */
  rupturaAntesDaChegada: boolean;
  /** Dias estimados sem estoque entre a ruptura e a chegada do trânsito (null se não rompe antes). */
  diasRupturaAntesChegada: number | null;
  /** Estoque-alvo: consumo/dia × (lead time + cobertura). */
  alvoEstoque: number;
  /** Compra ideal = alvo − (estoque + trânsito). Pode ser negativa (excesso). */
  compraIdeal: number;
  status: CompraIdealStatus;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Alvo já embute lead time + cobertura; só é excesso bem acima disso.
const FATOR_EXCESSO_PADRAO = 1.5;
/**
 * Piso de histórico para a janela de ritmo. Produto com menos de 30 dias com estoque
 * (ex.: lançamento) não pode extrapolar a rajada: o consumo/dia é calculado como se a
 * base mínima fosse 30 dias. Ex.: 172 vendas em 12 dias → 172/30 (≈5,7/dia), não 172/12
 * (≈14/dia). A partir de 30 dias com estoque, usa a janela real normalmente.
 */
const RITMO_DIAS_BASE_MINIMO = 30;

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parseIsoDate(value?: string | null): Date | null {
  const v = (value ?? "").trim().slice(0, 10);
  if (!v) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatIso(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number): Date {
  const d = startOfLocalDay(date);
  d.setDate(d.getDate() + days);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfLocalDay(to).getTime() - startOfLocalDay(from).getTime()) / MS_PER_DAY);
}

interface ChegadaProjecao {
  /** Quantidade que chega. */
  qty: number;
  /** Dia (índice a partir de hoje, ≥0) em que chega. Sem data conhecida ⇒ 0 (já disponível). */
  dia: number;
}

/**
 * Projeta o ESTOQUE no fim de um dia futuro (índice a partir de hoje), consumindo a
 * `consumoDiario` e somando as chegadas de trânsito nas suas datas. Nunca vai abaixo de 0
 * (rupturas não geram estoque negativo). Usado para saber o saldo na chegada da compra nova.
 */
function projetarEstoqueNoDia(
  estoqueInicial: number,
  consumoDiario: number,
  chegadas: ChegadaProjecao[],
  diaAlvo: number
): number {
  let estoque = Math.max(0, estoqueInicial);
  let dia = 0;
  for (const c of chegadas) {
    if (c.dia > diaAlvo) break;
    estoque = Math.max(0, estoque - consumoDiario * (c.dia - dia)) + c.qty;
    dia = c.dia;
  }
  return Math.max(0, estoque - consumoDiario * (diaAlvo - dia));
}

/**
 * Projeta em que DIA (índice a partir de hoje, float) o estoque + trânsito acaba — ou seja,
 * quando a última unidade da posição atual é consumida, considerando que o trânsito só passa
 * a contar na sua data de chegada (respeita o gap se o estoque rompe antes da chegada).
 * Retorna null quando não há consumo.
 */
function projetarDiaAcaba(
  estoqueInicial: number,
  consumoDiario: number,
  chegadas: ChegadaProjecao[]
): number | null {
  if (consumoDiario <= 0) return null;
  let estoque = Math.max(0, estoqueInicial);
  let dia = 0;
  for (const c of chegadas) {
    estoque = Math.max(0, estoque - consumoDiario * (c.dia - dia)) + c.qty;
    dia = c.dia;
  }
  return dia + estoque / consumoDiario;
}

export function calcCompraIdeal(input: CompraIdealInput): CompraIdealResult {
  const hoje = input.hoje ?? new Date();
  const estoqueAtual = Math.round(Number(input.estoqueAtual ?? 0));
  // Modo CICLO: lead time (produção) vem separado da cobertura. Sem ele, lógica legada
  // (cobertura por linha/subgrupo e lead time = cobertura).
  const modoCiclo =
    input.coberturaDias != null &&
    Number(input.coberturaDias) > 0 &&
    input.producaoDias != null &&
    Number(input.producaoDias) >= 0;
  const coberturaAlvoDias = modoCiclo
    ? Math.round(Number(input.coberturaDias))
    : getLimiteDiasReposicao({ linha: input.linha, subgrupo: input.subgrupo });
  const fatorExcesso = Number(input.fatorExcesso ?? FATOR_EXCESSO_PADRAO);

  // Ritmo — REGRA ÚNICA, sem fallback. Base = maior trecho contínuo com estoque
  // (`ritmoDiasComEstoque`, já capado em 60 na origem) e as vendas dentro dele:
  //   divisor = MAX(trecho, 30)   → sem trecho/<30 = 30 · 30-59 = dias reais · ≥60 = 60
  //   consumo/dia = vendas_do_trecho ÷ divisor
  //
  // JANELA ANTIGA: se o maior trecho terminou há mais que a tolerância da empresa
  // (gap > gapAntigoDias), ele está "velho" — o produto ficou sem estoque tempo demais e o
  // ritmo daquele período não reflete o de hoje. Aí a base passa a ser o TRECHO RECENTE. Sem
  // tolerância configurada, ou gap dentro dela (ruptura normal), mantém o maior trecho.
  const melhorDias = Math.max(0, Math.round(Number(input.ritmoDiasComEstoque ?? 0)));
  const melhorVendas = Math.max(0, Number(input.ritmoVendasPeriodo ?? 0));
  const recenteDias = Math.max(0, Math.round(Number(input.ritmoRecenteDias ?? 0)));
  const recenteVendas = Math.max(0, Number(input.ritmoRecenteVendas ?? 0));
  const ritmoGapDias = Math.max(0, Math.round(Number(input.ritmoGapDias ?? 0)));
  const gapAntigoDias =
    input.gapAntigoDias != null ? Math.max(0, Math.round(Number(input.gapAntigoDias))) : null;
  // (1) JANELA ANTIGA: o maior trecho VENDIA mas ficou velho (gap > tolerância) → usa o recente.
  const trocaPorGap =
    gapAntigoDias != null && gapAntigoDias > 0 && ritmoGapDias > gapAntigoDias && recenteDias > 0;
  // (2) RESGATE DE JANELA ZERADA: o maior trecho teve 0 venda (vendedor lento cujo trecho longo
  // calhou num período parado), mas o trecho recente VENDEU dentro do horizonte da empresa → usa
  // o recente em vez de zerar o consumo e cair em "Suficiente" com estoque 0. Só dispara quando
  // o maior trecho realmente não vendeu (melhorVendas <= 0) — não mexe no giro saudável.
  const recenteHorizonteDias =
    input.recenteHorizonteDias != null ? Math.max(0, Math.round(Number(input.recenteHorizonteDias))) : null;
  const recenteUltimaVendaDate = parseIsoDate(input.ritmoRecenteUltimaVendaIso);
  const recenteVendaDiasAtras = recenteUltimaVendaDate
    ? Math.max(0, daysBetween(recenteUltimaVendaDate, hoje))
    : null;
  const vendeuRecentemente =
    recenteHorizonteDias != null &&
    recenteHorizonteDias > 0 &&
    recenteVendaDiasAtras != null &&
    recenteVendaDiasAtras <= recenteHorizonteDias;
  const resgateZerado =
    !trocaPorGap && melhorVendas <= 0 && recenteVendas > 0 && recenteDias > 0 && vendeuRecentemente;
  const usouTrechoRecente = trocaPorGap || resgateZerado;
  const motivoTrechoRecente: "gap" | "zerado" | null = trocaPorGap
    ? "gap"
    : resgateZerado
      ? "zerado"
      : null;
  const ritmoDiasBase = usouTrechoRecente ? recenteDias : melhorDias;
  const ritmoVendasBase = usouTrechoRecente ? recenteVendas : melhorVendas;
  const divisorRitmo = Math.max(ritmoDiasBase, RITMO_DIAS_BASE_MINIMO);
  const consumoDiario = ritmoVendasBase / divisorRitmo;
  // Trecho < 30 (inclui "sem trecho" = novo): o consumo foi amortecido pelo piso de 30.
  const ritmoBaseAmortecida = ritmoDiasBase < RITMO_DIAS_BASE_MINIMO;
  const confiabilidade: CompraIdealConfiabilidade =
    ritmoDiasBase >= 60 ? "alta" : ritmoDiasBase >= 14 ? "baixa" : "muito_baixa";
  const ritmoMensal = Math.round(consumoDiario * 30);
  // Datas do período usado: quando troca pro recente, exibe as datas do trecho recente.
  const ritmoInicioIso = usouTrechoRecente
    ? (input.ritmoRecenteInicioIso ?? null)
    : (input.ritmoInicioIso ?? null);
  const ritmoFimIso = usouTrechoRecente
    ? (input.ritmoRecenteFimIso ?? null)
    : (input.ritmoFimIso ?? null);
  const ritmoFimDate = parseIsoDate(ritmoFimIso);
  const ritmoDiasAtras = ritmoFimDate ? Math.max(0, daysBetween(ritmoFimDate, hoje)) : null;
  const ritmoDiasComVenda = Math.max(0, Math.round(Number(input.ritmoDiasComVenda ?? 0)));
  const ritmoPrimeiraVendaIso = input.ritmoPrimeiraVendaIso ?? null;
  const ritmoUltimaVendaIso = input.ritmoUltimaVendaIso ?? null;
  const ritmoPrimeiraVendaDate = parseIsoDate(ritmoPrimeiraVendaIso);
  const ritmoUltimaVendaDate = parseIsoDate(ritmoUltimaVendaIso);
  const ritmoSpanVendaDias =
    ritmoPrimeiraVendaDate && ritmoUltimaVendaDate
      ? Math.max(1, daysBetween(ritmoPrimeiraVendaDate, ritmoUltimaVendaDate) + 1)
      : null;

  // Entradas em trânsito ativas, ordenadas por data de recebimento (mais cedo primeiro).
  const entries = [...(input.transitEntries ?? [])]
    .map((e) => ({
      qty: Math.max(0, Math.round(Number(e.quantidade ?? 0))),
      data: parseIsoDate(e.dataRecebimento),
    }))
    .filter((e) => e.qty > 0)
    .sort((a, b) => {
      const ta = a.data ? a.data.getTime() : Number.POSITIVE_INFINITY;
      const tb = b.data ? b.data.getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  const emTransito = entries.reduce((s, e) => s + e.qty, 0);
  const proximaChegada = entries.find((e) => e.data != null)?.data ?? null;
  const chegaEm = proximaChegada ? formatIso(proximaChegada) : null;

  // Acaba em: data em que o estoque atual zera no ritmo de consumo.
  let diasAteAcabar: number | null = null;
  let acabaEm: string | null = null;
  if (consumoDiario > 0) {
    diasAteAcabar = Math.max(0, Math.floor(estoqueAtual / consumoDiario));
    acabaEm = formatIso(addDays(hoje, diasAteAcabar));
  }

  // Dias até a próxima chegada de trânsito (a partir de hoje).
  const diasAteChegada = proximaChegada ? Math.max(0, daysBetween(hoje, proximaChegada)) : null;

  // Saldo na chegada: estoque atual restante quando o trânsito chega (sem somar o que chega).
  let saldoChegada: number | null = null;
  if (proximaChegada && diasAteChegada != null) {
    saldoChegada = Math.max(0, Math.round(estoqueAtual - consumoDiario * diasAteChegada));
  }

  // Lead time = produção (modo ciclo) ou a própria cobertura (legado).
  const producaoDias = modoCiclo ? Math.round(Number(input.producaoDias)) : coberturaAlvoDias;
  // Alvo de POSIÇÃO em dias = lead time + cobertura pós-chegada. Usado para excesso/OK.
  const alvoTotalDias = producaoDias + coberturaAlvoDias;
  const leadTimeDias = producaoDias;
  const alvoEstoque = Math.round(consumoDiario * alvoTotalDias);
  const posicao = estoqueAtual + emTransito;

  const coberturaAtualDias = consumoDiario > 0 ? Math.round(estoqueAtual / consumoDiario) : null;
  // Folga até a chegada do trânsito existente: rompe antes se negativo.
  let folgaAteChegadaDias: number | null = null;
  if (proximaChegada && consumoDiario > 0 && diasAteChegada != null) {
    folgaAteChegadaDias = (coberturaAtualDias ?? 0) - diasAteChegada;
  }

  // Ruptura antes da chegada: o estoque atual zera (diasAteAcabar) ANTES de o trânsito
  // pousar (diasAteChegada). O gap é a janela sem estoque. Usa as MESMAS datas exibidas
  // (acabaEm × chegaEm) para o número bater com a tela.
  let rupturaAntesDaChegada = false;
  let diasRupturaAntesChegada: number | null = null;
  if (proximaChegada && consumoDiario > 0 && diasAteChegada != null && diasAteAcabar != null) {
    const gap = diasAteChegada - diasAteAcabar;
    if (gap > 0) {
      rupturaAntesDaChegada = true;
      diasRupturaAntesChegada = gap;
    }
  }

  // --- Campos do modo ciclo (data de compra fixa + quantidade de 1 ciclo) ---
  let acabaComTransitoIso: string | null = null;
  let diasAteAcabarComTransito: number | null = null;
  let dataCompra: string | null = null;
  let diasAteComprar: number | null = null;
  let comprarAgora = false;
  let saldoNaChegadaCompra: number | null = null;

  let compraIdeal: number;
  let status: CompraIdealStatus;

  if (modoCiclo && consumoDiario > 0) {
    // Chegadas de trânsito como índices de dia a partir de hoje (sem data ⇒ disponível já).
    const chegadas: ChegadaProjecao[] = entries.map((e) => ({
      qty: e.qty,
      dia: e.data ? Math.max(0, daysBetween(hoje, e.data)) : 0,
    }));

    // Dia em que estoque + trânsito acaba (respeitando quando cada remessa chega).
    const diaAcaba = projetarDiaAcaba(estoqueAtual, consumoDiario, chegadas);
    if (diaAcaba != null) {
      const diaAcabaInt = Math.max(0, Math.round(diaAcaba));
      diasAteAcabarComTransito = diaAcabaInt;
      acabaComTransitoIso = formatIso(addDays(hoje, diaAcabaInt));

      // Data de compra = (dia que acaba) − produção. A remessa nova precisa ser pedida
      // com `producaoDias` de antecedência para chegar antes do estoque romper.
      const diaCompraRaw = diaAcaba - producaoDias;
      diasAteComprar = Math.round(diaCompraRaw);
      comprarAgora = diaCompraRaw <= 0;
      dataCompra = formatIso(addDays(hoje, Math.max(0, Math.round(diaCompraRaw))));

      // Quantidade = 1 ciclo de cobertura, descontando o que ainda restará quando a
      // remessa nova chegar (dia da compra + produção). Em regime estável o saldo na
      // chegada ≈ 0 (a remessa chega quando o estoque anterior acaba) ⇒ qtd = consumo×cobertura.
      const diaChegadaNova = Math.max(0, Math.round(diaCompraRaw)) + producaoDias;
      const saldoNaChegada = projetarEstoqueNoDia(estoqueAtual, consumoDiario, chegadas, diaChegadaNova);
      saldoNaChegadaCompra = Math.round(saldoNaChegada);
      compraIdeal = Math.max(0, Math.ceil(consumoDiario * coberturaAlvoDias - saldoNaChegada));
    } else {
      compraIdeal = 0;
    }

    if (compraIdeal > 0) {
      status = "REPOR";
    } else if (posicao > 0 && posicao > alvoEstoque * fatorExcesso) {
      status = "EXCESSO";
    } else {
      status = "OK";
    }
  } else {
    // Lógica LEGADA: alvo = 2× cobertura, compra = alvo − posição (pode ser negativa).
    compraIdeal = Math.ceil(alvoEstoque - posicao);
    if (compraIdeal > 0) {
      status = "REPOR";
    } else if (posicao > 0 && posicao > alvoEstoque * fatorExcesso) {
      status = "EXCESSO";
    } else {
      status = "OK";
    }
  }

  return {
    ritmoMensal,
    consumoDiario,
    coberturaAlvoDias,
    ritmoDiasBase,
    ritmoVendasBase,
    ritmoBaseAmortecida,
    usouTrechoRecente,
    motivoTrechoRecente,
    ritmoGapDias,
    gapAntigoDias,
    confiabilidade,
    ritmoInicioIso,
    ritmoFimIso,
    ritmoDiasAtras,
    ritmoDiasComVenda,
    ritmoPrimeiraVendaIso,
    ritmoUltimaVendaIso,
    ritmoSpanVendaDias,
    estoqueAtual,
    emTransito,
    chegaEm,
    diasAteChegada,
    acabaEm,
    diasAteAcabar,
    coberturaAtualDias,
    leadTimeDias,
    producaoDias,
    modoCiclo,
    grupoCiclo: input.grupoCiclo ?? null,
    saldoNaChegadaCompra,
    acabaComTransitoIso,
    diasAteAcabarComTransito,
    dataCompra,
    diasAteComprar,
    comprarAgora,
    alvoTotalDias,
    saldoChegada,
    folgaAteChegadaDias,
    rupturaAntesDaChegada,
    diasRupturaAntesChegada,
    alvoEstoque,
    compraIdeal,
    status,
  };
}

/**
 * Campos do `resumo` de métricas de item que alimentam a Compra Ideal.
 * Estruturalmente compatível com `ControleEstoqueItemMetricasResumo`.
 */
export interface CompraIdealResumoLike {
  estoqueTotal?: number | null;
  qtde60d?: number | null;
  ritmoDiasComEstoque?: number | null;
  ritmoVendasPeriodo?: number | null;
  ritmoInicioIso?: string | null;
  ritmoFimIso?: string | null;
  ritmoDiasComVenda?: number | null;
  ritmoPrimeiraVendaIso?: string | null;
  ritmoUltimaVendaIso?: string | null;
  ritmoRecenteDias?: number | null;
  ritmoRecenteVendas?: number | null;
  ritmoRecenteInicioIso?: string | null;
  ritmoRecenteFimIso?: string | null;
  ritmoRecenteUltimaVendaIso?: string | null;
  ritmoGapDias?: number | null;
}

/**
 * Adaptador único: monta a Compra Ideal a partir do `resumo` de métricas do item +
 * compras em trânsito + linha/subgrupo. Fonte de verdade compartilhada por TODAS as
 * telas (lista loja, curva ABC, lista de compra, compras salvas etc.) — mesma regra.
 */
export function calcCompraIdealFromResumo(
  resumo: CompraIdealResumoLike | null | undefined,
  transitEntries: CompraTransitoIndexEntry[],
  meta: { linha?: string | null; subgrupo?: string | null; company?: string | null },
  hoje?: Date
): CompraIdealResult {
  // Quando a empresa tem ciclos configurados (ex.: scarfme), resolve cobertura + produção
  // por categoria → ativa o modo ciclo (lead time separado, quantidade de 1 ciclo, data fixa).
  // Sem isso (ou empresa sem ciclos, ex.: nerd hoje) → lógica legada.
  let coberturaDias: number | null = null;
  let producaoDias: number | null = null;
  let grupoCiclo: string | null = null;
  if (meta.company && hasCicloCompra(meta.company)) {
    const ciclo = resolveCicloCompra(meta.company, { linha: meta.linha, subgrupo: meta.subgrupo });
    coberturaDias = ciclo.coberturaDias;
    producaoDias = ciclo.producaoDias;
    grupoCiclo = ciclo.grupo;
  }

  return calcCompraIdeal({
    estoqueAtual: resumo?.estoqueTotal ?? 0,
    qtde60d: resumo?.qtde60d ?? null,
    ritmoDiasComEstoque: resumo?.ritmoDiasComEstoque ?? null,
    ritmoVendasPeriodo: resumo?.ritmoVendasPeriodo ?? null,
    ritmoInicioIso: resumo?.ritmoInicioIso ?? null,
    ritmoFimIso: resumo?.ritmoFimIso ?? null,
    ritmoDiasComVenda: resumo?.ritmoDiasComVenda ?? null,
    ritmoPrimeiraVendaIso: resumo?.ritmoPrimeiraVendaIso ?? null,
    ritmoUltimaVendaIso: resumo?.ritmoUltimaVendaIso ?? null,
    ritmoRecenteDias: resumo?.ritmoRecenteDias ?? null,
    ritmoRecenteVendas: resumo?.ritmoRecenteVendas ?? null,
    ritmoRecenteInicioIso: resumo?.ritmoRecenteInicioIso ?? null,
    ritmoRecenteFimIso: resumo?.ritmoRecenteFimIso ?? null,
    ritmoRecenteUltimaVendaIso: resumo?.ritmoRecenteUltimaVendaIso ?? null,
    ritmoGapDias: resumo?.ritmoGapDias ?? null,
    gapAntigoDias: resolveGapAntigoDias(meta.company),
    recenteHorizonteDias: resolveRecenteHorizonteDias(meta.company),
    linha: meta.linha,
    subgrupo: meta.subgrupo,
    coberturaDias,
    producaoDias,
    grupoCiclo,
    transitEntries,
    hoje,
  });
}

/**
 * Aplica uma DATA DE COMPRA da catraca (persistida) sobre um resultado já calculado,
 * recomputando `diasAteComprar` e `comprarAgora` em relação a hoje. A quantidade e o resto
 * seguem vivos (recalculados a cada carga). A decisão de QUAL data usar (catraca vs
 * recalculada) é de quem chama — aqui só reaplicamos a data escolhida. Sem efeito fora do
 * modo ciclo.
 */
export function applyDataCompraFixa(
  ideal: CompraIdealResult,
  dataCompraIso: string,
  hoje?: Date
): CompraIdealResult {
  if (!ideal.modoCiclo) return ideal;
  const ref = hoje ?? new Date();
  const data = parseIsoDate(dataCompraIso);
  if (!data) return ideal;
  const dias = daysBetween(ref, data);
  return {
    ...ideal,
    dataCompra: formatIso(data),
    diasAteComprar: dias,
    comprarAgora: dias <= 0,
  };
}

/**
 * Dias até a próxima ocorrência de um dia da semana (0=Dom … 6=Sáb), a partir de `hoje`.
 * Sempre 1..7: se hoje já é o dia, retorna 7 (a PRÓXIMA ocorrência, não hoje).
 */
function diasAteProximoDiaSemana(hoje: Date, diaSemana: number): number {
  const diff = (diaSemana - hoje.getDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}

/**
 * "COMPRAR ESSA SEMANA" — para empresas que compram num dia fixo da semana (ex.: NERD às
 * segundas): um item cuja DATA de compra sugerida cai dentro dos dias até a próxima ocorrência
 * desse dia (1..7) deve ser comprado JÁ nessa janela. Lê os campos já calculados (não recalcula
 * nada), então segue correto mesmo após a catraca (applyDataCompraFixa atualiza diasAteComprar).
 * Não inclui o "comprar agora" (data já chegou) — esse tem rótulo próprio. Empresa sem
 * `compraDiaSemana` (ex.: scarfme) → sempre false.
 */
export function precisaComprarEssaSemana(
  ideal: CompraIdealResult,
  company: string | null | undefined,
  hoje: Date = new Date()
): boolean {
  const diaSemana = resolveCompraDiaSemana(company);
  if (diaSemana == null) return false;
  if (!ideal.modoCiclo || ideal.status !== "REPOR" || ideal.comprarAgora) return false;
  if (ideal.diasAteComprar == null) return false;
  return ideal.diasAteComprar <= diasAteProximoDiaSemana(hoje, diaSemana);
}

export const COMPRA_IDEAL_STATUS_LABEL: Record<CompraIdealStatus, string> = {
  REPOR: "Repor",
  OK: "OK",
  EXCESSO: "Excesso",
};

export const COMPRA_IDEAL_CONFIABILIDADE_LABEL: Record<CompraIdealConfiabilidade, string> = {
  alta: "Confiável",
  baixa: "Confiabilidade baixa",
  muito_baixa: "Confiabilidade muito baixa",
};

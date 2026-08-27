/**
 * Projeção de vendas — motor PURO (sem banco, sem React), usado pela análise
 * "Projeção de vendas" do Gerador de Relatórios.
 *
 * Diferença de propósito em relação ao motor de Compra Ideal ([lib/utils/compra-ideal.ts]):
 * a Compra Ideal mede o ritmo pelo MAIOR TRECHO CONTÍNUO COM ESTOQUE (reconstrução
 * retroativa de saldo) para responder "quanto comprar". Aqui a pergunta é outra —
 * "quanto ESTE item deve vender nos próximos meses até o estoque acabar" — e a decisão
 * do dono (ago/2026) foi NÃO depender de estoque retroativo: a base é a SÉRIE MENSAL de
 * vendas (regra validada de venda líquida, com trocas), que é um fato observado.
 *
 * ── Regra do ritmo: JANELA ANCORADA NA ÚLTIMA VENDA ──────────────────────────────
 * Uma regra só cobre item ativo, item novo e item que ficou meses parado:
 *
 *  1. Só MESES FECHADOS entram na base (o mês corrente é parcial; incluí-lo puxaria o
 *     ritmo para baixo). Mesmo espírito do piso de 30 dias da Compra Ideal — não
 *     extrapolar rajada curta.
 *  2. Âncora = o mês fechado MAIS RECENTE com venda > 0.
 *  3. Base = os `janelaMeses` (default 3) meses que TERMINAM na âncora, cortados no
 *     primeiro mês com venda do item (zeros de "antes de existir" nunca entram).
 *  4. Zeros NO MEIO da janela contam no divisor (mês fraco de verdade, não infla).
 *     Zeros DEPOIS da âncora ficam fora da base e viram `baseIdadeMeses` (idade do ritmo);
 *     o tempo sem vender nenhuma unidade é `mesesParado`, contado da última venda.
 *  5. Item que só vendeu no mês corrente: ritmo = a quantidade do mês corrente, SEM
 *     extrapolar os dias que faltam (piso de um mês) — confiança "baixa".
 *
 * O ritmo histórico é entregue CHEIO (sem deságio por tempo parado, decisão do dono):
 * quem julga é quem lê, com `mesesParado` + `confianca` + a janela usada ao lado.
 *
 * Mês com quantidade LÍQUIDA negativa (devolução/troca maior que a venda do mês) entra na
 * soma com o próprio sinal — não é descartado. É a mesma disciplina da regra global de
 * venda: filtrar linha negativa antes de somar infla o número. Consequência esperada: uma
 * janela pode fechar em zero mesmo tendo tido venda num dos meses, e o item cai como "sem
 * giro" — a venda líquida dele naquele período foi zero de fato.
 */

/** Um mês da série: `mes` no formato "yyyy-mm", `qtde` em unidades líquidas vendidas. */
export interface ProjecaoMesSerie {
  mes: string;
  qtde: number;
}

export type ProjecaoConfianca = "alta" | "media" | "baixa";
/** De onde saiu o ritmo: venda recente, histórico antigo (item parado) ou nada. */
export type ProjecaoMotivoRitmo = "recente" | "historico" | "mes_corrente" | "sem_historico";

export interface ProjecaoRitmo {
  /** Unidades por mês estimadas (média da janela). */
  ritmoMes: number;
  /** Quantos meses entraram no divisor da média. */
  baseMeses: number;
  /** Primeiro mês da janela usada ("yyyy-mm"), ou null. */
  baseInicio: string | null;
  /** Último mês da janela usada — a âncora ("yyyy-mm"), ou null. */
  baseFim: string | null;
  /** Unidades somadas na janela. */
  baseQtde: number;
  /** Mês da última venda observada, inclusive o corrente ("yyyy-mm"), ou null. */
  ultimaVendaMes: string | null;
  /**
   * Meses fechados sem NENHUMA venda desde a última venda (0 = vendeu no mês corrente ou
   * no último mês fechado). Medido pela ÚLTIMA VENDA, não pela âncora: um item que vendeu
   * esparso e voltou a vender agora não pode aparecer como "parado há 5 meses" ao lado de
   * "última venda: este mês".
   */
  mesesParado: number;
  /**
   * Quantos meses fechados se passaram depois da âncora — a IDADE da base do ritmo.
   * 0 = a base termina no último mês fechado (ritmo atual). Alto = o ritmo veio de um
   * período antigo (venda esparsa ou item que parou), mesmo que tenha vendido agora.
   */
  baseIdadeMeses: number;
  confianca: ProjecaoConfianca;
  motivo: ProjecaoMotivoRitmo;
}

const JANELA_MESES_DEFAULT = 3;

/** "yyyy-mm" → índice absoluto de mês (ano×12 + mês), para aritmética simples. */
export function mesToIndex(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return y * 12 + (m - 1);
}

/** Índice absoluto de mês → "yyyy-mm". */
export function indexToMes(index: number): string {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Soma/subtrai meses de um "yyyy-mm". */
export function addMeses(mes: string, delta: number): string {
  return indexToMes(mesToIndex(mes) + delta);
}

/** Quantos dias tem o mês "yyyy-mm". */
export function diasNoMes(mes: string): number {
  const [y, m] = mes.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Rótulo curto pt-BR de um "yyyy-mm" → "ago/26". */
export function mesLabel(mes: string): string {
  const [y, m] = mes.split("-").map(Number);
  return `${MESES_CURTOS[m - 1] ?? "?"}/${String(y).slice(-2)}`;
}

/**
 * Ritmo mensal de um item a partir da sua série mensal. Ver o cabeçalho do arquivo para
 * a regra completa. `serie` NÃO precisa estar completa nem ordenada: os meses ausentes
 * são tratados como zero dentro do intervalo observado.
 */
export function calcRitmoMensal(params: {
  serie: ProjecaoMesSerie[];
  /** Mês corrente ("yyyy-mm") — fronteira entre "fechado" e "parcial". */
  mesAtual: string;
  janelaMeses?: number;
}): ProjecaoRitmo {
  const janela = Math.max(1, params.janelaMeses ?? JANELA_MESES_DEFAULT);
  const atualIdx = mesToIndex(params.mesAtual);

  const porIdx = new Map<number, number>();
  for (const p of params.serie) {
    const q = Number(p.qtde ?? 0);
    if (!Number.isFinite(q)) continue;
    const idx = mesToIndex(p.mes);
    porIdx.set(idx, (porIdx.get(idx) ?? 0) + q);
  }
  const qtdeDe = (idx: number) => porIdx.get(idx) ?? 0;

  // Meses com venda (inclui o corrente, só para saber "quando vendeu por último").
  const comVenda = [...porIdx.entries()]
    .filter(([, q]) => q > 0)
    .map(([idx]) => idx)
    .sort((a, b) => a - b);
  const ultimaVendaIdx = comVenda.length > 0 ? comVenda[comVenda.length - 1]! : null;
  const primeiraVendaIdx = comVenda.length > 0 ? comVenda[0]! : null;

  if (ultimaVendaIdx == null || primeiraVendaIdx == null) {
    return {
      ritmoMes: 0,
      baseMeses: 0,
      baseInicio: null,
      baseFim: null,
      baseQtde: 0,
      ultimaVendaMes: null,
      mesesParado: 0,
      baseIdadeMeses: 0,
      confianca: "baixa",
      motivo: "sem_historico",
    };
  }

  // Âncora = último mês FECHADO com venda (o corrente é parcial e não entra na base).
  const ancoraIdx = comVenda.filter((idx) => idx < atualIdx).pop() ?? null;

  if (ancoraIdx == null) {
    // Só vendeu no mês corrente (item novo). Piso de um mês: usa a quantidade do mês
    // como se fosse o mês inteiro, SEM extrapolar os dias que faltam.
    const q = qtdeDe(atualIdx);
    return {
      ritmoMes: q,
      baseMeses: 1,
      baseInicio: params.mesAtual,
      baseFim: params.mesAtual,
      baseQtde: q,
      ultimaVendaMes: indexToMes(ultimaVendaIdx),
      mesesParado: 0,
      baseIdadeMeses: 0,
      confianca: "baixa",
      motivo: "mes_corrente",
    };
  }

  // Janela de `janela` meses terminando na âncora, cortada na 1ª venda do item.
  const inicioIdx = Math.max(ancoraIdx - janela + 1, primeiraVendaIdx);
  let soma = 0;
  let meses = 0;
  for (let idx = inicioIdx; idx <= ancoraIdx; idx += 1) {
    soma += qtdeDe(idx);
    meses += 1;
  }
  const baseMeses = Math.max(1, meses);
  // Idade da base = meses fechados depois da âncora (o corrente, parcial, não conta).
  const baseIdadeMeses = Math.max(0, atualIdx - 1 - ancoraIdx);
  // "Parado há" conta da ÚLTIMA VENDA (que pode ser o mês corrente), não da âncora.
  const mesesParado = Math.max(0, atualIdx - ultimaVendaIdx - 1);

  const confianca: ProjecaoConfianca =
    mesesParado === 0 && baseIdadeMeses === 0 && baseMeses >= 3
      ? "alta"
      : mesesParado <= 2 && baseMeses >= 2
        ? "media"
        : "baixa";

  return {
    ritmoMes: soma / baseMeses,
    baseMeses,
    baseInicio: indexToMes(inicioIdx),
    baseFim: indexToMes(ancoraIdx),
    baseQtde: soma,
    ultimaVendaMes: indexToMes(ultimaVendaIdx),
    mesesParado,
    baseIdadeMeses,
    confianca,
    // "recente" = a base TERMINA no último mês fechado. Se a âncora é mais antiga, o ritmo
    // veio de um período passado — vale mesmo que o item tenha voltado a vender agora.
    motivo: baseIdadeMeses === 0 ? "recente" : "historico",
  };
}

/**
 * Índice sazonal por mês do calendário (1..12), calculado da PRÓPRIA seleção de itens:
 * média das unidades daquele mês ÷ média geral. Só devolve algo com pelo menos 12 meses
 * fechados de histórico — abaixo disso o "padrão" seria ruído. Clampado em [0.5, 2] para
 * um mês atípico (uma liquidação, um item que estourou) não distorcer a projeção inteira.
 */
export function buildIndiceSazonal(params: {
  /** Série AGREGADA da seleção (soma de todos os itens) por mês. */
  serieAgregada: ProjecaoMesSerie[];
  /** Mês corrente — meses >= ele são parciais e ficam fora. */
  mesAtual: string;
  minMesesFechados?: number;
}): Map<number, number> | null {
  const atualIdx = mesToIndex(params.mesAtual);
  const minMeses = params.minMesesFechados ?? 12;

  const fechados = params.serieAgregada
    .filter((p) => mesToIndex(p.mes) < atualIdx)
    .map((p) => ({ mes: p.mes, qtde: Number(p.qtde ?? 0) }))
    .filter((p) => Number.isFinite(p.qtde));
  if (fechados.length < minMeses) return null;

  const totalGeral = fechados.reduce((s, p) => s + p.qtde, 0);
  const mediaGeral = totalGeral / fechados.length;
  if (mediaGeral <= 0) return null;

  const porMesCalendario = new Map<number, { soma: number; n: number }>();
  for (const p of fechados) {
    const mesCal = Number(p.mes.split("-")[1]);
    const acc = porMesCalendario.get(mesCal) ?? { soma: 0, n: 0 };
    acc.soma += p.qtde;
    acc.n += 1;
    porMesCalendario.set(mesCal, acc);
  }

  const indice = new Map<number, number>();
  for (let mesCal = 1; mesCal <= 12; mesCal += 1) {
    const acc = porMesCalendario.get(mesCal);
    // Mês do calendário sem observação fica neutro (1), não zerado.
    if (!acc || acc.n === 0) {
      indice.set(mesCal, 1);
      continue;
    }
    const bruto = acc.soma / acc.n / mediaGeral;
    indice.set(mesCal, Math.min(2, Math.max(0.5, bruto)));
  }
  return indice;
}

export interface ProjecaoMesProjetado {
  mes: string;
  /** Unidades projetadas para vender NESTE mês (já limitadas pelo estoque restante). */
  qtde: number;
  /** Capacidade de venda do mês antes do limite de estoque (ritmo × sazonal × fração). */
  capacidade: number;
}

export interface ProjecaoEstoqueResultado {
  meses: ProjecaoMesProjetado[];
  /** Dias até o estoque zerar (fracionário), ou null quando não zera / sem giro. */
  diasParaAcabar: number | null;
  /** Mês em que o estoque zera ("yyyy-mm"), ou null. */
  mesAcaba: string | null;
  /** true quando há giro mas o estoque não acaba dentro do horizonte pedido. */
  excedeHorizonte: boolean;
  /** Unidades de estoque que sobram no fim do horizonte (0 se acabar antes). */
  sobra: number;
  /**
   * DEMANDA do horizonte inteiro: soma da capacidade de venda de todos os meses, SEM
   * limite de estoque. Igual nos dois modos — é o "quanto isso vende" puro, e a base do
   * "falta comprar" (`demandaHorizonte − estoque`).
   */
  demandaHorizonte: number;
  /** Cobertura simples em meses (estoque ÷ ritmo), ignorando sazonalidade. */
  coberturaMeses: number | null;
}

/**
 * Projeta a venda mês a mês pelo ritmo estimado, começando no mês corrente (proporcional
 * aos dias que ainda faltam nele). Nenhuma reposição é considerada.
 *
 * DOIS MODOS (`limitarAoEstoque`, decisão do dono ago/2026):
 *
 *  - **true (Considerar estoque)** — a coluna de cada mês é limitada pelo estoque que
 *    ainda resta, e zera quando o estoque acaba. Responde "com o que tenho hoje, até
 *    quando vai" e a soma das colunas fecha com o estoque consumido.
 *  - **false (Só a demanda)** — a coluna de cada mês é a venda que o histórico sustenta,
 *    SEM teto de estoque. É o modo para analisar ANTES de comprar: item que já zerou (ou
 *    zera semana que vem) continua mostrando o que venderia, em vez de virar uma fila de
 *    zeros. `DIAS_PARA_ACABAR`/`mesAcaba` continuam valendo — eles descrevem o estoque
 *    real, independentemente de a projeção estar ou não limitada por ele.
 *
 * `demandaHorizonte` (sem teto) é calculada nos DOIS modos: é o que permite dizer quanto
 * falta comprar para atender o horizonte.
 */
export function projetarConsumoEstoque(params: {
  estoque: number;
  ritmoMes: number;
  /** Mês corrente ("yyyy-mm"). */
  mesAtual: string;
  /** Dia do mês corrente (1..31) — o dia de hoje conta como disponível. */
  diaAtual: number;
  maxMeses: number;
  indiceSazonal?: Map<number, number> | null;
  /** Ver os dois modos acima. Default true (limita ao estoque). */
  limitarAoEstoque?: boolean;
}): ProjecaoEstoqueResultado {
  const estoque = Math.max(0, Number(params.estoque ?? 0));
  const ritmo = Math.max(0, Number(params.ritmoMes ?? 0));
  const maxMeses = Math.max(1, Math.floor(params.maxMeses));
  const meses: ProjecaoMesProjetado[] = [];

  const totalDiasMesAtual = diasNoMes(params.mesAtual);
  const diasRestantesMesAtual = Math.min(
    totalDiasMesAtual,
    Math.max(1, totalDiasMesAtual - params.diaAtual + 1)
  );

  const limitar = params.limitarAoEstoque !== false;

  if (ritmo <= 0) {
    for (let i = 0; i < maxMeses; i += 1) {
      meses.push({ mes: addMeses(params.mesAtual, i), qtde: 0, capacidade: 0 });
    }
    return {
      meses,
      diasParaAcabar: null,
      mesAcaba: null,
      excedeHorizonte: estoque > 0,
      sobra: estoque,
      demandaHorizonte: 0,
      coberturaMeses: null,
    };
  }

  // `restanteEstoque` acompanha o estoque REAL sendo consumido — é ele que dá os dias até
  // acabar. No modo "só a demanda" a coluna do mês pode passar do estoque, então a coluna
  // exibida e o consumo do estoque são grandezas separadas.
  let restanteEstoque = estoque;
  let demandaHorizonte = 0;
  let dias = 0;
  let diasParaAcabar: number | null = null;
  let mesAcaba: string | null = null;

  for (let i = 0; i < maxMeses; i += 1) {
    const mes = addMeses(params.mesAtual, i);
    const mesCal = Number(mes.split("-")[1]);
    const fator = params.indiceSazonal?.get(mesCal) ?? 1;
    // Mês corrente entra proporcional aos dias que faltam; os seguintes, inteiros.
    const fracao = i === 0 ? diasRestantesMesAtual / totalDiasMesAtual : 1;
    const capacidade = ritmo * fator * fracao;
    demandaHorizonte += capacidade;
    const venda = limitar ? Math.min(capacidade, Math.max(0, restanteEstoque)) : capacidade;
    meses.push({ mes, qtde: venda, capacidade });

    const diasDoTrecho = i === 0 ? diasRestantesMesAtual : diasNoMes(mes);
    if (diasParaAcabar == null) {
      if (capacidade > 0 && restanteEstoque <= capacidade) {
        // Zera dentro deste mês: fração proporcional dos dias do trecho.
        dias += (restanteEstoque / capacidade) * diasDoTrecho;
        diasParaAcabar = dias;
        mesAcaba = mes;
      } else {
        dias += diasDoTrecho;
      }
    }
    restanteEstoque = Math.max(0, restanteEstoque - capacidade);
  }

  return {
    meses,
    diasParaAcabar,
    mesAcaba,
    excedeHorizonte: diasParaAcabar == null,
    sobra: restanteEstoque,
    demandaHorizonte,
    coberturaMeses: estoque / ritmo,
  };
}

/**
 * Arredonda uma lista de valores fracionários para inteiros PRESERVANDO a soma
 * (método do maior resto). Evita o clássico round-then-sum divergindo do total:
 * a soma das colunas de mês tem que fechar com o estoque consumido.
 */
export function arredondarPreservandoSoma(valores: number[]): number[] {
  const totalExato = valores.reduce((s, v) => s + v, 0);
  const alvo = Math.round(totalExato);
  const pisos = valores.map((v) => Math.floor(v));
  let faltam = alvo - pisos.reduce((s, v) => s + v, 0);
  const ordem = valores
    .map((v, i) => ({ i, resto: v - Math.floor(v) }))
    .sort((a, b) => b.resto - a.resto);
  const out = [...pisos];
  for (const { i } of ordem) {
    if (faltam <= 0) break;
    out[i] += 1;
    faltam -= 1;
  }
  return out;
}

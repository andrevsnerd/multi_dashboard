/**
 * Agregação do painel de Gastos de Compra — funções puras, sem I/O.
 *
 * Regra única de alocação: **cada parcela conta uma vez, no mês do seu
 * vencimento**. Compra de 4x de 25% aparece em quatro meses, com 25% em cada;
 * adiantamento é a primeira parcela do próprio lote, nunca um lançamento
 * separado (senão o comprometido contaria duas vezes o mesmo dinheiro).
 *
 * Usada pela tela (recalcula na hora quando o usuário edita o orçamento) e
 * disponível para a API/relatórios sem duplicar a conta.
 */

import {
  COMPRA_GASTO_CANAIS,
  COMPRA_GASTO_CANAL_CURTO,
  COMPRA_GASTO_CANAL_LABEL,
  type CompraGastoCanal,
  type CompraGastoFornecedor,
  type CompraGastoItem,
  type CompraGastoLote,
  type CompraGastoMes,
  type CompraGastoModeloParcelamento,
  type CompraGastoOrcamentoEntry,
  type CompraGastoParcela,
  type CompraGastoStatus,
  type CompraGastoTotais,
} from "@/lib/types/compra-gasto";

/** Arredonda para centavos, evitando o lixo de ponto flutuante das somas. */
export function cents(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

export function ymOf(iso: string): string {
  return (iso || "").slice(0, 7);
}

export function loteTotal(lote: CompraGastoLote): number {
  return cents(lote.parcelas.reduce((s, p) => s + (Number(p.valor) || 0), 0));
}

export function loteTotalPago(lote: CompraGastoLote): number {
  return cents(lote.parcelas.reduce((s, p) => s + (p.pago ? Number(p.valor) || 0 : 0), 0));
}

export function itemTotal(item: CompraGastoItem): number {
  return cents((Number(item.qtd) || 0) * (Number(item.custoUnitario) || 0));
}

export function itensTotal(itens: CompraGastoItem[] | undefined): number {
  return cents((itens ?? []).reduce((s, i) => s + itemTotal(i), 0));
}

/** Linhas sem custo unitário — nunca somam zero em silêncio, a tela avisa. */
export function itensSemCusto(itens: CompraGastoItem[] | undefined): number {
  return (itens ?? []).filter((i) => !(Number(i.custoUnitario) > 0)).length;
}

/**
 * Status do lote, derivado das datas (nunca um campo digitado que envelhece).
 * `hoje` no formato YYYY-MM-DD.
 */
export function loteStatus(lote: CompraGastoLote, hoje: string): CompraGastoStatus {
  if (lote.estimado) return { key: "estimativa", label: "Estimativa", tom: "mute" };
  if (lote.chegadaReal) return { key: "recebido", label: "Recebido", tom: "good" };
  if (!lote.chegadaIni) return { key: "lancado", label: "Lançado", tom: "mute" };
  if (lote.chegadaIni < hoje) return { key: "atrasado", label: "Atrasado", tom: "crit" };
  return { key: "transito", label: "Em trânsito", tom: "warn" };
}

/** Dias corridos entre duas datas YYYY-MM-DD (b − a). */
export function diasEntre(a: string, b: string): number {
  if (!a || !b) return 0;
  const ms = Date.parse(`${b}T00:00:00`) - Date.parse(`${a}T00:00:00`);
  return Math.round(ms / 86400000);
}

/** Dias de atraso da chegada, 0 se não está atrasado. */
export function diasAtraso(lote: CompraGastoLote, hoje: string): number {
  if (lote.chegadaReal || lote.estimado) return 0;
  const prevista = lote.chegadaIni || "";
  if (!prevista || prevista >= hoje) return 0;
  return diasEntre(prevista, hoje);
}

function addMonth(ym: string): string {
  const ano = parseInt(ym.slice(0, 4), 10);
  const mes = parseInt(ym.slice(5, 7), 10);
  const proximo = mes === 12 ? `${ano + 1}-01` : `${ano}-${String(mes + 1).padStart(2, "0")}`;
  return proximo;
}

/** Preenche os meses vazios entre o primeiro e o último — o gráfico não pode ter buraco. */
function preencherIntervalo(yms: string[]): string[] {
  if (yms.length === 0) return [];
  const ordenados = [...new Set(yms)].sort();
  const out: string[] = [];
  let atual = ordenados[0];
  const fim = ordenados[ordenados.length - 1];
  let guarda = 0;
  while (atual <= fim && guarda < 600) {
    out.push(atual);
    atual = addMonth(atual);
    guarda += 1;
  }
  return out;
}

export function anosDisponiveis(
  lotes: CompraGastoLote[],
  orcamento: CompraGastoOrcamentoEntry[]
): string[] {
  const anos = new Set<string>();
  lotes.forEach((l) => l.parcelas.forEach((p) => anos.add((p.vencimento || "").slice(0, 4))));
  orcamento.forEach((o) => anos.add((o.ym || "").slice(0, 4)));
  return [...anos].filter(Boolean).sort();
}

/**
 * Monta os meses do painel.
 *
 * A janela não é só o que já tem dado: ela sempre inclui o mês corrente e um
 * horizonte de meses à frente, senão não haveria linha onde digitar o orçamento
 * de um mês futuro que ainda não tem compra nenhuma. Com um ano selecionado, a
 * janela é o ano inteiro (jan a dez) pelo mesmo motivo.
 *
 * @param ano             filtra/abre os meses de um ano ("2026"); vazio = intervalo dos dados.
 * @param hoje            YYYY-MM-DD — âncora do horizonte.
 * @param horizonteMeses  quantos meses à frente abrir (padrão 12).
 */
export function mesesDoPainel(
  lotes: CompraGastoLote[],
  orcamento: CompraGastoOrcamentoEntry[],
  options: { ano?: string; hoje: string; horizonteMeses?: number }
): CompraGastoMes[] {
  const { ano, hoje } = options;
  const horizonte = Math.max(0, Math.min(60, options.horizonteMeses ?? 12));
  const orcMap = new Map<string, number>();
  orcamento.forEach((o) => orcMap.set(o.ym, cents(o.valor)));

  const presentes: string[] = [];
  lotes.forEach((l) => l.parcelas.forEach((p) => presentes.push(ymOf(p.vencimento))));
  orcamento.forEach((o) => presentes.push(o.ym));
  presentes.push(ymOf(hoje));

  // Horizonte à frente: sempre há linha para lançar orçamento futuro.
  let cursor = ymOf(hoje);
  for (let i = 0; i < horizonte; i += 1) {
    cursor = addMonth(cursor);
    presentes.push(cursor);
  }

  // Ano selecionado abre os 12 meses dele, mesmo os sem movimento.
  if (ano) {
    for (let m = 1; m <= 12; m += 1) presentes.push(`${ano}-${String(m).padStart(2, "0")}`);
  }

  const janela = preencherIntervalo(presentes.filter(Boolean)).filter((ym) =>
    ano ? ym.slice(0, 4) === ano : true
  );

  const base = new Map<string, CompraGastoMes>();
  janela.forEach((ym) => {
    const temOrcamento = orcMap.has(ym);
    base.set(ym, {
      ym,
      orcamento: temOrcamento ? (orcMap.get(ym) as number) : 0,
      temOrcamento,
      comprometido: 0,
      pago: 0,
      aPagar: 0,
      firme: 0,
      estimado: 0,
      saldo: 0,
      lotes: [],
    });
  });

  lotes.forEach((lote) => {
    // Uma passada por lote agrupando as parcelas por mês de vencimento.
    const porMes = new Map<string, { valor: number; pago: number; qtd: number }>();
    lote.parcelas.forEach((p) => {
      const ym = ymOf(p.vencimento);
      if (!ym) return;
      const acc = porMes.get(ym) ?? { valor: 0, pago: 0, qtd: 0 };
      acc.valor += Number(p.valor) || 0;
      if (p.pago) acc.pago += Number(p.valor) || 0;
      acc.qtd += 1;
      porMes.set(ym, acc);
    });

    porMes.forEach((acc, ym) => {
      const mes = base.get(ym);
      if (!mes) return; // fora da janela/ano filtrado
      const valor = cents(acc.valor);
      const pago = cents(acc.pago);
      const aPagar = cents(valor - pago);
      mes.comprometido = cents(mes.comprometido + valor);
      mes.pago = cents(mes.pago + pago);
      mes.aPagar = cents(mes.aPagar + aPagar);
      if (lote.estimado) mes.estimado = cents(mes.estimado + aPagar);
      else mes.firme = cents(mes.firme + aPagar);
      mes.lotes.push({
        loteId: lote.id,
        valor,
        pago,
        parcelasNoMes: acc.qtd,
        totalParcelas: lote.parcelas.length,
      });
    });
  });

  return [...base.values()]
    .sort((a, b) => a.ym.localeCompare(b.ym))
    .map((mes) => {
      mes.saldo = cents(mes.orcamento - mes.comprometido);
      mes.lotes.sort((a, b) => b.valor - a.valor);
      return mes;
    });
}

export function totaisDoPainel(meses: CompraGastoMes[]): CompraGastoTotais {
  const t = meses.reduce<CompraGastoTotais>(
    (acc, m) => {
      acc.orcamento = cents(acc.orcamento + m.orcamento);
      acc.comprometido = cents(acc.comprometido + m.comprometido);
      acc.pago = cents(acc.pago + m.pago);
      acc.aPagar = cents(acc.aPagar + m.aPagar);
      acc.firme = cents(acc.firme + m.firme);
      acc.estimado = cents(acc.estimado + m.estimado);
      if (m.temOrcamento && m.comprometido > m.orcamento) acc.mesesEstourados += 1;
      return acc;
    },
    {
      orcamento: 0,
      comprometido: 0,
      pago: 0,
      aPagar: 0,
      firme: 0,
      estimado: 0,
      saldo: 0,
      mesesEstourados: 0,
    }
  );
  t.saldo = cents(t.orcamento - t.comprometido);
  return t;
}

/**
 * Divide um total em N parcelas mensais a partir de um vencimento.
 * A última parcela absorve a diferença de centavos — a soma bate com o total.
 */
export function gerarParcelas(
  total: number,
  quantidade: number,
  primeiroVencimento: string,
  intervalo: "mensal" | "quinzenal" = "mensal"
): CompraGastoParcela[] {
  const n = Math.max(1, Math.min(48, Math.round(quantidade || 1)));
  const alvo = cents(total);
  if (!primeiroVencimento) return [];

  const base = Math.floor((alvo / n) * 100) / 100;
  const out: CompraGastoParcela[] = [];
  let somado = 0;

  for (let i = 0; i < n; i += 1) {
    const valor = i === n - 1 ? cents(alvo - somado) : base;
    somado = cents(somado + valor);
    out.push({
      numero: i + 1,
      vencimento: deslocarVencimento(primeiroVencimento, i, intervalo),
      valor,
      pago: false,
      dataPagamento: null,
    });
  }
  return out;
}

/**
 * Divide um total em parcelas por PERCENTUAL — "40% na data x, 60% na data y".
 *
 * Os percentuais são tratados como PESOS normalizados pela própria soma, então
 * `[40, 60]` e `[2, 3]` dão o mesmo resultado e uma lista que não fecha 100
 * ainda distribui o total inteiro. A última parcela absorve os centavos, de
 * modo que a soma bate com o total ao centavo.
 */
export function gerarParcelasPorPercentual(
  total: number,
  percentuais: number[],
  primeiroVencimento: string,
  intervalo: "mensal" | "quinzenal" = "mensal"
): CompraGastoParcela[] {
  const pesos = (percentuais ?? []).map((p) => Math.max(0, Number(p) || 0));
  const somaPesos = pesos.reduce((s, p) => s + p, 0);
  if (!primeiroVencimento || pesos.length === 0 || somaPesos <= 0) return [];

  const alvo = cents(total);
  const out: CompraGastoParcela[] = [];
  let somado = 0;

  pesos.forEach((peso, i) => {
    const ultima = i === pesos.length - 1;
    const valor = ultima ? cents(alvo - somado) : cents((alvo * peso) / somaPesos);
    somado = cents(somado + valor);
    out.push({
      numero: i + 1,
      vencimento: deslocarVencimento(primeiroVencimento, i, intervalo),
      valor,
      pago: false,
      dataPagamento: null,
    });
  });

  return out;
}

/**
 * Desloca uma data YYYY-MM-DD em N dias corridos.
 *
 * Conta em UTC a partir das partes da string — nunca `new Date(iso)` em fuso
 * local, que no Brasil devolve o dia anterior e faz a parcela cair um dia antes.
 */
export function adiarDias(iso: string, dias: number): string {
  if (!iso) return iso;
  const ano = parseInt(iso.slice(0, 4), 10);
  const mes = parseInt(iso.slice(5, 7), 10);
  const dia = parseInt(iso.slice(8, 10), 10);
  if (!ano || !mes || !dia) return iso;
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  d.setUTCDate(d.getUTCDate() + Math.round(dias || 0));
  return d.toISOString().slice(0, 10);
}

/** Etapa de um modelo: quantos dias depois da compra e que fatia do canal leva. */
interface EtapaModelo {
  dias: number;
  pct: number;
  etapa: string;
}

/** 2x iguais, 90 e 120 dias depois da compra — o calendário da Salete. */
const NOVENTA_CENTO_E_VINTE: EtapaModelo[] = [
  { dias: 90, pct: 50, etapa: "90 dias da compra" },
  { dias: 120, pct: 50, etapa: "120 dias da compra" },
];

/**
 * China: dois pagamentos paralelos sobre o MESMO total — transferência bancária
 * leva 40% e o Alibaba 60%. Cada um segue o mesmo calendário, então as datas
 * convergem e o mês soma os dois.
 */
const CHINA_CANAIS: { canal: CompraGastoCanal; pct: number }[] = [
  { canal: "transferencia", pct: 40 },
  { canal: "alibaba", pct: 60 },
];

const CHINA_ETAPAS: EtapaModelo[] = [
  { dias: 0, pct: 30, etapa: "no ato do pedido" },
  { dias: 30, pct: 50, etapa: "no despacho (30 dias)" },
  { dias: 90, pct: 20, etapa: "60 dias após o despacho" },
];

interface RegraModelo {
  label: string;
  /** Frase que explica o calendário — vai para o title do select e a dica. */
  dica: string;
  etapas: EtapaModelo[];
  /**
   * Canais paralelos. Cada um leva sua fatia do total e roda as etapas por
   * conta própria, com as datas convergindo. Ausente = pagamento único.
   */
  canais?: { canal: CompraGastoCanal; pct: number }[];
}

const DICA_90_120 = "2x iguais: 90 e 120 dias depois da data da compra.";
const DICA_CHINA = `${COMPRA_GASTO_CANAL_LABEL.transferencia} 40% + ${COMPRA_GASTO_CANAL_LABEL.alibaba} 60%, cada um 30% no ato do pedido, 50% no despacho (+30 dias) e 20% 60 dias depois do despacho (+90). As datas convergem: o dia soma os dois pagamentos.`;
/** Fornecedor que ainda não tem calendário próprio — copia o do vizinho. */
const COMO = (quem: string) => ` Por enquanto, mesmas regras de ${quem}.`;

/**
 * Regra de pagamento de cada fornecedor.
 *
 * Fornecedores que hoje pagam igual têm entradas separadas de propósito: o dia
 * em que um deles mudar de calendário, muda só a própria linha desta tabela.
 */
const REGRAS: Record<CompraGastoFornecedor, RegraModelo> = {
  salete: { label: "Salete", dica: DICA_90_120, etapas: NOVENTA_CENTO_E_VINTE },
  telma: { label: "Telma", dica: DICA_90_120 + COMO("Salete"), etapas: NOVENTA_CENTO_E_VINTE },
  roseli: {
    label: "Roseli (Pashmina)",
    dica: DICA_90_120 + COMO("Salete"),
    etapas: NOVENTA_CENTO_E_VINTE,
  },
  china: {
    label: "China (Nick)",
    dica: DICA_CHINA,
    etapas: CHINA_ETAPAS,
    canais: CHINA_CANAIS,
  },
  china_hannah: {
    label: "China (Hannah)",
    dica: DICA_CHINA + COMO("China (Nick)"),
    etapas: CHINA_ETAPAS,
    canais: CHINA_CANAIS,
  },
  india_kunal: {
    label: "Índia (Kunal)",
    dica: DICA_CHINA + COMO("China (Nick)"),
    etapas: CHINA_ETAPAS,
    canais: CHINA_CANAIS,
  },
  nepal: {
    label: "Nepal",
    dica: DICA_CHINA + COMO("China (Nick)"),
    etapas: CHINA_ETAPAS,
    canais: CHINA_CANAIS,
  },
};

/** Opções do select de fornecedor, na ordem em que aparecem na tela. */
export const COMPRA_GASTO_FORNECEDORES: {
  valor: CompraGastoFornecedor;
  label: string;
  dica: string;
}[] = (
  [
    "salete",
    "telma",
    "roseli",
    "china",
    "china_hannah",
    "india_kunal",
    "nepal",
  ] as CompraGastoFornecedor[]
).map((valor) => ({ valor, label: REGRAS[valor].label, dica: REGRAS[valor].dica }));

/** O valor gravado em `fornecedor` é um dos fornecedores com regra? */
export function ehFornecedorConhecido(valor?: string | null): valor is CompraGastoFornecedor {
  return !!valor && valor in REGRAS;
}

/**
 * Nome de exibição do fornecedor gravado no lote. Compra antiga tem texto livre
 * nesse campo (era um input) — nesse caso o próprio texto é o rótulo.
 */
export function rotuloFornecedor(valor?: string | null): string {
  if (!valor) return "";
  return ehFornecedorConhecido(valor) ? REGRAS[valor].label : String(valor);
}

/** A regra de pagamento do fornecedor gravado — "manual" quando não há. */
export function modeloDoFornecedor(valor?: string | null): CompraGastoModeloParcelamento {
  return ehFornecedorConhecido(valor) ? valor : "manual";
}

/**
 * Reparte um valor pelas etapas de um modelo. A última etapa absorve os
 * centavos, então a soma bate ao centavo com o valor recebido — a regra do
 * projeto é somar exato e arredondar só na exibição.
 */
function parcelasDeEtapas(
  valor: number,
  dataBase: string,
  etapas: EtapaModelo[],
  canal: CompraGastoCanal | null
): CompraGastoParcela[] {
  const alvo = cents(valor);
  let somado = 0;
  return etapas.map((et, i) => {
    const ultima = i === etapas.length - 1;
    const parte = ultima ? cents(alvo - somado) : cents((alvo * et.pct) / 100);
    somado = cents(somado + parte);
    return {
      numero: i + 1,
      vencimento: adiarDias(dataBase, et.dias),
      valor: parte,
      pago: false,
      dataPagamento: null,
      canal,
      etapa: et.etapa,
    };
  });
}

/**
 * Gera as parcelas de um fornecedor a partir da data da compra.
 *
 * `manual` não gera nada (quem divide é o usuário). Nos modelos com canais os
 * dois saem numa lista só, ordenada por data — as parcelas do mesmo dia ficam
 * lado a lado, que é como o dinheiro sai: somadas na data, separadas por canal.
 */
export function gerarParcelasModelo(
  total: number,
  dataCompra: string,
  modelo: CompraGastoModeloParcelamento
): CompraGastoParcela[] {
  if (modelo === "manual" || !dataCompra) return [];
  const regra = REGRAS[modelo];
  if (!regra) return [];

  if (!regra.canais) {
    return renumerarParcelas(parcelasDeEtapas(total, dataCompra, regra.etapas, null));
  }

  // Com canais: fatia o total entre eles primeiro (o último canal absorve os
  // centavos), depois cada canal se divide nas suas etapas.
  const alvo = cents(total);
  let alocado = 0;
  const parcelas: CompraGastoParcela[] = [];
  regra.canais.forEach((c, i) => {
    const ultimo = i === regra.canais!.length - 1;
    const valorCanal = ultimo ? cents(alvo - alocado) : cents((alvo * c.pct) / 100);
    alocado = cents(alocado + valorCanal);
    parcelas.push(...parcelasDeEtapas(valorCanal, dataCompra, regra.etapas, c.canal));
  });

  parcelas.sort(
    (a, b) =>
      a.vencimento.localeCompare(b.vencimento) ||
      ordemDoCanal(a.canal) - ordemDoCanal(b.canal)
  );
  return renumerarParcelas(parcelas);
}

function ordemDoCanal(canal?: CompraGastoCanal | null): number {
  const i = canal ? COMPRA_GASTO_CANAIS.indexOf(canal) : -1;
  return i < 0 ? 99 : i;
}

function renumerarParcelas(parcelas: CompraGastoParcela[]): CompraGastoParcela[] {
  return parcelas.map((p, i) => ({ ...p, numero: i + 1 }));
}

/** Canais presentes nas parcelas, na ordem de exibição. */
export function canaisDasParcelas(parcelas: CompraGastoParcela[]): CompraGastoCanal[] {
  const presentes = new Set(parcelas.map((p) => p.canal).filter(Boolean) as CompraGastoCanal[]);
  return COMPRA_GASTO_CANAIS.filter((c) => presentes.has(c));
}

/** Total (e quanto já saiu) de cada canal — a visão "separada" dos pagamentos. */
export interface CompraGastoCanalResumo {
  canal: CompraGastoCanal;
  label: string;
  total: number;
  pago: number;
  parcelas: number;
}

export function resumoPorCanal(parcelas: CompraGastoParcela[]): CompraGastoCanalResumo[] {
  return canaisDasParcelas(parcelas).map((canal) => {
    const doCanal = parcelas.filter((p) => p.canal === canal);
    return {
      canal,
      label: COMPRA_GASTO_CANAL_CURTO[canal],
      total: cents(doCanal.reduce((s, p) => s + (Number(p.valor) || 0), 0)),
      pago: cents(doCanal.reduce((s, p) => s + (p.pago ? Number(p.valor) || 0 : 0), 0)),
      parcelas: doCanal.length,
    };
  });
}

/**
 * Uma linha por data de vencimento com o valor de cada canal e o total do dia —
 * a visão "somada" dos pagamentos que convergem. É o que responde "quanto sai
 * neste dia" sem esconder de onde cada pedaço vem.
 */
export interface CompraGastoConvergenciaLinha {
  vencimento: string;
  porCanal: Partial<Record<CompraGastoCanal, number>>;
  /** Parcelas do dia sem canal definido. */
  semCanal: number;
  total: number;
}

export function convergenciaPorData(
  parcelas: CompraGastoParcela[]
): CompraGastoConvergenciaLinha[] {
  const mapa = new Map<string, CompraGastoConvergenciaLinha>();
  parcelas.forEach((p) => {
    const dia = p.vencimento || "";
    if (!dia) return;
    const linha =
      mapa.get(dia) ?? { vencimento: dia, porCanal: {}, semCanal: 0, total: 0 };
    const valor = Number(p.valor) || 0;
    if (p.canal) linha.porCanal[p.canal] = cents((linha.porCanal[p.canal] ?? 0) + valor);
    else linha.semCanal = cents(linha.semCanal + valor);
    linha.total = cents(linha.total + valor);
    mapa.set(dia, linha);
  });
  return [...mapa.values()].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/**
 * Joga a diferença até o total numa das parcelas em aberto — é o que faz
 * "digitei 40% na primeira" virar 40/60 sem ninguém calcular o resto.
 *
 * Absorve a **última parcela em aberto que não é a editada**: mexer na primeira
 * ajusta a última, mexer na última ajusta a anterior. Assim o valor recém
 * digitado nunca é sobrescrito e a soma fecha do mesmo jeito.
 *
 * @param editada índice recém-alterado (use -1 quando a mudança não veio de uma
 *                linha específica, como no botão de fechar a conta).
 *
 * Parcela paga nunca é escolhida: o que já saiu do caixa não muda de valor.
 * Sem candidata (todas pagas, ou a editada é a única em aberto), devolve a lista
 * como está e a divergência aparece para o usuário resolver.
 */
export function redistribuirNaUltimaEmAberto(
  parcelas: CompraGastoParcela[],
  total: number,
  editada: number
): CompraGastoParcela[] {
  if (!(total > 0)) return parcelas;

  let alvo = -1;
  for (let i = parcelas.length - 1; i >= 0; i -= 1) {
    if (!parcelas[i].pago && i !== editada) {
      alvo = i;
      break;
    }
  }
  if (alvo < 0) return parcelas;

  const outras = parcelas.reduce((s, p, i) => (i === alvo ? s : s + (Number(p.valor) || 0)), 0);
  const resto = Math.max(0, cents(total - outras));
  return parcelas.map((p, i) => (i === alvo ? { ...p, valor: resto } : p));
}

/**
 * Lê percentuais digitados como "40/60", "30 30 40" ou "33,3/33,3/33,4".
 * Separadores: barra, ponto-e-vírgula, mais e espaço. Vírgula é decimal (pt-BR).
 */
export function parsePercentuais(texto: string): number[] {
  return String(texto ?? "")
    .split(/[/;+\s]+/)
    .map((p) => p.trim().replace("%", "").replace(",", "."))
    .filter(Boolean)
    .map((p) => Number(p))
    .filter((n) => Number.isFinite(n) && n > 0);
}

/** Percentual que cada parcela representa do total do lote. */
export function percentualDaParcela(valor: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.round((valor / total) * 1000) / 10;
}

/**
 * Desloca o vencimento mantendo o dia do mês. Dia que não existe no mês de
 * destino (31 em fevereiro) cai no último dia daquele mês.
 */
function deslocarVencimento(
  primeiro: string,
  passos: number,
  intervalo: "mensal" | "quinzenal"
): string {
  if (passos === 0) return primeiro;
  const ano = parseInt(primeiro.slice(0, 4), 10);
  const mes = parseInt(primeiro.slice(5, 7), 10);
  const dia = parseInt(primeiro.slice(8, 10), 10);

  if (intervalo === "quinzenal") {
    const d = new Date(Date.UTC(ano, mes - 1, dia));
    d.setUTCDate(d.getUTCDate() + passos * 15);
    return d.toISOString().slice(0, 10);
  }

  const alvoMes = mes - 1 + passos;
  const alvoAno = ano + Math.floor(alvoMes / 12);
  const mesNormalizado = ((alvoMes % 12) + 12) % 12;
  const ultimoDia = new Date(Date.UTC(alvoAno, mesNormalizado + 1, 0)).getUTCDate();
  const diaFinal = Math.min(dia, ultimoDia);
  return `${alvoAno}-${String(mesNormalizado + 1).padStart(2, "0")}-${String(diaFinal).padStart(2, "0")}`;
}

/** Linha achatada da agenda de pagamentos (uma por parcela). */
export interface CompraGastoAgendaLinha {
  lote: CompraGastoLote;
  parcela: CompraGastoParcela;
  indice: number;
  total: number;
}

export function agendaDePagamentos(
  lotes: CompraGastoLote[],
  options: { ano?: string } = {}
): CompraGastoAgendaLinha[] {
  const linhas: CompraGastoAgendaLinha[] = [];
  lotes.forEach((lote) => {
    lote.parcelas.forEach((parcela, i) => {
      if (options.ano && (parcela.vencimento || "").slice(0, 4) !== options.ano) return;
      linhas.push({ lote, parcela, indice: i + 1, total: lote.parcelas.length });
    });
  });
  return linhas.sort((a, b) => a.parcela.vencimento.localeCompare(b.parcela.vencimento));
}

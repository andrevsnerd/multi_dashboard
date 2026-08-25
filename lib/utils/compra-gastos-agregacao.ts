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

import type {
  CompraGastoItem,
  CompraGastoLote,
  CompraGastoMes,
  CompraGastoOrcamentoEntry,
  CompraGastoParcela,
  CompraGastoStatus,
  CompraGastoTotais,
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
  if (lote.chegadaReal && lote.pdv && lote.pdv <= hoje) {
    return { key: "no-pdv", label: "No PDV", tom: "good" };
  }
  if (lote.chegadaReal) return { key: "recebido", label: "Recebido", tom: "good" };
  if (!lote.chegadaIni && !lote.chegadaFim) {
    return { key: "lancado", label: "Lançado", tom: "mute" };
  }
  const limite = lote.chegadaFim || lote.chegadaIni || "";
  if (limite && limite < hoje) return { key: "atrasado", label: "Atrasado", tom: "crit" };
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
  const limite = lote.chegadaFim || lote.chegadaIni || "";
  if (!limite || limite >= hoje) return 0;
  return diasEntre(limite, hoje);
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

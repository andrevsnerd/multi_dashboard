/**
 * Ponte entre o parcelamento que a tela edita (datas e valores) e o PLANO que a
 * Compra em trânsito guarda (dias e percentual).
 *
 * Por que dois formatos: a forma de pagamento é configurada enquanto a compra
 * ainda é rascunho, mas quem define a data da compra — e o valor final dos
 * itens — é a CONFIRMAÇÃO, que pode acontecer dias depois. Gravar vencimento e
 * valor absolutos congelaria datas velhas e um total que já mudou. Gravando
 * "90 dias depois, 50%", o mesmo plano reancora na data real da confirmação e
 * acompanha o total real.
 *
 * Funções puras, sem I/O: usadas na tela (Compras em Trânsito) e no servidor
 * (ao lançar em Gastos de Compra).
 */

import type { CompraGastoParcela } from "@/lib/types/compra-gasto";
import type {
  CompraTransitoPagamento,
  CompraTransitoParcelaPlano,
} from "@/lib/types/compra-transito";
import { adiarDias, cents, diasEntre } from "@/lib/utils/compra-gastos-agregacao";

/** Configuração inicial: lança em Gastos de Compra, mercadoria, à vista. */
export const PAGAMENTO_PADRAO: CompraTransitoPagamento = {
  lancar: true,
  tipo: "mercadoria",
  fornecedor: null,
  observacao: null,
  plano: null,
};

const TIPOS_VALIDOS = ["mercadoria", "frete", "adiantamento", "material", "outros"] as const;
const CANAIS_VALIDOS = ["transferencia", "alibaba"] as const;

function texto(v: unknown, max: number): string | null {
  const s = String(v ?? "").trim();
  return s ? s.slice(0, max) : null;
}

/**
 * Normaliza o que chega do cliente ou do banco. Devolve `null` quando não há
 * pagamento configurado — compra antiga não passa a lançar nada sozinha.
 */
export function normalizePagamento(raw: unknown): CompraTransitoPagamento | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Partial<CompraTransitoPagamento>;
  const tipo = TIPOS_VALIDOS.includes(obj.tipo as (typeof TIPOS_VALIDOS)[number])
    ? (obj.tipo as CompraTransitoPagamento["tipo"])
    : "mercadoria";

  const plano = Array.isArray(obj.plano)
    ? obj.plano
        .map((p) => normalizeParcelaPlano(p))
        .filter((p): p is CompraTransitoParcelaPlano => p !== null)
    : [];

  return {
    // Só `false` explícito desliga: ausente é a configuração antiga, e a tela
    // sempre manda o valor.
    lancar: obj.lancar !== false,
    tipo,
    fornecedor: texto(obj.fornecedor, 120),
    observacao: texto(obj.observacao, 500),
    plano: plano.length > 0 ? plano : null,
  };
}

function normalizeParcelaPlano(raw: unknown): CompraTransitoParcelaPlano | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<CompraTransitoParcelaPlano>;
  const pct = Number(p.pct);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const dias = Number(p.dias);
  const canal = CANAIS_VALIDOS.includes(p.canal as (typeof CANAIS_VALIDOS)[number])
    ? (p.canal as CompraTransitoParcelaPlano["canal"])
    : null;
  return {
    dias: Number.isFinite(dias) ? Math.max(0, Math.round(dias)) : 0,
    // 6 casas: o suficiente para o valor voltar igual ao centavo, sem encher o
    // JSON de lixo de ponto flutuante.
    pct: Math.round(pct * 1e6) / 1e6,
    canal,
    etapa: texto(p.etapa, 80),
  };
}

/**
 * Parcelas editadas na tela → plano gravável.
 *
 * `dataBase` é a data que ancora o parcelamento na tela (a data prevista da
 * compra). Vencimento anterior a ela vira dia 0 em vez de dias negativos.
 * Quando o total é zero (compra sem custo, ou usuário sem acesso a custo) as
 * parcelas dividem igual — é o único peso honesto que sobra.
 */
export function planoDeParcelas(
  parcelas: CompraGastoParcela[],
  dataBase: string,
  total: number
): CompraTransitoParcelaPlano[] {
  const lista = (parcelas ?? []).filter((p) => p?.vencimento);
  if (lista.length === 0) return [];
  const semTotal = !(total > 0);

  return lista.map((p) => ({
    dias: Math.max(0, diasEntre(dataBase, p.vencimento)),
    pct: semTotal ? 100 / lista.length : Math.round((p.valor / total) * 1e8) / 1e6,
    canal: p.canal ?? null,
    etapa: p.etapa ?? null,
  }));
}

/**
 * Plano gravado → parcelas de verdade, a partir da data real da compra e do
 * total real dos itens.
 *
 * Os percentuais são PESOS normalizados pela própria soma: um plano que não
 * fecha 100 ainda distribui o total inteiro. A última parcela absorve os
 * centavos, então a soma bate ao centavo com o total.
 */
export function parcelasDoPlano(
  total: number,
  dataCompra: string,
  plano: CompraTransitoParcelaPlano[]
): CompraGastoParcela[] {
  const lista = (plano ?? []).filter((p) => Number(p?.pct) > 0);
  const somaPesos = lista.reduce((s, p) => s + p.pct, 0);
  if (!dataCompra || lista.length === 0 || somaPesos <= 0) return [];

  const alvo = cents(total);
  let somado = 0;
  return lista.map((p, i) => {
    const ultima = i === lista.length - 1;
    const valor = ultima ? cents(alvo - somado) : cents((alvo * p.pct) / somaPesos);
    somado = cents(somado + valor);
    return {
      numero: i + 1,
      vencimento: adiarDias(dataCompra, p.dias),
      valor,
      pago: false,
      dataPagamento: null,
      canal: p.canal ?? null,
      etapa: p.etapa ?? null,
    };
  });
}

/**
 * As parcelas com que a compra entra em Gastos de Compra.
 *
 * Sem plano (ou com um plano que não gera nada) a compra nasce INTEIRA na data
 * da compra — a mesma regra do painel: o valor só sai desse mês quando alguém
 * divide de fato.
 */
export function parcelasDoPagamento(
  total: number,
  dataCompra: string,
  pagamento: CompraTransitoPagamento | null | undefined
): CompraGastoParcela[] {
  const plano = pagamento?.plano ?? [];
  const geradas = plano.length > 0 ? parcelasDoPlano(total, dataCompra, plano) : [];
  if (geradas.length > 0) return geradas;
  return [
    {
      numero: 1,
      vencimento: dataCompra,
      valor: cents(total),
      pago: false,
      dataPagamento: null,
      canal: null,
      etapa: null,
    },
  ];
}

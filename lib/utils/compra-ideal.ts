import type { CompraTransitoIndexEntry } from "@/lib/client/compras-transito";
import { getLimiteDiasReposicao } from "@/lib/utils/suggestion-rules";

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
  /** Fallback de ritmo: vendas dos últimos 60 dias corridos (usado se a janela não vier). */
  qtde60d?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
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
  /** Alvo total em dias = lead time + cobertura pós-chegada. */
  alvoTotalDias: number;
  /** Estoque atual restante na data da próxima chegada (sem somar o que chega), ou null. */
  saldoChegada: number | null;
  /** Folga até a chegada do trânsito existente: cobertura atual − dias até a chegada (negativo = rompe antes). */
  folgaAteChegadaDias: number | null;
  /** Estoque-alvo: consumo/dia × (lead time + cobertura). */
  alvoEstoque: number;
  /** Compra ideal = alvo − (estoque + trânsito). Pode ser negativa (excesso). */
  compraIdeal: number;
  status: CompraIdealStatus;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
// Alvo já embute lead time + cobertura; só é excesso bem acima disso.
const FATOR_EXCESSO_PADRAO = 1.5;

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

export function calcCompraIdeal(input: CompraIdealInput): CompraIdealResult {
  const hoje = input.hoje ?? new Date();
  const estoqueAtual = Math.round(Number(input.estoqueAtual ?? 0));
  const coberturaAlvoDias = getLimiteDiasReposicao({ linha: input.linha, subgrupo: input.subgrupo });
  const fatorExcesso = Number(input.fatorExcesso ?? FATOR_EXCESSO_PADRAO);

  // Ritmo: prioriza a janela de "dias com estoque" (até 60 mais recentes). Sem ela,
  // cai no fallback de 60 dias corridos (qtde60d) com confiabilidade rebaixada.
  let ritmoDiasBase = 0;
  let ritmoVendasBase = 0;
  let consumoDiario = 0;
  let confiabilidade: CompraIdealConfiabilidade;
  // Usa a janela de "dias com estoque" só quando ela existe (>0). Quando vem 0/ausente
  // (ex.: resumo de produto agrupado, que não recalcula a janela), cai no fallback de
  // 60 dias corridos via qtde60d — que continua agregado corretamente.
  if (input.ritmoDiasComEstoque != null && Number(input.ritmoDiasComEstoque) > 0) {
    ritmoDiasBase = Math.max(0, Math.round(Number(input.ritmoDiasComEstoque ?? 0)));
    ritmoVendasBase = Math.max(0, Number(input.ritmoVendasPeriodo ?? 0));
    consumoDiario = ritmoDiasBase > 0 ? ritmoVendasBase / ritmoDiasBase : 0;
    confiabilidade = ritmoDiasBase >= 60 ? "alta" : ritmoDiasBase >= 14 ? "baixa" : "muito_baixa";
  } else {
    // Fallback legado: 60 dias corridos.
    const qtde60d = Math.max(0, Number(input.qtde60d ?? 0));
    ritmoDiasBase = 0;
    ritmoVendasBase = qtde60d;
    consumoDiario = qtde60d / 60;
    confiabilidade = "baixa";
  }
  const ritmoMensal = Math.round(consumoDiario * 30);
  const ritmoInicioIso = input.ritmoInicioIso ?? null;
  const ritmoFimIso = input.ritmoFimIso ?? null;
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

  // Alvo = sobreviver o lead time (até a compra nova chegar) + manter cobertura saudável
  // após a chegada. Lead time = própria cobertura → alvo total = 2× cobertura. Já embute a
  // quantidade em trânsito (abatida da posição) e o consumo durante o lead time.
  const leadTimeDias = coberturaAlvoDias;
  const alvoTotalDias = leadTimeDias + coberturaAlvoDias;
  const alvoEstoque = Math.round(consumoDiario * alvoTotalDias);
  const posicao = estoqueAtual + emTransito;
  const compraIdeal = Math.ceil(alvoEstoque - posicao);

  const coberturaAtualDias = consumoDiario > 0 ? Math.round(estoqueAtual / consumoDiario) : null;
  // Folga até a chegada do trânsito existente: rompe antes se negativo.
  let folgaAteChegadaDias: number | null = null;
  if (proximaChegada && consumoDiario > 0 && diasAteChegada != null) {
    folgaAteChegadaDias = (coberturaAtualDias ?? 0) - diasAteChegada;
  }

  let status: CompraIdealStatus;
  if (compraIdeal > 0) {
    status = "REPOR";
  } else if (posicao > 0 && posicao > alvoEstoque * fatorExcesso) {
    status = "EXCESSO";
  } else {
    status = "OK";
  }

  return {
    ritmoMensal,
    consumoDiario,
    coberturaAlvoDias,
    ritmoDiasBase,
    ritmoVendasBase,
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
    alvoTotalDias,
    saldoChegada,
    folgaAteChegadaDias,
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
}

/**
 * Adaptador único: monta a Compra Ideal a partir do `resumo` de métricas do item +
 * compras em trânsito + linha/subgrupo. Fonte de verdade compartilhada por TODAS as
 * telas (lista loja, curva ABC, lista de compra, compras salvas etc.) — mesma regra.
 */
export function calcCompraIdealFromResumo(
  resumo: CompraIdealResumoLike | null | undefined,
  transitEntries: CompraTransitoIndexEntry[],
  meta: { linha?: string | null; subgrupo?: string | null },
  hoje?: Date
): CompraIdealResult {
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
    linha: meta.linha,
    subgrupo: meta.subgrupo,
    transitEntries,
    hoje,
  });
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

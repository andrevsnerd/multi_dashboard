// Distribuição da Matriz → Lojas — regra de rateio (read-only), PURA.
//
// A quantidade "ideal"/"necessidade" de cada loja usa a MESMA fórmula da Compra Ideal
// (`calcCompraIdealFromResumo` em compra-ideal.ts — a fonte única de "quanto uma loja precisa"
// usada por Lista Loja, Curva ABC, Compras Salvas e Gerador de Relatórios). Este módulo NÃO
// recalcula demanda: só aplica o PISO ANTI-ZERO por cima do resultado da Compra Ideal e faz o
// RATEIO quando a Matriz não cobre toda a rede. Isso garante que "Repor"/"OK" e a cobertura em
// dias mostrados aqui batem com o que a mesma loja mostraria em Lista Loja/Curva ABC.
//
// MISSÃO diferente da transferência entre lojas: aqui a origem é sempre a Matriz (depósito) e
// ela cede tudo — sem zona neutra nem proteção de origem (essas regras do Controle de
// Transferências existem para equilibrar lojas-pares que competem pelo mesmo estoque; não se
// aplicam a um depósito cuja função é justamente esvaziar para a rede).

import type { CompraIdealResult } from "@/lib/utils/compra-ideal";

/** Presença mínima numa loja que vende o item — nunca deixar com 0 nem com 1. */
export const PISO_PRESENCA = 2;

export type LojaDistStatus = "SEM_ESTOQUE" | "CRITICO" | "BAIXO" | "OK" | "SEM_VENDA" | "NOVO";

export interface LojaDistribuicao {
  /** Nome canônico da filial (para API / chave de coluna). */
  filial: string;
  /** Nome de exibição. */
  filialLabel: string;
  estoqueAtual: number;
  /** Tem histórico de venda do item nos últimos 12 meses. */
  vende: boolean;
  /** Cobertura atual em dias (mesma métrica de `calcCompraIdeal`), ou null sem consumo. */
  coberturaAtualDias: number | null;
  /** Estoque-alvo da Compra Ideal (mesma métrica da coluna "Compra Ideal" em Lista Loja). */
  idealAlvo: number;
  /** "Repor" | "OK" | "Excesso" — igual ao rótulo mostrado em Lista Loja/Curva ABC. */
  idealStatusLabel: string;
  /** Necessidade = Compra Ideal da loja, com o piso anti-zero aplicado (≥0). */
  necessidade: number;
  /** Quanto a Matriz deve enviar (após o rateio). */
  enviar: number;
  /** Estoque projetado da loja após o envio (estoque + enviar). */
  saldoAposEnvio: number;
  status: LojaDistStatus;
}

export interface DistribuicaoItem {
  produto: string;
  cor: string;
  codigoCor?: string;
  descricao: string;
  codigo: string;
  codigoBarra?: string;
  subgrupo?: string;
  grade?: string;
  /** Estoque positivo na Matriz (o que há para distribuir). */
  matrizEstoque: number;
  /** Soma do que será enviado (após rateio). */
  totalEnviar: number;
  /** Soma da necessidade da rede (antes do limite de estoque da Matriz). */
  totalNecessidade: number;
  /** Nº de lojas que vendem e estão zeradas (estoque 0) — o alerta principal. */
  lojasSemEstoque: number;
  /**
   * Item SEM histórico de venda em nenhuma loja (lançamento novo ou parado há 12m+). Não há
   * ritmo para calcular Compra Ideal, então a sugestão é uma abertura IGUAL entre todas as
   * lojas operacionais. Sinalizado com a badge "NOVO" na tela.
   */
  semHistorico: boolean;
  /** true quando a Matriz cobre toda a necessidade da rede. */
  atendeTudo: boolean;
  /** Uma entrada por filial destino, na MESMA ordem de `filiaisDestino` (colunas). */
  lojas: LojaDistribuicao[];
}

export interface DistribuicaoResult {
  matrizLabel: string;
  /** Ordem das colunas (nomes canônicos das filiais destino). */
  filiaisDestino: string[];
  filialLabels: Record<string, string>;
  itens: DistribuicaoItem[];
}

/** Entrada por loja para montar um item do board — a métrica `ideal` já vem calculada (fonte canônica). */
export interface LojaDistribuicaoInput {
  filial: string;
  filialLabel: string;
  estoqueAtual: number;
  vende: boolean;
  ideal: CompraIdealResult;
}

const IDEAL_STATUS_LABEL: Record<CompraIdealResult["status"], string> = {
  REPOR: "Repor",
  OK: "OK",
  EXCESSO: "Excesso",
};

function classificarStatus(
  vende: boolean,
  estoqueAtual: number,
  ideal: CompraIdealResult
): LojaDistStatus {
  if (!vende) return "SEM_VENDA";
  if (estoqueAtual <= 0) return "SEM_ESTOQUE";
  if (ideal.status !== "REPOR") return "OK";
  // Dentro de "Repor": crítico quando já deveria ter comprado ou vai acabar antes do próprio lead time.
  const urgente =
    ideal.comprarAgora || (ideal.diasAteAcabar != null && ideal.diasAteAcabar <= ideal.leadTimeDias);
  return urgente ? "CRITICO" : "BAIXO";
}

interface LojaComIdeal extends LojaDistribuicao {
  ideal: CompraIdealResult;
}

/** Prioridade de atendimento no rateio: quanto MENOR o número, mais cedo é servido. */
function prioridade(loja: LojaComIdeal): number {
  if (loja.status === "SEM_ESTOQUE") return -1000;
  if (loja.status === "CRITICO") return -500 + (loja.ideal.diasAteAcabar ?? 0);
  if (loja.status === "BAIXO") return loja.ideal.coberturaAtualDias ?? 999;
  return 1000 + (loja.ideal.coberturaAtualDias ?? 0);
}

/**
 * Monta o item do board a partir da Compra Ideal já calculada de cada loja: aplica o piso
 * anti-zero e rateia o estoque da Matriz em 2 passadas (1ª garante o piso às lojas críticas
 * — ninguém que vende fica sem —; 2ª completa até o ideal, na ordem de urgência).
 */
export function montarDistribuicaoItem(
  base: Omit<
    DistribuicaoItem,
    "lojas" | "totalEnviar" | "totalNecessidade" | "lojasSemEstoque" | "semHistorico" | "atendeTudo"
  >,
  lojasInput: LojaDistribuicaoInput[]
): DistribuicaoItem {
  // Item SEM histórico: nenhuma loja vendeu o item em 12m. Sem ritmo → Compra Ideal daria 0
  // pra todo mundo. Regra do dono: abertura IGUAL entre todas as lojas operacionais (a Matriz é
  // zona de distribuição, manda pras lojas). Divide o estoque da Matriz por igual; a sobra da
  // divisão vai pras lojas com MENOS estoque hoje (para nivelar a presença).
  const semHistorico = lojasInput.length > 0 && lojasInput.every((l) => !l.vende);
  if (semHistorico) {
    return montarItemSemHistorico(base, lojasInput);
  }

  const lojas: LojaComIdeal[] = lojasInput.map((l) => {
    const status = classificarStatus(l.vende, l.estoqueAtual, l.ideal);
    let necessidade = l.vende ? Math.max(0, l.ideal.compraIdeal) : 0;
    if (l.vende) {
      const faltaParaPiso = Math.max(0, PISO_PRESENCA - l.estoqueAtual);
      necessidade = Math.max(necessidade, faltaParaPiso);
    }
    return {
      filial: l.filial,
      filialLabel: l.filialLabel,
      estoqueAtual: l.estoqueAtual,
      vende: l.vende,
      coberturaAtualDias: l.ideal.coberturaAtualDias,
      idealAlvo: l.ideal.alvoEstoque,
      idealStatusLabel: IDEAL_STATUS_LABEL[l.ideal.status],
      necessidade,
      enviar: 0,
      saldoAposEnvio: l.estoqueAtual,
      status,
      ideal: l.ideal,
    };
  });

  const totalNecessidade = lojas.reduce((s, l) => s + l.necessidade, 0);
  let disponivel = base.matrizEstoque;
  const ordenadas = [...lojas].sort((a, b) => prioridade(a) - prioridade(b));

  // 1ª passada — garante o PISO anti-zero ao máximo de lojas críticas (ninguém fica sem).
  for (const loja of ordenadas) {
    if (disponivel <= 0) break;
    if (!loja.vende) continue;
    const alvoPiso = Math.max(0, PISO_PRESENCA - loja.estoqueAtual);
    if (alvoPiso <= 0) continue;
    const dar = Math.min(alvoPiso, loja.necessidade, disponivel);
    if (dar <= 0) continue;
    loja.enviar += dar;
    disponivel -= dar;
  }

  // 2ª passada — completa até a Compra Ideal, na ordem de urgência.
  for (const loja of ordenadas) {
    if (disponivel <= 0) break;
    const resta = loja.necessidade - loja.enviar;
    if (resta <= 0) continue;
    const dar = Math.min(resta, disponivel);
    loja.enviar += dar;
    disponivel -= dar;
  }

  lojas.forEach((l) => {
    l.saldoAposEnvio = l.estoqueAtual + l.enviar;
  });

  const totalEnviar = lojas.reduce((s, l) => s + l.enviar, 0);
  const lojasSemEstoque = lojas.filter((l) => l.status === "SEM_ESTOQUE").length;

  return {
    ...base,
    totalEnviar,
    totalNecessidade,
    lojasSemEstoque,
    semHistorico: false,
    atendeTudo: base.matrizEstoque >= totalNecessidade,
    // Descarta o `ideal` (CompraIdealResult completo) — só serviu no cálculo; não vai no payload.
    lojas: lojas.map((l) => {
      const { ideal, ...rest } = l;
      void ideal;
      return rest;
    }),
  };
}

/**
 * Abertura de item SEM histórico: divide o estoque da Matriz por igual entre TODAS as lojas
 * operacionais (base = floor(estoque ÷ nº lojas)); a sobra da divisão vai para as lojas com
 * menos estoque hoje, para nivelar a presença. Todas as lojas recebem a mesma quantidade-base
 * (a "sugestão igual para todas" pedida), com a badge "NOVO" para deixar claro que não há base
 * histórica. A Matriz esvazia esse item (é lançamento — tem que ir pra rede).
 */
function montarItemSemHistorico(
  base: Omit<
    DistribuicaoItem,
    "lojas" | "totalEnviar" | "totalNecessidade" | "lojasSemEstoque" | "semHistorico" | "atendeTudo"
  >,
  lojasInput: LojaDistribuicaoInput[]
): DistribuicaoItem {
  const n = lojasInput.length;
  const total = Math.max(0, Math.round(base.matrizEstoque));
  const cota = Math.floor(total / n);
  let resto = total - cota * n;

  // Ordem para receber a sobra: menor estoque atual primeiro (nivela a presença na rede).
  const ordemResto = lojasInput
    .map((l, idx) => ({ idx, estoque: l.estoqueAtual }))
    .sort((a, b) => a.estoque - b.estoque || a.idx - b.idx);
  const extra = new Set<number>();
  for (const { idx } of ordemResto) {
    if (resto <= 0) break;
    extra.add(idx);
    resto -= 1;
  }

  const lojas: LojaDistribuicao[] = lojasInput.map((l, idx) => {
    const enviar = cota + (extra.has(idx) ? 1 : 0);
    return {
      filial: l.filial,
      filialLabel: l.filialLabel,
      estoqueAtual: l.estoqueAtual,
      vende: false,
      coberturaAtualDias: null,
      idealAlvo: 0,
      idealStatusLabel: "Novo",
      necessidade: enviar,
      enviar,
      saldoAposEnvio: l.estoqueAtual + enviar,
      status: "NOVO",
    };
  });

  const totalEnviar = lojas.reduce((s, l) => s + l.enviar, 0);
  return {
    ...base,
    totalEnviar,
    totalNecessidade: totalEnviar,
    lojasSemEstoque: 0,
    semHistorico: true,
    atendeTudo: true,
    lojas,
  };
}

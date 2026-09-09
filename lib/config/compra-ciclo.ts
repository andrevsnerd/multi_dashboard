import type { CompanyKey } from "@/lib/config/company";
import {
  configCicloFabrica,
  normalizeCicloValor,
  regraCasa,
  type CompraCicloConfig,
  type CompraCicloConfigMap,
} from "@/lib/config/compra-ciclo-tipos";

/**
 * Ciclos de compra por empresa/categoria — RESOLUÇÃO.
 *
 * Cada categoria define DOIS números independentes:
 *  - coberturaDias: por quantos dias de VENDA uma remessa deve durar (giro).
 *  - producaoDias:  LEAD TIME — dias entre fazer a compra e a remessa chegar no PDV
 *                   e começar a vender (produção + transporte).
 *
 * Diferente da lógica antiga (onde lead time era assumido IGUAL à cobertura), aqui os
 * dois são separados. Isso alimenta:
 *  - a QUANTIDADE: 1 ciclo de cobertura (consumo/dia × coberturaDias);
 *  - a DATA de compra: (data em que estoque+trânsito acaba) − producaoDias.
 *
 * A resolução é por PRECEDÊNCIA (primeira regra que casa vence). Regra do dono:
 * o MATERIAL manda — qualquer subgrupo de SEDA cai em "Seda" mesmo dentro da linha
 * LENÇOS/PASHMINA; só depois caímos nas regras por linha.
 *
 * ONDE MORAM OS NÚMEROS. Já foram constantes neste arquivo; hoje são DADO editável na tela
 * "Ciclo de Compra" (`/[company]/compra-ciclo`), guardado em `compra-ciclo-store.ts`. Este
 * módulo só resolve, e resolve SÍNCRONO — é chamado no meio do render das telas e dentro de
 * loops por item nos repositórios, onde não cabe `await`. A config vem de um registro de
 * runtime preenchido de dois jeitos:
 *
 *  - NO SERVIDOR: `ensureCompraCicloRuntime()` (no store) carrega do Neon/JSON e chama
 *    `setCompraCicloRuntime`. Quem calcula compra ideal no backend faz esse await uma vez,
 *    antes do loop.
 *  - NO CLIENTE: o layout raiz injeta `window.__COMPRA_CICLO__` num <script> ANTES da
 *    hidratação (mesmo truque do tema), então o valor já está de pé no primeiro render —
 *    nada de tela calculando com o prazo velho enquanto um fetch responde.
 *
 * Sem nada carregado, cai na config DE FÁBRICA (`compra-ciclo-tipos.ts`), que é exatamente
 * o que este arquivo tinha fixo antes.
 */

export interface CicloCompra {
  /** Rótulo do grupo (Seda, Cashmere, Kafta, Pashmina Brasil, Lenços Brasil…). */
  grupo: string;
  /** Dias de cobertura (giro) que 1 remessa deve durar. */
  coberturaDias: number;
  /** Lead time: dias de produção + transporte até chegar no PDV. */
  producaoDias: number;
}

/** Chave do global compartilhado entre o script injetado e este módulo. */
const RUNTIME_KEY = "__COMPRA_CICLO__";

type RuntimeHolder = { [RUNTIME_KEY]?: CompraCicloConfigMap };

function runtimeHolder(): RuntimeHolder {
  return globalThis as unknown as RuntimeHolder;
}

/**
 * Publica a config viva (a salva na tela) para todo o processo/aba. Chamada pelo store no
 * servidor e pelo script injetado no cliente. Passar `null` volta tudo para a de fábrica.
 */
export function setCompraCicloRuntime(map: CompraCicloConfigMap | null): void {
  if (map) runtimeHolder()[RUNTIME_KEY] = map;
  else delete runtimeHolder()[RUNTIME_KEY];
}

/** Config viva já carregada (sem tocar em I/O), ou null quando ainda não veio nenhuma. */
export function getCompraCicloRuntime(): CompraCicloConfigMap | null {
  return runtimeHolder()[RUNTIME_KEY] ?? null;
}

function companyKeyOf(company: CompanyKey | string | null | undefined): string {
  return normalizeCicloValor(company).toLowerCase();
}

/**
 * Config efetiva da empresa: a salva na tela quando existe, senão a de fábrica. Empresa
 * desconhecida cai na de fábrica da SCARF ME (mesmo fallback de antes).
 */
export function getCompraCicloConfig(
  company: CompanyKey | string | null | undefined
): CompraCicloConfig {
  const key = companyKeyOf(company);
  return getCompraCicloRuntime()?.[key] ?? configCicloFabrica(key);
}

/**
 * Resolve o ciclo de compra (cobertura + produção) para um item de uma empresa.
 * Retorna sempre um ciclo (cai no padrão da empresa quando nenhuma regra casa).
 */
export function resolveCicloCompra(
  company: CompanyKey | string | null | undefined,
  meta: { linha?: string | null; subgrupo?: string | null }
): CicloCompra {
  const cfg = getCompraCicloConfig(company);
  const linha = normalizeCicloValor(meta.linha);
  const subgrupo = normalizeCicloValor(meta.subgrupo);

  for (const regra of cfg.regras) {
    if (regraCasa(regra, linha, subgrupo)) {
      return {
        grupo: regra.grupo,
        coberturaDias: regra.coberturaDias,
        producaoDias: regra.producaoDias,
      };
    }
  }
  return { ...cfg.padrao };
}

/**
 * Indica se a empresa usa o modo ciclo (lead time separado da cobertura, qtd 1 ciclo, data
 * + catraca). Quando false, o cálculo usa a lógica legada (lead = cobertura, 2× alvo).
 */
export function hasCicloCompra(company: CompanyKey | string | null | undefined): boolean {
  return getCompraCicloConfig(company).enabled;
}

/**
 * Gap (em dias) da JANELA ANTIGA da empresa — acima dele o maior trecho com estoque é tratado
 * como "velho" e o ritmo passa a usar o trecho recente.
 *
 * Números medidos nos dados reais (jun/2026, SKUs que zeraram e voltaram em 13 meses):
 *  - SCARF ME: gap mediano ~35d, P75 ~105d → 60d cobre ~64% dos casos como ruptura (mantém
 *    o histórico) e troca só nos gaps longos; alinhado ao ciclo de produção (37–80d).
 *  - NERD: gap mediano ~14d, P75 ~49d → 30d cobre ~66% como ruptura; é o dobro do lead (14d).
 */
export function resolveGapAntigoDias(
  company: CompanyKey | string | null | undefined
): number | null {
  return getCompraCicloConfig(company).gapAntigoDias;
}

/**
 * Horizonte (dias) do RESGATE de janela zerada da empresa — dentro dele uma venda no trecho
 * recente reativa o ritmo de um item cujo maior trecho teve 0 venda. Independente do
 * `gapAntigoDias` (que trata o trecho longo que vendia mas ficou velho); aqui o trecho longo
 * NÃO vendeu.
 */
export function resolveRecenteHorizonteDias(
  company: CompanyKey | string | null | undefined
): number | null {
  return getCompraCicloConfig(company).recenteHorizonteDias;
}

/**
 * Dia da semana (0=Dom … 6=Sáb) em que a empresa coloca as compras, ou `null` quando não há
 * regra semanal. Quando definido, um item cuja DATA de compra sugerida cai dentro dos dias
 * até a próxima ocorrência desse dia (1..7) é sinalizado como "comprar essa semana" — já que
 * só se compra nesse dia. Hoje só NERD (segundas = 1).
 */
export function resolveCompraDiaSemana(
  company: CompanyKey | string | null | undefined
): number | null {
  return getCompraCicloConfig(company).compraDiaSemana;
}

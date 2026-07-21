import type { CompanyKey } from "@/lib/config/company";

/**
 * Ciclos de compra por empresa/categoria.
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
 */

export interface CicloCompra {
  /** Rótulo do grupo (Seda, Cashmere, Kafta, Pashmina Brasil, Lenços Brasil…). */
  grupo: string;
  /** Dias de cobertura (giro) que 1 remessa deve durar. */
  coberturaDias: number;
  /** Lead time: dias de produção + transporte até chegar no PDV. */
  producaoDias: number;
}

interface CicloRule extends CicloCompra {
  /** Casa por linha/subgrupo já normalizados (UPPER, sem acento). */
  match: (linha: string, subgrupo: string) => boolean;
}

/** Normaliza para comparação: UPPER, sem acento, espaços colapsados. */
function normalize(value?: string | null): string {
  return (value ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

/**
 * SCARF ME — números definidos pelo dono (jun/2026; Seda → 80 produção em jul/2026):
 *   Seda                         → 90 cobertura / 80 produção
 *   Cashmere, Kafta              → 90 cobertura / 70 produção
 *   Pashmina Brasil, Lenços Brasil → 60 cobertura / 37 produção
 *
 * Precedência: material (SEDA) vence linha. ELETRONICOS mantém 30 (legado).
 */
const SCARFME_RULES: CicloRule[] = [
  // Material manda: qualquer subgrupo de seda é "Seda", mesmo em LENÇOS/PASHMINA.
  { grupo: "Seda", coberturaDias: 90, producaoDias: 80, match: (_l, sg) => sg.includes("SEDA") },
  { grupo: "Cashmere", coberturaDias: 90, producaoDias: 70, match: (l) => l === "INDIA" },
  { grupo: "Kafta", coberturaDias: 90, producaoDias: 70, match: (l) => l === "FASHION" },
  { grupo: "Pashmina Brasil", coberturaDias: 60, producaoDias: 37, match: (l) => l === "PASHMINA" },
  { grupo: "Lenços Brasil", coberturaDias: 60, producaoDias: 37, match: (l) => l === "LENCOS" },
  // Eletrônicos: cobertura curta legada; lead time = cobertura até definição própria.
  { grupo: "Eletrônicos", coberturaDias: 30, producaoDias: 30, match: (l) => l === "ELETRONICOS" },
];

interface CompanyCicloConfig {
  /** Quando true, o modo ciclo é usado (lead time separado, qtd 1 ciclo, data + catraca). */
  enabled: boolean;
  /** Regras por categoria (precedência). Default quando nenhuma casa. */
  rules: CicloRule[];
  default: CicloCompra;
  /**
   * JANELA ANTIGA — gap (em dias) acima do qual o MAIOR trecho contínuo com estoque é
   * considerado "velho": o produto ficou sem estoque por tanto tempo entre o trecho longo e
   * o trecho recente que o ritmo daquele período não reflete mais o de hoje. Acima desse gap,
   * o cálculo passa a usar o TRECHO RECENTE como base do ritmo (ver compra-ideal.ts).
   *
   * Números medidos nos dados reais (jun/2026, SKUs que zeraram e voltaram em 13 meses):
   *  - SCARF ME: gap mediano ~35d, P75 ~105d → 60d cobre ~64% dos casos como ruptura (mantém
   *    o histórico) e troca só nos gaps longos; alinhado ao ciclo de produção (37–80d).
   *  - NERD: gap mediano ~14d, P75 ~49d → 30d cobre ~66% como ruptura; é o dobro do lead (14d).
   */
  gapAntigoDias: number;
  /**
   * RESGATE DE JANELA ZERADA — horizonte (em dias) que define "vendeu recentemente". Quando o
   * MAIOR trecho contínuo com estoque teve 0 venda (vendedor lento/intermitente cujo trecho
   * longo calhou num período parado), mas houve venda no TRECHO RECENTE dentro deste horizonte,
   * o ritmo passa a ser medido pelo trecho recente ÷ máx(dias, 30) em vez de zerar o consumo e
   * cair em "Suficiente". Independente do `gapAntigoDias` (que trata o trecho longo que vendia
   * mas ficou velho); aqui o trecho longo NÃO vendeu. Default 60 nas duas; a SCARF ME, com
   * produção mais longa (até 90d), pode querer afrouxar este número depois.
   */
  recenteHorizonteDias: number;
  /**
   * COMPRAR ESSA SEMANA — dia da semana (0=Dom … 6=Sáb) em que a empresa coloca as compras.
   * Quando definido, um item cuja DATA de compra sugerida cai dentro dos dias até a próxima
   * ocorrência desse dia (1..7) é sinalizado como "comprar essa semana" (deve ser comprado já
   * nessa janela, já que só se compra nesse dia). `null`/ausente = sem regra semanal. Hoje só
   * NERD (segundas = 1); SCARF ME fica de fora até definirmos.
   */
  compraDiaSemana?: number | null;
}

/**
 * Config de ciclo por empresa.
 * - SCARF ME: regras por categoria (Seda/Cashmere/Kafta 90/70; Pashmina/Lenços 60/37), default 60/37.
 * - NERD: sem regras por categoria ainda (o dono vai passar produção por fornecedor); usa o
 *   DEFAULT 30 cobertura / 14 lead time em tudo. Já ativo (enabled).
 */
const CICLO_CONFIG: Record<CompanyKey, CompanyCicloConfig> = {
  scarfme: {
    enabled: true,
    rules: SCARFME_RULES,
    default: { grupo: "Padrão", coberturaDias: 60, producaoDias: 37 },
    gapAntigoDias: 60,
    recenteHorizonteDias: 60,
  },
  nerd: {
    enabled: true,
    rules: [],
    default: { grupo: "Padrão", coberturaDias: 30, producaoDias: 14 },
    gapAntigoDias: 30,
    recenteHorizonteDias: 60,
    compraDiaSemana: 1, // compras NERD acontecem às segundas-feiras
  },
  // CORPORATIVO não faz compra/reposição — só cadastro de clientes. Config inerte.
  corporativo: {
    enabled: false,
    rules: [],
    default: { grupo: "Padrão", coberturaDias: 30, producaoDias: 14 },
    gapAntigoDias: 30,
    recenteHorizonteDias: 60,
  },
};

/**
 * Resolve o ciclo de compra (cobertura + produção) para um item de uma empresa.
 * Retorna sempre um ciclo (cai no default da empresa quando nenhuma regra casa).
 */
export function resolveCicloCompra(
  company: CompanyKey | string | null | undefined,
  meta: { linha?: string | null; subgrupo?: string | null }
): CicloCompra {
  const key = normalize(company).toLowerCase() as CompanyKey;
  const cfg = CICLO_CONFIG[key] ?? CICLO_CONFIG.scarfme;
  const linha = normalize(meta.linha);
  const subgrupo = normalize(meta.subgrupo);

  for (const rule of cfg.rules) {
    if (rule.match(linha, subgrupo)) {
      return { grupo: rule.grupo, coberturaDias: rule.coberturaDias, producaoDias: rule.producaoDias };
    }
  }
  return cfg.default;
}

/**
 * Indica se a empresa usa o modo ciclo (lead time separado da cobertura, qtd 1 ciclo, data
 * + catraca). Quando false, o cálculo usa a lógica legada (lead = cobertura, 2× alvo).
 */
export function hasCicloCompra(company: CompanyKey | string | null | undefined): boolean {
  const key = normalize(company).toLowerCase() as CompanyKey;
  return CICLO_CONFIG[key]?.enabled ?? false;
}

/**
 * Gap (em dias) da JANELA ANTIGA da empresa — acima dele o maior trecho com estoque é tratado
 * como "velho" e o ritmo passa a usar o trecho recente. `null` quando a empresa não está
 * configurada (aí o cálculo nunca troca a base; preserva o comportamento legado).
 */
export function resolveGapAntigoDias(
  company: CompanyKey | string | null | undefined
): number | null {
  const key = normalize(company).toLowerCase() as CompanyKey;
  return CICLO_CONFIG[key]?.gapAntigoDias ?? null;
}

/**
 * Horizonte (dias) do RESGATE de janela zerada da empresa — dentro dele uma venda no trecho
 * recente reativa o ritmo de um item cujo maior trecho teve 0 venda. `null` quando a empresa
 * não está configurada (aí o resgate não dispara; preserva o comportamento legado).
 */
export function resolveRecenteHorizonteDias(
  company: CompanyKey | string | null | undefined
): number | null {
  const key = normalize(company).toLowerCase() as CompanyKey;
  return CICLO_CONFIG[key]?.recenteHorizonteDias ?? null;
}

/**
 * Dia da semana (0=Dom … 6=Sáb) em que a empresa coloca as compras, ou `null` quando não há
 * regra semanal (aí "comprar essa semana" não se aplica). Ver `compraDiaSemana`.
 */
export function resolveCompraDiaSemana(
  company: CompanyKey | string | null | undefined
): number | null {
  const key = normalize(company).toLowerCase() as CompanyKey;
  return CICLO_CONFIG[key]?.compraDiaSemana ?? null;
}

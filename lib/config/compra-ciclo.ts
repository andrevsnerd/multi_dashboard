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
 * SCARF ME — números definidos pelo dono (jun/2026):
 *   Seda, Cashmere, Kafta        → 90 cobertura / 70 produção
 *   Pashmina Brasil, Lenços Brasil → 60 cobertura / 37 produção
 *
 * Precedência: material (SEDA) vence linha. ELETRONICOS mantém 30 (legado).
 */
const SCARFME_RULES: CicloRule[] = [
  // Material manda: qualquer subgrupo de seda é "Seda", mesmo em LENÇOS/PASHMINA.
  { grupo: "Seda", coberturaDias: 90, producaoDias: 70, match: (_l, sg) => sg.includes("SEDA") },
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
  },
  nerd: {
    enabled: true,
    rules: [],
    default: { grupo: "Padrão", coberturaDias: 30, producaoDias: 14 },
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

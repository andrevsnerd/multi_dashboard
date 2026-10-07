/**
 * Planejamento de Receita — orçado mensal por canal.
 *
 * Fonte: planilha "Sme _ Budget 2027 _ vscs.xlsx" (aba "SMe 2027 _ Budget"), mantida pelo
 * financeiro. Os números ficam aqui como DADO, e as regras da planilha viram fórmula para
 * que um ajuste no orçado-base se propague como lá:
 *
 *   - Lojas 2026  = linha "Varejo · Orçado (2026)"        (L16:W16)
 *   - Web 2026    = linha "Web · Orçado (2026)"            (L20:W20)
 *   - Corp. 2026  = linha "Corporativo · Orçado (2026)"    (L24:W24)
 *   - Lojas 2027  = Lojas 2026 × 1,025                     (linha "Potencial", L17 = L16*1.025)
 *   - Web 2027    = valores digitados (linha "Potencial", L21:W21)
 *   - Corp. 2027  = Corp. 2026 × 1,2                       (L25 = L24*1.2)
 *
 * O quadro "SCarfMe_Planejamento de Receita 2027" (VAREJO TOTAL = Web + Lojas) é a soma
 * (na tela vira "Lojas + Web": lá "Varejo" é o nome da linha das LOJAS, e o termo confundia)
 * desses canais. Os cenários vêm dos três blocos de DRE da planilha, que aplicam um
 * crescimento uniforme sobre a receita bruta: base 0%, otimista +10%, pessimista −10%.
 *
 * O "Real" da planilha NÃO entra aqui: o realizado sai do Linx pela regra canônica de
 * venda (ver CLAUDE.md). Conferido em 07/10/2026: Lojas abr–ago bate ao centavo com
 * `fetchSalesTotals`; a Web da planilha vem de outra fonte e diverge de −3% a −20%.
 */

export type CanalPlanejamento = "lojas" | "web" | "corporativo";

export interface OrcadoAno {
  /** 12 valores, jan..dez, em reais. */
  lojas: number[];
  web: number[];
  /** Orçado do canal B2B. O realizado ainda não está conectado. */
  corporativo: number[];
  /** Como o orçado do ano foi montado, em uma frase por canal (aparece no rodapé). */
  regras: Partial<Record<CanalPlanejamento, string>>;
}

export interface CenarioPlanejamento {
  key: "pessimista" | "base" | "otimista";
  label: string;
  /** Crescimento uniforme sobre o orçado (0.1 = +10%). */
  fator: number;
}

export interface PlanejamentoEmpresa {
  anos: Record<number, OrcadoAno>;
  cenarios: CenarioPlanejamento[];
  fonte: string;
}

const centavos = (v: number) => Math.round(v * 100) / 100;

const LOJAS_2026 = [
  577039, 763128, 1121544, 1295770, 1562617, 1310194, 1358275, 1352265, 1292164, 1352265,
  1646758, 2194480,
];
const WEB_2026 = [
  218762, 289310, 425190, 491241, 592405, 496709, 514937, 512658, 489874, 512658, 624304,
  831952,
];
const CORPORATIVO_2026 = [
  350000, 450000, 300000, 350000, 450000, 300000, 350000, 450000, 300000, 350000, 450000,
  300000,
];

const WEB_2027 = [
  285090.35, 315000, 450000, 530000, 600000, 650000, 650000, 650000, 600000, 630000, 700000,
  850000,
];

const LOJAS_FATOR_2027 = 1.025;
const CORPORATIVO_FATOR_2027 = 1.2;

export const PLANEJAMENTO_RECEITA: Partial<Record<string, PlanejamentoEmpresa>> = {
  scarfme: {
    fonte: "Planilha Sme _ Budget 2027 (financeiro)",
    cenarios: [
      { key: "pessimista", label: "Pessimista", fator: -0.1 },
      { key: "base", label: "Base", fator: 0 },
      { key: "otimista", label: "Otimista", fator: 0.1 },
    ],
    anos: {
      2026: {
        lojas: LOJAS_2026,
        web: WEB_2026,
        corporativo: CORPORATIVO_2026,
        regras: {
          lojas: "Orçado 2026 das lojas físicas.",
          web: "Orçado 2026 do e-commerce.",
          corporativo: "Orçado 2026 do corporativo.",
        },
      },
      2027: {
        lojas: LOJAS_2026.map((v) => centavos(v * LOJAS_FATOR_2027)),
        web: WEB_2027,
        corporativo: CORPORATIVO_2026.map((v) => centavos(v * CORPORATIVO_FATOR_2027)),
        regras: {
          lojas: "Orçado 2026 + 2,5% (potencial).",
          web: "Potencial definido mês a mês pelo financeiro.",
          corporativo: "Orçado 2026 + 20% (potencial).",
        },
      },
    },
  },
};

export function getPlanejamentoEmpresa(company: string): PlanejamentoEmpresa | null {
  return PLANEJAMENTO_RECEITA[company] ?? null;
}

export function anosComPlanejamento(company: string): number[] {
  const plano = getPlanejamentoEmpresa(company);
  if (!plano) return [];
  return Object.keys(plano.anos)
    .map(Number)
    .sort((a, b) => a - b);
}

/**
 * Tipos + presets de fábrica do CICLO DE COMPRA (cobertura × produção).
 *
 * Arquivo PURO (sem `server-only`, sem I/O): é importado pelo backend (store, repositórios)
 * e pelo frontend (tela de Ciclo de Compra, Compra Ideal das telas de loja).
 *
 * O que mudou em relação à versão anterior: as regras eram FUNÇÕES (`match: (l, sg) => …`)
 * escritas no código, então mudar um prazo exigia deploy. Agora cada regra é DADO
 * (`campo` + `modo` + `valor`), o que a torna serializável — dá pra guardar no banco, editar
 * na tela e montar preset. A semântica é a mesma de antes:
 *
 *  - `campo`: qual atributo do produto a regra olha (linha ou subgrupo);
 *  - `modo`:  "igual" (nome exato) ou "contem" (o material aparece no nome);
 *  - ORDEM = PRECEDÊNCIA: a primeira regra que casa vence. É o que faz o MATERIAL mandar
 *    (SEDA em primeiro casa antes das regras por linha), regra do dono.
 */

export type CicloCampo = "linha" | "subgrupo";
export type CicloModo = "igual" | "contem";

/** Uma faixa de prazo: "quem casa com isto tem estes dois prazos". */
export interface CicloRegra {
  /** Id estável (usado como key da lista e no reordenar). */
  id: string;
  /** Rótulo exibido na Compra Ideal (Seda, Cashmere, Lenços Brasil…). */
  grupo: string;
  campo: CicloCampo;
  modo: CicloModo;
  /** Valor comparado (normalizado: UPPER, sem acento, espaços colapsados). */
  valor: string;
  /** Dias de venda que 1 remessa deve durar (giro). */
  coberturaDias: number;
  /** Lead time: dias de produção + transporte até chegar no PDV. */
  producaoDias: number;
}

/** Prazo de quem não casa com nenhuma regra. */
export interface CicloPadrao {
  grupo: string;
  coberturaDias: number;
  producaoDias: number;
}

export interface CompraCicloConfig {
  /** Modo ciclo ligado (lead separado da cobertura, qtd 1 ciclo, data + catraca). */
  enabled: boolean;
  /** Regras em ordem de precedência. */
  regras: CicloRegra[];
  padrao: CicloPadrao;
  /** Gap (dias) acima do qual o maior trecho com estoque é "velho" (janela antiga). */
  gapAntigoDias: number;
  /** Horizonte (dias) do resgate de janela zerada / venda recente. */
  recenteHorizonteDias: number;
  /** Dia da semana em que a empresa compra (0=Dom … 6=Sáb) ou null (sem regra semanal). */
  compraDiaSemana: number | null;
}

export type CompraCicloConfigMap = Record<string, CompraCicloConfig>;

/** Snapshot nomeado de uma config inteira, aplicável em qualquer empresa. */
export interface CompraCicloPreset {
  id: string;
  nome: string;
  descricao: string;
  /** true = preset de fábrica (não pode ser apagado nem sobrescrito). */
  builtin: boolean;
  config: CompraCicloConfig;
  criadoPor?: string;
  createdAt?: string;
}

export const LIMITES = {
  coberturaMin: 1,
  coberturaMax: 720,
  producaoMin: 0,
  producaoMax: 720,
  gapMin: 0,
  gapMax: 365,
  horizonteMin: 0,
  horizonteMax: 365,
} as const;

export const DIAS_SEMANA = [
  { valor: 0, label: "Domingo" },
  { valor: 1, label: "Segunda-feira" },
  { valor: 2, label: "Terça-feira" },
  { valor: 3, label: "Quarta-feira" },
  { valor: 4, label: "Quinta-feira" },
  { valor: 5, label: "Sexta-feira" },
  { valor: 6, label: "Sábado" },
] as const;

/** Normaliza para comparação: UPPER, sem acento, espaços colapsados. */
export function normalizeCicloValor(value?: string | null): string {
  return (value ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ");
}

/** Uma regra casa com o item? Mesma semântica das funções `match` antigas. */
export function regraCasa(regra: CicloRegra, linha: string, subgrupo: string): boolean {
  const alvo = regra.campo === "linha" ? linha : subgrupo;
  const valor = normalizeCicloValor(regra.valor);
  if (!valor) return false;
  return regra.modo === "contem" ? alvo.includes(valor) : alvo === valor;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

let seq = 0;

/** Id novo para regra criada na tela (só precisa ser único dentro da config). */
export function novoRegraId(): string {
  seq += 1;
  return `r${Date.now().toString(36)}${seq.toString(36)}`;
}

function normalizarRegra(bruto: unknown, indice: number): CicloRegra | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, unknown>;
  const valor = String(r.valor ?? "").trim();
  if (!valor) return null;
  return {
    id: String(r.id ?? "").trim() || `r${indice}`,
    grupo: String(r.grupo ?? "").trim() || valor,
    campo: r.campo === "linha" ? "linha" : "subgrupo",
    modo: r.modo === "contem" ? "contem" : "igual",
    valor,
    coberturaDias: clampInt(r.coberturaDias, LIMITES.coberturaMin, LIMITES.coberturaMax, 60),
    producaoDias: clampInt(r.producaoDias, LIMITES.producaoMin, LIMITES.producaoMax, 37),
  };
}

/**
 * Sanitiza qualquer objeto vindo do banco/tela numa config válida. Nunca lança: entrada
 * podre cai nos limites e no padrão, para uma linha ruim no JSON não derrubar a Compra Ideal
 * da rede inteira.
 */
export function normalizarConfigCiclo(bruto: unknown): CompraCicloConfig {
  const b = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const padraoBruto = (b.padrao && typeof b.padrao === "object" ? b.padrao : {}) as Record<string, unknown>;
  const regrasBrutas = Array.isArray(b.regras) ? b.regras : [];
  const diaSemana = b.compraDiaSemana;

  return {
    enabled: b.enabled !== false,
    regras: regrasBrutas
      .map((r, i) => normalizarRegra(r, i))
      .filter((r): r is CicloRegra => r !== null),
    padrao: {
      grupo: String(padraoBruto.grupo ?? "").trim() || "Padrão",
      coberturaDias: clampInt(padraoBruto.coberturaDias, LIMITES.coberturaMin, LIMITES.coberturaMax, 60),
      producaoDias: clampInt(padraoBruto.producaoDias, LIMITES.producaoMin, LIMITES.producaoMax, 37),
    },
    gapAntigoDias: clampInt(b.gapAntigoDias, LIMITES.gapMin, LIMITES.gapMax, 60),
    recenteHorizonteDias: clampInt(b.recenteHorizonteDias, LIMITES.horizonteMin, LIMITES.horizonteMax, 60),
    compraDiaSemana:
      diaSemana === null || diaSemana === undefined || diaSemana === ""
        ? null
        : clampInt(diaSemana, 0, 6, 1),
  };
}

export function clonarConfigCiclo(config: CompraCicloConfig): CompraCicloConfig {
  return {
    ...config,
    regras: config.regras.map((r) => ({ ...r })),
    padrao: { ...config.padrao },
  };
}

/**
 * SCARF ME de fábrica — números definidos pelo dono (jun/2026; Seda → 80 de produção em
 * jul/2026). Tradução 1:1 das regras que viviam em código.
 */
const SCARFME_FABRICA: CompraCicloConfig = {
  enabled: true,
  regras: [
    // Material manda: qualquer subgrupo de seda é "Seda", mesmo em LENÇOS/PASHMINA.
    { id: "seda", grupo: "Seda", campo: "subgrupo", modo: "contem", valor: "SEDA", coberturaDias: 90, producaoDias: 80 },
    { id: "cashmere", grupo: "Cashmere", campo: "linha", modo: "igual", valor: "INDIA", coberturaDias: 90, producaoDias: 70 },
    { id: "kafta", grupo: "Kafta", campo: "linha", modo: "igual", valor: "FASHION", coberturaDias: 90, producaoDias: 70 },
    { id: "pashmina-br", grupo: "Pashmina Brasil", campo: "linha", modo: "igual", valor: "PASHMINA", coberturaDias: 60, producaoDias: 37 },
    { id: "lencos-br", grupo: "Lenços Brasil", campo: "linha", modo: "igual", valor: "LENCOS", coberturaDias: 60, producaoDias: 37 },
    // Eletrônicos: cobertura curta legada; lead time = cobertura até definição própria.
    { id: "eletronicos", grupo: "Eletrônicos", campo: "linha", modo: "igual", valor: "ELETRONICOS", coberturaDias: 30, producaoDias: 30 },
  ],
  padrao: { grupo: "Padrão", coberturaDias: 60, producaoDias: 37 },
  gapAntigoDias: 60,
  recenteHorizonteDias: 60,
  compraDiaSemana: null,
};

/**
 * NERD de fábrica — sem regras por categoria ainda (o dono vai passar produção por
 * fornecedor); tudo cai no default 30 cobertura / 14 lead. Compra às segundas.
 */
const NERD_FABRICA: CompraCicloConfig = {
  enabled: true,
  regras: [],
  padrao: { grupo: "Padrão", coberturaDias: 30, producaoDias: 14 },
  gapAntigoDias: 30,
  recenteHorizonteDias: 60,
  compraDiaSemana: 1,
};

/** CORPORATIVO não faz compra/reposição — config inerte. */
const CORPORATIVO_FABRICA: CompraCicloConfig = {
  enabled: false,
  regras: [],
  padrao: { grupo: "Padrão", coberturaDias: 30, producaoDias: 14 },
  gapAntigoDias: 30,
  recenteHorizonteDias: 60,
  compraDiaSemana: null,
};

/** Config de fábrica por empresa — o que valia quando isto era código fixo. */
export const CONFIG_CICLO_FABRICA: Record<string, CompraCicloConfig> = {
  scarfme: SCARFME_FABRICA,
  nerd: NERD_FABRICA,
  corporativo: CORPORATIVO_FABRICA,
};

export function configCicloFabrica(company: string): CompraCicloConfig {
  return clonarConfigCiclo(CONFIG_CICLO_FABRICA[company] ?? SCARFME_FABRICA);
}

/**
 * Presets de fábrica — pontos de partida prontos. Cada um é uma config inteira; aplicar um
 * preset só PREENCHE o formulário (ainda precisa salvar). Presets novos são criados na tela
 * a partir da config atual.
 */
export const PRESETS_FABRICA: CompraCicloPreset[] = [
  {
    id: "fabrica-scarfme",
    nome: "Padrão SCARF ME",
    descricao: "Seda 90/80 · Cashmere e Kafta 90/70 · Pashmina e Lenços BR 60/37 · default 60/37.",
    builtin: true,
    config: SCARFME_FABRICA,
  },
  {
    id: "fabrica-nerd",
    nome: "Padrão NERD",
    descricao: "Sem regra por categoria: tudo 30 de cobertura / 14 de lead. Compra às segundas.",
    builtin: true,
    config: NERD_FABRICA,
  },
  {
    id: "fabrica-desligado",
    nome: "Modo ciclo desligado",
    descricao: "Volta à lógica legada (lead = cobertura, alvo 2× cobertura, sem data de compra).",
    builtin: true,
    config: CORPORATIVO_FABRICA,
  },
];

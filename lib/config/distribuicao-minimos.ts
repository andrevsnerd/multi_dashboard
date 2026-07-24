// ════════════════════════════════════════════════════════════════════════════
//  DISTRIBUIÇÃO POR MÍNIMO — tradução fiel da planilha "DIVISÃO LOJAS NOVO.xlsx".
// ════════════════════════════════════════════════════════════════════════════
//
// Regra (definida pelo dono):
//   • Cada material×tamanho tem um ESTOQUE MÍNIMO por loja.
//   • O mínimo vale POR ESTAMPA/COR (grão produto×cor), não para a categoria somada.
//   • Se a loja tem menos que o mínimo daquele produto×cor  → sugerir enviar (mínimo − estoque).
//   • Se tem o mínimo ou mais                               → não enviar nada.
//   • A origem é sempre a MATRIZ; ela só envia o que tem em estoque (rateio quando falta).
//
// Camadas de exceção ("observações" da planilha):
//   • SAZONAL  — PANNEAUX têm mínimo de verão e de inverno (resolvido por data).
//   • COLEÇÃO/TEMA — GUARULHOS (aeroporto) tem mínimo maior para coleções/estampas "Brasil"
//                    (casado por NOME do produto DESC_PRODUTO + COLECAO + TIPO, sem acento).
//   • COR      — pashminas têm mínimo maior em certas cores (casado por código de cor).
//   • RESTRIÇÃO DE COR — IGUATEMI pashmina só recebe tons neutros (demais cores → mínimo 0).
//
// Fonte de verdade do MAPEAMENTO no Linx (validado via consulta ao ERP):
//   material → GRUPO_PRODUTO / SUBGRUPO_PRODUTO / GRADE / (nome DESC_PRODUTO p/ arabesco e organizador)
//   cor      → código COR_PRODUTO (PRETO=06, OFF WHITE=13, CAFÉ=Q9, CAQUI=L8, NUDE=42, FENDI=94)
//
// Notas: temas "MATA ATLANTICA" e "COCAR" existem no NOME do produto (não em COLECAO/TIPO) — por
// isso o casamento de tema inclui DESC_PRODUTO. A lista CORES_NEUTRAS (restrição IGUATEMI) é curada
// do cadastro; ajuste com o dono se faltar/sobrar cor.

import type { CompanyKey } from "@/lib/config/company";

/** Ordem canônica das 9 lojas destino — casa com o display do registry (filial-registry.ts). */
export const DISTRIBUICAO_FILIAIS = [
  "PAULISTA",
  "MORUMBI",
  "HIGIENÓPOLIS",
  "IGUATEMI",
  "VILLA LOBOS",
  "OSCAR FREIRE", // planilha: "OSCAR"
  "E-COMMERCE", //   planilha: "SITE"
  "GALEÃO RJ", //    planilha: "GALEÃO"
  "GUARULHOS",
] as const;

export type DistribuicaoFilial = (typeof DISTRIBUICAO_FILIAIS)[number];

/** Vetor de mínimos na ordem de DISTRIBUICAO_FILIAIS. */
type Mins = readonly [number, number, number, number, number, number, number, number, number];

/** Códigos de cor citados nas observações (COR_PRODUTO no Linx). */
export const COR_CODIGO = {
  PRETO: "06",
  OFF_WHITE: "13",
  CAFE: "Q9",
  CAQUI: "L8",
  NUDE: "42",
  FENDI: "94",
} as const;

/**
 * Cores "neutras" (códigos COR_PRODUTO) — usadas na restrição do IGUATEMI ("só enviar tons
 * neutros" nas pashminas). ⚠️ Lista curada a partir do cadastro; ajuste com o dono se faltar/sobrar.
 */
export const CORES_NEUTRAS: string[] = [
  "01", // BRANCO
  "06", // PRETO
  "07", // CINZA
  "09", // MARROM
  "13", // OFF WHITE
  "20", // BEGE
  "22", // CREME
  "28", // AREIA
  "41", // CARAMELO
  "42", // NUDE
  "94", // FENDI (FENDHI)
  "L8", // CAQUI
  "Q9", // CAFÉ
  "U3", // CASTANHO
  "C8", // CHUMBO
  "H1", // PELE
];

/** Como reconhecer os produtos de um material no cadastro do Linx. */
export interface MaterialMatch {
  /** GRUPO_PRODUTO (uppercase) — qualquer um da lista. Vazio = não filtra por grupo. */
  grupo?: string[];
  /** SUBGRUPO_PRODUTO (uppercase) — qualquer um da lista. */
  subgrupo?: string[];
  /** GRADE (uppercase) — qualquer um da lista. */
  grade?: string[];
  /** DESC_PRODUTO CONTÉM (uppercase) — para arabesco/organizador que são por nome. */
  descContains?: string[];
  /** GRADE COMEÇA COM (uppercase) — para organizador (TAMANHO PP/P/M/G). */
  gradeStartsWith?: string[];
}

/** Override por coleção/tema: casa COLECAO (desc) OU TIPO_PRODUTO contendo alguma palavra-chave. */
export interface OverrideTema {
  kind: "tema";
  /** Palavras-chave (uppercase) buscadas em COLECAO/TIPO_PRODUTO por "contém". */
  keywords: string[];
  /** Lojas afetadas (display). */
  filiais: DistribuicaoFilial[];
  /** Mínimo elevado para essas lojas quando o produto casa. */
  min: number;
  /** Só documentação. */
  nota?: string;
}

/** Override por cor: casa código de cor exato. */
export interface OverrideCor {
  kind: "cor";
  /** Códigos COR_PRODUTO. */
  codigos: string[];
  /** Mínimo por loja (na ordem de DISTRIBUICAO_FILIAIS) quando a cor casa; null = não altera. */
  minPorFilial: readonly (number | null)[];
  nota?: string;
}

export type Override = OverrideTema | OverrideCor;

/** Restrição de cores para certas lojas: só as cores permitidas recebem; o resto vira mínimo 0. */
export interface RestricaoCor {
  filiais: DistribuicaoFilial[];
  /** Códigos COR_PRODUTO permitidos nessas lojas. Qualquer outra cor → mínimo 0. */
  codigosPermitidos: string[];
  nota?: string;
}

export interface MaterialDef {
  key: string;
  label: string;
  match: MaterialMatch;
  /** Mínimo base por loja. Em materiais sazonais, este é o de VERÃO. */
  min: Mins;
  /** Se sazonal, mínimo de INVERNO (abr–set). Ausente = não sazonal (min vale o ano todo). */
  minInverno?: Mins;
  overrides?: Override[];
  /** Lojas que só recebem certas cores (ex.: IGUATEMI pashmina = só neutros). */
  restricaoCor?: RestricaoCor;
}

// ── Helpers de estação ──────────────────────────────────────────────────────

/** Verão = out–mar; Inverno = abr–set (calendário Brasil). */
export function isInverno(date: Date): boolean {
  const m = date.getMonth() + 1; // 1..12
  return m >= 4 && m <= 9;
}

// ── Overrides de cor reutilizados (pashminas) ─────────────────────────────────
// Cada linha = mínimo POR LOJA quando a cor casa (mesma ordem de DISTRIBUICAO_FILIAIS).
// Ordem: PAULISTA, MORUMBI, HIGIENÓPOLIS, IGUATEMI, VILLA LOBOS, OSCAR, SITE, GALEÃO, GUARULHOS

/** Pashmina viscose — PRETO/OFF WHITE elevam quase todas; SITE inclui FENDI/CAQUI/NUDE. */
const PASHMINA_VISCOSE_COR_OVERRIDES: Override[] = [
  {
    kind: "cor",
    codigos: [COR_CODIGO.PRETO, COR_CODIGO.OFF_WHITE],
    // PAU 5, MOR 5, HIG 4, IGU 3, VL 4, OSC 6, SITE (tratado abaixo) , GAL 3, GRU 3
    minPorFilial: [5, 5, 4, 3, 4, 6, null, 3, 3],
    nota: "PRETO/OFF WHITE — mínimo elevado. IGUATEMI inclui CAFÉ (ver override próprio).",
  },
  {
    kind: "cor",
    codigos: [COR_CODIGO.CAFE],
    // Só IGUATEMI cita CAFÉ (3) — "PRETO, OFF WHITE E CAFÉ 3 UNIDADES".
    minPorFilial: [null, null, null, 3, null, null, null, null, null],
    nota: "IGUATEMI — CAFÉ entra nos neutros (3).",
  },
  {
    kind: "cor",
    codigos: [COR_CODIGO.PRETO, COR_CODIGO.OFF_WHITE, COR_CODIGO.FENDI, COR_CODIGO.CAQUI, COR_CODIGO.NUDE],
    // SITE — "PRETO, OFF WHITE, FENDI, CAQUI E NUDE 30".
    minPorFilial: [null, null, null, null, null, null, 30, null, null],
    nota: "SITE — cores neutras a 30.",
  },
];

/** Pashmina toque de lã (100% acrílico) — igual às viscose, mas SITE sem NUDE. */
const PASHMINA_LA_COR_OVERRIDES: Override[] = [
  {
    kind: "cor",
    codigos: [COR_CODIGO.PRETO, COR_CODIGO.OFF_WHITE],
    minPorFilial: [5, 5, 4, 3, 4, 6, null, 3, 3],
    nota: "PRETO/OFF WHITE — mínimo elevado.",
  },
  {
    kind: "cor",
    codigos: [COR_CODIGO.PRETO, COR_CODIGO.OFF_WHITE, COR_CODIGO.FENDI, COR_CODIGO.CAQUI],
    // SITE — "PRETO, OFF WHITE, FENDI, CAQUI 30".
    minPorFilial: [null, null, null, null, null, null, 30, null, null],
    nota: "SITE — neutras a 30 (sem NUDE nesta aba).",
  },
];

// ── Overrides de tema GUARULHOS (aeroporto) — coleções/estampas "Brasil" ──────
// keywords casadas por "contém" (sem acento) no NOME (DESC_PRODUTO) + COLECAO + TIPO_PRODUTO.
//   PANTANAL → COLECAO 'PANTANAL VIVO 25' e nome
//   TARSILA  → COLECAO 'TARSILA DO AMARAL 25'
//   TROPICAL/FAUNA/AMAZONIA/ARARA/PAISAGEM → TIPO_PRODUTO + nome
//   MATA ATL / COCAR → NOME do produto (ex.: "MATA ATLÂNTICA 05/23", "COCAR ALV17").
//   ⚠️ Casamento por palavra é amplo de propósito (Guarulhos deve reforçar temas "Brasil").

const GRU: DistribuicaoFilial[] = ["GUARULHOS"];

function temaGru(keywords: string[], min: number, nota?: string): OverrideTema {
  return { kind: "tema", keywords, filiais: GRU, min, nota };
}

// ════════════════════════════════════════════════════════════════════════════
//  TABELA DE MATERIAIS (a planilha, aba por aba)
// ════════════════════════════════════════════════════════════════════════════

export const MATERIAIS_SCARFME: MaterialDef[] = [
  // ───────── CETIM POLIÉSTER (SUBGRUPO='CETIM DE POLIESTER') ─────────
  {
    key: "cetim-poliester-90x90",
    label: "CETIM POLIÉSTER 90X90",
    match: { subgrupo: ["CETIM DE POLIESTER"], grade: ["90X90"] },
    min: [4, 4, 3, 3, 3, 5, 10, 4, 3],
    overrides: [temaGru(["PANTANAL", "TROPICAL", "FAUNA"], 10, "GUARULHOS: PANTANAL, BRASIL TROPICAL, FAUNA = 10")],
  },
  {
    key: "cetim-poliester-70x70",
    label: "CETIM POLIÉSTER 70X70",
    match: { subgrupo: ["CETIM DE POLIESTER"], grade: ["70X70"] },
    // IGUATEMI base 0 — "recebe só se for coleção nova (Tarsila) 3".
    min: [4, 4, 3, 0, 3, 5, 10, 4, 3],
    overrides: [
      { kind: "tema", keywords: ["TARSILA"], filiais: ["IGUATEMI"], min: 3, nota: "IGUATEMI só recebe se coleção nova (Tarsila) = 3" },
      temaGru(["TARSILA"], 10, "GUARULHOS: Tarsila do Amaral = 10"),
    ],
  },
  {
    key: "cetim-poliester-50x50",
    label: "CETIM POLIÉSTER 50X50",
    match: { subgrupo: ["CETIM DE POLIESTER"], grade: ["50X50"] },
    min: [3, 3, 3, 1, 2, 5, 20, 3, 3],
    overrides: [temaGru(["TROPICAL"], 5, "GUARULHOS: Brasil Tropical = 5")],
  },
  {
    key: "cetim-poliester-8x130",
    label: "CETIM POLIÉSTER 8X130",
    match: { subgrupo: ["CETIM DE POLIESTER"], grade: ["8X130"] },
    min: [3, 3, 2, 2, 2, 5, 10, 3, 3],
  },

  // ───────── MOUSSELINE POLIÉSTER (SUBGRUPO='MOUSSELINE DE POLIESTER') ─────────
  {
    key: "mousseline-poliester-45x210",
    label: "MOUSSELINE POLIÉSTER 45X210",
    match: { subgrupo: ["MOUSSELINE DE POLIESTER"], grade: ["45X210"] },
    min: [5, 5, 4, 3, 3, 5, 10, 4, 4],
    overrides: [
      temaGru(["TROPICAL", "PANTANAL", "AMAZONIA", "MATA ATL"], 10, "GUARULHOS: Brasil Tropical, Pantanal, Amazônia, Mata Atlântica = 10"),
    ],
  },
  {
    key: "mousseline-poliester-130x130",
    label: "MOUSSELINE POLIÉSTER 130X130",
    match: { subgrupo: ["MOUSSELINE DE POLIESTER"], grade: ["130X130"] },
    min: [2, 2, 2, 1, 1, 3, 5, 3, 5],
  },

  // ───────── PANNEAU VISCOSE (GRUPO='PANNEAUX' + SUBGRUPO='VISCOSE') — SAZONAL ─────────
  {
    key: "panneau-viscose-130x200",
    label: "PANNEAU VISCOSE 130X200",
    match: { grupo: ["PANNEAUX"], subgrupo: ["VISCOSE"], grade: ["130X200"] },
    min: [3, 3, 2, 2, 2, 5, 6, 3, 3], //         verão
    minInverno: [0, 0, 0, 0, 0, 2, 3, 3, 3], //  inverno
    overrides: [
      temaGru(["COCAR", "TROPICAL", "PANTANAL", "ARARA", "PAISAGEM"], 5, "GUARULHOS: Cocar, Brasil Tropical, Pantanal, Araras, Paisagem = 5"),
    ],
  },

  // ───────── PANNEAU GEORGETE (GRUPO='PANNEAUX' + SUBGRUPO='GEORGETE DE POLIESTER') — SAZONAL ─────────
  {
    key: "panneau-georgete-130x200",
    label: "PANNEAU GEORGETE 130X200",
    match: { grupo: ["PANNEAUX"], subgrupo: ["GEORGETE DE POLIESTER"], grade: ["130X200"] },
    min: [2, 2, 2, 2, 2, 5, 6, 3, 3], //         verão
    minInverno: [0, 0, 0, 0, 0, 2, 3, 3, 3], //  inverno
    overrides: [
      temaGru(["COCAR", "TROPICAL", "PANTANAL", "ARARA", "PAISAGEM"], 5, "GUARULHOS: Cocar, Brasil Tropical, Pantanal, Araras, Paisagem = 5"),
    ],
  },

  // ───────── ALGODÃO 65X65 (GRUPO='LENÇO' + SUBGRUPO='ALGODÃO') ─────────
  {
    key: "algodao-65x65",
    label: "ALGODÃO 65X65",
    match: { grupo: ["LENÇO"], subgrupo: ["ALGODÃO", "ALGODAO"], grade: ["65X65"] },
    min: [3, 3, 3, 2, 2, 5, 10, 4, 3],
  },

  // ───────── PASHMINA VISCOSE 70X180 (GRUPO='PASHMINA' + SUBGRUPO viscose) ─────────
  {
    key: "pashmina-viscose-70x180",
    label: "PASHMINA VISCOSE 70X180",
    match: { grupo: ["PASHMINA"], subgrupo: ["VISCOSE", "VISCOSE (PASHMINA)"], grade: ["70X180"] },
    min: [2, 2, 2, 2, 2, 5, 20, 2, 2],
    overrides: PASHMINA_VISCOSE_COR_OVERRIDES,
    restricaoCor: { filiais: ["IGUATEMI"], codigosPermitidos: CORES_NEUTRAS, nota: "IGUATEMI: só tons neutros" },
  },

  // ───────── PASHMINA TOQUE DE LÃ 70X180 (GRUPO='PASHMINA' + SUBGRUPO='100% ACRILICO') ─────────
  {
    key: "pashmina-toque-de-la-70x180",
    label: "PASHMINA TOQUE DE LÃ 70X180",
    match: { grupo: ["PASHMINA"], subgrupo: ["100% ACRILICO"], grade: ["70X180"] },
    min: [2, 2, 2, 1, 1, 5, 20, 2, 1],
    overrides: PASHMINA_LA_COR_OVERRIDES,
    restricaoCor: { filiais: ["IGUATEMI"], codigosPermitidos: CORES_NEUTRAS, nota: "IGUATEMI: só tons neutros" },
  },

  // ───────── LIVRO (SUBGRUPO='LIVRO') ─────────
  {
    key: "livro",
    label: "LIVRO",
    match: { subgrupo: ["LIVRO"] },
    min: [10, 10, 10, 10, 10, 20, 30, 10, 10],
  },

  // ───────── PASHMINA ARABESCO (por nome DESC_PRODUTO) ─────────
  {
    key: "pashmina-arabesco",
    label: "PASHMINA ARABESCO",
    // Nome começa com "PASHMINA ARABESCO"; GRUPO='PASHMINA' exclui os KITs.
    match: { grupo: ["PASHMINA"], descContains: ["PASHMINA ARABESCO"] },
    min: [15, 15, 12, 12, 10, 20, 50, 10, 10],
  },

  // ───────── ORGANIZADOR (por nome DESC_PRODUTO, tamanhos PP/P/M/G) ─────────
  {
    key: "organizador",
    label: "ORGANIZADOR (PP/P/M/G)",
    // Nome contém "ORGANIZADOR" e grade é TAMANHO ... (exclui KIT ORGANIZADOR grade UNICO).
    match: { descContains: ["ORGANIZADOR"], gradeStartsWith: ["TAMANHO "] },
    min: [1, 1, 0, 1, 1, 3, 5, 3, 2],
    // IGUATEMI: "TARSILA P e PP falar antes com a loja" — nota manual, sem regra automática.
  },
];

// ── API pública ───────────────────────────────────────────────────────────────

export function getMateriaisForCompany(company: CompanyKey): MaterialDef[] {
  return company === "scarfme" ? MATERIAIS_SCARFME : [];
}

/** Contexto de um produto×cor para resolver o mínimo efetivo. */
export interface ProdutoContexto {
  grupo: string | null;
  subgrupo: string | null;
  grade: string | null;
  descricao: string | null;
  colecaoDesc: string | null;
  tipo: string | null;
  corCodigo: string | null;
}

const up = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/** Uppercase + remove acentos (para casar "ATLÂNTICA" com a keyword "MATA ATL"). */
const norm = (s: string | null | undefined) =>
  up(s).normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Normaliza um código de cor para comparação: se for puramente numérico, remove zeros à
 * esquerda ('06'→'6'); senão, uppercase. COR_PRODUTO chega como '06' ou '6' conforme a fonte.
 */
function normCor(c: string | null | undefined): string {
  const raw = up(c);
  return /^\d+$/.test(raw) ? String(parseInt(raw, 10)) : raw;
}

/** true se o produto×cor pertence ao material. */
export function produtoCasaMaterial(m: MaterialDef, ctx: ProdutoContexto): boolean {
  const { grupo, subgrupo, grade, descContains, gradeStartsWith } = m.match;
  if (grupo && !grupo.map(up).includes(up(ctx.grupo))) return false;
  if (subgrupo && !subgrupo.map(up).includes(up(ctx.subgrupo))) return false;
  if (grade && !grade.map(up).includes(up(ctx.grade))) return false;
  if (gradeStartsWith && !gradeStartsWith.some((g) => up(ctx.grade).startsWith(up(g)))) return false;
  if (descContains && !descContains.some((d) => up(ctx.descricao).includes(up(d)))) return false;
  return true;
}

/**
 * Mínimo efetivo daquele produto×cor numa loja: parte do base do material (verão/inverno),
 * e aplica o MAIOR override aplicável (tema de coleção ou cor). Nunca abaixo do base.
 */
export function minimoEfetivo(
  m: MaterialDef,
  filialIndex: number,
  ctx: ProdutoContexto,
  inverno: boolean
): number {
  const filialDisplay = DISTRIBUICAO_FILIAIS[filialIndex];

  // Restrição de cor (ex.: IGUATEMI pashmina só neutros): cor não permitida → mínimo 0.
  const r = m.restricaoCor;
  if (r && r.filiais.includes(filialDisplay)) {
    const permitida =
      ctx.corCodigo != null && r.codigosPermitidos.map(normCor).includes(normCor(ctx.corCodigo));
    if (!permitida) return 0;
  }

  const baseVetor = inverno && m.minInverno ? m.minInverno : m.min;
  let min = baseVetor[filialIndex] ?? 0;

  for (const ov of m.overrides ?? []) {
    if (ov.kind === "cor") {
      if (ctx.corCodigo && ov.codigos.map(normCor).includes(normCor(ctx.corCodigo))) {
        const cand = ov.minPorFilial[filialIndex];
        if (cand != null) min = Math.max(min, cand);
      }
    } else {
      // tema: casa keyword no NOME (DESC_PRODUTO) + COLECAO + TIPO, sem acento.
      const hay = norm(`${ctx.descricao} ${ctx.colecaoDesc} ${ctx.tipo}`);
      const afeta = ov.filiais.includes(filialDisplay);
      if (afeta && ov.keywords.some((k) => hay.includes(norm(k)))) {
        min = Math.max(min, ov.min);
      }
    }
  }
  return min;
}

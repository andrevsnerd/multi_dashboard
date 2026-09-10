/**
 * Embalagens da ScarfMe — de que forma o cadastro do produto vira CATEGORIA e de que forma
 * um ticket vira quantidade de embalagem.
 *
 * A conta tem dois passos, e este arquivo é a fonte única dos dois:
 *
 *   1. CLASSIFICAÇÃO — cada item vendido cai em UMA categoria (`CATEGORIAS`, primeira que
 *      casar vence). A ordem importa: as coleções personalizadas (Tarsila, Portinari…) vêm
 *      antes das genéricas, senão um lenço Tarsila contaria como lenço ScarfMe.
 *   2. REGRA — cada embalagem (`EMBALAGENS`) recebe o TICKET INTEIRO já classificado e diz
 *      quantas unidades dela aquele ticket consome. É por isso que "caixa por peça" e
 *      "sacola por compra" convivem sem gambiarra: a primeira lê `ctx.qtd.<categoria>`, a
 *      segunda devolve 1.
 *
 * A projeção aplica estas regras também ao PASSADO — inclusive a regra nova de novembro,
 * que ainda não estava valendo. É de propósito: o que se quer projetar é quanta embalagem
 * o mesmo movimento de venda consumiria sob as regras de HOJE, não quanta se gastou de fato.
 *
 * Estoque atual NÃO vive aqui: `estoqueInicial` é só a semente da primeira vez (os números
 * da planilha de contagem). Depois disso o valor é o que estiver salvo em
 * [embalagens-estoque-store.ts](@/lib/utils/embalagens-estoque-store), editável na tela.
 */

/** Canal do pedido: loja física (ticket POS) ou site (nota do e-commerce). */
export type EmbalagemCanal = "loja" | "site";

/** Categoria de produto que as regras de embalagem sabem contar. */
export type CategoriaEmbalagem =
  | "lencoTarsila"
  | "twillyTarsila"
  | "pashminaTarsila"
  | "fashionTarsila"
  | "twillyJardimSurreal"
  | "lencoPortinari"
  | "lencoPantanal"
  | "lencoEssencial"
  | "lencoEssenciaBrasileira"
  | "cashmere"
  | "pashminaLa"
  | "pashminaViscose"
  | "twilly"
  | "fashion"
  | "lenco";

/**
 * Um casamento com o cadastro do produto. As dimensões preenchidas se SOMAM (E lógico);
 * dentro de cada uma, os valores são alternativas (OU).
 */
export interface FiltroCadastro {
  /** `PRODUTOS.LINHA`, comparação exata (maiúsculas). */
  linhas?: string[];
  /** `PRODUTOS.GRUPO_PRODUTO`, exata. */
  grupos?: string[];
  /** `PRODUTOS.SUBGRUPO_PRODUTO`, exata. */
  subgrupos?: string[];
  /** `PRODUTOS.SUBGRUPO_PRODUTO`, contém o trecho. */
  subgruposContendo?: string[];
  /** `PRODUTOS.COLECAO` — o CÓDIGO da coleção, não a descrição. */
  colecoes?: string[];
  /** `PRODUTOS.DESC_PRODUTO`, contém o trecho. */
  descricaoContendo?: string[];
}

export interface CategoriaDef {
  key: CategoriaEmbalagem;
  label: string;
  /** Casa quando QUALQUER um dos filtros casar (OU entre eles). Vazio = nunca casa. */
  filtros: FiltroCadastro[];
}

/** Grupos que contam como "lenço" no vocabulário da embalagem (a caixinha é a mesma). */
const GRUPOS_LENCO = ["LENÇO", "ECHARPE", "FOULLARD", "PANNEAUX"];

/** Códigos de coleção das linhas com embalagem própria (tabela COLECOES). */
export const COLECAO = {
  tarsila: "U7", // TARSILA DO AMARAL 25
  portinari: "X10", // PORTINARI
  pantanal: "V9", // PANTANAL VIVO 25
  jardimSurreal: "U6", // JD. SURREAL MÃES 25
  essencial: "Y4", // ESSENTIALS 26
  essenciaBrasileira: "P8", // BRASILIDADE
} as const;

/**
 * `COD_FILIAL` de Guarulhos. A loja do aeroporto usa caixinha de lenço PRÓPRIA, então ela
 * sai da conta da caixa ScarfMe e entra na dela. Vai por CÓDIGO e não por nome: o nome da
 * filial muda no Linx, o código não — ver [[filial-por-id-registry]].
 */
export const FILIAL_GRU = "000079";

/**
 * `COD_FILIAL` da Oscar Freire. A loja segue a mesma regra de fim de ano do site: entre 1º
 * de novembro e 25 de dezembro, cada lenço sai na sua sacola em vez de a compra inteira ir
 * numa só.
 */
export const FILIAL_OSCAR_FREIRE = "000062";

/**
 * Ordem = prioridade. Primeira categoria que casar leva o item; quem não casa com nenhuma
 * fica sem categoria (o ticket ainda conta — a caixa dos Correios é por pedido, não por peça).
 */
export const CATEGORIAS: CategoriaDef[] = [
  // ── Coleções com embalagem personalizada (têm de vir antes das genéricas) ──
  { key: "lencoTarsila", label: "Lenço Tarsila", filtros: [{ colecoes: [COLECAO.tarsila], grupos: GRUPOS_LENCO }] },
  { key: "twillyTarsila", label: "Twilly Tarsila", filtros: [{ colecoes: [COLECAO.tarsila], grupos: ["TWILLY"] }] },
  { key: "pashminaTarsila", label: "Pashmina Tarsila", filtros: [{ colecoes: [COLECAO.tarsila], grupos: ["PASHMINA"] }] },
  { key: "fashionTarsila", label: "Fashion Tarsila", filtros: [{ colecoes: [COLECAO.tarsila], linhas: ["FASHION"] }] },
  {
    key: "twillyJardimSurreal",
    label: "Twilly Jardim Surreal",
    filtros: [{ colecoes: [COLECAO.jardimSurreal], grupos: ["TWILLY"] }],
  },
  { key: "lencoPortinari", label: "Lenço Portinari", filtros: [{ colecoes: [COLECAO.portinari], grupos: GRUPOS_LENCO }] },
  { key: "lencoPantanal", label: "Lenço Pantanal", filtros: [{ colecoes: [COLECAO.pantanal], grupos: GRUPOS_LENCO }] },
  { key: "lencoEssencial", label: "Lenço Essencial", filtros: [{ colecoes: [COLECAO.essencial], grupos: GRUPOS_LENCO }] },
  {
    key: "lencoEssenciaBrasileira",
    label: "Lenço Essência Brasileira",
    filtros: [{ colecoes: [COLECAO.essenciaBrasileira], grupos: GRUPOS_LENCO }],
  },

  // ── Pashminas: cada material tem a sua caixa, então vêm antes de "lenço" ──
  {
    // Cashmere Baby (100% cashmere da linha ÍNDIA) e Cashmere Zari (cashmere com seda).
    key: "cashmere",
    label: "Cashmere (Baby / Zari)",
    filtros: [{ grupos: ["PASHMINA"], subgrupos: ["100% CASHMERE", "CASHMERE", "CASHMERE/SEDA", "CASHMERE (PASHMINA)"] }],
  },
  {
    // "Pashmina com toque de lã" — a que sai na caixa de acrílico com tampa.
    key: "pashminaLa",
    label: "Pashmina toque de lã",
    filtros: [{ grupos: ["PASHMINA"], subgruposContendo: ["LÃ", "ACRILICO", "ALPACA"] }],
  },
  {
    key: "pashminaViscose",
    label: "Pashmina viscose / arabesco",
    filtros: [
      { grupos: ["PASHMINA"], subgruposContendo: ["VISCOSE"] },
      { grupos: ["PASHMINA"], descricaoContendo: ["ARABESCO"] },
    ],
  },

  // ── Genéricas ──
  { key: "twilly", label: "Twilly", filtros: [{ grupos: ["TWILLY"] }] },
  { key: "fashion", label: "Fashion", filtros: [{ linhas: ["FASHION"] }] },
  { key: "lenco", label: "Lenço ScarfMe", filtros: [{ grupos: GRUPOS_LENCO }] },
];

export const CATEGORIA_KEYS: CategoriaEmbalagem[] = CATEGORIAS.map((c) => c.key);

/** Contagem por categoria de um ticket (sempre com todas as chaves preenchidas). */
export type ContagemCategorias = Record<CategoriaEmbalagem, number>;

export function contagemVazia(): ContagemCategorias {
  return Object.fromEntries(CATEGORIA_KEYS.map((k) => [k, 0])) as ContagemCategorias;
}

/** Um ticket (ou pedido do site) já classificado, do jeito que a regra enxerga. */
export interface ContextoTicket {
  qtd: ContagemCategorias;
  canal: EmbalagemCanal;
  /** `COD_FILIAL` da venda ('' no e-commerce). */
  filialId: string;
  /**
   * A venda caiu entre 1º de novembro e 25 de dezembro — a janela em que o pedido do site
   * leva uma sacola por lenço (regra 7).
   */
  janelaNatal: boolean;
}

/**
 * A compra está na janela de fim de ano em que a sacola acompanha a PEÇA e não o pedido:
 * de 1º de novembro a 25 de dezembro, nos pedidos do site e na loja Oscar Freire.
 */
function sacolaPorPeca(ctx: ContextoTicket): boolean {
  if (!ctx.janelaNatal) return false;
  return ctx.canal === "site" || ctx.filialId === FILIAL_OSCAR_FREIRE;
}

/**
 * Sacola ScarfMe do ticket. É UMA por compra e EXCLUSIVA entre os tamanhos: a cliente sai
 * da loja com uma sacola só, então P/M/G não podem somar no mesmo ticket.
 *
 * A exceção é a regra 7: na janela de fim de ano do site e da Oscar Freire, vai uma sacola
 * M por lenço.
 */
function sacolaScarfme(ctx: ContextoTicket): { tamanho: "P" | "M" | "G"; qtde: number } | null {
  const lencos = ctx.qtd.lenco;
  const twillys = ctx.qtd.twilly;

  // Fashion e Cashmere mandam na sacola: os dois saem em G (regras 1 e 2).
  if (ctx.qtd.fashion > 0 || ctx.qtd.cashmere > 0) return { tamanho: "G", qtde: 1 };

  // Regra 7: na janela de fim de ano vai uma sacola por lenço, não uma por compra.
  if (sacolaPorPeca(ctx) && lencos > 0) return { tamanho: "M", qtde: lencos };

  // Faixa por quantidade de lenços: até 3 vai só na caixinha, 4-6 em M, 7+ em G.
  if (lencos > 6) return { tamanho: "G", qtde: 1 };
  if (lencos >= 4) return { tamanho: "M", qtde: 1 };

  // Twilly: 1 ou 2 em sacola P, mais que isso em M.
  if (twillys > 2) return { tamanho: "M", qtde: 1 };
  if (twillys > 0) return { tamanho: "P", qtde: 1 };

  return null;
}

/** Quantas sacolas ScarfMe daquele tamanho o ticket consome. */
function sacola(ctx: ContextoTicket, tamanho: "P" | "M" | "G"): number {
  const escolha = sacolaScarfme(ctx);
  return escolha && escolha.tamanho === tamanho ? escolha.qtde : 0;
}

/** 1 quando o ticket tem qualquer peça daquelas categorias (sacola é por compra). */
function umaPorCompra(ctx: ContextoTicket, categorias: CategoriaEmbalagem[]): number {
  return categorias.some((c) => ctx.qtd[c] > 0) ? 1 : 0;
}

export interface EmbalagemDef {
  id: string;
  nome: string;
  /** Contagem da planilha — vale só enquanto ninguém tiver salvo um estoque na tela. */
  estoqueInicial: number;
  /**
   * Quantas unidades desta embalagem o ticket consome. `null` = regra ainda não definida:
   * a linha aparece na tela como "sem regra" em vez de projetar zero e parecer certa.
   */
  regra: ((ctx: ContextoTicket) => number) | null;
  /** Observação que a tela mostra no tooltip da linha. */
  nota?: string;
  /**
   * Fora da tela por ora. A definição fica aqui (com o motivo) em vez de sumir do arquivo:
   * o dia em que a regra existir, é só tirar a flag.
   */
  oculta?: boolean;
}

export const EMBALAGENS: EmbalagemDef[] = [
  // ── Caixinhas de lenço: uma por lenço comprado ──
  {
    id: "caixa-lenco-scarfme",
    nome: "Caixa de lenço - ScarfMe",
    estoqueInicial: 8280,
    // Guarulhos usa a caixa dela, então não consome esta.
    regra: (ctx) => (ctx.filialId === FILIAL_GRU ? 0 : ctx.qtd.lenco),
    nota: "1 por lenço ScarfMe. Guarulhos usa a caixa própria e fica de fora.",
  },
  {
    id: "caixa-lenco-gru",
    nome: "Caixa de lenço - GRU",
    estoqueInicial: 240,
    regra: (ctx) => (ctx.filialId === FILIAL_GRU ? ctx.qtd.lenco : 0),
    nota: "1 por lenço vendido na loja de Guarulhos.",
  },
  {
    id: "caixa-lenco-tarsila",
    nome: "Caixa de lenço - Tarsila",
    estoqueInicial: 240,
    regra: (ctx) => ctx.qtd.lencoTarsila,
    nota: "1 por lenço da coleção Tarsila do Amaral.",
  },
  {
    id: "caixa-lenco-portinari",
    nome: "Caixa de lenço - Portinari",
    estoqueInicial: 620,
    regra: (ctx) => ctx.qtd.lencoPortinari,
    nota: "1 por lenço da coleção Portinari.",
  },
  {
    id: "caixa-lenco-pantanal",
    nome: "Caixa de lenço - Pantanal",
    estoqueInicial: 600,
    regra: (ctx) => ctx.qtd.lencoPantanal,
    nota: "1 por lenço da coleção Pantanal Vivo.",
  },
  {
    id: "caixa-lenco-essencial",
    nome: "Caixa de lenço - Essencial",
    estoqueInicial: 600,
    regra: (ctx) => ctx.qtd.lencoEssencial,
    nota: "1 por lenço da coleção Essentials.",
  },
  {
    id: "caixa-lenco-essencia-brasileira",
    nome: "Caixa de lenço - Essência Brasileira",
    estoqueInicial: 480,
    regra: (ctx) => ctx.qtd.lencoEssenciaBrasileira,
    nota: "1 por lenço da coleção Brasilidade.",
  },

  // ── Twilly: uma caixinha por twilly ──
  {
    id: "caixa-twilly",
    nome: "Caixa de Twilly",
    estoqueInicial: 4439,
    regra: (ctx) => ctx.qtd.twilly,
    nota: "1 por Twilly ScarfMe.",
  },
  {
    id: "caixa-twilly-tarsila",
    nome: "Caixa de Twilly - Tarsila",
    estoqueInicial: 1260,
    regra: (ctx) => ctx.qtd.twillyTarsila,
    nota: "1 por Twilly da coleção Tarsila do Amaral.",
  },
  {
    id: "caixa-twilly-jardim-surreal",
    nome: "Caixa de Twilly - Jardim Surreal",
    estoqueInicial: 1000,
    regra: (ctx) => ctx.qtd.twillyJardimSurreal,
    nota: "1 por Twilly da coleção Jardim Surreal.",
  },

  // ── Pashmina ──
  {
    id: "caixa-pashmina-scarfme",
    nome: "Caixa de pashmina - ScarfMe",
    estoqueInicial: 3136,
    regra: (ctx) => ctx.qtd.pashminaViscose,
    nota: "1 por pashmina de viscose ou arabesco.",
  },
  {
    id: "caixa-pashmina-tarsila",
    nome: "Caixa de pashmina - Tarsila",
    estoqueInicial: 1260,
    regra: (ctx) => ctx.qtd.pashminaTarsila,
    nota: "1 por pashmina da coleção Tarsila do Amaral.",
    // Não existe produto da coleção Tarsila no grupo PASHMINA do cadastro, então a linha
    // daria zero em todo mês. Fora da tela até se saber a que produto ela corresponde.
    oculta: true,
  },
  {
    id: "fundo-caixa-acrilico",
    nome: "Fundo caixa de acrílico",
    estoqueInicial: 2200,
    regra: (ctx) => ctx.qtd.pashminaLa,
    nota: "1 por pashmina com toque de lã (a caixa é fundo + tampa).",
  },
  {
    id: "tampa-caixa-acrilico",
    nome: "Tampa caixa de acrílico",
    estoqueInicial: 1800,
    regra: (ctx) => ctx.qtd.pashminaLa,
    nota: "1 por pashmina com toque de lã (a caixa é fundo + tampa).",
  },

  // ── Cashmere ──
  {
    id: "caixa-cashmere",
    nome: "Caixa de cashmere",
    estoqueInicial: 1218,
    regra: (ctx) => ctx.qtd.cashmere,
    nota: "1 por Cashmere Baby ou Zari comprado.",
  },

  // ── Fashion: caixa de presente por peça (fundo + tampa) ──
  {
    id: "fundo-caixa-presente-scarfme",
    nome: "Fundo caixa presente - ScarfMe",
    estoqueInicial: 500,
    regra: (ctx) => ctx.qtd.fashion,
    nota: "1 por peça Fashion (a caixa é fundo + tampa).",
  },
  {
    id: "tampa-caixa-presente-scarfme",
    nome: "Tampa caixa presente - ScarfMe",
    estoqueInicial: 500,
    regra: (ctx) => ctx.qtd.fashion,
    nota: "1 por peça Fashion (a caixa é fundo + tampa).",
  },
  {
    id: "fundo-caixa-presente-tarsila",
    nome: "Fundo caixa presente - Tarsila",
    estoqueInicial: 500,
    regra: (ctx) => ctx.qtd.fashionTarsila,
    nota: "1 por peça Fashion da coleção Tarsila do Amaral.",
  },
  {
    id: "tampa-caixa-presente-tarsila",
    nome: "Tampa caixa presente - Tarsila",
    estoqueInicial: 500,
    regra: (ctx) => ctx.qtd.fashionTarsila,
    nota: "1 por peça Fashion da coleção Tarsila do Amaral.",
  },

  // ── Sacolas: uma por compra (a de fim de ano do site é a exceção) ──
  {
    id: "sacola-scarfme-p",
    nome: "Sacola ScarfMe - P",
    estoqueInicial: 1500,
    regra: (ctx) => sacola(ctx, "P"),
    nota: "Compra de 1 ou 2 Twilly.",
  },
  {
    id: "sacola-scarfme-m",
    nome: "Sacola ScarfMe - M",
    estoqueInicial: 8250,
    regra: (ctx) => sacola(ctx, "M"),
    nota: "4 a 6 lenços, ou mais de 2 Twilly. No site e na Oscar Freire, de 1º/nov a 25/dez: 1 por lenço.",
  },
  {
    id: "sacola-scarfme-g",
    nome: "Sacola ScarfMe - G",
    estoqueInicial: 750,
    regra: (ctx) => sacola(ctx, "G"),
    nota: "Compra com Fashion, com Cashmere ou com mais de 6 lenços.",
  },
  {
    id: "sacola-tarsila-m",
    nome: "Sacola Tarsila - M",
    estoqueInicial: 1260,
    regra: (ctx) => umaPorCompra(ctx, ["lencoTarsila", "twillyTarsila"]),
    nota: "1 por compra com lenço ou Twilly Tarsila.",
  },
  {
    id: "sacola-tarsila-g",
    nome: "Sacola Tarsila - G",
    estoqueInicial: 600,
    regra: (ctx) => umaPorCompra(ctx, ["fashionTarsila", "pashminaTarsila"]),
    nota: "1 por compra com Fashion ou pashmina Tarsila.",
  },
  {
    id: "sacola-portinari-m",
    nome: "Sacola Portinari - M",
    estoqueInicial: 600,
    regra: (ctx) => umaPorCompra(ctx, ["lencoPortinari"]),
    nota: "1 por compra com lenço Portinari.",
  },
  {
    id: "sacola-pantanal-m",
    nome: "Sacola Pantanal - M",
    estoqueInicial: 600,
    regra: (ctx) => umaPorCompra(ctx, ["lencoPantanal"]),
    nota: "1 por compra com lenço Pantanal.",
  },

  // ── E-commerce ──
  {
    id: "caixa-ecommerce-correios",
    nome: "Caixa e-commerce - Correios",
    estoqueInicial: 3400,
    regra: (ctx) => (ctx.canal === "site" ? 1 : 0),
    nota: "1 por pedido do site.",
  },

  // ── Caixas gaveta: falta saber que ticket puxa cada uma, então ficam fora da tela ──
  { id: "caixa-gaveta-cg08", nome: "Caixa gaveta - CG08", estoqueInicial: 1520, regra: null, oculta: true },
  { id: "caixa-gaveta-cg32", nome: "Caixa gaveta - CG32", estoqueInicial: 1470, regra: null, oculta: true },
  {
    id: "caixa-gaveta-tarsila",
    nome: "Caixa gaveta - Tarsila",
    estoqueInicial: 936,
    regra: null,
    oculta: true,
  },
];

export const EMBALAGEM_IDS = EMBALAGENS.map((e) => e.id);

/** As que a tela mostra. O estoque das ocultas continua guardado, só não aparece. */
export const EMBALAGENS_VISIVEIS = EMBALAGENS.filter((e) => !e.oculta);

/** Estoque de fábrica (a contagem da planilha), usado enquanto ninguém salvou o seu. */
export function estoqueInicialMap(): Record<string, number> {
  return Object.fromEntries(EMBALAGENS.map((e) => [e.id, e.estoqueInicial]));
}

/**
 * Aviamentos da ScarfMe — etiqueta, tag, lâmina, lacre… — e quanto de cada um o ticket
 * consome.
 *
 * Mesma estrutura da aba Embalagens ([embalagens.ts](@/lib/config/embalagens)): o ticket
 * chega resumido (`ContextoAviamento`) e a `regra` de cada item diz quantas unidades ele
 * gasta. A lista são os produtos do grupo `AVIAMENTOS` do cadastro (código X5.*), e o `id`
 * é o próprio código do produto no Linx.
 *
 * As regras abaixo são a PRIMEIRA leitura, feita pelo nome do item. Item cuja regra não dá
 * para deduzir do nome fica `regra: null` e a tela mostra "sem regra" em vez de projetar
 * um número inventado.
 *
 * Estoque: `estoqueInicial` = 10 em todos, provisório até a contagem real ser digitada na
 * tela (fica salvo em [aviamentos-estoque-store.ts](@/lib/utils/aviamentos-estoque-store)).
 */

/** Canal do pedido: loja física (ticket POS) ou site (nota do e-commerce). */
export type AviamentoCanal = "loja" | "site";

/**
 * Linhas que não são peça da marca: não levam tag nem etiqueta. São as `excludedLines` da
 * ScarfMe em company.ts mais o próprio material de expedição.
 */
export const LINHAS_SEM_PECA = [
  "PRIVATE LABEL",
  "GASTRONOMICA",
  "PERFUMARIA",
  "CASHMERE",
  "ELETRONICOS",
  "EMBALAGENS",
  "CAPAS E ACESSORIOS P/ CEL",
  "AVIAMENTOS",
];

/** Linha das peças com grade de tamanho (as únicas que levam etiqueta de tamanho). */
export const LINHA_FASHION = "FASHION";

/** Um ticket (ou pedido do site) já resumido, do jeito que a regra enxerga. */
export interface ContextoAviamento {
  /** Peças da marca no ticket (tudo menos `LINHAS_SEM_PECA`). */
  pecas: number;
  /** Dessas, quantas são da linha Fashion. */
  pecasFashion: number;
  canal: AviamentoCanal;
}

export interface AviamentoDef {
  /** Código do produto no Linx. */
  id: string;
  nome: string;
  /** Estoque provisório — vale só enquanto ninguém tiver salvo um estoque na tela. */
  estoqueInicial: number;
  /** Quantas unidades o ticket consome. `null` = regra ainda não definida. */
  regra: ((ctx: ContextoAviamento) => number) | null;
  /** Observação que a tela mostra no tooltip da linha. */
  nota?: string;
}

/** Estoque provisório de todo aviamento enquanto ninguém digitou a contagem. */
const ESTOQUE_PROVISORIO = 10;

export const AVIAMENTOS: AviamentoDef[] = [
  // ── Etiquetas ──
  {
    id: "X5.01.0002",
    nome: "Etiqueta de marca - ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecas,
    nota: "1 por peça vendida.",
  },
  {
    id: "X5.03.0004",
    nome: "Etiqueta de composição",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecas,
    nota: "1 por peça vendida.",
  },
  {
    id: "X5.10.0011",
    nome: "Etiqueta de tamanho - ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecasFashion,
    nota: "1 por peça Fashion (as únicas com grade de tamanho).",
  },
  {
    id: "X5.04.0005",
    nome: "Etiqueta de cód. barra",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecas,
    nota: "1 por peça vendida.",
  },
  {
    id: "X5.11.0012",
    nome: "Etiqueta presente - ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => (ctx.pecas > 0 ? 1 : 0),
    nota: "1 por compra.",
  },
  {
    id: "X5.14.0015",
    nome: "Etiqueta remetente",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => (ctx.canal === "site" ? 1 : 0),
    nota: "1 por pedido do site.",
  },
  {
    id: "X5.13.0014",
    nome: "Etiqueta BOP transparente",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Regra a definir.",
  },
  {
    id: "X5.12.0013",
    nome: "Etiqueta presente - NERD",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Item da NERD — a projeção mede a venda ScarfMe.",
  },

  // ── Tag e acabamento ──
  {
    id: "X5.05.0007",
    nome: "Tag ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecas,
    nota: "1 por peça vendida.",
  },
  {
    id: "X5.09.0010",
    nome: "Lacre",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecas,
    nota: "1 por peça vendida (prende a tag).",
  },
  {
    id: "X5.06.0007",
    nome: "Lâmina ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: (ctx) => ctx.pecas,
    nota: "1 por peça vendida.",
  },
  {
    id: "X5.07.0008",
    nome: "Faixa ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Regra a definir.",
  },
  {
    id: "X5.15.0016",
    nome: "Folha de seda ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Regra a definir.",
  },
  {
    id: "X5.08.0009",
    nome: "Botão",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Regra a definir.",
  },
  {
    id: "X5.05.0006",
    nome: "Tag NERD",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Item da NERD — a projeção mede a venda ScarfMe.",
  },
];

export const AVIAMENTO_IDS = AVIAMENTOS.map((a) => a.id);

/** Estoque provisório de cada aviamento, usado enquanto ninguém salvou o seu. */
export function estoqueInicialAviamentos(): Record<string, number> {
  return Object.fromEntries(AVIAMENTOS.map((a) => [a.id, a.estoqueInicial]));
}

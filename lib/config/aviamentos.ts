/**
 * Aviamentos da ScarfMe — etiqueta, tag, lâmina, lacre… — e quanto de cada um uma peça
 * COMPRADA precisa.
 *
 * A necessidade não sai da venda: sai do que foi comprado e ainda não chegou (Compras em
 * trânsito). Cada peça a caminho vai precisar dos seus aviamentos; a que já chegou já tem.
 * A `regra` de cada aviamento recebe UMA linha do trânsito (produto × cor, com o cadastro
 * do produto) e devolve quantas unidades daquele aviamento ela consome.
 *
 * A exceção são os aviamentos gastos NA VENDA (etiqueta presente, remetente, a folha de seda
 * da caixa de presente): esses usam `regraVenda`, que recebe a venda projetada — o ritmo
 * dos últimos `VENDA_JANELA_DIAS` dias esticado pelos próximos `VENDA_HORIZONTE_DIAS`.
 * Um aviamento pode ter as duas regras; a necessidade é a soma.
 *
 * A lista são os produtos do grupo `AVIAMENTOS` do cadastro (código X5.*), e o `id` é o
 * próprio código do produto no Linx.
 *
 * As regras abaixo são a PRIMEIRA leitura, feita pelo nome do item. Item cuja regra não dá
 * para deduzir fica `regra: null` e a tela mostra "sem regra" em vez de um número inventado.
 *
 * Estoque: `estoqueInicial` = 10 em todos, provisório até a contagem real ser digitada na
 * tela (fica salvo em [aviamentos-estoque-store.ts](@/lib/utils/aviamentos-estoque-store)).
 */

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
  // O cadastro também tem a linha no singular.
  "EMBALAGEM",
  "CAPAS E ACESSORIOS P/ CEL",
  "AVIAMENTOS",
];

/** Linha das peças com grade de tamanho (as únicas que levam etiqueta de tamanho). */
export const LINHA_FASHION = "FASHION";

/** Linha Índia (cashmere, robes, mantas…). */
export const LINHA_INDIA = "INDIA";

/**
 * Pashmina é o GRUPO, e ele aparece em várias linhas (PASHMINA, INDIA, LENÇOS…); a linha
 * PASHMINA também conta, para não depender de como cada produto foi cadastrado.
 */
export const GRUPO_PASHMINA = "PASHMINA";

/** Uma linha do trânsito (produto × cor), já com o cadastro do produto. */
export interface ItemComprado {
  produto: string;
  /** Peças a caminho. */
  quantidade: number;
  /** `PRODUTOS.LINHA`, maiúsculas e sem espaço nas pontas ('' = sem cadastro). */
  linha: string;
  /** `PRODUTOS.GRUPO_PRODUTO`, mesmo tratamento. */
  grupo: string;
  /** É peça da marca (fora de `LINHAS_SEM_PECA`). */
  pecaDaMarca: boolean;
  /** É da linha Fashion (tem grade de tamanho). */
  fashion: boolean;
  /** É da linha Índia. */
  india: boolean;
  /** É pashmina (grupo PASHMINA ou linha PASHMINA). */
  pashmina: boolean;
}

/** Janela de venda medida para os aviamentos gastos na venda. */
export const VENDA_JANELA_DIAS = 90;
/** Por quantos dias à frente esse ritmo é projetado. */
export const VENDA_HORIZONTE_DIAS = 90;

/**
 * Venda projetada para os próximos `VENDA_HORIZONTE_DIAS` (lojas + site), já pela regra
 * oficial de venda com trocas (`fetchSalesTotals`).
 */
export interface VendaProjetada {
  /** Vendas (ticket na loja, nota no site). */
  tickets: number;
  /** Peças Fashion vendidas — cada uma sai numa caixa de presente grande. */
  pecasFashion: number;
}

export interface AviamentoDef {
  /** Código do produto no Linx. */
  id: string;
  nome: string;
  /** Estoque provisório — vale só enquanto ninguém tiver salvo um estoque na tela. */
  estoqueInicial: number;
  /**
   * Quantas unidades a linha do trânsito consome. `null` = o aviamento não sai na peça
   * comprada (ou a regra ainda não foi definida, quando `regraVenda` também falta).
   */
  regra: ((item: ItemComprado) => number) | null;
  /** Quantas unidades a venda projetada consome (aviamento gasto na venda). */
  regraVenda?: (venda: VendaProjetada) => number;
  /** Observação que a tela mostra no tooltip da linha. */
  nota?: string;
}

/** Estoque provisório de todo aviamento enquanto ninguém digitou a contagem. */
const ESTOQUE_PROVISORIO = 10;

/** 1 por peça da marca comprada. */
const umPorPeca = (item: ItemComprado) => (item.pecaDaMarca ? item.quantidade : 0);

/** 1 por peça comprada que cumpre a condição (sempre só peça da marca). */
const umPorPecaSe = (condicao: (item: ItemComprado) => boolean) => (item: ItemComprado) =>
  item.pecaDaMarca && condicao(item) ? item.quantidade : 0;

export const AVIAMENTOS: AviamentoDef[] = [
  // ── Etiquetas ──
  {
    id: "X5.01.0002",
    nome: "Etiqueta de marca - ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada.",
  },
  {
    id: "X5.03.0004",
    nome: "Etiqueta de composição",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada.",
  },
  {
    id: "X5.10.0011",
    nome: "Etiqueta de tamanho - ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPecaSe((item) => item.fashion),
    nota: "1 por peça Fashion comprada (as únicas com grade de tamanho).",
  },
  {
    id: "X5.04.0005",
    nome: "Etiqueta de cód. barra",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada.",
  },
  {
    id: "X5.11.0012",
    nome: "Etiqueta presente - ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    regraVenda: (venda) => venda.tickets,
    nota: "Pela venda: 1 por venda (lojas e site), ritmo dos últimos 90 dias × próximos 90.",
  },
  {
    id: "X5.14.0015",
    nome: "Etiqueta remetente",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    regraVenda: (venda) => venda.tickets,
    nota: "Pela venda: 1 por venda (lojas e site), ritmo dos últimos 90 dias × próximos 90.",
  },
  {
    id: "X5.13.0014",
    nome: "Etiqueta BOP transparente",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada (todo produto tem).",
  },
  {
    id: "X5.12.0013",
    nome: "Etiqueta presente - NERD",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Item da NERD — a conta usa as compras ScarfMe.",
  },

  // ── Tag e acabamento ──
  {
    id: "X5.05.0007",
    nome: "Tag ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada.",
  },
  {
    id: "X5.09.0010",
    nome: "Lacre",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada (prende a tag).",
  },
  {
    id: "X5.06.0007",
    nome: "Lâmina ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPeca,
    nota: "1 por peça comprada.",
  },
  {
    id: "X5.07.0008",
    nome: "Faixa ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPecaSe((item) => !item.india && !item.pashmina && !item.fashion),
    nota: "1 por peça comprada, menos Índia, pashminas e Fashion.",
  },
  {
    id: "X5.15.0016",
    nome: "Folha de seda ScarfMe",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPecaSe((item) => item.fashion || item.india || item.pashmina),
    // A caixa de presente grande é a de Fashion: 1 por peça Fashion vendida, a mesma régua
    // das caixas "presente" em embalagens.ts.
    regraVenda: (venda) => venda.pecasFashion,
    nota:
      "1 por peça Fashion, Índia ou pashmina comprada + 1 por caixa de presente grande na venda (peça Fashion vendida, ritmo 90 dias × próximos 90).",
  },
  {
    id: "X5.08.0009",
    nome: "Botão",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: umPorPecaSe((item) => item.fashion),
    nota: "1 por peça Fashion comprada.",
  },
  {
    id: "X5.05.0006",
    nome: "Tag NERD",
    estoqueInicial: ESTOQUE_PROVISORIO,
    regra: null,
    nota: "Item da NERD — a conta usa as compras ScarfMe.",
  },
];

export const AVIAMENTO_IDS = AVIAMENTOS.map((a) => a.id);

/** Estoque provisório de cada aviamento, usado enquanto ninguém salvou o seu. */
export function estoqueInicialAviamentos(): Record<string, number> {
  return Object.fromEntries(AVIAMENTOS.map((a) => [a.id, a.estoqueInicial]));
}

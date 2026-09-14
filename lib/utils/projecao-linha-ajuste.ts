/**
 * A trava da regra **Sazonal da categoria** quando ela é aplicada LINHA A LINHA.
 *
 * Por que este arquivo existe — o defeito é de AGREGAÇÃO, não da regra.
 *
 * Medido em 14/09/2026, rebobinando a tela para 14/09/2025 e comparando com o que a linha
 * LENÇOS de fato vendeu entre 15/09 e 31/12/2025 (989 itens × cor):
 *
 *   - projeção do ESCOPO (uma série só, como o card do topo):  8.535 contra 9.918 → −14%
 *   - SOMA das projeções item a item:                         12.123 contra 9.918 → +22%
 *
 * O mesmo motor, os mesmos fatores, o mesmo horizonte. Medido no escopo inteiro ele acerta;
 * somado item a item ele infla 42%. O culpado é o `primeiroMesComVenda` de
 * [projecao-sazonal.ts](./projecao-sazonal): ele descarta os meses anteriores à primeira
 * venda do ano para não penalizar produto lançado no meio do ano. No ESCOPO o buraco de um
 * item é tapado pelos outros e a série fica inteira; na LINHA, cada item vira "eu só existo
 * desde junho" e três meses de pico de reposição viram o patamar permanente dele — que a
 * curva de Nov/Dez depois multiplica por dois.
 *
 * **O que este módulo NÃO faz: mexer na linha que já estava certa.** A conta atual, medida
 * só nos itens confiáveis (≥12 meses de vida, sem degeneração, participação estável), dá
 * viés +8% e MAE 6,3 — está boa, e trocar o motor dela não melhorava nada (+15% / MAE 6,2).
 * Toda a melhora vinha das linhas sinalizadas. Por isso a correção é CIRÚRGICA: só a linha
 * que dispara um dos dois sinais abaixo troca de conta; o resto sai bit a bit igual.
 *
 *     grupo                  regra atual          com esta trava
 *     saudáveis (509)        +8%  · MAE  6,3      +8%  · MAE  6,3   (intocado)
 *     sinalizados (256)      +99% · MAE 15,2      +5%  · MAE  9,5
 *     todos (980)            +46% · MAE  8,4      +15% · MAE  7,0
 *
 * A conta da linha sinalizada troca de "nível próprio × curva" para PARTICIPAÇÃO na
 * categoria — que é uma razão, e por isso muito mais estável: o estouro de reposição aparece
 * no numerador E no denominador e se cancela em boa parte.
 *
 *     projeção = projeção da CATEGORIA × (50% participação de 3 meses
 *                                       + 50% participação de 12 meses)
 *
 * O encolhimento contra os 12 meses não é enfeite: a participação de 3 meses PURA não
 * resolve o item cuja fatia explodiu (ficava em +57%, igual à regra atual); com o
 * encolhimento cai para +9%.
 *
 * Ver [[projecao-regra-sazonal-categoria]] para a regra que este módulo protege.
 */

import type { MesSerie } from "@/lib/utils/projecao-realista";
import {
  MESES_RECENTES_SAZONAL,
  montarPerfilSazonal,
  projetarHorizonteSazonal,
  type CurvaSazonal,
} from "@/lib/utils/projecao-sazonal";

/**
 * Quantas vezes a participação recente precisa passar da participação longa para a linha
 * ser considerada "em alta". 2× é o corte que separa crescimento de estouro de reposição:
 * dos 980 itens medidos, 69 passavam dele e projetavam +57%.
 */
export const FATOR_PARTICIPACAO_ALTA = 2;

/** Peso da participação RECENTE na mistura. O resto vai para a de 12 meses. */
export const PESO_PARTICIPACAO_RECENTE = 0.5;

/** Meses fechados da janela longa de participação. */
export const MESES_PARTICIPACAO_LONGA = 12;

/** A série da categoria do item, em meses fechados. Índice 1-based; `[0]` não é usado. */
export interface SerieCategoria {
  /** Realizado por mês do ano base. Mês em curso e futuros vêm zerados. */
  base: number[];
  /** Realizado por mês do ano anterior (12 meses cheios). */
  anterior: number[];
}

/** Por que a linha foi sinalizada. Uma linha pode disparar os dois. */
export interface SinaisLinha {
  /**
   * A primeira venda do ANO está dentro dos últimos meses fechados — a janela do "ano
   * corrido" virou a mesma do "agora" e a mistura 50/50 do patamar passou a misturar uma
   * coisa com ela mesma. É o sintoma exato do `primeiroMesComVenda` disparando em item que
   * não é lançamento (154 de 156 itens nesse balde já vendiam antes).
   */
  baseCurta: boolean;
  /**
   * A fatia do item na categoria nos últimos 3 meses passou de `FATOR_PARTICIPACAO_ALTA`
   * vezes a fatia dos últimos 12. É o item que voltou de reposição e está sendo lido como
   * se o pico fosse o novo normal.
   */
  participacaoEmAlta: boolean;
}

export interface AjusteLinha {
  sinais: SinaisLinha;
  /** Disparou pelo menos um sinal. */
  sinalizada: boolean;
  /** A conta trocou de fato (sinalizada E com base da categoria para trocar). */
  aplicado: boolean;
  /** O que a regra sazonal devolveria sem esta trava. */
  necessidadeOriginal: number;
  /** O que a linha passa a projetar. Igual à original quando `aplicado` é false. */
  necessidade: number;
  /** Projeção da CATEGORIA no mesmo horizonte (a base da divisão). */
  projecaoCategoria: number;
  participacaoRecente: number;
  participacaoLonga: number;
  /** A mistura das duas — a fatia efetivamente aplicada. */
  participacaoAplicada: number;
  /** Unidades do item e da categoria em cada janela (o tooltip abre isso). */
  itemRecente: number;
  itemLongo: number;
  categoriaRecente: number;
  categoriaLonga: number;
  ultimoMesReal: number;
  primeiroMesComVenda: number;
}

/** Soma `meses[de..ate]` com piso 0 — linha negativa (mais troca que venda) não vira crédito. */
function somar(meses: number[], de: number, ate: number): number {
  let total = 0;
  for (let m = Math.max(1, de); m <= Math.min(12, ate); m += 1) {
    total += Math.max(0, Number(meses[m]) || 0);
  }
  return total;
}

/**
 * Os últimos 12 meses fechados, que ATRAVESSAM a virada do ano: meses `1..ultimo` do ano
 * base mais `ultimo+1..12` do ano anterior. É de propósito que a janela não respeite o ano
 * calendário — a pergunta "qual o tamanho deste item" não tem nada a ver com 1º de janeiro,
 * e no começo do ano a janela do calendário teria dois meses de amostra.
 */
function janelaLonga(base: number[], anterior: number[], ultimo: number): number {
  return somar(base, 1, ultimo) + somar(anterior, ultimo + 1, 12);
}

/** Extrai o realizado mensal (1-based) de uma série, contando SÓ mês fechado. */
function realizadoFechado(serie: MesSerie[]): { base: number[]; anterior: number[]; ultimo: number } {
  const base = new Array<number>(13).fill(0);
  const anterior = new Array<number>(13).fill(0);
  let ultimo = 0;
  serie.forEach((m) => {
    const mes = Number(m.mes.slice(5, 7));
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) return;
    // O ano anterior é sempre CHEIO: ele não tem mês parcial nem futuro nesta janela.
    anterior[mes] = Number(m.qtdeAnoAnterior) || 0;
    if (m.futuro || m.parcial) return;
    base[mes] = Number(m.qtde) || 0;
    if (mes > ultimo) ultimo = mes;
  });
  return { base, anterior, ultimo };
}

/** Monta a série da categoria no formato que `montarPerfilSazonal` consome. */
function serieDaCategoria(cat: SerieCategoria, dataBase: string): MesSerie[] {
  const ano = Number(dataBase.slice(0, 4));
  const mesBase = Number(dataBase.slice(5, 7));
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    return {
      mes: `${ano}-${String(mes).padStart(2, "0")}`,
      qtde: Math.max(0, Number(cat.base[mes]) || 0),
      qtdeAnoAnterior: Math.max(0, Number(cat.anterior[mes]) || 0),
      parcial: mes === mesBase,
      futuro: mes > mesBase,
    };
  });
}

/**
 * Avalia UMA linha da tabela item a item: ela está apoiada em base curta demais? A fatia
 * dela na categoria explodiu? E, se sim, quanto a conta por participação devolve no lugar.
 *
 * Devolve `null` quando não há nem um mês fechado para olhar — aí não há o que sinalizar.
 * Quando a categoria não veio (`serieCategoria` nula), os sinais que dependem só do item
 * continuam valendo e `aplicado` fica false: a tela AVISA sem trocar o número, que é o
 * comportamento certo para não inventar conta sem base.
 */
export function avaliarAjusteLinha(params: {
  serieItem: MesSerie[];
  serieCategoria: SerieCategoria | null | undefined;
  curva: CurvaSazonal;
  dataBase: string;
  diasHorizonte: number;
  /** O que a regra sazonal projetou para esta linha sem a trava. */
  necessidadeOriginal: number;
}): AjusteLinha | null {
  const { serieItem, serieCategoria, curva, dataBase, diasHorizonte, necessidadeOriginal } = params;
  const item = realizadoFechado(serieItem);
  if (item.ultimo < 1) return null;

  let primeiroMesComVenda = 0;
  for (let m = 1; m <= item.ultimo; m += 1) {
    if (item.base[m] > 0) {
      primeiroMesComVenda = m;
      break;
    }
  }
  if (primeiroMesComVenda === 0) return null;

  const inicioRecente = Math.max(1, item.ultimo - MESES_RECENTES_SAZONAL + 1);
  const itemRecente = somar(item.base, inicioRecente, item.ultimo);
  const itemLongo = janelaLonga(item.base, item.anterior, item.ultimo);

  // A degeneração da mistura 50/50: `mesesAno` e `mesesRecentes` viram a mesma lista.
  const baseCurta = primeiroMesComVenda >= inicioRecente;

  const categoriaRecente = serieCategoria
    ? somar(serieCategoria.base, inicioRecente, item.ultimo)
    : 0;
  const categoriaLonga = serieCategoria
    ? janelaLonga(serieCategoria.base, serieCategoria.anterior, item.ultimo)
    : 0;
  const participacaoRecente = categoriaRecente > 0 ? itemRecente / categoriaRecente : 0;
  const participacaoLonga = categoriaLonga > 0 ? itemLongo / categoriaLonga : 0;
  const participacaoEmAlta =
    participacaoLonga > 0 && participacaoRecente > FATOR_PARTICIPACAO_ALTA * participacaoLonga;

  const sinalizada = baseCurta || participacaoEmAlta;
  const participacaoAplicada =
    PESO_PARTICIPACAO_RECENTE * participacaoRecente +
    (1 - PESO_PARTICIPACAO_RECENTE) * participacaoLonga;

  let projecaoCategoria = 0;
  if (serieCategoria && categoriaRecente + categoriaLonga > 0) {
    const perfil = montarPerfilSazonal(serieDaCategoria(serieCategoria, dataBase), curva);
    projecaoCategoria = projetarHorizonteSazonal(perfil, curva, dataBase, diasHorizonte);
  }

  const aplicado = sinalizada && projecaoCategoria > 0 && participacaoAplicada > 0;

  return {
    sinais: { baseCurta, participacaoEmAlta },
    sinalizada,
    aplicado,
    necessidadeOriginal,
    necessidade: aplicado ? projecaoCategoria * participacaoAplicada : necessidadeOriginal,
    projecaoCategoria,
    participacaoRecente,
    participacaoLonga,
    participacaoAplicada,
    itemRecente,
    itemLongo,
    categoriaRecente,
    categoriaLonga,
    ultimoMesReal: item.ultimo,
    primeiroMesComVenda,
  };
}

/** Rótulo curto do motivo, para o selo da célula. */
export function rotuloAjuste(sinais: SinaisLinha): string {
  if (sinais.baseCurta && sinais.participacaoEmAlta) return "base curta + fatia em alta";
  if (sinais.baseCurta) return "base curta";
  return "fatia em alta";
}

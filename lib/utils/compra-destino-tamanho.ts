import {
  compareFilialDisplayOrder,
  getFilialLabelForDisplay,
  normalizeFilialLookupKey,
  resolveCompany,
  type CompanyKey,
} from "@/lib/config/company";
import type { DestinoCompraFinalParte } from "@/lib/utils/compra-final-destino";
import type { TamanhoGrade } from "@/lib/utils/grade-tamanhos";

/**
 * Distribuição por tamanho das peças fashion (grade com P, M ou G).
 *
 * Regra do dono, nesta ordem:
 *  1. Peça fashion só vai para OSCAR FREIRE, E-COMMERCE, GUARULHOS e GALEÃO RJ.
 *  2. **Mínimo por tamanho**: cada loja precisa ter pelo menos 1 de cada tamanho — 3 em
 *     Oscar. Quem tem P mas não tem M e G recebe M e G; quem já tem o mínimo em tudo não
 *     recebe nada nessa etapa.
 *  3. **Só depois** a sobra vai por performance (compra ideal), e dentro da loja cai no
 *     tamanho mais descoberto.
 *
 * A quantidade da compra é o teto: a função reparte exatamente `qtdTotal`, nunca inventa
 * peça a mais. Se a quantidade não cobre todos os mínimos, atende primeiro quem está mais
 * descoberto.
 *
 * ## Grade fechada (regra do dono)
 *
 * Peça fashion é comprada em **grade fechada**: a quantidade vem em múltiplos do número de
 * tamanhos da grade, com a MESMA quantidade em cada tamanho. Em P/M/G o mínimo são 6 peças
 * (2 P + 2 M + 2 G) e o passo seguinte é 9 (3+3+3) — nunca 3 P e 1 G. Então o total de cada
 * tamanho é **cota fechada**, calculada antes de distribuir: `qtdTotal ÷ nº de tamanhos`.
 * Quando a quantidade não fecha grade (7 numa P/M/G), o resto vai para os tamanhos mais
 * descobertos, uma peça em cada — e `fechaGrade` volta `false` para a tela avisar.
 *
 * A cota pode ser travada à mão por tamanho via `qtdPorOrdinal` (o comprador editou o P):
 * aí o tamanho travado vale exatamente aquilo e os tamanhos livres dividem o que sobra do
 * total. As duas etapas de distribuição (mínimo e performance) só escolhem QUEM recebe
 * dentro de cada cota — nunca mudam o quanto cada tamanho leva.
 */

/** Lojas que podem receber peça fashion (rótulos de exibição do registry). */
export const LOJAS_FASHION = ["OSCAR FREIRE", "E-COMMERCE", "GUARULHOS", "GALEÃO RJ"] as const;

/** Mínimo por tamanho em cada loja. Oscar segura grade cheia; as outras, 1 de cada. */
const MINIMO_PADRAO = 1;
const MINIMO_POR_LOJA: Record<string, number> = { "OSCAR FREIRE": 3 };

export function minimoPorTamanho(lojaLabel: string): number {
  return MINIMO_POR_LOJA[lojaLabel.trim().toUpperCase()] ?? MINIMO_PADRAO;
}

export interface LinhaTamanhoDestino {
  /** Rótulo do tamanho: "P", "M", "G"... */
  label: string;
  ordinal: number;
  /** Quantidade desta linha — soma exata dos destinos abaixo. */
  qtd: number;
  partes: DestinoCompraFinalParte[];
  /** Quanto desta linha veio da regra de mínimo (o resto é performance). */
  qtdMinimo: number;
  /** `grade` = cota da grade fechada; `manual` = cota travada pelo comprador. */
  origemQtd: "grade" | "manual";
}

export interface DistribuicaoPorTamanho {
  linhas: LinhaTamanhoDestino[];
  /** Total repartido — igual a `qtdTotal` salvo quando há cota manual acima do total. */
  qtdDistribuida: number;
  /** Soma dos mínimos que ainda faltam nas 4 lojas, ignorando a quantidade comprada. */
  faltaTotalMinimos: number;
  /** Nº de tamanhos da grade — o módulo da grade fechada (3 em P/M/G). */
  tamanhosNaGrade: number;
  /** `true` quando a quantidade fecha grade: múltiplo do nº de tamanhos e nenhuma trava manual. */
  fechaGrade: boolean;
  /** `true` quando algum tamanho está com a cota travada à mão. */
  temTravaManual: boolean;
}

interface Celula {
  loja: string;
  ordinal: number;
  label: string;
  /** Estoque atual da loja neste tamanho (negativo já tratado como 0). */
  estoque: number;
  falta: number;
  alocadoMinimo: number;
  alocadoExtra: number;
}

function estoqueUtil(valor: number): number {
  // Negativo nunca conta — quem tem -2 no P precisa do mínimo inteiro. Mesma regra do
  // resto do app (estoque = só saldo positivo).
  return Math.max(0, valor);
}

/**
 * Agrega o estoque por tamanho nos rótulos de exibição, somando os CNPJs de um grupo
 * (E-COMMERCE é 5 filiais no banco) e jogando fora as lojas que não recebem fashion.
 */
function agregarEstoqueNasLojasFashion(
  estoquePorFilial: Array<{ filial: string; porTamanho: number[] }>,
  tamanhos: TamanhoGrade[],
  companyKey: CompanyKey
): Map<string, number[]> {
  const cfg = resolveCompany(companyKey);
  const permitidas = new Set(LOJAS_FASHION.map((l) => normalizeFilialLookupKey(l)));
  const mapa = new Map<string, number[]>();

  // Toda loja fashion entra na conta, mesmo sem registro de estoque: "loja que não tem o
  // item" é justamente o caso que a regra existe para resolver.
  for (const loja of LOJAS_FASHION) {
    mapa.set(loja, tamanhos.map(() => 0));
  }

  for (const row of estoquePorFilial) {
    const label = getFilialLabelForDisplay(cfg, row.filial);
    if (!permitidas.has(normalizeFilialLookupKey(label))) continue;
    const alvo = mapa.get(label) ?? tamanhos.map(() => 0);
    tamanhos.forEach((_, idx) => {
      alvo[idx] = (alvo[idx] ?? 0) + Number(row.porTamanho[idx] ?? 0);
    });
    mapa.set(label, alvo);
  }

  return mapa;
}

/** Peso de demanda por loja — mesma fórmula da distribuição agregada (12m com ajuste 60d). */
function demandaPorLoja(
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>,
  companyKey: CompanyKey
): Map<string, number> {
  const cfg = resolveCompany(companyKey);
  const permitidas = new Set(LOJAS_FASHION.map((l) => normalizeFilialLookupKey(l)));
  const acumulado = new Map<string, { m12: number; d60: number }>();

  for (const row of vendasPorFilial) {
    const label = getFilialLabelForDisplay(cfg, row.filial);
    if (!permitidas.has(normalizeFilialLookupKey(label))) continue;
    const prev = acumulado.get(label) ?? { m12: 0, d60: 0 };
    acumulado.set(label, {
      m12: prev.m12 + Number(row.qtde12m ?? 0),
      d60: prev.d60 + Number(row.qtde60d ?? 0),
    });
  }

  const demandas = new Map<string, number>();
  for (const loja of LOJAS_FASHION) {
    const { m12, d60 } = acumulado.get(loja) ?? { m12: 0, d60: 0 };
    const mensal = m12 / 12;
    if (mensal <= 0) {
      demandas.set(loja, 0);
      continue;
    }
    const peso = d60 / (mensal * 2);
    demandas.set(loja, mensal * (0.5 + 0.5 * peso));
  }
  return demandas;
}

export function distribuirPorTamanho(input: {
  qtdTotal: number;
  tamanhos: TamanhoGrade[];
  estoquePorFilial: Array<{ filial: string; porTamanho: number[] }>;
  vendasPorFilial: Array<{ filial: string; qtde12m: number; qtde60d?: number }>;
  companyKey: CompanyKey;
  /**
   * Cota travada a mao, por ordinal da grade (o comprador digitou a quantidade do P).
   * O que nao esta aqui divide o que sobra de `qtdTotal` em grade fechada.
   */
  qtdPorOrdinal?: Record<number, number>;
}): DistribuicaoPorTamanho | null {
  const { qtdTotal, tamanhos, estoquePorFilial, vendasPorFilial, companyKey, qtdPorOrdinal } = input;
  if (tamanhos.length === 0) return null;

  const cfg = resolveCompany(companyKey);
  const estoque = agregarEstoqueNasLojasFashion(estoquePorFilial, tamanhos, companyKey);
  const demandas = demandaPorLoja(vendasPorFilial, companyKey);

  const celulas: Celula[] = [];
  for (const loja of LOJAS_FASHION) {
    const minimo = minimoPorTamanho(loja);
    const doLoja = estoque.get(loja) ?? tamanhos.map(() => 0);
    tamanhos.forEach((tam, idx) => {
      const atual = estoqueUtil(Number(doLoja[idx] ?? 0));
      celulas.push({
        loja,
        ordinal: tam.ordinal,
        label: tam.label,
        estoque: atual,
        falta: Math.max(0, minimo - atual),
        alocadoMinimo: 0,
        alocadoExtra: 0,
      });
    });
  }

  const faltaTotalMinimos = celulas.reduce((s, c) => s + c.falta, 0);

  // ── Cota fechada por tamanho ──
  // Antes de escolher lojas, decide QUANTO cada tamanho leva. Peca fashion vem em grade
  // fechada: a mesma quantidade em cada tamanho (6 numa P/M/G = 2+2+2, 9 = 3+3+3, nunca
  // 3 P e 1 G). Tamanho travado a mao vale exatamente o que o comprador digitou; os livres
  // dividem o que sobra do total.
  const travadas = new Map<number, number>();
  for (const tam of tamanhos) {
    const bruto = qtdPorOrdinal?.[tam.ordinal];
    if (bruto === undefined || bruto === null || !Number.isFinite(Number(bruto))) continue;
    travadas.set(tam.ordinal, Math.max(0, Math.round(Number(bruto))));
  }
  const temTravaManual = travadas.size > 0;
  const somaTravada = [...travadas.values()].reduce((soma, v) => soma + v, 0);
  const pot = Math.max(0, Math.round(qtdTotal));
  const livres = tamanhos.filter((t) => !travadas.has(t.ordinal));
  // Trava acima do total ganha do total: quem digitou 4 no P quer 4 no P.
  const paraLivres = Math.max(0, pot - somaTravada);

  // Descoberto de cada tamanho — decide quem leva o resto quando a quantidade nao fecha grade.
  const descobertoPorOrdinal = new Map<number, { falta: number; estoque: number }>();
  for (const tam of tamanhos) {
    const doTam = celulas.filter((c) => c.ordinal === tam.ordinal);
    descobertoPorOrdinal.set(tam.ordinal, {
      falta: doTam.reduce((soma, c) => soma + c.falta, 0),
      estoque: doTam.reduce((soma, c) => soma + c.estoque, 0),
    });
  }

  const cotaPorTamanho = new Map<number, number>(travadas);
  if (livres.length > 0) {
    const base = Math.floor(paraLivres / livres.length);
    const resto = paraLivres - base * livres.length;
    const ordemResto = [...livres].sort((a, b) => {
      const da = descobertoPorOrdinal.get(a.ordinal) ?? { falta: 0, estoque: 0 };
      const db = descobertoPorOrdinal.get(b.ordinal) ?? { falta: 0, estoque: 0 };
      if (da.falta !== db.falta) return db.falta - da.falta;
      if (da.estoque !== db.estoque) return da.estoque - db.estoque;
      return a.ordinal - b.ordinal;
    });
    const ganhamResto = new Set(ordemResto.slice(0, resto).map((t) => t.ordinal));
    for (const tam of livres) {
      cotaPorTamanho.set(tam.ordinal, base + (ganhamResto.has(tam.ordinal) ? 1 : 0));
    }
  }

  const totalACobrir = [...cotaPorTamanho.values()].reduce((soma, v) => soma + v, 0);
  const fechaGrade = !temTravaManual && pot % tamanhos.length === 0;
  /** Quanto ainda cabe neste tamanho — nenhuma etapa passa da cota fechada. */
  const cabeNoTamanho = (ordinal: number) => {
    const cota = cotaPorTamanho.get(ordinal) ?? 0;
    const usado = celulas
      .filter((c) => c.ordinal === ordinal)
      .reduce((soma, c) => soma + c.alocadoMinimo + c.alocadoExtra, 0);
    return Math.max(0, cota - usado);
  };

  // ── 1ª etapa: cobrir os mínimos, em rodadas ──
  // Uma peça por vez, sempre para quem recebeu menos até agora: primeiro 1 em cada buraco,
  // só depois a 2ª e a 3ª de Oscar. É o "manter 1 mínimo" — se a quantidade não cobre tudo,
  // 3 lojas com 1 peça vale mais que uma loja com a grade cheia e as outras zeradas.
  let restante = totalACobrir;
  const desempate = (a: Celula, b: Celula) => {
    if (a.alocadoMinimo !== b.alocadoMinimo) return a.alocadoMinimo - b.alocadoMinimo;
    const faltaA = a.falta - a.alocadoMinimo;
    const faltaB = b.falta - b.alocadoMinimo;
    if (faltaA !== faltaB) return faltaB - faltaA;
    const demA = demandas.get(a.loja) ?? 0;
    const demB = demandas.get(b.loja) ?? 0;
    if (demA !== demB) return demB - demA;
    const ordem = compareFilialDisplayOrder(a.loja, b.loja, cfg);
    if (ordem !== 0) return ordem;
    return a.ordinal - b.ordinal;
  };

  while (restante > 0) {
    const candidatas = celulas.filter((c) => c.alocadoMinimo < c.falta && cabeNoTamanho(c.ordinal) > 0);
    if (candidatas.length === 0) break;
    candidatas.sort(desempate);
    candidatas[0].alocadoMinimo += 1;
    restante -= 1;
  }

  // ── 2ª etapa: sobra por performance (compra ideal) ──
  // A loja é escolhida pela demanda; dentro da loja, a peça cai no tamanho que ficaria
  // mais descoberto. Não usa histórico de venda POR TAMANHO — só por loja.
  if (restante > 0) {
    const somaDemanda = LOJAS_FASHION.reduce((s, loja) => s + (demandas.get(loja) ?? 0), 0);

    const cotasLoja = new Map<string, number>();
    if (somaDemanda > 0) {
      const exatos = LOJAS_FASHION.map((loja) => {
        const exato = (restante * (demandas.get(loja) ?? 0)) / somaDemanda;
        return { loja, piso: Math.floor(exato), resto: exato - Math.floor(exato) };
      });
      const somaPisos = exatos.reduce((s, e) => s + e.piso, 0);
      const sobra = restante - somaPisos;
      const boost = new Set(
        [...exatos].sort((a, b) => b.resto - a.resto).slice(0, sobra).map((e) => e.loja)
      );
      for (const e of exatos) cotasLoja.set(e.loja, e.piso + (boost.has(e.loja) ? 1 : 0));
    } else {
      // Sem histórico de venda em nenhuma das 4: espalha parelho pelo mais descoberto.
      let sobrando = restante;
      let i = 0;
      for (const loja of LOJAS_FASHION) cotasLoja.set(loja, 0);
      while (sobrando > 0) {
        const loja = LOJAS_FASHION[i % LOJAS_FASHION.length];
        cotasLoja.set(loja, (cotasLoja.get(loja) ?? 0) + 1);
        sobrando -= 1;
        i += 1;
      }
    }

    // Uma peca por vez, sempre dentro da cota fechada do tamanho: a loja que ainda tem
    // cota entra na frente e a peca cai no tamanho mais descoberto dela. Se o tamanho que
    // essa loja precisava ja fechou a cota, a peca vai para outra loja em vez de estourar
    // a grade — e por isso nenhum tamanho termina com 3 quando o maximo era 2.
    while (restante > 0) {
      const comEspaco = celulas.filter((c) => cabeNoTamanho(c.ordinal) > 0);
      if (comEspaco.length === 0) break;
      const comCota = comEspaco.filter((c) => (cotasLoja.get(c.loja) ?? 0) > 0);
      const pool = comCota.length > 0 ? comCota : comEspaco;
      pool.sort((a, b) => {
        const projA = a.estoque + a.alocadoMinimo + a.alocadoExtra;
        const projB = b.estoque + b.alocadoMinimo + b.alocadoExtra;
        if (projA !== projB) return projA - projB;
        const demA = demandas.get(a.loja) ?? 0;
        const demB = demandas.get(b.loja) ?? 0;
        if (demA !== demB) return demB - demA;
        const ordem = compareFilialDisplayOrder(a.loja, b.loja, cfg);
        if (ordem !== 0) return ordem;
        return a.ordinal - b.ordinal;
      });
      const alvo = pool[0];
      alvo.alocadoExtra += 1;
      cotasLoja.set(alvo.loja, Math.max(0, (cotasLoja.get(alvo.loja) ?? 0) - 1));
      restante -= 1;
    }
  }

  // ── Monta uma linha por tamanho ──
  const linhas: LinhaTamanhoDestino[] = tamanhos.map((tam) => {
    const doTamanho = celulas.filter((c) => c.ordinal === tam.ordinal);
    const partes: DestinoCompraFinalParte[] = doTamanho
      .map((c) => ({
        label: c.loja,
        qtd: c.alocadoMinimo + c.alocadoExtra,
        isNM: c.alocadoMinimo > 0 || undefined,
        nmQty: c.alocadoMinimo > 0 ? c.alocadoMinimo : undefined,
      }))
      .filter((p) => p.qtd > 0)
      .sort((a, b) => compareFilialDisplayOrder(a.label, b.label, cfg));

    return {
      label: tam.label,
      ordinal: tam.ordinal,
      qtd: partes.reduce((s, p) => s + p.qtd, 0),
      qtdMinimo: doTamanho.reduce((s, c) => s + c.alocadoMinimo, 0),
      origemQtd: travadas.has(tam.ordinal) ? "manual" : "grade",
      partes,
    };
  });

  return {
    linhas,
    qtdDistribuida: linhas.reduce((s, l) => s + l.qtd, 0),
    faltaTotalMinimos,
    tamanhosNaGrade: tamanhos.length,
    fechaGrade,
    temTravaManual,
  };
}

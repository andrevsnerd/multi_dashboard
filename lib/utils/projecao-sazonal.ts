/**
 * Motor da regra **Sazonal da categoria** da Projeção Compra.
 *
 * Existe porque as duas réguas que já havia erram justamente onde mais dói — o fim do ano:
 *
 *   - `realista` projeta `mês do ano anterior × índice YoY`. Se o ano anterior teve um
 *     Nov/Dez fraco (acontece: 2025 do CETIM DE SEDA 90X90 fechou Nov/Dez praticamente no
 *     nível do mês médio), a projeção herda o mês fraco e manda comprar de menos bem na
 *     virada. A sazonalidade vem de UMA amostra por mês.
 *   - as regras de janela (30/60/90/120/365) esticam o ritmo em linha reta: não têm
 *     sazonalidade nenhuma, e Dezembro sai igual a Fevereiro.
 *
 * Aqui a conta é separada em duas perguntas independentes, e cada uma é respondida onde há
 * amostra para respondê-la:
 *
 *   1. **QUANTO** o escopo está entregando — o PATAMAR — sai do próprio escopo, medido no
 *      ano corrente. É "a média que ele veio fazendo esse ano" equilibrada com "o quanto
 *      ele vem fazendo agora".
 *   2. **QUANDO** esse volume aparece — a CURVA — sai da CATEGORIA (subgrupo/linha/grupo)
 *      inteira e de vários anos completos. É a única base grande o bastante para dizer que
 *      Novembro e Dezembro crescem, e quanto.
 *
 *       nível[m]  = realizado[m] ÷ fator[m]          (só meses FECHADOS do ano base)
 *       patamar   = 50% × média(nível, ano corrido) + 50% × média(nível, últimos 3 fechados)
 *       projeção[m] = patamar × fator[m]
 *
 * O `nível` é o realizado LIMPO da sazonalidade: dividir Agosto (mês fraco) pelo fator de
 * Agosto devolve quanto aquele mês valeria num mês médio. Sem esse passo a média de Jan–Ago
 * — que é um trecho estruturalmente fraco do ano — seria lida como o patamar do ano inteiro
 * e subestimaria tudo o que vem depois de Outubro.
 *
 * **O crescimento contra o ano passado NÃO é multiplicado aqui, de propósito.** O patamar já
 * é medido nas vendas DESTE ano; aplicar por cima um índice YoY (que compara este ano com o
 * anterior) contaria o mesmo crescimento duas vezes. O YoY continua sendo calculado e
 * exibido — é a resposta de "quanto ele cresce em relação ao ano passado" —, só não entra
 * como multiplicador.
 *
 * Ver [[projecao-indice-yoy-curva-ano-anterior]] para a regra `realista`, que é outra conta.
 */

import type { MesSerie } from "@/lib/utils/projecao-realista";

/** Peso do trecho recente no patamar (o resto vai para o ano corrido). */
export const PESO_RECENTE_SAZONAL = 0.5;
/** Quantos meses fechados formam o trecho "agora". */
export const MESES_RECENTES_SAZONAL = 3;
/**
 * Trava do fator de UM ano antes de entrar na média. Um mês que dobrou por causa de uma
 * venda corporativa única não pode virar a sazonalidade da categoria.
 */
export const FATOR_ANO_MIN = 0.2;
export const FATOR_ANO_MAX = 4;
/** Volume mínimo de um ano para ele valer como amostra de curva (≈1 peça/mês). */
export const MIN_VOLUME_ANO_CURVA = 12;
/** Quantos anos completos a curva olha, do mais recente para trás. */
export const ANOS_CURVA = 3;
/**
 * Peso de cada ano na curva, do mais recente para o mais antigo. O ano passado pesa mais
 * (o mix de produto e o tamanho da rede mudaram), mas os anteriores seguram o resultado
 * quando o ano passado foi atípico — que é exatamente o caso que motivou esta regra.
 */
export const PESOS_ANOS_CURVA = [3, 2, 1];

/** A série de UM ano-calendário da categoria: 12 meses fechados. */
export interface AnoCategoria {
  ano: number;
  /** 1-based: `meses[1]` é janeiro. Índice 0 não é usado. */
  meses: number[];
}

/** Como um ano contribuiu para a curva — é o que a tela abre para o usuário conferir. */
export interface AnoDaCurva {
  ano: number;
  total: number;
  /** Fatores daquele ano isolado (1-based), já travados. */
  fatores: number[];
  peso: number;
  /** Entrou na curva? Ano sem volume mínimo fica de fora. */
  usado: boolean;
}

export interface CurvaSazonal {
  /** Identificação da categoria (SUBGRUPO, LINHA ou GRUPO — o que o item tiver). */
  chave: string;
  /** Fator de cada mês (1-based). Média 1: 1,45 = 45% acima do mês médio. */
  fatores: number[];
  anos: AnoDaCurva[];
  /** Quantos anos completos entraram. Zero = curva neutra (tudo 1). */
  anosUsados: number;
  /** Volume somado dos anos usados — o tamanho da amostra. */
  volumeBase: number;
  /**
   * A curva tem base para ser levada a sério: pelo menos 2 anos completos. Com um ano só
   * ela ainda é usada (é melhor que fator 1), mas a tela avisa.
   */
  confiavel: boolean;
}

/** Curva neutra: usada quando a categoria não tem nenhum ano completo com volume. */
export function curvaNeutra(chave: string): CurvaSazonal {
  return {
    chave,
    fatores: new Array<number>(13).fill(1),
    anos: [],
    anosUsados: 0,
    volumeBase: 0,
    confiavel: false,
  };
}

function travar(valor: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, valor));
}

/**
 * Curva sazonal da categoria a partir dos anos-calendário completos.
 *
 * Cada ano é normalizado SOZINHO (mês ÷ média mensal daquele ano) antes de entrar na média
 * ponderada. É isso que separa sazonalidade de crescimento: um ano que vendeu o dobro do
 * anterior entra com a mesma forma, não com o dobro do peso em cada mês.
 *
 * No fim a curva é renormalizada para somar exatamente 12 — a ponderação e as travas
 * desviam a média de 1, e sem esse ajuste o patamar sairia sistematicamente torto.
 */
export function montarCurvaSazonal(chave: string, anos: AnoCategoria[]): CurvaSazonal {
  const ordenados = [...anos].sort((a, b) => b.ano - a.ano).slice(0, ANOS_CURVA);
  const detalhe: AnoDaCurva[] = [];
  const soma = new Array<number>(13).fill(0);
  let pesoTotal = 0;
  let volumeBase = 0;

  ordenados.forEach((entrada, ordem) => {
    const meses = entrada.meses;
    let total = 0;
    for (let m = 1; m <= 12; m += 1) total += Math.max(0, Number(meses[m]) || 0);
    const media = total / 12;
    const usado = total >= MIN_VOLUME_ANO_CURVA && media > 0;
    const peso = PESOS_ANOS_CURVA[ordem] ?? 1;
    const fatores = new Array<number>(13).fill(1);
    if (usado) {
      for (let m = 1; m <= 12; m += 1) {
        fatores[m] = travar(Math.max(0, Number(meses[m]) || 0) / media, FATOR_ANO_MIN, FATOR_ANO_MAX);
      }
      for (let m = 1; m <= 12; m += 1) soma[m] += fatores[m] * peso;
      pesoTotal += peso;
      volumeBase += total;
    }
    detalhe.push({ ano: entrada.ano, total, fatores, peso, usado });
  });

  if (pesoTotal === 0) {
    const neutra = curvaNeutra(chave);
    return { ...neutra, anos: detalhe };
  }

  const fatores = new Array<number>(13).fill(1);
  let somaFatores = 0;
  for (let m = 1; m <= 12; m += 1) {
    fatores[m] = soma[m] / pesoTotal;
    somaFatores += fatores[m];
  }
  // Renormaliza para média exatamente 1 (soma 12).
  if (somaFatores > 0) {
    const ajuste = 12 / somaFatores;
    for (let m = 1; m <= 12; m += 1) fatores[m] *= ajuste;
  }

  const anosUsados = detalhe.filter((a) => a.usado).length;
  return {
    chave,
    fatores,
    anos: detalhe,
    anosUsados,
    volumeBase,
    confiavel: anosUsados >= 2,
  };
}

export interface PerfilSazonal {
  /** Último mês FECHADO do ano base. 0 = nada fechou ainda. */
  ultimoMesReal: number;
  /** Primeiro mês fechado com venda — antes disso o escopo não existia. */
  primeiroMesComVenda: number;
  /** Meses fechados que entraram no patamar do ano (1-based). */
  mesesAno: number[];
  /** Meses fechados do trecho "agora". */
  mesesRecentes: number[];
  /** Realizado por mês do ano base (1-based). */
  reais: number[];
  /** Realizado dessazonalizado (`realizado ÷ fator`), 1-based. */
  niveis: number[];
  /** Média do nível no ano corrido. */
  patamarAno: number;
  /** Média do nível nos últimos meses fechados. */
  patamarRecente: number;
  /** O patamar aplicado: mistura dos dois acima. */
  patamar: number;
  /** Teve venda nos últimos meses fechados. Escopo parado projeta 0. */
  ativa: boolean;
}

/** Perfil vazio — usado quando ainda não há nenhum mês fechado. */
const PERFIL_SAZONAL_VAZIO: PerfilSazonal = {
  ultimoMesReal: 0,
  primeiroMesComVenda: 0,
  mesesAno: [],
  mesesRecentes: [],
  reais: new Array<number>(13).fill(0),
  niveis: new Array<number>(13).fill(0),
  patamarAno: 0,
  patamarRecente: 0,
  patamar: 0,
  ativa: false,
};

/**
 * Mede o patamar do escopo com a sazonalidade da categoria descontada.
 *
 * Os meses ANTERIORES à primeira venda ficam de fora do ano corrido: produto lançado em maio
 * tem Jan–Abr iguais a zero por não existir, e contá-los derrubaria o patamar pela metade.
 * Um zero DEPOIS da primeira venda continua entrando — ali o zero é informação (ruptura,
 * item morrendo), não ausência de cadastro.
 */
export function montarPerfilSazonal(serie: MesSerie[], curva: CurvaSazonal): PerfilSazonal {
  const reais = new Array<number>(13).fill(0);
  let ultimoMesReal = 0;

  serie.forEach((m) => {
    const mes = Number(m.mes.slice(5, 7));
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) return;
    // Mês em curso é PARCIAL: não é mês fechado e não pode medir patamar.
    if (m.futuro || m.parcial) return;
    reais[mes] = Number(m.qtde) || 0;
    if (mes > ultimoMesReal) ultimoMesReal = mes;
  });

  if (ultimoMesReal < 1) return { ...PERFIL_SAZONAL_VAZIO, reais };

  let primeiroMesComVenda = 0;
  for (let m = 1; m <= ultimoMesReal; m += 1) {
    if (reais[m] > 0) {
      primeiroMesComVenda = m;
      break;
    }
  }
  if (primeiroMesComVenda === 0) {
    return { ...PERFIL_SAZONAL_VAZIO, ultimoMesReal, reais };
  }

  const niveis = new Array<number>(13).fill(0);
  for (let m = 1; m <= 12; m += 1) {
    const fator = curva.fatores[m] > 0 ? curva.fatores[m] : 1;
    niveis[m] = reais[m] / fator;
  }

  const mesesAno: number[] = [];
  for (let m = primeiroMesComVenda; m <= ultimoMesReal; m += 1) mesesAno.push(m);
  const inicioRecente = Math.max(primeiroMesComVenda, ultimoMesReal - MESES_RECENTES_SAZONAL + 1);
  const mesesRecentes: number[] = [];
  for (let m = inicioRecente; m <= ultimoMesReal; m += 1) mesesRecentes.push(m);

  const media = (meses: number[]) =>
    meses.length > 0 ? meses.reduce((s, m) => s + niveis[m], 0) / meses.length : 0;

  const patamarAno = media(mesesAno);
  const patamarRecente = media(mesesRecentes);
  const vendaRecente = mesesRecentes.reduce((s, m) => s + reais[m], 0);

  return {
    ultimoMesReal,
    primeiroMesComVenda,
    mesesAno,
    mesesRecentes,
    reais,
    niveis,
    patamarAno,
    patamarRecente,
    patamar: (1 - PESO_RECENTE_SAZONAL) * patamarAno + PESO_RECENTE_SAZONAL * patamarRecente,
    ativa: vendaRecente > 0,
  };
}

/** Quanto o escopo vende num mês CHEIO qualquer do calendário. */
export function projetarMesSazonal(
  perfil: PerfilSazonal,
  curva: CurvaSazonal,
  mes: number
): number {
  if (!perfil.ativa || perfil.patamar <= 0) return 0;
  const fator = curva.fatores[mes] > 0 ? curva.fatores[mes] : 1;
  return perfil.patamar * fator;
}

/** Quantos dias tem o mês (1-12) daquele ano. */
function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

/** Um mês do horizonte, com a conta aberta (o que o tooltip mostra). */
export interface ParteHorizonteSazonal {
  ano: number;
  mes: number;
  /** Fator sazonal da categoria naquele mês. */
  fator: number;
  /** `patamar × fator` — o mês inteiro. */
  mesCheio: number;
  diasUsados: number;
  diasDoMes: number;
  parcela: number;
  /** Mês já fechado dentro do horizonte (só acontece se o horizonte olhar para trás). */
  realizado: number | null;
}

/**
 * A projeção entre a data base e o fim do horizonte, mês a mês e com pro-rata nas pontas.
 *
 * O mês da data base entra só pelos dias que faltam dele. Meses do ano SEGUINTE usam o mesmo
 * patamar e o mesmo fator — a curva é do calendário, não do ano, e o patamar já é o nível
 * atual do escopo. Não há encadeamento de crescimento: esticar uma taxa anual para dentro
 * de um trimestre que ainda nem começou é chute, e esta regra existe para não chutar.
 */
export function detalharHorizonteSazonal(
  perfil: PerfilSazonal,
  curva: CurvaSazonal,
  dataBase: string,
  diasHorizonte: number
): ParteHorizonteSazonal[] {
  if (diasHorizonte <= 0 || perfil.ultimoMesReal < 1) return [];
  const partes: ParteHorizonteSazonal[] = [];
  let ano = Number(dataBase.slice(0, 4));
  let mes = Number(dataBase.slice(5, 7));
  let dia = Number(dataBase.slice(8, 10));
  let restantes = diasHorizonte;
  // Teto de 48 meses: o horizonte vem de uma data digitada na tela e um erro de digitação
  // não pode virar laço infinito.
  for (let guard = 0; restantes > 0 && guard < 48; guard += 1) {
    const dm = diasNoMes(ano, mes);
    const usados = Math.min(restantes, dm - dia + 1);
    const mesCheio = projetarMesSazonal(perfil, curva, mes);
    partes.push({
      ano,
      mes,
      fator: curva.fatores[mes] > 0 ? curva.fatores[mes] : 1,
      mesCheio,
      diasUsados: usados,
      diasDoMes: dm,
      parcela: mesCheio * (usados / dm),
      realizado: null,
    });
    restantes -= usados;
    dia = 1;
    if (mes === 12) {
      ano += 1;
      mes = 1;
    } else {
      mes += 1;
    }
  }
  return partes;
}

/** Total projetado no horizonte. Sem arredondar — quem soma linhas precisa dos centavos. */
export function projetarHorizonteSazonal(
  perfil: PerfilSazonal,
  curva: CurvaSazonal,
  dataBase: string,
  diasHorizonte: number
): number {
  return detalharHorizonteSazonal(perfil, curva, dataBase, diasHorizonte).reduce(
    (soma, parte) => soma + parte.parcela,
    0
  );
}

/**
 * Projeção de um intervalo de datas fechado ['de' .. 'ate'], as duas pontas incluídas.
 *
 * É a forma que o "estoque de 90 dias" pede: quanto o escopo vende de 01/01 a 31/03 do ano
 * que vem, um trecho que não começa na data base.
 */
export function projetarIntervaloSazonal(
  perfil: PerfilSazonal,
  curva: CurvaSazonal,
  de: string,
  ate: string
): number {
  const dias = diffDiasInclusivo(de, ate);
  if (dias <= 0) return 0;
  return projetarHorizonteSazonal(perfil, curva, de, dias);
}

/** Distância em dias entre duas datas 'yyyy-MM-dd', com as duas pontas dentro. */
export function diffDiasInclusivo(de: string, ate: string): number {
  const a = Date.UTC(Number(de.slice(0, 4)), Number(de.slice(5, 7)) - 1, Number(de.slice(8, 10)));
  const b = Date.UTC(Number(ate.slice(0, 4)), Number(ate.slice(5, 7)) - 1, Number(ate.slice(8, 10)));
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Quanto a categoria cresce em Nov/Dez contra o mês médio — a leitura que a tela mostra.
 * `fator 1,45` vira `+45%`.
 */
export function altaDeFimDeAno(curva: CurvaSazonal): { novembro: number; dezembro: number; outubro: number } {
  return {
    outubro: curva.fatores[10] - 1,
    novembro: curva.fatores[11] - 1,
    dezembro: curva.fatores[12] - 1,
  };
}

/**
 * Motor de projeção mensal — porte fiel de `AUTOMACOES/projecao_scarfme.py`.
 *
 * A regra é: NÃO se extrapola ritmo. Mantém-se a CURVA do ano anterior (é ela que carrega a
 * sazonalidade — Nov/Dez pesam muito mais que Jan/Fev) e corrige-se o PATAMAR por um índice
 * YoY medido no que o escopo está de fato entregando:
 *
 *     índice     = (1 − P) × YoY(ano corrido)  +  P × YoY(últimos 3 meses fechados)
 *     projeção[m] = realizado_ano_anterior[m] × índice
 *
 * Os dois YoY são RAZÃO DE SOMAS (soma do atual ÷ soma do ano anterior no mesmo recorte de
 * meses), não média de percentuais mês a mês — média de taxas dá peso igual a um mês de base
 * 3 unidades e a um de base 3.000, e era exatamente isso que a regra antiga fazia.
 *
 * Casos especiais:
 *   - sem base no ano anterior naquele mês  → média dos últimos 3 meses fechados
 *   - nada vendido nos últimos 3 meses fechados (escopo "parado") → projeta 0
 *
 * No script o primeiro caso é `média recente × sazonalidade da REDE`, e ali isso faz sentido:
 * uma loja nova não tem curva, mas as outras lojas têm. Aqui a série é UMA (o agregado do
 * escopo), então "a curva da rede" seria a curva do próprio escopo — e ela vale exatamente 0
 * justamente nos meses em que falta base, o que zerava a projeção de item que está vendendo
 * bem agora. Decisão do dono (10/09/2026): sem base no ano anterior, usa a média recente seca.
 *
 * Diferença de recorte: no script cada LOJA/CANAL tem o seu índice e a rede é a soma das lojas.
 * Aqui a série é sempre UMA — o agregado do escopo — e o índice é um só. Para olhar uma loja
 * isolada, o recorte é o filtro Filial da tela (que muda a série, e com ela o índice), não uma
 * quebra interna. A fórmula, os pesos e o clamp são os mesmos.
 */

/** Peso do YoY recente no índice (o resto vai para o YoY do ano corrido). */
export const PESO_JANELA_RECENTE = 0.5;
/** Janela recente: quantos meses fechados entram na atividade e no YoY de curto prazo. */
export const MESES_JANELA_ATIVIDADE = 3;
/** Trava contra índice absurdo vindo de base pequena. */
export const INDICE_MIN = 0.3;
export const INDICE_MAX = 2.0;
/** Modo conservador: mesmo mês do ano passado + 10%. */
export const FATOR_MAIS10 = 1.1;

export type ModoProjecao = "realista" | "mais10";

/** Critério que produziu o valor do mês — o que a tela mostra no tooltip. */
export type CriterioMes = "real" | "parado" | "yoy" | "ano_passado" | "sem_base";

/** Um mês da série anual do escopo, do jeito que a API já devolve. */
export interface MesSerie {
  /** 'yyyy-MM' */
  mes: string;
  qtde: number;
  qtdeAnoAnterior: number;
  /** Mês em curso: fechado só até a data base. */
  parcial: boolean;
  futuro: boolean;
}

export interface PerfilProjecao {
  /** Último mês FECHADO (0 quando a data base cai em janeiro e nada fechou ainda). */
  ultimoMesReal: number;
  /** Meses da janela recente (1-based). */
  mesesJanela: number[];
  /** Realizado do ano base por mês (1-based; índice 0 não usado). */
  reais: number[];
  /** Realizado do ano anterior por mês (1-based). */
  anoAnterior: number[];
  /** Teve movimento na janela recente. Escopo parado projeta 0. */
  ativa: boolean;
  /** Média mensal da janela recente — patamar usado quando falta base no ano anterior. */
  mediaRecente: number;
  /** YoY do ano corrido (soma ÷ soma), null quando o ano anterior não tem base. */
  yoyAno: number | null;
  /** YoY dos últimos meses fechados, null quando o ano anterior não tem base. */
  yoyRecente: number | null;
  /** Índice combinado já clampado, null quando não há YoY nenhum. */
  indice: number | null;
}

/** Razão de somas entre o ano base e o anterior nos meses pedidos. */
function yoyDeMeses(reais: number[], anoAnterior: number[], meses: number[]): number | null {
  let atual = 0;
  let passado = 0;
  meses.forEach((m) => {
    atual += reais[m] ?? 0;
    passado += anoAnterior[m] ?? 0;
  });
  return passado > 0 ? atual / passado : null;
}

/** Índice YoY combinado: parte ano corrido, parte janela recente. */
export function indiceRealista(yoyAno: number | null, yoyRecente: number | null): number | null {
  if (yoyAno == null && yoyRecente == null) return null;
  let indice: number;
  if (yoyRecente == null) indice = yoyAno as number;
  else if (yoyAno == null) indice = yoyRecente;
  else indice = (1 - PESO_JANELA_RECENTE) * yoyAno + PESO_JANELA_RECENTE * yoyRecente;
  return Math.max(INDICE_MIN, Math.min(INDICE_MAX, indice));
}

/** Reúne, da série do escopo, tudo o que a projeção precisa saber. */
export function montarPerfil(serie: MesSerie[]): PerfilProjecao {
  const reais = new Array<number>(13).fill(0);
  const anoAnterior = new Array<number>(13).fill(0);
  let ultimoMesReal = 0;

  serie.forEach((m) => {
    const mes = Number(m.mes.slice(5, 7));
    if (!Number.isFinite(mes) || mes < 1 || mes > 12) return;
    anoAnterior[mes] = Number(m.qtdeAnoAnterior) || 0;
    // Mês em curso é PARCIAL: entra como projetado, não como realizado — comparar meio mês
    // com um mês cheio do ano anterior contamina o índice.
    if (!m.futuro && !m.parcial) {
      reais[mes] = Number(m.qtde) || 0;
      if (mes > ultimoMesReal) ultimoMesReal = mes;
    }
  });

  const inicioJanela = Math.max(1, ultimoMesReal - MESES_JANELA_ATIVIDADE + 1);
  const mesesJanela: number[] = [];
  for (let m = inicioJanela; m <= ultimoMesReal; m += 1) mesesJanela.push(m);

  const somaJanela = mesesJanela.reduce((s, m) => s + reais[m], 0);
  const mesesFechados: number[] = [];
  for (let m = 1; m <= ultimoMesReal; m += 1) mesesFechados.push(m);

  const yoyAno = yoyDeMeses(reais, anoAnterior, mesesFechados);
  const yoyRecente = yoyDeMeses(reais, anoAnterior, mesesJanela);

  return {
    ultimoMesReal,
    mesesJanela,
    reais,
    anoAnterior,
    ativa: somaJanela > 0,
    mediaRecente: mesesJanela.length > 0 ? somaJanela / mesesJanela.length : 0,
    yoyAno,
    yoyRecente,
    indice: indiceRealista(yoyAno, yoyRecente),
  };
}

/** Índice que o modo aplica sobre a curva do ano anterior. */
export function indiceDoModo(perfil: PerfilProjecao, modo: ModoProjecao): number | null {
  return modo === "realista" ? perfil.indice : FATOR_MAIS10;
}

/**
 * Projeção do mês CHEIO (1-12), ignorando o que já foi realizado. É esta a conta que a tela
 * usa para comparar qualquer mês com o mesmo mês do ano anterior — inclusive um mês já
 * fechado, onde o realizado é o número de verdade mas a projeção serve de aferição.
 * Sem arredondar: quem soma precisa dos centavos (ver [[produto-giro-arredondamento-somar-exato]]).
 */
export function projetarMesCheio(
  perfil: PerfilProjecao,
  mes: number,
  modo: ModoProjecao
): { valor: number; criterio: CriterioMes } {
  if (!perfil.ativa) {
    return { valor: 0, criterio: "parado" };
  }
  const indice = indiceDoModo(perfil, modo);
  const base = perfil.anoAnterior[mes] ?? 0;
  if (base > 0 && indice != null) {
    return {
      valor: base * indice,
      criterio: modo === "realista" ? "yoy" : "ano_passado",
    };
  }
  // Sem base no ano anterior naquele mês: patamar dos últimos meses fechados.
  return { valor: perfil.mediaRecente, criterio: "sem_base" };
}

/** Valor de UM mês: mês fechado devolve o realizado; o resto é projeção. */
export function projetarMes(
  perfil: PerfilProjecao,
  mes: number,
  modo: ModoProjecao
): { valor: number; criterio: CriterioMes } {
  if (mes <= perfil.ultimoMesReal) {
    return { valor: perfil.reais[mes] ?? 0, criterio: "real" };
  }
  return projetarMesCheio(perfil, mes, modo);
}

/** Projeção dos 12 meses do ano base (índice 0 = janeiro). */
export function projetarAno(
  perfil: PerfilProjecao,
  modo: ModoProjecao
): Array<{ mes: number; valor: number; criterio: CriterioMes }> {
  return Array.from({ length: 12 }, (_, i) => {
    const mes = i + 1;
    return { mes, ...projetarMes(perfil, mes, modo) };
  });
}

export type SuggestionType = "COMPRA" | "S" | "E" | "PO" | "NM" | "SUFICIENTE" | "SEM_SUGESTAO";

export interface SuggestionRuleInput {
  qtde12m?: number | null;
  vendasMesAtual?: number | null;
  estoqueAtual?: number | null;
  linha?: string | null;
  subgrupo?: string | null;
  diasDesdeUltimaVenda?: number | null;
  mesesHistoricoFilial?: number | null;
  diasComEstoquePositivo?: number | null;
  diasSemEstoque?: number | null;
  mesesDisponiveis?: number | null;
  velocidadeAjustada?: number | null;
}

export interface SuggestionSData {
  mediaVendasMes: number;
  velocidadeAjustada: number;
  mesesHistoricoFilial: number;
  mesesDisponiveis: number;
  estoqueAtual: number;
  limiteDias: number;
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
  alvoEstoque: number;
  sugestaoBruta: number;
  cappedQty: number;
}

export interface SuggestionEData {
  qtd: number;
  velocidadeAjustada: number;
  mesesSemVenda: number;
  mesesSemEstoque: number;
  mesesAtivos: number;
  mesesDisponiveis: number;
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
  limiteDias: number;
  sugestaoBruta: number;
  cappedQty: number;
}

export interface SuggestionPOData {
  qtd: number;
  velocidadeAjustada: number;
  velocidadeDisponivelDia: number;
  potencialMensalBruto: number;
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
  mesesDisponiveis: number;
  limiteDias: number;
  sugestaoBruta: number;
  limiteSeguro: number;
  cappedQty: number;
}

export interface ReposicaoCompraView {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO: number;
  qtdNM: number;
  qtdSuficiente: boolean;
  semSugestao: boolean;
  sData?: SuggestionSData;
  eData?: SuggestionEData;
  poData?: SuggestionPOData;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function normalizeKey(value?: string | null): string {
  return (value ?? "")
    .toString()
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function roundSafe(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function getQtde12m(item: SuggestionRuleInput): number {
  return Math.max(0, Number(item.qtde12m ?? 0));
}

function getEstoqueAtual(item: SuggestionRuleInput): number {
  return Number(item.estoqueAtual ?? 0);
}

function getDiasComEstoquePositivo(item: SuggestionRuleInput): number {
  const explicitDays = Number(item.diasComEstoquePositivo ?? NaN);
  if (Number.isFinite(explicitDays)) {
    return clamp(roundSafe(explicitDays), 0, 365);
  }

  const explicitMonths = Number(item.mesesDisponiveis ?? NaN);
  if (Number.isFinite(explicitMonths)) {
    return clamp(roundSafe(explicitMonths * 30), 0, 365);
  }

  const historicoMonths = Number(item.mesesHistoricoFilial ?? NaN);
  if (Number.isFinite(historicoMonths)) {
    return clamp(roundSafe(historicoMonths * 30), 0, 365);
  }

  return 365;
}

function getDiasSemEstoque(item: SuggestionRuleInput): number {
  const explicitDays = Number(item.diasSemEstoque ?? NaN);
  if (Number.isFinite(explicitDays)) {
    return clamp(roundSafe(explicitDays), 0, 365);
  }
  return clamp(365 - getDiasComEstoquePositivo(item), 0, 365);
}

export function getMesesDisponiveis(item: SuggestionRuleInput): number {
  const explicitMonths = Number(item.mesesDisponiveis ?? NaN);
  if (Number.isFinite(explicitMonths) && explicitMonths > 0) {
    return Math.max(explicitMonths, 1);
  }
  return Math.max(getDiasComEstoquePositivo(item) / 30, 1);
}

export function getVelocidadeAjustada(item: SuggestionRuleInput): number {
  const explicitVelocity = Number(item.velocidadeAjustada ?? NaN);
  if (Number.isFinite(explicitVelocity) && explicitVelocity >= 0) {
    return explicitVelocity;
  }
  return getQtde12m(item) / getMesesDisponiveis(item);
}

export function getLimiteDiasReposicao(item: Pick<SuggestionRuleInput, "linha" | "subgrupo">): number {
  const linha = normalizeKey(item.linha);
  const subgrupo = normalizeKey(item.subgrupo);

  if (linha === "INDIA") return 90;
  if (linha === "ELETRONICOS") return 30;

  const subgrupos90 = new Set(["CETIM DE SEDA", "MOUSSELINE DE SEDA", "SEDA PREMIUM"]);
  if (subgrupos90.has(subgrupo)) return 90;

  return 60;
}

export function getSuggestedDelta(
  item: Pick<SuggestionRuleInput, "vendasMesAtual" | "estoqueAtual" | "linha" | "subgrupo">,
  diasCorridosMes: number
): number {
  const vendasMes = Number(item.vendasMesAtual ?? 0);
  if (vendasMes <= 0 || diasCorridosMes <= 0) return 0;

  const consumoDiario = vendasMes / diasCorridosMes;
  if (consumoDiario <= 0) return 0;

  const estoqueAtual = getEstoqueAtual(item);
  const limiteDias = getLimiteDiasReposicao(item);
  const duracaoAtual = estoqueAtual / consumoDiario;
  if (duracaoAtual >= limiteDias) return 0;

  const qtd = Math.ceil(consumoDiario * (limiteDias - duracaoAtual));
  return Number.isFinite(qtd) ? Math.max(0, qtd) : 0;
}

function applyDisponibilidadeCap(qty: number, item: SuggestionRuleInput): number {
  const diasComEstoquePositivo = getDiasComEstoquePositivo(item);
  if (diasComEstoquePositivo < 90) {
    return Math.min(qty, 3);
  }
  return qty;
}

export function calcNecessidadeMinimaQtyAdjusted(input: {
  estoqueAtual?: number | null;
  qtde12m?: number | null;
  velocidadeAjustada?: number | null;
  mesesDisponiveis?: number | null;
  diasComEstoquePositivo?: number | null;
}): number {
  const estoqueAtual = Number(input.estoqueAtual ?? 0);
  if (estoqueAtual > 0) return 0;

  const qtde12m = Math.max(0, Math.floor(Number(input.qtde12m ?? 0)));
  if (qtde12m < 3) return 0;

  const mesesDisponiveis = Number(input.mesesDisponiveis ?? NaN);
  const diasComEstoquePositivo = Number(input.diasComEstoquePositivo ?? NaN);
  const velocidadeAjustadaExplicit = Number(input.velocidadeAjustada ?? NaN);
  const velocidadeAjustada =
    Number.isFinite(velocidadeAjustadaExplicit) && velocidadeAjustadaExplicit >= 0
      ? velocidadeAjustadaExplicit
      : qtde12m / Math.max(
        Number.isFinite(mesesDisponiveis) && mesesDisponiveis > 0
          ? mesesDisponiveis
          : Number.isFinite(diasComEstoquePositivo)
            ? Math.max(diasComEstoquePositivo / 30, 1)
            : 12,
        1
      );

  return velocidadeAjustada >= 0.5 ? 1 : 0;
}

export function calcQtdSugestaoS(item: SuggestionRuleInput): number {
  const velocidadeAjustada = getVelocidadeAjustada(item);
  if (velocidadeAjustada < 1) return 0;

  const estoqueAtual = getEstoqueAtual(item);
  const limiteDias = getLimiteDiasReposicao(item);
  const alvoEstoque = Math.ceil(velocidadeAjustada * (limiteDias / 30));
  const sugestaoBruta = Math.max(0, alvoEstoque - estoqueAtual);
  return applyDisponibilidadeCap(sugestaoBruta, item);
}

export function calcQtdSugestaoEInfo(item: SuggestionRuleInput): SuggestionEData | null {
  const estoqueAtual = getEstoqueAtual(item);
  if (estoqueAtual > 0) return null;

  const qtde12m = getQtde12m(item);
  if (qtde12m < 3) return null;

  const diasComEstoquePositivo = getDiasComEstoquePositivo(item);
  if (diasComEstoquePositivo <= 0) return null;

  const velocidadeAjustada = getVelocidadeAjustada(item);
  if (velocidadeAjustada < 0.5) return null;

  const limiteDias = getLimiteDiasReposicao(item);
  const sugestaoBruta = Math.max(1, Math.ceil(velocidadeAjustada * (limiteDias / 30)) - estoqueAtual);
  const cappedQty = Math.max(1, applyDisponibilidadeCap(sugestaoBruta, item));
  const diasSemEstoque = getDiasSemEstoque(item);
  const mesesDisponiveis = getMesesDisponiveis(item);

  return {
    qtd: cappedQty,
    velocidadeAjustada,
    mesesSemVenda: diasSemEstoque / 30,
    mesesSemEstoque: diasSemEstoque / 30,
    mesesAtivos: mesesDisponiveis,
    mesesDisponiveis,
    diasComEstoquePositivo,
    diasSemEstoque,
    limiteDias,
    sugestaoBruta,
    cappedQty,
  };
}

function getPotencialOcultoLimiteSeguro(diasComEstoquePositivo: number): number {
  if (diasComEstoquePositivo < 7) return 3;
  if (diasComEstoquePositivo < 15) return 5;
  return 8;
}

export function calcQtdSugestaoPOInfo(item: SuggestionRuleInput): SuggestionPOData | null {
  const estoqueAtual = getEstoqueAtual(item);
  if (estoqueAtual > 1) return null;

  const qtde12m = getQtde12m(item);
  if (qtde12m < 3) return null;

  const diasComEstoquePositivo = getDiasComEstoquePositivo(item);
  if (diasComEstoquePositivo <= 0 || diasComEstoquePositivo > 30) return null;

  const diasSemEstoque = getDiasSemEstoque(item);
  if (diasSemEstoque < Math.max(15, diasComEstoquePositivo * 2)) return null;

  const mesesDisponiveis = getMesesDisponiveis(item);
  const velocidadeAjustada = getVelocidadeAjustada(item);
  const velocidadeDisponivelDia = qtde12m / Math.max(diasComEstoquePositivo, 1);
  const potencialMensalBruto = velocidadeDisponivelDia * 30;
  if (potencialMensalBruto < 4 || velocidadeAjustada < 4) return null;

  const limiteDias = getLimiteDiasReposicao(item);
  const sugestaoBruta = Math.max(1, Math.ceil(velocidadeAjustada * (limiteDias / 30)) - estoqueAtual);
  const limiteSeguro = getPotencialOcultoLimiteSeguro(diasComEstoquePositivo);
  const cappedQty = Math.max(
    diasComEstoquePositivo < 15 ? 3 : 2,
    Math.min(sugestaoBruta, limiteSeguro)
  );

  return {
    qtd: cappedQty,
    velocidadeAjustada,
    velocidadeDisponivelDia,
    potencialMensalBruto,
    diasComEstoquePositivo,
    diasSemEstoque,
    mesesDisponiveis,
    limiteDias,
    sugestaoBruta,
    limiteSeguro,
    cappedQty,
  };
}

export function getReposicaoCompraView(
  item: SuggestionRuleInput,
  diasCorridosMes: number
): ReposicaoCompraView {
  const qtdFinalPuro = getSuggestedDelta(item, diasCorridosMes);
  const vendasMes = Number(item.vendasMesAtual ?? 0);
  const consumoDiario = diasCorridosMes > 0 ? vendasMes / diasCorridosMes : 0;
  const estoqueAtual = getEstoqueAtual(item);
  const limiteDias = getLimiteDiasReposicao(item);
  const duracaoAtual = consumoDiario > 0 ? estoqueAtual / consumoDiario : 0;
  const qtdSuficiente = consumoDiario > 0 && duracaoAtual >= limiteDias;

  const velocidadeAjustada = getVelocidadeAjustada(item);
  const mesesDisponiveis = getMesesDisponiveis(item);
  const diasComEstoquePositivo = getDiasComEstoquePositivo(item);
  const diasSemEstoque = getDiasSemEstoque(item);
  const poData = calcQtdSugestaoPOInfo(item) ?? undefined;
  const qtdPO = poData?.qtd ?? 0;
  const alvoEstoqueS = Math.ceil(velocidadeAjustada * (limiteDias / 30));
  const sugestaoBrutaS = Math.max(0, alvoEstoqueS - estoqueAtual);
  const qtdS = velocidadeAjustada >= 1 ? applyDisponibilidadeCap(sugestaoBrutaS, item) : 0;

  if (qtdFinalPuro > 0) {
    if (qtdS > 0 && qtdFinalPuro < 0.6 * qtdS) {
      return {
        qtdFinal: Math.round(0.8 * qtdS + 0.4 * qtdFinalPuro),
        qtdS: 0,
        qtdE: 0,
        qtdPO,
        qtdNM: 0,
        qtdSuficiente: false,
        semSugestao: false,
        poData,
      };
    }

    return {
      qtdFinal: qtdFinalPuro,
      qtdS: 0,
      qtdE: 0,
      qtdPO,
      qtdNM: 0,
      qtdSuficiente: false,
      semSugestao: false,
      poData,
    };
  }

  if (qtdSuficiente) {
    return {
      qtdFinal: 0,
      qtdS: 0,
      qtdE: 0,
      qtdPO,
      qtdNM: 0,
      qtdSuficiente: true,
      semSugestao: qtdPO === 0,
      poData,
    };
  }

  if (qtdS > 0) {
    return {
      qtdFinal: 0,
      qtdS,
      qtdE: 0,
      qtdPO,
      qtdNM: 0,
      qtdSuficiente: false,
      semSugestao: false,
      sData: {
        mediaVendasMes: velocidadeAjustada,
        velocidadeAjustada,
        mesesHistoricoFilial: mesesDisponiveis,
        mesesDisponiveis,
        estoqueAtual,
        limiteDias,
        diasComEstoquePositivo,
        diasSemEstoque,
        alvoEstoque: alvoEstoqueS,
        sugestaoBruta: sugestaoBrutaS,
        cappedQty: qtdS,
      },
      poData,
    };
  }

  const eData = calcQtdSugestaoEInfo(item);
  if (eData) {
    return {
      qtdFinal: 0,
      qtdS: 0,
      qtdE: eData.qtd,
      qtdPO,
      qtdNM: 0,
      qtdSuficiente: false,
      semSugestao: false,
      eData,
      poData,
    };
  }

  const qtdNM = calcNecessidadeMinimaQtyAdjusted({
    estoqueAtual,
    qtde12m: getQtde12m(item),
    velocidadeAjustada,
    mesesDisponiveis,
    diasComEstoquePositivo,
  });

  return {
    qtdFinal: 0,
    qtdS: 0,
    qtdE: 0,
    qtdPO,
    qtdNM,
    qtdSuficiente: false,
    semSugestao: qtdNM === 0 && qtdPO === 0,
    poData,
  };
}

export function getReposicaoBaseType(sugestao: {
  qtdFinal: number;
  qtdS: number;
  qtdE: number;
  qtdPO?: number;
  qtdNM?: number;
  qtdSuficiente: boolean;
}): SuggestionType {
  const principalQty = getSuggestedQtyValue({
    qtdFinal: sugestao.qtdFinal,
    qtdS: sugestao.qtdS,
    qtdE: sugestao.qtdE,
    qtdPO: sugestao.qtdPO ?? 0,
    qtdNM: sugestao.qtdNM ?? 0,
    qtdSuficiente: sugestao.qtdSuficiente,
    semSugestao: false,
  });
  if (principalQty > 0) {
    if (sugestao.qtdFinal === principalQty && sugestao.qtdFinal > 0) return "COMPRA";
    if (sugestao.qtdS === principalQty && sugestao.qtdS > 0) return "S";
    if (sugestao.qtdE === principalQty && sugestao.qtdE > 0) return "E";
    if ((sugestao.qtdPO ?? 0) === principalQty && (sugestao.qtdPO ?? 0) > 0) return "PO";
    if ((sugestao.qtdNM ?? 0) === principalQty && (sugestao.qtdNM ?? 0) > 0) return "NM";
  }
  if (sugestao.qtdSuficiente) return "SUFICIENTE";
  return "SEM_SUGESTAO";
}

export function getSuggestedQtyValue(sugestao: ReposicaoCompraView): number {
  return Math.max(
    0,
    sugestao.qtdFinal,
    sugestao.qtdS,
    sugestao.qtdE,
    sugestao.qtdPO,
    sugestao.qtdNM
  );
}

export function buildDisponibilidadeResumo(
  stockByDate: Array<{ dateIso: string; stockTotal: number }>
): {
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
} {
  const positiveDays = stockByDate.reduce((sum, row) => sum + (row.stockTotal > 0 ? 1 : 0), 0);
  return {
    diasComEstoquePositivo: positiveDays,
    diasSemEstoque: Math.max(0, stockByDate.length - positiveDays),
  };
}

export function buildDateRangeLast12Months(now: Date = new Date()): {
  start: Date;
  end: Date;
  totalDays: number;
} {
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const start = new Date(end);
  start.setDate(start.getDate() - 365);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY));
  return { start, end, totalDays };
}

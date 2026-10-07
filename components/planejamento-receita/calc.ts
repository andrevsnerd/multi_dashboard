import type { OrcadoAno } from "@/lib/config/planejamento-receita";
import type {
  PlanejamentoReceitaResponse,
  ReceitaMesRealizado,
  StatusMes,
} from "@/lib/types/planejamento-receita";

/**
 * Contas da tela de Planejamento de Receita — funções puras sobre a resposta da API.
 *
 * Três regras que valem em toda a tela:
 *  1. Mês corrente é comparado PROPORCIONALMENTE: o orçado do mês entra pela fração de
 *     dias decorridos, e o ano anterior pelos mesmos dias (nunca mês cheio contra mês
 *     pela metade).
 *  2. Crescimento só existe contra ano anterior FECHADO; mês do ano anterior que ainda
 *     não aconteceu vira "—", não zero.
 *  3. Projeção de fechamento = realizado + mês corrente no ritmo diário + orçado dos
 *     meses futuros × atingimento acumulado. É uma régua simples e explicável, não um
 *     modelo: se o ano não começou, a projeção é o próprio orçado.
 */

/** "total" = Lojas + Web (sem corporativo). Na planilha "Varejo" é a linha das LOJAS. */
export type Canal = "total" | "lojas" | "web";

export const CANAIS: { key: Canal; label: string }[] = [
  { key: "total", label: "Lojas + Web" },
  { key: "lojas", label: "Lojas" },
  { key: "web", label: "Web" },
];

export interface MesCalc {
  mes: number;
  status: StatusMes;
  aaStatus: StatusMes;
  orcado: number;
  /** Orçado até hoje: mês fechado = cheio; corrente = pela fração de dias; futuro = 0. */
  orcadoProporcional: number;
  /** null em mês futuro. */
  realizado: number | null;
  /** Mês fechado = realizado; corrente = ritmo diário × dias do mês; futuro = null. */
  projecaoMes: number | null;
  /** Ano anterior, mês cheio. null se ainda não aconteceu. */
  aa: number | null;
  aaParcial: boolean;
  /** Base do crescimento do realizado: mês cheio, ou os mesmos dias no mês corrente. */
  aaComparavel: number | null;
  atingimento: number | null;
  crescRealizado: number | null;
  crescOrcado: number | null;
  orcadoAA: number | null;
}

export interface ResumoCalc {
  orcadoAno: number;
  realizadoAno: number;
  orcadoPeriodo: number;
  atingimento: number | null;
  diferenca: number;
  crescimentoPeriodo: number | null;
  aaPeriodo: number;
  aaAno: number;
  aaAnoCompleto: boolean;
  /** Orçado do ano vs realizado do ano anterior inteiro (só quando o anterior fechou). */
  crescOrcadoVsAA: number | null;
  /** Orçado do ano vs orçado do ano anterior (quando os dois existem). */
  crescOrcadoVsOrcadoAA: number | null;
  orcadoAAano: number | null;
  projecaoRitmo: number;
  /** Realizado + o que falta do orçado (cumprindo o orçado daqui pra frente). */
  projecaoCumprindo: number;
  faltaParaOrcado: number;
  orcadoRestante: number;
  /** Quanto do orçado restante precisa ser entregue para fechar o ano no orçado (1 = 100%). */
  ritmoNecessario: number | null;
  status: "nao-iniciado" | "em-andamento" | "encerrado";
  /** Dia de hoje e dias do mês corrente (para rótulos). */
  diaHoje: number;
  diasMesCorrente: number;
  mesCorrente: number | null;
}

export function diasNoMes(ano: number, mes: number): number {
  return new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function valorCanal(lojas: number, web: number, canal: Canal): number {
  if (canal === "lojas") return lojas;
  if (canal === "web") return web;
  return lojas + web;
}

export function orcadoCanal(orcado: OrcadoAno, canal: Canal, i: number): number {
  return valorCanal(orcado.lojas[i] ?? 0, orcado.web[i] ?? 0, canal);
}

function aaMesmosDias(m: ReceitaMesRealizado, canal: Canal): number | null {
  if (m.aaLojasMesmosDias == null || m.aaWebMesmosDias == null) return null;
  return valorCanal(m.aaLojasMesmosDias, m.aaWebMesmosDias, canal);
}

const razao = (a: number, b: number): number | null => (b > 0 ? a / b - 1 : null);

export function calcularMeses(data: PlanejamentoReceitaResponse, canal: Canal): MesCalc[] {
  const diaHoje = Number(data.hoje.slice(8, 10));
  return data.meses.map((m, i) => {
    const orcado = orcadoCanal(data.orcado, canal, i);
    const diasMes = diasNoMes(data.ano, m.mes);
    const fracao = m.status === "fechado" ? 1 : m.status === "corrente" ? diaHoje / diasMes : 0;
    const orcadoProporcional = orcado * fracao;

    const realizado = m.status === "futuro" ? null : valorCanal(m.lojas, m.web, canal);
    const projecaoMes =
      realizado == null ? null : m.status === "corrente" ? (realizado / diaHoje) * diasMes : realizado;

    const aaCheio = valorCanal(m.aaLojas, m.aaWeb, canal);
    const aa = m.aaStatus === "futuro" ? null : aaCheio;
    const aaParcial = m.aaStatus === "corrente";
    const aaComparavel =
      realizado == null || m.aaStatus !== "fechado"
        ? null
        : m.status === "corrente"
          ? aaMesmosDias(m, canal)
          : aaCheio;

    return {
      mes: m.mes,
      status: m.status,
      aaStatus: m.aaStatus,
      orcado,
      orcadoProporcional,
      realizado,
      projecaoMes,
      aa,
      aaParcial,
      aaComparavel,
      atingimento: realizado != null && orcadoProporcional > 0 ? realizado / orcadoProporcional : null,
      crescRealizado: realizado != null && aaComparavel != null ? razao(realizado, aaComparavel) : null,
      crescOrcado: m.aaStatus === "fechado" ? razao(orcado, aaCheio) : null,
      orcadoAA: data.orcadoAnoAnterior ? orcadoCanal(data.orcadoAnoAnterior, canal, i) : null,
    };
  });
}

export function calcularResumo(data: PlanejamentoReceitaResponse, meses: MesCalc[]): ResumoCalc {
  const soma = (f: (m: MesCalc) => number | null) => meses.reduce((s, m) => s + (f(m) ?? 0), 0);

  const orcadoAno = soma((m) => m.orcado);
  const realizadoAno = soma((m) => m.realizado);
  const orcadoPeriodo = soma((m) => m.orcadoProporcional);
  const atingimento = orcadoPeriodo > 0 ? realizadoAno / orcadoPeriodo : null;

  // Crescimento do período: só meses que têm realizado E ano anterior comparável.
  const comparaveis = meses.filter((m) => m.realizado != null && m.aaComparavel != null);
  const realComparavel = comparaveis.reduce((s, m) => s + (m.realizado ?? 0), 0);
  const aaPeriodo = comparaveis.reduce((s, m) => s + (m.aaComparavel ?? 0), 0);

  const aaAnoCompleto = meses.every((m) => m.aaStatus === "fechado");
  const aaAno = soma((m) => m.aa);
  const orcadoAAano = data.orcadoAnoAnterior ? soma((m) => m.orcadoAA) : null;

  const ritmo = atingimento ?? 1;
  const projecaoRitmo = soma((m) =>
    m.status === "futuro" ? m.orcado * ritmo : m.projecaoMes
  );
  const orcadoRestante = orcadoAno - orcadoPeriodo;
  const projecaoCumprindo = realizadoAno + orcadoRestante;
  const faltaParaOrcado = orcadoAno - realizadoAno;

  const corrente = meses.find((m) => m.status === "corrente") ?? null;
  const status: ResumoCalc["status"] = meses.every((m) => m.status === "futuro")
    ? "nao-iniciado"
    : meses.every((m) => m.status === "fechado")
      ? "encerrado"
      : "em-andamento";

  return {
    orcadoAno,
    realizadoAno,
    orcadoPeriodo,
    atingimento,
    diferenca: realizadoAno - orcadoPeriodo,
    crescimentoPeriodo: aaPeriodo > 0 ? realComparavel / aaPeriodo - 1 : null,
    aaPeriodo,
    aaAno,
    aaAnoCompleto,
    crescOrcadoVsAA: aaAnoCompleto && aaAno > 0 ? orcadoAno / aaAno - 1 : null,
    crescOrcadoVsOrcadoAA: orcadoAAano && orcadoAAano > 0 ? orcadoAno / orcadoAAano - 1 : null,
    orcadoAAano,
    projecaoRitmo,
    projecaoCumprindo,
    faltaParaOrcado,
    orcadoRestante,
    ritmoNecessario: orcadoRestante > 0 ? Math.max(0, faltaParaOrcado) / orcadoRestante : null,
    status,
    diaHoje: Number(data.hoje.slice(8, 10)),
    diasMesCorrente: corrente ? diasNoMes(data.ano, corrente.mes) : 0,
    mesCorrente: corrente?.mes ?? null,
  };
}

// ---------- formatação ----------

export const MESES_CURTOS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const MESES_LONGOS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** 1234567.8 → "1.234.568" (a planilha trabalha sem centavos). */
export function inteiro(v: number): string {
  return Math.round(v).toLocaleString("pt-BR");
}

export function brl(v: number): string {
  const sinal = v < 0 ? "−" : "";
  return `${sinal}R$ ${inteiro(Math.abs(v))}`;
}

/** Rótulo curto: 850 mil, 1,2 mi. */
export function compacto(v: number): string {
  const abs = Math.abs(v);
  const sinal = v < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    return `${sinal}${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: abs >= 10_000_000 ? 1 : 2 })} mi`;
  }
  if (abs >= 1000) return `${sinal}${Math.round(abs / 1000).toLocaleString("pt-BR")} mil`;
  return `${sinal}${Math.round(abs)}`;
}

/** Variação: 0.123 → "+12,3%". */
export function variacao(v: number | null, casas = 1): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const p = v * 100;
  const sinal = p > 0.05 ? "+" : p < -0.05 ? "−" : "";
  return `${sinal}${Math.abs(p).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;
}

/** Atingimento: 1.042 → "104%". */
export function percentual(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100).toLocaleString("pt-BR")}%`;
}

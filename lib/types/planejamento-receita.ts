import type { CenarioPlanejamento, OrcadoAno } from "@/lib/config/planejamento-receita";

/** Situação de um mês em relação a hoje (dia-calendário do Brasil). */
export type StatusMes = "fechado" | "corrente" | "futuro";

export interface ReceitaMesRealizado {
  /** 1..12 */
  mes: number;
  status: StatusMes;
  /** Venda líquida do mês (no mês corrente, do dia 1 até hoje). */
  lojas: number;
  web: number;
  /** Mesmo mês do ano anterior, mês cheio. */
  aaLojas: number;
  aaWeb: number;
  /** Situação do mês do ano anterior — no planejamento do ano que vem, parte dele ainda não aconteceu. */
  aaStatus: StatusMes;
  /**
   * Só no mês corrente: ano anterior nos MESMOS dias (1 até o dia de hoje), para o
   * crescimento do mês não comparar um mês pela metade com um mês cheio.
   */
  aaLojasMesmosDias: number | null;
  aaWebMesmosDias: number | null;
}

/** Célula do orçado alterada na tela (por cima da planilha). */
export interface OrcadoEdicaoInfo {
  canal: "lojas" | "web" | "corporativo";
  mes: number;
  valor: number;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface PlanejamentoReceitaResponse {
  company: string;
  ano: number;
  anosDisponiveis: number[];
  /** Orçado efetivo: planilha + edições da tela. */
  orcado: OrcadoAno;
  /** Orçado original da planilha (null em ano criado na tela). */
  planilha: OrcadoAno | null;
  edicoes: OrcadoEdicaoInfo[];
  /** O usuário pode editar o orçado (só admin). */
  podeEditar: boolean;
  /** Orçado do ano anterior, quando existir (para "orçado vs orçado"). */
  orcadoAnoAnterior: OrcadoAno | null;
  cenarios: CenarioPlanejamento[];
  fonte: string;
  meses: ReceitaMesRealizado[];
  /** YYYY-MM-DD, calendário do Brasil. */
  hoje: string;
  /** ISO da consulta (o realizado fica em cache por alguns minutos). */
  consultadoEm: string;
}

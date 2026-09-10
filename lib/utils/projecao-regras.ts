import type { CriterioMes, ModoProjecao } from "@/lib/utils/projecao-realista";

/**
 * As regras que o select "Regra de cálculo" da Projeção Compra oferece — compartilhadas
 * pelas abas Produtos, Tickets e Embalagens, que projetam do mesmo jeito e só mudam o que
 * está sendo contado.
 *
 * `realista` (padrão) e `mais10` são o motor de [projecao-realista.ts](@/lib/utils/projecao-realista):
 * mantêm a CURVA do ano anterior (é ela que carrega a sazonalidade) e corrigem o patamar por
 * um índice — YoY combinado no realista, +10% fixo no conservador. É a mesma lógica do
 * `AUTOMACOES/projecao_scarfme.py`.
 *
 * As regras de dias extrapolam linearmente o ritmo de uma janela — não têm sazonalidade e
 * seguem existindo para conferência.
 */
export type RegraProjecao =
  | "realista"
  | "mais10"
  | "compraIdeal"
  | "30"
  | "60"
  | "90"
  | "120"
  | "365";

/** As regras que usam o motor de curva + índice (as outras são ritmo de janela). */
export const REGRAS_CURVA: Record<string, ModoProjecao> = {
  realista: "realista",
  mais10: "mais10",
};

/**
 * Ritmo medido pela régua da COMPRA IDEAL (a mesma da Curva ABC e do "comprar agora").
 *
 * Não é regra de curva: aqui não existe comparação com o ano passado. O consumo/dia sai do
 * MAIOR trecho contínuo com estoque positivo nos últimos 12 meses (teto de 60 dias), com os
 * resgates de janela antiga e de venda recente que a Compra Ideal já aplica — e a projeção é
 * esse consumo × os dias do horizonte.
 *
 * Existe para a Projeção Compra falar a MESMA língua da decisão de compra do dia a dia: se
 * a Curva ABC diz que o item consome 1,8/dia, esta regra projeta 1,8/dia, sem sazonalidade.
 */
export const REGRA_COMPRA_IDEAL: RegraProjecao = "compraIdeal";

/** A regra da Compra Ideal precisa do detalhe por item (o ritmo é medido item a item). */
export function ehRegraCompraIdeal(regra: RegraProjecao): boolean {
  return regra === REGRA_COMPRA_IDEAL;
}

/** Ordem do select — as de curva primeiro (realista é o padrão), depois as janelas. */
export const REGRAS: RegraProjecao[] = [
  "realista",
  "mais10",
  "compraIdeal",
  "60",
  "365",
  "120",
  "90",
  "30",
];

export const REGRA_LABEL: Record<RegraProjecao, string> = {
  realista: "Projeção realista (índice YoY)",
  mais10: "Projeção conservadora (+10%)",
  compraIdeal: "Ritmo Compra Ideal (igual à Curva ABC)",
  "60": "Ritmo 60 dias",
  "365": "Ritmo 12 meses",
  "120": "Ritmo 120 dias",
  "90": "Ritmo 90 dias",
  "30": "Ritmo 30 dias",
};

/** Texto do tooltip de cada mês projetado, conforme o critério que o motor usou. */
export const CRITERIO_TEXTO: Record<CriterioMes, string> = {
  real: "Realizado",
  parado: "Escopo sem venda nos últimos meses fechados: projeta 0",
  yoy: "Mesmo mês do ano anterior × índice YoY do escopo",
  ano_passado: "Mesmo mês do ano anterior + 10%",
  sem_base: "Sem base no ano anterior naquele mês: média dos últimos meses fechados",
};

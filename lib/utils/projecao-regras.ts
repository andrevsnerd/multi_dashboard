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
  | "sazonalCategoria"
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

/**
 * Ritmo do ESCOPO × curva sazonal da CATEGORIA.
 *
 * Separa as duas perguntas que as outras regras misturam: QUANTO o item está entregando
 * (patamar, medido no próprio escopo, no ano corrente, equilibrando o ano corrido com os
 * últimos meses) e QUANDO esse volume aparece (curva, medida na categoria inteira ao longo
 * de vários anos completos). É a única regra que enxerga a alta de Nov/Dez sem depender de
 * o ano passado ter sido um ano bom — e a única que sabe dizer, em número, quanto a
 * categoria cresce naqueles dois meses.
 *
 * O crescimento contra o ano passado NÃO é multiplicado: o patamar já sai das vendas deste
 * ano. O YoY continua exibido, como leitura.
 *
 * Motor em [projecao-sazonal.ts](@/lib/utils/projecao-sazonal); a curva vem do servidor
 * (`?sazonal=1`), porque medir a categoria inteira custa 12 consultas por ano-calendário.
 */
export const REGRA_SAZONAL_CATEGORIA: RegraProjecao = "sazonalCategoria";

/** A regra sazonal precisa da curva da categoria, que só vem do servidor sob demanda. */
export function ehRegraSazonalCategoria(regra: RegraProjecao): boolean {
  return regra === REGRA_SAZONAL_CATEGORIA;
}

/** A regra da Compra Ideal precisa do detalhe por item (o ritmo é medido item a item). */
export function ehRegraCompraIdeal(regra: RegraProjecao): boolean {
  return regra === REGRA_COMPRA_IDEAL;
}

/**
 * O que o select da aba Produtos oferece.
 *
 * **Hoje só a Sazonal.** Decisão do dono (11/09/2026): ter seis réguas no select fazia duas
 * pessoas olharem a mesma tela e verem números diferentes sem perceber que tinham escolhido
 * réguas diferentes. A compra passa a ser decidida por UMA régua, e as outras ficam fora do
 * caminho.
 *
 * As demais NÃO foram removidas — o motor de cada uma continua inteiro e testado, e elas
 * voltam ao select bastando descomentar a linha. É de propósito que a lista seja o único
 * ponto de corte: `regrasDisponiveis` na tela, o quadro do "Como esta projeção é calculada"
 * e a tabela "Outras réguas" leem daqui, então descomentar devolve tudo de uma vez.
 *
 * `realista` continua sendo a régua das abas Tickets e Embalagens (ver `REGRAS_OUTRAS_ABAS`):
 * a Sazonal precisa da curva da categoria, que não existe para ticket nem para embalagem.
 */
export const REGRAS: RegraProjecao[] = [
  "sazonalCategoria",
  // "realista",
  // "mais10",
  // "compraIdeal",
  // "60",
  // "365",
  // "120",
  // "90",
  // "30",
];

/**
 * A régua das abas que não são Produtos. Ticket não é item e embalagem não tem cadastro no
 * Linx, então a Sazonal (que depende da curva da CATEGORIA) não se aplica lá — sem esta
 * lista, aquelas abas ficariam sem régua nenhuma quando o select de Produtos foi reduzido.
 */
export const REGRAS_OUTRAS_ABAS: RegraProjecao[] = ["realista"];

export const REGRA_LABEL: Record<RegraProjecao, string> = {
  sazonalCategoria: "Projeção Realista Sazonal",
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
  sazonal: "Patamar do escopo neste ano × fator sazonal da categoria naquele mês",
};

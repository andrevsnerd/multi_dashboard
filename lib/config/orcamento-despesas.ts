/**
 * Orçamento de despesas — o "Orçado" do mês para a aba "Orçamento do mês" do
 * Controle Financeiro.
 *
 * Fonte: planilha "Sme _ Budget 2027 _ vscs - COMENTADA.xlsx" (aba "SMe 2027 _ Budget"),
 * bloco de DRE do cenário BASE (linhas 41–67, colunas J..X = out/26..dez/27). Ela é a
 * visão do Hélio: não é base de nada, só lê a planilha da Débora. Por isso o orçado fica
 * aqui como DADO (mesma postura do `planejamento-receita.ts`) e o realizado sai da base
 * do Controle Financeiro, que continua sendo atualizada pela planilha da Débora.
 *
 * Cada linha diz quais lançamentos das "abas vermelhas" a compõem, transcrevendo os
 * comentários da coluna H da planilha (ex.: "ABA DRE (Linha 33) - Abertura na Aba
 * vermelha FUNCIONARIOS"). As classificações casam pela coluna J (Classificação) da aba;
 * a data é a coluna D (Data Caixa) — o próprio comentário da linha 40 manda olhar só
 * D, E, G e J.
 *
 * Fora daqui, de propósito: a TAXA DE CARTÃO (DRE linha 15). Ela não tem lançamento nas
 * abas vermelhas (sai calculada na DRE) e, como diz o comentário da linha 41, acompanha
 * a receita — receita maior faz a taxa subir sem que isso seja "estourar".
 */

export type GrupoOrcamento = "variaveis" | "operacionais" | "financeiro";

export interface LinhaOrcamento {
  key: string;
  label: string;
  grupo: GrupoOrcamento;
  /** De onde vem o realizado, como está no comentário da planilha. */
  referencia: string;
  /** Classificações (coluna J) que compõem a linha, em qualquer aba. Têm prioridade. */
  classificacoes?: string[];
  /** Abas inteiras que compõem a linha (o que nenhuma outra linha pegou pela classificação). */
  abas?: string[];
  /** Ressalva do mapeamento que ainda precisa de confirmação. */
  ressalva?: string;
  /** Orçado em reais (positivo = gasto), alinhado com MESES_ORCADO. */
  orcado: number[];
}

export const GRUPOS_ORCAMENTO: { key: GrupoOrcamento; label: string }[] = [
  { key: "variaveis", label: "Custos que acompanham a receita" },
  { key: "operacionais", label: "Despesas operacionais" },
  { key: "financeiro", label: "Financeiro, investimentos e sócios" },
];

/** Colunas J..X da planilha. */
export const MESES_ORCADO = [
  "2026-10", "2026-11", "2026-12",
  "2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06",
  "2027-07", "2027-08", "2027-09", "2027-10", "2027-11", "2027-12",
];

const repete = (v: number) => MESES_ORCADO.map(() => v);

export const LINHAS_ORCAMENTO: LinhaOrcamento[] = [
  {
    key: "impostos",
    label: "Impostos",
    grupo: "variaveis",
    referencia: "DRE linha 85 · aba Impostos",
    abas: ["Impostos"],
    ressalva: "Orçado = 13,5% da receita bruta orçada: receita maior faz o imposto subir.",
    orcado: [
      328355.78, 377562.33, 458254.8, 175034.97, 221022.84, 264543.65, 307552.17, 370127.13,
      317648.09, 332401.3, 347769.67, 308403.19, 328869.67, 395270.14, 467011.17,
    ],
  },
  {
    key: "devolucoes",
    label: "Descontos e devoluções",
    grupo: "variaveis",
    referencia: "DRE linha 56 · aba Outros (Devolução)",
    classificacoes: ["Devolução"],
    ressalva: "Mapeamento marcado na planilha como “confirmar com Hélio”.",
    orcado: [
      6080.66, 6991.9, 8486.2, 3241.39, 4093.02, 4898.96, 5695.41, 6854.21, 5882.37, 6155.58,
      6440.18, 5711.17, 6090.18, 7319.82, 8648.35,
    ],
  },
  {
    key: "cmv",
    label: "CMV (fornecedores)",
    grupo: "variaveis",
    referencia: "aba Fornecedor",
    abas: ["Fornecedor"],
    orcado: [
      682500, 582500, 350000, 463000, 541000, 424000, 663000, 741000, 624000, 863000, 1041000,
      624000, 663000, 641000, 424000,
    ],
  },
  {
    key: "folha_varejo",
    label: "Folha varejo",
    grupo: "operacionais",
    referencia: "DRE linha 33 · aba Funcionários",
    classificacoes: [
      "Folha - Varejo",
      "Horas Extras - Varejo",
      "Benefícios - Varejo",
      "Encargos - Varejo",
      "Premiações - Varejo",
      "Rescisão Contratual - Varejo",
      "Férias - Varejo",
      "Sindicato - Varejo",
    ],
    orcado: repete(285000),
  },
  {
    key: "folha_adm",
    label: "Folha ADM",
    grupo: "operacionais",
    referencia: "DRE linha 42 · aba Funcionários",
    classificacoes: [
      "Folha - ADM",
      "Horas Extras - ADM",
      "Benefícios - ADM",
      "Encargos - ADM",
      "Premiações - ADM",
      "Rescisão Contratual - ADM",
      "Férias - ADM",
      "Sindicato - ADM",
    ],
    orcado: repete(295000),
  },
  {
    key: "alugueis",
    label: "Aluguéis",
    grupo: "operacionais",
    referencia: "DRE linha 23 · aba Shoppings",
    abas: ["Shoppings"],
    orcado: repete(235000),
  },
  {
    key: "mkt",
    label: "Marketing, mídia/web, collabs e feiras",
    grupo: "operacionais",
    referencia: "DRE linhas 45–48 e 50 · aba Outros",
    classificacoes: ["Marketing", "Collab", "Web", "Desp. de Vendas Varejo", "Feiras"],
    orcado: [
      450000, 450000, 450000, 200000, 250000, 350000, 400000, 450000, 450000, 450000, 450000,
      450000, 450000, 450000, 450000,
    ],
  },
  {
    key: "fretes",
    label: "Fretes, transportes e viagens",
    grupo: "operacionais",
    referencia: "DRE linhas 51, 52, 59 e 70 · aba Outros",
    classificacoes: ["Fretes Lojas", "Fretes Corporativo", "Desp. Viagens", "Transporte / Estacionamento"],
    orcado: repete(50000),
  },
  {
    key: "comissoes",
    label: "Comissões (corp + web)",
    grupo: "operacionais",
    referencia: "DRE linha 74 · aba Outros (Comissão)",
    classificacoes: ["Comissão"],
    orcado: repete(65000),
  },
  {
    key: "outros",
    label: "Outros",
    grupo: "operacionais",
    referencia: "aba Outros, menos as classificações das linhas acima",
    abas: ["Outros"],
    orcado: repete(147495),
  },
  {
    key: "juros",
    label: "Juros de empréstimos",
    grupo: "financeiro",
    referencia: "DRE linha 90 · aba Receitas e Despesas Fin (Juros)",
    classificacoes: ["Juros"],
    orcado: [
      140000, 137200, 116620, 114287.6, 112001.85, 109761.81, 107566.57, 98961.25, 96982.02,
      93102.74, 85654.52, 83941.43, 78904.95, 63123.96, 61861.48,
    ],
  },
  {
    key: "juros_antecipacao",
    label: "Juros de antecipação",
    grupo: "financeiro",
    referencia: "DRE linha 91 · aba Receitas e Despesas Fin",
    classificacoes: ["Juros - Antecipação"],
    orcado: [
      60000, 59400, 57618, 54737.1, 55831.84, 56948.48, 52962.09, 49254.74, 45806.91, 42600.42,
      39618.39, 36845.11, 34265.95, 31867.33, 29636.62,
    ],
  },
  {
    key: "amortizacoes",
    label: "Amortizações",
    grupo: "financeiro",
    referencia: "DRE linha 102 · aba Receitas e Despesas Fin",
    classificacoes: ["Amortização"],
    orcado: [
      0, 50000, 50000, 50000, 50000, 50000, 50000, 75000, 86250, 99187.5, 114065.62, 75000,
      93750, 117187.5, 146484.38,
    ],
  },
  {
    key: "investimentos",
    label: "Investimentos (ativo fixo)",
    grupo: "financeiro",
    referencia: "DRE linha 98 · Investimento - Ativo Fixo",
    classificacoes: ["Investimento - Ativo Fixo"],
    orcado: repete(0),
  },
  {
    key: "socios",
    label: "Sócios",
    grupo: "financeiro",
    referencia: "DRE linha 96 · aba Funcionários (Distribuição - Sócios)",
    classificacoes: ["Distribuição - Sócios"],
    orcado: [...repete(165000).slice(0, -1), 765000],
  },
];

/** "2026-10" → índice em MESES_ORCADO, ou -1 se o budget não cobre o mês. */
export const indiceMesOrcado = (mes: string) => MESES_ORCADO.indexOf(mes.slice(0, 7));

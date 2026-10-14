/**
 * Controle Financeiro — mapa da planilha "Controle Financeiro - Scarf Me".
 *
 * A planilha é a FONTE: toda atualização chega como um arquivo novo com a mesma
 * estrutura. Este módulo (puro, roda no navegador e no servidor) diz como cada aba
 * vira registro no banco:
 *
 *  - abas de lançamento (Funcionários, Fornecedor, Shoppings, Impostos, Outros,
 *    Receitas e Despesas Fin, Contas a Pagar) → uma linha por lançamento;
 *  - Linx, Entrada Linx, Entradas Atacado, Entradas, Caixa Diário, Budget, Cielo →
 *    uma linha por linha da aba, com as colunas conhecidas tipadas;
 *  - DRE → uma linha por célula (rótulo × mês), com o layout das linhas guardado à parte;
 *  - qualquer outra aba (Resumo, Cadastro, Un. de Negócio, Segmentos, Plan2…) e
 *    qualquer aba NOVA que aparecer → "grade": uma linha por linha, coluna por letra.
 *
 * Nada é descartado: coluna sem mapeamento vai para `extras` com o título dela, e
 * valor que não converte para o tipo do campo (ex.: "#REF!" em Valor) também vai
 * para `extras`, sob o título da coluna. As únicas linhas puladas são as de
 * template (fórmula arrastada sem lançamento: só Status/Mês = 1900), contadas em
 * `ignoradas`.
 *
 * `base` é a identidade estável de um registro entre duas versões da planilha
 * (sem valor/status/data de caixa, que são o que muda). A comparação casa primeiro
 * registros idênticos e depois pareia o resto pela mesma base — ver store.
 */

export type TipoAba =
  | "lancamento"
  | "receita_linx"
  | "entrada_linx"
  | "entrada_atacado"
  | "entrada_banco"
  | "caixa_diario"
  | "budget"
  | "cielo"
  | "dre"
  | "grade";

export const CAMPOS_DATA = ["data_competencia", "data_caixa", "mes_competencia", "mes_caixa"] as const;
export const CAMPOS_TEXTO = [
  "descricao",
  "matriz",
  "loja",
  "classificacao",
  "forma_pgto",
  "status",
  "banco",
  "conta_contabil",
  "colecao",
  "cliente",
  "grupo",
] as const;

export type CampoData = (typeof CAMPOS_DATA)[number];
export type CampoTexto = (typeof CAMPOS_TEXTO)[number];
export type Campo = CampoData | CampoTexto | "valor";

export const ROTULO_CAMPO: Record<Campo, string> = {
  data_competencia: "Data competência",
  data_caixa: "Data caixa",
  mes_competencia: "Mês competência",
  mes_caixa: "Mês caixa",
  valor: "Valor",
  descricao: "Descrição",
  matriz: "Matriz",
  loja: "Loja / Shopping",
  classificacao: "Classificação",
  forma_pgto: "Forma de pgto",
  status: "Status",
  banco: "Banco",
  conta_contabil: "Classificação contábil",
  colecao: "Coleção",
  cliente: "Cliente",
  grupo: "Grupo",
};

export type ValorCelula = string | number | null;

export interface ColunaAba {
  /** Letra da coluna na planilha (A, B, …, AA). */
  letra: string;
  /** Título do cabeçalho como está na planilha (ou "Coluna X" quando vazio). */
  titulo: string;
  /** Campo tipado que recebe a coluna; null = vai para `extras[chave]`. */
  campo: Campo | null;
  /** Chave em `extras` (sempre preenchida: recebe também o valor cru que não converteu). */
  chave: string;
}

export interface RegistroFin {
  aba: string;
  tipo: TipoAba;
  /** Número da linha na planilha (1-based). */
  linha: number;
  base: string;
  c: Partial<Record<Campo, ValorCelula>>;
  x: Record<string, ValorCelula>;
}

export interface CelulaSolta {
  endereco: string;
  valor: ValorCelula;
}

export interface DreLinhaLayout {
  linha: number;
  bloco: string;
  rotulo: string;
  ocorrencia: number;
  formato: "moeda" | "pct" | "multiplo";
  /** Linha de título de bloco (ex.: "WEB DRE"), sem valores. */
  titulo?: boolean;
}

export interface AbaMeta {
  aba: string;
  tipo: TipoAba;
  ordem: number;
  oculta: boolean;
  titulo: string | null;
  /** Primeira data do cabeçalho da aba (as abas de lançamento trazem a data de atualização). */
  dataReferencia: string | null;
  linhaCabecalho: number | null;
  colunas: ColunaAba[];
  /** Células acima do cabeçalho (título, data, saldo inicial, contadores). */
  preambulo: CelulaSolta[];
  layout: DreLinhaLayout[] | null;
  totalRegistros: number;
  ignoradas: number;
}

export interface AbaLida extends AbaMeta {
  registros: RegistroFin[];
}

/* ------------------------------------------------------------------ helpers */

export function normalizar(s: unknown): string {
  if (s == null) return "";
  return String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function letraColuna(indice0: number): string {
  let n = indice0 + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function primeiroDoMes(iso: string | null | undefined): string | null {
  if (!iso || iso.length < 7) return null;
  return `${iso.slice(0, 7)}-01`;
}

/* ------------------------------------------------------- tipo de cada aba */

const TIPO_POR_NOME: Record<string, TipoAba> = {
  funcionarios: "lancamento",
  fornecedor: "lancamento",
  shoppings: "lancamento",
  "receitas e despesas fin": "lancamento",
  impostos: "lancamento",
  outros: "lancamento",
  "contas a pagar": "lancamento",
  linx: "receita_linx",
  "entrada linx": "entrada_linx",
  "entradas atacado": "entrada_atacado",
  entradas: "entrada_banco",
  "budget x realizado": "budget",
  cielo: "cielo",
  dre: "dre",
};

export function tipoDaAba(nome: string): TipoAba | null {
  const n = normalizar(nome);
  if (TIPO_POR_NOME[n]) return TIPO_POR_NOME[n];
  if (n.startsWith("caixa diario")) return "caixa_diario";
  return null;
}

/* ------------------------------------------------ cabeçalho → campo tipado */

type MapaCabecalho = Record<string, Campo>;

const MAPA_LANCAMENTO: MapaCabecalho = {
  "data competencia": "data_competencia",
  "data caixa": "data_caixa",
  valor: "valor",
  colecao: "colecao",
  "descricao despesa": "descricao",
  descricao: "descricao",
  observacoes: "descricao",
  matriz: "matriz",
  shopping: "loja",
  classificacao: "classificacao",
  "forma de pgto": "forma_pgto",
  status: "status",
  "mes comp.": "mes_competencia",
  "mes comp": "mes_competencia",
  "mes caixa": "mes_caixa",
  bancos: "banco",
  "classificacao contabil": "conta_contabil",
  "cassificacao contabil": "conta_contabil",
};

export interface SpecAba {
  mapa: MapaCabecalho;
  /** Cabeçalhos que identificam a linha de cabeçalho (todos têm de estar na mesma linha). */
  identifica: string[];
  /** Um registro só existe se ao menos um destes campos vier preenchido. */
  essenciais: Campo[];
  base: (c: RegistroFin["c"], r: { linha: number; x: RegistroFin["x"] }) => (ValorCelula | undefined)[];
}

const n = normalizar;

export const SPECS: Record<Exclude<TipoAba, "dre" | "grade">, SpecAba> = {
  lancamento: {
    mapa: MAPA_LANCAMENTO,
    identifica: ["valor", "status"],
    essenciais: ["data_competencia", "data_caixa", "valor", "descricao"],
    base: (c) => [
      c.data_competencia ?? c.mes_competencia,
      n(c.descricao),
      n(c.matriz),
      n(c.loja),
      n(c.classificacao),
      n(c.colecao),
    ],
  },
  receita_linx: {
    mapa: {
      "data - caixa": "data_caixa",
      "data - competencia": "data_competencia",
      "valor bruto": "valor",
      observacoes: "descricao",
      "mes - caixa": "mes_caixa",
      "mes - competencia": "mes_competencia",
      unidades: "loja",
      matriz: "matriz",
      "tipo comprador": "forma_pgto",
      cliente: "cliente",
      classificacao: "classificacao",
      status: "status",
      bancos: "banco",
      centro: "grupo",
    },
    identifica: ["valor bruto", "unidades"],
    essenciais: ["valor", "data_competencia"],
    base: (c, r) => [n(c.loja), c.data_competencia, n(c.forma_pgto), n(c.cliente), c.data_caixa ?? r.x["Data - Caixa"]],
  },
  entrada_linx: {
    mapa: {
      matriz: "matriz",
      filial: "loja",
      data_emissao: "data_competencia",
      vencimento: "data_caixa",
      valor_original: "valor",
      tipo_documento: "forma_pgto",
      administradora: "descricao",
      cliente_varejo: "cliente",
    },
    identifica: ["valor_original", "filial"],
    essenciais: ["valor", "data_competencia"],
    base: (c, r) => [
      n(c.loja),
      c.data_competencia,
      c.data_caixa ?? r.x["vencimento"],
      n(c.forma_pgto),
      n(c.descricao),
      n(c.cliente),
    ],
  },
  entrada_atacado: {
    mapa: {
      cliente: "cliente",
      conta: "banco",
      "data faturamento": "data_competencia",
      "data prevista caixa": "data_caixa",
      "valor fechado": "valor",
      "valor pipeline": "descricao",
    },
    identifica: ["cliente", "valor fechado"],
    essenciais: ["cliente", "valor"],
    base: (c) => [n(c.cliente), c.data_competencia, n(c.descricao)],
  },
  entrada_banco: {
    mapa: { data: "data_caixa", "total recebiveis": "valor" },
    identifica: ["data", "total recebiveis"],
    essenciais: ["data_caixa"],
    base: (c) => [c.data_caixa],
  },
  caixa_diario: {
    mapa: { data: "data_caixa", net: "valor" },
    identifica: ["data", "net"],
    essenciais: ["data_caixa"],
    base: (c) => [c.data_caixa],
  },
  budget: {
    mapa: { mes: "classificacao", competencia: "mes_competencia", realizado: "valor" },
    identifica: ["competencia", "realizado"],
    essenciais: ["classificacao"],
    base: (c) => [n(c.classificacao), c.mes_competencia],
  },
  cielo: {
    mapa: {
      "data competencia": "data_competencia",
      "data caixa": "data_caixa",
      "valor bruto": "valor",
      matriz: "matriz",
      shopping: "loja",
      "descricao": "descricao",
      "banco": "banco",
    },
    identifica: ["valor bruto", "data competencia"],
    essenciais: ["valor", "descricao"],
    base: (c) => [c.data_competencia, n(c.loja), n(c.descricao), c.valor],
  },
};

/**
 * Aba com nome desconhecido mas cabeçalho de lançamento (Data Competência + Valor +
 * Classificação) é tratada como lançamento: uma aba nova de despesas entra completa.
 */
export function pareceLancamento(cabecalhos: string[]): boolean {
  const set = new Set(cabecalhos.map(normalizar));
  return set.has("data competencia") && set.has("valor") && (set.has("classificacao") || set.has("descricao despesa"));
}

export function montarBase(partes: (ValorCelula | undefined)[]): string {
  return partes.map((p) => (p == null ? "" : String(p))).join("|");
}

/** Abas cujo registro é lançamento de despesa/receita financeira (drill-down da DRE). */
export const TIPOS_LANCAMENTO: TipoAba[] = ["lancamento"];

export const ROTULO_TIPO: Record<TipoAba, string> = {
  lancamento: "Lançamentos",
  receita_linx: "Receitas Linx",
  entrada_linx: "Exportação Linx",
  entrada_atacado: "Recebíveis atacado",
  entrada_banco: "Entradas por banco",
  caixa_diario: "Caixa diário",
  budget: "Budget",
  cielo: "Cielo",
  dre: "DRE",
  grade: "Grade",
};

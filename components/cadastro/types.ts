import type { MultiSelectOption } from "@/components/filters/MultiSelectFilter";

export type CompanyKey = "nerd" | "scarfme";

export type DimensaoTipo = "grupo" | "subgrupo" | "linha" | "tipo" | "griffe" | "colecao";

export interface DimensaoMeta {
  tipo: DimensaoTipo;
  label: string;
  nomeEhChave: boolean;
  maxNome: number;
  temCodigo: boolean;
  codigoUnico: boolean;
  codigoMax: number;
  codigoObrigatorio: boolean;
  temPai: boolean;
  podeCriar: boolean;
  renomeiaComUso: boolean;
}

export interface DimensaoRow {
  nome: string;
  /** Identifica o registro nas ações: o nome, ou o código quando o nome é descrição. */
  chave: string;
  codigo: string | null;
  pai: string | null;
  inativo: boolean;
  produtos: number;
  produtosEmpresa: number;
}

export interface ImpactoDimensao {
  produtos: number;
  produtosEmpresa: number;
  nomeJaExiste: boolean;
  codigoJaExiste: boolean;
  avisosCodigo: string[];
  avisosCopia: string[];
  bloqueadoPorUso: boolean;
}

export interface ResultadoDimensao {
  lote: string;
  ok: boolean;
  produtosAfetados: number;
  mensagem: string;
  avisos: string[];
}

export type TipoCampoProduto = "texto" | "dimensao" | "bool" | "inteiro" | "decimal";

export type FonteDimensao = DimensaoTipo | "unidade" | "fabricante" | "grade";

export interface CampoProdutoDef {
  campo: string;
  label: string;
  tipo: TipoCampoProduto;
  fonte?: FonteDimensao;
  max?: number;
  obrigatorio: boolean;
  somenteLeitura?: boolean;
  nota?: string;
  par?: boolean;
  massa: boolean;
}

export type ValorCampo = string | number | boolean | null;

export interface ProdutoCadastro {
  produto: string;
  valores: Record<string, ValorCampo>;
}

export interface OpcoesDimensoes {
  grupos: string[];
  subgruposPorGrupo: Record<string, string[]>;
  linhas: string[];
  tipos: string[];
  griffes: string[];
  colecoes: MultiSelectOption[];
  unidades: string[];
  grades: string[];
}

export interface ResumoCampoProduto {
  campo: string;
  label: string;
  aplicados: number;
  semMudanca: number;
  naoConfirmados: number;
  invalidos: number;
}

export interface ResultadoProdutos {
  lote: string;
  aplicados: number;
  semMudanca: number;
  naoConfirmados: number;
  invalidos: number;
  porCampo: ResumoCampoProduto[];
  erros: string[];
}

export interface HistoricoLote {
  lote: string;
  data: string;
  usuario: string;
  empresa: string;
  escopo: "DIMENSAO" | "PRODUTO";
  acao: "RENOMEAR" | "CRIAR" | "INATIVAR" | "REATIVAR" | "CAMPO";
  alteracoes: number;
  alvos: number;
  resumo: string;
  produtos: number | null;
  obs: string | null;
  reverteLote: string | null;
  revertidoPor: string | null;
  reversivel: boolean;
}

/** Valores aceitos por um campo de dimensão, já resolvidos para a UI. */
export function opcoesDoCampo(
  campo: CampoProdutoDef,
  opcoes: OpcoesDimensoes,
  grupoAtual: string
): MultiSelectOption[] {
  const simples = (v: string[]) => v.map((x) => ({ value: x, label: x }));
  switch (campo.fonte) {
    case "grupo":
      return simples(opcoes.grupos);
    // O par (grupo, subgrupo) é validado junto pela FK: os subgrupos ofertados
    // são só os que existem DENTRO do grupo escolhido.
    case "subgrupo":
      return simples(opcoes.subgruposPorGrupo[grupoAtual] ?? []);
    case "linha":
      return simples(opcoes.linhas);
    case "tipo":
      return simples(opcoes.tipos);
    case "griffe":
      return simples(opcoes.griffes);
    case "colecao":
      return opcoes.colecoes;
    case "unidade":
      return simples(opcoes.unidades);
    case "grade":
      return simples(opcoes.grades);
    default:
      return [];
  }
}

export function dataCurta(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function separarCodigos(texto: string): string[] {
  return texto
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Rótulo legível para a ação registrada no histórico. */
export const ACAO_LABEL: Record<HistoricoLote["acao"], string> = {
  RENOMEAR: "Renomear",
  CRIAR: "Criar",
  INATIVAR: "Inativar",
  REATIVAR: "Reativar",
  CAMPO: "Campos do produto",
};

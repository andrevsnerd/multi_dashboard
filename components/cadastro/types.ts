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
  temInativo: boolean;
  podeCriar: boolean;
  renomeiaComUso: boolean;
}

/** Um registro físico da mestre: no subgrupo, o par (grupo, subgrupo). */
export interface DimensaoPar {
  grupo: string;
  codigo: string | null;
  inativo: boolean;
  produtos: number;
  produtosEmpresa: number;
}

export interface DimensaoRow {
  nome: string;
  /** Identifica o registro nas ações: o nome, ou o código quando o nome é descrição. */
  chave: string;
  codigo: string | null;
  /** Grupo do subgrupo. `null` na linha agregada (o subgrupo vive em vários grupos). */
  pai: string | null;
  /** Registros físicos da linha: um par por grupo no subgrupo. Vazio nas globais. */
  pares: DimensaoPar[];
  /** `true` quando todos os pares estão inativos. */
  inativo: boolean;
  /** `true` quando só parte dos pares está inativa. */
  inativoParcial: boolean;
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
  /** Grupos que o rename vai tocar (subgrupo). */
  gruposAfetados: string[];
  /** Grupos onde o nome de destino já existe — esses bloqueiam. */
  colisoes: string[];
}

export interface ResultadoDimensao {
  lote: string;
  ok: boolean;
  produtosAfetados: number;
  gruposRenomeados: string[];
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

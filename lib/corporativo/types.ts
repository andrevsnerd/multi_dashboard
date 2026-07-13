/**
 * Tipos compartilhados da área CORPORATIVO (cadastro de clientes atacado no Linx).
 *
 * O cadastro grava em DUAS tabelas do Linx (LINX_PRODUCAO):
 *   - CADASTRO_CLI_FOR   → cadastro mestre (PK = NOME_CLIFOR; CLIFOR = código char(6) único)
 *   - CLIENTES_ATACADO   → camada atacado (condição pgto, tabela preço, filial, etc.)
 * O código (CLIFOR/COD_CLIENTE) vem da tabela SEQUENCIAIS
 * (TABELA_COLUNA = 'CLIENTES_ATACADO.CLIFOR'): novo código = SEQUENCIA + 1, com 6 dígitos.
 */

export type TipoPessoa = "PF" | "PJ";

/** Item de opção (código + descrição) para os selects do formulário. */
export interface OptionItem {
  value: string;
  label: string;
}

/** Todos os lookups do Linx que alimentam o formulário de cadastro. */
export interface CorporativoLookups {
  condicoesPgto: OptionItem[];
  tabelasPreco: OptionItem[];
  transportadoras: OptionItem[];
  regioes: OptionItem[];
  conceitos: OptionItem[];
  pontualidades: OptionItem[];
  tipos: OptionItem[];
  tiposTributacao: OptionItem[];
  indicadoresFiscais: OptionItem[];
  filiais: OptionItem[];
  /** Próximo código que SERIA gerado (apenas visualização; não reserva). */
  proximoCodigoPreview: string;
}

/** Bloco de endereço (usado para cobrança/entrega quando não espelham o principal). */
export interface EnderecoBloco {
  cep: string;
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  codMunicipioIbge: string;
  pais?: string;
}

/** Payload enviado pelo formulário para criar um cliente corporativo. */
export interface ClienteCorporativoInput {
  tipoPessoa: TipoPessoa;
  /** Razão social (PJ) ou nome completo (PF). Vai para RAZAO_SOCIAL (máx 90). */
  razaoSocial: string;
  /** Nome curto / fantasia. Vira NOME_CLIFOR (PK, máx 25). Se vazio, deriva de razaoSocial. */
  nomeFantasia?: string;
  /** CPF (11) ou CNPJ (14). Guardado só com dígitos. */
  cpfCnpj: string;
  /** RG (PF) ou Inscrição Estadual (PJ). Vazio => 'ISENTO'. */
  rgIe?: string;
  inscricaoMunicipal?: string;
  /** PJ: PRESUMIDO | REAL | SIMPLES NACIONAL. */
  tipoTributacao?: string;
  /** INDICADOR_FISCAL_TERCEIRO ("Indica Tipo 30.s"). PJ→1, PF→8 por padrão. */
  indicadorFiscal?: number;
  suframa?: string;

  // Endereço principal
  cep: string;
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  /** Código IBGE do município (obrigatório p/ NF-e). Vem do ViaCEP. */
  codMunicipioIbge: string;
  pais?: string;

  // Contato
  ddd1: string;
  telefone1: string;
  ddd2?: string;
  telefone2?: string;
  email?: string;
  emailNfe?: string;
  /** ISO date (YYYY-MM-DD) opcional. */
  aniversario?: string;

  // Cobrança / entrega (se "mesmo…" = true, espelham o principal)
  mesmoEnderecoCobranca: boolean;
  mesmoEnderecoEntrega: boolean;
  cobranca?: EnderecoBloco;
  entrega?: EnderecoBloco;

  // Comercial (CLIENTES_ATACADO)
  filial: string;
  condicaoPgto: string;
  codigoTabPreco: string;
  transportadora: string;
  regiao: string;
  conceito: string;
  tipo: string;
  pontualidade?: string;
  limiteCredito?: number;
  indicadorVenda?: string;
  matrizCliente?: string;
  observacao?: string;
}

/** Resultado da criação. */
export interface ClienteCorporativoCriado {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
}

/**
 * Payload MÍNIMO enviado pela página pública de AUTOCADASTRO (/cadastro).
 * O cliente só informa identificação, endereço, contato e credenciais de acesso.
 * Todos os dados comerciais/fiscais são padronizados no servidor (registroDefaults).
 */
export interface RegistroPublicoInput {
  tipoPessoa: TipoPessoa;
  /** Razão social (PJ) ou nome completo (PF). */
  razaoSocial: string;
  /** CPF (11) ou CNPJ (14) — só dígitos aceitos. */
  cpfCnpj: string;
  /** PJ: Inscrição Estadual (obrigatória; vazio => ISENTO). PF: ignorado (sempre ISENTO). */
  inscricaoEstadual?: string;

  // Endereço principal (usado também para cobrança e entrega).
  cep: string;
  endereco: string;
  numero: string;
  complemento?: string;
  bairro: string;
  cidade: string;
  uf: string;
  codMunicipioIbge: string;

  // Contato
  ddd1: string;
  telefone1: string;
  email?: string;

  // Acesso ao sistema (dashboard_users)
  username: string;
  password: string;
}

export type RegistroStatus = "pendente" | "aprovado" | "rejeitado";

/**
 * Cadastro corporativo PENDENTE de aprovação. O usuário do sistema já existe
 * (role cliente_corporativo), mas o cliente no Linx só é criado na aprovação.
 * `payload` guarda o ClienteCorporativoInput completo (já padronizado) para o
 * aprovador revisar/editar antes de efetivar no Linx.
 */
export interface RegistroPendente {
  id: string;
  userId: string;
  username: string;
  tipoPessoa: TipoPessoa;
  razaoSocial: string;
  cpfCnpj: string;
  status: RegistroStatus;
  /** ClienteCorporativoInput completo (padronizado) — editável na aprovação. */
  payload: ClienteCorporativoInput;
  /** CLIFOR gerado no Linx (preenchido na aprovação). */
  clienteCodigo: string | null;
  criadoEm: string;
  revisadoPor: string | null;
  revisadoEm: string | null;
  motivoRejeicao: string | null;
  /** Avisos de padronização (lookups que não casaram) capturados no cadastro. */
  avisos: string[];
}

/** Detalhe completo (mestre + comercial) de um cliente corporativo já cadastrado. */
export interface ClienteCorporativoDetalhe {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  tipoPessoa: TipoPessoa;
  rgIe: string;
  inscricaoMunicipal: string;
  tipoTributacao: string;
  indicadorFiscal: string;
  suframa: string;

  endereco: EnderecoBloco & { numero: string; complemento: string };
  cobranca: EnderecoBloco & { numero: string; complemento: string };
  entrega: EnderecoBloco & { numero: string; complemento: string };
  enderecoCobrancaIgual: boolean;
  enderecoEntregaIgual: boolean;

  ddd1: string;
  telefone1: string;
  ddd2: string;
  telefone2: string;
  email: string;
  emailNfe: string;
  aniversario: string | null;

  filial: string;
  condicaoPgto: string;
  condicaoPgtoDescricao: string;
  codigoTabPreco: string;
  codigoTabPrecoDescricao: string;
  transportadora: string;
  regiao: string;
  conceito: string;
  tipo: string;
  pontualidade: string;
  limiteCredito: number;
  indicadorVenda: string;
  matrizCliente: string;
  observacao: string;

  cadastramento: string | null;
  inativo: boolean;
}

/** Linha da listagem de clientes corporativos. */
export interface ClienteCorporativoListItem {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  tipoPessoa: TipoPessoa;
  cidade: string;
  uf: string;
  telefone: string;
  email: string;
  filial: string;
  tipo: string;
  cadastramento: string | null;
  inativo: boolean;
}

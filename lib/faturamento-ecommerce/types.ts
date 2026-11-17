import type { EmpresaFat } from "./config";

export interface Opcao {
  value: string;
  label: string;
}

export interface FatLookups {
  empresa: EmpresaFat;
  /** Filiais emissoras da empresa, com a série e o último número usado. */
  filiaisNota: { filial: string; serie: string; ultimoNumero: string; uf: string }[];
  /** Filial emissora sugerida (no rodízio da Scarf Me, a que emitiu por último). */
  filialNotaPadrao: string;
  naturezas: Opcao[];
  condicoesPgto: Opcao[];
  tabelasPreco: Opcao[];
  transportadoras: Opcao[];
  tiposFrete: Opcao[];
  conceitos: Opcao[];
  pontualidades: Opcao[];
  tiposCliente: Opcao[];
  filiaisCliente: Opcao[];
  representantes: Opcao[];
  regioes: Opcao[];
  infoPgto: Opcao[];
  proximoCodigoCliente: string;
  /** Função do usuário pode gravar no Linx (preenchido pela rota). */
  podeGravar?: boolean;
}

export interface EnderecoFat {
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  codMunicipioIbge: string;
}

export interface ClienteFatListItem {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  cidade: string;
  uf: string;
  filial: string;
  tipo: string;
  cadastramento: string | null;
  /** Última NF emitida para o cliente (qualquer filial). */
  ultimaNf: string | null;
  ultimaNfFilial: string | null;
  ultimaNfEmissao: string | null;
}

export interface ClienteFatDetalhe {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  pessoaJuridica: boolean;
  rgIe: string;
  indicadorFiscal: string;
  endereco: EnderecoFat;
  enderecoEntregaDiferente: boolean;
  ddd: string;
  telefone: string;
  email: string;
  emailNfe: string;
  filial: string;
  tipo: string;
  conceito: string;
  pontualidade: string;
  transportadora: string;
  condicaoPgto: string;
  codigoTabPreco: string;
  contaContabil: string;
  regiao: string;
  representante: string;
  cadastramento: string | null;
}

export interface ClienteFatInput {
  razaoSocial: string;
  /** Opcional: nome curto (25). Vazio = 25 primeiros caracteres da razão. */
  nomeClifor?: string;
  cpfCnpj: string;
  rgIe?: string;
  endereco: EnderecoFat;
  ddd?: string;
  telefone?: string;
  email?: string;
  emailNfe?: string;
  filial?: string;
  tipo?: string;
  conceito?: string;
  pontualidade?: string;
  transportadora?: string;
  condicaoPgto?: string;
  codigoTabPreco?: string;
  contaContabil?: string;
  regiao?: string;
  representante?: string;
  /** Cadastrar mesmo existindo outro cliente com o mesmo CPF. */
  forcar?: boolean;
}

export interface ClienteAtualizacaoInput {
  endereco: EnderecoFat;
  ddd?: string;
  telefone?: string;
  email?: string;
  emailNfe?: string;
  regiao?: string;
}

export interface ProdutoFatOpcao {
  produto: string;
  descricao: string;
  cor: string;
  descCor: string;
  /** Posição na grade (1..48). */
  tamanho: number;
  tamanhoLabel: string;
  codigoBarra: string | null;
  preco: number;
  estoque: number | null;
}

export interface NotaItemInput {
  produto: string;
  cor: string;
  tamanho: number;
  qtde: number;
  preco: number;
}

export interface NotaInput {
  empresa: EmpresaFat;
  filial: string;
  natureza: string;
  clienteCodigo: string;
  condicaoPgto: string;
  tipoFrete: string;
  transportadora: string;
  transpRedespacho: string;
  frete: number;
  seguro: number;
  /** "percentual" grava PORC_DESCONTO digitado; "valor" grava o valor e calcula o %. */
  descontoModo: "percentual" | "valor";
  descontoPercentual: number;
  descontoValor: number;
  pesoLiquido: number;
  pesoBruto: number;
  volumes: number;
  tipoVolume: string;
  infoPgto: string;
  /** FATURAMENTO.OBS — nº do pedido do site (#1710). */
  obs: string;
  itens: NotaItemInput[];
  /** Faturar mesmo havendo NF com o mesmo nº de pedido do site na OBS. */
  confirmarDuplicidade?: boolean;
}

export interface NotaPreviewItem {
  produto: string;
  cor: string;
  descCor: string;
  tamanho: number;
  tamanhoLabel: string;
  codigoItem: string;
  descricao: string;
  qtde: number;
  preco: number;
  valor: number;
  ncm: string;
  cfop: string;
  csosn: string;
  excecao: number | null;
  excecaoDescricao: string;
  estoque: number | null;
}

export interface NotaPreview {
  filial: string;
  serie: string;
  proximoNumero: string;
  natureza: string;
  naturezaDescricao: string;
  cliente: { codigo: string; nome: string; razao: string; uf: string; cidade: string };
  itens: NotaPreviewItem[];
  subtotal: number;
  descontoPercentual: number;
  desconto: number;
  frete: number;
  seguro: number;
  total: number;
  qtdeTotal: number;
  /** Impedem a gravação. */
  bloqueios: string[];
  /** Só avisam. */
  avisos: string[];
}

export interface NotaCriada {
  filial: string;
  nf: string;
  serie: string;
  chave: string;
  pedido: string;
  total: number;
  simulacao: boolean;
}

export interface NotaListItem {
  filial: string;
  nf: string;
  serie: string;
  emissao: string | null;
  cliente: string;
  natureza: string;
  valor: number;
  qtde: number;
  status: number;
  logStatus: number;
  statusLabel: string;
  tom: "neutro" | "ok" | "alerta" | "erro";
  chave: string;
  protocolo: string;
  dataAutorizacao: string | null;
  obs: string;
  cancelada: boolean;
  /** Motivo da última rejeição/erro registrado no envio (quando houver). */
  mensagem: string | null;
}

export interface NotaDetalheItem {
  produto: string;
  cor: string;
  descricao: string;
  qtde: number;
  preco: number;
  valor: number;
  cfop: string;
}

export interface NotaDetalhe extends NotaListItem {
  cpfCnpj: string;
  uf: string;
  cidade: string;
  condicaoPgto: string;
  transportadora: string;
  tipoFrete: string;
  subtotal: number;
  desconto: number;
  frete: number;
  seguro: number;
  pesoLiquido: number;
  pesoBruto: number;
  volumes: number;
  tipoVolume: string;
  infoPgto: string;
  temXml: boolean;
  itens: NotaDetalheItem[];
}

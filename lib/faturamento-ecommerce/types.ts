import type { EmpresaFat } from "./config";

export interface Opcao {
  value: string;
  label: string;
}

export interface FatLookups {
  empresa: EmpresaFat;
  /**
   * Filiais emissoras da empresa, com a série e o último número usado. A principal
   * (a que emitiu NF de e-commerce por último) vem primeiro.
   */
  filiaisNota: FilialNotaOpcao[];
  /** Filial principal (regra do rodízio: a que emitiu NF de e-commerce por último). */
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
  /** Naturezas que cada filial emissora já usou, com contagens e padrões (catalogo.ts). */
  catalogo: CatalogoNotas;
  /** Função do usuário pode gravar no Linx (preenchido pela rota). */
  podeGravar?: boolean;
}

export interface FilialNotaOpcao {
  filial: string;
  serie: string;
  ultimoNumero: string;
  uf: string;
  ultimaEmissao: string | null;
  /** Fora do rodízio do e-commerce (ex.: Matriz da Scarf Me) — nunca vira a principal. */
  extra: boolean;
  rotulo: string | null;
  /** Simples Nacional (pernas do e-commerce). A Matriz é regime normal (ICMS/PIS/COFINS), declarado no config. */
  simples: boolean;
  naturezaDentroUf: string;
  naturezaForaUf: string;
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
  /** O cliente é uma filial/loja do grupo (NF de abastecimento: 100.08 da Matriz). */
  ehFilial?: boolean;
}

export interface ClienteFatInput {
  /** WEB (padrão) ou CORPORATIVO — PERFIS_CLIENTE_PF. */
  perfil?: string;
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

/**
 * Cadastro PJ (CNPJ) — fluxo separado do cadastro de pessoa física do site, com perfil
 * WEB ou CORPORATIVO (PERFIS_CLIENTE_PJ). Tudo editável; vazio = padrão do perfil /
 * de PADROES[e].clientePj.
 */
export interface ClientePjFatInput {
  /** WEB (padrão) ou CORPORATIVO — define indicador de venda e agrupamento de itens. */
  perfil?: string;
  cnpj: string;
  razaoSocial: string;
  /** Nome no Linx (NOME_CLIFOR, 25). Vazio = 25 primeiros caracteres da razão social. */
  nomeFantasia?: string;
  /** Vazio = ISENTO. */
  inscricaoEstadual?: string;
  indicadorFiscal?: string;
  tipoTributacao?: string;
  inscricaoMunicipal?: string;
  suframa?: string;
  endereco: EnderecoFat;
  /** null = igual ao principal. */
  cobranca?: EnderecoFat | null;
  entrega?: EnderecoFat | null;
  ddd?: string;
  telefone?: string;
  ddd2?: string;
  telefone2?: string;
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
  limiteCredito?: number;
  observacao?: string;
  /** Cadastrar mesmo existindo outro cliente com o mesmo CNPJ. */
  forcar?: boolean;
}

/** Dados da BrasilAPI para autopreencher o cadastro PJ. */
export interface CnpjConsulta {
  razaoSocial: string;
  nomeFantasia: string;
  cep: string;
  endereco: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  ddd: string;
  telefone: string;
  email: string;
  situacao: string;
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
  /**
   * Linha da NF (como foi digitada no form do Linx: uma linha = um produto × cor com seus
   * tamanhos). Itens com o mesmo número formam uma linha só. Vazio = uma linha por produto × cor
   * (como saem 99% das NFs).
   */
  linha?: number;
  /** FATURAMENTO_ITEM.OBS_ITEM — observação do item (vai no XML como informação adicional do produto). */
  obs?: string;
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
  /**
   * Desconto na condição de pagamento (2º desconto do form do Linx, sobre o valor já com o 1º):
   * em % (valor = base × % truncado) ou em R$ (% gravado = valor ÷ base, arredondado).
   */
  descontoCondModo?: "percentual" | "valor";
  descontoCondPercentual?: number;
  descontoCondValor?: number;
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
  /**
   * FATURAMENTO.INDICA_CONSUMIDOR_FINAL. Vazio = o mais comum no histórico para a natureza e o
   * indicador fiscal do cliente (catálogo). Na 100.01 é escolha de quem emite.
   */
  consumidorFinal?: boolean;
  /**
   * FATURAMENTO.AGRUPAMENTO_ITENS (opção do form do Linx): 2 = um item fiscal por produto × cor ×
   * tamanho (padrão, ~99% das NFs); 1 = por produto × cor; 0 = por produto; 3/4/5 = 0/1/2 com o nº
   * do pedido na frente do código e da descrição do item.
   */
  agrupamento?: 0 | 1 | 2 | 3 | 4 | 5;
  /** Exportação (cliente UF EX, 100.71): UF e local de embarque. Vazio = SP / Aeroporto de Guarulhos. */
  ufEmbarque?: string;
  localEmbarque?: string;
}

/** Padrões de cabeçalho de uma natureza (o valor mais comum nas NFs reais). */
export interface PadroesNatureza {
  condicaoPgto: string | null;
  tipoFrete: string | null;
  transportadora: string | null;
  transpRedespacho: string | null;
  infoPgto: string | null;
  tipoVolume: string | null;
  codTransacao: string | null;
  /** Tabela de preço do pedido quando o cliente não tem a dele (100.08 → 97, a de transferência). */
  tabPreco: string | null;
}

/**
 * Uma natureza que a filial já emitiu (desde 01/01/2025, sem contar NF para filial do grupo).
 * A tela oferece só estas; `validada` = o gravador já reproduziu NFs reais dela centavo a centavo.
 */
export interface NaturezaCatalogo {
  natureza: string;
  descricao: string;
  /** NATUREZAS_SAIDAS.TIPO_OPERACAO: V venda, R remessa, O outras. O padrão automático é sempre venda. */
  tipoOperacao: string;
  nfs: number;
  validada: boolean;
  /**
   * NF para loja/filial do próprio grupo (abastecimento, 100.08) ou para cliente. A mesma natureza
   * pode aparecer nos dois destinos, cada um com seus padrões; o padrão do cliente nunca é
   * escolhido entre as de filial, e vice-versa.
   */
  destino: "cliente" | "filial";
  /** Contagem por "indicador fiscal|dentro|fora" do cliente — escolhe o padrão para o cliente. */
  porClasse: Record<string, number>;
  /** Consumidor final mais comum por indicador fiscal ("8": true…) e no geral ("*"). */
  consumidorFinal: Record<string, boolean>;
  padroes: PadroesNatureza;
}

/** Catálogo por filial emissora (nome vivo no Linx). */
export type CatalogoNotas = Record<string, NaturezaCatalogo[]>;

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
  /** Desconto na condição de pagamento (2º desconto) e o % gravado. */
  descontoCond: number;
  descontoCondPercentual: number;
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

// ── Importação do Shopify ───────────────────────────────────────────────────

export interface PedidoShopifyResumo {
  nome: string;
  criadoEm: string;
  cliente: string;
  cidade: string;
  uf: string;
  total: number;
  pecas: number;
  pagamento: string;
  fulfillment: string;
  /** NFs (não canceladas) com este nº de pedido na OBS; `provavel` = achada por CPF + valor. */
  notas: { filial: string; nf: string; provavel?: boolean }[];
}

export interface ClienteCandidato {
  codigo: string;
  nomeClifor: string;
  razaoSocial: string;
  cpfCnpj: string;
  cep: string;
  numero: string;
  cidade: string;
  uf: string;
  filial: string;
  /** "mesmo CPF", "nome parecido e mesmo CEP", "nome parecido". */
  motivo: string;
  forte: boolean;
  /** CEP ou número diferentes do endereço do pedido. */
  enderecoDifere: boolean;
}

export interface ItemImportado {
  produto: string;
  cor: string;
  tamanho: number;
  qtde: number;
  preco: number;
  descricao: string;
  descCor: string;
  tamanhoLabel: string;
  estoque: number | null;
  /** De onde veio o vínculo Shopify → Linx. */
  origem: string;
  /** Vínculo só sugerido no mapeamento (conferir). */
  conferir: boolean;
  tituloShopify: string;
  /** Preço da tabela 01 no Linx (para avisar quando difere do preço do site). */
  precoLinx: number | null;
  /** Item de preço zero no site (brinde): vai a R$ 0,01. */
  brinde: boolean;
}

export interface LinhaNaoMapeada {
  titulo: string;
  sku: string | null;
  qtde: number;
  preco: number;
  desconto: number;
  motivo: string;
}

export interface PedidoShopifyImport {
  nome: string;
  criadoEm: string;
  pagamento: string;
  /** Dados do cliente prontos para o cadastro (endereço já enriquecido pelo CEP). */
  cliente: ClienteFatInput & { telefoneOriginal: string; enderecoOriginal: string };
  candidatos: ClienteCandidato[];
  itens: ItemImportado[];
  naoMapeados: LinhaNaoMapeada[];
  subtotalShopify: number;
  descontoItens: number;
  frete: number;
  totalShopify: number;
  notas: { filial: string; nf: string; provavel?: boolean }[];
}

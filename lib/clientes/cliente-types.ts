export interface ClienteRankingItem {
  nomeCliente: string;
  /** Igual a nome para cadastrados; para sem cadastro: SEM_CAD_{filial}_{pedido}_{ticket} */
  chaveCliente: string;
  totalGasto: number;
  tickets: number;
  cpf?: string;
}

export interface ClienteDetalheInfo {
  nomeCliente: string;
  telefone: string;
  cpf: string;
  endereco: string;
  cidade: string;
  vendedores: string[];
  /** Venda sem nome no pedido / sem cadastro em CLIENTES_VAREJO (detalhe só da venda). */
  semCadastroNoCaixa?: boolean;
}

export interface ClienteCompraDetalheItem {
  dataCompra: Date;
  ticket: string;
  produto: string;
  codigo: string;
  quantidade: number;
  valor: number;
  filial: string;
  /** Vendedor da venda (quem atendeu / não cadastrou o cliente no caixa). */
  vendedor: string;
}

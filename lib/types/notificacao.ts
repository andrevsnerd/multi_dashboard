/**
 * Tipos compartilhados do sistema de notificações.
 *
 * Hoje só existe um tipo de notificação ("saida_destinada"), mas o modelo já
 * nasce extensível: novos tipos entram em `NotificacaoTipo` e na fonte
 * canônica (lib/server/notificacoes-saidas.ts e futuros módulos).
 *
 * A `key` é estável e determinística por evento — isso permite:
 *   - marcar leitura por usuário sem duplicar;
 *   - no futuro, a "trava" de lojas que não confirmaram entradas pode reusar
 *     a mesma fonte de pendências (ver SaidaPendente) e a mesma key.
 */

export type NotificacaoTipo = "saida_destinada";

/**
 * Pendência crua de saída destinada a uma filial (sem estado de leitura).
 * É a fonte de verdade reutilizável: notificações E futura trava bebem daqui.
 */
export interface SaidaPendente {
  /** Chave estável: `saida:{company}:{romaneio}:{destinoCodigo}` */
  key: string;
  tipo: NotificacaoTipo;
  company: string;
  romaneio: string;
  filialOrigem: string;
  /** Nome (display) do destino. */
  filialDestino: string;
  /** Código ativo do destino (canônico, via getActiveFilial). */
  destinoCodigo: string;
  dataEmissao: string;
  responsavel: string;
  tipoRomaneio: string;
  qtdProdutos: number;
  qtdItens: number;
  qtdConfirmados: number;
}

/**
 * Notificação pronta para a UI: pendência + estado de leitura do usuário +
 * link direto para o detalhe do romaneio (onde a entrada é confirmada).
 */
export interface Notificacao extends SaidaPendente {
  /** Lida pelo usuário (controla o badge do sino). */
  lida: boolean;
  /** Link pronto para o detalhe do romaneio (mesma URL da lista de romaneios). */
  href: string;
}

export interface NotificacoesResponse {
  data: Notificacao[];
  /** Quantidade de notificações ainda não lidas (badge do sino). */
  naoLidas: number;
}

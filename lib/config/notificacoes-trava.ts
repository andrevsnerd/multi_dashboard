/**
 * Constantes da TRAVA de confirmação de entradas (popup bloqueante).
 *
 * Módulo PURO (sem dependências de server/fs/db) para poder ser importado tanto
 * pelo server (lib/server/notificacoes-saidas.ts) quanto por componentes client
 * (NotificationGate) sem vazar código de servidor para o bundle do cliente.
 *
 * - TRAVA_DATA_INICIO: só saídas emitidas a partir desta data contam. Antes
 *   disso há entradas antigas já corrigidas via ajuste/inventário.
 * - TRAVA_DIAS_MINIMOS: carência. Saídas com menos dias que isso não bloqueiam,
 *   dando tempo para a loja receber fisicamente o produto.
 */
export const TRAVA_DATA_INICIO = new Date("2026-06-01T00:00:00");
export const TRAVA_DIAS_MINIMOS = 7;

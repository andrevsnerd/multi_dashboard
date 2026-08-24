import {
  getDefeitoFilial,
  isFilialDefeito,
  isFilialEspecial,
} from '@/lib/config/filiais-especiais';
import {
  fetchRomaneioDefeitoDoDia,
  type RomaneioDefeitoDoDia,
} from '@/lib/repositories/logSaidas';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA DE DEFEITO — UM romaneio de saída de defeito por filial por dia.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Regra do dono: a loja junta os defeitos do dia e manda UM romaneio só. Antes
 * disso, gerente abria um romaneio por peça — vários romaneios de 1 item por
 * dia, inviável de conferir na chegada em NERD DEFEITOS / BAZAR SCARF ME.
 *
 * A trava é de SAÍDA e vale para o par (filial de origem, dia). Não mexe em
 * entrada, transferência entre lojas, ajuste nem SAÍDA MKT.
 *
 * Fonte da verdade é o ERP (`ESTOQUE_PROD_SAI`), não o dashboard: se o romaneio
 * for excluído, o dia libera de novo; se for cancelado em `LOJA_SAIDAS`, não conta.
 */

/** `admin` passa por cima da trava (correção/exceção operacional). */
export function podeIgnorarTravaDefeito(role: string | null | undefined): boolean {
  return (role || '').trim().toLowerCase() === 'admin';
}

/** Normaliza tipo de romaneio: maiúsculo, sem espaço extra. */
function normalizaTipo(value: string | null | undefined): string {
  return (value || '').toUpperCase().trim().replace(/\s+/g, ' ');
}

/** True se o tipo de romaneio é DEFEITO. */
export function isTipoRomaneioDefeito(tipoRomaneio: string | null | undefined): boolean {
  return normalizaTipo(tipoRomaneio) === 'DEFEITO';
}

/**
 * True se a saída é de defeito — pelo TIPO de romaneio OU pelo destino ser a
 * filial de defeito. Mesmo recorte usado por `fetchDefeitos` e pela query da
 * trava, para o bloqueio nunca discordar do relatório.
 */
export function isSaidaDeDefeito(params: {
  companyKey?: string | null;
  tipoRomaneio?: string | null;
  filialDestino?: string | null;
}): boolean {
  if (isTipoRomaneioDefeito(params.tipoRomaneio)) return true;
  const destino = (params.filialDestino || '').trim();
  if (!destino) return false;
  return params.companyKey
    ? isFilialDefeito(params.companyKey, destino)
    : isFilialEspecial(destino);
}

/**
 * Romaneio de defeito já emitido hoje pela filial, ou null se o dia está livre.
 */
export async function buscarDefeitoDoDia(
  companyKey: string | null | undefined,
  filialOrigem: string
): Promise<RomaneioDefeitoDoDia | null> {
  const filial = (filialOrigem || '').trim();
  if (!filial) return null;
  return fetchRomaneioDefeitoDoDia({
    filialOrigem: filial,
    defeitoFilialDestino: getDefeitoFilial(companyKey) ?? null,
  });
}

/** "14:32" a partir do `EMISSAO` do banco (string local, sem converter fuso). */
function horaDaEmissao(dataEmissao: string): string {
  const match = /T(\d{2}):(\d{2})/.exec(dataEmissao || '');
  return match ? `${match[1]}:${match[2]}` : '';
}

/** Mensagem única do bloqueio — usada na API e ecoada na tela. */
export function mensagemTravaDefeito(existente: RomaneioDefeitoDoDia): string {
  const hora = horaDaEmissao(existente.dataEmissao);
  const partes = [
    `Já existe romaneio de DEFEITO hoje nesta filial: #${existente.romaneio}`,
    hora ? ` (${hora}` : '',
    hora ? `, ${existente.qtdProdutos} produto(s) / ${existente.qtdItens} item(ns))` : '',
  ].join('');
  return (
    `${partes}. É permitido apenas UM romaneio de defeito por dia por filial: ` +
    `junte todas as peças com defeito no mesmo romaneio e envie o próximo amanhã.`
  );
}

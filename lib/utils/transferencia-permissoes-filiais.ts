/**
 * ════════════════════════════════════════════════════════════════════════════
 *  FILIAIS DE OPERAÇÃO DE UM USUÁRIO — fonte única
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Um usuário opera na `filialAtribuida` MAIS as `filiaisAdicionais`.
 * As adicionais existem para o caso da logística: além da própria filial, ela
 * recebe/confirma os romaneios de DEFEITO, cujo destino é uma filial fora do
 * registry (NERD DEFEITOS / BAZAR SCARF ME).
 *
 * Todo filtro/gate por filial deve usar estas funções, para que a filial
 * adicional valha em TODOS os lugares (listas de romaneios, confirmação de
 * entrada, saída/entrada direta) e não só em um deles.
 */

import { getActiveFilial, type CompanyConfig } from '@/lib/config/company';
import type { TransferenciaPermissao } from '@/lib/utils/transferencia-permissoes-store';

/** Permissão reduzida ao que interessa aqui (facilita usar no cliente também). */
export type PermissaoFiliais = Pick<
  TransferenciaPermissao,
  'filialAtribuida' | 'filiaisAdicionais'
>;

/** Normaliza nome/código de filial para comparação (caixa e espaços duplicados — ver Galeão RJ). */
export function normalizeFilialCmp(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Filiais em que o usuário opera: a atribuída + as adicionais, já resolvidas
 * para a canônica ativa (rodízio de grupo) e normalizadas em MAIÚSCULAS.
 *
 * Lista vazia = sem filial atribuída → o chamador trata como "vê tudo",
 * mantendo o comportamento que já existia com `filialAtribuida` sozinha.
 * "TODAS" continua saindo como "TODAS" (mesma semântica de antes).
 */
export function filiaisDeOperacao(
  permissao: PermissaoFiliais | null | undefined,
  companyConfig: CompanyConfig | null | undefined
): string[] {
  const result: string[] = [];

  const add = (value: string | null | undefined) => {
    const raw = (value || '').trim();
    if (!raw) return;
    const canonica = normalizeFilialCmp(getActiveFilial(companyConfig, raw));
    if (canonica && !result.includes(canonica)) result.push(canonica);
  };

  add(permissao?.filialAtribuida);
  for (const filial of permissao?.filiaisAdicionais ?? []) add(filial);

  return result;
}

/**
 * True se o usuário NÃO tem restrição de filial (sem filial atribuída ou "TODAS").
 * Uma filial adicional sozinha não libera tudo — ela só acrescenta uma filial.
 */
export function verTodasAsFiliais(
  permissao: PermissaoFiliais | null | undefined,
  companyConfig: CompanyConfig | null | undefined
): boolean {
  const filiais = filiaisDeOperacao(permissao, companyConfig);
  return filiais.length === 0 || filiais.includes('TODAS');
}

/** True se `filial` é uma das filiais onde o usuário opera (atribuída ou adicional). */
export function operaNaFilial(
  permissao: PermissaoFiliais | null | undefined,
  companyConfig: CompanyConfig | null | undefined,
  filial: string | null | undefined
): boolean {
  const alvo = normalizeFilialCmp(getActiveFilial(companyConfig, (filial || '').trim()));
  if (!alvo) return false;
  return filiaisDeOperacao(permissao, companyConfig).includes(alvo);
}

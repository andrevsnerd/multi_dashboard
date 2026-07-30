/**
 * ════════════════════════════════════════════════════════════════════════════
 *  FILIAIS ESPECIAIS — existem no Linx, mas ficam FORA do registry de filiais.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Não entram em `lib/config/filial-registry.ts` de propósito: não são lojas,
 * então não aparecem em vendas, estoque, colunas por filial nem nos filtros
 * operacionais (`filialFilters`).
 *
 * Hoje só existe uma categoria: a filial de DEFEITO de cada empresa, usada como
 * DESTINO dos romaneios de saída do tipo "DEFEITO" (a loja manda o defeito pra lá).
 * Esta é a fonte única do nome — antes ele estava duplicado em 3 arquivos.
 */

/** Nome (FILIAL no Linx) da filial de defeito de cada empresa. */
export const DEFEITO_FILIAL_POR_EMPRESA: Record<string, string> = {
  nerd: 'NERD DEFEITOS',
  scarfme: 'BAZAR SCARF ME',
};

/** Nome da filial de defeito da empresa, ou undefined se a empresa não tem uma. */
export function getDefeitoFilial(companyKey: string | null | undefined): string | undefined {
  return DEFEITO_FILIAL_POR_EMPRESA[(companyKey || '').trim().toLowerCase()];
}

/** Compara nomes de filial tolerando caixa e espaços duplicados (ver Galeão RJ). */
function normalizeNome(value: string | null | undefined): string {
  return (value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/** True se `filial` é a filial de defeito da empresa informada. */
export function isFilialDefeito(
  companyKey: string | null | undefined,
  filial: string | null | undefined
): boolean {
  const defeito = getDefeitoFilial(companyKey);
  if (!defeito) return false;
  const alvo = normalizeNome(filial);
  return !!alvo && alvo === normalizeNome(defeito);
}

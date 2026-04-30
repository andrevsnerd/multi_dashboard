import 'server-only';

import { resolveCompany, type CompanyConfig } from './company';
import {
  listFilialGruposByCompany,
  buildDerivedFilialConfig,
} from '@/lib/utils/filial-grupos-store';

/**
 * Versão server-only de resolveCompany que mescla a config estática com os
 * grupos dinâmicos gerenciados pelo painel admin.
 * Use esta função em API routes e Server Components operacionais.
 */
export async function resolveCompanyDynamic(
  company?: string
): Promise<CompanyConfig | null> {
  const base = resolveCompany(company);
  if (!base) return null;

  try {
    const grupos = await listFilialGruposByCompany(base.key);
    if (grupos.length === 0) return base;

    const { filialGroups, activeFilials } = buildDerivedFilialConfig(grupos);
    const filialDisplayNames = grupos.reduce<Record<string, string>>((acc, grupo) => {
      for (const member of grupo.members) {
        acc[member] = grupo.label;
      }
      acc[grupo.active] = grupo.label;
      return acc;
    }, {});

    return {
      ...base,
      filialGroups: { ...base.filialGroups, ...filialGroups },
      activeFilials: { ...base.activeFilials, ...activeFilials },
      filialDisplayNames: { ...base.filialDisplayNames, ...filialDisplayNames },
    };
  } catch {
    return base;
  }
}

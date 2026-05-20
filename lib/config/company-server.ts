import 'server-only';

import { resolveCompany, type CompanyConfig } from './company';
import {
  listFilialGruposByCompany,
  buildDerivedFilialConfig,
} from '@/lib/utils/filial-grupos-store';
import { detectActiveFilials } from '@/lib/utils/active-filial-detector';

/**
 * Versão server-only de resolveCompany que mescla a config estática com os
 * grupos dinâmicos gerenciados pelo painel admin.
 * O campo `active` de cada grupo é resolvido automaticamente pela venda mais
 * recente entre os membros (com cache de 5min); fallback para o active configurado.
 */
export async function resolveCompanyDynamic(
  company?: string
): Promise<CompanyConfig | null> {
  const base = resolveCompany(company);
  if (!base) return null;

  try {
    const grupos = await listFilialGruposByCompany(base.key);
    if (grupos.length === 0) return base;

    // Detecta a filial ativa de cada grupo pela venda mais recente
    const detectedActives = await detectActiveFilials(
      grupos,
      base.ecommerceFilials ?? []
    );

    // Substitui o campo active de cada grupo pelo detectado
    const gruposComAtivo = grupos.map((g) => ({
      ...g,
      active: detectedActives.get(g.id) ?? g.active,
    }));

    const { filialGroups, activeFilials } = buildDerivedFilialConfig(gruposComAtivo);
    const filialDisplayNames = gruposComAtivo.reduce<Record<string, string>>((acc, grupo) => {
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

import 'server-only';

import { type CompanyConfig } from './company';
import { resolveCompanyLive, liveNameForFilialRef, liveNamesForFilialRefs, idForFilialRef } from '@/lib/server/company-live';
import {
  listFilialGruposByCompany,
  buildDerivedFilialConfig,
} from '@/lib/utils/filial-grupos-store';
import { detectActiveFilials } from '@/lib/utils/active-filial-detector';

/**
 * Versão server-only de resolveCompany que mescla a config (com NOMES VIVOS do
 * banco, via resolveCompanyLive) com os grupos dinâmicos gerenciados pelo painel
 * admin. Os nomes dos membros/ativa dos grupos do admin são normalizados para o
 * nome vivo do banco (match por COD_FILIAL), de forma que um rename no ERP não
 * quebre o reconhecimento dos grupos.
 *
 * O campo `active` de cada grupo é resolvido automaticamente pela venda mais
 * recente entre os membros (com cache de 5min); fallback para o active configurado.
 */
export async function resolveCompanyDynamic(
  company?: string
): Promise<CompanyConfig | null> {
  const base = await resolveCompanyLive(company);
  if (!base) return null;

  try {
    const grupos = await listFilialGruposByCompany(base.key);
    if (grupos.length === 0) return base;

    // Resolve membros/ativa dos grupos do admin — que podem ser COD_FILIAL (novo)
    // ou nome (legado) — para o nome vivo do banco.
    const gruposVivos = await Promise.all(
      grupos.map(async (g) => ({
        ...g,
        members: (await liveNamesForFilialRefs(g.members)) ?? g.members,
        active: (await liveNameForFilialRef(g.active)) ?? g.active,
      }))
    );

    // Detecta a filial ativa de cada grupo pela venda mais recente
    const detectedActives = await detectActiveFilials(
      gruposVivos,
      base.ecommerceFilials ?? []
    );

    // Substitui o campo active de cada grupo pelo detectado
    const gruposComAtivo = gruposVivos.map((g) => ({
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

/**
 * Detecta a filial ATIVA (canônica) de cada grupo da empresa pela venda/emissão mais
 * recente entre os membros — a MESMA regra usada por `resolveCompanyDynamic` (e, portanto,
 * pelo dashboard). Retorna Map de groupId → COD_FILIAL detectado.
 *
 * Usado pelo painel admin de Grupos de Filiais para exibir a canônica VIVA (ex.: rodízio
 * MSC↔AKS do e-commerce), em vez do `active` estático salvo/registry, que fica defasado
 * quando o rodízio vira. Em caso de falha, o detector já cai no active configurado.
 */
export async function detectActiveFilialIdsByCompany(
  company?: string
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const base = await resolveCompanyLive(company);
  if (!base) return out;

  const grupos = await listFilialGruposByCompany(base.key);
  if (grupos.length === 0) return out;

  const gruposVivos = await Promise.all(
    grupos.map(async (g) => ({
      ...g,
      members: (await liveNamesForFilialRefs(g.members)) ?? g.members,
      active: (await liveNameForFilialRef(g.active)) ?? g.active,
    }))
  );

  const detectedActives = await detectActiveFilials(
    gruposVivos,
    base.ecommerceFilials ?? []
  );

  // detectActiveFilials devolve NOMES vivos; converte de volta para COD_FILIAL.
  for (const [gid, name] of detectedActives) {
    const id = await idForFilialRef(name);
    if (id) out.set(gid, id);
  }

  return out;
}

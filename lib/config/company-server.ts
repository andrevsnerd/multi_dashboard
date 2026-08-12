import 'server-only';

import { type CompanyConfig } from './company';
import { resolveCompanyLive, liveNameForFilialRef, liveNamesForFilialRefs, idForFilialRef } from '@/lib/server/company-live';
import {
  listFilialGruposByCompany,
  buildDerivedFilialConfig,
  DEFAULT_GRUPOS,
  type FilialGrupo,
} from '@/lib/utils/filial-grupos-store';
import { detectActiveFilials } from '@/lib/utils/active-filial-detector';

/**
 * Resolve os grupos para nomes vivos, detecta a perna ATIVA de cada um pela venda/emissão
 * mais recente e mescla o resultado na CompanyConfig.
 */
async function applyGruposToConfig(
  base: CompanyConfig,
  grupos: FilialGrupo[]
): Promise<CompanyConfig> {
  // Resolve membros/ativa dos grupos — que podem ser COD_FILIAL (novo) ou nome
  // (legado) — para o nome vivo do banco.
  const gruposVivos = await Promise.all(
    grupos.map(async (g) => ({
      ...g,
      members: (await liveNamesForFilialRefs(g.members)) ?? g.members,
      active: (await liveNameForFilialRef(g.active)) ?? g.active,
    }))
  );

  // Detecta a filial ativa de cada grupo pela venda mais recente
  const detectedActives = await detectActiveFilials(gruposVivos, base.ecommerceFilials ?? []);

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
}

/**
 * Versão server-only de resolveCompany que mescla a config (com NOMES VIVOS do
 * banco, via resolveCompanyLive) com os grupos dinâmicos gerenciados pelo painel
 * admin. Os nomes dos membros/ativa dos grupos do admin são normalizados para o
 * nome vivo do banco (match por COD_FILIAL), de forma que um rename no ERP não
 * quebre o reconhecimento dos grupos.
 *
 * O campo `active` de cada grupo é resolvido automaticamente pela venda mais
 * recente entre os membros (com cache de 5min); fallback para o active configurado.
 *
 * Se o store de grupos (Neon) estiver fora, ainda detectamos a perna ativa ao vivo
 * usando a composição de grupos do registry — ver o comentário no `catch`. Só quando o
 * Linx também cai é que sobra a config estática.
 */
export async function resolveCompanyDynamic(
  company?: string
): Promise<CompanyConfig | null> {
  const base = await resolveCompanyLive(company);
  if (!base) return null;

  try {
    const grupos = await listFilialGruposByCompany(base.key);
    if (grupos.length === 0) return base;
    return await applyGruposToConfig(base, grupos);
  } catch {
    // O store de grupos vive no NEON; a detecção da perna ativa roda no LINX. Numa
    // queda só do Neon, cair para a config estática congelaria o `activeId` do registry
    // enquanto as queries de estoque seguem funcionando — e a tela mostraria o saldo do
    // CNPJ errado sem erro visível (foi o que fez a barra 046500 exibir os 2 da MSC
    // parada como se fossem da AKS ativa). Então ainda detectamos ao vivo, usando só a
    // COMPOSIÇÃO dos grupos do registry: membro de grupo quase nunca muda, quem muda é
    // qual deles está ativo.
    try {
      const defaults = DEFAULT_GRUPOS.filter((g) => g.company === base.key.toLowerCase());
      if (defaults.length === 0) return base;
      return await applyGruposToConfig(base, defaults);
    } catch {
      // Linx também fora: aí a config estática é tudo que resta (e as queries de
      // estoque falham junto, então não há número errado para mostrar).
      return base;
    }
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

import 'server-only';

import { resolveCompany, VAREJO_VALUE, type CompanyConfig } from '@/lib/config/company';
import { buildDerivedFilialConfig, staticNameOf } from '@/lib/config/filial-config-builder';
import { getIdToNameMap, idForName, nameForId } from './filial-resolver';

/**
 * Versão "viva" de `resolveCompany`: monta a CompanyConfig com os NOMES ATUAIS das
 * filiais lidos da tabela FILIAIS pelo COD_FILIAL (via filial-resolver, cache 5 min),
 * em vez dos nomes fallback estáticos. Use nos caminhos que montam SQL (`WHERE FILIAL
 * IN (...)`) para que um rename no ERP se auto-corrija.
 *
 * Se o ERP estiver indisponível, o resolver cai no nome fallback do registry — ou
 * seja, no pior caso o comportamento é idêntico ao `resolveCompany` estático.
 */
export async function resolveCompanyLive(slug?: string): Promise<CompanyConfig | null> {
  const base = resolveCompany(slug);
  if (!base) return null;

  const idToName = await getIdToNameMap();
  const nameOf = (id: string) => idToName.get(id) ?? staticNameOf(id);

  return { ...base, ...buildDerivedFilialConfig(base.key, nameOf) };
}

/**
 * Normaliza um nome de filial vindo do front (config estática / grafia legada) para
 * o NOME VIVO atual no banco, resolvendo via COD_FILIAL (tolerante a espaço/acento).
 * Se não reconhecer (não é filial do registry, ou é um sentinel como VAREJO), devolve
 * o valor original — assim sentinels e nomes desconhecidos passam intactos.
 */
export async function liveNameForIncoming(name: string | null | undefined): Promise<string | null | undefined> {
  if (!name || name === VAREJO_VALUE) return name;
  const id = await idForName(name);
  if (!id) return name;
  return (await nameForId(id)) ?? name;
}

/** Versão em lote de `liveNameForIncoming` (preserva ordem; mantém valores não-reconhecidos). */
export async function liveNamesForIncoming(
  names: string[] | null | undefined
): Promise<string[] | null | undefined> {
  if (!names) return names;
  const out: string[] = [];
  for (const n of names) {
    const live = await liveNameForIncoming(n);
    if (typeof live === 'string') out.push(live);
  }
  return out;
}

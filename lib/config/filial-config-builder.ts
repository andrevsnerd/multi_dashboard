import type { CompanyKey } from './company';
import {
  getFiliaisByCompany,
  getFilialGroupsByCompany,
  getFilialById,
  COMPANY_LEAD_TIME_DEFAULT,
  ESTOQUE_FILIAL_ORDER,
  LEGACY_ACTIVE_SELF_MAP_IDS,
} from './filial-registry';

/**
 * Deriva os campos de filial de uma CompanyConfig a partir do registry (por ID),
 * resolvendo cada ID para um nome via `nameOf`.
 *
 * - Estático/fallback: passe `nameOf = (id) => dbNameFallback` (ver `staticNameOf`).
 * - Vivo (server): passe um `nameOf` que consulte o resolver (nome atual no banco).
 *
 * A saída é intencionalmente idêntica, campo a campo, ao bloco hardcoded legado
 * de `company.ts`, para permitir um corte sem mudança de comportamento.
 */
export interface DerivedFilialConfig {
  filialFilters: Record<'sales' | 'inventory', string[]>;
  filialDisplayNames: Record<string, string>;
  estoqueFilialOrder: string[];
  ecommerceFilials?: string[];
  filialGroups: Record<string, string[]>;
  activeFilials: Record<string, string>;
  leadTimeDays: { default: number; byFilial: Record<string, number> };
}

export type NameOf = (id: string) => string;

/** nameOf estático: usa o último nome conhecido (dbNameFallback) do registry. */
export const staticNameOf: NameOf = (id) => getFilialById(id)?.dbNameFallback ?? id;

export function buildDerivedFilialConfig(company: CompanyKey, nameOf: NameOf): DerivedFilialConfig {
  const defs = getFiliaisByCompany(company);
  const groups = getFilialGroupsByCompany(company);

  const sales: string[] = [];
  const inventory: string[] = [];
  const filialDisplayNames: Record<string, string> = {};
  const ecommerce: string[] = [];
  const byFilial: Record<string, number> = {};

  for (const d of defs) {
    const name = nameOf(d.id);
    if (d.modules.includes('sales')) sales.push(name);
    if (d.modules.includes('inventory')) inventory.push(name);
    filialDisplayNames[name] = d.display;
    if (d.ecommerce) ecommerce.push(name);
    if (d.leadTimeDays != null) byFilial[name] = d.leadTimeDays;
  }

  // filialGroups: apenas grupos multi-membro e NÃO-ecommerce (e-commerce é
  // agrupado via ecommerceFilials + label de exibição, não por este mecanismo).
  const filialGroups: Record<string, string[]> = {};
  for (const g of groups) {
    if (g.memberIds.length <= 1) continue;
    const allEcommerce = g.memberIds.every((id) => getFilialById(id)?.ecommerce);
    if (allEcommerce) continue;
    filialGroups[nameOf(g.memberIds[0])] = g.memberIds.map(nameOf);
  }

  // activeFilials: todo membro de todo grupo (single ou multi) aponta para o ativo.
  const activeFilials: Record<string, string> = {};
  for (const g of groups) {
    const activeName = nameOf(g.activeId);
    for (const m of g.memberIds) activeFilials[nameOf(m)] = activeName;
  }
  // Self-maps legados (normalização de espaçamento).
  for (const id of LEGACY_ACTIVE_SELF_MAP_IDS[company] ?? []) {
    const name = nameOf(id);
    activeFilials[name] = name;
  }

  const result: DerivedFilialConfig = {
    filialFilters: { sales, inventory },
    filialDisplayNames,
    estoqueFilialOrder: ESTOQUE_FILIAL_ORDER[company],
    filialGroups,
    activeFilials,
    leadTimeDays: { default: COMPANY_LEAD_TIME_DEFAULT[company], byFilial },
  };
  if (ecommerce.length > 0) result.ecommerceFilials = ecommerce;

  return result;
}

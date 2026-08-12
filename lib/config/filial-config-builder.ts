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

  // filialGroups: todos os grupos multi-membro, INCLUSIVE e-commerce.
  // A CANÔNICA é a filial ATIVA (não o 1º membro): é ela que o filtro de vendas
  // usa (`FILIAL = @filial`, sem expandir o grupo) e a chave de meta no dashboard.
  // Os membros vêm com a ativa primeiro, para a lógica de `slice(1)` que separa
  // canônica de não-canônicas (GoalsModal) continuar válida.
  //
  // O e-commerce era pulado aqui (agrupado só via ecommerceFilials + label), e por
  // isso ficava fora da régua de filial ativa: o saldo dos 5 CNPJs era somado num
  // balde só, fazendo a perna parada do rodízio (ex.: MSC) prometer estoque que a
  // ativa não tem. Espelha o buildDerivedFilialConfig de filial-grupos-store.
  const filialGroups: Record<string, string[]> = {};
  for (const g of groups) {
    if (g.memberIds.length <= 1) continue;
    const orderedIds = [g.activeId, ...g.memberIds.filter((id) => id !== g.activeId)];
    filialGroups[nameOf(g.activeId)] = orderedIds.map(nameOf);
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

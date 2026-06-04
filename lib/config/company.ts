import { buildDerivedFilialConfig, staticNameOf } from './filial-config-builder';

export type CompanyKey = 'nerd' | 'scarfme';

export type CompanyModule = 'sales' | 'inventory';

// Valor especial para representar "VAREJO" (apenas filiais normais, sem ecommerce)
// Usado apenas para scarfme
export const VAREJO_VALUE = "__VAREJO__";

export interface CompanyConfig {
  key: CompanyKey;
  name: string;
  filialFilters: Record<CompanyModule, string[]>;
  filialDisplayNames?: Record<string, string>;
  /** Ordem fixa dos cards "Estoque por Filial" (por nome de exibição) */
  estoqueFilialOrder?: string[];
  ecommerceFilials?: string[];
  excludedLines?: string[]; // Linhas excluídas de cálculos de estoque e vendas
  /**
   * Grupos de filiais que devem ser tratados como uma só filial lógica.
   * Chave = filial canônica (representante, usada como valor do filtro).
   * Valor = todas as filiais do grupo (incluindo a canônica).
   * Quando a filial canônica é selecionada, todas do grupo são incluídas nas consultas.
   */
  filialGroups?: Record<string, string[]>;
  activeFilials?: Record<string, string>;
  /** Lead time de reposição em dias (pode ser global e/ou por filial canônica). */
  leadTimeDays?: {
    default?: number;
    byFilial?: Record<string, number>;
  };
}

/**
 * Os campos de filial (filialFilters, filialDisplayNames, ecommerceFilials,
 * estoqueFilialOrder, filialGroups, activeFilials, leadTimeDays) são DERIVADOS do
 * registry por ID (`filial-registry.ts`) via `buildDerivedFilialConfig`. Aqui usamos
 * os nomes fallback (estáticos); o nome vivo do banco é injetado no caminho server
 * que monta SQL. Não edite estes campos à mão — edite o registry.
 */
const companyConfigs: Record<CompanyKey, CompanyConfig> = {
  nerd: {
    key: 'nerd',
    name: 'NERD',
    ...buildDerivedFilialConfig('nerd', staticNameOf),
  },
  scarfme: {
    key: 'scarfme',
    name: 'SCARF ME',
    ...buildDerivedFilialConfig('scarfme', staticNameOf),
    excludedLines: [
      'PRIVATE LABEL',
      'GASTRONOMICA',
      'PERFUMARIA',
      'CASHMERE',
      'ELETRONICOS',
      'EMBALAGENS',
      'CAPAS E ACESSORIOS P/ CEL',
    ],
  },
};

export function resolveCompany(company?: string): CompanyConfig | null {
  if (!company) {
    return null;
  }

  const normalized = company.toLowerCase() as CompanyKey;
  return companyConfigs[normalized] ?? null;
}

/**
 * Retorna todas as filiais do banco que compõem a filial lógica selecionada.
 * Se a filial não pertencer a nenhum grupo, retorna [filial].
 */
export function getFilialGroupMembers(company: CompanyConfig, filial: string): string[] {
  const normalizedFilial = normalizeFilialNameForMatch(filial).toUpperCase();
  const groups = company.filialGroups ?? {};
  // É a filial canônica de um grupo?
  for (const [canonical, members] of Object.entries(groups)) {
    if (normalizeFilialNameForMatch(canonical).toUpperCase() === normalizedFilial) {
      return members;
    }
  }
  // É membro não-canônico de algum grupo?
  for (const members of Object.values(groups)) {
    if (members.some((member) => normalizeFilialNameForMatch(member).toUpperCase() === normalizedFilial)) {
      return members;
    }
  }
  return [filial];
}

export function isEcommerceFilial(
  companySlug?: string,
  filial?: string | null
): boolean {
  if (!companySlug || !filial) {
    return false;
  }

  const company = resolveCompany(companySlug);
  if (!company) {
    return false;
  }

  const ecommerceFilials = company.ecommerceFilials ?? [];
  return ecommerceFilials.includes(filial);
}

/** Normaliza nome de filial do ERP para bater com filialDisplayNames / listas (espaços, hífens unicode). */
function normalizeFilialNameForMatch(s: string): string {
  return s
    .trim()
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ');
}

export function normalizeFilialLookupKey(rawFilial: string): string {
  return normalizeFilialNameForMatch(rawFilial)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/** Nome curto da filial como na dashboard (E-COMMERCE, PAULISTA, MATRIZ, …). */
function findActiveRule(company: CompanyConfig, filial: string): string | null {
  const normalizedFilial = normalizeFilialNameForMatch(filial).toUpperCase();
  const rules = company.activeFilials ?? {};

  for (const [from, to] of Object.entries(rules)) {
    if (normalizeFilialNameForMatch(from).toUpperCase() === normalizedFilial) {
      return to;
    }
  }

  for (const [canonical, members] of Object.entries(company.filialGroups ?? {})) {
    const isSameGroup =
      normalizeFilialNameForMatch(canonical).toUpperCase() === normalizedFilial ||
      members.some((member) => normalizeFilialNameForMatch(member).toUpperCase() === normalizedFilial);

    if (isSameGroup) {
      return rules[canonical] ?? canonical;
    }
  }

  return null;
}

export function getActiveFilial(
  company: CompanyConfig | null | undefined,
  filial: string | null | undefined
): string {
  const raw = (filial || '').trim();
  if (!company || !raw) return raw;
  return findActiveRule(company, raw) ?? raw;
}

export function isActiveFilial(
  company: CompanyConfig | null | undefined,
  filial: string | null | undefined
): boolean {
  const raw = (filial || '').trim();
  if (!company || !raw) return Boolean(raw);
  return normalizeFilialNameForMatch(getActiveFilial(company, raw)).toUpperCase() ===
    normalizeFilialNameForMatch(raw).toUpperCase();
}

export function getOperationalFilials(
  company: CompanyConfig | null | undefined,
  module: CompanyModule = 'inventory'
): string[] {
  if (!company) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filial of company.filialFilters[module] ?? []) {
    const active = getActiveFilial(company, filial);
    const key = normalizeFilialNameForMatch(active).toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(active);
  }

  return result;
}

export function normalizeOperationalFilialList(
  company: CompanyConfig | null | undefined,
  filiais: string[]
): string[] {
  if (!company) return filiais;
  const seen = new Set<string>();
  const result: string[] = [];

  for (const filial of filiais) {
    const active = getActiveFilial(company, filial);
    const key = normalizeFilialNameForMatch(active).toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(active);
  }

  return result;
}

export function getFilialLabelForDisplay(
  company: CompanyConfig | null | undefined,
  rawFilial: string
): string {
  const t = normalizeFilialNameForMatch(rawFilial);
  if (!company) return t;

  const map = company.filialDisplayNames;
  if (map) {
    if (map[rawFilial] !== undefined) return map[rawFilial];
    if (map[t] !== undefined) return map[t];
    for (const [key, label] of Object.entries(map)) {
      if (normalizeFilialNameForMatch(key) === t) return label;
    }
  }

  const ecommerce = company.ecommerceFilials ?? [];
  if (ecommerce.some((f) => normalizeFilialNameForMatch(f) === t)) {
    return 'E-COMMERCE';
  }

  const groups = company.filialGroups ?? {};
  for (const [canonical, members] of Object.entries(groups)) {
    if (normalizeFilialNameForMatch(canonical) === t) {
      return map?.[canonical] ?? map?.[members[0] ?? ''] ?? canonical;
    }
    for (const m of members) {
      if (normalizeFilialNameForMatch(m) === t) {
        return map?.[canonical] ?? map?.[m] ?? canonical;
      }
    }
  }

  return t;
}

/**
 * Soma vendas por filial quando vários códigos ERP compartilham o mesmo rótulo de exibição
 * (ex.: filiais de e-commerce → "E-COMMERCE"; Paulista → "PAULISTA").
 */
export function aggregateVendasPorFilialByDisplayLabel<
  T extends { filial: string; qtde12m: number; qtde60d: number },
>(rows: T[], company: CompanyConfig | null | undefined): T[] {
  const acc = new Map<string, { qtde12m: number; qtde60d: number }>();
  for (const r of rows) {
    const label = getFilialLabelForDisplay(company, r.filial);
    const prev = acc.get(label);
    if (!prev) {
      acc.set(label, { qtde12m: r.qtde12m, qtde60d: r.qtde60d });
    } else {
      acc.set(label, {
        qtde12m: prev.qtde12m + r.qtde12m,
        qtde60d: prev.qtde60d + r.qtde60d,
      });
    }
  }
  return Array.from(acc.entries()).map(([filial, v]) => ({
    filial,
    qtde12m: v.qtde12m,
    qtde60d: v.qtde60d,
  })) as T[];
}

export function aggregateEstoquePorFilialByDisplayLabel<
  T extends { filial: string; estoque: number },
>(rows: T[], company: CompanyConfig | null | undefined): T[] {
  const acc = new Map<string, number>();
  for (const row of rows) {
    const label = getFilialLabelForDisplay(company, row.filial);
    acc.set(label, (acc.get(label) ?? 0) + Number(row.estoque ?? 0));
  }
  return Array.from(acc.entries()).map(([filial, estoque]) => ({
    filial,
    estoque,
  })) as T[];
}

export function compareFilialDisplayOrder(
  a: string,
  b: string,
  company: CompanyConfig | null | undefined
): number {
  const ord = company?.estoqueFilialOrder ?? [];
  const ia = ord.indexOf(a);
  const ib = ord.indexOf(b);
  const fa = ia === -1 ? 999 : ia;
  const fb = ib === -1 ? 999 : ib;
  if (fa !== fb) return fa - fb;
  return a.localeCompare(b, "pt-BR");
}

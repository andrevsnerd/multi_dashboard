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

const companyConfigs: Record<CompanyKey, CompanyConfig> = {
  nerd: {
    key: 'nerd',
    name: 'NERD',
    filialFilters: {
      sales: [
        'NERD CENTER NORTE',
        'NERD HIGIENOPOLIS',
        'NERD LEBLON',
        'NERD MORUMBI RDRRRJ',
        'NERD MORUMBI RDRX',
        'NERD MORUMBI RDRRX',
        'NERD ELDORADO',
        'NERD VILLA LOBOS',
      ],
      inventory: [
        'NERD CENTER NORTE',
        'NERD HIGIENOPOLIS',
        'NERD LEBLON',
        'NERD MORUMBI RDRRRJ',
        'NERD MORUMBI RDRX',
        'NERD MORUMBI RDRRX',
        'NERD ELDORADO',
        'NERD VILLA LOBOS',
        'NERD',
      ],
    },
    filialDisplayNames: {
      'NERD CENTER NORTE': 'CENTER NORTE',
      'NERD HIGIENOPOLIS': 'HIGIENOPOLIS',
      'NERD LEBLON': 'LEBLON',
      'NERD MORUMBI RDRRRJ': 'MORUMBI 1',
      'NERD MORUMBI RDRX': 'MORUMBI 1',
      'NERD MORUMBI RDRRX': 'MORUMBI 2',
      'NERD ELDORADO': 'ELDORADO',
      'NERD VILLA LOBOS': 'VILLA LOBOS',
      'NERD': 'MATRIZ',
    },
    estoqueFilialOrder: ['MATRIZ', 'MORUMBI 1', 'MORUMBI 2', 'ELDORADO', 'VILLA LOBOS', 'HIGIENOPOLIS', 'LEBLON', 'CENTER NORTE'],
    filialGroups: {
      'NERD MORUMBI RDRRRJ': [
        'NERD MORUMBI RDRRRJ',
        'NERD MORUMBI RDRX',
      ],
    },
    activeFilials: {
      'NERD MORUMBI RDRRRJ': 'NERD MORUMBI RDRX',
      'NERD MORUMBI RDRX': 'NERD MORUMBI RDRX',
      'NERD MORUMBI RDRRX': 'NERD MORUMBI RDRRX',
    },
    leadTimeDays: {
      default: 2,
      byFilial: {
        'NERD': 1,
      },
    },
  },
  scarfme: {
    key: 'scarfme',
    name: 'SCARF ME',
    filialFilters: {
      sales: [
        'GUARULHOS - RSR',
        'IGUATEMI SP - JJJ',
        'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ',
        'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL',
        'SCARFME ME - PAULISTA FFF',
        'SCARF ME - PAULISTA RSR',
        'SCARF ME - PAULISTA FFFR',
        'SCARF ME PAULISTA FFFR',
        'SCARF ME - MATRIZ',
        'SCARFME MATRIZ CMS',
        'SCARF ME - MATRIZ LLL',
        'SCARF ME MATRIZ - FFF',
        'VILLA LOBOS - LLL',
        'MSC COMERCIO DE LENCOS LT',
        'SCARFME LLL -  GALEAO RJ',
      ],
      inventory: [
        'GUARULHOS - RSR',
        'IGUATEMI SP - JJJ',
        'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ',
        'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL',
        'SCARFME ME - PAULISTA FFF',
        'SCARF ME - PAULISTA RSR',
        'SCARF ME - PAULISTA FFFR',
        'SCARF ME PAULISTA FFFR',
        'SCARF ME - MATRIZ',
        'SCARFME MATRIZ CMS',
        'SCARF ME - MATRIZ LLL',
        'SCARF ME MATRIZ - FFF',
        'VILLA LOBOS - LLL',
        'MSC COMERCIO DE LENCOS LT',
        'SCARFME LLL -  GALEAO RJ',
      ],
    },
    filialDisplayNames: {
      'GUARULHOS - RSR': 'GUARULHOS',
      'IGUATEMI SP - JJJ': 'IGUATEMI',
      'MORUMBI - JJJ': 'MORUMBI',
      'OSCAR FREIRE - FSZ': 'OSCAR FREIRE',
      'SCARF ME - HIGIENOPOLIS 2': 'HIGIENÓPOLIS',
      'SCARFME - IBIRAPUERA LLL': 'IBIRAPUERA',
      'SCARFME ME - PAULISTA FFF': 'PAULISTA',
      'SCARF ME - PAULISTA RSR': 'PAULISTA',
      'SCARF ME - PAULISTA FFFR': 'PAULISTA',
      'SCARF ME PAULISTA FFFR': 'PAULISTA',
      'SCARF ME - MATRIZ': 'MATRIZ',
      'SCARFME MATRIZ CMS': 'E-COMMERCE',
      'SCARF ME - MATRIZ LLL': 'E-COMMERCE',
      'SCARF ME MATRIZ - FFF': 'E-COMMERCE',
      'VILLA LOBOS - LLL': 'VILLA LOBOS',
      'MSC COMERCIO DE LENCOS LT': 'E-COMMERCE',
      'SCARFME LLL -  GALEAO RJ': 'GALEÃO RJ',
    },
    estoqueFilialOrder: ['MATRIZ', 'E-COMMERCE', 'GUARULHOS', 'MORUMBI', 'OSCAR FREIRE', 'VILLA LOBOS', 'GALEÃO RJ'],
    ecommerceFilials: ['SCARFME MATRIZ CMS', 'SCARF ME - MATRIZ LLL', 'SCARF ME MATRIZ - FFF', 'MSC COMERCIO DE LENCOS LT'],
    filialGroups: {
      // PAULISTA: várias entidades/CNPJs no sistema, tratadas como uma loja lógica
      'SCARFME ME - PAULISTA FFF': [
        'SCARFME ME - PAULISTA FFF',
        'SCARF ME - PAULISTA RSR',
        'SCARF ME - PAULISTA FFFR',
        'SCARF ME PAULISTA FFFR',
      ],
    },
    activeFilials: {
      'SCARFME ME - PAULISTA FFF': 'SCARF ME PAULISTA FFFR',
      'SCARF ME - PAULISTA RSR': 'SCARF ME PAULISTA FFFR',
      'SCARF ME - PAULISTA FFFR': 'SCARF ME PAULISTA FFFR',
      'SCARF ME PAULISTA FFFR': 'SCARF ME PAULISTA FFFR',
      'SCARFME MATRIZ CMS': 'MSC COMERCIO DE LENCOS LT',
      'SCARF ME - MATRIZ LLL': 'MSC COMERCIO DE LENCOS LT',
      'SCARF ME MATRIZ - FFF': 'MSC COMERCIO DE LENCOS LT',
      'MSC COMERCIO DE LENCOS LT': 'MSC COMERCIO DE LENCOS LT',
      // Galeão: o nome real no DB tem 2 espaços após o hífen ("SCARFME LLL -  GALEAO RJ").
      // Como findActiveRule colapsa \s+ ao comparar, esta regra normaliza qualquer variação
      // de espaçamento (ex.: destinos antigos salvos com 1 espaço) para o nome canônico do DB.
      // Auto-corrige leitura de destinos/confirmações legados sem migrar linha a linha.
      'SCARFME LLL -  GALEAO RJ': 'SCARFME LLL -  GALEAO RJ',
    },
    excludedLines: [
      'PRIVATE LABEL',
      'GASTRONOMICA',
      'PERFUMARIA',
      'CASHMERE',
      'ELETRONICOS',
      'EMBALAGENS',
      'CAPAS E ACESSORIOS P/ CEL',
    ],
    leadTimeDays: {
      default: 3,
      byFilial: {
        'SCARF ME - MATRIZ': 2,
        'SCARFME MATRIZ CMS': 2,
        'SCARF ME - MATRIZ LLL': 2,
        'SCARF ME MATRIZ - FFF': 2,
      },
    },
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

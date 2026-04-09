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
        'NERD MORUMBI RDRRX',
        'NERD ELDORADO',
        'NERD VILLA LOBOS',
      ],
      inventory: [
        'NERD CENTER NORTE',
        'NERD HIGIENOPOLIS',
        'NERD LEBLON',
        'NERD MORUMBI RDRRRJ',
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
      'NERD MORUMBI RDRRX': 'MORUMBI 2',
      'NERD ELDORADO': 'ELDORADO',
      'NERD VILLA LOBOS': 'VILLA LOBOS',
      'NERD': 'MATRIZ',
    },
    estoqueFilialOrder: ['MATRIZ', 'MORUMBI 1', 'MORUMBI 2', 'ELDORADO', 'VILLA LOBOS', 'HIGIENOPOLIS', 'LEBLON', 'CENTER NORTE'],
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
        'SCARF ME - MATRIZ',
        'SCARFME MATRIZ CMS',
        'SCARF ME - MATRIZ LLL',
        'SCARF ME MATRIZ - FFF',
        'VILLA LOBOS - LLL',
        'MSC COMERCIO DE LENCOS LT',
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
        'SCARF ME - MATRIZ',
        'SCARFME MATRIZ CMS',
        'SCARF ME - MATRIZ LLL',
        'SCARF ME MATRIZ - FFF',
        'VILLA LOBOS - LLL',
        'MSC COMERCIO DE LENCOS LT',
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
      'SCARF ME - MATRIZ': 'MATRIZ',
      'SCARFME MATRIZ CMS': 'E-COMMERCE',
      'SCARF ME - MATRIZ LLL': 'E-COMMERCE',
      'SCARF ME MATRIZ - FFF': 'E-COMMERCE',
      'VILLA LOBOS - LLL': 'VILLA LOBOS',
      'MSC COMERCIO DE LENCOS LT': 'E-COMMERCE',
    },
    estoqueFilialOrder: ['MATRIZ', 'E-COMMERCE', 'GUARULHOS', 'MORUMBI', 'OSCAR FREIRE', 'VILLA LOBOS'],
    ecommerceFilials: ['SCARFME MATRIZ CMS', 'SCARF ME - MATRIZ LLL', 'SCARF ME MATRIZ - FFF', 'MSC COMERCIO DE LENCOS LT'],
    filialGroups: {
      // PAULISTA: várias entidades/CNPJs no sistema, tratadas como uma loja lógica
      'SCARFME ME - PAULISTA FFF': [
        'SCARFME ME - PAULISTA FFF',
        'SCARF ME - PAULISTA RSR',
        'SCARF ME - PAULISTA FFFR',
      ],
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
  const groups = company.filialGroups ?? {};
  // É a filial canônica de um grupo?
  if (filial in groups) return groups[filial];
  // É membro não-canônico de algum grupo?
  for (const members of Object.values(groups)) {
    if (members.includes(filial)) return members;
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

/** Nome curto da filial como na dashboard (E-COMMERCE, PAULISTA, MATRIZ, …). */
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



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
  ecommerceFilials?: string[];
  excludedLines?: string[]; // Linhas excluídas de cálculos de estoque e vendas
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
        'NERD VILLA LOBOS',
      ],
      inventory: [
        'NERD CENTER NORTE',
        'NERD HIGIENOPOLIS',
        'NERD LEBLON',
        'NERD MORUMBI RDRRRJ',
        'NERD VILLA LOBOS',
        'NERD',
      ],
    },
    filialDisplayNames: {
      'NERD CENTER NORTE': 'CENTER NORTE',
      'NERD HIGIENOPOLIS': 'HIGIENOPOLIS',
      'NERD LEBLON': 'LEBLON',
      'NERD MORUMBI RDRRRJ': 'MORUMBI',
      'NERD VILLA LOBOS': 'VILLA LOBOS',
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
      'SCARF ME - MATRIZ': 'MATRIZ',
      'SCARFME MATRIZ CMS': 'E-COMMERCE',
      'SCARF ME - MATRIZ LLL': 'E-COMMERCE',
      'SCARF ME MATRIZ - FFF': 'E-COMMERCE',
      'VILLA LOBOS - LLL': 'VILLA LOBOS',
      'MSC COMERCIO DE LENCOS LT': 'E-COMMERCE',
    },
    ecommerceFilials: ['SCARFME MATRIZ CMS', 'SCARF ME - MATRIZ LLL', 'SCARF ME MATRIZ - FFF', 'MSC COMERCIO DE LENCOS LT'],
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



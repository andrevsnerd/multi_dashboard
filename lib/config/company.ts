export type CompanyKey = 'nerd' | 'scarfme';

export type CompanyModule = 'sales' | 'inventory';

export interface CompanyConfig {
  key: CompanyKey;
  name: string;
  filialFilters: Record<CompanyModule, string[]>;
  filialDisplayNames?: Record<string, string>;
  ecommerceFilials?: string[];
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
  },
  scarfme: {
    key: 'scarfme',
    name: 'Scarf Me',
    filialFilters: {
      sales: [
        'GUARULHOS - RSR',
        'IGUATEMI SP - JJJ',
        'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ',
        'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL',
        'SCARFME ME - PAULISTA FFF',
        'SCARFME MATRIZ CMS',
        'VILLA LOBOS - LLL',
      ],
      inventory: [
        'GUARULHOS - RSR',
        'IGUATEMI SP - JJJ',
        'MORUMBI - JJJ',
        'OSCAR FREIRE - FSZ',
        'SCARF ME - HIGIENOPOLIS 2',
        'SCARFME - IBIRAPUERA LLL',
        'SCARFME ME - PAULISTA FFF',
        'SCARFME MATRIZ CMS',
        'VILLA LOBOS - LLL',
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
      'SCARFME MATRIZ CMS': 'E-COMMERCE',
      'VILLA LOBOS - LLL': 'VILLA LOBOS',
    },
    ecommerceFilials: ['SCARFME MATRIZ CMS'],
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



export type CompanyKey = 'nerd' | 'scarfme';

export interface CompanyConfig {
  key: CompanyKey;
  name: string;
  filialCodes: string[];
}

const companyConfigs: Record<CompanyKey, CompanyConfig> = {
  nerd: {
    key: 'nerd',
    name: 'NERD',
    filialCodes: [],
  },
  scarfme: {
    key: 'scarfme',
    name: 'Scarfme',
    filialCodes: [],
  },
};

export function resolveCompany(company?: string): CompanyConfig | null {
  if (!company) {
    return null;
  }

  const normalized = company.toLowerCase() as CompanyKey;
  return companyConfigs[normalized] ?? null;
}



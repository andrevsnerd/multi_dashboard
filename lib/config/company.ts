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
      'NERD': 'MATRIZ',
    },
    estoqueFilialOrder: ['MATRIZ', 'MORUMBI', 'VILLA LOBOS', 'HIGIENOPOLIS', 'LEBLON', 'CENTER NORTE'],
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
    estoqueFilialOrder: ['MATRIZ', 'E-COMMERCE', 'GUARULHOS', 'MORUMBI', 'OSCAR FREIRE', 'VILLA LOBOS'],
    ecommerceFilials: ['SCARFME MATRIZ CMS', 'SCARF ME - MATRIZ LLL', 'SCARF ME MATRIZ - FFF', 'MSC COMERCIO DE LENCOS LT'],
    filialGroups: {
      // PAULISTA possui dois CNPJs/entidades no sistema mas é tratada como uma só loja
      'SCARFME ME - PAULISTA FFF': ['SCARFME ME - PAULISTA FFF', 'SCARF ME - PAULISTA RSR'],
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



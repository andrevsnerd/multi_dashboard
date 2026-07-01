import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import {
  getActiveFilial,
  getFilialLabelForDisplay,
  getOperationalFilials,
} from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';

// Lista canônica de filiais operacionais (ativas) para o select.
// Usa resolveCompanyDynamic para incorporar grupos definidos no painel admin.
async function getFiliaisCanonicas(companyKey?: string | null): Promise<string[]> {
  if (companyKey) {
    const company = await resolveCompanyDynamic(companyKey);
    if (company) {
      const inventory = getOperationalFilials(company, 'inventory');
      return [...new Set(inventory)];
    }
  }
  const nerd = getOperationalFilials((await resolveCompanyDynamic('nerd')), 'inventory');
  const scarfme = getOperationalFilials((await resolveCompanyDynamic('scarfme')), 'inventory');
  return [...new Set([...nerd, ...scarfme])];
}

type FilialOption = {
  codFilial: string;
  filial: string;
  displayName: string;
  activeFilial: string;
  aliases: string[];
  /** Nomes de todos os membros do grupo (>1 quando há rodízio; ex.: E-COMMERCE = MSC, AKS…). */
  members: string[];
};

const normFilialKey = (s: string) =>
  (s || '').trim().replace(/[‐-―−]/g, '-').replace(/\s+/g, ' ').toUpperCase();

/**
 * Retorna os nomes de todos os membros do grupo ao qual a filial ativa pertence.
 * E-commerce é agrupado via ecommerceFilials; demais grupos via filialGroups.
 * Filial sem grupo (rodízio) retorna apenas ela mesma.
 */
function getGroupMembers(
  company: Awaited<ReturnType<typeof resolveCompanyDynamic>>,
  activeFilial: string
): string[] {
  if (!company) return [activeFilial];
  const activeKey = normFilialKey(activeFilial);

  const ecommerce = company.ecommerceFilials ?? [];
  if (ecommerce.some((f) => normFilialKey(f) === activeKey)) {
    return [...new Set(ecommerce.map((f) => f.trim()))];
  }

  for (const [canonical, members] of Object.entries(company.filialGroups ?? {})) {
    const inGroup =
      normFilialKey(canonical) === activeKey ||
      members.some((m) => normFilialKey(m) === activeKey);
    if (inGroup) {
      return [...new Set([canonical, ...members].map((m) => m.trim()))];
    }
  }

  return [activeFilial.trim()];
}

function getFilialAliases(
  company: Awaited<ReturnType<typeof resolveCompanyDynamic>>,
  activeFilial: string
): string[] {
  const seen = new Set<string>();
  const aliases: string[] = [];
  const activeKey = activeFilial.trim().toUpperCase();
  const add = (value?: string | null) => {
    const filial = (value || '').trim();
    const key = filial.toUpperCase();
    if (!filial || seen.has(key)) return;
    seen.add(key);
    aliases.push(filial);
  };

  add(activeFilial);
  if (!company) return aliases;

  for (const filial of company.filialFilters.inventory) {
    if (getActiveFilial(company, filial).trim().toUpperCase() === activeKey) {
      add(filial);
    }
  }

  for (const [canonical, members] of Object.entries(company.filialGroups ?? {})) {
    if (getActiveFilial(company, canonical).trim().toUpperCase() === activeKey) {
      add(canonical);
    }
    for (const member of members) {
      if (getActiveFilial(company, member).trim().toUpperCase() === activeKey) {
        add(member);
      }
    }
  }

  return aliases;
}

function toFilialOption(
  filial: string,
  company: Awaited<ReturnType<typeof resolveCompanyDynamic>>
): FilialOption {
  const activeFilial = getActiveFilial(company, filial);
  return {
    codFilial: activeFilial,
    filial: activeFilial,
    displayName: getFilialLabelForDisplay(company, activeFilial),
    activeFilial,
    aliases: getFilialAliases(company, activeFilial),
    members: getGroupMembers(company, activeFilial),
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const filiaisCanonicas = await getFiliaisCanonicas(company);
    const companyConfig = company ? await resolveCompanyDynamic(company) : null;

    const filiais = await withRequest(async (req) => {
      const query = `
        SELECT DISTINCT
          COD_FILIAL,
          FILIAL
        FROM FILIAIS WITH (NOLOCK)
        WHERE FILIAL LIKE '%NERD%' 
           OR FILIAL LIKE '%SCARF%'
           OR FILIAL LIKE '%SCARFME%'
           OR FILIAL LIKE '%MSC COMERCIO%LENCOS%'
        ORDER BY FILIAL
      `;

      const result = await req.query<{
        COD_FILIAL: string;
        FILIAL: string;
      }>(query);

      const fromDb = result.recordset.map((row) => ({
        codFilial: row.COD_FILIAL?.toString().trim() || '',
        filial: row.FILIAL?.toString().trim() || '',
      }));

      const matched = new Set<string>();
      const mapped: FilialOption[] = [];

      for (const f of fromDb) {
        if (filiaisCanonicas.includes(f.filial)) {
          matched.add(f.filial);
          mapped.push(toFilialOption(f.filial, companyConfig));
        }
      }

      // Incluir filiais do config que não vieram do DB (ex: nova filial e-commerce)
      // usando o nome como codFilial provisório para aparecer no select.
      for (const nome of filiaisCanonicas) {
        if (!matched.has(nome)) {
          mapped.push(toFilialOption(nome, companyConfig));
        }
      }

      return mapped.sort((a, b) => {
        const byLabel = a.displayName.localeCompare(b.displayName, 'pt-BR');
        if (byLabel !== 0) return byLabel;
        return a.activeFilial.localeCompare(b.activeFilial, 'pt-BR');
      });
    });

    return NextResponse.json({ data: filiais });
  } catch (error) {
    console.error('Erro ao buscar filiais', error);
    return NextResponse.json(
      { error: 'Erro ao buscar filiais' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import { getOperationalFilials } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';

// Lista canônica de filiais operacionais (ativas) para o select.
// Usa resolveCompanyDynamic para incorporar grupos definidos no painel admin.
async function getFiliaisCanonicas(companyKey?: string | null): Promise<string[]> {
  if (companyKey) {
    const company = await resolveCompanyDynamic(companyKey);
    if (company) {
      const inventory = getOperationalFilials(company, 'inventory');
      const semMatriz = inventory.filter((filial) => {
        const display = company.filialDisplayNames?.[filial] ?? filial;
        return display.trim().toUpperCase() !== 'MATRIZ';
      });
      return [...new Set(semMatriz)];
    }
  }
  const nerd = getOperationalFilials((await resolveCompanyDynamic('nerd')), 'inventory');
  const scarfme = getOperationalFilials((await resolveCompanyDynamic('scarfme')), 'inventory');
  return [...new Set([...nerd, ...scarfme])];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = searchParams.get('company');
    const filiaisCanonicas = await getFiliaisCanonicas(company);

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
      const mapped: Array<{ codFilial: string; filial: string }> = [];

      for (const f of fromDb) {
        if (filiaisCanonicas.includes(f.filial)) {
          matched.add(f.filial);
          mapped.push({ codFilial: f.filial, filial: f.filial });
        }
      }

      // Incluir filiais do config que não vieram do DB (ex: nova filial e-commerce)
      // usando o nome como codFilial provisório para aparecer no select.
      for (const nome of filiaisCanonicas) {
        if (!matched.has(nome)) {
          mapped.push({ codFilial: nome, filial: nome });
        }
      }

      return mapped.sort((a, b) => a.filial.localeCompare(b.filial));
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

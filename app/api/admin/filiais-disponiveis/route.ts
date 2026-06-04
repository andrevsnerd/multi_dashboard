import { NextRequest, NextResponse } from 'next/server';
import { getFiliaisByCompany, type FilialDef } from '@/lib/config/filial-registry';
import { withLiveNames } from '@/lib/server/filial-resolver';
import type { CompanyKey } from '@/lib/config/company';

/**
 * Lista as filiais do registry (por COD_FILIAL) com o nome vivo do banco,
 * para o painel de Grupos de Filiais montar a seleção por ID.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const company = (searchParams.get('company') || '').toLowerCase();

  try {
    const companies: CompanyKey[] = company === 'nerd' || company === 'scarfme'
      ? [company]
      : ['nerd', 'scarfme'];

    const defs: FilialDef[] = companies.flatMap((c) => getFiliaisByCompany(c));
    const withNames = await withLiveNames(defs);

    const data = withNames.map((f) => ({
      id: f.id,
      company: f.company,
      display: f.display,
      dbName: f.dbName,
      ecommerce: f.ecommerce ?? false,
    }));

    return NextResponse.json(
      { data },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erro ao listar filiais' },
      { status: 500 }
    );
  }
}

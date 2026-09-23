import { NextRequest, NextResponse } from 'next/server';

import { fetchDefeitoRomaneios } from '@/lib/repositories/defeitos';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getDefeitoFilial } from '@/lib/config/filiais-especiais';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { DEFEITOS_ROLES } from '@/lib/auth/permissions';

/**
 * GET /api/defeitos/romaneios?company=nerd&dias=180&search=
 *
 * Romaneios de saída destinados à filial de defeito, confirmados ou não.
 *
 * A janela é em DIAS (padrão 180) e não acompanha o período do painel de
 * entradas de propósito: um romaneio de julho que ninguém conferiu tem que
 * continuar visível em setembro, senão a pendência desaparece da tela.
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const user = username ? await findUserByUsername(username) : null;
    if (!user || !DEFEITOS_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }

    const companyKey = request.nextUrl.searchParams.get('company')?.trim();
    if (!companyKey) {
      return NextResponse.json({ error: 'Parâmetro company é obrigatório' }, { status: 400 });
    }

    const defeitoFilial = getDefeitoFilial(companyKey);
    if (!defeitoFilial) {
      return NextResponse.json(
        { error: 'Esta empresa não tem filial de defeito configurada.' },
        { status: 400 }
      );
    }

    const companyConfig = await resolveCompanyDynamic(companyKey);
    const filiaisOrigem = companyConfig?.filialFilters.inventory ?? [];

    const diasParam = Number(request.nextUrl.searchParams.get('dias') ?? 180);
    const dias = Number.isFinite(diasParam) ? Math.min(Math.max(diasParam, 1), 1095) : 180;
    const search = request.nextUrl.searchParams.get('search')?.trim() ?? '';

    // Fim no amanhã: a EMISSAO do romaneio é gravada à meia-noite do dia
    // contábil, então um filtro que pare em "hoje" perde o romaneio de hoje.
    const hoje = new Date();
    const end = new Date(
      Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() + 1)
    );
    const start = new Date(end.getTime() - dias * 24 * 60 * 60 * 1000);

    const data = await fetchDefeitoRomaneios({
      companyKey,
      filiaisOrigem,
      defeitoFilial,
      range: { start, end },
      search,
    });

    return NextResponse.json({ data, defeitoFilial });
  } catch (error) {
    console.error('Erro ao listar romaneios de defeito', error);
    return NextResponse.json({ error: 'Erro ao listar romaneios de defeito' }, { status: 500 });
  }
}

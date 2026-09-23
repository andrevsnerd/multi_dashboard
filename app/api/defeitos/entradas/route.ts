import { NextRequest, NextResponse } from 'next/server';

import { fetchDefeitoEntradas } from '@/lib/repositories/defeitos';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getDefeitoFilial } from '@/lib/config/filiais-especiais';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { DEFEITOS_ROLES } from '@/lib/auth/permissions';
import { normalizeRangeForQuery } from '@/lib/utils/date';

/**
 * GET /api/defeitos/entradas?company=nerd&start=2026-09-01&end=2026-09-30
 *
 * O que entrou na filial de defeito no período, quebrado por loja de origem,
 * com custo por item e total por filial. Sem `start`/`end` cai no mês atual.
 *
 * O período é pela DATA DA CONFIRMAÇÃO (quando a peça de fato entrou), não pela
 * emissão do romaneio de saída — romaneio de 30/08 conferido em 02/09 entrou em
 * setembro. O range passa por `normalizeRangeForQuery` porque o cliente manda a
 * data em ISO e ler isso no fuso do servidor desloca o dia (ver o bug de
 * `toISOString` nos filtros de período).
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const user = username ? await findUserByUsername(username) : null;
    if (!user || !DEFEITOS_ROLES.includes(user.role)) {
      return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
    }

    const sp = request.nextUrl.searchParams;
    const companyKey = sp.get('company')?.trim();
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

    const range = normalizeRangeForQuery({
      start: sp.get('start') ?? undefined,
      end: sp.get('end') ?? undefined,
    });

    const resultado = await fetchDefeitoEntradas({
      companyKey,
      filiaisOrigem,
      defeitoFilial,
      range,
    });

    return NextResponse.json({
      ...resultado,
      defeitoFilial,
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
    });
  } catch (error) {
    console.error('Erro ao carregar entradas de defeito', error);
    const detalhe = error instanceof Error ? error.message : '';
    return NextResponse.json(
      { error: `Erro ao carregar as entradas de defeito${detalhe ? `: ${detalhe}` : ''}` },
      { status: 500 }
    );
  }
}

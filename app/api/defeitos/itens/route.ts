import { NextRequest, NextResponse } from 'next/server';

import { fetchDefeitoRomaneioItens } from '@/lib/repositories/defeitos';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getDefeitoFilial } from '@/lib/config/filiais-especiais';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { DEFEITOS_ROLES, canCorrigirDefeito } from '@/lib/auth/permissions';

/**
 * GET /api/defeitos/itens?company=nerd&romaneio=033362&filialOrigem=NERD VILLA LOBOS
 *
 * Itens de um romaneio de defeito com o estado de conferência de cada um, mais o
 * veredito de "pode corrigir" — a tela usa isso para habilitar o stepper em vez
 * de descobrir no POST que o usuário é somente-leitura.
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
    const romaneio = sp.get('romaneio')?.trim();
    const filialOrigem = sp.get('filialOrigem')?.trim();

    if (!companyKey || !romaneio || !filialOrigem) {
      return NextResponse.json(
        { error: 'Parâmetros obrigatórios: company, romaneio, filialOrigem' },
        { status: 400 }
      );
    }

    const defeitoFilial = getDefeitoFilial(companyKey);
    if (!defeitoFilial) {
      return NextResponse.json(
        { error: 'Esta empresa não tem filial de defeito configurada.' },
        { status: 400 }
      );
    }

    // A filial de origem precisa ser da empresa pedida: sem isso o romaneio de
    // uma empresa poderia ser lido (e corrigido) pela tela da outra.
    const companyConfig = await resolveCompanyDynamic(companyKey);
    const filiaisOrigem = companyConfig?.filialFilters.inventory ?? [];
    const normaliza = (v: string) => v.trim().replace(/\s+/g, ' ').toUpperCase();
    if (
      filiaisOrigem.length > 0 &&
      !filiaisOrigem.some((f) => normaliza(f) === normaliza(filialOrigem))
    ) {
      return NextResponse.json(
        { error: `${filialOrigem} não é uma filial de ${companyKey}.` },
        { status: 400 }
      );
    }

    const itens = await fetchDefeitoRomaneioItens({
      companyKey,
      romaneio,
      filialOrigem,
      defeitoFilial,
    });

    return NextResponse.json({
      data: itens,
      defeitoFilial,
      podeCorrigir: canCorrigirDefeito(user.role),
    });
  } catch (error) {
    console.error('Erro ao carregar itens do romaneio de defeito', error);
    const detalhe = error instanceof Error ? error.message : '';
    return NextResponse.json(
      { error: `Erro ao carregar os itens do romaneio${detalhe ? `: ${detalhe}` : ''}` },
      { status: 500 }
    );
  }
}

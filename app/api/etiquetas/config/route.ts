import { NextResponse } from 'next/server';

import { autorizarEtiquetas, parseEtiquetaCompany } from '@/lib/auth/etiquetas-guard';
import {
  carregarConfigEtiqueta,
  resetarConfigEtiqueta,
  salvarConfigEtiqueta,
} from '@/lib/utils/etiquetas-config-store';

export const dynamic = 'force-dynamic';

/** Configuração salva da etiqueta da empresa (ou a padrão de fábrica). */
export async function GET(request: Request) {
  const autorizacao = await autorizarEtiquetas(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const url = new URL(request.url);
  const company = parseEtiquetaCompany(url.searchParams.get('company'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

  try {
    const config = await carregarConfigEtiqueta(company);
    return NextResponse.json({ config, podeConfigurar: autorizacao.auth.podeConfigurar });
  } catch (error) {
    console.error('[etiquetas/config] erro ao carregar', error);
    return NextResponse.json({ error: 'Erro ao carregar a configuração.' }, { status: 500 });
  }
}

/** Salva o modelo da etiqueta (vale para todos os usuários da empresa). */
export async function PUT(request: Request) {
  const autorizacao = await autorizarEtiquetas(request, { exigirConfiguracao: true });
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as { company?: string; config?: unknown; resetar?: boolean };
    const company = parseEtiquetaCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

    const config = body.resetar
      ? await resetarConfigEtiqueta(company, autorizacao.auth.username)
      : await salvarConfigEtiqueta(company, body.config, autorizacao.auth.username);

    return NextResponse.json({ config });
  } catch (error) {
    console.error('[etiquetas/config] erro ao salvar', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao salvar a configuração.' },
      { status: 500 }
    );
  }
}

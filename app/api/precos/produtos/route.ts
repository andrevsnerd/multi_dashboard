import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import { fetchProdutosPrecos, type PrecoFiltros } from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Body {
  company?: string;
  codigos?: string[];
  busca?: string | null;
  grupos?: string[];
  subgrupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  grades?: string[];
  tipos?: string[];
  incluirInativos?: boolean;
  todoCadastro?: boolean;
  camposCadastro?: string[];
  tabelas?: string[];
  incluirAvancados?: boolean;
  limite?: number;
}

function lista(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => String(v ?? '').trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

/**
 * Busca os produtos que batem nos filtros e os valores atuais das colunas
 * escolhidas. POST porque a lista de códigos colados pode ser grande demais
 * para a query string.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parsePrecoCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
    }

    const filtros: PrecoFiltros = {
      company,
      codigos: lista(body.codigos),
      busca: typeof body.busca === 'string' ? body.busca : null,
      grupos: lista(body.grupos),
      subgrupos: lista(body.subgrupos),
      linhas: lista(body.linhas),
      colecoes: lista(body.colecoes),
      grades: lista(body.grades),
      tipos: lista(body.tipos),
      incluirInativos: Boolean(body.incluirInativos),
      todoCadastro: Boolean(body.todoCadastro),
      camposCadastro: lista(body.camposCadastro),
      tabelas: lista(body.tabelas),
      incluirAvancados: Boolean(body.incluirAvancados),
      limite: typeof body.limite === 'number' ? body.limite : undefined,
    };

    const semFiltro =
      !filtros.codigos &&
      !filtros.grupos &&
      !filtros.subgrupos &&
      !filtros.linhas &&
      !filtros.colecoes &&
      !filtros.grades &&
      !filtros.tipos &&
      (filtros.busca ?? '').trim().length < 2;

    if (semFiltro) {
      return NextResponse.json(
        { error: 'Aplique pelo menos um filtro (códigos, nome, grupo, subgrupo, linha, coleção, grade ou tipo).' },
        { status: 400 }
      );
    }

    const result = await fetchProdutosPrecos(filtros);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[precos/produtos] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao buscar produtos.' },
      { status: 500 }
    );
  }
}

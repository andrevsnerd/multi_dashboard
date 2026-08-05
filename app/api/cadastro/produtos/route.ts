import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import {
  fetchProdutoCadastro,
  fetchProdutosCadastro,
  type CadastroFiltros,
} from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface Body {
  company?: string;
  /** Um código só → ficha do produto (aba "Alterar Produto"). */
  codigo?: string;
  codigos?: string[];
  busca?: string | null;
  grupos?: string[];
  subgrupos?: string[];
  linhas?: string[];
  colecoes?: string[];
  tipos?: string[];
  griffes?: string[];
  grades?: string[];
  incluirInativos?: boolean;
  todoCadastro?: boolean;
  limite?: number;
}

function lista(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => String(v ?? '').trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

/**
 * Busca de produtos para as telas de cadastro. POST porque a lista de códigos
 * colados pode ser grande demais para a query string.
 */
export async function POST(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  try {
    const body = (await request.json()) as Body;
    const company = parseCadastroCompany(body.company);
    if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });

    // Ficha de um produto: aceita código do produto ou código de barras.
    const codigoUnico = (body.codigo ?? '').trim();
    if (codigoUnico) {
      const produto = await fetchProdutoCadastro(codigoUnico);
      if (!produto) {
        return NextResponse.json({ error: `Produto "${codigoUnico}" não encontrado.` }, { status: 404 });
      }
      return NextResponse.json({ produto });
    }

    const filtros: CadastroFiltros = {
      company,
      codigos: lista(body.codigos),
      busca: typeof body.busca === 'string' ? body.busca : null,
      grupos: lista(body.grupos),
      subgrupos: lista(body.subgrupos),
      linhas: lista(body.linhas),
      colecoes: lista(body.colecoes),
      tipos: lista(body.tipos),
      griffes: lista(body.griffes),
      grades: lista(body.grades),
      incluirInativos: Boolean(body.incluirInativos),
      todoCadastro: Boolean(body.todoCadastro),
      limite: typeof body.limite === 'number' ? body.limite : undefined,
    };

    const semFiltro =
      !filtros.codigos &&
      !filtros.grupos &&
      !filtros.subgrupos &&
      !filtros.linhas &&
      !filtros.colecoes &&
      !filtros.tipos &&
      !filtros.griffes &&
      !filtros.grades &&
      (filtros.busca ?? '').trim().length < 2;

    if (semFiltro) {
      return NextResponse.json(
        { error: 'Aplique pelo menos um filtro (códigos, nome, grupo, subgrupo, linha, coleção, tipo, griffe ou grade).' },
        { status: 400 }
      );
    }

    const result = await fetchProdutosCadastro(filtros);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[cadastro/produtos] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao buscar produtos.' },
      { status: 500 }
    );
  }
}

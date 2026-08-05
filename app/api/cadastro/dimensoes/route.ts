import { NextResponse } from 'next/server';

import { autorizarCadastro, parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import {
  alternarInativoDimensao,
  avaliarImpactoDimensao,
  criarDimensao,
  fetchDimensao,
  fetchGruposParaSelecao,
  parseDimensaoTipo,
  renomearDimensao,
  sugerirCodigoDimensao,
} from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/** Lista uma dimensão com contagem de uso (+ grupos para escopar subgrupo). */
export async function GET(request: Request) {
  const autorizacao = await autorizarCadastro(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parseCadastroCompany(searchParams.get('company'));
  const tipo = parseDimensaoTipo(searchParams.get('tipo'));
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
  if (!tipo) return NextResponse.json({ error: 'Dimensão inválida.' }, { status: 400 });

  try {
    const [lista, grupos] = await Promise.all([
      fetchDimensao(company, tipo, {
        pai: searchParams.get('pai'),
        busca: searchParams.get('busca'),
        incluirInativos: searchParams.get('incluirInativos') === '1',
      }),
      fetchGruposParaSelecao(),
    ]);

    return NextResponse.json({
      ...lista,
      grupos,
      podeExecutar: autorizacao.auth.podeExecutar,
    });
  } catch (error) {
    console.error('[cadastro/dimensoes] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar a dimensão.' },
      { status: 500 }
    );
  }
}

interface Body {
  company?: string;
  tipo?: string;
  /** `impacto` e `sugerirCodigo` são leitura; os demais gravam. */
  acao?: 'impacto' | 'sugerirCodigo' | 'renomear' | 'criar' | 'inativar' | 'reativar';
  nomeAtual?: string;
  nomeNovo?: string;
  nome?: string;
  codigo?: string;
  pai?: string | null;
  /** Chave do registro na mestre; só difere do nome em coleção (é o código). */
  chave?: string | null;
  obs?: string | null;
}

/**
 * Ações sobre a dimensão. As de leitura (`impacto`, `sugerirCodigo`) não exigem
 * escrita — é a pré-checagem que o diretor também precisa ver. As de gravação
 * passam por `exigirEscrita`.
 */
export async function POST(request: Request) {
  const leitura = await autorizarCadastro(request);
  if ('erro' in leitura) return leitura.erro;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Corpo inválido.' }, { status: 400 });
  }

  const company = parseCadastroCompany(body.company);
  const tipo = parseDimensaoTipo(body.tipo);
  if (!company) return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
  if (!tipo) return NextResponse.json({ error: 'Dimensão inválida.' }, { status: 400 });

  const acao = body.acao ?? 'impacto';
  const usuario = leitura.auth.username;

  try {
    if (acao === 'impacto') {
      const impacto = await avaliarImpactoDimensao(company, tipo, {
        nomeAtual: body.nomeAtual ?? body.nome ?? '',
        nomeNovo: body.nomeNovo ?? null,
        pai: body.pai ?? null,
        codigoNovo: body.codigo ?? null,
        chave: body.chave ?? null,
      });
      return NextResponse.json({ impacto });
    }

    if (acao === 'sugerirCodigo') {
      const codigo = await sugerirCodigoDimensao(tipo, body.pai ?? null);
      return NextResponse.json({ codigo });
    }

    // Daqui para baixo, grava.
    const escrita = await autorizarCadastro(request, { exigirEscrita: true });
    if ('erro' in escrita) return escrita.erro;

    if (acao === 'renomear') {
      const resultado = await renomearDimensao({
        company,
        usuario,
        tipo,
        nomeAtual: body.nomeAtual ?? '',
        nomeNovo: body.nomeNovo ?? '',
        pai: body.pai ?? null,
        chave: body.chave ?? null,
        obs: body.obs ?? null,
      });
      return NextResponse.json(resultado);
    }

    if (acao === 'criar') {
      const resultado = await criarDimensao({
        company,
        usuario,
        tipo,
        nome: body.nome ?? '',
        codigo: body.codigo ?? null,
        pai: body.pai ?? null,
        obs: body.obs ?? null,
      });
      return NextResponse.json(resultado);
    }

    if (acao === 'inativar' || acao === 'reativar') {
      const resultado = await alternarInativoDimensao({
        company,
        usuario,
        tipo,
        nome: body.nome ?? body.nomeAtual ?? '',
        pai: body.pai ?? null,
        chave: body.chave ?? null,
        inativo: acao === 'inativar',
        obs: body.obs ?? null,
      });
      return NextResponse.json(resultado);
    }

    return NextResponse.json({ error: 'Ação desconhecida.' }, { status: 400 });
  } catch (error) {
    console.error('[cadastro/dimensoes] erro na ação', acao, error);
    // Mensagem de trigger do Linx é descritiva ("Impossível Atualizar #X #porque
    // existem registros em #Y") — vale mais para o usuário do que um genérico.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao executar a ação.' },
      { status: 400 }
    );
  }
}

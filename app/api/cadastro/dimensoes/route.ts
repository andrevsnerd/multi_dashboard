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

function lista(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = value.map((v) => String(v ?? '').trim()).filter(Boolean);
  return out.length > 0 ? out : null;
}

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
    const [dimensao, grupos] = await Promise.all([
      fetchDimensao(company, tipo, {
        pai: searchParams.get('pai'),
        busca: searchParams.get('busca'),
        incluirInativos: searchParams.get('incluirInativos') === '1',
        // Subgrupo vem agregado por nome; `porGrupo=1` mostra par a par.
        porGrupo: searchParams.get('porGrupo') === '1',
      }),
      fetchGruposParaSelecao(),
    ]);

    return NextResponse.json({
      ...dimensao,
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
  /**
   * Grupos-alvo escolhidos na tela (subgrupo). Vazio/ausente = todos os grupos em
   * que o nome existe. É o que a seleção por checkbox manda.
   */
  grupos?: string[] | null;
  /** Vários alvos de inativar/reativar de uma vez (seleção de N nomes na tela). */
  alvos?: Array<{ nome?: string; chave?: string | null; grupos?: string[] | null }> | null;
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
        grupos: lista(body.grupos),
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
        grupos: lista(body.grupos),
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
        grupos: lista(body.grupos),
        alvos: Array.isArray(body.alvos)
          ? body.alvos
              .map((a) => ({
                nome: String(a?.nome ?? '').trim(),
                chave: a?.chave ?? null,
                grupos: lista(a?.grupos),
              }))
              .filter((a) => a.nome.length > 0)
          : null,
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

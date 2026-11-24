import { NextResponse } from 'next/server';

import {
  assumirRascunho,
  descartarRascunho,
  listarRascunhos,
  marcarVisto,
  rascunhoEmUso,
  rascunhoId,
  removerRascunho,
  salvarRascunho,
  type RascunhoItem,
  type TipoOperacaoRascunho,
} from '@/lib/utils/saida-entrada-draft-store';

/**
 * Rascunhos da tela de Saídas/Entradas (ver `lib/utils/saida-entrada-draft-store.ts`).
 *
 * GET    ?company=nerd                      → rascunhos pendentes da empresa
 * PUT    { company, tipoOperacao, filial, tela, listaId, itens, … }
 *                                            → salva/atualiza (lista vazia apaga)
 *                                            409 RASCUNHO_ASSUMIDO/RASCUNHO_DESCARTADO: outra tela
 *                                                levou/descartou a lista (vem a foto do que saiu)
 *                                            409 RASCUNHO_CONFLITO: a chave tem outra lista
 * DELETE ?company=&tipoOperacao=&filial=&tela=[&romaneioEdicao=] → apaga o rascunho
 *                                            DESTA tela (romaneio registrado)
 * DELETE ?id=…&tela=…                       → descartar pela aba Rascunhos;
 *                                            423 RASCUNHO_EM_USO se a tela dona está mexendo
 * POST   { acao: 'assumir', id, tela }      → retoma um rascunho da aba, relido na hora;
 *                                            404 se não existe mais, 423 se está em uso
 * POST   { acao: 'visto', id, listaId }     → sinal de vida da tela dona + conferência de posse
 */

function getUsername(request: Request): string {
  return (request.headers.get('x-auth-username') || '').trim();
}

function normalizeTipo(value: unknown): TipoOperacaoRascunho {
  return String(value ?? '').trim().toLowerCase() === 'entrada' ? 'entrada' : 'saida';
}

function respostaEvento(evento: {
  acao: 'assumido' | 'descartado';
  por: string;
  em: string;
  itens: RascunhoItem[];
  observacao: string;
}) {
  return NextResponse.json(
    {
      error:
        evento.acao === 'assumido'
          ? `Esta lista foi assumida por ${evento.por}.`
          : `Esta lista foi descartada por ${evento.por}.`,
      code: evento.acao === 'assumido' ? 'RASCUNHO_ASSUMIDO' : 'RASCUNHO_DESCARTADO',
      evento,
    },
    { status: 409 }
  );
}

function respostaEmUso(usuario: string, vistoEm: string | null) {
  return NextResponse.json(
    {
      error:
        `Esta lista está aberta agora na tela de ${usuario}. ` +
        `Peça para ${usuario} registrar ou fechar a tela — ou espere ela ficar parada.`,
      code: 'RASCUNHO_EM_USO',
      usuario,
      vistoEm,
    },
    { status: 423 }
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = (searchParams.get('company') || '').trim();

  if (!companyKey) {
    return NextResponse.json({ error: 'Parâmetro "company" é obrigatório.' }, { status: 400 });
  }

  try {
    const lista = await listarRascunhos(companyKey);
    // "Em uso" decidido aqui, no relógio do servidor (o do caixa pode estar errado).
    const agora = Date.now();
    const data = lista.map((r) => ({ ...r, emUso: rascunhoEmUso(r, agora) }));
    return NextResponse.json({ data });
  } catch (error) {
    console.error('Erro ao listar rascunhos de saída/entrada', error);
    return NextResponse.json({ error: 'Erro ao listar rascunhos' }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const username = getUsername(request);
  if (!username) {
    return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as {
      company?: string;
      companyKey?: string;
      tipoOperacao?: string;
      filial?: string;
      filialLabel?: string | null;
      filialDestino?: string | null;
      filialDestinoLabel?: string | null;
      tipoRomaneio?: string | null;
      observacao?: string | null;
      romaneioEdicao?: string | null;
      tela?: string | null;
      listaId?: string | null;
      itens?: RascunhoItem[];
    };

    const companyKey = (body.company || body.companyKey || '').trim();
    const filial = (body.filial || '').trim();

    if (!companyKey || !filial) {
      return NextResponse.json(
        { error: 'Parâmetros "company" e "filial" são obrigatórios.' },
        { status: 400 }
      );
    }

    const resultado = await salvarRascunho({
      companyKey,
      username,
      tipoOperacao: normalizeTipo(body.tipoOperacao),
      filial,
      filialLabel: body.filialLabel ?? null,
      filialDestino: body.filialDestino ?? null,
      filialDestinoLabel: body.filialDestinoLabel ?? null,
      tipoRomaneio: body.tipoRomaneio ?? null,
      observacao: body.observacao ?? null,
      romaneioEdicao: body.romaneioEdicao ?? null,
      tela: body.tela ?? null,
      listaId: body.listaId ?? null,
      itens: Array.isArray(body.itens) ? body.itens : [],
    });

    if (resultado.status === 'evento') return respostaEvento(resultado.evento);
    if (resultado.status === 'conflito') {
      return NextResponse.json(
        { error: 'Esta tela tem outra lista salva.', code: 'RASCUNHO_CONFLITO', atual: resultado.atual },
        { status: 409 }
      );
    }
    return NextResponse.json({ data: resultado.status === 'ok' ? resultado.rascunho : null });
  } catch (error) {
    console.error('Erro ao salvar rascunho de saída/entrada', error);
    return NextResponse.json({ error: 'Erro ao salvar rascunho' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const username = getUsername(request);
  if (!username) {
    return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
  }

  try {
    const body = (await request.json()) as { acao?: string; id?: string; tela?: string | null; listaId?: string };
    const id = (body.id || '').trim();

    if (body.acao === 'visto') {
      const listaId = (body.listaId || '').trim();
      if (!id || !listaId) {
        return NextResponse.json({ error: 'Informe { acao: "visto", id, listaId }.' }, { status: 400 });
      }
      const visto = await marcarVisto(id, listaId);
      if (visto.status === 'evento') return respostaEvento(visto.evento);
      return NextResponse.json({ ok: true, status: visto.status });
    }

    if (body.acao !== 'assumir' || !id) {
      return NextResponse.json({ error: 'Informe { acao: "assumir", id }.' }, { status: 400 });
    }

    const resultado = await assumirRascunho(id, username, (body.tela || '').trim() || null);
    if (!resultado.ok) {
      if (resultado.motivo === 'em_uso') return respostaEmUso(resultado.usuario, resultado.vistoEm);
      return NextResponse.json(
        {
          error:
            'Este rascunho não existe mais — o romaneio já foi registrado ou outra pessoa assumiu a lista. Confira o histórico antes de montar de novo.',
          code: 'RASCUNHO_INEXISTENTE',
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      data: resultado.rascunho,
      deUsuario: resultado.deUsuario,
      jaEraDaTela: resultado.jaEraDaTela,
      somado: resultado.somado,
      itensAssumidos: resultado.itensAssumidos,
    });
  } catch (error) {
    console.error('Erro ao assumir rascunho de saída/entrada', error);
    return NextResponse.json({ error: 'Erro ao retomar o rascunho' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const username = getUsername(request);
  const { searchParams } = new URL(request.url);
  const idParam = (searchParams.get('id') || '').trim();
  const tela = (searchParams.get('tela') || '').trim() || null;

  try {
    if (idParam) {
      // Apagar rascunho de outra pessoa é permitido de propósito: a lista é da
      // LOJA, e quem assume a conferência precisa poder descartar o que ficou
      // pendurado do turno anterior. Só não da mão de quem está bipando agora.
      const resultado = await descartarRascunho(idParam, username, tela);
      if (!resultado.ok) return respostaEmUso(resultado.usuario, resultado.vistoEm);
      return NextResponse.json({ ok: true });
    }

    if (!username) {
      return NextResponse.json({ error: 'Usuário não identificado.' }, { status: 401 });
    }

    const companyKey = (searchParams.get('company') || '').trim();
    const filial = (searchParams.get('filial') || '').trim();
    const tipoOperacao = normalizeTipo(searchParams.get('tipoOperacao'));

    if (!companyKey || !filial) {
      return NextResponse.json(
        { error: 'Informe "id" ou ("company" + "filial").' },
        { status: 400 }
      );
    }

    const romaneioEdicao = (searchParams.get('romaneioEdicao') || '').trim() || null;
    await removerRascunho(rascunhoId(companyKey, username, tipoOperacao, filial, romaneioEdicao, tela));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Erro ao remover rascunho de saída/entrada', error);
    return NextResponse.json({ error: 'Erro ao remover rascunho' }, { status: 500 });
  }
}

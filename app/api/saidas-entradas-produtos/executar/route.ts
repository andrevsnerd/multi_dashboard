import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, forwardTransferToProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { executeSaidaLote, executeEntradaLote } from '@/lib/saida-entrada-executor';

interface ItemOperacao {
  produto: string;
  corProduto: string | null;
  quantidade: number;
}

interface SaidaEntradaRequest {
  tipoOperacao: 'saida' | 'entrada';
  filial: string;
  filialDestino?: string | null;
  itens: ItemOperacao[];
  tipoRomaneio?: string;
  responsavel?: string;
  observacao?: string | null;
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const body = (await request.json()) as SaidaEntradaRequest;
    const {
      tipoOperacao,
      filial,
      filialDestino = null,
      itens,
      tipoRomaneio = tipoOperacao === 'saida' ? 'TRANSFERENCIA' : 'ENTRADA AVULSA',
      responsavel = 'LOGISTICA',
      observacao = null,
    } = body;

    // Validar dados
    if (!filial || !tipoOperacao || !itens || itens.length === 0) {
      return NextResponse.json(
        { error: 'Dados inválidos para operação' },
        { status: 400 }
      );
    }

    for (const item of itens) {
      if (!item.produto || item.quantidade <= 0) {
        return NextResponse.json(
          { error: 'Dados inválidos: cada item precisa de produto e quantidade > 0' },
          { status: 400 }
        );
      }
    }

    if (tipoOperacao !== 'saida' && tipoOperacao !== 'entrada') {
      return NextResponse.json(
        { error: 'tipoOperacao deve ser "saida" ou "entrada"' },
        { status: 400 }
      );
    }

    const filialTrim = filial.trim();

    if (!username) {
      return NextResponse.json(
        { error: 'Usuário não identificado. Faça login novamente.' },
        { status: 401 }
      );
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json(
        { error: 'Usuário não encontrado' },
        { status: 403 }
      );
    }

    const permissao = await getPermissaoByUsername(user.username);

    if (user.role !== 'admin') {
      if (!permissao) {
        return NextResponse.json(
          { error: 'Sem permissão para realizar esta operação. Configure o perfil em Admin.' },
          { status: 403 }
        );
      }
      const filialOk = tipoOperacao === 'saida'
        ? (permissao.filiaisOrigem.length === 0 ||
           permissao.filiaisOrigem.some((p) => (p || '').trim() === filialTrim))
        : (permissao.filiaisDestino.length === 0 ||
           permissao.filiaisDestino.some((p) => (p || '').trim() === filialTrim));
      if (!filialOk) {
        return NextResponse.json(
          { error: 'Sem permissão para esta filial.' },
          { status: 403 }
        );
      }
    }

    // Responsável: sempre usa o configurado pelo admin para aquele login.
    // O valor enviado pelo cliente é completamente ignorado.
    const responsavelFinal = permissao?.responsavelPadrao || 'LOGISTICA';

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const result = tipoOperacao === 'saida'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await executeSaidaLote(pool, { itens, filial, filialDestino, tipoRomaneio, responsavel: responsavelFinal, observacao } as any)
      : await executeEntradaLote(pool, { itens, filial, tipoRomaneio, responsavel: responsavelFinal, observacao });

    return NextResponse.json({
      success: true,
      romaneio: result.romaneio,
      message: result.message,
    });
  } catch (error: any) {
    console.error('Erro ao executar operação', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao executar operação' },
      { status: 500 }
    );
  }
}

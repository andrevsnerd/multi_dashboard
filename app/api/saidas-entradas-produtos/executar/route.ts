import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, forwardTransferToProxy } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { executeSaida, executeEntrada } from '@/lib/saida-entrada-executor';

interface SaidaEntradaRequest {
  tipoOperacao: 'saida' | 'entrada';
  produto: string;
  corProduto: string | null;
  filial: string;
  quantidade: number;
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
      produto,
      corProduto,
      filial,
      quantidade,
      tipoRomaneio = tipoOperacao === 'saida' ? 'TRANSFERENCIA' : 'ENTRADA AVULSA',
      responsavel = 'LOGISTICA',
      observacao = null,
    } = body;

    // Validar dados
    if (!produto || !filial || quantidade <= 0 || !tipoOperacao) {
      return NextResponse.json(
        { error: 'Dados inválidos para operação' },
        { status: 400 }
      );
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

    {
      const user = await findUserByUsername(username);
      if (!user) {
        return NextResponse.json(
          { error: 'Usuário não encontrado' },
          { status: 403 }
        );
      }
      if (user.role !== 'admin') {
        const permissao = await getPermissaoByUsername(user.username);
        if (!permissao) {
          return NextResponse.json(
            { error: 'Sem permissão para realizar esta operação. Configure o perfil em Admin.' },
            { status: 403 }
          );
        }
        // Para saída: verificar filiaisOrigem, para entrada: verificar filiaisDestino
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
    }

    if (shouldUseProxy()) {
      // Para proxy, precisaríamos adaptar o forwardTransferToProxy ou criar um novo método
      // Por enquanto, vamos executar diretamente mesmo via proxy
      // TODO: Implementar proxy específico para saida/entrada se necessário
    }

    const pool = await getConnectionPool();
    const result = tipoOperacao === 'saida'
      ? await executeSaida(pool, {
          produto,
          corProduto,
          filial,
          quantidade,
          tipoRomaneio,
          responsavel,
          observacao,
        })
      : await executeEntrada(pool, {
          produto,
          corProduto,
          filial,
          quantidade,
          tipoRomaneio,
          responsavel,
          observacao,
        });

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

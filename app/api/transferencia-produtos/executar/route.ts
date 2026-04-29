import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, forwardTransferToProxy } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { executeTransfer } from '@/lib/transfer-executor';
import { getActiveFilial, resolveCompany } from '@/lib/config/company';

interface TransferenciaRequest {
  produto: string;
  corProduto: string | null;
  filialOrigem: string;
  filialDestino: string;
  qtdeSaida: number;
  qtdeEntrada: number;
  tipoRomaneio?: string;
  responsavel?: string;
  observacao?: string | null;
  companyKey?: string;
}

function getActiveFilialForRequest(companyKey: string | undefined, filial: string): string {
  const preferredCompany = resolveCompany(companyKey);
  if (preferredCompany) {
    return getActiveFilial(preferredCompany, filial);
  }

  for (const key of ['nerd', 'scarfme']) {
    const company = resolveCompany(key);
    const active = getActiveFilial(company, filial);
    if (active !== filial.trim()) return active;
  }

  return filial.trim();
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const body = (await request.json()) as TransferenciaRequest;
    const {
      produto,
      corProduto,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio = 'TRANSFERENCIA',
      responsavel = 'LOGISTICA',
      observacao = null,
      companyKey,
    } = body;

    // Validar dados
    if (!produto || !filialOrigem || !filialDestino || qtdeSaida <= 0 || qtdeEntrada <= 0) {
      return NextResponse.json(
        { error: 'Dados inválidos para transferência' },
        { status: 400 }
      );
    }

    const fo = getActiveFilialForRequest(companyKey, filialOrigem.trim());
    const fd = getActiveFilialForRequest(companyKey, filialDestino.trim());

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
            { error: 'Sem permissão para transferir. Configure o perfil em Admin.' },
            { status: 403 }
          );
        }
        const origemOk = permissao.filiaisOrigem.length === 0 ||
          permissao.filiaisOrigem.some((p) => getActiveFilialForRequest(companyKey, (p || '').trim()) === fo);
        const destinoOk = permissao.filiaisDestino.length === 0 ||
          permissao.filiaisDestino.some((p) => getActiveFilialForRequest(companyKey, (p || '').trim()) === fd);
        if (!origemOk || !destinoOk) {
          return NextResponse.json(
            { error: 'Sem permissão para esta origem ou destino.' },
            { status: 403 }
          );
        }
      }
    }

    if (shouldUseProxy()) {
      const proxyResponse = await forwardTransferToProxy(
        {
          produto,
          corProduto,
          filialOrigem: fo,
          filialDestino: fd,
          qtdeSaida,
          qtdeEntrada,
          tipoRomaneio,
          responsavel,
          observacao,
        },
        request.headers
      );
      const proxyJson = await proxyResponse.json().catch(() => ({}));
      return NextResponse.json(
        proxyJson.success ? proxyJson : { error: proxyJson.error || 'Erro ao executar transferência via proxy' },
        { status: proxyResponse.ok ? 200 : proxyResponse.status }
      );
    }

    const pool = await getConnectionPool();
    const result = await executeTransfer(pool, {
      produto,
      corProduto,
      filialOrigem: fo,
      filialDestino: fd,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio,
      responsavel,
      observacao,
    });

    return NextResponse.json({
      success: true,
      romaneioSaida: result.romaneioSaida,
      romaneioEntrada: result.romaneioEntrada,
      message: result.message,
    });
  } catch (error: any) {
    console.error('Erro ao executar transferência', error);
    return NextResponse.json(
      { error: error.message || 'Erro ao executar transferência' },
      { status: 500 }
    );
  }
}

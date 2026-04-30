import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, forwardTransferToProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { executeSaidaLote, executeEntradaLote } from '@/lib/saida-entrada-executor';
import { getActiveFilial } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';

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
  companyKey?: string;
}

function isTransferenciaEntreLojas(tipoRomaneio: string): boolean {
  const normalized = (tipoRomaneio || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  return normalized.includes('TRANSFERENCIA ENTRE LOJAS');
}

async function getActiveFilialForRequest(companyKey: string | undefined, filial: string): Promise<string> {
  const preferredCompany = await resolveCompanyDynamic(companyKey);
  if (preferredCompany) {
    return getActiveFilial(preferredCompany, filial);
  }

  for (const key of ['nerd', 'scarfme']) {
    const company = await resolveCompanyDynamic(key);
    const active = getActiveFilial(company, filial);
    if (active !== filial.trim()) return active;
  }

  return filial.trim();
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
      companyKey,
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

    const filialTrim = await getActiveFilialForRequest(companyKey, filial.trim());
    const filialDestinoTrim = filialDestino
      ? await getActiveFilialForRequest(companyKey, filialDestino.trim())
      : filialDestino;

    if (tipoOperacao === 'saida' && isTransferenciaEntreLojas(tipoRomaneio) && !filialDestinoTrim) {
      return NextResponse.json(
        { error: 'Filial destino é obrigatória para romaneio do tipo TRANSFERENCIA ENTRE LOJAS.' },
        { status: 400 }
      );
    }

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
           (await Promise.all(permissao.filiaisOrigem.map((p) => getActiveFilialForRequest(companyKey, (p || '').trim())))).some((a) => a === filialTrim))
        : (permissao.filiaisDestino.length === 0 ||
           (await Promise.all(permissao.filiaisDestino.map((p) => getActiveFilialForRequest(companyKey, (p || '').trim())))).some((a) => a === filialTrim));
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
      ? await executeSaidaLote(pool, { itens, filial: filialTrim, filialDestino: filialDestinoTrim, tipoRomaneio, responsavel: responsavelFinal, observacao } as any)
      : await executeEntradaLote(pool, { itens, filial: filialTrim, tipoRomaneio, responsavel: responsavelFinal, observacao });

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

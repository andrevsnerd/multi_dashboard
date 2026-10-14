import { NextResponse } from 'next/server';

import { findUserByUsername } from '@/lib/auth/users-store';
import { readOnlyBlock } from '@/lib/auth/route-guards';
import { getActiveFilial } from '@/lib/config/company';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, forwardTransferToProxy } from '@/lib/db/proxy';
import { executeTransfer } from '@/lib/transfer-executor';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { mensagemTravaEstoqueNegativo, verificarSaldoSaida } from '@/lib/server/trava-estoque-negativo';

/** Ver o bloco no início do POST. */
const TRANSFERENCIA_LEGADA_DESATIVADA = true;

interface TransferenciaRequest {
  produto: string;
  corProduto: string | null;
  filialOrigem: string;
  filialDestino: string;
  qtdeSaida: number;
  qtdeEntrada: number;
  tipoRomaneio?: string;
  /**
   * IGNORADO. O responsável gravado no Linx é sempre o usuário do Linx atrelado ao
   * login (resolveResponsavelLinx) — o cliente não escolhe em nome de quem grava.
   * Mantido no tipo só para não quebrar chamadores antigos que ainda mandam.
   */
  responsavel?: string;
  observacao?: string | null;
  companyKey?: string;
  idempotencyKey?: string | null;
  permitirDuplicado?: boolean;
}

// Resolve a filial informada para a CANÔNICA ATIVA detectada ao vivo (venda mais recente
// entre os membros do grupo — ex.: rodízio MSC↔AKS do e-commerce). Precisa ser dinâmico:
// esta é a rota que GRAVA o romaneio, então usar a canônica estática mandaria a movimentação
// para a filial errada quando o rodízio girasse.
async function getActiveFilialForRequest(companyKey: string | undefined, filial: string): Promise<string> {
  const preferredCompany = await resolveCompanyDynamic(companyKey);
  if (preferredCompany) {
    return getActiveFilial(preferredCompany, filial);
  }

  for (const key of ['nerd', 'scarfme']) {
    const company = await resolveCompanyDynamic(key);
    if (!company) continue;
    const active = getActiveFilial(company, filial);
    if (active !== filial.trim()) return active;
  }

  return filial.trim();
}

export async function POST(request: Request) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const readOnly = await readOnlyBlock(username);
    if (readOnly) return readOnly;
    // DESATIVADA em 14/10/2026. `executeTransfer` grava os itens SEM a coluna de
    // grade (SA_n/EN_n) e acerta `ESTOQUE_PRODUTOS.ESTOQUE` com UPDATE na mão: o
    // total anda e ES1..ES48 não — ESTOQUE ≠ soma(ES) em centenas de linhas
    // (fev–abr/2026) e romaneio que a exclusão não reverte. Sem uso desde 09/04/2026;
    // transferência se faz pela tela Saídas/Entradas (executor por trigger). Só
    // reativar depois de o executor gravar pela grade e deixar o trigger mover o estoque.
    if (TRANSFERENCIA_LEGADA_DESATIVADA) {
      return NextResponse.json(
        {
          error:
            'Esta tela de transferência foi desativada porque gravava o estoque de forma inconsistente. ' +
            'Use a tela Saídas/Entradas de Produtos para transferir.',
        },
        { status: 410 }
      );
    }

    const body = (await request.json()) as TransferenciaRequest;
    const {
      produto,
      corProduto,
      filialOrigem,
      filialDestino,
      qtdeSaida,
      qtdeEntrada,
      tipoRomaneio = 'TRANSFERENCIA',
      observacao = null,
      companyKey,
      idempotencyKey = null,
      permitirDuplicado = false,
    } = body;

    if (!produto || !filialOrigem || !filialDestino || qtdeSaida <= 0 || qtdeEntrada <= 0) {
      return NextResponse.json(
        { error: 'Dados invalidos para transferencia' },
        { status: 400 }
      );
    }

    const fo = await getActiveFilialForRequest(companyKey, filialOrigem.trim());
    const fd = await getActiveFilialForRequest(companyKey, filialDestino.trim());

    if (!username) {
      return NextResponse.json(
        { error: 'Usuario nao identificado. Faca login novamente.' },
        { status: 401 }
      );
    }

    // Responsável gravado no Linx: o usuário do Linx atrelado a este login.
    const responsavel = await resolveResponsavelLinx(username);

    {
      const user = await findUserByUsername(username);
      if (!user) {
        return NextResponse.json(
          { error: 'Usuario nao encontrado' },
          { status: 403 }
        );
      }

      if (user.role !== 'admin') {
        const permissao = await getPermissaoByUsername(user.username);
        if (!permissao) {
          return NextResponse.json(
            { error: 'Sem permissao para transferir. Configure o perfil em Admin.' },
            { status: 403 }
          );
        }

        const origemOk =
          permissao.filiaisOrigem.length === 0 ||
          (await Promise.all(permissao.filiaisOrigem.map((p) => getActiveFilialForRequest(companyKey, (p || '').trim())))).some((a) => a === fo);
        const destinoOk =
          permissao.filiaisDestino.length === 0 ||
          (await Promise.all(permissao.filiaisDestino.map((p) => getActiveFilialForRequest(companyKey, (p || '').trim())))).some((a) => a === fd);

        if (!origemOk || !destinoOk) {
          return NextResponse.json(
            { error: 'Sem permissao para esta origem ou destino.' },
            { status: 403 }
          );
        }
      }
    }

    // TRAVA DE ESTOQUE NEGATIVO — origem com PERMITE_EST_NEGATIVO = 0 no Linx
    // (ex.: NERD matriz) não transfere além do saldo. Ver lib/server/trava-estoque-negativo.ts.
    const travaSaldo = await verificarSaldoSaida(fo, [{ produto, corProduto, quantidade: qtdeSaida }]);
    if (travaSaldo) {
      return NextResponse.json(
        { error: mensagemTravaEstoqueNegativo(travaSaldo), travaEstoqueNegativo: travaSaldo },
        { status: 409 }
      );
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
          idempotencyKey,
          permitirDuplicado,
        },
        request.headers
      );

      const proxyJson = await proxyResponse.json().catch(() => ({}));
      if (proxyJson.success) {
        return NextResponse.json(proxyJson, { status: 200 });
      }
      // Propaga a trava de duplicação como 409 estruturado (o proxy repassa code/romaneioExistente).
      if (proxyJson.code === 'TRANSFERENCIA_DUPLICADA') {
        return NextResponse.json(
          {
            error: proxyJson.error,
            code: 'TRANSFERENCIA_DUPLICADA',
            romaneioExistente: proxyJson.romaneioExistente,
            segundosAtras: proxyJson.segundosAtras,
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: proxyJson.error || 'Erro ao executar transferencia via proxy' },
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
      idempotencyKey,
      permitirDuplicado,
    });

    return NextResponse.json({
      success: true,
      romaneioSaida: result.romaneioSaida,
      romaneioEntrada: result.romaneioEntrada,
      message: result.message,
      deduplicado: result.deduplicado || false,
    });
  } catch (error: unknown) {
    // Trava anti-duplicação: devolve 409 estruturado para o cliente decidir (confirmar reenvio).
    if (error && typeof error === 'object' && (error as { code?: string }).code === 'TRANSFERENCIA_DUPLICADA') {
      const e = error as { message?: string; romaneioExistente?: string; segundosAtras?: number };
      return NextResponse.json(
        {
          error: e.message,
          code: 'TRANSFERENCIA_DUPLICADA',
          romaneioExistente: e.romaneioExistente,
          segundosAtras: e.segundosAtras,
        },
        { status: 409 }
      );
    }
    console.error('Erro ao executar transferencia', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao executar transferencia' },
      { status: 500 }
    );
  }
}

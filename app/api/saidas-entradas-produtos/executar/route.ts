import { NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { getPermissaoByUsername } from '@/lib/utils/transferencia-permissoes-store';
import { setDestinoRomaneio } from '@/lib/utils/destino-romaneio-store';
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
  liberarTransitoAutomaticamente?: boolean;
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

async function liberarEntradaTransitoAutomaticamente(
  pool: ProxyPool | Awaited<ReturnType<typeof getConnectionPool>>,
  filial: string,
  romaneio: string
): Promise<boolean> {
  const req = pool.request();
  req.input('filial', filial.trim());
  req.input('romaneio', romaneio.trim());
  const result = await req.query(`
    DECLARE @updated INT;

    UPDATE LOJA_ENTRADAS
       SET STATUS_TRANSITO = 4,
           ENTRADA_CONFERIDA = 1,
           DATA_PARA_TRANSFERENCIA = GETDATE(),
           OBS = CASE
             WHEN OBS IS NULL OR LTRIM(RTRIM(CONVERT(VARCHAR(200), OBS))) = ''
               THEN 'Retirado do Transito pela Tela de Liberação'
             WHEN CONVERT(VARCHAR(200), OBS) LIKE '%Retirado do Transito pela Tela de Liberação%'
               THEN OBS
             ELSE CONVERT(VARCHAR(200), OBS) + ' - Retirado do Transito pela Tela de Liberação'
           END
     WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
       AND LTRIM(RTRIM(FILIAL)) = @filial
       AND (STATUS_TRANSITO IS NULL OR STATUS_TRANSITO < 4)
       AND ISNULL(ENTRADA_CONFERIDA, 0) = 0
       AND ISNULL(ENTRADA_ENCERRADA, 0) = 1
       AND NOT EXISTS (
         SELECT 1
           FROM LOJA_ENTRADAS_PRODUTO lep
          WHERE lep.ROMANEIO_PRODUTO = LOJA_ENTRADAS.ROMANEIO_PRODUTO
            AND lep.FILIAL = LOJA_ENTRADAS.FILIAL
       )
       AND EXISTS (
         SELECT 1
           FROM ESTOQUE_PROD1_ENT e
          WHERE e.ROMANEIO_PRODUTO = LOJA_ENTRADAS.ROMANEIO_PRODUTO
            AND e.FILIAL = LOJA_ENTRADAS.FILIAL
       );

    SET @updated = @@ROWCOUNT;

    SELECT
      @updated AS UPDATED,
      STATUS_TRANSITO,
      ENTRADA_CONFERIDA
    FROM LOJA_ENTRADAS
    WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
      AND LTRIM(RTRIM(FILIAL)) = @filial;
  `);

  const row = result.recordset?.[0] as
    | { UPDATED?: number; STATUS_TRANSITO?: number | null; ENTRADA_CONFERIDA?: boolean | number | null }
    | undefined;

  return (
    Number(row?.UPDATED ?? 0) === 1 &&
    Number(row?.STATUS_TRANSITO ?? 0) === 4 &&
    (row?.ENTRADA_CONFERIDA === true || Number(row?.ENTRADA_CONFERIDA ?? 0) === 1)
  );
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
      observacao = null,
      companyKey,
      liberarTransitoAutomaticamente = false,
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

    let autoReleaseMessage = '';
    if (tipoOperacao === 'entrada' && liberarTransitoAutomaticamente && result.romaneio) {
      try {
        const released = await liberarEntradaTransitoAutomaticamente(pool, filialTrim, result.romaneio);
        if (!released) {
          console.error('Entrada criada, mas não foi possível liberar trânsito automaticamente', {
            filial: filialTrim,
            romaneio: result.romaneio,
          });
          autoReleaseMessage = ' Entrada criada, mas a liberação automática do trânsito precisa de revisão manual.';
        }
      } catch (releaseError) {
        console.error('Falha ao liberar trânsito automaticamente', releaseError);
        autoReleaseMessage = ' Entrada criada, mas a liberação automática do trânsito precisa de revisão manual.';
      }
    }

    if (tipoOperacao === 'saida' && companyKey && filialDestinoTrim && result.romaneio) {
      try {
        await setDestinoRomaneio(companyKey, result.romaneio, filialTrim, filialDestinoTrim);
      } catch (destinoError) {
        console.error('Erro ao salvar destino auxiliar do romaneio', destinoError);
      }
    }

    return NextResponse.json({
      success: true,
      romaneio: result.romaneio,
      message: `${result.message}${autoReleaseMessage}`,
    });
  } catch (error: unknown) {
    console.error('Erro ao executar operação', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao executar operação' },
      { status: 500 }
    );
  }
}

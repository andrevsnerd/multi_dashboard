import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';

import { withRequest, getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { readOnlyBlock } from '@/lib/auth/route-guards';
import { canEditarRomaneioSaida } from '@/lib/auth/permissions';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import { getConfirmados } from '@/lib/utils/romaneio-confirmacao-store';
import { executeSaidaAppend } from '@/lib/saida-entrada-executor';

/**
 * REABRIR ROMANEIO DE SAÍDA — espelho de `entrada-editar`: o operador esqueceu
 * uma peça no romaneio já gravado e acrescenta em vez de emitir um segundo.
 *
 * GET  → itens já lançados + veredito de "pode editar" (para a tela montar a
 *        lista antes de deixar acrescentar peça).
 * POST → acrescenta os itens novos ao romaneio (executeSaidaAppend).
 *
 * Quem pode: admin e logística (canEditarRomaneioSaida). A loja registra a saída
 * dela, mas não reabre romaneio — acrescentar item TIRA estoque na hora.
 */

interface ItemSaida {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  quantidade: number;
  estoque: number;
}

interface EditarSaidaRequest {
  romaneio: string;
  filial: string;
  itens: Array<{ produto: string; corProduto: string | null; quantidade: number }>;
  companyKey?: string;
}

async function usuarioPodeEditar(username: string | null | undefined) {
  const nome = (username || '').trim();
  if (!nome) return { ok: false as const, status: 401, error: 'Usuário não identificado. Faça login novamente.' };

  const user = await findUserByUsername(nome);
  if (!user) return { ok: false as const, status: 403, error: 'Usuário não encontrado' };
  if (!canEditarRomaneioSaida(user.role)) {
    return {
      ok: false as const,
      status: 403,
      error: 'Acesso negado. Apenas administradores e logística podem editar romaneios de saída.',
    };
  }
  return { ok: true as const, user };
}

/** Nome da filial como está em FILIAIS (as tabelas de romaneio guardam o nome). */
async function resolverNomeFilial(filial: string): Promise<string> {
  const bruto = (filial || '').trim();
  if (!bruto) return bruto;

  return withRequest(async (req) => {
    req.input('filial', sql.VarChar, bruto);
    const result = await req.query<{ FILIAL: string }>(`
      SELECT TOP 1 LTRIM(RTRIM(FILIAL)) AS FILIAL
      FROM FILIAIS WITH (NOLOCK)
      WHERE LTRIM(RTRIM(COD_FILIAL)) = @filial OR LTRIM(RTRIM(FILIAL)) = @filial
    `);
    return result.recordset[0]?.FILIAL?.toString().trim() || bruto;
  });
}

/**
 * Só SAÍDA AVULSA é editável — a que esta tela cria (sem ROMANEIO_DESTINO, sem
 * LOJA_SAIDAS_PRODUTO, sem nota). Saída pareada com uma entrada gerada pelo Linx
 * tem o outro lado amarrado: acrescentar peça aqui deixaria origem e destino
 * divergentes, então a tela nem oferece.
 */
async function verificarEditavel(
  romaneio: string,
  filialNome: string
): Promise<{ editavel: boolean; motivo: string | null; filialDestino: string | null }> {
  return withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filialNome);
    const result = await req.query<{
      CABECALHO: number;
      COM_DESTINO: number;
      ITENS_LOJA: number;
      CANCELADA: number;
      COM_NOTA: number;
      FILIAL_DESTINO: string | null;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial) AS CABECALHO,
        (SELECT COUNT(*) FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial
            AND ISNULL(LTRIM(RTRIM(ROMANEIO_DESTINO)), '') <> '') AS COM_DESTINO,
        (SELECT COUNT(*) FROM LOJA_SAIDAS_PRODUTO WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial) AS ITENS_LOJA,
        (SELECT COUNT(*) FROM LOJA_SAIDAS WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial
            AND ISNULL(SAIDA_CANCELADA, 0) = 1) AS CANCELADA,
        (SELECT COUNT(*) FROM LOJA_SAIDAS WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial
            AND ISNULL(LTRIM(RTRIM(NUMERO_NF_TRANSFERENCIA)), '') <> '') AS COM_NOTA,
        (SELECT TOP 1 LTRIM(RTRIM(ISNULL(FILIAL_DESTINO, ''))) FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial) AS FILIAL_DESTINO
    `);

    const row = result.recordset[0];
    const filialDestino = (row?.FILIAL_DESTINO ?? '').toString().trim() || null;

    if (!row || !Number(row.CABECALHO)) {
      return { editavel: false, motivo: 'Romaneio de saída não encontrado nesta filial.', filialDestino };
    }
    if (Number(row.CANCELADA)) {
      return { editavel: false, motivo: 'Romaneio cancelado — não pode receber itens.', filialDestino };
    }
    if (Number(row.COM_DESTINO) || Number(row.ITENS_LOJA) || Number(row.COM_NOTA)) {
      return {
        editavel: false,
        motivo:
          'Romaneio pareado com entrada/nota de transferência (o outro lado já foi gerado). Só saídas avulsas podem receber itens novos.',
        filialDestino,
      };
    }
    return { editavel: true, motivo: null, filialDestino };
  });
}

/** Itens já lançados no romaneio, com estoque atual da filial de origem. */
async function lerItensDoRomaneio(romaneio: string, filialNome: string): Promise<ItemSaida[]> {
  return withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filialNome);
    const result = await req.query<{
      PRODUTO: string;
      COR_PRODUTO: string | null;
      QTDE: number;
      DESC_PRODUTO: string;
      DESC_COR: string;
      CODIGO_BARRA: string | null;
      ESTOQUE: number | null;
    }>(`
      SELECT
        sp.PRODUTO,
        sp.COR_PRODUTO,
        ISNULL(sp.QTDE, 0) AS QTDE,
        ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
        ISNULL(c.DESC_COR, '') AS DESC_COR,
        (SELECT TOP 1 pb.CODIGO_BARRA
           FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE pb.PRODUTO = sp.PRODUTO
            AND ISNULL(pb.COR_PRODUTO, '') = ISNULL(sp.COR_PRODUTO, '')
          ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC) AS CODIGO_BARRA,
        (SELECT TOP 1 es.ESTOQUE
           FROM ESTOQUE_PRODUTOS es WITH (NOLOCK)
          WHERE es.PRODUTO = sp.PRODUTO
            AND ISNULL(es.COR_PRODUTO, '') = ISNULL(sp.COR_PRODUTO, '')
            AND LTRIM(RTRIM(es.FILIAL)) = @filial) AS ESTOQUE
      FROM ESTOQUE_PROD1_SAI sp WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = sp.PRODUTO
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON LTRIM(RTRIM(c.PRODUTO)) = LTRIM(RTRIM(sp.PRODUTO))
         AND (LTRIM(RTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(sp.COR_PRODUTO AS VARCHAR(20))))
              OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, sp.COR_PRODUTO))
      WHERE LTRIM(RTRIM(sp.ROMANEIO_PRODUTO)) = @romaneio
        AND LTRIM(RTRIM(sp.FILIAL)) = @filial
      ORDER BY p.DESC_PRODUTO, sp.PRODUTO, sp.COR_PRODUTO
    `);

    return result.recordset.map((row) => ({
      produto: (row.PRODUTO ?? '').toString().trim(),
      corProduto: (row.COR_PRODUTO ?? '').toString().trim() || null,
      descProduto: (row.DESC_PRODUTO ?? '').toString().trim(),
      descCor: (row.DESC_COR ?? '').toString().trim(),
      codigoBarra: (row.CODIGO_BARRA ?? '').toString().trim() || null,
      quantidade: Number(row.QTDE) || 0,
      estoque: Number(row.ESTOQUE) || 0,
    }));
  });
}

/**
 * A loja de destino já começou a conferir este romaneio? Não bloqueia (a peça
 * esquecida pode estar fisicamente na caixa), mas quem edita precisa saber que
 * está mexendo numa conferência em andamento do outro lado.
 */
async function avisoConferenciaDestino(
  companyKey: string,
  romaneio: string,
  filialDestino: string | null
): Promise<string | null> {
  if (!companyKey || !filialDestino) return null;
  try {
    const confirmados = await getConfirmados(companyKey, romaneio, filialDestino);
    let itens = 0;
    for (const qtde of confirmados.values()) if (qtde > 0) itens += 1;
    if (itens === 0) return null;
    return `O destino já confirmou ${itens} item(ns) deste romaneio — o que você acrescentar volta para a conferência dele.`;
  } catch {
    // Aviso é auxiliar: falha de leitura não pode travar a edição.
    return null;
  }
}

/**
 * GET /api/saidas-entradas-produtos/saida-editar?romaneio=016123&filial=NERD%20MATRIZ
 * Itens já lançados + se o romaneio aceita novos itens.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await usuarioPodeEditar(request.headers.get('x-auth-username'));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const romaneio = request.nextUrl.searchParams.get('romaneio')?.trim();
    const filial = request.nextUrl.searchParams.get('filial')?.trim();
    const companyKey = request.nextUrl.searchParams.get('company')?.trim() || '';
    if (!romaneio || !filial) {
      return NextResponse.json({ error: 'Parâmetros obrigatórios: romaneio, filial' }, { status: 400 });
    }

    const filialNome = await resolverNomeFilial(filial);
    const { editavel, motivo, filialDestino } = await verificarEditavel(romaneio, filialNome);
    const itens = editavel ? await lerItensDoRomaneio(romaneio, filialNome) : [];
    const aviso = editavel ? await avisoConferenciaDestino(companyKey, romaneio, filialDestino) : null;

    return NextResponse.json({ romaneio, filial: filialNome, filialDestino, editavel, motivo, aviso, itens });
  } catch (error) {
    console.error('Erro ao carregar romaneio de saída para edição', error);
    return NextResponse.json({ error: 'Erro ao carregar o romaneio de saída' }, { status: 500 });
  }
}

/**
 * POST /api/saidas-entradas-produtos/saida-editar
 * Acrescenta itens a um romaneio de saída existente.
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const readOnly = await readOnlyBlock(username);
    if (readOnly) return readOnly;

    const guard = await usuarioPodeEditar(username);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const body = (await request.json()) as EditarSaidaRequest;
    const romaneio = (body.romaneio || '').trim();
    const filial = (body.filial || '').trim();
    const itens = body.itens ?? [];

    if (!romaneio || !filial || itens.length === 0) {
      return NextResponse.json(
        { error: 'Dados inválidos: informe romaneio, filial e ao menos um item.' },
        { status: 400 }
      );
    }
    for (const item of itens) {
      if (!item.produto || !(item.quantidade > 0)) {
        return NextResponse.json(
          { error: 'Dados inválidos: cada item precisa de produto e quantidade > 0' },
          { status: 400 }
        );
      }
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const resultado = await executeSaidaAppend(pool, { romaneio, filial, itens });

    // Auditoria (não bloqueante): quem acrescentou o quê, depois do romaneio pronto.
    inserirAjuste({
      filial: resultado.filial,
      itens: itens.map((item) => ({
        produto: item.produto,
        cor: (item.corProduto ?? '').toString().trim(),
        qtde: Math.floor(Number(item.quantidade) || 0),
      })),
      romaneioRef: romaneio,
      tipoAjuste: 'EDICAO_ROMANEIO_SAIDA',
      responsavel: await resolveResponsavelLinx(username),
      obs: `Itens acrescentados ao romaneio de saída ${romaneio} (+${resultado.qtdeAdicionada} item(ns))`,
    }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));

    return NextResponse.json({
      success: true,
      romaneio: resultado.romaneio,
      qtdeAdicionada: resultado.qtdeAdicionada,
      message: resultado.message,
    });
  } catch (error: unknown) {
    console.error('Erro ao acrescentar itens ao romaneio de saída', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao editar o romaneio de saída' },
      { status: 500 }
    );
  }
}

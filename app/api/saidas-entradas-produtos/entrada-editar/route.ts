import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';

import { withRequest, getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { readOnlyBlock } from '@/lib/auth/route-guards';
import { canEditarRomaneioEntrada } from '@/lib/auth/permissions';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import { executeEntradaAppend } from '@/lib/saida-entrada-executor';

/**
 * REABRIR ROMANEIO DE ENTRADA — o Linx deixa abrir uma entrada já gravada e
 * continuar digitando itens; esta rota traz o mesmo para a tela de Saídas e
 * Entradas.
 *
 * GET  → itens já entrados + veredito de "pode editar" (para a tela montar a
 *        lista antes de deixar acrescentar peça).
 * POST → acrescenta os itens novos ao romaneio (executeEntradaAppend).
 *
 * Quem pode: admin e logística (canEditarRomaneioEntrada). Gerente registra a
 * entrada da loja dele, mas não reabre romaneio.
 */

interface ItemEntrada {
  produto: string;
  corProduto: string | null;
  descProduto: string;
  descCor: string;
  codigoBarra: string | null;
  quantidade: number;
  estoque: number;
}

interface EditarEntradaRequest {
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
  if (!canEditarRomaneioEntrada(user.role)) {
    return {
      ok: false as const,
      status: 403,
      error: 'Acesso negado. Apenas administradores e logística podem editar romaneios de entrada.',
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
 * Só ENTRADA DIRETA é editável. Transferência faturada pela matriz tem nota e
 * conferência de trânsito amarradas — acrescentar peça lá quebraria a
 * conferência, então a tela nem oferece.
 */
async function verificarEditavel(
  romaneio: string,
  filialNome: string
): Promise<{ editavel: boolean; motivo: string | null }> {
  return withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filialNome);
    const result = await req.query<{
      CABECALHO: number;
      COM_ORIGEM: number;
      ITENS_LOJA: number;
      CANCELADA: number;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial) AS CABECALHO,
        (SELECT COUNT(*) FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial
            AND ISNULL(LTRIM(RTRIM(FILIAL_ORIGEM)), '') <> '') AS COM_ORIGEM,
        (SELECT COUNT(*) FROM LOJA_ENTRADAS_PRODUTO WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial) AS ITENS_LOJA,
        (SELECT COUNT(*) FROM LOJA_ENTRADAS WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = @filial
            AND ISNULL(ENTRADA_CANCELADA, 0) = 1) AS CANCELADA
    `);

    const row = result.recordset[0];
    if (!row || !Number(row.CABECALHO)) {
      return { editavel: false, motivo: 'Romaneio de entrada não encontrado nesta filial.' };
    }
    if (Number(row.CANCELADA)) {
      return { editavel: false, motivo: 'Romaneio cancelado — não pode receber itens.' };
    }
    if (Number(row.COM_ORIGEM) || Number(row.ITENS_LOJA)) {
      return {
        editavel: false,
        motivo:
          'Romaneio de transferência/nota (segue o fluxo de trânsito). Só entradas diretas podem receber itens novos.',
      };
    }
    return { editavel: true, motivo: null };
  });
}

/** Itens já entrados no romaneio, com estoque atual da filial. */
async function lerItensDoRomaneio(romaneio: string, filialNome: string): Promise<ItemEntrada[]> {
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
        ep.PRODUTO,
        ep.COR_PRODUTO,
        ISNULL(ep.QTDE, 0) AS QTDE,
        ISNULL(p.DESC_PRODUTO, '') AS DESC_PRODUTO,
        ISNULL(c.DESC_COR, '') AS DESC_COR,
        (SELECT TOP 1 pb.CODIGO_BARRA
           FROM PRODUTOS_BARRA pb WITH (NOLOCK)
          WHERE pb.PRODUTO = ep.PRODUTO
            AND ISNULL(pb.COR_PRODUTO, '') = ISNULL(ep.COR_PRODUTO, '')
          ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))) ASC, pb.CODIGO_BARRA ASC) AS CODIGO_BARRA,
        (SELECT TOP 1 es.ESTOQUE
           FROM ESTOQUE_PRODUTOS es WITH (NOLOCK)
          WHERE es.PRODUTO = ep.PRODUTO
            AND ISNULL(es.COR_PRODUTO, '') = ISNULL(ep.COR_PRODUTO, '')
            AND LTRIM(RTRIM(es.FILIAL)) = @filial) AS ESTOQUE
      FROM ESTOQUE_PROD1_ENT ep WITH (NOLOCK)
      LEFT JOIN PRODUTOS p WITH (NOLOCK) ON p.PRODUTO = ep.PRODUTO
      LEFT JOIN (
        SELECT PRODUTO, COR_PRODUTO, MAX(DESC_COR_PRODUTO) AS DESC_COR
        FROM PRODUTO_CORES WITH (NOLOCK)
        GROUP BY PRODUTO, COR_PRODUTO
      ) c ON LTRIM(RTRIM(c.PRODUTO)) = LTRIM(RTRIM(ep.PRODUTO))
         AND (LTRIM(RTRIM(CAST(c.COR_PRODUTO AS VARCHAR(20)))) = LTRIM(RTRIM(CAST(ep.COR_PRODUTO AS VARCHAR(20))))
              OR TRY_CONVERT(INT, c.COR_PRODUTO) = TRY_CONVERT(INT, ep.COR_PRODUTO))
      WHERE LTRIM(RTRIM(ep.ROMANEIO_PRODUTO)) = @romaneio
        AND LTRIM(RTRIM(ep.FILIAL)) = @filial
      ORDER BY p.DESC_PRODUTO, ep.PRODUTO, ep.COR_PRODUTO
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
 * GET /api/saidas-entradas-produtos/entrada-editar?romaneio=016123&filial=NERD%20MATRIZ
 * Itens já entrados + se o romaneio aceita novos itens.
 */
export async function GET(request: NextRequest) {
  try {
    const guard = await usuarioPodeEditar(request.headers.get('x-auth-username'));
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const romaneio = request.nextUrl.searchParams.get('romaneio')?.trim();
    const filial = request.nextUrl.searchParams.get('filial')?.trim();
    if (!romaneio || !filial) {
      return NextResponse.json({ error: 'Parâmetros obrigatórios: romaneio, filial' }, { status: 400 });
    }

    const filialNome = await resolverNomeFilial(filial);
    const { editavel, motivo } = await verificarEditavel(romaneio, filialNome);
    const itens = editavel ? await lerItensDoRomaneio(romaneio, filialNome) : [];

    return NextResponse.json({ romaneio, filial: filialNome, editavel, motivo, itens });
  } catch (error) {
    console.error('Erro ao carregar romaneio de entrada para edição', error);
    return NextResponse.json({ error: 'Erro ao carregar o romaneio de entrada' }, { status: 500 });
  }
}

/**
 * POST /api/saidas-entradas-produtos/entrada-editar
 * Acrescenta itens a um romaneio de entrada existente.
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    const readOnly = await readOnlyBlock(username);
    if (readOnly) return readOnly;

    const guard = await usuarioPodeEditar(username);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const body = (await request.json()) as EditarEntradaRequest;
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
    const resultado = await executeEntradaAppend(pool, { romaneio, filial, itens });

    // Auditoria (não bloqueante): quem acrescentou o quê, depois do romaneio pronto.
    inserirAjuste({
      filial: resultado.filial,
      itens: itens.map((item) => ({
        produto: item.produto,
        cor: (item.corProduto ?? '').toString().trim(),
        qtde: Math.floor(Number(item.quantidade) || 0),
      })),
      romaneioRef: romaneio,
      tipoAjuste: 'EDICAO_ROMANEIO_ENTRADA',
      responsavel: await resolveResponsavelLinx(username),
      obs: `Itens acrescentados ao romaneio de entrada ${romaneio} (+${resultado.qtdeAdicionada} item(ns))`,
    }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));

    return NextResponse.json({
      success: true,
      romaneio: resultado.romaneio,
      qtdeAdicionada: resultado.qtdeAdicionada,
      message: resultado.message,
    });
  } catch (error: unknown) {
    console.error('Erro ao acrescentar itens ao romaneio de entrada', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao editar o romaneio de entrada' },
      { status: 500 }
    );
  }
}

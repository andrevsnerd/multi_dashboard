import { NextRequest, NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import { findUserByUsername } from '@/lib/auth/users-store';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import sql from 'mssql';

async function isAdmin(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

interface PreviewItem {
  produto: string;
  cor: string;
  qtde: number;
  estoqueAtual: number;
  estoqueFinal: number;
}

/**
 * Lê os itens do romaneio (ESTOQUE_PROD1_SAI/ENT) e o estoque atual de cada um
 * na filial do romaneio. Usado tanto pelo preview (GET) quanto pela reversão
 * de estoque do DELETE (modo=retornar).
 *
 * @param sinal +1 para saída (devolver à origem soma estoque), -1 para entrada
 *              (remover do destino subtrai estoque).
 */
async function lerItensComEstoque(
  tipo: 'saida' | 'entrada',
  romaneio: string,
  filial: string,
  sinal: 1 | -1
): Promise<PreviewItem[]> {
  return withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filial);

    const tabelaItens = tipo === 'saida' ? 'ESTOQUE_PROD1_SAI' : 'ESTOQUE_PROD1_ENT';
    // Mesmo JOIN do editar-qtd: estoque por (PRODUTO, COR) na filial (por COD_FILIAL ou nome).
    const result = await req.query<{
      PRODUTO: string;
      COR_PRODUTO: string | null;
      QTDE: number;
      ESTOQUE_ATUAL: number | null;
    }>(`
      SELECT
        i.PRODUTO,
        i.COR_PRODUTO,
        SUM(ISNULL(i.QTDE, 0)) AS QTDE,
        (
          SELECT TOP 1 ep.ESTOQUE
          FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
          INNER JOIN FILIAIS f WITH (NOLOCK)
            ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          WHERE ep.PRODUTO = i.PRODUTO
            AND ISNULL(ep.COR_PRODUTO, '') = ISNULL(i.COR_PRODUTO, '')
            AND (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filial))
                 OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filial)))
        ) AS ESTOQUE_ATUAL
      FROM ${tabelaItens} i WITH (NOLOCK)
      WHERE i.ROMANEIO_PRODUTO = @romaneio
        AND LTRIM(RTRIM(i.FILIAL)) = LTRIM(RTRIM(@filial))
      GROUP BY i.PRODUTO, i.COR_PRODUTO
    `);

    return result.recordset.map((row) => {
      const qtde = Number(row.QTDE) || 0;
      const estoqueAtual = Number(row.ESTOQUE_ATUAL) || 0;
      return {
        produto: (row.PRODUTO ?? '').toString().trim(),
        cor: (row.COR_PRODUTO ?? '').toString().trim(),
        qtde,
        estoqueAtual,
        estoqueFinal: estoqueAtual + sinal * qtde,
      };
    });
  });
}

/**
 * GET /api/saidas-entradas-produtos/log/[tipo]/[romaneio]/[filial]
 * Preview da exclusão (apenas admin): retorna itens + estoque atual/projetado.
 * Não escreve nada.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tipo: string; romaneio: string; filial: string }> }
) {
  try {
    const { tipo, romaneio, filial } = await params;

    const username = request.headers.get('x-auth-username')?.trim();
    if (!await isAdmin(username || null)) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas administradores podem visualizar a exclusão.' },
        { status: 403 }
      );
    }

    if (tipo !== 'saida' && tipo !== 'entrada') {
      return NextResponse.json(
        { error: 'Tipo inválido. Deve ser "saida" ou "entrada"' },
        { status: 400 }
      );
    }

    const sinal: 1 | -1 = tipo === 'saida' ? 1 : -1;
    const itens = await lerItensComEstoque(tipo, romaneio, filial, sinal);
    const totalItens = itens.reduce((s, i) => s + i.qtde, 0);

    return NextResponse.json({
      tipo,
      romaneio,
      filial,
      totalProdutos: itens.length,
      totalItens,
      itens,
    });
  } catch (error) {
    console.error('Erro ao gerar preview de exclusão de romaneio', error);
    return NextResponse.json(
      { error: 'Erro ao gerar preview de exclusão' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/saidas-entradas-produtos/log/[tipo]/[romaneio]/[filial]
 * Edita a observação de um log (apenas admin)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tipo: string; romaneio: string; filial: string }> }
) {
  try {
    const { tipo, romaneio, filial } = await params;
    const body = await request.json();
    const { observacao } = body;
    
    // Verificar autenticação e permissão de admin
    const username = request.headers.get('x-auth-username')?.trim();
    if (!await isAdmin(username || null)) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas administradores podem editar logs.' },
        { status: 403 }
      );
    }

    if (tipo !== 'saida' && tipo !== 'entrada') {
      return NextResponse.json(
        { error: 'Tipo inválido. Deve ser "saida" ou "entrada"' },
        { status: 400 }
      );
    }

    const observacaoEscaped = observacao ? observacao.replace(/'/g, "''") : null;

    await withRequest(async (req) => {
      if (tipo === 'saida') {
        // Atualizar OBS em ESTOQUE_PROD_SAI
        req.input('romaneio', sql.VarChar, romaneio);
        req.input('filial', sql.VarChar, filial);
        if (observacaoEscaped) {
          req.input('observacao', sql.VarChar, observacaoEscaped);
          await req.query(`
            UPDATE ESTOQUE_PROD_SAI
            SET OBS = @observacao
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        } else {
          await req.query(`
            UPDATE ESTOQUE_PROD_SAI
            SET OBS = NULL
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        }

        // Atualizar OBS em LOJA_SAIDAS
        if (observacaoEscaped) {
          req.input('observacao', sql.VarChar, observacaoEscaped);
          await req.query(`
            UPDATE LOJA_SAIDAS
            SET OBS = @observacao
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        } else {
          await req.query(`
            UPDATE LOJA_SAIDAS
            SET OBS = NULL
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        }
      } else {
        // Atualizar OBS em ESTOQUE_PROD_ENT
        req.input('romaneio', sql.VarChar, romaneio);
        req.input('filial', sql.VarChar, filial);
        if (observacaoEscaped) {
          req.input('observacao', sql.VarChar, observacaoEscaped);
          await req.query(`
            UPDATE ESTOQUE_PROD_ENT
            SET OBS = @observacao
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        } else {
          await req.query(`
            UPDATE ESTOQUE_PROD_ENT
            SET OBS = NULL
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        }

        // Atualizar OBS em LOJA_ENTRADAS
        if (observacaoEscaped) {
          req.input('observacao', sql.VarChar, observacaoEscaped);
          await req.query(`
            UPDATE LOJA_ENTRADAS
            SET OBS = @observacao
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        } else {
          await req.query(`
            UPDATE LOJA_ENTRADAS
            SET OBS = NULL
            WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
          `);
        }
      }
    });

    return NextResponse.json({ success: true, message: 'Log atualizado com sucesso' });
  } catch (error) {
    console.error('Erro ao editar log', error);
    return NextResponse.json(
      { error: 'Erro ao editar log' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/saidas-entradas-produtos/log/[tipo]/[romaneio]/[filial]
 * Remove completamente um log do sistema (apenas admin)
 * NOTA: NÃO reverte o estoque - apenas remove os registros do log
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tipo: string; romaneio: string; filial: string }> }
) {
  try {
    const { tipo, romaneio, filial } = await params;

    // Verificar autenticação e permissão de admin
    const username = request.headers.get('x-auth-username')?.trim();
    if (!await isAdmin(username || null)) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas administradores podem remover logs.' },
        { status: 403 }
      );
    }

    if (tipo !== 'saida' && tipo !== 'entrada') {
      return NextResponse.json(
        { error: 'Tipo inválido. Deve ser "saida" ou "entrada"' },
        { status: 400 }
      );
    }

    // modo=apenas (default): só remove os registros, não mexe no estoque.
    // modo=retornar: reverte o efeito de estoque do romaneio antes de remover.
    const modo = request.nextUrl.searchParams.get('modo') === 'retornar'
      ? 'retornar'
      : 'apenas';

    // Lê os itens (qtd + estoque atual) ANTES de qualquer delete, para auditoria.
    // saída: itens saíram da origem → devolver soma estoque (+).
    // entrada: itens entraram no destino → retornar remove estoque (-).
    const sinal: 1 | -1 = tipo === 'saida' ? 1 : -1;
    const itensRevertidos: PreviewItem[] =
      modo === 'retornar' ? await lerItensComEstoque(tipo, romaneio, filial, sinal) : [];

    // Reversão de estoque + deletes na mesma conexão, em ordem (reversão antes
    // dos deletes, pois agrega a partir dos itens ainda presentes no banco).
    await withRequest(async (req) => {
      req.input('romaneio', sql.VarChar, romaneio);
      req.input('filial', sql.VarChar, filial);

      if (modo === 'retornar') {
        // Espelha o ajuste manual de ESTOQUE_PRODUTOS do editar-qtd.
        // Operador embutido (+/-) conforme o tipo — não vem de input do usuário.
        const op = tipo === 'saida' ? '+' : '-';
        await req.query(`
          UPDATE ep
          SET ep.ESTOQUE = ep.ESTOQUE ${op} agg.QTDE
          FROM ESTOQUE_PRODUTOS ep
          INNER JOIN FILIAIS f WITH (NOLOCK)
            ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          INNER JOIN (
            SELECT PRODUTO, ISNULL(COR_PRODUTO, '') AS COR, SUM(ISNULL(QTDE, 0)) AS QTDE
            FROM ${tipo === 'saida' ? 'ESTOQUE_PROD1_SAI' : 'ESTOQUE_PROD1_ENT'} WITH (NOLOCK)
            WHERE ROMANEIO_PRODUTO = @romaneio
              AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filial))
            GROUP BY PRODUTO, ISNULL(COR_PRODUTO, '')
          ) agg
            ON ep.PRODUTO = agg.PRODUTO
           AND ISNULL(ep.COR_PRODUTO, '') = agg.COR
          WHERE (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filial))
                 OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filial)))
        `);
      }

      if (tipo === 'saida') {
        // Deletar registros relacionados (sem reverter estoque)
        await req.query(`
          DELETE FROM ESTOQUE_PROD1_SAI
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);

        await req.query(`
          DELETE FROM LOJA_SAIDAS_PRODUTO
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);

        await req.query(`
          DELETE FROM LOJA_SAIDAS
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);

        await req.query(`
          DELETE FROM ESTOQUE_PROD_SAI
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);
      } else {
        // ENTRADA - Deletar registros relacionados (sem reverter estoque)
        await req.query(`
          DELETE FROM ESTOQUE_PROD1_ENT
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);

        await req.query(`
          DELETE FROM LOJA_ENTRADAS_PRODUTO
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);

        await req.query(`
          DELETE FROM LOJA_ENTRADAS
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);

        await req.query(`
          DELETE FROM ESTOQUE_PROD_ENT
          WHERE ROMANEIO_PRODUTO = @romaneio AND FILIAL = @filial
        `);
      }
    });

    // Auditoria (não-bloqueante). Saída devolve (+qtd), entrada remove (-qtd).
    if (modo === 'retornar' && itensRevertidos.length > 0) {
      inserirAjuste({
        filial,
        itens: itensRevertidos.map((i) => ({ produto: i.produto, cor: i.cor, qtde: sinal * i.qtde })),
        romaneioRef: romaneio,
        tipoAjuste: tipo === 'saida' ? 'EXCLUSAO_ROMANEIO_SAIDA' : 'EXCLUSAO_ROMANEIO_ENTRADA',
        responsavel: username ?? undefined,
        obs: `Romaneio ${romaneio} excluído com retorno de estoque (${tipo})`,
      }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria de exclusão:', err));
    }

    return NextResponse.json({
      success: true,
      message: modo === 'retornar'
        ? 'Romaneio removido e estoque revertido com sucesso'
        : 'Romaneio removido com sucesso',
      modo,
      itensRevertidos: modo === 'retornar' ? itensRevertidos.length : 0,
    });
  } catch (error) {
    console.error('Erro ao remover log', error);
    return NextResponse.json(
      { error: 'Erro ao remover log' },
      { status: 500 }
    );
  }
}

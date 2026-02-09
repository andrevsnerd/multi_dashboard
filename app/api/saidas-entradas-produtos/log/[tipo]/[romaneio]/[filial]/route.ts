import { NextRequest, NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import { findUserByUsername } from '@/lib/auth/users-store';
import sql from 'mssql';

async function isAdmin(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
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

    await withRequest(async (req) => {
      req.input('romaneio', sql.VarChar, romaneio);
      req.input('filial', sql.VarChar, filial);

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

    return NextResponse.json({ success: true, message: 'Log removido com sucesso' });
  } catch (error) {
    console.error('Erro ao remover log', error);
    return NextResponse.json(
      { error: 'Erro ao remover log' },
      { status: 500 }
    );
  }
}

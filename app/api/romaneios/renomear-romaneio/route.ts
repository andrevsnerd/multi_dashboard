import { NextRequest, NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import { findUserByUsername } from '@/lib/auth/users-store';
import sql from 'mssql';

async function podeChamar(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin';
}

/**
 * POST /api/romaneios/renomear-romaneio
 * Renomeia o número de um romaneio em todas as tabelas relacionadas.
 * Suporta tipo "entrada" e "saida".
 * Permitido apenas para: admin.
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim() || null;
    if (!await podeChamar(username)) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas administradores podem renomear romaneios.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { oldRomaneio, newRomaneio, tipo } = body as {
      oldRomaneio?: string;
      newRomaneio?: string;
      tipo?: string;
    };

    if (!oldRomaneio?.trim() || !newRomaneio?.trim()) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const tipoNorm = tipo === 'saida' ? 'saida' : 'entrada';
    const oldTrim = oldRomaneio.trim();
    const newTrim = newRomaneio.trim().padStart(6, '0');

    if (!/^\d{6}$/.test(newTrim)) {
      return NextResponse.json(
        { error: 'O número de romaneio deve ter exatamente 6 dígitos numéricos.' },
        { status: 400 }
      );
    }

    if (oldTrim === newTrim) {
      return NextResponse.json({ success: true, romaneio: newTrim });
    }

    await withRequest(async (req) => {
      req.input('old', sql.VarChar, oldTrim);
      req.input('new', sql.VarChar, newTrim);

      if (tipoNorm === 'entrada') {
        const check = await req.query(`
          SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @new
        `);
        if (check.recordset[0]?.TOTAL > 0) {
          throw Object.assign(new Error(`Romaneio ${newTrim} já existe nas entradas.`), { status: 409 });
        }
        await req.query(`UPDATE ESTOQUE_PROD_ENT  SET ROMANEIO_PRODUTO = @new WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old`);
        await req.query(`UPDATE ESTOQUE_PROD1_ENT SET ROMANEIO_PRODUTO = @new WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old`);
        await req.query(`UPDATE LOJA_ENTRADAS     SET ROMANEIO_PRODUTO = @new WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old`);
      } else {
        const check = await req.query(`
          SELECT COUNT(*) as TOTAL FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
          WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @new
        `);
        if (check.recordset[0]?.TOTAL > 0) {
          throw Object.assign(new Error(`Romaneio ${newTrim} já existe nas saídas.`), { status: 409 });
        }
        await req.query(`UPDATE ESTOQUE_PROD_SAI  SET ROMANEIO_PRODUTO = @new WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old`);
        await req.query(`UPDATE ESTOQUE_PROD1_SAI SET ROMANEIO_PRODUTO = @new WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old`);
        await req.query(`UPDATE LOJA_SAIDAS       SET ROMANEIO_PRODUTO = @new WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old`);
      }
    });

    return NextResponse.json({ success: true, romaneio: newTrim });
  } catch (error: unknown) {
    const err = error as { message?: string; status?: number };
    console.error('Erro ao renomear romaneio', error);
    return NextResponse.json(
      { error: err.message || 'Erro ao renomear romaneio' },
      { status: err.status || 500 }
    );
  }
}

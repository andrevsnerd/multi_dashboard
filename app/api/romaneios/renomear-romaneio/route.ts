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
 * Renomeia o número de UM romaneio (apenas o primeiro encontrado) em todas as tabelas
 * relacionadas, sem afetar eventuais duplicatas com o mesmo número.
 * Suporta tipo "entrada" e "saida". Permitido apenas para: admin.
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
    const { oldRomaneio, newRomaneio, tipo, newResponsavel } = body as {
      oldRomaneio?: string;
      newRomaneio?: string;
      tipo?: string;
      newResponsavel?: string;
    };

    if (!oldRomaneio?.trim() || !newRomaneio?.trim()) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const tipoNorm = tipo === 'saida' ? 'saida' : 'entrada';
    const oldTrim = oldRomaneio.trim();
    const newTrim = newRomaneio.trim().padStart(6, '0');
    const responsavelTrim = newResponsavel?.trim() || null;

    if (!/^\d{6}$/.test(newTrim)) {
      return NextResponse.json(
        { error: 'O número de romaneio deve ter exatamente 6 dígitos numéricos.' },
        { status: 400 }
      );
    }

    const numeroMudou = oldTrim !== newTrim;

    await withRequest(async (req) => {
      req.input('old', sql.VarChar, oldTrim);
      req.input('new', sql.VarChar, newTrim);
      if (responsavelTrim) req.input('responsavel', sql.VarChar, responsavelTrim);

      if (tipoNorm === 'entrada') {
        if (numeroMudou) {
          const check = await req.query(`
            SELECT COUNT(*) AS TOTAL FROM ESTOQUE_PROD_ENT WITH (NOLOCK)
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @new
          `);
          if (check.recordset[0]?.TOTAL > 0) {
            throw Object.assign(new Error(`Romaneio ${newTrim} já existe nas entradas.`), { status: 409 });
          }
        }

        await req.query(`
          DECLARE @headerCount INT
          DECLARE @itemCount   INT
          DECLARE @itemsParaDup INT

          SELECT @headerCount = COUNT(*) FROM ESTOQUE_PROD_ENT  WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old
          SELECT @itemCount   = COUNT(*) FROM ESTOQUE_PROD1_ENT WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old

          SET @itemsParaDup = @itemCount / NULLIF(@headerCount, 1)
          IF @itemsParaDup IS NULL OR @itemsParaDup < 1 SET @itemsParaDup = @itemCount

          UPDATE TOP (1) ESTOQUE_PROD_ENT
            SET ROMANEIO_PRODUTO = @new ${responsavelTrim ? ', RESPONSAVEL = @responsavel' : ''}
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old

          UPDATE TOP (1) LOJA_ENTRADAS
            SET ROMANEIO_PRODUTO = @new ${responsavelTrim ? ', RESPONSAVEL = @responsavel' : ''}
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old

          UPDATE TOP (@itemsParaDup) ESTOQUE_PROD1_ENT
            SET ROMANEIO_PRODUTO = @new
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old
        `);
      } else {
        if (numeroMudou) {
          const check = await req.query(`
            SELECT COUNT(*) AS TOTAL FROM ESTOQUE_PROD_SAI WITH (NOLOCK)
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @new
          `);
          if (check.recordset[0]?.TOTAL > 0) {
            throw Object.assign(new Error(`Romaneio ${newTrim} já existe nas saídas.`), { status: 409 });
          }
        }

        await req.query(`
          DECLARE @headerCount INT
          DECLARE @itemCount   INT
          DECLARE @itemsParaDup INT

          SELECT @headerCount = COUNT(*) FROM ESTOQUE_PROD_SAI  WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old
          SELECT @itemCount   = COUNT(*) FROM ESTOQUE_PROD1_SAI WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old

          SET @itemsParaDup = @itemCount / NULLIF(@headerCount, 1)
          IF @itemsParaDup IS NULL OR @itemsParaDup < 1 SET @itemsParaDup = @itemCount

          UPDATE TOP (1) ESTOQUE_PROD_SAI
            SET ROMANEIO_PRODUTO = @new ${responsavelTrim ? ', RESPONSAVEL = @responsavel' : ''}
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old

          UPDATE TOP (1) LOJA_SAIDAS
            SET ROMANEIO_PRODUTO = @new ${responsavelTrim ? ', RESPONSAVEL = @responsavel' : ''}
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old

          UPDATE TOP (@itemsParaDup) ESTOQUE_PROD1_SAI
            SET ROMANEIO_PRODUTO = @new
            WHERE LTRIM(RTRIM(ROMANEIO_PRODUTO)) = @old
        `);
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

import { NextRequest, NextResponse } from 'next/server';
import { withRequest } from '@/lib/db/connection';
import { findUserByUsername } from '@/lib/auth/users-store';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import sql from 'mssql';

async function podeEditarQtdRomaneio(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin' || user?.role === 'logistica';
}

/**
 * PUT /api/romaneios/editar-qtd
 * Edita a quantidade de um item do romaneio e ajusta o estoque correspondente.
 * Permitido para: admin e logistica.
 * - Entrada: ajusta estoque do destino (+ diff)
 * - Saída:   ajusta estoque da origem  (- diff)
 */
export async function PUT(request: NextRequest) {
  try {
    const username = request.headers.get('x-auth-username')?.trim();
    if (!await podeEditarQtdRomaneio(username || null)) {
      return NextResponse.json(
        { error: 'Acesso negado. Apenas administradores e logística podem editar quantidades.' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { tipo, romaneio, filialOrigem, filialDestino, produto, corProduto, qtdeAtual, qtdeNova } = body;

    if (!tipo || !romaneio || !produto || qtdeNova == null || qtdeAtual == null) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    if (tipo !== 'saida' && tipo !== 'entrada') {
      return NextResponse.json({ error: 'Tipo inválido' }, { status: 400 });
    }

    if (qtdeNova < 0) {
      return NextResponse.json({ error: 'Quantidade não pode ser negativa' }, { status: 400 });
    }

    const diff = qtdeNova - qtdeAtual;
    if (diff === 0) {
      return NextResponse.json({ success: true, message: 'Nenhuma alteração necessária' });
    }

    const cor = (corProduto ?? '').toString().trim();

    await withRequest(async (req) => {
      req.input('romaneio', sql.VarChar, romaneio);
      req.input('produto', sql.VarChar, produto);
      req.input('cor', sql.VarChar, cor);
      req.input('qtdeNova', sql.Int, qtdeNova);
      req.input('diff', sql.Int, diff); // positivo = aumento, negativo = redução

      if (tipo === 'saida') {
        req.input('filialOrigem', sql.VarChar, (filialOrigem ?? '').toString().trim());

        // Atualiza quantidade em ESTOQUE_PROD1_SAI
        await req.query(`
          UPDATE ESTOQUE_PROD1_SAI
          SET QTDE = @qtdeNova
          WHERE ROMANEIO_PRODUTO = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filialOrigem))
            AND PRODUTO = @produto
            AND ISNULL(COR_PRODUTO, '') = @cor
        `);

        // Atualiza quantidade em LOJA_SAIDAS_PRODUTO
        await req.query(`
          UPDATE LOJA_SAIDAS_PRODUTO
          SET QTDE_SAIDA = @qtdeNova
          WHERE ROMANEIO_PRODUTO = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filialOrigem))
            AND PRODUTO = @produto
            AND ISNULL(COR_PRODUTO, '') = @cor
        `);

        // Ajusta estoque da ORIGEM
        // diff > 0 → mais saiu → estoque diminui
        // diff < 0 → menos saiu → estoque aumenta (devolução)
        await req.query(`
          UPDATE ep
          SET ep.ESTOQUE = ep.ESTOQUE - @diff
          FROM ESTOQUE_PRODUTOS ep
          INNER JOIN FILIAIS f WITH (NOLOCK) ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          WHERE ep.PRODUTO = @produto
            AND ISNULL(ep.COR_PRODUTO, '') = @cor
            AND (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filialOrigem))
                 OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filialOrigem)))
        `);
      } else {
        // entrada
        req.input('filialDestino', sql.VarChar, (filialDestino ?? '').toString().trim());

        // Atualiza quantidade em ESTOQUE_PROD1_ENT
        await req.query(`
          UPDATE ESTOQUE_PROD1_ENT
          SET QTDE = @qtdeNova
          WHERE ROMANEIO_PRODUTO = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filialDestino))
            AND PRODUTO = @produto
            AND ISNULL(COR_PRODUTO, '') = @cor
        `);

        // Atualiza quantidade em LOJA_ENTRADAS_PRODUTO
        await req.query(`
          UPDATE LOJA_ENTRADAS_PRODUTO
          SET QTDE_ENTRADA = @qtdeNova
          WHERE ROMANEIO_PRODUTO = @romaneio
            AND LTRIM(RTRIM(FILIAL)) = LTRIM(RTRIM(@filialDestino))
            AND PRODUTO = @produto
            AND ISNULL(COR_PRODUTO, '') = @cor
        `);

        // Ajusta estoque do DESTINO
        // diff > 0 → mais chegou → estoque aumenta
        // diff < 0 → menos chegou → estoque diminui
        await req.query(`
          UPDATE ep
          SET ep.ESTOQUE = ep.ESTOQUE + @diff
          FROM ESTOQUE_PRODUTOS ep
          INNER JOIN FILIAIS f WITH (NOLOCK) ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
          WHERE ep.PRODUTO = @produto
            AND ISNULL(ep.COR_PRODUTO, '') = @cor
            AND (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filialDestino))
                 OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filialDestino)))
        `);
      }
    });

    // Registra auditoria no histórico de ajustes (não-bloqueante)
    const filialAjuste = tipo === 'saida'
      ? (filialOrigem ?? '').toString().trim()
      : (filialDestino ?? '').toString().trim();
    // Saída: diff>0 = mais saiu (estoque -), diff<0 = menos saiu (estoque +) → qtdeAjuste = -diff
    // Entrada: diff>0 = mais chegou (estoque +), diff<0 = menos chegou (estoque -) → qtdeAjuste = diff
    const qtdeAjuste = tipo === 'saida' ? -diff : diff;
    inserirAjuste({
      filial: filialAjuste,
      itens: [{ produto, cor, qtde: qtdeAjuste }],
      romaneioRef: romaneio,
      tipoAjuste: tipo === 'saida' ? 'EDICAO_ROMANEIO_SAIDA' : 'EDICAO_ROMANEIO_ENTRADA',
      responsavel: username ?? undefined,
      obs: `Qtde ${tipo} ajustada: ${qtdeAtual} → ${qtdeNova}`,
    }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Erro ao editar quantidade do romaneio', error);
    return NextResponse.json({ error: 'Erro ao editar quantidade' }, { status: 500 });
  }
}

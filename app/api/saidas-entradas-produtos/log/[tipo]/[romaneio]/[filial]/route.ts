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
 * na filial do romaneio. Usado pelo preview (GET), pela auditoria do DELETE e
 * pela compensação de estoque do modo=apenas.
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
 * Repõe em ESTOQUE_PRODUTOS.ESTOQUE o que os triggers do Linx acabaram de mexer.
 *
 * Ao deletar os itens de um romaneio, os triggers LXD_ESTOQUE_PROD1_ENT/SAI já
 * revertem o estoque sozinhos (`SUM(EN_n)/SUM(SA_n) * -1`). Quem quer o estoque
 * INALTERADO (modo=apenas) precisa desfazer essa reversão — é isso que esta função
 * faz, aplicando o efeito OPOSTO ao do trigger.
 *
 * Toca só a coluna ESTOQUE porque as colunas de grade (ES1..ES48) o trigger já
 * deixou certas; mexer nelas aqui reintroduziria divergência entre saldo e grade.
 *
 * @param sinal o mesmo sinal da reversão (+1 saída, -1 entrada). A compensação usa
 *              o operador contrário.
 */
async function compensarReversaoDeEstoque(
  itens: PreviewItem[],
  filial: string,
  sinal: 1 | -1
): Promise<void> {
  const comQtde = itens.filter((i) => i.qtde !== 0);
  if (comQtde.length === 0) return;

  const escape = (v: string) => v.replace(/'/g, "''");
  const values = comQtde
    .map((i) => `('${escape(i.produto)}','${escape(i.cor)}',${Math.trunc(i.qtde)})`)
    .join(',');

  // Operador embutido, contrário ao da reversão do trigger — não vem de input do usuário.
  const op = sinal === 1 ? '-' : '+';

  await withRequest(async (req) => {
    req.input('filial', sql.VarChar, filial);
    await req.query(`
      ;WITH agg(PRODUTO, COR, QTDE) AS (
        SELECT * FROM (VALUES ${values}) v(PRODUTO, COR, QTDE)
      )
      UPDATE ep
      SET ep.ESTOQUE = ep.ESTOQUE ${op} agg.QTDE
      FROM ESTOQUE_PRODUTOS ep
      INNER JOIN FILIAIS f WITH (NOLOCK)
        ON LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(f.FILIAL))
      INNER JOIN agg
        ON ep.PRODUTO = agg.PRODUTO
       AND ISNULL(ep.COR_PRODUTO, '') = agg.COR
      WHERE (LTRIM(RTRIM(f.COD_FILIAL)) = LTRIM(RTRIM(@filial))
             OR LTRIM(RTRIM(f.FILIAL)) = LTRIM(RTRIM(@filial)))
    `);
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
 * Remove completamente um log do sistema (apenas admin).
 *
 * IMPORTANTE — quem reverte o estoque é o Linx, não esta rota. Os triggers
 * LXD_ESTOQUE_PROD1_ENT / LXD_ESTOQUE_PROD1_SAI (e os equivalentes de
 * LOJA_ENTRADAS_PRODUTO / LOJA_SAIDAS_PRODUTO) desfazem o movimento assim que os
 * itens são deletados. Por isso:
 *
 *   modo=retornar → só deleta; a reversão vem do trigger.
 *   modo=apenas   → deleta e DESFAZ a reversão do trigger, para o estoque ficar igual.
 *
 * Esta rota já fez um `UPDATE ESTOQUE_PRODUTOS` "de reversão" além do trigger, o que
 * descontava/creditava DUAS vezes: o romaneio de entrada 834279 (NERD, 23/07/2026)
 * deixou 50 itens negativos e 134 unidades a menos. Não reintroduzir esse UPDATE.
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

    // modo=apenas (default): remove os registros e mantém o estoque como está.
    // modo=retornar: remove os registros e deixa a reversão do trigger valer.
    const modo = request.nextUrl.searchParams.get('modo') === 'retornar'
      ? 'retornar'
      : 'apenas';

    // Lê os itens (qtd + estoque atual) ANTES dos deletes: depois deles não há mais
    // de onde ler. Serve para a auditoria e para a compensação do modo=apenas.
    // saída: itens saíram da origem → o trigger devolve (+).
    // entrada: itens entraram no destino → o trigger remove (-).
    const sinal: 1 | -1 = tipo === 'saida' ? 1 : -1;
    const itensDoRomaneio = await lerItensComEstoque(tipo, romaneio, filial, sinal);

    await withRequest(async (req) => {
      req.input('romaneio', sql.VarChar, romaneio);
      req.input('filial', sql.VarChar, filial);

      if (tipo === 'saida') {
        // Deletar registros relacionados. Cada DELETE dispara o trigger LXD do Linx,
        // que já devolve o estoque à origem — não somar isso de novo aqui.
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
        // ENTRADA - Deletar registros relacionados. Cada DELETE dispara o trigger LXD do
        // Linx, que já retira o estoque do destino — não subtrair isso de novo aqui.
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

    // modo=apenas: desfaz a reversão que o trigger acabou de aplicar, para o estoque
    // ficar exatamente como estava. Feito DEPOIS dos deletes — é o trigger deles que
    // move o estoque.
    if (modo === 'apenas') {
      await compensarReversaoDeEstoque(itensDoRomaneio, filial, sinal);
    }

    // Auditoria (não-bloqueante) — é o ÚNICO rastro que sobra de um romaneio excluído:
    // as tabelas de origem são apagadas e nenhuma outra guarda os itens.
    //
    // QTDE_AJUSTE é o efeito LÍQUIDO no estoque, porque é assim que o Extrato de Produto
    // soma a linha:
    //   retornar → 0: o romaneio saiu do histórico e o estoque caiu junto, então o saldo
    //              do extrato já fecha sem esta linha. A quantidade fica na OBS.
    //   apenas   → efeito contrário ao da reversão: o movimento desapareceu do histórico
    //              mas o estoque foi mantido, e sem esta linha o extrato não fecharia.
    if (itensDoRomaneio.length > 0) {
      const rotulo = modo === 'retornar'
        ? `Romaneio ${romaneio} excluído com retorno de estoque (${tipo})`
        : `Romaneio ${romaneio} excluído sem alterar o estoque (${tipo})`;
      inserirAjuste({
        filial,
        itens: itensDoRomaneio.map((i) => ({
          produto: i.produto,
          cor: i.cor,
          qtde: modo === 'retornar' ? 0 : -sinal * i.qtde,
          obs: `${rotulo} — ${i.qtde} un no romaneio`,
        })),
        romaneioRef: romaneio,
        tipoAjuste: tipo === 'saida' ? 'EXCLUSAO_ROMANEIO_SAIDA' : 'EXCLUSAO_ROMANEIO_ENTRADA',
        responsavel: username ?? undefined,
        obs: rotulo,
        registrarZerados: true,
      }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria de exclusão:', err));
    }

    return NextResponse.json({
      success: true,
      message: modo === 'retornar'
        ? 'Romaneio removido e estoque revertido com sucesso'
        : 'Romaneio removido com sucesso',
      modo,
      itensRevertidos: modo === 'retornar' ? itensDoRomaneio.length : 0,
    });
  } catch (error) {
    console.error('Erro ao remover log', error);
    return NextResponse.json(
      { error: 'Erro ao remover log' },
      { status: 500 }
    );
  }
}

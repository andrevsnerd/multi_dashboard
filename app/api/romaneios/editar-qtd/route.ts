import { NextRequest, NextResponse } from 'next/server';
import { getConnectionPool } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { mensagemTravaEstoqueNegativo, verificarSaldoSaida } from '@/lib/server/trava-estoque-negativo';
import { executeItemQtdeSet } from '@/lib/saida-entrada-executor';

async function podeEditarQtdRomaneio(username: string | null): Promise<boolean> {
  if (!username) return false;
  const user = await findUserByUsername(username);
  return user?.role === 'admin' || user?.role === 'logistica';
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * PUT /api/romaneios/editar-qtd
 * Corrige a quantidade de um item do romaneio. Permitido para: admin e logistica.
 *
 * Quem grava é `executeItemQtdeSet`: QTDE e a coluna de grade (SA_n / EN_n) no
 * MESMO UPDATE, por delta, e o trigger do Linx move ESTOQUE e ES1..ES48 juntos.
 *
 * NUNCA voltar a fazer `SET QTDE = …` + `UPDATE ESTOQUE_PRODUTOS SET ESTOQUE = …`
 * na mão: foi o que esta rota fez até 14/10/2026. O trigger não enxerga QTDE,
 * então o total do estoque era acertado à mão e a grade ficava para trás —
 * ESTOQUE ≠ soma(ES) (ex.: saída 033072, N5.10.0015 K9 na NERD com total 0 e
 * tamanho −2) e o romaneio com QTDE ≠ SA_n, que a exclusão reverte errado.
 *
 * Só romaneio AVULSO: saída/entrada amarrada a transferência (LOJA_SAIDAS_PRODUTO /
 * LOJA_ENTRADAS_PRODUTO, que têm triggers de estoque próprios) é assunto de
 * conferência, não de correção por aqui.
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
    const filial = (tipo === 'saida' ? filialOrigem : filialDestino ?? '').toString().trim();
    if (!filial) {
      return NextResponse.json({ error: 'Filial do romaneio não informada.' }, { status: 400 });
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();

    // Entrada amarrada a transferência: a saída já trava sozinha no executor.
    if (tipo === 'entrada') {
      const res = await pool.request().query(`
        SELECT COUNT(*) AS TOTAL
        FROM LOJA_ENTRADAS_PRODUTO lep WITH (NOLOCK)
        JOIN FILIAIS f WITH (NOLOCK) ON f.FILIAL = lep.FILIAL
        WHERE LTRIM(RTRIM(lep.ROMANEIO_PRODUTO)) = ${lit(String(romaneio).trim())}
          AND (f.COD_FILIAL = ${lit(filial)} OR f.FILIAL = ${lit(filial)})
      `);
      if (Number(res.recordset[0]?.TOTAL) > 0) {
        return NextResponse.json(
          {
            error: `Romaneio ${romaneio} é entrada de transferência (tem itens de loja amarrados) — a quantidade se acerta pela conferência, não por aqui.`,
          },
          { status: 409 }
        );
      }
    }

    // Saída maior que antes tira mais estoque: mesma trava de saldo das Saídas.
    if (tipo === 'saida' && diff > 0) {
      const travaSaldo = await verificarSaldoSaida(filial, [{ produto, corProduto: cor, quantidade: diff }]);
      if (travaSaldo) {
        return NextResponse.json(
          { error: mensagemTravaEstoqueNegativo(travaSaldo), travaEstoqueNegativo: travaSaldo },
          { status: 409 }
        );
      }
    }

    let resultado;
    try {
      resultado = await executeItemQtdeSet(pool, { tipo, romaneio, filial, produto, corProduto: cor, qtdeNova });
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Erro ao editar quantidade' },
        { status: 409 }
      );
    }

    // Registra auditoria no histórico de ajustes (não-bloqueante)
    // Saída: delta>0 = mais saiu (estoque -), delta<0 = menos saiu (estoque +) → qtdeAjuste = -delta
    // Entrada: delta>0 = mais chegou (estoque +), delta<0 = menos chegou (estoque -) → qtdeAjuste = delta
    if (resultado.delta !== 0) {
      const qtdeAjuste = tipo === 'saida' ? -resultado.delta : resultado.delta;
      inserirAjuste({
        filial: resultado.filial,
        itens: [{ produto, cor, qtde: qtdeAjuste }],
        romaneioRef: romaneio,
        tipoAjuste: tipo === 'saida' ? 'EDICAO_ROMANEIO_SAIDA' : 'EDICAO_ROMANEIO_ENTRADA',
        responsavel: await resolveResponsavelLinx(username),
        obs: `Qtde ${tipo} ajustada: ${resultado.qtdeAnterior} → ${resultado.qtdeNova}`,
      }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));
    }

    return NextResponse.json({ success: true, message: resultado.message });
  } catch (error) {
    console.error('Erro ao editar quantidade do romaneio', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao editar quantidade' },
      { status: 500 }
    );
  }
}

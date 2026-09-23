import { NextRequest, NextResponse } from 'next/server';
import sql from 'mssql';

import { getConnectionPool, withRequest } from '@/lib/db/connection';
import { shouldUseProxy, ProxyPool } from '@/lib/db/proxy';
import { findUserByUsername } from '@/lib/auth/users-store';
import { readOnlyBlock } from '@/lib/auth/route-guards';
import { DEFEITOS_ROLES, canCorrigirDefeito } from '@/lib/auth/permissions';
import { getDefeitoFilial } from '@/lib/config/filiais-especiais';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { resolveResponsavelLinx } from '@/lib/server/responsavel-linx';
import { inserirAjuste } from '@/lib/repositories/ajuste-historico';
import {
  getConfirmacaoItem,
  confirmarItem,
} from '@/lib/utils/romaneio-confirmacao-store';
import {
  executarAjusteContagem,
  encontrarNomeContagemLivre,
} from '@/lib/ajuste-estoque-executor';
import { executeItemQtdeSet, executeSaidaAppend } from '@/lib/saida-entrada-executor';

export const dynamic = 'force-dynamic';

const QTDE_MAX = 99999;

interface CorrigirItemRequest {
  company: string;
  romaneio: string;
  filialOrigem: string;
  produto: string;
  corProduto?: string | null;
  /** Quantidade real da peça neste romaneio. 0 = não veio nada. */
  qtdeNova: number;
}

interface AcrescentarItemRequest {
  company: string;
  romaneio: string;
  filialOrigem: string;
  itens: Array<{ produto: string; corProduto?: string | null; quantidade: number }>;
}

function normaliza(v: string | null | undefined): string {
  return (v ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
}

/**
 * Guarda comum das duas rotas: usuário com função certa, empresa válida, filial de
 * defeito configurada e a filial de origem realmente pertencendo à empresa pedida.
 *
 * O escopo por empresa não é formalidade: `TIPO_ROMANEIO = 'DEFEITO'` existe nas
 * duas empresas (há saída de OSCAR FREIRE e AKS no mesmo recorte), então sem esta
 * checagem a tela de uma empresa corrigiria romaneio da outra.
 */
async function guardar(
  request: NextRequest,
  companyKey: string,
  filialOrigem: string
): Promise<
  | { ok: false; response: NextResponse }
  | { ok: true; username: string; defeitoFilial: string }
> {
  const username = request.headers.get('x-auth-username')?.trim();
  if (!username) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Usuário não identificado. Faça login novamente.' },
        { status: 401 }
      ),
    };
  }

  const readOnly = await readOnlyBlock(username);
  if (readOnly) return { ok: false, response: readOnly };

  const user = await findUserByUsername(username);
  if (!user || !DEFEITOS_ROLES.includes(user.role)) {
    return { ok: false, response: NextResponse.json({ error: 'Acesso negado.' }, { status: 403 }) };
  }
  if (!canCorrigirDefeito(user.role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Acesso negado. Apenas administradores e logística podem corrigir romaneios.' },
        { status: 403 }
      ),
    };
  }

  const defeitoFilial = getDefeitoFilial(companyKey);
  if (!defeitoFilial) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Esta empresa não tem filial de defeito configurada.' },
        { status: 400 }
      ),
    };
  }

  const companyConfig = await resolveCompanyDynamic(companyKey);
  const filiaisOrigem = companyConfig?.filialFilters.inventory ?? [];
  if (
    filiaisOrigem.length > 0 &&
    !filiaisOrigem.some((f) => normaliza(f) === normaliza(filialOrigem))
  ) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: `${filialOrigem} não é uma filial de ${companyKey}.` },
        { status: 400 }
      ),
    };
  }

  return { ok: true, username, defeitoFilial };
}

/** O romaneio é mesmo um romaneio de defeito desta filial? */
async function ehRomaneioDeDefeito(
  romaneio: string,
  filialOrigem: string,
  defeitoFilial: string
): Promise<boolean> {
  return withRequest(async (req) => {
    req.input('romaneio', sql.VarChar, romaneio);
    req.input('filial', sql.VarChar, filialOrigem);
    req.input('defeito', sql.VarChar, defeitoFilial.toUpperCase());
    const result = await req.query<{ total: number }>(`
      SELECT COUNT(*) AS total
        FROM ESTOQUE_PROD_SAI s WITH (NOLOCK)
       WHERE LTRIM(RTRIM(s.ROMANEIO_PRODUTO)) = @romaneio
         AND LTRIM(RTRIM(s.FILIAL)) = LTRIM(RTRIM(@filial))
         AND (
           UPPER(LTRIM(RTRIM(ISNULL(s.TIPO_ROMANEIO, '')))) = 'DEFEITO'
           OR UPPER(LTRIM(RTRIM(ISNULL(s.FILIAL_DESTINO, '')))) = @defeito
         )
    `);
    return Number(result.recordset[0]?.total ?? 0) > 0;
  });
}

/** Saldo atual do item na filial de defeito — base do ajuste no caso legado. */
async function lerEstoqueNoDefeito(
  defeitoFilial: string,
  produto: string,
  cor: string
): Promise<number> {
  return withRequest(async (req) => {
    req.input('filial', sql.VarChar, defeitoFilial);
    req.input('produto', sql.VarChar, produto);
    req.input('cor', sql.VarChar, cor);
    const result = await req.query<{ estoque: number | null }>(`
      SELECT TOP 1 ISNULL(ep.ESTOQUE, 0) AS estoque
        FROM ESTOQUE_PRODUTOS ep WITH (NOLOCK)
       WHERE LTRIM(RTRIM(ep.PRODUTO)) = LTRIM(RTRIM(@produto))
         AND LTRIM(RTRIM(ep.FILIAL)) = LTRIM(RTRIM(@filial))
         AND (
           LTRIM(RTRIM(CAST(ISNULL(ep.COR_PRODUTO, '') AS VARCHAR(20)))) = LTRIM(RTRIM(@cor))
           OR TRY_CONVERT(INT, ep.COR_PRODUTO) = TRY_CONVERT(INT, @cor)
         )
    `);
    return Number(result.recordset[0]?.estoque ?? 0);
  });
}

/**
 * PUT /api/defeitos/item — a peça deste romaneio na verdade eram N.
 *
 * Corrige a quantidade e deixa os DOIS estoques certos:
 *
 *  1. ORIGEM (sempre): a linha do romaneio de saída passa a valer N. Quem move o
 *     estoque é o trigger do Linx, pela coluna de grade — reduzir devolve peça à
 *     loja, aumentar tira mais. É o caso do romaneio de 3 que na verdade eram 2:
 *     a loja recebe 1 de volta.
 *
 *  2. DESTINO (só se o item já foi conferido): a peça já está na filial de defeito,
 *     então o saldo de lá também tem que acompanhar.
 *     - Confirmação com romaneio de entrada gravado → corrige a própria entrada.
 *     - Confirmação antiga, sem esse vínculo (anterior a 23/09/2026) → o vínculo
 *       não existe em lugar nenhum do Linx, então a correção sai como ajuste de
 *       estoque na filial de defeito, que aparece no extrato e dá para estornar.
 *
 * Item ainda não conferido mexe só na origem: nada entrou no destino para corrigir.
 */
export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as CorrigirItemRequest;
    const companyKey = (body?.company ?? '').trim();
    const romaneio = (body?.romaneio ?? '').trim();
    const filialOrigem = (body?.filialOrigem ?? '').trim();
    const produto = (body?.produto ?? '').trim();
    const cor = (body?.corProduto ?? '').toString().trim();
    const qtdeNova = Number(body?.qtdeNova);

    if (!companyKey || !romaneio || !filialOrigem || !produto) {
      return NextResponse.json(
        { error: 'Parâmetros obrigatórios: company, romaneio, filialOrigem, produto' },
        { status: 400 }
      );
    }
    if (!Number.isInteger(qtdeNova) || qtdeNova < 0 || qtdeNova > QTDE_MAX) {
      return NextResponse.json(
        { error: `Quantidade inválida: use um inteiro entre 0 e ${QTDE_MAX}.` },
        { status: 400 }
      );
    }

    const guard = await guardar(request, companyKey, filialOrigem);
    if (!guard.ok) return guard.response;
    const { username, defeitoFilial } = guard;

    if (!(await ehRomaneioDeDefeito(romaneio, filialOrigem, defeitoFilial))) {
      return NextResponse.json(
        {
          error: `O romaneio ${romaneio} de ${filialOrigem} não é um romaneio de defeito — corrija-o na tela Romaneios.`,
        },
        { status: 400 }
      );
    }

    const confirmacao = await getConfirmacaoItem(
      companyKey,
      romaneio,
      defeitoFilial,
      produto,
      cor
    );

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const responsavel = await resolveResponsavelLinx(username);

    // 1) ORIGEM — a saída passa a valer a quantidade real.
    const saida = await executeItemQtdeSet(pool, {
      tipo: 'saida',
      romaneio,
      filial: filialOrigem,
      produto,
      corProduto: cor,
      qtdeNova,
    });

    // Saída já estava na quantidade pedida — mas NÃO se sai daqui ainda. Se uma
    // tentativa anterior corrigiu a origem e falhou no destino, é exatamente
    // este o estado, e sair agora deixaria o destino errado para sempre com um
    // "nada foi alterado" na tela. O destino é conferido abaixo de qualquer jeito.
    if (saida.delta !== 0) {
      // Auditoria da origem. `delta` negativo = saiu menos → estoque da loja sobe.
      inserirAjuste({
        filial: saida.filial,
        itens: [{ produto, cor, qtde: -saida.delta }],
        romaneioRef: romaneio,
        tipoAjuste: 'CORRECAO_DEFEITO_SAIDA',
        responsavel,
        obs: `Defeito: ${saida.qtdeAnterior} → ${qtdeNova} no romaneio ${romaneio}`,
      }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));
    }

    // 2) DESTINO — só quando a peça já foi conferida na filial de defeito.
    //
    // A origem JÁ foi corrigida acima e o estoque dela já se mexeu. Então uma
    // falha daqui para baixo não pode virar um 500 seco: o operador precisa
    // saber que a loja foi corrigida e que só o saldo da filial de defeito ficou
    // para trás — senão ele repete a correção e a loja recebe peça duas vezes.
    let destino: { modo: 'entrada' | 'ajuste' | 'nenhum' | 'falhou'; detalhe: string } = {
      modo: 'nenhum',
      detalhe: 'Item ainda não conferido: nada entrou na filial de defeito para corrigir.',
    };

    try {
      if (confirmacao) {
        const deltaDestino = qtdeNova - confirmacao.qtdeConfirmada;

        if (deltaDestino !== 0 && confirmacao.romaneioEntrada) {
          const entrada = await executeItemQtdeSet(pool, {
            tipo: 'entrada',
            romaneio: confirmacao.romaneioEntrada,
            filial: defeitoFilial,
            produto,
            corProduto: cor,
            qtdeNova,
          });
          destino = {
            modo: 'entrada',
            detalhe: `Entrada ${confirmacao.romaneioEntrada} em ${defeitoFilial}: ${entrada.qtdeAnterior} → ${entrada.qtdeNova}.`,
          };
          inserirAjuste({
            filial: defeitoFilial,
            itens: [{ produto, cor, qtde: entrada.delta }],
            romaneioRef: confirmacao.romaneioEntrada,
            tipoAjuste: 'CORRECAO_DEFEITO_ENTRADA',
            responsavel,
            obs: `Defeito: entrada corrigida de ${entrada.qtdeAnterior} para ${entrada.qtdeNova} (saída ${romaneio})`,
          }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));
        } else if (deltaDestino !== 0) {
          // Confirmação antiga: o romaneio de entrada não foi registrado na época e
          // o Linx não guarda o vínculo. Corrige o saldo por contagem, que é o
          // mecanismo próprio para "o saldo de lá está errado".
          const poolLike = pool as unknown as { request: () => unknown };
          const estoqueAtual = await lerEstoqueNoDefeito(defeitoFilial, produto, cor);
          const alvo = Math.max(0, estoqueAtual + deltaDestino);

          // O saldo da filial de defeito não tem a peça para devolver (já saiu de
          // lá, ou nunca entrou). Abaixar para negativo é proibido pela regra da
          // casa, e um ajuste de delta 0 seria recusado pelo executor com uma
          // mensagem que não explica nada — então o caso é dito por extenso.
          if (alvo === estoqueAtual) {
            throw new Error(
              `o saldo de ${produto}${cor ? ` cor ${cor}` : ''} em ${defeitoFilial} é ${estoqueAtual} ` +
                `e não absorve ${deltaDestino} — a peça já saiu de lá ou nunca entrou.`
            );
          }

          const hoje = new Date();
          const dd = String(hoje.getDate()).padStart(2, '0');
          const mm = String(hoje.getMonth() + 1).padStart(2, '0');
          const nomeContagem = await encontrarNomeContagemLivre(poolLike, `DEF${dd}${mm}`);

          await executarAjusteContagem(poolLike, {
            filialNome: defeitoFilial,
            nomeContagem,
            emissao: `${hoje.getFullYear()}-${mm}-${dd} 00:00:00`,
            responsavel,
            obs: `CORRECAO DEFEITO ROMANEIO ${romaneio}`,
            itens: [{ produto, cor, contagem: alvo }],
          });

          destino = {
            modo: 'ajuste',
            detalhe:
              `${defeitoFilial}: ajuste de ${deltaDestino > 0 ? '+' : ''}${deltaDestino} (contagem ${nomeContagem}). ` +
              'Esta confirmação é anterior ao registro do romaneio de entrada, então a correção do destino saiu como ajuste de estoque.',
          };
        } else {
          destino = {
            modo: 'nenhum',
            detalhe: 'A quantidade conferida já era essa: o destino não precisou de correção.',
          };
        }

        // A conferência passa a valer a quantidade real.
        await confirmarItem(
          companyKey,
          romaneio,
          defeitoFilial,
          produto,
          cor,
          qtdeNova,
          username,
          confirmacao.romaneioEntrada
        );
      }
    } catch (error) {
      const motivo = error instanceof Error ? error.message : 'erro desconhecido';
      destino = {
        modo: 'falhou',
        detalhe:
          `O estoque de ${saida.filial} está correto, mas o saldo de ${defeitoFilial} ` +
          `NÃO foi corrigido: ${motivo} Tente salvar de novo — a origem não se mexe ` +
          `duas vezes. Se insistir, ajuste ${defeitoFilial} pela tela de Ajuste de Estoque.`,
      };
      console.error('[defeitos] Correção do destino falhou:', error);
    }

    const origemMsg =
      saida.delta === 0
        ? `${produto}: a saída já estava em ${qtdeNova}.`
        : `${produto}: ${saida.qtdeAnterior} → ${qtdeNova}. ` +
          (saida.delta < 0
            ? `${-saida.delta} peça(s) devolvida(s) ao estoque de ${saida.filial}.`
            : `${saida.delta} peça(s) a mais baixada(s) de ${saida.filial}.`);

    return NextResponse.json({
      success: true,
      alterado: saida.delta !== 0 || destino.modo === 'entrada' || destino.modo === 'ajuste',
      origem: {
        filial: saida.filial,
        qtdeAnterior: saida.qtdeAnterior,
        qtdeNova: saida.qtdeNova,
        /** Peça devolvida à loja (positivo) ou tirada dela (negativo). */
        estoqueDevolvido: -saida.delta,
      },
      destino,
      message: origemMsg,
    });
  } catch (error) {
    console.error('Erro ao corrigir item do romaneio de defeito', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao corrigir o item' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/defeitos/item — peça que estava no fardo mas não no romaneio.
 *
 * Acrescenta itens ao romaneio de saída (reusa `executeSaidaAppend`, a mesma
 * rotina da tela Saídas e Entradas), o que BAIXA o estoque da loja de origem na
 * hora, pelo trigger. O destino não é tocado: a peça nova entra na filial de
 * defeito quando for conferida, como qualquer outra.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as AcrescentarItemRequest;
    const companyKey = (body?.company ?? '').trim();
    const romaneio = (body?.romaneio ?? '').trim();
    const filialOrigem = (body?.filialOrigem ?? '').trim();
    const itens = (body?.itens ?? []).map((item) => ({
      produto: (item?.produto ?? '').trim(),
      corProduto: (item?.corProduto ?? '').toString().trim(),
      quantidade: Math.floor(Number(item?.quantidade)),
    }));

    if (!companyKey || !romaneio || !filialOrigem || itens.length === 0) {
      return NextResponse.json(
        { error: 'Parâmetros obrigatórios: company, romaneio, filialOrigem e ao menos um item.' },
        { status: 400 }
      );
    }
    for (const item of itens) {
      if (!item.produto || !Number.isInteger(item.quantidade) || item.quantidade <= 0) {
        return NextResponse.json(
          { error: 'Cada item precisa de produto e quantidade inteira maior que zero.' },
          { status: 400 }
        );
      }
    }

    const guard = await guardar(request, companyKey, filialOrigem);
    if (!guard.ok) return guard.response;
    const { username, defeitoFilial } = guard;

    if (!(await ehRomaneioDeDefeito(romaneio, filialOrigem, defeitoFilial))) {
      return NextResponse.json(
        {
          error: `O romaneio ${romaneio} de ${filialOrigem} não é um romaneio de defeito — edite-o na tela Romaneios.`,
        },
        { status: 400 }
      );
    }

    const pool = shouldUseProxy() ? new ProxyPool() : await getConnectionPool();
    const resultado = await executeSaidaAppend(pool, {
      romaneio,
      filial: filialOrigem,
      itens,
    });

    inserirAjuste({
      filial: resultado.filial,
      itens: itens.map((item) => ({
        produto: item.produto,
        cor: item.corProduto,
        qtde: item.quantidade,
      })),
      romaneioRef: romaneio,
      tipoAjuste: 'CORRECAO_DEFEITO_SAIDA',
      responsavel: await resolveResponsavelLinx(username),
      obs: `Defeito: ${itens.length} item(ns) acrescentado(s) ao romaneio ${romaneio} (+${resultado.qtdeAdicionada} peça(s))`,
    }).catch((err) => console.error('[ajuste-historico] Falha ao registrar auditoria:', err));

    return NextResponse.json({
      success: true,
      romaneio: resultado.romaneio,
      qtdeAdicionada: resultado.qtdeAdicionada,
      message: resultado.message,
    });
  } catch (error) {
    console.error('Erro ao acrescentar item ao romaneio de defeito', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao acrescentar o item' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';

import { parseCadastroCompany } from '@/lib/auth/cadastro-guard';
import { canRenomearProduto, normalizeRole } from '@/lib/auth/permissions';
import { findUserByUsername } from '@/lib/auth/users-store';
import {
  executarAlteracaoCadastro,
  fetchProdutoCadastro,
  type AlteracaoProdutoInput,
} from '@/lib/repositories/cadastro';

export const dynamic = 'force-dynamic';

/** DESC_PRODUTO e DESC_PROD_NF sao VARCHAR(40) NOT NULL no Linx. */
const MAX_NOME = 40;

/**
 * Renomear produto — o mesmo ato da tela de Cadastro de Produtos do Linx.
 *
 * O que o Linx faz num rename (verificado no banco de producao):
 *  1. `UPDATE PRODUTOS SET DESC_PRODUTO` — o nome mora SO nessa coluna. As demais
 *     tabelas com "DESC_PRODUTO" (as W_ do BI e as Sale do PDV) sao VIEWS, que
 *     leem PRODUTOS ao vivo, e nenhuma tabela de venda ou NF guarda copia do
 *     nome. Nao ha o que propagar depois do UPDATE.
 *  2. O trigger LXU_PRODUTOS grava o nome ANTERIOR em PRODUTOS_LOG
 *     (PRODUTO, DESCR_ANT_ITEM, DATA_ALTERACAO) — auditoria nativa do ERP.
 *  3. O trigger LXU_ETL_PRODUTOS enfileira o produto em LJ_ETL_REPOSITORIO, que
 *     e o que replica o cadastro para os PDVs das lojas.
 * Os dois triggers disparam no nosso UPDATE tambem — ficam ligados de proposito.
 *
 * DESC_PROD_NF e o SEGUNDO campo daquela tela: e ele que sai impresso na NF/DANFE.
 * O Linx NAO sincroniza os dois — quem digita decide. Por isso 538 dos 2.434
 * produtos ja renomeados ficaram com a NF presa no nome antigo. Aqui os dois vao
 * juntos por padrao (`aplicarNaNf`), que e o que evita esse rastro.
 */

interface ProdutoNomes {
  productId: string;
  nome: string;
  nomeNf: string;
  nfIgualAoNome: boolean;
}

async function autorizar(request: Request) {
  const username = request.headers.get('x-auth-username')?.trim();
  if (!username) {
    return {
      erro: NextResponse.json(
        { error: 'Usuario nao identificado. Faca login novamente.' },
        { status: 401 }
      ),
    };
  }

  const user = await findUserByUsername(username);
  if (!user) {
    return { erro: NextResponse.json({ error: 'Usuario nao encontrado.' }, { status: 403 }) };
  }
  if (!canRenomearProduto(normalizeRole(user.role))) {
    return {
      erro: NextResponse.json({ error: 'Esta funcao nao pode renomear produtos.' }, { status: 403 }),
    };
  }

  return { username };
}

/**
 * Espaco duplo em DESC_PRODUTO quebra a busca por nome (o cadastro do Linx ja tem
 * centenas assim) — colapsa na entrada para nao criar mais um.
 */
function normalizarNome(valor: unknown): string {
  return String(valor ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

async function lerNomes(productId: string): Promise<ProdutoNomes | null> {
  const ficha = await fetchProdutoCadastro(productId);
  if (!ficha) return null;

  const nome = String(ficha.valores.DESC_PRODUTO ?? '').trim();
  const nomeNf = String(ficha.valores.DESC_PROD_NF ?? '').trim();
  return { productId: ficha.produto, nome, nomeNf, nfIgualAoNome: nome === nomeNf };
}

/** Estado atual dos dois campos, para o modal abrir preenchido. */
export async function GET(request: Request) {
  const auth = await autorizar(request);
  if ('erro' in auth) return auth.erro;

  try {
    const { searchParams } = new URL(request.url);
    const productId = (searchParams.get('productId') ?? '').trim();
    if (!productId) {
      return NextResponse.json({ error: 'Produto e obrigatorio.' }, { status: 400 });
    }

    const nomes = await lerNomes(productId);
    if (!nomes) {
      return NextResponse.json(
        { error: `Produto "${productId}" nao encontrado no cadastro.` },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: nomes });
  } catch (error) {
    console.error('[product-detail/rename] erro ao ler nomes', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao ler o cadastro do produto.' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await autorizar(request);
  if ('erro' in auth) return auth.erro;

  try {
    const body = (await request.json()) as {
      productId?: string;
      company?: string;
      nome?: string;
      nomeNf?: string;
      /** true (padrao): a descricao da NF acompanha o nome. */
      aplicarNaNf?: boolean;
      obs?: string | null;
    };

    const company = parseCadastroCompany(body.company);
    if (!company) {
      return NextResponse.json({ error: 'Empresa invalida.' }, { status: 400 });
    }

    const productId = String(body.productId ?? '').trim();
    if (!productId) {
      return NextResponse.json({ error: 'Produto e obrigatorio.' }, { status: 400 });
    }

    const nome = normalizarNome(body.nome);
    if (!nome) {
      return NextResponse.json({ error: 'Informe o novo nome do produto.' }, { status: 400 });
    }
    if (nome.length > MAX_NOME) {
      return NextResponse.json(
        { error: `Nome do produto deve ter no maximo ${MAX_NOME} caracteres.` },
        { status: 400 }
      );
    }

    const aplicarNaNf = body.aplicarNaNf !== false;
    // Com `aplicarNaNf` a NF vira o proprio nome; sem ele, so muda se veio texto.
    const nomeNf = aplicarNaNf ? nome : normalizarNome(body.nomeNf);
    if (nomeNf.length > MAX_NOME) {
      return NextResponse.json(
        { error: `Descricao da nota fiscal deve ter no maximo ${MAX_NOME} caracteres.` },
        { status: 400 }
      );
    }
    if (!aplicarNaNf && !nomeNf) {
      // DESC_PROD_NF e NOT NULL: sem texto proprio, nao ha o que gravar nela.
      return NextResponse.json(
        { error: 'Informe a descricao da nota fiscal ou marque para usar o nome do produto.' },
        { status: 400 }
      );
    }

    const alteracoes: AlteracaoProdutoInput[] = [
      { produto: productId, campo: 'DESC_PRODUTO', valor: nome },
      { produto: productId, campo: 'DESC_PROD_NF', valor: nomeNf },
    ];

    const obs = typeof body.obs === 'string' ? body.obs.trim() : '';

    // Os dois campos vao no MESMO lote: o estorno no Alterar Cadastro volta os dois.
    const resultado = await executarAlteracaoCadastro({
      company,
      usuario: auth.username,
      alteracoes,
      obs: obs || 'Renomeado no Produto Detalhado',
    });

    const mexeu = resultado.aplicados > 0;
    const jaEstavaAssim = !mexeu && resultado.semMudanca > 0;

    if (!mexeu && !jaEstavaAssim) {
      const motivo =
        resultado.erros.length > 0
          ? resultado.erros.join(' ')
          : 'O Linx nao confirmou a gravacao do novo nome.';
      return NextResponse.json({ error: motivo }, { status: 400 });
    }

    const depois = await lerNomes(productId);

    return NextResponse.json({
      success: true,
      data: {
        productId,
        productName: depois?.nome ?? nome,
        nomeNf: depois?.nomeNf ?? nomeNf,
        nfIgualAoNome: depois?.nfIgualAoNome ?? nome === nomeNf,
        semMudanca: jaEstavaAssim,
        camposAlterados: resultado.aplicados,
        lote: resultado.lote,
        // Erros parciais (ex.: um dos dois campos recusado) nao somem em silencio.
        avisos: resultado.erros,
      },
    });
  } catch (error) {
    console.error('[product-detail/rename] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao renomear o produto.' },
      { status: 500 }
    );
  }
}

import { NextResponse } from 'next/server';

import { autorizarPrecos, parsePrecoCompany } from '@/lib/auth/precos-guard';
import {
  fetchPrecoFiltroOpcoes,
  listarCamposProduto,
  listarCamposTabela,
} from '@/lib/repositories/precos';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Opções da tela "Alterar Custo / Preço": dimensões do cadastro (grupo, subgrupo,
 * linha, coleção, grade, tipo), tabelas de preço com itens/média e o catálogo de
 * colunas alteráveis. Tudo lido do cadastro, não das vendas.
 */
export async function GET(request: Request) {
  const autorizacao = await autorizarPrecos(request);
  if ('erro' in autorizacao) return autorizacao.erro;

  const { searchParams } = new URL(request.url);
  const company = parsePrecoCompany(searchParams.get('company'));
  if (!company) {
    return NextResponse.json({ error: 'Empresa inválida.' }, { status: 400 });
  }

  const todoCadastro = searchParams.get('todoCadastro') === '1';
  const incluirInativos = searchParams.get('incluirInativos') === '1';

  try {
    // As tabelas de preço NÃO vêm daqui: elas são descobertas a partir dos produtos
    // encontrados (`/api/precos/produtos`), senão a tela mostraria a contagem do
    // cadastro inteiro mesmo com um produto só selecionado.
    const filtros = await fetchPrecoFiltroOpcoes(company, { todoCadastro, incluirInativos });

    return NextResponse.json({
      filtros,
      camposProduto: listarCamposProduto(),
      camposTabelaModelo: listarCamposTabela('01').map((c) => ({
        campo: c.campo,
        label: c.label,
        avancado: c.avancado,
        espelho: c.espelho,
      })),
      podeExecutar: autorizacao.auth.podeExecutar,
    });
  } catch (error) {
    console.error('[precos/opcoes] erro', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Erro ao carregar opções.' },
      { status: 500 }
    );
  }
}

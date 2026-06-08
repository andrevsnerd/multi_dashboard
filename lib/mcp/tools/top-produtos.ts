import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchTopProdutosUltimos3Meses } from '@/lib/repositories/controleEstoque';
import { empresaSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * (NERD) Escopo de linha aplicado: por padrão só ELETRONICOS; "todas" = todas;
 * ou uma linha específica. Para SCARF ME não se aplica (retorna null).
 */
function escopoLinhaLabel(empresa: string, linha?: string): string | null {
  if (empresa !== 'nerd') return null;
  const raw = (linha ?? '').trim().toLowerCase();
  if (!raw || raw === 'eletronicos') return 'ELETRONICOS (padrão)';
  if (raw === 'todas' || raw === 'geral' || raw === 'all') return 'TODAS as linhas';
  return (linha ?? '').trim().toUpperCase();
}

const linhaNerdSchema = z
  .string()
  .optional()
  .describe(
    '(NERD) Escopo de LINHA. Padrão: só ELETRONICOS (sinalizado no retorno). ' +
      'Use "todas" para todas as linhas (inclui BAG, ASSISTENCIA), ou uma linha específica (ex.: "ASSISTENCIA", "BAG"). Ignorado para SCARF ME.'
  );

const ordenarPorSchema = z
  .enum(['receita', 'qtde12m', 'qtde60d', 'qtdeMes'])
  .optional()
  .describe('Critério de ordenação (padrão: receita 12m).');

function compactProduto(p: Awaited<ReturnType<typeof fetchTopProdutosUltimos3Meses>>[number]) {
  return {
    produto: p.produto,
    descricao: p.descricao,
    cor: p.corDescricao || p.cor,
    linha: p.linha,
    subgrupo: p.subgrupo,
    colecao: p.colecao,
    grade: p.grade,
    vendas12m: p.vendas3meses, // janela real = 12 meses
    vendas60dias: p.vendas60dias,
    vendasMesAtual: p.vendasMesAtual,
    receita12m: p.valor3meses,
    estoqueAtual: p.estoqueAtual,
    custoUnitario: p.custoUnitario,
    sugestaoCompra: p.qtdSugerida,
    participacaoPct: p.percParticipacao,
  };
}

function ordenar(
  lista: Awaited<ReturnType<typeof fetchTopProdutosUltimos3Meses>>,
  criterio?: string
) {
  const key = {
    receita: (p: (typeof lista)[number]) => p.valor3meses ?? 0,
    qtde12m: (p: (typeof lista)[number]) => p.vendas3meses ?? 0,
    qtde60d: (p: (typeof lista)[number]) => p.vendas60dias ?? 0,
    qtdeMes: (p: (typeof lista)[number]) => p.vendasMesAtual ?? 0,
  }[criterio ?? 'receita'] ?? ((p: (typeof lista)[number]) => p.valor3meses ?? 0);
  return [...lista].sort((a, b) => key(b) - key(a));
}

/**
 * Tools `top_produtos` e `sem_estoque`, ambas sobre fetchTopProdutosUltimos3Meses,
 * que entrega por produto: vendas (12m / 60d / mês atual), estoque atual, custo,
 * sugestão de compra (qtdSugerida) e categoria. Janelas são fixas (não aceita
 * range arbitrário). Filtros de categoria: NERD → grupos; SCARF ME → linhas,
 * subgrupos, coleções, grades.
 */
export function registerTopProdutosTools(server: McpServer) {
  server.registerTool(
    'top_produtos',
    {
      description:
        'Ranking de produtos mais vendidos de uma empresa, com estoque atual e sugestão de compra por item. ' +
        'Filtros: filial e categoria (NERD → grupos; SCARF ME → linhas/subgrupos/coleções/grades). ' +
        'Ex.: "top capas em NERD" → grupos=["CAPAS"]; "pashmina mais vendida" → linhas/subgrupos=["PASHMINA"]. ' +
        'Para "mais vendidos POR COR" (cada cor do produto como uma linha, com vendas/estoque/sugestão por cor), passe porCor=true — ' +
        'sempre que o usuário pedir "por cor", use porCor=true (vale NERD e SCARF ME). ' +
        'Janelas de venda: 12 meses, 60 dias e mês atual (não aceita período arbitrário). Ordene com `ordenarPor` (ex.: qtdeMes p/ "mais vendidos do mês"). ' +
        'Para "os N mais vendidos ESSE MÊS por cor", o tool `produtos_vendidos` é mais direto (já vem por cor por padrão e aceita o período exato). ' +
        '(NERD) por padrão conta SÓ a linha ELETRONICOS (sinalizado em escopoLinha); para o geral passe `linha`="todas", ou uma linha específica (ex.: "ASSISTENCIA").',
      inputSchema: {
        empresa: empresaSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        linha: linhaNerdSchema,
        porCor: z
          .boolean()
          .optional()
          .describe('Separar por cor (uma linha por produto×cor). Padrão TRUE. Passe false para ver por SKU (somando as cores).'),
        grupos: listaOpcional('Grupos de produto (NERD). Ex.: ["CAPAS"].'),
        linhas: listaOpcional('Linhas (SCARF ME). Ex.: ["PASHMINA"].'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        ordenarPor: ordenarPorSchema,
        limite: z.number().int().min(1).max(200).optional().describe('Qtde de produtos (padrão 30).'),
        mesesCobertura: z
          .number()
          .int()
          .min(1)
          .max(12)
          .optional()
          .describe('Meses-alvo de cobertura para a sugestão de compra (padrão 3).'),
      },
    },
    async ({ empresa, filial, linha, porCor, grupos, linhas, subgrupos, colecoes, grades, ordenarPor, limite, mesesCobertura }) => {
      const lista = await fetchTopProdutosUltimos3Meses({
        company: empresa,
        filial: filial ?? null,
        porCor: porCor ?? true,
        grupos: listaOuNull(grupos),
        linhas: listaOuNull(linhas),
        subgrupos: listaOuNull(subgrupos),
        colecoes: listaOuNull(colecoes),
        grades: listaOuNull(grades),
        qtdCompra: mesesCobertura ?? 3,
        limit: Math.max(limite ?? 30, 1),
        nerdLinha: linha,
      });

      const ordenada = ordenar(lista, ordenarPor).slice(0, limite ?? 30);
      return texto({
        empresa,
        filial: filial ?? 'TODAS',
        escopoLinha: escopoLinhaLabel(empresa, linha),
        porCor: porCor ?? true,
        ordenadoPor: ordenarPor ?? 'receita',
        total: ordenada.length,
        produtos: ordenada.map(compactProduto),
      });
    }
  );

  server.registerTool(
    'sem_estoque',
    {
      description:
        'Produtos SEM ESTOQUE (estoque atual <= 0) que tiveram venda — rupturas — de uma empresa, ordenados por venda. ' +
        'Inclui a sugestão de compra de cada item. Filtros: filial e categoria (grupos/linhas/subgrupos/coleções/grades). ' +
        '(NERD) por padrão conta SÓ a linha ELETRONICOS (sinalizado em escopoLinha); para o geral passe `linha`="todas", ou uma linha específica.',
      inputSchema: {
        empresa: empresaSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        linha: linhaNerdSchema,
        grupos: listaOpcional('Grupos (NERD).'),
        linhas: listaOpcional('Linhas (SCARF ME).'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        limite: z.number().int().min(1).max(300).optional().describe('Qtde de produtos (padrão 50).'),
        mesesCobertura: z.number().int().min(1).max(12).optional().describe('Meses-alvo p/ sugestão (padrão 3).'),
      },
    },
    async ({ empresa, filial, linha, grupos, linhas, subgrupos, colecoes, grades, limite, mesesCobertura }) => {
      const lista = await fetchTopProdutosUltimos3Meses({
        company: empresa,
        filial: filial ?? null,
        grupos: listaOuNull(grupos),
        linhas: listaOuNull(linhas),
        subgrupos: listaOuNull(subgrupos),
        colecoes: listaOuNull(colecoes),
        grades: listaOuNull(grades),
        qtdCompra: mesesCobertura ?? 3,
        limit: 1000,
        nerdLinha: linha,
      });

      const rupturas = ordenar(
        lista.filter((p) => (p.estoqueAtual ?? 0) <= 0 && (p.vendas3meses ?? 0) > 0),
        'qtde12m'
      ).slice(0, limite ?? 50);

      return texto({
        empresa,
        filial: filial ?? 'TODAS',
        escopoLinha: escopoLinhaLabel(empresa, linha),
        criterio: 'estoqueAtual <= 0 e com venda nos últimos 12 meses',
        total: rupturas.length,
        produtos: rupturas.map(compactProduto),
      });
    }
  );
}

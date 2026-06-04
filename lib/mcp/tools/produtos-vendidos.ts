import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchProdutoDetalhes } from '@/lib/repositories/controleEstoque';
import { empresaSchema, dataSchema, texto } from '@/lib/mcp/shared';

/**
 * Tool `produtos_vendidos`: ranking de produtos vendidos em um PERÍODO ARBITRÁRIO
 * (datas exatas — inclusive um único dia, ex.: ontem), com filtros de categoria e
 * filial. Diferente de `top_produtos` (janelas fixas + sugestão de compra), aqui
 * o período é livre. Sobre fetchProdutoDetalhes (variações com vendasTotais).
 */
export function registerProdutosVendidosTools(server: McpServer) {
  server.registerTool(
    'produtos_vendidos',
    {
      description:
        'Ranking de produtos vendidos em um PERÍODO específico (datas exatas), por empresa. ' +
        'Use para "mais vendidos no mês passado", "o que vendeu ontem", "quanto a categoria X vendeu entre datas". ' +
        'Para um único dia, passe inicio=fim nesse dia. Filtros: filial e categoria (grupo p/ NERD; ' +
        'linha/subgrupo/coleção/grade p/ SCARF ME) e/ou busca por SKU/nome. Ordene por vendas (padrão) ou estoque.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.describe('Início do período (YYYY-MM-DD). Para "ontem", use a data de ontem.'),
        fim: dataSchema.describe('Fim do período (YYYY-MM-DD), inclusivo. Para um único dia, igual a inicio.'),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        grupo: z.string().optional().describe('Grupo de produto (NERD). Ex.: "CAPAS".'),
        linha: z.string().optional().describe('Linha (SCARF ME). Ex.: "PASHMINA".'),
        subgrupo: z.string().optional().describe('Subgrupo (SCARF ME).'),
        colecao: z.string().optional().describe('Coleção (SCARF ME).'),
        grade: z.string().optional().describe('Grade (SCARF ME).'),
        busca: z.string().optional().describe('Termo de busca por SKU/nome (opcional).'),
        ordenarPor: z.enum(['vendas', 'estoque']).optional().describe('Critério (padrão: vendas).'),
        limite: z.number().int().min(1).max(200).optional().describe('Qtde de produtos (padrão 30).'),
      },
    },
    async ({ empresa, inicio, fim, filial, grupo, linha, subgrupo, colecao, grade, busca, ordenarPor, limite }) => {
      // Fim inclusivo: o repositório usa endDate exclusivo, então somamos 1 dia.
      const startDate = new Date(`${inicio}T00:00:00.000Z`);
      const endDate = new Date(`${fim}T00:00:00.000Z`);
      endDate.setUTCDate(endDate.getUTCDate() + 1);

      const detalhe = await fetchProdutoDetalhes({
        company: empresa,
        filial: filial ?? null,
        grupo: grupo || undefined,
        linha: linha || undefined,
        subgrupo: subgrupo || undefined,
        colecao: colecao || undefined,
        grade: grade || undefined,
        buscaItens: busca ? [busca] : undefined,
        startDate,
        endDate,
        filtrarApenasComVendas: true,
      });

      const criterio = ordenarPor ?? 'vendas';
      const ordenadas = [...detalhe.variacoes]
        .sort((a, b) =>
          criterio === 'estoque'
            ? (b.estoque ?? 0) - (a.estoque ?? 0)
            : (b.vendasTotais ?? 0) - (a.vendasTotais ?? 0)
        )
        .slice(0, limite ?? 30)
        .map((v) => ({
          produto: v.produto,
          descricao: v.descricao,
          cor: v.cor,
          linha: v.linha,
          subgrupo: v.subgrupo,
          colecao: v.colecao,
          grade: v.grade,
          vendasPeriodo: v.vendasTotais,
          estoqueAtual: v.estoque,
          preco: v.preco,
          custoUnitario: v.custoUnitario,
        }));

      return texto({
        empresa,
        periodo: { inicio, fim },
        filial: filial ?? 'TODAS',
        ordenadoPor: criterio,
        totais: {
          itensComVenda: detalhe.resumo.totalItens,
          vendasTotais: detalhe.resumo.vendasTotais,
          estoqueTotal: detalhe.resumo.estoqueTotal,
        },
        produtos: ordenadas,
      });
    }
  );
}

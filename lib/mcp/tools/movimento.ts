import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchControleMovimentoKPIs } from '@/lib/repositories/controleMovimento';
import { fetchControleTransferencias } from '@/lib/repositories/controleTransferencias';
import { empresaSchema, dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tools `movimento` e `transferencias`:
 * - movimento: KPIs de movimentação de estoque (entradas, vendidos, itens
 *   parados) do período, com comparativo contra o mês anterior.
 * - transferencias: base por produto para análise de transferência entre
 *   filiais (estoque + vendas em janelas). Resumida + top N para manter enxuto.
 */
export function registerMovimentoTools(server: McpServer) {
  server.registerTool(
    'movimento',
    {
      description:
        'KPIs de movimentação de estoque de uma empresa no período: entradas (qtd/custo), itens vendidos ' +
        '(qtd/valor) e itens parados (sem giro) — cada um com comparativo contra o mês anterior. ' +
        'Filtros: filial, grupos, linhas, coleções, subgrupos, grades.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        grupos: listaOpcional('Grupos de produto.'),
        linhas: listaOpcional('Linhas de produto.'),
        colecoes: listaOpcional('Coleções.'),
        subgrupos: listaOpcional('Subgrupos.'),
        grades: listaOpcional('Grades.'),
      },
    },
    async ({ empresa, inicio, fim, filial, grupos, linhas, colecoes, subgrupos, grades }) => {
      const kpis = await fetchControleMovimentoKPIs({
        company: empresa,
        filial: filial ?? null,
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
        grupos: listaOuNull(grupos),
        linhas: listaOuNull(linhas),
        colecoes: listaOuNull(colecoes),
        subgrupos: listaOuNull(subgrupos),
        grades: listaOuNull(grades),
      });

      return texto({
        empresa,
        periodo: inicio && fim ? { inicio, fim } : 'padrão',
        filial: filial ?? 'TODAS',
        kpis,
      });
    }
  );

  server.registerTool(
    'transferencias',
    {
      description:
        'Base de análise de transferência entre filiais de uma empresa: por produto, mostra estoque e vendas ' +
        '(30d/60d/12m) em cada filial — insumo para decidir remanejamento. Retorna totais e os top N produtos ' +
        'por volume de vendas (use `limite`). Filtro: filial, período da janela de vendas.',
      inputSchema: {
        empresa: empresaSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        limite: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Qtde de produtos no topProdutos (padrão 30).'),
      },
    },
    async ({ empresa, filial, inicio, fim, limite }) => {
      const produtos = await fetchControleTransferencias({
        company: empresa,
        filial: filial ?? null,
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
      });

      const totalEstoque = produtos.reduce((s, p) => s + (p.totalEstoque ?? 0), 0);
      const totalVendas = produtos.reduce((s, p) => s + (p.totalVendas ?? 0), 0);

      const topProdutos = [...produtos]
        .sort((a, b) => (b.totalVendas ?? 0) - (a.totalVendas ?? 0))
        .slice(0, limite ?? 30)
        .map((p) => ({
          produto: p.produto,
          descricao: p.descricao,
          cor: p.cor,
          subgrupo: p.subgrupo,
          totalEstoque: p.totalEstoque,
          totalVendas: p.totalVendas,
          filiais: (p.filiais ?? []).map((f) => ({
            filial: f.filial,
            estoque: f.stock,
            vendas30d: f.salesLast30Days,
            vendas60d: f.vendas60d,
            vendas12m: f.vendas12m,
          })),
        }));

      return texto({
        empresa,
        filial: filial ?? 'TODAS',
        totais: { produtos: produtos.length, estoque: totalEstoque, vendas: totalVendas },
        topProdutos,
      });
    }
  );
}

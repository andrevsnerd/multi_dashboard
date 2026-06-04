import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchSalesSummary } from '@/lib/repositories/sales';
import type { MetricSummary } from '@/types/dashboard';

const empresaSchema = z
  .enum(['nerd', 'scarfme'])
  .describe('Chave da empresa (nerd | scarfme). Veja listar_empresas.');

const dataSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use o formato YYYY-MM-DD')
  .describe('Data no formato YYYY-MM-DD');

const listaOpcional = (descricao: string) =>
  z.array(z.string()).optional().describe(descricao);

function metrica(m: MetricSummary) {
  return {
    atual: m.currentValue,
    anterior: m.previousValue,
    variacaoPct: m.changePercentage,
  };
}

/**
 * Tool `vendas`: resumo de vendas (faturamento, quantidade, tickets, ticket
 * médio, estoque) de um período, com comparativo automático contra o período
 * anterior equivalente. Aceita filtros de filial, grupos, subgrupos, linhas,
 * coleções e grades. É um wrapper fino sobre fetchSalesSummary.
 */
export function registerVendasTools(server: McpServer) {
  server.registerTool(
    'vendas',
    {
      description:
        'Resumo de vendas de uma empresa em um período: faturamento, quantidade, nº de tickets, ' +
        'ticket médio e estoque — cada um com valor atual, do período anterior equivalente e variação %. ' +
        'Filtros opcionais por filial, grupos, subgrupos, linhas, coleções e grades. ' +
        'Use listar_filiais para descobrir os valores de `filial`/grupos. Omitir `filial` = todas as filiais.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema,
        fim: dataSchema,
        filial: z
          .string()
          .optional()
          .describe('Valor de filial vindo de listar_filiais. Omitir = todas as filiais.'),
        grupos: listaOpcional('Grupos de produto (ex.: vindos de listar_grupos).'),
        subgrupos: listaOpcional('Subgrupos de produto.'),
        linhas: listaOpcional('Linhas de produto.'),
        colecoes: listaOpcional('Coleções.'),
        grades: listaOpcional('Grades.'),
      },
    },
    async ({ empresa, inicio, fim, filial, grupos, subgrupos, linhas, colecoes, grades }) => {
      const { summary, currentPeriodLastSaleDate, availableRange } = await fetchSalesSummary({
        company: empresa,
        range: { start: inicio, end: fim },
        filial: filial ?? null,
        grupos: grupos && grupos.length > 0 ? grupos : null,
        subgrupos: subgrupos && subgrupos.length > 0 ? subgrupos : null,
        linhas: linhas && linhas.length > 0 ? linhas : null,
        colecoes: colecoes && colecoes.length > 0 ? colecoes : null,
        grades: grades && grades.length > 0 ? grades : null,
      });

      const payload = {
        empresa,
        periodo: { inicio, fim },
        filial: filial ?? 'TODAS',
        filtros: {
          grupos: grupos ?? null,
          subgrupos: subgrupos ?? null,
          linhas: linhas ?? null,
          colecoes: colecoes ?? null,
          grades: grades ?? null,
        },
        metricas: {
          faturamento: metrica(summary.totalRevenue),
          quantidade: metrica(summary.totalQuantity),
          tickets: metrica(summary.totalTickets),
          ticketMedio: metrica(summary.averageTicket),
          estoqueQuantidade: metrica(summary.totalStockQuantity),
          estoqueValor: metrica(summary.totalStockValue),
        },
        ultimaVendaNoPeriodo: currentPeriodLastSaleDate?.toISOString() ?? null,
        rangeDisponivel: {
          inicio: availableRange.start?.toISOString() ?? null,
          fim: availableRange.end?.toISOString() ?? null,
        },
      };

      return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
    }
  );
}

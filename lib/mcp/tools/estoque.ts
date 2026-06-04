import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchStockByFilial } from '@/lib/repositories/stockByFilial';
import { empresaSchema, dataSchema, texto } from '@/lib/mcp/shared';

/**
 * Tool `estoque`: saldo de estoque atual agregado por filial (+ vendas no
 * período e nos últimos 30 dias). Opcionalmente lista os produtos com maior
 * estoque. Wrapper sobre fetchStockByFilial — agregação feita aqui para manter
 * o payload enxuto (a query pode retornar milhares de SKUs).
 */
export function registerEstoqueTools(server: McpServer) {
  server.registerTool(
    'estoque',
    {
      description:
        'Estoque atual agregado por filial de uma empresa, com vendas no período e nos últimos 30 dias. ' +
        'Filtros opcionais: filial (de listar_filiais), linha, subgrupo, coleção, grade. ' +
        'Defina incluirProdutos=true para também receber os produtos com maior estoque (topProdutos).',
      inputSchema: {
        empresa: empresaSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        inicio: dataSchema.optional().describe('Início da janela de vendas (opcional).'),
        fim: dataSchema.optional().describe('Fim da janela de vendas (opcional).'),
        linha: z.string().optional(),
        subgrupo: z.string().optional(),
        colecao: z.string().optional(),
        grade: z.string().optional(),
        incluirProdutos: z
          .boolean()
          .optional()
          .describe('Se true, inclui topProdutos por estoque.'),
        limiteProdutos: z
          .number()
          .int()
          .min(1)
          .max(200)
          .optional()
          .describe('Qtde de produtos em topProdutos (padrão 20).'),
      },
    },
    async ({ empresa, filial, inicio, fim, linha, subgrupo, colecao, grade, incluirProdutos, limiteProdutos }) => {
      const itens = await fetchStockByFilial({
        company: empresa,
        filial: filial ?? null,
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
        linha: linha ?? null,
        subgrupo: subgrupo ?? null,
        colecao: colecao ?? null,
        grade: grade ?? null,
      });

      // Agrega por filial
      const porFilialMap = new Map<
        string,
        { filial: string; estoque: number; vendasPeriodo: number; vendas30d: number; skus: number }
      >();
      let totalEstoque = 0;
      let totalVendas = 0;

      for (const item of itens) {
        totalEstoque += item.totalEstoque ?? 0;
        totalVendas += item.totalVendas ?? 0;
        for (const f of item.filiais ?? []) {
          const cur =
            porFilialMap.get(f.filial) ??
            { filial: f.filial, estoque: 0, vendasPeriodo: 0, vendas30d: 0, skus: 0 };
          cur.estoque += f.stock ?? 0;
          cur.vendasPeriodo += f.sales ?? 0;
          cur.vendas30d += f.salesLast30Days ?? 0;
          if ((f.stock ?? 0) !== 0) cur.skus += 1;
          porFilialMap.set(f.filial, cur);
        }
      }

      const porFilial = Array.from(porFilialMap.values()).sort((a, b) => b.estoque - a.estoque);

      const payload: Record<string, unknown> = {
        empresa,
        filial: filial ?? 'TODAS',
        filtros: { linha: linha ?? null, subgrupo: subgrupo ?? null, colecao: colecao ?? null, grade: grade ?? null },
        totais: { estoque: totalEstoque, vendas: totalVendas, skus: itens.length },
        porFilial,
      };

      if (incluirProdutos) {
        const limite = limiteProdutos ?? 20;
        payload.topProdutos = [...itens]
          .sort((a, b) => (b.totalEstoque ?? 0) - (a.totalEstoque ?? 0))
          .slice(0, limite)
          .map((i) => ({
            produto: i.produto,
            descricao: i.descricao,
            cor: i.cor,
            grupo: i.grupo,
            subgrupo: i.subgrupo,
            estoque: i.totalEstoque,
            vendas: i.totalVendas,
          }));
      }

      return texto(payload);
    }
  );
}

import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchVendedoresList } from '@/lib/repositories/vendedores-v2';
import { fetchClientesRankingCompras } from '@/lib/repositories/clientes';
import { empresaSchema, dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tools `vendedores` e `clientes`: rankings analíticos.
 * - vendedores: ranking de vendedores por faturamento no período.
 * - clientes: ranking de clientes por compras no período.
 */
export function registerPessoasTools(server: McpServer) {
  server.registerTool(
    'vendedores',
    {
      description:
        'Ranking de vendedores de uma empresa no período, por faturamento (com qtd vendida, tickets, ticket médio e ' +
        'participação na filial). Filtros: filial, grupos, linhas, coleções, subgrupos, grades. Limita a `limite` (padrão 50).',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        grupos: listaOpcional('Grupos de produto (NERD).'),
        linhas: listaOpcional('Linhas (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        limite: z.number().int().min(1).max(500).optional().describe('Máximo de vendedores (padrão 50).'),
      },
    },
    async ({ empresa, inicio, fim, filial, grupos, linhas, colecoes, subgrupos, grades, limite }) => {
      const lista = await fetchVendedoresList({
        company: empresa,
        filial: filial ?? null,
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
        grupos: listaOuNull(grupos) ?? undefined,
        linhas: listaOuNull(linhas) ?? undefined,
        colecoes: listaOuNull(colecoes) ?? undefined,
        subgrupos: listaOuNull(subgrupos) ?? undefined,
        grades: listaOuNull(grades) ?? undefined,
        light: true,
      });

      const vendedores = [...lista]
        .sort((a, b) => (b.faturamento ?? 0) - (a.faturamento ?? 0))
        .slice(0, limite ?? 50)
        .map((v) => ({
          vendedor: v.vendedor,
          filial: v.filial,
          faturamento: v.faturamento,
          quantidadeVendida: v.quantidadeVendida,
          tickets: v.tickets,
          ticketMedio: v.ticketMedio,
          participacaoFilial: v.participacaoFilial,
        }));

      return texto({ empresa, filial: filial ?? 'TODAS', total: lista.length, vendedores });
    }
  );

  server.registerTool(
    'clientes',
    {
      description:
        'Ranking de clientes de uma empresa por compras no período. Filtros: filial, vendedor (apelido/código), ' +
        'busca (nome do cliente). Limita a `limite` (padrão 100).',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        vendedor: z.string().optional().describe('Apelido ou código do vendedor.'),
        busca: z.string().optional().describe('Filtra por nome do cliente (mín. 2 caracteres).'),
        limite: z.number().int().min(1).max(1000).optional().describe('Máximo de clientes (padrão 100).'),
      },
    },
    async ({ empresa, inicio, fim, filial, vendedor, busca, limite }) => {
      const lista = await fetchClientesRankingCompras({
        company: empresa,
        filial: filial ?? null,
        vendedor: vendedor ?? null,
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
        searchTerm: busca ?? undefined,
        limit: limite ?? 100,
      });

      return texto({ empresa, filial: filial ?? 'TODAS', total: lista.length, clientes: lista });
    }
  );
}

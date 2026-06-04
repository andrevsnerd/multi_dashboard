import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  fetchAvailableGrupos,
  fetchAvailableLinhas,
  fetchAvailableColecoesWithDescriptions,
  fetchAvailableSubgrupos,
  fetchAvailableGrades,
} from '@/lib/repositories/products';
import { empresaSchema, dataSchema, texto } from '@/lib/mcp/shared';

/**
 * Tool `listar_categorias`: vocabulário de produto para montar filtros.
 *
 * O modelo difere por empresa: **NERD usa GRUPOS**; **SCARF ME usa LINHAS,
 * COLEÇÕES, SUBGRUPOS e GRADES**. Retorna apenas as dimensões da empresa, com
 * base nos produtos que tiveram venda no período/filial informados.
 */
export function registerCategoriasTools(server: McpServer) {
  server.registerTool(
    'listar_categorias',
    {
      description:
        'Lista as categorias de produto disponíveis para filtrar (vendas, estoque, movimento). ' +
        'NERD → grupos. SCARF ME → linhas, coleções, subgrupos, grades. ' +
        'Considera produtos com venda no período/filial. Use os valores retornados em grupos/subgrupos/linhas/coleções/grades das outras tools.',
      inputSchema: {
        empresa: empresaSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        inicio: dataSchema.optional().describe('Início da janela (opcional).'),
        fim: dataSchema.optional().describe('Fim da janela (opcional).'),
      },
    },
    async ({ empresa, filial, inicio, fim }) => {
      const range = inicio && fim ? { start: inicio, end: fim } : undefined;
      const base = { company: empresa, range, filial: filial ?? null };

      if (empresa === 'nerd') {
        const grupos = await fetchAvailableGrupos(base);
        return texto({ empresa, dimensoes: { grupos } });
      }

      // scarfme
      const [linhas, colecoes, subgrupos, grades] = await Promise.all([
        fetchAvailableLinhas(base),
        fetchAvailableColecoesWithDescriptions(base),
        fetchAvailableSubgrupos(base),
        fetchAvailableGrades(base),
      ]);

      return texto({
        empresa,
        dimensoes: {
          linhas,
          colecoes: colecoes.map((c) => ({ valor: c.value, descricao: c.label })),
          subgrupos,
          grades,
        },
      });
    }
  );
}

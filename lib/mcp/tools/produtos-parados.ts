import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchProdutosParados } from '@/lib/repositories/controleEstoque';
import { empresaSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tool `produtos_parados`: produtos COM estoque e SEM venda há mais de X dias
 * (giro parado). O usuário escolhe o limite de dias (ex.: 120, 90, 180).
 * Sobre fetchProdutosParados (diasGiro = janela sem venda).
 */
export function registerProdutosParadosTools(server: McpServer) {
  server.registerTool(
    'produtos_parados',
    {
      description:
        'Produtos com estoque que NÃO vendem há mais de N dias (giro parado), de uma empresa. ' +
        'Você escolhe o limite em `dias` (ex.: 120, 90, 180). Responde "qual produto está parado há mais de X dias". ' +
        'Filtros: filial e categoria (grupos p/ NERD; linhas/subgrupos/coleções/grades p/ SCARF ME). ' +
        'Ordenado por estoque (maior encalhe primeiro).',
      inputSchema: {
        empresa: empresaSchema,
        dias: z
          .number()
          .int()
          .min(1)
          .max(3650)
          .describe('Limite de dias sem venda (parado há mais de N dias). Ex.: 120.'),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        grupos: listaOpcional('Grupos (NERD).'),
        linhas: listaOpcional('Linhas (SCARF ME).'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        limite: z.number().int().min(1).max(500).optional().describe('Máximo de produtos (padrão 100).'),
      },
    },
    async ({ empresa, dias, filial, grupos, linhas, subgrupos, colecoes, grades, limite }) => {
      const lista = await fetchProdutosParados({
        company: empresa,
        filial: filial ?? null,
        grupos: listaOuNull(grupos),
        linhas: listaOuNull(linhas),
        subgrupos: listaOuNull(subgrupos),
        colecoes: listaOuNull(colecoes),
        grades: listaOuNull(grades),
        diasGiro: dias,
      });

      const ordenada = [...lista].sort((a, b) => (b.estoque ?? 0) - (a.estoque ?? 0));
      const totalEstoque = ordenada.reduce((s, p) => s + (p.estoque ?? 0), 0);

      return texto({
        empresa,
        criterio: `sem venda há mais de ${dias} dias, com estoque`,
        filial: filial ?? 'TODAS',
        totais: { produtos: ordenada.length, estoque: totalEstoque },
        produtos: ordenada.slice(0, limite ?? 100).map((p) => ({
          produto: p.produto,
          descricao: p.descricao,
          cor: p.cor,
          linha: p.linha,
          subgrupo: p.subgrupo,
          colecao: p.colecao,
          grade: p.grade,
          estoque: p.estoque,
        })),
      });
    }
  );
}

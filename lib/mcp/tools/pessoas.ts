import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchVendedoresList, fetchVendedorProdutosList } from '@/lib/repositories/vendedores-v2';
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
        'Ranking de vendedores de uma empresa no período, por faturamento (com qtd vendida, DESCONTO concedido, tickets, ticket médio e ' +
        'participação na filial). Filtros: filial, grupos, linhas, coleções, subgrupos, grades. ' +
        'Para o ranking de QUEM deu mais desconto, use `ordenarPor: "desconto"`. ' +
        'Para "quais vendedores deram mais desconto NESTE produto", passe `produto` (código) + `ordenarPor: "desconto"`. ' +
        'Limita a `limite` (padrão 50).',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas.'),
        produto: z
          .string()
          .optional()
          .describe('Código de UM produto: restringe o ranking às vendas desse SKU (ex.: quem mais vendeu/descontou este item).'),
        ordenarPor: z
          .enum(['faturamento', 'desconto'])
          .optional()
          .describe('Critério de ordenação do ranking. Padrão: faturamento. Use "desconto" para quem deu mais desconto.'),
        grupos: listaOpcional('Grupos de produto (NERD).'),
        linhas: listaOpcional('Linhas (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        limite: z.number().int().min(1).max(500).optional().describe('Máximo de vendedores (padrão 50).'),
      },
    },
    async ({ empresa, inicio, fim, filial, produto, ordenarPor, grupos, linhas, colecoes, subgrupos, grades, limite }) => {
      const lista = await fetchVendedoresList({
        company: empresa,
        filial: filial ?? null,
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
        produtoId: produto?.trim() || undefined,
        grupos: listaOuNull(grupos) ?? undefined,
        linhas: listaOuNull(linhas) ?? undefined,
        colecoes: listaOuNull(colecoes) ?? undefined,
        subgrupos: listaOuNull(subgrupos) ?? undefined,
        grades: listaOuNull(grades) ?? undefined,
        light: true,
      });

      const ordenarPorDesconto = ordenarPor === 'desconto';
      const vendedores = [...lista]
        .sort((a, b) =>
          ordenarPorDesconto
            ? (b.desconto ?? 0) - (a.desconto ?? 0)
            : (b.faturamento ?? 0) - (a.faturamento ?? 0)
        )
        .slice(0, limite ?? 50)
        .map((v) => ({
          vendedor: v.vendedor,
          filial: v.filial,
          faturamento: v.faturamento,
          desconto: v.desconto,
          quantidadeVendida: v.quantidadeVendida,
          tickets: v.tickets,
          ticketMedio: v.ticketMedio,
          participacaoFilial: v.participacaoFilial,
        }));

      return texto({
        empresa,
        filial: filial ?? 'TODAS',
        produto: produto?.trim() || null,
        ordenadoPor: ordenarPorDesconto ? 'desconto' : 'faturamento',
        total: lista.length,
        vendedores,
      });
    }
  );

  server.registerTool(
    'vendedor_produtos',
    {
      description:
        'Lista TODOS os produtos que UM vendedor vendeu no período (cada item: produto, descrição, cor, categoria, ' +
        'quantidade e faturamento), ordenados por faturamento. É o INVERSO de "quem vendeu este produto": aqui você fixa o ' +
        'vendedor e vê o detalhe dos produtos dele. Responde "quais produtos a Stephanie vendeu este mês", "detalhe das vendas do vendedor X". ' +
        'Informe `vendedor` (apelido como aparece no ranking de `vendedores`, ou código). `filial` opcional (omitir = todas as filiais onde ele atuou). ' +
        'Dá pra recortar por categoria (grupos/linhas/subgrupos/coleções/grades), por termo na descrição (`busca`) ou por um SKU (`produto`).',
      inputSchema: {
        empresa: empresaSchema,
        vendedor: z.string().describe('Apelido do vendedor (como no ranking de `vendedores`) ou código.'),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas as filiais onde o vendedor atuou.'),
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        grupos: listaOpcional('Grupos de produto (NERD).'),
        linhas: listaOpcional('Linhas (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        busca: z.string().optional().describe('Trecho da DESCRIÇÃO do produto (ex.: "geonav").'),
        produto: z.string().optional().describe('Código de UM produto (SKU) para ver só ele.'),
        limite: z.number().int().min(1).max(500).optional().describe('Máximo de produtos (padrão 100).'),
      },
    },
    async ({ empresa, vendedor, filial, inicio, fim, grupos, linhas, colecoes, subgrupos, grades, busca, produto, limite }) => {
      const lista = await fetchVendedorProdutosList({
        company: empresa,
        vendedor,
        filial: filial ?? '',
        range: inicio && fim ? { start: inicio, end: fim } : undefined,
        grupos: listaOuNull(grupos) ?? undefined,
        linhas: listaOuNull(linhas) ?? undefined,
        colecoes: listaOuNull(colecoes) ?? undefined,
        subgrupos: listaOuNull(subgrupos) ?? undefined,
        grades: listaOuNull(grades) ?? undefined,
        produtoId: produto?.trim() || undefined,
        produtoSearchTerm: !produto && busca ? busca : undefined,
      });

      const faturamentoTotal = lista.reduce((s, p) => s + (p.faturamento ?? 0), 0);
      const quantidadeTotal = lista.reduce((s, p) => s + (p.quantidade ?? 0), 0);
      const produtos = lista.slice(0, limite ?? 100).map((p) => ({
        produto: p.codigo ?? null,
        descricao: p.descricao,
        cor: p.cor ?? null,
        grupo: p.grupo ?? null,
        linha: p.linha ?? null,
        subgrupo: p.subgrupo ?? null,
        colecao: p.colecao ?? null,
        grade: p.grade ?? null,
        quantidade: p.quantidade,
        faturamento: p.faturamento,
      }));

      return texto({
        empresa,
        vendedor,
        filial: filial ?? 'TODAS',
        periodo: inicio && fim ? { inicio, fim } : 'padrão',
        totais: { produtos: lista.length, faturamento: faturamentoTotal, quantidade: quantidadeTotal },
        produtos,
      });
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

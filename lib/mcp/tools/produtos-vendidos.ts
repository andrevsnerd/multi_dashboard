import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchProductsWithDetails, type ProductDetail } from '@/lib/repositories/products';
import { aggregateProductDetailsWithGroups } from '@/lib/utils/produto-agrupado-aggregation';
import { listProdutoAgrupadoGroups } from '@/lib/utils/produto-agrupado-store';
import type { CompanyKey } from '@/lib/config/company';
import { empresaSchema, dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tool `produtos_vendidos`: ranking de produtos vendidos em um PERÍODO arbitrário,
 * espelhando EXATAMENTE a página /produtos do dashboard.
 *
 * Usa a mesma fonte da página (`fetchProductsWithDetails` + agregação de produtos
 * agrupados), então traz FATURAMENTO (totalRevenue) e ordena por faturamento por
 * padrão — igual à tela. Com `porCor` (padrão true) separa por cor, e o estoque
 * vem por cor (igual ao "Por cor" da página). Período livre (datas exatas, mín 1 dia);
 * padrão = mês atual.
 */

const ordenarPorSchema = z
  .enum(['faturamento', 'quantidade', 'estoque'])
  .optional()
  .describe('Critério de ordenação (padrão: faturamento, igual à página /produtos).');

function defaultRange(): { inicio: string; fim: string } {
  const hoje = new Date();
  const inicioMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  return {
    inicio: inicioMes.toISOString().slice(0, 10),
    fim: hoje.toISOString().slice(0, 10),
  };
}

export function registerProdutosVendidosTools(server: McpServer) {
  server.registerTool(
    'produtos_vendidos',
    {
      description:
        'Ranking de produtos vendidos em um PERÍODO (datas exatas), por empresa — espelha a página /produtos do dashboard. ' +
        'Traz FATURAMENTO, quantidade, preço médio, custo, markup e ESTOQUE de cada item, ordenado por faturamento (como na tela). ' +
        'Use para "mais vendidos este mês/no mês passado", "o que vendeu ontem", "quanto a categoria X faturou entre datas". ' +
        'Padrão: mês atual e separado POR COR (porCor=true) — assim dá pra ver vendas E estoque por produto x cor. ' +
        'Para um único dia, passe inicio=fim. Para um SKU específico e suas cores, passe `produto`. ' +
        'Filtros combináveis: filial + categoria (grupos p/ NERD; linhas/subgrupos/coleções/grades p/ SCARF ME) + `busca`. ' +
        '`busca` casa qualquer trecho da DESCRIÇÃO do produto (ex.: marca/termo "geonav", "lenço") — ideal para ações em produtos que ' +
        'compartilham um termo no nome. Devolve a lista (quais) e os totais do período (quanto faturou/vendeu o conjunto filtrado).',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional().describe('Início do período (YYYY-MM-DD). Padrão: 1º dia do mês atual.'),
        fim: dataSchema.optional().describe('Fim do período (YYYY-MM-DD), inclusivo. Padrão: hoje. Para 1 dia, igual a inicio.'),
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = todas (rede).'),
        porCor: z
          .boolean()
          .optional()
          .describe('Separar por cor (padrão true). Quando true, vendas E estoque vêm por produto x cor.'),
        produto: z.string().optional().describe('Código de UM produto (SKU) para ver só ele e suas cores.'),
        grupos: listaOpcional('Grupos (NERD). Ex.: ["CAPAS"].'),
        linhas: listaOpcional('Linhas (SCARF ME). Ex.: ["PASHMINA"].'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        busca: z
          .string()
          .optional()
          .describe('Trecho da DESCRIÇÃO do produto (ex.: "geonav", "lenço"). Casa qualquer produto cujo nome contém o termo. Combina com os filtros de categoria. Para SKU exato, use `produto`.'),
        ordenarPor: ordenarPorSchema,
        limite: z.number().int().min(1).max(300).optional().describe('Qtde de produtos (padrão 50).'),
      },
    },
    async ({ empresa, inicio, fim, filial, porCor, produto, grupos, linhas, subgrupos, colecoes, grades, busca, ordenarPor, limite }) => {
      const padrao = defaultRange();
      const range = { start: inicio ?? padrao.inicio, end: fim ?? padrao.fim };
      const groupByColor = porCor !== false; // padrão true (igual à página)

      const [rawData, gruposAgrupados] = await Promise.all([
        fetchProductsWithDetails({
          company: empresa,
          range,
          filial: filial ?? null,
          grupos: listaOuNull(grupos),
          linhas: listaOuNull(linhas),
          subgrupos: listaOuNull(subgrupos),
          colecoes: listaOuNull(colecoes),
          grades: listaOuNull(grades),
          groupByColor,
          produtoId: produto || undefined,
          produtoSearchTerm: !produto && busca ? busca : undefined,
        }),
        listProdutoAgrupadoGroups(empresa as CompanyKey),
      ]);

      const data: ProductDetail[] = aggregateProductDetailsWithGroups(rawData, gruposAgrupados, {
        groupByColor,
      });

      const criterio = ordenarPor ?? 'faturamento';
      const sortKey = (p: ProductDetail) =>
        criterio === 'quantidade'
          ? p.totalQuantity ?? 0
          : criterio === 'estoque'
            ? p.stock ?? p.estoqueRede ?? 0
            : p.totalRevenue ?? 0;

      const ordenadas = [...data].sort((a, b) => sortKey(b) - sortKey(a));

      const faturamentoTotal = data.reduce((s, p) => s + (p.totalRevenue ?? 0), 0);
      const quantidadeTotal = data.reduce((s, p) => s + (p.totalQuantity ?? 0), 0);

      const produtos = ordenadas.slice(0, limite ?? 50).map((p) => ({
        produto: p.productId,
        descricao: p.productName,
        cor: p.descCorProduto ?? null,
        corCodigo: p.corProduto ?? null,
        grade: p.grade ?? null,
        faturamento: p.totalRevenue,
        quantidade: p.totalQuantity,
        precoMedio: p.averagePrice,
        custo: p.cost,
        markup: p.markup,
        estoque: p.stock,
        estoqueRede: p.estoqueRede ?? p.stock,
        participacaoPct:
          faturamentoTotal > 0 ? Math.round(((p.totalRevenue ?? 0) / faturamentoTotal) * 1000) / 10 : 0,
      }));

      return texto({
        empresa,
        periodo: { inicio: range.start, fim: range.end },
        filial: filial ?? 'TODAS',
        porCor: groupByColor,
        ordenadoPor: criterio,
        totais: {
          itens: data.length,
          faturamento: faturamentoTotal,
          quantidade: quantidadeTotal,
        },
        produtos,
      });
    }
  );
}

import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  fetchProductDetail,
  fetchProductStockByFilial,
  fetchProductSaleHistory,
} from '@/lib/repositories/productDetail';
import { empresaSchema, dataSchema, texto } from '@/lib/mcp/shared';

/**
 * Tool `produto`: ficha 360 de um produto específico (por código). Combina:
 * - fetchProductDetail        → totais, custo/preço, última ENTRADA (quando entrou)
 * - fetchProductStockByFilial → estoque por filial (ONDE o produto está)
 * - fetchProductSaleHistory   → última VENDA + vendas recentes por dia
 *
 * Para descobrir o código a partir do nome/categoria, use top_produtos antes.
 */
export function registerProdutoTools(server: McpServer) {
  server.registerTool(
    'produto',
    {
      description:
        'Ficha completa de UM produto (por código): descrição, estoque total e por filial (onde está), ' +
        'última venda, última entrada (quando entrou), receita/quantidade no período, custo e preço médios. ' +
        'Use o código `produto` retornado por top_produtos/sem_estoque/curva_abc. ' +
        'Por padrão olha os últimos 24 meses (para achar a última venda mesmo de itens lentos). ' +
        'Para saber se vendeu num dia específico (ex.: ontem) e quanto, passe inicio=fim nesse dia: ' +
        'os campos vendas.quantidadePeriodo / receitaPeriodo trazem o total do dia.',
      inputSchema: {
        empresa: empresaSchema,
        produto: z.string().describe('Código do produto (campo `produto` das outras tools).'),
        filial: z.string().optional().describe('Restringe a uma filial (listar_filiais). Omitir = todas.'),
        inicio: dataSchema.optional().describe('Início da janela de vendas (padrão: 24 meses atrás).'),
        fim: dataSchema.optional().describe('Fim da janela (padrão: hoje).'),
      },
    },
    async ({ empresa, produto, filial, inicio, fim }) => {
      const hoje = new Date();
      const defaultStart = new Date(hoje);
      defaultStart.setMonth(defaultStart.getMonth() - 24);
      const range = {
        start: inicio ?? defaultStart.toISOString().slice(0, 10),
        end: fim ?? hoje.toISOString().slice(0, 10),
      };

      const params = { productId: produto, company: empresa, range, filial: filial ?? null };

      const [detail, porFilial, historico] = await Promise.all([
        fetchProductDetail(params),
        fetchProductStockByFilial(params),
        fetchProductSaleHistory(params),
      ]);

      const ultimaVenda = historico.length > 0 ? historico[0] : null;

      return texto({
        empresa,
        produto: detail.productId,
        descricao: detail.productName,
        grade: detail.grade ?? null,
        periodoAnalisado: range,
        estoque: {
          total: detail.totalStock,
          porFilial: porFilial
            .filter((f) => f.stock !== 0 || f.quantity !== 0)
            .map((f) => ({
              filial: f.filialDisplayName,
              estoque: f.stock,
              vendasPeriodo: f.quantity,
              receitaPeriodo: f.revenue,
            })),
        },
        vendas: {
          receitaPeriodo: detail.totalRevenue,
          quantidadePeriodo: detail.totalQuantity,
          variacaoReceitaPct: detail.revenueVariance,
          ultimaVenda: ultimaVenda
            ? {
                data: ultimaVenda.date instanceof Date ? ultimaVenda.date.toISOString().slice(0, 10) : ultimaVenda.date,
                filial: ultimaVenda.filialDisplayName,
                quantidade: ultimaVenda.quantity,
              }
            : null,
        },
        entrada: {
          ultimaEntrada: detail.lastEntryDate
            ? detail.lastEntryDate.toISOString().slice(0, 10)
            : null,
          filialUltimaEntrada: detail.lastEntryFilial,
        },
        custos: {
          custoMedio: detail.averageCost,
          precoMedio: detail.averagePrice,
          custoCadastrado: detail.registeredCost,
          precoCadastrado: detail.registeredPrice,
        },
      });
    }
  );
}

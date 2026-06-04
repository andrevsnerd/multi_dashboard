import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { listComprasTransitoFull } from '@/lib/utils/compra-transito-store';
import { empresaSchema, texto } from '@/lib/mcp/shared';

const STATUS_LABEL: Record<string, string> = {
  rascunho: 'rascunho',
  em_transito: 'em trânsito',
  recebido: 'recebido',
};

/**
 * Tool `compras_transito`: compras em trânsito (o que foi comprado, quanto,
 * custo e quando chega — `dataRecebimento`). Fonte: feature de compras em
 * trânsito do dashboard (Neon/arquivo), gerenciada manualmente — NÃO é pedido
 * de compra automático do ERP. Permite buscar por código de produto.
 */
export function registerComprasTools(server: McpServer) {
  server.registerTool(
    'compras_transito',
    {
      description:
        'Compras em trânsito de uma empresa: itens comprados com quantidade, custo e previsão de chegada (dataRecebimento). ' +
        'Responde "esse produto foi comprado / está chegando / quando chega". Filtre por `produto` (código) e/ou `status` ' +
        '(em_transito | recebido | rascunho). Fonte: cadastro de compras em trânsito do dashboard (não é pedido do ERP).',
      inputSchema: {
        empresa: empresaSchema,
        produto: z.string().optional().describe('Código do produto para filtrar (opcional).'),
        status: z
          .enum(['em_transito', 'recebido', 'rascunho'])
          .optional()
          .describe('Filtra pelo status do item.'),
      },
    },
    async ({ empresa, produto, status }) => {
      const compras = await listComprasTransitoFull(empresa);
      const alvoProduto = produto ? produto.trim().replace(/\s+/g, '').toUpperCase() : null;

      const itens: Array<Record<string, unknown>> = [];
      for (const compra of compras) {
        for (const item of compra.items ?? []) {
          if (alvoProduto && item.produto.trim().replace(/\s+/g, '').toUpperCase() !== alvoProduto) continue;
          if (status && item.status !== status) continue;
          itens.push({
            compra: compra.title,
            produto: item.produto,
            descricao: item.descricao,
            cor: item.corDescricao || item.corProduto || null,
            grade: item.grade ?? null,
            quantidade: item.quantidade,
            custoUnitario: item.custoUnitario ?? null,
            valorTotal: item.custoUnitario != null ? item.custoUnitario * item.quantidade : null,
            chegadaPrevista: item.dataRecebimento,
            status: STATUS_LABEL[item.status] ?? item.status,
          });
        }
      }

      itens.sort((a, b) => String(a.chegadaPrevista ?? '').localeCompare(String(b.chegadaPrevista ?? '')));

      const totalQtd = itens.reduce((s, i) => s + (Number(i.quantidade) || 0), 0);
      const totalValor = itens.reduce((s, i) => s + (Number(i.valorTotal) || 0), 0);

      return texto({
        empresa,
        filtro: { produto: produto ?? null, status: status ?? null },
        totais: { itens: itens.length, quantidade: totalQtd, valor: totalValor },
        itens,
      });
    }
  );
}

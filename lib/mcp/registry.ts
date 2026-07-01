import 'server-only';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerDiscoveryTools } from './tools/discovery';
import { registerVendasTools } from './tools/vendas';
import { registerEstoqueTools } from './tools/estoque';
import { registerRomaneioTools } from './tools/romaneios';
import { registerMovimentoTools } from './tools/movimento';
import { registerCategoriasTools } from './tools/categorias';
import { registerPessoasTools } from './tools/pessoas';
import { registerCurvaTools } from './tools/curva';
import { registerTopProdutosTools } from './tools/top-produtos';
import { registerProdutoTools } from './tools/produto';
import { registerComprasTools } from './tools/compras';
import { registerProdutosVendidosTools } from './tools/produtos-vendidos';
import { registerProdutoCurvaTools } from './tools/produto-curva';
import { registerProdutosParadosTools } from './tools/produtos-parados';
import { registerFaturamentoTools } from './tools/faturamento';

/**
 * Registra todas as tools do servidor MCP do multi-dashboard.
 *
 * Fase 1: descoberta (empresas, filiais) + vendas.
 * Fase 2: estoque, entradas, saídas (romaneios), movimento, transferências.
 * Fase 3: listar_categorias (grupos/linhas/coleções/subgrupos/grades) +
 *         vendedores, clientes, curva ABC.
 * Fase 4: produto (ficha 360), top_produtos, sem_estoque (rupturas + sugestão),
 *         compras_transito (comprado/quando chega), produtos_vendidos (ranking
 *         por período arbitrário) e produto_curva (curva ABC 12m + mês).
 */
export function registerAllTools(server: McpServer) {
  registerDiscoveryTools(server);
  registerVendasTools(server);
  registerEstoqueTools(server);
  registerRomaneioTools(server);
  registerMovimentoTools(server);
  registerCategoriasTools(server);
  registerPessoasTools(server);
  registerCurvaTools(server);
  registerTopProdutosTools(server);
  registerProdutoTools(server);
  registerComprasTools(server);
  registerProdutosVendidosTools(server);
  registerProdutoCurvaTools(server);
  registerProdutosParadosTools(server);
  registerFaturamentoTools(server);
}

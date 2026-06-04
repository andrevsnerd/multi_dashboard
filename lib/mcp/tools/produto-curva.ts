import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchFilialProdutoSales } from '@/lib/repositories/performance';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import type { CompanyKey } from '@/lib/config/company';
import { empresaSchema, texto } from '@/lib/mcp/shared';

function normCodigo(s: string): string {
  return s.trim().replace(/\s+/g, '').toUpperCase();
}

/**
 * Classifica curva ABC (A<=80% da receita acumulada, B<=95%, C acima) sobre o
 * universo de produtos vendidos no período e retorna a posição do produto-alvo.
 */
async function curvaNoPeriodo(
  company: CompanyKey,
  posMembers: string[],
  ecomMembers: string[],
  range: { start?: Date | string; end?: Date | string },
  produtoAlvo: string
) {
  const normalized = normalizeRangeForQuery(range);
  const rows = await fetchFilialProdutoSales(company, posMembers, ecomMembers, normalized, 'month', {
    limit: 0,
  });

  // Agrega por produto (soma cores/filiais)
  const porProduto = new Map<string, { produto: string; descricao: string; vendas: number }>();
  for (const r of rows) {
    const key = normCodigo(r.produto);
    if (!key) continue;
    const cur = porProduto.get(key) ?? { produto: r.produto, descricao: r.descricao, vendas: 0 };
    cur.vendas += r.vendas ?? 0;
    porProduto.set(key, cur);
  }

  const ordenado = [...porProduto.values()].filter((p) => p.vendas > 0).sort((a, b) => b.vendas - a.vendas);
  const total = ordenado.reduce((s, p) => s + p.vendas, 0);
  const alvo = normCodigo(produtoAlvo);

  let cumulativo = 0;
  for (let i = 0; i < ordenado.length; i++) {
    const p = ordenado[i];
    const participacao = total > 0 ? (p.vendas / total) * 100 : 0;
    cumulativo += participacao;
    if (normCodigo(p.produto) === alvo) {
      const curva = cumulativo <= 80 ? 'A' : cumulativo <= 95 ? 'B' : 'C';
      return {
        curva,
        rank: i + 1,
        deUnTotal: ordenado.length,
        receita: p.vendas,
        participacaoPct: Number(participacao.toFixed(3)),
        participacaoAcumuladaPct: Number(cumulativo.toFixed(3)),
      };
    }
  }
  return { curva: null, semVendaNoPeriodo: true };
}

/**
 * Tool `produto_curva`: para UM produto, classifica a curva ABC em duas janelas
 * — últimos 12 meses e mês atual — respondendo "é curva A nos 12 meses?" e
 * "é curva A neste mês?". Funciona para NERD e SCARF ME, escopo rede (todas as
 * filiais de venda). A curva é calculada sobre a receita de todos os produtos.
 */
export function registerProdutoCurvaTools(server: McpServer) {
  server.registerTool(
    'produto_curva',
    {
      description:
        'Classificação de curva ABC de UM produto (por código) em duas janelas: últimos 12 meses e mês atual. ' +
        'Responde "é curva A nos 12 meses?" e "é curva A neste mês?". Curva A = até 80% da receita acumulada da rede, ' +
        'B = até 95%, C = acima. Escopo: rede (todas as filiais de venda da empresa).',
      inputSchema: {
        empresa: empresaSchema,
        produto: z.string().describe('Código do produto (campo `produto` das outras tools).'),
      },
    },
    async ({ empresa, produto }) => {
      const company = await resolveCompanyDynamic(empresa);
      if (!company) {
        return texto({ erro: `Empresa ${empresa} não encontrada.` });
      }

      const ecommerce = new Set(company.ecommerceFilials ?? []);
      const vendaFiliais = company.filialFilters.sales ?? [];
      const posMembers = vendaFiliais.filter((f) => !ecommerce.has(f));
      const ecomMembers = vendaFiliais.filter((f) => ecommerce.has(f));

      const hoje = new Date();
      const fim = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
      const inicio12m = new Date(fim);
      inicio12m.setUTCDate(inicio12m.getUTCDate() - 365);
      const inicioMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));

      const [curva12meses, curvaMesAtual] = await Promise.all([
        curvaNoPeriodo(company.key, posMembers, ecomMembers, { start: inicio12m, end: fim }, produto),
        curvaNoPeriodo(company.key, posMembers, ecomMembers, { start: inicioMes, end: fim }, produto),
      ]);

      return texto({
        empresa,
        produto,
        escopo: 'rede (todas as filiais de venda)',
        curva12meses,
        curvaMesAtual,
      });
    }
  );
}

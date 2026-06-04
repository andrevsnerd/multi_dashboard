import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchClaudeReport } from '@/lib/repositories/claudeReport';
import { empresaSchema, dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tool `curva_abc`: classificação ABC dos SKUs por participação de receita,
 * com resumo por curva e os principais itens da curva A. Baseada no relatório
 * analítico (`fetchClaudeReport`), que hoje é específico de SCARF ME.
 */
export function registerCurvaTools(server: McpServer) {
  server.registerTool(
    'curva_abc',
    {
      description:
        'Curva ABC de SKUs por participação de receita no período (resumo por curva A/B/C + top itens da curva A). ' +
        'Disponível para SCARF ME. Filtros: filial, coleções, subgrupos, grades.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema,
        fim: dataSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = rede.'),
        colecoes: listaOpcional('Coleções.'),
        subgrupos: listaOpcional('Subgrupos.'),
        grades: listaOpcional('Grades.'),
        limite: z.number().int().min(1).max(100).optional().describe('Itens da curva A (padrão 20).'),
      },
    },
    async ({ empresa, inicio, fim, filial, colecoes, subgrupos, grades, limite }) => {
      if (empresa !== 'scarfme') {
        return texto({
          erro: 'Curva ABC disponível apenas para SCARF ME no momento.',
          empresa,
        });
      }

      const report = await fetchClaudeReport({
        filial: filial ?? null,
        range: { start: inicio, end: fim },
        colecoes: listaOuNull(colecoes),
        subgrupos: listaOuNull(subgrupos),
        grades: listaOuNull(grades),
      });

      const compactAbc = (i: (typeof report.topCurveA)[number]) => ({
        produto: i.product,
        descricao: i.description,
        subgrupo: i.subgrupo,
        colecao: i.colecao,
        cor: i.corDescricao || i.cor,
        receita: i.revenue,
        quantidade: i.quantity,
        estoque: i.stock,
        curva: i.curve,
        rank: i.rank,
        participacaoPct: i.share,
        participacaoAcumuladaPct: i.cumulativeShare,
      });

      return texto({
        empresa,
        escopo: report.scopeLabel,
        periodo: report.range,
        resumo: {
          receitaTotal: report.summary.totalRevenue,
          unidades: report.summary.totalUnits,
          skus: report.summary.skuCount,
          estoqueTotal: report.summary.stockTotal,
          rupturas: report.summary.ruptureCount,
          coberturaMeses: report.summary.coverageMonths,
        },
        curvaResumo: report.curveSummary,
        topCurvaA: report.topCurveA.slice(0, limite ?? 20).map(compactAbc),
        rankingSubgrupos: report.subgroupRanking.slice(0, 10),
        rankingColecoes: report.collectionRanking.slice(0, 10),
      });
    }
  );
}

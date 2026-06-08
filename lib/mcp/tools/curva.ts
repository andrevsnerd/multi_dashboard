import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchClaudeReport } from '@/lib/repositories/claudeReport';
import { fetchFilialProdutoSales, fetchStockByProduto } from '@/lib/repositories/performance';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { normalizeRangeForQuery } from '@/lib/utils/date';
import { empresaSchema, dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Curva ABC LEVE (uma consulta por produto, sem a narrativa/drift de 4 anos do
 * relatório completo): agrega receita por SKU, ordena, calcula participação
 * acumulada e classifica A (<=80%), B (<=95%), C (acima). Rápida o suficiente
 * para responder em qualquer empresa — usada para a NERD, onde o relatório
 * completo (fetchClaudeReport) é pesado demais e não retornava a tempo.
 */
async function curvaAbcLeve(
  empresa: string,
  inicio: string,
  fim: string,
  filial: string | null,
  limite: number
) {
  const company = await resolveCompanyDynamic(empresa);
  if (!company) {
    return texto({ erro: `Empresa ${empresa} não encontrada.`, empresa });
  }

  const ecommerce = new Set(company.ecommerceFilials ?? []);
  const vendaFiliais = company.filialFilters.sales ?? [];
  const inventoryFiliais = company.filialFilters.inventory ?? [];
  let posMembers = vendaFiliais.filter((f) => !ecommerce.has(f));
  let ecomMembers = vendaFiliais.filter((f) => ecommerce.has(f));
  // Estoque inclui matriz/depósito (escopo inventory) — igual à SCARF ME.
  let stockScope = inventoryFiliais.length > 0 ? inventoryFiliais : vendaFiliais;

  // Filial específica: restringe os membros (best-effort por nome). Se não casar,
  // mantém a rede e avisa, para nunca devolver vazio por um nome de grupo/rótulo.
  let avisoFilial: string | undefined;
  let escopo = 'rede (todas as filiais de venda)';
  if (filial && filial.trim()) {
    const alvo = filial.trim().toUpperCase();
    const pos = posMembers.filter((f) => f.trim().toUpperCase() === alvo);
    const ecom = ecomMembers.filter((f) => f.trim().toUpperCase() === alvo);
    if (pos.length + ecom.length > 0) {
      posMembers = pos;
      ecomMembers = ecom;
      stockScope = [...pos, ...ecom];
      escopo = `filial ${filial.trim()}`;
    } else {
      avisoFilial = `Filial "${filial.trim()}" não casou diretamente; curva calculada na rede inteira.`;
    }
  }

  const range = normalizeRangeForQuery({ start: inicio, end: fim });
  const [rows, stockMap] = await Promise.all([
    fetchFilialProdutoSales(company.key, posMembers, ecomMembers, range, 'month', { limit: 0 }),
    fetchStockByProduto(stockScope),
  ]);

  // Agrega por SKU (soma cores/grades/filiais).
  const porProduto = new Map<
    string,
    { produto: string; descricao: string; grupo: string; receita: number; quantidade: number }
  >();
  for (const r of rows) {
    const key = (r.produto ?? '').trim().toUpperCase();
    if (!key) continue;
    const cur =
      porProduto.get(key) ??
      { produto: r.produto, descricao: r.descricao, grupo: (r.categoria ?? '').trim(), receita: 0, quantidade: 0 };
    cur.receita += r.vendas ?? 0;
    cur.quantidade += r.qtde ?? 0;
    porProduto.set(key, cur);
  }

  const ordenado = [...porProduto.values()].filter((p) => p.receita > 0).sort((a, b) => b.receita - a.receita);
  const totalReceita = ordenado.reduce((s, p) => s + p.receita, 0);
  const totalQtd = ordenado.reduce((s, p) => s + p.quantidade, 0);

  let cumulativo = 0;
  const classificados = ordenado.map((p, i) => {
    const share = totalReceita > 0 ? (p.receita / totalReceita) * 100 : 0;
    cumulativo += share;
    const curva: 'A' | 'B' | 'C' = cumulativo <= 80 ? 'A' : cumulativo <= 95 ? 'B' : 'C';
    const estoque = stockMap.get(p.produto.trim().toUpperCase()) ?? 0;
    return {
      produto: p.produto,
      descricao: p.descricao,
      grupo: p.grupo || null,
      receita: p.receita,
      quantidade: p.quantidade,
      estoque,
      curva,
      rank: i + 1,
      participacaoPct: Number(share.toFixed(3)),
      participacaoAcumuladaPct: Number(cumulativo.toFixed(3)),
    };
  });

  // Resumo por curva A/B/C (inclui estoque, igual à SCARF ME).
  const curvaResumo = (['A', 'B', 'C'] as const).map((c) => {
    const itens = classificados.filter((p) => p.curva === c);
    const receita = itens.reduce((s, p) => s + p.receita, 0);
    return {
      curva: c,
      skus: itens.length,
      receita,
      quantidade: itens.reduce((s, p) => s + p.quantidade, 0),
      estoque: itens.reduce((s, p) => s + p.estoque, 0),
      participacaoPct: totalReceita > 0 ? Number(((receita / totalReceita) * 100).toFixed(1)) : 0,
    };
  });

  // Estoque / rupturas / cobertura — mesma lógica da SCARF ME.
  const estoqueTotal = Array.from(stockMap.values()).reduce((s, v) => s + Math.max(0, v), 0);
  const activeStockTotal = classificados.reduce((s, p) => s + Math.max(0, p.estoque), 0);
  const rupturas = classificados.filter((p) => p.estoque <= 0 && p.quantidade > 0).length;
  const msNoPeriodo = new Date(`${fim}T00:00:00`).getTime() - new Date(`${inicio}T00:00:00`).getTime();
  const meses = Math.max(msNoPeriodo / (30.44 * 86400000), 1);
  const mediaMensalUnidades = totalQtd / meses;
  const coberturaMeses = mediaMensalUnidades > 0 ? Number((activeStockTotal / mediaMensalUnidades).toFixed(1)) : 0;

  // Ranking por grupo (NERD) — equivalente leve dos rankings de subgrupo/coleção.
  const porGrupo = new Map<string, { grupo: string; receita: number; skus: number }>();
  for (const p of classificados) {
    const g = (p.grupo ?? '').trim() || 'SEM GRUPO';
    const cur = porGrupo.get(g) ?? { grupo: g, receita: 0, skus: 0 };
    cur.receita += p.receita;
    cur.skus += 1;
    porGrupo.set(g, cur);
  }
  const rankingGrupos = [...porGrupo.values()]
    .sort((a, b) => b.receita - a.receita)
    .slice(0, 10)
    .map((g) => ({
      grupo: g.grupo,
      receita: g.receita,
      skus: g.skus,
      participacaoPct: totalReceita > 0 ? Number(((g.receita / totalReceita) * 100).toFixed(1)) : 0,
    }));

  return texto({
    empresa,
    escopo,
    avisoFilial,
    periodo: { inicio, fim },
    resumo: {
      receitaTotal: totalReceita,
      unidades: totalQtd,
      skus: classificados.length,
      estoqueTotal,
      rupturas,
      coberturaMeses,
    },
    curvaResumo,
    // "top curva ABC": os itens de maior receita (começam na curva A), cada um com sua classificação.
    topCurvaA: classificados.slice(0, limite),
    rankingGrupos,
  });
}

/**
 * Tool `curva_abc`: classificação ABC dos SKUs por participação de receita,
 * com resumo por curva e os principais itens.
 * - SCARF ME: relatório analítico completo (`fetchClaudeReport`) com rankings de
 *   subgrupo/coleção.
 * - NERD: versão leve (`curvaAbcLeve`) — mesma classificação ABC por SKU/receita,
 *   com ranking por grupo, rápida para não estourar o tempo de resposta.
 */
export function registerCurvaTools(server: McpServer) {
  server.registerTool(
    'curva_abc',
    {
      description:
        'Curva ABC de SKUs por participação de receita no período: resumo (receita, unidades, SKUs, estoque, rupturas, cobertura), ' +
        'curva A/B/C (com estoque) e os itens de maior receita (topCurvaA — curva, rank, participação, participação acumulada e estoque). ' +
        'Disponível com os MESMOS dados para NERD e SCARF ME. Use para "qual o top da curva ABC", "tabela ABC do mês". ' +
        'Filtros: filial; e (SCARF ME) coleções/subgrupos/grades. Ranking de categoria: NERD por grupo; SCARF ME por subgrupo/coleção.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema,
        fim: dataSchema,
        filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = rede.'),
        colecoes: listaOpcional('Coleções (SCARF ME).'),
        subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
        grades: listaOpcional('Grades (SCARF ME).'),
        limite: z.number().int().min(1).max(100).optional().describe('Itens no topCurvaA (padrão 20).'),
      },
    },
    async ({ empresa, inicio, fim, filial, colecoes, subgrupos, grades, limite }) => {
      // NERD: caminho leve (o relatório completo é pesado demais e não retorna a tempo).
      if (empresa !== 'scarfme') {
        return curvaAbcLeve(empresa, inicio, fim, filial ?? null, limite ?? 20);
      }

      const report = await fetchClaudeReport({
        company: empresa,
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

import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runReport } from '@/lib/reports/registry.server';
import { VENDAS_FATURAMENTO_ID } from '@/lib/reports/vendas-faturamento';
import { VENDAS_HISTORICO_ID } from '@/lib/reports/vendas-historico';
import type { ReportFilters } from '@/lib/reports/types';
import { empresaSchema, dataSchema, listaOpcional, listaOuNull, texto } from '@/lib/mcp/shared';

/**
 * Tools `relatorio_vendas_faturamento` e `relatorio_vendas_historico`: expõem, no MCP,
 * EXATAMENTE as análises do Gerador de Relatórios (página /relatorios) — chamam o mesmo
 * `runReport`, então trazem TODAS as colunas do relatório (incl. Curva, Linha, Subgrupo,
 * Tipo e Código de barra) já com a lógica validada (trocas, cancelamentos, descontos).
 *
 * São as tools para "me dá o relatório de faturamento da coleção X" e "o histórico de
 * vendas da coleção X" que o dono normalmente exporta em XLSX — agora direto no Claude.
 */

const DEFAULT_LIMIT_FATURAMENTO = 500;
const DEFAULT_LIMIT_HISTORICO = 1000;
const MAX_LIMIT = 5000;

function defaultRange(): { inicio: string; fim: string } {
  const hoje = new Date();
  const inicioMes = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  return {
    inicio: inicioMes.toISOString().slice(0, 10),
    fim: hoje.toISOString().slice(0, 10),
  };
}

/** Filtros comuns às duas análises (mesmo superconjunto da rota /api/relatorios/dados). */
function buildFilters(input: {
  empresa: string;
  inicio?: string;
  fim?: string;
  filial?: string;
  grupos?: string[];
  linhas?: string[];
  subgrupos?: string[];
  colecoes?: string[];
  grades?: string[];
  cores?: string[];
  tipos?: string[];
  produto?: string;
  busca?: string;
  limite?: number;
  limiteDefault: number;
}): ReportFilters {
  const padrao = defaultRange();
  return {
    company: input.empresa,
    filial: input.filial || null,
    start: input.inicio ?? padrao.inicio,
    end: input.fim ?? padrao.fim,
    grupos: listaOuNull(input.grupos),
    linhas: listaOuNull(input.linhas),
    subgrupos: listaOuNull(input.subgrupos),
    colecoes: listaOuNull(input.colecoes),
    grades: listaOuNull(input.grades),
    cores: listaOuNull(input.cores),
    tipos: listaOuNull(input.tipos),
    produtoId: input.produto || null,
    produtoSearchTerm: !input.produto && input.busca ? input.busca : null,
    limit: input.limite && input.limite > 0 ? Math.min(input.limite, MAX_LIMIT) : input.limiteDefault,
  };
}

// Filtros de categoria compartilhados pelo inputSchema das duas tools.
const filtrosCategoria = {
  filial: z.string().optional().describe('Valor de filial (listar_filiais). Omitir = rede inteira.'),
  colecoes: listaOpcional(
    'Coleções (SCARF ME). IMPORTANTE: use o CÓDIGO da coleção (campo `valor` de listar_categorias, ex.: "V9"), NÃO a descrição ("PANTANAL VIVO 25").'
  ),
  linhas: listaOpcional('Linhas (SCARF ME). Ex.: ["PASHMINA"].'),
  subgrupos: listaOpcional('Subgrupos (SCARF ME).'),
  grades: listaOpcional('Grades (SCARF ME).'),
  grupos: listaOpcional('Grupos (NERD). Ex.: ["CAPAS"].'),
  cores: listaOpcional('Cores por DESCRIÇÃO (ex.: ["PRETO"]), como aparecem no relatório — não o código.'),
  tipos: listaOpcional('Tipos de produto (TIPO_PRODUTO).'),
  produto: z.string().optional().describe('Código de UM produto (SKU) para ver só ele.'),
  busca: z.string().optional().describe('Trecho da DESCRIÇÃO do produto (ex.: "silhuetas"). Ignorado se `produto` for passado.'),
};

export function registerRelatoriosTools(server: McpServer) {
  server.registerTool(
    'relatorio_vendas_faturamento',
    {
      description:
        'Relatório "Vendas por faturamento" (produto × cor) — a MESMA análise do Gerador de Relatórios (/relatorios), com TODAS as colunas: ' +
        'Curva (A/B/C), Código, Cor, Descrição, Grupo, Subgrupo, Linha, Tipo, Grade, Coleção, Qtde, Faturamento, Preço médio (TICKET_MEDIO), ' +
        'Custo unit., Custo total, Markup, Margem (R$ e %), Estoque, Estoque total, Preço sugerido, Participação (% e acum.) e Código de barra. ' +
        'Usa a lógica validada da tela de Produtos (trocas, cancelamentos e descontos já tratados), ordenado por faturamento. ' +
        'É a tool para "me dá o relatório/planilha de faturamento da coleção X entre as datas Y e Z" (o export XLSX que o dono normalmente faz). ' +
        'Para faturamento POR CÓDIGO DE COLEÇÃO, passe `colecoes` com o CÓDIGO (ex.: ["V9"] para PANTANAL VIVO 25 — veja listar_categorias). ' +
        'Período livre (datas exatas); padrão = mês atual. Para um ranking mais enxuto/rápido do dia a dia, prefira `produtos_vendidos`.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional().describe('Início do período (YYYY-MM-DD). Padrão: 1º dia do mês atual.'),
        fim: dataSchema.optional().describe('Fim do período (YYYY-MM-DD), inclusivo. Padrão: hoje.'),
        ...filtrosCategoria,
        limite: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Máximo de linhas (padrão ${DEFAULT_LIMIT_FATURAMENTO}). Sinaliza \`truncado\` se o universo exceder.`),
      },
    },
    async ({ empresa, inicio, fim, filial, colecoes, linhas, subgrupos, grades, grupos, cores, tipos, produto, busca, limite }) => {
      const filters = buildFilters({
        empresa,
        inicio,
        fim,
        filial,
        colecoes,
        linhas,
        subgrupos,
        grades,
        grupos,
        cores,
        tipos,
        produto,
        busca,
        limite,
        limiteDefault: DEFAULT_LIMIT_FATURAMENTO,
      });

      const result = await runReport(VENDAS_FATURAMENTO_ID, filters, []);
      if (!result) {
        return texto({ erro: 'Análise não encontrada', analise: VENDAS_FATURAMENTO_ID });
      }

      return texto({
        empresa,
        analise: 'vendas-faturamento',
        periodo: { inicio: filters.start, fim: filters.end },
        filial: filial ?? 'TODAS',
        totalLinhas: result.total,
        truncado: result.truncated,
        linhas: result.rows,
      });
    }
  );

  server.registerTool(
    'relatorio_vendas_historico',
    {
      description:
        'Relatório "Histórico de vendas" (venda a venda, SEM agrupar) — a MESMA análise do Gerador de Relatórios (/relatorios). ' +
        'Cada linha é um item vendido em um ticket, com: Data, Ticket, Filial, Vendedor, Código, Cor, Descrição, Tamanho, Qtde, Preço unit., ' +
        'Venda Líquida (VALOR), Custo unit. histórico (o custo NA ÉPOCA da venda), Linha, Grupo, Subgrupo, Grade, Tipo, Coleção e Código de barra. ' +
        'Cobre loja/POS (com vendedor) e e-commerce (faturamento, sem vendedor). Mais recentes primeiro. ' +
        'É a tool para "me dá o histórico de vendas da coleção X entre Y e Z" (o export XLSX de histórico que o dono normalmente faz) e para ' +
        '"todas as vendas do produto P no período". Para faturamento POR CÓDIGO DE COLEÇÃO, passe `colecoes` com o CÓDIGO (ex.: ["V9"]). ' +
        'Período livre (datas exatas); padrão = mês atual. Pode retornar muitas linhas — use `limite` e/ou filtros (coleção, produto, filial) para focar.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional().describe('Início do período (YYYY-MM-DD). Padrão: 1º dia do mês atual.'),
        fim: dataSchema.optional().describe('Fim do período (YYYY-MM-DD), inclusivo. Padrão: hoje.'),
        ...filtrosCategoria,
        limite: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIMIT)
          .optional()
          .describe(`Máximo de linhas, mais recentes primeiro (padrão ${DEFAULT_LIMIT_HISTORICO}). Sinaliza \`truncado\` se exceder.`),
      },
    },
    async ({ empresa, inicio, fim, filial, colecoes, linhas, subgrupos, grades, grupos, cores, tipos, produto, busca, limite }) => {
      const filters = buildFilters({
        empresa,
        inicio,
        fim,
        filial,
        colecoes,
        linhas,
        subgrupos,
        grades,
        grupos,
        cores,
        tipos,
        produto,
        busca,
        limite,
        limiteDefault: DEFAULT_LIMIT_HISTORICO,
      });

      const result = await runReport(VENDAS_HISTORICO_ID, filters, []);
      if (!result) {
        return texto({ erro: 'Análise não encontrada', analise: VENDAS_HISTORICO_ID });
      }

      return texto({
        empresa,
        analise: 'vendas-historico',
        periodo: { inicio: filters.start, fim: filters.end },
        filial: filial ?? 'TODAS',
        totalLinhas: result.total,
        truncado: result.truncated,
        linhas: result.rows,
      });
    }
  );
}

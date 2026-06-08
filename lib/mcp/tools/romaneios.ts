import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchLogEntradas, fetchProductEntries } from '@/lib/repositories/logEntradas';
import { fetchLogSaidas, fetchDefeitos } from '@/lib/repositories/logSaidas';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { empresaSchema, dataSchema, texto } from '@/lib/mcp/shared';

/** Filial de destino que representa "defeito" em cada empresa. */
const DEFEITO_FILIAL_DESTINO: Record<string, string> = {
  nerd: 'NERD DEFEITOS',
  scarfme: 'BAZAR SCARF ME',
};

function mesAtualRange(): { inicio: string; fim: string } {
  const hoje = new Date();
  const inicio = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  return { inicio: inicio.toISOString().slice(0, 10), fim: hoje.toISOString().slice(0, 10) };
}

/**
 * fetchLogEntradas/fetchLogSaidas NÃO filtram por empresa — só por `filiais`.
 * Para que o parâmetro `empresa` realmente escope o resultado, quando o usuário
 * não informa filiais, usamos todas as filiais (módulo inventory) da empresa.
 */
async function filiaisDaEmpresa(empresa: string, explicitas?: string[]): Promise<string[]> {
  if (explicitas && explicitas.length > 0) return explicitas;
  const company = await resolveCompanyDynamic(empresa);
  return company?.filialFilters.inventory ?? [];
}

const diasSchema = z
  .number()
  .int()
  .min(1)
  .max(365)
  .optional()
  .describe('Janela em dias a partir de hoje (padrão 90). Ignorado se `busca` for um nº de romaneio.');

const limiteSchema = z
  .number()
  .int()
  .min(1)
  .max(1000)
  .optional()
  .describe('Máximo de romaneios (padrão 200).');

const buscaSchema = z
  .string()
  .optional()
  .describe('Busca por nº de romaneio, responsável ou observação. Nº de romaneio ignora a janela de dias.');

const filiaisSchema = z
  .array(z.string())
  .optional()
  .describe('Filtra por filiais (valores de listar_filiais). Omitir = todas.');

const produtoSchema = z
  .string()
  .optional()
  .describe(
    'Código de UM produto (campo `produto` das outras tools). Quando informado, ' +
      'retorna SÓ as entradas desse produto (com nº de romaneio, qtd recebida e custo), ' +
      'ignorando `busca`. Use para responder "qual o romaneio da última entrada do produto X".'
  );

/**
 * Tools `entradas` e `saidas`: listam romaneios de movimentação de estoque
 * (entrada e saída/transferência), já paginados/limitados pelos repositórios
 * de log. Cada linha é um romaneio com filiais, datas, tipo, responsável e
 * quantidades.
 */
export function registerRomaneioTools(server: McpServer) {
  server.registerTool(
    'entradas',
    {
      description:
        'Lista romaneios de ENTRADA de estoque (recebimentos) de uma empresa. ' +
        'Cada item: romaneio, filial origem/destino, datas, tipo, responsável, qtd de produtos/itens, status. ' +
        'Filtros: dias (janela), filiais, busca (nº de romaneio). Resultado limitado por `limite`. ' +
        'Para as entradas de UM produto específico (achar o nº do romaneio, qtd recebida e custo da última entrada), ' +
        'passe `produto` — aí cada item é uma entrada DAQUELE produto.',
      inputSchema: {
        empresa: empresaSchema,
        dias: diasSchema,
        limite: limiteSchema,
        busca: buscaSchema,
        filiais: filiaisSchema,
        produto: produtoSchema,
      },
    },
    async ({ empresa, dias, limite, busca, filiais, produto }) => {
      const escopo = await filiaisDaEmpresa(empresa, filiais);

      if (produto && produto.trim()) {
        // Entradas de UM produto: nº de romaneio, qtd recebida e custo, das duas
        // fontes (ESTOQUE_PROD_ENT + LOJA_ENTRADAS). Sem janela de dias por padrão
        // para sempre achar a última entrada, mesmo de itens de giro lento.
        const rows = await fetchProductEntries(produto.trim(), limite ?? 50, escopo, dias);
        return texto({
          empresa,
          tipo: 'entradas',
          produto: produto.trim(),
          dias: dias ?? 'todas',
          total: rows.length,
          entradas: rows,
        });
      }

      const rows = await fetchLogEntradas(limite ?? 200, dias ?? 90, busca ?? '', escopo);
      return texto({ empresa, tipo: 'entradas', dias: dias ?? 90, total: rows.length, romaneios: rows });
    }
  );

  server.registerTool(
    'saidas',
    {
      description:
        'Lista romaneios de SAÍDA/transferência de estoque de uma empresa (inclui origem→destino). ' +
        'Cada item: romaneio, filial origem/destino (e códigos), datas, tipo, responsável, qtd de produtos/itens, status. ' +
        'Filtros: dias (janela), filiais (origem), busca (nº de romaneio). Resultado limitado por `limite`.',
      inputSchema: {
        empresa: empresaSchema,
        dias: diasSchema,
        limite: limiteSchema,
        busca: buscaSchema,
        filiais: filiaisSchema,
      },
    },
    async ({ empresa, dias, limite, busca, filiais }) => {
      const escopo = await filiaisDaEmpresa(empresa, filiais);
      const rows = await fetchLogSaidas(limite ?? 200, dias ?? 90, busca ?? '', escopo);
      return texto({ empresa, tipo: 'saidas', dias: dias ?? 90, total: rows.length, romaneios: rows });
    }
  );

  server.registerTool(
    'defeitos',
    {
      description:
        'Itens enviados para DEFEITO no período (romaneios de SAÍDA com tipo "DEFEITO" ou destino à filial de defeito — ' +
        'NERD DEFEITOS / BAZAR SCARF ME). Devolve os TOTAIS (quantidade e VALOR sugerido) + a lista POR PRODUTO×COR: ' +
        'produto, descrição, cor, quantidade, preço sugerido (cadastro) e valor sugerido (qtd × preço). ' +
        'Responde "quantos produtos foram pra defeito esse mês, quais, quanto em qtd e valor". ' +
        'Filtros: `filial` (loja de ORIGEM), `responsavel` (quem registrou o romaneio), `produto`/`busca` (descrição). ' +
        'Padrão: mês atual. Ordenado por quantidade. Para somar cores num item só, porCor=false.',
      inputSchema: {
        empresa: empresaSchema,
        inicio: dataSchema.optional().describe('Início (YYYY-MM-DD). Padrão: 1º dia do mês atual.'),
        fim: dataSchema.optional().describe('Fim (YYYY-MM-DD). Padrão: hoje.'),
        filial: z.string().optional().describe('Loja de ORIGEM (listar_filiais). Omitir = todas da empresa.'),
        responsavel: z.string().optional().describe('Quem registrou o romaneio de defeito (busca parcial).'),
        produto: z.string().optional().describe('Código de UM produto (SKU) para ver só ele.'),
        busca: z.string().optional().describe('Trecho da DESCRIÇÃO do produto.'),
        porCor: z.boolean().optional().describe('Quebrar por cor (padrão true → uma linha por produto×cor).'),
        limite: z.number().int().min(1).max(1000).optional().describe('Qtde de itens na lista (padrão 200). Totais não são limitados.'),
      },
    },
    async ({ empresa, inicio, fim, filial, responsavel, produto, busca, porCor, limite }) => {
      const destino = DEFEITO_FILIAL_DESTINO[empresa];
      if (!destino) {
        return texto({ empresa, erro: `Empresa "${empresa}" não tem filial de defeito mapeada.` });
      }

      const company = await resolveCompanyDynamic(empresa);
      const escopo = company?.filialFilters.inventory ?? [];

      const padrao = mesAtualRange();
      const start = new Date(`${inicio ?? padrao.inicio}T00:00:00`);
      // Fim inclusivo: vai até o fim do dia informado.
      const fimDia = fim ?? padrao.fim;
      const end = new Date(`${fimDia}T23:59:59`);

      const resultado = await fetchDefeitos({
        filiaisOrigem: escopo,
        defeitoFilialDestino: destino,
        range: { start, end },
        filialOrigem: filial?.trim() || null,
        responsavel: responsavel?.trim() || undefined,
        produtoId: produto?.trim() || undefined,
        produtoSearchTerm: !produto && busca ? busca : undefined,
        porCor: porCor !== false,
        limit: limite ?? 200,
      });

      return texto({
        empresa,
        periodo: { inicio: inicio ?? padrao.inicio, fim: fimDia },
        destinoDefeito: destino,
        filialOrigem: filial?.trim() || 'TODAS',
        responsavel: responsavel?.trim() || 'TODOS',
        porCor: porCor !== false,
        totais: {
          quantidade: resultado.totalQuantidade,
          valorSugerido: resultado.totalValor,
          itensDistintos: resultado.totalItens,
          itensListados: resultado.itensListados,
        },
        produtos: resultado.itens,
      });
    }
  );
}

import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { fetchLogEntradas, fetchProductEntries } from '@/lib/repositories/logEntradas';
import { fetchLogSaidas } from '@/lib/repositories/logSaidas';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { empresaSchema, texto } from '@/lib/mcp/shared';

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
}

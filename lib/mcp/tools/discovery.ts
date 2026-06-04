import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { getFilialLabelForDisplay } from '@/lib/config/company';

const EMPRESAS = [
  { key: 'nerd', nome: 'NERD' },
  { key: 'scarfme', nome: 'SCARF ME' },
] as const;

const empresaSchema = z
  .enum(['nerd', 'scarfme'])
  .describe('Chave da empresa. Use listar_empresas para ver as opções.');

function texto(payload: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }] };
}

/**
 * Tools de descoberta: dão ao Claude o vocabulário (empresas, filiais, grupos)
 * antes de ele montar os filtros das tools de dados. O `valor` retornado em
 * `listar_filiais` é exatamente o que deve ser passado no parâmetro `filial`
 * das demais tools.
 */
export function registerDiscoveryTools(server: McpServer) {
  server.registerTool(
    'listar_empresas',
    {
      description:
        'Lista as empresas disponíveis no dashboard (NERD e SCARF ME). Retorna a chave usada como parâmetro `empresa` nas demais tools.',
      inputSchema: {},
    },
    async () => texto({ empresas: EMPRESAS })
  );

  server.registerTool(
    'listar_filiais',
    {
      description:
        'Lista as filiais de uma empresa, com o nome de exibição, se é e-commerce, e o grupo lógico. ' +
        'O campo `valor` é o que deve ser passado no parâmetro `filial` das tools de dados (ex.: vendas). ' +
        'Omitir `filial` nessas tools = todas as filiais.',
      inputSchema: { empresa: empresaSchema },
    },
    async ({ empresa }) => {
      const company = await resolveCompanyDynamic(empresa);
      if (!company) {
        return texto({ erro: `Empresa não encontrada: ${empresa}` });
      }

      const ecommerce = new Set(company.ecommerceFilials ?? []);
      const seen = new Set<string>();
      const filiais = (company.filialFilters.sales ?? [])
        .filter((valor) => {
          if (seen.has(valor)) return false;
          seen.add(valor);
          return true;
        })
        .map((valor) => ({
          valor,
          nome: getFilialLabelForDisplay(company, valor),
          ecommerce: ecommerce.has(valor),
        }));

      const grupos = Object.entries(company.filialGroups ?? {}).map(
        ([canonica, membros]) => ({
          canonica,
          nome: getFilialLabelForDisplay(company, canonica),
          membros,
        })
      );

      return texto({ empresa: company.key, filiais, grupos });
    }
  );
}

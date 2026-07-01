import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  fetchNotasFiscais,
  fetchNotaFiscalDetalhe,
  fetchFaturamentoResumo,
  fetchFaturamentoDimensoes,
  type FaturamentoFiltro,
} from '@/lib/repositories/faturamento';
import { dataSchema, texto } from '@/lib/mcp/shared';

const empresaFiscalSchema = z
  .enum(['nerd', 'scarfme'])
  .optional()
  .describe(
    'Filtra pela empresa fiscal: "scarfme" = MATRIZ + MSC (EMPRESA 1/10/13/15), "nerd" = EMPRESA 8. ' +
      'Omitir = TODAS as empresas (sem distinção de filial — recomendado p/ ver todo o faturamento).',
  );

const listaOpc = (d: string) => z.array(z.string()).optional().describe(d);
const listaOuNull = (v?: string[] | null) => (v && v.length > 0 ? v : null);

function filtroFrom(input: {
  empresa?: 'nerd' | 'scarfme';
  filial?: string;
  naturezas?: string[];
  cliente?: string;
  nf?: string;
  produto?: string;
  inicio?: string;
  fim?: string;
  incluirCanceladas?: boolean;
  incluirDevolucoes?: boolean;
}): FaturamentoFiltro {
  return {
    empresa: input.empresa ?? null,
    filial: input.filial ?? null,
    naturezas: listaOuNull(input.naturezas),
    cliente: input.cliente ?? null,
    nfNumero: input.nf ?? null,
    produto: input.produto ?? null,
    range: input.inicio && input.fim ? { start: input.inicio, end: input.fim } : undefined,
    incluirCanceladas: input.incluirCanceladas ?? false,
    incluirDevolucoes: input.incluirDevolucoes ?? true,
  };
}

/**
 * Módulo FISCAL para o MCP: NFs / faturamento (tabela FATURAMENTO + itens), que é
 * onde aparece o faturamento da MATRIZ ScarfMe (corporativo / private / revenda) —
 * vendas que NÃO passam por LOJA_VENDA e portanto não estão nas tools de `vendas`.
 *
 * - notas_fiscais     → lista as NFs emitidas num período (com filtros) + totais.
 * - nota_fiscal       → detalhe de UMA NF (cabeçalho + itens).
 * - faturamento_resumo→ agregados (por natureza, filial, mês, cliente).
 * - listar_naturezas  → dimensões (filiais fiscais + naturezas de operação).
 */
export function registerFaturamentoTools(server: McpServer) {
  server.registerTool(
    'notas_fiscais',
    {
      description:
        'Lista as NOTAS FISCAIS (NFs) de saída / FATURAMENTO fiscal emitidas num período — ' +
        'inclui o faturamento da MATRIZ ScarfMe (vendas corporativas/private/revenda) que NÃO aparece nas tools de `vendas`. ' +
        'Cada NF traz: número (NF_SAIDA), série, filial fiscal, cliente (NOME_CLIFOR), natureza de operação (código + descrição), ' +
        'emissão, valor total, quantidade, desconto, ICMS/IPI, chave NFe, status, transportadora, representante. ' +
        'Retorna também os TOTAIS (nº de NFs, valor, qtde) de tudo que casa o filtro. ' +
        'Filtros: `empresa` (omitir = todas), `filial` (nome fiscal exato — veja listar_naturezas), `naturezas` (códigos), ' +
        '`cliente` (trecho do nome), `nf` (número), `produto` (código/descrição — NFs que contêm o produto), ' +
        '`incluirCanceladas` (padrão false), `incluirDevolucoes` (padrão true). Período por EMISSÃO; padrão = mês corrente. ' +
        'Responde "quais NFs foram emitidas no mês", "faturamento da matriz", "notas para o cliente X".',
      inputSchema: {
        empresa: empresaFiscalSchema,
        inicio: dataSchema.optional().describe('Início (EMISSÃO). Padrão: 1º dia do mês corrente.'),
        fim: dataSchema.optional().describe('Fim (EMISSÃO). Padrão: hoje.'),
        filial: z.string().optional().describe('Nome exato da filial fiscal (ex.: "SCARF ME - MATRIZ"). Veja listar_naturezas.'),
        naturezas: listaOpc('Códigos de natureza de operação (ex.: ["100.02","100.08"]).'),
        cliente: z.string().optional().describe('Trecho do nome do cliente (NOME_CLIFOR).'),
        nf: z.string().optional().describe('Número da NF (NF_SAIDA), com ou sem zeros à esquerda.'),
        produto: z.string().optional().describe('Código ou trecho da descrição do produto — filtra NFs que o contêm.'),
        incluirCanceladas: z.boolean().optional().describe('Inclui NFs canceladas. Padrão: false.'),
        incluirDevolucoes: z.boolean().optional().describe('Inclui devoluções. Padrão: true.'),
      },
    },
    async (input) => {
      const { notas, totais, truncado } = await fetchNotasFiscais(filtroFrom(input));
      return texto({
        empresa: input.empresa ?? 'TODAS',
        filial: input.filial ?? 'TODAS',
        periodo: input.inicio && input.fim ? { inicio: input.inicio, fim: input.fim } : 'mês corrente',
        totais,
        truncado,
        quantidadeRetornada: notas.length,
        notas: notas.map((n) => ({
          nf: n.nfSaida,
          serie: n.serie,
          filial: n.filial,
          cliente: n.cliente,
          natureza: n.natureza,
          descNatureza: n.descNatureza,
          emissao: n.emissao ? n.emissao.slice(0, 10) : null,
          valorTotal: n.valorTotal,
          qtde: n.qtdeTotal,
          desconto: n.desconto,
          tipoFaturamento: n.tipoFaturamento,
          cancelada: n.cancelada,
          devolucao: n.devolucao,
          chaveNfe: n.chaveNfe,
          representante: n.representante,
        })),
      });
    },
  );

  server.registerTool(
    'nota_fiscal',
    {
      description:
        'Detalhe de UMA nota fiscal (NF): cabeçalho completo (cliente, natureza, emissão, valor, impostos, chave NFe, ' +
        'transportadora, representante, condição de pagamento) + TODOS os itens (produto, cor, grade, coleção, qtde, ' +
        'preço, desconto, valor, valor líquido, custo). Informe o número `nf` (NF_SAIDA); para desambiguar, passe também ' +
        '`serie` e/ou `filial`. Use depois de `notas_fiscais` para abrir uma NF específica.',
      inputSchema: {
        nf: z.string().describe('Número da NF (NF_SAIDA), com ou sem zeros à esquerda.'),
        serie: z.string().optional().describe('Série da NF (SERIE_NF), para desambiguar.'),
        filial: z.string().optional().describe('Filial fiscal, para desambiguar quando o número se repete entre filiais.'),
      },
    },
    async ({ nf, serie, filial }) => {
      const { header, itens } = await fetchNotaFiscalDetalhe({ nfSaida: nf, serie, filial });
      if (!header) {
        return texto({ erro: `NF ${nf} não encontrada${filial ? ` na filial ${filial}` : ''}.`, nf });
      }
      return texto({
        nf: header.nfSaida,
        serie: header.serie,
        filial: header.filial,
        cliente: header.cliente,
        natureza: { codigo: header.natureza, descricao: header.descNatureza },
        emissao: header.emissao ? header.emissao.slice(0, 10) : null,
        dataSaida: header.dataSaida ? header.dataSaida.slice(0, 10) : null,
        valorTotal: header.valorTotal,
        qtdeTotal: header.qtdeTotal,
        desconto: header.desconto,
        impostos: { icms: header.icms, ipi: header.ipi, frete: header.frete },
        tipoFaturamento: header.tipoFaturamento,
        cancelada: header.cancelada,
        devolucao: header.devolucao,
        chaveNfe: header.chaveNfe,
        statusNfe: header.statusNfe,
        condicaoPgto: header.condicaoPgto,
        transportadora: header.transportadora,
        representante: header.representante,
        gerente: header.gerente,
        moeda: header.moeda,
        totalItens: itens.length,
        itens: itens.map((i) => ({
          item: i.item,
          produto: i.produto,
          descricao: i.descProduto,
          cor: i.descCorProduto || i.corProduto,
          grade: i.grade,
          colecao: i.descColecao || i.colecao,
          grupo: i.grupo,
          linha: i.linha,
          qtde: i.qtde,
          preco: i.preco,
          desconto: i.descontoItem,
          valor: i.valor,
          valorLiquido: i.valorLiquido,
          custo: i.custoNaData,
          uf: i.uf,
        })),
      });
    },
  );

  server.registerTool(
    'faturamento_resumo',
    {
      description:
        'Resumo AGREGADO do faturamento fiscal (NFs) num período: total de NFs, valor e quantidade, mais as quebras ' +
        'por natureza de operação, por filial fiscal, por mês e por cliente (top 50). Ideal para "quanto a matriz ScarfMe ' +
        'faturou no mês", "faturamento por natureza", "quais clientes mais compraram da matriz". Mesmos filtros de `notas_fiscais`. ' +
        'Período por EMISSÃO; padrão = mês corrente.',
      inputSchema: {
        empresa: empresaFiscalSchema,
        inicio: dataSchema.optional(),
        fim: dataSchema.optional(),
        filial: z.string().optional().describe('Nome exato da filial fiscal.'),
        naturezas: listaOpc('Códigos de natureza de operação.'),
        cliente: z.string().optional().describe('Trecho do nome do cliente.'),
        produto: z.string().optional().describe('Código/trecho da descrição do produto.'),
        incluirCanceladas: z.boolean().optional(),
        incluirDevolucoes: z.boolean().optional(),
      },
    },
    async (input) => {
      const resumo = await fetchFaturamentoResumo(filtroFrom(input));
      return texto({
        empresa: input.empresa ?? 'TODAS',
        filial: input.filial ?? 'TODAS',
        periodo: input.inicio && input.fim ? { inicio: input.inicio, fim: input.fim } : 'mês corrente',
        ...resumo,
      });
    },
  );

  server.registerTool(
    'listar_naturezas',
    {
      description:
        'Dimensões do módulo fiscal para montar filtros: (a) `filiais` fiscais que emitiram NF nos últimos 12 meses ' +
        '(nome exato p/ o parâmetro `filial`, com a EMPRESA e o volume de NFs), e (b) `naturezas` de operação de saída ativas ' +
        '(código + descrição, p/ o parâmetro `naturezas`). Use antes de `notas_fiscais`/`faturamento_resumo`.',
      inputSchema: {},
    },
    async () => {
      const dim = await fetchFaturamentoDimensoes();
      return texto(dim);
    },
  );
}

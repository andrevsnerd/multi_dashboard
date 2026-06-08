import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
  fetchProductDetail,
  fetchProductStockByFilial,
  fetchProductSaleHistory,
  fetchProductAvailableColors,
  type ProductAvailableColor,
} from '@/lib/repositories/productDetail';
import { fetchProductEntries } from '@/lib/repositories/logEntradas';
import { resolveCompanyDynamic } from '@/lib/config/company-server';
import { empresaSchema, dataSchema, texto } from '@/lib/mcp/shared';

/**
 * Resolve a cor pedida (código "06" OU descrição "PRETO") para o(s) código(s)
 * COR_PRODUTO reais do produto, usando a lista de cores disponíveis. Tolera
 * zeros à esquerda ("06" vs "6") e casa por descrição/displayName.
 */
function resolveCores(input: string, available: ProductAvailableColor[]): ProductAvailableColor[] {
  const norm = (s: string | null | undefined) => String(s ?? '').trim().toUpperCase();
  const stripZeros = (s: string) => s.replace(/^0+(?=\d)/, '');
  const alvo = norm(input);
  if (!alvo) return [];
  return available.filter((c) => {
    const code = norm(c.code);
    const desc = norm(c.description);
    const disp = norm(c.displayName);
    return (
      code === alvo ||
      stripZeros(code) === stripZeros(alvo) ||
      desc === alvo ||
      disp === alvo ||
      (alvo.length >= 3 && (desc.includes(alvo) || disp.includes(alvo)))
    );
  });
}

/**
 * Tool `produto`: ficha 360 de um produto específico (por código). Combina:
 * - fetchProductDetail        → totais, custo/preço, última ENTRADA (quando entrou)
 * - fetchProductStockByFilial → estoque por filial (ONDE o produto está, incl. matriz)
 * - fetchProductSaleHistory   → última VENDA + vendas recentes por dia
 *
 * Aceita `cor` (código "06" ou descrição "PRETO") para restringir estoque/vendas
 * a UMA cor — útil quando o produto veio de um ranking por cor (top_produtos/curva_abc
 * com porCor). Sempre devolve `coresDisponiveis` para o Claude saber as variações.
 */
export function registerProdutoTools(server: McpServer) {
  server.registerTool(
    'produto',
    {
      description:
        'Ficha completa de UM produto (por código): descrição, estoque total e por filial (onde está, INCLUINDO a matriz/depósito), ' +
        'última venda (COM o vendedor responsável e o DESCONTO concedido), última entrada (quando/onde entrou, COM nº de romaneio, qtd recebida e custo) e as últimas entradas, ' +
        'receita/quantidade/DESCONTO total no período, vendas POR FILIAL (ONDE vendeu — quantidade e receita em cada filial no período), ' +
        'top VENDEDORES (QUEM mais vendeu este produto — qtd/receita E desconto por vendedor), custo e preço médios. ' +
        'Responde "onde vendeu essas N unidades"/"onde vendeu nos últimos X meses" (vendas.porFilial), ' +
        '"qual vendedor fez a última venda" (vendas.ultimaVenda.vendedor), "quem mais vendeu este item" (vendas.topVendedores), ' +
        '"quanto de desconto este produto deu" (vendas.descontoPeriodo) e "quem deu mais desconto neste produto" (vendas.topVendedores[].desconto) — use inicio/fim para o range. ' +
        'Use o código `produto` retornado por top_produtos/sem_estoque/curva_abc/produtos_vendidos. ' +
        'Para uma COR específica (ex.: o item veio de um ranking POR COR), passe `cor` (código "06" ou descrição "PRETO"): ' +
        'aí estoque por filial e vendas vêm SÓ daquela cor. Sem `cor`, soma todas as cores. ' +
        'Por padrão olha os últimos 24 meses (para achar a última venda mesmo de itens lentos). ' +
        'Para saber se vendeu num dia específico (ex.: ontem) e quanto, passe inicio=fim nesse dia.',
      inputSchema: {
        empresa: empresaSchema,
        produto: z.string().describe('Código do produto (campo `produto` das outras tools).'),
        cor: z
          .string()
          .optional()
          .describe('Cor específica: código (ex.: "06") ou descrição (ex.: "PRETO"). Omitir = todas as cores somadas.'),
        filial: z.string().optional().describe('Restringe a uma filial (listar_filiais). Omitir = todas (incl. matriz).'),
        inicio: dataSchema.optional().describe('Início da janela de vendas (padrão: 24 meses atrás).'),
        fim: dataSchema.optional().describe('Fim da janela (padrão: hoje).'),
      },
    },
    async ({ empresa, produto, cor, filial, inicio, fim }) => {
      const hoje = new Date();
      const defaultStart = new Date(hoje);
      defaultStart.setMonth(defaultStart.getMonth() - 24);
      const range = {
        start: inicio ?? defaultStart.toISOString().slice(0, 10),
        end: fim ?? hoje.toISOString().slice(0, 10),
      };

      // Lista de cores do produto (sempre devolvida) + resolução do filtro de cor.
      const coresDisponiveis = await fetchProductAvailableColors(produto, empresa);
      let coresFiltro: string[] | undefined;
      let corResolvida: { codigo: string; descricao: string } | null = null;
      let avisoCor: string | undefined;

      if (cor) {
        const match = resolveCores(cor, coresDisponiveis);
        if (match.length === 0) {
          avisoCor = `Cor "${cor}" não encontrada para este produto. Veja coresDisponiveis e tente o código ou a descrição exata.`;
        } else {
          coresFiltro = match.map((m) => m.code);
          corResolvida = { codigo: match[0].code, descricao: match[0].displayName || match[0].description };
        }
      }

      const params = {
        productId: produto,
        company: empresa,
        range,
        filial: filial ?? null,
        ...(coresFiltro ? { colors: coresFiltro } : {}),
      };

      // Escopo de filiais da empresa (módulo inventory) para listar as entradas
      // do produto sem vazar entre empresas. Independe do filtro `filial` (que é
      // sobre estoque/vendas) — a última entrada é vista na empresa toda.
      const company = await resolveCompanyDynamic(empresa);
      const escopoEntradas = company?.filialFilters.inventory ?? [];

      const [detail, porFilial, historico, entradas] = await Promise.all([
        fetchProductDetail(params),
        fetchProductStockByFilial(params),
        fetchProductSaleHistory(params),
        fetchProductEntries(produto, 5, escopoEntradas),
      ]);

      const ultimaVenda = historico.length > 0 ? historico[0] : null;
      const ultimaEntrada = entradas.length > 0 ? entradas[0] : null;

      // Top vendedores DESTE produto no período: agrega o histórico (que já vem
      // com o vendedor resolvido para apelido/nome) por vendedor. Reusa a mesma
      // base de fetchProductSaleHistory — sem query nova. Vendas de e-commerce
      // vêm sem vendedor (null) e ficam fora do ranking.
      const vendedoresMap = new Map<string, { quantidade: number; receita: number; desconto: number }>();
      for (const h of historico) {
        const nome = (h.vendedor ?? '').trim();
        if (!nome) continue;
        const acc = vendedoresMap.get(nome) ?? { quantidade: 0, receita: 0, desconto: 0 };
        acc.quantidade += h.quantity ?? 0;
        acc.receita += h.revenue ?? 0;
        acc.desconto += h.desconto ?? 0;
        vendedoresMap.set(nome, acc);
      }
      const topVendedores = [...vendedoresMap.entries()]
        .map(([vendedor, v]) => ({
          vendedor,
          quantidade: v.quantidade,
          receita: v.receita,
          desconto: v.desconto,
        }))
        .filter((v) => v.quantidade > 0)
        .sort((a, b) => b.quantidade - a.quantidade);

      // Desconto total concedido neste produto no período (R$). Para "quem deu mais
      // desconto", o ranking acima já traz desconto por vendedor.
      const descontoPeriodo = historico.reduce((s, h) => s + (h.desconto ?? 0), 0);

      return texto({
        empresa,
        produto: detail.productId,
        descricao: detail.productName,
        grade: detail.grade ?? null,
        cor: corResolvida,
        avisoCor,
        coresDisponiveis: coresDisponiveis.map((c) => ({ codigo: c.code, cor: c.displayName || c.description })),
        periodoAnalisado: range,
        estoque: {
          total: detail.totalStock,
          porFilial: porFilial
            .filter((f) => f.stock !== 0 || f.quantity !== 0)
            .map((f) => ({
              filial: f.filialDisplayName,
              estoque: f.stock,
              vendasPeriodo: f.quantity,
              receitaPeriodo: f.revenue,
            })),
        },
        vendas: {
          receitaPeriodo: detail.totalRevenue,
          quantidadePeriodo: detail.totalQuantity,
          descontoPeriodo,
          variacaoReceitaPct: detail.revenueVariance,
          // ONDE vendeu: distribuição da quantidade/receita por filial no período
          // (respeita inicio/fim e o filtro de cor). Responde "onde vendeu essas N
          // unidades" e "onde vendeu nos últimos X meses". Só filiais com venda > 0,
          // da que mais vendeu para a que menos vendeu.
          porFilial: porFilial
            .filter((f) => (f.quantity ?? 0) > 0)
            .sort((a, b) => (b.quantity ?? 0) - (a.quantity ?? 0))
            .map((f) => ({
              filial: f.filialDisplayName,
              quantidade: f.quantity,
              receita: f.revenue,
            })),
          ultimaVenda: ultimaVenda
            ? {
                data: ultimaVenda.date instanceof Date ? ultimaVenda.date.toISOString().slice(0, 10) : ultimaVenda.date,
                filial: ultimaVenda.filialDisplayName,
                quantidade: ultimaVenda.quantity,
                // Vendedor responsável (apelido/nome). null em venda de e-commerce.
                vendedor: ultimaVenda.vendedor ?? null,
                // Desconto concedido nessa venda (R$). 0 no e-commerce.
                desconto: ultimaVenda.desconto ?? 0,
              }
            : null,
          // QUEM mais vendeu este produto no período (qtd/receita por vendedor),
          // do que mais vendeu para o que menos vendeu. E-commerce não tem vendedor,
          // então essas vendas não aparecem aqui.
          topVendedores,
        },
        entrada: {
          // Última entrada com nº de romaneio, filial, qtd recebida e custo —
          // das duas fontes (ESTOQUE_PROD_ENT + LOJA_ENTRADAS). Cai para a data/
          // filial do detalhe quando não há linha de entrada detalhada.
          ultimaEntrada: ultimaEntrada
            ? {
                data: ultimaEntrada.dataEmissao
                  ? ultimaEntrada.dataEmissao.slice(0, 10)
                  : null,
                romaneio: ultimaEntrada.romaneio,
                filial: ultimaEntrada.filialDestino,
                filialOrigem: ultimaEntrada.filialOrigem || null,
                quantidade: ultimaEntrada.qtde,
                custoUnitario: ultimaEntrada.custoUnitario,
                tipo: ultimaEntrada.tipoRomaneio || null,
                responsavel: ultimaEntrada.responsavel || null,
              }
            : detail.lastEntryDate
              ? {
                  data: detail.lastEntryDate.toISOString().slice(0, 10),
                  romaneio: null,
                  filial: detail.lastEntryFilial,
                  filialOrigem: null,
                  quantidade: null,
                  custoUnitario: null,
                  tipo: null,
                  responsavel: null,
                }
              : null,
          ultimasEntradas: entradas.map((e) => ({
            data: e.dataEmissao ? e.dataEmissao.slice(0, 10) : null,
            romaneio: e.romaneio,
            filial: e.filialDestino,
            filialOrigem: e.filialOrigem || null,
            quantidade: e.qtde,
            custoUnitario: e.custoUnitario,
            tipo: e.tipoRomaneio || null,
          })),
        },
        custos: {
          custoMedio: detail.averageCost,
          precoMedio: detail.averagePrice,
          custoCadastrado: detail.registeredCost,
          precoCadastrado: detail.registeredPrice,
        },
      });
    }
  );
}

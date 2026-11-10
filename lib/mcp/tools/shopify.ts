import 'server-only';

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { dataSchema, texto } from '@/lib/mcp/shared';
import { getShopifyCredentials, type ShopifyCompany } from '@/lib/shopify/config';
import {
  buscarPedidoShopify,
  listarPedidosShopify,
  produtosVendidosShopify,
  rankingClientesShopify,
} from '@/lib/shopify/consultas';
import { fetchShopifyResumo, todayBrt } from '@/lib/shopify/dashboard';
import { runShopifyIncrementalSync } from '@/lib/shopify/sync';

/**
 * Visão SHOPIFY (loja online) no MCP — "Shopify Scarf Me" e "Shopify NERD". Mesmos dados e
 * regras da página /[company]/shopify: pedidos do site em tempo real (espelho no Neon,
 * webhook + varredura), venda sem frete com o frete sempre separado, dia = São Paulo.
 * É a visão operacional do site: NÃO somar com o faturamento do Linx (os mesmos pedidos
 * viram NF no Linx depois).
 */

const NOME: Record<ShopifyCompany, string> = { scarfme: 'Shopify Scarf Me', nerd: 'Shopify NERD' };

const empresaShopify = z
  .enum(['nerd', 'scarfme'])
  .describe('Loja Shopify: "scarfme" = Shopify Scarf Me (scarfme.com.br), "nerd" = Shopify NERD (nerdnerd.com.br).');

const inicioSchema = dataSchema.optional().describe('Início (dia do PEDIDO, horário de São Paulo). Padrão: hoje.');
const fimSchema = dataSchema.optional().describe('Fim, inclusivo. Padrão: igual ao início.');

const AVISO =
  'Fonte: Shopify (site), em tempo real. Venda = itens com desconto, SEM frete; frete à parte. ' +
  'Não somar com o faturamento do Linx (os mesmos pedidos viram NF no Linx depois).';

function periodo(inicio?: string, fim?: string) {
  const i = inicio ?? todayBrt();
  return { inicio: i, fim: fim ?? i };
}

/** Puxa do Shopify o que mudou (no máx. 1×/30 s) antes de ler — igual à página. */
async function atualizar(company: ShopifyCompany) {
  try {
    await runShopifyIncrementalSync(company, { budgetMs: 8_000, minIntervalSeconds: 30 });
  } catch {
    /* lê o espelho mesmo assim */
  }
}

function semShopify(company: ShopifyCompany) {
  return getShopifyCredentials(company) ? null : texto({ erro: `${NOME[company]} não está configurado.` });
}

export function registerShopifyTools(server: McpServer) {
  server.registerTool(
    'shopify_resumo',
    {
      description:
        'Resumo de vendas da LOJA ONLINE (Shopify) — "Shopify Scarf Me" ou "Shopify NERD" — num período, em tempo real. ' +
        'Traz: venda líquida (sem frete), frete, venda + frete (= "Vendas totais" do painel do Shopify), pedidos pagos, ticket médio, ' +
        'peças, clientes, descontos, devoluções (no dia do reembolso), pendentes (Pix/boleto aguardando), cancelados; ' +
        'comparação com o período anterior (hoje × ontem até a mesma hora); venda por hora (1 dia) ou por dia; ' +
        'venda por estado e por forma de pagamento; 20 mais vendidos (na visão do Linx quando vinculados). ' +
        'Use para "quanto vendeu o site hoje", "vendas do e-commerce na semana", "ticket médio do site". ' +
        AVISO,
      inputSchema: { empresa: empresaShopify, inicio: inicioSchema, fim: fimSchema },
    },
    async ({ empresa, inicio, fim }) => {
      const erro = semShopify(empresa);
      if (erro) return erro;
      await atualizar(empresa);
      const p = periodo(inicio, fim);
      const r = await fetchShopifyResumo(empresa, p.inicio, p.fim);
      const k = r.kpis;
      const kp = r.kpisAnterior;
      return texto({
        loja: NOME[empresa],
        periodo: r.periodo,
        comparadoCom: r.anterior,
        kpis: {
          vendaLiquida: k.venda,
          frete: k.freteLiquido,
          vendaComFrete: k.venda + k.freteLiquido,
          pedidosPagos: k.pedidos,
          ticketMedio: k.ticketMedio,
          ticketMedioComFrete: k.pedidos > 0 ? (k.venda + k.freteLiquido) / k.pedidos : 0,
          pecas: k.itens,
          clientes: k.clientes,
          descontos: k.descontos,
          devolucoes: k.devolucoes,
          pendentes: { pedidos: k.pendentesQtd, valor: k.pendentesValor },
          cancelados: { pedidos: k.canceladosQtd, valor: k.canceladosValor },
        },
        periodoAnterior: {
          vendaLiquida: kp.venda,
          frete: kp.freteLiquido,
          pedidosPagos: kp.pedidos,
          ticketMedio: kp.ticketMedio,
          pecas: kp.itens,
        },
        serie: r.serie.map((s) => ({ quando: s.key, venda: s.venda, frete: s.frete, pedidos: s.pedidos, vendaAnterior: s.vendaAnterior })),
        porEstado: r.estados,
        porPagamento: r.pagamentos,
        maisVendidos: r.topProdutos.map((t) =>
          t.linx
            ? { linx: t.linx, nomeShopify: t.titulo, pecas: t.qtde, venda: t.venda, frete: t.frete }
            : { linx: null, nomeShopify: t.titulo, skus: t.skus, pecas: t.qtde, venda: t.venda, frete: t.frete },
        ),
        sincronizado: r.sync.ultimaExecucao,
        aviso: AVISO,
      });
    },
  );

  server.registerTool(
    'shopify_pedidos',
    {
      description:
        'Lista os PEDIDOS da loja online (Shopify Scarf Me / Shopify NERD) num período, mais recentes primeiro, ' +
        'com totais do filtro. Cada pedido: número (#65997), data/hora, status (pago, pendente, reembolsado, CANCELADO), envio, ' +
        'venda, desconto, frete, reembolsado, total, peças, cliente (nome, e-mail, cidade/UF), forma de pagamento e canal. ' +
        'Filtros: `status` (pagos | pendentes | cancelados | todos — padrão todos), `busca` (nº do pedido, cliente, e-mail, produto ou SKU), ' +
        '`uf` (estado de entrega), `limite` (padrão 100, máx. 500). ' + AVISO,
      inputSchema: {
        empresa: empresaShopify,
        inicio: inicioSchema,
        fim: fimSchema,
        status: z.enum(['pagos', 'pendentes', 'cancelados', 'todos']).optional().describe('Padrão: todos.'),
        busca: z.string().optional().describe('Trecho do nº do pedido, nome/e-mail do cliente, nome do produto ou SKU.'),
        uf: z.string().optional().describe('UF de entrega, ex.: "SP".'),
        limite: z.number().int().optional().describe('Máximo de pedidos (padrão 100, máx. 500).'),
      },
    },
    async ({ empresa, inicio, fim, status, busca, uf, limite }) => {
      const erro = semShopify(empresa);
      if (erro) return erro;
      await atualizar(empresa);
      const p = periodo(inicio, fim);
      const r = await listarPedidosShopify(empresa, { ...p, status, busca, uf, limite });
      return texto({ loja: NOME[empresa], periodo: p, ...r, aviso: AVISO });
    },
  );

  server.registerTool(
    'shopify_pedido',
    {
      description:
        'Detalhe de UM pedido da loja online (Shopify Scarf Me / Shopify NERD) pelo número (ex.: "#65997" ou "65997"): ' +
        'status, envio, pagamento, cliente e endereço (cidade/UF), valores (venda, desconto, frete, reembolso, total), ' +
        'itens (nome no Shopify, variante, SKU, qtde, preço, desconto e o produto/cor/código de barras do Linx quando vinculado) ' +
        'e reembolsos com data. O mesmo número aparece na OBS da NF do Linx.',
      inputSchema: { empresa: empresaShopify, numero: z.string().describe('Número do pedido, ex.: "#65997".') },
    },
    async ({ empresa, numero }) => {
      const erro = semShopify(empresa);
      if (erro) return erro;
      await atualizar(empresa);
      const r = await buscarPedidoShopify(empresa, numero);
      return texto(r ? { loja: NOME[empresa], ...r } : { erro: `Pedido ${numero} não encontrado em ${NOME[empresa]}.` });
    },
  );

  server.registerTool(
    'shopify_clientes',
    {
      description:
        'CLIENTES da loja online (Shopify Scarf Me / Shopify NERD) que compraram no período, por valor: nome, e-mail, cidade/UF, ' +
        'pedidos, venda, frete, peças, último pedido, primeiro pedido da vida, se é cliente NOVO (1ª compra no período) e o ' +
        'histórico total (pedidos e venda desde sempre). `busca` filtra por nome/e-mail; `limite` padrão 50 (máx. 500). ' +
        'Traz também quantos clientes distintos compraram no período. ' + AVISO,
      inputSchema: {
        empresa: empresaShopify,
        inicio: inicioSchema,
        fim: fimSchema,
        busca: z.string().optional().describe('Trecho do nome ou e-mail do cliente.'),
        limite: z.number().int().optional().describe('Máximo de clientes (padrão 50, máx. 500).'),
      },
    },
    async ({ empresa, inicio, fim, busca, limite }) => {
      const erro = semShopify(empresa);
      if (erro) return erro;
      await atualizar(empresa);
      const p = periodo(inicio, fim);
      const r = await rankingClientesShopify(empresa, { ...p, busca, limite });
      return texto({ loja: NOME[empresa], periodo: p, ...r, aviso: AVISO });
    },
  );

  server.registerTool(
    'shopify_produtos',
    {
      description:
        'PRODUTOS vendidos na loja online (Shopify Scarf Me / Shopify NERD) num período, por valor. ' +
        'Item vinculado ao Linx sai na visão do Linx (código do produto, descrição, cor e código de barras, somando todos os anúncios ' +
        'do Shopify daquele item); sem vínculo, sai o nome do Shopify e os SKUs. Cada linha: peças, pedidos, venda e frete rateado ' +
        'pelo valor do item. `busca` = trecho do nome, SKU, código do Linx ou código de barras; `limite` padrão 50 (máx. 1000). ' + AVISO,
      inputSchema: {
        empresa: empresaShopify,
        inicio: inicioSchema,
        fim: fimSchema,
        busca: z.string().optional().describe('Trecho do nome, SKU, código do produto no Linx ou código de barras.'),
        limite: z.number().int().optional().describe('Máximo de itens (padrão 50, máx. 1000).'),
      },
    },
    async ({ empresa, inicio, fim, busca, limite }) => {
      const erro = semShopify(empresa);
      if (erro) return erro;
      await atualizar(empresa);
      const p = periodo(inicio, fim);
      const itens = await produtosVendidosShopify(empresa, { ...p, busca, limite });
      return texto({ loja: NOME[empresa], periodo: p, itens, aviso: AVISO });
    },
  );
}

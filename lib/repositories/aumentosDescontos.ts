import { fetchProductsWithDetails, fetchProdutosCustoPrecoMestre } from "@/lib/repositories/products";
import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { fetchVendasHistorico } from "@/lib/repositories/reportVendasHistorico";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import type { ReportFilters } from "@/lib/reports/types";

/**
 * Análise "Aumentos e Descontos" (por produto × cor).
 *
 * Reusa a lógica VALIDADA de vendas (`fetchProductsWithDetails` com
 * `groupByColor: true`): trocas, cancelamentos, fator de desconto e grupos de
 * filial já estão tratados ali — o "valor real vendido" é o faturamento líquido
 * canônico. Aqui NÃO escrevemos SQL de vendas: só comparamos esse valor real
 * contra o VALOR SUGERIDO do cadastro (PRECO_REPOSICAO_1, via
 * `fetchProdutosCustoPrecoMestre`, mesma fonte do Gerador de Relatórios).
 *
 * Regra da classificação (por produto × cor, no período):
 *   valorSugerido = precoSugerido(unit) × qtde líquida vendida
 *   diferenca     = valorSugerido − valorReal
 *     > 0 → DESCONTO (vendeu abaixo do sugerido)
 *     < 0 → AUMENTO  (vendeu acima do sugerido)
 *     = 0 → preço justo
 *   percentual    = |diferenca| ÷ valorSugerido × 100
 */

export interface AumentosDescontosFilters {
  company?: string;
  start?: string;
  end?: string;
  filial?: string | null;
  grupos?: string[] | null;
  linhas?: string[] | null;
  subgrupos?: string[] | null;
  grades?: string[] | null;
  colecoes?: string[] | null;
  cores?: string[] | null;
  tipos?: string[] | null;
  produtoId?: string | null;
  produtoSearchTerm?: string | null;
}

export interface AumentoDescontoRow {
  produto: string;
  cor: string; // código cru da cor
  corDescricao: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  tipo: string;
  grade: string;
  qtde: number; // qtde líquida vendida no período
  precoSugerido: number; // unitário (PRECO_REPOSICAO_1)
  valorSugerido: number; // precoSugerido × qtde
  precoMedioReal: number; // valorReal ÷ qtde
  valorReal: number; // faturamento líquido canônico
  /** Valor da diferença (sempre positivo): desconto concedido ou aumento praticado. */
  valor: number;
  /** Desconto/aumento MÉDIO por unidade vendida (valor ÷ qtde), em R$. */
  valorMedioUnit: number;
  /** Percentual relativo ao valor sugerido do próprio item (sempre positivo). */
  percentual: number;
}

export interface AumentosDescontosResumo {
  /**
   * Vendas líquidas do período pela FONTE CANÔNICA (`fetchSalesTotals`), a mesma
   * do Dashboard e da Curva ABC. É o número que TEM que bater com o resto do app.
   * Difere de `valorRealTotal` porque este cobre só os itens analisáveis (com
   * preço sugerido cadastrado e quantidade líquida positiva).
   */
  vendasPeriodo: number;
  valorSugeridoTotal: number;
  valorRealTotal: number;
  totalDescontoValor: number;
  totalAumentoValor: number;
  descontoMedioPerc: number;
  aumentoMedioPerc: number;
  itensDesconto: number;
  itensAumento: number;
  qtdeDesconto: number;
  qtdeAumento: number;
  itensPrecoJusto: number;
  itensSemPrecoSugerido: number;
}

export interface AumentosDescontosResult {
  descontos: AumentoDescontoRow[];
  aumentos: AumentoDescontoRow[];
  resumo: AumentosDescontosResumo;
}

function up(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeSet(values: string[] | null | undefined): Set<string> | null {
  const list = (values ?? []).map(up).filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

function round2(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

export async function fetchAumentosDescontos(
  filters: AumentosDescontosFilters
): Promise<AumentosDescontosResult> {
  // Vendas do período pela fonte canônica (bate com Dashboard/Curva ABC) e os
  // detalhes por produto × cor rodam em paralelo. O `fetchSalesTotals` já conhece
  // TODOS os filtros (inclui cor por descrição e tipo).
  const [details, salesTotals] = await Promise.all([
    fetchProductsWithDetails({
      company: filters.company,
      range: { start: filters.start, end: filters.end },
      filial: filters.filial ?? null,
      grupos: filters.grupos ?? null,
      linhas: filters.linhas ?? null,
      subgrupos: filters.subgrupos ?? null,
      grades: filters.grades ?? null,
      colecoes: filters.colecoes ?? null,
      produtoId: filters.produtoId ?? undefined,
      produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
      groupByColor: true,
    }),
    fetchSalesTotals({
      company: filters.company,
      range: normalizeRangeForQuery({ start: filters.start, end: filters.end }),
      filial: filters.filial ?? null,
      linhas: filters.linhas ?? null,
      grupos: filters.grupos ?? null,
      subgrupos: filters.subgrupos ?? null,
      grades: filters.grades ?? null,
      colecoes: filters.colecoes ?? null,
      cores: filters.cores ?? null,
      tipos: filters.tipos ?? null,
      produtoId: filters.produtoId ?? null,
      produtoSearchTerm: filters.produtoSearchTerm ?? null,
    }).catch(() => null),
  ]);

  // Filtros pós-consulta (cor por DESCRIÇÃO e tipo) — mesma regra do Gerador de
  // Relatórios; `fetchProductsWithDetails` não expõe esses dois filtros.
  const corSet = normalizeSet(filters.cores);
  const tipoSet = normalizeSet(filters.tipos);
  const filtered = details.filter((d) => {
    if (corSet && !corSet.has(up(d.descCorProduto))) return false;
    if (tipoSet && !tipoSet.has(up(d.tipo))) return false;
    return true;
  });

  // Preço sugerido SEMPRE da tabela mestre PRODUTOS (PRECO_REPOSICAO_1). Mesmo
  // fallback do Gerador de Relatórios: se o mestre não tiver, usa o suggestedPrice
  // que a própria consulta de vendas já traz.
  const custoPreco = await fetchProdutosCustoPrecoMestre(
    filtered.map((d) => String(d.productId ?? "").trim())
  );

  const descontos: AumentoDescontoRow[] = [];
  const aumentos: AumentoDescontoRow[] = [];
  let itensPrecoJusto = 0;
  let itensSemPrecoSugerido = 0;
  let valorSugeridoTotal = 0;
  let valorRealTotal = 0;
  let totalDescontoValor = 0;
  let totalAumentoValor = 0;
  let qtdeDesconto = 0;
  let qtdeAumento = 0;
  let valorSugeridoDesconto = 0;
  let valorSugeridoAumento = 0;

  for (const d of filtered) {
    const pid = String(d.productId ?? "").trim();
    const qtde = d.totalQuantity ?? 0;
    const valorReal = d.totalRevenue ?? 0;

    const mestre = custoPreco.get(pid);
    const precoSugerido =
      mestre && mestre.precoSugerido != null
        ? mestre.precoSugerido
        : d.suggestedPrice != null
          ? d.suggestedPrice
          : null;

    // Sem preço sugerido ou sem quantidade líquida positiva → não dá para
    // comparar. Fica de fora das duas abas (contabilizado à parte).
    if (precoSugerido == null || precoSugerido <= 0 || qtde <= 0) {
      itensSemPrecoSugerido += 1;
      continue;
    }

    const valorSugerido = precoSugerido * qtde;
    const diferenca = valorSugerido - valorReal; // > 0 desconto, < 0 aumento
    const precoMedioReal = qtde > 0 ? valorReal / qtde : 0;

    valorSugeridoTotal += valorSugerido;
    valorRealTotal += valorReal;

    const base: Omit<AumentoDescontoRow, "valor" | "valorMedioUnit" | "percentual"> = {
      produto: pid,
      cor: d.corProduto ? String(d.corProduto).trim() : "",
      corDescricao: d.descCorProduto ?? "",
      descricao: d.productName ?? "",
      grupo: d.grupo ?? "",
      subgrupo: d.subgrupo ?? "",
      linha: d.linha ?? "",
      tipo: d.tipo ?? "",
      grade: d.grade ?? "",
      qtde: roundInt(qtde),
      precoSugerido: round2(precoSugerido),
      valorSugerido: round2(valorSugerido),
      precoMedioReal: round2(precoMedioReal),
      valorReal: round2(valorReal),
    };

    const difArred = round2(diferenca);
    if (difArred > 0) {
      const perc = valorSugerido !== 0 ? (diferenca / valorSugerido) * 100 : 0;
      descontos.push({
        ...base,
        valor: difArred,
        valorMedioUnit: round2(qtde > 0 ? difArred / qtde : 0),
        percentual: round2(perc),
      });
      totalDescontoValor += diferenca;
      qtdeDesconto += qtde;
      valorSugeridoDesconto += valorSugerido;
    } else if (difArred < 0) {
      const aumento = -diferenca;
      const perc = valorSugerido !== 0 ? (aumento / valorSugerido) * 100 : 0;
      aumentos.push({
        ...base,
        valor: round2(aumento),
        valorMedioUnit: round2(qtde > 0 ? aumento / qtde : 0),
        percentual: round2(perc),
      });
      totalAumentoValor += aumento;
      qtdeAumento += qtde;
      valorSugeridoAumento += valorSugerido;
    } else {
      itensPrecoJusto += 1;
    }
  }

  // Maior impacto primeiro (valor em R$).
  descontos.sort((a, b) => b.valor - a.valor);
  aumentos.sort((a, b) => b.valor - a.valor);

  const resumo: AumentosDescontosResumo = {
    vendasPeriodo: round2(salesTotals?.vendas ?? valorRealTotal),
    valorSugeridoTotal: round2(valorSugeridoTotal),
    valorRealTotal: round2(valorRealTotal),
    totalDescontoValor: round2(totalDescontoValor),
    totalAumentoValor: round2(totalAumentoValor),
    descontoMedioPerc:
      valorSugeridoDesconto !== 0 ? round2((totalDescontoValor / valorSugeridoDesconto) * 100) : 0,
    aumentoMedioPerc:
      valorSugeridoAumento !== 0 ? round2((totalAumentoValor / valorSugeridoAumento) * 100) : 0,
    itensDesconto: descontos.length,
    itensAumento: aumentos.length,
    qtdeDesconto: roundInt(qtdeDesconto),
    qtdeAumento: roundInt(qtdeAumento),
    itensPrecoJusto,
    itensSemPrecoSugerido,
  };

  return { descontos, aumentos, resumo };
}

/**
 * Visão DETALHADA (transação a transação): cada linha é um item vendido num
 * ticket/nota, comparado contra o preço sugerido do cadastro.
 *
 * Reusa a fonte canônica `fetchVendasHistorico` (nível de transação, regra de
 * vendas validada — POS via LOJA_VENDA_PRODUTO com fator de desconto, e-commerce
 * via FATURAMENTO). Observação: por ser nível de transação, o valor real da linha
 * NÃO abate trocas (trocas não se atribuem a uma linha específica); por isso a
 * soma da visão detalhada pode diferir levemente da agregada, que é líquida de
 * trocas. Para o número oficial de vendas do período, use `vendasPeriodo`.
 */
export interface AumentoDescontoDetalheRow {
  data: string; // ISO 'yyyy-mm-dd'
  ticket: string;
  filial: string;
  vendedor: string;
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  tamanho: number | null;
  linha: string;
  grupo: string;
  subgrupo: string;
  grade: string;
  tipo: string;
  qtde: number;
  precoSugerido: number; // unitário
  valorSugerido: number; // precoSugerido × qtde
  precoReal: number; // valor real ÷ qtde
  valorReal: number; // valor líquido da linha (regra validada)
  valor: number; // |diferença| (desconto ou aumento)
  percentual: number;
}

export interface AumentosDescontosDetalheResult {
  descontos: AumentoDescontoDetalheRow[];
  aumentos: AumentoDescontoDetalheRow[];
  total: number;
  truncated: boolean;
  itensSemPrecoSugerido: number;
  itensPrecoJusto: number;
}

export async function fetchAumentosDescontosDetalhe(
  filters: AumentosDescontosFilters
): Promise<AumentosDescontosDetalheResult> {
  const reportFilters: ReportFilters = {
    company: filters.company,
    filial: filters.filial ?? null,
    start: filters.start,
    end: filters.end,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    cores: filters.cores ?? null,
    tipos: filters.tipos ?? null,
    produtoId: filters.produtoId ?? null,
    produtoSearchTerm: filters.produtoSearchTerm ?? null,
  };

  const historico = await fetchVendasHistorico(reportFilters);
  const rows = historico.rows;

  const custoPreco = await fetchProdutosCustoPrecoMestre(
    rows.map((r) => String(r.PRODUTO ?? "").trim())
  );

  const descontos: AumentoDescontoDetalheRow[] = [];
  const aumentos: AumentoDescontoDetalheRow[] = [];
  let itensSemPrecoSugerido = 0;
  let itensPrecoJusto = 0;

  for (const r of rows) {
    const pid = String(r.PRODUTO ?? "").trim();
    const qtde = Number(r.QTDE ?? 0);
    const valorReal = Number(r.VALOR ?? 0);
    const mestre = custoPreco.get(pid);
    const precoSugerido = mestre && mestre.precoSugerido != null ? mestre.precoSugerido : null;

    if (precoSugerido == null || precoSugerido <= 0 || qtde <= 0) {
      itensSemPrecoSugerido += 1;
      continue;
    }

    const valorSugerido = precoSugerido * qtde;
    const diferenca = valorSugerido - valorReal;
    const difArred = round2(diferenca);
    if (difArred === 0) {
      itensPrecoJusto += 1;
      continue;
    }

    const base: Omit<AumentoDescontoDetalheRow, "valor" | "percentual"> = {
      data: String(r.DATA_VENDA ?? ""),
      ticket: String(r.TICKET ?? ""),
      filial: String(r.FILIAL ?? ""),
      vendedor: String(r.VENDEDOR ?? ""),
      produto: pid,
      cor: String(r.COR ?? ""),
      corDescricao: String(r.COR_DESCRICAO ?? ""),
      descricao: String(r.DESCRICAO ?? ""),
      tamanho: r.TAMANHO != null ? Number(r.TAMANHO) : null,
      linha: String(r.LINHA ?? ""),
      grupo: String(r.GRUPO ?? ""),
      subgrupo: String(r.SUBGRUPO ?? ""),
      grade: String(r.GRADE ?? ""),
      tipo: String(r.TIPO ?? ""),
      qtde: roundInt(qtde),
      precoSugerido: round2(precoSugerido),
      valorSugerido: round2(valorSugerido),
      precoReal: round2(qtde > 0 ? valorReal / qtde : 0),
      valorReal: round2(valorReal),
    };

    const perc = valorSugerido !== 0 ? (Math.abs(diferenca) / valorSugerido) * 100 : 0;
    if (difArred > 0) descontos.push({ ...base, valor: difArred, percentual: round2(perc) });
    else aumentos.push({ ...base, valor: round2(-diferenca), percentual: round2(perc) });
  }

  descontos.sort((a, b) => b.valor - a.valor);
  aumentos.sort((a, b) => b.valor - a.valor);

  return {
    descontos,
    aumentos,
    total: descontos.length + aumentos.length,
    truncated: historico.truncated,
    itensSemPrecoSugerido,
    itensPrecoJusto,
  };
}

/**
 * Visão POR TICKET: agrupa as mesmas vendas transação-a-transação por
 * ticket/nota (filial + ticket), e compara o TICKET INTEIRO — não o item
 * isolado — contra a soma dos preços sugeridos dos itens que o compõem.
 *
 * Por quê: um produto pode aparecer "com desconto" só porque foi vendido
 * junto com outros itens (kit, negociação no caixa que abate um item pra
 * fechar a venda, etc.). Olhado sozinho, isso parece desconto ruim; olhado
 * no ticket completo, o resultado real pode ser neutro ou até positivo,
 * porque outro item do mesmo carrinho teve aumento. Esta visão existe pra
 * mostrar esse quadro completo — o "valor do ticket" é a métrica que
 * realmente importa pro impacto do negócio, não o item isolado.
 *
 * Reusa a mesma fonte canônica de transações (`fetchVendasHistorico`) e o
 * mesmo preço sugerido (`fetchProdutosCustoPrecoMestre`) da visão Detalhar —
 * só muda o agrupamento e a matemática de comparação (por ticket, não por
 * linha). Mesma ressalva: nível de transação não abate trocas por linha.
 */
export interface TicketItemRow {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  qtde: number;
  /** null = produto sem preço sugerido cadastrado (não entra na comparação do ticket). */
  precoSugerido: number | null;
  precoReal: number;
  valorSugerido: number | null;
  valorReal: number;
  /** sugerido − real do ITEM (0 quando sem preço sugerido); só contexto, o líquido do ticket é que importa. */
  diferenca: number;
  classificacao: "desconto" | "aumento" | "justo" | "sem_preco";
}

export interface TicketRow {
  ticket: string;
  filial: string;
  data: string;
  vendedor: string;
  /** Nº de linhas de produto (produto × cor) distintas no ticket. */
  qtdeItens: number;
  /** Soma das quantidades vendidas no ticket. */
  qtdeTotal: number;
  /** Valor REAL TOTAL do ticket — TODOS os itens, inclusive os sem preço sugerido cadastrado. */
  valorTicketTotal: number;
  /** Soma do valor sugerido só dos itens com preço cadastrado (base comparável). */
  valorSugeridoComparavel: number;
  /** Soma do valor real só dos itens com preço cadastrado (mesma base do comparável acima). */
  valorRealComparavel: number;
  /** valorSugeridoComparavel − valorRealComparavel: > 0 desconto líquido do ticket, < 0 aumento líquido. */
  diferenca: number;
  /** Percentual da diferença relativo ao valorSugeridoComparavel. */
  percentual: number;
  itensComDesconto: number;
  itensComAumento: number;
  itensJusto: number;
  itensSemPreco: number;
  itens: TicketItemRow[];
}

export interface AumentosDescontosPorTicketResumo {
  /** Tickets com pelo menos 1 item de desconto OU de aumento (universo desta visão). */
  ticketsAnalisados: number;
  /** Diferença líquida > 0: desconto que realmente sobrou depois de olhar o ticket inteiro. */
  ticketsDescontoLiquido: number;
  /** Diferença líquida < 0: aumento que realmente sobrou depois de olhar o ticket inteiro. */
  ticketsAumentoLiquido: number;
  /**
   * Tickets que tinham item de desconto E de aumento ao mesmo tempo — evidência direta
   * de compensação dentro do carrinho (o caso que você descreveu).
   */
  ticketsMistos: number;
  /** Dentro dos mistos: quantos zeraram exatamente (desconto de um item 100% absorvido por outro). */
  ticketsNeutralizados: number;
  descontoLiquidoTotal: number;
  aumentoLiquidoTotal: number;
  /** Soma do valor total (real, todos os itens) de todos os tickets analisados — dá a escala da amostra. */
  valorTicketsTotal: number;
}

export interface AumentosDescontosPorTicketResult {
  ticketsComDesconto: TicketRow[];
  ticketsComAumento: TicketRow[];
  resumo: AumentosDescontosPorTicketResumo;
  truncated: boolean;
}

export async function fetchAumentosDescontosPorTicket(
  filters: AumentosDescontosFilters
): Promise<AumentosDescontosPorTicketResult> {
  const reportFilters: ReportFilters = {
    company: filters.company,
    filial: filters.filial ?? null,
    start: filters.start,
    end: filters.end,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    colecoes: filters.colecoes ?? null,
    cores: filters.cores ?? null,
    tipos: filters.tipos ?? null,
    produtoId: filters.produtoId ?? null,
    produtoSearchTerm: filters.produtoSearchTerm ?? null,
  };

  const historico = await fetchVendasHistorico(reportFilters);
  const rows = historico.rows;

  const custoPreco = await fetchProdutosCustoPrecoMestre(
    rows.map((r) => String(r.PRODUTO ?? "").trim())
  );

  // Agrupa por FILIAL + TICKET (chave do ticket no POS/e-commerce; o mesmo
  // par identifica univocamente uma venda em LOJA_VENDA / FATURAMENTO).
  interface Acc extends Omit<TicketRow, "diferenca" | "percentual"> {
    _valorSugeridoRaw: number;
    _valorRealComparavelRaw: number;
    _valorTicketTotalRaw: number;
  }
  const map = new Map<string, Acc>();

  for (const r of rows) {
    const filial = String(r.FILIAL ?? "");
    const ticket = String(r.TICKET ?? "");
    const key = `${filial}::${ticket}`;

    let t = map.get(key);
    if (!t) {
      t = {
        ticket,
        filial,
        data: String(r.DATA_VENDA ?? ""),
        vendedor: String(r.VENDEDOR ?? ""),
        qtdeItens: 0,
        qtdeTotal: 0,
        valorTicketTotal: 0,
        valorSugeridoComparavel: 0,
        valorRealComparavel: 0,
        itensComDesconto: 0,
        itensComAumento: 0,
        itensJusto: 0,
        itensSemPreco: 0,
        itens: [],
        _valorSugeridoRaw: 0,
        _valorRealComparavelRaw: 0,
        _valorTicketTotalRaw: 0,
      };
      map.set(key, t);
    }

    const pid = String(r.PRODUTO ?? "").trim();
    const qtde = Number(r.QTDE ?? 0);
    const valorReal = Number(r.VALOR ?? 0);
    const mestre = custoPreco.get(pid);
    const precoSugerido = mestre && mestre.precoSugerido != null ? mestre.precoSugerido : null;

    t.qtdeItens += 1;
    t.qtdeTotal += qtde;
    t._valorTicketTotalRaw += valorReal; // SEMPRE soma — é o valor real do ticket completo

    let classificacao: TicketItemRow["classificacao"];
    let itemValorSugerido: number | null = null;
    let itemDiferenca = 0;

    if (precoSugerido == null || precoSugerido <= 0 || qtde <= 0) {
      classificacao = "sem_preco";
      t.itensSemPreco += 1;
    } else {
      itemValorSugerido = precoSugerido * qtde;
      itemDiferenca = round2(itemValorSugerido - valorReal);
      t._valorSugeridoRaw += itemValorSugerido;
      t._valorRealComparavelRaw += valorReal;
      if (itemDiferenca > 0) {
        classificacao = "desconto";
        t.itensComDesconto += 1;
      } else if (itemDiferenca < 0) {
        classificacao = "aumento";
        t.itensComAumento += 1;
      } else {
        classificacao = "justo";
        t.itensJusto += 1;
      }
    }

    t.itens.push({
      produto: pid,
      cor: String(r.COR ?? ""),
      corDescricao: String(r.COR_DESCRICAO ?? ""),
      descricao: String(r.DESCRICAO ?? ""),
      qtde: roundInt(qtde),
      precoSugerido: precoSugerido != null ? round2(precoSugerido) : null,
      precoReal: round2(qtde > 0 ? valorReal / qtde : 0),
      valorSugerido: itemValorSugerido != null ? round2(itemValorSugerido) : null,
      valorReal: round2(valorReal),
      diferenca: itemDiferenca,
      classificacao,
    });
  }

  const ticketsComDesconto: TicketRow[] = [];
  const ticketsComAumento: TicketRow[] = [];
  let ticketsMistos = 0;
  let ticketsNeutralizados = 0;
  let descontoLiquidoTotal = 0;
  let aumentoLiquidoTotal = 0;
  let valorTicketsTotal = 0;

  for (const t of map.values()) {
    // Só interessam tickets com pelo menos 1 item classificável como desconto
    // ou aumento — tickets 100% "preço justo"/"sem preço" não têm o que mostrar aqui.
    if (t.itensComDesconto === 0 && t.itensComAumento === 0) continue;

    const valorTicketTotal = round2(t._valorTicketTotalRaw);
    const valorSugeridoComparavel = round2(t._valorSugeridoRaw);
    const valorRealComparavel = round2(t._valorRealComparavelRaw);
    const diferenca = round2(t._valorSugeridoRaw - t._valorRealComparavelRaw);
    const percentual = valorSugeridoComparavel !== 0 ? round2((diferenca / valorSugeridoComparavel) * 100) : 0;

    t.itens.sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca));

    const ticketRow: TicketRow = {
      ticket: t.ticket,
      filial: t.filial,
      data: t.data,
      vendedor: t.vendedor,
      qtdeItens: t.qtdeItens,
      qtdeTotal: roundInt(t.qtdeTotal),
      valorTicketTotal,
      valorSugeridoComparavel,
      valorRealComparavel,
      diferenca,
      percentual,
      itensComDesconto: t.itensComDesconto,
      itensComAumento: t.itensComAumento,
      itensJusto: t.itensJusto,
      itensSemPreco: t.itensSemPreco,
      itens: t.itens,
    };

    valorTicketsTotal += valorTicketTotal;
    if (t.itensComDesconto > 0 && t.itensComAumento > 0) {
      ticketsMistos += 1;
      if (diferenca === 0) ticketsNeutralizados += 1;
    }

    if (diferenca > 0) {
      ticketsComDesconto.push(ticketRow);
      descontoLiquidoTotal += diferenca;
    } else if (diferenca < 0) {
      ticketsComAumento.push(ticketRow);
      aumentoLiquidoTotal += -diferenca;
    }
    // diferenca === 0 sem ser misto não deveria acontecer (exigiria item de
    // desconto ou aumento cuja diferença sozinha já fosse zero — impossível
    // pela classificação), mas se ocorrer fica de fora das duas abas por não
    // ter lado (nem desconto nem aumento líquido).
  }

  ticketsComDesconto.sort((a, b) => b.diferenca - a.diferenca);
  ticketsComAumento.sort((a, b) => a.diferenca - b.diferenca);

  const resumo: AumentosDescontosPorTicketResumo = {
    ticketsAnalisados: ticketsComDesconto.length + ticketsComAumento.length,
    ticketsDescontoLiquido: ticketsComDesconto.length,
    ticketsAumentoLiquido: ticketsComAumento.length,
    ticketsMistos,
    ticketsNeutralizados,
    descontoLiquidoTotal: round2(descontoLiquidoTotal),
    aumentoLiquidoTotal: round2(aumentoLiquidoTotal),
    valorTicketsTotal: round2(valorTicketsTotal),
  };

  return {
    ticketsComDesconto,
    ticketsComAumento,
    resumo,
    truncated: historico.truncated,
  };
}

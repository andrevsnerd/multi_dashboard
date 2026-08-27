import {
  fetchProductsWithDetails,
  fetchProdutosCustoPrecoMestre,
} from "@/lib/repositories/products";
import { fetchEstoqueRedePorProduto } from "@/lib/repositories/controleEstoque";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import { canonicalCor, canonicalKey, ROW_COR_FIELD } from "@/lib/reports/keys";
import {
  DIAS_ACABAR_EXCEDE,
  DIAS_ACABAR_SEM_GIRO,
  PROJECAO_HORIZONTE_MESES,
  PROJECAO_JANELA_DEFAULT,
  PROJECAO_LOOKBACK_MESES,
  PROJECAO_MES_COL_PREFIX,
} from "@/lib/reports/projecao-vendas";
import {
  addMeses,
  arredondarPreservandoSoma,
  buildIndiceSazonal,
  calcRitmoMensal,
  diasNoMes,
  mesLabel,
  mesToIndex,
  projetarConsumoEstoque,
  type ProjecaoMesSerie,
  type ProjecaoMotivoRitmo,
} from "@/lib/utils/projecao-vendas";
import type { ReportRunContext } from "@/lib/reports/registry.server";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

/** Quantos meses buscar em paralelo (cada mês é uma consulta de vendas própria). */
const MES_CONCURRENCY = 4;

const CONFIANCA_LABEL: Record<string, string> = {
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
};

/**
 * Rótulo da origem do ritmo. "recente" = a janela termina no último mês fechado (ritmo
 * atual); "historico" = a janela é anterior — item que parou OU vendedor esparso que
 * voltou a vender agora (nesse caso "Parado há" fica 0 e a Idade da base mostra o quanto
 * o ritmo é antigo).
 */
const ORIGEM_LABEL: Record<ProjecaoMotivoRitmo, string> = {
  recente: "Venda recente",
  historico: "Histórico (base antiga)",
  mes_corrente: "Só o mês corrente",
  sem_historico: "Sem histórico de venda",
};

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

/** "Hoje" no fuso de Brasília (o servidor pode estar em UTC) → { ymd, mes, dia }. */
function hojeBrasilia(): { ymd: string; mes: string; dia: number } {
  // en-CA formata como yyyy-mm-dd, que é exatamente o formato que usamos internamente.
  const ymd = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [y, m, d] = ymd.split("-");
  return { ymd, mes: `${y}-${m}`, dia: Number(d) };
}

/** Soma dias a um "yyyy-mm-dd" (UTC-noon evita saltos de fuso/DST). */
function addDiasYmd(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/**
 * 3 tentativas com backoff, propagando o erro NOMEADO quando todas falham.
 *
 * Regra do dono nas telas/relatórios que viram decisão de compra: **dado que não chegou
 * nunca vira 0**. Um `.catch(() => [])` num mês faria o ritmo daquele item cair sem aviso
 * (e a projeção sair plausível e errada). O custo de um relatório abortado é recarregar;
 * o de um relatório silenciosamente incompleto é comprar errado.
 */
async function withRetry<T>(what: string, fn: () => Promise<T>, tentativas = 3): Promise<T> {
  let ultimoErro: unknown = null;
  for (let i = 0; i < tentativas; i += 1) {
    try {
      return await fn();
    } catch (error) {
      ultimoErro = error;
      if (i < tentativas - 1) {
        await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
      }
    }
  }
  const detalhe = ultimoErro instanceof Error ? ultimoErro.message : String(ultimoErro);
  throw new Error(`Falha ao consultar ${what} (${tentativas} tentativas): ${detalhe}`);
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await mapper(items[i]!, i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

interface ItemAcc {
  produto: string;
  corCodigo: string;
  corDescricao: string;
  descricao: string;
  grupo: string;
  subgrupo: string;
  linha: string;
  tipo: string;
  grade: string;
  /** Série mensal de unidades vendidas: "yyyy-mm" → qtde. */
  serie: Map<string, number>;
  estoque: number;
  custoVendas: number;
}

/**
 * Análise "Projeção de vendas" — quanto cada produto × cor deve vender no mês corrente e
 * nos seguintes, consumindo o estoque de hoje até acabar.
 *
 * Fontes (todas canônicas, nenhuma SQL de venda nova — regra do CLAUDE.md):
 *  - Série mensal de vendas: `fetchProductsWithDetails` UMA VEZ POR MÊS (24 meses), escopada
 *    aos produtos/filtros escolhidos. É a lógica validada "com trocas" (POS + e-commerce),
 *    então a soma dos meses bate com o relatório de faturamento por construção.
 *  - Estoque atual: `fetchEstoqueRedePorProduto` (mesmo escopo da Estoque Consulta; só
 *    saldos POSITIVOS entram, negativo nunca conta).
 *  - Custo: `fetchProdutosCustoPrecoMestre` (tabela mestre PRODUTOS), não o custo da venda.
 *
 * Cálculo em [lib/utils/projecao-vendas.ts] (motor puro e testável): ritmo pela JANELA
 * ANCORADA NA ÚLTIMA VENDA e consumo do estoque mês a mês. Não há reconstrução de estoque
 * retroativo em nenhum ponto — decisão do dono, para o ritmo não depender de saldo
 * reconstruído (que gera "fantasma" em item novo).
 *
 * Universo de linhas = produto × cor que TEM estoque hoje OU vendeu nos últimos 24 meses.
 * Item sem estoque aparece com projeção 0 e "Dias p/ acabar" 0 (já acabou) — é sinal de
 * ruptura, não erro.
 */
export async function fetchProjecaoVendas(
  filters: ReportFilters,
  ctx?: ReportRunContext
): Promise<ReportResult> {
  const hoje = hojeBrasilia();
  const mesAtual = hoje.mes;
  const janelaMeses =
    filters.projecaoJanelaMeses && filters.projecaoJanelaMeses > 0
      ? Math.floor(filters.projecaoJanelaMeses)
      : PROJECAO_JANELA_DEFAULT;

  // ── Janelas mensais: 24 meses fechados + o mês corrente (parcial, até hoje) ──────────
  const meses: Array<{ mes: string; start: string; end: string }> = [];
  for (let i = PROJECAO_LOOKBACK_MESES - 1; i >= 0; i -= 1) {
    const mes = addMeses(mesAtual, -i);
    const start = `${mes}-01`;
    const end = mes === mesAtual ? hoje.ymd : `${mes}-${String(diasNoMes(mes)).padStart(2, "0")}`;
    meses.push({ mes, start, end });
  }

  // ── Escopo de produtos ──────────────────────────────────────────────────────────────
  // Duas formas de escolher, que convivem:
  //  · `produtoIds` (chips de busca / código do produto colado) → TODAS as cores do produto.
  //  · `produtoChaves` ("PRODUTO|COR", código de BARRA colado) → só aquela cor.
  // A consulta SQL é escopada por PRODUTO (índice); o recorte por cor é aplicado em JS,
  // mesmo padrão dos filtros de cor/tipo desta análise.
  const produtoIds = (filters.produtoIds ?? []).map((p) => String(p ?? "").trim()).filter(Boolean);
  const chavesCor = new Map<string, Set<string>>();
  for (const raw of filters.produtoChaves ?? []) {
    const [prod, cor] = String(raw ?? "").split("|");
    const produto = (prod ?? "").trim();
    if (!produto) continue;
    const set = chavesCor.get(produto) ?? new Set<string>();
    set.add(canonicalCor(cor ?? ""));
    chavesCor.set(produto, set);
  }
  // Produto pedido pelo código (sem cor) libera todas as cores dele.
  const produtosTodasCores = new Set(produtoIds);
  const produtosEscopo = Array.from(new Set([...produtoIds, ...chavesCor.keys()]));
  const escopoProdutos = produtosEscopo.length > 0 ? produtosEscopo : null;
  /** Item passa pelo recorte de cor? (só restringe produto pedido por barra). */
  const corPermitida = (produto: string, cor: string | null): boolean => {
    if (produtosTodasCores.has(produto)) return true;
    const permitidas = chavesCor.get(produto);
    if (!permitidas) return true; // produto veio por categoria, não por lista
    return permitidas.has(canonicalCor(cor ?? ""));
  };

  const considerarEstoque = filters.projecaoConsiderarEstoque !== false;

  // ── Série mensal (uma consulta por mês) + estoque + custo ───────────────────────────
  let mesesFeitos = 0;
  ctx?.onProgress?.(0, meses.length, "meses");
  const [porMes, estoqueRows] = await Promise.all([
    mapWithConcurrency(meses, MES_CONCURRENCY, async (m) => {
      const rows = await withRetry(`vendas de ${m.mes}`, () =>
        fetchProductsWithDetails({
          company: filters.company,
          range: { start: m.start, end: m.end },
          filial: filters.filial ?? null,
          grupos: filters.grupos ?? null,
          linhas: filters.linhas ?? null,
          subgrupos: filters.subgrupos ?? null,
          grades: filters.grades ?? null,
          colecoes: filters.colecoes ?? null,
          produtoId: filters.produtoId ?? undefined,
          produtoIds: escopoProdutos,
          produtoSearchTerm: filters.produtoSearchTerm ?? undefined,
          groupByColor: true,
        })
      );
      mesesFeitos += 1;
      ctx?.onProgress?.(mesesFeitos, meses.length, "meses");
      return { mes: m.mes, rows };
    }),
    withRetry("estoque atual", () =>
      fetchEstoqueRedePorProduto({
        company: filters.company,
        // Estoque segue o filtro de filial da tela (null = rede inteira).
        filial: filters.filial ?? null,
        grupos: filters.grupos ?? null,
        linhas: filters.linhas ?? null,
        subgrupos: filters.subgrupos ?? null,
        grades: filters.grades ?? null,
        colecoes: filters.colecoes ?? null,
        cores: filters.cores ?? null,
        tipos: filters.tipos ?? null,
        produtoId: filters.produtoId ?? null,
        produtoIds: escopoProdutos,
        produtoSearchTerm: filters.produtoSearchTerm ?? null,
        // Com uma lista explícita de itens, traz também os de saldo ZERO: o item que o
        // usuário colou tem que aparecer na tabela (com "Sem giro"/estoque 0) em vez de
        // desaparecer em silêncio. Sem lista (análise por categoria) fica no padrão, senão
        // a consulta devolveria o cadastro inteiro.
        incluirZerados: escopoProdutos != null,
      })
    ),
  ]);

  // ── Acumula por produto × cor ───────────────────────────────────────────────────────
  const corSet = normalizeSet(filters.cores);
  const tipoSet = normalizeSet(filters.tipos);
  const itens = new Map<string, ItemAcc>();

  const getAcc = (key: string, seed: Omit<ItemAcc, "serie" | "estoque" | "custoVendas">) => {
    let acc = itens.get(key);
    if (!acc) {
      acc = { ...seed, serie: new Map<string, number>(), estoque: 0, custoVendas: 0 };
      itens.set(key, acc);
    }
    return acc;
  };

  for (const { mes, rows } of porMes) {
    for (const d of rows) {
      // Cor e tipo não são filtros da consulta de vendas — mesma régua em JS que a
      // Compra sugerida ABC aplica (ver reportCompraSugeridaAbc).
      if (corSet && !corSet.has(up(d.descCorProduto))) continue;
      if (tipoSet && !tipoSet.has(up(d.tipo))) continue;

      const produto = String(d.productId ?? "").trim();
      if (!produto) continue;
      const corCodigo = d.corProduto ? String(d.corProduto).trim() : "";
      if (!corPermitida(produto, corCodigo)) continue;
      const key = canonicalKey(produto, corCodigo);
      const acc = getAcc(key, {
        produto,
        corCodigo,
        corDescricao: d.descCorProduto ?? "",
        descricao: d.productName ?? "",
        grupo: d.grupo ?? "",
        subgrupo: d.subgrupo ?? "",
        linha: d.linha ?? "",
        tipo: d.tipo ?? "",
        grade: d.grade ?? "",
      });
      // Metadados: preenche o que estiver vazio (mês antigo pode vir sem alguma descrição).
      if (!acc.corDescricao && d.descCorProduto) acc.corDescricao = d.descCorProduto;
      if (!acc.descricao && d.productName) acc.descricao = d.productName;
      const qtde = Number(d.totalQuantity ?? 0);
      if (Number.isFinite(qtde) && qtde !== 0) {
        acc.serie.set(mes, (acc.serie.get(mes) ?? 0) + qtde);
      }
      if (acc.custoVendas <= 0 && Number(d.cost ?? 0) > 0) acc.custoVendas = Number(d.cost);
    }
  }

  for (const r of estoqueRows) {
    if (corSet && !corSet.has(up(r.cor))) continue;
    if (tipoSet && !tipoSet.has(up(r.tipo))) continue;
    const produto = (r.produto ?? "").trim();
    if (!produto) continue;
    const corCodigo = (r.corCodigo ?? "").trim();
    if (!corPermitida(produto, corCodigo)) continue;
    const key = canonicalKey(produto, corCodigo);
    const acc = getAcc(key, {
      produto,
      corCodigo,
      corDescricao: r.cor ?? "",
      descricao: r.descricao ?? "",
      grupo: r.grupo ?? "",
      subgrupo: r.subgrupo ?? "",
      linha: r.linha ?? "",
      tipo: r.tipo ?? "",
      grade: r.grade ?? "",
    });
    // Negativo nunca conta (regra do dono): soma só os saldos positivos das filiais.
    acc.estoque += Math.max(0, Number(r.positiveStock ?? 0));
  }

  if (itens.size === 0) {
    return { rows: [], total: 0, truncated: false, summary: [], dynamicColumns: [] };
  }

  // ── Custo da tabela mestre (não o custo gravado na venda) ───────────────────────────
  const custoMestre = await withRetry("custo da tabela mestre", () =>
    fetchProdutosCustoPrecoMestre(
      Array.from(new Set(Array.from(itens.values()).map((i) => i.produto)))
    )
  );

  // ── Índice sazonal (opt-in), calculado da PRÓPRIA seleção ───────────────────────────
  let indiceSazonal: Map<number, number> | null = null;
  if (filters.projecaoSazonalidade) {
    const agregadoPorMes = new Map<string, number>();
    for (const acc of itens.values()) {
      for (const [mes, qtde] of acc.serie) {
        agregadoPorMes.set(mes, (agregadoPorMes.get(mes) ?? 0) + qtde);
      }
    }
    const serieAgregada: ProjecaoMesSerie[] = meses.map((m) => ({
      mes: m.mes,
      qtde: agregadoPorMes.get(m.mes) ?? 0,
    }));
    indiceSazonal = buildIndiceSazonal({ serieAgregada, mesAtual });
  }

  // ── Uma linha por item ─────────────────────────────────────────────────────────────
  const atualIdx = mesToIndex(mesAtual);
  interface Calculada {
    row: ReportRow;
    projecaoPorMes: Map<string, number>;
    /** Quantos meses de coluna este item realmente usa (até zerar), 1..horizonte. */
    mesesUsados: number;
    semGiro: boolean;
    zerado: boolean;
    proj90: number;
  }
  const calculadas: Calculada[] = [];

  for (const acc of itens.values()) {
    const serie: ProjecaoMesSerie[] = meses.map((m) => ({
      mes: m.mes,
      qtde: acc.serie.get(m.mes) ?? 0,
    }));
    const ritmo = calcRitmoMensal({ serie, mesAtual, janelaMeses });
    const projecao = projetarConsumoEstoque({
      estoque: acc.estoque,
      ritmoMes: ritmo.ritmoMes,
      mesAtual,
      diaAtual: hoje.dia,
      maxMeses: PROJECAO_HORIZONTE_MESES,
      indiceSazonal,
      limitarAoEstoque: considerarEstoque,
    });

    // Arredonda as colunas de mês PRESERVANDO a soma (nunca round-then-sum: a soma das
    // colunas tem que fechar com o estoque consumido). Ver [[produto-giro-arredondamento-somar-exato]].
    const inteiros = arredondarPreservandoSoma(projecao.meses.map((m) => m.qtde));
    const projecaoPorMes = new Map<string, number>();
    let mesesUsados = 0;
    projecao.meses.forEach((m, i) => {
      const qtde = inteiros[i] ?? 0;
      projecaoPorMes.set(m.mes, qtde);
      if (qtde > 0) mesesUsados = i + 1;
    });
    const projecaoTotal = inteiros.reduce((s, v) => s + v, 0);
    // Soma os 3 primeiros meses NA MESMA leitura da tabela (com teto de estoque quando o
    // modo está ligado; demanda pura quando não) — o rótulo do KPI acompanha o modo.
    const proj90 = projecao.meses.slice(0, 3).reduce((s, m) => s + m.qtde, 0);

    // Janelas de venda para leitura rápida (rolantes, incluem o mês corrente parcial).
    const somaUltimos = (n: number) =>
      meses
        .filter((m) => mesToIndex(m.mes) > atualIdx - n)
        .reduce((s, m) => s + (acc.serie.get(m.mes) ?? 0), 0);

    const semGiro = ritmo.ritmoMes <= 0;
    const custoUnit = Number(custoMestre.get(acc.produto)?.custo ?? 0) || acc.custoVendas;
    const diasSentinela = semGiro
      ? DIAS_ACABAR_SEM_GIRO
      : projecao.diasParaAcabar == null
        ? DIAS_ACABAR_EXCEDE
        : Math.round(projecao.diasParaAcabar);

    const row: ReportRow = {
      [ROW_COR_FIELD]: acc.corCodigo,
      PRODUTO: acc.produto,
      COR: acc.corCodigo,
      COR_DESCRICAO: acc.corDescricao,
      DESCRICAO: acc.descricao,
      GRUPO: acc.grupo,
      SUBGRUPO: acc.subgrupo,
      LINHA: acc.linha,
      TIPO: acc.tipo,
      GRADE: acc.grade,
      ESTOQUE_REDE: roundInt(acc.estoque),
      CUSTO_UNITARIO: round2(custoUnit),
      VALOR_ESTOQUE: round2(custoUnit * acc.estoque),
      RITMO_MES: round2(ritmo.ritmoMes),
      RITMO_DIA: round2(ritmo.ritmoMes / 30),
      BASE_RITMO:
        ritmo.baseInicio && ritmo.baseFim
          ? ritmo.baseInicio === ritmo.baseFim
            ? `${mesLabel(ritmo.baseInicio)} (1 mês)`
            : `${mesLabel(ritmo.baseInicio)}–${mesLabel(ritmo.baseFim)} (${ritmo.baseMeses} meses)`
          : "",
      BASE_MESES: ritmo.baseMeses,
      BASE_QTDE: roundInt(ritmo.baseQtde),
      BASE_IDADE_MESES: ritmo.baseIdadeMeses,
      ORIGEM_RITMO: ORIGEM_LABEL[ritmo.motivo],
      CONFIANCA: CONFIANCA_LABEL[ritmo.confianca] ?? ritmo.confianca,
      ULTIMA_VENDA_MES: ritmo.ultimaVendaMes ? mesLabel(ritmo.ultimaVendaMes) : "",
      MESES_PARADO: ritmo.mesesParado,
      QTDE_3M: roundInt(somaUltimos(3)),
      QTDE_12M: roundInt(somaUltimos(12)),
      COBERTURA_MESES: projecao.coberturaMeses != null ? round2(projecao.coberturaMeses) : null,
      DIAS_PARA_ACABAR: diasSentinela,
      DATA_ACABA:
        !semGiro && projecao.diasParaAcabar != null
          ? addDiasYmd(hoje.ymd, Math.ceil(projecao.diasParaAcabar))
          : "",
      PROJECAO_TOTAL: projecaoTotal,
      // Demanda/falta ignoram o modo e o teto de estoque de propósito: são a régua de
      // compra, e precisam ser o mesmo número com "Considerar estoque" ligado ou não.
      DEMANDA_HORIZONTE: roundInt(projecao.demandaHorizonte),
      FALTA_HORIZONTE: roundInt(Math.max(0, projecao.demandaHorizonte - acc.estoque)),
      SOBRA_HORIZONTE: roundInt(projecao.sobra),
    };

    calculadas.push({
      row,
      projecaoPorMes,
      mesesUsados: Math.max(1, mesesUsados),
      semGiro,
      zerado: acc.estoque <= 0,
      proj90,
    });
  }

  // ── Colunas de mês ──────────────────────────────────────────────────────────────────
  // Com estoque: do mês corrente até o mês em que o ÚLTIMO item zera (item que não zera
  // dentro do horizonte estica para o horizonte inteiro). Sem estoque (modo demanda): nada
  // "acaba", então sempre o horizonte inteiro.
  const horizonteUsado = !considerarEstoque
    ? PROJECAO_HORIZONTE_MESES
    : calculadas.some((c) => c.row.DIAS_PARA_ACABAR === DIAS_ACABAR_EXCEDE)
      ? PROJECAO_HORIZONTE_MESES
      : Math.max(1, ...calculadas.map((c) => c.mesesUsados));

  const dynamicColumns: ReportColumnDef[] = [];
  const mesesColuna: string[] = [];
  for (let i = 0; i < horizonteUsado; i += 1) {
    const mes = addMeses(mesAtual, i);
    mesesColuna.push(mes);
    dynamicColumns.push({
      key: `${PROJECAO_MES_COL_PREFIX}${mes}`,
      defaultLabel: mesLabel(mes),
      type: "int",
    });
  }

  const rows: ReportRow[] = calculadas.map((c) => {
    for (const mes of mesesColuna) {
      c.row[`${PROJECAO_MES_COL_PREFIX}${mes}`] = c.projecaoPorMes.get(mes) ?? 0;
    }
    return c.row;
  });

  // ── KPIs ───────────────────────────────────────────────────────────────────────────
  const estoqueTotal = rows.reduce((s, r) => s + Number(r.ESTOQUE_REDE ?? 0), 0);
  const valorEstoque = rows.reduce((s, r) => s + Number(r.VALOR_ESTOQUE ?? 0), 0);
  const proj90Total = calculadas.reduce((s, c) => s + c.proj90, 0);
  const demandaTotal = rows.reduce((s, r) => s + Number(r.DEMANDA_HORIZONTE ?? 0), 0);
  const faltaTotal = rows.reduce((s, r) => s + Number(r.FALTA_HORIZONTE ?? 0), 0);
  const semGiroCount = calculadas.filter((c) => c.semGiro).length;
  const zeradosCount = calculadas.filter((c) => c.zerado).length;
  const summary: ReportSummaryMetric[] = [
    { label: "Itens (produto × cor)", value: rows.length, format: "int" },
    { label: "Estoque atual (un)", value: roundInt(estoqueTotal), format: "int" },
    { label: "Valor do estoque", value: round2(valorEstoque), format: "currency" },
    {
      label: considerarEstoque ? "Projeção 3 meses (un)" : "Demanda 3 meses (un)",
      value: roundInt(proj90Total),
      format: "int",
    },
    { label: "Demanda 12 meses (un)", value: roundInt(demandaTotal), format: "int" },
    { label: "Falta p/ atender 12 meses", value: roundInt(faltaTotal), format: "int" },
    { label: "Itens sem giro", value: semGiroCount, format: "int" },
    { label: "Itens zerados", value: zeradosCount, format: "int" },
  ];

  await applyColecaoLabels(filters.company, rows);

  return { rows, total: rows.length, truncated: false, summary, dynamicColumns };
}

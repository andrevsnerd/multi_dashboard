import {
  getFilialLabelForDisplay,
  VAREJO_VALUE,
} from "@/lib/config/company";
import { resolveCompanyLive } from "@/lib/server/company-live";
import { fetchColecaoCodeByProduto, getColecaoDescMap } from "@/lib/repositories/colecao";
import { fetchProductsWithDetails } from "@/lib/repositories/products";

/**
 * Monta o payload do deck "Top Produtos (Campeões de Venda)" do Gerador de
 * Apresentações — porte fiel do modelo `scarfme-campeoes-<mês>.html`:
 *
 *   01 capa · 02 top 10 da rede · 03+ sumário · N páginas de categoria ·
 *   última(s) página(s) "Demais categorias".
 *
 * CATEGORIA = a dimensão que quebra o deck em páginas. Na ScarfMe é o SUBGRUPO
 * (como no modelo original); no NERD é o GRUPO — os subgrupos do NERD são finos
 * demais para render página. Quem manda é `DIMENSAO_POR_EMPRESA`, e o payload
 * leva os rótulos ("subgrupo"/"grupo") prontos para o deck escrever.
 *
 * VENDAS/FATURAMENTO usam a ÚNICA lógica válida do sistema
 * (`fetchProductsWithDetails` com `groupByColor: true`): base LOJA_VENDA_PRODUTO
 * com FATOR_DESCONTO_VENDA e dedução de trocas (LOJA_VENDA_TROCA), mais
 * e-commerce por faturamento. É a mesma fonte da análise "Vendas por faturamento"
 * do Gerador de Relatórios — que é exatamente a planilha que originou o modelo.
 *
 * O grão do ranking é o ITEM = produto × cor (como na planilha de origem).
 */

/** Itens mínimos para uma categoria ganhar página própria… */
const MIN_ITENS_PAGINA = 4;
/** …ou, com menos itens, participação mínima na rede (%) para não ir pro complemento. */
const MIN_PERC_REDE_PAGINA = 0.5;
/** Itens por página de categoria (e do top da rede). */
const TOP_N = 10;
/** Até este total de itens a categoria sai em cards grandes em vez de tabela. */
const MAX_ITENS_CARDS = 4;
/** Linhas do sumário por página (2 colunas × 12). */
const SUMARIO_POR_PAGINA = 24;
/**
 * Linhas (categoria + produtos) por coluna na página "Demais categorias".
 * As linhas são flex e encolhem um pouco além disso, então 17 é a densidade do
 * modelo sem estourar a altura do slide.
 */
const MENORES_POR_COLUNA = 17;

export interface TopProdutosParams {
  company?: string;
  filial?: string | null;
  range?: { start?: string; end?: string };
}

/** Dimensão que quebra o deck em páginas. */
export type TopProdutosDimensaoKey = "subgrupo" | "grupo";

export interface TopProdutosDimensao {
  key: TopProdutosDimensaoKey;
  /** "subgrupo" — usado no meio da frase. */
  singular: string;
  /** "subgrupos". */
  plural: string;
  /** "Subgrupo" — início de frase / cabeçalho. */
  singularCap: string;
  /** "Subgrupos". */
  pluralCap: string;
}

/** Empresa → dimensão. Ausente = subgrupo (padrão do modelo ScarfMe). */
const DIMENSAO_POR_EMPRESA: Record<string, TopProdutosDimensaoKey> = {
  nerd: "grupo",
};

const DIMENSOES: Record<TopProdutosDimensaoKey, TopProdutosDimensao> = {
  subgrupo: {
    key: "subgrupo",
    singular: "subgrupo",
    plural: "subgrupos",
    singularCap: "Subgrupo",
    pluralCap: "Subgrupos",
  },
  grupo: {
    key: "grupo",
    singular: "grupo",
    plural: "grupos",
    singularCap: "Grupo",
    pluralCap: "Grupos",
  },
};

function resolveDimensao(company: string | undefined): TopProdutosDimensao {
  const key = DIMENSAO_POR_EMPRESA[(company ?? "").trim().toLowerCase()] ?? "subgrupo";
  return DIMENSOES[key];
}

export interface TopProdutosItem {
  rank: number;
  /** Código do produto (ex.: "13.46.0445"). */
  produto: string;
  descricao: string;
  cor: string;
  colecaoDesc: string;
  colecaoCode: string;
  grade: string;
  linha: string;
  /** Nome da categoria do item (subgrupo na ScarfMe, grupo no NERD). */
  categoria: string;
  faturamento: number;
  qtde: number;
  precoMedio: number;
  /** Largura da barra: líder do próprio ranking = 100%. */
  barPct: number;
}

export interface TopProdutosCategoriaSlide {
  categoria: string;
  /** Posição da categoria entre as que têm página (1ª, 2ª…). */
  rank: number;
  /** Linhas (LINHA) presentes na categoria, ordenadas. */
  linhas: string[];
  itensComVenda: number;
  faturamento: number;
  qtde: number;
  percRede: number;
  /** % do faturamento da categoria concentrado nos itens exibidos. */
  topPerc: number;
  items: TopProdutosItem[];
  /** Tabela (padrão) ou cards grandes (poucos itens). */
  layout: "table" | "cards";
  /** Rodapé de observação quando todos os itens da categoria estão listados. */
  note: string | null;
  /** Tamanho do título no cabeçalho (o modelo reduz conforme o nome cresce). */
  titleFontSize: string;
}

export interface TopProdutosSumarioRow {
  ordem: number;
  categoria: string;
  itensComVenda: number;
  qtde: number;
  faturamento: number;
  barPct: number;
  pagina: number;
}

export interface TopProdutosMenorGrupo {
  categoria: string;
  faturamento: number;
  qtde: number;
  items: Array<{ descricao: string; cor: string; faturamento: number; qtde: number }>;
}

export interface TopProdutosPayload {
  /** Rótulos da dimensão das páginas (subgrupo na ScarfMe, grupo no NERD). */
  dimensao: TopProdutosDimensao;
  period: {
    start: string;
    end: string;
    /** "JULHO 2026" (ou "JUL–AGO 2026" quando cruza meses). */
    label: string;
    /** "01/07/2026 a 31/07/2026". */
    range: string;
    /** "julho de 2026" — usado nos subtítulos. */
    longLabel: string;
    /** "mês" quando o período é um mês fechado; "período" quando não é. */
    unit: string;
  };
  scope: {
    /** "todas as filiais" · "lojas físicas" · nome da filial. */
    label: string;
    /** "na rede" · "nas lojas físicas" · "em MORUMBI 2". */
    inLabel: string;
    /** "rede completa" · nome da filial (eyebrow da capa). */
    eyebrow: string;
    /** "da rede" · "das lojas físicas" · "de MORUMBI 2" (ex.: "1º grupo da rede"). */
    ofLabel: string;
    /** Rótulo do chip de participação: "% da rede" · "% do total". */
    pctLabel: string;
  };
  totals: {
    faturamento: number;
    pecas: number;
    itensComVenda: number;
    categorias: number;
  };
  /** Top 10 da rede/filial: os 3 primeiros vão no pódio, o resto na tabela. */
  network: {
    items: TopProdutosItem[];
    faturamento: number;
    qtde: number;
    percRede: number;
  };
  /** Sumário paginado (cada página vira um slide). */
  sumarioPages: TopProdutosSumarioRow[][];
  slides: TopProdutosCategoriaSlide[];
  /** Complemento: categorias pequenas, paginado. */
  menores: {
    categorias: number;
    faturamento: number;
    percRede: number;
    /** Cada página tem 2 colunas de grupos (já quebradas). */
    pages: TopProdutosMenorGrupo[][][];
  };
  /** Total de páginas do deck (capa incluída) — usado no "04 / 28". */
  totalPages: number;
}

const MESES = [
  "JANEIRO",
  "FEVEREIRO",
  "MARÇO",
  "ABRIL",
  "MAIO",
  "JUNHO",
  "JULHO",
  "AGOSTO",
  "SETEMBRO",
  "OUTUBRO",
  "NOVEMBRO",
  "DEZEMBRO",
];

function isoToDate(iso: string): Date | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDateBr(iso: string): string {
  const d = isoToDate(iso);
  if (!d) return iso;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** "JULHO 2026" quando o período cabe num mês; "JUL–AGO 2026" quando cruza. */
function buildPeriodLabels(startIso: string, endIso: string) {
  const s = isoToDate(startIso);
  const e = isoToDate(endIso);
  if (!s || !e) return { label: "", longLabel: "", unit: "período" };
  const mesS = MESES[s.getMonth()];
  const mesE = MESES[e.getMonth()];
  if (s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear()) {
    return {
      label: `${mesS} ${s.getFullYear()}`,
      longLabel: `${mesS.toLowerCase()} de ${s.getFullYear()}`,
      unit: "mês",
    };
  }
  const anoSuffix =
    s.getFullYear() === e.getFullYear() ? `${e.getFullYear()}` : `${s.getFullYear()}–${e.getFullYear()}`;
  return {
    label: `${mesS.slice(0, 3)}–${mesE.slice(0, 3)} ${anoSuffix}`,
    longLabel: `${mesS.toLowerCase()} a ${mesE.toLowerCase()} de ${e.getFullYear()}`,
    unit: "período",
  };
}

/** O modelo encolhe o título da categoria conforme o nome cresce. */
function titleFontSizeFor(name: string): string {
  const len = name.trim().length;
  if (len <= 15) return "36px";
  if (len <= 21) return "31px";
  return "27px";
}

function clean(value: string | null | undefined): string {
  const t = (value ?? "").trim();
  return t === "-" ? "" : t;
}

function pct(part: number, total: number): number {
  return total > 0 ? (part / total) * 100 : 0;
}

/** Barras do modelo: líder do ranking = 100%, uma casa decimal. */
function barPctOf(value: number, leader: number): number {
  if (leader <= 0) return 0;
  return Math.round((value / leader) * 1000) / 10;
}

interface RawItem {
  produto: string;
  descricao: string;
  cor: string;
  colecaoDesc: string;
  colecaoCode: string;
  grade: string;
  linha: string;
  categoria: string;
  faturamento: number;
  qtde: number;
}

function toItems(raw: RawItem[], leader: number): TopProdutosItem[] {
  return raw.map((r, i) => ({
    rank: i + 1,
    produto: r.produto,
    descricao: r.descricao,
    cor: r.cor,
    colecaoDesc: r.colecaoDesc,
    colecaoCode: r.colecaoCode,
    grade: r.grade,
    linha: r.linha,
    categoria: r.categoria,
    faturamento: r.faturamento,
    qtde: r.qtde,
    precoMedio: r.qtde > 0 ? r.faturamento / r.qtde : 0,
    barPct: barPctOf(r.faturamento, leader),
  }));
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Rótulos de escopo (capa, subtítulos e rodapé) a partir do filtro de filial. */
async function resolveScope(company: string | undefined, filial: string | null | undefined) {
  if (!filial) {
    return {
      label: "todas as filiais",
      inLabel: "na rede",
      eyebrow: "rede completa",
      ofLabel: "da rede",
      pctLabel: "% da rede",
    };
  }
  if (filial === VAREJO_VALUE) {
    return {
      label: "lojas físicas",
      inLabel: "nas lojas físicas",
      eyebrow: "lojas físicas",
      ofLabel: "das lojas físicas",
      pctLabel: "% do total",
    };
  }
  const cfg = company ? await resolveCompanyLive(company).catch(() => null) : null;
  const label = getFilialLabelForDisplay(cfg, filial) || filial.trim();
  return {
    label,
    inLabel: `em ${label}`,
    eyebrow: label,
    ofLabel: `de ${label}`,
    pctLabel: "% do total",
  };
}

export async function fetchTopProdutosPresentation({
  company,
  filial,
  range,
}: TopProdutosParams): Promise<TopProdutosPayload> {
  const startIso = range?.start ?? "";
  const endIso = range?.end ?? "";
  const dimensao = resolveDimensao(company);

  const [details, scope] = await Promise.all([
    fetchProductsWithDetails({
      company,
      filial: filial ?? null,
      range: { start: startIso, end: endIso },
      groupByColor: true,
    }),
    resolveScope(company, filial),
  ]);

  // Coleção sempre da tabela MESTRE COLECOES (o item pode nem ter descrição na venda).
  const produtoIds = details.map((d) => String(d.productId ?? "").trim()).filter(Boolean);
  const [descByCode, codeByProduto] = await Promise.all([
    getColecaoDescMap(),
    fetchColecaoCodeByProduto(produtoIds),
  ]);

  const raw: RawItem[] = details
    .map((d) => {
      const produto = String(d.productId ?? "").trim();
      const colecaoCode = codeByProduto.get(produto) ?? "";
      return {
        produto,
        descricao: clean(d.productName) || produto,
        cor: clean(d.descCorProduto),
        colecaoDesc: colecaoCode ? descByCode.get(colecaoCode) ?? "" : "",
        colecaoCode,
        grade: clean(d.grade),
        linha: clean(d.linha),
        categoria:
          dimensao.key === "grupo"
            ? clean(d.grupo) || "SEM GRUPO"
            : clean(d.subgrupo) || "SEM SUBGRUPO",
        faturamento: d.totalRevenue ?? 0,
        qtde: d.totalQuantity ?? 0,
      };
    })
    // ATENÇÃO: NÃO filtre por faturamento aqui. `raw` tem que ser EXATAMENTE o
    // conjunto de linhas que a regra global devolve (mesmo grão da análise
    // "Vendas por faturamento"), inclusive as NEGATIVAS (trocas maiores que a
    // venda) e as zeradas. Tirar as negativas inflava o faturamento e fazia o
    // deck divergir do Dashboard / Gerador de Relatórios (bug real:
    // +R$ 1.973,80 em agosto/2026); tirar as zeradas mudava a contagem de itens.
    // Os RANKINGS usam `positivos` (abaixo); os TOTAIS usam `raw` inteiro.
    .filter((r) => r.produto)
    .sort((a, b) => b.faturamento - a.faturamento);

  const totalFaturamento = raw.reduce((s, r) => s + r.faturamento, 0);
  const totalPecas = raw.reduce((s, r) => s + r.qtde, 0);
  const { label: periodLabel, longLabel, unit: periodUnit } = buildPeriodLabels(startIso, endIso);

  // ---- agrupa pela categoria da empresa (subgrupo · grupo) ----
  const byCategoria = new Map<string, RawItem[]>();
  for (const item of raw) {
    const list = byCategoria.get(item.categoria);
    if (list) list.push(item);
    else byCategoria.set(item.categoria, [item]);
  }

  const grupos = Array.from(byCategoria.entries())
    .map(([categoria, items]) => {
      const faturamento = items.reduce((s, r) => s + r.faturamento, 0);
      return {
        categoria,
        items,
        faturamento,
        qtde: items.reduce((s, r) => s + r.qtde, 0),
        percRede: pct(faturamento, totalFaturamento),
        linhas: Array.from(new Set(items.map((r) => r.linha).filter(Boolean))).sort((a, b) =>
          a.localeCompare(b, "pt-BR")
        ),
      };
    })
    .sort((a, b) => b.faturamento - a.faturamento);

  // Categoria ganha página quando tem itens suficientes OU peso relevante na rede
  // (é o que faz um subgrupo de 1 item campeão, tipo MODAL COM SEDA, ter página).
  // Sem nenhum item positivo não há ranking para mostrar → vai pro complemento.
  const temPagina = (g: (typeof grupos)[number]) =>
    g.items.some((r) => r.faturamento > 0) &&
    (g.items.length >= MIN_ITENS_PAGINA || g.percRede >= MIN_PERC_REDE_PAGINA);
  const comPagina = grupos.filter(temPagina);
  const menoresGrupos = grupos.filter((g) => !temPagina(g));

  // ---- complemento: quebra em colunas ANTES de paginar ----
  // O grupo e seus produtos nunca se separam, então a quebra real é a única fonte
  // do nº de páginas — a numeração "04 / 28" depende dela.
  const menoresColumns: TopProdutosMenorGrupo[][] = [];
  let currentColumn: TopProdutosMenorGrupo[] = [];
  let currentRows = 0;
  for (const g of menoresGrupos) {
    const rows = 1 + g.items.length;
    if (currentRows > 0 && currentRows + rows > MENORES_POR_COLUNA) {
      menoresColumns.push(currentColumn);
      currentColumn = [];
      currentRows = 0;
    }
    currentColumn.push({
      categoria: g.categoria,
      faturamento: g.faturamento,
      qtde: g.qtde,
      items: g.items.map((r) => ({
        descricao: r.descricao,
        cor: r.cor,
        faturamento: r.faturamento,
        qtde: r.qtde,
      })),
    });
    currentRows += rows;
  }
  if (currentColumn.length > 0) menoresColumns.push(currentColumn);

  // ---- paginação (a numeração "04 / 28" precisa saber tudo antes) ----
  const sumarioPagesCount = Math.ceil(comPagina.length / SUMARIO_POR_PAGINA);
  const menoresPages = chunk(menoresColumns, 2);
  const firstCategoriaPage = 2 + sumarioPagesCount + 1; // capa + top10 + sumário(s)
  const totalPages = firstCategoriaPage - 1 + comPagina.length + menoresPages.length;

  // ---- slide 02: top 10 da rede ----
  // Ranking = só itens com faturamento POSITIVO ("campeões de venda"); os
  // negativos continuam nos totais e nos números do subgrupo.
  const positivos = raw.filter((r) => r.faturamento > 0);
  const networkRaw = positivos.slice(0, TOP_N);
  const networkLeader = networkRaw[0]?.faturamento ?? 0;
  const networkItems = toItems(networkRaw, networkLeader);
  const networkFaturamento = networkRaw.reduce((s, r) => s + r.faturamento, 0);

  // ---- sumário ----
  const sumarioLeader = comPagina[0]?.faturamento ?? 0;
  const sumarioRows: TopProdutosSumarioRow[] = comPagina.map((g, i) => ({
    ordem: i + 1,
    categoria: g.categoria,
    itensComVenda: g.items.length,
    qtde: g.qtde,
    faturamento: g.faturamento,
    barPct: barPctOf(g.faturamento, sumarioLeader),
    pagina: firstCategoriaPage + i,
  }));

  // ---- páginas de categoria ----
  const slides: TopProdutosCategoriaSlide[] = comPagina.map((g, i) => {
    // Ranking da categoria: só positivos. Faturamento/peças/% da categoria seguem
    // sendo o LÍQUIDO de todos os itens (senão a soma das páginas não fecharia
    // com o total do deck nem com o Dashboard).
    const positivosGrupo = g.items.filter((r) => r.faturamento > 0);
    const shown = positivosGrupo.slice(0, TOP_N);
    const leader = shown[0]?.faturamento ?? 0;
    const layout: "table" | "cards" = shown.length <= MAX_ITENS_CARDS ? "cards" : "table";
    const todosListados = shown.length === positivosGrupo.length;
    const negativos = g.items.length - positivosGrupo.length;
    // O share do top N pode passar de 100% quando a categoria tem itens negativos
    // (o líquido dela é menor que a soma dos positivos) — limita em 100%.
    const topPerc = Math.min(
      100,
      pct(
        shown.reduce((s, r) => s + r.faturamento, 0),
        g.faturamento
      )
    );
    return {
      categoria: g.categoria,
      rank: i + 1,
      linhas: g.linhas,
      itensComVenda: g.items.length,
      faturamento: g.faturamento,
      qtde: g.qtde,
      percRede: g.percRede,
      topPerc,
      items: toItems(shown, leader),
      layout,
      note:
        layout === "table" && todosListados
          ? negativos === 0
            ? `Este ${dimensao.singular} teve apenas ${g.items.length} itens com venda no ${periodUnit} — todos estão listados acima.`
            : `Este ${dimensao.singular} teve ${g.items.length} itens com venda no ${periodUnit}; os ${positivosGrupo.length} com faturamento positivo estão listados acima (${negativos} ficaram negativos por trocas).`
          : null,
      titleFontSize: titleFontSizeFor(g.categoria),
    };
  });

  const menoresFaturamento = menoresGrupos.reduce((s, g) => s + g.faturamento, 0);

  return {
    dimensao,
    period: {
      start: startIso,
      end: endIso,
      label: periodLabel,
      range: startIso && endIso ? `${fmtDateBr(startIso)} a ${fmtDateBr(endIso)}` : "",
      longLabel,
      unit: periodUnit,
    },
    scope,
    totals: {
      faturamento: totalFaturamento,
      pecas: totalPecas,
      itensComVenda: raw.length,
      categorias: grupos.length,
    },
    network: {
      items: networkItems,
      faturamento: networkFaturamento,
      qtde: networkRaw.reduce((s, r) => s + r.qtde, 0),
      percRede: pct(networkFaturamento, totalFaturamento),
    },
    sumarioPages: chunk(sumarioRows, SUMARIO_POR_PAGINA),
    slides,
    menores: {
      categorias: menoresGrupos.length,
      faturamento: menoresFaturamento,
      percRede: pct(menoresFaturamento, totalFaturamento),
      pages: menoresPages,
    },
    totalPages,
  };
}

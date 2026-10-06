import sql from "mssql";

import {
  getFilialLabelForDisplay,
  VAREJO_VALUE,
  type CompanyKey,
} from "@/lib/config/company";
import { resolveCompanyLive, liveNameForIncoming } from "@/lib/server/company-live";
import { withRequest } from "@/lib/db/connection";
import type { RequestLike } from "@/lib/db/proxy";
import { canonicalKey } from "@/lib/reports/keys";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import { fetchProductsWithDetails } from "@/lib/repositories/products";
import { fetchProdutoQtdePorFilial } from "@/lib/repositories/performance";
import { fetchTicketItens } from "@/lib/repositories/reportTickets";
import {
  describeItemFilters,
  type PresentationItemFilters,
} from "@/lib/presentations/item-filters";

/**
 * Monta o payload do deck "Relatório Completo de Coleção" do Gerador de
 * Apresentações.
 *
 * VENDAS/FATURAMENTO usam a MESMA lógica VALIDADA da tela de Produtos e do
 * Gerador de Relatórios (`fetchProductsWithDetails` + `fetchProdutoQtdePorFilial`):
 * base LOJA_VENDA_PRODUTO com FATOR_DESCONTO_VENDA e dedução de trocas
 * (LOJA_VENDA_TROCA), mais e-commerce por faturamento (natureza 100.02/100.022).
 * Antes usava `fetchCollectionReport` (tabela contábil W_CTB, desconto absoluto e
 * SEM trocas), o que divergia do relatório de vendas/produtos por venda.
 *
 * ESTOQUE segue a REGRA GLOBAL, igual ao resto do app: soma só saldos POSITIVOS
 * ([[estoque-negativos-nunca-contam]]). A linha de um SKU pode aparecer negativa
 * (quando ele não tem nenhum saldo positivo na rede — é informação real), mas
 * negativo NUNCA entra numa soma (total da coleção e linha "Outros").
 * Antes era saldo líquido cru, copiado do protótipo; estava errado — negativo de
 * uma filial abatia o positivo de outra e o estoque saía menor que o real.
 */

/**
 * Destaque opcional: um CONJUNTO de produtos da própria coleção que ganha um
 * slide extra (logo depois da lista geral de produtos).
 *
 * `termo` usa o MESMO reconhecimento do Gerador de Relatórios (`DESC_PRODUTO
 * LIKE '%termo%'`, mínimo 2 caracteres). `produtoIds` é o refinamento manual da
 * lista reconhecida (o usuário desmarca o que não quer) e, quando vem
 * preenchido, manda. Em qualquer caso o conjunto é intersectado com os SKUs da
 * coleção do deck — nunca entra produto de fora dela.
 */
export interface ColecaoDestaqueParams {
  /** Termo digitado (ex.: "Dracena"). */
  termo?: string;
  /** Título do slide; vazio = derivado do termo/nomes dos produtos. */
  nome?: string;
  /** Subconjunto escolhido à mão entre os produtos reconhecidos. */
  produtoIds?: string[];
}

export interface ColecaoPresentationParams {
  company?: string;
  filial?: string | null;
  colecoes?: string[];
  range?: { start?: string; end?: string };
  /**
   * Recorte da coleção pelo cadastro (grupo/subgrupo/linha/grade), ex.: só o
   * subgrupo CETIM DE SEDA da ESSENTIALS. Vale para o deck INTEIRO (KPIs, produtos,
   * lojas, destaque e a prévia de vendas): é repassado à `fetchProductsWithDetails`.
   */
  filtros?: PresentationItemFilters | null;
  /** Descrição da coleção (label do multiselect) para o título/capa. */
  collectionLabel?: string;
  /** Conjunto de produtos em destaque (slide extra opcional). */
  destaque?: ColecaoDestaqueParams;
  /**
   * true = a tabela de produtos lista TODAS as linhas (o deck quebra em várias
   * páginas de `productsPerSlide`), sem a linha "Outros".
   * false (padrão) = top `PRODUCTS_LIMIT` + "Outros".
   */
  todosProdutos?: boolean;
  /**
   * true = a tabela vira 1 linha por PRODUTO, somando as cores.
   * As linhas são AGRUPADAS a partir dos mesmos SKUs já calculados — nunca uma
   * consulta nova —, então faturamento/peças/estoque somam idêntico nos 2 modos.
   */
  produtoTotal?: boolean;
  /**
   * Vendas a TIRAR do relatório: chaves (`VendaColecaoRow.key`) escolhidas na prévia
   * de vendas da página. Ver `fetchVendasDaColecao`.
   */
  excluirVendas?: string[];
}

/**
 * Uma linha de venda da coleção: item de ticket (loja) ou de nota (e-commerce), no
 * grão ticket × produto × cor × tamanho. É o que a página lista para o usuário
 * escolher o que sai do relatório.
 */
export interface VendaColecaoRow {
  /** Identidade estável da linha; é o que a página manda de volta em `excluirVendas`. */
  key: string;
  canal: "LOJA" | "ECOMMERCE";
  /** Rótulo da loja; e-commerce sai como "E-COMMERCE" (mesmo balde do deck). */
  loja: string;
  /** Nº do ticket (loja) ou da NF (e-commerce). */
  documento: string;
  /** AAAA-MM-DD. */
  data: string;
  produto: string;
  nome: string;
  cor: string;
  corDescricao: string;
  tamanho: string;
  /**
   * Códigos de barra da variação vendida (PRODUTOS_BARRA): na loja, os do tamanho
   * vendido, com o código bipado no caixa primeiro; no e-commerce (sem grade), todos
   * os da cor. É o que deixa filtrar/colar a lista pelo código de barra.
   */
  codigosBarra: string[];
  qtd: number;
  valor: number;
}

/** Resumo do que foi tirado do deck (a página mostra; o deck não). */
export interface ColecaoExclusoesResumo {
  linhas: number;
  qtd: number;
  venda: number;
  /** Chaves pedidas que não existem mais na venda do período (dado mudou no Linx). */
  naoEncontradas: number;
}

export interface PresentationProductRow {
  rank: number;
  /** Código do produto (sem padding) — usado para casar o conjunto em destaque. */
  productId: string;
  nome: string;
  colorDescription: string;
  grade: string;
  tipo: string;
  qtd: number;
  precoMedio: number;
  venda: number;
  estoque: number;
  barWidthPct: number;
  participacaoPct: number;
}

export interface PresentationStoreRow {
  nome: string;
  venda: number;
  qtd: number;
  participacaoPct: number;
}

export interface PresentationStoreBar {
  nome: string;
  venda: number;
  widthPct: number;
  pctLabel: string;
  showPctInside: boolean;
  color: string;
}

/** Payload do slide de destaque (ausente quando nada foi pedido/reconhecido). */
export interface PresentationDestaquePayload {
  /** Título do slide (informado pelo usuário ou derivado). */
  titulo: string;
  /** Linha de apoio ("3 itens de 2 produtos reconhecidos por 'Dracena'"). */
  subtitulo: string;
  /** Termo usado no reconhecimento (vazio quando a seleção foi só manual). */
  termo: string;
  /** Itens (produto × cor) do conjunto, do maior para o menor faturamento. */
  items: PresentationProductRow[];
  /** Cauda do conjunto quando ele passa de DESTAQUE_ITEMS_LIMIT itens. */
  outros: { count: number; qtd: number; venda: number; estoque: number } | null;
  totals: {
    venda: number;
    qtd: number;
    estoque: number;
    precoMedio: number;
    /** % do faturamento da COLEÇÃO que o conjunto representa. */
    participacaoPct: number;
    /** SKUs (produto × cor) do conjunto. */
    skus: number;
    /** Produtos distintos do conjunto. */
    produtos: number;
  };
  /** Barra "conjunto × resto da coleção". */
  shareBar: { destaquePct: number; restoPct: number; restoVenda: number };
  /** Canal que mais vendeu o conjunto (% dentro do próprio conjunto). */
  topCanal: { nome: string; venda: number; participacaoPct: number } | null;
  insight: { titulo: string; texto: string };
}

export interface ColecaoPresentationPayload {
  /** `recorte` = texto dos filtros de item ("Subgrupo: CETIM DE SEDA"); null = coleção inteira. */
  collection: { code: string; fullName: string; recorte: string | null };
  period: { start: string; end: string; label: string; short: string };
  kpis: {
    faturamento: number;
    pecasVendidas: number;
    nSkus: number;
    precoMedio: number;
    estoqueRestante: number;
    canaisAtivos: number;
  };
  channel: {
    hasEcommerce: boolean;
    ecommerceShare: number;
    retailShare: number;
    ecommerceRevenue: number;
    retailRevenue: number;
  };
  topProducts: PresentationProductRow[];
  products: PresentationProductRow[];
  /**
   * Linhas por slide da tabela de produtos. O deck pagina `products` com isso
   * (não pode importar a constante: este módulo é server/mssql).
   */
  productsPerSlide: number;
  /** Total de linhas da tabela (SKUs ou produtos, conforme `produtoTotal`). */
  productsTotalCount: number;
  /** true = tabela agrupada por produto (cores somadas na mesma linha). */
  productsPorProduto: boolean;
  /**
   * TODOS os SKUs (produto × cor) com id e quantidade — sem o corte de
   * PRODUCTS_LIMIT que `products` aplica. Existe para quem consome este payload no
   * servidor precisar da base completa (ex.: o comparativo entre coleções calcula
   * custo/markup a partir daqui em vez de refazer a consulta de produtos).
   */
  skus: Array<{ productId: string; qtd: number }>;
  outros: { count: number; qtd: number; venda: number; estoque: number } | null;
  /** Slide extra de destaque; null quando não foi pedido ou nada casou. */
  destaque: PresentationDestaquePayload | null;
  /** Vendas tiradas a pedido do usuário; null quando nada foi tirado. */
  exclusoes: ColecaoExclusoesResumo | null;
  insightProdutos: { titulo: string; texto: string };
  stores: PresentationStoreRow[];
  storesTotal: { venda: number; qtd: number };
  storeChartSubtitle: string;
  storeBars: PresentationStoreBar[];
  closing: {
    insightA: { titulo: string; texto: string };
    insightB: { titulo: string; texto: string };
    footKpis: Array<{ label: string; value: string; fontSize: string }>;
  };
}

// Cores das barras: variáveis do tema do deck (ColecaoDeck.module.css), não hex
// fixo — assim as barras seguem a paleta escolhida no Gerador (paleta do Painel
// de Coleções ou manual) sem o payload saber qual é.
const ACCENT = "var(--accent)";
const ACCENT_DARK = "var(--accent-d)";
const ECOMMERCE_BUCKET = "E-COMMERCE";
const PRODUCTS_LIMIT = 12; // linhas antes de agrupar o restante em "Outros".
const DESTAQUE_ITEMS_LIMIT = 12; // itens listados no slide de destaque.
/** Mesmo piso do `produtoSearchTerm` do Gerador de Relatórios. */
const DESTAQUE_MIN_TERM = 2;

/** Normaliza cor para casar '06' com '6' (duas fontes divergem no formato). */
function normalizeCor(value: string): string {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return "";
  const num = Number(trimmed);
  return Number.isFinite(num) && /^\d+$/.test(trimmed) ? String(num) : trimmed.toUpperCase();
}

function skuKey(productId: string, cor: string): string {
  return `${productId.trim()}||${normalizeCor(cor)}`;
}

function fmtDateShort(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}`;
}

function fmtInt(value: number): string {
  return Math.round(value).toLocaleString("pt-BR");
}

function fmtCurrency(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}

function fmtPct(value: number): string {
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

/**
 * Estoque da rede por produto × cor pela REGRA GLOBAL ([[estoque-negativos-nunca-contam]]):
 * soma só os saldos POSITIVOS das filiais; o negativo só aparece quando o SKU não
 * tem nenhum saldo positivo (aí ele é exibido negativo, para o problema não virar
 * um zero silencioso) — mesma lógica de `fetchMultipleProductsStockByColor`.
 *
 * Antes somava cru (`SUM(ESTOQUE)`), então um saldo negativo numa filial abatia o
 * positivo de outra e o total do deck ficava menor que o real.
 *
 * O casamento de cor é feito aqui (chave `skuKey`, que normaliza '06'≡'6') em vez
 * de no SQL porque venda e estoque divergem no formato do código de cor
 * ([[cor-produto-formato-duas-fontes]]) — match exato perderia SKUs.
 */
async function fetchNetworkStock(productIds: string[]): Promise<Map<string, number>> {
  const uniqueIds = Array.from(new Set(productIds.map((id) => id.trim()).filter(Boolean)));
  const stock = new Map<string, number>();
  if (uniqueIds.length === 0) return stock;

  await withRequest(async (request) => {
    uniqueIds.forEach((id, index) => request.input(`pid${index}`, sql.VarChar, id));
    const placeholders = uniqueIds.map((_, i) => `@pid${i}`).join(", ");

    const stockRes = await request.query<{ PRODUTO: string; COR: string; POS: number; NEG: number }>(`
      SELECT
        ISNULL(e.PRODUTO, '') AS PRODUTO,
        ISNULL(e.COR_PRODUTO, '') AS COR,
        CAST(SUM(CASE WHEN e.ESTOQUE > 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS POS,
        CAST(SUM(CASE WHEN e.ESTOQUE < 0 THEN e.ESTOQUE ELSE 0 END) AS FLOAT) AS NEG
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.PRODUTO IN (${placeholders})
      GROUP BY ISNULL(e.PRODUTO, ''), ISNULL(e.COR_PRODUTO, '')
    `);
    for (const row of stockRes.recordset) {
      const pos = Number(row.POS ?? 0);
      const neg = Number(row.NEG ?? 0);
      stock.set(skuKey(row.PRODUTO ?? "", row.COR ?? ""), Math.round(pos > 0 ? pos : neg));
    }
  });

  return stock;
}

/**
 * Recorte de item (`PresentationItemFilters`) como `AND p.X IN (...)` sobre PRODUTOS
 * `p` — usado só nas consultas de CADASTRO deste módulo (reconhecimento do destaque).
 * Venda nunca passa por aqui: vai pela `fetchProductsWithDetails` com os mesmos filtros.
 */
function itemFilterSql(
  request: sql.Request | RequestLike,
  filtros: PresentationItemFilters | null | undefined,
  prefix: string
): string {
  const cols: Array<[string[] | undefined, string, string]> = [
    [filtros?.grupos, "Gr", "p.GRUPO_PRODUTO"],
    [filtros?.subgrupos, "Sg", "p.SUBGRUPO_PRODUTO"],
    [filtros?.linhas, "Ln", "p.LINHA"],
    [filtros?.grades, "Gd", "CONVERT(VARCHAR, p.GRADE)"],
  ];
  return cols
    .map(([values, tag, col]) => {
      const list = (values ?? []).map((v) => v.trim().toUpperCase()).filter(Boolean);
      if (list.length === 0) return "";
      list.forEach((v, i) => request.input(`${prefix}${tag}${i}`, sql.VarChar, v));
      const ph = list.map((_, i) => `@${prefix}${tag}${i}`).join(", ");
      return `AND UPPER(LTRIM(RTRIM(ISNULL(${col}, '')))) IN (${ph})`;
    })
    .filter(Boolean)
    .join(" ");
}

/** A linha (de ticket) passa no recorte de item? Mesma regra do `itemFilterSql`. */
function rowMatchesItemFilters(
  row: { grupo: string; subgrupo: string; linha: string; grade: string },
  filtros: PresentationItemFilters | null | undefined
): boolean {
  const ok = (list: string[] | undefined, value: string) =>
    !list || list.length === 0 || list.includes((value ?? "").trim().toUpperCase());
  return (
    ok(filtros?.grupos, row.grupo) &&
    ok(filtros?.subgrupos, row.subgrupo) &&
    ok(filtros?.linhas, row.linha) &&
    ok(filtros?.grades, row.grade)
  );
}

export interface ColecaoProdutoMatch {
  productId: string;
  nome: string;
}

/**
 * Produtos de uma coleção cujo NOME casa com o termo digitado.
 *
 * O reconhecimento é o MESMO do Gerador de Relatórios: `DESC_PRODUTO LIKE
 * '%termo%'` com piso de 2 caracteres (ver `produtoSearchTerm` em
 * [products.ts](lib/repositories/products.ts)). A diferença é o escopo: aqui o
 * LIKE roda SEMPRE preso à(s) coleção(ões) do deck (`PRODUTOS.COLECAO`), então o
 * destaque não consegue trazer um produto de outra coleção.
 *
 * Serve a dois consumidores: a prévia da página (mostra o que foi reconhecido
 * antes de gerar) e o próprio payload do deck — assim a regra de reconhecimento
 * mora num lugar só e a prévia nunca divirja do slide.
 */
export async function fetchProdutosDaColecaoPorNome({
  colecoes,
  termo,
  filtros,
}: {
  colecoes?: string[];
  termo?: string;
  filtros?: PresentationItemFilters | null;
}): Promise<ColecaoProdutoMatch[]> {
  const term = (termo ?? "").trim();
  const codes = Array.from(
    new Set((colecoes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean))
  );
  if (term.length < DESTAQUE_MIN_TERM || codes.length === 0) return [];

  return withRequest(async (request) => {
    request.input("destaqueTermo", sql.VarChar, `%${term}%`);
    codes.forEach((c, i) => request.input(`destaqueCol${i}`, sql.VarChar, c));
    const placeholders = codes.map((_, i) => `@destaqueCol${i}`).join(", ");
    const recorte = itemFilterSql(request, filtros, "destaqueIt");

    const res = await request.query<{ PRODUTO: string; NOME: string }>(`
      SELECT DISTINCT
        LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO,
        LTRIM(RTRIM(ISNULL(p.DESC_PRODUTO, ''))) AS NOME
      FROM PRODUTOS p WITH (NOLOCK)
      WHERE p.DESC_PRODUTO LIKE @destaqueTermo
        AND UPPER(LTRIM(RTRIM(ISNULL(p.COLECAO, '')))) IN (${placeholders})
        ${recorte}
      ORDER BY NOME
    `);

    return res.recordset
      .map((r) => ({ productId: (r.PRODUTO ?? "").trim(), nome: (r.NOME ?? "").trim() }))
      .filter((r) => r.productId);
  });
}

/**
 * Vendas da coleção LINHA A LINHA (ticket/NF × produto × cor × tamanho) no mesmo
 * escopo do deck (coleção + período + filial).
 *
 * Fonte: `fetchTicketItens` — a base de "Tickets detalhados" do Gerador de
 * Relatórios, que segue a regra canônica com trocas e fecha ao centavo com
 * `fetchProductsWithDetails`. Por isso tirar uma linha daqui do total do deck dá
 * exatamente o número que o relatório teria sem aquela venda.
 *
 * O filtro de coleção da análise escolhe o TICKET inteiro; aqui só ficam os itens
 * que são da coleção. Linhas de troca/devolução (qtd negativa) também aparecem —
 * fazem parte da conta e também podem ser tiradas.
 */
export async function fetchVendasDaColecao({
  company,
  filial,
  colecoes,
  range,
  filtros,
}: Pick<ColecaoPresentationParams, "company" | "filial" | "colecoes" | "range" | "filtros">): Promise<
  VendaColecaoRow[]
> {
  const codes = new Set((colecoes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean));
  if (codes.size === 0) return [];

  const [{ rows }, companyLive] = await Promise.all([
    fetchTicketItens({
      company,
      filial: filial ?? null,
      start: range?.start,
      end: range?.end,
      colecoes: Array.from(codes),
      grupos: filtros?.grupos,
      subgrupos: filtros?.subgrupos,
      linhas: filtros?.linhas,
      grades: filtros?.grades,
    }),
    resolveCompanyLive(company),
  ]);

  // O filtro da análise escolhe o TICKET inteiro; aqui ficam só os itens da coleção
  // E do recorte (ex.: só o CETIM DE SEDA de um ticket que levou outras peças).
  const daColecao = rows
    .filter((r) => codes.has(r.colecao.trim().toUpperCase()))
    .filter((r) => rowMatchesItemFilters(r, filtros))
    .filter((r) => r.qtde !== 0 || r.valorItem !== 0);

  const barras = await fetchBarrasPorVariacao(daColecao.map((r) => r.produto));
  const barrasDaLinha = (r: (typeof daColecao)[number]): string[] => {
    const cor = normalizeCor(r.cor);
    const doTamanho = r.tamanho > 0 ? barras.get(`${r.produto}||${cor}||${r.tamanho}`) : undefined;
    const lista = doTamanho ?? barras.get(`${r.produto}||${cor}`) ?? [];
    const bipado = r.codigoBarra.trim();
    return bipado ? [bipado, ...lista.filter((c) => c !== bipado)] : lista;
  };

  return daColecao
    .map((r) => ({
      key: [
        r.canal,
        r.codigoFilial,
        r.ticket,
        r.dataVenda ?? "",
        r.produto,
        normalizeCor(r.cor),
        r.tamanho,
      ].join("~"),
      canal: r.canal,
      loja: r.canal === "ECOMMERCE" ? ECOMMERCE_BUCKET : storeBucket(companyLive, r.filial),
      documento: r.ticket,
      data: r.dataVenda ?? "",
      produto: r.produto,
      nome: r.descricao,
      cor: r.cor,
      corDescricao: r.corDescricao,
      tamanho:
        r.multiTamanho === 1 ? r.tamanhoLabel || (r.tamanho > 0 ? String(r.tamanho) : "") : "",
      codigosBarra: barrasDaLinha(r),
      qtd: r.qtde,
      valor: r.valorItem,
    }));
}

/**
 * Códigos de barra cadastrados (PRODUTOS_BARRA) por variação, em duas chaves:
 * `produto||cor||tamanho` (tamanho = ordinal da grade, ver
 * [[grade-tamanhos-posicional-linx]]) e `produto||cor` (todos os tamanhos). Cor
 * normalizada ('06' ≡ '6'), mesma chave do resto deste módulo.
 */
async function fetchBarrasPorVariacao(produtos: string[]): Promise<Map<string, string[]>> {
  const ids = Array.from(new Set(produtos.map((p) => p.trim()).filter(Boolean)));
  const out = new Map<string, string[]>();
  const add = (key: string, codigo: string) => {
    const lista = out.get(key);
    if (!lista) out.set(key, [codigo]);
    else if (!lista.includes(codigo)) lista.push(codigo);
  };

  const CHUNK = 1000;
  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    await withRequest(async (request) => {
      chunk.forEach((id, i) => request.input(`bar${i}`, sql.VarChar, id));
      const placeholders = chunk.map((_, i) => `@bar${i}`).join(", ");
      const res = await request.query<{ PRODUTO: string; COR: string; TAMANHO: number | null; CODIGO: string }>(`
        SELECT
          LTRIM(RTRIM(pb.PRODUTO)) AS PRODUTO,
          ISNULL(LTRIM(RTRIM(pb.COR_PRODUTO)), '') AS COR,
          TRY_CONVERT(INT, pb.TAMANHO) AS TAMANHO,
          LTRIM(RTRIM(pb.CODIGO_BARRA)) AS CODIGO
        FROM PRODUTOS_BARRA pb WITH (NOLOCK)
        WHERE pb.PRODUTO IN (${placeholders})
          AND LTRIM(RTRIM(ISNULL(pb.CODIGO_BARRA, ''))) <> ''
        ORDER BY LEN(LTRIM(RTRIM(pb.CODIGO_BARRA))), pb.CODIGO_BARRA
      `);
      for (const r of res.recordset) {
        const base = `${(r.PRODUTO ?? "").trim()}||${normalizeCor(r.COR ?? "")}`;
        const codigo = (r.CODIGO ?? "").trim();
        add(base, codigo);
        if (r.TAMANHO != null && r.TAMANHO > 0) add(`${base}||${r.TAMANHO}`, codigo);
      }
    });
  }
  return out;
}

/** Balde de loja do deck — o MESMO rótulo da quebra "Vendas por loja". */
function storeBucket(
  companyLive: Awaited<ReturnType<typeof resolveCompanyLive>>,
  filialName: string
): string {
  const label = companyLive ? getFilialLabelForDisplay(companyLive, filialName) : filialName;
  return (label || "OUTROS").toUpperCase().trim();
}

/**
 * Colapsa linhas de SKU (produto × cor) em 1 linha por PRODUTO.
 *
 * Trabalha sobre as linhas JÁ CALCULADAS — de propósito: assim o modo "Produto
 * Total" não tem chance de divergir do modo por cor (mesma venda, mesmas peças,
 * mesmo estoque; só a granularidade muda). Estoque agregado soma só positivos
 * ([[estoque-negativos-nunca-contam]]).
 *
 * `totalRevenue` é o da COLEÇÃO (não do subconjunto), para a participação de cada
 * linha continuar sendo lida contra o total do deck.
 */
function groupRowsByProduct(
  rows: PresentationProductRow[],
  totalRevenue: number
): PresentationProductRow[] {
  interface Group {
    row: PresentationProductRow;
    cores: Set<string>;
    grades: Set<string>;
    tipos: Set<string>;
  }
  const groups = new Map<string, Group>();

  for (const r of rows) {
    const key = r.productId;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        row: { ...r },
        cores: new Set(r.colorDescription ? [r.colorDescription] : []),
        grades: new Set(r.grade ? [r.grade] : []),
        tipos: new Set(r.tipo ? [r.tipo] : []),
      });
      continue;
    }
    g.row.qtd += r.qtd;
    g.row.venda += r.venda;
    g.row.estoque += Math.max(0, r.estoque);
    if (r.colorDescription) g.cores.add(r.colorDescription);
    if (r.grade) g.grades.add(r.grade);
    if (r.tipo) g.tipos.add(r.tipo);
  }

  const listLabel = (values: Set<string>, plural: string): string => {
    const list = Array.from(values);
    if (list.length === 0) return "";
    if (list.length <= 2) return list.join(" / ");
    return `${list.length} ${plural}`;
  };

  const merged = Array.from(groups.values()).map((g) => {
    const row = g.row;
    row.colorDescription = listLabel(g.cores, "cores");
    row.grade = listLabel(g.grades, "grades");
    row.tipo = listLabel(g.tipos, "tipos");
    row.precoMedio = row.qtd > 0 ? row.venda / row.qtd : 0;
    row.participacaoPct = totalRevenue > 0 ? (row.venda / totalRevenue) * 100 : 0;
    return row;
  });

  merged.sort((a, b) => b.venda - a.venda);
  const maxVenda = Math.max(...merged.map((r) => r.venda), 1);
  return merged.map((row, i) => ({
    ...row,
    rank: i + 1,
    barWidthPct: Math.round((row.venda / maxVenda) * 100),
  }));
}

/** Rótulo da coleção quando a página não mandou a descrição (só os códigos). */
function fullNameFallback(colecoes?: string[]): string {
  const code = (colecoes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean).join(", ");
  return code || "coleção";
}

/** "dracena maxi" → "Dracena Maxi" (título automático a partir do termo). */
function titleCaseTermo(term: string): string {
  return term
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length <= 2 ? w : w[0].toLocaleUpperCase("pt-BR") + w.slice(1)))
    .join(" ");
}

interface SkuAgg {
  productId: string;
  nome: string;
  colorCode: string;
  colorDescription: string;
  grade: string;
  tipo: string;
  qtd: number;
  venda: number;
}

/**
 * Decide as listas de filiais POS/e-commerce a considerar no detalhamento por
 * loja, respeitando o filtro de filial selecionado — mesma semântica de escopo
 * que `fetchProductsWithDetails` aplica para os totais.
 */
function resolveFilialScope(
  ecommerceFilials: Set<string>,
  salesFiliais: string[],
  specific: string | null | undefined
): { posNames: string[]; ecomNames: string[] } {
  const allPos = salesFiliais.filter((f) => !ecommerceFilials.has(f));
  const allEcom = salesFiliais.filter((f) => ecommerceFilials.has(f));

  if (specific && specific !== VAREJO_VALUE) {
    if (ecommerceFilials.has(specific)) {
      return { posNames: [], ecomNames: [specific] };
    }
    return { posNames: [specific], ecomNames: [] };
  }

  if (specific === VAREJO_VALUE) {
    return { posNames: allPos, ecomNames: [] };
  }

  return { posNames: allPos, ecomNames: allEcom };
}

export async function fetchColecaoPresentation({
  company,
  filial,
  colecoes,
  range,
  filtros,
  collectionLabel,
  destaque,
  todosProdutos = false,
  produtoTotal = false,
  excluirVendas,
}: ColecaoPresentationParams): Promise<ColecaoPresentationPayload> {
  const rangeInput = { start: range?.start, end: range?.end };

  // ---- Vendas a tirar (escolhidas na prévia de vendas da página) ----
  // As linhas são buscadas de novo aqui, pela chave, em vez de confiar em valores
  // vindos do navegador: o que sai do deck é sempre o número do banco.
  const excluirKeys = new Set((excluirVendas ?? []).map((k) => k.trim()).filter(Boolean));

  // ---- Produtos × cor pela lógica VALIDADA (com trocas/descontos/cancelamentos) ----
  const [products, vendasDaColecao] = await Promise.all([
    fetchProductsWithDetails({
      company,
      filial: filial ?? null,
      colecoes,
      // Recorte da coleção pelo cadastro — mesmos filtros do Gerador de Relatórios.
      grupos: filtros?.grupos ?? null,
      subgrupos: filtros?.subgrupos ?? null,
      linhas: filtros?.linhas ?? null,
      grades: filtros?.grades ?? null,
      range: rangeInput,
      groupByColor: true,
    }),
    excluirKeys.size > 0
      ? fetchVendasDaColecao({ company, filial, colecoes, range, filtros })
      : Promise.resolve([] as VendaColecaoRow[]),
  ]);
  const vendasExcluidas = vendasDaColecao.filter((v) => excluirKeys.has(v.key));

  // Abatimento por SKU (produto × cor). É subtração das MESMAS linhas que compõem o
  // total — nenhuma outra linha é descartada.
  const exclPorSku = new Map<string, { qtd: number; venda: number }>();
  for (const v of vendasExcluidas) {
    const k = skuKey(v.produto, v.cor);
    const cur = exclPorSku.get(k) ?? { qtd: 0, venda: 0 };
    cur.qtd += v.qtd;
    cur.venda += v.valor;
    exclPorSku.set(k, cur);
  }
  const exclusoes: ColecaoExclusoesResumo | null =
    excluirKeys.size > 0
      ? {
          linhas: vendasExcluidas.length,
          qtd: vendasExcluidas.reduce((s, v) => s + v.qtd, 0),
          venda: vendasExcluidas.reduce((s, v) => s + v.valor, 0),
          naoEncontradas: excluirKeys.size - vendasExcluidas.length,
        }
      : null;

  const skus: SkuAgg[] = products
    .map((d) => {
      const productId = String(d.productId ?? "").trim();
      const colorCode = d.corProduto ? String(d.corProduto).trim() : "";
      const excl = exclPorSku.get(skuKey(productId, colorCode));
      return {
        productId,
        // DESC_PRODUTO é CHAR: vem com padding ("DRACENA C 04/26        "). O HTML
        // colapsa o espaço sozinho, mas o texto dos insights não — daí o trim aqui.
        nome: (d.productName ?? "").trim(),
        colorCode,
        colorDescription:
          d.descCorProduto && d.descCorProduto !== "-" ? d.descCorProduto : "",
        grade: d.grade && d.grade !== "-" ? d.grade : "",
        tipo: (d.tipo ?? "").trim().toUpperCase(),
        qtd: (d.totalQuantity ?? 0) - (excl?.qtd ?? 0),
        venda: (d.totalRevenue ?? 0) - (excl?.venda ?? 0),
      };
    })
    // Tolerância só para o resíduo de ponto flutuante: SKU que teve toda a venda
    // tirada precisa sair da lista (arredondar cada SKU desalinharia o total).
    .filter((s) => s.productId && (Math.abs(s.venda) >= 0.005 || s.qtd !== 0));

  const stock = await fetchNetworkStock(skus.map((s) => s.productId));

  const totalRevenue = skus.reduce((s, r) => s + r.venda, 0);
  const totalQuantity = skus.reduce((s, r) => s + r.qtd, 0);
  const maxRevenue = Math.max(...skus.map((s) => s.venda), 1);

  const sortedSkus = [...skus].sort((a, b) => b.venda - a.venda);

  const productRows: PresentationProductRow[] = sortedSkus.map((s, i) => {
    const estoque = stock.get(skuKey(s.productId, s.colorCode)) ?? 0;
    return {
      rank: i + 1,
      productId: s.productId,
      nome: s.nome,
      colorDescription: s.colorDescription,
      grade: s.grade,
      tipo: s.tipo,
      qtd: s.qtd,
      precoMedio: s.qtd > 0 ? s.venda / s.qtd : 0,
      venda: s.venda,
      estoque,
      barWidthPct: Math.round((s.venda / maxRevenue) * 100),
      participacaoPct: totalRevenue > 0 ? (s.venda / totalRevenue) * 100 : 0,
    };
  });

  // Top 3 (destaques da capa/visão geral).
  const topProducts: PresentationProductRow[] = productRows.slice(0, 3);

  // ---- Conjunto em destaque (slide extra opcional) ----
  // A seleção manual (`produtoIds`) manda; sem ela, reconhece pelo termo com a
  // MESMA regra do Gerador de Relatórios. O `filter` sobre `productRows` garante
  // o recorte pedido: só entra produto que está na coleção do deck e vendeu no
  // período — os itens mantêm o rank que têm na lista geral.
  const destaqueTermo = (destaque?.termo ?? "").trim();
  const destaqueIdsManuais = Array.from(
    new Set((destaque?.produtoIds ?? []).map((id) => id.trim()).filter(Boolean))
  );
  let destaqueIds = new Set<string>(destaqueIdsManuais);
  if (destaqueIds.size === 0 && destaqueTermo.length >= DESTAQUE_MIN_TERM) {
    const matches = await fetchProdutosDaColecaoPorNome({ colecoes, termo: destaqueTermo, filtros });
    destaqueIds = new Set(matches.map((m) => m.productId));
  }
  const destaqueRows =
    destaqueIds.size > 0 ? productRows.filter((r) => destaqueIds.has(r.productId)) : [];
  const destaqueSkuKeys = new Set(
    sortedSkus
      .filter((s) => destaqueIds.has(s.productId))
      .map((s) => canonicalKey(s.productId, s.colorCode))
  );

  // ---- Tabela de produtos ----
  // `produtoTotal` colapsa as cores numa linha por produto; `todosProdutos` manda
  // TODAS as linhas (o deck pagina) em vez do top PRODUCTS_LIMIT + "Outros".
  const tableRows = produtoTotal
    ? groupRowsByProduct(productRows, totalRevenue)
    : productRows;
  const shown = todosProdutos ? tableRows : tableRows.slice(0, PRODUCTS_LIMIT);
  const tail = todosProdutos ? [] : tableRows.slice(PRODUCTS_LIMIT);
  const outros =
    tail.length > 0
      ? {
          count: tail.length,
          qtd: tail.reduce((s, r) => s + r.qtd, 0),
          venda: tail.reduce((s, r) => s + r.venda, 0),
          // Agregado É soma → só positivos (negativo nunca soma).
          estoque: tail.reduce((s, r) => s + Math.max(0, r.estoque), 0),
        }
      : null;

  // Total da rede: soma só os SKUs positivos. A linha do SKU pode aparecer
  // negativa (é informação real), mas negativo NUNCA entra numa soma.
  const estoqueRestante = productRows.reduce((s, r) => s + Math.max(0, r.estoque), 0);
  const pecasVendidas = totalQuantity;
  const precoMedio = pecasVendidas > 0 ? totalRevenue / pecasVendidas : 0;

  // ---- Lojas / canais: detalhamento por filial pela MESMA lógica validada ----
  // `fetchProdutoQtdePorFilial` traz a venda líquida (trocas/descontos abatidos)
  // por produto×cor×filial (POS) e por faturamento (e-commerce). Restringimos aos
  // SKUs desta coleção (já filtrados acima) via chave canônica produto×cor.
  const storeAgg = new Map<string, { venda: number; qtd: number }>();
  // Mesmo rateio por canal, mas só das linhas do conjunto em destaque (usado no
  // slide extra para dizer qual canal puxou o conjunto).
  const destaqueStoreAgg = new Map<string, number>();
  let ecommerceRevenue = 0;
  let retailRevenue = 0;

  const companyLive = await resolveCompanyLive(company);
  if (companyLive && skus.length > 0) {
    const ecommerceFilials = new Set(companyLive.ecommerceFilials ?? []);
    const salesFiliais = companyLive.filialFilters.sales ?? [];
    const specific =
      filial && filial !== VAREJO_VALUE ? await liveNameForIncoming(filial) : filial ?? null;
    const { posNames, ecomNames } = resolveFilialScope(
      ecommerceFilials,
      salesFiliais,
      specific
    );

    const colecaoKeys = new Set(skus.map((s) => canonicalKey(s.productId, s.colorCode)));
    const normalizedRange = normalizeRangeForQuery(rangeInput);

    const rows = await fetchProdutoQtdePorFilial(
      (company ?? "") as CompanyKey,
      posNames,
      ecomNames,
      normalizedRange,
      { groupByCor: true }
    ).catch(() => []);

    for (const r of rows) {
      const skuCanonical = canonicalKey(r.produto, r.cor || null);
      if (!colecaoKeys.has(skuCanonical)) continue;
      const isEcom = ecommerceFilials.has(r.filial);
      const bucket = isEcom ? ECOMMERCE_BUCKET : storeBucket(companyLive, r.filial);
      const cur = storeAgg.get(bucket) ?? { venda: 0, qtd: 0 };
      cur.venda += r.vendas;
      cur.qtd += r.qtde;
      storeAgg.set(bucket, cur);
      if (destaqueSkuKeys.has(skuCanonical)) {
        destaqueStoreAgg.set(bucket, (destaqueStoreAgg.get(bucket) ?? 0) + r.vendas);
      }
      if (isEcom) {
        ecommerceRevenue += r.vendas;
      } else {
        retailRevenue += r.vendas;
      }
    }

    // Venda tirada sai também da loja/canal onde aconteceu (mesmo balde). SKU que
    // teve TODA a venda tirada já saiu de `colecaoKeys` e as linhas dele foram
    // puladas acima — abater de novo tiraria em dobro.
    for (const v of vendasExcluidas) {
      if (!colecaoKeys.has(canonicalKey(v.produto, v.cor || null))) continue;
      const cur = storeAgg.get(v.loja);
      if (cur) {
        cur.venda -= v.valor;
        cur.qtd -= v.qtd;
      }
      if (destaqueSkuKeys.has(canonicalKey(v.produto, v.cor || null))) {
        destaqueStoreAgg.set(v.loja, (destaqueStoreAgg.get(v.loja) ?? 0) - v.valor);
      }
      if (v.canal === "ECOMMERCE") ecommerceRevenue -= v.valor;
      else retailRevenue -= v.valor;
    }
    if (vendasExcluidas.length > 0) {
      // Loja que ficou sem nada some do gráfico (tolerância só para o resíduo de
      // ponto flutuante — arredondar cada loja desalinharia a soma em centavos).
      for (const [bucket, cur] of storeAgg) {
        if (Math.abs(cur.venda) < 0.005 && cur.qtd === 0) storeAgg.delete(bucket);
      }
    }
  }

  const storesSortedDesc = Array.from(storeAgg.entries())
    .map(([nome, v]) => ({
      nome,
      venda: v.venda,
      qtd: v.qtd,
      participacaoPct: totalRevenue > 0 ? (v.venda / totalRevenue) * 100 : 0,
    }))
    .sort((a, b) => b.venda - a.venda);

  const canaisAtivos = storesSortedDesc.filter((s) => s.venda > 0 || s.qtd > 0).length;

  // Barras: ascendente (menor no topo), maior recebe 82% + destaque interno.
  const maxStore = Math.max(...storesSortedDesc.map((s) => s.venda), 1);
  const storeBars: PresentationStoreBar[] = [...storesSortedDesc]
    .sort((a, b) => a.venda - b.venda)
    .map((s) => {
      const isMax = s.venda === maxStore;
      return {
        nome: s.nome,
        venda: s.venda,
        widthPct: Math.max(1, Math.round((s.venda / maxStore) * 82)),
        pctLabel: fmtPct(s.participacaoPct),
        showPctInside: isMax,
        color: isMax ? ACCENT_DARK : ACCENT,
      };
    });

  const topStore = storesSortedDesc[0];
  const channelTotal = retailRevenue + ecommerceRevenue;
  const ecommerceShare = channelTotal > 0 ? (ecommerceRevenue / channelTotal) * 100 : 0;
  const retailShare = channelTotal > 0 ? (retailRevenue / channelTotal) * 100 : 0;
  const hasEcommerce = ecommerceRevenue > 0;
  const storeChartSubtitle =
    topStore?.nome === ECOMMERCE_BUCKET
      ? `E-commerce concentra ${fmtPct(topStore.participacaoPct)} do faturamento da coleção`
      : topStore
        ? `${topStore.nome} lidera com ${fmtPct(topStore.participacaoPct)} do faturamento`
        : "Distribuição de faturamento por canal";

  // ---- Slide de destaque: números do conjunto ----
  // Tudo derivado das MESMAS linhas da lista geral (nada é recalculado por outra
  // via), então o total do conjunto sempre fecha com a soma dos itens que ele
  // mostra e a % bate com a participação exibida na tabela de produtos.
  let destaquePayload: PresentationDestaquePayload | null = null;
  if (destaqueRows.length > 0) {
    // O destaque segue a granularidade da tabela: com "Produto Total" ligado, as
    // linhas do conjunto vêm da MESMA lista agrupada (inclusive com o rank que o
    // produto tem lá), senão vêm SKU por SKU.
    const dBase = produtoTotal
      ? tableRows.filter((r) => destaqueIds.has(r.productId))
      : destaqueRows;
    const dVenda = dBase.reduce((s, r) => s + r.venda, 0);
    const dQtd = dBase.reduce((s, r) => s + r.qtd, 0);
    // Agregado É soma → só positivos ([[estoque-negativos-nunca-contam]]).
    const dEstoque = dBase.reduce((s, r) => s + Math.max(0, r.estoque), 0);
    const dProdutos = new Set(dBase.map((r) => r.productId)).size;
    const dShare = totalRevenue > 0 ? (dVenda / totalRevenue) * 100 : 0;
    const dMax = Math.max(...dBase.map((r) => r.venda), 1);

    // Barras do slide são relativas ao MAIOR item do conjunto (não ao da coleção),
    // senão um conjunto pequeno sairia com barras quase invisíveis.
    const dRows: PresentationProductRow[] = dBase.map((r) => ({
      ...r,
      barWidthPct: Math.max(2, Math.round((r.venda / dMax) * 100)),
    }));
    const dShown = dRows.slice(0, DESTAQUE_ITEMS_LIMIT);
    const dTail = dRows.slice(DESTAQUE_ITEMS_LIMIT);
    const dOutros =
      dTail.length > 0
        ? {
            count: dTail.length,
            qtd: dTail.reduce((s, r) => s + r.qtd, 0),
            venda: dTail.reduce((s, r) => s + r.venda, 0),
            estoque: dTail.reduce((s, r) => s + Math.max(0, r.estoque), 0),
          }
        : null;

    const dTopCanalEntry = Array.from(destaqueStoreAgg.entries()).sort((a, b) => b[1] - a[1])[0];
    const dTopCanal =
      dTopCanalEntry && dVenda > 0
        ? {
            nome: dTopCanalEntry[0],
            venda: dTopCanalEntry[1],
            participacaoPct: (dTopCanalEntry[1] / dVenda) * 100,
          }
        : null;

    // Título: o que o usuário escreveu > termo digitado > nome do maior item.
    const titulo =
      (destaque?.nome ?? "").trim() ||
      (destaqueTermo ? titleCaseTermo(destaqueTermo) : "") ||
      dRows[0]?.nome ||
      "Produtos em destaque";
    const itemLabel = `${dRows.length} ${dRows.length === 1 ? "item" : "itens"}`;
    const produtoLabel = `${dProdutos} ${dProdutos === 1 ? "produto" : "produtos"}`;
    // Vale tanto para a lista inteira reconhecida quanto para o subconjunto que o
    // usuário deixou marcado (todo item exibido tem, sim, o termo no nome).
    const colecaoLabel = collectionLabel?.trim() || fullNameFallback(colecoes);
    const subtitulo = destaqueTermo
      ? `${itemLabel} · ${produtoLabel} com “${destaqueTermo}” no nome · ${colecaoLabel}`
      : `${itemLabel} · ${produtoLabel} selecionados · ${colecaoLabel}`;

    const dHero = dRows[0];
    const dTicket = dQtd > 0 ? dVenda / dQtd : 0;
    destaquePayload = {
      titulo,
      subtitulo,
      termo: destaqueTermo,
      items: dShown,
      outros: dOutros,
      totals: {
        venda: dVenda,
        qtd: dQtd,
        estoque: dEstoque,
        precoMedio: dTicket,
        participacaoPct: dShare,
        skus: dRows.length,
        produtos: dProdutos,
      },
      shareBar: {
        destaquePct: Math.min(100, Math.max(0, dShare)),
        restoPct: Math.min(100, Math.max(0, 100 - dShare)),
        restoVenda: Math.max(0, totalRevenue - dVenda),
      },
      topCanal: dTopCanal,
      insight: {
        titulo:
          dShare >= 30
            ? "O conjunto carrega a coleção"
            : dShare >= 10
              ? "Peso relevante no faturamento"
              : "Contribuição do conjunto",
        texto:
          `${titulo} somou ${fmtCurrency(dVenda)} em ${fmtInt(dQtd)} peças — ` +
          `${fmtPct(dShare)} do faturamento da coleção, com ticket médio de ${fmtCurrency(dTicket)}.` +
          (dHero && dRows.length > 1
            ? ` ${dHero.nome} lidera o conjunto com ${fmtCurrency(dHero.venda)}.`
            : "") +
          (dTopCanal
            ? ` ${dTopCanal.nome} respondeu por ${fmtPct(dTopCanal.participacaoPct)} das vendas do conjunto.`
            : "") +
          (dEstoque > 0 ? ` Restam ${fmtInt(dEstoque)} peças na rede.` : ""),
      },
    };
  }

  // ---- Narrativas (geradas a partir dos números) ----
  const hero = productRows[0];
  const top4Share = productRows.slice(0, 4).reduce((s, r) => s + r.participacaoPct, 0);
  const insightProdutos = {
    titulo: "Leitura da curva",
    texto: hero
      ? `${hero.nome} lidera com ${fmtPct(hero.participacaoPct)} do faturamento da coleção. ` +
        `Os 4 principais SKUs concentram ${fmtPct(top4Share)} do total — ` +
        `${top4Share >= 80 ? "curva muito concentrada" : top4Share >= 60 ? "curva concentrada" : "distribuição equilibrada"}.`
      : "Sem produtos vendidos no período selecionado.",
  };

  const closing = {
    insightA: {
      titulo: hasEcommerce && ecommerceShare >= 50 ? "Volume puxado pelo digital" : "Onde a coleção performou",
      texto:
        `A coleção faturou ${fmtCurrency(totalRevenue)} em ${fmtInt(pecasVendidas)} peças` +
        (hasEcommerce ? `, com ${fmtPct(ecommerceShare)} das vendas no e-commerce.` : ".") +
        (hero ? ` ${hero.nome} foi o produto herói, com ${fmtCurrency(hero.venda)}.` : ""),
    },
    insightB: {
      titulo: "Atenção ao estoque",
      texto:
        `Restam ${fmtInt(estoqueRestante)} peças na rede` +
        (topStore ? `. ${topStore.nome} é o canal líder — priorize reposição/escoamento conforme o giro.` : "."),
    },
    footKpis: [
      { label: "Faturamento", value: fmtCurrency(totalRevenue), fontSize: "30px" },
      { label: "% E-commerce", value: `${Math.round(ecommerceShare)}%`, fontSize: "30px" },
      { label: "% Lojas físicas", value: `${Math.round(retailShare)}%`, fontSize: "30px" },
      {
        label: "Produto herói",
        value: hero?.nome ?? "-",
        fontSize: (hero?.nome ?? "").length > 16 ? "20px" : "30px",
      },
    ],
  };

  const startLabelIso = range?.start ?? "";
  const endLabelIso = range?.end ?? "";
  const year = endLabelIso ? new Date(`${endLabelIso}T00:00:00`).getFullYear() : new Date().getFullYear();
  const periodLabel =
    startLabelIso && endLabelIso
      ? `${fmtDateShort(startLabelIso)} a ${fmtDateShort(endLabelIso)} de ${year}`
      : "";
  const periodShort =
    startLabelIso && endLabelIso ? `${fmtDateShort(startLabelIso)}–${fmtDateShort(endLabelIso)}/${year}` : "";

  const code = (colecoes ?? []).map((c) => c.trim().toUpperCase()).filter(Boolean).join(", ");
  const fullName = collectionLabel?.trim() || code;

  return {
    collection: { code, fullName, recorte: describeItemFilters(filtros) },
    period: { start: startLabelIso, end: endLabelIso, label: periodLabel, short: periodShort },
    kpis: {
      faturamento: totalRevenue,
      pecasVendidas,
      nSkus: productRows.length,
      precoMedio,
      estoqueRestante,
      canaisAtivos,
    },
    channel: {
      hasEcommerce,
      ecommerceShare,
      retailShare,
      ecommerceRevenue,
      retailRevenue,
    },
    topProducts,
    products: shown,
    productsPerSlide: PRODUCTS_LIMIT,
    productsTotalCount: tableRows.length,
    productsPorProduto: produtoTotal,
    skus: sortedSkus.map((s) => ({ productId: s.productId, qtd: s.qtd })),
    outros,
    destaque: destaquePayload,
    exclusoes,
    insightProdutos,
    stores: storesSortedDesc,
    storesTotal: { venda: totalRevenue, qtd: pecasVendidas },
    storeChartSubtitle,
    storeBars,
    closing,
  };
}

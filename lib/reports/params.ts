import type { SourceId } from "./column-sources";
import type { ReportFilters } from "./types";

const VALID_SOURCES: SourceId[] = ["vendas", "estoque", "parados", "cadastro"];

/**
 * Parser ÚNICO dos filtros do Gerador de Relatórios a partir da query string.
 *
 * Existe para que TODAS as rotas do gerador (a /dados e as de streaming) leiam exatamente
 * o mesmo conjunto de parâmetros. Antes cada rota reimplementava a leitura, e a rota de
 * streaming da compra sugerida esqueceu de ler `fornecedor` — o filtro escolhido na tela
 * era silenciosamente ignorado e o arquivo saía com itens de outro fornecedor. Filtro novo
 * entra AQUI, uma vez, e passa a valer em todas as rotas.
 */
export function parseReportFilters(searchParams: URLSearchParams): ReportFilters {
  const num = (key: string): number | null => {
    const raw = searchParams.get(key);
    if (raw == null || raw.trim() === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  };
  const list = (key: string) => {
    const values = searchParams.getAll(key).filter(Boolean);
    return values.length > 0 ? values : null;
  };

  const limit = num("limit");
  const diasParadoValorRaw = num("diasParadoValor");
  const diasParadoModoRaw = searchParams.get("diasParadoModo");
  const janelaRaw = num("projecaoJanelaMeses");

  return {
    company: searchParams.get("company") ?? undefined,
    filial: searchParams.get("filial") || null,
    start: searchParams.get("start") ?? undefined,
    end: searchParams.get("end") ?? undefined,
    grupos: list("grupo"),
    linhas: list("linha"),
    subgrupos: list("subgrupo"),
    grades: list("grade"),
    colecoes: list("colecao"),
    cores: list("cor"),
    tipos: list("tipo"),
    produtoId: searchParams.get("produtoId") || null,
    // Vários produtos: aceita repetido (?produtoId2=a&produtoId2=b) na chave curta `prod`.
    produtoIds: list("prod"),
    produtoSearchTerm: searchParams.get("produtoSearchTerm") || null,
    fornecedor: searchParams.get("fornecedor") || null,
    limit: limit != null && limit > 0 ? limit : undefined,
    diasParadoValor: diasParadoValorRaw != null && diasParadoValorRaw >= 0 ? diasParadoValorRaw : null,
    diasParadoModo:
      diasParadoModoRaw === "lte" ? "lte" : diasParadoModoRaw === "gte" ? "gte" : null,
    estoquePorFilial: searchParams.get("estoquePorFilial") === "1",
    vendasPorFilial: searchParams.get("vendasPorFilial") === "1",
    compraIdeal: searchParams.get("compraIdeal") === "1",
    incluirZerados: searchParams.get("incluirZerados") === "1",
    incluirNegativos: searchParams.get("incluirNegativos") === "1",
    considerarTransferencias: searchParams.get("considerarTransferencias") === "1",
    incluirRupturas: searchParams.get("incluirRupturas") === "1",
    projecaoJanelaMeses: janelaRaw != null && janelaRaw > 0 ? Math.floor(janelaRaw) : null,
    projecaoSazonalidade: searchParams.get("projecaoSazonalidade") === "1",
  };
}

/** Fontes extras válidas (colunas de outras análises no preset) vindas de `?src=`. */
export function parseExtraSources(searchParams: URLSearchParams): SourceId[] {
  return searchParams
    .getAll("src")
    .filter((s): s is SourceId => (VALID_SOURCES as string[]).includes(s));
}

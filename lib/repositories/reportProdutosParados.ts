import { fetchProdutosParadosDetalhado } from "@/lib/repositories/controleEstoque";
import { ROW_COR_FIELD } from "@/lib/reports/keys";
import { ULTIMA_VENDA_NUNCA } from "@/lib/reports/format";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import type { ReportFilters, ReportResult, ReportRow } from "@/lib/reports/types";

const DEFAULT_LIMIT = 5000;
/** Sentinela de "nunca vendeu" (espelha diasParado=9999 do repositório). */
const NUNCA_VENDEU = 9999;

function up(value: string | null | undefined): string {
  return (value ?? "").trim().toUpperCase();
}

function normalizeSet(values: string[] | null | undefined): Set<string> | null {
  const list = (values ?? []).map(up).filter(Boolean);
  return list.length > 0 ? new Set(list) : null;
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

/**
 * Análise "Produtos Parados": todos os produtos (produto × cor) com estoque positivo,
 * com dias parado e última venda. Reusa a lógica VALIDADA da página Produtos Parados
 * (`fetchProdutosParadosDetalhado`): dias parado = 9999 ⇒ nunca vendeu; última venda
 * nula ⇒ nunca vendeu; estoque = só positivos. `minDias=0` traz todos (a coluna Dias
 * Parado mostra a defasagem; ordenar por ela revela os mais parados / nunca vendidos).
 * Cor e nome não são filtros nativos da função → aplicados aqui como pós-filtro.
 */
export async function fetchProdutosParados(filters: ReportFilters): Promise<ReportResult> {
  const itens = await fetchProdutosParadosDetalhado({
    company: filters.company,
    filial: filters.filial ?? null,
    grupos: filters.grupos ?? null,
    linhas: filters.linhas ?? null,
    colecoes: filters.colecoes ?? null,
    subgrupos: filters.subgrupos ?? null,
    grades: filters.grades ?? null,
    minDias: 0,
  });

  // Pós-filtros (a função-base não os expõe). Cor casa pela DESCRIÇÃO.
  const corSet = normalizeSet(filters.cores);
  const termo = (filters.produtoSearchTerm ?? "").trim().toUpperCase();
  const produtoIdAlvo = (filters.produtoId ?? "").trim().toUpperCase();

  // Filtro opcional de dias parado: "lte" = até X dias; "gte" = X dias ou mais.
  // (gte inclui "nunca vendeu" = 9999; lte o exclui — comportamento esperado.)
  const diasCorte =
    filters.diasParadoValor != null && Number.isFinite(filters.diasParadoValor)
      ? filters.diasParadoValor
      : null;
  const diasModo = filters.diasParadoModo === "lte" ? "lte" : "gte";

  const filtered = itens.filter((d) => {
    if (corSet && !corSet.has(up(d.cor))) return false;
    if (diasCorte != null) {
      if (diasModo === "lte" ? d.diasParado > diasCorte : d.diasParado < diasCorte) return false;
    }
    if (produtoIdAlvo) {
      if (up(d.produto) !== produtoIdAlvo) return false;
    } else if (termo.length >= 2) {
      const alvo = `${up(d.descricao)} ${up(d.produto)} ${up(d.codigoBarra)}`;
      if (!alvo.includes(termo)) return false;
    }
    return true;
  });

  // Mais parados / nunca vendidos primeiro (estável; o preset pode reordenar).
  filtered.sort((a, b) => b.diasParado - a.diasParado);

  const total = filtered.length;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const truncated = total > limit;
  const sliced = truncated ? filtered.slice(0, limit) : filtered;

  const rows: ReportRow[] = sliced.map((d) => {
    const nuncaVendeu = !d.ultimaVenda || d.diasParado >= NUNCA_VENDEU;
    return {
      [ROW_COR_FIELD]: d.corCodigo ?? "", // código cru da cor (join entre análises)
      PRODUTO: d.produto,
      CODIGO_BARRA: d.codigoBarra,
      GRUPO: d.grupo,
      LINHA: d.linha,
      SUBGRUPO: d.subgrupo,
      GRADE: d.grade,
      COLECAO: d.colecao,
      TIPO: d.tipo,
      COR: d.cor,
      DESCRICAO: d.descricao,
      ESTOQUE: roundInt(d.estoque),
      // Valor numérico (sentinela NUNCA_VENDEU) — o formatador exibe "Nunca vendeu".
      DIAS_PARADO: nuncaVendeu ? NUNCA_VENDEU : roundInt(d.diasParado),
      // Sentinela "NUNCA" = nunca vendeu (≠ vazio, que significa "sem dado" no enriquecimento).
      ULTIMA_VENDA: nuncaVendeu ? ULTIMA_VENDA_NUNCA : d.ultimaVenda,
    };
  });

  await applyColecaoLabels(filters.company, rows);

  return { rows, total, truncated };
}

import { fetchEstoqueRedePorProduto } from "@/lib/repositories/controleEstoque";
import { resolveCompanyLive } from "@/lib/server/company-live";
import {
  getOperationalFilials,
  getFilialLabelForDisplay,
  compareFilialDisplayOrder,
} from "@/lib/config/company";
import { ROW_COR_FIELD } from "@/lib/reports/keys";
import { applyColecaoLabels } from "@/lib/repositories/colecao";
import type {
  ReportColumnDef,
  ReportFilters,
  ReportResult,
  ReportRow,
  ReportSummaryMetric,
} from "@/lib/reports/types";

const DEFAULT_LIMIT = 5000;
/** Prefixo das chaves das colunas dinâmicas de estoque por filial (espelha o front). */
const FILIAL_COL_PREFIX = "ESTOQUE_FILIAL::";

/** Filiais (por rótulo de exibição) ocultadas desta análise — não viram coluna nem entram no total. */
const EXCLUDED_FILIAL_LABELS = new Set(["IBIRAPUERA"]);
function isExcludedLabel(label: string): boolean {
  return EXCLUDED_FILIAL_LABELS.has(label.trim().toUpperCase());
}

function roundInt(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

interface Agg {
  produto: string;
  descricao: string;
  grupo: string;
  linha: string;
  subgrupo: string;
  grade: string;
  tipo: string;
  cor: string;
  corCodigo: string;
  posByLabel: Map<string, number>;
  negByLabel: Map<string, number>;
}

/**
 * Análise "Estoque por filial": estoque de todos os produtos (produto × cor) da rede,
 * com uma coluna por filial + estoque total. Mesmo escopo da Estoque Consulta.
 * Estoque por filial é SEMPRE a rede inteira. As COLUNAS por filial exibem pos>0?pos:neg
 * (mostram o negativo quando a filial está 100% negativa), mas o ESTOQUE TOTAL (coluna e
 * KPI) soma só os POSITIVOS — batendo com o "Estoque Total" do Controle de Estoque.
 */
export async function fetchEstoqueRede(filters: ReportFilters): Promise<ReportResult> {
  const [company, itens] = await Promise.all([
    resolveCompanyLive(filters.company),
    fetchEstoqueRedePorProduto({
      company: filters.company,
      filial: null, // sempre a rede inteira ("onde o produto está")
      grupos: filters.grupos ?? null,
      linhas: filters.linhas ?? null,
      subgrupos: filters.subgrupos ?? null,
      grades: filters.grades ?? null,
      colecoes: filters.colecoes ?? null,
      cores: filters.cores ?? null,
      tipos: filters.tipos ?? null,
      produtoId: filters.produtoId ?? null,
      produtoSearchTerm: filters.produtoSearchTerm ?? null,
      // Para listar zerados, a fonte precisa devolver os grupos com saldo líquido 0.
      incluirZerados: filters.incluirZerados ?? false,
    }),
  ]);

  // Agrupa por (produto, cor) acumulando pos/neg por filial (label canônico).
  const labelSet = new Set<string>();
  if (company) {
    for (const f of getOperationalFilials(company, "inventory")) {
      const label = getFilialLabelForDisplay(company, f);
      if (!isExcludedLabel(label)) labelSet.add(label);
    }
  }

  const byKey = new Map<string, Agg>();
  for (const r of itens) {
    const label = company ? getFilialLabelForDisplay(company, r.filial) : r.filial;
    if (isExcludedLabel(label)) continue; // Ibirapuera fora desta análise (nem coluna nem total)

    const key = `${r.produto}||${r.cor}`;
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        produto: r.produto,
        descricao: r.descricao,
        grupo: r.grupo,
        linha: r.linha,
        subgrupo: r.subgrupo,
        grade: r.grade,
        tipo: r.tipo,
        cor: r.cor,
        corCodigo: r.corCodigo,
        posByLabel: new Map(),
        negByLabel: new Map(),
      };
      byKey.set(key, agg);
    }
    labelSet.add(label);
    agg.posByLabel.set(label, (agg.posByLabel.get(label) ?? 0) + r.positiveStock);
    agg.negByLabel.set(label, (agg.negByLabel.get(label) ?? 0) + r.negativeStock);
  }

  const orderedLabels = Array.from(labelSet).sort((a, b) =>
    company ? compareFilialDisplayOrder(a, b, company) : a.localeCompare(b, "pt-BR")
  );
  const dynamicColumns: ReportColumnDef[] = orderedLabels.map((label) => ({
    key: `${FILIAL_COL_PREFIX}${label}`,
    defaultLabel: label,
    type: "int" as const,
  }));

  // Estoque total por (produto, cor) = soma só dos POSITIVOS (igual ao Controle de
  // Estoque). Os negativos continuam visíveis nas colunas por filial (pos>0?pos:neg),
  // mas NÃO entram no total — assim o KPI/coluna "Estoque total" bate com o Controle.
  //
  // Listagem (igual à Estoque Consulta): por padrão só itens com estoque positivo.
  // "incluirNegativos" também lista os que têm só negativo; "incluirZerados" também
  // lista os zerados (saldo 0 em toda a rede). Itens mistos (pos+neg) sempre entram e
  // mostram o negativo nas colunas da filial.
  const incluirZerados = filters.incluirZerados ?? false;
  const incluirNegativos = filters.incluirNegativos ?? false;
  const aggs = Array.from(byKey.values())
    .map((agg) => {
      let sumPos = 0;
      let sumNeg = 0;
      agg.posByLabel.forEach((v) => (sumPos += v));
      agg.negByLabel.forEach((v) => (sumNeg += v));
      return { agg, total: sumPos, sumNeg };
    })
    .filter(({ total, sumNeg }) => {
      if (total > 0) return true; // tem positivo em alguma filial
      if (incluirNegativos && sumNeg < 0) return true; // só negativo
      if (incluirZerados && sumNeg === 0) return true; // zerado em toda a rede
      return false;
    });

  aggs.sort((a, b) => b.total - a.total);

  const total = aggs.length;
  const limit = filters.limit && filters.limit > 0 ? filters.limit : DEFAULT_LIMIT;
  const truncated = total > limit;
  const sliced = truncated ? aggs.slice(0, limit) : aggs;

  // KPIs sobre o conjunto COMPLETO (não só o que cabe no limite), já sem Ibirapuera.
  const estoqueTotalRede = aggs.reduce((s, a) => s + a.total, 0);
  const summary: ReportSummaryMetric[] = [
    { label: "Estoque Total", value: roundInt(estoqueTotalRede), format: "int" },
    { label: "Itens Únicos", value: total, format: "int" },
  ];

  const rows: ReportRow[] = sliced.map(({ agg, total: estoqueTotal }) => {
    const row: ReportRow = {
      [ROW_COR_FIELD]: agg.corCodigo, // código cru da cor (join entre análises)
      PRODUTO: agg.produto,
      GRUPO: agg.grupo,
      LINHA: agg.linha,
      SUBGRUPO: agg.subgrupo,
      GRADE: agg.grade,
      TIPO: agg.tipo,
      COR: agg.cor,
      DESCRICAO: agg.descricao,
      ESTOQUE_TOTAL: roundInt(estoqueTotal),
    };
    for (const label of orderedLabels) {
      const pos = agg.posByLabel.get(label) ?? 0;
      const neg = agg.negByLabel.get(label) ?? 0;
      row[`${FILIAL_COL_PREFIX}${label}`] = roundInt(pos > 0 ? pos : neg);
    }
    return row;
  });

  await applyColecaoLabels(filters.company, rows);

  return { rows, total, truncated, dynamicColumns, summary };
}

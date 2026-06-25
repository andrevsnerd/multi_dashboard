export interface ControleEstoqueItemInput {
  produto: string;
  corProduto?: string | null;
}

export interface ControleEstoqueEstoquePorFilialRow {
  filial: string;
  estoque: number;
}

export interface ControleEstoqueVendasPorFilialRow {
  filial: string;
  qtde12m: number;
  qtde60d: number;
  qtdeMesAtual: number;
  valor12m: number;
  custoUnitario: number;
  diasDesdeUltimaVenda: number | null;
  primeiraEntradaFilial: string | null;
  diasHistoricoFilial: number;
  mesesHistoricoFilial: number;
  historicoParcial: boolean;
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
  mesesDisponiveis: number;
  velocidadeAjustada: number;
}

export interface ControleEstoqueResumoHistorico {
  primeiraEntradaFilial: string | null;
  diasHistoricoFilial: number;
  mesesHistoricoFilial: number;
  historicoParcial: boolean;
}

export interface ControleEstoqueItemMetricasResumo extends ControleEstoqueResumoHistorico {
  estoqueTotal: number;
  qtde12m: number;
  qtde60d: number;
  vendasMesAtual: number;
  valor12m: number | null;
  custoUnitario: number | null;
  diasDesdeUltimaVenda: number | null;
  diasComEstoquePositivo: number;
  diasSemEstoque: number;
  mesesDisponiveis: number;
  velocidadeAjustada: number;
  /** Dias do maior período contínuo com estoque nos últimos 12 meses (até 60). */
  ritmoDiasComEstoque: number;
  /** Vendas líquidas ocorridas nesse período. */
  ritmoVendasPeriodo: number;
  /** Data de início da janela usada (ISO yyyy-mm-dd), ou null. */
  ritmoInicioIso: string | null;
  /** Data de término desse período (ISO yyyy-mm-dd), ou null. */
  ritmoFimIso: string | null;
  /** Dias COM venda dentro da janela (mede concentração das vendas). */
  ritmoDiasComVenda: number;
  /** 1ª venda dentro da janela (ISO), ou null. */
  ritmoPrimeiraVendaIso: string | null;
  /** Última venda dentro da janela (ISO), ou null. */
  ritmoUltimaVendaIso: string | null;
  /** Dias do trecho RECENTE com estoque (último período contínuo, teto 60). */
  ritmoRecenteDias: number;
  /** Vendas líquidas no trecho recente. */
  ritmoRecenteVendas: number;
  /** Início do trecho recente (ISO), ou null. */
  ritmoRecenteInicioIso: string | null;
  /** Fim do trecho recente (ISO), ou null. */
  ritmoRecenteFimIso: string | null;
  /** Última venda DENTRO do trecho recente (ISO), ou null. Sinal de "vendeu recentemente?". */
  ritmoRecenteUltimaVendaIso: string | null;
  /** Gap (dias) entre o fim do maior trecho e o início do recente (0 = mesmo trecho). */
  ritmoGapDias: number;
}

export interface ControleEstoqueItemMetricas {
  item: {
    produto: string;
    corProduto: string | null;
  };
  estoquePorFilial: ControleEstoqueEstoquePorFilialRow[];
  vendasPorFilial: ControleEstoqueVendasPorFilialRow[];
  resumo: ControleEstoqueItemMetricasResumo;
}

export interface ControleEstoqueMetricasItensPayload {
  company?: string;
  filial?: string | null;
  includeHistorico?: boolean;
  itens: ControleEstoqueItemInput[];
}

export function normalizeControleEstoqueItemValue(value?: string | null): string {
  return (value ?? "").toString().trim();
}

export function normalizeControleEstoqueItemKeyPart(value?: string | null): string {
  return normalizeControleEstoqueItemValue(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function buildControleEstoqueItemKey(produto?: string | null, corProduto?: string | null): string {
  return `${normalizeControleEstoqueItemKeyPart(produto)}||${normalizeControleEstoqueItemKeyPart(corProduto)}`;
}

export function dedupeControleEstoqueItens<T extends ControleEstoqueItemInput>(itens: T[]): T[] {
  const unique = new Map<string, T>();
  for (const item of itens) {
    const produto = normalizeControleEstoqueItemValue(item.produto);
    if (!produto) continue;
    const corProduto = normalizeControleEstoqueItemValue(item.corProduto);
    const key = buildControleEstoqueItemKey(produto, corProduto);
    if (!unique.has(key)) {
      unique.set(key, {
        ...item,
        produto,
        corProduto: corProduto || null,
      });
    }
  }
  return Array.from(unique.values());
}

function getHistoricoFallback(): ControleEstoqueResumoHistorico {
  return {
    primeiraEntradaFilial: null,
    diasHistoricoFilial: 365,
    mesesHistoricoFilial: 12,
    historicoParcial: false,
  };
}

function calculateHistoricoFromDate(value: string): ControleEstoqueResumoHistorico {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return getHistoricoFallback();
  const diasHistoricoFilial = Math.min(
    365,
    Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000))
  );
  return {
    primeiraEntradaFilial: date.toISOString(),
    diasHistoricoFilial,
    mesesHistoricoFilial: Math.min(12, Math.max(1, diasHistoricoFilial / 30)),
    historicoParcial: diasHistoricoFilial < 365,
  };
}

export function mergeControleEstoqueHistoricoRows(
  rows: Array<
    Pick<
      ControleEstoqueVendasPorFilialRow,
      "primeiraEntradaFilial" | "diasHistoricoFilial" | "mesesHistoricoFilial" | "historicoParcial"
    >
  >
): ControleEstoqueResumoHistorico {
  let primeiraEntrada: Date | null = null;

  for (const row of rows) {
    if (!row.primeiraEntradaFilial) continue;
    const date = new Date(row.primeiraEntradaFilial);
    if (Number.isNaN(date.getTime())) continue;
    if (!primeiraEntrada || date < primeiraEntrada) primeiraEntrada = date;
  }

  if (primeiraEntrada) {
    return calculateHistoricoFromDate(primeiraEntrada.toISOString());
  }

  const parcial = rows.find(
    (row) =>
      row.diasHistoricoFilial != null &&
      row.mesesHistoricoFilial != null &&
      row.historicoParcial != null
  );

  if (parcial) {
    return {
      primeiraEntradaFilial: null,
      diasHistoricoFilial: Math.min(365, Math.max(0, Number(parcial.diasHistoricoFilial ?? 365))),
      mesesHistoricoFilial: Math.min(12, Math.max(1, Number(parcial.mesesHistoricoFilial ?? 12))),
      historicoParcial: Boolean(parcial.historicoParcial),
    };
  }

  return getHistoricoFallback();
}

export function summarizeControleEstoqueItemMetricas(input: {
  estoquePorFilial: ControleEstoqueEstoquePorFilialRow[];
  vendasPorFilial: ControleEstoqueVendasPorFilialRow[];
}): ControleEstoqueItemMetricasResumo {
  const { estoquePorFilial, vendasPorFilial } = input;
  const historico = mergeControleEstoqueHistoricoRows(vendasPorFilial);
  const diasValidos = vendasPorFilial
    .map((row) => row.diasDesdeUltimaVenda)
    .filter((value): value is number => value != null);
  const totalValor = vendasPorFilial.reduce((sum, row) => sum + Number(row.valor12m ?? 0), 0);
  const custoUnitario = vendasPorFilial.reduce(
    (max, row) => Math.max(max, Number(row.custoUnitario ?? 0)),
    0
  );

  return {
    estoqueTotal: Math.round(
      estoquePorFilial.reduce((sum, row) => sum + Math.max(0, Number(row.estoque ?? 0)), 0)
    ),
    qtde12m: Math.round(vendasPorFilial.reduce((sum, row) => sum + Number(row.qtde12m ?? 0), 0)),
    qtde60d: Math.round(vendasPorFilial.reduce((sum, row) => sum + Number(row.qtde60d ?? 0), 0)),
    vendasMesAtual: Math.round(
      vendasPorFilial.reduce((sum, row) => sum + Number(row.qtdeMesAtual ?? 0), 0)
    ),
    valor12m: totalValor > 0 ? Math.round(totalValor) : null,
    custoUnitario: custoUnitario > 0 ? custoUnitario : null,
    diasDesdeUltimaVenda: diasValidos.length > 0 ? Math.min(...diasValidos) : null,
    diasComEstoquePositivo: vendasPorFilial.reduce(
      (max, row) => Math.max(max, Number(row.diasComEstoquePositivo ?? 0)),
      0
    ),
    diasSemEstoque: vendasPorFilial.reduce(
      (min, row) => Math.min(min, Number(row.diasSemEstoque ?? 365)),
      365
    ),
    mesesDisponiveis: Math.max(
      vendasPorFilial.reduce(
        (max, row) => Math.max(max, Number(row.mesesDisponiveis ?? 1)),
        1
      ),
      1
    ),
    velocidadeAjustada:
      Math.round(
        (vendasPorFilial.reduce(
          (max, row) => Math.max(max, Number(row.velocidadeAjustada ?? 0)),
          0
        ) +
          Number.EPSILON) *
          100
      ) / 100,
    // Defaults; o servidor sobrescreve com a janela de ritmo do resumoDisponibilidade.
    ritmoDiasComEstoque: 0,
    ritmoVendasPeriodo: 0,
    ritmoInicioIso: null,
    ritmoFimIso: null,
    ritmoDiasComVenda: 0,
    ritmoPrimeiraVendaIso: null,
    ritmoUltimaVendaIso: null,
    ritmoRecenteDias: 0,
    ritmoRecenteVendas: 0,
    ritmoRecenteInicioIso: null,
    ritmoRecenteFimIso: null,
    ritmoRecenteUltimaVendaIso: null,
    ritmoGapDias: 0,
    ...historico,
  };
}

function getEarlierIsoDate(
  current: string | null | undefined,
  incoming: string | null | undefined
): string | null {
  if (!current) return incoming ?? null;
  if (!incoming) return current;

  const currentDate = new Date(current);
  const incomingDate = new Date(incoming);
  if (Number.isNaN(currentDate.getTime())) return incoming;
  if (Number.isNaN(incomingDate.getTime())) return current;
  return incomingDate < currentDate ? incoming : current;
}

export function mergeControleEstoqueMetricasEntries(
  rows: ControleEstoqueItemMetricas[]
): ControleEstoqueItemMetricas {
  const estoquePorFilialMap = new Map<string, ControleEstoqueEstoquePorFilialRow>();
  const vendasPorFilialMap = new Map<string, ControleEstoqueVendasPorFilialRow>();

  for (const row of rows) {
    for (const estoque of row.estoquePorFilial) {
      const key = normalizeControleEstoqueItemValue(estoque.filial).toUpperCase();
      const current = estoquePorFilialMap.get(key);
      if (current) {
        current.estoque += Number(estoque.estoque ?? 0);
      } else {
        estoquePorFilialMap.set(key, {
          filial: normalizeControleEstoqueItemValue(estoque.filial),
          estoque: Number(estoque.estoque ?? 0),
        });
      }
    }

    for (const venda of row.vendasPorFilial) {
      const key = normalizeControleEstoqueItemValue(venda.filial).toUpperCase();
      const current = vendasPorFilialMap.get(key);
      if (current) {
        current.qtde12m += Number(venda.qtde12m ?? 0);
        current.qtde60d += Number(venda.qtde60d ?? 0);
        current.qtdeMesAtual += Number(venda.qtdeMesAtual ?? 0);
        current.valor12m += Number(venda.valor12m ?? 0);
        current.custoUnitario = Math.max(Number(current.custoUnitario ?? 0), Number(venda.custoUnitario ?? 0));
        current.diasDesdeUltimaVenda =
          current.diasDesdeUltimaVenda == null
            ? venda.diasDesdeUltimaVenda
            : venda.diasDesdeUltimaVenda == null
              ? current.diasDesdeUltimaVenda
              : Math.min(current.diasDesdeUltimaVenda, venda.diasDesdeUltimaVenda);
        current.primeiraEntradaFilial = getEarlierIsoDate(current.primeiraEntradaFilial, venda.primeiraEntradaFilial);
        current.diasHistoricoFilial = Math.max(
          Number(current.diasHistoricoFilial ?? 0),
          Number(venda.diasHistoricoFilial ?? 0)
        );
        current.mesesHistoricoFilial = Math.max(
          Number(current.mesesHistoricoFilial ?? 0),
          Number(venda.mesesHistoricoFilial ?? 0)
        );
        current.historicoParcial = Boolean(current.historicoParcial) && Boolean(venda.historicoParcial);
        current.diasComEstoquePositivo = Math.max(
          Number(current.diasComEstoquePositivo ?? 0),
          Number(venda.diasComEstoquePositivo ?? 0)
        );
        current.diasSemEstoque = Math.min(
          Number(current.diasSemEstoque ?? 365),
          Number(venda.diasSemEstoque ?? 365)
        );
        current.mesesDisponiveis = Math.max(
          Number(current.mesesDisponiveis ?? 1),
          Number(venda.mesesDisponiveis ?? 1)
        );
        current.velocidadeAjustada = Math.max(
          Number(current.velocidadeAjustada ?? 0),
          Number(venda.velocidadeAjustada ?? 0)
        );
      } else {
        vendasPorFilialMap.set(key, {
          filial: normalizeControleEstoqueItemValue(venda.filial),
          qtde12m: Number(venda.qtde12m ?? 0),
          qtde60d: Number(venda.qtde60d ?? 0),
          qtdeMesAtual: Number(venda.qtdeMesAtual ?? 0),
          valor12m: Number(venda.valor12m ?? 0),
          custoUnitario: Number(venda.custoUnitario ?? 0),
          diasDesdeUltimaVenda: venda.diasDesdeUltimaVenda ?? null,
          primeiraEntradaFilial: venda.primeiraEntradaFilial ?? null,
          diasHistoricoFilial: Number(venda.diasHistoricoFilial ?? 0),
          mesesHistoricoFilial: Number(venda.mesesHistoricoFilial ?? 0),
          historicoParcial: Boolean(venda.historicoParcial),
          diasComEstoquePositivo: Number(venda.diasComEstoquePositivo ?? 0),
          diasSemEstoque: Number(venda.diasSemEstoque ?? 365),
          mesesDisponiveis: Number(venda.mesesDisponiveis ?? 1),
          velocidadeAjustada: Number(venda.velocidadeAjustada ?? 0),
        });
      }
    }
  }

  const estoquePorFilial = Array.from(estoquePorFilialMap.values());
  const vendasPorFilial = Array.from(vendasPorFilialMap.values());

  // A janela de ritmo (maior trecho contínuo com estoque) NÃO é derivável dos agregados por
  // filial — ela vem da simulação diária, que só os MEMBROS têm calculada. Se deixássemos o
  // summarize zerar a janela, todo produto AGRUPADO cairia em consumo 0 ("Suficiente"). Então
  // agregamos a janela dos membros: somamos as vendas-no-trecho e usamos o MAIOR trecho como
  // base de dias (período representativo). É a MESMA regra aplicada ao grupo, com dado real.
  let ritmoDiasComEstoque = 0;
  let ritmoVendasPeriodo = 0;
  let ritmoDiasComVenda = 0;
  let ritmoInicioIso: string | null = null;
  let ritmoFimIso: string | null = null;
  let ritmoPrimeiraVendaIso: string | null = null;
  let ritmoUltimaVendaIso: string | null = null;
  // Trecho recente + gap agregados: vendas do recente SOMAM (como as do maior trecho); dias do
  // recente = MAIOR entre os membros (janela representativa); o GAP vem do membro que define o
  // maior trecho (é "há quanto tempo o trecho-base do grupo terminou"); fim/início recente do
  // membro com o fim mais recente.
  let ritmoRecenteDias = 0;
  let ritmoRecenteVendas = 0;
  let ritmoRecenteInicioIso: string | null = null;
  let ritmoRecenteFimIso: string | null = null;
  let ritmoRecenteUltimaVendaIso: string | null = null;
  let ritmoGapDias = 0;
  for (const r of rows) {
    ritmoVendasPeriodo += Number(r.resumo?.ritmoVendasPeriodo ?? 0);
    ritmoDiasComVenda += Number(r.resumo?.ritmoDiasComVenda ?? 0);
    const dias = Number(r.resumo?.ritmoDiasComEstoque ?? 0);
    if (dias > ritmoDiasComEstoque) {
      ritmoDiasComEstoque = dias;
      ritmoInicioIso = r.resumo?.ritmoInicioIso ?? null;
      ritmoFimIso = r.resumo?.ritmoFimIso ?? null;
      ritmoGapDias = Number(r.resumo?.ritmoGapDias ?? 0);
    }
    ritmoPrimeiraVendaIso = getEarlierIsoDate(ritmoPrimeiraVendaIso, r.resumo?.ritmoPrimeiraVendaIso ?? null);
    const ult = r.resumo?.ritmoUltimaVendaIso ?? null;
    if (ult && ult > (ritmoUltimaVendaIso ?? "")) ritmoUltimaVendaIso = ult;
    ritmoRecenteVendas += Number(r.resumo?.ritmoRecenteVendas ?? 0);
    const rDias = Number(r.resumo?.ritmoRecenteDias ?? 0);
    if (rDias > ritmoRecenteDias) ritmoRecenteDias = rDias;
    const rFim = r.resumo?.ritmoRecenteFimIso ?? null;
    if (rFim && rFim > (ritmoRecenteFimIso ?? "")) {
      ritmoRecenteFimIso = rFim;
      ritmoRecenteInicioIso = r.resumo?.ritmoRecenteInicioIso ?? null;
    }
    // Venda mais recente entre os membros: define se o GRUPO "vendeu recentemente".
    const rUlt = r.resumo?.ritmoRecenteUltimaVendaIso ?? null;
    if (rUlt && rUlt > (ritmoRecenteUltimaVendaIso ?? "")) ritmoRecenteUltimaVendaIso = rUlt;
  }

  return {
    item: {
      produto: rows[0]?.item.produto ?? "",
      corProduto: rows[0]?.item.corProduto ?? null,
    },
    estoquePorFilial,
    vendasPorFilial,
    resumo: {
      ...summarizeControleEstoqueItemMetricas({ estoquePorFilial, vendasPorFilial }),
      // Janela agregada dos membros (o summarize sozinho a zeraria).
      ritmoDiasComEstoque,
      ritmoVendasPeriodo,
      ritmoDiasComVenda,
      ritmoInicioIso,
      ritmoFimIso,
      ritmoPrimeiraVendaIso,
      ritmoUltimaVendaIso,
      ritmoRecenteDias,
      ritmoRecenteVendas,
      ritmoRecenteInicioIso,
      ritmoRecenteFimIso,
      ritmoRecenteUltimaVendaIso,
      ritmoGapDias,
    },
  };
}

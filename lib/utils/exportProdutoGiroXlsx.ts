import * as XLSX from "xlsx";
import type { CompanyKey } from "@/lib/config/company";

export interface ProdutoGiroXlsxRow {
  PRODUTO: string;
  DESCRICAO: string;
  COR: string;
  CATEGORIA: string;
  SUBGRUPO: string;
  COLECAO: string;
  GRADE: string;
  VENDAS: number;
  QTDE: number;
  MEDIA_DIARIA: number;
  ESTOQUE: number;
  DURACAO_DIAS: number | "";
  ACABA_EM: string;
  COMPRA_SUGERIDA: number | "";
  STATUS: string;
  /** Lente de transferência (opcional; presente só quando "Ver transferências" está ligado). */
  TRANSFERENCIA?: number | "";
}

function safeFilenamePart(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function formatDateRange(start: Date, end: Date): string {
  const s = start.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  const e = end.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
  return `${s.replace(/\//g, "-")}_${e.replace(/\//g, "-")}`;
}

/** Linha da aba "Performance" (venda real por semana/mês). */
export interface ProdutoGiroPerfXlsxRow {
  PERIODO: string;
  INICIO: string;
  FIM: string;
  DIAS: number;
  VENDAS: number;
  QTDE: number;
  VAR_PCT_VS_ANTERIOR: number | "";
  /** Base da % (ex.: "semana anterior" ou "mesmos 3 dias da semana passada"). */
  BASE_COMPARACAO: string;
}

/** Matriz "vendas por dia": cada linha é um item×cor; colunas de dia são dinâmicas (dd/mm). */
export interface ProdutoGiroDiarioSheet {
  dias: string[]; // ISO yyyy-MM-dd, na ordem das colunas
  /** Totais agregados por dia (todos os itens) — qtd e R$. */
  totaisPorDia?: Array<{ dia: string; qtde: number; vendas: number }>;
  itens: Array<{
    produto: string;
    descricao: string;
    cor: string;
    subgrupo: string;
    colecao: string;
    grade: string;
    totalQtde: number;
    totalVendas: number;
    porDia: Record<string, number>;
  }>;
}

/** Uma linha rótulo→valor da aba "Resumo" (KPIs). */
export type ProdutoGiroResumoRow = [string, string | number];

/** Linha da aba "Vendas por filial". */
export interface ProdutoGiroFilialXlsxRow {
  FILIAL: string;
  TIPO: string;
  VENDAS: number;
  QTDE: number;
  PCT: number;
}

function diaHeader(iso: string): string {
  const p = iso.split("-");
  return p.length === 3 ? `${p[2]}/${p[1]}` : iso;
}

/**
 * Exporta a tabela (item × cor) numa aba e, opcionalmente, a performance por período e a
 * matriz de vendas por dia em abas extras. Todas já refletem os filtros/escopo da tela.
 */
export function exportProdutoGiroXlsx(
  rows: ProdutoGiroXlsxRow[],
  options: {
    companyKey: CompanyKey;
    range: { startDate: Date; endDate: Date };
    filialLabel?: string | null;
    performance?: ProdutoGiroPerfXlsxRow[];
    performanceLabel?: string;
    diario?: ProdutoGiroDiarioSheet | null;
    filiais?: ProdutoGiroFilialXlsxRow[] | null;
    resumo?: ProdutoGiroResumoRow[] | null;
  }
): void {
  if (rows.length === 0) {
    alert("Não há dados para exportar");
    return;
  }

  const workbook = XLSX.utils.book_new();

  // Aba 1 (primeira página): Resumo com os principais KPIs.
  if (options.resumo && options.resumo.length > 0) {
    const resumoSheet = XLSX.utils.aoa_to_sheet([["INDICADOR", "VALOR"], ...options.resumo]);
    resumoSheet["!cols"] = [{ wch: 30 }, { wch: 28 }];
    XLSX.utils.book_append_sheet(workbook, resumoSheet, "Resumo");
  }

  const worksheet = XLSX.utils.json_to_sheet(rows);

  // Larguras aproximadas por coluna (ordem = chaves do objeto).
  const cols = [
    { wch: 14 }, // PRODUTO
    { wch: 40 }, // DESCRICAO
    { wch: 18 }, // COR
    { wch: 18 }, // CATEGORIA
    { wch: 18 }, // SUBGRUPO
    { wch: 16 }, // COLECAO
    { wch: 10 }, // GRADE
    { wch: 14 }, // VENDAS
    { wch: 8 }, // QTDE
    { wch: 12 }, // MEDIA_DIARIA
    { wch: 10 }, // ESTOQUE
    { wch: 12 }, // DURACAO_DIAS
    { wch: 12 }, // ACABA_EM
    { wch: 16 }, // COMPRA_SUGERIDA
    { wch: 12 }, // STATUS
  ];
  if (rows[0]?.TRANSFERENCIA !== undefined) cols.push({ wch: 14 }); // TRANSFERENCIA
  worksheet["!cols"] = cols;

  XLSX.utils.book_append_sheet(workbook, worksheet, "Produto Giro");

  // Segunda aba: performance por período (venda real por semana/mês), quando fornecida.
  if (options.performance && options.performance.length > 0) {
    const perfSheet = XLSX.utils.json_to_sheet(options.performance);
    perfSheet["!cols"] = [
      { wch: 16 }, // PERIODO
      { wch: 12 }, // INICIO
      { wch: 12 }, // FIM
      { wch: 7 }, // DIAS
      { wch: 14 }, // VENDAS
      { wch: 10 }, // QTDE
      { wch: 18 }, // VAR_PCT_VS_ANTERIOR
      { wch: 34 }, // BASE_COMPARACAO
    ];
    XLSX.utils.book_append_sheet(workbook, perfSheet, options.performanceLabel ?? "Performance");
  }

  // Aba extra: vendas por filial (+ % do total).
  if (options.filiais && options.filiais.length > 0) {
    const filialSheet = XLSX.utils.json_to_sheet(options.filiais);
    filialSheet["!cols"] = [{ wch: 28 }, { wch: 12 }, { wch: 14 }, { wch: 10 }, { wch: 8 }];
    XLSX.utils.book_append_sheet(workbook, filialSheet, "Vendas por filial");
  }

  // Aba extra: matriz de vendas por dia (item×cor nas linhas, um dia por coluna).
  if (options.diario && options.diario.itens.length > 0 && options.diario.dias.length > 0) {
    const { dias, itens, totaisPorDia } = options.diario;
    const aoa: (string | number)[][] = [];
    // Cabeçalho
    aoa.push([
      "PRODUTO",
      "DESCRICAO",
      "COR",
      "SUBGRUPO",
      "COLECAO",
      "GRADE",
      "TOTAL_QTDE",
      "TOTAL_VENDAS",
      ...dias.map(diaHeader),
    ]);
    // Totais por dia — preferir os agregados do servidor (qtd + R$); fallback pela soma dos itens.
    const totByDia = new Map((totaisPorDia ?? []).map((t) => [t.dia, t]));
    const qtdePorDia = dias.map((d) => totByDia.get(d)?.qtde ?? itens.reduce((s, it) => s + (it.porDia[d] ?? 0), 0));
    const vendasPorDia = dias.map((d) => Math.round((totByDia.get(d)?.vendas ?? 0) * 100) / 100);
    const grandQtde = itens.reduce((s, it) => s + it.totalQtde, 0);
    const grandVendas = Math.round(itens.reduce((s, it) => s + it.totalVendas, 0) * 100) / 100;
    // Linha 1: TOTAL de QUANTIDADE por dia. Linha 2: TOTAL de VENDAS (R$) por dia.
    aoa.push(["TOTAL QTDE / dia", `${itens.length} itens`, "", "", "", "", grandQtde, "", ...qtdePorDia]);
    aoa.push(["TOTAL VENDAS (R$) / dia", "", "", "", "", "", "", grandVendas, ...vendasPorDia]);
    for (const it of itens) {
      aoa.push([
        it.produto.trim(),
        it.descricao,
        it.cor,
        it.subgrupo,
        it.colecao,
        it.grade,
        it.totalQtde,
        it.totalVendas,
        ...dias.map((d) => it.porDia[d] ?? 0),
      ]);
    }
    const diarioSheet = XLSX.utils.aoa_to_sheet(aoa);
    diarioSheet["!cols"] = [
      { wch: 14 },
      { wch: 40 },
      { wch: 18 },
      { wch: 18 },
      { wch: 16 },
      { wch: 10 },
      { wch: 12 },
      { wch: 14 },
      ...dias.map(() => ({ wch: 7 })),
    ];
    XLSX.utils.book_append_sheet(workbook, diarioSheet, "Vendas por dia");
  }

  const filialPart = options.filialLabel ? `-${safeFilenamePart(options.filialLabel)}` : "";
  const filename = `produto-giro-${options.companyKey}${filialPart}-${formatDateRange(
    options.range.startDate,
    options.range.endDate
  )}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

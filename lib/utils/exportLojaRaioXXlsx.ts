/**
 * Export "Loja Raio X" para XLSX (client-side, multi-abas). Busca os dados direto
 * da API (independente do que já está carregado nas abas da tela) para garantir
 * que o export sempre saia completo, mesmo que o usuário não tenha aberto todas
 * as abas.
 *
 * Abas: Resumo, Diferença de Produtos, Produtos (vendas x estoque), Vendedores, Rupturas.
 */
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore - xlsx tipos incompletos
import * as XLSX from "xlsx";

import type { CompanyKey } from "@/lib/config/company";

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function ymLabel(ym: string): string {
  const [ano, mes] = ym.split("-").map(Number);
  return `${MESES_ABREV[(mes || 1) - 1]}/${String(ano).slice(2)}`;
}

function autoWidth(ws: XLSX.WorkSheet): void {
  const ref = ws["!ref"];
  if (!ref) return;
  const range = XLSX.utils.decode_range(ref);
  const colWidths: number[] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    for (let C = range.s.c; C <= range.e.c; C++) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      const len = cell ? String(cell.v ?? "").length : 0;
      colWidths[C] = Math.min(Math.max(colWidths[C] ?? 10, len + 2), 60);
    }
  }
  ws["!cols"] = colWidths.map((w) => ({ wch: w }));
}

function safeFilenamePart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 48);
}

function round2(v: number | null | undefined): number | "" {
  if (v == null || !Number.isFinite(v)) return "";
  return Math.round(v * 100) / 100;
}

/** "2026-07-20" → "20/07". Vazio se inválido. */
function shortDate(iso: string | null): string {
  if (!iso) return "";
  const [, m, d] = iso.split("-");
  return m && d ? `${d}/${m}` : "";
}

/** Texto da célula "Em trânsito" para o item (vazio quando não há compra a caminho). */
function transitoCell(item: { emTransito: boolean; transitoQtd: number; transitoData: string | null }): string {
  if (!item.emTransito) return "";
  const qtd = item.transitoQtd > 0 ? `+${item.transitoQtd} un` : "Sim";
  const data = item.transitoData ? ` (${shortDate(item.transitoData)})` : "";
  return `${qtd}${data}`;
}

// ── Tipos (espelham o payload de /api/loja-raio-x) ───────────────────────────

interface MesMetric {
  ym: string;
  label: string;
  faturamento: number;
  tickets: number;
  quantidade: number;
  ticketMedio: number;
}
interface Janela {
  parcial: boolean;
  analisadoLabel: string;
  comparacaoLabel: string | null;
}
interface PrincipalData {
  analyzed: MesMetric | null;
  comparacao: MesMetric | null;
  isMesmo: boolean;
  janela: Janela;
  decomposicao: { gap: number; porAtendimentos: number; porTicketMedio: number } | null;
}
interface ComparacaoProdutoItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
  qtdAnalisado: number;
  fatAnalisado: number;
  qtdComparacao: number;
  fatComparacao: number;
  diffFat: number;
  estoqueLoja: number;
  estoqueFimMesAnalisado: number | null;
  temNaRede: boolean;
}
interface ComparacaoData {
  ruptura: ComparacaoProdutoItem[];
  tinhaEstoque: ComparacaoProdutoItem[];
  cresceu: ComparacaoProdutoItem[];
  rupturaCount: number;
  tinhaEstoqueCount: number;
  cresceuCount: number;
  rupturaFat: number;
  tinhaEstoqueFat: number;
  cresceuFat: number;
  truncado: boolean;
}
interface ProdutoVendaEstoqueItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
  qtdAntes: number;
  fatAntes: number;
  qtdDepois: number;
  fatDepois: number;
  estoque: number;
  acabaEmDias: number | null;
}
interface ProdutosEstoqueData {
  semEstoque: ProdutoVendaEstoqueItem[];
  comEstoque: ProdutoVendaEstoqueItem[];
  truncado: boolean;
}
interface VendedorLinha {
  vendedor: string;
  porMes: Record<string, { valor: number; qtd: number }>;
  totalValor: number;
  totalQtd: number;
}
interface VendedoresData {
  meses: string[];
  vendedores: VendedorLinha[];
}
interface RupturaItem {
  produto: string;
  cor: string;
  corDescricao: string;
  descricao: string;
  subgrupo: string | null;
  grade: string | null;
  descontinuado: boolean;
  emTransito: boolean;
  transitoQtd: number;
  transitoData: string | null;
  qtdVendida: number;
  faturamento: number;
  estoqueLoja: number;
  ondeTemEstoque: Array<{ filial: string; estoque: number }>;
}

export interface ExportLojaRaioXOptions {
  companyKey: CompanyKey;
  filial: string | null;
  mes: string; // YYYY-MM analisado
  comparar: string; // "auto" ou YYYY-MM
  isRede: boolean;
  filialLabel?: string | null;
}

async function fetchSection<T>(params: URLSearchParams): Promise<T> {
  const res = await fetch(`/api/loja-raio-x?${params.toString()}`, { cache: "no-store" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || "Falha ao buscar dados do Loja Raio X");
  }
  const json = await res.json();
  return json.data as T;
}

function baseParams(options: ExportLojaRaioXOptions, section: string): URLSearchParams {
  const params = new URLSearchParams({ company: options.companyKey, section });
  if (options.filial) params.set("filial", options.filial);
  return params;
}

export async function exportLojaRaioXXlsx(options: ExportLojaRaioXOptions): Promise<void> {
  // 1. Principal primeiro — resolve o mês de comparação real (auto = melhor mês).
  const principalParams = baseParams(options, "principal");
  principalParams.set("mes", options.mes);
  if (options.comparar !== "auto") principalParams.set("comparar", options.comparar);
  const principal = await fetchSection<PrincipalData>(principalParams);

  if (!principal.analyzed) {
    alert("Não há dados para exportar neste período.");
    return;
  }

  const compYm = principal.comparacao?.ym ?? null;
  const temComparacao = !!compYm && !principal.isMesmo;

  // 2. Demais seções em paralelo (vendedores e rupturas independem da comparação).
  const rupturasParams = baseParams(options, "rupturas");
  rupturasParams.set("mes", options.mes);
  const vendedoresParams = baseParams(options, "vendedores");

  const [vendedores, rupturas, comparacao, produtosEstoque] = await Promise.all([
    fetchSection<VendedoresData>(vendedoresParams),
    fetchSection<RupturaItem[]>(rupturasParams),
    temComparacao
      ? (() => {
          const p = baseParams(options, "comparacao");
          p.set("mes", options.mes);
          p.set("comparar", compYm!);
          return fetchSection<ComparacaoData>(p);
        })()
      : Promise.resolve(null),
    temComparacao
      ? (() => {
          const p = baseParams(options, "produtos-estoque");
          p.set("mes", options.mes);
          p.set("comparar", compYm!);
          return fetchSection<ProdutosEstoqueData>(p);
        })()
      : Promise.resolve(null),
  ]);

  const workbook = XLSX.utils.book_new();
  const escopoLabel = options.isRede ? "Rede (todas as lojas)" : (options.filialLabel ?? options.filial ?? "—");
  // ScarfMe exige subgrupo + grade em todo item de produto (grade só existe p/ scarfme).
  const showGradeSubgrupo = options.companyKey === "scarfme";
  const gsHeaders = showGradeSubgrupo ? ["Subgrupo", "Grade"] : [];

  // ─── ABA: RESUMO ────────────────────────────────────────────────────────
  const { analyzed, comparacao: comparacaoMes, janela, decomposicao } = principal;
  const resumoAoa: (string | number)[][] = [
    ["LOJA RAIO X — RESUMO"],
    ["Empresa", options.companyKey],
    ["Escopo", escopoLabel],
    ["Mês analisado", janela.analisadoLabel],
    ["Mês comparação", janela.comparacaoLabel ?? "—"],
    [],
    ["Indicador", "Analisado", "Comparação", "Diferença"],
    [
      "Faturamento (R$)",
      round2(analyzed!.faturamento),
      comparacaoMes ? round2(comparacaoMes.faturamento) : "",
      comparacaoMes ? round2(analyzed!.faturamento - comparacaoMes.faturamento) : "",
    ],
    [
      "Tickets",
      analyzed!.tickets,
      comparacaoMes ? comparacaoMes.tickets : "",
      comparacaoMes ? analyzed!.tickets - comparacaoMes.tickets : "",
    ],
    [
      "Ticket médio (R$)",
      round2(analyzed!.ticketMedio),
      comparacaoMes ? round2(comparacaoMes.ticketMedio) : "",
      comparacaoMes ? round2(analyzed!.ticketMedio - comparacaoMes.ticketMedio) : "",
    ],
    [
      "Peças vendidas",
      analyzed!.quantidade,
      comparacaoMes ? comparacaoMes.quantidade : "",
      comparacaoMes ? analyzed!.quantidade - comparacaoMes.quantidade : "",
    ],
  ];
  if (decomposicao) {
    resumoAoa.push(
      [],
      ["Decomposição do gap", ""],
      ["Gap total (R$)", round2(decomposicao.gap)],
      ["Por tickets — volume (R$)", round2(decomposicao.porAtendimentos)],
      ["Por ticket médio — valor (R$)", round2(decomposicao.porTicketMedio)]
    );
  }
  if (principal.isMesmo) {
    resumoAoa.push([], ["Nota", "Mês analisado é o próprio mês de comparação — sem gap/decomposição."]);
  }
  const wsResumo = XLSX.utils.aoa_to_sheet(resumoAoa);
  autoWidth(wsResumo);
  XLSX.utils.book_append_sheet(workbook, wsResumo, "Resumo");

  // ─── ABA: DIFERENÇA DE PRODUTOS ─────────────────────────────────────────
  if (comparacao) {
    const anLabel = janela.analisadoLabel;
    const compLabel = janela.comparacaoLabel ?? "";
    const diffHeaders = [
      "Situação",
      "Produto",
      "Descrição",
      "Cor",
      ...gsHeaders,
      `Qtd (${compLabel})`,
      `Fat (${compLabel})`,
      `Qtd (${anLabel})`,
      `Fat (${anLabel})`,
      "Diferença (R$)",
      "Estoque no mês",
      "Estoque hoje",
      "Tem na rede",
      "Descontinuado",
      "Em trânsito",
    ];
    const rowsFor = (items: ComparacaoProdutoItem[], situacao: string) =>
      items.map((p) => [
        situacao,
        p.produto,
        p.descricao || "",
        p.corDescricao || p.cor || "",
        ...(showGradeSubgrupo ? [p.subgrupo || "", p.grade || ""] : []),
        p.qtdComparacao,
        round2(p.fatComparacao),
        p.qtdAnalisado,
        round2(p.fatAnalisado),
        round2(p.diffFat),
        p.estoqueFimMesAnalisado ?? p.estoqueLoja,
        p.estoqueLoja,
        p.temNaRede ? "Sim" : "Não",
        p.descontinuado ? "Sim" : "Não",
        // Trânsito só é relevante em ruptura (produto faltando, mas já a caminho).
        situacao === "Faltou produto" ? transitoCell(p) : "",
      ]);
    const diffRows = [
      ...rowsFor(comparacao.ruptura, "Faltou produto"),
      ...rowsFor(comparacao.tinhaEstoque, "Tinha estoque, vendeu menos"),
      ...rowsFor(comparacao.cresceu, "Compensou (cresceu)"),
    ];
    const diffAoa: (string | number)[][] = [
      diffHeaders,
      ...diffRows,
      [],
      ["Resumo", "Qtd SKUs", "Faturamento (R$)"],
      ["Faltou produto", comparacao.rupturaCount, round2(comparacao.rupturaFat)],
      ["Tinha estoque, vendeu menos", comparacao.tinhaEstoqueCount, round2(comparacao.tinhaEstoqueFat)],
      ["Compensou (cresceu)", comparacao.cresceuCount, round2(comparacao.cresceuFat)],
    ];
    if (comparacao.truncado) {
      diffAoa.push([], ["Nota", "Lista truncada: mostrando os maiores de cada grupo."]);
    }
    const wsDiff = XLSX.utils.aoa_to_sheet(diffAoa);
    autoWidth(wsDiff);
    XLSX.utils.book_append_sheet(workbook, wsDiff, "Diferença de Produtos");
  }

  // ─── ABA: PRODUTOS (VENDAS x ESTOQUE) ───────────────────────────────────
  if (produtosEstoque) {
    const anLabel = janela.analisadoLabel;
    const compLabel = janela.comparacaoLabel ?? "";
    const peHeaders = [
      "Produto",
      "Descrição",
      "Cor",
      ...gsHeaders,
      `Vendas antes (${compLabel})`,
      `Fat antes (${compLabel})`,
      `Vendas depois (${anLabel})`,
      `Fat depois (${anLabel})`,
      "Estoque",
      "Acaba em (dias)",
      "Descontinuado",
      "Em trânsito",
    ];
    // showTransito: só na seção SEM estoque (ruptura — o que já está a caminho importa).
    const rowsFor = (items: ProdutoVendaEstoqueItem[], showTransito: boolean) =>
      items.map((p) => [
        p.produto,
        p.descricao || "",
        p.corDescricao || p.cor || "",
        ...(showGradeSubgrupo ? [p.subgrupo || "", p.grade || ""] : []),
        p.qtdAntes,
        round2(p.fatAntes),
        p.qtdDepois,
        round2(p.fatDepois),
        p.estoque,
        p.acabaEmDias == null ? "sem giro" : p.acabaEmDias <= 0 ? "esgotado" : p.acabaEmDias,
        p.descontinuado ? "Sim" : "Não",
        showTransito ? transitoCell(p) : "",
      ]);
    const peAoa: (string | number)[][] = [
      [`PRODUTOS VENDIDOS SEM ESTOQUE — ${produtosEstoque.semEstoque.length}`],
      peHeaders,
      ...rowsFor(produtosEstoque.semEstoque, true),
      [],
      [`PRODUTOS VENDIDOS COM ESTOQUE — ${produtosEstoque.comEstoque.length}`],
      peHeaders,
      ...rowsFor(produtosEstoque.comEstoque, false),
    ];
    if (produtosEstoque.truncado) {
      peAoa.push([], ["Nota", "Lista truncada: mostrando os principais de cada grupo."]);
    }
    const wsPe = XLSX.utils.aoa_to_sheet(peAoa);
    autoWidth(wsPe);
    XLSX.utils.book_append_sheet(workbook, wsPe, "Produtos (Vendas x Estoque)");
  }

  // ─── ABA: VENDEDORES ─────────────────────────────────────────────────────
  if (vendedores.vendedores.length > 0) {
    const vendHeaders = [
      "Vendedor",
      ...vendedores.meses.flatMap((ym) => [`${ymLabel(ym)} (R$)`, `${ymLabel(ym)} (pç)`]),
      "Total (R$)",
      "Total (pç)",
    ];
    const vendRows = vendedores.vendedores.map((v) => [
      v.vendedor,
      ...vendedores.meses.flatMap((ym) => {
        const cell = v.porMes[ym];
        return [cell ? round2(cell.valor) : "", cell ? cell.qtd : ""];
      }),
      round2(v.totalValor),
      v.totalQtd,
    ]);
    const wsVend = XLSX.utils.aoa_to_sheet([vendHeaders, ...vendRows]);
    autoWidth(wsVend);
    XLSX.utils.book_append_sheet(workbook, wsVend, "Vendedores");
  }

  // ─── ABA: RUPTURAS ───────────────────────────────────────────────────────
  const rupHeaders = [
    "Produto",
    "Descrição",
    "Cor",
    ...gsHeaders,
    "Vendeu (qtd)",
    "Faturou (R$)",
    options.isRede ? "Estoque rede" : "Estoque loja",
    "Onde tem estoque",
    "Descontinuado",
    "Em trânsito",
  ];
  const rupRows = rupturas.map((r) => [
    r.produto,
    r.descricao || "",
    r.corDescricao || r.cor || "",
    ...(showGradeSubgrupo ? [r.subgrupo || "", r.grade || ""] : []),
    r.qtdVendida,
    round2(r.faturamento),
    r.estoqueLoja,
    r.ondeTemEstoque.length === 0
      ? "Zerado em toda a rede"
      : r.ondeTemEstoque.map((f) => `${f.filial}: ${f.estoque}`).join("; "),
    r.descontinuado ? "Sim" : "Não",
    transitoCell(r),
  ]);
  const wsRup = XLSX.utils.aoa_to_sheet([[`${janela.analisadoLabel} — ${rupturas.length} produtos zerados`], rupHeaders, ...rupRows]);
  autoWidth(wsRup);
  XLSX.utils.book_append_sheet(workbook, wsRup, "Rupturas");

  const dateStr = new Date().toISOString().split("T")[0];
  const escopoSlug = options.isRede ? "rede" : safeFilenamePart(options.filialLabel ?? options.filial ?? "loja");
  const filename = `loja-raio-x-${options.companyKey}-${escopoSlug}-${options.mes}-${dateStr}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

import { NextResponse } from "next/server";

import { VAREJO_VALUE } from "@/lib/config/company";
import { fetchSalesTotals, type SalesTotals } from "@/lib/services/salesTotals";
import {
  fetchFaturamentoMensalLoja,
  fetchVendedoresMatrizMensal,
  fetchVendedoresMesResumo,
  fetchRupturasLoja,
  fetchComparacaoProdutosLoja,
  fetchProdutosVendaEstoque,
  analyzedWindow,
  comparacaoWindow,
  type MesMetric,
  type VendedorMesResumo,
  type Range,
} from "@/lib/repositories/lojaRaioX";

// Consultas por loja com 12 meses de histórico podem demorar; folga no timeout.
export const maxDuration = 300;

const MESES_ABREV = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

/** NERD conta só ELETRONICOS (espelha o dashboard). ScarfMe = todas as linhas. */
function linhasEscopo(company: string | undefined): string[] | null {
  return company === "nerd" ? ["ELETRONICOS"] : null;
}

function round2(v: number): number {
  return Math.round((v ?? 0) * 100) / 100;
}

/**
 * Constrói o KPI de um mês a partir dos totais CANÔNICOS (fetchSalesTotals — mesma
 * fórmula do dashboard/Curva ABC). Faturamento = líquido (com trocas/devoluções).
 */
function metricFromTotals(ym: string, label: string, t: SalesTotals): MesMetric {
  const [ano, mes] = ym.split("-").map(Number);
  const faturamento = round2(t.vendas);
  return {
    ano,
    mes,
    ym,
    label,
    faturamento,
    tickets: t.tickets,
    quantidade: Math.round(t.qtde),
    ticketMedio: t.tickets > 0 ? round2(faturamento / t.tickets) : 0,
  };
}

/** Rótulo da janela: "jul/26" (mês inteiro) ou "1–8 jul" (parcial/alinhada). */
function janelaLabel(range: Range, ym: string): string {
  const [ano, mes] = ym.split("-").map(Number);
  const abrev = MESES_ABREV[(mes || 1) - 1];
  const startDay = range.start.getUTCDate();
  const inclusiveEnd = new Date(range.end.getTime() - 86_400_000);
  const endDay = inclusiveEnd.getUTCDate();
  const lastDay = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const mesInteiro = startDay === 1 && endDay >= lastDay;
  return mesInteiro ? `${abrev}/${String(ano).slice(2)}` : `${startDay}–${endDay} ${abrev}`;
}

/** Melhor mês (por faturamento) entre os últimos N meses da série (exclui o analisado). */
function melhorMesDosUltimos(meses: MesMetric[], n: number, excluirYm: string): MesMetric | null {
  const janela = meses.slice(-n).filter((m) => m.faturamento > 0 && m.ym !== excluirYm);
  if (janela.length === 0) return null;
  return janela.reduce((best, m) => (m.faturamento > best.faturamento ? m : best), janela[0]);
}

/** Resumo de vendedores (mês analisado vs comparação) a partir de 2 janelas. */
function resumoVendedores(
  analisadoLista: VendedorMesResumo[],
  compLista: VendedorMesResumo[],
  temComparacao: boolean
) {
  const analisadoMap = new Map(analisadoLista.map((v) => [v.vendedor, v.valor]));
  const compMap = new Map(compLista.map((v) => [v.vendedor, v.valor]));
  const ativosAnalisado = analisadoLista.filter((v) => v.valor > 0).length;
  const ativosBest = compLista.filter((v) => v.valor > 0).length;

  const nomes = new Set([...analisadoMap.keys(), ...compMap.keys()]);
  const quedas: Array<{ vendedor: string; analisado: number; melhor: number; queda: number }> = [];
  const ranking: Array<{ vendedor: string; analisado: number; comparacao: number; diff: number }> = [];
  for (const nome of nomes) {
    const analisado = analisadoMap.get(nome) ?? 0;
    const comp = compMap.get(nome) ?? 0;
    ranking.push({ vendedor: nome, analisado, comparacao: comp, diff: comp - analisado });
    if (temComparacao && comp - analisado > 0) {
      quedas.push({ vendedor: nome, analisado, melhor: comp, queda: comp - analisado });
    }
  }
  quedas.sort((a, b) => b.queda - a.queda);
  ranking.sort((a, b) => b.comparacao - a.comparacao || b.analisado - a.analisado);
  return { ativosAnalisado, ativosBest, quedas: quedas.slice(0, 5), ranking: ranking.slice(0, 10) };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const mes = searchParams.get("mes") ?? undefined; // YYYY-MM
  const section = searchParams.get("section") ?? "principal";
  const linhas = linhasEscopo(company);
  // filial === null → visão REDE (agrega todas as lojas físicas da empresa, sem e-commerce).
  // Para os totais canônicos, rede = VAREJO (fetchSalesTotals exclui e-commerce).
  const filialTotals = filial ?? VAREJO_VALUE;

  try {
    if (section === "vendedores") {
      const data = await fetchVendedoresMatrizMensal({ company, filial, linhas });
      return NextResponse.json({ data });
    }

    if (section === "rupturas") {
      if (!mes) {
        return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
      }
      const win = analyzedWindow(mes);
      const data = await fetchRupturasLoja({ company, filial, range: win.range, linhas, withCompraIdeal: true });
      return NextResponse.json({ data });
    }

    if (section === "comparacao") {
      const comparar = searchParams.get("comparar"); // ym do mês de comparação (resolvido no client)
      if (!mes || !comparar) {
        return NextResponse.json({ error: "Meses inválidos." }, { status: 400 });
      }
      const win = analyzedWindow(mes);
      const rangeComparacao = comparacaoWindow(win.range, mes, comparar);
      const data = await fetchComparacaoProdutosLoja({
        company,
        filial,
        rangeAnalisado: win.range,
        rangeComparacao,
        linhas,
      });
      return NextResponse.json({ data });
    }

    if (section === "produtos-estoque") {
      const comparar = searchParams.get("comparar"); // ym do mês de referência (resolvido no client)
      if (!mes || !comparar) {
        return NextResponse.json({ error: "Meses inválidos." }, { status: 400 });
      }
      const win = analyzedWindow(mes);
      const rangeComparacao = comparacaoWindow(win.range, mes, comparar);
      const data = await fetchProdutosVendaEstoque({
        company,
        filial,
        rangeAnalisado: win.range,
        rangeComparacao,
        linhas,
      });
      return NextResponse.json({ data });
    }

    // ── section === "principal" (default): linha do tempo + diagnóstico ──────
    // Palpite: o client sempre manda `mes`. Dispara rupturas + vendedores do mês
    // analisado EM PARALELO com a série de 12 meses (pesada na visão rede).
    const winGuess = mes ? analyzedWindow(mes) : null;
    const [meses, rupturasGuess, vendAnalisadoGuess] = await Promise.all([
      fetchFaturamentoMensalLoja({ company, filial, linhas }),
      winGuess ? fetchRupturasLoja({ company, filial, range: winGuess.range, linhas }) : Promise.resolve(null),
      winGuess ? fetchVendedoresMesResumo({ company, filial, range: winGuess.range, linhas }) : Promise.resolve(null),
    ]);

    const analyzedYm = mes && meses.some((m) => m.ym === mes) ? mes : meses[meses.length - 1]?.ym;
    if (!analyzedYm) {
      return NextResponse.json({ error: "Sem dados para o período." }, { status: 200 });
    }
    const analyzedWin =
      analyzedYm === mes && winGuess ? winGuess : analyzedWindow(analyzedYm);
    const analyzedLabelBase = meses.find((m) => m.ym === analyzedYm)?.label ?? analyzedYm;

    // Se o palpite não bateu (mes ausente/inválido), refaz rupturas/vendedores do mês certo.
    let rupturas = rupturasGuess;
    let vendAnalisado = vendAnalisadoGuess;
    if (analyzedYm !== mes || rupturas == null || vendAnalisado == null) {
      [rupturas, vendAnalisado] = await Promise.all([
        fetchRupturasLoja({ company, filial, range: analyzedWin.range, linhas }),
        fetchVendedoresMesResumo({ company, filial, range: analyzedWin.range, linhas }),
      ]);
    }
    rupturas = rupturas ?? [];
    vendAnalisado = vendAnalisado ?? [];

    // Mês de comparação: explícito (?comparar=YYYY-MM) ou automático = melhor mês dos últimos 6.
    const compararParam = searchParams.get("comparar");
    const compararEscolhido =
      compararParam && meses.some((m) => m.ym === compararParam)
        ? meses.find((m) => m.ym === compararParam) ?? null
        : null;
    const comparacaoMes = compararEscolhido ?? melhorMesDosUltimos(meses, 6, analyzedYm);
    const comparacaoAuto = !compararEscolhido;
    const isMesmo = !!(comparacaoMes && comparacaoMes.ym === analyzedYm);

    // Janela de comparação alinhada por dia (mesma faixa de dias do mês analisado).
    const comparWin =
      comparacaoMes && !isMesmo
        ? comparacaoWindow(analyzedWin.range, analyzedYm, comparacaoMes.ym)
        : null;

    // KPIs CANÔNICOS (fetchSalesTotals) nas janelas alinhadas — batem com o dashboard.
    const [analyzedTotals, comparTotals] = await Promise.all([
      fetchSalesTotals({ company, range: analyzedWin.range, filial: filialTotals, linhas }),
      comparWin
        ? fetchSalesTotals({ company, range: comparWin, filial: filialTotals, linhas })
        : Promise.resolve(null),
    ]);

    const analyzed = metricFromTotals(analyzedYm, analyzedLabelBase, analyzedTotals);
    const comparacao =
      comparacaoMes && comparWin && comparTotals
        ? metricFromTotals(comparacaoMes.ym, comparacaoMes.label, comparTotals)
        : comparacaoMes
          ? metricFromTotals(comparacaoMes.ym, comparacaoMes.label, analyzedTotals) // isMesmo
          : null;

    // Decomposição do gap (Faturamento = Atendimentos × Ticket médio), 2 fatores.
    let decomposicao: { gap: number; porAtendimentos: number; porTicketMedio: number } | null = null;
    if (comparacao && !isMesmo) {
      const gap = comparacao.faturamento - analyzed.faturamento;
      const porAtendimentos = (comparacao.tickets - analyzed.tickets) * analyzed.ticketMedio;
      const porTicketMedio = (comparacao.ticketMedio - analyzed.ticketMedio) * comparacao.tickets;
      decomposicao = {
        gap: round2(gap),
        porAtendimentos: round2(porAtendimentos),
        porTicketMedio: round2(porTicketMedio),
      };
    }

    // Resumo de vendedores do mês de comparação (só se diferente do analisado), alinhado.
    const vendCompRaw = comparWin
      ? await fetchVendedoresMesResumo({ company, filial, range: comparWin, linhas })
      : null;
    const vendComp = vendCompRaw ?? vendAnalisado;

    const rupturasResumo = {
      quantidade: rupturas.length,
      faturamento: round2(rupturas.reduce((s, r) => s + r.faturamento, 0)),
      comEstoqueNaRede: rupturas.filter((r) => r.ondeTemEstoque.length > 0).length,
    };

    const vendedoresResumo = resumoVendedores(vendAnalisado, vendComp, !!comparWin);

    const janela = {
      parcial: analyzedWin.isMesCorrente,
      diaCorte: analyzedWin.diaCorte,
      analisadoLabel: janelaLabel(analyzedWin.range, analyzedYm),
      comparacaoLabel: comparWin && comparacaoMes ? janelaLabel(comparWin, comparacaoMes.ym) : null,
    };

    return NextResponse.json({
      data: {
        meses,
        analyzed,
        comparacao,
        comparacaoAuto,
        isMesmo,
        janela,
        decomposicao,
        rupturasResumo,
        vendedoresResumo,
      },
    });
  } catch (error) {
    console.error("Erro ao carregar Loja Raio X", error);
    if (error instanceof Error && "code" in error && (error as { code?: string }).code === "ETIMEOUT") {
      return NextResponse.json(
        { error: "Timeout: a consulta demorou muito.", code: "ETIMEOUT" },
        { status: 504 }
      );
    }
    return NextResponse.json({ error: "Erro ao carregar Loja Raio X" }, { status: 500 });
  }
}

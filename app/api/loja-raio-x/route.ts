import { NextResponse } from "next/server";

import {
  fetchFaturamentoMensalLoja,
  fetchVendedoresMatrizMensal,
  fetchVendedoresMesResumo,
  fetchRupturasLoja,
  type MesMetric,
  type VendedorMesResumo,
} from "@/lib/repositories/lojaRaioX";

// Consultas por loja com 12 meses de histórico podem demorar; folga no timeout.
export const maxDuration = 300;

/** NERD conta só ELETRONICOS (espelha o dashboard). ScarfMe = todas as linhas. */
function linhasEscopo(company: string | undefined): string[] | null {
  return company === "nerd" ? ["ELETRONICOS"] : null;
}

/** Melhor mês (por faturamento) entre os últimos N meses da série. */
function melhorMesDosUltimos(meses: MesMetric[], n: number): MesMetric | null {
  const janela = meses.slice(-n).filter((m) => m.faturamento > 0);
  if (janela.length === 0) return null;
  return janela.reduce((best, m) => (m.faturamento > best.faturamento ? m : best), janela[0]);
}

/** Resumo de vendedores (mês analisado vs melhor mês) a partir de 2 consultas de mês. */
function resumoVendedores(
  analisadoLista: VendedorMesResumo[],
  bestLista: VendedorMesResumo[],
  temBest: boolean
) {
  const analisadoMap = new Map(analisadoLista.map((v) => [v.vendedor, v.valor]));
  const bestMap = new Map(bestLista.map((v) => [v.vendedor, v.valor]));
  const ativosAnalisado = analisadoLista.filter((v) => v.valor > 0).length;
  const ativosBest = bestLista.filter((v) => v.valor > 0).length;

  const quedas: Array<{ vendedor: string; analisado: number; melhor: number; queda: number }> = [];
  if (temBest) {
    const nomes = new Set([...analisadoMap.keys(), ...bestMap.keys()]);
    for (const nome of nomes) {
      const analisado = analisadoMap.get(nome) ?? 0;
      const melhor = bestMap.get(nome) ?? 0;
      if (melhor - analisado > 0) quedas.push({ vendedor: nome, analisado, melhor, queda: melhor - analisado });
    }
  }
  quedas.sort((a, b) => b.queda - a.queda);
  return { ativosAnalisado, ativosBest, quedas: quedas.slice(0, 5) };
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const filial = searchParams.get("filial");
  const mes = searchParams.get("mes") ?? undefined; // YYYY-MM
  const section = searchParams.get("section") ?? "principal";
  const linhas = linhasEscopo(company);

  if (!filial) {
    return NextResponse.json({ error: "Selecione uma filial." }, { status: 400 });
  }

  try {
    if (section === "vendedores") {
      const data = await fetchVendedoresMatrizMensal({ company, filial, linhas });
      return NextResponse.json({ data });
    }

    if (section === "rupturas") {
      if (!mes) {
        return NextResponse.json({ error: "Mês inválido." }, { status: 400 });
      }
      const data = await fetchRupturasLoja({ company, filial, mes, linhas });
      return NextResponse.json({ data });
    }

    // ── section === "principal" (default): linha do tempo + diagnóstico ──────
    const meses = await fetchFaturamentoMensalLoja({ company, filial, linhas });
    const analyzedYm = mes && meses.some((m) => m.ym === mes) ? mes : meses[meses.length - 1]?.ym;
    const analyzed = meses.find((m) => m.ym === analyzedYm) ?? null;

    // Mês de comparação: explícito (?comparar=YYYY-MM) ou automático = melhor mês dos últimos 6.
    const compararParam = searchParams.get("comparar");
    const compararEscolhido =
      compararParam && meses.some((m) => m.ym === compararParam)
        ? meses.find((m) => m.ym === compararParam) ?? null
        : null;
    const comparacao = compararEscolhido ?? melhorMesDosUltimos(meses, 6);
    const comparacaoAuto = !compararEscolhido;
    const isMesmo = !!(analyzed && comparacao && analyzed.ym === comparacao.ym);

    // Decomposição do gap (Faturamento = Tickets × TicketMédio), 2 fatores.
    let decomposicao: {
      gap: number;
      porAtendimentos: number;
      porTicketMedio: number;
    } | null = null;
    if (analyzed && comparacao && !isMesmo) {
      const gap = comparacao.faturamento - analyzed.faturamento;
      const porAtendimentos = (comparacao.tickets - analyzed.tickets) * analyzed.ticketMedio;
      const porTicketMedio = (comparacao.ticketMedio - analyzed.ticketMedio) * comparacao.tickets;
      decomposicao = {
        gap: Math.round(gap * 100) / 100,
        porAtendimentos: Math.round(porAtendimentos * 100) / 100,
        porTicketMedio: Math.round(porTicketMedio * 100) / 100,
      };
    }

    // Rupturas do mês analisado (resumo) + resumo de vendedores (meses leves, em paralelo).
    const [rupturas, vendAnalisado, vendCompRaw] = await Promise.all([
      analyzedYm ? fetchRupturasLoja({ company, filial, mes: analyzedYm, linhas }) : Promise.resolve([]),
      analyzedYm ? fetchVendedoresMesResumo({ company, filial, mes: analyzedYm, linhas }) : Promise.resolve([]),
      comparacao && comparacao.ym !== analyzedYm
        ? fetchVendedoresMesResumo({ company, filial, mes: comparacao.ym, linhas })
        : Promise.resolve(null),
    ]);
    const vendComp = vendCompRaw ?? vendAnalisado;

    const rupturasResumo = {
      quantidade: rupturas.length,
      faturamento: Math.round(rupturas.reduce((s, r) => s + r.faturamento, 0) * 100) / 100,
      comEstoqueNaRede: rupturas.filter((r) => r.ondeTemEstoque.length > 0).length,
    };

    const vendedoresResumo = resumoVendedores(vendAnalisado, vendComp, !!comparacao);

    return NextResponse.json({
      data: {
        meses,
        analyzed,
        comparacao,
        comparacaoAuto,
        isMesmo,
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

import { NextResponse } from "next/server";

import { fetchSalesTotals } from "@/lib/services/salesTotals";
import { normalizeRangeForQuery } from "@/lib/utils/date";
import type { CompanyKey } from "@/lib/config/company";

export const maxDuration = 120;

const MESES_ABREV = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MS_DIA = 24 * 60 * 60 * 1000;

/** Segunda-feira (local) da semana que contém `d`. */
function segundaDaSemana(d: Date): Date {
  const diff = (d.getDay() + 6) % 7; // dias desde a segunda (0=Dom)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff);
}

function inicioDoDia(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

interface Bucket {
  label: string;
  start: Date;
  /** Fim inclusivo NOMINAL do bucket (domingo da semana / último dia do mês). */
  endInclusive: Date;
  /** Fim inclusivo EFETIVO (limitado a hoje quando o bucket está em andamento). */
  endEffective: Date;
  /** Dias já decorridos no bucket (7 numa semana fechada; <7 na parcial). */
  dias: number;
  partial: boolean;
}

/**
 * Série de performance (faturamento) por SEMANA (default) ou MÊS para a Produto Giro.
 * Cada ponto é a venda REAL do período (sem extrapolar), da fonte canônica `fetchSalesTotals`.
 *
 * O período EM ANDAMENTO conta só os dias já decorridos (não a semana/mês inteiro) e sua
 * variação é comparada contra a MESMA quantidade de dias do período anterior (maçã com maçã),
 * não contra o período anterior cheio — senão a parcial pareceria sempre "caindo".
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") as CompanyKey | null;
  const filial = searchParams.get("filial") || null;
  const mode = searchParams.get("mode") === "month" ? "month" : "week";
  const produtoIds = searchParams.getAll("produto").map((p) => p.trim()).filter(Boolean);

  if (!company) {
    return NextResponse.json({ error: "Parâmetro company obrigatório" }, { status: 400 });
  }

  const now = new Date();
  const hoje = inicioDoDia(now);
  const buckets: Bucket[] = [];

  if (mode === "week") {
    const COUNT = 8;
    const semanaAtual = segundaDaSemana(now);
    for (let i = COUNT - 1; i >= 0; i--) {
      const start = new Date(semanaAtual.getFullYear(), semanaAtual.getMonth(), semanaAtual.getDate() - i * 7);
      const endInclusive = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const partial = i === 0;
      const endEffective = partial ? hoje : endInclusive;
      const dias = Math.max(1, Math.round((inicioDoDia(endEffective).getTime() - start.getTime()) / MS_DIA) + 1);
      buckets.push({
        label: `${String(start.getDate()).padStart(2, "0")}/${String(start.getMonth() + 1).padStart(2, "0")}`,
        start,
        endInclusive,
        endEffective,
        dias,
        partial,
      });
    }
  } else {
    const COUNT = 6;
    for (let i = COUNT - 1; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const endInclusive = new Date(start.getFullYear(), start.getMonth() + 1, 0);
      const partial = i === 0;
      const endEffective = partial ? hoje : endInclusive;
      const dias = Math.max(1, Math.round((inicioDoDia(endEffective).getTime() - start.getTime()) / MS_DIA) + 1);
      buckets.push({
        label: `${MESES_ABREV[start.getMonth()]}/${String(start.getFullYear()).slice(2)}`,
        start,
        endInclusive,
        endEffective,
        dias,
        partial,
      });
    }
  }

  const somaVendas = async (start: Date, endInclusive: Date) => {
    const range = normalizeRangeForQuery({ start, end: endInclusive });
    const totals = await fetchSalesTotals({
      company,
      range,
      filial,
      comparisonMode: "month",
      produtoIds: produtoIds.length > 0 ? produtoIds : null,
    });
    return { vendas: Math.round(totals.vendas), qtde: Math.round(totals.qtde) };
  };

  try {
    // Venda real de cada bucket (o parcial usa o fim efetivo = hoje).
    const base = await Promise.all(
      buckets.map(async (b) => ({ b, ...(await somaVendas(b.start, b.endEffective)) }))
    );

    // Para o bucket EM ANDAMENTO: venda dos MESMOS dias decorridos no período anterior,
    // pra a % ser comparável (ex.: 3 dias desta semana vs os 3 primeiros dias da passada).
    const points = await Promise.all(
      base.map(async (cur, idx) => {
        const prev = base[idx - 1];
        let deltaPct: number | null = null;
        let deltaBase: "cheio" | "parcial-equivalente" | null = null;

        if (prev) {
          if (cur.b.partial) {
            const prevStart = prev.b.start;
            const prevEndEquivalente = new Date(
              prevStart.getFullYear(),
              prevStart.getMonth(),
              prevStart.getDate() + (cur.b.dias - 1)
            );
            const prevEquivalente = await somaVendas(prevStart, prevEndEquivalente);
            if (prevEquivalente.vendas > 0) {
              deltaPct = ((cur.vendas - prevEquivalente.vendas) / prevEquivalente.vendas) * 100;
            }
            deltaBase = "parcial-equivalente";
          } else if (prev.vendas > 0) {
            deltaPct = ((cur.vendas - prev.vendas) / prev.vendas) * 100;
            deltaBase = "cheio";
          }
        }

        return {
          label: cur.b.label,
          startIso: cur.b.start.toISOString().slice(0, 10),
          endIso: cur.b.endEffective.toISOString().slice(0, 10),
          vendas: cur.vendas,
          qtde: cur.qtde,
          dias: cur.b.dias,
          partial: cur.b.partial,
          deltaPct,
          deltaBase,
        };
      })
    );

    return NextResponse.json({ mode, points }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Erro ao carregar performance da Produto Giro:", error);
    return NextResponse.json({ error: "Erro ao carregar performance" }, { status: 500 });
  }
}

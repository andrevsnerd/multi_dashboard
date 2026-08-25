import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import { deleteOrcamento, listOrcamento, setOrcamento } from "@/lib/utils/compra-gastos-store";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }
  try {
    return NextResponse.json({ data: await listOrcamento(companyKey) });
  } catch (error) {
    console.error("Erro ao carregar orçamento de compra", error);
    return NextResponse.json({ error: "Erro ao carregar orçamento" }, { status: 500 });
  }
}

// Exige mês 01..12: `\d{2}` sozinho deixaria passar "2026-13" e gravaria um
// registro que nenhuma tela consegue mostrar.
const MES_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Define quanto se pretende gastar num mês. Valor 0 apaga o orçamento do mês.
 *
 * Aceita também `meses: [{ ym, valor }]` para gravar vários de uma vez — é o
 * que a tela usa ao aplicar o mesmo valor num intervalo (planejar o ano
 * inteiro sem uma requisição por mês).
 */
export async function PUT(request: Request) {
  try {
    const bloqueado = await readOnlyBlock(request.headers.get("x-auth-username"));
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as {
      companyKey?: string;
      ym?: string;
      valor?: number;
      observacao?: string | null;
      meses?: { ym?: string; valor?: number }[];
    };
    const companyKey = String(body?.companyKey ?? "").trim();
    const ym = String(body?.ym ?? "").trim().slice(0, 7);

    if (!companyKey) {
      return NextResponse.json({ error: "companyKey é obrigatório" }, { status: 400 });
    }

    if (Array.isArray(body?.meses)) {
      const entradas = body.meses
        .map((m) => ({ ym: String(m?.ym ?? "").trim().slice(0, 7), valor: Number(m?.valor ?? 0) }))
        .filter((m) => MES_RE.test(m.ym) && Number.isFinite(m.valor) && m.valor >= 0);

      if (entradas.length === 0) {
        return NextResponse.json({ error: "Nenhum mês válido para gravar" }, { status: 400 });
      }
      if (entradas.length > 120) {
        return NextResponse.json({ error: "Intervalo muito longo (máx. 120 meses)" }, { status: 400 });
      }

      const username = request.headers.get("x-auth-username");
      const gravados = [];
      for (const entrada of entradas) {
        if (entrada.valor === 0) {
          await deleteOrcamento(companyKey, entrada.ym);
          continue;
        }
        gravados.push(await setOrcamento(companyKey, entrada.ym, entrada.valor, username));
      }
      return NextResponse.json({ data: gravados, total: entradas.length });
    }
    if (!MES_RE.test(ym)) {
      return NextResponse.json({ error: "ym deve estar no formato YYYY-MM" }, { status: 400 });
    }

    const valor = Number(body?.valor ?? 0);
    if (!Number.isFinite(valor) || valor < 0) {
      return NextResponse.json({ error: "Valor de orçamento inválido" }, { status: 400 });
    }

    if (valor === 0 && !body?.observacao) {
      await deleteOrcamento(companyKey, ym);
      return NextResponse.json({ data: null, removido: true });
    }

    const data = await setOrcamento(
      companyKey,
      ym,
      valor,
      request.headers.get("x-auth-username"),
      body?.observacao ?? null
    );
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao salvar orçamento de compra", error);
    return NextResponse.json({ error: "Erro ao salvar orçamento" }, { status: 500 });
  }
}

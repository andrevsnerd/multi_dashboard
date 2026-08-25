import { NextResponse } from "next/server";

import { readOnlyBlock } from "@/lib/auth/route-guards";
import type { CompraGastoLote } from "@/lib/types/compra-gasto";
import {
  avisoDeCustoFaltante,
  listarCandidatasReconhecimento,
  materializarCompraSalva,
  type EscopoReconhecimento,
} from "@/lib/utils/compra-gastos-import";
import { createLote, listCompraSalvaIdsLancados } from "@/lib/utils/compra-gastos-store";

/**
 * Compras Salvas que ainda não entraram no painel, já com data e valor prontos.
 *
 * `escopo=comprada` (padrão) traz só as marcadas como compradas na tela de
 * Compras Salvas; `escopo=todas` traz o resto, para quando a marcação não foi
 * feita.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const escopo = (searchParams.get("escopo") === "todas" ? "todas" : "comprada") as EscopoReconhecimento;

  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }
  try {
    const jaLancados = await listCompraSalvaIdsLancados(companyKey);
    const candidatas = await listarCandidatasReconhecimento(companyKey, jaLancados, escopo);
    return NextResponse.json({ candidatas, escopo });
  } catch (error) {
    console.error("Erro ao reconhecer compras salvas", error);
    return NextResponse.json({ error: "Erro ao reconhecer compras salvas" }, { status: 500 });
  }
}

/**
 * Lança as Compras Salvas escolhidas como compras do painel.
 *
 * Cada uma nasce **inteira**: uma única parcela de 100% vencendo na data da
 * compra. O parcelamento é editado depois na gaveta da compra — e é aí que o
 * valor sai do mês da compra e vai para os meses dos novos vencimentos.
 */
export async function POST(request: Request) {
  try {
    const bloqueado = await readOnlyBlock(request.headers.get("x-auth-username"));
    if (bloqueado) return bloqueado;

    const body = (await request.json()) as { companyKey?: string; ids?: string[] };
    const companyKey = String(body?.companyKey ?? "").trim();
    const ids = Array.isArray(body?.ids) ? body.ids.map((i) => String(i)).filter(Boolean) : [];

    if (!companyKey) {
      return NextResponse.json({ error: "companyKey é obrigatório" }, { status: 400 });
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "Selecione ao menos uma compra salva" }, { status: 400 });
    }

    const jaLancados = await listCompraSalvaIdsLancados(companyKey);
    const criados: CompraGastoLote[] = [];
    const ignorados: { id: string; motivo: string }[] = [];
    const username = request.headers.get("x-auth-username");

    for (const id of ids) {
      if (jaLancados.has(id)) {
        ignorados.push({ id, motivo: "já lançada no painel" });
        continue;
      }

      const m = await materializarCompraSalva(companyKey, id);
      if (!m) {
        ignorados.push({ id, motivo: "compra salva não encontrada" });
        continue;
      }
      if (m.total <= 0) {
        ignorados.push({ id, motivo: "sem valor (itens sem custo cadastrado)" });
        continue;
      }

      const lote = await createLote(
        companyKey,
        {
          codigo: m.titulo.slice(0, 24),
          titulo: m.titulo,
          tipo: "mercadoria",
          origem: "salva",
          compraSalvaId: m.compraSalvaId,
          dataCompra: m.dataCompra,
          // Vem inteira: 100% na data da compra. Parcela-se depois na edição.
          parcelas: [{ numero: 1, vencimento: m.dataCompra, valor: m.total, pago: false }],
          estimado: m.semCusto > 0,
          observacao: avisoDeCustoFaltante(m),
          itens: m.itens,
        },
        username
      );

      criados.push(lote);
      jaLancados.add(id);
    }

    return NextResponse.json({ criados, ignorados });
  } catch (error) {
    console.error("Erro ao lançar compras salvas reconhecidas", error);
    return NextResponse.json({ error: "Erro ao lançar as compras reconhecidas" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import { listarTransferencias } from "@/lib/utils/transferencia-pendente-store";

/**
 * GET /api/transferencias-pendentes?company=X&destino=Y&origem=Z&status=pendente&days=30&limit=30&offset=0
 *
 * Devolve a lista de transferências (uma linha por item enviado) com o status
 * derivado por JOIN com `romaneio_item_confirmado`. Usado pela aba "Realizadas"
 * de cada destinationGroup e pela página /historico-transferencias.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = (searchParams.get("company") || "").trim();
    if (!company) {
      return NextResponse.json(
        { error: "Parâmetro 'company' é obrigatório." },
        { status: 400 }
      );
    }

    const destino = (searchParams.get("destino") || "").trim() || null;
    const origem = (searchParams.get("origem") || "").trim() || null;
    const produto = (searchParams.get("produto") || "").trim() || null;
    const statusParam = (searchParams.get("status") || "").trim().toLowerCase();
    const status = statusParam === "pendente" || statusParam === "confirmada" ? statusParam : null;

    const daysParam = parseInt(searchParams.get("days") || "", 10);
    const sinceDays = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : null;

    const limitParam = parseInt(searchParams.get("limit") || "", 10);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 30;

    const offsetParam = parseInt(searchParams.get("offset") || "", 10);
    const offset = Number.isFinite(offsetParam) && offsetParam >= 0 ? offsetParam : 0;

    const { items, total } = await listarTransferencias(company, {
      origemCanonico: origem,
      destinoCanonico: destino,
      produto,
      status,
      sinceDays,
      limit,
      offset,
    });

    return NextResponse.json({ data: items, total, limit, offset });
  } catch (error: unknown) {
    console.error("[GET /api/transferencias-pendentes] erro:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Erro ao listar transferências." },
      { status: 500 }
    );
  }
}

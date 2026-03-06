import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { getDestinoRomaneio, setDestinoRomaneio } from "@/lib/utils/destino-romaneio-store";

/**
 * GET /api/destino-romaneio?company=nerd&romaneio=029231&filialOrigem=X
 * Retorna a filial destino salva para este romaneio de saída (não requer auth para leitura).
 */
export async function GET(request: NextRequest) {
  try {
    const companyKey = request.nextUrl.searchParams.get("company")?.trim();
    const romaneioId = request.nextUrl.searchParams.get("romaneio")?.trim();
    const filialOrigem = request.nextUrl.searchParams.get("filialOrigem")?.trim();

    if (!companyKey || !romaneioId || !filialOrigem) {
      return NextResponse.json(
        { error: "Parâmetros obrigatórios: company, romaneio, filialOrigem" },
        { status: 400 }
      );
    }

    const filialDestino = await getDestinoRomaneio(companyKey, romaneioId, filialOrigem);
    return NextResponse.json({ filialDestino });
  } catch (error) {
    console.error("Erro ao buscar destino romaneio", error);
    return NextResponse.json(
      { error: "Erro ao buscar destino romaneio" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/destino-romaneio
 * Body: { companyKey, romaneioId, filialOrigem, filialDestino }
 * Salva o destino deste romaneio de saída. Apenas "destino-romaneio" ou admin.
 * Header: x-auth-username
 */
export async function PUT(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const user = await findUserByUsername(username);
    if (!user) {
      return NextResponse.json({ error: "Usuário não encontrado" }, { status: 404 });
    }

    const canSet =
      user.role === "admin" || (user.permissions ?? []).includes("destino-romaneio");
    if (!canSet) {
      return NextResponse.json(
        { error: "Sem permissão para definir destino de romaneio" },
        { status: 403 }
      );
    }

    const body = await request.json();
    const companyKey = typeof body.companyKey === "string" ? body.companyKey.trim() : "";
    const romaneioId = typeof body.romaneioId === "string" ? body.romaneioId.trim() : "";
    const filialOrigem = typeof body.filialOrigem === "string" ? body.filialOrigem.trim() : "";
    const filialDestino = typeof body.filialDestino === "string" ? body.filialDestino.trim() : "";

    if (!companyKey || !romaneioId || !filialOrigem) {
      return NextResponse.json(
        { error: "companyKey, romaneioId e filialOrigem são obrigatórios" },
        { status: 400 }
      );
    }

    await setDestinoRomaneio(companyKey, romaneioId, filialOrigem, filialDestino);
    return NextResponse.json({ ok: true, filialDestino });
  } catch (error) {
    console.error("Erro ao salvar destino romaneio", error);
    return NextResponse.json(
      { error: "Erro ao salvar destino romaneio" },
      { status: 500 }
    );
  }
}

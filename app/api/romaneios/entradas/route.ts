import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { fetchLogEntradas } from "@/lib/repositories/logEntradas";

/**
 * GET /api/romaneios/entradas?company=nerd
 * Retorna romaneios de entrada filtrados pela filial atribuída do usuário.
 * Header: x-auth-username
 * - Se usuário tem filialAtribuida = Todas: retorna todos.
 * - Se tem filialAtribuida = código X: retorna apenas entradas cujo destino (filial onde a entrada foi feita) = X.
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    const companyKey = request.nextUrl.searchParams.get("company")?.trim();

    if (!companyKey) {
      return NextResponse.json(
        { error: "Parâmetro company é obrigatório" },
        { status: 400 }
      );
    }

    const entradas = await fetchLogEntradas(200, 90);

    if (!username) {
      return NextResponse.json({ data: entradas });
    }

    const permissao = await getPermissaoByUsername(username);
    const filialAtribuida = (permissao?.filialAtribuida ?? "").trim().toUpperCase();
    const verTodas =
      !filialAtribuida || filialAtribuida === "" || filialAtribuida === "TODAS";

    if (verTodas) {
      return NextResponse.json({ data: entradas });
    }

    const filtered = entradas.filter((e) => {
      const destino = (e.filialDestino ?? "").trim().toUpperCase();
      return destino === filialAtribuida;
    });

    return NextResponse.json({ data: filtered });
  } catch (error) {
    console.error("Erro ao buscar romaneios de entrada", error);
    return NextResponse.json(
      { error: "Erro ao buscar romaneios de entrada" },
      { status: 500 }
    );
  }
}

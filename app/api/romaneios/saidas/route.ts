import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { getAllDestinosByCompany } from "@/lib/utils/destino-romaneio-store";
import { fetchLogSaidas } from "@/lib/repositories/logSaidas";

/**
 * GET /api/romaneios/saidas?company=nerd
 * Retorna romaneios de saída filtrados pela filial atribuída do usuário.
 * Header: x-auth-username
 * - Se usuário tem filialAtribuida = Todas (null/""/TODAS): retorna todos.
 * - Se tem filialAtribuida = código X: retorna apenas romaneios cujo destino salvo = X.
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

    const [saidas, destinosMap] = await Promise.all([
      fetchLogSaidas(200, 90),
      getAllDestinosByCompany(companyKey),
    ]);

    const saidasComDestino = saidas.map((s) => {
      const key = `${s.romaneio}|${s.filialOrigem}`;
      const destinoCodigo = destinosMap.get(key)?.trim() || null;
      return { ...s, destinoCodigo };
    });

    if (!username) {
      return NextResponse.json({ data: saidasComDestino });
    }

    const permissao = await getPermissaoByUsername(username);
    const filialAtribuida = (permissao?.filialAtribuida ?? "").trim().toUpperCase();
    const verTodas =
      !filialAtribuida || filialAtribuida === "" || filialAtribuida === "TODAS";

    if (verTodas) {
      return NextResponse.json({ data: saidasComDestino });
    }

    const filtered = saidasComDestino.filter((s) => {
      const destino = (s.destinoCodigo ?? "").trim().toUpperCase();
      return destino === filialAtribuida;
    });

    return NextResponse.json({ data: filtered });
  } catch (error) {
    console.error("Erro ao buscar romaneios de saída", error);
    return NextResponse.json(
      { error: "Erro ao buscar romaneios de saída" },
      { status: 500 }
    );
  }
}

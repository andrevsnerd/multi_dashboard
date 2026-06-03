import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { fetchLogTransito } from "@/lib/repositories/logTransito";
import { findUserByUsername } from "@/lib/auth/users-store";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";

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

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";
    const companyConfig = await resolveCompanyDynamic(companyKey);
    const filiaisInventory = companyConfig?.filialFilters.inventory ?? [];
    const filiaisEmpresa = new Set(filiaisInventory.map((f) => f.toUpperCase()));
    // Filtra no SQL (antes do TOP) pelas filiais da empresa — teto por empresa, sem misturar.
    const transitos = await fetchLogTransito(1000, 3650, search, filiaisInventory);
    const transitosDaEmpresa = filiaisEmpresa.size > 0
      ? transitos.filter((t) =>
          filiaisEmpresa.has((t.filialDestino ?? "").toUpperCase())
        )
      : transitos;

    if (!username) {
      return NextResponse.json({ data: transitosDaEmpresa });
    }

    const userRecord = await findUserByUsername(username);
    if (userRecord?.role === "logistica") {
      return NextResponse.json({ data: transitosDaEmpresa });
    }

    const permissao = await getPermissaoByUsername(username);
    const filialAtribuida = getActiveFilial(companyConfig, permissao?.filialAtribuida ?? "").trim().toUpperCase();
    const verTodas =
      !filialAtribuida || filialAtribuida === "" || filialAtribuida === "TODAS";

    if (verTodas) {
      return NextResponse.json({ data: transitosDaEmpresa });
    }

    const filtered = transitosDaEmpresa.filter((t) => {
      const destino = getActiveFilial(companyConfig, t.filialDestino ?? "").trim().toUpperCase();
      return destino === filialAtribuida;
    });

    return NextResponse.json({ data: filtered });
  } catch (error) {
    console.error("Erro ao buscar romaneios em trânsito", error);
    return NextResponse.json(
      { error: "Erro ao buscar romaneios em trânsito" },
      { status: 500 }
    );
  }
}

import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { fetchLogEntradas } from "@/lib/repositories/logEntradas";
import { findUserByUsername } from "@/lib/auth/users-store";
import { resolveCompany } from "@/lib/config/company";
import { getContadorConfirmadosByCompany } from "@/lib/utils/romaneio-confirmacao-store";

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

    const search = request.nextUrl.searchParams.get("search")?.trim() ?? "";

    const [entradas, confirmadosCounter] = await Promise.all([
      fetchLogEntradas(1000, 90, search),
      getContadorConfirmadosByCompany(companyKey),
    ]);

    const entradasComConfirmacao = entradas.map((e) => {
      const qtdConfirmados = e.filialDestino
        ? (confirmadosCounter.get(`${e.romaneio}|${e.filialDestino}`) ?? 0)
        : 0;
      return { ...e, qtdConfirmados };
    });

    if (!username) {
      return NextResponse.json({ data: entradasComConfirmacao });
    }

    // Logística vê todos os romaneios da empresa, filtrado pelas filiais da empresa
    const userRecord = await findUserByUsername(username);
    if (userRecord?.role === "logistica") {
      const companyConfig = resolveCompany(companyKey);
      if (!companyConfig) {
        return NextResponse.json({ data: entradasComConfirmacao });
      }
      const filiaisEmpresa = new Set(
        companyConfig.filialFilters.inventory.map((f) => f.toUpperCase())
      );
      const filtered = entradasComConfirmacao.filter((e) =>
        filiaisEmpresa.has((e.filialDestino ?? "").toUpperCase())
      );
      return NextResponse.json({ data: filtered });
    }

    const permissao = await getPermissaoByUsername(username);
    const filialAtribuida = (permissao?.filialAtribuida ?? "").trim().toUpperCase();
    const verTodas =
      !filialAtribuida || filialAtribuida === "" || filialAtribuida === "TODAS";

    if (verTodas) {
      return NextResponse.json({ data: entradasComConfirmacao });
    }

    const filtered = entradasComConfirmacao.filter((e) => {
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

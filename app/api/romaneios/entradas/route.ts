import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { fetchLogEntradas } from "@/lib/repositories/logEntradas";
import { findUserByUsername } from "@/lib/auth/users-store";
import { seesAllFiliais } from "@/lib/auth/permissions";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { getContadorConfirmadosByCompany } from "@/lib/utils/romaneio-confirmacao-store";
import { comFilialDefeito } from "@/lib/config/filiais-especiais";

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
    const companyConfig = await resolveCompanyDynamic(companyKey);
    // + filial de defeito: ela não está no registry (não é loja), mas é destino real de
    // romaneio e a logística precisa consultar essas entradas aqui.
    const filiaisInventory = comFilialDefeito(
      companyKey,
      companyConfig?.filialFilters.inventory ?? []
    );
    const filiaisEmpresa = new Set(filiaisInventory.map((f) => f.toUpperCase()));

    // Filtra no SQL (antes do TOP) pelas filiais da empresa — teto por empresa, sem misturar.
    const [entradas, confirmadosCounter] = await Promise.all([
      fetchLogEntradas(1000, 90, search, filiaisInventory),
      getContadorConfirmadosByCompany(companyKey),
    ]);

    const entradasComConfirmacao = entradas.map((e) => {
      const filialDestinoAtiva = getActiveFilial(companyConfig, e.filialDestino);
      const qtdConfirmados = e.filialDestino
        ? ((confirmadosCounter.get(`${e.romaneio}|${filialDestinoAtiva}`) ?? 0) ||
           (confirmadosCounter.get(`${e.romaneio}|${e.filialDestino}`) ?? 0))
        : 0;
      return {
        ...e,
        dataEmissao: e.dataDigitacao || e.dataEmissao,
        qtdConfirmados,
      };
    });

    const entradasDaEmpresa = filiaisEmpresa.size > 0
      ? entradasComConfirmacao.filter((e) =>
          filiaisEmpresa.has((e.filialDestino ?? "").toUpperCase())
        )
      : entradasComConfirmacao;

    if (!username) {
      return NextResponse.json({ data: entradasDaEmpresa });
    }

    // Admin/diretor/supervisor/logística veem todos os romaneios da empresa; só o gerente filtra pela filial atribuída.
    const userRecord = await findUserByUsername(username);
    if (seesAllFiliais(userRecord?.role)) {
      return NextResponse.json({ data: entradasDaEmpresa });
    }

    const permissao = await getPermissaoByUsername(username);
    const filialAtribuida = getActiveFilial(companyConfig, permissao?.filialAtribuida ?? "").trim().toUpperCase();
    const verTodas =
      !filialAtribuida || filialAtribuida === "" || filialAtribuida === "TODAS";

    if (verTodas) {
      return NextResponse.json({ data: entradasDaEmpresa });
    }

    const filtered = entradasDaEmpresa.filter((e) => {
      const destino = getActiveFilial(companyConfig, e.filialDestino ?? "").trim().toUpperCase();
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

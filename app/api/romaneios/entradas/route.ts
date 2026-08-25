import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { fetchLogEntradas } from "@/lib/repositories/logEntradas";
import { findUserByUsername } from "@/lib/auth/users-store";
import { canSeeRomaneioAjuste, seesAllFiliais } from "@/lib/auth/permissions";
import { isTipoRomaneioAjuste } from "@/lib/utils/romaneio-tipos";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { getContadorConfirmadosByCompany } from "@/lib/utils/romaneio-confirmacao-store";
import { comFilialDefeito } from "@/lib/config/filiais-especiais";
import {
  filiaisDeOperacao,
  normalizeFilialCmp,
  verTodasAsFiliais,
} from "@/lib/utils/transferencia-permissoes-filiais";

/**
 * GET /api/romaneios/entradas?company=nerd
 * Retorna romaneios de entrada filtrados pela filial atribuída do usuário.
 * Header: x-auth-username
 * - Se usuário tem filialAtribuida = Todas: retorna todos.
 * - Se tem filialAtribuida = código X: retorna apenas entradas cujo destino (filial onde a entrada foi feita) = X.
 * - As filiaisAdicionais do usuário contam junto com a atribuída (ex.: NERD DEFEITOS).
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

    // Ajuste de estoque é romaneio interno: só de logística pra cima enxerga.
    // Filtra antes de qualquer retorno, para o gerente nunca receber esses romaneios.
    const userRecord = username ? await findUserByUsername(username) : null;
    const visiveis = canSeeRomaneioAjuste(userRecord?.role)
      ? entradasDaEmpresa
      : entradasDaEmpresa.filter((r) => !isTipoRomaneioAjuste(r.tipoRomaneio));

    if (!username) {
      return NextResponse.json({ data: visiveis });
    }

    // Admin/diretor/supervisor/logística veem todos os romaneios da empresa; só o gerente filtra pela filial atribuída.
    if (seesAllFiliais(userRecord?.role)) {
      return NextResponse.json({ data: visiveis });
    }

    const permissao = await getPermissaoByUsername(username);

    if (verTodasAsFiliais(permissao, companyConfig)) {
      return NextResponse.json({ data: visiveis });
    }

    // Filial atribuída + adicionais (ex.: logística que também recebe em NERD DEFEITOS).
    const filiaisPermitidas = filiaisDeOperacao(permissao, companyConfig);
    const filtered = visiveis.filter((e) => {
      const destino = normalizeFilialCmp(getActiveFilial(companyConfig, e.filialDestino ?? ""));
      return filiaisPermitidas.includes(destino);
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

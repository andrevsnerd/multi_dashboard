import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { fetchLogTransito } from "@/lib/repositories/logTransito";
import { findUserByUsername } from "@/lib/auth/users-store";
import { canSeeRomaneioAjuste, seesAllFiliais } from "@/lib/auth/permissions";
import { isTipoRomaneioAjuste } from "@/lib/utils/romaneio-tipos";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { comFilialDefeito } from "@/lib/config/filiais-especiais";
import {
  filiaisDeOperacao,
  normalizeFilialCmp,
  verTodasAsFiliais,
} from "@/lib/utils/transferencia-permissoes-filiais";

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
    // + filial de defeito: destino real de romaneio, fora do registry (não é loja).
    const filiaisInventory = comFilialDefeito(
      companyKey,
      companyConfig?.filialFilters.inventory ?? []
    );
    const filiaisEmpresa = new Set(filiaisInventory.map((f) => f.toUpperCase()));
    // Filtra no SQL (antes do TOP) pelas filiais da empresa — teto por empresa, sem misturar.
    const transitos = await fetchLogTransito(1000, 3650, search, filiaisInventory);
    const transitosDaEmpresa = filiaisEmpresa.size > 0
      ? transitos.filter((t) =>
          filiaisEmpresa.has((t.filialDestino ?? "").toUpperCase())
        )
      : transitos;

    // Ajuste de estoque é romaneio interno: só de logística pra cima enxerga.
    // Filtra antes de qualquer retorno, para o gerente nunca receber esses romaneios.
    const userRecord = username ? await findUserByUsername(username) : null;
    const visiveis = canSeeRomaneioAjuste(userRecord?.role)
      ? transitosDaEmpresa
      : transitosDaEmpresa.filter((r) => !isTipoRomaneioAjuste(r.tipoRomaneio));

    if (!username) {
      return NextResponse.json({ data: visiveis });
    }

    // Admin/diretor/supervisor/logística veem todos os romaneios; só o gerente filtra pela filial atribuída.
    if (seesAllFiliais(userRecord?.role)) {
      return NextResponse.json({ data: visiveis });
    }

    const permissao = await getPermissaoByUsername(username);

    if (verTodasAsFiliais(permissao, companyConfig)) {
      return NextResponse.json({ data: visiveis });
    }

    // Filial atribuída + adicionais (ex.: logística que também recebe em NERD DEFEITOS).
    const filiaisPermitidas = filiaisDeOperacao(permissao, companyConfig);
    const filtered = visiveis.filter((t) => {
      const destino = normalizeFilialCmp(getActiveFilial(companyConfig, t.filialDestino ?? ""));
      return filiaisPermitidas.includes(destino);
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

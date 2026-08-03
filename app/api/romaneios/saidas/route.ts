import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { getAllDestinosByCompany } from "@/lib/utils/destino-romaneio-store";
import { fetchLogSaidas } from "@/lib/repositories/logSaidas";
import { findUserByUsername } from "@/lib/auth/users-store";
import { seesAllFiliais } from "@/lib/auth/permissions";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { getContadorConfirmadosByCompany } from "@/lib/utils/romaneio-confirmacao-store";
import {
  filiaisDeOperacao,
  normalizeFilialCmp,
  verTodasAsFiliais,
} from "@/lib/utils/transferencia-permissoes-filiais";

function cleanDestino(value: string | null | undefined): string | null {
  const trimmed = (value || "").trim();
  if (!trimmed || trimmed === "—" || trimmed === "-") return null;
  return trimmed;
}

function getDestinoSalvo(
  destinosMap: Map<string, string>,
  romaneio: string,
  filialOrigem: string,
  filialOrigemCodigo?: string
): string | null {
  const origem = cleanDestino(filialOrigem);
  const origemCodigo = cleanDestino(filialOrigemCodigo);
  const keys = [
    origem ? `${romaneio}|${origem}` : null,
    origemCodigo ? `${romaneio}|${origemCodigo}` : null,
  ].filter(Boolean) as string[];

  for (const key of keys) {
    if (destinosMap.has(key)) {
      return cleanDestino(destinosMap.get(key)) ?? "";
    }
  }
  return null;
}

/**
 * GET /api/romaneios/saidas?company=nerd
 * Retorna romaneios de saída filtrados pela filial atribuída do usuário.
 * Header: x-auth-username
 * - Se usuário tem filialAtribuida = Todas (null/""/TODAS): retorna todos.
 * - Se tem filialAtribuida = código X: retorna apenas romaneios cujo destino salvo = X.
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
    const filiaisInventory = companyConfig?.filialFilters.inventory ?? [];
    const filiaisEmpresa = new Set(filiaisInventory.map((f) => f.toUpperCase()));

    // Passa as filiais da empresa para a query filtrar no SQL (antes do TOP),
    // garantindo que o teto de linhas seja por empresa e nunca misture NERD + SCARFME.
    const [saidas, destinosMap, confirmadosCounter] = await Promise.all([
      fetchLogSaidas(1000, 90, search, filiaisInventory),
      getAllDestinosByCompany(companyKey),
      getContadorConfirmadosByCompany(companyKey),
    ]);

    const saidasComDestino = saidas.map((s) => {
      const destinoSalvo = getDestinoSalvo(destinosMap, s.romaneio, s.filialOrigem, s.filialOrigemCodigo);
      const destinoOriginal =
        destinoSalvo !== null
          ? destinoSalvo
          : cleanDestino(s.filialDestino) || cleanDestino(s.filialDestinoCodigo);
      const destinoCodigo = destinoOriginal
        ? getActiveFilial(companyConfig, destinoOriginal)
        : null;
      const qtdConfirmados = destinoCodigo
        ? ((confirmadosCounter.get(`${s.romaneio}|${destinoCodigo}`) ?? 0) ||
           (destinoOriginal ? (confirmadosCounter.get(`${s.romaneio}|${destinoOriginal}`) ?? 0) : 0))
        : 0;
      return {
        ...s,
        dataEmissao: s.dataDigitacao || s.dataEmissao,
        filialDestino: destinoSalvo !== null ? destinoOriginal : s.filialDestino,
        destinoCodigo,
        qtdConfirmados,
      };
    });

    const saidasDaEmpresa = filiaisEmpresa.size > 0
      ? saidasComDestino.filter((s) =>
          filiaisEmpresa.has((s.filialOrigem ?? "").toUpperCase())
        )
      : saidasComDestino;

    if (!username) {
      return NextResponse.json({ data: saidasDaEmpresa });
    }

    // Admin/diretor/supervisor/logística veem todos os romaneios da empresa; só o gerente filtra pela filial atribuída.
    const userRecord = await findUserByUsername(username);
    if (seesAllFiliais(userRecord?.role)) {
      return NextResponse.json({ data: saidasDaEmpresa });
    }

    const permissao = await getPermissaoByUsername(username);

    if (verTodasAsFiliais(permissao, companyConfig)) {
      return NextResponse.json({ data: saidasDaEmpresa });
    }

    // Filial atribuída + adicionais (ex.: logística que também recebe em NERD DEFEITOS).
    const filiaisPermitidas = filiaisDeOperacao(permissao, companyConfig);
    const filtered = saidasDaEmpresa.filter((s) => {
      const destino = normalizeFilialCmp(getActiveFilial(companyConfig, s.destinoCodigo ?? ""));
      return filiaisPermitidas.includes(destino);
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

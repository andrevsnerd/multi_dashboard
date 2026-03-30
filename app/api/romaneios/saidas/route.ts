import { NextRequest, NextResponse } from "next/server";
import { getPermissaoByUsername } from "@/lib/utils/transferencia-permissoes-store";
import { getAllDestinosByCompany } from "@/lib/utils/destino-romaneio-store";
import { fetchLogSaidas } from "@/lib/repositories/logSaidas";
import { findUserByUsername } from "@/lib/auth/users-store";
import { resolveCompany } from "@/lib/config/company";
import { getContadorConfirmadosByCompany } from "@/lib/utils/romaneio-confirmacao-store";

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

    const [saidas, destinosMap, confirmadosCounter] = await Promise.all([
      fetchLogSaidas(200, 90),
      getAllDestinosByCompany(companyKey),
      getContadorConfirmadosByCompany(companyKey),
    ]);

    const saidasComDestino = saidas.map((s) => {
      const key = `${s.romaneio}|${s.filialOrigem}`;
      const destinoCodigo = destinosMap.get(key)?.trim() || null;
      const qtdConfirmados = destinoCodigo
        ? (confirmadosCounter.get(`${s.romaneio}|${destinoCodigo}`) ?? 0)
        : 0;
      return { ...s, destinoCodigo, qtdConfirmados };
    });

    if (!username) {
      return NextResponse.json({ data: saidasComDestino });
    }

    // Logística vê todos os romaneios da empresa, filtrado pelas filiais da empresa
    const userRecord = await findUserByUsername(username);
    if (userRecord?.role === "logistica") {
      const companyConfig = resolveCompany(companyKey);
      if (!companyConfig) {
        return NextResponse.json({ data: saidasComDestino });
      }
      const filiaisEmpresa = new Set(
        companyConfig.filialFilters.inventory.map((f) => f.toUpperCase())
      );
      const filtered = saidasComDestino.filter((s) =>
        filiaisEmpresa.has((s.filialOrigem ?? "").toUpperCase())
      );
      return NextResponse.json({ data: filtered });
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

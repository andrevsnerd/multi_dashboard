import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import { comFilialDefeito } from "@/lib/config/filiais-especiais";
import {
  listarUltimosInventariosLinx,
  mensagemTravaInventario,
  verificarTravaInventario,
} from "@/lib/server/trava-inventario";
import {
  getTravasInventario,
  removerTravaInventario,
  setTravaInventario,
} from "@/lib/utils/trava-inventario-store";

/**
 * Trava de inventário dos romaneios — manual, por filial (ver lib/server/trava-inventario.ts).
 *
 * GET ?company=                                   → { travas }       (Neon, sem Linx)
 * GET ?company=&filialDestino=&dataRomaneio=      → { trava }        null = pode confirmar
 * GET ?company=&inventarios=1            (admin)  → { inventarios }  último INV... de cada filial (Linx)
 * POST   { companyKey, filial, codFilial?, dataCorte, inventarioNome? }  (admin) aplica/altera
 * DELETE { companyKey, filial }                                          (admin) remove
 */

async function isAdmin(request: NextRequest): Promise<string | null> {
  const username = request.headers.get("x-auth-username")?.trim();
  if (!username) return null;
  const user = await findUserByUsername(username);
  return user?.role === "admin" ? username : null;
}

export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const companyKey = (sp.get("company") || "").trim();
  if (!companyKey) {
    return NextResponse.json({ error: "Parâmetro company é obrigatório" }, { status: 400 });
  }

  try {
    if (sp.get("inventarios")) {
      if (!(await isAdmin(request))) {
        return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
      }
      const company = await resolveCompanyDynamic(companyKey);
      const filiaisEmpresa = company
        ? new Set(
            comFilialDefeito(companyKey, company.filialFilters.inventory ?? []).map((f) =>
              f.trim().toUpperCase()
            )
          )
        : null;
      const todos = await listarUltimosInventariosLinx();
      const inventarios = filiaisEmpresa
        ? todos.filter((i) => filiaisEmpresa.has(i.filial.toUpperCase()))
        : todos;
      return NextResponse.json({ inventarios });
    }

    const filialDestino = sp.get("filialDestino");
    if (filialDestino) {
      const trava = await verificarTravaInventario({
        companyKey,
        filialDestino,
        dataRomaneio: sp.get("dataRomaneio"),
      });
      return NextResponse.json({
        trava: trava ? { ...trava, mensagem: mensagemTravaInventario(trava) } : null,
      });
    }

    return NextResponse.json({ travas: await getTravasInventario(companyKey) });
  } catch (error) {
    console.error("Erro na trava de inventário", error);
    return NextResponse.json({ error: "Erro na trava de inventário" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const username = await isAdmin(request);
  if (!username) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as {
    companyKey?: string;
    filial?: string;
    codFilial?: string | null;
    dataCorte?: string;
    inventarioNome?: string | null;
  };
  const companyKey = (body.companyKey || "").trim();
  const filial = (body.filial || "").trim();
  const dataCorte = (body.dataCorte || "").trim();
  if (!companyKey || !filial || !/^\d{4}-\d{2}-\d{2}$/.test(dataCorte)) {
    return NextResponse.json(
      { error: "Campos obrigatórios: companyKey, filial, dataCorte (AAAA-MM-DD)." },
      { status: 400 }
    );
  }

  try {
    await setTravaInventario({
      companyKey,
      filial,
      codFilial: (body.codFilial || "").trim() || null,
      dataCorte,
      inventarioNome: (body.inventarioNome || "").trim() || null,
      aplicadoPor: username,
    });
    return NextResponse.json({ success: true, travas: await getTravasInventario(companyKey) });
  } catch (error) {
    console.error("Erro ao aplicar trava de inventário", error);
    return NextResponse.json({ error: "Erro ao aplicar trava." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const username = await isAdmin(request);
  if (!username) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as { companyKey?: string; filial?: string };
  const companyKey = (body.companyKey || "").trim();
  const filial = (body.filial || "").trim();
  if (!companyKey || !filial) {
    return NextResponse.json({ error: "Campos obrigatórios: companyKey, filial." }, { status: 400 });
  }

  try {
    await removerTravaInventario(companyKey, filial);
    return NextResponse.json({ success: true, travas: await getTravasInventario(companyKey) });
  } catch (error) {
    console.error("Erro ao remover trava de inventário", error);
    return NextResponse.json({ error: "Erro ao remover trava." }, { status: 500 });
  }
}

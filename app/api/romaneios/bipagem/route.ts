import { NextResponse } from "next/server";

import { findUserByUsername } from "@/lib/auth/users-store";
import { isReadOnlyRole } from "@/lib/auth/permissions";
import { getActiveFilial } from "@/lib/config/company";
import { resolveCompanyDynamic } from "@/lib/config/company-server";
import {
  encerrarSessao,
  gravarEventos,
  listarEventosAbertos,
  sanitizeEvento,
  sessaoBipagemId,
} from "@/lib/utils/romaneio-bipagem-store";

/**
 * Conferência de romaneio por bipagem — eventos de leitura (ver
 * lib/utils/romaneio-bipagem-store.ts). Não mexe em estoque nem confirma nada:
 * a confirmação continua sendo a de /api/romaneio-confirmar-entrada.
 *
 * GET   ?company&romaneio&filialDestino      → { eventos }
 * POST  { companyKey, romaneioId, filialDestino, eventos[] }
 * PATCH { companyKey, romaneioId, filialDestino, acao: "encerrar" | "descartar" }
 */

const MAX_EVENTOS_POR_CHAMADA = 200;

/** Sessão sempre na perna ativa do destino — o mesmo nome que a confirmação usa. */
async function sessaoDe(companyKey: string, romaneioId: string, filialDestino: string): Promise<string> {
  const company = await resolveCompanyDynamic(companyKey);
  return sessaoBipagemId(companyKey, romaneioId, getActiveFilial(company, filialDestino));
}

async function usuarioQuePodeBipar(request: Request): Promise<{ username: string } | NextResponse> {
  const username = request.headers.get("x-auth-username")?.trim();
  if (!username) {
    return NextResponse.json({ error: "Usuário não identificado. Faça login novamente." }, { status: 401 });
  }
  const user = await findUserByUsername(username);
  if (!user) return NextResponse.json({ error: "Usuário não encontrado" }, { status: 403 });
  if (isReadOnlyRole(user.role)) {
    return NextResponse.json({ error: "Acesso somente leitura: esta função não confere romaneios." }, { status: 403 });
  }
  return { username };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const company = (searchParams.get("company") || "").trim();
    const romaneio = (searchParams.get("romaneio") || "").trim();
    const filialDestino = (searchParams.get("filialDestino") || "").trim();
    if (!company || !romaneio || !filialDestino) {
      return NextResponse.json({ error: "Parâmetros obrigatórios: company, romaneio, filialDestino" }, { status: 400 });
    }
    const eventos = await listarEventosAbertos(await sessaoDe(company, romaneio, filialDestino));
    return NextResponse.json({ eventos });
  } catch (err) {
    console.error("GET romaneios/bipagem:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro interno" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await usuarioQuePodeBipar(request);
    if (auth instanceof NextResponse) return auth;

    const body = (await request.json().catch(() => ({}))) as {
      companyKey?: string;
      romaneioId?: string;
      filialDestino?: string;
      eventos?: unknown[];
    };
    const companyKey = (body.companyKey || "").trim();
    const romaneioId = (body.romaneioId || "").trim();
    const filialDestino = (body.filialDestino || "").trim();
    if (!companyKey || !romaneioId || !filialDestino) {
      return NextResponse.json({ error: "Campos obrigatórios: companyKey, romaneioId, filialDestino" }, { status: 400 });
    }
    const brutos = Array.isArray(body.eventos) ? body.eventos : [];
    if (brutos.length > MAX_EVENTOS_POR_CHAMADA) {
      return NextResponse.json({ error: `No máximo ${MAX_EVENTOS_POR_CHAMADA} eventos por envio.` }, { status: 400 });
    }
    const eventos = brutos.map(sanitizeEvento).filter((e): e is NonNullable<typeof e> => e !== null);
    if (eventos.length !== brutos.length) {
      return NextResponse.json({ error: "Evento de bipagem inválido." }, { status: 400 });
    }

    await gravarEventos(await sessaoDe(companyKey, romaneioId, filialDestino), auth.username, eventos);
    return NextResponse.json({ ok: true, gravados: eventos.map((e) => e.id) });
  } catch (err) {
    console.error("POST romaneios/bipagem:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await usuarioQuePodeBipar(request);
    if (auth instanceof NextResponse) return auth;

    const body = (await request.json().catch(() => ({}))) as {
      companyKey?: string;
      romaneioId?: string;
      filialDestino?: string;
      acao?: string;
    };
    const companyKey = (body.companyKey || "").trim();
    const romaneioId = (body.romaneioId || "").trim();
    const filialDestino = (body.filialDestino || "").trim();
    if (!companyKey || !romaneioId || !filialDestino) {
      return NextResponse.json({ error: "Campos obrigatórios: companyKey, romaneioId, filialDestino" }, { status: 400 });
    }
    if (body.acao !== "encerrar" && body.acao !== "descartar") {
      return NextResponse.json({ error: 'acao deve ser "encerrar" ou "descartar".' }, { status: 400 });
    }

    await encerrarSessao(
      await sessaoDe(companyKey, romaneioId, filialDestino),
      body.acao === "encerrar" ? "confirmada" : "descartada",
      auth.username
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH romaneios/bipagem:", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Erro interno" }, { status: 500 });
  }
}

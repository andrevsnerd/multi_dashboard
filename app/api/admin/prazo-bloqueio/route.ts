import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import {
  getAllDiasMinimos,
  setDiasMinimos,
  TRAVA_DIAS_MIN,
  TRAVA_DIAS_MAX,
} from "@/lib/utils/notificacoes-trava-store";

/** Empresas que possuem trava de confirmação de entradas. */
const COMPANIES = ["nerd", "scarfme"] as const;

async function isAdmin(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  return user?.role === "admin";
}

/**
 * GET /api/admin/prazo-bloqueio
 * Retorna o prazo (dias mínimos) da trava por empresa. (apenas admin)
 */
export async function GET(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const prazos = await getAllDiasMinimos([...COMPANIES]);
    return NextResponse.json(
      { data: prazos, min: TRAVA_DIAS_MIN, max: TRAVA_DIAS_MAX },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("Erro ao listar prazos de bloqueio", error);
    return NextResponse.json({ error: "Erro ao listar prazos" }, { status: 500 });
  }
}

/**
 * POST /api/admin/prazo-bloqueio
 * Body: { company: string; dias: number }
 * Atualiza o prazo da trava de uma empresa. (apenas admin)
 */
export async function POST(request: NextRequest) {
  try {
    const username = request.headers.get("x-auth-username");
    if (!username || !(await isAdmin(username))) {
      return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      company?: string;
      dias?: number;
    };

    const company = (body.company || "").trim().toLowerCase();
    if (!(COMPANIES as readonly string[]).includes(company)) {
      return NextResponse.json({ error: "Empresa inválida" }, { status: 400 });
    }

    const dias = Number(body.dias);
    if (!Number.isFinite(dias)) {
      return NextResponse.json({ error: "Prazo inválido" }, { status: 400 });
    }

    const saved = await setDiasMinimos(company, dias);
    return NextResponse.json({ company, dias: saved });
  } catch (error) {
    console.error("Erro ao salvar prazo de bloqueio", error);
    return NextResponse.json({ error: "Erro ao salvar prazo" }, { status: 500 });
  }
}

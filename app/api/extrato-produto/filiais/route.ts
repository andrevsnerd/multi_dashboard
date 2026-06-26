import { NextRequest, NextResponse } from "next/server";
import { findUserByUsername } from "@/lib/auth/users-store";
import { userHasPagePermission } from "@/lib/auth/permissions";
import type { UserSession } from "@/types/auth";
import { query } from "@/lib/db/connection";

/** Acesso ao Extrato de Produto: admin sempre; logistica se a pagina for liberada. */
async function canAccessExtrato(username: string): Promise<boolean> {
  const user = await findUserByUsername(username);
  if (!user) return false;
  return userHasPagePermission(user as unknown as UserSession, "extrato-produto");
}

function trimValue(value: unknown) {
  return value == null ? "" : String(value).trim();
}

export interface AdminFilialOption {
  filial: string;
  codFilial: string | null;
}

export async function GET(request: NextRequest) {
  const username = request.headers.get("x-auth-username");
  if (!username || !(await canAccessExtrato(username))) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const rows = await query<{ COD_FILIAL: string | null; FILIAL: string | null }>(`
      SELECT DISTINCT
        RTRIM(LTRIM(CAST(f.COD_FILIAL AS VARCHAR(50)))) AS COD_FILIAL,
        RTRIM(LTRIM(CAST(f.FILIAL AS VARCHAR(120)))) AS FILIAL
      FROM FILIAIS f WITH (NOLOCK)
      WHERE f.FILIAL IS NOT NULL
        AND RTRIM(LTRIM(CAST(f.FILIAL AS VARCHAR(120)))) <> ''
      ORDER BY FILIAL
    `);

    const data: AdminFilialOption[] = rows
      .map((r) => ({
        filial: trimValue(r.FILIAL),
        codFilial: trimValue(r.COD_FILIAL) || null,
      }))
      .filter((r) => r.filial);

    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: `Erro ao listar filiais: ${(e as Error).message}` },
      { status: 500 }
    );
  }
}


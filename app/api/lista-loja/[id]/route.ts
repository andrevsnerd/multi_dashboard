import { NextRequest, NextResponse } from "next/server";
import { getNeonSql } from "@/lib/db/neon";

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  await sql`
    CREATE TABLE IF NOT EXISTS lista_loja (
      id TEXT PRIMARY KEY,
      nome TEXT NOT NULL,
      username TEXT NOT NULL,
      filial TEXT NOT NULL,
      nome_filial TEXT NOT NULL,
      company TEXT NOT NULL,
      itens JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sql = getNeonSql();
    await ensureTable(sql);
    const { id } = await params;

    const rows = await sql`
      SELECT id, nome, username, filial, nome_filial, company, itens, created_at, updated_at
      FROM lista_loja
      WHERE id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: "Lista não encontrada" }, { status: 404 });
    }

    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    console.error("Erro ao buscar lista", error);
    return NextResponse.json({ error: "Erro ao buscar lista" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sql = getNeonSql();
    await ensureTable(sql);

    const username = request.headers.get("x-auth-username");
    if (!username) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as {
      nome: string;
      filial: string;
      nomeFilial: string;
      itens: unknown[];
    };

    const { nome, filial, nomeFilial, itens } = body;

    await sql`
      UPDATE lista_loja
      SET
        nome       = ${nome?.trim() || ""},
        filial     = ${filial},
        nome_filial = ${nomeFilial || filial},
        itens      = ${JSON.stringify(itens || [])}::jsonb,
        updated_at = NOW()
      WHERE id = ${id}
    `;

    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("Erro ao atualizar lista", error);
    return NextResponse.json({ error: "Erro ao atualizar lista" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sql = getNeonSql();
    const { id } = await params;

    await sql`DELETE FROM lista_loja WHERE id = ${id}`;

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    console.error("Erro ao deletar lista", error);
    return NextResponse.json({ error: "Erro ao deletar lista" }, { status: 500 });
  }
}

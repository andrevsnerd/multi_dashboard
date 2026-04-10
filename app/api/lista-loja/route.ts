import { NextRequest, NextResponse } from "next/server";
import { getNeonSql } from "@/lib/db/neon";
import { createHash } from "crypto";

let tableEnsured = false;

async function ensureTable(sql: ReturnType<typeof getNeonSql>) {
  if (tableEnsured) return;
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
  tableEnsured = true;
}

export async function GET(request: NextRequest) {
  try {
    const sql = getNeonSql();
    await ensureTable(sql);

    const { searchParams } = new URL(request.url);
    const company = searchParams.get("company");

    const rows = company
      ? await sql`
          SELECT id, nome, username, filial, nome_filial, company, itens, created_at, updated_at
          FROM lista_loja
          WHERE company = ${company}
          ORDER BY updated_at DESC
        `
      : await sql`
          SELECT id, nome, username, filial, nome_filial, company, itens, created_at, updated_at
          FROM lista_loja
          ORDER BY updated_at DESC
        `;

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("Erro ao buscar listas", error);
    return NextResponse.json({ error: "Erro ao buscar listas" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const sql = getNeonSql();
    await ensureTable(sql);

    const username = request.headers.get("x-auth-username");
    if (!username) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const body = (await request.json()) as {
      nome: string;
      filial: string;
      nomeFilial: string;
      company: string;
      itens: unknown[];
    };

    const { nome, filial, nomeFilial, company, itens } = body;
    if (!nome?.trim() || !filial || !company) {
      return NextResponse.json({ error: "Dados obrigatórios faltando" }, { status: 400 });
    }

    const id = createHash("sha256")
      .update(`${username}-${Date.now()}-${Math.random()}`)
      .digest("hex")
      .slice(0, 16);

    await sql`
      INSERT INTO lista_loja (id, nome, username, filial, nome_filial, company, itens)
      VALUES (
        ${id},
        ${nome.trim()},
        ${username},
        ${filial},
        ${nomeFilial || filial},
        ${company},
        ${JSON.stringify(itens || [])}::jsonb
      )
    `;

    return NextResponse.json({ data: { id } }, { status: 201 });
  } catch (error) {
    console.error("Erro ao criar lista", error);
    return NextResponse.json({ error: "Erro ao criar lista" }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import {
  buscarClientePorDocumento,
  criarClienteCorporativo,
  listClientesCorporativos,
} from "@/lib/repositories/clienteCorporativo";
import type { ClienteCorporativoInput } from "@/lib/corporativo/types";

export const maxDuration = 120;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") ?? undefined;
  const limit = Number(searchParams.get("limit") ?? 100);
  try {
    const data = await listClientesCorporativos({ search, limit });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao listar clientes corporativos", error);
    return NextResponse.json({ error: "Erro ao listar clientes." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: ClienteCorporativoInput & { forcar?: boolean };
  try {
    body = (await request.json()) as ClienteCorporativoInput & { forcar?: boolean };
  } catch {
    return NextResponse.json({ error: "Corpo da requisição inválido." }, { status: 400 });
  }

  try {
    // Aviso de duplicidade: mesmo CPF/CNPJ já cadastrado. Não bloqueia se forcar=true.
    if (!body.forcar) {
      const existente = await buscarClientePorDocumento(body.cpfCnpj);
      if (existente) {
        return NextResponse.json(
          {
            error: "duplicado",
            duplicado: existente,
            message: `Já existe um cliente com este documento: ${existente.razao} (código ${existente.codigo}).`,
          },
          { status: 409 }
        );
      }
    }

    const criado = await criarClienteCorporativo(body);
    return NextResponse.json({ data: criado });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao cadastrar cliente.";
    console.error("Erro ao cadastrar cliente corporativo", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

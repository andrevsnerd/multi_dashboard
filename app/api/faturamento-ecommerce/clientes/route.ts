import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import {
  buscarClientesFat,
  clientesPorDocumento,
  criarClienteFat,
} from "@/lib/repositories/faturamentoEcommerce/clientes";
import type { ClienteFatInput } from "@/lib/faturamento-ecommerce/types";

export const maxDuration = 120;

/** Busca por CPF/CNPJ, código ou nome. `todos=1` inclui clientes da outra empresa. */
export async function GET(request: Request) {
  const sp = new URL(request.url).searchParams;
  const a = await autorizarFaturamentoEcommerce(request, sp.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await buscarClientesFat({
      empresa: a.auth.empresa,
      termo: sp.get("q") ?? "",
      somenteEmpresa: sp.get("todos") !== "1",
    });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/clientes GET]", err);
    return erroJson(err);
  }
}

/** Cadastra cliente. Se o CPF já existir, devolve 409 com os cadastros (reenviar com forcar=true). */
export async function POST(request: Request) {
  let body: { empresa?: string; cliente?: ClienteFatInput };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const a = await autorizarFaturamentoEcommerce(request, body.empresa, { escrita: true });
  if ("erro" in a) return a.erro;
  const cliente = body.cliente;
  if (!cliente) return NextResponse.json({ error: "Dados do cliente ausentes." }, { status: 400 });
  try {
    if (!cliente.forcar) {
      const existentes = await clientesPorDocumento(cliente.cpfCnpj);
      if (existentes.length > 0) {
        return NextResponse.json(
          { error: "Já existe cliente com este CPF/CNPJ.", existentes },
          { status: 409 }
        );
      }
    }
    const data = await criarClienteFat(a.auth.empresa, cliente);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/clientes POST]", err);
    return erroJson(err, 400);
  }
}

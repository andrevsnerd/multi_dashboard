import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { clientesPorDocumento } from "@/lib/repositories/faturamentoEcommerce/clientes";
import { criarClientePjFat, fetchContasContabeisFat } from "@/lib/repositories/faturamentoEcommerce/clientesPj";
import type { ClientePjFatInput } from "@/lib/faturamento-ecommerce/types";

export const maxDuration = 120;

/** Listas que só o cadastro PJ usa (plano de contas). */
export async function GET(request: Request) {
  const a = await autorizarFaturamentoEcommerce(request, new URL(request.url).searchParams.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    return NextResponse.json({ data: { contasContabeis: await fetchContasContabeisFat() } });
  } catch (err) {
    console.error("[faturamento-ecommerce/clientes-pj GET]", err);
    return erroJson(err);
  }
}

/** Cadastra cliente PJ. Se o CNPJ já existir, devolve 409 com os cadastros (reenviar com forcar=true). */
export async function POST(request: Request) {
  let body: { empresa?: string; cliente?: ClientePjFatInput };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const a = await autorizarFaturamentoEcommerce(request, body.empresa, { escrita: true });
  if ("erro" in a) return a.erro;
  const cliente = body.cliente;
  if (!cliente) return NextResponse.json({ error: "Dados do cliente ausentes." }, { status: 400 });
  if (String(cliente.cnpj ?? "").replace(/\D/g, "").length !== 14) {
    return NextResponse.json({ error: "CNPJ precisa ter 14 dígitos." }, { status: 400 });
  }
  try {
    if (!cliente.forcar) {
      const existentes = await clientesPorDocumento(cliente.cnpj);
      if (existentes.length > 0) {
        return NextResponse.json({ error: "Já existe cliente com este CNPJ.", existentes }, { status: 409 });
      }
    }
    const data = await criarClientePjFat(a.auth.empresa, cliente);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/clientes-pj POST]", err);
    return erroJson(err, 400);
  }
}

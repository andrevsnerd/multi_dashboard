import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce, erroJson } from "@/lib/auth/faturamento-ecommerce-guard";
import { atualizarClienteFat, fetchClienteFat } from "@/lib/repositories/faturamentoEcommerce/clientes";
import type { ClienteAtualizacaoInput } from "@/lib/faturamento-ecommerce/types";

export const maxDuration = 60;

export async function GET(request: Request, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  const a = await autorizarFaturamentoEcommerce(request, new URL(request.url).searchParams.get("empresa"));
  if ("erro" in a) return a.erro;
  try {
    const data = await fetchClienteFat(codigo);
    if (!data) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/clientes/:codigo GET]", err);
    return erroJson(err);
  }
}

/** Atualiza endereço (as 3 vias) e contato de um cliente reaproveitado. */
export async function PATCH(request: Request, ctx: { params: Promise<{ codigo: string }> }) {
  const { codigo } = await ctx.params;
  let body: { empresa?: string } & Partial<ClienteAtualizacaoInput>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }
  const a = await autorizarFaturamentoEcommerce(request, body.empresa, { escrita: true });
  if ("erro" in a) return a.erro;
  if (!body.endereco) return NextResponse.json({ error: "Endereço ausente." }, { status: 400 });
  try {
    await atualizarClienteFat(codigo, body as ClienteAtualizacaoInput);
    const data = await fetchClienteFat(codigo);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[faturamento-ecommerce/clientes/:codigo PATCH]", err);
    return erroJson(err, 400);
  }
}

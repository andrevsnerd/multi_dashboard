import { NextResponse } from "next/server";

import {
  fetchClienteComprasDetalhe,
  fetchClienteDetalheInfo,
} from "@/lib/repositories/clientes";

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cliente: string }> }
) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const cpf = searchParams.get("cpf") ?? undefined;
  const chaveCliente = searchParams.get("chave") ?? undefined;
  const startParam = searchParams.get("start");
  const endParam = searchParams.get("end");
  const range =
    startParam && endParam
      ? { start: startParam, end: endParam }
      : undefined;

  const { cliente: clienteEncoded } = await params;
  const clienteNome = decodeURIComponent(clienteEncoded);

  try {
    const [detalhe, compras] = await Promise.all([
      fetchClienteDetalheInfo({ company, clienteNome, cpf, chaveCliente }),
      fetchClienteComprasDetalhe({
        company,
        clienteNome,
        cpf,
        chaveCliente,
        range,
      }),
    ]);
    return NextResponse.json({ detalhe, compras });
  } catch (error) {
    console.error("Erro ao carregar resumo do cliente", error);
    return NextResponse.json(
      { error: "Erro ao carregar resumo do cliente" },
      { status: 500 }
    );
  }
}

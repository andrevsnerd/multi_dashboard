import { NextResponse } from "next/server";

import { fetchClienteDetalheInfo } from "@/lib/repositories/clientes";

export const maxDuration = 60;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ cliente: string }> }
) {
  const { searchParams } = new URL(request.url);
  const company = searchParams.get("company") ?? undefined;
  const cpf = searchParams.get("cpf") ?? undefined;
  const chaveCliente = searchParams.get("chave") ?? undefined;
  const { cliente: clienteEncoded } = await params;
  const clienteNome = decodeURIComponent(clienteEncoded);

  try {
    const data = await fetchClienteDetalheInfo({
      company,
      clienteNome,
      cpf,
      chaveCliente,
    });
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar detalhe do cliente", error);
    return NextResponse.json(
      { error: "Erro ao carregar detalhe do cliente" },
      { status: 500 }
    );
  }
}

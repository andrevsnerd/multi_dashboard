import { NextResponse } from "next/server";

import {
  fetchClienteCorporativoDetalhe,
  listClientesCorporativos,
} from "@/lib/repositories/clienteCorporativo";

export const maxDuration = 60;

/**
 * Resolve os dados do cliente atacado (endereço, nome, tabela de preço) para o
 * checkout. O front passa ?codigo= (o clienteCodigo vinculado ao usuário logado).
 * Se não vier código (ex.: admin testando), devolve uma empresa já cadastrada como
 * AMOSTRA, apenas para visualização — marcada com isSample=true.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const codigo = (searchParams.get("codigo") ?? "").trim();

    if (codigo) {
      const cliente = await fetchClienteCorporativoDetalhe(codigo);
      if (!cliente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      return NextResponse.json({ data: cliente, isSample: false });
    }

    // Sem código: amostra (primeiro cliente cadastrado) para visualização do admin.
    const lista = await listClientesCorporativos({ limit: 1 });
    if (lista.length === 0) return NextResponse.json({ data: null, isSample: true });
    const cliente = await fetchClienteCorporativoDetalhe(lista[0].codigo);
    return NextResponse.json({ data: cliente, isSample: true });
  } catch (error) {
    console.error("Erro ao resolver cliente do checkout", error);
    return NextResponse.json({ error: "Erro ao carregar dados do cliente." }, { status: 500 });
  }
}

import { NextResponse } from "next/server";

import {
  getComprasDataFixa,
  upsertComprasDataFixa,
  type CompraDataFixaUpsert,
} from "@/lib/utils/compra-data-fixa-store";

/** GET ?company=&filial= → mapa { itemKey: { dataCompra, transitoSig, ... } } */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const companyKey = searchParams.get("company") ?? "";
  const filial = searchParams.get("filial") ?? "";
  if (!companyKey) {
    return NextResponse.json({ error: "company é obrigatório" }, { status: 400 });
  }
  try {
    const data = await getComprasDataFixa(companyKey, filial);
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Erro ao carregar datas de compra", error);
    return NextResponse.json({ error: "Erro ao carregar datas de compra" }, { status: 500 });
  }
}

/** POST { companyKey, filial, entries:[{itemKey, dataCompra, transitoSig}] } → upsert lote. */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { companyKey, filial, entries } = body ?? {};
    if (!companyKey) {
      return NextResponse.json({ error: "companyKey é obrigatório" }, { status: 400 });
    }
    if (!Array.isArray(entries)) {
      return NextResponse.json({ error: "entries deve ser um array" }, { status: 400 });
    }
    const normalized: CompraDataFixaUpsert[] = entries.map((e: CompraDataFixaUpsert) => ({
      itemKey: String(e.itemKey ?? "").trim(),
      dataCompra: String(e.dataCompra ?? "").slice(0, 10),
      transitoSig: String(e.transitoSig ?? ""),
    }));
    const count = await upsertComprasDataFixa(String(companyKey), String(filial ?? ""), normalized);
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    console.error("Erro ao salvar datas de compra", error);
    return NextResponse.json({ error: "Erro ao salvar datas de compra" }, { status: 500 });
  }
}

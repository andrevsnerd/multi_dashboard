import { NextResponse } from "next/server";

import { autorizarFaturamentoEcommerce } from "@/lib/auth/faturamento-ecommerce-guard";

/**
 * Consulta de CEP (ViaCEP, com BrasilAPI de reserva). Devolve o código IBGE do
 * município — é por ele que o cadastro resolve a cidade sem acento no Linx.
 * ViaCEP/BrasilAPI recusam o User-Agent padrão do Node: manda um de navegador.
 */
const UA = "Mozilla/5.0 (compatible; Dashboard/1.0)";

export async function GET(request: Request, ctx: { params: Promise<{ cep: string }> }) {
  const a = await autorizarFaturamentoEcommerce(request, new URL(request.url).searchParams.get("empresa"));
  if ("erro" in a) return a.erro;
  const { cep } = await ctx.params;
  const digits = String(cep ?? "").replace(/\D/g, "");
  if (digits.length !== 8) return NextResponse.json({ error: "CEP inválido (8 dígitos)." }, { status: 400 });

  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const j = await res.json();
      if (!j?.erro) {
        return NextResponse.json({
          data: {
            cep: digits,
            endereco: j.logradouro ?? "",
            bairro: j.bairro ?? "",
            cidade: j.localidade ?? "",
            uf: j.uf ?? "",
            codMunicipioIbge: j.ibge ?? "",
          },
        });
      }
    }
  } catch (err) {
    console.error("[faturamento-ecommerce/cep] ViaCEP", err);
  }

  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${digits}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const j = await res.json();
      return NextResponse.json({
        data: {
          cep: digits,
          endereco: j.street ?? "",
          bairro: j.neighborhood ?? "",
          cidade: j.city ?? "",
          uf: j.state ?? "",
          codMunicipioIbge: j.ibge?.city ?? j.city_ibge ?? "",
        },
      });
    }
    return NextResponse.json({ error: "CEP não encontrado." }, { status: 404 });
  } catch (err) {
    console.error("[faturamento-ecommerce/cep] BrasilAPI", err);
    return NextResponse.json({ error: "Erro ao consultar o CEP." }, { status: 502 });
  }
}

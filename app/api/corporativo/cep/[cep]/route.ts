import { NextResponse } from "next/server";

/** Consulta ViaCEP (retorna também o código IBGE do município, exigido na NF-e). */
export async function GET(_request: Request, ctx: { params: Promise<{ cep: string }> }) {
  const { cep } = await ctx.params;
  const digits = String(cep ?? "").replace(/\D/g, "");
  if (digits.length !== 8) {
    return NextResponse.json({ error: "CEP inválido (8 dígitos)." }, { status: 400 });
  }
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; NERD-Dashboard/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      return NextResponse.json({ error: "Falha ao consultar CEP." }, { status: 502 });
    }
    const json = await res.json();
    if (json?.erro) {
      return NextResponse.json({ error: "CEP não encontrado." }, { status: 404 });
    }
    return NextResponse.json({
      data: {
        cep: digits,
        endereco: json.logradouro ?? "",
        complemento: json.complemento ?? "",
        bairro: json.bairro ?? "",
        cidade: json.localidade ?? "",
        uf: json.uf ?? "",
        codMunicipioIbge: json.ibge ?? "",
        ddd: json.ddd ?? "",
      },
    });
  } catch (error) {
    console.error("Erro ViaCEP", error);
    return NextResponse.json({ error: "Erro ao consultar CEP." }, { status: 502 });
  }
}

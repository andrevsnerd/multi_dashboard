import { NextResponse } from "next/server";

/**
 * Consulta CNPJ na BrasilAPI para autopreencher o cadastro.
 * Não traz o código IBGE — o front encadeia com a consulta de CEP para obtê-lo.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ cnpj: string }> }) {
  const { cnpj } = await ctx.params;
  const digits = String(cnpj ?? "").replace(/\D/g, "");
  if (digits.length !== 14) {
    return NextResponse.json({ error: "CNPJ inválido (14 dígitos)." }, { status: 400 });
  }
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
      // A BrasilAPI (WAF) responde 403 ao User-Agent padrão do Node; simular navegador.
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; NERD-Dashboard/1.0)" },
      signal: AbortSignal.timeout(12000),
    });
    if (res.status === 404) {
      return NextResponse.json({ error: "CNPJ não encontrado." }, { status: 404 });
    }
    if (!res.ok) {
      return NextResponse.json({ error: "Falha ao consultar CNPJ." }, { status: 502 });
    }
    const j = await res.json();
    const tel = String(j.ddd_telefone_1 ?? "").replace(/\D/g, "");
    const ddd = tel.slice(0, 2);
    const telefone = tel.slice(2);
    return NextResponse.json({
      data: {
        razaoSocial: j.razao_social ?? "",
        nomeFantasia: j.nome_fantasia ?? "",
        cep: String(j.cep ?? "").replace(/\D/g, ""),
        endereco: j.logradouro ?? "",
        numero: j.numero ?? "",
        complemento: j.complemento ?? "",
        bairro: j.bairro ?? "",
        cidade: j.municipio ?? "",
        uf: j.uf ?? "",
        ddd1: ddd,
        telefone1: telefone,
        email: j.email ?? "",
        situacao: j.descricao_situacao_cadastral ?? "",
      },
    });
  } catch (error) {
    console.error("Erro BrasilAPI CNPJ", error);
    return NextResponse.json({ error: "Erro ao consultar CNPJ." }, { status: 502 });
  }
}

import "server-only";

import type { CnpjConsulta } from "./types";

/**
 * Consulta CNPJ na BrasilAPI para autopreencher o cadastro PJ (mesma fonte do
 * cadastro corporativo — app/api/corporativo/cnpj). Não traz o código IBGE: o
 * front encadeia com a consulta de CEP. null = CNPJ não encontrado.
 */
export async function consultarCnpj(cnpj: string): Promise<CnpjConsulta | null> {
  const digits = String(cnpj ?? "").replace(/\D/g, "");
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digits}`, {
    // A BrasilAPI (WAF) responde 403 ao User-Agent padrão do Node; simular navegador.
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; NERD-Dashboard/1.0)" },
    signal: AbortSignal.timeout(12000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("Falha ao consultar o CNPJ na Receita (BrasilAPI). Preencha à mão.");
  const j = await res.json();
  const tel = String(j.ddd_telefone_1 ?? "").replace(/\D/g, "");
  const tipoLog = String(j.descricao_tipo_de_logradouro ?? "").trim();
  const logradouro = String(j.logradouro ?? "").trim();
  return {
    razaoSocial: String(j.razao_social ?? ""),
    nomeFantasia: String(j.nome_fantasia ?? ""),
    cep: String(j.cep ?? "").replace(/\D/g, ""),
    // A Receita separa o tipo ("AVENIDA") do nome; só junta se o nome ainda não começa com ele.
    endereco:
      tipoLog && logradouro && !logradouro.toUpperCase().startsWith(tipoLog.toUpperCase())
        ? `${tipoLog} ${logradouro}`
        : logradouro,
    numero: String(j.numero ?? ""),
    complemento: String(j.complemento ?? ""),
    bairro: String(j.bairro ?? ""),
    cidade: String(j.municipio ?? ""),
    uf: String(j.uf ?? ""),
    ddd: tel.slice(0, 2),
    telefone: tel.slice(2),
    email: String(j.email ?? ""),
    situacao: String(j.descricao_situacao_cadastral ?? ""),
  };
}

/** Confere os dígitos verificadores do CNPJ. */
export function cnpjValido(cnpj: string): boolean {
  const d = String(cnpj ?? "").replace(/\D/g, "");
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const dv = (base: string) => {
    let soma = 0;
    let peso = base.length - 7;
    for (const c of base) {
      soma += Number(c) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(d.slice(0, 12));
  const d2 = dv(d.slice(0, 12) + d1);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

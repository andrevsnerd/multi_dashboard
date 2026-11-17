import "server-only";

/**
 * Consulta de CEP (ViaCEP, BrasilAPI de reserva). Devolve o código IBGE do município —
 * é por ele que o cadastro resolve a cidade sem acento no Linx. Os dois serviços
 * recusam o User-Agent padrão do Node: manda um de navegador.
 */
const UA = "Mozilla/5.0 (compatible; Dashboard/1.0)";

export interface CepInfo {
  cep: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  codMunicipioIbge: string;
}

export async function consultarCep(cepRaw: string): Promise<CepInfo | null> {
  const cep = String(cepRaw ?? "").replace(/\D/g, "");
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const j = await res.json();
      if (!j?.erro && j?.ibge) {
        return { cep, endereco: j.logradouro ?? "", bairro: j.bairro ?? "", cidade: j.localidade ?? "", uf: j.uf ?? "", codMunicipioIbge: String(j.ibge) };
      }
    }
  } catch (err) {
    console.error("[cep] ViaCEP", err);
  }
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cep/v2/${cep}`, {
      headers: { Accept: "application/json", "User-Agent": UA },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const j = await res.json();
      return {
        cep,
        endereco: j.street ?? "",
        bairro: j.neighborhood ?? "",
        cidade: j.city ?? "",
        uf: j.state ?? "",
        codMunicipioIbge: String(j.ibge?.city ?? j.city_ibge ?? ""),
      };
    }
  } catch (err) {
    console.error("[cep] BrasilAPI", err);
  }
  return null;
}

import type { TipoPessoa } from "@/lib/corporativo/types";

/** UF → macro-região (para preencher REGIAO automaticamente). */
export const UF_REGIAO: Record<string, string> = {
  AC: "NORTE", AP: "NORTE", AM: "NORTE", PA: "NORTE", RO: "NORTE", RR: "NORTE", TO: "NORTE",
  AL: "NORDESTE", BA: "NORDESTE", CE: "NORDESTE", MA: "NORDESTE", PB: "NORDESTE", PE: "NORDESTE", PI: "NORDESTE", RN: "NORDESTE", SE: "NORDESTE",
  DF: "CENTRO OESTE", GO: "CENTRO OESTE", MT: "CENTRO OESTE", MS: "CENTRO OESTE",
  ES: "SUDESTE", MG: "SUDESTE", RJ: "SUDESTE", SP: "SUDESTE",
  PR: "SUL", RS: "SUL", SC: "SUL",
};

export type EnderecoFields = {
  cep: string; endereco: string; numero: string; complemento: string;
  bairro: string; cidade: string; uf: string; codMunicipioIbge: string;
};

export const emptyEndereco: EnderecoFields = {
  cep: "", endereco: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", codMunicipioIbge: "",
};

export interface FormState extends EnderecoFields {
  tipoPessoa: TipoPessoa;
  razaoSocial: string;
  nomeFantasia: string;
  cpfCnpj: string;
  rgIe: string;
  isento: boolean;
  inscricaoMunicipal: string;
  tipoTributacao: string;
  indicadorFiscal: string;
  suframa: string;
  ddd1: string; telefone1: string; ddd2: string; telefone2: string;
  email: string; emailNfe: string; aniversario: string;
  mesmoEnderecoCobranca: boolean;
  mesmoEnderecoEntrega: boolean;
  cobranca: EnderecoFields;
  entrega: EnderecoFields;
  filial: string; condicaoPgto: string; codigoTabPreco: string;
  transportadora: string; regiao: string; conceito: string; tipo: string; pontualidade: string;
  limiteCredito: string; indicadorVenda: string; matrizCliente: string; observacao: string;
}

export const initialForm: FormState = {
  ...emptyEndereco,
  tipoPessoa: "PJ",
  razaoSocial: "", nomeFantasia: "", cpfCnpj: "", rgIe: "", isento: true,
  inscricaoMunicipal: "", tipoTributacao: "", indicadorFiscal: "1", suframa: "",
  ddd1: "", telefone1: "", ddd2: "", telefone2: "",
  email: "", emailNfe: "", aniversario: "",
  mesmoEnderecoCobranca: true, mesmoEnderecoEntrega: true,
  cobranca: { ...emptyEndereco }, entrega: { ...emptyEndereco },
  filial: "", condicaoPgto: "", codigoTabPreco: "", transportadora: "", regiao: "",
  conceito: "", tipo: "", pontualidade: "INDEFINIDO",
  limiteCredito: "0", indicadorVenda: "", matrizCliente: "", observacao: "",
};

export function pickOption(options: { value: string }[], prefer: string[]): string {
  for (const p of prefer) {
    const hit = options.find((o) => o.value.toUpperCase() === p.toUpperCase());
    if (hit) return hit.value;
  }
  return options[0]?.value ?? "";
}

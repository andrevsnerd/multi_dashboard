import type { ClienteCorporativoInput, TipoPessoa } from "@/lib/corporativo/types";

/** UF → macro-região (para preencher REGIAO automaticamente). Fonte única em lib/corporativo/regioes. */
export { UF_REGIAO } from "@/lib/corporativo/regioes";

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

/**
 * Converte o FormState em ClienteCorporativoInput (payload de criação no Linx).
 * Espelha o buildPayload da página de novo cliente — usado na aprovação editável.
 */
export function formStateToInput(form: FormState): ClienteCorporativoInput {
  const isPJ = form.tipoPessoa === "PJ";
  const digitsDoc = form.cpfCnpj.replace(/\D/g, "");
  return {
    tipoPessoa: form.tipoPessoa,
    razaoSocial: form.razaoSocial,
    nomeFantasia: form.nomeFantasia,
    cpfCnpj: digitsDoc,
    rgIe: form.isento && !isPJ ? "ISENTO" : form.rgIe,
    inscricaoMunicipal: form.inscricaoMunicipal,
    tipoTributacao: isPJ ? form.tipoTributacao : "",
    indicadorFiscal: Number(form.indicadorFiscal),
    suframa: form.suframa,
    cep: form.cep, endereco: form.endereco, numero: form.numero, complemento: form.complemento,
    bairro: form.bairro, cidade: form.cidade, uf: form.uf, codMunicipioIbge: form.codMunicipioIbge,
    pais: "BRASIL",
    ddd1: form.ddd1, telefone1: form.telefone1, ddd2: form.ddd2, telefone2: form.telefone2,
    email: form.email, emailNfe: form.emailNfe, aniversario: form.aniversario,
    mesmoEnderecoCobranca: form.mesmoEnderecoCobranca,
    mesmoEnderecoEntrega: form.mesmoEnderecoEntrega,
    cobranca: { ...form.cobranca, pais: "BRASIL" },
    entrega: { ...form.entrega, pais: "BRASIL" },
    filial: form.filial, condicaoPgto: form.condicaoPgto, codigoTabPreco: form.codigoTabPreco,
    transportadora: form.transportadora, regiao: form.regiao, conceito: form.conceito,
    tipo: form.tipo, pontualidade: form.pontualidade,
    limiteCredito: Number(form.limiteCredito) || 0,
    indicadorVenda: form.indicadorVenda, matrizCliente: form.matrizCliente, observacao: form.observacao,
  };
}

/**
 * Converte um ClienteCorporativoInput (payload salvo do autocadastro pendente) em
 * FormState, para reidratar o formulário completo na tela de aprovação (editável).
 */
export function inputToFormState(input: ClienteCorporativoInput): FormState {
  const isPJ = input.tipoPessoa === "PJ";
  const end = (b: ClienteCorporativoInput["cobranca"]): EnderecoFields => ({
    cep: b?.cep ?? "",
    endereco: b?.endereco ?? "",
    numero: b?.numero ?? "",
    complemento: b?.complemento ?? "",
    bairro: b?.bairro ?? "",
    cidade: b?.cidade ?? "",
    uf: b?.uf ?? "",
    codMunicipioIbge: b?.codMunicipioIbge ?? "",
  });
  const rgIe = input.rgIe ?? "";
  return {
    ...emptyEndereco,
    cep: input.cep ?? "",
    endereco: input.endereco ?? "",
    numero: input.numero ?? "",
    complemento: input.complemento ?? "",
    bairro: input.bairro ?? "",
    cidade: input.cidade ?? "",
    uf: input.uf ?? "",
    codMunicipioIbge: input.codMunicipioIbge ?? "",
    tipoPessoa: input.tipoPessoa,
    razaoSocial: input.razaoSocial ?? "",
    nomeFantasia: input.nomeFantasia ?? "",
    cpfCnpj: input.cpfCnpj ?? "",
    rgIe: rgIe.toUpperCase() === "ISENTO" ? "" : rgIe,
    isento: !rgIe || rgIe.toUpperCase() === "ISENTO",
    inscricaoMunicipal: input.inscricaoMunicipal ?? "",
    tipoTributacao: input.tipoTributacao ?? "",
    indicadorFiscal: input.indicadorFiscal != null ? String(input.indicadorFiscal) : isPJ ? "1" : "8",
    suframa: input.suframa ?? "",
    ddd1: input.ddd1 ?? "",
    telefone1: input.telefone1 ?? "",
    ddd2: input.ddd2 ?? "",
    telefone2: input.telefone2 ?? "",
    email: input.email ?? "",
    emailNfe: input.emailNfe ?? "",
    aniversario: input.aniversario ?? "",
    mesmoEnderecoCobranca: input.mesmoEnderecoCobranca !== false,
    mesmoEnderecoEntrega: input.mesmoEnderecoEntrega !== false,
    cobranca: input.cobranca ? end(input.cobranca) : { ...emptyEndereco },
    entrega: input.entrega ? end(input.entrega) : { ...emptyEndereco },
    filial: input.filial ?? "",
    condicaoPgto: input.condicaoPgto ?? "",
    codigoTabPreco: input.codigoTabPreco ?? "",
    transportadora: input.transportadora ?? "",
    regiao: input.regiao ?? "",
    conceito: input.conceito ?? "",
    tipo: input.tipo ?? "",
    pontualidade: input.pontualidade ?? "INDEFINIDO",
    limiteCredito: String(input.limiteCredito ?? 0),
    indicadorVenda: input.indicadorVenda ?? "",
    matrizCliente: input.matrizCliente ?? "",
    observacao: input.observacao ?? "",
  };
}

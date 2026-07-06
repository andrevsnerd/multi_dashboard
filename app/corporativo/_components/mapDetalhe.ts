import type { ClienteCorporativoDetalhe, OptionItem } from "@/lib/corporativo/types";
import type { ComercialOptions } from "./ClienteCorporativoForm";
import { emptyEndereco, type EnderecoFields, type FormState } from "./formTypes";

/** Cadastros antigos no Linx usam sequências de 9s/0s como "não informado" (ex.: RG_IE). */
function isPlaceholderRgIe(value: string): boolean {
  const v = (value || "").trim();
  return !v || /^(9+|0+)$/.test(v) || v.toUpperCase() === "ISENTO";
}

function mapEndereco(b: { cep: string; endereco: string; numero: string; complemento?: string; bairro: string; cidade: string; uf: string; codMunicipioIbge: string }): EnderecoFields {
  return {
    cep: b.cep ?? "",
    endereco: b.endereco ?? "",
    numero: b.numero ?? "",
    complemento: b.complemento ?? "",
    bairro: b.bairro ?? "",
    cidade: b.cidade ?? "",
    uf: b.uf ?? "",
    codMunicipioIbge: b.codMunicipioIbge ?? "",
  };
}

/** Converte o cadastro real (Linx) no mesmo formato de estado usado pela tela de cadastro. */
export function detalheToFormState(d: ClienteCorporativoDetalhe): FormState {
  return {
    ...emptyEndereco,
    ...mapEndereco(d.endereco),
    tipoPessoa: d.tipoPessoa,
    razaoSocial: d.razaoSocial,
    nomeFantasia: d.nomeClifor,
    cpfCnpj: d.cpfCnpj,
    rgIe: isPlaceholderRgIe(d.rgIe) ? "" : d.rgIe,
    isento: isPlaceholderRgIe(d.rgIe),
    inscricaoMunicipal: d.inscricaoMunicipal,
    tipoTributacao: d.tipoTributacao,
    indicadorFiscal: d.indicadorFiscal,
    suframa: d.suframa,
    ddd1: d.ddd1, telefone1: d.telefone1, ddd2: d.ddd2, telefone2: d.telefone2,
    email: d.email, emailNfe: d.emailNfe,
    aniversario: d.aniversario ? d.aniversario.slice(0, 10) : "",
    mesmoEnderecoCobranca: d.enderecoCobrancaIgual,
    mesmoEnderecoEntrega: d.enderecoEntregaIgual,
    cobranca: mapEndereco(d.cobranca),
    entrega: mapEndereco(d.entrega),
    filial: d.filial,
    condicaoPgto: d.condicaoPgto,
    codigoTabPreco: d.codigoTabPreco,
    transportadora: d.transportadora,
    regiao: d.regiao,
    conceito: d.conceito,
    tipo: d.tipo,
    pontualidade: d.pontualidade,
    limiteCredito: String(d.limiteCredito ?? 0),
    indicadorVenda: d.indicadorVenda,
    matrizCliente: d.matrizCliente,
    observacao: d.observacao,
  };
}

/** Mesma lista fixa de lib/repositories/clienteCorporativo.ts#fetchCorporativoLookups. */
const INDICADOR_FISCAL_LABELS: Record<string, string> = {
  "8": "8 - Não Contribuinte",
  "1": "1 - Empresa (Industrial/Comercial)",
  "2": "2 - Produtor Rural",
  "6": "6 - Consumidor Final",
  "7": "7 - Órgão Público",
};

/**
 * Em modo visualização os selects não precisam da lista completa de opções do Linx
 * (que pode nem conter mais um código antigo/inativo) — cada campo vira um único
 * item = valor real gravado, com a descrição já resolvida quando disponível.
 */
export function detalheToViewOptions(d: ClienteCorporativoDetalhe): ComercialOptions {
  const single = (value: string, label?: string): OptionItem[] =>
    value ? [{ value, label: label || value }] : [];

  return {
    condicoesPgto: single(d.condicaoPgto, d.condicaoPgtoDescricao ? `${d.condicaoPgto} - ${d.condicaoPgtoDescricao}` : undefined),
    tabelasPreco: single(d.codigoTabPreco, d.codigoTabPrecoDescricao ? `${d.codigoTabPreco} - ${d.codigoTabPrecoDescricao}` : undefined),
    transportadoras: single(d.transportadora),
    regioes: single(d.regiao),
    conceitos: single(d.conceito),
    pontualidades: single(d.pontualidade),
    tipos: single(d.tipo),
    filiais: single(d.filial),
    indicadoresFiscais: single(d.indicadorFiscal, INDICADOR_FISCAL_LABELS[d.indicadorFiscal]),
    tiposTributacao: single(d.tipoTributacao),
  };
}

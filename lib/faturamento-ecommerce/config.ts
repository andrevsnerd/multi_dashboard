/**
 * Faturamento E-commerce — padrões por empresa (NERD e Scarf Me são empresas
 * diferentes; nada aqui é compartilhado entre elas).
 *
 * Os valores vêm da medição do faturamento manual feito no Linx (form 100101SPK e
 * cadastro 001015SPK) — ver docs/FATURAMENTO_SHOPIFY_LINX.md. Todos aparecem
 * pré-preenchidos na tela e podem ser alterados antes de gravar.
 *
 * Arquivo sem "server-only": é lido também pelos componentes da página.
 */

import { getFilialGroupById } from "@/lib/config/filial-registry";

export type EmpresaFat = "nerd" | "scarfme";

export const EMPRESAS_FAT: EmpresaFat[] = ["nerd", "scarfme"];

export function isEmpresaFat(v: unknown): v is EmpresaFat {
  return v === "nerd" || v === "scarfme";
}

export interface PadraoCliente {
  /** CLIENTES_ATACADO.FILIAL */
  filial: string;
  tipo: string;
  conceito: string;
  pontualidade: string;
  transportadora: string;
  condicaoPgto: string;
  codigoTabPreco: string;
  contaContabil: string;
  rgIe: string;
  indicadorFiscal: number;
  representante: string;
}

export interface PadraoNota {
  /**
   * COD_FILIAL das filiais que emitem NF de e-commerce desta empresa. Sempre por código:
   * o nome no Linx pode ter caractere invisível (a FFF usa espaço não separável em volta
   * do hífen) — o nome vivo vem de lib/server/filial-resolver no servidor.
   * A principal (pré-selecionada) é a que emitiu NF de e-commerce por último.
   */
  codFiliais: string[];
  /** Série padrão. A de cada filial é a da última NF de e-commerce dela (a CMS usa 13). */
  serie: string;
  condicaoPgto: string;
  tipoFrete: string;
  transportadora: string;
  transpRedespacho: string;
  pesoLiquido: number;
  pesoBruto: number;
  volumes: number;
  tipoVolume: string;
  infoPgto: string;
  representante: string;
  centroCusto: string;
  /** Natureza quando o cliente está na mesma UF da filial / em outra UF. */
  naturezaDentroUf: string;
  naturezaForaUf: string;
  /**
   * Filiais que também podem emitir NF por esta página, FORA do rodízio do e-commerce
   * (nunca viram a principal). Cada uma com as naturezas que ela usa de fato no Linx.
   */
  filiaisExtras: FilialNotaExtra[];
}

export interface FilialNotaExtra {
  codFilial: string;
  /** Rótulo curto na tela. */
  rotulo: string;
  naturezaDentroUf: string;
  naturezaForaUf: string;
  /** Natureza para cliente revendedor (INDICADOR_FISCAL_TERCEIRO 16), se a filial usa uma própria. */
  naturezaRevenda: string | null;
  /**
   * Regime da filial. As pernas do rodízio são sempre Simples (o gravador zera os impostos);
   * aqui é declarado — FILIAIS.TIPO_TRIBUTACAO não serve: MSC e CMS (Simples) estão vazias.
   */
  simplesNacional: boolean;
}

/**
 * Padrões do cadastro PJ (CNPJ). Fluxo à parte do cadastro de pessoa física do site.
 * Tipo, conta, tabela e transportadora vêm do perfil (PERFIS_CLIENTE_PJ, padrão WEB);
 * o resto é comum aos dois perfis. IE ISENTO quando não houver, indicador fiscal 8.
 */
export interface PadraoClientePj {
  filial: string;
  tipo: string;
  conceito: string;
  pontualidade: string;
  transportadora: string;
  condicaoPgto: string;
  codigoTabPreco: string;
  contaContabil: string;
  indicadorFiscal: number;
  representante: string;
}

export interface PadraoEmpresa {
  nome: string;
  cliente: PadraoCliente;
  clientePj: PadraoClientePj;
  nota: PadraoNota;
}

const CLIENTE_BASE: Omit<PadraoCliente, "filial"> = {
  tipo: "WEB",
  conceito: "BOM",
  pontualidade: "INDEFINIDO",
  transportadora: "NOSSO CARRO",
  condicaoPgto: "01",
  codigoTabPreco: "01",
  contaContabil: "1120302",
  rgIe: "9999999999999999999",
  indicadorFiscal: 8,
  representante: "SEM REPRESENTANTE",
};

/**
 * Perfil do cliente PJ — "cada um no seu quadrado". Medido no Linx em 18/11/2026 nos CNPJs
 * cadastrados desde 2025 (97 WEB, 87 CORPORATIVO): os dois tipos têm conjuntos fixos e
 * diferentes de conta, indicador de venda, agrupamento, tabela e transportadora. Trocar o
 * perfil na tela troca o conjunto inteiro — nunca metade WEB, metade corporativo.
 *
 * O indicador FISCAL não faz parte do perfil: é fato do cliente (tem IE ou não), e com 1
 * a NF do e-commerce bloqueia (ver CLIENTE_PJ_BASE). Os corporativos medidos têm 1 porque
 * saem pela Matriz.
 */
export type PerfilClientePj = "WEB" | "CORPORATIVO";

export interface PerfilClientePjDef {
  rotulo: string;
  descricao: string;
  /** CLIENTES_ATACADO.TIPO */
  tipo: string;
  contaContabil: string;
  codigoTabPreco: string;
  transportadora: string;
  /** CLIENTES_ATACADO.INDICADOR_VENDA — não aparece na tela, vem do perfil. */
  indicadorVenda: string;
  /** CADASTRO_CLI_FOR.AGRUPAMENTO_ITENS — não aparece na tela, vem do perfil. */
  agrupamentoItens: number;
}

export const PERFIS_CLIENTE_PJ: Record<PerfilClientePj, PerfilClientePjDef> = {
  WEB: {
    rotulo: "WEB",
    descricao: "Empresa que comprou pelo site",
    tipo: "WEB",
    contaContabil: "1120302",
    codigoTabPreco: "01",
    transportadora: "NOSSO CARRO",
    indicadorVenda: "V",
    agrupamentoItens: 0,
  },
  CORPORATIVO: {
    rotulo: "CORPORATIVO",
    descricao: "Cliente da venda corporativa",
    tipo: "CORPORATIVO",
    contaContabil: "1120101",
    codigoTabPreco: "05",
    transportadora: "CORREIOS - SEDEX",
    indicadorVenda: "",
    agrupamentoItens: 2,
  },
};

export const PERFIL_PJ_PADRAO: PerfilClientePj = "WEB";

export function isPerfilClientePj(v: unknown): v is PerfilClientePj {
  return v === "WEB" || v === "CORPORATIVO";
}

/** Perfil a que um TIPO de cliente pertence (null = tipo fora dos dois perfis). */
export function perfilDoTipo(tipo: string): PerfilClientePj | null {
  const t = String(tipo ?? "").trim().toUpperCase();
  return isPerfilClientePj(t) ? t : null;
}

/**
 * Padrões comuns aos dois perfis + os do perfil padrão (WEB, como o cliente do site).
 * Indicador fiscal padrão é 8 (não contribuinte), medido em 18/11/2026: nem NERD nem
 * Scarf Me têm exceção fiscal de venda para contribuinte (indicador 1): a NF cai em 1117
 * "DEVOLUÇÃO COMPRA" (CSOSN 900) e a prévia bloqueia, em qualquer UF. Com 8 sai 5102/6108
 * CSOSN 102, como 164 de 185 NFs de e-commerce para CNPJ desde 2024. A tela troca para 1
 * quando o operador informa a IE (empresa contribuinte).
 */
const CLIENTE_PJ_BASE: Omit<PadraoClientePj, "filial"> = {
  tipo: PERFIS_CLIENTE_PJ[PERFIL_PJ_PADRAO].tipo,
  conceito: "BOM",
  pontualidade: "INDEFINIDO",
  transportadora: PERFIS_CLIENTE_PJ[PERFIL_PJ_PADRAO].transportadora,
  condicaoPgto: "01",
  codigoTabPreco: PERFIS_CLIENTE_PJ[PERFIL_PJ_PADRAO].codigoTabPreco,
  contaContabil: PERFIS_CLIENTE_PJ[PERFIL_PJ_PADRAO].contaContabil,
  indicadorFiscal: 8,
  representante: "SEM REPRESENTANTE",
};

/** INDICADOR_FISCAL_TERCEIRO ("Indica Tipo 30.s") — mesma lista do corporativo. */
export const INDICADORES_FISCAIS = [
  { value: "8", label: "8 - Não Contribuinte" },
  { value: "1", label: "1 - Empresa (Industrial/Comercial)" },
  { value: "2", label: "2 - Produtor Rural" },
  { value: "6", label: "6 - Consumidor Final" },
  { value: "7", label: "7 - Órgão Público" },
];

export const TIPOS_TRIBUTACAO = ["SIMPLES NACIONAL", "PRESUMIDO", "REAL"].map((t) => ({ value: t, label: t }));

const NOTA_BASE: Omit<PadraoNota, "codFiliais" | "serie" | "filiaisExtras"> = {
  condicaoPgto: "01",
  tipoFrete: "2",
  transportadora: "CORREIOS - SEDEX",
  transpRedespacho: "CORREIOS - SEDEX",
  pesoLiquido: 1,
  pesoBruto: 1.1,
  volumes: 1,
  tipoVolume: "CAIXA DE PAPELAO",
  infoPgto: "90",
  representante: "SEM REPRESENTANTE",
  centroCusto: "001",
  naturezaDentroUf: "100.02",
  naturezaForaUf: "100.022",
};

/**
 * Scarf Me: todas as pernas do grupo E-COMMERCE do registry (rodízio fiscal AKS ↔ MSC ↔
 * LLL…). Vem do registry para que uma perna nova entre aqui sem editar este arquivo.
 */
const COD_FILIAIS_ECOMMERCE_SCARFME: string[] = getFilialGroupById("ecommerce-scarfme")?.memberIds ?? [];

export const PADROES: Record<EmpresaFat, PadraoEmpresa> = {
  nerd: {
    nome: "NERD",
    cliente: { ...CLIENTE_BASE, filial: "NERD" },
    clientePj: { ...CLIENTE_PJ_BASE, filial: "NERD" },
    // Só a matriz NERD (000069) fatura o e-commerce da NERD.
    nota: { ...NOTA_BASE, codFiliais: ["000069"], serie: "001", filiaisExtras: [] },
  },
  scarfme: {
    nome: "SCARF ME",
    cliente: { ...CLIENTE_BASE, filial: "SCARF ME - MATRIZ" },
    clientePj: { ...CLIENTE_PJ_BASE, filial: "SCARF ME - MATRIZ" },
    // Rodízio fiscal entre as pernas do e-commerce: a principal é a que emitiu por último.
    nota: {
      ...NOTA_BASE,
      codFiliais: COD_FILIAIS_ECOMMERCE_SCARFME,
      serie: "1",
      // Pedido do site às vezes é faturado pela Matriz (como o corporativo). A Matriz NÃO é
      // Simples Nacional (CRT 3): ICMS/PIS/COFINS de verdade — o gravador calcula no regime
      // normal. Naturezas medidas nas NFs dela (18/11/2026): 100.05 VENDA PRIVATE (dentro e
      // fora de SP) e 100.08 REVENDA (cliente indicador 16).
      filiaisExtras: [
        {
          codFilial: "001",
          rotulo: "MATRIZ",
          naturezaDentroUf: "100.05",
          naturezaForaUf: "100.05",
          naturezaRevenda: "100.08",
          simplesNacional: false,
        },
      ],
    },
  },
};

/** UF → região de venda (REGIOES_VENDA), pela divisão do IBGE. */
const REGIAO_POR_UF: Record<string, string> = {
  AC: "NORTE", AM: "NORTE", AP: "NORTE", PA: "NORTE", RO: "NORTE", RR: "NORTE", TO: "NORTE",
  AL: "NORDESTE", BA: "NORDESTE", CE: "NORDESTE", MA: "NORDESTE", PB: "NORDESTE",
  PE: "NORDESTE", PI: "NORDESTE", RN: "NORDESTE", SE: "NORDESTE",
  DF: "CENTRO OESTE", GO: "CENTRO OESTE", MS: "CENTRO OESTE", MT: "CENTRO OESTE",
  ES: "SUDESTE", MG: "SUDESTE", RJ: "SUDESTE", SP: "SUDESTE",
  PR: "SUL", RS: "SUL", SC: "SUL",
};

export function regiaoDaUf(uf: string | null | undefined): string {
  return REGIAO_POR_UF[String(uf ?? "").trim().toUpperCase()] ?? "SUDESTE";
}

export const REGIOES = ["CENTRO OESTE", "NORDESTE", "NORTE", "SUDESTE", "SUL"];

/** Indicador de forma de pagamento da NF-e (tPag) usado no Linx. */
export const INFO_PGTO_OPCOES = [
  { value: "90", label: "90 - SEM PAGAMENTO" },
  { value: "15", label: "15 - BOLETO BANCÁRIO" },
  { value: "17", label: "17 - PIX" },
  { value: "03", label: "03 - CARTÃO DE CRÉDITO" },
  { value: "04", label: "04 - CARTÃO DE DÉBITO" },
  { value: "01", label: "01 - DINHEIRO" },
  { value: "99", label: "99 - OUTROS" },
];

/** STATUS_NFE do FATURAMENTO → rótulo do Monitor de NF-e do Linx. */
export function statusNfeLabel(status: number | null | undefined, log: number | null | undefined): {
  label: string;
  tom: "neutro" | "ok" | "alerta" | "erro";
} {
  const s = Number(status ?? 0);
  const l = Number(log ?? 0);
  switch (s) {
    case 1:
      return { label: "Não enviada", tom: "alerta" };
    case 2:
      return l === 99 ? { label: "Erro ao validar", tom: "erro" } : { label: "Aguardando envio", tom: "alerta" };
    case 3:
      return { label: "Enviada (aguardando retorno)", tom: "alerta" };
    case 4:
      return { label: "Rejeitada", tom: "erro" };
    case 5:
      return { label: "Autorizada", tom: "ok" };
    case 6:
      return { label: "Autorizada fora do prazo", tom: "ok" };
    case 42:
      return l === 99 ? { label: "Cancelamento com erro", tom: "erro" } : { label: "Cancelamento aguardando", tom: "alerta" };
    case 49:
      return { label: "Cancelada", tom: "neutro" };
    case 50:
      return { label: "Cancelada fora do prazo", tom: "neutro" };
    case 52:
      return l === 99 ? { label: "Inutilização com erro", tom: "erro" } : { label: "Inutilização aguardando", tom: "alerta" };
    case 59:
      return { label: "Inutilizada", tom: "neutro" };
    case 70:
      return { label: "Uso denegado", tom: "erro" };
    default:
      return { label: s ? `Status ${s}` : "Sem NF-e", tom: "neutro" };
  }
}

/** Grupos de status para o filtro do monitor. */
export const FILTROS_STATUS: { value: string; label: string; status: number[] }[] = [
  { value: "pendentes", label: "Pendentes de envio / com erro", status: [1, 2, 3, 4, 42, 52] },
  { value: "autorizadas", label: "Autorizadas", status: [5, 6] },
  { value: "canceladas", label: "Canceladas / inutilizadas", status: [49, 50, 59] },
  { value: "rejeitadas", label: "Rejeitadas / denegadas", status: [4, 70] },
  { value: "todas", label: "Todas", status: [] },
];

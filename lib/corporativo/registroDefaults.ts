/**
 * Padronização (server-authoritative) do AUTOCADASTRO corporativo.
 *
 * O cliente que se cadastra sozinho em /cadastro NÃO escolhe dados comerciais/fiscais:
 * eles são resolvidos aqui a partir dos lookups reais do Linx, com regras fixas do dono.
 * Isso garante que o cadastro pendente já nasça consistente (o aprovador ainda pode editar).
 *
 * Regras:
 *  - Condição de pagamento: SEMPRE 45 dias (exibida ao cliente como "BOLETO (45 DIAS)").
 *  - Tipo: ATACADO.
 *  - Transportadora: CORREIOS - SEDEX.
 *  - Tabela de preços: PF → 01 (padrão); PJ → 05 (PARCERIAS).
 *  - Conceito: BOM. Pontualidade: INDEFINIDO. Filial: SCARF ME - MATRIZ.
 *  - Região: derivada da UF do endereço.
 *  - Indicador fiscal: PJ → 1 (Empresa); PF → 8 (Não Contribuinte).
 *  - PF é sempre ISENTO (RG_IE = "ISENTO"); PJ informa Inscrição Estadual.
 */
import type { CorporativoLookups, OptionItem, TipoPessoa } from "@/lib/corporativo/types";
import { regiaoFromUf } from "@/lib/corporativo/regioes";

const norm = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Escolhe pelo CÓDIGO (value), tentando cada candidato na ordem. */
function pickByValue(options: OptionItem[], candidates: string[]): string | null {
  for (const c of candidates) {
    const target = norm(c);
    const hit = options.find((o) => norm(o.value) === target);
    if (hit) return hit.value;
  }
  return null;
}

/** Escolhe pela LABEL/descrição contendo TODOS os termos (ex: ["CORREIOS","SEDEX"]). */
function pickByLabelIncludes(options: OptionItem[], terms: string[][]): string | null {
  for (const group of terms) {
    const wanted = group.map(norm);
    const hit = options.find((o) => {
      const hay = norm(`${o.value} ${o.label}`);
      return wanted.every((w) => hay.includes(w));
    });
    if (hit) return hit.value;
  }
  return null;
}

export interface RegistroComercialPadrao {
  condicaoPgto: string;
  codigoTabPreco: string;
  transportadora: string;
  regiao: string;
  conceito: string;
  tipo: string;
  pontualidade: string;
  filial: string;
  indicadorFiscal: number;
  limiteCredito: number;
}

/**
 * Resolve os valores comerciais/fiscais padronizados a partir dos lookups reais.
 * `avisos` lista o que NÃO casou com o Linx (para o aprovador conferir).
 */
export function resolveRegistroComercial(
  lookups: CorporativoLookups,
  tipoPessoa: TipoPessoa,
  uf: string
): { padrao: RegistroComercialPadrao; avisos: string[] } {
  const avisos: string[] = [];
  const isPJ = tipoPessoa === "PJ";

  // Condição de pagamento: 45 dias. Casamos pela descrição contendo "45".
  const condicaoPgto =
    pickByLabelIncludes(lookups.condicoesPgto, [["45"]]) ??
    pickByValue(lookups.condicoesPgto, ["45", "04", "03"]) ??
    "";
  if (!condicaoPgto) avisos.push("Condição de pagamento de 45 dias não encontrada no Linx.");

  // Tabela de preço: PF = 01 (padrão); PJ = 05 (PARCERIAS).
  const codigoTabPreco = isPJ
    ? (pickByValue(lookups.tabelasPreco, ["05"]) ??
        pickByLabelIncludes(lookups.tabelasPreco, [["PARCERIA"]]) ??
        "")
    : (pickByValue(lookups.tabelasPreco, ["01"]) ??
        pickByLabelIncludes(lookups.tabelasPreco, [["PADRAO"]]) ??
        "");
  if (!codigoTabPreco) avisos.push(`Tabela de preço padrão (${isPJ ? "05 PARCERIAS" : "01 PADRÃO"}) não encontrada.`);

  const transportadora =
    pickByLabelIncludes(lookups.transportadoras, [["CORREIOS", "SEDEX"], ["CORREIOS"]]) ?? "";
  if (!transportadora) avisos.push("Transportadora CORREIOS - SEDEX não encontrada no Linx.");

  const tipo = pickByLabelIncludes(lookups.tipos, [["ATACADO"]]) ?? "";
  if (!tipo) avisos.push('Tipo "ATACADO" não encontrado no Linx.');

  const conceito = pickByLabelIncludes(lookups.conceitos, [["BOM"]]) ?? "";
  const pontualidade = pickByLabelIncludes(lookups.pontualidades, [["INDEFINIDO"]]) ?? "INDEFINIDO";

  const filial =
    pickByLabelIncludes(lookups.filiais, [["SCARF", "MATRIZ"], ["MATRIZ"]]) ?? "";
  if (!filial) avisos.push("Filial SCARF ME - MATRIZ não encontrada no Linx.");

  return {
    padrao: {
      condicaoPgto,
      codigoTabPreco,
      transportadora,
      regiao: regiaoFromUf(uf),
      conceito,
      tipo,
      pontualidade,
      filial,
      indicadorFiscal: isPJ ? 1 : 8,
      limiteCredito: 0,
    },
    avisos,
  };
}

/**
 * Grade de tamanhos do Linx — o que conta como "item com P, M ou G".
 *
 * As posições da grade são ordinais 1-based e valem em todo o ERP: `ESTOQUE_PRODUTOS.ES1..ES48`,
 * `EN_1/SA_1..` nos romaneios, `LOJA_VENDA_PRODUTO.TAMANHO` na venda. Os rótulos vêm de
 * `PRODUTOS_TAMANHOS` (`TAMANHO_1..TAMANHO_48`) — nunca do nome da grade, que é só texto livre.
 */

export interface TamanhoGrade {
  /** Posição 1-based na grade (índice de ES1..ES48). */
  ordinal: number;
  /** Rótulo cadastrado: "P", "M", "GG", "38"... */
  label: string;
}

/** Nº máximo de posições de grade no Linx. */
export const MAX_TAMANHOS_GRADE = 48;

const TAMANHOS_FASHION = new Set(["P", "M", "G"]);

/**
 * Uma grade entra na regra de distribuição por tamanho quando tem mais de um tamanho e
 * pelo menos um deles é P, M ou G — o critério que o dono definiu para "peça fashion".
 *
 * Cobre 9 grades / ~2.129 produtos: P/M/G, PP/P/M/G/GG, P\M\G\GG, PP/P/M/G,
 * PP/P/M/G/GG/EG, P/M/G/GG/EG, PP/P, M/G/GG e PP/P/M/G/GG/XGG. Grade numérica
 * (36/38/40...) e tamanho único ficam de fora e seguem o fluxo antigo.
 */
export function gradeEhFashion(tamanhos: TamanhoGrade[]): boolean {
  if (tamanhos.length <= 1) return false;
  return tamanhos.some((t) => TAMANHOS_FASHION.has(t.label.trim().toUpperCase()));
}

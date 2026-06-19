/**
 * Chaves de junção entre análises no grão produto × cor (para "misturar colunas").
 *
 * - canonicalCor: normaliza o código de cor tolerando zero à esquerda ('06' e '6'
 *   colapsam em '6'), espelhando o TRY_CONVERT(INT) usado no SQL ([[cor-produto-formato-duas-fontes]]).
 * - canonicalKey: usada para casar fontes que vêm de tabelas diferentes (vendas, parados).
 * - rawKey: usada para casar com fetchMultipleProductsStockByColor, que faz match EXATO
 *   de PRODUTO + COR_PRODUTO.
 */
type CorInput = string | number | null | undefined;

export function canonicalCor(code: CorInput): string {
  const t = String(code ?? "").trim();
  if (t === "") return "";
  return /^\d+$/.test(t) ? String(parseInt(t, 10)) : t;
}

export function canonicalKey(produto: CorInput, code: CorInput): string {
  return `${String(produto ?? "").trim()}|${canonicalCor(code)}`;
}

export function rawKey(produto: CorInput, code: CorInput): string {
  return `${String(produto ?? "").trim()}-${String(code ?? "").trim()}`;
}

/** Campos ocultos embutidos nas linhas-base para permitir o join (nunca viram coluna). */
export const ROW_COR_FIELD = "__cor"; // código cru da cor

/** Dias decorridos desde uma data ISO até `nowMs` (passado pelo chamador). null se sem data. */
export function diasDesde(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

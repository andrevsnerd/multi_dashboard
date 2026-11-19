import type { NaturezaCatalogo } from "./types";

/** Funções do catálogo de notas usadas na tela e no servidor (sem acesso a banco). */

/**
 * Natureza padrão para um cliente — sempre uma VENDA (remessa, devolução etc. só por escolha):
 * a mais usada para o mesmo indicador fiscal e a mesma relação
 * de UF (dentro/fora); se não houver, a mais usada para o indicador; senão a mais usada da
 * filial entre as validadas. Pode devolver uma natureza ainda em validação (é a que o Linx usa
 * para esse cliente) — a tela mostra o aviso e não deixa gravar.
 */
export function naturezaPadrao(
  todas: NaturezaCatalogo[],
  indFiscal: number | string,
  dentroUf: boolean,
  destino: "cliente" | "filial" = "cliente"
): string | null {
  // Só as naturezas usadas para o mesmo destino (cliente × loja do grupo).
  const lista = naturezasDoDestino(todas, destino);
  const chave = `${indFiscal}|${dentroUf ? "dentro" : "fora"}`;
  const vendas = lista.filter((n) => n.tipoOperacao === "V");
  const melhor = (fn: (n: NaturezaCatalogo) => number) =>
    [...vendas].sort((a, b) => fn(b) - fn(a)).find((n) => fn(n) > 0)?.natureza ?? null;
  return (
    melhor((n) => n.porClasse[chave] ?? 0) ??
    melhor((n) => Object.entries(n.porClasse).filter(([k]) => k.startsWith(`${indFiscal}|`)).reduce((s, [, v]) => s + v, 0)) ??
    vendas.find((n) => n.validada)?.natureza ??
    vendas[0]?.natureza ??
    lista[0]?.natureza ??
    null
  );
}

/** Naturezas do catálogo para o destino (NF a cliente ou a loja/filial do grupo). */
export function naturezasDoDestino(lista: NaturezaCatalogo[], destino: "cliente" | "filial"): NaturezaCatalogo[] {
  return lista.filter((n) => (n.destino ?? "cliente") === destino);
}

/** Consumidor final padrão para a natureza e o indicador fiscal do cliente (o mais comum no histórico). */
export function consumidorFinalPadrao(n: NaturezaCatalogo | undefined, indFiscal: number | string): boolean | null {
  if (!n) return null;
  const v = n.consumidorFinal[String(indFiscal)];
  return v === undefined ? (n.consumidorFinal["*"] ?? null) : v;
}

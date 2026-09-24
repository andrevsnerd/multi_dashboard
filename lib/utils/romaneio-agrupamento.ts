/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ORGANIZAÇÃO VISUAL DOS ITENS DE UM ROMANEIO
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A ordem em que os itens aparecem não é estética: é o que faz a conferência
 * render na bancada. Primeiro os itens são separados por CATEGORIA (banner na
 * tabela) e, dentro dela, os de nome parecido ficam juntos e em ordem de modelo
 * — "CAPA IP 13" antes de "CAPA IP 15", e as duas coladas.
 *
 * Extraído da tela Romaneios para a tela Defeitos usar a MESMA regra. Duas
 * cópias da regra divergiriam, e aí a mesma lista sairia em ordens diferentes
 * dependendo da tela (e do export).
 */

/** O que o agrupamento precisa saber de um item. Qualquer item de romaneio serve. */
export interface ItemAgrupavel {
  descProduto?: string | null;
  produto?: string | null;
  grupo?: string | null;
  subgrupo?: string | null;
  linha?: string | null;
}

/**
 * Separa a descrição em FAMÍLIA (o nome sem o modelo) e MODELO (o primeiro
 * número). "PT HPRIME FIBERPRO IP16 PRO" → família "PT HPRIME FIBERPRO",
 * modelo 16.
 *
 * O recuo de uma palavra quando a anterior é curta (`IP`, `S`, `A`) mantém o
 * prefixo do modelo fora da família — sem isso "IP 13" e "IP 15" cairiam em
 * famílias diferentes e os dois nunca ficariam lado a lado.
 */
export function splitFamilyAndModel(descricao: string | null | undefined): {
  family: string;
  model: number | null;
} {
  const raw = String(descricao ?? '').trim();
  if (!raw) return { family: '', model: null };
  const words = raw.split(/\s+/);
  const idx = words.findIndex((w) => /\d/.test(w));
  if (idx <= 0) return { family: raw.toUpperCase(), model: null };

  const digits = words[idx].replace(/\D+/g, '');
  const model = digits ? parseInt(digits, 10) : null;

  let cut = idx;
  const prevWord = words[cut - 1];
  if (cut - 1 > 0 && prevWord && /^[A-Za-zÀ-ÿ]{1,3}$/.test(prevWord)) cut -= 1;

  const family = words.slice(0, cut).join(' ').toUpperCase();
  return {
    family: family || raw.toUpperCase(),
    model: Number.isFinite(model as number) ? model : null,
  };
}

/**
 * Categoria que vira o banner da tabela. Cada empresa organiza por uma dimensão
 * diferente: ScarfMe pensa em LINHA, NERD pensa em GRUPO.
 */
export function categoriaDoItem(item: ItemAgrupavel, companyKey: string): string {
  if (companyKey === 'scarfme') {
    return item.linha?.trim() || item.subgrupo?.trim() || 'SEM LINHA';
  }
  if (companyKey === 'nerd') {
    return item.grupo?.trim() || 'SEM GRUPO';
  }
  return item.grupo?.trim() || item.subgrupo?.trim() || item.linha?.trim() || 'SEM GRUPO';
}

/** Uma linha do plano: o banner da categoria ou um item dela. */
export type LinhaPlanejada<T> =
  | { kind: 'banner'; label: string }
  | { kind: 'item'; item: T; index: number };

/**
 * Monta a lista na ordem de exibição: banner da categoria, depois os itens dela
 * com os de nome parecido juntos e ordenados por modelo.
 *
 * `index` é a posição do item dentro da categoria — a tela usa como parte da
 * key e o empate de ordenação cai nele, deixando a ordem estável.
 */
export function planejarItensAgrupados<T extends ItemAgrupavel>(
  itens: T[],
  companyKey: string
): LinhaPlanejada<T>[] {
  const porCategoria = new Map<string, T[]>();

  for (const item of itens) {
    const categoria = categoriaDoItem(item, companyKey);
    const balde = porCategoria.get(categoria) ?? [];
    balde.push(item);
    porCategoria.set(categoria, balde);
  }

  const plano: LinhaPlanejada<T>[] = [];

  for (const [categoria, itensDaCategoria] of porCategoria) {
    plano.push({ kind: 'banner', label: categoria });

    const familias = new Map<string, Array<{ item: T; index: number }>>();
    itensDaCategoria.forEach((item, index) => {
      const { family } = splitFamilyAndModel(item.descProduto);
      const chave = family || '—';
      const lista = familias.get(chave) ?? [];
      lista.push({ item, index });
      familias.set(chave, lista);
    });

    for (const lista of familias.values()) {
      lista.sort((a, b) => {
        const aSplit = splitFamilyAndModel(a.item.descProduto);
        const bSplit = splitFamilyAndModel(b.item.descProduto);
        const aModel = aSplit.model ?? Number.POSITIVE_INFINITY;
        const bModel = bSplit.model ?? Number.POSITIVE_INFINITY;
        if (aModel !== bModel) return aModel - bModel;

        const aDesc = String(a.item.descProduto ?? '').toUpperCase();
        const bDesc = String(b.item.descProduto ?? '').toUpperCase();
        if (aDesc !== bDesc) return aDesc.localeCompare(bDesc, 'pt-BR');

        const aProd = String(a.item.produto ?? '');
        const bProd = String(b.item.produto ?? '');
        if (aProd !== bProd) return aProd.localeCompare(bProd, 'pt-BR');

        return a.index - b.index;
      });

      for (const entrada of lista) {
        plano.push({ kind: 'item', item: entrada.item, index: entrada.index });
      }
    }
  }

  return plano;
}

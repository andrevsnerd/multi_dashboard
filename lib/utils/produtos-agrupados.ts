import type { CompanyKey } from "@/lib/config/company";

export const PRODUTO_AGRUPADO_PREFIX = "__PRODUTO_AGRUPADO__:";

export interface ProdutoAgrupadoMember {
  produto: string;
  cor: string;
  descricao: string;
  corDescricao: string;
  vendas?: number;
  qtde?: number;
  averagePrice?: number;
  cost?: number;
  markup?: number;
  stock?: number;
  estoqueRede?: number;
}

export interface ProdutoAgrupadoGroup {
  company: CompanyKey;
  id: string;
  nome: string;
  members: ProdutoAgrupadoMember[];
  createdAt: string;
  updatedAt: string;
}

export function normalizeProdutoAgrupadoValue(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

export function normalizeProdutoAgrupadoKey(value: string | null | undefined): string {
  return normalizeProdutoAgrupadoValue(value)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase();
}

export function buildProdutoAgrupadoProductKey(produto: string | null | undefined): string {
  return normalizeProdutoAgrupadoKey(produto);
}

export function buildProdutoAgrupadoSyntheticId(groupId: string): string {
  return `${PRODUTO_AGRUPADO_PREFIX}${normalizeProdutoAgrupadoValue(groupId)}`;
}

export function isProdutoAgrupadoSyntheticId(value: string | null | undefined): boolean {
  return normalizeProdutoAgrupadoValue(value).startsWith(PRODUTO_AGRUPADO_PREFIX);
}

export function normalizeProdutoAgrupadoMember(
  member: Partial<ProdutoAgrupadoMember>
): ProdutoAgrupadoMember | null {
  const produto = normalizeProdutoAgrupadoValue(member.produto);
  if (!produto) return null;

  return {
    produto,
    cor: normalizeProdutoAgrupadoValue(member.cor),
    descricao: normalizeProdutoAgrupadoValue(member.descricao),
    corDescricao: normalizeProdutoAgrupadoValue(member.corDescricao),
  };
}

export function dedupeProdutoAgrupadoMembers(
  members: Array<Partial<ProdutoAgrupadoMember>>
): ProdutoAgrupadoMember[] {
  const unique = new Map<string, ProdutoAgrupadoMember>();

  for (const member of members) {
    const normalized = normalizeProdutoAgrupadoMember(member);
    if (!normalized) continue;

    const key = buildProdutoAgrupadoProductKey(normalized.produto);
    if (!unique.has(key)) {
      unique.set(key, normalized);
    }
  }

  return Array.from(unique.values()).sort((a, b) =>
    a.descricao.localeCompare(b.descricao, "pt-BR") || a.produto.localeCompare(b.produto, "pt-BR")
  );
}

export function buildProdutoAgrupadoLookup(
  groups: ProdutoAgrupadoGroup[]
): Map<string, ProdutoAgrupadoGroup> {
  const lookup = new Map<string, ProdutoAgrupadoGroup>();

  for (const group of groups) {
    for (const member of group.members) {
      lookup.set(buildProdutoAgrupadoProductKey(member.produto), group);
    }
  }

  return lookup;
}

/* ─── Cor canônica dos grupos ────────────────────────────────────────────────
 *
 * O grupo é montado no nível PRODUTO ("CAPA BASIC" = CP BASIC 1 + CP BASIC 2),
 * mas toda visão por cor precisa continuar quebrando por cor:
 *
 *   CAPA BASIC AZUL     = CP BASIC 1 AZUL     + CP BASIC 2 AZUL
 *   CAPA BASIC VERMELHO = CP BASIC 1 VERMELHO + CP BASIC 2 VERMELHO
 *
 * O que NÃO dá para usar como chave é o CÓDIGO de cor: ele é escopado por
 * produto — o '06' de um produto é outra cor em outro (ver colorMapping /
 * PRODUTO_CORES). Quem manda é a DESCRIÇÃO da cor (DESC_COR_PRODUTO); o código
 * só entra como último recurso, e aí a cor fica separada, que é o lado seguro
 * do erro (nunca funde duas cores diferentes).
 */

/** Código de cor tolerante a zero à esquerda: '06' e '6' viram a mesma chave. */
export function normalizeProdutoAgrupadoCorCode(cor: string | null | undefined): string {
  const raw = normalizeProdutoAgrupadoValue(cor);
  if (!raw) return "";
  if (/^\d+$/.test(raw)) return String(Number(raw));
  return normalizeProdutoAgrupadoKey(raw);
}

/** Descrição de cor normalizada (sem acento, caixa alta, espaços colapsados). */
export function normalizeProdutoAgrupadoCorDescricao(value: string | null | undefined): string {
  return normalizeProdutoAgrupadoKey(value).replace(/[^A-Z0-9]+/g, " ").trim();
}

/** Chave do mapa (produto, código de cor) → DESC_COR_PRODUTO. */
export function buildProdutoAgrupadoCorLookupKey(
  produto: string | null | undefined,
  cor: string | null | undefined
): string {
  return `${buildProdutoAgrupadoProductKey(produto)}||${normalizeProdutoAgrupadoCorCode(cor)}`;
}

/** produto+cor → descrição da cor (vem de PRODUTO_CORES). */
export type ProdutoAgrupadoCorLookup = Map<string, string>;

export interface ProdutoAgrupadoCorResolved {
  /** Chave de fusão: mesma cor em produtos diferentes → mesma chave. */
  key: string;
  /** Rótulo exibível da cor (descrição quando existe, senão o código). */
  label: string;
}

/**
 * Resolve a cor canônica de uma linha para fundir membros do grupo.
 * Precedência: descrição da própria linha → descrição do cadastro (lookup) →
 * código de cor prefixado (`#`), que nunca colide com uma descrição.
 */
export function resolveProdutoAgrupadoCor(
  produto: string | null | undefined,
  cor: string | null | undefined,
  corDescricao?: string | null,
  lookup?: ProdutoAgrupadoCorLookup | null
): ProdutoAgrupadoCorResolved {
  const codigo = normalizeProdutoAgrupadoValue(cor);
  const descricaoDireta = normalizeProdutoAgrupadoValue(corDescricao);
  const descricaoCadastro = lookup?.get(buildProdutoAgrupadoCorLookupKey(produto, cor)) ?? "";
  const descricao = descricaoDireta || normalizeProdutoAgrupadoValue(descricaoCadastro);

  if (descricao) {
    return { key: normalizeProdutoAgrupadoCorDescricao(descricao), label: descricao };
  }
  if (codigo) {
    return { key: `#${normalizeProdutoAgrupadoCorCode(codigo)}`, label: codigo };
  }
  return { key: "", label: "" };
}

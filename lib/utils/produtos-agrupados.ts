import type { CompanyKey } from "@/lib/config/company";

export const PRODUTO_AGRUPADO_PREFIX = "__PRODUTO_AGRUPADO__:";

export interface ProdutoAgrupadoMember {
  produto: string;
  cor: string;
  descricao: string;
  corDescricao: string;
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

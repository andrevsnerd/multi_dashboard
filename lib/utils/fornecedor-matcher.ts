/**
 * Matcher puro (sem `server-only`) compartilhado entre o frontend (Curva ABC,
 * Lista Loja) e o backend (Gerador de Relatórios) para decidir a qual
 * fornecedor um produto pertence.
 *
 * Um fornecedor "explícito" (ex.: Fornecedor Externo) captura produtos por
 * MARCA na descrição (contém) e/ou por ITEM específico (código + cor opcional).
 * Um fornecedor "complemento" (ex.: Centro) captura tudo que NÃO foi capturado
 * pelos fornecedores que ele está configurado a ignorar.
 */

export type FornecedorModo = 'explicito' | 'complemento';

export interface FornecedorItem {
  produto: string;
  cor?: string | null; // vazia = qualquer cor do produto
}

export interface Fornecedor {
  id: string;
  company: string;
  nome: string;
  modo: FornecedorModo;
  termosDescricao: string[];
  itens: FornecedorItem[];
  ignorarFornecedorIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProdutoInfo {
  produto?: string | null;
  cor?: string | null;
  descricao?: string | null;
}

/** Uppercase + remove acentos. Espelha a classificação NF dos scripts Python. */
export function normalizeTermo(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toUpperCase();
}

/**
 * Normaliza o código de cor para comparação, tolerando os dois formatos que
 * chegam das fontes ('06' vs '6'). Espelha normalizeCorKey de
 * lib/repositories/products.ts. Ver memória [[cor-produto-formato-duas-fontes]].
 */
function normalizeCorKey(cor: string | null | undefined): string {
  const trimmed = String(cor ?? '').trim();
  if (trimmed === '') return '';
  if (/^\d+$/.test(trimmed)) return String(parseInt(trimmed, 10));
  return trimmed.toUpperCase();
}

function normalizeProdutoKey(produto: string | null | undefined): string {
  return String(produto ?? '').trim().toUpperCase();
}

/**
 * True se o produto casa as regras EXPLÍCITAS do fornecedor: descrição contém
 * algum termo, OU (produto[, cor]) casa algum item. Item com cor vazia casa
 * qualquer cor do produto.
 */
export function matchExplicito(fornecedor: Fornecedor, info: ProdutoInfo): boolean {
  const descricao = normalizeTermo(info.descricao);
  if (descricao) {
    for (const termo of fornecedor.termosDescricao ?? []) {
      const t = normalizeTermo(termo);
      if (t && descricao.includes(t)) return true;
    }
  }

  const produto = normalizeProdutoKey(info.produto);
  if (produto) {
    const cor = normalizeCorKey(info.cor);
    for (const item of fornecedor.itens ?? []) {
      if (normalizeProdutoKey(item.produto) !== produto) continue;
      const itemCor = normalizeCorKey(item.cor);
      if (itemCor === '' || itemCor === cor) return true;
    }
  }

  return false;
}

/**
 * Predicado único usado por todas as telas: o produto pertence ao fornecedor
 * de id `fornecedorId`?
 *  - fornecedor explícito → casa suas regras.
 *  - fornecedor complemento → nenhum dos fornecedores ignorados captura o produto.
 */
export function productMatchesFornecedor(
  fornecedores: Fornecedor[],
  fornecedorId: string,
  info: ProdutoInfo
): boolean {
  const alvo = fornecedores.find((f) => f.id === fornecedorId);
  if (!alvo) return false;

  if (alvo.modo === 'explicito') {
    return matchExplicito(alvo, info);
  }

  // Complemento: pertence se nenhum fornecedor ignorado o captura.
  for (const ignoradoId of alvo.ignorarFornecedorIds ?? []) {
    const ignorado = fornecedores.find((f) => f.id === ignoradoId);
    if (ignorado && matchExplicito(ignorado, info)) return false;
  }
  return true;
}

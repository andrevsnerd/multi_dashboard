import sql from 'mssql';

import { withRequest } from '@/lib/db/connection';
import { fetchProdutosCustoPrecoMestre } from '@/lib/repositories/products';

/**
 * Cadastro no Linx dos produtos vinculados à tela "Aproveitamentos Matriz".
 *
 * Só leitura de cadastro (PRODUTOS + PRODUTO_CORES). O estoque desses itens NÃO vem do
 * Linx — é a contagem manual do store ([aproveitamentos-matriz-store.ts](@/lib/utils/aproveitamentos-matriz-store)).
 * Custo e preço sugerido saem da tabela mestre, pela mesma função do Gerador
 * (`fetchProdutosCustoPrecoMestre`: CUSTO_REPOSICAO1 / PRECO_REPOSICAO_1).
 */

export interface CorCadastro {
  cor: string;
  descricao: string;
}

export interface CadastroAproveitamento {
  produto: string;
  descricao: string;
  grade: string;
  /** SUBGRUPO_PRODUTO — aqui é o tecido (cetim de poliéster × cetim de seda). */
  tecido: string;
  linha: string;
  custo: number;
  precoSugerido: number | null;
  cores: CorCadastro[];
}

const CHUNK = 500;

export async function fetchCadastroAproveitamentos(
  produtos: string[]
): Promise<Map<string, CadastroAproveitamento>> {
  const ids = [...new Set(produtos.map((p) => (p ?? '').trim().toUpperCase()).filter(Boolean))];
  const out = new Map<string, CadastroAproveitamento>();
  if (ids.length === 0) return out;

  for (let start = 0; start < ids.length; start += CHUNK) {
    const chunk = ids.slice(start, start + CHUNK);
    await withRequest(async (request) => {
      // VarChar: parâmetro NVARCHAR mata o index seek — ver [[param-nvarchar-proxy-mata-index-seek]].
      chunk.forEach((id, i) => request.input(`apr${i}`, sql.VarChar, id));
      const placeholders = chunk.map((_, i) => `@apr${i}`).join(', ');
      const result = await request.query<{
        produto: string;
        descricao: string | null;
        grade: string | null;
        tecido: string | null;
        linha: string | null;
        cor: string | null;
        descCor: string | null;
      }>(`
        SELECT
          RTRIM(p.PRODUTO) AS produto,
          RTRIM(p.DESC_PRODUTO) AS descricao,
          RTRIM(p.GRADE) AS grade,
          RTRIM(p.SUBGRUPO_PRODUTO) AS tecido,
          RTRIM(p.LINHA) AS linha,
          RTRIM(c.COR_PRODUTO) AS cor,
          RTRIM(c.DESC_COR_PRODUTO) AS descCor
        FROM PRODUTOS p WITH (NOLOCK)
        LEFT JOIN PRODUTO_CORES c WITH (NOLOCK) ON c.PRODUTO = p.PRODUTO
        WHERE p.PRODUTO IN (${placeholders})
        ORDER BY p.PRODUTO, c.COR_PRODUTO
      `);
      for (const r of result.recordset) {
        const produto = (r.produto ?? '').trim();
        if (!produto) continue;
        let item = out.get(produto);
        if (!item) {
          item = {
            produto,
            descricao: (r.descricao ?? '').trim(),
            grade: (r.grade ?? '').trim(),
            tecido: (r.tecido ?? '').trim(),
            linha: (r.linha ?? '').trim(),
            custo: 0,
            precoSugerido: null,
            cores: [],
          };
          out.set(produto, item);
        }
        const cor = (r.cor ?? '').trim();
        if (cor && !item.cores.some((c) => c.cor === cor)) {
          item.cores.push({ cor, descricao: (r.descCor ?? '').trim() });
        }
      }
    });
  }

  const custoPreco = await fetchProdutosCustoPrecoMestre([...out.keys()]);
  for (const [produto, item] of out) {
    const cp = custoPreco.get(produto);
    if (!cp) continue;
    item.custo = cp.custo;
    item.precoSugerido = cp.precoSugerido;
  }

  return out;
}

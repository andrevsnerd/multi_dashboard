import sql from "mssql";

import { resolveCicloCompra } from "@/lib/config/compra-ciclo";
import { withRequest } from "@/lib/db/connection";

/**
 * Data de recebimento AUTOMÁTICA das compras em trânsito.
 *
 * Regra (dono, jun/2026): ao CONFIRMAR a compra, a data em que cada item chega é
 *   dataRecebimento = data da confirmação + tempo de produção (producaoDias)
 * onde producaoDias vem do ciclo do produto (resolveCicloCompra por linha/subgrupo) —
 * o mesmo lead time usado na Compra Ideal. Como é calculado na confirmação, se a lista
 * foi criada num dia e confirmada noutro, a produção conta a partir da confirmação.
 *
 * Itens com `dataRecebimentoManual` continuam intocados (o usuário fixou a data).
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Soma `dias` a uma data e devolve YYYY-MM-DD (horário local do servidor). */
function addDaysIso(base: Date, dias: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() + Math.max(0, Math.round(dias)));
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export interface RecebimentoItemLike {
  produto?: string | null;
  dataRecebimento?: string | null;
  dataRecebimentoManual?: boolean;
}

/**
 * Busca no Linx (PRODUTOS) a linha/subgrupo de cada produto e resolve o producaoDias do
 * ciclo. Retorna Map produto → producaoDias. Em lote. Tolerante a falha (Map vazio).
 */
async function resolveProducaoDiasByProduto(
  company: string,
  produtos: string[]
): Promise<Map<string, number>> {
  const uniq = [...new Set(produtos.map((p) => String(p ?? "").trim()).filter(Boolean))];
  const map = new Map<string, number>();
  if (uniq.length === 0) return map;

  try {
    const CHUNK = 200;
    for (let i = 0; i < uniq.length; i += CHUNK) {
      const chunk = uniq.slice(i, i + CHUNK);
      const rows = await withRequest(async (req) => {
        chunk.forEach((p, idx) => req.input(`p${idx}`, sql.VarChar, p));
        const inList = chunk.map((_, idx) => `@p${idx}`).join(", ");
        const query = `
          SELECT
            RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) AS PRODUTO,
            ISNULL(p.LINHA, '') AS LINHA,
            ISNULL(p.SUBGRUPO_PRODUTO, '') AS SUBGRUPO
          FROM PRODUTOS p WITH (NOLOCK)
          WHERE RTRIM(LTRIM(CAST(p.PRODUTO AS VARCHAR(50)))) IN (${inList})
        `;
        const result = await req.query<{ PRODUTO: string; LINHA: string | null; SUBGRUPO: string | null }>(query);
        return result.recordset;
      });
      for (const row of rows) {
        const produto = String(row.PRODUTO ?? "").trim();
        if (!produto) continue;
        const ciclo = resolveCicloCompra(company, { linha: row.LINHA, subgrupo: row.SUBGRUPO });
        map.set(produto, ciclo.producaoDias);
      }
    }
  } catch (error) {
    console.error("[compra-transito-recebimento] Falha ao resolver producaoDias no Linx:", error);
  }
  return map;
}

/**
 * Aplica a data de recebimento automática aos itens NÃO manuais, usando `confirmDate`
 * como base (data da confirmação). Itens manuais ficam intactos. Quando o produto não é
 * achado no Linx, usa o producaoDias DEFAULT da empresa (resolveCicloCompra sem categoria).
 * Só altera o campo dataRecebimento — nenhum outro.
 */
export async function applyAutoRecebimento<T extends RecebimentoItemLike>(
  company: string,
  items: T[],
  confirmDate: Date
): Promise<T[]> {
  const auto = items.filter((it) => it.dataRecebimentoManual !== true && String(it.produto ?? "").trim());
  if (auto.length === 0) return items;

  const map = await resolveProducaoDiasByProduto(company, auto.map((it) => String(it.produto)));
  const producaoDefault = resolveCicloCompra(company, {}).producaoDias;

  return items.map((it) => {
    if (it.dataRecebimentoManual === true || !String(it.produto ?? "").trim()) return it;
    const producaoDias = map.get(String(it.produto).trim()) ?? producaoDefault;
    return { ...it, dataRecebimento: addDaysIso(confirmDate, producaoDias) };
  });
}

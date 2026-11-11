import { query } from '@/lib/db/connection';
import { chaveSku, type GradeProduto } from '@/lib/server/grade-produto';
import { MAX_TAMANHOS_GRADE } from '@/lib/utils/grade-tamanhos';
import type { ItemConfirmado } from '@/lib/server/trava-confirmacao-acima-romaneio';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA — CONFERÊNCIA PARCIAL DA LOJA NÃO VIRA ENTRADA SEM A LOGÍSTICA.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Regra do dono (11/11/2026): a loja só lança direto a entrada de uma saída
 * quando confere TUDO — todos os itens, na quantidade que saiu e, em peça P/M/G,
 * no mesmo tamanho. Qualquer diferença vai para a revisão da logística
 * (lib/utils/romaneio-revisao-store.ts), que aprova uma entrada só.
 *
 * A tela já manda a parcial para a revisão; esta é a garantia no servidor. Só
 * vale para quem NÃO é logística/admin (canRevisarConferencia) — quem chama decide.
 * Saída sem linhas encontradas → null (fail-open, como as outras travas).
 */
export async function verificarConferenciaIntegral(params: {
  romaneioSaida: string;
  filialOrigem: string;
  itens: ItemConfirmado[];
  grades: Map<string, GradeProduto>;
}): Promise<string | null> {
  const romaneio = (params.romaneioSaida || '').trim();
  const filial = (params.filialOrigem || '').trim();
  if (!romaneio || !filial) return null;

  const lit = (v: string) => `'${(v || '').replace(/'/g, "''")}'`;
  const rows = await query<Record<string, unknown>>(`
    SELECT LTRIM(RTRIM(i.PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(i.COR_PRODUTO, ''))) AS COR,
           SUM(ISNULL(i.QTDE, 0)) AS QTDE,
           ${Array.from({ length: MAX_TAMANHOS_GRADE }, (_, k) => `SUM(ISNULL(i.SA_${k + 1}, 0)) AS SA${k + 1}`).join(', ')}
    FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
    WHERE LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) = ${lit(romaneio)}
      AND i.FILIAL = (
            SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK)
            WHERE LTRIM(RTRIM(FILIAL)) = ${lit(filial)} OR LTRIM(RTRIM(COD_FILIAL)) = ${lit(filial)}
          )
    GROUP BY LTRIM(RTRIM(i.PRODUTO)), LTRIM(RTRIM(ISNULL(i.COR_PRODUTO, '')))
  `);
  if (rows.length === 0) return null;

  const pedido = new Map<string, { total: number; porTam: Map<number, number> }>();
  for (const it of params.itens) {
    const k = chaveSku(it.produto, it.corProduto);
    const p = pedido.get(k) ?? { total: 0, porTam: new Map<number, number>() };
    const q = Math.max(0, Math.floor(Number(it.quantidade) || 0));
    p.total += q;
    const t = Number(it.tamanho);
    if (Number.isInteger(t) && t >= 1) p.porTam.set(t, (p.porTam.get(t) ?? 0) + q);
    pedido.set(k, p);
  }

  let itensDiferentes = 0;
  let pecasFaltando = 0;
  for (const r of rows) {
    const produto = String(r.PRODUTO);
    const total = Number(r.QTDE) || 0;
    if (total <= 0) continue;
    const p = pedido.get(chaveSku(produto, String(r.COR ?? '')));
    const conferido = p?.total ?? 0;
    let diferente = conferido !== total;
    if (!diferente && p && params.grades.get(produto)?.exigeTamanho) {
      for (let k = 1; k <= MAX_TAMANHOS_GRADE; k++) {
        if ((p.porTam.get(k) ?? 0) !== (Number(r[`SA${k}`]) || 0)) {
          diferente = true;
          break;
        }
      }
    }
    if (diferente) {
      itensDiferentes += 1;
      pecasFaltando += Math.max(0, total - conferido);
    }
  }
  if (itensDiferentes === 0) return null;

  return (
    `Nada foi lançado: a conferência do romaneio ${romaneio} não bate com o que saiu ` +
    `(${itensDiferentes} item(ns) diferente(s)${pecasFaltando > 0 ? `, ${pecasFaltando} peça(s) a menos` : ''}). ` +
    'Conferência parcial vai para a revisão da logística — atualize a tela e confirme de novo.'
  );
}

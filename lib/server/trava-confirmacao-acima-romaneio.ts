import { query } from '@/lib/db/connection';
import { chaveSku, type GradeProduto } from '@/lib/server/grade-produto';
import { MAX_TAMANHOS_GRADE } from '@/lib/utils/grade-tamanhos';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA — A CONFIRMAÇÃO NUNCA PASSA DO ROMANEIO.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Regra do dono (27/10/2026): quem confirma uma saída (gerente da loja que
 * recebe) não tem poder de ajuste. A entrada que confirma a saída só pode ter:
 *  - produto×cor que ESTÁ na saída;
 *  - no máximo a quantidade que saiu;
 *  - em peça P/M/G, no máximo o que saiu EM CADA TAMANHO (tamanho trocado não
 *    é aceito: saiu P, a loja não confirma M).
 * Peça sobrando ou de outro tamanho é a logística que lança, por ajuste.
 *
 * A tela já não deixa passar (modo manual e bipagem); esta é a garantia no
 * servidor, para qualquer tela que confirme saída (Romaneios, Defeitos).
 *
 * Total compara com SUM(QTDE) da saída, não com a soma da grade: há linhas
 * antigas com QTDE ≠ soma(SA_n) (editar-qtd antigo) e a tela mostra QTDE.
 */

export interface ItemConfirmado {
  produto: string;
  corProduto: string | null;
  quantidade: number;
  tamanho?: number | null;
}

function lit(value: string): string {
  return `'${(value || '').replace(/'/g, "''")}'`;
}

/**
 * Mensagem de recusa, ou null quando está tudo dentro do romaneio. Saída sem
 * nenhuma linha encontrada → null (não dá para conferir; a rota segue
 * fail-open como as outras travas). Erro de consulta propaga.
 */
export async function verificarConfirmacaoDentroDoRomaneio(params: {
  romaneioSaida: string;
  filialOrigem: string;
  itens: ItemConfirmado[];
  grades: Map<string, GradeProduto>;
}): Promise<string | null> {
  const romaneio = (params.romaneioSaida || '').trim();
  const filial = (params.filialOrigem || '').trim();
  if (!romaneio || !filial || params.itens.length === 0) return null;

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

  const saida = new Map<string, { total: number; sa: number[] }>();
  for (const r of rows) {
    saida.set(chaveSku(String(r.PRODUTO), String(r.COR ?? '')), {
      total: Number(r.QTDE) || 0,
      sa: Array.from({ length: MAX_TAMANHOS_GRADE }, (_, k) => Number(r[`SA${k + 1}`]) || 0),
    });
  }

  // Soma o que está sendo confirmado (o mesmo item pode vir em várias linhas, uma por tamanho).
  const pedido = new Map<string, { produto: string; cor: string; total: number; porTam: Map<number, number> }>();
  for (const it of params.itens) {
    const k = chaveSku(it.produto, it.corProduto);
    const p = pedido.get(k) ?? { produto: it.produto.trim(), cor: (it.corProduto ?? '').trim(), total: 0, porTam: new Map() };
    const q = Math.max(0, Math.floor(Number(it.quantidade) || 0));
    p.total += q;
    const t = Number(it.tamanho);
    if (Number.isInteger(t) && t >= 1) p.porTam.set(t, (p.porTam.get(t) ?? 0) + q);
    pedido.set(k, p);
  }

  const problemas: string[] = [];
  for (const [k, p] of pedido) {
    const nome = `${p.produto}${p.cor ? ` cor ${p.cor}` : ''}`;
    const s = saida.get(k);
    if (!s) {
      problemas.push(`${nome} não está no romaneio`);
      continue;
    }
    if (p.total > s.total) {
      problemas.push(`${nome}: ${p.total} confirmada(s), o romaneio tem ${s.total}`);
      continue;
    }
    const grade = params.grades.get(p.produto);
    if (!grade?.exigeTamanho) continue;
    for (const [t, q] of p.porTam) {
      const enviado = s.sa[t - 1] ?? 0;
      if (q > enviado) {
        const rotulo = grade.tamanhos.find((x) => x.ordinal === t)?.label ?? `tam. ${t}`;
        problemas.push(
          enviado === 0
            ? `${nome}: tamanho ${rotulo} não saiu neste romaneio`
            : `${nome}: ${q} no tamanho ${rotulo}, o romaneio tem ${enviado}`
        );
      }
    }
  }
  if (problemas.length === 0) return null;

  const lista = problemas.slice(0, 5).join('; ');
  const resto = problemas.length > 5 ? ` e mais ${problemas.length - 5}` : '';
  return (
    `Nada foi lançado: a confirmação passa do romaneio ${romaneio} (${lista}${resto}). ` +
    'Só é possível confirmar até o que saiu, no mesmo tamanho. Peça a mais ou de outro tamanho: avise a logística.'
  );
}

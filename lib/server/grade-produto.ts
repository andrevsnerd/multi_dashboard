import { query } from '@/lib/db/connection';
import { gradeEhFashion, MAX_TAMANHOS_GRADE, type TamanhoGrade } from '@/lib/utils/grade-tamanhos';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  GRADE DO PRODUTO NAS OPERAÇÕES — tamanho obrigatório em peça P/M/G.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Saída, entrada, confirmação de romaneio e transferência gravam o tamanho na
 * coluna de grade (SA_n / EN_n), e o trigger do Linx move ESn junto. Até
 * 14/10/2026 tudo ia para o TAMANHO_BASE (1ª posição = P): o total batia, mas a
 * loja ficava com P a mais e M/G a menos.
 *
 * Regra (decisão do dono): peça cuja grade é "fashion" (`gradeEhFashion`: mais de
 * um tamanho e algum P/M/G) EXIGE o tamanho. Grade de tamanho único, medida de
 * lenço (90X90) ou numérica segue o fluxo antigo, no tamanho base.
 *
 * Tamanho = posição 1-based da grade (ver memória grade-tamanhos-posicional-linx).
 */

export interface GradeProduto {
  produto: string;
  /** Tamanhos cadastrados (rótulo não vazio), na ordem da grade. */
  tamanhos: TamanhoGrade[];
  /** true = tamanho obrigatório nas operações. */
  exigeTamanho: boolean;
  /** PRODUTOS.TAMANHO_BASE (1..48) — usado quando o tamanho não é exigido. */
  tamanhoBase: number;
}

export interface TamanhoComEstoque extends TamanhoGrade {
  estoque: number;
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** Grade (rótulos + regra) de cada produto. Produto sem cadastro não entra no mapa. */
export async function carregarGrades(produtos: string[]): Promise<Map<string, GradeProduto>> {
  const unicos = [...new Set(produtos.map((p) => (p || '').trim()).filter(Boolean))];
  const mapa = new Map<string, GradeProduto>();
  for (let i = 0; i < unicos.length; i += 500) {
    const fatia = unicos.slice(i, i + 500);
    const rows = await query<Record<string, unknown>>(`
      SELECT LTRIM(RTRIM(p.PRODUTO)) AS PRODUTO, ISNULL(p.TAMANHO_BASE, 1) AS TB,
        ${Array.from(
          { length: MAX_TAMANHOS_GRADE },
          (_, k) => `LTRIM(RTRIM(ISNULL(CAST(pt.TAMANHO_${k + 1} AS VARCHAR(20)), ''))) AS T${k + 1}`
        ).join(',\n        ')}
      FROM PRODUTOS p WITH (NOLOCK)
      LEFT JOIN PRODUTOS_TAMANHOS pt WITH (NOLOCK)
        ON LTRIM(RTRIM(CONVERT(VARCHAR(60), pt.GRADE))) = LTRIM(RTRIM(CONVERT(VARCHAR(60), p.GRADE)))
      WHERE LTRIM(RTRIM(p.PRODUTO)) IN (${fatia.map(lit).join(',')})
    `);
    for (const row of rows) {
      const tamanhos: TamanhoGrade[] = [];
      for (let k = 1; k <= MAX_TAMANHOS_GRADE; k += 1) {
        const label = String(row[`T${k}`] ?? '').trim();
        if (label) tamanhos.push({ ordinal: k, label });
      }
      const tb = Number(row.TB);
      mapa.set(String(row.PRODUTO), {
        produto: String(row.PRODUTO),
        tamanhos,
        exigeTamanho: gradeEhFashion(tamanhos),
        tamanhoBase: tb >= 1 && tb <= MAX_TAMANHOS_GRADE ? tb : 1,
      });
    }
  }
  return mapa;
}

/** Chave produto|cor (cor '06' e '6' viram a mesma, como no resto do sistema). */
export function chaveSku(produto: string, cor: string | null | undefined): string {
  const c = (cor ?? '').toString().trim();
  const n = Number(c);
  return `${(produto || '').trim()}|${c !== '' && Number.isInteger(n) ? String(n) : c}`;
}

/**
 * Saldo por tamanho (ES1..ES48) de cada produto×cor na filial. `filial` aceita o
 * nome do Linx ou o COD_FILIAL. Item sem linha em ESTOQUE_PRODUTOS não entra.
 */
export async function carregarEstoquePorTamanho(
  filial: string,
  produtos: string[]
): Promise<Map<string, { estoque: number; es: number[] }>> {
  const unicos = [...new Set(produtos.map((p) => (p || '').trim()).filter(Boolean))];
  const mapa = new Map<string, { estoque: number; es: number[] }>();
  const f = (filial || '').trim();
  if (!f || unicos.length === 0) return mapa;
  for (let i = 0; i < unicos.length; i += 500) {
    const fatia = unicos.slice(i, i + 500);
    const rows = await query<Record<string, unknown>>(`
      SELECT LTRIM(RTRIM(e.PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(e.COR_PRODUTO, ''))) AS COR,
             ISNULL(e.ESTOQUE, 0) AS ESTOQUE,
             ${Array.from({ length: MAX_TAMANHOS_GRADE }, (_, k) => `ISNULL(e.ES${k + 1}, 0) AS ES${k + 1}`).join(', ')}
      FROM ESTOQUE_PRODUTOS e WITH (NOLOCK)
      WHERE e.FILIAL = (
              SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK)
              WHERE LTRIM(RTRIM(FILIAL)) = ${lit(f)} OR LTRIM(RTRIM(COD_FILIAL)) = ${lit(f)}
            )
        AND LTRIM(RTRIM(e.PRODUTO)) IN (${fatia.map(lit).join(',')})
    `);
    for (const row of rows) {
      mapa.set(chaveSku(String(row.PRODUTO), String(row.COR ?? '')), {
        estoque: Number(row.ESTOQUE) || 0,
        es: Array.from({ length: MAX_TAMANHOS_GRADE }, (_, k) => Number(row[`ES${k + 1}`]) || 0),
      });
    }
  }
  return mapa;
}

export interface ItemComTamanho {
  produto: string;
  corProduto?: string | null;
  quantidade: number;
  /** Posição da grade (1..48). Obrigatório quando a grade exige tamanho. */
  tamanho?: number | null;
}

/**
 * Confere o tamanho de cada item contra a grade. Devolve a mensagem de erro (para
 * o operador) ou null. Peça que exige tamanho sem tamanho, ou com tamanho que
 * não existe na grade, é recusada; nas demais o tamanho é ignorado (vai no base).
 */
export function validarTamanhos(itens: ItemComTamanho[], grades: Map<string, GradeProduto>): string | null {
  const faltando: string[] = [];
  const invalidos: string[] = [];
  for (const it of itens) {
    const grade = grades.get((it.produto || '').trim());
    if (!grade?.exigeTamanho) continue;
    const t = Number(it.tamanho);
    if (!it.tamanho || !Number.isInteger(t)) {
      faltando.push(`${it.produto}${it.corProduto ? ` cor ${it.corProduto}` : ''}`);
    } else if (!grade.tamanhos.some((g) => g.ordinal === t)) {
      invalidos.push(`${it.produto} (tamanho ${t})`);
    }
  }
  if (faltando.length > 0) {
    return (
      `Informe o tamanho (${'P/M/G'}) das peças: ${[...new Set(faltando)].slice(0, 10).join(', ')}` +
      `${faltando.length > 10 ? '…' : ''}. Esses produtos têm grade de tamanhos e o tamanho é obrigatório.`
    );
  }
  if (invalidos.length > 0) {
    return `Tamanho que não existe na grade do produto: ${[...new Set(invalidos)].slice(0, 10).join(', ')}.`;
  }
  return null;
}

/**
 * Grade (SA_1..SA_48) de cada produto×cor num romaneio de SAÍDA. `filial` aceita o
 * nome do Linx ou o COD_FILIAL.
 */
export async function carregarGradeDaSaida(
  romaneio: string,
  filial: string,
  produtos: string[]
): Promise<Map<string, number[]>> {
  const mapa = new Map<string, number[]>();
  const unicos = [...new Set(produtos.map((p) => (p || '').trim()).filter(Boolean))];
  const r = (romaneio || '').trim();
  const f = (filial || '').trim();
  if (!r || !f || unicos.length === 0) return mapa;
  const rows = await query<Record<string, unknown>>(`
    SELECT LTRIM(RTRIM(i.PRODUTO)) AS PRODUTO, LTRIM(RTRIM(ISNULL(i.COR_PRODUTO, ''))) AS COR,
           ${Array.from({ length: MAX_TAMANHOS_GRADE }, (_, k) => `SUM(ISNULL(i.SA_${k + 1}, 0)) AS SA${k + 1}`).join(', ')}
    FROM ESTOQUE_PROD1_SAI i WITH (NOLOCK)
    WHERE LTRIM(RTRIM(i.ROMANEIO_PRODUTO)) = ${lit(r)}
      AND i.FILIAL = (
            SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK)
            WHERE LTRIM(RTRIM(FILIAL)) = ${lit(f)} OR LTRIM(RTRIM(COD_FILIAL)) = ${lit(f)}
          )
      AND LTRIM(RTRIM(i.PRODUTO)) IN (${unicos.map(lit).join(',')})
    GROUP BY LTRIM(RTRIM(i.PRODUTO)), LTRIM(RTRIM(ISNULL(i.COR_PRODUTO, '')))
  `);
  for (const row of rows) {
    mapa.set(
      chaveSku(String(row.PRODUTO), String(row.COR ?? '')),
      Array.from({ length: MAX_TAMANHOS_GRADE }, (_, k) => Number(row[`SA${k + 1}`]) || 0)
    );
  }
  return mapa;
}

/**
 * ENTRADA QUE CONFIRMA UMA SAÍDA, sem tamanho informado (telas que ainda não
 * perguntam o tamanho, ex.: Defeitos): copia o tamanho da própria saída — o que
 * saiu P entra P. Só quando não há dúvida:
 *  - a quantidade confirmada é igual à da saída → espelha a saída tamanho a tamanho;
 *  - a saída tem um tamanho só → tudo nesse tamanho.
 * Fora disso (conferiu menos de uma saída com vários tamanhos) o item fica sem
 * tamanho e `validarTamanhos` recusa pedindo que o operador informe.
 */
export async function preencherTamanhosPelaSaida<T extends ItemComTamanho>(
  itens: T[],
  grades: Map<string, GradeProduto>,
  romaneioSaida: string,
  filialOrigem: string
): Promise<T[]> {
  const semTamanho = itens.filter((it) => grades.get((it.produto || '').trim())?.exigeTamanho && !it.tamanho);
  if (semTamanho.length === 0) return itens;
  const gradeSaida = await carregarGradeDaSaida(
    romaneioSaida,
    filialOrigem,
    semTamanho.map((it) => it.produto)
  );
  const resultado: T[] = [];
  for (const it of itens) {
    const precisa = grades.get((it.produto || '').trim())?.exigeTamanho && !it.tamanho;
    const sa = precisa ? gradeSaida.get(chaveSku(it.produto, it.corProduto)) : undefined;
    if (!precisa || !sa) {
      resultado.push(it);
      continue;
    }
    const totalSaida = sa.reduce((s, x) => s + x, 0);
    const tamanhosDaSaida = sa.map((q, i) => ({ t: i + 1, q })).filter((x) => x.q > 0);
    const qtd = Math.floor(Number(it.quantidade) || 0);
    if (qtd === totalSaida && tamanhosDaSaida.length > 0) {
      for (const { t, q } of tamanhosDaSaida) resultado.push({ ...it, quantidade: q, tamanho: t });
    } else if (tamanhosDaSaida.length === 1) {
      resultado.push({ ...it, tamanho: tamanhosDaSaida[0].t });
    } else {
      resultado.push(it);
    }
  }
  return resultado;
}

/**
 * Tamanho efetivo de cada item: o informado (peça P/M/G) ou o TAMANHO_BASE.
 * Chamar DEPOIS de `validarTamanhos`.
 */
export function tamanhoEfetivo(it: ItemComTamanho, grades: Map<string, GradeProduto>): number {
  const grade = grades.get((it.produto || '').trim());
  if (grade?.exigeTamanho) return Number(it.tamanho);
  return grade?.tamanhoBase ?? 1;
}

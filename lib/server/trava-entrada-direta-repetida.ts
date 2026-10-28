import { query } from '@/lib/db/connection';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA DE ENTRADA DIRETA REPETIDA — a mesma lista não vira dois romaneios.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * A trava de `trava-entrada-duplicada.ts` só cobre entrada que confirma uma
 * saída (tem `REF SAIDA` no OBS). Entrada DIRETA (NERD PRODUÇÃO, entrada avulsa)
 * não tem vínculo nenhum — e a mesma lista pode chegar em duas telas: o rascunho
 * de uma pessoa é retomado por outra, ou uma cópia velha da aba Rascunhos volta
 * depois que o romaneio já foi registrado.
 *
 * Foi o caso 836272 × 836273 (NERD, 28/10/2026): a FATIMA registrou a entrada da
 * nota (72 produtos / 154 peças) e, 96 s depois, o ALECIO registrou a MESMA lista
 * com 7 produtos a mais como romaneio novo — 154 peças entraram em dobro.
 *
 * Prova: entrada direta na mesma filial, digitada nas últimas `HORAS_JANELA`
 * horas, que divide com o pedido pelo menos `FRACAO_MINIMA` das peças do MENOR
 * dos dois (pedido ⊇ existente, como no caso acima, ou pedido ⊆ existente, a
 * cópia velha registrada depois). Pequenas repetições (≤ `MIN_PECAS_COMUM`
 * peças / `MIN_LINHAS_COMUM` itens) não contam — repor a mesma peça no dia é normal.
 *
 * Não é proibição: a tela mostra o romaneio parecido e deixa (a) acrescentar só a
 * diferença nele ou (b) registrar mesmo assim, se for outra nota.
 */

const HORAS_JANELA = 24;
const FRACAO_MINIMA = 0.8;
const MIN_PECAS_COMUM = 5;
const MIN_LINHAS_COMUM = 3;

export interface ItemEntradaDireta {
  produto: string;
  corProduto: string | null;
  quantidade: number;
  /** Tamanho efetivo (posição da grade) — o mesmo que vai para EN_n. */
  tamanho: number;
}

export interface EntradaDiretaRepetida {
  romaneio: string;
  responsavel: string;
  /** DATA_DIGITACAO do romaneio existente, "dd/mm hh:mm" na hora do banco (Brasília). */
  quando: string | null;
  pecasExistente: number;
  pecasPedido: number;
  pecasEmComum: number;
  /**
   * Por linha do pedido (mesma ordem de `itens`): peças que AINDA NÃO estão no
   * romaneio existente. É o que a tela oferece acrescentar nele.
   */
  restante: number[];
}

function sqlLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

/** Cor vem '06' de uma fonte e '6' de outra — compara pelo número quando é número. */
function normCor(value: string | null | undefined): string {
  const cor = (value || '').trim().toUpperCase();
  return /^\d+$/.test(cor) ? String(parseInt(cor, 10)) : cor;
}

function chaveItem(produto: string, cor: string | null | undefined): string {
  return `${(produto || '').trim().toUpperCase()}|${normCor(cor)}`;
}

/** Dia (YYYY-MM-DD, Brasília) de `horas` atrás — piso de EMISSAO para usar o índice. */
function diaDeHorasAtras(horas: number): string {
  const d = new Date(Date.now() - horas * 60 * 60 * 1000);
  return d.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
}

/**
 * DATETIME do Linx não tem fuso: o driver o entrega como se fosse UTC, com o
 * relógio de Brasília dentro. Por isso o rótulo sai da string ISO, sem conversão.
 */
function rotuloDataBanco(value: unknown): string | null {
  const iso = value instanceof Date ? value.toISOString() : value ? String(value) : '';
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]} ${m[4]}:${m[5]}` : null;
}

async function nomeFilialLinx(filial: string): Promise<string> {
  const f = sqlLiteral((filial || '').trim());
  const rows = await query<{ FILIAL: string }>(`
    SELECT TOP 1 FILIAL FROM FILIAIS WITH (NOLOCK)
    WHERE COD_FILIAL = '${f}' OR RTRIM(FILIAL) = '${f}'
  `);
  return (rows[0]?.FILIAL || filial || '').trim();
}

interface Candidata {
  romaneio: string;
  responsavel: string;
  quando: string | null;
  total: number;
  /** produto|cor → tamanho → peças. Tamanho 0 = linha sem grade (legado). */
  porItem: Map<string, Map<number, number>>;
}

/**
 * Procura uma entrada direta recente que já tenha (quase) a mesma lista.
 * `null` = pode gravar. Erro de consulta propaga: a rota segue fail-open.
 */
export async function buscarEntradaDiretaRepetida(params: {
  filial: string;
  itens: ItemEntradaDireta[];
}): Promise<EntradaDiretaRepetida | null> {
  if (params.itens.length === 0) return null;

  const pedido = new Map<string, number>();
  let pecasPedido = 0;
  for (const it of params.itens) {
    const q = Math.max(0, Math.round(it.quantidade));
    const k = chaveItem(it.produto, it.corProduto);
    pedido.set(k, (pedido.get(k) ?? 0) + q);
    pecasPedido += q;
  }

  const filialNome = await nomeFilialLinx(params.filial);
  const colunasGrade = Array.from({ length: 48 }, (_, i) => `ISNULL(p.EN_${i + 1}, 0) AS EN_${i + 1}`).join(', ');

  const rows = await query<Record<string, unknown>>(`
    SELECT
      RTRIM(e.ROMANEIO_PRODUTO) AS ROM,
      RTRIM(ISNULL(e.RESPONSAVEL, '')) AS RESP,
      e.DATA_DIGITACAO,
      RTRIM(p.PRODUTO) AS PRODUTO,
      RTRIM(ISNULL(CAST(p.COR_PRODUTO AS VARCHAR(20)), '')) AS COR,
      ISNULL(p.QTDE, 0) AS QTDE,
      ${colunasGrade}
    FROM ESTOQUE_PROD_ENT e WITH (NOLOCK)
    JOIN ESTOQUE_PROD1_ENT p WITH (NOLOCK)
      ON p.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
     AND (p.FILIAL IS NULL OR LTRIM(RTRIM(p.FILIAL)) = '' OR p.FILIAL = e.FILIAL)
    WHERE RTRIM(e.FILIAL) = '${sqlLiteral(filialNome)}'
      AND e.EMISSAO >= '${diaDeHorasAtras(HORAS_JANELA)}'
      AND e.DATA_DIGITACAO >= DATEADD(HOUR, -${HORAS_JANELA}, GETDATE())
      AND ISNULL(LTRIM(RTRIM(e.FILIAL_ORIGEM)), '') = ''
      AND NOT EXISTS (
        SELECT 1 FROM LOJA_ENTRADAS le WITH (NOLOCK)
        WHERE le.ROMANEIO_PRODUTO = e.ROMANEIO_PRODUTO
          AND le.FILIAL = e.FILIAL
          AND ISNULL(le.ENTRADA_CANCELADA, 0) = 1
      )
  `);

  const candidatas = new Map<string, Candidata>();
  for (const r of rows) {
    const rom = String(r.ROM ?? '').trim();
    if (!candidatas.has(rom)) {
      candidatas.set(rom, {
        romaneio: rom,
        responsavel: String(r.RESP ?? '').trim(),
        quando: rotuloDataBanco(r.DATA_DIGITACAO),
        total: 0,
        porItem: new Map(),
      });
    }
    const c = candidatas.get(rom)!;
    const k = chaveItem(String(r.PRODUTO ?? ''), String(r.COR ?? ''));
    const grade = c.porItem.get(k) ?? new Map<number, number>();
    const qtde = Math.trunc(Number(r.QTDE) || 0);
    let somaGrade = 0;
    for (let t = 1; t <= 48; t++) {
      const v = Math.trunc(Number(r[`EN_${t}`]) || 0);
      if (v > 0) {
        grade.set(t, (grade.get(t) ?? 0) + v);
        somaGrade += v;
      }
    }
    // Linha antiga sem grade: a quantidade casa com qualquer tamanho.
    if (somaGrade === 0 && qtde > 0) grade.set(0, (grade.get(0) ?? 0) + qtde);
    c.porItem.set(k, grade);
    c.total += somaGrade > 0 ? somaGrade : Math.max(0, qtde);
  }

  let melhor: { c: Candidata; comum: number } | null = null;
  for (const c of candidatas.values()) {
    let comum = 0;
    let linhasComum = 0;
    for (const [k, q] of pedido) {
      const grade = c.porItem.get(k);
      if (!grade) continue;
      const existente = [...grade.values()].reduce((s, v) => s + v, 0);
      const m = Math.min(q, existente);
      if (m > 0) {
        comum += m;
        linhasComum += 1;
      }
    }
    if (comum < MIN_PECAS_COMUM || linhasComum < MIN_LINHAS_COMUM) continue;
    if (comum < FRACAO_MINIMA * Math.min(c.total, pecasPedido)) continue;
    if (!melhor || comum > melhor.comum) melhor = { c, comum };
  }
  if (!melhor) return null;

  // Diferença linha a linha: consome o que já está no romaneio (mesmo tamanho
  // primeiro, depois a linha sem grade) e devolve o que sobra de cada linha.
  const saldo = new Map<string, Map<number, number>>();
  for (const [k, grade] of melhor.c.porItem) saldo.set(k, new Map(grade));
  const restante = params.itens.map((it) => {
    let falta = Math.max(0, Math.round(it.quantidade));
    const grade = saldo.get(chaveItem(it.produto, it.corProduto));
    if (!grade) return falta;
    for (const t of [it.tamanho, 0]) {
      const disp = grade.get(t) ?? 0;
      const usa = Math.min(disp, falta);
      if (usa > 0) {
        grade.set(t, disp - usa);
        falta -= usa;
      }
    }
    return falta;
  });

  return {
    romaneio: melhor.c.romaneio,
    responsavel: melhor.c.responsavel,
    quando: melhor.c.quando,
    pecasExistente: melhor.c.total,
    pecasPedido,
    pecasEmComum: melhor.comum,
    restante,
  };
}

export function mensagemEntradaDiretaRepetida(r: EntradaDiretaRepetida): string {
  const quem = [r.responsavel ? `por ${r.responsavel}` : '', r.quando ? `em ${r.quando}` : ''].filter(Boolean).join(' ');
  return (
    `Esta lista repete a entrada ${r.romaneio} (registrada${quem ? ` ${quem}` : ''}): ${r.pecasEmComum} das ${r.pecasPedido} peças ` +
    `já estão nela. Registrar de novo duplicaria o estoque — nada foi lançado.`
  );
}

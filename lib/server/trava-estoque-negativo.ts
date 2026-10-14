import { query } from '@/lib/db/connection';
import { carregarEstoquePorTamanho, carregarGrades, chaveSku } from '@/lib/server/grade-produto';

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  TRAVA DE ESTOQUE NEGATIVO — saída não passa do saldo onde o Linx não deixa.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Quem manda é o Linx: `FILIAIS.PERMITE_EST_NEGATIVO = 0` faz o trigger
 * LXU_ESTOQUE_PRODUTOS recusar qualquer UPDATE que deixe ESTOQUE ou um ESx < 0
 * ("Operacao Cancelada! O Estoque nao pode ser negativo!"). Vale para todas as
 * telas do ERP, para o PDV e para o dashboard. Hoje: NERD (matriz, 000069, desde
 * 14/10/2026) e SCARF ME - MATRIZ, entre outras.
 *
 * Por que conferir aqui também, se o Linx já recusa: via proxy o executor NÃO
 * roda em transação. Cabeçalho e itens são statements separados — o Linx recusa o
 * 3º item, mas o cabeçalho e os 2 primeiros já ficaram gravados (romaneio pela
 * metade). Conferir ANTES de gravar evita isso e devolve uma mensagem legível.
 *
 * A filial é lida do cadastro (não há lista fixa aqui): ligar/desligar o
 * parâmetro no Linx liga/desliga esta trava junto.
 *
 * Conferência por TAMANHO, como o trigger: a saída baixa a coluna do tamanho
 * (o informado na peça P/M/G, ou o TAMANHO_BASE), então precisa caber no ESn
 * daquele tamanho E o total precisa caber no ESTOQUE. Item sem linha em
 * ESTOQUE_PRODUTOS tem saldo 0.
 */

export interface ItemSaidaSaldo {
  produto: string;
  corProduto?: string | null;
  quantidade: number;
  /** Posição da grade; sem ele, o TAMANHO_BASE do produto. */
  tamanho?: number | null;
}

export interface FaltaSaldo {
  produto: string;
  cor: string;
  /** Rótulo do tamanho (P/M/G…) quando a falta é de um tamanho; vazio = total. */
  tamanho: string;
  pedido: number;
  disponivel: number;
}

export interface TravaEstoqueNegativo {
  filial: string;
  faltas: FaltaSaldo[];
}

function lit(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Confere se a saída cabe no saldo da filial. `null` = pode gravar (ou a filial
 * permite estoque negativo). Falha de consulta propaga: a gravação também iria
 * falhar no mesmo banco.
 */
export async function verificarSaldoSaida(
  filial: string,
  itens: ItemSaidaSaldo[]
): Promise<TravaEstoqueNegativo | null> {
  const filialTrim = (filial || '').trim();
  if (!filialTrim || !itens?.length) return null;

  const cad = await query<{ FILIAL: string; PERMITE: number | boolean | null }>(`
    SELECT TOP 1 RTRIM(FILIAL) AS FILIAL, PERMITE_EST_NEGATIVO AS PERMITE
    FROM FILIAIS WITH (NOLOCK)
    WHERE FILIAL = ${lit(filialTrim)} OR COD_FILIAL = ${lit(filialTrim)}
  `);
  const row = cad[0];
  if (!row || row.PERMITE === null || Number(row.PERMITE) === 1 || row.PERMITE === true) return null;
  const filialNome = row.FILIAL;

  const produtos = [...new Set(itens.map((it) => (it.produto || '').trim()).filter(Boolean))];
  const [grades, saldos] = await Promise.all([
    carregarGrades(produtos),
    carregarEstoquePorTamanho(filialNome, produtos),
  ]);

  // Pedido por SKU (total) e por SKU×tamanho — o mesmo SKU pode vir em várias linhas.
  const total = new Map<string, { produto: string; cor: string; pedido: number }>();
  const porTamanho = new Map<string, { produto: string; cor: string; tamanho: number; pedido: number }>();
  for (const it of itens) {
    const produto = (it.produto || '').trim();
    const cor = (it.corProduto ?? '').toString().trim();
    const qtd = Math.floor(Number(it.quantidade) || 0);
    if (!produto || qtd <= 0) continue;
    const grade = grades.get(produto);
    const t = Number(it.tamanho);
    const tamanho = Number.isInteger(t) && t >= 1 && t <= 48 ? t : grade?.tamanhoBase ?? 1;
    const sku = chaveSku(produto, cor);
    const tot = total.get(sku) ?? { produto, cor, pedido: 0 };
    tot.pedido += qtd;
    total.set(sku, tot);
    const kt = `${sku}#${tamanho}`;
    const pt = porTamanho.get(kt) ?? { produto, cor, tamanho, pedido: 0 };
    pt.pedido += qtd;
    porTamanho.set(kt, pt);
  }
  if (total.size === 0) return null;

  const faltas: FaltaSaldo[] = [];
  for (const [kt, p] of porTamanho) {
    const saldo = saldos.get(kt.split('#')[0]);
    const disponivel = saldo?.es[p.tamanho - 1] ?? 0;
    if (p.pedido > disponivel) {
      const grade = grades.get(p.produto);
      const rotulo = grade?.exigeTamanho
        ? grade.tamanhos.find((g) => g.ordinal === p.tamanho)?.label ?? String(p.tamanho)
        : '';
      faltas.push({ produto: p.produto, cor: p.cor, tamanho: rotulo, pedido: p.pedido, disponivel });
    }
  }
  for (const [sku, p] of total) {
    const disponivel = saldos.get(sku)?.estoque ?? 0;
    const jaListado = faltas.some((f) => chaveSku(f.produto, f.cor) === sku);
    if (p.pedido > disponivel && !jaListado) {
      faltas.push({ produto: p.produto, cor: p.cor, tamanho: '', pedido: p.pedido, disponivel });
    }
  }
  return faltas.length > 0 ? { filial: filialNome, faltas } : null;
}

export function mensagemTravaEstoqueNegativo(trava: TravaEstoqueNegativo): string {
  const lista = trava.faltas
    .slice(0, 10)
    .map(
      (f) =>
        `${f.produto}${f.cor ? ` cor ${f.cor}` : ''}${f.tamanho ? ` tam. ${f.tamanho}` : ''} ` +
        `(pedido ${f.pedido}, saldo ${Math.max(0, f.disponivel)})`
    )
    .join('; ');
  const resto = trava.faltas.length > 10 ? ` e mais ${trava.faltas.length - 10} item(ns)` : '';
  return (
    `Saldo insuficiente em ${trava.filial}: esta filial não pode ficar com estoque negativo. ` +
    `Sem saldo para: ${lista}${resto}. Nada foi gravado — lance a entrada que falta antes da saída.`
  );
}
